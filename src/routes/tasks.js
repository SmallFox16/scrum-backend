import express from 'express';
import db from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Helper: get Product Backlog project ID
function getProductBacklogId() {
  const row = db.prepare("SELECT id FROM projects WHERE name = 'Product Backlog'").get();
  return row ? row.id : null;
}

// Helper: get assignees for a task
function getAssignees(taskId) {
  return db.prepare(`
    SELECT u.id, u.name, u.avatar
    FROM task_assignees ta
    JOIN users u ON ta.user_id = u.id
    WHERE ta.task_id = ?
    ORDER BY u.name ASC
  `).all(taskId);
}

// Helper: get assignees for multiple tasks at once
function getAssigneesForTasks(taskIds) {
  if (taskIds.length === 0) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT ta.task_id, u.id, u.name, u.avatar
    FROM task_assignees ta
    JOIN users u ON ta.user_id = u.id
    WHERE ta.task_id IN (${placeholders})
    ORDER BY u.name ASC
  `).all(...taskIds);

  const map = {};
  for (const row of rows) {
    if (!map[row.task_id]) map[row.task_id] = [];
    map[row.task_id].push({ id: row.id, name: row.name, avatar: row.avatar });
  }
  return map;
}

// Helper: set assignees for a task (replaces all)
function setAssignees(taskId, userIds) {
  const del = db.prepare('DELETE FROM task_assignees WHERE task_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)');
  db.transaction(() => {
    del.run(taskId);
    for (const uid of userIds) {
      ins.run(taskId, uid);
    }
  })();
}

// Attach assignees to task objects
function attachAssignees(tasks) {
  const ids = tasks.map((t) => t.id);
  const assigneeMap = getAssigneesForTasks(ids);
  return tasks.map((t) => ({
    ...t,
    assignees: assigneeMap[t.id] || [],
  }));
}

// GET /api/tasks/backlog-items — PBIs available for sprint linking
router.get('/backlog-items', authenticate, (req, res) => {
  const backlogId = getProductBacklogId();
  if (!backlogId) return res.json({ tasks: [] });

  const tasks = db.prepare(`
    SELECT tasks.*, users.name as assigned_name
    FROM tasks LEFT JOIN users ON tasks.assigned_to = users.id
    WHERE tasks.project_id = ? AND tasks.sprint_project_id IS NULL
    ORDER BY tasks.priority ASC, tasks.created_at DESC
  `).all(backlogId);

  res.json({ tasks: attachAssignees(tasks) });
});

// GET all tasks (optionally filter by project)
router.get('/', authenticate, (req, res) => {
  const { project_id } = req.query;

  let tasks;
  if (project_id) {
    const backlogId = getProductBacklogId();
    if (String(project_id) === String(backlogId)) {
      tasks = db.prepare(`
        SELECT tasks.*, users.name as assigned_name,
               sp.name as sprint_project_name
        FROM tasks
        LEFT JOIN users ON tasks.assigned_to = users.id
        LEFT JOIN projects sp ON tasks.sprint_project_id = sp.id
        WHERE tasks.project_id = ?
        ORDER BY tasks.priority ASC, tasks.created_at DESC
      `).all(project_id);
    } else {
      tasks = db.prepare(`
        SELECT tasks.*, users.name as assigned_name,
               sp.name as sprint_project_name
        FROM tasks
        LEFT JOIN users ON tasks.assigned_to = users.id
        LEFT JOIN projects sp ON tasks.sprint_project_id = sp.id
        WHERE tasks.project_id = ? OR tasks.sprint_project_id = ?
        ORDER BY tasks.created_at DESC
      `).all(project_id, project_id);
    }
  } else {
    tasks = db.prepare(`
      SELECT tasks.*, users.name as assigned_name,
             sp.name as sprint_project_name
      FROM tasks
      LEFT JOIN users ON tasks.assigned_to = users.id
      LEFT JOIN projects sp ON tasks.sprint_project_id = sp.id
      ORDER BY tasks.created_at DESC
    `).all();
  }

  res.json({ tasks: attachAssignees(tasks) });
});

// GET single task
router.get('/:id', authenticate, (req, res) => {
  const task = db.prepare(`
    SELECT tasks.*, users.name as assigned_name,
           sp.name as sprint_project_name
    FROM tasks
    LEFT JOIN users ON tasks.assigned_to = users.id
    LEFT JOIN projects sp ON tasks.sprint_project_id = sp.id
    WHERE tasks.id = ?
  `).get(req.params.id);

  if (!task) return res.status(404).json({ error: 'Task not found' });
  task.assignees = getAssignees(task.id);
  res.json({ task });
});

// POST create task
router.post('/', authenticate, (req, res) => {
  const { title, description, status, assigned_to, assignee_ids, project_id, sprint_project_id, time_estimate, due_date } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, assigned_to, project_id, sprint_project_id, time_estimate, due_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title,
    description || '',
    status || 'todo',
    assigned_to || null,
    project_id || null,
    sprint_project_id || null,
    time_estimate || null,
    due_date || null
  );

  const taskId = result.lastInsertRowid;

  // Set assignees if provided
  if (Array.isArray(assignee_ids) && assignee_ids.length > 0) {
    setAssignees(taskId, assignee_ids);
  }

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  task.assignees = getAssignees(taskId);
  res.status(201).json({ task });
});

// PUT /api/tasks/reorder — Reorder tasks by priority
router.put('/reorder', authenticate, (req, res) => {
  const { taskIds } = req.body;
  if (!Array.isArray(taskIds)) {
    return res.status(400).json({ error: 'taskIds array is required' });
  }

  const update = db.prepare('UPDATE tasks SET priority = ? WHERE id = ?');
  const reorderAll = db.transaction(() => {
    for (let i = 0; i < taskIds.length; i++) {
      update.run(i, taskIds[i]);
    }
  });
  reorderAll();

  res.json({ message: 'Tasks reordered' });
});

// PUT update task
router.put('/:id', authenticate, (req, res) => {
  const { title, description, status, assigned_to, assignee_ids, project_id, sprint_project_id, time_estimate, due_date } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, status = ?, assigned_to = ?,
      project_id = ?, sprint_project_id = ?, time_estimate = ?, due_date = ?
    WHERE id = ?
  `).run(
    title ?? task.title,
    description ?? task.description,
    status ?? task.status,
    assigned_to !== undefined ? assigned_to : task.assigned_to,
    project_id ?? task.project_id,
    sprint_project_id !== undefined ? sprint_project_id : task.sprint_project_id,
    time_estimate !== undefined ? time_estimate : task.time_estimate,
    due_date !== undefined ? due_date : task.due_date,
    req.params.id
  );

  // Update assignees if provided
  if (Array.isArray(assignee_ids)) {
    setAssignees(req.params.id, assignee_ids);
  }

  const updated = db.prepare(`
    SELECT tasks.*, users.name as assigned_name,
           sp.name as sprint_project_name
    FROM tasks
    LEFT JOIN users ON tasks.assigned_to = users.id
    LEFT JOIN projects sp ON tasks.sprint_project_id = sp.id
    WHERE tasks.id = ?
  `).get(req.params.id);
  updated.assignees = getAssignees(req.params.id);
  res.json({ task: updated });
});

// DELETE task
router.delete('/:id', authenticate, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ message: 'Task deleted' });
});

export default router;

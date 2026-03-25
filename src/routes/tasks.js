import express from 'express';
import db from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Helper: get Product Backlog project ID
function getProductBacklogId() {
  const row = db.prepare("SELECT id FROM projects WHERE name = 'Product Backlog'").get();
  return row ? row.id : null;
}

// GET /api/tasks/backlog-items — PBIs available for sprint linking
// (Must be before /:id route to avoid matching "backlog-items" as an id)
router.get('/backlog-items', authenticate, (req, res) => {
  const backlogId = getProductBacklogId();
  if (!backlogId) return res.json({ tasks: [] });

  const tasks = db.prepare(`
    SELECT tasks.*, users.name as assigned_name
    FROM tasks LEFT JOIN users ON tasks.assigned_to = users.id
    WHERE tasks.project_id = ? AND tasks.sprint_project_id IS NULL
    ORDER BY tasks.priority ASC, tasks.created_at DESC
  `).all(backlogId);

  res.json({ tasks });
});

// GET all tasks (optionally filter by project)
router.get('/', authenticate, (req, res) => {
  const { project_id } = req.query;

  let tasks;
  if (project_id) {
    const backlogId = getProductBacklogId();
    if (String(project_id) === String(backlogId)) {
      // Product Backlog: order by priority
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
      // Sprint project: show own tasks + PBIs linked to this sprint
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

  res.json({ tasks });
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
  res.json({ task });
});

// POST create task
router.post('/', authenticate, (req, res) => {
  const { title, description, status, assigned_to, project_id, sprint_project_id, time_estimate, due_date } = req.body;
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

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
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
  const { title, description, status, assigned_to, project_id, sprint_project_id, time_estimate, due_date } = req.body;
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

  const updated = db.prepare(`
    SELECT tasks.*, users.name as assigned_name,
           sp.name as sprint_project_name
    FROM tasks
    LEFT JOIN users ON tasks.assigned_to = users.id
    LEFT JOIN projects sp ON tasks.sprint_project_id = sp.id
    WHERE tasks.id = ?
  `).get(req.params.id);
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

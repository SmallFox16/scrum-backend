import express from 'express';
import db from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET all tasks (optionally filter by project)
router.get('/', authenticate, (req, res) => {
  const { project_id } = req.query;

  const tasks = project_id
    ? db.prepare(`
        SELECT tasks.*, users.name as assigned_name 
        FROM tasks LEFT JOIN users ON tasks.assigned_to = users.id
        WHERE tasks.project_id = ?
        ORDER BY tasks.created_at DESC
      `).all(project_id)
    : db.prepare(`
        SELECT tasks.*, users.name as assigned_name 
        FROM tasks LEFT JOIN users ON tasks.assigned_to = users.id
        ORDER BY tasks.created_at DESC
      `).all();

  res.json({ tasks });
});

// GET single task
router.get('/:id', authenticate, (req, res) => {
  const task = db.prepare(`
    SELECT tasks.*, users.name as assigned_name 
    FROM tasks LEFT JOIN users ON tasks.assigned_to = users.id
    WHERE tasks.id = ?
  `).get(req.params.id);

  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json({ task });
});

// POST create task
router.post('/', authenticate, (req, res) => {
  const { title, description, status, assigned_to, project_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const result = db.prepare(`
    INSERT INTO tasks (title, description, status, assigned_to, project_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(title, description || '', status || 'todo', assigned_to || null, project_id || null);

  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ task });
});

// PUT update task
router.put('/:id', authenticate, (req, res) => {
  const { title, description, status, assigned_to, project_id } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  db.prepare(`
    UPDATE tasks SET title = ?, description = ?, status = ?, assigned_to = ?, project_id = ?
    WHERE id = ?
  `).run(
    title ?? task.title,
    description ?? task.description,
    status ?? task.status,
    assigned_to ?? task.assigned_to,
    project_id ?? task.project_id,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
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

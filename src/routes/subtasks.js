import express from 'express';
import db from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/tasks/:taskId/subtasks — all subtasks for a task
router.get('/:taskId/subtasks', authenticate, (req, res) => {
  const subtasks = db.prepare(
    'SELECT * FROM subtasks WHERE parent_task_id = ? ORDER BY sort_order ASC, id ASC'
  ).all(req.params.taskId);
  res.json({ subtasks });
});

// POST /api/tasks/:taskId/subtasks — create a subtask
router.post('/:taskId/subtasks', authenticate, (req, res) => {
  const { title, description } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const parentTask = db.prepare('SELECT id FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!parentTask) return res.status(404).json({ error: 'Parent task not found' });

  // Set sort_order to next available number
  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) as max_order FROM subtasks WHERE parent_task_id = ?'
  ).get(req.params.taskId);

  const result = db.prepare(
    'INSERT INTO subtasks (parent_task_id, title, description, sort_order) VALUES (?, ?, ?, ?)'
  ).run(req.params.taskId, title, description || '', maxOrder.max_order + 1);

  const subtask = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ subtask });
});

// PUT /api/tasks/:taskId/subtasks/:id — update a subtask
router.put('/:taskId/subtasks/:id', authenticate, (req, res) => {
  const { title, description, status } = req.body;
  const subtask = db.prepare(
    'SELECT * FROM subtasks WHERE id = ? AND parent_task_id = ?'
  ).get(req.params.id, req.params.taskId);

  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  db.prepare(
    'UPDATE subtasks SET title = ?, description = ?, status = ? WHERE id = ?'
  ).run(
    title ?? subtask.title,
    description ?? subtask.description,
    status ?? subtask.status,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(req.params.id);
  res.json({ subtask: updated });
});

// DELETE /api/tasks/:taskId/subtasks/:id — delete a subtask
router.delete('/:taskId/subtasks/:id', authenticate, (req, res) => {
  const subtask = db.prepare(
    'SELECT * FROM subtasks WHERE id = ? AND parent_task_id = ?'
  ).get(req.params.id, req.params.taskId);

  if (!subtask) return res.status(404).json({ error: 'Subtask not found' });

  db.prepare('DELETE FROM subtasks WHERE id = ?').run(req.params.id);
  res.json({ message: 'Subtask deleted' });
});

export default router;

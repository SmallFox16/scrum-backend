import express from 'express';
import db from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET all projects
router.get('/', authenticate, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json({ projects });
});

// GET single project
router.get('/:id', authenticate, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json({ project });
});

// POST create project (members + admin)
router.post('/', authenticate, (req, res) => {
  const { name, description, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const result = db.prepare(
    'INSERT INTO projects (name, description, status) VALUES (?, ?, ?)'
  ).run(name, description || '', status || 'active');

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ project });
});

// PUT update project
router.put('/:id', authenticate, (req, res) => {
  const { name, description, status } = req.body;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  db.prepare(
    'UPDATE projects SET name = ?, description = ?, status = ? WHERE id = ?'
  ).run(name || project.name, description ?? project.description, status || project.status, req.params.id);

  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  res.json({ project: updated });
});

// DELETE project
router.delete('/:id', authenticate, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ message: 'Project deleted' });
});

export default router;

import express from 'express';
import db from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/users — Return all users (excluding passwords)
router.get('/', authenticate, (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, role, gender, avatar FROM users ORDER BY name ASC'
  ).all();
  res.json({ users });
});

// PUT /api/users/:id/avatar — Update user avatar
router.put('/:id/avatar', authenticate, (req, res) => {
  const { avatar } = req.body;
  if (!avatar) return res.status(400).json({ error: 'avatar is required' });

  // Users can only update their own avatar
  if (String(req.user.id) !== String(req.params.id)) {
    return res.status(403).json({ error: 'Cannot update another user\'s avatar' });
  }

  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, req.params.id);
  const user = db.prepare('SELECT id, name, email, role, gender, avatar FROM users WHERE id = ?').get(req.params.id);
  res.json({ user });
});

export default router;

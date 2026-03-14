import express from 'express';
import db from '../database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// GET /api/users — Return all users (excluding passwords)
router.get('/', authenticate, (req, res) => {
  const users = db.prepare(
    'SELECT id, name, email, role FROM users ORDER BY name ASC'
  ).all();
  res.json({ users });
});

export default router;

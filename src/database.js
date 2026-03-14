import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = process.env.NODE_ENV === 'production' ? '/app/data/scrum.db' : 'scrum.db';
mkdirSync(dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo',
    assigned_to INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default users if none exist
const existingUsers = db.prepare('SELECT * FROM users').all();

if (existingUsers.length === 0) {
  const users = [
    { name: 'Admin',     email: 'admin@scrum.com',     password: 'admin123',     role: 'admin'  },
    { name: 'Marcus',    email: 'marcus@scrum.com',     password: 'marcus123',    role: 'member' },
    { name: 'Alexander', email: 'alexander@scrum.com',  password: 'alexander123', role: 'member' },
    { name: 'Robert',    email: 'robert@scrum.com',     password: 'robert123',    role: 'member' },
  ];

  const insert = db.prepare(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  );

  for (const user of users) {
    const hashed = bcrypt.hashSync(user.password, 10);
    insert.run(user.name, user.email, hashed, user.role);
  }

  console.log('Default users created');
}

export default db;

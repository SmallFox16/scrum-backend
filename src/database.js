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
    role TEXT NOT NULL DEFAULT 'member',
    gender TEXT DEFAULT 'male',
    avatar TEXT
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo',
    assigned_to INTEGER REFERENCES users(id),
    project_id INTEGER REFERENCES projects(id),
    sprint_project_id INTEGER REFERENCES projects(id),
    priority INTEGER DEFAULT 0,
    time_estimate TEXT,
    due_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS task_assignees (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    PRIMARY KEY (task_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'todo',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ============================================================
// Migrations for existing databases
// ============================================================

const projectCols = db.prepare("PRAGMA table_info(projects)").all();
if (!projectCols.some((c) => c.name === 'status')) {
  db.exec("ALTER TABLE projects ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
}

const userCols = db.prepare("PRAGMA table_info(users)").all();
if (!userCols.some((c) => c.name === 'gender')) {
  db.exec("ALTER TABLE users ADD COLUMN gender TEXT DEFAULT 'male'");
}
if (!userCols.some((c) => c.name === 'avatar')) {
  db.exec("ALTER TABLE users ADD COLUMN avatar TEXT");
}

const taskCols = db.prepare("PRAGMA table_info(tasks)").all();
if (!taskCols.some((c) => c.name === 'sprint_project_id')) {
  db.exec("ALTER TABLE tasks ADD COLUMN sprint_project_id INTEGER REFERENCES projects(id)");
}
if (!taskCols.some((c) => c.name === 'priority')) {
  db.exec("ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 0");
}
if (!taskCols.some((c) => c.name === 'time_estimate')) {
  db.exec("ALTER TABLE tasks ADD COLUMN time_estimate TEXT");
}
if (!taskCols.some((c) => c.name === 'due_date')) {
  db.exec("ALTER TABLE tasks ADD COLUMN due_date TEXT");
}
if (!taskCols.some((c) => c.name === 'priority_level')) {
  db.exec("ALTER TABLE tasks ADD COLUMN priority_level TEXT DEFAULT NULL");
}

// ============================================================
// Seed default users if none exist
// ============================================================

const existingUsers = db.prepare('SELECT * FROM users').all();

if (existingUsers.length === 0) {
  const users = [
    { name: 'Admin',     email: 'admin@scrum.com',      password: 'admin123',     role: 'admin',  gender: 'male'   },
    { name: 'Marcus',    email: 'marcus@scrum.com',      password: 'marcus123',    role: 'member', gender: 'male'   },
    { name: 'Alexander', email: 'alexander@scrum.com',   password: 'alexander123', role: 'member', gender: 'male'   },
    { name: 'Robert',    email: 'robert@scrum.com',      password: 'robert123',    role: 'member', gender: 'male'   },
    { name: 'Cayleigh',  email: 'cayleigh@scrum.com',    password: 'cayleigh123',  role: 'member', gender: 'female' },
    { name: 'Brandon',   email: 'brandon@scrum.com',     password: 'brandon123',   role: 'member', gender: 'male'   },
    { name: 'Cooper',    email: 'cooper@scrum.com',      password: 'cooper123',    role: 'member', gender: 'male'   },
    { name: 'Lucien',    email: 'lucien@scrum.com',      password: 'lucien123',    role: 'member', gender: 'male'   },
    { name: 'Ash',       email: 'ash@scrum.com',         password: 'ash123',       role: 'member', gender: 'female' },
    { name: 'Auggie',    email: 'auggie@scrum.com',      password: 'auggie123',    role: 'member', gender: 'male'   },
  ];

  const insert = db.prepare(
    'INSERT INTO users (name, email, password, role, gender) VALUES (?, ?, ?, ?, ?)'
  );

  for (const user of users) {
    const hashed = bcrypt.hashSync(user.password, 10);
    insert.run(user.name, user.email, hashed, user.role, user.gender);
  }

  console.log('Default users created');
}

// ============================================================
// Seed "Product Backlog" project if it doesn't exist
// ============================================================

const productBacklog = db.prepare("SELECT * FROM projects WHERE name = 'Product Backlog'").get();
if (!productBacklog) {
  db.prepare(
    "INSERT INTO projects (name, description, status) VALUES (?, ?, ?)"
  ).run('Product Backlog', 'Central backlog for all product backlog items', 'active');
  console.log('Product Backlog project created');
}

export default db;

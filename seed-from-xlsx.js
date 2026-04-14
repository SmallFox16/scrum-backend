/**
 * Seed script: imports all PBI data from PBI_Master.xlsx into scrum.db
 *
 * Run: node seed-from-xlsx.js
 * Requires: xlsx package (npm install xlsx --no-save)
 *
 * This will:
 * 1. Start the database (creates tables + default users via database.js)
 * 2. Create Sprint 1 and Sprint 2 projects
 * 3. Import all PBIs from all 3 sheets
 * 4. Link PBIs to sprint projects where applicable
 * 5. Set up assignees via the task_assignees junction table
 */

import XLSX from 'xlsx';
import db from './src/database.js';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const xlsxPath = resolve(__dirname, '..', 'PBI_Master.xlsx');

// Status mapping from Excel to backend
const STATUS_MAP = {
  'TODO': 'todo',
  'DONE': 'done',
  'INREVIEW': 'in_review',
  'INPROGRESS': 'in_progress',
  'TOBEREFINED': 'to_be_refined',
};

// Priority mapping
const PRIORITY_MAP = {
  'High': 'high',
  'Medium': 'medium',
  'Low': 'low',
};

// Get user IDs by name
function getUsersByName() {
  const users = db.prepare('SELECT id, name FROM users').all();
  const map = {};
  for (const u of users) {
    map[u.name.toLowerCase()] = u.id;
  }
  return map;
}

// Parse assignee string like "Cooper, Marcus" into user IDs
function parseAssignees(assigneeStr, userMap) {
  if (!assigneeStr) return [];
  return assigneeStr.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(name => userMap[name] !== undefined)
    .map(name => userMap[name]);
}

// Parse sprint reference from "Sprint / Notes" column
function parseSprintRef(notes) {
  if (!notes) return null;
  const match = notes.match(/Sprint:\s*Sprint\s*(\d+)/i);
  return match ? `Sprint ${match[1]}` : null;
}

function seed() {
  const wb = XLSX.readFile(xlsxPath);
  console.log('Sheets found:', wb.SheetNames);

  const userMap = getUsersByName();
  console.log('Users in DB:', Object.keys(userMap).length);

  // Ensure Sprint 1 and Sprint 2 projects exist
  const sprintProjects = {};
  for (const sprintName of ['Sprint 1', 'Sprint 2']) {
    let project = db.prepare('SELECT * FROM projects WHERE name = ?').get(sprintName);
    if (!project) {
      const result = db.prepare(
        "INSERT INTO projects (name, description, status) VALUES (?, ?, ?)"
      ).run(sprintName, `${sprintName} sprint backlog`, 'active');
      project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
      console.log(`Created project: ${sprintName} (id: ${project.id})`);
    } else {
      console.log(`Project exists: ${sprintName} (id: ${project.id})`);
    }
    sprintProjects[sprintName] = project.id;
  }

  // Get Product Backlog project
  const pbProject = db.prepare("SELECT * FROM projects WHERE name = 'Product Backlog'").get();
  if (!pbProject) {
    console.error('Product Backlog project not found!');
    process.exit(1);
  }
  console.log(`Product Backlog project id: ${pbProject.id}`);

  // Track titles we've already inserted (to handle duplicates across sheets)
  // The Product Backlog sheet is the master — it contains all PBIs including ones in sprints
  // Sprint sheets contain the sprint-specific view
  // Strategy: seed from Product Backlog sheet first (it has sprint links), then add
  // any sprint-only items that aren't in the Product Backlog sheet

  const insertTask = db.prepare(`
    INSERT INTO tasks (title, description, status, project_id, sprint_project_id, priority_level, time_estimate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertAssignee = db.prepare(
    'INSERT OR IGNORE INTO task_assignees (task_id, user_id) VALUES (?, ?)'
  );

  const seenTitles = new Set();
  let totalInserted = 0;

  // --- Seed from Product Backlog sheet first (it's the master) ---
  const pbSheet = wb.Sheets['Product Backlog'];
  if (pbSheet) {
    const rows = XLSX.utils.sheet_to_json(pbSheet, { header: 1 });
    console.log(`\nProcessing Product Backlog sheet (${rows.length - 1} rows)...`);

    for (let i = 1; i < rows.length; i++) {
      const [title, priority, estimate, status, assignees, notes] = rows[i];
      if (!title) continue;

      const dbStatus = STATUS_MAP[status] || 'to_be_refined';
      const dbPriority = PRIORITY_MAP[priority] || null;
      const sprintRef = parseSprintRef(notes);
      const sprintId = sprintRef ? (sprintProjects[sprintRef] || null) : null;

      const result = insertTask.run(
        title,
        '',
        dbStatus,
        pbProject.id,        // All PBIs belong to Product Backlog
        sprintId,             // Linked to sprint if applicable
        dbPriority,
        estimate || null
      );

      const taskId = result.lastInsertRowid;
      const userIds = parseAssignees(assignees, userMap);
      for (const uid of userIds) {
        insertAssignee.run(taskId, uid);
      }

      seenTitles.add(title.trim().toLowerCase());
      totalInserted++;
    }
    console.log(`  Inserted ${totalInserted} PBIs from Product Backlog`);
  }

  // --- Seed Sprint 1 and Sprint 2 items that aren't already in the backlog ---
  for (const sheetName of ['Sprint 1', 'Sprint 2']) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`\nProcessing ${sheetName} sheet (${rows.length - 1} rows)...`);
    let added = 0;

    for (let i = 1; i < rows.length; i++) {
      const [title, priority, estimate, status, assignees] = rows[i];
      if (!title) continue;

      // Skip if already inserted from the Product Backlog sheet
      if (seenTitles.has(title.trim().toLowerCase())) continue;

      const dbStatus = STATUS_MAP[status] || 'to_be_refined';
      const dbPriority = PRIORITY_MAP[priority] || null;
      const sprintId = sprintProjects[sheetName] || null;

      const result = insertTask.run(
        title,
        '',
        dbStatus,
        pbProject.id,
        sprintId,
        dbPriority,
        estimate || null
      );

      const taskId = result.lastInsertRowid;
      const userIds = parseAssignees(assignees, userMap);
      for (const uid of userIds) {
        insertAssignee.run(taskId, uid);
      }

      seenTitles.add(title.trim().toLowerCase());
      added++;
      totalInserted++;
    }
    console.log(`  Added ${added} new items from ${sheetName} (skipped duplicates)`);
  }

  console.log(`\n=== Seeding complete ===`);
  console.log(`Total PBIs inserted: ${totalInserted}`);
  console.log(`Projects: ${db.prepare('SELECT COUNT(*) as c FROM projects').get().c}`);
  console.log(`Tasks: ${db.prepare('SELECT COUNT(*) as c FROM tasks').get().c}`);
  console.log(`Task assignees: ${db.prepare('SELECT COUNT(*) as c FROM task_assignees').get().c}`);
}

seed();

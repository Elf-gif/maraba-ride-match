// Simple JSON-file backed store. Good enough for a small cohort of students.
// Swap this out for a real database (see schema.sql) if usage grows.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

function emptyState() {
  return {
    nextId: { users: 1, duties: 1, matches: 1, adminActions: 1 },
    users: [],
    duties: [],
    matches: [],
    adminActions: []
  };
}

function load() {
  if (!fs.existsSync(DATA_FILE)) {
    const state = emptyState();
    save(state);
    return state;
  }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}

function save(state) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function nextId(state, table) {
  const id = state.nextId[table];
  state.nextId[table] += 1;
  return id;
}

module.exports = { load, save, nextId, DATA_FILE };

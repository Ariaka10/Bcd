import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { normalize } from './util.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  level TEXT,
  teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('admin', 'enseignant', 'eleve')),
  username TEXT UNIQUE,
  password_hash TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  avatar TEXT,
  secret_code TEXT,
  birth_date TEXT,
  sex TEXT,
  ine TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY,
  isbn TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  authors TEXT,
  publisher TEXT,
  pub_year INTEGER,
  pages INTEGER,
  series TEXT,
  series_number TEXT,
  doc_type TEXT NOT NULL DEFAULT 'album',
  dewey TEXT,
  subjects TEXT,
  summary TEXT,
  audience TEXT,
  cover_url TEXT,
  cote TEXT,
  location TEXT,
  notes TEXT,
  source TEXT,
  source_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_isbn ON documents(isbn);

CREATE TABLE IF NOT EXISTS copies (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  barcode TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'ok' CHECK (state IN ('ok', 'abime', 'perdu', 'reparation')),
  acquired_at TEXT NOT NULL DEFAULT (date('now', 'localtime')),
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_copies_doc ON copies(document_id);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY,
  copy_id INTEGER REFERENCES copies(id) ON DELETE SET NULL,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  doc_title TEXT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  loaned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  renewals INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  loaned_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_loans_active ON loans(returned_at, copy_id);
CREATE INDEX IF NOT EXISTS idx_loans_user ON loans(user_id);
CREATE INDEX IF NOT EXISTS idx_loans_doc ON loans(document_id);

CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS list_items (
  list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (list_id, document_id)
);
`;

export const DEFAULT_SETTINGS = {
  school_name: 'Ma BCD',
  loan_days_eleve: '14',
  loan_days_enseignant: '28',
  loan_days_admin: '28',
  max_loans_eleve: '2',
  max_loans_enseignant: '20',
  max_loans_admin: '20',
  max_renewals: '1',
  block_if_overdue: '1',
  barcode_prefix: 'BCD',
};

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.function('norm', { deterministic: true }, (s) => normalize(s));
  db.exec(SCHEMA);
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  return db;
}

export function getSettings(db) {
  const out = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) out[r.key] = r.value;
  return out;
}

/** Exécute fn dans une transaction. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

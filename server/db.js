import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { normalize } from './util.js';

// Un prêt est fait à un usager OU à une classe entière (prêt de lot).
const LOANS_COLUMNS = `
  id INTEGER PRIMARY KEY,
  copy_id INTEGER REFERENCES copies(id) ON DELETE SET NULL,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  doc_title TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
  loaned_at TEXT NOT NULL,
  due_at TEXT NOT NULL,
  returned_at TEXT,
  renewals INTEGER NOT NULL DEFAULT 0,
  lost INTEGER NOT NULL DEFAULT 0,
  loaned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CHECK (user_id IS NOT NULL OR class_id IS NOT NULL)`;

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
  archived_at TEXT,
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
  keywords TEXT,
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

CREATE TABLE IF NOT EXISTS loans (${LOANS_COLUMNS}
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

CREATE TABLE IF NOT EXISTS themes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  emoji TEXT,
  color TEXT,
  for_students INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS document_themes (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  theme_id INTEGER NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, theme_id)
);
CREATE INDEX IF NOT EXISTS idx_doc_themes_theme ON document_themes(theme_id);

-- Avis des élèves : 1 = bof, 2 = bien, 3 = adoré
CREATE TABLE IF NOT EXISTS reviews (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 3),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, document_id)
);

-- attente : le livre est emprunté ; prete : un exemplaire est mis de côté ; terminee / annulee
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'attente' CHECK (status IN ('attente', 'prete', 'terminee', 'annulee')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ready_at TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_doc ON reservations(document_id, status);

-- Date d'archivage d'un usager (élève parti), tenue à jour automatiquement.
CREATE TRIGGER IF NOT EXISTS users_archived AFTER UPDATE OF active ON users
  WHEN NEW.active IS NOT OLD.active
BEGIN
  UPDATE users SET archived_at = CASE WHEN NEW.active = 0 THEN datetime('now') ELSE NULL END WHERE id = NEW.id;
END;

-- Couvertures ajoutées à la main (photo, image du PC), stockées dans la base pour fonctionner sans Internet.
CREATE TABLE IF NOT EXISTS covers (
  document_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  loan_days_classe: '35',
  max_loans_classe: '40',
  // 1 : les élèves ne voient que les livres rangés dans un thème « visible par les élèves »
  restrict_student_catalog: '0',
  // Sauvegarde supplémentaire (clé USB…) : dossier choisi et date de la dernière copie
  extra_backup_dir: '',
  extra_backup_last: '',
};

/** Année scolaire en cours : « 2026-2027 » de septembre 2026 à août 2027. */
export function currentSchoolYear(d = new Date()) {
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${y + 1}`;
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // WAL + synchronous FULL : chaque modification est écrite sur le disque dès qu'elle est validée,
  // une coupure de courant ne fait perdre au plus que l'opération en cours.
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;');
  db.function('norm', { deterministic: true }, (s) => normalize(s));
  migrateSchema(db);
  db.exec(SCHEMA);
  ensureDefaults(db);
  return db;
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

/** Met à niveau une base créée par une version précédente (avant création des nouvelles tables). */
function migrateSchema(db) {
  const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((t) => t.name));
  if (tables.has('users') && !columns(db, 'users').includes('archived_at')) {
    db.exec('ALTER TABLE users ADD COLUMN archived_at TEXT');
    db.exec(`UPDATE users SET archived_at = datetime('now') WHERE active = 0`);
  }
  if (tables.has('documents') && !columns(db, 'documents').includes('keywords')) {
    db.exec('ALTER TABLE documents ADD COLUMN keywords TEXT');
  }
  // v1.1 : prêts aux classes → la colonne user_id devient facultative (reconstruction de la table).
  if (tables.has('loans') && !columns(db, 'loans').includes('class_id')) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      db.exec(`CREATE TABLE loans_v11 (${LOANS_COLUMNS});
        INSERT INTO loans_v11 (id, copy_id, document_id, doc_title, user_id, loaned_at, due_at, returned_at, renewals, lost, loaned_by)
          SELECT id, copy_id, document_id, doc_title, user_id, loaned_at, due_at, returned_at, renewals, lost, loaned_by FROM loans;
        DROP TABLE loans;
        ALTER TABLE loans_v11 RENAME TO loans;`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

/**
 * Réglages par défaut et corrections de données (sans effet si déjà faites).
 * Appelé aussi après la restauration d'une ancienne sauvegarde.
 */
export function ensureDefaults(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  // Année scolaire pour laquelle l'assistant de rentrée a été fait : une nouvelle installation
  // (ou une mise à jour en cours d'année) n'a pas besoin de l'assistant avant la prochaine rentrée.
  ins.run('school_year_done', currentSchoolYear());
  db.exec('CREATE INDEX IF NOT EXISTS idx_loans_class ON loans(class_id)');
  // v1.1 : numéros d'exemplaire simples (1, 2, 3…) au lieu de « BCD000001 ».
  const old = db.prepare(`SELECT id, barcode FROM copies WHERE barcode GLOB 'BCD[0-9][0-9][0-9][0-9][0-9][0-9]'`).all();
  if (old.length) {
    const upd = db.prepare('UPDATE copies SET barcode = ? WHERE id = ?');
    const taken = db.prepare('SELECT 1 FROM copies WHERE barcode = ?');
    tx(db, () => {
      for (const c of old) {
        const n = String(Number(c.barcode.slice(3)));
        if (!taken.get(n)) upd.run(n, c.id);
      }
    });
  }
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

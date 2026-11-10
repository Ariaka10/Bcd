/** Sauvegardes de la base : copie à chaud, sauvegardes automatiques et restauration. */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { HttpError } from './util.js';

// Ordre sans importance : les clés étrangères sont désactivées pendant la restauration.
const TABLES = ['settings', 'classes', 'users', 'documents', 'copies', 'loans', 'lists', 'list_items',
  'themes', 'document_themes', 'reviews', 'reservations', 'covers'];

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}h${p(d.getMinutes())}`;
}

/** Copie cohérente de la base, même pendant son utilisation. */
export function snapshot(db, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  db.prepare('VACUUM INTO ?').run(file);
  return file;
}

export function backupFileName(prefix = 'bcd-sauvegarde') {
  return `${prefix}_${stamp()}.sqlite`;
}

/** Sauvegarde automatique : garde les `keep` plus récentes de ce type. */
export function autoBackup(db, dir, { keep = 10, prefix = 'bcd-auto' } = {}) {
  const file = snapshot(db, path.join(dir, backupFileName(prefix)));
  const old = fs.readdirSync(dir).filter((f) => f.startsWith(prefix + '_') && f.endsWith('.sqlite')).sort().reverse();
  for (const f of old.slice(keep)) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}

export function listBackups(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, date: st.mtime.toISOString() };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Vérifie qu'un fichier est bien une sauvegarde BCD ; renvoie quelques chiffres. */
export function inspectBackup(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\0') throw new HttpError(400, 'Ce fichier n\'est pas une sauvegarde BCD');
  let bk;
  try {
    bk = new DatabaseSync(file, { readOnly: true });
    const tables = new Set(bk.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((t) => t.name));
    if (!['documents', 'users', 'loans'].every((t) => tables.has(t))) throw new HttpError(400, 'Ce fichier n\'est pas une sauvegarde BCD');
    if (bk.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new HttpError(400, 'Sauvegarde endommagée');
    return {
      documents: bk.prepare('SELECT COUNT(*) AS n FROM documents').get().n,
      users: bk.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Fichier illisible : ' + e.message);
  } finally {
    bk?.close();
  }
}

/**
 * Remplace le contenu de la base par celui d'une sauvegarde.
 * Une copie de sécurité de l'état actuel est faite avant, dans `safetyDir`.
 */
export function restoreFrom(db, file, { safetyDir } = {}) {
  const info = inspectBackup(file);
  if (safetyDir) autoBackup(db, safetyDir, { keep: 5, prefix: 'bcd-avant-restauration' });

  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare('ATTACH DATABASE ? AS bk').run(file);
  try {
    db.exec('BEGIN');
    try {
      for (const t of TABLES) {
        const cols = (schema) => db.prepare(`PRAGMA ${schema}.table_info(${t})`).all().map((c) => c.name);
        const backupCols = new Set(cols('bk'));
        db.exec(`DELETE FROM main.${t}`);
        if (!backupCols.size) continue;
        const common = cols('main').filter((c) => backupCols.has(c)).map((c) => `"${c}"`).join(', ');
        db.exec(`INSERT INTO main.${t} (${common}) SELECT ${common} FROM bk.${t}`);
      }
      // Les sessions ouvertes ne correspondent plus : tout le monde se reconnecte.
      db.exec('DELETE FROM main.sessions');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } finally {
    db.exec('DETACH DATABASE bk');
    db.exec('PRAGMA foreign_keys = ON');
  }
  return info;
}

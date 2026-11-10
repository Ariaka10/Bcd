import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError, localDate, randomToken } from '../util.js';
import { getSettings, DEFAULT_SETTINGS, ensureDefaults } from '../db.js';
import { staff, admin, anyUser } from '../guards.js';
import { fixMojibake, hasMojibake } from '../text.js';
import { snapshot, backupFileName, autoBackup, listBackups, restoreFrom } from '../backup.js';

function tempFile() {
  return path.join(os.tmpdir(), `bcd-${randomToken().slice(0, 12)}.sqlite`);
}

export default function (r, { backupDir, appInfo, installUpdate, checkUpdate } = {}) {
  // Téléchargement d'une copie complète de la base.
  r.get('/api/admin/backup', admin, ({ db, res }) => {
    const tmp = snapshot(db, tempFile());
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': fs.statSync(tmp).size,
      'Content-Disposition': `attachment; filename="${backupFileName()}"`,
    });
    fs.createReadStream(tmp).pipe(res).on('close', () => fs.rmSync(tmp, { force: true }));
  });

  // Restauration depuis un fichier envoyé par le navigateur.
  r.post('/api/admin/restore', admin, ({ db, raw }) => {
    if (!raw?.length) throw new HttpError(400, 'Aucun fichier reçu');
    const tmp = tempFile();
    fs.writeFileSync(tmp, raw);
    try {
      const info = restoreFrom(db, tmp, { safetyDir: backupDir });
      ensureDefaults(db);
      return { ok: true, ...info };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  // Sauvegardes automatiques (version bureau).
  r.get('/api/admin/backups', admin, () => ({ dir: backupDir ?? null, items: listBackups(backupDir) }));

  r.post('/api/admin/backups', admin, ({ db }) => {
    if (!backupDir) throw new HttpError(400, 'Dossier de sauvegarde non configuré');
    return { file: path.basename(autoBackup(db, backupDir, { keep: 30, prefix: 'bcd-manuelle' })) };
  });

  r.post('/api/admin/backups/:name/restore', admin, ({ db, params }) => {
    if (!backupDir) throw new HttpError(400, 'Dossier de sauvegarde non configuré');
    const name = path.basename(params.name);
    const file = path.join(backupDir, name);
    if (!name.endsWith('.sqlite') || !fs.existsSync(file)) throw new HttpError(404, 'Sauvegarde introuvable');
    // On restaure depuis une copie : la sauvegarde de sécurité pourrait sinon écraser ce fichier.
    const tmp = tempFile();
    fs.copyFileSync(file, tmp);
    try {
      const info = restoreFrom(db, tmp, { safetyDir: backupDir });
      ensureDefaults(db);
      return { ok: true, ...info };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  // Réparation des accents abîmés déjà enregistrés (aperçu puis application).
  const REPAIRABLE = {
    documents: ['title', 'subtitle', 'authors', 'publisher', 'series', 'subjects', 'summary', 'keywords', 'audience'],
    users: ['first_name', 'last_name'],
    classes: ['name'],
    lists: ['name', 'description'],
    themes: ['name'],
  };
  const findRepairs = (db) => {
    const out = [];
    for (const [table, fields] of Object.entries(REPAIRABLE)) {
      for (const row of db.prepare(`SELECT id, ${fields.join(', ')} FROM ${table}`).all()) {
        for (const f of fields) {
          if (!hasMojibake(row[f])) continue;
          const after = fixMojibake(row[f]);
          if (after !== row[f]) out.push({ table, id: row.id, field: f, before: row[f], after });
        }
      }
    }
    return out;
  };
  r.get('/api/admin/text-repair', admin, ({ db }) => ({ items: findRepairs(db) }));
  r.post('/api/admin/text-repair', admin, ({ db }) => {
    const items = findRepairs(db);
    db.exec('BEGIN');
    try {
      for (const i of items) db.prepare(`UPDATE ${i.table} SET ${i.field} = ? WHERE id = ?`).run(i.after, i.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { repaired: items.length };
  });

  // Version de l'application et mise à jour disponible (renseignées par l'application Windows).
  r.get('/api/app/info', anyUser, () => appInfo?.() ?? { desktop: false });
  r.post('/api/app/check-update', admin, async () => {
    if (checkUpdate) await checkUpdate();
    return appInfo?.() ?? { desktop: false };
  });
  r.post('/api/app/install-update', admin, async () => {
    if (!installUpdate) throw new HttpError(400, 'Mise à jour automatique indisponible');
    return installUpdate();
  });

  r.get('/api/settings', staff, ({ db }) => getSettings(db));

  r.put('/api/settings', admin, ({ db, body }) => {
    const upd = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (!(k in body)) continue;
      const v = String(body[k] ?? '').trim();
      if ((k.startsWith('loan_days_') || k.startsWith('max_')) && !(Number(v) >= 0)) throw new HttpError(400, `Valeur invalide : ${k}`);
      upd.run(k, v);
    }
    return getSettings(db);
  });

  r.get('/api/stats', staff, ({ db }) => {
    const today = localDate();
    const one = (sql, ...a) => db.prepare(sql).get(...a).n;
    const year = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    const schoolYearStart = `${year}-09-01`;
    return {
      documents: one('SELECT COUNT(*) AS n FROM documents'),
      copies: one('SELECT COUNT(*) AS n FROM copies'),
      students: one(`SELECT COUNT(*) AS n FROM users WHERE role = 'eleve' AND active = 1`),
      classes: one('SELECT COUNT(*) AS n FROM classes'),
      active_loans: one('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL'),
      overdue: one('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL AND due_at < ?', today),
      loans_this_year: one('SELECT COUNT(*) AS n FROM loans WHERE loaned_at >= ?', schoolYearStart),
      by_type: db.prepare('SELECT doc_type, COUNT(*) AS n FROM documents GROUP BY doc_type ORDER BY n DESC').all(),
      top_documents: db.prepare(`SELECT d.id, d.title, d.cote, COUNT(*) AS n FROM loans l JOIN documents d ON d.id = l.document_id
        WHERE l.loaned_at >= ? GROUP BY d.id ORDER BY n DESC LIMIT 10`).all(schoolYearStart),
      by_class: db.prepare(`SELECT c.name, (SELECT COUNT(*) FROM loans l LEFT JOIN users u ON u.id = l.user_id
          WHERE coalesce(l.class_id, u.class_id) = c.id AND l.loaned_at >= ?) AS n
        FROM classes c ORDER BY c.name`).all(schoolYearStart),
      reservations: one(`SELECT COUNT(*) AS n FROM reservations WHERE status = 'prete'`),
      recent: db.prepare(`SELECT id, title, cote, cover_url FROM documents ORDER BY created_at DESC, id DESC LIMIT 8`).all(),
    };
  });
}

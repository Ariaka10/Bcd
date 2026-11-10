import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HttpError, localDate, randomToken } from '../util.js';
import { getSettings, DEFAULT_SETTINGS, ensureDefaults, currentSchoolYear } from '../db.js';
import { staff, admin, anyUser } from '../guards.js';
import { fixMojibake, hasMojibake } from '../text.js';
import { snapshot, backupFileName, autoBackup, listBackups, restoreFrom, resolveExtraDir, copyToExtraDir } from '../backup.js';

function tempFile() {
  return path.join(os.tmpdir(), `bcd-${randomToken().slice(0, 12)}.sqlite`);
}

export default function (r, { backupDir, appInfo, installUpdate, checkUpdate, chooseFolder } = {}) {
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

  /* ----- Sauvegarde supplémentaire (clé USB…) ----- */

  const extraInfo = (db) => {
    const s = getSettings(db);
    const resolved = resolveExtraDir(s.extra_backup_dir);
    const days = s.extra_backup_last ? Math.floor((Date.now() - Date.parse(s.extra_backup_last)) / 86400000) : null;
    return { dir: s.extra_backup_dir || null, resolved, available: Boolean(resolved), last: s.extra_backup_last || null, days_since: days };
  };

  r.get('/api/admin/extra-backup', admin, ({ db }) => extraInfo(db));

  r.put('/api/admin/extra-backup', admin, ({ db, body }) => {
    const dir = String(body.dir ?? '').trim();
    if (dir) {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new HttpError(400, 'Dossier introuvable (la clé est-elle branchée ?)');
      try {
        const probe = path.join(dir, `.bcd-test-${randomToken().slice(0, 6)}`);
        fs.writeFileSync(probe, 'ok');
        fs.rmSync(probe);
      } catch {
        throw new HttpError(400, 'Impossible d\'écrire dans ce dossier');
      }
    }
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'extra_backup_dir'`).run(dir);
    if (dir) copyToExtraDir(db, dir);
    return extraInfo(db);
  });

  r.post('/api/admin/extra-backup/run', admin, ({ db }) => {
    const s = getSettings(db);
    if (!s.extra_backup_dir) throw new HttpError(400, 'Aucun dossier choisi');
    if (!copyToExtraDir(db, s.extra_backup_dir)) throw new HttpError(409, 'Clé USB / dossier introuvable : est-elle branchée ?');
    return extraInfo(db);
  });

  r.post('/api/app/choose-folder', admin, async () => {
    if (!chooseFolder) throw new HttpError(400, 'Disponible seulement dans l\'application Windows');
    return { dir: await chooseFolder() };
  });

  /* ----- Rappels pour l'administrateur (rentrée, clé USB) ----- */

  r.get('/api/admin/reminders', admin, ({ db }) => {
    const s = getSettings(db);
    const year = currentSchoolYear();
    const extra = extraInfo(db);
    return {
      rentree: s.school_year_done !== year ? year : null,
      extra_backup_days: extra.dir && (extra.days_since === null || extra.days_since >= 7) ? extra.days_since ?? -1 : null,
    };
  });

  /* ----- Assistant « Nouvelle année scolaire » ----- */

  r.get('/api/admin/rentree', admin, ({ db }) => {
    const year = currentSchoolYear();
    return {
      year,
      done: getSettings(db).school_year_done === year,
      pending_loans: db.prepare('SELECT COUNT(*) AS n FROM loans WHERE returned_at IS NULL').get().n,
      students: db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'eleve' AND active = 1`).get().n,
      archived: db.prepare(`SELECT u.id, u.first_name, u.last_name, u.archived_at, c.name AS class_name,
          (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.returned_at IS NULL) AS active_loans
        FROM users u LEFT JOIN classes c ON c.id = u.class_id
        WHERE u.role = 'eleve' AND u.active = 0 ORDER BY u.archived_at, u.last_name`).all(),
      empty_classes: db.prepare(`SELECT c.id, c.name FROM classes c
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.class_id = c.id AND u.active = 1)
          AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.class_id = c.id AND l.returned_at IS NULL)
        ORDER BY c.name`).all(),
    };
  });

  // Suppression définitive des élèves partis (RGPD) : seulement des comptes archivés sans prêt en cours.
  r.post('/api/admin/rentree/purge', admin, ({ db, body }) => {
    const del = db.prepare(`DELETE FROM users WHERE id = ? AND role = 'eleve' AND active = 0
      AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.user_id = users.id AND l.returned_at IS NULL)`);
    let n = 0;
    db.exec('BEGIN');
    try {
      for (const id of body.ids ?? []) n += Number(del.run(Number(id)).changes);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { deleted: n };
  });

  r.post('/api/admin/rentree/classes', admin, ({ db, body }) => {
    const del = db.prepare(`DELETE FROM classes WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.class_id = classes.id AND u.active = 1)
      AND NOT EXISTS (SELECT 1 FROM loans l WHERE l.class_id = classes.id AND l.returned_at IS NULL)`);
    let n = 0;
    for (const id of body.ids ?? []) n += Number(del.run(Number(id)).changes);
    return { deleted: n };
  });

  r.post('/api/admin/rentree/done', admin, ({ db }) => {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('school_year_done', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(currentSchoolYear());
    return { ok: true };
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

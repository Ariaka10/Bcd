import { HttpError, localDate } from '../util.js';
import { getSettings, DEFAULT_SETTINGS } from '../db.js';
import { staff, admin } from '../guards.js';

export default function (r) {
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
      by_class: db.prepare(`SELECT c.name, COUNT(l.id) AS n FROM classes c
        LEFT JOIN users u ON u.class_id = c.id LEFT JOIN loans l ON l.user_id = u.id AND l.loaned_at >= ?
        GROUP BY c.id ORDER BY c.name`).all(schoolYearStart),
      recent: db.prepare(`SELECT id, title, cote, cover_url FROM documents ORDER BY created_at DESC, id DESC LIMIT 8`).all(),
    };
  });
}

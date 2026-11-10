/** Thèmes créés par l'administrateur (« Les animaux », « Noël »…) pour classer et filtrer les livres. */
import { HttpError } from '../util.js';
import { getSettings, tx } from '../db.js';
import { staff, admin, anyUser } from '../guards.js';

function cleanTheme(body, existing = {}) {
  const t = { ...existing };
  if ('name' in body) t.name = String(body.name ?? '').trim();
  if (!t.name) throw new HttpError(400, 'Nom du thème requis');
  if ('emoji' in body) t.emoji = String(body.emoji ?? '').trim().slice(0, 16) || null;
  if ('color' in body) t.color = /^#[0-9a-f]{6}$/i.test(body.color ?? '') ? body.color : null;
  if ('for_students' in body) t.for_students = body.for_students ? 1 : 0;
  t.for_students ??= 1;
  return t;
}

export default function (r) {
  r.get('/api/themes', anyUser, ({ db, user }) => {
    const kid = user.role === 'eleve';
    return db.prepare(`SELECT t.id, t.name, t.emoji, t.color, t.for_students, t.position,
        (SELECT COUNT(*) FROM document_themes x WHERE x.theme_id = t.id) AS count
      FROM themes t ${kid ? 'WHERE t.for_students = 1' : ''} ORDER BY t.position, t.name`).all();
  });

  r.post('/api/themes', admin, ({ db, body }) => {
    const t = cleanTheme(body);
    if (db.prepare('SELECT 1 FROM themes WHERE name = ? COLLATE NOCASE').get(t.name)) throw new HttpError(409, 'Ce thème existe déjà');
    const pos = db.prepare('SELECT coalesce(MAX(position), 0) + 1 AS p FROM themes').get().p;
    const { lastInsertRowid } = db.prepare('INSERT INTO themes (name, emoji, color, for_students, position) VALUES (?, ?, ?, ?, ?)')
      .run(t.name, t.emoji ?? null, t.color ?? null, t.for_students, pos);
    return { id: Number(lastInsertRowid) };
  });

  r.put('/api/themes/:id', admin, ({ db, params, body }) => {
    const existing = db.prepare('SELECT * FROM themes WHERE id = ?').get(params.id);
    if (!existing) throw new HttpError(404, 'Thème introuvable');
    const t = cleanTheme(body, existing);
    db.prepare('UPDATE themes SET name = ?, emoji = ?, color = ?, for_students = ? WHERE id = ?')
      .run(t.name, t.emoji ?? null, t.color ?? null, t.for_students, existing.id);
    return { ok: true };
  });

  r.post('/api/themes/order', admin, ({ db, body }) => tx(db, () => {
    const upd = db.prepare('UPDATE themes SET position = ? WHERE id = ?');
    (body.ids ?? []).forEach((id, i) => upd.run(i + 1, Number(id)));
    return { ok: true };
  }));

  r.delete('/api/themes/:id', admin, ({ db, params }) => {
    db.prepare('DELETE FROM themes WHERE id = ?').run(params.id);
    return { ok: true };
  });

  // Ajouter (ou retirer) des documents d'un thème, par lot.
  r.post('/api/themes/:id/documents', staff, ({ db, params, body }) => tx(db, () => {
    if (!db.prepare('SELECT 1 FROM themes WHERE id = ?').get(params.id)) throw new HttpError(404, 'Thème introuvable');
    const ids = (body.document_ids ?? []).map(Number);
    const stmt = body.remove
      ? db.prepare('DELETE FROM document_themes WHERE theme_id = ? AND document_id = ?')
      : db.prepare('INSERT OR IGNORE INTO document_themes (theme_id, document_id) SELECT ?, id FROM documents WHERE id = ?');
    let n = 0;
    for (const id of ids) n += Number(stmt.run(Number(params.id), id).changes);
    return { changed: n };
  }));

  r.get('/api/meta/student-catalog', anyUser, ({ db }) => ({ restricted: getSettings(db).restrict_student_catalog === '1' }));
}

import { HttpError, hashPassword, normalize, randomAvatar, AVATARS, CODE_SYMBOLS, localDate } from '../util.js';
import { tx } from '../db.js';
import { staff, admin } from '../guards.js';
import { parseStudentList } from '../csv.js';
import { listLoans, listReservations } from './loans.js';

const ROLES = ['admin', 'enseignant', 'eleve'];

function splitCode(code) {
  // Les pictogrammes peuvent compter plusieurs « caractères » JS : on les découpe d'après la liste connue.
  const out = [];
  let rest = String(code ?? '');
  while (rest) {
    const sym = CODE_SYMBOLS.find((s) => rest.startsWith(s));
    if (!sym) return null;
    out.push(sym); rest = rest.slice(sym.length);
  }
  return out;
}

function cleanUser(body, existing = {}) {
  const u = { ...existing };
  for (const f of ['role', 'username', 'first_name', 'last_name', 'class_id', 'avatar', 'birth_date', 'sex', 'ine', 'active']) {
    if (f in body) u[f] = body[f] === '' ? null : body[f];
  }
  if (!ROLES.includes(u.role)) throw new HttpError(400, 'Profil inconnu');
  u.first_name = String(u.first_name ?? '').trim();
  u.last_name = String(u.last_name ?? '').trim();
  if (!u.first_name || !u.last_name) throw new HttpError(400, 'Nom et prénom obligatoires');
  if (u.avatar && !AVATARS.includes(u.avatar)) u.avatar = null;
  u.avatar ||= randomAvatar();
  u.class_id = u.class_id ? Number(u.class_id) : null;
  u.active = u.active === undefined || u.active === null ? 1 : (u.active ? 1 : 0);
  if (u.role === 'eleve') u.username = null;
  else {
    u.username = String(u.username ?? '').trim().toLowerCase() || null;
    if (!u.username) throw new HttpError(400, 'Identifiant de connexion obligatoire pour un adulte');
  }
  if ('secret_code' in body) {
    if (!body.secret_code) u.secret_code = null;
    else {
      const parts = Array.isArray(body.secret_code) ? body.secret_code : splitCode(body.secret_code);
      if (!parts || parts.some((p) => !CODE_SYMBOLS.includes(p)) || parts.length < 2 || parts.length > 4) {
        throw new HttpError(400, 'Code secret : 2 à 4 pictogrammes');
      }
      u.secret_code = parts.join('');
    }
  }
  return u;
}

const USER_COLS = ['role', 'username', 'first_name', 'last_name', 'class_id', 'avatar', 'birth_date', 'sex', 'ine', 'active', 'secret_code'];

function findOrCreateClass(db, name, level) {
  name = String(name ?? '').trim();
  if (!name) return null;
  const c = db.prepare('SELECT id FROM classes WHERE name = ? COLLATE NOCASE').get(name);
  if (c) {
    if (level) db.prepare('UPDATE classes SET level = coalesce(level, ?) WHERE id = ?').run(level, c.id);
    return c.id;
  }
  return Number(db.prepare('INSERT INTO classes (name, level) VALUES (?, ?)').run(name, level || null).lastInsertRowid);
}

/**
 * Importe une liste d'élèves. Les élèves déjà connus (même INE, ou mêmes nom + prénom + date de naissance)
 * sont mis à jour (changement de classe) ; les autres sont créés.
 * `archive_missing` désactive les élèves absents du fichier (élèves partis en fin d'année).
 */
export function importStudents(db, { text, class_name, dry_run, archive_missing }) {
  const { students, errors, columns } = parseStudentList(text, { defaultClass: class_name });
  const report = { columns, errors, created: [], moved: [], unchanged: 0, reactivated: 0, archived: [], archived_with_loans: [], new_classes: [] };
  if (!students.length) return report;

  const run = () => {
    const seen = new Set();
    const knownClasses = new Set(db.prepare('SELECT name FROM classes').all().map((c) => normalize(c.name)));
    for (const s of students) {
      if (!s.class_name) { report.errors.push(`Ligne ${s.line} : classe manquante (${s.first_name} ${s.last_name})`); continue; }
      if (!knownClasses.has(normalize(s.class_name))) {
        knownClasses.add(normalize(s.class_name));
        report.new_classes.push(s.class_name);
      }
      const classId = dry_run ? null : findOrCreateClass(db, s.class_name, s.level);

      let existing = s.ine ? db.prepare(`SELECT * FROM users WHERE role = 'eleve' AND ine = ?`).get(s.ine) : null;
      existing ??= db.prepare(`SELECT * FROM users WHERE role = 'eleve' AND norm(last_name) = ? AND norm(first_name) = ?
        AND (birth_date IS ? OR birth_date IS NULL OR ? IS NULL)`)
        .get(normalize(s.last_name), normalize(s.first_name), s.birth_date, s.birth_date);

      const label = `${s.first_name} ${s.last_name} (${s.class_name})`;
      if (existing) {
        seen.add(existing.id);
        const currentClass = existing.class_id ? db.prepare('SELECT name FROM classes WHERE id = ?').get(existing.class_id)?.name : null;
        const moved = normalize(currentClass) !== normalize(s.class_name);
        if (moved) report.moved.push(`${label} ← ${currentClass ?? 'sans classe'}`);
        else report.unchanged++;
        if (!existing.active) report.reactivated++;
        if (!dry_run) {
          db.prepare(`UPDATE users SET class_id = ?, active = 1, birth_date = coalesce(?, birth_date),
            ine = coalesce(?, ine), sex = coalesce(?, sex) WHERE id = ?`)
            .run(classId, s.birth_date, s.ine, s.sex, existing.id);
        }
      } else {
        report.created.push(label);
        if (!dry_run) {
          const { lastInsertRowid } = db.prepare(`INSERT INTO users (role, first_name, last_name, class_id, avatar, birth_date, sex, ine)
            VALUES ('eleve', ?, ?, ?, ?, ?, ?, ?)`)
            .run(s.first_name, s.last_name, classId, randomAvatar(), s.birth_date, s.sex, s.ine);
          seen.add(Number(lastInsertRowid));
        }
      }
    }
    if (archive_missing) {
      for (const u of db.prepare(`SELECT u.id, u.first_name, u.last_name, c.name AS class_name FROM users u
        LEFT JOIN classes c ON c.id = u.class_id WHERE u.role = 'eleve' AND u.active = 1`).all()) {
        if (seen.has(u.id)) continue;
        report.archived.push(`${u.first_name} ${u.last_name}${u.class_name ? ` (${u.class_name})` : ''}`);
        // Élève qui part avec un livre : signalé pour le récupérer (le prêt est conservé).
        const loans = db.prepare(`SELECT l.id, l.due_at, coalesce(d.title, l.doc_title) AS title, c.barcode FROM loans l
          LEFT JOIN documents d ON d.id = l.document_id LEFT JOIN copies c ON c.id = l.copy_id
          WHERE l.user_id = ? AND l.returned_at IS NULL ORDER BY l.due_at`).all(u.id);
        if (loans.length) {
          report.archived_with_loans.push({ id: u.id, name: `${u.first_name} ${u.last_name}`, class_name: u.class_name, loans });
        }
        if (!dry_run) db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(u.id);
      }
    }
  };

  // En simulation rien n'est écrit : on calcule seulement le compte rendu.
  if (dry_run) run();
  else tx(db, run);
  report.total = students.length;
  return report;
}

export default function (r) {
  r.get('/api/meta/avatars', () => ({ avatars: AVATARS, code_symbols: CODE_SYMBOLS }));

  r.get('/api/users', staff, ({ db, query }) => {
    const where = [];
    const args = [];
    if (query.role) { where.push('u.role = ?'); args.push(query.role); }
    if (query.class_id === 'none') where.push('u.class_id IS NULL');
    else if (query.class_id) { where.push('u.class_id = ?'); args.push(Number(query.class_id)); }
    if (query.active !== 'all') { where.push('u.active = ?'); args.push(query.active === '0' ? 0 : 1); }
    if (query.q) {
      for (const t of normalize(query.q).split(' ').filter(Boolean)) {
        where.push(`norm(u.first_name || ' ' || u.last_name || ' ' || coalesce(u.username, '')) LIKE ?`);
        args.push(`%${t}%`);
      }
    }
    const today = localDate();
    return db.prepare(`
      SELECT u.id, u.role, u.username, u.first_name, u.last_name, u.class_id, u.avatar, u.birth_date, u.sex, u.ine,
        u.active, u.secret_code IS NOT NULL AS has_code, c.name AS class_name,
        (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.returned_at IS NULL) AS active_loans,
        (SELECT COUNT(*) FROM loans l WHERE l.user_id = u.id AND l.returned_at IS NULL AND l.due_at < ?) AS overdue_loans
      FROM users u LEFT JOIN classes c ON c.id = u.class_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY u.role != 'eleve' DESC, c.name, u.last_name, u.first_name
      LIMIT ?`).all(today, ...args, Math.min(Number(query.limit) || 2000, 5000));
  });

  r.get('/api/users/:id', staff, ({ db, params, user }) => {
    const u = db.prepare(`SELECT u.*, c.name AS class_name FROM users u LEFT JOIN classes c ON c.id = u.class_id WHERE u.id = ?`).get(params.id);
    if (!u) throw new HttpError(404, 'Usager introuvable');
    delete u.password_hash;
    if (user.role !== 'admin') delete u.secret_code;
    u.loans = listLoans(db, { user_id: u.id });
    u.history = listLoans(db, { user_id: u.id, status: 'history', limit: 50 });
    u.reservations = listReservations(db, { user_id: u.id });
    return u;
  });

  r.post('/api/users', staff, ({ db, body, user }) => {
    const u = cleanUser({ role: 'eleve', ...body });
    if (user.role !== 'admin' && u.role !== 'eleve') throw new HttpError(403, 'Seul un administrateur peut créer un compte adulte');
    if (u.role !== 'eleve' && String(body.password ?? '').length < 6) throw new HttpError(400, 'Mot de passe : 6 caractères minimum');
    const cols = [...USER_COLS, 'password_hash'];
    u.password_hash = u.role !== 'eleve' ? hashPassword(body.password) : null;
    u.secret_code ??= null;
    const { lastInsertRowid } = db.prepare(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => u[c] ?? null));
    return { id: Number(lastInsertRowid) };
  });

  r.put('/api/users/:id', staff, ({ db, params, body, user }) => {
    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(params.id);
    if (!existing) throw new HttpError(404, 'Usager introuvable');
    if (user.role !== 'admin' && (existing.role !== 'eleve' || (body.role && body.role !== 'eleve'))) {
      throw new HttpError(403, 'Seul un administrateur peut modifier un compte adulte');
    }
    if (user.role !== 'admin') delete body.secret_code;
    const u = cleanUser(body, existing);
    if (existing.id === user.id && (u.role !== 'admin' || !u.active)) throw new HttpError(400, 'Vous ne pouvez pas retirer vos propres droits');
    db.prepare(`UPDATE users SET ${USER_COLS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...USER_COLS.map((c) => u[c] ?? null), existing.id);
    if (body.password && u.role !== 'eleve') {
      if (String(body.password).length < 6) throw new HttpError(400, 'Mot de passe : 6 caractères minimum');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.password), existing.id);
    }
    if (!u.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    return { ok: true };
  });

  r.delete('/api/users/:id', admin, ({ db, params, user }) => {
    if (Number(params.id) === user.id) throw new HttpError(400, 'Vous ne pouvez pas supprimer votre propre compte');
    if (db.prepare('SELECT 1 FROM loans WHERE user_id = ? AND returned_at IS NULL').get(params.id)) {
      throw new HttpError(409, 'Cet usager a des prêts en cours');
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
    return { ok: true };
  });

  /** Actions groupées : archiver, réactiver, changer de classe, supprimer. */
  r.post('/api/users/batch', admin, ({ db, body, user }) => tx(db, () => {
    const ids = (body.ids ?? []).map(Number).filter((id) => id !== user.id);
    let done = 0;
    const skipped = [];
    for (const id of ids) {
      if (body.action === 'archive') db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
      else if (body.action === 'activate') db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(id);
      else if (body.action === 'move') db.prepare('UPDATE users SET class_id = ? WHERE id = ?').run(body.class_id ? Number(body.class_id) : null, id);
      else if (body.action === 'delete') {
        if (db.prepare('SELECT 1 FROM loans WHERE user_id = ? AND returned_at IS NULL').get(id)) { skipped.push(id); continue; }
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
      } else throw new HttpError(400, 'Action inconnue');
      done++;
    }
    return { done, skipped: skipped.length };
  }));

  r.post('/api/users/import', admin, ({ db, body }) => {
    if (!body.text) throw new HttpError(400, 'Fichier vide');
    return importStudents(db, body);
  });

  // Classes
  r.get('/api/classes', staff, ({ db }) => db.prepare(`
    SELECT c.id, c.name, c.level, c.teacher_id, t.first_name || ' ' || t.last_name AS teacher_name,
      (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'eleve' AND u.active = 1) AS students,
      (SELECT COUNT(*) FROM loans l JOIN users u ON u.id = l.user_id WHERE u.class_id = c.id AND l.returned_at IS NULL) AS active_loans,
      (SELECT COUNT(*) FROM loans l WHERE l.class_id = c.id AND l.returned_at IS NULL) AS class_loans
    FROM classes c LEFT JOIN users t ON t.id = c.teacher_id ORDER BY c.name`).all());

  r.post('/api/classes', admin, ({ db, body }) => {
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'Nom de classe requis');
    const { lastInsertRowid } = db.prepare('INSERT INTO classes (name, level, teacher_id) VALUES (?, ?, ?)')
      .run(name, body.level || null, body.teacher_id || null);
    return { id: Number(lastInsertRowid) };
  });

  r.put('/api/classes/:id', admin, ({ db, params, body }) => {
    const c = db.prepare('SELECT * FROM classes WHERE id = ?').get(params.id);
    if (!c) throw new HttpError(404, 'Classe introuvable');
    db.prepare('UPDATE classes SET name = ?, level = ?, teacher_id = ? WHERE id = ?')
      .run(String(body.name ?? c.name).trim(), body.level ?? c.level, body.teacher_id === undefined ? c.teacher_id : (body.teacher_id || null), c.id);
    return { ok: true };
  });

  r.delete('/api/classes/:id', admin, ({ db, params }) => {
    if (db.prepare('SELECT 1 FROM loans WHERE class_id = ? AND returned_at IS NULL').get(params.id)) {
      throw new HttpError(409, 'Cette classe a des livres en prêt : enregistrez d\'abord leur retour');
    }
    db.prepare('DELETE FROM classes WHERE id = ?').run(params.id);
    return { ok: true };
  });
}

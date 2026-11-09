import { HttpError, hashPassword, verifyPassword, randomToken, AVATARS, CODE_SYMBOLS } from '../util.js';
import { getSettings } from '../db.js';
import { SESSION_COOKIE, anyUser } from '../guards.js';

const SESSION_HOURS = 10;

function openSession(ctx, userId) {
  const token = randomToken();
  ctx.db.prepare(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .run(token, userId, `+${SESSION_HOURS} hours`);
  ctx.db.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  ctx.res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
}

function needsSetup(db) {
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get().n === 0;
}

export default function (r) {
  r.get('/api/public/info', ({ db }) => ({
    school_name: getSettings(db).school_name,
    needs_setup: needsSetup(db),
    code_symbols: CODE_SYMBOLS,
  }));

  r.post('/api/setup', (ctx) => {
    const { db, body } = ctx;
    if (!needsSetup(db)) throw new HttpError(403, 'Déjà configuré');
    const { username, password, first_name, last_name, school_name } = body;
    if (!username || !password || String(password).length < 6) {
      throw new HttpError(400, 'Identifiant et mot de passe (6 caractères min.) requis');
    }
    if (school_name) db.prepare(`UPDATE settings SET value = ? WHERE key = 'school_name'`).run(school_name);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users (role, username, password_hash, first_name, last_name, avatar)
      VALUES ('admin', ?, ?, ?, ?, '🦉')`)
      .run(String(username).trim().toLowerCase(), hashPassword(password), first_name || 'Admin', last_name || 'BCD');
    openSession(ctx, Number(lastInsertRowid));
    return { ok: true };
  });

  r.post('/api/login', (ctx) => {
    const { username, password } = ctx.body;
    const u = ctx.db.prepare(`SELECT * FROM users WHERE username = ? AND role != 'eleve' AND active = 1`)
      .get(String(username ?? '').trim().toLowerCase());
    if (!u || !verifyPassword(password, u.password_hash)) throw new HttpError(401, 'Identifiant ou mot de passe incorrect');
    openSession(ctx, u.id);
    return { ok: true, role: u.role };
  });

  // Connexion des élèves : classe → avatar → (code secret en pictogrammes si défini).
  r.get('/api/public/classes', ({ db }) => db.prepare(`
    SELECT c.id, c.name, c.level FROM classes c
    WHERE EXISTS (SELECT 1 FROM users u WHERE u.class_id = c.id AND u.role = 'eleve' AND u.active = 1)
    ORDER BY c.name`).all());

  r.get('/api/public/classes/:id/students', ({ db, params }) => db.prepare(`
    SELECT id, first_name, substr(last_name, 1, 1) AS initial, avatar, secret_code IS NOT NULL AS has_code
    FROM users WHERE class_id = ? AND role = 'eleve' AND active = 1
    ORDER BY first_name, last_name`).all(params.id));

  r.post('/api/login/eleve', (ctx) => {
    const { user_id, code } = ctx.body;
    const u = ctx.db.prepare(`SELECT * FROM users WHERE id = ? AND role = 'eleve' AND active = 1`).get(user_id);
    if (!u) throw new HttpError(404, 'Élève introuvable');
    if (u.secret_code) {
      const given = Array.isArray(code) ? code.join('') : String(code ?? '');
      if (given !== u.secret_code) throw new HttpError(401, 'Code secret incorrect');
    }
    openSession(ctx, u.id);
    return { ok: true, role: 'eleve' };
  });

  r.post('/api/logout', (ctx) => {
    if (ctx.token) ctx.db.prepare('DELETE FROM sessions WHERE token = ?').run(ctx.token);
    ctx.res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    return { ok: true };
  });

  r.get('/api/me', ({ user }) => ({ user }));

  r.put('/api/me/password', anyUser, ({ db, user, body }) => {
    if (user.role === 'eleve') throw new HttpError(403, 'Non disponible');
    const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(body.old_password, u.password_hash)) throw new HttpError(401, 'Mot de passe actuel incorrect');
    if (String(body.new_password ?? '').length < 6) throw new HttpError(400, '6 caractères minimum');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.new_password), user.id);
    return { ok: true };
  });

  r.put('/api/me/avatar', anyUser, ({ db, user, body }) => {
    if (!AVATARS.includes(body.avatar)) throw new HttpError(400, 'Avatar inconnu');
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(body.avatar, user.id);
    return { ok: true };
  });
}

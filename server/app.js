import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, readJson, parseCookies, sendJson, serveStatic } from './http.js';
import { HttpError } from './util.js';
import { SESSION_COOKIE } from './guards.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import loanRoutes from './routes/loans.js';
import userRoutes from './routes/users.js';
import listRoutes from './routes/lists.js';
import adminRoutes from './routes/admin.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function loadUser(db, token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.role, u.username, u.first_name, u.last_name, u.class_id, u.avatar, c.name AS class_name
    FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN classes c ON c.id = u.class_id
    WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1`).get(token);
  return row ?? null;
}

export function createApp(db, { lookupIsbn } = {}) {
  const router = new Router();
  const deps = { lookupIsbn };
  authRoutes(router, deps);
  documentRoutes(router, deps);
  loanRoutes(router, deps);
  userRoutes(router, deps);
  listRoutes(router, deps);
  adminRoutes(router, deps);

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && serveStatic(PUBLIC_DIR, req, res, url.pathname)) return;
        throw new HttpError(404, 'Introuvable');
      }
      const match = router.match(req.method, url.pathname);
      if (!match) throw new HttpError(404, 'Route inconnue');

      const cookies = parseCookies(req.headers.cookie);
      const ctx = {
        req, res, db,
        params: match.params,
        query: Object.fromEntries(url.searchParams),
        body: ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {},
        token: cookies[SESSION_COOKIE],
        user: loadUser(db, cookies[SESSION_COOKIE]),
      };
      let result;
      for (const h of match.handlers) result = await h(ctx);
      if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
    } catch (e) {
      const status = e.status ?? (/constraint/i.test(e.message) ? 409 : 500);
      if (status === 500) console.error(e);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Erreur interne' : e.message });
    }
  };
}

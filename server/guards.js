import { HttpError } from './util.js';

export const SESSION_COOKIE = 'bcd_sid';

/** Garde d'accès : à placer en tête des handlers d'une route. */
export function requireRole(...roles) {
  return (ctx) => {
    if (!ctx.user) throw new HttpError(401, 'Connexion requise');
    if (roles.length && !roles.includes(ctx.user.role)) throw new HttpError(403, 'Accès réservé');
  };
}
export const staff = requireRole('admin', 'enseignant');
export const admin = requireRole('admin');
export const anyUser = requireRole();

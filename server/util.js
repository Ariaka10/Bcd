import crypto from 'node:crypto';

/** Minuscules, sans accents, espaces simplifiés. */
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

export function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** Date locale au format AAAA-MM-JJ. */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + days));
}

export function daysBetween(fromStr, toStr) {
  const a = new Date(fromStr + 'T00:00:00');
  const b = new Date(toStr + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

export function nowIso() {
  return new Date().toISOString();
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const AVATARS = [
  '🦊', '🐼', '🐨', '🦁', '🐯', '🐸', '🐵', '🐰', '🐻', '🐶',
  '🐱', '🐭', '🐹', '🐷', '🐮', '🐔', '🐧', '🐦', '🦉', '🦄',
  '🐝', '🐞', '🦋', '🐢', '🐙', '🐬', '🐳', '🦈', '🦀', '🐌',
  '🦒', '🦓', '🐘', '🦔', '🦕', '🦖', '🐲', '🦜', '🦩', '🐿️',
];

/** Pictogrammes utilisables comme « code secret » des élèves. */
export const CODE_SYMBOLS = ['🍎', '⭐', '🌈', '⚽', '🚀', '🎈', '🌻', '🍦', '🎵', '❤️', '🌙', '🚲'];

export function randomAvatar() {
  return AVATARS[crypto.randomInt(AVATARS.length)];
}

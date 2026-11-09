/** Outils ISBN / EAN. */

export function cleanIsbn(raw) {
  return String(raw ?? '').toUpperCase().replace(/[^0-9X]/g, '');
}

export function isValidIsbn10(s) {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : Number(s[i])) * (10 - i);
  return sum % 11 === 0;
}

export function isValidEan13(s) {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

export function isbn10to13(s) {
  const base = '978' + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 ? 3 : 1);
  return base + ((10 - (sum % 10)) % 10);
}

/** Renvoie l'ISBN-13 / EAN normalisé, ou null si invalide. */
export function toIsbn13(raw) {
  const s = cleanIsbn(raw);
  if (s.length === 10 && isValidIsbn10(s)) return isbn10to13(s);
  if (s.length === 13 && isValidEan13(s)) return s;
  return null;
}

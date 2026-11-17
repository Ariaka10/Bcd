/**
 * ISBN avec tirets (978-2-278-09154-6), comme imprimé dans le livre.
 * La place des tirets dépend de l'éditeur : elle suit les tranches officielles de l'agence internationale de l'ISBN.
 * Seuls les livres français sont traités (978-2 et 979-10, presque tous ceux d'une BCD) ;
 * pour les autres, l'ISBN reste sans tirets.
 */

// Tranches des codes éditeurs (ISBN International, données publiques) : [début, fin], de même longueur.
const RANGES = {
  '9782': [['00', '19'], ['200', '349'], ['35000', '39999'], ['400', '486'], ['487000', '494999'], ['495', '495'],
    ['4960', '4966'], ['49670', '49699'], ['497', '527'], ['5280', '5299'], ['530', '699'], ['7000', '8399'],
    ['84000', '89999'], ['900000', '919799'], ['91980', '91980'], ['919810', '919942'], ['9199430', '9199689'],
    ['919969', '949999'], ['9500000', '9999999']],
  '97910': [['00', '19'], ['200', '699'], ['7000', '8999'], ['90000', '97599'], ['976000', '999999']],
};

/** « 9782278091546 » → « 978-2-278-09154-6 » ; null si l'ISBN n'est pas français ou pas valide. */
export function hyphenateIsbn(isbn) {
  const s = String(isbn ?? '').replace(/[^0-9X]/gi, '');
  if (!/^97[89]\d{10}$/.test(s)) return null;
  for (const [prefix, ranges] of Object.entries(RANGES)) {
    if (!s.startsWith(prefix)) continue;
    const rest = s.slice(prefix.length, 12); // éditeur + numéro du livre (sans la clé)
    for (const [lo, hi] of ranges) {
      const part = rest.slice(0, lo.length);
      if (part >= lo && part <= hi) {
        const group = prefix === '9782' ? ['978', '2'] : ['979', '10'];
        return [...group, part, rest.slice(lo.length), s[12]].join('-');
      }
    }
  }
  return null;
}

/**
 * Réparation des textes « abîmés » : texte UTF-8 relu par erreur en Windows-1252 / Latin-1
 * (ex. « Un kilomÃ¨tre Ã  pied, Ã§a use » → « Un kilomètre à pied, ça use »).
 * On ne retouche que les séquences suspectes : les accents corrects du reste du texte sont conservés.
 */

// Caractères Windows-1252 de la plage 0x80–0x9F, vers leur octet d'origine.
const CP1252 = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

function toByte(ch) {
  if (CP1252[ch] !== undefined) return CP1252[ch];
  const c = ch.codePointAt(0);
  return c <= 0xff ? c : null;
}

const CONT = '[\\u0080-\\u00BF€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ]';
// Octet de tête UTF-8 (Â–ô) suivi de 1 à 3 octets de continuation.
const SEQ = new RegExp(`[\\u00C2-\\u00F4]${CONT}{1,3}`, 'g');
const decoder = new TextDecoder('utf-8', { fatal: true });

function decodeSeq(seq) {
  const bytes = [...seq].map(toByte);
  if (bytes.includes(null)) return null;
  try {
    const out = decoder.decode(Uint8Array.from(bytes));
    return out.length === 1 || [...out].length === 1 ? out : null;
  } catch {
    return null;
  }
}

const SUSPECT = /[ÃÂÅÄ][\u0080-¿€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ ]|â€/;

export function hasMojibake(s) {
  return typeof s === 'string' && SUSPECT.test(s);
}

export function fixMojibake(s) {
  if (!hasMojibake(s)) return s;
  let out = s;
  // Deux passes : certains textes ont été abîmés deux fois.
  for (let pass = 0; pass < 2; pass++) {
    const before = out;
    out = out.replace(SEQ, (seq) => {
      // Une séquence peut être plus longue que le caractère réel : on essaie du plus long au plus court.
      for (let len = seq.length; len >= 2; len--) {
        const d = decodeSeq(seq.slice(0, len));
        if (d) return d + seq.slice(len);
      }
      return seq;
    });
    if (out === before) break;
  }
  // « à » = octets C3 A0 ; l'espace insécable A0 est souvent devenu une espace simple : « Ã  ».
  // Si les deux espaces ont survécu (« Ã  pied »), on n'en garde qu'une.
  out = out.replace(/Ã[  ](?= )/g, 'à').replace(/Ã(?=[  ])/g, 'à');
  return out;
}

/** Corrige tous les champs texte d'un objet (notice, usager…). */
export function fixFields(obj, fields) {
  let changed = false;
  for (const f of fields) {
    if (typeof obj[f] !== 'string') continue;
    const fixed = fixMojibake(obj[f]);
    if (fixed !== obj[f]) { obj[f] = fixed; changed = true; }
  }
  return changed;
}

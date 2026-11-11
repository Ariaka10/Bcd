/**
 * Couvertures récupérées sur Internet et enregistrées dans la base,
 * pour qu'elles s'affichent même sans connexion et partent avec les sauvegardes.
 *
 * Sources essayées dans l'ordre : service officiel des couvertures de la BnF, adresse donnée par la notice,
 * Open Library, Google Books, puis Amazon si l'option est cochée. Seul l'ISBN du livre est envoyé.
 */
import crypto from 'node:crypto';
import { tx, getSettings } from './db.js';
import { toIsbn13 } from './isbn.js';
import { fetchWithTimeout, fromBnf } from './notice.js';

const MIN_BYTES = 1500; // en dessous : image vide ou pixel de remplacement
const MAX_BYTES = 2 * 1024 * 1024;
const MIN_SIDE = 60;

/** Type et dimensions d'une image (JPEG, PNG, GIF, WebP) d'après ses octets. */
export function imageInfo(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i++; continue; }
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: 'image/jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.subarray(0, 3).toString('latin1') === 'GIF') {
    return { mime: 'image/gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    const kind = buf.subarray(12, 16).toString('latin1');
    if (kind === 'VP8X' && buf.length >= 30) return { mime: 'image/webp', width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8 ' && buf.length >= 30) return { mime: 'image/webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && buf.length >= 25) {
      const b = buf.readUInt32LE(21);
      return { mime: 'image/webp', width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
  }
  return null;
}

/** Télécharge une image et vérifie que c'est une vraie couverture. null sinon (404, page web, pixel vide…). */
async function fetchImage(url) {
  const res = await fetchWithTimeout(url, 10000);
  if (!res.ok) return null;
  const data = res.body;
  if (data.length < MIN_BYTES || data.length > MAX_BYTES) return null;
  const info = imageInfo(data);
  if (!info || info.width < MIN_SIDE || info.height < MIN_SIDE) return null;
  return { mime: info.mime, data, url };
}

/**
 * Service officiel des couvertures de la BnF (Licence ouverte : la source est citée sous la couverture).
 * Sans couverture, il répond par une erreur 500 : c'est normal, on passe à la source suivante.
 */
const BNF_COVERS = 'https://openapi.bnf.fr/couverture/image/image/recupererImage';
const bnfCover = (param) => `${BNF_COVERS}?${param}&couverture=1&taille=originale&largeur=400&hauteur=600`;

/** ISBN-10 (les ISBN en 979 n'en ont pas) : c'est la référence des images Amazon. */
export function isbn10(isbn13) {
  if (!/^978\d{10}$/.test(isbn13 ?? '')) return null;
  const core = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(core[i]);
  const check = (11 - (sum % 11)) % 11;
  return core + (check === 10 ? 'X' : String(check));
}

/** Nom de la source d'après l'adresse de l'image (affiché sous la couverture). */
export function originOf(url) {
  const host = (String(url).match(/^https?:\/\/([^/]+)/) || [])[1] ?? '';
  if (host.endsWith('bnf.fr')) return 'bnf';
  if (host.endsWith('openlibrary.org')) return 'openlibrary';
  if (host.includes('google')) return 'google';
  if (host.includes('amazon')) return 'amazon';
  return 'internet';
}

const arkOf = (s) => (String(s ?? '').match(/ark:\/12148\/\w+/) || [])[0];

/**
 * Sources à essayer, de la plus fiable à la moins fiable. Chacune donne une adresse d'image (ou null) ;
 * celles qui demandent une recherche ne sont interrogées que si les précédentes n'ont rien donné.
 */
function sources(doc, { amazon = false } = {}) {
  const isbn = toIsbn13(doc.isbn ?? '');
  return [
    async () => (isbn ? bnfCover(`EAN=${isbn}`) : null),
    async () => {
      // Notice BnF sans EAN : on passe par son identifiant (ark).
      const ark = arkOf(doc.source_url) ?? (isbn ? arkOf((await fromBnf(isbn))?.source_url) : null);
      return ark ? bnfCover(`idArk=${ark}`) : null;
    },
    async () => (/^https?:\/\//.test(doc.cover_url ?? '') ? doc.cover_url : null),
    async () => (isbn ? `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false` : null),
    async () => {
      if (!isbn) return null;
      const res = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
      if (!res.ok) throw new Error(`Google Books : HTTP ${res.status}`);
      const thumb = (await res.json()).items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
      return thumb ? thumb.replace('http://', 'https://') : null;
    },
    // Amazon : en dernier recours, seulement si l'option est cochée (pas d'accès officiel, peut bloquer).
    async () => (amazon && isbn10(isbn) ? `https://images-na.ssl-images-amazon.com/images/P/${isbn10(isbn)}.01.LZZZZZZZ.jpg` : null),
  ];
}

/**
 * Cherche une couverture pour ce document.
 * Résultat : { mime, data, url } ; null si aucune source n'en a ;
 * lève une erreur si aucune source n'a pu être jointe (pas d'Internet).
 */
export async function findCover(doc, isRejected = () => false, options = {}) {
  const tried = new Set();
  let reached = false;
  let lastError = null;
  for (const source of sources(doc, options)) {
    try {
      const url = await source();
      if (!url || tried.has(url)) continue;
      tried.add(url);
      const img = await fetchImage(url);
      reached = true;
      if (img && !isRejected(hashOf(img.data))) return { ...img, origin: originOf(url) };
    } catch (e) {
      lastError = e; // une source ne répond pas : on passe à la suivante
    }
  }
  if (!reached && lastError) throw lastError;
  return null;
}

export const hashOf = (data) => crypto.createHash('sha1').update(data).digest('hex');

/** Enregistre une couverture dans la base et fait pointer le document vers elle. */
export function storeCover(db, id, { mime, data, source = 'manuel', origin = null }) {
  tx(db, () => {
    db.prepare(`INSERT INTO covers (document_id, mime, data, source, hash, origin) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(document_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, source = excluded.source,
        hash = excluded.hash, origin = excluded.origin, updated_at = datetime('now')`).run(id, mime, data, source, hashOf(data), origin);
    // Paramètre « v » : force le navigateur à afficher la nouvelle image.
    db.prepare(`UPDATE documents SET cover_url = ?, updated_at = datetime('now') WHERE id = ?`).run(`/api/documents/${id}/cover?v=${Date.now()}`, id);
  });
}

export const amazonEnabled = (db) => getSettings(db).covers_amazon === '1';

const isRejectedIn = (db) => (hash) => !!db.prepare('SELECT 1 FROM cover_rejects WHERE hash = ?').get(hash);

/**
 * Une même image trouvée pour deux livres différents est une image « pas de couverture » d'un site :
 * elle est écartée partout et ne sera plus jamais retenue.
 */
function isPlaceholder(db, id, hash, onRemoved) {
  const doc = db.prepare('SELECT isbn FROM documents WHERE id = ?').get(id);
  const others = db.prepare(`SELECT c.document_id FROM covers c JOIN documents d ON d.id = c.document_id
    WHERE c.hash = ? AND c.source = 'internet' AND c.document_id != ? AND coalesce(d.isbn, '') != coalesce(?, '')`).all(hash, id, doc?.isbn ?? null);
  if (!others.length) return false;
  tx(db, () => {
    db.prepare('INSERT OR IGNORE INTO cover_rejects (hash) VALUES (?)').run(hash);
    for (const o of others) {
      db.prepare('DELETE FROM covers WHERE document_id = ?').run(o.document_id);
      db.prepare('UPDATE documents SET cover_url = NULL, cover_tried_at = NULL WHERE id = ?').run(o.document_id);
    }
  });
  onRemoved?.(others.map((o) => o.document_id));
  return true;
}

/**
 * Récupère et enregistre la couverture d'un document qui n'en a pas encore dans la base.
 * Résultat : 'present' (déjà là), 'found', 'missing' (aucune source n'en a) ou 'error' (Internet injoignable).
 */
export async function fetchCoverFor(db, id, { onRemoved } = {}) {
  if (db.prepare('SELECT 1 FROM covers WHERE document_id = ?').get(id)) return 'present';
  const doc = db.prepare('SELECT id, isbn, cover_url, source_url FROM documents WHERE id = ?').get(id);
  if (!doc) return 'missing';
  let img;
  try {
    img = await findCover(doc, isRejectedIn(db), { amazon: amazonEnabled(db) });
  } catch {
    return 'error';
  }
  if (!db.isOpen) return 'error';
  // Le livre a pu recevoir une image à la main ou être supprimé pendant la recherche.
  if (!db.prepare('SELECT 1 FROM documents WHERE id = ?').get(id)) return 'missing';
  if (db.prepare('SELECT 1 FROM covers WHERE document_id = ?').get(id)) return 'present';
  if (img && !isPlaceholder(db, id, hashOf(img.data), onRemoved)) {
    storeCover(db, id, { ...img, source: 'internet' });
    return 'found';
  }
  db.prepare(`UPDATE documents SET cover_tried_at = datetime('now') WHERE id = ?`).run(id);
  return 'missing';
}

/** Documents qui pourraient recevoir une couverture automatique : sans image enregistrée, avec un ISBN ou une adresse. */
const NO_COVER = 'NOT EXISTS (SELECT 1 FROM covers c WHERE c.document_id = d.id)';
const SEARCHABLE = `(coalesce(d.isbn, '') != '' OR coalesce(d.cover_url, '') LIKE 'http%' OR coalesce(d.source_url, '') LIKE '%ark:/12148/%')`;
const MISSING_SQL = `${NO_COVER} AND ${SEARCHABLE}`;

export function coverStats(db) {
  return db.prepare(`SELECT
      (SELECT COUNT(*) FROM documents) AS total,
      (SELECT COUNT(*) FROM covers) AS with_cover,
      (SELECT COUNT(*) FROM documents d WHERE ${MISSING_SQL} AND d.cover_tried_at IS NULL) AS to_search,
      (SELECT COUNT(*) FROM documents d WHERE ${MISSING_SQL} AND d.cover_tried_at IS NOT NULL) AS not_found,
      (SELECT COUNT(*) FROM documents d WHERE ${NO_COVER} AND NOT ${SEARCHABLE}) AS no_isbn`).get();
}

/**
 * File d'attente unique : un livre à la fois, avec une pause entre deux livres,
 * pour ménager les sites et ne pas se faire bloquer.
 */
export function createCoverService(db, { pauseMs = 1000 } = {}) {
  const queue = [];
  let working = false;
  let job = null;

  // Pause plus longue quand Amazon est utilisé : il bloque ceux qui vont trop vite.
  const pause = () => new Promise((r) => setTimeout(r, db.isOpen && amazonEnabled(db) ? pauseMs * 2.5 : pauseMs));

  async function work() {
    if (working) return;
    working = true;
    try {
      while (db.isOpen) {
        const fromQueue = queue.length > 0;
        const id = fromQueue ? queue.shift() : job?.running ? job.ids.shift() : undefined;
        if (id === undefined) {
          if (job?.running) finish(null);
          break;
        }
        const result = await fetchCoverFor(db, id, {
          // Image « pas de couverture » repérée : les livres qui l'avaient reçue ne comptent plus comme trouvés.
          onRemoved: (ids) => { if (job) for (const x of ids) if (job.foundIds.delete(x)) { job.found--; job.missing++; } },
        });
        if (!fromQueue && job?.running) {
          job.done++;
          if (result === 'found') { job.found++; job.foundIds.add(id); }
          else if (result === 'missing') job.missing++;
          else if (result === 'error') job.errors++;
          job.streak = result === 'error' ? job.streak + 1 : 0;
          // Plusieurs échecs de suite : Internet est coupé, on s'arrête (on reprendra plus tard).
          if (job.streak >= 5) finish('Internet ne répond pas : recherche arrêtée. Elle reprendra où elle s\'est arrêtée.');
        }
        if (queue.length || job?.running) await pause();
      }
    } finally {
      working = false;
    }
  }

  function finish(error) {
    job.running = false;
    job.finished_at = new Date().toISOString();
    job.error = error;
    job.ids = [];
  }

  return {
    /** Après l'enregistrement d'un livre : sa couverture est cherchée en arrière-plan. */
    queue(id) {
      if (!queue.includes(id)) queue.push(id);
      work();
    },
    /** Recherche de toutes les couvertures manquantes. */
    start({ retry = false } = {}) {
      if (job?.running) return this.status();
      const ids = db.prepare(`SELECT d.id FROM documents d WHERE ${MISSING_SQL} ${retry ? '' : 'AND d.cover_tried_at IS NULL'}
        ORDER BY d.id`).all().map((x) => x.id);
      job = { running: true, total: ids.length, done: 0, found: 0, missing: 0, errors: 0, streak: 0, ids, foundIds: new Set(),
        started_at: new Date().toISOString(), finished_at: null, error: null, stopped: false };
      work();
      return this.status();
    },
    stop() {
      if (job?.running) { finish(null); job.stopped = true; }
      return this.status();
    },
    status() {
      const { ids, streak, foundIds, ...rest } = job ?? {};
      return { job: job ? rest : null, amazon: amazonEnabled(db), ...coverStats(db) };
    },
    /** Pour les tests : attend la fin du travail en cours. */
    async idle() {
      while (working || queue.length || job?.running) await new Promise((r) => setTimeout(r, 5));
    },
  };
}

/**
 * Récupération de notices bibliographiques prêtes à l'emploi à partir d'un ISBN / EAN.
 * Source principale : catalogue général de la BnF (API SRU, format UNIMARC).
 * Sources de secours : Open Library puis Google Books.
 */
import { toIsbn13, cleanIsbn } from './isbn.js';
import { fixFields } from './text.js';

const BNF_SRU = 'https://catalogue.bnf.fr/api/SRU';
const TIMEOUT_MS = 8000;

function decodeXml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Retire les signes de non-classement UNIMARC (« << >> », caractères NSB/NSE). */
function clean(s) {
  return String(s ?? '')
    .replace(/[\u0088\u0089\u0098\u009c]/g, '')
    .replace(/<<|>>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[/:;,.=]\s*$/, '')
    .trim();
}

/** Analyse un enregistrement UNIMARC XChange en liste de champs { tag, sub: {code: [valeurs]} }. */
export function parseUnimarc(xml) {
  const fields = [];
  const dfRe = /<(?:[\w-]+:)?datafield\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?datafield>/g;
  let m;
  while ((m = dfRe.exec(xml))) {
    const tag = (m[1].match(/tag="(\d+)"/) || [])[1];
    if (!tag) continue;
    const sub = {};
    const sfRe = /<(?:[\w-]+:)?subfield\b[^>]*code="(\w)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?subfield>/g;
    let s;
    while ((s = sfRe.exec(m[2]))) (sub[s[1]] ??= []).push(decodeXml(s[2]));
    fields.push({ tag, sub });
  }
  return fields;
}

export function unimarcToNotice(fields) {
  const get = (tag, code) => fields.find((f) => f.tag === tag && f.sub[code])?.sub[code][0];
  const all = (tag) => fields.filter((f) => f.tag === tag);

  const authors = [];
  for (const tag of ['700', '701', '710', '711', '702']) {
    for (const f of all(tag)) {
      const nom = clean(f.sub.a?.[0]);
      const prenom = clean(f.sub.b?.[0]);
      if (!nom) continue;
      const a = prenom ? `${nom}, ${prenom}` : nom;
      if (!authors.includes(a)) authors.push(a);
    }
  }

  const subjects = [];
  for (const tag of ['606', '600', '601', '607', '608', '610']) {
    for (const f of all(tag)) {
      const parts = [f.sub.a?.[0], ...(f.sub.x ?? []), ...(f.sub.y ?? [])].map(clean).filter(Boolean);
      const sbj = parts.join(' -- ');
      if (sbj && !subjects.includes(sbj)) subjects.push(sbj);
    }
  }

  const dateRaw = get('214', 'd') ?? get('210', 'd') ?? '';
  const year = (dateRaw.match(/\d{4}/) || [])[0];
  const pages = (String(get('215', 'a') ?? '').match(/(\d+)\s*(p|f)/) || [])[1];

  return {
    title: clean(get('200', 'a')),
    subtitle: clean(get('200', 'e')),
    authors: authors.join(' ; '),
    responsibility: clean(get('200', 'f')),
    publisher: clean(get('214', 'c') ?? get('210', 'c')),
    pub_year: year ? Number(year) : null,
    pages: pages ? Number(pages) : null,
    series: clean(get('225', 'a') ?? get('461', 't')),
    series_number: clean(get('225', 'v') ?? get('461', 'v')),
    summary: clean(get('330', 'a')),
    subjects: subjects.join(' ; '),
    dewey: clean(get('676', 'a')) || null,
    audience: clean(get('333', 'a')),
  };
}

let fetchImpl = (...a) => fetch(...a);

/** Remplace la fonction réseau (l'application Windows utilise celle d'Electron, qui suit le proxy du système). */
export function setFetch(fn) {
  fetchImpl = fn;
}

export async function fetchWithTimeout(url, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    // Lecture du corps comprise dans le délai : une image coupée en route ne bloque pas.
    const res = await fetchImpl(url, { signal: ctrl.signal, headers: { 'User-Agent': 'BCD-gestion/1.0' } });
    const body = Buffer.from(await res.arrayBuffer());
    return {
      ok: res.ok, status: res.status, headers: res.headers, body,
      text: async () => body.toString('utf8'), json: async () => JSON.parse(body.toString('utf8')),
    };
  } finally {
    clearTimeout(t);
  }
}

export async function fromBnf(isbn) {
  const query = `bib.isbn all "${isbn}"`;
  const url = `${BNF_SRU}?version=1.2&operation=searchRetrieve&recordSchema=unimarcXchange&maximumRecords=1&query=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`BnF : HTTP ${res.status}`);
  const xml = await res.text();
  const record = (xml.match(/<(?:[\w-]+:)?record\b[^>]*>[\s\S]*?<\/(?:[\w-]+:)?record>/) || [])[0];
  if (!record || !/datafield/.test(record)) return null;
  const notice = unimarcToNotice(parseUnimarc(record));
  const ark = (xml.match(/ark:\/12148\/[\w]+/) || [])[0];
  if (!notice.title) return null;
  return { ...notice, source: 'bnf', source_url: ark ? `https://catalogue.bnf.fr/${ark}` : null };
}

function olAuthor(name) {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts.pop()}, ${parts.join(' ')}`;
}

export async function fromOpenLibrary(isbn) {
  const res = await fetchWithTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  if (!res.ok) throw new Error(`Open Library : HTTP ${res.status}`);
  const d = (await res.json())[`ISBN:${isbn}`];
  if (!d) return null;
  return {
    title: d.title ?? '',
    subtitle: d.subtitle ?? '',
    authors: (d.authors ?? []).map((a) => olAuthor(a.name)).join(' ; '),
    publisher: d.publishers?.[0]?.name ?? '',
    pub_year: Number((String(d.publish_date ?? '').match(/\d{4}/) || [])[0]) || null,
    pages: d.number_of_pages ?? null,
    subjects: (d.subjects ?? []).slice(0, 6).map((s) => s.name).join(' ; '),
    summary: '',
    series: '',
    dewey: d.classifications?.dewey_decimal_class?.[0] ?? null,
    cover_url: d.cover?.medium ?? null,
    source: 'openlibrary',
    source_url: d.url ?? null,
  };
}

export async function fromGoogleBooks(isbn) {
  const res = await fetchWithTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  if (!res.ok) throw new Error(`Google Books : HTTP ${res.status}`);
  const v = (await res.json()).items?.[0]?.volumeInfo;
  if (!v) return null;
  return {
    title: v.title ?? '',
    subtitle: v.subtitle ?? '',
    authors: (v.authors ?? []).map(olAuthor).join(' ; '),
    publisher: v.publisher ?? '',
    pub_year: Number((String(v.publishedDate ?? '').match(/\d{4}/) || [])[0]) || null,
    pages: v.pageCount ?? null,
    subjects: (v.categories ?? []).join(' ; '),
    summary: v.description ?? '',
    series: '',
    dewey: null,
    cover_url: v.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
    source: 'google',
    source_url: v.infoLink ?? null,
  };
}

/** Cherche la notice dans les différentes sources ; complète les champs manquants. */
export async function lookupIsbn(raw, sources = [fromBnf, fromOpenLibrary, fromGoogleBooks]) {
  const isbn = toIsbn13(raw);
  if (!isbn) return { error: 'ISBN / EAN invalide', isbn: cleanIsbn(raw) };

  const errors = [];
  let notice = null;
  for (const src of sources) {
    try {
      const r = await src(isbn);
      if (!r) continue;
      if (!notice) notice = r;
      else for (const [k, v] of Object.entries(r)) if (!notice[k] && v) notice[k] = v;
      if (notice.title && notice.cover_url && notice.summary) break;
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (!notice) return { isbn, found: false, errors };
  // Certaines sources (Open Library…) renvoient des accents abîmés : « kilomÃ¨tre » → « kilomètre ».
  fixFields(notice, Object.keys(notice));
  notice.cover_url ||= `https://covers.openlibrary.org/b/isbn/${isbn}-M.jpg?default=false`;
  return { isbn, found: true, notice: { ...notice, isbn }, errors };
}

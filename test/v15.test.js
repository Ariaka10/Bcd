import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { setFetch } from '../server/notice.js';
import { imageInfo, hashOf } from '../server/covers.js';

/** Fausse image PNG (en-tête correct, contenu propre à chaque « graine »). */
function png(w, h, seed) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(w, 0);
  dims.writeUInt32BE(h, 4);
  return Buffer.concat([head, dims, Buffer.alloc(3000, seed)]);
}
const IMG = { A: png(200, 300, 1), B: png(180, 260, 2), PLACEHOLDER: png(128, 190, 9), TINY: png(1, 1, 3) };
const ISBN = { A: '9782070548064', B: '9782211011396', C: '9782081234567', D: '9782092543214', E: '9782203001015', F: '9782070612758' };

let offline = false;
const calls = [];
function fakeFetch(url) {
  calls.push(url);
  if (offline) return Promise.reject(new Error('fetch failed'));
  const ok = (body, type = 'image/png') => new Response(body, { status: 200, headers: { 'Content-Type': type } });
  const notFound = () => new Response('not found', { status: 404 });
  if (url.startsWith('https://catalogue.bnf.fr/api/SRU')) {
    if (url.includes(ISBN.A)) {
      return Promise.resolve(ok(`<srw:searchRetrieveResponse><srw:record><mxc:record>
        <mxc:datafield tag="200"><mxc:subfield code="a">Le Gruffalo</mxc:subfield></mxc:datafield>
        </mxc:record><srw:recordIdentifier>ark:/12148/cb37075409k</srw:recordIdentifier></srw:record></srw:searchRetrieveResponse>`, 'text/xml'));
    }
    return Promise.resolve(ok('<srw:searchRetrieveResponse><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>', 'text/xml'));
  }
  if (url.startsWith('https://openapi.bnf.fr/couverture/')) {
    // Pas d'EAN connu ici : seule la recherche par identifiant (ark) aboutit ; sinon erreur 500 comme le vrai service.
    return Promise.resolve(url.includes('idArk=ark:/12148/cb37075409k') ? ok(IMG.A)
      : new Response('<html>Erreur interne du serveur</html>', { status: 500, headers: { 'Content-Type': 'text/html' } }));
  }
  if (url.startsWith('https://covers.openlibrary.org/')) {
    if (url.includes(ISBN.B)) return Promise.resolve(ok(IMG.B));
    if (url.includes(ISBN.C)) return Promise.resolve(ok(IMG.TINY)); // pixel vide : refusé
    return Promise.resolve(notFound());
  }
  if (url.startsWith('https://www.googleapis.com/')) {
    const withThumb = [ISBN.D, ISBN.E].some((i) => url.includes(i));
    return Promise.resolve(ok(JSON.stringify(withThumb ? { items: [{ volumeInfo: { imageLinks: { thumbnail: 'http://books.google.com/x.png' } } }] } : {}), 'application/json'));
  }
  if (url === 'https://books.google.com/x.png') return Promise.resolve(ok(IMG.PLACEHOLDER));
  return Promise.resolve(notFound());
}

let server;
let base;
let db;
let app;
let cookie = '';

before(async () => {
  setFetch(fakeFetch);
  db = openDb(':memory:');
  app = createApp(db, { autoCovers: true, coverPauseMs: 0 });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/setup', { username: 'admin', password: 'secret123', first_name: 'Claire', last_name: 'Martin' });
});
after(() => { server.close(); db.close(); });

async function call(method, p, body) {
  const res = await fetch(base + p, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const coverOf = (id) => db.prepare('SELECT source, hash FROM covers WHERE document_id = ?').get(id);
const docOf = (id) => db.prepare('SELECT cover_url, cover_tried_at FROM documents WHERE id = ?').get(id);

test('dimensions des images', () => {
  assert.deepEqual(imageInfo(IMG.A), { mime: 'image/png', width: 200, height: 300 });
  // JPEG minimal : SOI, APP0, SOF0 (hauteur 240, largeur 160)
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), Buffer.alloc(14),
    Buffer.from([0xff, 0xc0, 0, 17, 8, 0, 240, 0, 160, 3]), Buffer.alloc(20)]);
  assert.deepEqual(imageInfo(jpeg), { mime: 'image/jpeg', width: 160, height: 240 });
  assert.equal(imageInfo(Buffer.from('<html>pas une image</html>')), null);
});

test('couverture récupérée et enregistrée à l\'enregistrement du livre', async () => {
  const a = (await call('POST', '/api/documents', { title: 'Le Gruffalo', isbn: ISBN.A, copies: 1 })).data.id;
  const b = (await call('POST', '/api/documents', { title: 'Petit Bleu', isbn: ISBN.B, copies: 1,
    cover_url: `https://covers.openlibrary.org/b/isbn/${ISBN.B}-M.jpg?default=false` })).data.id;
  const c = (await call('POST', '/api/documents', { title: 'Introuvable', isbn: ISBN.C, copies: 1 })).data.id;
  const sansIsbn = (await call('POST', '/api/documents', { title: 'Cahier de la classe', copies: 1 })).data.id;
  await app.covers.idle();

  // BnF en premier
  assert.equal(coverOf(a).hash, hashOf(IMG.A));
  assert.equal(coverOf(a).source, 'internet');
  assert.match(docOf(a).cover_url, new RegExp(`^/api/documents/${a}/cover`));
  const img = await call('GET', `/api/documents/${a}/cover`);
  assert.equal(Buffer.compare(img.data, IMG.A), 0);
  // Open Library ensuite
  assert.equal(coverOf(b).hash, hashOf(IMG.B));
  // Pixel vide refusé : marqué « cherché sans succès »
  assert.equal(coverOf(c), undefined);
  assert.ok(docOf(c).cover_tried_at);
  assert.equal(coverOf(sansIsbn), undefined);

  const st = (await call('GET', '/api/admin/covers')).data;
  assert.equal(st.with_cover, 2);
  assert.equal(st.to_search, 0);
  assert.equal(st.not_found, 1);
  assert.equal(st.no_isbn, 1);
});

test('image « pas de couverture » d\'un site écartée', async () => {
  // Livres importés (sans passer par l'enregistrement) : la recherche groupée s'en charge.
  const ins = db.prepare('INSERT INTO documents (title, isbn) VALUES (?, ?)');
  const d = Number(ins.run('Livre D', ISBN.D).lastInsertRowid);
  const e = Number(ins.run('Livre E', ISBN.E).lastInsertRowid);
  let st = (await call('GET', '/api/admin/covers')).data;
  assert.equal(st.to_search, 2);

  st = (await call('POST', '/api/admin/covers/start', {})).data;
  assert.equal(st.job.running, true);
  assert.equal(st.job.total, 2);
  await app.covers.idle();
  st = (await call('GET', '/api/admin/covers')).data;
  assert.equal(st.job.running, false);
  assert.equal(st.job.done, 2);
  assert.equal(st.job.found, 0);
  assert.equal(st.job.missing, 2);
  // Même image pour deux livres différents : retirée des deux et mise de côté
  assert.equal(coverOf(d), undefined);
  assert.equal(coverOf(e), undefined);
  assert.ok(db.prepare('SELECT 1 FROM cover_rejects WHERE hash = ?').get(hashOf(IMG.PLACEHOLDER)));

  // Réessayer les introuvables : l'image écartée n'est plus jamais retenue
  st = (await call('POST', '/api/admin/covers/start', { retry: true })).data;
  assert.equal(st.job.total, 3); // C, D, E
  await app.covers.idle();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM covers').get().n, 2);
});

test('couverture retirée à la main : pas remise automatiquement', async () => {
  const a = db.prepare('SELECT id FROM documents WHERE isbn = ?').get(ISBN.A).id;
  await call('DELETE', `/api/documents/${a}/cover`);
  const doc = (await call('GET', `/api/documents/${a}`)).data;
  await call('PUT', `/api/documents/${a}`, { ...doc, title: 'Le Gruffalo (album)' });
  await app.covers.idle();
  assert.equal(coverOf(a), undefined);
  assert.equal((await call('GET', '/api/admin/covers')).data.to_search, 0);
  // Photo ajoutée à la main : source « manuel »
  const res = await fetch(`${base}/api/documents/${a}/cover`, { method: 'PUT', headers: { cookie, 'Content-Type': 'application/octet-stream' }, body: IMG.B });
  assert.equal(res.status, 200);
  assert.equal(coverOf(a).source, 'manuel');
});

test('sans Internet : rien n\'est marqué introuvable', async () => {
  offline = true;
  const f = (await call('POST', '/api/documents', { title: 'Livre F', isbn: ISBN.F, copies: 1 })).data.id;
  await app.covers.idle();
  assert.equal(docOf(f).cover_tried_at, null);
  const st = (await call('POST', '/api/admin/covers/start', {})).data;
  assert.equal(st.job.total, 1);
  await app.covers.idle();
  const end = (await call('GET', '/api/admin/covers')).data;
  assert.equal(end.job.errors, 1);
  assert.equal(end.to_search, 1);

  // Internet revenu : la recherche reprend
  offline = false;
  calls.length = 0;
  await call('POST', '/api/admin/covers/start', {});
  await app.covers.idle();
  assert.ok(calls.length > 0);
  assert.equal((await call('GET', '/api/admin/covers')).data.to_search, 0);
});

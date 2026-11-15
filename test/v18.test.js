import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { setFetch } from '../server/notice.js';
import { hashOf, firstAuthorName } from '../server/covers.js';

/** Fausse image PNG (en-tête correct, contenu propre à chaque « graine »). */
function png(w, h, seed) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(w, 0);
  dims.writeUInt32BE(h, 4);
  return Buffer.concat([head, dims, Buffer.alloc(3000, seed)]);
}
const IMG = { BNF: png(300, 420, 1), OL: png(200, 300, 2), GOOGLE: png(128, 190, 3) };

let offline = false;
const calls = [];
function fakeFetch(url) {
  calls.push(url);
  if (offline) return Promise.reject(new Error('fetch failed'));
  const ok = (body, type = 'image/png') => new Response(body, { status: 200, headers: { 'Content-Type': type } });
  const json = (o) => ok(JSON.stringify(o), 'application/json');
  if (url.startsWith('https://catalogue.bnf.fr/api/SRU')) {
    if (!decodeURIComponent(url).includes('bib.title all "Le Gruffalo" and bib.author all "Donaldson"')) {
      return Promise.resolve(ok('<srw:searchRetrieveResponse><srw:numberOfRecords>0</srw:numberOfRecords></srw:searchRetrieveResponse>', 'text/xml'));
    }
    const rec = (ark, title, year) => `<srw:record><srw:recordData><mxc:record format="UNIMARC" id="ark:/12148/${ark}">
      <mxc:datafield tag="200"><mxc:subfield code="a">${title}</mxc:subfield></mxc:datafield>
      <mxc:datafield tag="214"><mxc:subfield code="c">Gallimard jeunesse</mxc:subfield><mxc:subfield code="d">${year}</mxc:subfield></mxc:datafield>
      <mxc:datafield tag="700"><mxc:subfield code="a">Donaldson</mxc:subfield><mxc:subfield code="b">Julia</mxc:subfield></mxc:datafield>
      </mxc:record></srw:recordData></srw:record>`;
    return Promise.resolve(ok(`<srw:searchRetrieveResponse><srw:records>${rec('cbAVEC', 'Le Gruffalo', 1999)}${rec('cbSANS', 'Le Gruffalo', 2010)}
      </srw:records></srw:searchRetrieveResponse>`, 'text/xml'));
  }
  if (url.startsWith('https://openapi.bnf.fr/couverture/')) {
    return Promise.resolve(url.includes('cbAVEC') ? ok(IMG.BNF) : new Response('<html>Erreur</html>', { status: 500 }));
  }
  if (!url.includes('Gruffalo') && /openlibrary\.org\/search|googleapis/.test(url)) return Promise.resolve(json({}));
  if (url.startsWith('https://openlibrary.org/search.json')) {
    return Promise.resolve(json({ docs: [{ title: 'The Gruffalo', author_name: ['Julia Donaldson'], cover_i: 42, first_publish_year: 1999 },
      { title: 'Sans image', cover_i: null }] }));
  }
  if (url.startsWith('https://covers.openlibrary.org/b/id/42-M.jpg')) return Promise.resolve(ok(IMG.OL));
  if (url.startsWith('https://www.googleapis.com/')) {
    // Même image que la BnF : ne doit être proposée qu'une fois.
    return Promise.resolve(json({ items: [{ volumeInfo: { title: 'Le Gruffalo', authors: ['Julia Donaldson'], imageLinks: { thumbnail: 'http://books.google.com/g.png' } } }] }));
  }
  if (url === 'https://books.google.com/g.png') return Promise.resolve(ok(IMG.BNF));
  return Promise.resolve(new Response('not found', { status: 404 }));
}

let server;
let base;
let db;
let cookie = '';

before(async () => {
  setFetch(fakeFetch);
  db = openDb(':memory:');
  server = http.createServer(createApp(db, { autoCovers: false }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/setup', { username: 'admin', password: 'secret123', first_name: 'Claire', last_name: 'Martin' });
});
after(() => { server.close(); db.close(); });

async function call(method, p, body) {
  const res = await fetch(base + p, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}

test('nom du premier auteur', () => {
  assert.equal(firstAuthorName('Donaldson, Julia ; Scheffler, Axel'), 'Donaldson');
  assert.equal(firstAuthorName(''), '');
});

test('couverture par titre et auteur : propositions, puis validation', async () => {
  const id = (await call('POST', '/api/documents', { title: 'Le Gruffalo', authors: 'Donaldson, Julia ; Scheffler, Axel' })).data.id;
  const r = await call('POST', `/api/documents/${id}/cover/search`, {});
  assert.equal(r.status, 200);
  // BnF (avec image) + Open Library ; la notice BnF sans image et le doublon Google sont écartés.
  assert.equal(r.data.proposals.length, 2);
  const [bnf, ol] = r.data.proposals;
  assert.equal(bnf.origin, 'bnf');
  assert.equal(bnf.publisher, 'Gallimard jeunesse');
  assert.equal(bnf.year, 1999);
  assert.match(bnf.image, /^data:image\/png;base64,/);
  assert.equal(ol.origin, 'openlibrary');
  // Rien n'est enregistré tant que l'utilisateur n'a pas validé.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM covers').get().n, 0);
  // Seuls le titre et le nom de l'auteur sont envoyés.
  assert.ok(calls.some((u) => u.includes('title=Le%20Gruffalo&author=Donaldson')));

  const ok = await call('POST', `/api/documents/${id}/cover/choose`, { index: ol.index });
  assert.equal(ok.status, 200);
  const c = db.prepare('SELECT hash, origin, source FROM covers WHERE document_id = ?').get(id);
  assert.deepEqual({ ...c }, { hash: hashOf(IMG.OL), origin: 'openlibrary', source: 'internet' });
  // Les propositions ne servent qu'une fois.
  assert.equal((await call('POST', `/api/documents/${id}/cover/choose`, { index: 0 })).status, 410);
});

test('aucune proposition, et Internet coupé', async () => {
  const id = (await call('POST', '/api/documents', { title: 'Livre introuvable' })).data.id;
  calls.length = 0;
  const r = await call('POST', `/api/documents/${id}/cover/search`, {});
  assert.deepEqual(r.data.proposals, []);
  offline = true;
  assert.equal((await call('POST', `/api/documents/${id}/cover/search`, {})).status, 502);
  offline = false;
});

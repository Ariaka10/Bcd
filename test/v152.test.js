import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { setFetch } from '../server/notice.js';
import { isbn10, originOf } from '../server/covers.js';

function png(w, h, seed) {
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dims = Buffer.alloc(8);
  dims.writeUInt32BE(w, 0);
  dims.writeUInt32BE(h, 4);
  return Buffer.concat([head, dims, Buffer.alloc(3000, seed)]);
}
const BNF = png(300, 400, 1);
const AMZ = png(300, 400, 2);
const ISBN_BNF = '9782877678612';
const ISBN_AMZ = '9782070669202';
const AMZ_EMPTY = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;', 'latin1');

const calls = [];
function fakeFetch(url) {
  calls.push(url);
  const ok = (body, type = 'image/png') => new Response(body, { status: 200, headers: { 'Content-Type': type } });
  if (url.startsWith('https://openapi.bnf.fr/couverture/')) {
    return Promise.resolve(url.includes(`EAN=${ISBN_BNF}`) ? ok(BNF) : new Response('<html>Erreur</html>', { status: 500 }));
  }
  if (url.startsWith('https://catalogue.bnf.fr/api/SRU')) return Promise.resolve(ok('<srw:numberOfRecords>0</srw:numberOfRecords>', 'text/xml'));
  if (url.startsWith('https://www.googleapis.com/')) return Promise.resolve(ok('{}', 'application/json'));
  if (url.startsWith('https://images-na.ssl-images-amazon.com/')) {
    // Amazon renvoie une image vide d'1 pixel quand il n'a pas la couverture
    return Promise.resolve(url.includes(`/P/${isbn10(ISBN_AMZ)}.`) ? ok(AMZ, 'image/jpeg') : ok(AMZ_EMPTY, 'image/gif'));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
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
  return { status: res.status, data: await res.json() };
}

test('ISBN-10 et nom des sources', () => {
  assert.equal(isbn10('9782070669202'), '2070669203');
  assert.equal(isbn10('9782733864654'), '2733864653');
  assert.equal(isbn10('9791023500448'), null); // les ISBN en 979 n'ont pas d'ISBN-10
  assert.equal(originOf('https://openapi.bnf.fr/couverture/image/image/recupererImage?EAN=1'), 'bnf');
  assert.equal(originOf('https://books.google.com/books/content?id=x'), 'google');
});

test('BnF officielle par EAN, source citée sur la fiche', async () => {
  const id = (await call('POST', '/api/documents', { title: 'Bébés chouettes', isbn: ISBN_BNF, copies: 1 })).data.id;
  await app.covers.idle();
  assert.ok(calls[0].startsWith(`https://openapi.bnf.fr/couverture/image/image/recupererImage?EAN=${ISBN_BNF}&couverture=1`));
  const doc = (await call('GET', `/api/documents/${id}`)).data;
  assert.equal(doc.cover_origin, 'bnf');
  assert.ok(doc.cover_date);
});

test('Amazon seulement si l\'option est cochée', async () => {
  calls.length = 0;
  const id = (await call('POST', '/api/documents', { title: 'Gruffalo', isbn: ISBN_AMZ, copies: 1 })).data.id;
  await app.covers.idle();
  assert.ok(!calls.some((u) => u.includes('amazon')));
  let st = (await call('GET', '/api/admin/covers')).data;
  assert.equal(st.amazon, false);
  assert.equal(st.not_found, 1);

  assert.equal((await call('PUT', '/api/settings', { covers_amazon: '1' })).status, 200);
  st = (await call('POST', '/api/admin/covers/start', { retry: true })).data;
  assert.equal(st.amazon, true);
  await app.covers.idle();
  assert.ok(calls.some((u) => u.includes(`/images/P/2070669203.`)));
  assert.equal((await call('GET', `/api/documents/${id}`)).data.cover_origin, 'amazon');

  // Image vide d'Amazon : écartée
  const other = (await call('POST', '/api/documents', { title: 'Inconnu', isbn: '9782733864654', copies: 1 })).data.id;
  await app.covers.idle();
  assert.equal((await call('GET', `/api/documents/${other}`)).data.cover_origin, null);
});

test('mise à jour : les introuvables seront recherchés à nouveau', () => {
  // Base de la version 1.5.1 : pas de colonne « origin », un livre marqué introuvable.
  const file = path.join(os.tmpdir(), `bcd-v152-${process.pid}.sqlite`);
  const a = openDb(file);
  a.exec('ALTER TABLE covers DROP COLUMN origin');
  a.exec(`INSERT INTO documents (title, isbn, cover_tried_at) VALUES ('Ancien', '${ISBN_BNF}', datetime('now'))`);
  a.close();
  const b = openDb(file);
  assert.equal(b.prepare('SELECT cover_tried_at FROM documents').get().cover_tried_at, null);
  b.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
});

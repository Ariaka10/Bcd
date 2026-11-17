import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { hyphenateIsbn } from '../public/js/isbn-format.js';

test('ISBN avec tirets (livres français)', () => {
  assert.equal(hyphenateIsbn('9782278091546'), '978-2-278-09154-6'); // Didier jeunesse
  assert.equal(hyphenateIsbn('9782070548064'), '978-2-07-054806-4'); // Gallimard
  assert.equal(hyphenateIsbn('9782747012345'), '978-2-7470-1234-5'); // Bayard
  assert.equal(hyphenateIsbn('9791035800000'), '979-10-358-0000-0');
  assert.equal(hyphenateIsbn('9780140449136'), null); // anglais : laissé tel quel
  assert.equal(hyphenateIsbn('123'), null);
});

let server;
let base;
let db;
let cookie = '';

before(async () => {
  db = openDb(':memory:');
  server = http.createServer(createApp(db, {}));
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

test('navigation entre résultats et liens auteur / mot-clé', async () => {
  const a = (await call('POST', '/api/documents', { title: 'Cocotte tricote', authors: 'Beigel, Christine ; Destours, Christine', keywords: 'Hiver ; Ami' })).data.id;
  const b = (await call('POST', '/api/documents', { title: 'Bonhomme de neige', authors: 'Martin, Paul', keywords: 'Hiver' })).data.id;
  const c = (await call('POST', '/api/documents', { title: 'Au soleil', authors: 'Durand, Léa', keywords: 'Été' })).data.id;
  // Même ordre que la liste affichée (ici par titre)
  assert.deepEqual((await call('GET', '/api/documents/ids?sort=title')).data.ids, [c, b, a]);
  // Lien d'un mot-clé (mots-clés et sujets) et d'un auteur
  assert.deepEqual((await call('GET', '/api/documents/ids?keyword=Hiver&sort=title')).data.ids, [b, a]);
  assert.deepEqual((await call('GET', `/api/documents/ids?${new URLSearchParams({ author: 'Beigel, Christine' })}`)).data.ids, [a]);
});

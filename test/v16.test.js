import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { schoolYearBounds } from '../server/stats.js';

let server;
let base;
let db;

before(async () => {
  db = openDb(':memory:');
  server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

function client() {
  let cookie = '';
  return async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json() };
  };
}

const adm = client();
let cls;
let kid;

test('compte « Ajout de livres » : catalogue oui, élèves et prêts non', async () => {
  await adm('POST', '/api/setup', { username: 'admin', password: 'secret123', first_name: 'Claire', last_name: 'Martin' });
  cls = (await adm('POST', '/api/classes', { name: 'Petite section' })).data.id;
  kid = (await adm('POST', '/api/users', { role: 'eleve', first_name: 'Léa', last_name: 'MARTIN', class_id: cls })).data.id;
  const doc = (await adm('POST', '/api/documents', { title: 'Le Gruffalo', copies: 1 })).data;
  await adm('POST', '/api/loans', { user_id: kid, barcode: doc.barcodes[0] });

  // Créé par l'administrateur, sans mot de passe
  const r = await adm('POST', '/api/users', { role: 'catalogueur', first_name: 'Tom', last_name: 'Durand' });
  assert.equal(r.status, 200);
  const tom = r.data.id;
  const cards = (await client()('GET', '/api/public/adults')).data;
  assert.ok(cards.some((c) => c.id === tom && c.role === 'catalogueur' && c.needs_password === 0));

  const cat = client();
  assert.equal((await cat('POST', '/api/login/carte', { user_id: tom })).status, 200);
  // Ajouter et modifier des livres
  const added = await cat('POST', '/api/documents', { title: 'La moufle', copies: 2 });
  assert.equal(added.status, 200);
  const got = (await cat('GET', `/api/documents/${added.data.id}`)).data;
  assert.equal((await cat('PUT', `/api/documents/${added.data.id}`, { ...got, title: 'La Moufle' })).status, 200);
  assert.equal((await cat('POST', '/api/cote', { title: 'La moufle', doc_type: 'album' })).status, 200);
  // Pas de suppression (administrateur)
  assert.equal((await cat('DELETE', `/api/documents/${added.data.id}`)).status, 403);
  // Ni élèves, ni prêts, ni statistiques, ni réglages
  for (const p of ['/api/users', '/api/loans', '/api/stats', '/api/stats/details', '/api/classes', '/api/settings']) {
    assert.equal((await cat('GET', p)).status, 403, p);
  }
  // La fiche d'un livre prêté ne dit pas qui l'a
  const lent = (await cat('GET', `/api/documents/${doc.id}`)).data;
  assert.ok(lent.copies.every((c) => !c.borrower));
  assert.ok(JSON.stringify(lent).indexOf('MARTIN') < 0);
  // Ce compte n'emprunte pas
  const loan = await adm('POST', '/api/loans', { user_id: tom, barcode: added.data.barcodes[0] });
  assert.equal(loan.status, 409);
});

test('retour : informations pour la fenêtre de confirmation', async () => {
  const r = await adm('POST', '/api/loans/return', { barcode: '1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user_id, kid);
  assert.equal(r.data.first_name, 'Léa');
  assert.ok('cover_url' in r.data && 'avatar' in r.data);
});

test('statistiques détaillées de l\'année scolaire', async () => {
  const { year, start } = schoolYearBounds();
  const d = (await adm('GET', '/api/stats/details')).data;
  assert.equal(d.year, year);
  assert.equal(d.months.length, 12);
  assert.equal(d.months[0].label, 'sept.');
  assert.equal(d.months[0].key, start.slice(0, 7));
  assert.equal(d.totals.loans, 1);
  assert.equal(d.totals.readers, 1);
  assert.equal(d.totals.students, 1);
  assert.equal(d.totals.returned, 1);
  assert.equal(d.months.reduce((n, m) => n + m.n, 0), 1);
  assert.equal(d.top_documents[0].title, 'Le Gruffalo');
  assert.deepEqual(d.by_class.map((c) => [c.name, c.loans, c.readers, c.students]), [['Petite section', 1, 1, 1]]);
  // Année sans prêt
  const prev = Number(year.slice(0, 4)) - 3;
  const old = (await adm('GET', `/api/stats/details?year=${prev}-${prev + 1}`)).data;
  assert.equal(old.totals.loans, 0);
  assert.ok(d.years.includes(year));
});

test('mise à jour d\'une ancienne base : profil « catalogueur » accepté, données gardées', () => {
  const file = path.join(os.tmpdir(), `bcd-v16-${process.pid}.sqlite`);
  const a = openDb(file);
  a.exec(`INSERT INTO users (role, first_name, last_name, username) VALUES ('admin', 'Claire', 'Martin', 'admin')`);
  // Remet la contrainte de la version 1.5 (trois profils seulement)
  const sql = a.prepare(`SELECT sql FROM sqlite_master WHERE name = 'users'`).get().sql
    .replace("'eleve', 'catalogueur'", "'eleve'").replace('CREATE TABLE users', 'CREATE TABLE users_old');
  a.exec('PRAGMA foreign_keys = OFF');
  a.exec(`${sql}; INSERT INTO users_old SELECT * FROM users; DROP TABLE users; ALTER TABLE users_old RENAME TO users;`);
  assert.throws(() => a.exec(`INSERT INTO users (role, first_name, last_name) VALUES ('catalogueur', 'X', 'Y')`));
  a.close();

  const b = openDb(file);
  b.exec(`INSERT INTO users (role, first_name, last_name) VALUES ('catalogueur', 'Tom', 'Durand')`);
  assert.equal(b.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  // Les déclencheurs liés aux usagers sont toujours là
  assert.ok(b.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = 'users_archived'`).get());
  b.close();
  for (const ext of ['', '-wal', '-shm']) fs.rmSync(file + ext, { force: true });
});

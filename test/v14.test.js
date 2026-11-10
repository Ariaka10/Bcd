import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { guessDocType } from '../server/catalog-import.js';

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

test('connexion des adultes par cartes', async () => {
  const adm = client();
  await adm('POST', '/api/setup', { username: 'directrice', password: 'secret123', first_name: 'Claire', last_name: 'Martin' });
  // Enseignante créée sans identifiant ni mot de passe
  let r = await adm('POST', '/api/users', { role: 'enseignant', first_name: 'Sophie', last_name: 'Laurent' });
  assert.equal(r.status, 200);
  const sophie = r.data.id;
  assert.equal(db.prepare('SELECT username FROM users WHERE id = ?').get(sophie).username, 'slaurent');
  // Un administrateur doit avoir un mot de passe
  assert.equal((await adm('POST', '/api/users', { role: 'admin', first_name: 'A', last_name: 'B' })).status, 400);

  const cards = (await client()('GET', '/api/public/adults')).data;
  assert.deepEqual(cards.map((c) => [c.first_name, c.role, c.needs_password]), [['Sophie', 'enseignant', 0], ['Claire', 'admin', 1]]);
  assert.equal(cards[0].last_name, undefined);

  // Enseignante : un clic, puis proposition de mot de passe
  const prof = client();
  assert.equal((await prof('POST', '/api/login/carte', { user_id: sophie })).status, 200);
  assert.equal((await prof('GET', '/api/me')).data.user.ask_password, true);
  await prof('POST', '/api/me/password-prompt');
  assert.equal((await prof('GET', '/api/me')).data.user.ask_password, false);
  // Elle choisit finalement un mot de passe (sans ancien mot de passe)
  assert.equal((await prof('PUT', '/api/me/password', { new_password: 'monmdp1' })).status, 200);
  assert.equal((await client()('POST', '/api/login/carte', { user_id: sophie })).status, 401);
  assert.equal((await client()('POST', '/api/login/carte', { user_id: sophie, password: 'monmdp1' })).status, 200);
  // L'administrateur peut retirer son mot de passe
  await adm('PUT', `/api/users/${sophie}`, { remove_password: true });
  assert.equal((await client()('POST', '/api/login/carte', { user_id: sophie })).status, 200);

  // Administrateur : mot de passe toujours demandé
  const admId = cards[1].id;
  assert.equal((await client()('POST', '/api/login/carte', { user_id: admId })).status, 401);
  assert.equal((await client()('POST', '/api/login/carte', { user_id: admId, password: 'secret123' })).status, 200);
});

test('périodiques : numéros, prêt, retrait des anciens numéros, abonnement', async () => {
  const adm = client();
  await adm('POST', '/api/login', { username: 'directrice', password: 'secret123' });
  const doc = (await adm('POST', '/api/documents', { title: 'Wapiti', doc_type: 'periodique', copies: 0,
    periodicity: 'mensuel', subscription_end: '2026-11-20' })).data;
  assert.equal(doc.cote, 'PER WAP');
  const n1 = (await adm('POST', `/api/documents/${doc.id}/copies`, { count: 1, issue_label: 'n° 411', issue_date: '2026-02' })).data.barcodes[0];
  const n2 = (await adm('POST', `/api/documents/${doc.id}/copies`, { count: 2, issue_label: 'n° 412', issue_date: '2026-03' })).data.barcodes;
  const d = (await adm('GET', `/api/documents/${doc.id}`)).data;
  assert.deepEqual(d.copies.map((c) => c.issue_label), ['n° 412', 'n° 412', 'n° 411']); // plus récent d'abord
  // Prêt d'un numéro : le titre affiché contient le numéro du magazine
  const kid = (await adm('POST', '/api/users', { role: 'eleve', first_name: 'Léa', last_name: 'M' })).data.id;
  const loan = (await adm('POST', '/api/loans', { user_id: kid, barcode: n2[0] })).data;
  assert.equal(loan.title, 'Wapiti — n° 412');
  assert.equal((await adm('GET', `/api/loans?user_id=${kid}`)).data[0].title, 'Wapiti — n° 412');
  assert.equal((await adm('GET', '/api/loans/find-copies?q=wapiti')).data.length, 3);
  // Retirer les numéros parus avant avril : le n° 412 en prêt est gardé
  const purge = (await adm('POST', `/api/documents/${doc.id}/issues/purge`, { before: '2026-04' })).data;
  assert.equal(purge.deleted, 2);
  assert.deepEqual((await adm('GET', `/api/documents/${doc.id}`)).data.copies.map((c) => c.barcode), [n2[0]]);
  void n1;
  // Rappel d'abonnement sur l'accueil
  assert.deepEqual((await adm('GET', '/api/stats')).data.subscriptions.map((s) => s.title), ['Wapiti']);
});

test('multimédia : CD et DVD regroupés', async () => {
  assert.equal(guessDocType('DVD'), 'multimedia');
  assert.equal(guessDocType('CD audio'), 'multimedia');
  assert.equal(guessDocType('Multimédia'), 'multimedia');
  assert.equal(guessDocType('Album'), 'album');
  // Base d'une version précédente avec des CD et DVD
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-mm-'));
  const file = path.join(dir, 'old.sqlite');
  openDb(file).close();
  const raw = new DatabaseSync(file);
  raw.exec(`INSERT INTO documents (title, doc_type, cote) VALUES ('Comptines', 'audio', 'CD COL'), ('Le Gruffalo, le film', 'video', 'DVD DON')`);
  raw.close();
  const db2 = openDb(file);
  try {
    assert.deepEqual(db2.prepare('SELECT doc_type, cote FROM documents ORDER BY id').all().map((d) => [d.doc_type, d.cote]),
      [['multimedia', 'MM COL'], ['multimedia', 'MM DON']]);
  } finally {
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

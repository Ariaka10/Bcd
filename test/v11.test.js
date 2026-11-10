import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { fixMojibake } from '../server/text.js';

let server;
let base;
let db;

const fakeLookup = async () => ({
  isbn: '9782070612758', found: true, errors: [],
  notice: { isbn: '9782070612758', title: 'Un kilomètre à pied', authors: 'Dupont, Anne', source: 'openlibrary' },
});

before(async () => {
  db = openDb(':memory:');
  server = http.createServer(createApp(db, { lookupIsbn: fakeLookup }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); });

function client() {
  let cookie = '';
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, data: ct.includes('json') ? await res.json() : await res.text() };
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}), del: (p) => call('DELETE', p) };
}

test('réparation des accents abîmés', () => {
  assert.equal(fixMojibake('Un kilomÃ¨tre Ã  pied, Ã§a use, Ã§a use...'), 'Un kilomètre à pied, ça use, ça use...');
  assert.equal(fixMojibake('Ã‰lÃ©phant'), 'Éléphant');
  assert.equal(fixMojibake('Câ€™est moi'), 'C’est moi');
  assert.equal(fixMojibake('Déjà correct, São Paulo'), 'Déjà correct, São Paulo');
});

test('thèmes, mots-clés, avis, réservations, prêts aux classes, fin d\'année', async () => {
  const adm = client();
  await adm.post('/api/setup', { username: 'admin', password: 'secret123' });

  // Titre abîmé corrigé à l'enregistrement ; numéros simples ; mots-clés dédoublonnés
  let r = await adm.post('/api/documents', { title: 'Le loup qui voulait changer de couleur', doc_type: 'album', copies: 1,
    keywords: 'loup ; couleurs, Loup' });
  const loupId = r.data.id;
  assert.deepEqual(r.data.barcodes, ['1']);
  r = await adm.post('/api/documents', { title: 'Un kilomÃ¨tre Ã  pied', doc_type: 'album', copies: 2 });
  const kmId = r.data.id;
  assert.deepEqual(r.data.barcodes, ['2', '3']);
  assert.equal((await adm.get(`/api/documents/${kmId}`)).data.title, 'Un kilomètre à pied');
  assert.equal((await adm.get(`/api/documents/${loupId}`)).data.keywords, 'loup ; couleurs');
  assert.equal((await adm.get('/api/documents?keyword=couleurs')).data.total, 1);
  assert.equal((await adm.get('/api/documents?q=couleurs')).data.total, 1);

  // Thèmes
  r = await adm.post('/api/themes', { name: 'Les animaux', emoji: '🐾', for_students: true });
  const animaux = r.data.id;
  const noel = (await adm.post('/api/themes', { name: 'Noël', emoji: '🎄', for_students: false })).data.id;
  assert.equal((await adm.post('/api/themes', { name: 'les animaux' })).status, 409);
  await adm.put(`/api/documents/${loupId}`, { theme_ids: [animaux, noel] });
  await adm.post(`/api/themes/${noel}/documents`, { document_ids: [kmId] });
  assert.equal((await adm.get(`/api/documents?theme_id=${animaux}`)).data.total, 1);
  assert.equal((await adm.get(`/api/documents?theme_id=${noel}`)).data.total, 2);
  assert.equal((await adm.get(`/api/documents/${loupId}`)).data.themes.length, 2);
  assert.equal((await adm.get('/api/documents?no_theme=1')).data.total, 0);
  assert.equal((await adm.get('/api/documents?copy=3')).data.items[0].id, kmId);

  // Élève : ne voit que les thèmes « élèves » ; restriction du catalogue
  const ce = (await adm.post('/api/classes', { name: 'MS' })).data.id;
  const tom = (await adm.post('/api/users', { role: 'eleve', first_name: 'Tom', last_name: 'Petit', class_id: ce })).data.id;
  const zoe = (await adm.post('/api/users', { role: 'eleve', first_name: 'Zoé', last_name: 'Grand', class_id: ce })).data.id;
  const kid = client();
  await kid.post('/api/login/eleve', { user_id: tom });
  assert.deepEqual((await kid.get('/api/themes')).data.map((t) => t.name), ['Les animaux']);
  assert.equal((await kid.get('/api/documents')).data.total, 2);
  await adm.put('/api/settings', { restrict_student_catalog: '1' });
  assert.equal((await kid.get('/api/documents')).data.total, 1);
  assert.equal((await kid.get(`/api/documents/${kmId}`)).status, 404);
  assert.equal((await kid.get(`/api/documents/${loupId}`)).data.themes.length, 1);
  await adm.put('/api/settings', { restrict_student_catalog: '0' });

  // Avis et coups de cœur
  assert.equal((await kid.post(`/api/documents/${loupId}/review`, { rating: 3 })).status, 200);
  assert.equal((await kid.post(`/api/documents/${loupId}/review`, { rating: 7 })).status, 400);
  assert.equal((await kid.get(`/api/documents/${loupId}`)).data.my_review, 3);
  assert.deepEqual((await kid.get('/api/coups-de-coeur')).data.map((d) => d.id), [loupId]);

  // Comptoir sans douchette : recherche par titre ou numéro
  r = await adm.get('/api/loans/find-copies?q=kilometre');
  assert.deepEqual(r.data.map((c) => c.barcode), ['2', '3']);
  assert.equal((await adm.get('/api/loans/find-copies?q=1')).data[0].document_id, loupId);

  // Réservation : Tom emprunte le loup (1 seul exemplaire), Zoé le réserve
  assert.equal((await adm.post('/api/loans', { user_id: tom, copy_id: 1 })).status, 200);
  r = await adm.post('/api/reservations', { document_id: loupId, user_id: zoe });
  assert.equal(r.data.status, 'attente');
  assert.equal((await adm.post('/api/reservations', { document_id: loupId, user_id: zoe })).status, 409);
  const tomLoan = (await adm.get(`/api/loans?user_id=${tom}`)).data[0];
  assert.equal((await adm.post(`/api/loans/${tomLoan.id}/renew`)).status, 409);
  r = await adm.post('/api/loans/return', { barcode: '1' });
  assert.match(r.data.reserved_for, /Zoé/);
  // Mis de côté pour Zoé : prêt à Tom refusé, sauf confirmation
  r = await adm.post('/api/loans', { user_id: tom, barcode: '1' });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, 'reserved');
  assert.equal((await adm.post('/api/loans', { user_id: zoe, barcode: '1' })).status, 200);
  assert.equal((await adm.get('/api/reservations')).data.length, 0);

  // Réservation par l'élève lui-même, puis annulation
  const kidRes = await kid.post('/api/me/reservations', { document_id: loupId });
  assert.equal(kidRes.status, 200);
  assert.equal((await kid.get('/api/me/loans')).data.reservations.length, 1);
  assert.equal((await kid.del(`/api/reservations/${kidRes.data.id}`)).status, 200);

  // Prêt à une classe (lot)
  r = await adm.post('/api/loans', { class_id: ce, barcode: '2' });
  assert.equal(r.status, 200);
  await adm.post('/api/loans', { class_id: ce, barcode: '3' });
  const classLoans = (await adm.get('/api/loans?class_loans=1')).data;
  assert.equal(classLoans.length, 2);
  assert.equal(classLoans[0].last_name, 'MS');
  assert.equal(classLoans[0].avatar, '📦');
  assert.equal((await adm.del(`/api/classes/${ce}`)).status, 409);

  // Fin d'année : tout rendre avant le 3 juillet
  r = await adm.post('/api/loans/due-date', { due_at: '2027-07-03' });
  assert.equal(r.data.updated, 3);
  assert.ok((await adm.get('/api/loans')).data.every((l) => l.due_at === '2027-07-03'));
  assert.equal((await adm.post('/api/loans/return', { barcode: '2' })).data.last_name, 'MS');

  // Réparation des textes déjà enregistrés
  db.prepare(`UPDATE documents SET summary = 'Ã‰tÃ©' WHERE id = ?`).run(kmId);
  assert.equal((await adm.get('/api/admin/text-repair')).data.items.length, 1);
  assert.equal((await adm.post('/api/admin/text-repair')).data.repaired, 1);
  assert.equal((await adm.get(`/api/documents/${kmId}`)).data.summary, 'Été');

  // Notice : accents corrigés à la réception
  assert.equal((await adm.get('/api/isbn/9782070612758')).data.notice.title, 'Un kilomètre à pied');
});

test('mise à niveau d\'une base de la version 1.0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-mig-'));
  const file = path.join(dir, 'old.sqlite');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL, username TEXT, password_hash TEXT, first_name TEXT NOT NULL,
      last_name TEXT NOT NULL, class_id INTEGER, avatar TEXT, secret_code TEXT, birth_date TEXT, sex TEXT, ine TEXT,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE documents (id INTEGER PRIMARY KEY, isbn TEXT, title TEXT NOT NULL, subtitle TEXT, authors TEXT, publisher TEXT,
      pub_year INTEGER, pages INTEGER, series TEXT, series_number TEXT, doc_type TEXT NOT NULL DEFAULT 'album', dewey TEXT,
      subjects TEXT, summary TEXT, audience TEXT, cover_url TEXT, cote TEXT, location TEXT, notes TEXT, source TEXT, source_url TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE copies (id INTEGER PRIMARY KEY, document_id INTEGER NOT NULL, barcode TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL DEFAULT 'ok', acquired_at TEXT NOT NULL DEFAULT (date('now')), notes TEXT);
    CREATE TABLE loans (id INTEGER PRIMARY KEY, copy_id INTEGER, document_id INTEGER, doc_title TEXT, user_id INTEGER NOT NULL,
      loaned_at TEXT NOT NULL, due_at TEXT NOT NULL, returned_at TEXT, renewals INTEGER NOT NULL DEFAULT 0,
      lost INTEGER NOT NULL DEFAULT 0, loaned_by INTEGER);
    INSERT INTO users (id, role, first_name, last_name) VALUES (1, 'eleve', 'Léa', 'Martin');
    INSERT INTO documents (id, title) VALUES (1, 'Ancien livre');
    INSERT INTO copies (id, document_id, barcode) VALUES (1, 1, 'BCD000007'), (2, 1, 'MON-ETIQUETTE');
    INSERT INTO loans (copy_id, document_id, doc_title, user_id, loaned_at, due_at) VALUES (1, 1, 'Ancien livre', 1, '2026-01-01', '2026-01-15');`);
  old.close();

  const db2 = openDb(file);
  try {
    assert.deepEqual(db2.prepare('SELECT barcode FROM copies ORDER BY id').all().map((c) => c.barcode), ['7', 'MON-ETIQUETTE']);
    const loan = db2.prepare('SELECT * FROM loans').get();
    assert.equal(loan.user_id, 1);
    assert.equal(loan.class_id, null);
    assert.ok(db2.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'themes'`).get());
  } finally {
    db2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

let server;
let base;
let db;

const fakeLookup = async (isbn) => ({
  isbn: '9782070612758',
  found: true,
  notice: { isbn: '9782070612758', title: 'Matilda', authors: 'Dahl, Roald', subjects: 'Roman', source: 'bnf' },
  errors: [],
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
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const ct = res.headers.get('content-type') ?? '';
    const data = ct.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  };
  return {
    get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}),
    put: (p, b) => call('PUT', p, b ?? {}), del: (p) => call('DELETE', p),
  };
}

test('parcours complet : installation, catalogue, élèves, prêts, désherbage', async () => {
  const adm = client();
  assert.equal((await adm.get('/api/public/info')).data.needs_setup, true);
  assert.equal((await adm.get('/api/documents')).status, 401);

  let r = await adm.post('/api/setup', { username: 'Directrice', password: 'secret123', school_name: 'École Jules Ferry' });
  assert.equal(r.status, 200);
  assert.equal((await adm.get('/api/me')).data.user.role, 'admin');
  assert.equal((await client().post('/api/setup', { username: 'x', password: 'yyyyyy' })).status, 403);

  // Notice par ISBN
  r = await adm.get('/api/isbn/2070612759');
  assert.equal(r.data.notice.cote, 'R DAH');
  assert.equal(r.data.notice.doc_type, 'roman');
  assert.equal(r.data.local, null);

  r = await adm.post('/api/documents', { ...r.data.notice, copies: 2 });
  assert.equal(r.status, 200);
  const matildaId = r.data.id;
  assert.deepEqual(r.data.barcodes, ['1', '2']);
  assert.equal((await adm.get('/api/isbn/9782070612758')).data.local.id, matildaId);

  r = await adm.post('/api/documents', { title: 'Les volcans', doc_type: 'documentaire', authors: 'Ledu, Stéphanie', pub_year: 1995 });
  const volcansId = r.data.id;
  assert.equal(r.data.cote, '551 LED');
  await adm.post('/api/documents', { title: 'Écoute les oiseaux', doc_type: 'album', authors: 'Ramos, Mario', pub_year: 2020 });

  // Recherche simple (sans accents) et avancée
  assert.equal((await adm.get('/api/documents?q=ecoute')).data.total, 1);
  assert.equal((await adm.get('/api/documents?q=dahl matil')).data.total, 1);
  assert.equal((await adm.get('/api/documents?q=9782070612758')).data.total, 1);
  assert.equal((await adm.get('/api/documents?doc_type=album,roman')).data.total, 2);
  assert.equal((await adm.get('/api/documents?year_to=2000')).data.total, 1);
  assert.equal((await adm.get('/api/documents?cote=551')).data.total, 1);

  // Import ONDE
  const onde = "Nom élève;Nom d'usage élève;Prénom élève;Date naissance;Classe\nMARTIN;;Léa;03/09/2016;CE2\nPETIT;;Hugo;01/02/2016;CE2\n";
  r = await adm.post('/api/users/import', { text: onde, dry_run: true });
  assert.equal(r.data.created.length, 2);
  assert.equal((await adm.get('/api/users?role=eleve')).data.length, 0);
  r = await adm.post('/api/users/import', { text: onde });
  assert.deepEqual(r.data.new_classes, ['CE2']);
  // Réimport l'année suivante : Léa passe en CM1, Hugo est parti.
  r = await adm.post('/api/users/import', { text: "Nom élève;Prénom élève;Date naissance;Classe\nMARTIN;Léa;03/09/2016;CM1\n", archive_missing: true });
  assert.equal(r.data.moved.length, 1);
  assert.equal(r.data.archived.length, 1);
  const students = (await adm.get('/api/users?role=eleve')).data;
  assert.equal(students.length, 1);
  const lea = students[0];
  assert.equal(lea.class_name, 'CM1');

  // Connexion élève avec code secret
  await adm.put(`/api/users/${lea.id}`, { secret_code: ['🍎', '⭐'] });
  const classes = (await client().get('/api/public/classes')).data;
  assert.deepEqual(classes.map((c) => c.name), ['CM1']);
  const kids = (await client().get(`/api/public/classes/${classes[0].id}/students`)).data;
  assert.equal(kids[0].has_code, 1);
  assert.equal(kids[0].last_name, undefined);
  const eleve = client();
  assert.equal((await eleve.post('/api/login/eleve', { user_id: lea.id, code: ['⭐', '🍎'] })).status, 401);
  assert.equal((await eleve.post('/api/login/eleve', { user_id: lea.id, code: ['🍎', '⭐'] })).status, 200);
  assert.equal((await eleve.get('/api/documents?q=matilda')).data.total, 1);
  assert.equal((await eleve.post('/api/loans', { user_id: lea.id, barcode: '1' })).status, 403);

  // Prêts : limite, retards, retour, prolongation
  r = await adm.post('/api/loans', { user_id: lea.id, barcode: '9782070612758' }); // par ISBN
  assert.equal(r.status, 200);
  assert.equal(r.data.barcode, '1');
  assert.equal((await adm.post('/api/loans', { user_id: lea.id, barcode: '1' })).status, 409);
  const volcansCopy = (await adm.get(`/api/documents/${volcansId}`)).data.copies[0].barcode;
  assert.equal((await adm.post('/api/loans', { user_id: lea.id, barcode: volcansCopy })).status, 200);
  r = await adm.post('/api/loans', { user_id: lea.id, barcode: '2' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Limite/);

  assert.equal((await eleve.get('/api/me/loans')).data.current.length, 2);
  assert.equal((await adm.get(`/api/documents/${matildaId}`)).data.available_count, 1);

  db.prepare(`UPDATE loans SET due_at = '2020-01-01' WHERE copy_id = (SELECT id FROM copies WHERE barcode = '1')`).run();
  r = await adm.get('/api/loans?status=overdue');
  assert.equal(r.data.length, 1);
  assert.ok(r.data[0].days_late > 0);
  assert.match((await adm.get('/api/loans/overdue.csv')).data, /Matilda/);

  r = await adm.post(`/api/loans/${r.data[0].id}/renew`);
  assert.equal(r.status, 200);
  assert.equal((await adm.get('/api/loans?status=overdue')).data.length, 0);

  r = await adm.post('/api/loans/return', { barcode: '1' });
  assert.equal(r.data.first_name, 'Léa');
  assert.equal((await adm.post('/api/loans/return', { barcode: '1' })).status, 404);

  // Listes thématiques
  r = await adm.post('/api/lists', { name: 'Sciences', from_search: { doc_type: 'documentaire' } });
  assert.equal(r.data.added, 1);
  await adm.post(`/api/lists/${r.data.id}/items`, { document_ids: [matildaId] });
  assert.equal((await adm.get(`/api/lists/${r.data.id}`)).data.items.length, 2);
  assert.match((await adm.get(`/api/lists/${r.data.id}/export.csv`)).data, /551 LED/);

  // Désherbage : « Les volcans » (1995) est en prêt → ignoré
  r = await adm.get('/api/weeding?year_before=2000');
  assert.deepEqual(r.data.items.map((d) => d.id), [volcansId]);
  r = await adm.post('/api/documents/batch-delete', { ids: [volcansId, matildaId] });
  assert.equal(r.data.deleted, 1);
  assert.equal(r.data.skipped[0].id, volcansId);
  // L'historique de prêt reste lisible après suppression du document.
  const hist = (await adm.get(`/api/users/${lea.id}`)).data.history;
  assert.equal(hist[0].title, 'Matilda');

  // Rôle enseignant
  r = await adm.post('/api/users', { role: 'enseignant', username: 'mdurand', password: 'azerty1', first_name: 'Marie', last_name: 'Durand' });
  assert.equal(r.status, 200);
  const prof = client();
  assert.equal((await prof.post('/api/login', { username: 'MDurand', password: 'azerty1' })).status, 200);
  assert.equal((await prof.post('/api/documents/batch-delete', { ids: [volcansId] })).status, 403);
  assert.equal((await prof.post('/api/loans/return', { barcode: volcansCopy })).status, 200);
  assert.equal((await prof.get('/api/stats')).data.documents, 2);
});

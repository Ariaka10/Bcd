import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { guessMapping, normalizeAuthors, readTable } from '../server/catalog-import.js';

let server;
let base;
let db;
let cookie = '';

before(async () => {
  db = openDb(':memory:');
  server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/setup', { username: 'admin', password: 'secret123' });
});
after(() => { server.close(); db.close(); });

async function call(method, p, body, raw) {
  const res = await fetch(base + p, {
    method,
    headers: { cookie, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, type: ct, data: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

// Export « à la Hibouthèque » : une ligne par exemplaire, séparateur « ; »
const EXPORT = [
  'Code barre;Titre;Titre de série;Auteur(s);Illustrateur;Editeur;Date de parution;ISBN;Cote;Genre;Résumé;Etat;Date d\'acquisition',
  '000012;Le loup qui voulait changer de couleur;Mes p\'tits albums;Orianne LALLEMAND;Éléonore Thuillier;Auzou;2009;978-2-7338-1234-1;A LAL;Album;Le loup n\'aime pas sa couleur.;Bon;03/09/2015',
  '000013;Le loup qui voulait changer de couleur;Mes p\'tits albums;Orianne LALLEMAND;Éléonore Thuillier;Auzou;2009;978-2-7338-1234-1;A LAL;Album;;Abîmé;03/09/2015',
  '000014;Les volcans;;Stéphanie Ledu;;Milan;2012;;;Documentaire;;Bon;',
  '000015;Un kilomÃ¨tre Ã  pied;;Anonyme;;;;;;Comptines;;Perdu;',
  ';;;;;;;;;;;;',
  '000016;;;Sans titre;;;;;;;;;',
].join('\r\n');

test('reconnaissance des colonnes et des auteurs', () => {
  const { headers } = readTable(EXPORT);
  const m = guessMapping(headers);
  assert.equal(m[0], 'barcode');
  assert.equal(m[1], 'title');
  assert.equal(m[2], 'series'); // « Titre de série » n'est pas le titre
  assert.equal(m[3], 'authors');
  assert.equal(m[4], 'illustrators');
  assert.equal(m[9], 'doc_type');
  assert.equal(m[11], 'state');
  assert.deepEqual(guessMapping(['Auteur 1', 'Auteur 2', 'Titre']), ['authors', 'authors', 'title']);
  assert.equal(normalizeAuthors('Orianne LALLEMAND'), 'LALLEMAND, Orianne');
  assert.equal(normalizeAuthors('DUPONT Marie ; Roald Dahl'), 'DUPONT, Marie ; Dahl, Roald');
  assert.equal(normalizeAuthors('Ledu, Stéphanie'), 'Ledu, Stéphanie');
  // XML « plat »
  const xml = '<?xml version="1.0"?><export><document><titre>Petit Ours Brun</titre><auteur>Marie Aubinais</auteur></document>'
    + '<document><titre>Bébés chouettes</titre><auteur>Martin Waddell</auteur></document></export>';
  const t = readTable(xml);
  assert.deepEqual(guessMapping(t.headers), ['title', 'authors']);
  assert.equal(t.rows.length, 2);
});

test('import d\'un catalogue Hibouthèque', async () => {
  // Fichier en Windows-1252, comme souvent : décodé par le navigateur avant envoi (ici, déjà en texte).
  let r = await call('POST', '/api/catalog-import/analyze', { text: EXPORT });
  assert.equal(r.data.rows, 5); // la ligne vide est ignorée
  const mapping = r.data.mapping;

  r = await call('POST', '/api/catalog-import', { text: EXPORT, mapping, dry_run: true });
  assert.equal(r.data.documents, 3);
  assert.equal(r.data.copies, 4);
  assert.equal(r.data.errors.length, 1); // ligne sans titre
  assert.equal((await call('GET', '/api/documents')).data.total, 0);

  r = await call('POST', '/api/catalog-import', { text: EXPORT, mapping, keep_numbers: true });
  assert.equal(r.data.documents, 3);
  const loup = (await call('GET', '/api/documents?q=loup')).data.items[0];
  assert.equal(loup.isbn, '9782733812341');
  assert.equal(loup.cote, 'A LAL');
  assert.equal(loup.numbers, '12, 13'); // « 000012 » devient « 12 »
  const detail = (await call('GET', `/api/documents/${loup.id}`)).data;
  assert.equal(detail.authors, 'LALLEMAND, Orianne ; Thuillier, Éléonore');
  assert.equal(detail.series, 'Mes p\'tits albums');
  assert.deepEqual(detail.copies.map((c) => c.state), ['ok', 'abime']);
  assert.equal(detail.copies[0].acquired_at, '2015-09-03');
  const km = (await call('GET', '/api/documents?q=kilometre')).data.items[0];
  assert.equal(km.title, 'Un kilomètre à pied');
  assert.equal(km.doc_type, 'poesie');
  const volcans = (await call('GET', '/api/documents?q=volcans')).data.items[0];
  assert.equal(volcans.doc_type, 'documentaire');
  assert.match(volcans.cote, /^\d{3} LED$/);

  // Relancer l'import ne crée pas de doublons ; les nouveaux numéros suivent les anciens.
  r = await call('POST', '/api/catalog-import', { text: EXPORT, mapping });
  assert.equal(r.data.documents, 0);
  assert.equal(r.data.skipped.length, 3);
  const created = await call('POST', '/api/documents', { title: 'Nouveau', doc_type: 'album' });
  assert.deepEqual(created.data.barcodes, ['16']);
});

test('couverture ajoutée à la main', async () => {
  const id = (await call('POST', '/api/documents', { title: 'Avec image', doc_type: 'album' })).data.id;
  // Plus petit JPEG valide (1×1 pixel)
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
  assert.equal((await call('PUT', `/api/documents/${id}/cover`, null, Buffer.from('pas une image'))).status, 400);
  const r = await call('PUT', `/api/documents/${id}/cover`, null, jpeg);
  assert.equal(r.status, 200);
  assert.match(r.data.cover_url, new RegExp(`^/api/documents/${id}/cover\\?v=`));
  const img = await call('GET', `/api/documents/${id}/cover`);
  assert.equal(img.type, 'image/jpeg');
  assert.ok(img.data.equals(jpeg));
  assert.equal((await call('DELETE', `/api/documents/${id}/cover`)).status, 200);
  assert.equal((await call('GET', `/api/documents/${id}`)).data.cover_url, null);
  assert.equal((await call('GET', `/api/documents/${id}/cover`)).status, 404);
});

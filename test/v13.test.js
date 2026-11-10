import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openDb, currentSchoolYear } from '../server/db.js';
import { createApp } from '../server/app.js';

let server;
let base;
let db;
let cookie = '';
const usb = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-cle-'));

before(async () => {
  db = openDb(':memory:');
  server = http.createServer(createApp(db));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/setup', { username: 'admin', password: 'secret123' });
});
after(() => { server.close(); db.close(); fs.rmSync(usb, { recursive: true, force: true }); });

async function call(method, p, body) {
  const res = await fetch(base + p, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}

test('année scolaire', () => {
  assert.equal(currentSchoolYear(new Date(2026, 8, 1)), '2026-2027');
  assert.equal(currentSchoolYear(new Date(2027, 7, 31)), '2026-2027');
});

test('sauvegarde sur clé USB', async () => {
  assert.equal((await call('PUT', '/api/admin/extra-backup', { dir: path.join(usb, 'absent') })).status, 400);
  await call('POST', '/api/documents', { title: 'Un livre', doc_type: 'album' });
  let r = await call('PUT', '/api/admin/extra-backup', { dir: usb });
  assert.equal(r.data.available, true);
  assert.equal(r.data.days_since, 0);
  assert.equal(fs.readdirSync(usb).filter((f) => f.endsWith('.sqlite')).length, 1);
  assert.equal((await call('GET', '/api/admin/reminders')).data.extra_backup_days, null);
  // Clé débranchée
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'extra_backup_dir'`).run(path.join(usb, 'debranchee'));
  assert.equal((await call('POST', '/api/admin/extra-backup/run')).status, 409);
  // Pas de copie depuis 8 jours : rappel
  db.prepare(`UPDATE settings SET value = ? WHERE key = 'extra_backup_last'`).run(new Date(Date.now() - 8 * 86400000).toISOString());
  assert.equal((await call('GET', '/api/admin/reminders')).data.extra_backup_days, 8);
});

test('assistant de rentrée', async () => {
  // Installation neuve : rien à faire avant la prochaine rentrée
  assert.equal((await call('GET', '/api/admin/reminders')).data.rentree, null);
  db.prepare(`UPDATE settings SET value = '2000-2001' WHERE key = 'school_year_done'`).run();
  assert.equal((await call('GET', '/api/admin/reminders')).data.rentree, currentSchoolYear());

  const cls = (await call('POST', '/api/classes', { name: 'GS 2025' })).data.id;
  const parti = (await call('POST', '/api/users', { role: 'eleve', first_name: 'Tom', last_name: 'Parti', class_id: cls })).data.id;
  const gardeLivre = (await call('POST', '/api/users', { role: 'eleve', first_name: 'Zoé', last_name: 'Livre', class_id: cls })).data.id;
  await call('POST', '/api/loans', { user_id: gardeLivre, barcode: '1' });
  await call('POST', '/api/users/batch', { ids: [parti, gardeLivre], action: 'archive' });
  assert.ok(db.prepare('SELECT archived_at FROM users WHERE id = ?').get(parti).archived_at);

  let r = await call('GET', '/api/admin/rentree');
  assert.equal(r.data.archived.length, 2);
  assert.equal(r.data.pending_loans, 1);
  assert.deepEqual(r.data.empty_classes.map((c) => c.name), ['GS 2025']); // plus aucun élève actif
  r = await call('POST', '/api/admin/rentree/purge', { ids: [parti, gardeLivre] });
  assert.equal(r.data.deleted, 1); // Zoé a encore un livre : gardée
  await call('POST', '/api/loans/return', { barcode: '1' });
  assert.equal((await call('POST', '/api/admin/rentree/purge', { ids: [gardeLivre] })).data.deleted, 1);
  r = await call('GET', '/api/admin/rentree');
  assert.deepEqual(r.data.empty_classes.map((c) => c.name), ['GS 2025']);
  assert.equal((await call('POST', '/api/admin/rentree/classes', { ids: [cls] })).data.deleted, 1);
  await call('POST', '/api/admin/rentree/done');
  assert.equal((await call('GET', '/api/admin/reminders')).data.rentree, null);

  // Réactivation : la date d'archivage est effacée
  const u = (await call('POST', '/api/users', { role: 'eleve', first_name: 'Léa', last_name: 'B' })).data.id;
  await call('POST', '/api/users/batch', { ids: [u], action: 'archive' });
  await call('POST', '/api/users/batch', { ids: [u], action: 'activate' });
  assert.equal(db.prepare('SELECT archived_at FROM users WHERE id = ?').get(u).archived_at, null);
});

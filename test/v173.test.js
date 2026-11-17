import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createUsbWatcher, USB_FOLDER } from '../server/usb.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-usb-'));
// Deux fausses clés : chacune est un dossier (« racine » de la clé).
const KEY_A = { serial: 'A1B2C3D4', label: 'ECOLE', root: path.join(tmp, 'cleA') };
const KEY_B = { serial: '99887766', label: 'PERSO', root: path.join(tmp, 'cleB') };
fs.mkdirSync(KEY_A.root);
fs.mkdirSync(KEY_B.root);
let plugged = [];
const backups = (k) => (fs.existsSync(path.join(k.root, USB_FOLDER)) ? fs.readdirSync(path.join(k.root, USB_FOLDER)).filter((f) => f.endsWith('.sqlite')) : []);

let server;
let base;
let db;
let usb;
let cookie = '';

before(async () => {
  db = openDb(':memory:');
  usb = createUsbWatcher(db, { listDrives: async () => plugged });
  server = http.createServer(createApp(db, { usb }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/api/setup', { username: 'admin', password: 'secret123', first_name: 'Claire', last_name: 'Martin' });
});
after(() => { server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function call(method, p, body) {
  const res = await fetch(base + p, { method, headers: { cookie, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: res.status, data: await res.json() };
}

test('clé inconnue : proposition, puis « toujours sur cette clé »', async () => {
  plugged = [{ ...KEY_A, letter: 'E' }];
  await usb.poll();
  let s = (await call('GET', '/api/app/usb')).data;
  assert.deepEqual(s.pending, { serial: KEY_A.serial, label: 'ECOLE', letter: 'E' });
  assert.equal(backups(KEY_A).length, 0); // rien sans l'accord de l'administrateur

  s = (await call('POST', '/api/app/usb/answer', { serial: KEY_A.serial, choice: 'always' })).data;
  assert.equal(s.pending, null);
  assert.equal(s.keys.length, 1);
  assert.equal(s.keys[0].plugged, true);
  assert.ok(s.keys[0].last);
  assert.equal(backups(KEY_A).length, 1);
  assert.equal(s.events.at(-1).type, 'copied');
  // Compte pour le rappel « pas de copie depuis 7 jours »
  assert.equal((await call('GET', '/api/admin/reminders')).data.extra_backup_days, null);
});

test('clé mémorisée : copie dès qu\'elle est rebranchée, même sous une autre lettre', async () => {
  plugged = [];
  await usb.poll();
  await new Promise((r) => setTimeout(r, 1100)); // noms de fichiers à la minute près : on évite d'écraser
  plugged = [{ ...KEY_A, letter: 'F' }];
  await usb.poll();
  const s = (await call('GET', '/api/app/usb')).data;
  assert.equal(s.pending, null); // pas de question pour une clé mémorisée
  assert.equal(s.events.at(-1).reason, 'branchée');
  assert.equal(s.events.at(-1).letter, 'F');
  // Toujours branchée : pas de nouvelle copie à chaque passage
  const n = s.events.length;
  await usb.poll();
  assert.equal((await call('GET', '/api/app/usb')).data.events.length, n);
});

test('« une seule fois », « ne jamais demander » et clé retirée avant la réponse', async () => {
  plugged = [{ ...KEY_A, letter: 'F' }, { ...KEY_B, letter: 'G' }];
  await usb.poll();
  assert.equal((await call('GET', '/api/app/usb')).data.pending.serial, KEY_B.serial);
  let s = (await call('POST', '/api/app/usb/answer', { serial: KEY_B.serial, choice: 'once' })).data;
  assert.equal(backups(KEY_B).length, 1);
  assert.equal(s.keys.length, 1); // pas mémorisée

  // Rebranchée : la question revient
  plugged = [{ ...KEY_A, letter: 'F' }];
  await usb.poll();
  plugged = [{ ...KEY_A, letter: 'F' }, { ...KEY_B, letter: 'G' }];
  await usb.poll();
  assert.equal((await call('GET', '/api/app/usb')).data.pending.serial, KEY_B.serial);
  // Retirée sans réponse : plus de question
  plugged = [{ ...KEY_A, letter: 'F' }];
  await usb.poll();
  assert.equal((await call('GET', '/api/app/usb')).data.pending, null);

  plugged = [{ ...KEY_A, letter: 'F' }, { ...KEY_B, letter: 'G' }];
  await usb.poll();
  s = (await call('POST', '/api/app/usb/answer', { serial: KEY_B.serial, choice: 'never' })).data;
  assert.equal(s.ignored, 1);
  plugged = [{ ...KEY_A, letter: 'F' }];
  await usb.poll();
  plugged = [{ ...KEY_A, letter: 'F' }, { ...KEY_B, letter: 'G' }];
  await usb.poll();
  assert.equal((await call('GET', '/api/app/usb')).data.pending, null);
  // « Proposer à nouveau »
  s = (await call('POST', '/api/app/usb/reset-ignored')).data;
  assert.equal(s.ignored, 0);
  assert.equal((await call('POST', '/api/app/usb/answer', { serial: KEY_B.serial, choice: 'bizarre' })).status, 400);
});

test('fermeture : copie sur les clés mémorisées branchées ; oublier une clé', async () => {
  const before = (await call('GET', '/api/app/usb')).data.events.length;
  usb.copyOnQuit();
  const s = (await call('GET', '/api/app/usb')).data;
  assert.equal(s.events.length, Math.min(10, before + 1));
  assert.equal(s.events.at(-1).reason, 'fermeture');
  assert.equal((await call('DELETE', `/api/app/usb/keys/${KEY_A.serial}`)).data.keys.length, 0);
});

test('sans l\'application Windows', async () => {
  const db2 = openDb(':memory:');
  const srv = http.createServer(createApp(db2, {}));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const b = `http://127.0.0.1:${srv.address().port}`;
  let c = '';
  const res = await fetch(`${b}/api/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'secret123', first_name: 'A', last_name: 'B' }) });
  c = res.headers.get('set-cookie').split(';')[0];
  const r = await (await fetch(`${b}/api/app/usb`, { headers: { cookie: c } })).json();
  assert.deepEqual(r, { supported: false });
  srv.close();
  db2.close();
});

test('lecture des lecteurs donnés par Windows', async () => {
  const { parseDrive } = await import('../electron/drives.js');
  assert.deepEqual(parseDrive({ DeviceID: 'E:', VolumeSerialNumber: '1A2B3C4D', VolumeName: 'ÉCOLE' }),
    { letter: 'E', root: 'E:\\', serial: '1A2B3C4D', label: 'ÉCOLE' });
  assert.equal(parseDrive({ DeviceID: 'F:', VolumeSerialNumber: null }), null); // lecteur de cartes vide
  assert.equal(parseDrive({ DeviceID: 'G:', VolumeSerialNumber: 'X', VolumeName: '' }).label, null);
});

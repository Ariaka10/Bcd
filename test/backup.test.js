import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { autoBackup, listBackups } from '../server/backup.js';

test('sauvegarde, téléchargement et restauration', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-test-'));
  const backupDir = path.join(dir, 'Sauvegardes');
  const db = openDb(path.join(dir, 'bcd.sqlite'));
  const server = http.createServer(createApp(db, { backupDir }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const call = async (method, p, body, raw) => {
    const res = await fetch(base + p, {
      method,
      headers: { cookie, 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
      body: raw ?? (body ? JSON.stringify(body) : undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, res };
  };

  try {
    await call('POST', '/api/setup', { username: 'admin', password: 'secret123' });
    await call('POST', '/api/documents', { title: 'Avant', doc_type: 'roman' });

    // Copie téléchargée = état « Avant »
    const dl = await call('GET', '/api/admin/backup');
    assert.equal(dl.status, 200);
    const file = Buffer.from(await dl.res.arrayBuffer());
    assert.equal(file.subarray(0, 15).toString(), 'SQLite format 3');

    await call('POST', '/api/documents', { title: 'Après', doc_type: 'roman' });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents').get().n, 2);

    // Un fichier quelconque est refusé
    assert.equal((await call('POST', '/api/admin/restore', null, Buffer.from('pas une base'))).status, 400);

    const r = await call('POST', '/api/admin/restore', null, file);
    assert.equal(r.status, 200);
    assert.deepEqual(db.prepare('SELECT title FROM documents').all().map((d) => d.title), ['Avant']);
    // Sessions effacées : il faut se reconnecter
    assert.equal((await call('GET', '/api/admin/backups')).status, 401);
    await call('POST', '/api/login', { username: 'admin', password: 'secret123' });

    // Une copie de sécurité a été faite avant la restauration
    const list = await (await call('GET', '/api/admin/backups')).res.json();
    assert.ok(list.items.some((b) => b.name.startsWith('bcd-avant-restauration_')));

    // Rotation des sauvegardes automatiques
    for (let i = 0; i < 4; i++) {
      const f = autoBackup(db, backupDir, { keep: 2, prefix: 'bcd-auto' });
      fs.renameSync(f, f.replace('.sqlite', `-${i}.sqlite`));
    }
    autoBackup(db, backupDir, { keep: 2, prefix: 'bcd-auto' });
    assert.equal(listBackups(backupDir).filter((b) => b.name.startsWith('bcd-auto_')).length, 2);
  } finally {
    server.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

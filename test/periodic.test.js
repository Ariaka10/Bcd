import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { startPeriodicBackups } from '../server/backup.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('sauvegardes périodiques seulement après des changements', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-periodique-'));
  const db = openDb(path.join(dir, 'bcd.sqlite'));
  const backups = path.join(dir, 'Sauvegardes');
  const count = () => (fs.existsSync(backups) ? fs.readdirSync(backups).filter((f) => f.startsWith('bcd-periodique_')).length : 0);
  try {
    assert.equal(db.prepare('PRAGMA synchronous').get().synchronous, 2); // FULL
    const stop = startPeriodicBackups(db, backups, { minutes: 0.002, keep: 12 }); // ~120 ms
    await wait(350);
    assert.equal(count(), 0); // rien n'a changé : pas de sauvegarde
    db.prepare(`INSERT INTO documents (title) VALUES ('Nouveau livre')`).run();
    await wait(350);
    assert.equal(count(), 1);
    await wait(350);
    assert.equal(count(), 1); // pas de nouveau changement
    stop();
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

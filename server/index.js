import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbFile = process.env.BCD_DB ?? path.join(root, 'data', 'bcd.sqlite');
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

const db = openDb(dbFile);
const server = http.createServer(createApp(db));
server.listen(port, host, () => {
  console.log(`BCD prête sur http://localhost:${port}  (base : ${dbFile})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}

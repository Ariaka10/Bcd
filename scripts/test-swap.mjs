/**
 * Test (CI Windows) : fabrique le script de remplacement et son lanceur invisible, exactement comme
 * l'application lors d'une mise à jour légère de la version zip.
 * Usage : node scripts/test-swap.mjs <pid à attendre> <dossier resources> <BCD.exe> <dossier des scripts>
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

// updater.js importe Electron, absent hors de l'application : on le charge avec un faux module.
const src = fs.readFileSync(new URL('../electron/updater.js', import.meta.url), 'utf8')
  .replace("import { app, net } from 'electron';", 'const app = {}, net = {};');
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-test-')), 'updater.mjs');
fs.writeFileSync(tmp, src);
const { swapScript, hiddenLauncher } = await import(pathToFileURL(tmp).href);

const [pid, resources, exe, dir] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const script = path.join(dir, 'bcd-maj-test.cmd');
const launcher = path.join(dir, 'bcd-maj-test.vbs');
fs.writeFileSync(script, swapScript({ pid: Number(pid), resources, exe, launcher }), 'utf8');
fs.writeFileSync(launcher, hiddenLauncher(script));
console.log(launcher);

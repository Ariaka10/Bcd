/**
 * Mises à jour : on regarde la dernière version publiée sur GitHub.
 * - Application installée : téléchargement de l'installateur puis installation silencieuse et redémarrage.
 * - Version zip (sans installation) : seule la partie « application » est téléchargée (quelques Mo, fichier app.asar)
 *   si le moteur (Electron) n'a pas changé ; elle remplace l'ancienne à la fermeture, puis BCD se rouvre.
 *   Sinon : lien vers la page de téléchargement (zip complet).
 * La progression du téléchargement est consultable pendant l'opération (barre de progression dans l'appli).
 */
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = 'Ariaka10/Bcd';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const UA = { 'User-Agent': 'BCD-application' };

const state = { update: null, error: null, checkedAt: null };
// Opération en cours : { phase: 'download' | 'restart' | 'error', received, total, mode, error }
let progress = null;

/** Installée par l'installateur (dans %LOCALAPPDATA%\Programs) ou lancée depuis un dossier dézippé ? */
export function isInstalled() {
  if (process.platform !== 'win32' || !process.env.LOCALAPPDATA) return false;
  const programs = path.join(process.env.LOCALAPPDATA, 'Programs').toLowerCase();
  return process.execPath.toLowerCase().startsWith(programs);
}

/** Compare deux versions « 1.10.2 » ; > 0 si a est plus récente. */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** Dossier « resources » de l'application (celui qui contient app.asar). */
const resourcesDir = () => path.dirname(app.getAppPath());

/** La version zip peut-elle se mettre à jour elle-même (dossier modifiable) ? */
function canPatchHere() {
  if (process.platform !== 'win32' || isInstalled() || !app.isPackaged) return false;
  try {
    fs.accessSync(resourcesDir(), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function checkForUpdate() {
  state.checkedAt = new Date().toISOString();
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', ...UA },
    });
    if (res.status === 404) throw new Error('aucune version publiée pour le moment');
    if (!res.ok) throw new Error(`GitHub : erreur ${res.status}`);
    const rel = await res.json();
    const version = String(rel.tag_name ?? '').replace(/^v/, '');
    state.error = null;
    if (!version || compareVersions(version, app.getVersion()) <= 0) {
      state.update = null;
      return null;
    }
    const asset = (re) => rel.assets?.find((a) => re.test(a.name));
    const installer = asset(/^Installer-BCD-.*\.exe$/i);
    // Mise à jour légère de la version zip : fichier app.asar + description (version du moteur, empreinte).
    let patch = null;
    const asar = asset(/^BCD-app-.*\.asar$/i);
    const manifest = asset(/^BCD-maj-.*\.json$/i);
    if (asar && manifest && canPatchHere()) {
      try {
        const m = await (await net.fetch(manifest.browser_download_url, { headers: UA })).json();
        if (m.electron === process.versions.electron && /^[0-9a-f]{64}$/.test(m.sha256)) {
          patch = { url: asar.browser_download_url, sha256: m.sha256, size: m.size ?? asar.size };
        }
      } catch {
        patch = null; // description illisible : on proposera le zip complet
      }
    }
    state.update = {
      version,
      url: rel.html_url ?? RELEASES_URL,
      installer_url: installer?.browser_download_url ?? null,
      patch,
      can_install: (Boolean(installer) && isInstalled()) || Boolean(patch),
      install_mode: isInstalled() ? 'installer' : patch ? 'patch' : null,
      download_size: isInstalled() ? installer?.size ?? null : patch?.size ?? null,
      notes: rel.body ?? '',
    };
    return state.update;
  } catch (e) {
    state.error = e.message;
    return null;
  }
}

export function updateInfo() {
  return {
    desktop: true,
    version: app.getVersion(),
    portable: !isInstalled(),
    update: state.update,
    update_error: state.error,
    releases_url: RELEASES_URL,
  };
}

export const updateProgress = () => progress;

/** Téléchargement avec suivi de la progression. */
async function download(url, expectedSize) {
  const res = await net.fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Téléchargement impossible (erreur ${res.status})`);
  const total = Number(res.headers.get('content-length')) || expectedSize || 0;
  progress = { ...progress, phase: 'download', received: 0, total };
  const chunks = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    progress.received += value.length;
  }
  return Buffer.concat(chunks);
}

/**
 * Script lancé à la fermeture de la version zip : attend la fin de BCD, remplace app.asar par la nouvelle version
 * (en gardant l'ancienne en secours), puis rouvre BCD.
 */
export function swapScript({ pid, resources, exe }) {
  const q = (p) => `"${p}"`;
  return [
    '@echo off',
    'chcp 65001 >nul',
    ':attente',
    `tasklist /FI "PID eq ${pid}" 2>nul | find "${pid}" >nul && (timeout /t 1 /nobreak >nul & goto attente)`,
    'timeout /t 1 /nobreak >nul',
    `copy /y ${q(path.join(resources, 'app.asar'))} ${q(path.join(resources, 'app-precedente.asar.bak'))} >nul`,
    `move /y ${q(path.join(resources, 'app-maj.bin'))} ${q(path.join(resources, 'app.asar'))} >nul`,
    `start "" ${q(exe)}`,
    '(goto) 2>nul & del "%~f0"',
    '',
  ].join('\r\n');
}

/** Lance la mise à jour (en arrière-plan) ; la progression se suit avec updateProgress(). */
export function installUpdate() {
  const u = state.update;
  if (!u?.can_install) throw new Error('Installation automatique impossible pour cette version');
  if (progress?.phase === 'download' || progress?.phase === 'restart') return { ok: true, mode: progress.mode };
  const mode = u.install_mode;
  progress = { phase: 'download', received: 0, total: u.download_size ?? 0, mode, version: u.version };
  run(u, mode).catch((e) => { progress = { ...progress, phase: 'error', error: e.message }; });
  return { ok: true, mode };
}

async function run(u, mode) {
  if (mode === 'installer') {
    const buf = await download(u.installer_url, u.download_size);
    if (buf.length < 1_000_000 || buf.subarray(0, 2).toString('latin1') !== 'MZ') throw new Error('Fichier téléchargé invalide');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-maj-'));
    const file = path.join(dir, `Installer-BCD-${u.version}.exe`);
    fs.writeFileSync(file, buf);
    progress = { ...progress, phase: 'restart' };
    // /S : installation silencieuse ; --force-run : relancer BCD une fois installé.
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 2500);
    return;
  }
  // Version zip : seule la partie « application » change.
  const buf = await download(u.patch.url, u.patch.size);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha !== u.patch.sha256) throw new Error('Fichier téléchargé abîmé (empreinte différente) : réessayez');
  const resources = resourcesDir();
  // Nom sans « .asar » : Electron traite ces fichiers à part.
  fs.writeFileSync(path.join(resources, 'app-maj.bin'), buf);
  const script = path.join(os.tmpdir(), `bcd-maj-${process.pid}.cmd`);
  fs.writeFileSync(script, swapScript({ pid: process.pid, resources, exe: process.execPath }), 'utf8');
  progress = { ...progress, phase: 'restart' };
  spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  setTimeout(() => app.quit(), 2500);
}

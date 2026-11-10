/**
 * Mises à jour : on regarde la dernière version publiée sur GitHub.
 * - Application installée : téléchargement de l'installateur puis installation silencieuse et redémarrage.
 * - Version zip (sans installation) ou ordinateur qui bloque : lien vers la page de téléchargement.
 */
import { app, net } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REPO = 'Ariaka10/Bcd';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

const state = { update: null, error: null, checkedAt: null };

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

export async function checkForUpdate() {
  state.checkedAt = new Date().toISOString();
  try {
    const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'BCD-application' },
    });
    if (res.status === 404) throw new Error('aucune version publiée accessible (le dépôt GitHub est peut-être privé)');
    if (!res.ok) throw new Error(`GitHub : erreur ${res.status}`);
    const rel = await res.json();
    const version = String(rel.tag_name ?? '').replace(/^v/, '');
    state.error = null;
    if (!version || compareVersions(version, app.getVersion()) <= 0) {
      state.update = null;
      return null;
    }
    const installer = rel.assets?.find((a) => /^Installer-BCD-.*\.exe$/i.test(a.name));
    state.update = {
      version,
      url: rel.html_url ?? RELEASES_URL,
      installer_url: installer?.browser_download_url ?? null,
      can_install: Boolean(installer) && isInstalled(),
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

/** Télécharge l'installateur, le lance en mode silencieux et ferme l'application (elle redémarre ensuite). */
export async function installUpdate() {
  const u = state.update;
  if (!u?.can_install || !u.installer_url) throw new Error('Installation automatique impossible pour cette version');
  const res = await net.fetch(u.installer_url, { headers: { 'User-Agent': 'BCD-application' } });
  if (!res.ok) throw new Error(`Téléchargement impossible (erreur ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1_000_000 || buf.subarray(0, 2).toString('latin1') !== 'MZ') throw new Error('Fichier téléchargé invalide');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bcd-maj-'));
  const file = path.join(dir, `Installer-BCD-${u.version}.exe`);
  fs.writeFileSync(file, buf);
  // /S : installation silencieuse ; --force-run : relancer BCD une fois installé.
  spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 1500);
  return { ok: true };
}

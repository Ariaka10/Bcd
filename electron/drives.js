/**
 * Clés USB branchées (Windows) : lettre, nom et numéro de série du volume.
 * Toutes les 3 secondes, on regarde seulement quelles lettres existent (rapide) ;
 * PowerShell n'est interrogé que lorsqu'une lettre apparaît ou disparaît.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';

const LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ';

/** Le lecteur existe-t-il ? (sans bloquer : un lecteur réseau injoignable peut mettre longtemps à répondre) */
function exists(letter) {
  const check = fs.promises.access(`${letter}:\\`).then(() => true, () => false);
  const timeout = new Promise((r) => setTimeout(() => r(false), 1500));
  return Promise.race([check, timeout]);
}

/** Lecteurs amovibles (DriveType 2 = clé USB, carte mémoire) d'après Windows. Autre type : pour les tests (3 = disque). */
export function removableDrives(driveType = 2) {
  const script = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; '
    + `Get-CimInstance Win32_LogicalDisk -Filter "DriveType=${Number(driveType)}" | `
    + 'Select-Object DeviceID, VolumeSerialNumber, VolumeName | ConvertTo-Json -Compress';
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 20000, encoding: 'utf8' }, (err, stdout) => {
        if (err) return resolve(null);
        try {
          const raw = stdout.trim() ? JSON.parse(stdout) : [];
          resolve((Array.isArray(raw) ? raw : [raw]).map(parseDrive).filter(Boolean));
        } catch {
          resolve(null);
        }
      });
  });
}

export function parseDrive(d) {
  const letter = String(d?.DeviceID ?? '').replace(':', '');
  if (!/^[A-Z]$/.test(letter) || !d.VolumeSerialNumber) return null; // pas de média, ou clé non formatée
  return { letter, root: `${letter}:\\`, serial: String(d.VolumeSerialNumber), label: d.VolumeName || null };
}

let cache = { signature: null, drives: [] };

/** Liste des clés branchées ; [] hors Windows. */
export async function listDrives() {
  if (process.platform !== 'win32') return [];
  const present = [];
  for (const l of LETTERS) if (await exists(l)) present.push(l);
  const signature = present.join('');
  if (signature !== cache.signature) {
    const drives = await removableDrives();
    // PowerShell indisponible : on réessaiera au prochain passage.
    if (drives) cache = { signature, drives };
  }
  return cache.drives;
}

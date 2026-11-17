/**
 * Clés USB : BCD repère une clé dès qu'elle est branchée.
 * - Clé mémorisée (« Toujours sur cette clé ») : une sauvegarde y est copiée tout de suite, et à chaque fermeture.
 * - Clé inconnue : l'administrateur se voit proposer d'y faire une sauvegarde (une fois, toujours, ou jamais).
 * Une clé est reconnue par son numéro de série : peu importe la lettre (E:, F:…) que Windows lui donne.
 *
 * La liste des lecteurs est fournie par l'application Windows (listDrives) : [{ serial, label, letter, root }].
 */
import fs from 'node:fs';
import path from 'node:path';
import { autoBackup } from './backup.js';
import { getSettings } from './db.js';

export const USB_FOLDER = 'BCD-sauvegardes';

const readJson = (s, fallback) => {
  try {
    const v = JSON.parse(s || '');
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const setSetting = (db, key, value) => db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);

export const knownKeys = (db) => readJson(getSettings(db).usb_keys, []);
export const ignoredKeys = (db) => readJson(getSettings(db).usb_ignored, []);
const saveKeys = (db, keys) => setSetting(db, 'usb_keys', JSON.stringify(keys));
const saveIgnored = (db, list) => setSetting(db, 'usb_ignored', JSON.stringify(list));

/** Copie une sauvegarde sur la clé (dossier BCD-sauvegardes, 10 gardées). */
export function copyToKey(db, drive) {
  const dir = path.join(drive.root, USB_FOLDER);
  fs.mkdirSync(dir, { recursive: true });
  const file = autoBackup(db, dir, { keep: 10, prefix: 'bcd-auto' });
  const now = new Date().toISOString();
  // Compte aussi pour le rappel « pas de copie depuis 7 jours ».
  setSetting(db, 'extra_backup_last', now);
  const keys = knownKeys(db);
  const k = keys.find((x) => x.serial === drive.serial);
  if (k) {
    k.last = now;
    if (drive.label) k.label = drive.label;
    saveKeys(db, keys);
  }
  return file;
}

/**
 * Surveillance des clés. `listDrives` est appelée toutes les `intervalMs` ;
 * une clé n'est traitée qu'à son arrivée (pas à chaque passage).
 */
export function createUsbWatcher(db, { listDrives, intervalMs = 3000, onError = console.error } = {}) {
  let present = new Map(); // numéro de série → lecteur
  let pending = null; // clé inconnue en attente de réponse
  let events = []; // dernières copies (pour les messages à l'écran)
  let nextId = 1;
  let timer = null;
  let busy = false;

  const label = (d) => d.label || `clé ${d.letter ?? ''}`.trim();

  function copy(drive, reason) {
    try {
      copyToKey(db, drive);
      events.push({ id: nextId++, type: 'copied', label: label(drive), letter: drive.letter ?? null, reason, at: new Date().toISOString() });
    } catch (e) {
      events.push({ id: nextId++, type: 'error', label: label(drive), letter: drive.letter ?? null, error: e.message, at: new Date().toISOString() });
    }
    events = events.slice(-10);
  }

  async function poll() {
    if (busy || !db.isOpen) return;
    busy = true;
    try {
      const drives = (await listDrives()).filter((d) => d?.serial && d.root);
      const now = new Map(drives.map((d) => [d.serial, d]));
      for (const [serial, d] of now) {
        if (present.has(serial)) continue; // déjà vue
        if (knownKeys(db).some((k) => k.serial === serial)) copy(d, 'branchée');
        else if (!ignoredKeys(db).includes(serial)) pending = { serial, label: d.label || null, letter: d.letter ?? null };
      }
      // Clé retirée avant d'avoir répondu : on ne demande plus.
      if (pending && !now.has(pending.serial)) pending = null;
      present = now;
    } catch (e) {
      onError(e);
    } finally {
      busy = false;
    }
  }

  return {
    poll,
    start() {
      if (!timer) {
        timer = setInterval(poll, intervalMs);
        timer.unref?.();
        poll();
      }
      return this;
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    /** État pour l'écran : clé en attente de réponse et dernières copies. */
    status() {
      return {
        supported: true,
        pending,
        events,
        keys: knownKeys(db).map((k) => ({ ...k, plugged: present.has(k.serial) })),
        ignored: ignoredKeys(db).length,
      };
    },
    /** Réponse de l'administrateur : 'always' (mémoriser et copier), 'once', 'later' ou 'never'. */
    answer(serial, choice) {
      const drive = present.get(serial);
      if (pending?.serial === serial) pending = null;
      if (choice === 'never') {
        saveIgnored(db, [...new Set([...ignoredKeys(db), serial])]);
        return { ok: true };
      }
      if (choice === 'later') return { ok: true };
      if (!drive) return { ok: false, error: 'La clé a été retirée' };
      if (choice === 'always') {
        const keys = knownKeys(db).filter((k) => k.serial !== serial);
        keys.push({ serial, label: drive.label || null, added_at: new Date().toISOString(), last: null });
        saveKeys(db, keys);
      }
      copy(drive, choice === 'always' ? 'mémorisée' : 'une fois');
      const ev = events.at(-1);
      return ev.type === 'copied' ? { ok: true } : { ok: false, error: ev.error };
    },
    forget(serial) {
      saveKeys(db, knownKeys(db).filter((k) => k.serial !== serial));
    },
    resetIgnored() {
      saveIgnored(db, []);
    },
    /** À la fermeture : copie sur les clés mémorisées encore branchées. */
    copyOnQuit() {
      const serials = new Set(knownKeys(db).map((k) => k.serial));
      for (const d of present.values()) if (serials.has(d.serial)) copy(d, 'fermeture');
    },
  };
}

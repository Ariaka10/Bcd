/**
 * Application de bureau (Windows) : démarre le serveur BCD en interne, uniquement accessible
 * depuis cet ordinateur, et l'affiche dans une fenêtre. Aucune installation de Node.js nécessaire.
 */
import { app, BrowserWindow, Menu, shell, net, dialog } from 'electron';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { autoBackup, backupFileName, copyToExtraDir, startPeriodicBackups } from '../server/backup.js';
import { setFetch } from '../server/notice.js';
import { DatabaseSync } from 'node:sqlite';
import { checkForUpdate, updateInfo, installUpdate } from './updater.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_TEST = process.env.BCD_SMOKE_TEST; // chemin d'un fichier de résultat : test automatique

let db;
let server;
let win;
let dataDir;
let backupDir;
let backedUpOnQuit = false;

if (!app.requestSingleInstanceLock()) {
  // Déjà ouverte : on remet simplement la fenêtre existante au premier plan.
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start).catch(fatal);
}

function fatal(err) {
  console.error(err);
  if (SMOKE_TEST) fs.writeFileSync(SMOKE_TEST, 'ECHEC ' + (err?.stack ?? err));
  else dialog.showErrorBox('BCD — erreur au démarrage', String(err?.message ?? err));
  app.exit(1);
}

function hasData() {
  return db.prepare('SELECT (SELECT COUNT(*) FROM documents) + (SELECT COUNT(*) FROM users) AS n').get().n > 0;
}

function backup(reason) {
  try {
    if (db && hasData()) autoBackup(db, backupDir, { keep: 15 });
  } catch (e) {
    console.error(`Sauvegarde (${reason}) impossible :`, e);
  }
}

async function start() {
  dataDir = process.env.BCD_DATA_DIR ?? path.join(app.getPath('documents'), 'BCD');
  backupDir = path.join(dataDir, 'Sauvegardes');
  fs.mkdirSync(backupDir, { recursive: true });
  const dbFile = path.join(dataDir, 'bcd.sqlite');
  backupBeforeUpgrade(dbFile);
  db = openDb(dbFile);
  // Personne n'est connecté à l'ouverture : chacun choisit sa carte (fermeture brutale, coupure de courant…).
  logoutEveryone();

  setFetch((url, opts) => net.fetch(url, opts));
  server = http.createServer(createApp(db, {
    backupDir,
    autoCovers: true,
    appInfo: updateInfo,
    installUpdate,
    checkUpdate: checkForUpdate,
    chooseFolder: async () => {
      const r = await dialog.showOpenDialog(win, {
        title: 'Choisir le dossier de sauvegarde (clé USB…)',
        properties: ['openDirectory', 'createDirectory'],
      });
      return r.canceled ? null : r.filePaths[0];
    },
  }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve); // 127.0.0.1 : inaccessible depuis le réseau
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  buildMenu();
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'BCD',
    icon: path.join(here, '..', 'build', 'icon.png'),
    backgroundColor: '#f6f4ef',
    autoHideMenuBar: true,
    show: !SMOKE_TEST,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.maximize();

  // Liens externes (notice BnF…) : navigateur habituel ; la fenêtre reste sur l'application.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:/.test(url)) shell.openExternal(url);
    }
  });
  win.on('closed', () => { win = null; });

  // Le tout premier chargement peut échouer si l'ordinateur est encore occupé au démarrage : on réessaie.
  for (let attempt = 1; ; attempt++) {
    try {
      await win.loadURL(origin + '/');
      break;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 700 * attempt));
    }
  }
  if (SMOKE_TEST) return smokeTest(origin);

  // Sauvegarde toutes les 30 minutes pendant l'utilisation (s'il y a eu des changements).
  startPeriodicBackups(db, backupDir, { minutes: Number(process.env.BCD_BACKUP_MINUTES) || 30 });

  // Nouvelle version ? Vérification au démarrage puis une fois par jour.
  setTimeout(checkForUpdate, 5000);
  setInterval(checkForUpdate, 24 * 3600 * 1000);
}

/**
 * Premier lancement d'une nouvelle version : copie de sécurité de la base avant sa mise à niveau.
 * (VACUUM INTO inclut aussi les dernières modifications pas encore écrites dans le fichier principal.)
 */
function backupBeforeUpgrade(dbFile) {
  const versionFile = path.join(dataDir, 'version.txt');
  const previous = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null;
  if (fs.existsSync(dbFile) && previous !== app.getVersion()) {
    const raw = new DatabaseSync(dbFile);
    try {
      raw.prepare('VACUUM INTO ?').run(path.join(backupDir, backupFileName(`bcd-avant-version-${app.getVersion()}`)));
    } finally {
      raw.close();
    }
  }
  fs.writeFileSync(versionFile, app.getVersion());
}

async function smokeTest(origin) {
  const info = await (await net.fetch(origin + '/api/public/info')).json();
  const title = await win.webContents.executeJavaScript('document.querySelector("h1")?.textContent ?? ""');
  fs.writeFileSync(SMOKE_TEST, `OK needs_setup=${info.needs_setup} h1=${title} data=${dataDir}`);
  app.quit();
}

function buildMenu() {
  const template = [
    {
      label: 'Fichier',
      submenu: [
        { label: 'Ouvrir le dossier des données', click: () => shell.openPath(dataDir) },
        { label: 'Ouvrir le dossier des sauvegardes', click: () => shell.openPath(backupDir) },
        { type: 'separator' },
        { label: 'Imprimer…', accelerator: 'CmdOrCtrl+P', click: () => win?.webContents.executeJavaScript('window.bcdPrint && window.bcdPrint()') },
        { type: 'separator' },
        { label: 'Quitter', role: 'quit' },
      ],
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Actualiser', role: 'reload' },
        { type: 'separator' },
        { label: 'Zoom avant', role: 'zoomIn', accelerator: 'CmdOrCtrl+=' },
        { label: 'Zoom arrière', role: 'zoomOut' },
        { label: 'Taille normale', role: 'resetZoom' },
        { type: 'separator' },
        { label: 'Plein écran', role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Aide',
      submenu: [
        {
          label: 'À propos de BCD',
          click: () => dialog.showMessageBox(win, {
            title: 'À propos',
            message: `BCD — version ${app.getVersion()}`,
            detail: `Gestion de la bibliothèque de l'école.\n\nDonnées : ${dataDir}`,
          }),
        },
        { label: 'Outils de développement', role: 'toggleDevTools', accelerator: 'F12' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('window-all-closed', () => app.quit());

/** Déconnecte tous les profils (les sessions ne survivent pas à la fermeture de l'application). */
function logoutEveryone() {
  try {
    db.exec('DELETE FROM sessions');
  } catch (e) {
    console.error('Déconnexion impossible :', e);
  }
}

app.on('before-quit', () => {
  if (backedUpOnQuit || !db) return;
  backedUpOnQuit = true;
  logoutEveryone();
  backup('fermeture');
  // Copie sur la clé USB (ou autre dossier choisi), si elle est branchée.
  try {
    const dir = db.prepare(`SELECT value FROM settings WHERE key = 'extra_backup_dir'`).get()?.value;
    if (dir && hasData()) copyToExtraDir(db, dir);
  } catch (e) {
    console.error('Copie sur la clé impossible :', e);
  }
  server?.close();
  db.close();
});

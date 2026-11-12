import { api } from './api.js';
import { $, esc, toast, printPreview } from './ui.js';
import { initTables } from './tables.js';
import { runUpdate } from './update.js';

// Tous les boutons « Imprimer » (et Ctrl+P) ouvrent d'abord l'aperçu avant impression.
window.bcdPrint = () => printPreview();
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    if (!document.querySelector('dialog.modal-print[open]')) printPreview();
  }
});
import { state } from './state.js';
import * as login from './pages/login.js';
import * as home from './pages/home.js';
import * as catalogue from './pages/catalogue.js';
import * as documentPage from './pages/document.js';
import * as circulation from './pages/circulation.js';
import * as users from './pages/users.js';
import * as lists from './pages/lists.js';
import * as weeding from './pages/weeding.js';
import * as settings from './pages/settings.js';
import * as rentree from './pages/rentree.js';
import * as eleve from './pages/eleve.js';


const NAV = {
  admin: [
    ['#/', '🏠', 'Accueil'], ['#/catalogue', '🔎', 'Catalogue'], ['#/document/nouveau', '➕', 'Ajouter'],
    ['#/prets', '📚', 'Prêts'], ['#/usagers', '👧', 'Usagers'], ['#/listes', '📋', 'Listes'],
    ['#/parametres', '⚙️', 'Paramètres'],
  ],
  enseignant: [
    ['#/', '🏠', 'Accueil'], ['#/catalogue', '🔎', 'Catalogue'], ['#/document/nouveau', '➕', 'Ajouter'],
    ['#/prets', '📚', 'Prêts'], ['#/usagers', '👧', 'Ma classe'], ['#/listes', '📋', 'Listes'],
  ],
  eleve: [['#/', '🔎', 'Chercher un livre'], ['#/mes-prets', '📚', 'Mes livres']],
  // Compte « Ajout de livres » (bénévole, service civique, stagiaire) : catalogue seulement
  catalogueur: [
    ['#/', '🏠', 'Accueil'], ['#/document/nouveau', '➕', 'Ajouter'], ['#/inventaire', '📚', 'Tous les livres'],
    ['#/catalogue', '🔎', 'Catalogue'],
  ],
};

// [motif, module, rôles autorisés]
const ROUTES = [
  [/^\/connexion$/, login, null],
  [/^\/$/, null, ['admin', 'enseignant', 'eleve', 'catalogueur']],
  [/^\/catalogue$/, catalogue, ['admin', 'enseignant', 'catalogueur']],
  [/^\/inventaire$/, catalogue, ['admin', 'enseignant', 'catalogueur']],
  [/^\/themes$/, catalogue, ['admin', 'enseignant']],
  [/^\/import-livres$/, catalogue, ['admin']],
  [/^\/document\/nouveau$/, documentPage, ['admin', 'enseignant', 'catalogueur']],
  [/^\/document\/(\d+)$/, documentPage, ['admin', 'enseignant', 'eleve', 'catalogueur']],
  [/^\/document\/(\d+)\/modifier$/, documentPage, ['admin', 'enseignant', 'catalogueur']],
  [/^\/prets$/, circulation, ['admin', 'enseignant']],
  [/^\/retards$/, circulation, ['admin', 'enseignant']],
  [/^\/usagers$/, users, ['admin', 'enseignant']],
  [/^\/usager\/(\d+)$/, users, ['admin', 'enseignant']],
  [/^\/import$/, users, ['admin']],
  [/^\/classes$/, users, ['admin']],
  [/^\/cartes$/, users, ['admin', 'enseignant']],
  [/^\/listes$/, lists, ['admin', 'enseignant']],
  [/^\/liste\/(\d+)$/, lists, ['admin', 'enseignant']],
  [/^\/etiquettes$/, lists, ['admin', 'enseignant', 'catalogueur']],
  [/^\/desherbage$/, weeding, ['admin']],
  [/^\/parametres$/, settings, ['admin']],
  [/^\/rentree$/, rentree, ['admin']],
  [/^\/classe\/(\d+)$/, users, ['admin', 'enseignant']],
  [/^\/mon-compte$/, settings, ['admin', 'enseignant', 'eleve', 'catalogueur']],
  [/^\/mes-prets$/, eleve, ['eleve']],
];

export async function refreshUser() {
  state.user = (await api.get('/me')).user;
  renderNav();
}

function renderNav() {
  const nav = $('#nav');
  const u = state.user;
  document.body.dataset.role = u?.role ?? 'anon';
  $('#school-name').textContent = state.info?.school_name ?? 'BCD';
  if (!u) { nav.innerHTML = ''; $('#user-box').innerHTML = ''; return; }
  let current = '#' + (location.hash.slice(1).split('?')[0] || '/');
  if (['#/inventaire', '#/themes', '#/desherbage', '#/import-livres'].includes(current)) current = '#/catalogue';
  nav.innerHTML = NAV[u.role].map(([href, icon, label]) =>
    `<a href="${href}" class="${current === href ? 'active' : ''}"><span class="nav-icon">${icon}</span><span>${label}</span></a>`).join('');
  $('#user-box').innerHTML = `<a href="#/mon-compte" class="user-chip" title="Mon compte">
      <span class="avatar-sm">${esc(u.avatar ?? '🙂')}</span><span class="user-name">${esc(u.first_name)}</span></a>
    <button class="btn btn-ghost btn-sm" id="logout">Quitter</button>`;
  $('#logout').onclick = async () => {
    await api.post('/logout');
    state.user = null;
    state.settings = null;
    state.rentreeShown = false;
    $('#toasts').innerHTML = '';
    location.hash = '#/connexion';
  };
}

export function parseHash() {
  const raw = location.hash.slice(1) || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(query)) };
}

let renderId = 0;
async function route() {
  const id = ++renderId;
  const { path, query } = parseHash();
  const app = $('#app');
  for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();

  if (state.info?.needs_setup) {
    renderNav();
    return login.renderSetup(app);
  }
  const found = ROUTES.find(([re]) => re.test(path));
  if (!found) { location.hash = '#/'; return; }
  const [re, mod, roles] = found;
  if (roles && !state.user) { location.hash = '#/connexion'; return; }
  if (roles && !roles.includes(state.user.role)) { location.hash = '#/'; return; }
  if (!roles && state.user && mod === login) { location.hash = '#/'; return; }

  renderNav();
  checkUpdate();
  // Première ouverture de l'année scolaire : l'administrateur est conduit une fois vers l'assistant de rentrée.
  if (path === '/' && state.user.role === 'admin' && !state.rentreeShown) {
    state.rentreeShown = true;
    const rem = await api.get('/admin/reminders').catch(() => ({}));
    if (rem.rentree) { location.hash = '#/rentree'; return; }
  }
  const params = path.match(re).slice(1);
  let page = mod;
  if (path === '/') page = state.user.role === 'eleve' ? eleve : home;
  // Chaque page s'affiche dans son propre cadre : si l'on change de page pendant un chargement,
  // l'ancien cadre est retiré et la page en retard ne peut plus recouvrir la nouvelle.
  const view = document.createElement('div');
  view.innerHTML = '<div class="loading">Chargement…</div>';
  app.replaceChildren(view);
  try {
    await page.render(view, { path, params, query, isCurrent: () => id === renderId });
    if (id === renderId) window.scrollTo(0, 0);
    // Enseignant·e sans mot de passe : proposition (une fois) une fois la page affichée.
    if (id === renderId && state.user?.ask_password) login.offerPassword();
  } catch (e) {
    if (id !== renderId) return; // page abandonnée : erreur sans importance
    console.error(e);
    view.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
  }
}

/** Bandeau « nouvelle version disponible » (application Windows, administrateur). */
async function checkUpdate() {
  if (state.user?.role !== 'admin' || document.getElementById('update-banner')) return;
  let info;
  try { info = await api.get('/app/info'); } catch { return; }
  const u = info.update;
  if (!info.desktop || !u?.version) return;
  const bar = document.createElement('div');
  bar.id = 'update-banner';
  bar.className = 'update-banner no-print';
  bar.innerHTML = `🎉 Nouvelle version <b>${esc(u.version)}</b> disponible (vous avez la ${esc(info.version)}).
    ${u.can_install ? `<button class="btn btn-sm btn-primary" id="upd-install">Installer et redémarrer${u.download_size
      ? ` (${(u.download_size / 1024 / 1024).toFixed(u.download_size < 10485760 ? 1 : 0).replace('.', ',')} Mo)` : ''}</button>` : ''}
    <a class="btn btn-sm" href="${esc(u.url)}" target="_blank" rel="noopener">Télécharger depuis GitHub</a>
    <button class="icon-btn" id="upd-close" aria-label="Fermer">✕</button>`;
  document.querySelector('.topbar').after(bar);
  bar.querySelector('#upd-close').onclick = () => bar.remove();
  const inst = bar.querySelector('#upd-install');
  if (inst) inst.onclick = () => runUpdate(u);
}

async function start() {
  try {
    [state.info, state.meta] = await Promise.all([api.get('/public/info'), api.get('/meta')]);
    document.title = `${state.info.school_name} — BCD`;
    if (!state.info.needs_setup) state.user = (await api.get('/me')).user;
  } catch (e) {
    toast('Serveur injoignable', 'error');
  }
  window.addEventListener('hashchange', route);
  route();
}

start();

// Tri et recherche dans tous les tableaux.
initTables();

// Bouton « Contraste » (en bas à gauche) : réglage propre à cet ordinateur, gardé d'une ouverture à l'autre.
(function contrastToggle() {
  const btn = document.getElementById('contrast-toggle');
  const apply = (on) => {
    document.documentElement.classList.toggle('high-contrast', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  let on = false;
  try { on = localStorage.getItem('bcd-contrast') === '1'; } catch { /* stockage indisponible */ }
  apply(on);
  btn.onclick = () => {
    on = !on;
    apply(on);
    try { localStorage.setItem('bcd-contrast', on ? '1' : ''); } catch { /* stockage indisponible */ }
    toast(on ? 'Contraste élevé activé' : 'Contraste normal');
  };
})();

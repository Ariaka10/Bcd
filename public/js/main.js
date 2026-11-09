import { api } from './api.js';
import { $, esc, toast } from './ui.js';
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
import * as eleve from './pages/eleve.js';


const NAV = {
  admin: [
    ['#/', '🏠', 'Accueil'], ['#/catalogue', '🔎', 'Catalogue'], ['#/document/nouveau', '➕', 'Ajouter'],
    ['#/prets', '📚', 'Prêts'], ['#/usagers', '👧', 'Usagers'], ['#/listes', '📋', 'Listes'],
    ['#/desherbage', '🌿', 'Désherbage'], ['#/parametres', '⚙️', 'Paramètres'],
  ],
  enseignant: [
    ['#/', '🏠', 'Accueil'], ['#/catalogue', '🔎', 'Catalogue'], ['#/document/nouveau', '➕', 'Ajouter'],
    ['#/prets', '📚', 'Prêts'], ['#/usagers', '👧', 'Ma classe'], ['#/listes', '📋', 'Listes'],
  ],
  eleve: [['#/', '🔎', 'Chercher un livre'], ['#/mes-prets', '📚', 'Mes livres']],
};

// [motif, module, rôles autorisés]
const ROUTES = [
  [/^\/connexion$/, login, null],
  [/^\/$/, null, ['admin', 'enseignant', 'eleve']],
  [/^\/catalogue$/, catalogue, ['admin', 'enseignant']],
  [/^\/document\/nouveau$/, documentPage, ['admin', 'enseignant']],
  [/^\/document\/(\d+)$/, documentPage, ['admin', 'enseignant', 'eleve']],
  [/^\/document\/(\d+)\/modifier$/, documentPage, ['admin', 'enseignant']],
  [/^\/prets$/, circulation, ['admin', 'enseignant']],
  [/^\/retards$/, circulation, ['admin', 'enseignant']],
  [/^\/usagers$/, users, ['admin', 'enseignant']],
  [/^\/usager\/(\d+)$/, users, ['admin', 'enseignant']],
  [/^\/import$/, users, ['admin']],
  [/^\/classes$/, users, ['admin']],
  [/^\/cartes$/, users, ['admin', 'enseignant']],
  [/^\/listes$/, lists, ['admin', 'enseignant']],
  [/^\/liste\/(\d+)$/, lists, ['admin', 'enseignant']],
  [/^\/etiquettes$/, lists, ['admin', 'enseignant']],
  [/^\/desherbage$/, weeding, ['admin']],
  [/^\/parametres$/, settings, ['admin']],
  [/^\/mon-compte$/, settings, ['admin', 'enseignant', 'eleve']],
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
  const current = '#' + (location.hash.slice(1).split('?')[0] || '/');
  nav.innerHTML = NAV[u.role].map(([href, icon, label]) =>
    `<a href="${href}" class="${current === href ? 'active' : ''}"><span class="nav-icon">${icon}</span><span>${label}</span></a>`).join('');
  $('#user-box').innerHTML = `<a href="#/mon-compte" class="user-chip" title="Mon compte">
      <span class="avatar-sm">${esc(u.avatar ?? '🙂')}</span><span class="user-name">${esc(u.first_name)}</span></a>
    <button class="btn btn-ghost btn-sm" id="logout">Quitter</button>`;
  $('#logout').onclick = async () => {
    await api.post('/logout');
    state.user = null;
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
  const params = path.match(re).slice(1);
  let page = mod;
  if (path === '/') page = state.user.role === 'eleve' ? eleve : home;
  app.innerHTML = '<div class="loading">Chargement…</div>';
  try {
    await page.render(app, { path, params, query, isCurrent: () => id === renderId });
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    if (id === renderId) app.innerHTML = `<div class="empty">⚠️ ${esc(e.message)}</div>`;
  }
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

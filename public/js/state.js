/** État partagé de l'application (utilisateur connecté, infos de l'école, listes de référence). */
import { api } from './api.js';
import { esc } from './ui.js';

export const state = { user: null, info: null, meta: null, themes: null };

/*
 * Page précédente : pour quitter un formulaire sans le laisser dans l'historique
 * (sinon « Retour » depuis la fiche ramènerait au formulaire de modification).
 */
let currentHash = location.hash;
let previousHash = null;
window.addEventListener('hashchange', () => {
  if (location.hash !== currentHash) { previousHash = currentHash; currentHash = location.hash; }
});

/** Quitte la page en cours vers `hash` : retour arrière si l'on vient de là, sinon remplacement dans l'historique. */
export function leaveTo(hash) {
  if (location.hash === hash) navigate(hash);
  else if (previousHash === hash) history.back();
  else location.replace(hash);
}

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new Event('hashchange'));
  else location.hash = hash;
}

/** Compte « Ajout de livres » : pas d'accès aux élèves, aux prêts ni aux listes. */
export const isCataloguer = () => state.user?.role === 'catalogueur';
export const isAdmin = () => state.user?.role === 'admin';
export const typeLabel = (t) => state.meta?.doc_types?.[t]?.label ?? t ?? '';

/** Thèmes (mis en cache ; `force` après une modification). */
export async function loadThemes(force = false) {
  if (!state.themes || force) state.themes = await api.get('/themes');
  return state.themes;
}

/** Pastilles de thèmes à partir d'une liste d'identifiants (« 1,4 ») ou d'objets thème. */
export function themeChips(themes) {
  const list = typeof themes === 'string' || themes == null
    ? String(themes ?? '').split(',').filter(Boolean).map((id) => state.themes?.find((t) => String(t.id) === id)).filter(Boolean)
    : themes;
  return list.map((t) => `<span class="chip" style="${t.color ? `--chip:${t.color}` : ''}">${esc(t.emoji ?? '')} ${esc(t.name)}</span>`).join(' ');
}

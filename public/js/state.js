/** État partagé de l'application (utilisateur connecté, infos de l'école, listes de référence). */
import { api } from './api.js';
import { esc } from './ui.js';

export const state = { user: null, info: null, meta: null, themes: null };

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new Event('hashchange'));
  else location.hash = hash;
}

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

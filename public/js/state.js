/** État partagé de l'application (utilisateur connecté, infos de l'école, listes de référence). */
export const state = { user: null, info: null, meta: null };

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new Event('hashchange'));
  else location.hash = hash;
}

export const isAdmin = () => state.user?.role === 'admin';
export const typeLabel = (t) => state.meta?.doc_types?.[t]?.label ?? t ?? '';

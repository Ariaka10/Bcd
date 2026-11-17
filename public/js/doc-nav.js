/**
 * Navigation « ◀ 3/616 ▶ » sur la fiche d'un livre, dans les résultats de la dernière recherche
 * (Catalogue ou Tous les livres). Les flèches du clavier marchent aussi.
 * Passer d'un livre à l'autre ne s'ajoute pas à l'historique : « ← Retour » ramène toujours à la liste.
 */
import { api, qs } from './api.js';
import { esc } from './ui.js';

const KEY = 'bcd-nav';

/** À appeler par une page de résultats : mémorise la recherche affichée. */
export function rememberResults(query, label) {
  const { page, limit, ...q } = query;
  try { sessionStorage.setItem(KEY, JSON.stringify({ query: q, label })); } catch { /* stockage indisponible */ }
}

let keyHandler = null;

/** Barre de navigation pour ce livre (vide s'il ne vient pas d'une liste de résultats). */
export async function navBar(docId) {
  if (keyHandler) document.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  let nav;
  try { nav = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { nav = null; }
  if (!nav) return '';
  let ids;
  try { ({ ids } = await api.get('/documents/ids' + qs(nav.query))); } catch { return ''; }
  const i = ids.indexOf(Number(docId));
  if (i < 0) return '';
  const prev = ids[i - 1];
  const next = ids[i + 1];
  const go = (id) => location.replace(`#/document/${id}`);
  keyHandler = (e) => {
    if (!location.hash.startsWith(`#/document/${docId}`) || location.hash.endsWith('/modifier')) {
      document.removeEventListener('keydown', keyHandler);
      return;
    }
    if (e.target.closest('input, textarea, select, [contenteditable], dialog') || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'ArrowLeft' && prev) go(prev);
    if (e.key === 'ArrowRight' && next) go(next);
  };
  document.addEventListener('keydown', keyHandler);
  setTimeout(() => {
    for (const b of document.querySelectorAll('.doc-nav [data-go]')) b.onclick = () => go(b.dataset.go);
  });
  return `<div class="doc-nav no-print" title="${esc(nav.label)} — flèches ← → du clavier">
    <button class="btn btn-sm" ${prev ? `data-go="${prev}"` : 'disabled'} aria-label="Livre précédent">◀</button>
    <span><b>${i + 1}</b> / ${ids.length}</span>
    <button class="btn btn-sm" ${next ? `data-go="${next}"` : 'disabled'} aria-label="Livre suivant">▶</button></div>`;
}

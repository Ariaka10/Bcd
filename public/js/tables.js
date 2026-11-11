/**
 * Tous les tableaux de l'application, sans rien changer aux pages :
 * - tri en cliquant sur l'en-tête d'une colonne (▲ croissant, ▼ décroissant, un clic pour inverser) ;
 * - champ « Chercher dans ce tableau » au-dessus des tableaux d'une certaine taille (Ctrl+F pour y aller).
 *
 * Tableaux laissés tels quels : cellules fusionnées (fiche classe…) et tableaux marqués `data-no-tools`.
 * Lignes marquées `data-pin` (élèves partis avec un livre…) : toujours en tête, quel que soit le tri.
 */

const MIN_ROWS_FOR_SEARCH = 6;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Valeur de tri d'une cellule : date (jj/mm/aaaa), nombre, ou texte. */
function sortValue(td) {
  if (!td) return null;
  const raw = (td.dataset.sort ?? td.textContent).replace(/\s+/g, ' ').trim();
  if (!raw) return null;
  const date = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (date) return { n: Number(date[3] + date[2] + date[1]) };
  const num = raw.match(/^[+-]?\d+(?:[.,]\d+)?/);
  if (num && /^[+-]?\d+(?:[.,]\d+)?(?:\s*(?:j|jours?|mo|ko|%|\/\s*\d+|📖))?$/i.test(raw)) return { n: Number(num[0].replace(',', '.')) };
  // Le texte se trie sans l'avatar ou l'icône du début (« 🦊 Léa » → « Léa »).
  return { t: raw.replace(/^[^\p{L}\p{N}]+/u, '') || raw };
}

function compare(a, b) {
  if (a === null || b === null) return 0; // les cases vides sont gérées à part
  if ('n' in a && 'n' in b) return a.n - b.n;
  const ta = 't' in a ? a.t : String(a.n);
  const tb = 't' in b ? b.t : String(b.n);
  return ta.localeCompare(tb, 'fr', { numeric: true, sensitivity: 'base' });
}

/** Le tableau a-t-il des cellules fusionnées (le trier casserait sa mise en page) ? */
function hasMergedCells(table) {
  return [...table.tBodies].some((tb) => [...tb.rows].some((tr) => tr.cells.length > 1
    && [...tr.cells].some((td) => td.rowSpan > 1 || td.colSpan > 1)));
}

const dataRows = (tbody) => [...tbody.rows].filter((tr) => !(tr.cells.length === 1 && tr.cells[0].colSpan > 1));

function makeSortable(table) {
  const head = table.tHead?.rows[0];
  const tbody = table.tBodies[0];
  if (!head || !tbody) return;
  [...head.cells].forEach((th, col) => {
    if (!th.textContent.trim() || th.querySelector('input, select, button')) return;
    th.classList.add('sortable');
    th.tabIndex = 0;
    th.title = 'Cliquer pour trier';
    th.insertAdjacentHTML('beforeend', '<span class="sort-arrows no-print" aria-hidden="true"><i>▲</i><i>▼</i></span>');
    const run = () => {
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      for (const other of head.cells) delete other.dataset.dir;
      th.dataset.dir = dir;
      th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      const rows = dataRows(tbody);
      const keyed = rows.map((tr, i) => ({ tr, i, v: sortValue(tr.cells[col]), pin: tr.hasAttribute('data-pin') }));
      keyed.sort((a, b) => {
        if (a.pin !== b.pin) return a.pin ? -1 : 1;
        if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1; // vides à la fin
        return (dir === 'asc' ? compare(a.v, b.v) : compare(b.v, a.v)) || a.i - b.i;
      });
      for (const k of keyed) tbody.append(k.tr);
    };
    th.addEventListener('click', run);
    th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } });
  });
}

function addSearch(table) {
  const tbody = table.tBodies[0];
  if (!tbody || dataRows(tbody).length < MIN_ROWS_FOR_SEARCH) return;
  // Pas de recherche sur les tableaux à cases à cocher « tout sélectionner » : une ligne cachée resterait cochée.
  if (table.tHead?.querySelector('input[type=checkbox]')) return;
  const anchor = table.closest('.table-wrap') ?? table;
  const box = document.createElement('div');
  box.className = 'table-search no-print';
  box.innerHTML = `<input type="search" class="table-filter" placeholder="🔎 Chercher dans ce tableau…" aria-label="Chercher dans ce tableau">
    <span class="muted small" data-count></span>`;
  anchor.before(box);
  const input = box.querySelector('input');
  const count = box.querySelector('[data-count]');
  input.addEventListener('input', () => {
    const words = norm(input.value).split(' ').filter(Boolean);
    const rows = dataRows(tbody);
    let shown = 0;
    for (const tr of rows) {
      const text = tr.dataset.searchText ?? (tr.dataset.searchText = norm(tr.textContent));
      const ok = words.every((w) => text.includes(w));
      tr.hidden = !ok;
      if (ok) shown++;
    }
    count.textContent = words.length ? `${shown} / ${rows.length}` : '';
    let empty = tbody.querySelector('tr.table-search-empty');
    if (words.length && !shown) {
      if (!empty) {
        empty = document.createElement('tr');
        empty.className = 'table-search-empty';
        empty.innerHTML = `<td colspan="${table.tHead?.rows[0]?.cells.length ?? 1}" class="muted">Rien ne correspond à « ${input.value.replace(/[<>&"]/g, '')} ».</td>`;
        tbody.append(empty);
      }
    } else empty?.remove();
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); } });
}

export function enhanceTables(root = document) {
  for (const table of root.querySelectorAll('table:not([data-tools])')) {
    table.dataset.tools = '1';
    if (table.hasAttribute('data-no-tools') || table.closest('[data-no-tools], .print-sheet') || hasMergedCells(table)) continue;
    makeSortable(table);
    addSearch(table);
  }
}

/** Surveille la page : chaque tableau affiché reçoit le tri et la recherche. */
export function initTables() {
  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; enhanceTables(); });
  }).observe(document.body, { childList: true, subtree: true });
  enhanceTables();

  // Ctrl+F : aller au champ de recherche de la page (tableau, ou recherche du catalogue).
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f') return;
    const target = [...document.querySelectorAll('dialog[open] .table-filter, #app .table-filter, #app input[type=search], #app input[name=q]')]
      .find((el) => el.offsetParent !== null);
    if (!target) return;
    e.preventDefault();
    target.focus();
    target.select();
  });
}

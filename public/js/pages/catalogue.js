/** Catalogue : recherche, « Tous les livres » (inventaire complet) et gestion des thèmes. */
import { api, qs } from '../api.js';
import { esc, cover, toast, modal, confirmBox, formData, plural, readTextFile, $, $$ } from '../ui.js';
import { state, navigate, isAdmin, typeLabel, loadThemes, themeChips } from '../state.js';

const selected = new Set();
const ADV_FIELDS = ['title', 'author', 'subject', 'keyword', 'theme_id', 'series', 'publisher', 'isbn', 'cote', 'doc_type',
  'year_from', 'year_to', 'available', 'audience', 'location', 'added_from'];
const STATES = { ok: 'Bon état', abime: 'Abîmé', perdu: 'Perdu', reparation: 'En réparation' };

export async function render(app, { path, query }) {
  await loadThemes();
  if (path === '/themes') return renderThemes(app);
  if (path === '/inventaire') return renderInventory(app, query);
  if (path === '/import-livres') return renderImport(app);
  return renderSearch(app, query);
}

export function tabs(active) {
  return `<div class="tabs no-print">
    <a href="#/catalogue" class="${active === 'search' ? 'active' : ''}">🔎 Recherche</a>
    <a href="#/inventaire" class="${active === 'all' ? 'active' : ''}">📚 Tous les livres</a>
    <a href="#/themes" class="${active === 'themes' ? 'active' : ''}">🏷️ Thèmes</a>
    ${isAdmin() ? `<a href="#/desherbage" class="${active === 'weeding' ? 'active' : ''}">🌿 Désherbage</a>
      <a href="#/import-livres" class="${active === 'import' ? 'active' : ''}">📥 Importer</a>` : ''}</div>`;
}

const themeOptions = (current) => `<option value="">Tous</option>
  ${state.themes.map((t) => `<option value="${t.id}" ${String(current) === String(t.id) ? 'selected' : ''}>${esc(t.emoji ?? '')} ${esc(t.name)}</option>`).join('')}`;

/* ---------- Recherche ---------- */

async function renderSearch(app, query) {
  const q = { sort: '', ...query };
  const hasAdv = ADV_FIELDS.some((f) => q[f]);
  const types = Object.entries(state.meta.doc_types);
  const res = await api.get('/documents' + qs({ ...q, limit: 30 }));
  const pages = Math.ceil(res.total / res.limit);

  app.innerHTML = `
    <div class="page-head"><div><h1>Catalogue</h1><p class="muted">${plural(res.total, 'document')}</p></div>
      <div class="row no-print">
        <button class="btn" id="list-from-search">📋 Créer une liste avec ces résultats</button>
        <a class="btn btn-primary" href="#/document/nouveau">➕ Ajouter un document</a></div></div>
    ${tabs('search')}
    ${state.themes.length ? `<div class="theme-bar no-print">${state.themes.map((t) => `<a class="chip chip-lg ${String(q.theme_id) === String(t.id) ? 'active' : ''}"
      style="${t.color ? `--chip:${t.color}` : ''}" href="#/catalogue${qs(String(q.theme_id) === String(t.id) ? {} : { theme_id: t.id })}">
      ${esc(t.emoji ?? '')} ${esc(t.name)} <span class="muted">${t.count}</span></a>`).join('')}</div>` : ''}

    <form class="card no-print" id="search">
      <div class="searchbar"><input name="q" value="${esc(q.q)}" placeholder="Titre, auteur, mot-clé, sujet, collection, ISBN, cote…" autofocus>
        <button class="btn btn-primary">Rechercher</button></div>
      <details class="advanced" ${hasAdv ? 'open' : ''}><summary>Recherche avancée</summary>
        <div class="grid grid-4">
          <label>Titre <input name="title" value="${esc(q.title)}"></label>
          <label>Auteur <input name="author" value="${esc(q.author)}"></label>
          <label>Mot-clé <input name="keyword" value="${esc(q.keyword)}" placeholder="loup, couleurs…"></label>
          <label>Thème <select name="theme_id">${themeOptions(q.theme_id)}</select></label>
          <label>Sujet <input name="subject" value="${esc(q.subject)}"></label>
          <label>Collection / série <input name="series" value="${esc(q.series)}"></label>
          <label>Éditeur <input name="publisher" value="${esc(q.publisher)}"></label>
          <label>ISBN <input name="isbn" value="${esc(q.isbn)}"></label>
          <label>Cote commence par <input name="cote" value="${esc(q.cote)}" placeholder="R, A, 590…"></label>
          <label>Type <select name="doc_type"><option value="">Tous</option>
            ${types.map(([k, t]) => `<option value="${k}" ${q.doc_type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
          <label>Paru après (année) <input name="year_from" type="number" value="${esc(q.year_from)}"></label>
          <label>Paru avant (année) <input name="year_to" type="number" value="${esc(q.year_to)}"></label>
          <label>Public / niveau <input name="audience" value="${esc(q.audience)}" placeholder="dès 3 ans…"></label>
          <label>Emplacement <input name="location" value="${esc(q.location)}"></label>
          <label>Ajouté depuis le <input name="added_from" type="date" value="${esc(q.added_from)}"></label>
          <label>Tri <select name="sort">
            ${[['', 'Pertinence / récents'], ['title', 'Titre'], ['author', 'Auteur'], ['cote', 'Cote'], ['number', 'N° du livre'], ['year', 'Année'], ['recent', 'Derniers ajouts']]
              .map(([v, l]) => `<option value="${v}" ${q.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="available" ${q.available ? 'checked' : ''}> Disponibles seulement</label>
          <div class="row"><button type="button" class="btn btn-ghost" id="reset">Effacer les critères</button></div>
        </div></details>
    </form>

    ${res.items.length ? `<div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th class="no-print"><input type="checkbox" id="check-page" title="Sélectionner la page"></th>
        <th>Document</th><th>Cote</th><th>N°</th><th>Type</th><th class="num">Dispo.</th></tr></thead>
      <tbody>${res.items.map((d) => `<tr>
        <td class="no-print"><input type="checkbox" class="sel" value="${d.id}" ${selected.has(d.id) ? 'checked' : ''}></td>
        <td><a class="doc-cell" href="#/document/${d.id}" style="text-decoration:none;color:inherit">${cover(d)}
          <div><div class="doc-title">${esc(d.title)}${d.series ? ` <span class="muted small">— ${esc(d.series)}${d.series_number ? ' ' + esc(d.series_number) : ''}</span>` : ''}</div>
          <div class="muted small">${esc(d.authors ?? '')}${d.publisher ? ' · ' + esc(d.publisher) : ''}</div>
          <div>${themeChips(d.theme_ids)}</div></div></a></td>
        <td><span class="cote">${esc(d.cote ?? '')}</span></td>
        <td class="small">${esc(d.numbers ?? '')}</td>
        <td class="small">${esc(typeLabel(d.doc_type))}</td>
        <td class="num"><span class="badge ${d.available_count ? 'badge-ok' : 'badge-late'}">${d.available_count}/${d.copies_count}</span></td>
      </tr>`).join('')}</tbody></table></div>
      ${pages > 1 ? `<div class="pager">
        <button class="btn btn-sm" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}>← Précédent</button>
        <span>Page ${res.page} / ${pages}</span>
        <button class="btn btn-sm" data-page="${res.page + 1}" ${res.page >= pages ? 'disabled' : ''}>Suivant →</button></div>` : ''}`
    : `<div class="empty">Aucun document trouvé.${!q.q && !hasAdv ? ' <a href="#/document/nouveau">Ajoutez votre premier livre</a> à partir de son ISBN.' : ''}</div>`}
    <div id="selbar"></div>`;

  const go = (params) => navigate('#/catalogue' + qs(params));
  $('#search').onsubmit = (e) => { e.preventDefault(); go(formData(e.target)); };
  $('#reset').onclick = () => go({ q: $('#search').q.value });
  for (const b of $$('[data-page]')) b.onclick = () => go({ ...q, page: b.dataset.page });
  bindSelection(q, res.total);
  $('#list-from-search').onclick = () => newListDialog({ from_search: { ...q, page: undefined, sort: undefined } }, res.total);
}

/* ---------- Tous les livres (inventaire) ---------- */

async function renderInventory(app, query) {
  const q = { sort: 'number', ...query };
  const types = Object.entries(state.meta.doc_types);
  const res = await api.get('/documents' + qs({ ...q, limit: 5000 }));
  const copies = res.items.reduce((n, d) => n + d.copies_count, 0);
  const available = res.items.reduce((n, d) => n + d.available_count, 0);
  const stateLabel = (s) => [...new Set(String(s ?? '').split(','))].filter((x) => x && x !== 'ok').map((x) => STATES[x]).join(', ');

  app.innerHTML = `
    <div class="page-head"><div><h1>Tous les livres</h1>
      <p class="muted">${plural(res.total, 'titre')} · ${plural(copies, 'exemplaire')} · ${available} en rayon · ${copies - available} sortis ou indisponibles</p></div>
      <div class="row no-print">
        <a class="btn" href="/api/documents/export.csv${qs(q)}" download>⬇️ Exporter (Excel / CSV)</a>
        <button class="btn btn-primary" onclick="window.print()">🖨️ Imprimer</button></div></div>
    ${tabs('all')}
    <form class="row card no-print" id="filters" style="margin-bottom:1rem">
      <select name="theme_id" style="width:auto">${themeOptions(q.theme_id).replace('>Tous<', '>Tous les thèmes<')}</select>
      <select name="doc_type" style="width:auto"><option value="">Tous les types</option>
        ${types.map(([k, t]) => `<option value="${k}" ${q.doc_type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
      <select name="state" style="width:auto"><option value="">Tous les états</option>
        ${Object.entries(STATES).filter(([k]) => k !== 'ok').map(([k, l]) => `<option value="${k}" ${q.state === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" name="no_theme" ${q.no_theme ? 'checked' : ''}> Sans thème</label>
      <select name="sort" style="width:auto">
        ${[['number', 'Trier par N°'], ['title', 'par titre'], ['cote', 'par cote'], ['author', 'par auteur'], ['recent', 'derniers ajouts']]
          .map(([v, l]) => `<option value="${v}" ${q.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    </form>
    <p class="print-only"><b>${esc(state.info.school_name)}</b> — inventaire au ${new Date().toLocaleDateString('fr-FR')} : ${plural(res.total, 'titre')}, ${plural(copies, 'exemplaire')}</p>
    ${res.items.length ? `<div class="table-wrap"><table class="dense">
      <thead><tr><th class="no-print"><input type="checkbox" id="check-page"></th><th>N°</th><th>Titre</th><th>Auteur(s)</th><th>Cote</th>
        <th>Type</th><th>Thèmes</th><th>État</th><th class="num">En rayon</th></tr></thead>
      <tbody>${res.items.map((d) => `<tr>
        <td class="no-print"><input type="checkbox" class="sel" value="${d.id}" ${selected.has(d.id) ? 'checked' : ''}></td>
        <td class="nowrap"><b>${esc(d.numbers ?? '—')}</b></td>
        <td><a href="#/document/${d.id}">${esc(d.title)}</a></td>
        <td class="small">${esc(d.authors ?? '')}</td>
        <td><span class="cote">${esc(d.cote ?? '')}</span></td>
        <td class="small">${esc(typeLabel(d.doc_type))}</td>
        <td>${themeChips(d.theme_ids)}</td>
        <td class="small">${esc(stateLabel(d.states))}</td>
        <td class="num"><span class="badge ${d.available_count ? 'badge-ok' : 'badge-late'}">${d.available_count}/${d.copies_count}</span></td>
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun livre.</div>'}
    <div id="selbar"></div>`;

  const f = $('#filters');
  f.onchange = () => navigate('#/inventaire' + qs(formData(f)));
  bindSelection(q, res.total);
}

/* ---------- Sélection et actions groupées ---------- */

function bindSelection(q, total) {
  const updateBar = () => renderSelectionBar(q, total);
  for (const cb of $$('.sel')) {
    cb.onchange = () => { cb.checked ? selected.add(Number(cb.value)) : selected.delete(Number(cb.value)); updateBar(); };
  }
  const pageBox = $('#check-page');
  if (pageBox) {
    const boxes = $$('.sel');
    pageBox.checked = boxes.length > 0 && boxes.every((cb) => cb.checked);
    pageBox.onchange = () => {
      for (const cb of boxes) { cb.checked = pageBox.checked; pageBox.checked ? selected.add(Number(cb.value)) : selected.delete(Number(cb.value)); }
      updateBar();
    };
  }
  updateBar();
}

function renderSelectionBar(q, total) {
  const bar = $('#selbar');
  if (!selected.size) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = `<div class="selection-bar">
    <b>${plural(selected.size, 'sélectionné')}</b>
    ${total > selected.size ? `<button class="btn btn-sm" id="sel-all">Tout sélectionner (${total})</button>` : ''}
    <button class="btn btn-sm" id="sel-none">Désélectionner</button>
    <span class="grow"></span>
    <button class="btn btn-sm" id="sel-theme">🏷️ Ranger dans un thème</button>
    <button class="btn btn-sm" id="sel-list">📋 Ajouter à une liste</button>
    <button class="btn btn-sm" id="sel-labels">🔖 Étiquettes</button>
    ${isAdmin() ? `<button class="btn btn-sm" id="sel-cote">🔁 Recalculer les cotes</button>
    <button class="btn btn-sm btn-danger" id="sel-delete">🗑️ Supprimer</button>` : ''}</div>`;

  $('#sel-none').onclick = () => { selected.clear(); for (const cb of $$('.sel, #check-page')) cb.checked = false; renderSelectionBar(q, total); };
  const all = $('#sel-all');
  if (all) all.onclick = async () => {
    const r = await api.get('/documents' + qs({ ...q, page: 1, limit: 5000 }));
    for (const d of r.items) selected.add(d.id);
    for (const cb of $$('.sel, #check-page')) cb.checked = true;
    renderSelectionBar(q, total);
  };
  $('#sel-theme').onclick = () => themeDialog([...selected]);
  $('#sel-list').onclick = () => addToListDialog([...selected]);
  $('#sel-labels').onclick = () => { state.labelIds = [...selected]; navigate('#/etiquettes'); };
  if (isAdmin()) {
    $('#sel-cote').onclick = async () => {
      if (!(await confirmBox(`Recalculer automatiquement la cote de ${plural(selected.size, 'document')} ? Les cotes saisies à la main seront remplacées.`))) return;
      const r = await api.post('/documents/recompute-cotes', { ids: [...selected] });
      toast(`${plural(r.updated, 'cote')} recalculée(s)`);
      navigate(location.hash);
    };
    $('#sel-delete').onclick = async () => {
      if (!(await confirmBox(`Supprimer définitivement ${plural(selected.size, 'document')} et tous leurs exemplaires ?`, { ok: 'Supprimer', danger: true }))) return;
      const r = await api.post('/documents/batch-delete', { ids: [...selected] });
      toast(`${plural(r.deleted, 'document supprimé', 'documents supprimés')}${r.skipped.length ? ` · ${r.skipped.length} ignoré(s) car en prêt` : ''}`);
      selected.clear();
      navigate(location.hash);
    };
  }
}

async function themeDialog(ids) {
  const themes = await loadThemes(true);
  if (!themes.length) {
    toast(isAdmin() ? 'Créez d\'abord un thème (onglet Thèmes)' : 'Aucun thème : demandez à l\'administrateur d\'en créer', 'error');
    return;
  }
  const dlg = modal(`Thèmes de ${plural(ids.length, 'document')}`, `<form class="grid" id="f">
    <div class="theme-bar">${themes.map((t) => `<label class="chip chip-lg chip-check" style="${t.color ? `--chip:${t.color}` : ''}">
      <input type="radio" name="theme" value="${t.id}"> ${esc(t.emoji ?? '')} ${esc(t.name)}</label>`).join('')}</div>
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button>
      <button type="button" class="btn" id="remove">➖ Retirer de ce thème</button>
      <button class="btn btn-primary">➕ Ajouter à ce thème</button></div></form>`);
  const send = async (remove) => {
    const id = $('input[name=theme]:checked', dlg)?.value;
    if (!id) return toast('Choisissez un thème', 'error');
    const r = await api.post(`/themes/${id}/documents`, { document_ids: ids, remove });
    dlg.close();
    toast(`${plural(r.changed, 'document')} ${remove ? 'retiré(s)' : 'ajouté(s)'}`);
    await loadThemes(true);
    navigate(location.hash);
  };
  $('#f', dlg).onsubmit = (e) => { e.preventDefault(); send(false); };
  $('#remove', dlg).onclick = () => send(true);
}

/* ---------- Thèmes ---------- */

const EMOJIS = ['🐾', '🐻', '🦁', '🐟', '🦋', '🌳', '🌸', '🍎', '🎄', '🎃', '🐣', '❄️', '☀️', '🌧️', '🚗', '🚀', '🏰', '👑', '🧚', '🐉',
  '🦕', '👶', '👪', '❤️', '😊', '😢', '🎨', '🎵', '🔢', '🔤', '🌍', '🏠', '🏫', '🍽️', '🛁', '😴', '⚽', '📚', '⭐', '🌈'];
const COLORS = ['#e9a23b', '#2f6f5e', '#3b7dd8', '#c2410c', '#9333ea', '#db2777', '#0e9f9a', '#65a30d', '#6b665d'];

async function renderThemes(app) {
  const themes = await loadThemes(true);
  const settings = await api.get('/settings');
  app.innerHTML = `
    <div class="page-head"><div><h1>Thèmes</h1>
      <p class="muted">Classez les livres par thèmes (« Les animaux », « Noël », « Les émotions »…). Les élèves les retrouvent en gros boutons.</p></div>
      ${isAdmin() ? '<button class="btn btn-primary" id="add">➕ Nouveau thème</button>' : ''}</div>
    ${tabs('themes')}
    ${isAdmin() ? `<div class="card" style="margin-bottom:1rem"><label class="check"><input type="checkbox" id="restrict" ${settings.restrict_student_catalog === '1' ? 'checked' : ''}>
      <span><b>Les élèves ne voient que les livres rangés dans un thème « visible par les élèves »</b><br>
      <span class="muted small">Pratique pour ne proposer qu'une sélection (ex. : le thème du mois). Les adultes voient toujours tout.</span></span></label></div>` : ''}
    ${themes.length ? `<div class="table-wrap"><table><thead><tr><th>Thème</th><th class="num">Livres</th><th>Élèves</th><th></th></tr></thead>
      <tbody>${themes.map((t, i) => `<tr>
        <td><a class="chip chip-lg" style="${t.color ? `--chip:${t.color}` : ''}" href="#/catalogue?theme_id=${t.id}">${esc(t.emoji ?? '')} ${esc(t.name)}</a></td>
        <td class="num"><a href="#/inventaire?theme_id=${t.id}">${t.count}</a></td>
        <td>${t.for_students ? '👀 visible' : '<span class="muted">masqué</span>'}</td>
        <td class="num nowrap">${isAdmin() ? `
          <button class="icon-btn move" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Monter">⬆️</button>
          <button class="icon-btn move" data-i="${i}" data-dir="1" ${i === themes.length - 1 ? 'disabled' : ''} title="Descendre">⬇️</button>
          <button class="icon-btn edit" data-id="${t.id}" title="Modifier">✏️</button>
          <button class="icon-btn del" data-id="${t.id}" title="Supprimer">🗑️</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Aucun thème pour le moment.</div>'}
    <p class="muted small">Pour ranger des livres dans un thème : cochez-les dans la recherche ou dans « Tous les livres », puis « Ranger dans un thème ».
      On peut aussi choisir les thèmes dans la fiche d'un livre.</p>`;
  if (!isAdmin()) return;

  $('#restrict').onchange = async (e) => {
    await api.put('/settings', { restrict_student_catalog: e.target.checked ? '1' : '0' });
    toast(e.target.checked ? 'Les élèves ne voient plus que les thèmes visibles' : 'Les élèves voient tout le catalogue');
  };
  $('#add').onclick = () => editTheme();
  for (const b of $$('.edit')) b.onclick = () => editTheme(themes.find((t) => t.id === Number(b.dataset.id)));
  for (const b of $$('.del')) {
    b.onclick = async () => {
      const t = themes.find((x) => x.id === Number(b.dataset.id));
      if (!(await confirmBox(`Supprimer le thème « ${t.name} » ? Les livres restent au catalogue.`, { danger: true, ok: 'Supprimer' }))) return;
      await api.del(`/themes/${t.id}`);
      navigate(location.hash);
    };
  }
  for (const b of $$('.move')) {
    b.onclick = async () => {
      const ids = themes.map((t) => t.id);
      const i = Number(b.dataset.i);
      const j = i + Number(b.dataset.dir);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      await api.post('/themes/order', { ids });
      navigate(location.hash);
    };
  }
}

function editTheme(t = { emoji: '⭐', color: COLORS[0], for_students: 1 }) {
  let emoji = t.emoji;
  let color = t.color ?? COLORS[0];
  const dlg = modal(t.id ? 'Modifier le thème' : 'Nouveau thème', `<form class="grid" id="f">
    <label>Nom<input name="name" value="${esc(t.name ?? '')}" required placeholder="Les animaux de la ferme"></label>
    <div><b>Image</b><div class="avatar-grid" id="emojis" style="margin-top:.4rem">${EMOJIS.map((e) =>
      `<button type="button" data-e="${e}" class="${e === emoji ? 'selected' : ''}">${e}</button>`).join('')}</div>
      <label style="margin-top:.4rem">ou un autre emoji<input name="emoji_other" value="${EMOJIS.includes(emoji) ? '' : esc(emoji ?? '')}" maxlength="8" style="width:6rem"></label></div>
    <div><b>Couleur</b><div class="row" id="colors" style="margin-top:.4rem">${COLORS.map((c) =>
      `<button type="button" class="swatch ${c === color ? 'selected' : ''}" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>
    <label class="check"><input type="checkbox" name="for_students" ${t.for_students ? 'checked' : ''}> Visible par les élèves</label>
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`);
  for (const b of $$('#emojis button', dlg)) b.onclick = () => { emoji = b.dataset.e; for (const x of $$('#emojis button', dlg)) x.classList.toggle('selected', x === b); };
  for (const b of $$('#colors button', dlg)) b.onclick = () => { color = b.dataset.c; for (const x of $$('#colors button', dlg)) x.classList.toggle('selected', x === b); };
  $('#f', dlg).onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    const data = { name: f.name, emoji: f.emoji_other.trim() || emoji, color, for_students: f.for_students };
    try {
      if (t.id) await api.put(`/themes/${t.id}`, data); else await api.post('/themes', data);
      dlg.close();
      await loadThemes(true);
      navigate(location.hash);
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- Import d'un catalogue existant ---------- */

async function renderImport(app) {
  const types = Object.entries(state.meta.doc_types);
  app.innerHTML = `
    <div class="page-head"><div><h1>Importer des livres</h1>
      <p class="muted">Reprenez le catalogue d'un autre logiciel (Hibouthèque, BCDI, PMB…) ou d'un tableau Excel.</p></div></div>
    ${tabs('import')}
    <div class="card">
      <h2 style="margin-top:0">Depuis Hibouthèque</h2>
      <ol class="small">
        <li>Connectez-vous à Hibouthèque en <b>administrateur</b>.</li>
        <li>Onglet <b>Administration</b> → <b>Document</b>, puis en bas de la liste d'actions : <b>Export des documents en CSV</b>.</li>
        <li>Enregistrez le fichier, puis choisissez-le ci-dessous.</li></ol>
      <p class="small muted">Tout fichier <b>CSV</b> (séparateur « ; » ou « , ») ou <b>XML</b> convient. Depuis Excel : « Enregistrer sous » → « CSV (séparateur : point-virgule) ».
        Une ligne par livre ou par exemplaire : les exemplaires d'un même livre (même ISBN, ou même titre et auteur) sont regroupés.
        Les livres déjà présents dans la BCD sont ignorés : on peut relancer l'import sans créer de doublons.</p>
      <label>Fichier<input type="file" id="file" accept=".csv,.txt,.xml,text/csv,text/xml"></label>
    </div>
    <div id="step2"></div>`;

  $('#file').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await readTextFile(file);
    let a;
    try { a = await api.post('/catalog-import/analyze', { text }); } catch (err) { return toast(err.message, 'error'); }
    const options = (current) => `<option value="">— ignorer —</option>${Object.entries(a.fields).map(([k, l]) =>
      `<option value="${k}" ${current === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
    $('#step2').innerHTML = `<div class="card">
      <h2 style="margin-top:0">Colonnes du fichier</h2>
      <p class="muted">${plural(a.rows, 'ligne')}. Vérifiez à quoi correspond chaque colonne (reconnues automatiquement, corrigez si besoin).</p>
      <div class="table-wrap"><table class="dense map-table"><thead><tr><th>Colonne du fichier</th><th>Correspond à</th><th>Exemples</th></tr></thead>
        <tbody>${a.headers.map((h, i) => `<tr><td><b>${esc(h)}</b></td>
          <td><select class="map" data-i="${i}">${options(a.mapping[i])}</select></td>
          <td class="small muted">${a.sample.map((r) => esc((r[i] ?? '').slice(0, 40))).filter(Boolean).slice(0, 3).join(' · ')}</td></tr>`).join('')}</tbody></table></div>
      <div class="grid grid-2" style="margin-top:1rem">
        <label>Type par défaut (si le fichier ne le précise pas)<select id="default-type">${types.map(([k, t]) =>
          `<option value="${k}" ${k === 'album' ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label class="check" style="align-self:end"><input type="checkbox" id="keep-numbers" checked>
          Garder les numéros d'exemplaire du fichier (« 000012 » devient « 12 »), s'ils sont libres</label></div>
      <div class="actions"><button class="btn btn-primary" id="preview">👀 Prévisualiser</button></div>
      <div id="report"></div></div>`;

    const payload = () => ({
      text,
      mapping: $$('.map').map((s) => s.value),
      default_type: $('#default-type').value,
      keep_numbers: $('#keep-numbers').checked,
    });
    $('#preview').onclick = async () => {
      try {
        const r = await api.post('/catalog-import', { ...payload(), dry_run: true });
        showImportReport(r, true, async (btn) => {
          btn.disabled = true;
          btn.textContent = 'Import en cours…';
          try {
            const done = await api.post('/catalog-import', payload());
            showImportReport(done, false);
            toast(`${plural(done.documents, 'livre importé', 'livres importés')}`);
          } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
        });
      } catch (err) { toast(err.message, 'error'); }
    };
  };
}

function showImportReport(r, dry, onConfirm) {
  $('#report').innerHTML = `<h3>${dry ? 'Aperçu' : '✅ Import terminé'}</h3>
    <div class="stats">
      <div class="stat"><b>${r.documents}</b><span>${dry ? 'livres à importer' : 'livres importés'}</span></div>
      <div class="stat"><b>${r.copies}</b><span>exemplaires</span></div>
      <div class="stat"><b>${r.skipped.length}</b><span>déjà dans la BCD (ignorés)</span></div>
      ${r.renumbered ? `<div class="stat"><b>${r.renumbered}</b><span>renumérotés (numéro déjà pris)</span></div>` : ''}</div>
    ${r.errors.length ? `<details><summary>⚠️ ${plural(r.errors.length, 'ligne ignorée', 'lignes ignorées')}</summary>
      <ul class="log">${r.errors.slice(0, 50).map((e) => `<li class="warn">${esc(e)}</li>`).join('')}</ul></details>` : ''}
    ${dry && r.sample.length ? `<p class="muted small">Exemples :</p><div class="table-wrap"><table class="dense"><thead><tr><th>Titre</th><th>Auteur(s)</th><th>Cote</th><th>Type</th><th class="num">Ex.</th></tr></thead>
      <tbody>${r.sample.map((d) => `<tr><td>${esc(d.title)}</td><td>${esc(d.authors ?? '')}</td><td><span class="cote">${esc(d.cote ?? '')}</span></td>
        <td class="small">${esc(typeLabel(d.doc_type))}</td><td class="num">${d.copies}</td></tr>`).join('')}</tbody></table></div>` : ''}
    <div class="actions">${dry ? `<button class="btn btn-primary btn-lg" id="go" ${r.documents ? '' : 'disabled'}>✅ Importer ${plural(r.documents, 'livre')}</button>`
      : '<a class="btn btn-primary" href="#/inventaire">📚 Voir tous les livres</a>'}</div>
    ${!dry ? '<p class="muted small">Astuce : les fiches importées n\'ont souvent pas de résumé ni d\'image. Vous pouvez ajouter une couverture depuis la fiche de chaque livre (« 📷 Ajouter une couverture »).</p>' : ''}`;
  if (dry) $('#go').onclick = (e) => onConfirm(e.target);
}

/* ---------- Listes ---------- */

export async function addToListDialog(ids) {
  const lists = await api.get('/lists');
  const dlg = modal('Ajouter à une liste', `<form class="grid" id="f">
    ${lists.length ? `<label>Liste existante <select name="list_id"><option value="">—</option>
      ${lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.count})</option>`).join('')}</select></label>
      <p class="muted small" style="margin:0">ou</p>` : ''}
    <label>Nouvelle liste <input name="name" placeholder="Ex. : Rallye lecture, Les animaux de la ferme…"></label>
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary">Ajouter</button></div></form>`);
  $('#f', dlg).onsubmit = async (e) => {
    e.preventDefault();
    const { list_id, name } = formData(e.target);
    try {
      let id = list_id;
      if (!id) {
        if (!name) return toast('Choisissez ou nommez une liste', 'error');
        id = (await api.post('/lists', { name })).id;
      }
      const r = await api.post(`/lists/${id}/items`, { document_ids: ids });
      dlg.close();
      toast(`${plural(r.added, 'document ajouté', 'documents ajoutés')} à la liste`);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function newListDialog(payload, total) {
  const dlg = modal('Nouvelle liste thématique', `<form class="grid" id="f">
    <p class="muted" style="margin:0">Les ${plural(total, 'document')} de la recherche actuelle seront ajoutés à la liste.</p>
    <label>Nom de la liste <input name="name" required placeholder="Ex. : Albums sur l'automne"></label>
    <label>Description <textarea name="description" placeholder="Pour qui, pour quel projet…"></textarea></label>
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary">Créer la liste</button></div></form>`);
  $('#f', dlg).onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api.post('/lists', { ...formData(e.target), ...payload });
      dlg.close();
      navigate(`#/liste/${r.id}`);
    } catch (err) { toast(err.message, 'error'); }
  };
}

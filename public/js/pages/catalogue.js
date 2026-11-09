import { api, qs } from '../api.js';
import { esc, cover, toast, modal, confirmBox, formData, plural, $, $$ } from '../ui.js';
import { state, navigate, isAdmin, typeLabel } from '../state.js';

const selected = new Set();
const ADV_FIELDS = ['title', 'author', 'subject', 'series', 'publisher', 'isbn', 'cote', 'doc_type', 'year_from', 'year_to', 'available', 'audience', 'location', 'added_from'];

export async function render(app, { query }) {
  const q = { sort: '', ...query };
  const hasAdv = ADV_FIELDS.some((f) => q[f]);
  const types = Object.entries(state.meta.doc_types);
  const res = await api.get('/documents' + qs({ ...q, limit: 30 }));
  const pages = Math.ceil(res.total / res.limit);

  app.innerHTML = `
    <div class="page-head"><div><h1>Catalogue</h1><p class="muted">${plural(res.total, 'document')}</p></div>
      <div class="row no-print">
        <a class="btn" href="/api/documents/export.csv${qs(q)}" download>⬇️ Exporter (CSV)</a>
        <button class="btn" id="list-from-search">📋 Créer une liste avec ces résultats</button>
        <a class="btn btn-primary" href="#/document/nouveau">➕ Ajouter un document</a></div></div>

    <form class="card no-print" id="search">
      <div class="searchbar"><input name="q" value="${esc(q.q)}" placeholder="Titre, auteur, sujet, collection, ISBN, cote…" autofocus>
        <button class="btn btn-primary">Rechercher</button></div>
      <details class="advanced" ${hasAdv ? 'open' : ''}><summary>Recherche avancée</summary>
        <div class="grid grid-4">
          <label>Titre <input name="title" value="${esc(q.title)}"></label>
          <label>Auteur <input name="author" value="${esc(q.author)}"></label>
          <label>Sujet <input name="subject" value="${esc(q.subject)}"></label>
          <label>Collection / série <input name="series" value="${esc(q.series)}"></label>
          <label>Éditeur <input name="publisher" value="${esc(q.publisher)}"></label>
          <label>ISBN <input name="isbn" value="${esc(q.isbn)}"></label>
          <label>Cote commence par <input name="cote" value="${esc(q.cote)}" placeholder="R, A, 590…"></label>
          <label>Type <select name="doc_type"><option value="">Tous</option>
            ${types.map(([k, t]) => `<option value="${k}" ${q.doc_type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
          <label>Paru après (année) <input name="year_from" type="number" value="${esc(q.year_from)}"></label>
          <label>Paru avant (année) <input name="year_to" type="number" value="${esc(q.year_to)}"></label>
          <label>Public / niveau <input name="audience" value="${esc(q.audience)}" placeholder="cycle 2, CP…"></label>
          <label>Emplacement <input name="location" value="${esc(q.location)}"></label>
          <label>Ajouté depuis le <input name="added_from" type="date" value="${esc(q.added_from)}"></label>
          <label>Tri <select name="sort">
            ${[['', 'Pertinence / récents'], ['title', 'Titre'], ['author', 'Auteur'], ['cote', 'Cote'], ['year', 'Année'], ['recent', 'Derniers ajouts']]
              .map(([v, l]) => `<option value="${v}" ${q.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" name="available" ${q.available ? 'checked' : ''}> Disponibles seulement</label>
          <div class="row"><button type="button" class="btn btn-ghost" id="reset">Effacer les critères</button></div>
        </div></details>
    </form>

    ${res.items.length ? `<div class="table-wrap" style="margin-top:1rem"><table>
      <thead><tr><th class="no-print"><input type="checkbox" id="check-page" title="Sélectionner la page"></th>
        <th>Document</th><th>Cote</th><th>Type</th><th>Année</th><th class="num">Dispo.</th></tr></thead>
      <tbody>${res.items.map((d) => `<tr>
        <td class="no-print"><input type="checkbox" class="sel" value="${d.id}" ${selected.has(d.id) ? 'checked' : ''}></td>
        <td><a class="doc-cell" href="#/document/${d.id}" style="text-decoration:none;color:inherit">${cover(d)}
          <div><div class="doc-title">${esc(d.title)}${d.series ? ` <span class="muted small">— ${esc(d.series)}${d.series_number ? ' ' + esc(d.series_number) : ''}</span>` : ''}</div>
          <div class="muted small">${esc(d.authors ?? '')}${d.publisher ? ' · ' + esc(d.publisher) : ''}</div></div></a></td>
        <td><span class="cote">${esc(d.cote ?? '')}</span></td>
        <td class="small">${esc(typeLabel(d.doc_type))}</td>
        <td>${d.pub_year ?? ''}</td>
        <td class="num"><span class="badge ${d.available_count ? 'badge-ok' : 'badge-late'}">${d.available_count}/${d.copies_count}</span></td>
      </tr>`).join('')}</tbody></table></div>
      ${pages > 1 ? `<div class="pager">
        <button class="btn btn-sm" data-page="${res.page - 1}" ${res.page <= 1 ? 'disabled' : ''}>← Précédent</button>
        <span>Page ${res.page} / ${pages}</span>
        <button class="btn btn-sm" data-page="${res.page + 1}" ${res.page >= pages ? 'disabled' : ''}>Suivant →</button></div>` : ''}`
    : `<div class="empty">Aucun document trouvé.${!q.q && !hasAdv ? ' <a href="#/document/nouveau">Ajoutez votre premier livre</a> : il suffit de scanner son code-barres ISBN.' : ''}</div>`}
    <div id="selbar"></div>`;

  const go = (params) => navigate('#/catalogue' + qs(params));
  $('#search').onsubmit = (e) => {
    e.preventDefault();
    go(formData(e.target));
  };
  $('#reset').onclick = () => go({ q: $('#search').q.value });
  for (const b of $$('[data-page]')) b.onclick = () => go({ ...q, page: b.dataset.page });

  const updateBar = () => renderSelectionBar(q, res.total);
  for (const cb of $$('.sel')) {
    cb.onchange = () => { cb.checked ? selected.add(Number(cb.value)) : selected.delete(Number(cb.value)); updateBar(); };
  }
  const pageBox = $('#check-page');
  if (pageBox) {
    pageBox.checked = res.items.every((d) => selected.has(d.id));
    pageBox.onchange = () => {
      for (const cb of $$('.sel')) { cb.checked = pageBox.checked; pageBox.checked ? selected.add(Number(cb.value)) : selected.delete(Number(cb.value)); }
      updateBar();
    };
  }
  $('#list-from-search').onclick = () => newListDialog({ from_search: { ...q, page: undefined, sort: undefined } }, res.total);
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
    <button class="btn btn-sm" id="sel-list">📋 Ajouter à une liste</button>
    <button class="btn btn-sm" id="sel-labels">🏷️ Étiquettes de cote</button>
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

export async function addToListDialog(ids) {
  const lists = await api.get('/lists');
  const dlg = modal('Ajouter à une liste', `<form class="grid" id="f">
    ${lists.length ? `<label>Liste existante <select name="list_id"><option value="">—</option>
      ${lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${l.count})</option>`).join('')}</select></label>
      <p class="muted small" style="margin:0">ou</p>` : ''}
    <label>Nouvelle liste <input name="name" placeholder="Ex. : Rallye lecture CE2, Les animaux de la ferme…"></label>
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
    <label>Nom de la liste <input name="name" required placeholder="Ex. : Documentaires sur les dinosaures"></label>
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


import { api, qs } from '../api.js';
import { esc, cover, toast, modal, confirmBox, formData, fmtDate, plural, $, $$ } from '../ui.js';
import { state, navigate, typeLabel } from '../state.js';

export async function render(app, { path, params, query }) {
  if (path === '/etiquettes') return renderLabels(app, query);
  if (params.length) return renderList(app, params[0], query);
  return renderIndex(app);
}

async function renderIndex(app) {
  const lists = await api.get('/lists');
  app.innerHTML = `<div class="page-head"><div><h1>Listes thématiques</h1>
      <p class="muted">Sélections de documents à imprimer ou partager : rallye lecture, projet de classe, thème du mois…</p></div>
      <button class="btn btn-primary" id="add">➕ Nouvelle liste</button></div>
    <div class="card small" style="background:var(--primary-soft)">💡 Astuce : depuis le <a href="#/catalogue">catalogue</a>, faites une recherche
      (par sujet, cote, type…) puis « Créer une liste avec ces résultats », ou cochez des documents et « Ajouter à une liste ».</div>
    ${lists.length ? `<div class="table-wrap" style="margin-top:1rem"><table><thead><tr><th>Liste</th><th class="num">Documents</th><th>Créée par</th><th>Le</th></tr></thead>
      <tbody>${lists.map((l) => `<tr class="clickable" data-href="#/liste/${l.id}"><td><a href="#/liste/${l.id}"><b>${esc(l.name)}</b></a>
        ${l.description ? `<div class="muted small">${esc(l.description)}</div>` : ''}</td>
        <td class="num">${l.count}</td><td>${esc(l.author ?? '')}</td><td>${fmtDate(l.created_at)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Aucune liste pour le moment.</div>'}`;
  for (const tr of $$('[data-href]')) tr.onclick = () => navigate(tr.dataset.href);
  $('#add').onclick = () => editList();
}

function editList(l) {
  const types = Object.entries(state.meta.doc_types);
  const dlg = modal(l ? 'Modifier la liste' : 'Nouvelle liste', `<form class="grid" id="f">
    <label>Nom<input name="name" value="${esc(l?.name ?? '')}" required></label>
    <label>Description<textarea name="description">${esc(l?.description ?? '')}</textarea></label>
    ${l ? '' : `<details><summary>Remplir automatiquement à partir du catalogue (facultatif)</summary>
      <div class="grid grid-2" style="margin-top:.6rem">
        <label>Sujet contient<input name="subject" placeholder="animaux, Moyen Âge…"></label>
        <label>Cote commence par<input name="cote" placeholder="590, R, BD…"></label>
        <label>Auteur<input name="author"></label>
        <label>Type<select name="doc_type"><option value="">Tous</option>${types.map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></label>
        <label>Public / niveau<input name="audience"></label>
        <label>Mots-clés<input name="q"></label></div></details>`}
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`);
  $('#f', dlg).onsubmit = async (e) => {
    e.preventDefault();
    const { name, description, ...crit } = formData(e.target);
    try {
      if (l) {
        await api.put(`/lists/${l.id}`, { name, description });
        dlg.close(); navigate(location.hash);
      } else {
        const hasCrit = Object.values(crit).some(Boolean);
        const r = await api.post('/lists', { name, description, ...(hasCrit ? { from_search: crit } : {}) });
        dlg.close();
        if (hasCrit) toast(`${plural(r.added, 'document ajouté', 'documents ajoutés')}`);
        navigate(`#/liste/${r.id}`);
      }
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function renderList(app, id, query) {
  const l = await api.get(`/lists/${id}`);
  const withCovers = query.vue !== 'simple';
  app.innerHTML = `<div class="page-head no-print"><a href="#/listes" class="btn btn-ghost">← Listes</a>
      <div class="row">
        <a class="btn" href="#/liste/${l.id}${withCovers ? '?vue=simple' : ''}">${withCovers ? '📄 Vue compacte' : '🖼️ Avec couvertures'}</a>
        <button class="btn" id="edit">✏️ Renommer</button>
        <a class="btn" href="#/catalogue${qs({ list_id: l.id })}" title="Ouvrir dans le catalogue">🔎 Catalogue</a>
        <button class="btn" id="labels">🏷️ Étiquettes</button>
        <a class="btn" href="/api/lists/${l.id}/export.csv" download>⬇️ CSV</a>
        <button class="btn btn-primary" onclick="bcdPrint()">🖨️ Imprimer</button>
        <button class="btn btn-danger" id="del">🗑️</button></div></div>
    <div class="card">
      <h1>${esc(l.name)}</h1>
      ${l.description ? `<p>${esc(l.description)}</p>` : ''}
      <p class="muted small">${esc(state.info.school_name)} — ${plural(l.items.length, 'document')} — ${new Date().toLocaleDateString('fr-FR')}</p>
      ${l.items.length ? `<table><thead><tr>${withCovers ? '<th></th>' : ''}<th>Titre</th><th>Auteur(s)</th><th>Cote</th><th>Type</th><th class="no-print num">Dispo.</th><th class="no-print"></th></tr></thead>
      <tbody>${l.items.map((d) => `<tr>
        ${withCovers ? `<td>${cover(d)}</td>` : ''}
        <td><a href="#/document/${d.id}"><b>${esc(d.title)}</b></a>${d.series ? `<div class="muted small">${esc(d.series)}</div>` : ''}</td>
        <td>${esc(d.authors ?? '')}</td><td><span class="cote">${esc(d.cote ?? '')}</span></td><td class="small">${esc(typeLabel(d.doc_type))}</td>
        <td class="no-print num">${d.available_count ? '✅' : '⏳'}</td>
        <td class="no-print num"><button class="icon-btn rm" data-id="${d.id}" title="Retirer de la liste">✕</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Liste vide : ajoutez des documents depuis le catalogue.</p>'}
    </div>`;
  $('#edit').onclick = () => editList(l);
  $('#labels').onclick = () => { state.labelIds = l.items.map((d) => d.id); navigate('#/etiquettes'); };
  $('#del').onclick = async () => {
    if (!(await confirmBox(`Supprimer la liste « ${l.name} » ? Les documents restent au catalogue.`, { danger: true, ok: 'Supprimer' }))) return;
    await api.del(`/lists/${l.id}`); navigate('#/listes');
  };
  for (const b of $$('.rm')) b.onclick = async () => { await api.del(`/lists/${l.id}/items/${b.dataset.id}`); navigate(location.hash); };
}

async function renderLabels(app) {
  const ids = state.labelIds ?? [];
  if (!ids.length) {
    app.innerHTML = '<div class="empty">Sélectionnez des documents dans le catalogue puis « Étiquettes de cote ».</div>';
    return;
  }
  const { items } = await api.get('/documents' + qs({ ids: ids.join(','), limit: 5000, sort: 'cote' }));
  const detail = await Promise.all(items.map((d) => api.get(`/documents/${d.id}`)));
  const labels = detail.flatMap((d) => (d.copies.length ? d.copies : [{ barcode: '' }]).map((c) => ({ ...d, barcode: c.barcode })));
  app.innerHTML = `<div class="page-head no-print"><div><h1>Étiquettes</h1>
      <p class="muted">${plural(labels.length, 'étiquette')} (une par exemplaire). À imprimer sur planche d'étiquettes ou papier, puis découper.</p></div>
      <div class="row"><a href="javascript:history.back()" class="btn btn-ghost">← Retour</a><button class="btn btn-primary" onclick="bcdPrint()">🖨️ Imprimer</button></div></div>
    <div class="labels-print">${labels.map((d) => `<div class="label"><b>${esc(d.cote ?? '')}</b>
      <small>${esc(d.title)}</small><small>${d.barcode ? `n° ${esc(d.barcode)}` : ""}</small></div>`).join('')}</div>`;
}

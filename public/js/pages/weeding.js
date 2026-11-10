import { api, qs } from '../api.js';
import { esc, toast, confirmBox, formData, fmtDate, plural, $, $$ } from '../ui.js';
import { state, navigate, typeLabel } from '../state.js';
import { tabs } from './catalogue.js';

export async function render(app, { query }) {
  const types = Object.entries(state.meta.doc_types);
  const hasCrit = ['year_before', 'no_loan_years', 'state', 'doc_type'].some((k) => query[k]);
  const res = hasCrit ? await api.get('/weeding' + qs(query)) : { items: [] };
  const selected = new Set(res.items.map((d) => d.id));

  app.innerHTML = `<div class="page-head"><div><h1>Désherbage</h1>
      <p class="muted">Repérez les documents anciens, abîmés ou qui ne sortent plus, puis retirez-les du catalogue en une fois.</p></div></div>
    ${tabs('weeding')}
    <form class="card grid grid-4 no-print" id="f">
      <label>Parus avant (année)<input name="year_before" type="number" value="${esc(query.year_before)}" placeholder="${new Date().getFullYear() - 20}"></label>
      <label>Non empruntés depuis<select name="no_loan_years"><option value="">—</option>
        ${[1, 2, 3, 5, 8].map((n) => `<option value="${n}" ${String(query.no_loan_years) === String(n) ? 'selected' : ''}>${plural(n, 'an')}</option>`).join('')}</select></label>
      <label>Exemplaire en état<select name="state"><option value="">—</option>
        ${[['abime', 'Abîmé'], ['perdu', 'Perdu'], ['reparation', 'En réparation']].map(([k, l]) => `<option value="${k}" ${query.state === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Type<select name="doc_type"><option value="">Tous</option>
        ${types.map(([k, t]) => `<option value="${k}" ${query.doc_type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <div class="span-all row"><button class="btn btn-primary">🔎 Chercher les candidats</button>
        <span class="muted small">Les critères se cumulent. Les documents en prêt ne seront jamais supprimés.</span></div></form>
    ${!hasCrit ? '<div class="empty">Choisissez au moins un critère.</div>'
      : res.items.length ? `<div class="row" style="margin:1rem 0 .5rem"><b>${plural(res.items.length, 'candidat')}</b><span class="grow"></span>
        <button class="btn no-print" onclick="window.print()">🖨️ Imprimer la liste (pour vérifier en rayon)</button></div>
      <div class="table-wrap"><table><thead><tr><th class="no-print"><input type="checkbox" id="all" checked></th><th>Cote</th><th>Titre</th>
        <th>Type</th><th>Année</th><th class="num">Ex.</th><th>État</th><th class="num">Prêts</th><th>Dernier prêt</th></tr></thead>
      <tbody>${res.items.map((d) => `<tr><td class="no-print"><input type="checkbox" class="sel" value="${d.id}" checked></td>
        <td><span class="cote">${esc(d.cote ?? '')}</span></td><td><a href="#/document/${d.id}">${esc(d.title)}</a><div class="muted small">${esc(d.authors ?? '')}</div></td>
        <td class="small">${esc(typeLabel(d.doc_type))}</td><td>${d.pub_year ?? ''}</td><td class="num">${d.copies_count}</td>
        <td class="small">${esc((d.states ?? '').replace('ok', 'bon').replace('abime', 'abîmé'))}</td>
        <td class="num">${d.loan_count}</td><td>${d.last_loan ? fmtDate(d.last_loan) : '<span class="muted">jamais</span>'}</td></tr>`).join('')}</tbody></table></div>
      <div class="selection-bar"><b id="count"></b><span class="grow"></span>
        <button class="btn btn-sm btn-danger" id="go">🗑️ Supprimer la sélection du catalogue</button></div>`
      : '<div class="empty">Aucun document ne correspond. 🌱</div>'}`;

  $('#f').onsubmit = (e) => { e.preventDefault(); navigate('#/desherbage' + qs(formData(e.target))); };
  if (!res.items.length) return;
  const count = () => { $('#count').textContent = plural(selected.size, 'document sélectionné', 'documents sélectionnés'); $('#go').disabled = !selected.size; };
  for (const cb of $$('.sel')) cb.onchange = () => { cb.checked ? selected.add(Number(cb.value)) : selected.delete(Number(cb.value)); count(); };
  $('#all').onchange = (e) => { for (const cb of $$('.sel')) { cb.checked = e.target.checked; cb.onchange(); } };
  count();
  $('#go').onclick = async () => {
    if (!(await confirmBox(`Retirer définitivement ${plural(selected.size, 'document')} du catalogue (avec leurs exemplaires) ? L'historique des prêts est conservé.`, { danger: true, ok: 'Désherber' }))) return;
    try {
      const r = await api.post('/documents/batch-delete', { ids: [...selected] });
      toast(`${plural(r.deleted, 'document retiré', 'documents retirés')}${r.skipped.length ? ` · ${r.skipped.length} ignoré(s) car en prêt` : ''}`);
      navigate(location.hash);
    } catch (err) { toast(err.message, 'error'); }
  };
}

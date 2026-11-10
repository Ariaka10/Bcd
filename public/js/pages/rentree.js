/** Assistant « Nouvelle année scolaire » : proposé à la première ouverture après le 1er septembre. */
import { api } from '../api.js';
import { esc, toast, confirmBox, fmtDate, plural, $, $$ } from '../ui.js';
import { navigate } from '../state.js';

export async function render(app) {
  const [r, info] = await Promise.all([api.get('/admin/rentree'), api.get('/app/info').catch(() => ({}))]);
  const year = r.year.replace('-', ' – ');
  app.innerHTML = `
    <div class="page-head"><div><h1>🎒 Nouvelle année scolaire ${esc(year)}</h1>
      <p class="muted">Quelques étapes pour repartir sur de bonnes bases. Rien n'est supprimé sans votre accord.</p></div>
      ${r.done ? '<span class="badge badge-ok">✅ Rentrée faite</span>' : ''}</div>

    <div class="card step"><h2>1. Faire une sauvegarde</h2>
      <p class="muted">Par précaution, avant de toucher à la liste des élèves.</p>
      <div class="row">${info.desktop ? '<button class="btn btn-primary" id="backup">💾 Sauvegarder maintenant</button>' : ''}
        <a class="btn" href="/api/admin/backup" download>⬇️ Enregistrer une copie (clé USB…)</a></div></div>

    <div class="card step"><h2>2. Les livres pas encore rendus</h2>
      ${r.pending_loans ? `<p>Il reste <b>${plural(r.pending_loans, 'livre')}</b> en prêt de l'an dernier.
        Les élèves qui partent gardent leur prêt en cours tant qu'il n'est pas rendu (ils ne seront pas supprimés).</p>
        <div class="row"><a class="btn" href="#/prets?vue=fin">📋 Voir la liste par classe</a></div>`
        : '<p class="badge badge-ok">✅ Tous les livres sont rentrés.</p>'}</div>

    <div class="card step"><h2>3. Importer la liste des élèves de cette année</h2>
      <p class="muted">Exportez la liste depuis ONDE puis importez-la avec l'option « Archiver les élèves absents du fichier » :
        les élèves qui restent changent de classe, les nouveaux sont ajoutés, ceux qui sont partis sont archivés.
        (${plural(r.students, 'élève actif', 'élèves actifs')} aujourd'hui.)</p>
      <div class="row"><a class="btn btn-primary" href="#/import?rentree=1">📥 Importer depuis ONDE</a></div></div>

    <div class="card step"><h2>4. Supprimer les élèves partis</h2>
      ${r.archived.length ? `<p class="muted">Les données des enfants qui ont quitté l'école n'ont pas à être conservées (RGPD).
          Leur historique de prêts est supprimé avec eux. Ceux qui ont encore un livre ne peuvent pas être supprimés.</p>
        <div class="table-wrap"><table class="dense"><thead><tr><th><input type="checkbox" id="all-arch" checked></th><th>Élève</th><th>Ancienne classe</th><th>Archivé le</th><th></th></tr></thead>
        <tbody>${r.archived.map((u) => `<tr><td><input type="checkbox" class="arch" value="${u.id}" ${u.active_loans ? 'disabled' : 'checked'}></td>
          <td>${esc(u.first_name)} ${esc(u.last_name)}</td><td>${esc(u.class_name ?? '')}</td><td>${fmtDate(u.archived_at)}</td>
          <td>${u.active_loans ? `<span class="badge badge-late">${plural(u.active_loans, 'livre')} à rendre</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
        <div class="row" style="margin-top:.6rem"><button class="btn btn-danger" id="purge">🗑️ Supprimer les élèves cochés</button></div>`
        : '<p class="badge badge-ok">✅ Aucun élève archivé.</p>'}</div>

    <div class="card step"><h2>5. Supprimer les classes vides</h2>
      ${r.empty_classes.length ? `<p class="muted">Classes sans aucun élève actif (anciens noms de classe…) :</p>
        <div class="theme-bar">${r.empty_classes.map((c) => `<label class="chip chip-lg chip-check"><input type="checkbox" class="cls" value="${c.id}" checked> ${esc(c.name)}</label>`).join('')}</div>
        <button class="btn" id="classes">🗑️ Supprimer ces classes</button>`
        : '<p class="badge badge-ok">✅ Aucune classe vide.</p>'}</div>

    <div class="card step"><h2>6. C'est fini !</h2>
      <p class="muted">Pensez à imprimer les nouvelles <a href="#/cartes">cartes de connexion</a> des élèves.</p>
      <div class="row"><button class="btn btn-primary btn-lg" id="done">✅ Terminer la rentrée</button>
        ${r.done ? '' : '<button class="btn btn-ghost" id="later">Plus tard</button>'}</div></div>`;

  const backup = $('#backup');
  if (backup) backup.onclick = async () => {
    try { await api.post('/admin/backups'); toast('Sauvegarde faite ✅'); backup.disabled = true; } catch (e) { toast(e.message, 'error'); }
  };
  const all = $('#all-arch');
  if (all) all.onchange = () => { for (const cb of $$('.arch:not(:disabled)')) cb.checked = all.checked; };
  const purge = $('#purge');
  if (purge) purge.onclick = async () => {
    const ids = $$('.arch:checked').map((cb) => Number(cb.value));
    if (!ids.length) return toast('Aucun élève coché', 'error');
    if (!(await confirmBox(`Supprimer définitivement ${plural(ids.length, 'élève')} et leur historique ?`, { danger: true, ok: 'Supprimer' }))) return;
    const res = await api.post('/admin/rentree/purge', { ids });
    toast(`${plural(res.deleted, 'élève supprimé', 'élèves supprimés')}`);
    navigate(location.hash);
  };
  const classes = $('#classes');
  if (classes) classes.onclick = async () => {
    const ids = $$('.cls:checked').map((cb) => Number(cb.value));
    if (!ids.length) return;
    const res = await api.post('/admin/rentree/classes', { ids });
    toast(`${plural(res.deleted, 'classe supprimée', 'classes supprimées')}`);
    navigate(location.hash);
  };
  $('#done').onclick = async () => {
    await api.post('/admin/rentree/done');
    toast('Bonne rentrée ! 🎒');
    navigate('#/');
  };
  const later = $('#later');
  if (later) later.onclick = () => navigate('#/');
}

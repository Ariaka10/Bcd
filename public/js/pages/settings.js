import { api } from '../api.js';
import { esc, toast, formData, confirmBox, fmtDate, $, $$ } from '../ui.js';
import { state, navigate } from '../state.js';

export async function render(app, { path }) {
  if (path === '/mon-compte') return renderAccount(app);
  const s = await api.get('/settings');
  const num = (k, label) => `<label>${label}<input type="number" min="0" name="${k}" value="${esc(s[k])}"></label>`;
  app.innerHTML = `<div class="page-head"><h1>Paramètres</h1></div>
    <form class="card" id="f">
      <h2 style="margin-top:0">École</h2>
      <div class="grid grid-2">
        <label>Nom de l'école<input name="school_name" value="${esc(s.school_name)}"></label></div>
      <h2>Règles de prêt</h2>
      <div class="grid grid-3">
        ${num('loan_days_eleve', 'Durée de prêt élève (jours)')}
        ${num('loan_days_enseignant', 'Durée de prêt enseignant (jours)')}
        ${num('loan_days_admin', 'Durée de prêt administrateur (jours)')}
        ${num('max_loans_eleve', 'Nombre de prêts max. élève')}
        ${num('max_loans_enseignant', 'Nombre de prêts max. enseignant')}
        ${num('max_loans_admin', 'Nombre de prêts max. administrateur')}
        ${num('loan_days_classe', 'Durée de prêt à une classe (jours)')}
        ${num('max_loans_classe', 'Nombre de livres max. prêtés à une classe')}
        ${num('max_renewals', 'Prolongations autorisées')}
        <label class="check span-2" style="align-self:end"><input type="checkbox" name="block_if_overdue" ${s.block_if_overdue === '1' ? 'checked' : ''}>
          Bloquer les nouveaux prêts tant qu'un livre est en retard</label></div>
      <div class="actions"><button class="btn btn-primary">💾 Enregistrer</button></div></form>
    <div class="card"><h2 style="margin-top:0">Entretien du catalogue</h2>
      <p class="muted">Recalcule la cote de tous les documents selon les règles automatiques (préfixe du genre ou indice Dewey + 3 lettres de l'auteur).
        Attention : les cotes saisies à la main seront remplacées.</p>
      <button class="btn" id="recompute">🔁 Recalculer toutes les cotes</button>
      <h3>Accents abîmés</h3>
      <p class="muted">Certaines notices arrivent avec des accents illisibles (« kilomÃ¨tre » au lieu de « kilomètre »).
        Elles sont maintenant corrigées automatiquement ; ce bouton répare celles déjà enregistrées.</p>
      <button class="btn" id="repair">🩹 Chercher les textes à réparer</button>
      <div id="repair-result"></div></div>
    <div class="card" id="backups"></div>
    <div class="card" id="version"></div>`;
  renderBackups();
  renderVersion();
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    data.block_if_overdue = data.block_if_overdue ? '1' : '0';
    try {
      const saved = await api.put('/settings', data);
      state.settings = saved;
      state.info.school_name = saved.school_name;
      document.title = `${saved.school_name} — BCD`;
      toast('Paramètres enregistrés');
      navigate(location.hash);
    } catch (err) { toast(err.message, 'error'); }
  };
  $('#repair').onclick = async () => {
    const { items } = await api.get('/admin/text-repair');
    const box = $('#repair-result');
    if (!items.length) { box.innerHTML = '<p class="badge badge-ok">✅ Aucun texte abîmé.</p>'; return; }
    box.innerHTML = `<div class="table-wrap" style="margin-top:.6rem"><table class="dense"><thead><tr><th>Avant</th><th>Après</th></tr></thead>
      <tbody>${items.slice(0, 100).map((i) => `<tr><td class="muted">${esc(i.before.slice(0, 120))}</td><td>${esc(i.after.slice(0, 120))}</td></tr>`).join('')}</tbody></table></div>
      ${items.length > 100 ? `<p class="muted small">… et ${items.length - 100} autres.</p>` : ''}
      <div class="actions"><button class="btn btn-primary" id="repair-go">🩹 Réparer ces ${items.length} textes</button></div>`;
    $('#repair-go').onclick = async () => {
      const r = await api.post('/admin/text-repair');
      box.innerHTML = `<p class="badge badge-ok">✅ ${r.repaired} texte(s) réparé(s).</p>`;
    };
  };
  $('#recompute').onclick = async () => {
    if (!confirm('Recalculer toutes les cotes ?')) return;
    const r = await api.post('/documents/recompute-cotes', {});
    toast(`${r.updated} cotes recalculées`);
  };
}

async function renderAccount(app) {
  const u = state.user;
  const { avatars } = await api.get('/meta/avatars');
  app.innerHTML = `<div class="page-head"><h1>Mon compte</h1></div>
    <div class="card"><h2 style="margin-top:0">${u.role === 'eleve' ? 'Choisis ton avatar' : 'Mon avatar'}</h2>
      <div class="avatar-grid" id="avatars">${avatars.map((a) => `<button type="button" data-a="${a}" class="${a === u.avatar ? 'selected' : ''}">${a}</button>`).join('')}</div></div>
    ${u.role !== 'eleve' ? `<form class="card grid" id="pwd" style="max-width:460px"><h2 style="margin-top:0">Changer de mot de passe</h2>
      <label>Mot de passe actuel<input type="password" name="old_password" autocomplete="current-password" required></label>
      <label>Nouveau mot de passe<input type="password" name="new_password" autocomplete="new-password" minlength="6" required></label>
      <div class="actions"><button class="btn btn-primary">Changer</button></div></form>` : ''}`;
  for (const b of $$('#avatars button')) {
    b.onclick = async () => {
      await api.put('/me/avatar', { avatar: b.dataset.a });
      state.user.avatar = b.dataset.a;
      toast(u.role === 'eleve' ? 'Super, ton nouvel avatar est enregistré !' : 'Avatar enregistré');
      navigate(location.hash);
    };
  }
  const pwd = $('#pwd');
  if (pwd) pwd.onsubmit = async (e) => {
    e.preventDefault();
    try { await api.put('/me/password', formData(pwd)); toast('Mot de passe changé'); pwd.reset(); } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- Sauvegardes ---------- */

const KINDS = { 'bcd-auto': 'automatique', 'bcd-manuelle': 'manuelle', 'bcd-avant-restauration': 'avant restauration' };
const kindOf = (name) => (name.startsWith('bcd-avant-version') ? 'avant mise à jour'
  : KINDS[Object.keys(KINDS).find((k) => name.startsWith(k + '_'))] ?? '');
const WARN = 'Toutes les données actuelles seront remplacées par celles de la sauvegarde. Une copie de sécurité de l\'état actuel est faite avant.';

function restored(r) {
  alert(`Restauration terminée : ${r.documents} documents, ${r.users} usagers.\nVeuillez vous reconnecter.`);
  location.hash = '#/connexion';
  location.reload();
}

async function renderBackups() {
  const box = $('#backups');
  const { dir, items } = await api.get('/admin/backups');
  box.innerHTML = `<h2 style="margin-top:0">💾 Sauvegardes</h2>
    <p class="muted">Toutes les données de la BCD (catalogue, élèves, prêts, listes) tiennent dans un seul fichier.
      Pensez à en garder une copie sur une clé USB de temps en temps.</p>
    <div class="row">
      <a class="btn btn-primary" href="/api/admin/backup" download>⬇️ Enregistrer une sauvegarde…</a>
      <label class="btn" style="font-weight:500">📂 Restaurer depuis un fichier…
        <input type="file" id="restore-file" accept=".sqlite,.db" hidden></label>
      ${dir ? '<button class="btn" id="backup-now">💾 Sauvegarder maintenant</button>' : ''}</div>
    ${dir ? `<h3>Sauvegardes enregistrées sur cet ordinateur</h3>
      <p class="small muted">Une sauvegarde est faite automatiquement à chaque fermeture (les 15 dernières sont gardées).<br>
        Dossier : <code>${esc(dir)}</code></p>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th class="num">Taille</th><th></th></tr></thead>
        <tbody>${items.map((b) => `<tr><td>${fmtDate(b.date)} ${new Date(b.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
          <td>${kindOf(b.name)}</td><td class="num">${(b.size / 1024 / 1024).toFixed(1)} Mo</td>
          <td class="num"><button class="btn btn-sm restore" data-name="${esc(b.name)}">Restaurer</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Aucune pour le moment.</p>'}` : ''}`;

  $('#restore-file').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !(await confirmBox(`Restaurer « ${file.name} » ? ${WARN}`, { danger: true, ok: 'Restaurer' }))) return;
    try {
      const res = await fetch('/api/admin/restore', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      restored(data);
    } catch (err) { toast(err.message, 'error'); }
  };
  const now = $('#backup-now');
  if (now) now.onclick = async () => {
    try { await api.post('/admin/backups'); toast('Sauvegarde enregistrée'); renderBackups(); } catch (err) { toast(err.message, 'error'); }
  };
  for (const b of $$('.restore', box)) {
    b.onclick = async () => {
      if (!(await confirmBox(`Restaurer la sauvegarde du ${b.closest('tr').cells[0].textContent} ? ${WARN}`, { danger: true, ok: 'Restaurer' }))) return;
      try { restored(await api.post(`/admin/backups/${encodeURIComponent(b.dataset.name)}/restore`)); } catch (err) { toast(err.message, 'error'); }
    };
  }
}

/* ---------- Version et mises à jour ---------- */

async function renderVersion() {
  const box = $('#version');
  const info = await api.get('/app/info').catch(() => ({ desktop: false }));
  if (!info.desktop) { box.remove(); return; }
  const u = info.update;
  box.innerHTML = `<h2 style="margin-top:0">🔄 Version et mises à jour</h2>
    <p>Version installée : <b>${esc(info.version)}</b>${info.portable ? ' (version sans installation)' : ''}</p>
    ${u?.version ? `<p>🎉 La version <b>${esc(u.version)}</b> est disponible.</p>`
      : info.update_error ? `<p class="muted">Impossible de vérifier les mises à jour : ${esc(info.update_error)}</p>`
      : '<p class="muted">Vous avez la dernière version.</p>'}
    <div class="row">
      ${u?.can_install ? '<button class="btn btn-primary" id="install">⬇️ Installer la mise à jour</button>' : ''}
      <a class="btn" href="${esc(u?.url ?? info.releases_url)}" target="_blank" rel="noopener">🌐 Page de téléchargement (GitHub)</a>
      <button class="btn" id="check">🔁 Vérifier maintenant</button></div>
    <p class="small muted">L'application vérifie seule les nouvelles versions au démarrage. Si l'ordinateur bloque l'installation automatique,
      téléchargez la nouvelle version depuis la page GitHub (installateur ou fichier zip).</p>`;
  const install = $('#install');
  if (install) install.onclick = async () => {
    install.disabled = true;
    install.textContent = 'Téléchargement…';
    try {
      await api.post('/app/install-update');
      box.insertAdjacentHTML('beforeend', '<p class="badge badge-warn">⏳ Installation… l\'application va redémarrer.</p>');
    } catch (e) {
      toast(`${e.message} — utilisez la page de téléchargement`, 'error');
      install.disabled = false;
      install.textContent = 'Réessayer';
    }
  };
  $('#check').onclick = async () => {
    await api.post('/app/check-update').catch(() => {});
    renderVersion();
  };
}

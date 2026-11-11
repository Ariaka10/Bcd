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
    <div class="card" id="covers"></div>
    <div class="card" id="backups"></div>
    <div class="card" id="extra"></div>
    <div class="card" id="version"></div>`;
  renderCovers();
  renderBackups();
  renderExtra();
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
    ${u.role !== 'eleve' ? `<form class="card grid" id="pwd" style="max-width:460px">
      <h2 style="margin-top:0">${u.has_password ? '🔒 Mot de passe' : '🔓 Pas de mot de passe'}</h2>
      ${u.has_password ? '' : '<p class="muted" style="margin:0">Votre carte ouvre votre compte d\'un simple clic. Vous pouvez la protéger par un mot de passe.</p>'}
      ${u.has_password ? '<label>Mot de passe actuel<input type="password" name="old_password" autocomplete="current-password" required></label>' : ''}
      <label>${u.has_password ? 'Nouveau mot de passe' : 'Mot de passe (6 caractères minimum)'}<input type="password" name="new_password" autocomplete="new-password" minlength="6" required></label>
      <div class="actions">
        ${u.has_password && u.role !== 'admin' ? '<button type="button" class="btn btn-ghost" id="remove-pwd" style="margin-right:auto">Retirer le mot de passe</button>' : ''}
        <button class="btn btn-primary">${u.has_password ? 'Changer' : '🔒 Définir'}</button></div></form>` : ''}`;
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
    try {
      await api.put('/me/password', formData(pwd));
      toast(u.has_password ? 'Mot de passe changé' : 'Mot de passe défini 🔒');
      state.user = (await api.get('/me')).user;
      navigate(location.hash);
    } catch (err) { toast(err.message, 'error'); }
  };
  const remove = $('#remove-pwd');
  if (remove) remove.onclick = async () => {
    const old = pwd.old_password.value;
    if (!old) return toast('Tapez d\'abord votre mot de passe actuel', 'error');
    try {
      await api.put('/me/password', { old_password: old, remove: true });
      toast('Mot de passe retiré : votre carte s\'ouvre d\'un clic');
      state.user = (await api.get('/me')).user;
      navigate(location.hash);
    } catch (err) { toast(err.message, 'error'); }
  };
}

/* ---------- Couvertures manquantes ---------- */

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

async function renderCovers() {
  const box = $('#covers');
  if (!box) return; // page quittée entre-temps
  const st = await api.get('/admin/covers');
  const job = st.job;
  const running = job?.running;
  const pct = job?.total ? Math.round((job.done / job.total) * 100) : 0;
  box.innerHTML = `<h2 style="margin-top:0">🖼️ Couvertures des livres</h2>
    <p class="muted">À chaque livre enregistré, l'application cherche sa couverture sur Internet (BnF, Open Library, Google Books${st.amazon ? ', Amazon' : ''})
      et la garde sur l'ordinateur : elle s'affiche ensuite même sans connexion. Seul l'ISBN du livre est envoyé.</p>
    <p>${plural(st.with_cover, 'livre a sa couverture', 'livres ont leur couverture')} sur ${st.total}.
      ${st.to_search ? `<b>${plural(st.to_search, 'livre à chercher', 'livres à chercher')}</b>.` : ''}
      ${st.not_found ? `<span class="muted">${plural(st.not_found, 'introuvable', 'introuvables')} lors d'une recherche précédente.</span>` : ''}
      ${st.no_isbn ? `<span class="muted">${plural(st.no_isbn, 'livre sans ISBN', 'livres sans ISBN')} (photo ou image à ajouter à la main).</span>` : ''}</p>
    ${running ? `<div class="progress"><span style="width:${pct}%"></span></div>
      <p class="small">Recherche en cours : ${job.done} / ${job.total} — ${plural(job.found, 'trouvée', 'trouvées')}.
        Vous pouvez continuer à utiliser l'application.</p>
      <div class="row"><button class="btn" id="covers-stop">⏹️ Arrêter</button></div>`
    : `${job?.finished_at ? `<p class="${job.error ? 'badge badge-late' : 'badge badge-ok'}" style="display:inline-block">
        ${job.error ? esc(job.error) : `${job.stopped ? 'Recherche arrêtée' : 'Recherche terminée'} :
        ${plural(job.found, 'couverture trouvée', 'couvertures trouvées')}, ${plural(job.missing, 'introuvable', 'introuvables')}${job.errors ? `, ${plural(job.errors, 'erreur de connexion', 'erreurs de connexion')}` : ''}.`}</p>` : ''}
      <label class="check" style="margin:.2rem 0 .6rem"><input type="checkbox" id="covers-amazon" ${st.amazon ? 'checked' : ''}>
        Chercher aussi sur <b>Amazon</b> en dernier recours</label>
      <p class="small muted" style="margin-top:-.4rem">Amazon a beaucoup de couvertures d'albums, mais ce n'est pas un service prévu
        pour les logiciels : il peut bloquer si on lui demande trop d'images (la recherche ralentit alors un peu pour l'éviter).
        Un livre manqué à cause d'un blocage peut être retenté plus tard.</p>
      <div class="row">
        <button class="btn btn-primary" id="covers-start" ${st.to_search || st.not_found ? '' : 'disabled'}>🔎 Chercher les couvertures manquantes</button>
        ${st.not_found ? `<label class="check"><input type="checkbox" id="covers-retry" ${st.to_search ? '' : 'checked'}> Réessayer aussi ${st.not_found > 1 ? `les ${st.not_found} introuvables` : 'le livre introuvable'}</label>` : ''}</div>
      <p class="small muted">Un livre à la fois, avec une petite pause (1 à 2 secondes par livre). On peut arrêter et reprendre plus tard.</p>`}`;

  const start = $('#covers-start', box);
  if (start) start.onclick = async () => {
    const retry = $('#covers-retry', box)?.checked ?? false;
    if (!st.to_search && !retry) return toast('Cochez « Réessayer aussi les introuvables »', 'error');
    await api.post('/admin/covers/start', { retry });
    renderCovers();
  };
  const amazon = $('#covers-amazon', box);
  if (amazon) amazon.onchange = async () => {
    try {
      state.settings = await api.put('/settings', { covers_amazon: amazon.checked ? '1' : '0' });
      toast(amazon.checked ? 'Amazon sera utilisé en dernier recours' : 'Amazon ne sera plus utilisé');
    } catch (err) { toast(err.message, 'error'); amazon.checked = !amazon.checked; }
  };
  const stop = $('#covers-stop', box);
  if (stop) stop.onclick = async () => { await api.post('/admin/covers/stop'); renderCovers(); };
  // Suivi de l'avancement tant que la page est affichée.
  if (running) setTimeout(() => { if (box.isConnected) renderCovers(); }, 1500);
}

/* ---------- Sauvegardes ---------- */

const KINDS = { 'bcd-auto': 'à la fermeture', 'bcd-periodique': 'pendant l\'utilisation', 'bcd-manuelle': 'manuelle', 'bcd-avant-restauration': 'avant restauration' };
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
  if (!box) return; // page quittée entre-temps
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
      <p class="small muted">Sauvegardes automatiques : toutes les 30 minutes pendant l'utilisation s'il y a eu des changements (les 12 dernières), et à chaque fermeture (les 15 dernières). Chaque modification est en plus enregistrée immédiatement : une coupure de courant ne fait pas perdre le travail de la journée.<br>
        Dossier : <code>${esc(dir)}</code></p>
      ${items.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th class="num">Taille</th><th></th></tr></thead>
        <tbody>${items.map((b) => `<tr><td>${fmtDate(b.date)} ${new Date(b.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</td>
          <td>${kindOf(b.name)}</td><td class="num">${(b.size / 1024 / 1024).toFixed(1)} Mo</td>
          <td class="num"><button class="btn btn-sm restore" data-name="${esc(b.name)}">Restaurer</button></td></tr>`).join('')}</tbody></table></div>`
        : '<p class="muted">Aucune pour le moment.</p>'}` : ''}`;

  $('#restore-file', box).onchange = async (e) => {
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
  const now = $('#backup-now', box);
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
  if (!box) return; // page quittée entre-temps
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
  const install = $('#install', box);
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
  $('#check', box).onclick = async () => {
    await api.post('/app/check-update').catch(() => {});
    renderVersion();
  };
}

/* ---------- Copie sur clé USB ---------- */

async function renderExtra() {
  const box = $('#extra');
  if (!box) return; // page quittée entre-temps
  const [x, info] = await Promise.all([api.get('/admin/extra-backup'), api.get('/app/info').catch(() => ({}))]);
  const when = x.last ? `${fmtDate(x.last)} à ${new Date(x.last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'jamais';
  box.innerHTML = `<h2 style="margin-top:0">🔑 Copie sur une clé USB</h2>
    <p class="muted">Si l'ordinateur tombe en panne, les sauvegardes qu'il contient sont perdues avec lui.
      Choisissez un dossier sur une clé USB : à chaque fermeture de l'application, si la clé est branchée, une sauvegarde y est copiée
      (les 10 dernières sont gardées). Un rappel s'affiche si aucune copie n'a été faite depuis 7 jours.</p>
    ${x.dir ? `<p>Dossier : <code>${esc(x.dir)}</code>
        ${x.available ? `<span class="badge badge-ok">✅ branchée${x.resolved !== x.dir ? ` (en ${esc(x.resolved.slice(0, 2))})` : ''}</span>`
          : '<span class="badge badge-late">clé non branchée</span>'}<br>
        Dernière copie : <b>${when}</b>${x.days_since >= 7 ? ' <span class="badge badge-late">⚠️ pensez à brancher la clé</span>' : ''}</p>`
      : '<p><span class="badge">Aucun dossier choisi</span></p>'}
    <div class="row">
      ${info.desktop ? '<button class="btn btn-primary" id="choose">📁 Choisir le dossier…</button>'
        : '<input id="dir-input" placeholder="Chemin du dossier, ex. E:\\BCD-sauvegardes" style="max-width:22rem"><button class="btn btn-primary" id="save-dir">Enregistrer</button>'}
      ${x.dir ? `<button class="btn" id="run" ${x.available ? '' : 'disabled'}>💾 Copier maintenant</button>
        <button class="btn btn-ghost" id="stop">Ne plus copier</button>` : ''}</div>`;

  const save = async (dir) => {
    try {
      const r = await api.put('/admin/extra-backup', { dir });
      toast(dir ? (r.available ? 'Dossier enregistré — première copie faite ✅' : 'Dossier enregistré') : 'Copie sur clé désactivée');
      renderExtra();
    } catch (e) { toast(e.message, 'error'); }
  };
  const choose = $('#choose', box);
  if (choose) choose.onclick = async () => {
    const { dir } = await api.post('/app/choose-folder');
    if (dir) save(dir);
  };
  const saveDir = $('#save-dir', box);
  if (saveDir) saveDir.onclick = () => save($('#dir-input', box).value.trim());
  const run = $('#run', box);
  if (run) run.onclick = async () => {
    try { await api.post('/admin/extra-backup/run'); toast('Copie faite sur la clé ✅'); renderExtra(); } catch (e) { toast(e.message, 'error'); }
  };
  const stop = $('#stop', box);
  if (stop) stop.onclick = () => save('');
}

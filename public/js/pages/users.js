import { api, qs } from '../api.js';
import { esc, toast, modal, confirmBox, formData, fmtDate, plural, readTextFile, $, $$ } from '../ui.js';
import { state, navigate, isAdmin } from '../state.js';

const ROLES = { eleve: 'Élève', enseignant: 'Enseignant', admin: 'Administrateur' };
let avatarsCache;
const avatars = async () => (avatarsCache ??= await api.get('/meta/avatars'));

export async function render(app, { path, params, query }) {
  if (path === '/import') return renderImport(app, query);
  if (path.startsWith('/classe/')) return renderClassSheet(app, params[0]);
  if (path === '/classes') return renderClasses(app);
  if (path === '/cartes') return renderCards(app, query);
  if (params.length) return renderUser(app, params[0]);
  return renderList(app, query);
}

function tabs(active) {
  return isAdmin() ? `<div class="tabs no-print">
    <a href="#/usagers" class="${active === 'list' ? 'active' : ''}">👧 Usagers</a>
    <a href="#/classes" class="${active === 'classes' ? 'active' : ''}">🏫 Classes</a>
    <a href="#/import" class="${active === 'import' ? 'active' : ''}">📥 Importer (ONDE / CSV)</a>
    <a href="#/cartes" class="${active === 'cards' ? 'active' : ''}">🪪 Cartes de connexion</a></div>` : '';
}

/* ---------- Liste ---------- */

async function renderList(app, query) {
  const classes = await api.get('/classes');
  if (query.class_id === undefined && state.user.role === 'enseignant') {
    const mine = classes.find((c) => c.teacher_id === state.user.id);
    if (mine) query.class_id = String(mine.id);
  }
  const users = await api.get('/users' + qs({ class_id: query.class_id, role: query.role, q: query.q, active: query.active }));
  const selected = new Set();

  app.innerHTML = `<div class="page-head"><h1>Usagers</h1>
      <div class="row">${isAdmin() ? '<a class="btn" href="#/import">📥 Importer des élèves</a>' : ''}
        ${query.class_id && query.class_id !== 'none' ? `<a class="btn" href="#/classe/${query.class_id}">🏫 Fiche de la classe</a>` : ''}
        <a class="btn" href="#/cartes${qs({ class_id: query.class_id })}">🪪 Cartes de connexion</a>
        <button class="btn btn-primary" id="add">➕ Nouvel usager</button></div></div>
    ${tabs('list')}
    <form class="row card" id="filters" style="margin-bottom:1rem">
      <input name="q" value="${esc(query.q)}" placeholder="Rechercher un nom…" class="grow" style="max-width:280px">
      <select name="class_id" style="width:auto"><option value="">Toutes les classes</option>
        ${classes.map((c) => `<option value="${c.id}" ${String(query.class_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)} (${c.students})</option>`).join('')}
        <option value="none" ${query.class_id === 'none' ? 'selected' : ''}>Sans classe</option></select>
      <select name="role" style="width:auto"><option value="">Tous les profils</option>
        ${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${query.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select name="active" style="width:auto">
        <option value="">Actifs</option><option value="0" ${query.active === '0' ? 'selected' : ''}>Archivés</option>
        <option value="all" ${query.active === 'all' ? 'selected' : ''}>Tous</option></select>
      <button class="btn">Filtrer</button><span class="muted">${plural(users.length, 'usager')}</span></form>
    ${users.length ? `<div class="table-wrap"><table><thead><tr>
      ${isAdmin() ? '<th><input type="checkbox" id="all"></th>' : ''}<th>Nom</th><th>Profil</th><th>Classe</th><th>Né(e) le</th><th class="num">Prêts</th><th></th></tr></thead>
      <tbody>${users.map((u) => `<tr class="${u.active ? '' : 'muted'}">
        ${isAdmin() ? `<td><input type="checkbox" class="sel" value="${u.id}"></td>` : ''}
        <td><a href="#/usager/${u.id}" style="text-decoration:none"><span class="avatar-sm">${esc(u.avatar)}</span> <b>${esc(u.last_name)}</b> ${esc(u.first_name)}</a>
          ${u.has_code ? '<span title="Code secret défini">🔒</span>' : ''}${u.active ? '' : ' <span class="badge">archivé</span>'}</td>
        <td>${ROLES[u.role]}${u.username ? ` <span class="muted small">(${esc(u.username)})</span>` : ''}</td>
        <td>${esc(u.class_name ?? '')}</td><td>${fmtDate(u.birth_date)}</td>
        <td class="num">${u.active_loans ? `<span class="badge ${u.overdue_loans ? 'badge-late' : 'badge-ok'}">${u.active_loans}</span>` : ''}</td>
        <td class="num"><button class="icon-btn edit" data-id="${u.id}" title="Modifier">✏️</button></td></tr>`).join('')}</tbody></table></div>`
    : `<div class="empty">Aucun usager. ${isAdmin() ? '<a href="#/import">Importez la liste de vos élèves depuis ONDE</a>.' : ''}</div>`}
    <div id="selbar"></div>`;

  $('#filters').onsubmit = (e) => { e.preventDefault(); navigate('#/usagers' + qs(formData(e.target))); };
  for (const s of $$('#filters select')) s.onchange = () => $('#filters').requestSubmit();
  $('#add').onclick = () => editUser(null, classes, { class_id: query.class_id !== 'none' ? query.class_id : '' });
  for (const b of $$('.edit')) b.onclick = async () => editUser(await api.get(`/users/${b.dataset.id}`), classes);

  const bar = () => {
    $('#selbar').innerHTML = selected.size ? `<div class="selection-bar"><b>${plural(selected.size, 'sélectionné')}</b><span class="grow"></span>
      <select id="move-to" style="width:auto"><option value="">Changer de classe…</option>
        ${classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      <button class="btn btn-sm" data-batch="archive">📦 Archiver</button>
      <button class="btn btn-sm" data-batch="activate">♻️ Réactiver</button>
      <button class="btn btn-sm btn-danger" data-batch="delete">🗑️ Supprimer</button></div>` : '';
    if (!selected.size) return;
    $('#move-to').onchange = (e) => e.target.value && batch('move', { class_id: e.target.value });
    for (const b of $$('[data-batch]')) b.onclick = () => batch(b.dataset.batch);
  };
  const batch = async (action, extra = {}) => {
    if (action === 'delete' && !(await confirmBox(`Supprimer définitivement ${plural(selected.size, 'usager')} et leur historique ? (Préférez « Archiver » pour les élèves partis.)`, { danger: true, ok: 'Supprimer' }))) return;
    const r = await api.post('/users/batch', { ids: [...selected], action, ...extra });
    toast(`${plural(r.done, 'usager')} mis à jour${r.skipped ? ` · ${r.skipped} ignoré(s) (prêts en cours)` : ''}`);
    navigate(location.hash);
  };
  for (const cb of $$('.sel')) cb.onchange = () => { cb.checked ? selected.add(Number(cb.value)) : selected.delete(Number(cb.value)); bar(); };
  const all = $('#all');
  if (all) all.onchange = () => { for (const cb of $$('.sel')) { cb.checked = all.checked; all.checked ? selected.add(Number(cb.value)) : selected.delete(Number(cb.value)); } bar(); };
}

/* ---------- Création / modification ---------- */

async function editUser(u, classes, defaults = {}) {
  const { avatars: av, code_symbols: symbols } = await avatars();
  const isNew = !u;
  u ??= { role: 'eleve', active: 1, avatar: av[Math.floor(Math.random() * av.length)], ...defaults };
  let avatar = u.avatar;
  let code = u.secret_code ? splitCode(u.secret_code, symbols) : [];
  const canAdult = isAdmin();
  const dlg = modal(isNew ? 'Nouvel usager' : `${u.first_name} ${u.last_name}`, `<form class="grid" id="f">
    <div class="grid grid-2">
      <label>Prénom *<input name="first_name" value="${esc(u.first_name ?? '')}" required></label>
      <label>Nom *<input name="last_name" value="${esc(u.last_name ?? '')}" required></label>
      <label>Profil<select name="role" ${canAdult ? '' : 'disabled'}>${Object.entries(ROLES).map(([k, l]) =>
        `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label>Classe<select name="class_id"><option value="">—</option>${classes.map((c) =>
        `<option value="${c.id}" ${String(u.class_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="kid-only">Date de naissance<input type="date" name="birth_date" value="${esc(u.birth_date ?? '')}"></label>
      <label class="adult-only">Identifiant de connexion<input name="username" value="${esc(u.username ?? '')}" autocomplete="off"></label>
      <label class="adult-only">${isNew ? 'Mot de passe *' : 'Nouveau mot de passe'}<input name="password" type="password" autocomplete="new-password" minlength="6"></label>
      <label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Compte actif</label>
    </div>
    <div><b>Avatar</b><div class="avatar-grid" id="avatars" style="margin-top:.4rem">${av.map((a) =>
      `<button type="button" data-a="${a}" class="${a === avatar ? 'selected' : ''}">${a}</button>`).join('')}</div></div>
    ${isAdmin() ? `<div class="kid-only"><b>Code secret</b> <span class="muted small">— facultatif : 2 à 4 pictogrammes que l'élève touche pour se connecter</span>
      <div class="code-dots" id="code"></div>
      <div class="symbols">${symbols.map((s) => `<button type="button" data-s="${s}">${s}</button>`).join('')}</div>
      <div class="row" style="margin-top:.5rem"><button type="button" class="btn btn-sm" id="code-clear">Aucun code</button>
        <button type="button" class="btn btn-sm" id="code-random">🎲 Code au hasard</button></div></div>` : ''}
    <div class="actions">${!isNew && isAdmin() && u.id !== state.user.id ? '<button type="button" class="btn btn-danger" id="del" style="margin-right:auto">Supprimer</button>' : ''}
      <button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`);

  const form = $('#f', dlg);
  const syncRole = () => {
    const kid = form.role.value === 'eleve';
    for (const el of $$('.kid-only', dlg)) el.style.display = kid ? '' : 'none';
    for (const el of $$('.adult-only', dlg)) el.style.display = kid ? 'none' : '';
  };
  form.role.onchange = syncRole;
  syncRole();
  for (const b of $$('#avatars button', dlg)) {
    b.onclick = () => { avatar = b.dataset.a; for (const x of $$('#avatars button', dlg)) x.classList.toggle('selected', x === b); };
  }
  const drawCode = () => { const el = $('#code', dlg); if (el) el.innerHTML = code.map((s) => `<span>${s}</span>`).join('') || '<span class="muted small" style="width:auto">aucun</span>'; };
  drawCode();
  for (const b of $$('.symbols button', dlg)) b.onclick = () => { if (code.length >= 4) code = []; code.push(b.dataset.s); drawCode(); };
  if ($('#code-clear', dlg)) {
    $('#code-clear', dlg).onclick = () => { code = []; drawCode(); };
    $('#code-random', dlg).onclick = () => { code = [0, 1].map(() => symbols[Math.floor(Math.random() * symbols.length)]); drawCode(); };
  }
  if ($('#del', dlg)) $('#del', dlg).onclick = async () => {
    if (!(await confirmBox(`Supprimer ${u.first_name} ${u.last_name} ?`, { danger: true, ok: 'Supprimer' }))) return;
    try { await api.del(`/users/${u.id}`); dlg.close(); toast('Usager supprimé'); navigate('#/usagers'); } catch (e) { toast(e.message, 'error'); }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = { ...formData(form), avatar };
    if (!canAdult) data.role = u.role;
    if (isAdmin() && data.role === 'eleve') {
      if (code.length === 1) return toast('Le code secret doit contenir au moins 2 pictogrammes', 'error');
      data.secret_code = code.length ? code : null;
    }
    if (!data.password) delete data.password;
    try {
      if (isNew) await api.post('/users', data); else await api.put(`/users/${u.id}`, data);
      dlg.close();
      toast('Enregistré');
      navigate(location.hash);
    } catch (err) { toast(err.message, 'error'); }
  };
}

function splitCode(code, symbols) {
  const out = [];
  let rest = code;
  while (rest) {
    const s = symbols.find((x) => rest.startsWith(x));
    if (!s) break;
    out.push(s); rest = rest.slice(s.length);
  }
  return out;
}

/* ---------- Fiche usager ---------- */

/** Début de l'année scolaire en cours (1er septembre). */
function schoolYearStart() {
  const d = new Date();
  const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1;
  return { start: `${y}-09-01`, label: `${y}-${y + 1}` };
}

async function renderUser(app, id) {
  const [u, classes] = await Promise.all([api.get(`/users/${id}`), api.get('/classes')]);
  const { start, label } = schoolYearStart();
  const thisYear = u.history.filter((l) => l.loaned_at >= start);
  app.innerHTML = `<div class="page-head no-print"><a href="javascript:history.back()" class="btn btn-ghost">← Retour</a>
      <div class="row"><button class="btn" id="edit">✏️ Modifier</button>
      ${u.class_id ? `<a class="btn" href="#/classe/${u.class_id}">🏫 Fiche de la classe</a>` : ''}
      <button class="btn" onclick="window.print()">🖨️ Imprimer la fiche</button>
      <a class="btn btn-primary" href="#/prets" id="lend">📤 Prêter un livre</a></div></div>
    <p class="print-only small">${esc(state.info.school_name)} — Bibliothèque — fiche du ${new Date().toLocaleDateString('fr-FR')}</p>
    <div class="card"><div class="borrower" style="margin:0"><span class="avatar-lg">${esc(u.avatar)}</span>
      <div><h1 style="margin:0">${esc(u.first_name)} ${esc(u.last_name)}</h1>
      <span class="muted">${ROLES[u.role]}${u.class_name ? ' · ' + esc(u.class_name) : ''}${u.birth_date ? ' · né(e) le ' + fmtDate(u.birth_date) : ''}
      ${u.active ? '' : ' · <b>compte archivé</b>'}</span></div></div></div>
    ${u.reservations?.length ? `<div class="card"><h2 style="margin-top:0">🔖 Réservations</h2><ul class="log">${u.reservations.map((r) =>
      `<li class="${r.status === 'prete' ? 'warn' : ''}"><a href="#/document/${r.document_id}">${esc(r.title)}</a> —
        ${r.status === 'prete' ? '<b>mis de côté, à lui remettre</b>' : 'en attente du retour'}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h2 style="margin-top:0">📖 Livres empruntés en ce moment (${u.loans.length})</h2>
      ${u.loans.length ? `<ul class="log">${u.loans.map((l) => `<li class="${l.overdue ? 'err' : ''}">
        <a href="#/document/${l.document_id}">${esc(l.title)}</a> <span class="muted small">n° ${esc(l.barcode ?? '')}</span>
        — prêté le ${fmtDate(l.loaned_at)}, ${l.overdue ? `<b>en retard de ${plural(l.days_late, 'jour')}</b>` : `à rendre le ${fmtDate(l.due_at)}`}
        <button class="btn btn-sm ret no-print" data-id="${l.id}" style="float:right">Retour</button></li>`).join('')}</ul>` : '<p class="muted">Aucun.</p>'}</div>
    <div class="card"><h2 style="margin-top:0">📜 Carnet de lecteur ${esc(label)} <span class="muted small">(${plural(thisYear.length, 'livre lu', 'livres lus')})</span></h2>
      ${thisYear.length ? `<table class="dense"><thead><tr><th>Livre</th><th>Emprunté le</th><th>Rendu le</th></tr></thead><tbody>
      ${thisYear.map((l) => `<tr><td>${esc(l.title)}${l.lost ? ' <span class="badge badge-late">perdu</span>' : ''}</td>
        <td>${fmtDate(l.loaned_at)}</td><td>${fmtDate(l.returned_at)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Aucun livre rendu cette année pour le moment.</p>'}</div>
    ${u.history.length > thisYear.length ? `<details class="card no-print"><summary><b>Années précédentes</b> (${u.history.length - thisYear.length})</summary>
      <ul>${u.history.filter((l) => l.loaned_at < start).map((l) => `<li>${esc(l.title)} <span class="muted small">— ${fmtDate(l.loaned_at)}</span></li>`).join('')}</ul></details>` : ''}`;
  $('#edit').onclick = () => editUser(u, classes);
  for (const b of $$('.ret')) b.onclick = async () => { await api.post('/loans/return', { loan_id: Number(b.dataset.id) }); toast('Retour enregistré'); navigate(location.hash); };
}

/* ---------- Fiche classe (imprimable) ---------- */

async function renderClassSheet(app, id) {
  const classes = await api.get('/classes');
  const cls = classes.find((c) => c.id === Number(id));
  if (!cls) { app.innerHTML = '<div class="empty">Classe introuvable.</div>'; return; }
  const [students, loans] = await Promise.all([
    api.get(`/users?class_id=${cls.id}&role=eleve`),
    api.get(`/loans?class_id=${cls.id}&limit=2000`),
  ]);
  const byUser = new Map();
  for (const l of loans) if (l.user_id) (byUser.get(l.user_id) ?? byUser.set(l.user_id, []).get(l.user_id)).push(l);
  const classLoans = loans.filter((l) => !l.user_id);
  const late = loans.filter((l) => l.overdue).length;
  app.innerHTML = `<div class="page-head no-print"><a href="javascript:history.back()" class="btn btn-ghost">← Retour</a>
      <div class="row"><select id="cls" style="width:auto">${classes.map((c) => `<option value="${c.id}" ${c.id === cls.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <a class="btn" href="#/cartes?class_id=${cls.id}">🪪 Cartes de connexion</a>
        <button class="btn btn-primary" onclick="window.print()">🖨️ Imprimer</button></div></div>
    <div class="card">
      <h1 style="margin-bottom:.2rem">🏫 ${esc(cls.name)}</h1>
      <p class="muted">${esc(state.info.school_name)}${cls.teacher_name ? ` · ${esc(cls.teacher_name)}` : ''} ·
        ${plural(students.length, 'élève')} · ${plural(loans.length, 'livre')} en prêt${late ? ` · <b class="text-late">${plural(late, 'retard')}</b>` : ''}
        · le ${new Date().toLocaleDateString('fr-FR')}</p>
      <table class="dense class-sheet"><thead><tr><th>Élève</th><th>Livre(s) empruntés</th><th>N°</th><th>À rendre le</th><th class="print-only">Rendu ✓</th></tr></thead>
      <tbody>${students.map((u) => {
        const list = byUser.get(u.id) ?? [];
        const name = `<a href="#/usager/${u.id}">${esc(u.avatar)} <b>${esc(u.first_name)}</b> ${esc(u.last_name)}</a>`;
        if (!list.length) return `<tr><td>${name}</td><td class="muted">—</td><td></td><td></td><td class="print-only"></td></tr>`;
        return list.map((l, i) => `<tr class="${l.overdue ? 'row-late' : ''}">${i === 0 ? `<td rowspan="${list.length}">${name}</td>` : ''}
          <td>${esc(l.title)}</td><td>${esc(l.barcode ?? '')}</td>
          <td class="nowrap">${fmtDate(l.due_at)}${l.overdue ? ` <span class="badge badge-late">+${l.days_late} j</span>` : ''}</td><td class="print-only">☐</td></tr>`).join('');
      }).join('') || '<tr><td colspan="4" class="muted">Aucun élève dans cette classe.</td></tr>'}</tbody></table>
      ${classLoans.length ? `<h2>📦 Livres prêtés à toute la classe (${classLoans.length})</h2>
        <table class="dense"><thead><tr><th>Livre</th><th>N°</th><th>À rendre le</th><th class="print-only">Rendu ✓</th></tr></thead>
        <tbody>${classLoans.map((l) => `<tr class="${l.overdue ? 'row-late' : ''}"><td>${esc(l.title)}</td><td>${esc(l.barcode ?? '')}</td>
          <td>${fmtDate(l.due_at)}</td><td class="print-only">☐</td></tr>`).join('')}</tbody></table>` : ''}
    </div>`;
  $('#cls').onchange = (e) => navigate(`#/classe/${e.target.value}`);
}

/* ---------- Classes ---------- */

async function renderClasses(app) {
  const [classes, teachers] = await Promise.all([api.get('/classes'), api.get('/users?role=enseignant')]);
  const admins = await api.get('/users?role=admin');
  const adults = [...teachers, ...admins];
  app.innerHTML = `<div class="page-head"><h1>Classes</h1><button class="btn btn-primary" id="add">➕ Nouvelle classe</button></div>
    ${tabs('classes')}
    ${classes.length ? `<div class="table-wrap"><table><thead><tr><th>Classe</th><th>Niveau</th><th>Enseignant</th><th class="num">Élèves</th><th class="num">Prêts en cours</th><th></th></tr></thead>
    <tbody>${classes.map((c) => `<tr><td><a href="#/classe/${c.id}"><b>${esc(c.name)}</b></a> <a class="small" href="#/usagers?class_id=${c.id}">(élèves)</a></td><td>${esc(c.level ?? '')}</td>
      <td>${esc(c.teacher_name ?? '')}</td><td class="num">${c.students}</td><td class="num">${c.active_loans}</td>
      <td class="num nowrap"><button class="icon-btn edit" data-id="${c.id}">✏️</button><button class="icon-btn del" data-id="${c.id}">🗑️</button></td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">Aucune classe. Elles sont créées automatiquement lors de l\'import ONDE.</div>'}`;

  const edit = (c = {}) => {
    const dlg = modal(c.id ? 'Modifier la classe' : 'Nouvelle classe', `<form class="grid" id="f">
      <label>Nom<input name="name" value="${esc(c.name ?? '')}" required placeholder="CE1 A"></label>
      <label>Niveau<input name="level" value="${esc(c.level ?? '')}" placeholder="CE1"></label>
      <label>Enseignant<select name="teacher_id"><option value="">—</option>${adults.map((t) =>
        `<option value="${t.id}" ${c.teacher_id === t.id ? 'selected' : ''}>${esc(t.first_name)} ${esc(t.last_name)}</option>`).join('')}</select></label>
      <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary">Enregistrer</button></div></form>`);
    $('#f', dlg).onsubmit = async (e) => {
      e.preventDefault();
      try {
        const data = formData(e.target);
        if (c.id) await api.put(`/classes/${c.id}`, data); else await api.post('/classes', data);
        dlg.close(); navigate(location.hash);
      } catch (err) { toast(err.message, 'error'); }
    };
  };
  $('#add').onclick = () => edit();
  for (const b of $$('.edit')) b.onclick = () => edit(classes.find((c) => c.id === Number(b.dataset.id)));
  for (const b of $$('.del')) {
    b.onclick = async () => {
      const c = classes.find((x) => x.id === Number(b.dataset.id));
      if (!(await confirmBox(`Supprimer la classe ${c.name} ? Ses ${c.students} élève(s) resteront, sans classe.`, { danger: true, ok: 'Supprimer' }))) return;
      await api.del(`/classes/${c.id}`); navigate(location.hash);
    };
  }
}

/* ---------- Import ONDE / CSV ---------- */

async function renderImport(app, query = {}) {
  const classes = await api.get('/classes');
  app.innerHTML = `<div class="page-head"><h1>Importer des élèves</h1></div>
    ${tabs('import')}
    <div class="card">
      <h2 style="margin-top:0">Depuis ONDE</h2>
      <ol class="small">
        <li>Dans ONDE, menu <b>Élèves → Listes et extractions</b>, choisissez <b>Extraction</b> (ou « Exports CSV »).</li>
        <li>Sélectionnez l'année scolaire, toutes les classes, puis cochez au minimum <i>Nom, Prénom, Date de naissance, Niveau, Classe</i>.</li>
        <li>Enregistrez le fichier <b>.csv</b> puis déposez-le ci-dessous.</li></ol>
      <p class="small muted">Tout autre fichier CSV (séparateur « ; » ou « , ») convient s'il contient au moins les colonnes <b>Nom</b> et <b>Prénom</b>
        (et <b>Classe</b>, sinon choisissez la classe de destination). Les classes manquantes sont créées automatiquement.</p>
      <form class="grid grid-2" id="f">
        <label class="span-2">Fichier<input type="file" name="file" accept=".csv,.txt,text/csv" required></label>
        <label>Classe de destination (si le fichier n'a pas de colonne « Classe »)
          <input name="class_name" list="classes" placeholder="Ex. : CP"><datalist id="classes">${classes.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
        <label class="check" style="align-self:end"><input type="checkbox" name="archive_missing" ${query.rentree ? 'checked' : ''}>
          Archiver les élèves absents du fichier (élèves partis — à utiliser à la rentrée avec la liste complète de l'école)</label>
        <div class="span-2 row"><button class="btn btn-primary">👀 Prévisualiser</button></div>
      </form></div>
    <div id="preview"></div>`;

  let text = '';
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    text = await readTextFile(f.file.files[0]);
    const opts = { class_name: f.class_name.value.trim(), archive_missing: f.archive_missing.checked };
    try {
      const r = await api.post('/users/import', { text, ...opts, dry_run: true });
      showReport(r, true, async () => {
        const done = await api.post('/users/import', { text, ...opts });
        showReport(done, false);
        toast('Import terminé');
      });
    } catch (err) { toast(err.message, 'error'); }
  };
}

function showReport(r, dry, onConfirm) {
  const section = (title, items, cls = '') => items.length ? `<details ${items.length < 30 ? 'open' : ''}><summary><b>${title} (${items.length})</b></summary>
    <ul class="log">${items.map((i) => `<li class="${cls}">${esc(i)}</li>`).join('')}</ul></details>` : '';
  $('#preview').innerHTML = `<div class="card">
    <h2 style="margin-top:0">${dry ? 'Aperçu de l\'import' : '✅ Import réalisé'}</h2>
    ${Object.keys(r.columns ?? {}).length ? `<p class="small muted">Colonnes reconnues : ${Object.entries(r.columns).map(([k, v]) => `${esc(v)}`).join(' · ')}</p>` : ''}
    <div class="stats">
      <div class="stat"><b>${r.created.length}</b><span>nouveaux élèves</span></div>
      <div class="stat"><b>${r.moved.length}</b><span>changements de classe</span></div>
      <div class="stat"><b>${r.unchanged}</b><span>inchangés</span></div>
      <div class="stat"><b>${r.archived.length}</b><span>à archiver</span></div>
      <div class="stat"><b>${r.new_classes.length}</b><span>classes créées</span></div></div>
    ${r.errors.length ? section('⚠️ Problèmes', r.errors, 'err') : ''}
    ${section('Classes créées', r.new_classes)}
    ${section('Nouveaux élèves', r.created, 'ok')}
    ${section('Changements de classe', r.moved, 'warn')}
    ${section('Élèves archivés', r.archived)}
    ${dry ? `<div class="actions"><button class="btn btn-primary btn-lg" id="go" ${r.total ? '' : 'disabled'}>✅ Confirmer l'import</button></div>`
      : `<div class="actions">${location.hash.includes('rentree') ? '<a class="btn btn-primary" href="#/rentree">↩️ Revenir à l\'assistant de rentrée</a>' : ''}
        <a class="btn" href="#/usagers">Voir les usagers</a><a class="btn btn-primary" href="#/cartes">🪪 Imprimer les cartes de connexion</a></div>`}
  </div>`;
  if (dry) $('#go').onclick = onConfirm;
}

/* ---------- Cartes de connexion à imprimer ---------- */

async function renderCards(app, query) {
  const classes = await api.get('/classes');
  const classId = query.class_id || classes[0]?.id;
  const users = classId ? await api.get('/users' + qs({ class_id: classId, role: 'eleve' })) : [];
  const full = isAdmin() ? await Promise.all(users.map((u) => api.get(`/users/${u.id}`))) : users;
  const cls = classes.find((c) => String(c.id) === String(classId));
  app.innerHTML = `<div class="page-head no-print"><h1>Cartes de connexion</h1>
      <div class="row"><select id="cls" style="width:auto">${classes.map((c) => `<option value="${c.id}" ${String(c.id) === String(classId) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="btn btn-primary" onclick="window.print()">🖨️ Imprimer</button></div></div>
    ${tabs('cards')}
    <p class="muted no-print">Chaque élève choisit sa classe, touche son avatar puis, s'il en a un, tape son code secret. Découpez et distribuez les cartes.</p>
    ${full.length ? `<div class="cards-print">${full.map((u) => `<div class="login-card">
      <div class="small">${esc(state.info.school_name)} · ${esc(cls?.name ?? '')}</div>
      <div class="avatar">${esc(u.avatar)}</div><div class="name">${esc(u.first_name)} ${esc(u.last_name[0] ?? '')}.</div>
      ${u.secret_code ? `<div class="small">Mon code secret :</div><div class="code">${esc(u.secret_code)}</div>`
        : u.has_code ? '<div class="small muted">Code secret : voir l\'administrateur</div>' : '<div class="small muted">Pas de code secret</div>'}
    </div>`).join('')}</div>` : '<div class="empty">Aucun élève dans cette classe.</div>'}`;
  const sel = $('#cls');
  if (sel) sel.onchange = () => navigate('#/cartes?class_id=' + sel.value);
}

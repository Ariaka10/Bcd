import { api, qs } from '../api.js';
import { esc, toast, confirmBox, fmtDate, plural, $, $$, debounce } from '../ui.js';
import { state, navigate } from '../state.js';

let borrower = null;
const log = [];

export async function render(app, { path, query }) {
  const tab = path === '/retards' ? 'late' : (query.vue ?? 'desk');
  app.innerHTML = `<div class="page-head"><h1>Prêts et retours</h1></div>
    <div class="tabs no-print">
      <a href="#/prets" class="${tab === 'desk' ? 'active' : ''}">🛎️ Comptoir</a>
      <a href="#/prets?vue=current" class="${tab === 'current' ? 'active' : ''}">📖 Prêts en cours</a>
      <a href="#/retards" class="${tab === 'late' ? 'active' : ''}">⏰ Retards</a>
      <a href="#/prets?vue=history" class="${tab === 'history' ? 'active' : ''}">🕓 Historique</a></div>
    <div id="tab"></div>`;
  const el = $('#tab');
  if (tab === 'desk') return desk(el);
  if (tab === 'late') return overdue(el, query);
  return loanTable(el, query, tab);
}

/* ---------- Comptoir ---------- */

async function desk(el) {
  const classes = await api.get('/classes');
  el.innerHTML = `<div class="desk">
    <section class="card"><h2 style="margin-top:0">📤 Emprunter</h2>
      <label>1. Emprunteur
        <input id="who" placeholder="Nom ou prénom…" autocomplete="off"></label>
      <div id="who-suggest"></div>
      ${classes.length ? `<div class="row small" style="margin-top:.4rem"><span class="muted">ou par classe :</span>
        ${classes.map((c) => `<button class="btn btn-sm class-pick" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : ''}
      <div id="borrower"></div>
      <form id="loan-form" style="margin-top:.6rem">
        <label>2. Scanner le livre (code-barres de l'exemplaire ou ISBN)
          <input id="loan-code" class="scan-input" autocomplete="off" disabled placeholder="Choisissez d'abord l'emprunteur"></label></form>
    </section>
    <section class="card"><h2 style="margin-top:0">📥 Rendre</h2>
      <form id="return-form"><label>Scanner le livre rendu
        <input id="return-code" class="scan-input" autocomplete="off" placeholder="Code-barres ou ISBN"></label></form>
      <h3>Opérations de la séance</h3>
      <ul class="log" id="log"></ul>
    </section></div>`;

  const who = $('#who');
  const suggest = $('#who-suggest');
  const search = debounce(async () => {
    const q = who.value.trim();
    if (q.length < 2) { suggest.innerHTML = ''; return; }
    const users = await api.get('/users' + qs({ q, limit: 12 }));
    suggest.innerHTML = users.length ? `<div class="suggest">${users.map((u) => `<button type="button" data-id="${u.id}">
      <span class="avatar-sm">${esc(u.avatar)}</span><span class="grow">${esc(u.first_name)} ${esc(u.last_name)}</span>
      <span class="muted small">${esc(u.class_name ?? roleLabel(u.role))}</span></button>`).join('')}</div>` : '<p class="muted small">Personne trouvé.</p>';
    for (const b of $$('button', suggest)) b.onclick = () => selectBorrower(b.dataset.id);
  }, 200);
  who.oninput = search;
  who.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('button', suggest)?.click(); } };

  for (const b of $$('.class-pick')) {
    b.onclick = async () => {
      const users = await api.get('/users' + qs({ class_id: b.dataset.id, role: 'eleve' }));
      suggest.innerHTML = `<div class="kid-grid" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));margin-top:.6rem">
        ${users.map((u) => `<button type="button" class="kid-btn" data-id="${u.id}" style="font-size:.95rem;padding:.6rem .3rem">
          <span class="avatar" style="font-size:2rem">${esc(u.avatar)}</span>${esc(u.first_name)} ${esc(u.last_name[0] ?? '')}.
          ${u.active_loans ? `<span class="badge ${u.overdue_loans ? 'badge-late' : ''}">${u.active_loans} 📖</span>` : ''}</button>`).join('')}</div>`;
      for (const k of $$('.kid-btn', suggest)) k.onclick = () => selectBorrower(k.dataset.id);
    };
  }

  $('#loan-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#loan-code');
    const code = input.value.trim();
    if (!code || !borrower) return;
    input.value = '';
    try {
      const r = await api.post('/loans', { user_id: borrower.id, barcode: code });
      addLog('ok', `📤 « ${r.title} » prêté à ${borrower.first_name} — retour le ${fmtDate(r.due_at)}`);
      await selectBorrower(borrower.id, true);
    } catch (err) {
      addLog('err', `${code} : ${err.message}`);
      toast(err.message, 'error');
    }
    input.focus();
  };

  $('#return-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#return-code');
    const code = input.value.trim();
    if (!code) return;
    input.value = '';
    try {
      const r = await api.post('/loans/return', { barcode: code });
      addLog(r.days_late ? 'warn' : 'ok', `📥 « ${r.title} » rendu par ${r.first_name} ${r.last_name}${r.days_late ? ` — ${plural(r.days_late, 'jour')} de retard` : ''}`);
      if (borrower) await selectBorrower(borrower.id, true);
    } catch (err) {
      addLog('err', `${code} : ${err.message}`);
      toast(err.message, 'error');
    }
    input.focus();
  };

  drawLog();
  if (borrower) selectBorrower(borrower.id, true);
  else who.focus();
}

function roleLabel(r) {
  return { admin: 'Administrateur', enseignant: 'Enseignant', eleve: 'Élève' }[r] ?? r;
}

async function selectBorrower(id, keepFocus) {
  const u = await api.get(`/users/${id}`);
  borrower = u;
  const settings = state.settings ?? (state.settings = await api.get('/settings'));
  const max = Number(settings[`max_loans_${u.role}`] ?? 2);
  const late = u.loans.filter((l) => l.overdue);
  $('#who-suggest').innerHTML = '';
  $('#who').value = '';
  $('#borrower').innerHTML = `<div class="borrower">
      <span class="avatar-lg">${esc(u.avatar)}</span>
      <div class="grow"><b>${esc(u.first_name)} ${esc(u.last_name)}</b><br>
        <span class="muted small">${esc(u.class_name ?? roleLabel(u.role))} · ${u.loans.length}/${max} prêt(s)</span>
        ${late.length ? `<br><span class="badge badge-late">⚠️ ${plural(late.length, 'retard')}</span>` : ''}</div>
      <button class="icon-btn" id="clear-borrower" title="Changer d'emprunteur">✕</button></div>
    ${u.loans.length ? `<ul class="log">${u.loans.map((l) => `<li class="${l.overdue ? 'err' : ''}">📖 ${esc(l.title)}
      <span class="muted small">— ${l.overdue ? `en retard de ${plural(l.days_late, 'jour')}` : `à rendre le ${fmtDate(l.due_at)}`}</span></li>`).join('')}</ul>` : ''}`;
  $('#clear-borrower').onclick = () => {
    borrower = null;
    $('#borrower').innerHTML = '';
    $('#loan-code').disabled = true;
    $('#who').focus();
  };
  const input = $('#loan-code');
  input.disabled = false;
  input.placeholder = 'Scanner le code-barres…';
  if (!keepFocus || document.activeElement !== $('#return-code')) input.focus();
}

function addLog(cls, text) {
  log.unshift({ cls, text, at: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) });
  log.length = Math.min(log.length, 40);
  drawLog();
}

function drawLog() {
  const el = $('#log');
  if (el) el.innerHTML = log.map((l) => `<li class="${l.cls}"><span class="muted small">${l.at}</span> ${esc(l.text)}</li>`).join('')
    || '<li class="muted">Rien pour le moment.</li>';
}

/* ---------- Tableaux de prêts ---------- */

async function loanTable(el, query, tab) {
  const classes = await api.get('/classes');
  const loans = await api.get('/loans' + qs({ status: tab === 'history' ? 'history' : 'current', class_id: query.class_id, limit: tab === 'history' ? 300 : 2000 }));
  el.innerHTML = `<div class="row no-print" style="margin-bottom:.8rem">
      <select id="class-filter" style="width:auto"><option value="">Toutes les classes</option>
        ${classes.map((c) => `<option value="${c.id}" ${String(query.class_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <span class="muted">${plural(loans.length, 'prêt')}</span><span class="grow"></span>
      <button class="btn" onclick="window.print()">🖨️ Imprimer</button></div>
    ${loans.length ? `<div class="table-wrap"><table><thead><tr><th>Emprunteur</th><th>Classe</th><th>Document</th><th>Code-barres</th>
      <th>Prêté le</th><th>${tab === 'history' ? 'Rendu le' : 'À rendre le'}</th>${tab === 'history' ? '' : '<th class="no-print"></th>'}</tr></thead>
      <tbody>${loans.map((l) => `<tr>
        <td><a href="#/usager/${l.user_id}">${esc(l.avatar)} ${esc(l.first_name)} ${esc(l.last_name)}</a></td>
        <td>${esc(l.class_name ?? '')}</td>
        <td>${l.document_id ? `<a href="#/document/${l.document_id}">${esc(l.title)}</a>` : esc(l.title)} <span class="cote small">${esc(l.cote ?? '')}</span></td>
        <td class="small">${esc(l.barcode ?? '')}</td>
        <td class="nowrap">${fmtDate(l.loaned_at)}</td>
        <td class="nowrap">${tab === 'history' ? `${fmtDate(l.returned_at)}${l.lost ? ' <span class="badge badge-late">perdu</span>' : ''}`
          : `${fmtDate(l.due_at)} ${l.overdue ? `<span class="badge badge-late">+${l.days_late} j</span>` : ''}`}</td>
        ${tab === 'history' ? '' : `<td class="no-print nowrap">
          <button class="btn btn-sm act" data-act="return" data-id="${l.id}">Retour</button>
          <button class="btn btn-sm act" data-act="renew" data-id="${l.id}" title="Prolonger">⏩</button>
          <button class="btn btn-sm act" data-act="lost" data-id="${l.id}" title="Déclarer perdu">❓</button></td>`}
      </tr>`).join('')}</tbody></table></div>` : '<div class="empty">Aucun prêt.</div>'}`;

  $('#class-filter').onchange = (e) => navigate('#/prets' + qs({ vue: tab, class_id: e.target.value }));
  bindLoanActions(el);
}

function bindLoanActions(el) {
  for (const b of $$('.act', el)) {
    b.onclick = async () => {
      const id = Number(b.dataset.id);
      try {
        if (b.dataset.act === 'return') { await api.post('/loans/return', { loan_id: id }); toast('Retour enregistré'); }
        if (b.dataset.act === 'renew') { const r = await api.post(`/loans/${id}/renew`); toast(`Prolongé jusqu'au ${fmtDate(r.due_at)}`); }
        if (b.dataset.act === 'lost') {
          if (!(await confirmBox('Déclarer ce livre perdu ? Le prêt sera clôturé et l\'exemplaire marqué « perdu ».', { danger: true, ok: 'Déclarer perdu' }))) return;
          await api.post('/loans/return', { loan_id: id, lost: true }); toast('Exemplaire déclaré perdu');
        }
        navigate(location.hash);
      } catch (e) { toast(e.message, 'error'); }
    };
  }
}

/* ---------- Retards ---------- */

async function overdue(el, query) {
  const loans = await api.get('/loans' + qs({ status: 'overdue' }));
  const byClass = new Map();
  for (const l of loans) {
    const k = l.class_name ?? (l.role === 'eleve' ? 'Sans classe' : 'Adultes');
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push(l);
  }
  const mode = query.mode ?? 'table';
  el.innerHTML = `<div class="row no-print" style="margin-bottom:.8rem">
      <span class="muted">${plural(loans.length, 'livre')} en retard</span><span class="grow"></span>
      <a class="btn" href="#/retards${mode === 'slips' ? '' : '?mode=slips'}">${mode === 'slips' ? '📋 Vue tableau' : '✉️ Mots pour les familles'}</a>
      <a class="btn" href="/api/loans/overdue.csv" download>⬇️ CSV</a>
      <button class="btn btn-primary" onclick="window.print()">🖨️ Imprimer</button></div>
    ${!loans.length ? '<div class="empty">🎉 Aucun retard !</div>' : mode === 'slips' ? slips(loans) : [...byClass].map(([cls, list]) => `
      <div class="card" style="break-inside:avoid"><h2 style="margin-top:0">${esc(cls)} <span class="muted small">(${list.length})</span></h2>
      <div class="table-wrap"><table><thead><tr><th>Élève</th><th>Document</th><th>Cote</th><th>À rendre le</th><th class="num">Retard</th><th class="no-print"></th></tr></thead>
      <tbody>${list.map((l) => `<tr><td>${esc(l.avatar)} ${esc(l.first_name)} ${esc(l.last_name)}</td><td>${esc(l.title)}</td>
        <td><span class="cote small">${esc(l.cote ?? '')}</span></td><td>${fmtDate(l.due_at)}</td>
        <td class="num"><span class="badge badge-late">${plural(l.days_late, 'jour')}</span></td>
        <td class="no-print nowrap"><button class="btn btn-sm act" data-act="return" data-id="${l.id}">Retour</button>
          <button class="btn btn-sm act" data-act="renew" data-id="${l.id}">⏩</button></td></tr>`).join('')}</tbody></table></div></div>`).join('')}`;
  bindLoanActions(el);
}

function slips(loans) {
  const byUser = new Map();
  for (const l of loans) {
    if (!byUser.has(l.user_id)) byUser.set(l.user_id, []);
    byUser.get(l.user_id).push(l);
  }
  return `<div class="grid grid-2">${[...byUser.values()].map((list) => {
    const u = list[0];
    return `<div class="card" style="break-inside:avoid">
      <p><b>${esc(state.info.school_name)} — Bibliothèque</b></p>
      <p>Bonjour, <b>${esc(u.first_name)} ${esc(u.last_name)}</b>${u.class_name ? ` (${esc(u.class_name)})` : ''}
        n'a pas encore rendu ${list.length > 1 ? 'les livres suivants' : 'le livre suivant'} :</p>
      <ul>${list.map((l) => `<li><b>${esc(l.title)}</b> — à rendre le ${fmtDate(l.due_at)}</li>`).join('')}</ul>
      <p class="small">Merci de bien vouloir ${list.length > 1 ? 'les' : 'le'} rapporter à l'école. Si le livre est perdu ou abîmé, prenez contact avec l'enseignant.</p>
    </div>`;
  }).join('')}</div>`;
}

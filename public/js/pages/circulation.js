import { api, qs } from '../api.js';
import { esc, cover, toast, confirmBox, modal, fmtDate, plural, $, $$, debounce } from '../ui.js';
import { state, navigate } from '../state.js';

// Emprunteur en cours au comptoir : { kind: 'user', ...usager } ou { kind: 'class', id, name, loans }
let borrower = null;
// Classe dont on a affiché les avatars : on y revient après chaque prêt pour choisir l'élève suivant.
let pickedClass = null;
const log = [];

export async function render(app, { path, query }) {
  const tab = path === '/retards' ? 'late' : (query.vue ?? 'desk');
  app.innerHTML = `<div class="page-head"><h1>Prêts et retours</h1></div>
    <div class="tabs no-print">
      <a href="#/prets" class="${tab === 'desk' ? 'active' : ''}">🛎️ Comptoir</a>
      <a href="#/prets?vue=current" class="${tab === 'current' ? 'active' : ''}">📖 Prêts en cours</a>
      <a href="#/retards" class="${tab === 'late' ? 'active' : ''}">⏰ Retards</a>
      <a href="#/prets?vue=reservations" class="${tab === 'reservations' ? 'active' : ''}">🔖 Réservations</a>
      <a href="#/prets?vue=fin" class="${tab === 'fin' ? 'active' : ''}">☀️ Fin d'année</a>
      <a href="#/prets?vue=partis" class="${tab === 'partis' ? 'active' : ''}">🎒 Élèves partis</a>
      <a href="#/prets?vue=history" class="${tab === 'history' ? 'active' : ''}">🕓 Historique</a></div>
    <div id="tab"></div>`;
  const el = $('#tab');
  if (tab === 'desk') return desk(el);
  if (tab === 'late') return overdue(el, query);
  if (tab === 'reservations') return reservations(el);
  if (tab === 'fin') return endOfYear(el, query);
  if (tab === 'partis') return departed(el, query);
  return loanTable(el, query, tab);
}

const roleLabel = (r) => ({ admin: 'Administrateur', enseignant: 'Enseignant', eleve: 'Élève' }[r] ?? r);

/* ---------- Comptoir ---------- */

async function desk(el) {
  const classes = await api.get('/classes');
  el.innerHTML = `<div class="desk">
    <section class="card"><h2 style="margin-top:0">📤 Prêter</h2>
      <label>1. Qui emprunte ?
        <input id="who" placeholder="Nom ou prénom…" autocomplete="off"></label>
      <div id="who-suggest"></div>
      ${classes.length ? `<div class="row small" style="margin-top:.4rem"><span class="muted">ou par classe :</span>
        ${classes.map((c) => `<button class="btn btn-sm class-pick" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>` : ''}
      <div id="borrower"></div>
      <div id="book-step" hidden>
        <label style="margin-top:.6rem">2. Quel livre ? <span class="muted small">— son numéro, ou quelques lettres du titre</span>
          <input id="loan-code" class="scan-input" autocomplete="off" placeholder="Ex. : 12 ou « loup »"></label>
        <div id="book-suggest"></div>
      </div>
    </section>
    <section class="card"><h2 style="margin-top:0">📥 Rendre</h2>
      <label>Numéro du livre, titre ou nom de l'enfant
        <input id="return-code" class="scan-input" autocomplete="off" placeholder="Ex. : 12, « loup » ou « Léa »"></label>
      <div id="return-suggest"></div>
      <h3>Opérations de la séance</h3>
      <ul class="log" id="log"></ul>
    </section></div>`;

  // 1. Emprunteur
  const who = $('#who');
  const suggest = $('#who-suggest');
  who.oninput = debounce(async () => {
    const q = who.value.trim();
    if (q.length < 2) { suggest.innerHTML = ''; return; }
    const users = await api.get('/users' + qs({ q, limit: 12 }));
    suggest.innerHTML = users.length ? `<div class="suggest">${users.map((u) => `<button type="button" data-id="${u.id}">
      <span class="avatar-sm">${esc(u.avatar)}</span><span class="grow">${esc(u.first_name)} ${esc(u.last_name)}</span>
      <span class="muted small">${esc(u.class_name ?? roleLabel(u.role))}</span></button>`).join('')}</div>` : '<p class="muted small">Personne trouvé.</p>';
    for (const b of $$('button', suggest)) b.onclick = () => selectUser(b.dataset.id);
  }, 200);
  who.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('button', suggest)?.click(); } };

  for (const b of $$('.class-pick')) {
    b.onclick = () => showClassKids(classes.find((c) => c.id === Number(b.dataset.id)));
  }
  async function showClassKids(cls) {
    pickedClass = cls;
    {
      const users = await api.get('/users' + qs({ class_id: cls.id, role: 'eleve' }));
      suggest.innerHTML = `<div class="kid-grid" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr));margin-top:.6rem">
        <button type="button" class="kid-btn class-loan" style="font-size:.95rem;padding:.6rem .3rem;border-style:dashed">
          <span class="avatar" style="font-size:2rem">📦</span>Toute la classe
          ${cls.class_loans ? `<span class="badge">${cls.class_loans} 📖</span>` : ''}</button>
        ${users.map((u) => `<button type="button" class="kid-btn" data-id="${u.id}" style="font-size:.95rem;padding:.6rem .3rem">
          <span class="avatar" style="font-size:2rem">${esc(u.avatar)}</span>${esc(u.first_name)} ${esc(u.last_name[0] ?? '')}.
          ${u.active_loans ? `<span class="badge ${u.overdue_loans ? 'badge-late' : ''}">${u.active_loans} 📖</span>` : ''}</button>`).join('')}</div>`;
      for (const k of $$('.kid-btn[data-id]', suggest)) k.onclick = () => selectUser(k.dataset.id);
      $('.class-loan', suggest).onclick = () => selectClass(cls);
    }
  }
  nextBorrower = async () => {
    clearBorrower();
    if (pickedClass) {
      // Compteurs de prêts à jour sur les avatars
      const fresh = (await api.get('/classes')).find((c) => c.id === pickedClass.id);
      if (fresh && $('#who-suggest')) return showClassKids(fresh);
    }
    $('#who')?.focus();
  };

  // 2. Livre à prêter : numéro exact ou recherche par titre
  const code = $('#loan-code');
  const bookSuggest = $('#book-suggest');
  const searchBooks = debounce(async () => {
    const q = code.value.trim();
    if (!q) { bookSuggest.innerHTML = ''; return; }
    const copies = await api.get('/loans/find-copies' + qs({ q }));
    bookSuggest.innerHTML = copies.length ? `<div class="suggest">${copies.map((c) => `<button type="button" data-copy="${c.copy_id}"
        ${c.on_loan || !['ok', 'abime'].includes(c.state) ? 'disabled' : ''}>
      ${cover(c, 'cover-sm')}<span class="grow"><b>${esc(c.title)}</b><br><span class="muted small">n° ${esc(c.barcode)} · ${esc(c.cote ?? '')}</span></span>
      <span class="small">${c.on_loan ? '<span class="badge badge-late">déjà prêté</span>'
        : !['ok', 'abime'].includes(c.state) ? '<span class="badge">indisponible</span>'
        : c.held_for ? `<span class="badge badge-warn">gardé pour ${esc(c.held_for)}</span>` : '<span class="badge badge-ok">en rayon</span>'}</span></button>`).join('')}</div>`
      : '<p class="muted small">Aucun livre trouvé.</p>';
    for (const b of $$('button[data-copy]', bookSuggest)) b.onclick = () => lend({ copy_id: Number(b.dataset.copy) });
  }, 200);
  code.oninput = searchBooks;
  code.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = $('button[data-copy]:not([disabled])', bookSuggest);
    if (/^\d+$/.test(code.value.trim())) lend({ barcode: code.value.trim() });
    else first?.click();
  };

  // Retour
  const ret = $('#return-code');
  const retSuggest = $('#return-suggest');
  const searchReturns = debounce(async () => {
    const q = ret.value.trim();
    if (!q) { retSuggest.innerHTML = ''; return; }
    const loans = await api.get('/loans' + qs({ q, limit: 20 }));
    retSuggest.innerHTML = loans.length ? `<div class="suggest">${loans.map((l) => `<button type="button" data-loan="${l.id}">
      ${cover(l, 'cover-sm')}<span class="grow"><b>${esc(l.title)}</b> <span class="muted small">n° ${esc(l.barcode ?? '')}</span><br>
      <span class="small">${esc(l.avatar)} ${esc(l.first_name)} ${esc(l.last_name)}</span></span>
      ${l.overdue ? `<span class="badge badge-late">+${l.days_late} j</span>` : ''}<span class="btn btn-sm">Rendre</span></button>`).join('')}</div>`
      : '<p class="muted small">Aucun prêt en cours ne correspond.</p>';
    for (const b of $$('button[data-loan]', retSuggest)) b.onclick = () => giveBack({ loan_id: Number(b.dataset.loan) });
  }, 200);
  ret.oninput = searchReturns;
  ret.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (/^\d+$/.test(ret.value.trim())) giveBack({ barcode: ret.value.trim() });
    else $('button[data-loan]', retSuggest)?.click();
  };

  drawLog();
  if (borrower?.kind === 'user') selectUser(borrower.id);
  else if (borrower?.kind === 'class') selectClass(borrower);
  else who.focus();
}

let nextBorrower = () => {};

function clearBorrower() {
  borrower = null;
  if (!$('#borrower')) return;
  $('#borrower').innerHTML = '';
  $('#loan-code').value = '';
  $('#book-suggest').innerHTML = '';
  $('#book-step').hidden = true;
}

/** Fenêtre de confirmation du prêt ; « Élève suivant » (ou Entrée, ou 5 secondes) remet le comptoir à zéro. */
function confirmLoan(r) {
  const forClass = borrower.kind === 'class';
  const name = forClass ? `Classe ${borrower.name}` : `${borrower.first_name} ${borrower.last_name}`;
  const firstName = forClass ? 'la classe' : borrower.first_name;
  const dlg = modal('✅ Livre prêté', `<div class="loan-ok">
      ${cover(r, 'cover-md')}
      <div><p class="loan-ok-title">${esc(r.title)}</p>
        <p class="muted">n° ${esc(r.barcode)}</p>
        <p class="loan-ok-who"><span class="avatar-lg">${esc(forClass ? '📦' : borrower.avatar)}</span><b>${esc(name)}</b></p>
        <p>À rendre le <b>${fmtDate(r.due_at)}</b></p></div></div>
    <div class="actions">
      <button class="btn" data-same>📖 Un autre livre pour ${esc(firstName)}</button>
      <button class="btn btn-primary" data-next autofocus>👍 ${forClass ? 'Terminé' : 'Élève suivant'}</button></div>
    <p class="small muted" data-countdown style="text-align:right;margin:.4rem 0 0">Se ferme tout seul dans <span data-count>5</span> s</p>`);
  let choice = 'next';
  let left = 5;
  const timer = setInterval(() => {
    left--;
    const c = dlg.querySelector('[data-count]');
    if (c) c.textContent = left;
    if (left <= 0) dlg.close();
  }, 1000);
  // Un geste dans la fenêtre arrête le compte à rebours.
  const stop = () => { clearInterval(timer); dlg.querySelector('[data-countdown]')?.remove(); };
  dlg.addEventListener('pointerdown', stop, { once: true });
  dlg.querySelector('[data-same]').onclick = () => { choice = 'same'; dlg.close(); };
  dlg.querySelector('[data-next]').onclick = () => dlg.close();
  dlg.addEventListener('close', async () => {
    clearInterval(timer);
    if (!$('#borrower') || !borrower) return; // page quittée
    if (choice === 'same' || forClass) {
      $('#loan-code').value = '';
      $('#book-suggest').innerHTML = '';
      await refreshBorrower();
      $('#loan-code').focus();
    } else {
      nextBorrower();
    }
  });
}

async function lend(target, ignore_reservation = false) {
  if (!borrower) return;
  const who = borrower.kind === 'class' ? { class_id: borrower.id } : { user_id: borrower.id };
  try {
    const r = await api.post('/loans', { ...who, ...target, ignore_reservation });
    addLog('ok', `📤 « ${r.title} » (n° ${r.barcode}) prêté à ${borrowerName()} — retour le ${fmtDate(r.due_at)}`);
    confirmLoan(r);
    return;
  } catch (err) {
    if (err.code === 'reserved' && await confirmBox(`${err.message}. Le prêter quand même ?`, { ok: 'Prêter quand même' })) {
      return lend(target, true);
    }
    addLog('err', err.message);
    toast(err.message, 'error');
  }
  $('#loan-code').focus();
}

async function giveBack(target) {
  try {
    const r = await api.post('/loans/return', target);
    addLog(r.days_late ? 'warn' : 'ok', `📥 « ${r.title} » (n° ${r.barcode ?? '?'}) rendu par ${r.first_name} ${r.last_name}${r.days_late ? ` — ${plural(r.days_late, 'jour')} de retard` : ''}`);
    if (r.reserved_for) {
      addLog('warn', `🔖 Mettez « ${r.title} » de côté : il est réservé pour ${r.reserved_for}`);
      toast(`Réservé ! Mettez ce livre de côté pour ${r.reserved_for}`);
    }
    $('#return-code').value = '';
    $('#return-suggest').innerHTML = '';
    if (borrower) await refreshBorrower();
  } catch (err) {
    addLog('err', err.message);
    toast(err.message, 'error');
  }
  $('#return-code').focus();
}

const borrowerName = () => (borrower.kind === 'class' ? `la classe ${borrower.name}` : borrower.first_name);
const refreshBorrower = () => (borrower.kind === 'class' ? selectClass(borrower) : selectUser(borrower.id));

async function selectUser(id) {
  const u = await api.get(`/users/${id}`);
  borrower = { kind: 'user', ...u };
  const settings = state.settings ?? (state.settings = await api.get('/settings'));
  const max = Number(settings[`max_loans_${u.role}`] ?? 2);
  showBorrower({
    avatar: u.avatar,
    title: `${u.first_name} ${u.last_name}`,
    sub: `${u.class_name ?? roleLabel(u.role)} · ${u.loans.length}/${max} prêt(s)`,
    loans: u.loans,
    reservations: u.reservations,
  });
}

async function selectClass(cls) {
  const loans = await api.get('/loans' + qs({ loan_class_id: cls.id }));
  borrower = { kind: 'class', id: cls.id, name: cls.name };
  showBorrower({ avatar: '📦', title: `Classe ${cls.name}`, sub: `Prêt pour toute la classe · ${plural(loans.length, 'livre')}`, loans, reservations: [] });
}

function showBorrower({ avatar, title, sub, loans, reservations }) {
  const late = loans.filter((l) => l.overdue);
  $('#who-suggest').innerHTML = '';
  $('#who').value = '';
  $('#borrower').innerHTML = `<div class="borrower">
      <span class="avatar-lg">${esc(avatar)}</span>
      <div class="grow"><b>${esc(title)}</b><br><span class="muted small">${esc(sub)}</span>
        ${late.length ? `<br><span class="badge badge-late">⚠️ ${plural(late.length, 'retard')}</span>` : ''}</div>
      <button class="icon-btn" id="clear-borrower" title="Changer d'emprunteur">✕</button></div>
    ${reservations.length ? `<ul class="log">${reservations.map((r) => `<li class="warn">🔖 ${esc(r.title)} —
      ${r.status === 'prete' ? '<b>mis de côté, à remettre</b>' : 'réservé, en attente du retour'}</li>`).join('')}</ul>` : ''}
    ${loans.length ? `<ul class="log">${loans.map((l) => `<li class="${l.overdue ? 'err' : ''}">📖 ${esc(l.title)} <span class="muted small">n° ${esc(l.barcode ?? '')}
      — ${l.overdue ? `en retard de ${plural(l.days_late, 'jour')}` : `à rendre le ${fmtDate(l.due_at)}`}</span>
      <button class="btn btn-sm give-back" data-loan="${l.id}" style="float:right">Rendre</button></li>`).join('')}</ul>` : ''}`;
  $('#clear-borrower').onclick = () => {
    clearBorrower();
    $('#who').focus();
  };
  for (const b of $$('.give-back')) b.onclick = () => giveBack({ loan_id: Number(b.dataset.loan) });
  $('#book-step').hidden = false;
  if (document.activeElement !== $('#return-code')) $('#loan-code').focus();
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
      <button class="btn" onclick="bcdPrint()">🖨️ Imprimer</button></div>
    ${loans.length ? `<div class="table-wrap"><table><thead><tr><th>Emprunteur</th><th>Classe</th><th>Document</th><th>N°</th>
      <th>Prêté le</th><th>${tab === 'history' ? 'Rendu le' : 'À rendre le'}</th>${tab === 'history' ? '' : '<th class="no-print"></th>'}</tr></thead>
      <tbody>${loans.map((l) => `<tr>
        <td>${l.user_id ? `<a href="#/usager/${l.user_id}">${esc(l.avatar)} ${esc(l.first_name)} ${esc(l.last_name)}</a>${l.user_active ? '' : ' <span class="badge badge-warn">parti</span>'}` : `📦 <b>Toute la classe</b>`}</td>
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
        if (b.dataset.act === 'return') {
          const r = await api.post('/loans/return', { loan_id: id });
          toast(r.reserved_for ? `Retour enregistré — à mettre de côté pour ${r.reserved_for}` : 'Retour enregistré');
        }
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

function groupByClass(loans) {
  const byClass = new Map();
  for (const l of loans) {
    const k = l.class_name ?? (l.role === 'eleve' ? 'Sans classe' : 'Adultes');
    if (!byClass.has(k)) byClass.set(k, []);
    byClass.get(k).push(l);
  }
  return byClass;
}

const who = (l) => (l.user_id
  ? `${esc(l.avatar)} ${esc(l.first_name)} ${esc(l.last_name)}${l.user_active ? '' : ' <span class="badge badge-warn">parti</span>'}`
  : '📦 <b>Toute la classe</b>');

async function overdue(el, query) {
  const loans = await api.get('/loans' + qs({ status: 'overdue' }));
  const mode = query.mode ?? 'table';
  el.innerHTML = `<div class="row no-print" style="margin-bottom:.8rem">
      <span class="muted">${plural(loans.length, 'livre')} en retard</span><span class="grow"></span>
      <a class="btn" href="#/retards${mode === 'slips' ? '' : '?mode=slips'}">${mode === 'slips' ? '📋 Vue tableau' : '✉️ Mots pour les familles'}</a>
      <a class="btn" href="/api/loans/overdue.csv" download>⬇️ CSV</a>
      <button class="btn btn-primary" onclick="bcdPrint()">🖨️ Imprimer</button></div>
    ${!loans.length ? '<div class="empty">🎉 Aucun retard !</div>' : mode === 'slips' ? slips(loans.filter((l) => l.user_id)) : [...groupByClass(loans)].map(([cls, list]) => `
      <div class="card" style="break-inside:avoid"><h2 style="margin-top:0">${esc(cls)} <span class="muted small">(${list.length})</span></h2>
      <div class="table-wrap"><table><thead><tr><th>Emprunteur</th><th>Document</th><th>N°</th><th>À rendre le</th><th class="num">Retard</th><th class="no-print"></th></tr></thead>
      <tbody>${list.map((l) => `<tr><td>${who(l)}</td><td>${esc(l.title)}</td>
        <td class="small">${esc(l.barcode ?? '')}</td><td>${fmtDate(l.due_at)}</td>
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
  // Signé par la personne connectée (l'enseignant·e qui imprime) ; prénom de l'enfant seulement.
  const me = state.user;
  const signature = `${me.first_name} ${me.last_name}`;
  const today = new Date().toLocaleDateString('fr-FR');
  return `<div class="slips">${[...byUser.values()].map((list) => {
    const u = list[0];
    const many = list.length > 1;
    return `<div class="slip">
      <p class="slip-head"><b>${esc(state.info.school_name)} — Bibliothèque</b><span class="muted small">${today}</span></p>
      <p>Bonjour,<br><b>${esc(u.first_name)}</b>${u.class_name ? ` <span class="muted">(${esc(u.class_name)})</span>` : ''}
        n'a pas encore rendu ${many ? 'les livres suivants' : 'le livre suivant'} :</p>
      <ul>${list.map((l) => `<li><b>${esc(l.title)}</b> — à rendre le ${fmtDate(l.due_at)}</li>`).join('')}</ul>
      <p class="small">Merci de bien vouloir ${many ? 'les' : 'le'} rapporter à l'école.
        Si ${many ? 'un livre est perdu ou abîmé' : 'le livre est perdu ou abîmé'}, n'hésitez pas à nous en parler.</p>
      <p class="slip-sign">${esc(signature)}</p>
    </div>`;
  }).join('<div class="cut-line" aria-hidden="true"><span>✂</span></div>')}</div>`;
}

/* ---------- Réservations ---------- */

async function reservations(el) {
  const list = await api.get('/reservations');
  el.innerHTML = `<p class="muted no-print">Pour réserver un livre : ouvrez sa fiche puis « Réserver pour… ». Les élèves peuvent aussi appuyer sur « Je le veux ! ».
      Quand un livre réservé est rendu, l'application vous prévient de le mettre de côté.</p>
    ${list.length ? `<div class="table-wrap"><table><thead><tr><th>Livre</th><th>Pour</th><th>Classe</th><th>Depuis le</th><th>Situation</th><th></th></tr></thead>
      <tbody>${list.map((r) => `<tr class="${r.status === 'prete' ? 'row-warn' : ''}">
        <td><a href="#/document/${r.document_id}">${esc(r.title)}</a> <span class="cote small">${esc(r.cote ?? '')}</span></td>
        <td>${esc(r.avatar)} ${esc(r.first_name)} ${esc(r.last_name)}</td><td>${esc(r.class_name ?? '')}</td>
        <td>${fmtDate(r.created_at)}</td>
        <td>${r.status === 'prete' ? '<span class="badge badge-warn">📚 Mis de côté — à lui remettre</span>' : '<span class="badge">⏳ Attend le retour</span>'}</td>
        <td class="num"><button class="btn btn-sm cancel" data-id="${r.id}">Annuler</button></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Aucune réservation en cours.</div>'}`;
  for (const b of $$('.cancel', el)) {
    b.onclick = async () => {
      const r = await api.del(`/reservations/${b.dataset.id}`);
      toast(r.reserved_for ? `Annulée — le livre est maintenant pour ${r.reserved_for}` : 'Réservation annulée');
      navigate(location.hash);
    };
  }
}

/* ---------- Fin d'année ---------- */

async function endOfYear(el, query) {
  const classes = await api.get('/classes');
  const loans = await api.get('/loans' + qs({ class_id: query.class_id, limit: 5000 }));
  const y = new Date().getMonth() >= 7 ? new Date().getFullYear() + 1 : new Date().getFullYear();
  const deadline = query.date ?? `${y}-06-26`;
  el.innerHTML = `<div class="card no-print">
      <p style="margin-top:0">Avant les grandes vacances, tous les livres doivent revenir à la bibliothèque.</p>
      <form class="row" id="f">
        <label>Date limite <input type="date" name="date" value="${esc(deadline)}" style="width:auto"></label>
        <label>Classe <select name="class_id" style="width:auto"><option value="">Toutes</option>
          ${classes.map((c) => `<option value="${c.id}" ${String(query.class_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <button type="button" class="btn" id="apply">📅 Fixer cette date de retour pour ces ${loans.length} prêts</button>
        <button type="button" class="btn btn-primary" onclick="bcdPrint()">🖨️ Imprimer les listes par classe</button></form></div>
    ${!loans.length ? '<div class="empty">🎉 Tous les livres sont rentrés !</div>' : [...groupByClass(loans)].map(([cls, list]) => `
      <div class="card print-page"><h2 style="margin-top:0">${esc(cls)} — livres à rendre avant le ${fmtDate(deadline)}</h2>
        <p class="muted small">${esc(state.info.school_name)} · ${plural(list.length, 'livre')}</p>
        <table class="dense"><thead><tr><th>Emprunteur</th><th>Livre</th><th>N°</th><th>Rendu ✓</th></tr></thead>
        <tbody>${list.map((l) => `<tr><td>${who(l)}</td><td>${esc(l.title)}</td><td>${esc(l.barcode ?? '')}</td><td>☐</td></tr>`).join('')}</tbody></table></div>`).join('')}`;
  const f = $('#f');
  f.onchange = () => navigate('#/prets' + qs({ vue: 'fin', date: f.date.value, class_id: f.class_id.value }));
  $('#apply').onclick = async () => {
    if (!(await confirmBox(`Tous ces prêts devront être rendus le ${fmtDate(f.date.value)} au plus tard. Continuer ?`))) return;
    const r = await api.post('/loans/due-date', { due_at: f.date.value, class_id: f.class_id.value || undefined });
    toast(`${plural(r.updated, 'prêt')} mis à jour`);
    navigate(location.hash);
  };
}

/* ---------- Élèves partis avec un livre ---------- */

async function departed(el, query) {
  const loans = await api.get('/loans' + qs({ departed: '1' }));
  const mode = query.mode ?? 'table';
  el.innerHTML = `<p class="muted no-print">Élèves archivés (partis de l'école, par exemple après l'import ONDE de la rentrée)
      qui ont encore un livre. Ils pourront être supprimés dans l'assistant de rentrée une fois le livre rendu ou déclaré perdu.</p>
    <div class="row no-print" style="margin-bottom:.8rem">
      <span class="muted">${plural(loans.length, 'livre')} à récupérer</span><span class="grow"></span>
      ${loans.length ? `<a class="btn" href="#/prets?vue=partis${mode === 'slips' ? '' : '&mode=slips'}">${mode === 'slips' ? '📋 Vue tableau' : '✉️ Mots pour les familles'}</a>
      <button class="btn btn-primary" onclick="bcdPrint()">🖨️ Imprimer</button>` : ''}</div>
    ${!loans.length ? '<div class="empty">🎉 Aucun livre chez un élève parti.</div>' : mode === 'slips' ? slips(loans)
      : `<div class="table-wrap"><table><thead><tr><th>Élève</th><th>Ancienne classe</th><th>Livre</th><th>N°</th><th>À rendre le</th><th class="no-print"></th></tr></thead>
        <tbody>${loans.map((l) => `<tr><td><a href="#/usager/${l.user_id}">${esc(l.avatar)} ${esc(l.first_name)} ${esc(l.last_name)}</a></td>
          <td>${esc(l.class_name ?? '')}</td><td>${esc(l.title)}</td><td>${esc(l.barcode ?? '')}</td>
          <td class="nowrap">${fmtDate(l.due_at)}${l.overdue ? ` <span class="badge badge-late">+${l.days_late} j</span>` : ''}</td>
          <td class="no-print nowrap"><button class="btn btn-sm act" data-act="return" data-id="${l.id}">✅ Rendu</button>
            <button class="btn btn-sm act" data-act="lost" data-id="${l.id}">❓ Perdu</button></td></tr>`).join('')}</tbody></table></div>`}`;
  bindLoanActions(el);
}

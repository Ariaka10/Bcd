import { api } from '../api.js';
import { esc, toast, formData, $ } from '../ui.js';
import { state, navigate } from '../state.js';

async function afterLogin() {
  state.user = (await api.get('/me')).user;
  navigate('#/');
}

export function renderSetup(app) {
  app.innerHTML = `<div class="login-wrap" style="max-width:520px">
    <div class="login-hero"><h1>📚 Bienvenue !</h1>
      <p class="muted">Première utilisation : créez le compte administrateur de la BCD.</p></div>
    <form class="card grid" id="setup">
      <label>Nom de l'école <input name="school_name" placeholder="École élémentaire Jules Ferry" required></label>
      <div class="grid grid-2">
        <label>Prénom <input name="first_name" required></label>
        <label>Nom <input name="last_name" required></label>
      </div>
      <label>Identifiant <input name="username" autocomplete="username" required></label>
      <label>Mot de passe (6 caractères min.) <input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
      <button class="btn btn-primary btn-lg">Créer la BCD</button>
    </form></div>`;
  $('#setup').onsubmit = async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    try {
      await api.post('/setup', data);
      state.info.needs_setup = false;
      state.info.school_name = data.school_name;
      document.title = `${data.school_name} — BCD`;
      await afterLogin();
    } catch (err) { toast(err.message, 'error'); }
  };
}

export async function render(app) {
  app.innerHTML = `<div class="login-wrap">
    <div class="login-hero"><h1>${esc(state.info.school_name)}</h1><p class="muted">Bibliothèque de l'école</p></div>
    <div id="login-step"></div></div>`;
  choose();
}

function choose() {
  $('#login-step').innerHTML = `<div class="login-choice">
    <button class="choice-btn" id="go-kid"><span class="big">🧒</span>Je suis un élève</button>
    <button class="choice-btn" id="go-adult"><span class="big">🧑‍🏫</span>Je suis un adulte</button></div>`;
  $('#go-kid').onclick = pickClass;
  $('#go-adult').onclick = adult;
}

function adult() {
  $('#login-step').innerHTML = `<form class="card grid" id="adult" style="max-width:420px;margin:0 auto">
    <h2 style="margin-top:0">Connexion enseignant / administrateur</h2>
    <label>Identifiant <input name="username" autocomplete="username" required autofocus></label>
    <label>Mot de passe <input name="password" type="password" autocomplete="current-password" required></label>
    <div class="row row-end"><button type="button" class="btn btn-ghost" id="back">← Retour</button>
    <button class="btn btn-primary">Se connecter</button></div></form>`;
  $('#back').onclick = choose;
  $('#adult').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/login', formData(e.target));
      await afterLogin();
    } catch (err) { toast(err.message, 'error'); }
  };
}

async function pickClass() {
  const classes = await api.get('/public/classes');
  $('#login-step').innerHTML = `<h2 style="text-align:center">Quelle est ta classe ?</h2>
    ${classes.length ? `<div class="class-grid">${classes.map((c) =>
      `<button class="class-btn" data-id="${c.id}">${esc(c.name)}</button>`).join('')}</div>`
    : '<p class="empty">Aucune classe pour le moment. Demande à ton enseignant.</p>'}
    <div class="actions" style="justify-content:center"><button class="btn btn-ghost" id="back">← Retour</button></div>`;
  $('#back').onclick = choose;
  for (const b of document.querySelectorAll('.class-btn')) b.onclick = () => pickKid(b.dataset.id, b.textContent);
}

async function pickKid(classId, className) {
  const kids = await api.get(`/public/classes/${classId}/students`);
  $('#login-step').innerHTML = `<h2 style="text-align:center">${esc(className)} — Qui es-tu ?</h2>
    <div class="kid-grid">${kids.map((k) => `<button class="kid-btn" data-id="${k.id}" data-code="${k.has_code ? 1 : 0}">
      <span class="avatar">${esc(k.avatar)}</span><span>${esc(k.first_name)} ${esc(k.initial)}.</span></button>`).join('')}</div>
    <div class="actions" style="justify-content:center"><button class="btn btn-ghost" id="back">← Changer de classe</button></div>`;
  $('#back').onclick = pickClass;
  for (const b of document.querySelectorAll('.kid-btn')) {
    b.onclick = () => (b.dataset.code === '1' ? askCode(b, classId, className) : loginKid(b.dataset.id));
  }
}

async function loginKid(id, code) {
  try {
    await api.post('/login/eleve', { user_id: Number(id), code });
    await afterLogin();
  } catch (err) {
    toast(err.status === 401 ? 'Oups ! Ce n\'est pas le bon code. Réessaie.' : err.message, 'error');
    return false;
  }
  return true;
}

function askCode(btn, classId, className) {
  const symbols = state.info.code_symbols;
  let code = [];
  $('#login-step').innerHTML = `<div class="card" style="max-width:520px;margin:0 auto;text-align:center">
    <div style="font-size:4rem">${btn.querySelector('.avatar').textContent}</div>
    <h2 style="margin-top:0">${esc(btn.querySelector('span:last-child').textContent)}, tape ton code secret</h2>
    <div class="code-dots" id="dots"></div>
    <div class="symbols">${symbols.map((s) => `<button type="button" data-s="${s}">${s}</button>`).join('')}</div>
    <div class="actions" style="justify-content:space-between">
      <button class="btn btn-ghost" id="back">← Retour</button>
      <button class="btn" id="erase">⌫ Effacer</button>
      <button class="btn btn-primary btn-lg" id="ok">C'est moi !</button></div></div>`;
  const draw = () => { $('#dots').innerHTML = code.map((s) => `<span>${s}</span>`).join(''); };
  $('#back').onclick = () => pickKid(classId, className);
  $('#erase').onclick = () => { code.pop(); draw(); };
  for (const b of document.querySelectorAll('.symbols button')) {
    b.onclick = () => { if (code.length < 4) code.push(b.dataset.s); draw(); };
  }
  $('#ok').onclick = async () => {
    if (!(await loginKid(btn.dataset.id, code))) { code = []; draw(); }
  };
}

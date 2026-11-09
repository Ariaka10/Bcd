import { api } from '../api.js';
import { esc, toast, formData, $, $$ } from '../ui.js';
import { state, navigate } from '../state.js';

export async function render(app, { path }) {
  if (path === '/mon-compte') return renderAccount(app);
  const s = await api.get('/settings');
  const num = (k, label) => `<label>${label}<input type="number" min="0" name="${k}" value="${esc(s[k])}"></label>`;
  app.innerHTML = `<div class="page-head"><h1>Paramètres</h1></div>
    <form class="card" id="f">
      <h2 style="margin-top:0">École</h2>
      <div class="grid grid-2">
        <label>Nom de l'école<input name="school_name" value="${esc(s.school_name)}"></label>
        <label>Préfixe des codes-barres générés<input name="barcode_prefix" value="${esc(s.barcode_prefix)}"></label></div>
      <h2>Règles de prêt</h2>
      <div class="grid grid-3">
        ${num('loan_days_eleve', 'Durée de prêt élève (jours)')}
        ${num('loan_days_enseignant', 'Durée de prêt enseignant (jours)')}
        ${num('loan_days_admin', 'Durée de prêt administrateur (jours)')}
        ${num('max_loans_eleve', 'Nombre de prêts max. élève')}
        ${num('max_loans_enseignant', 'Nombre de prêts max. enseignant')}
        ${num('max_loans_admin', 'Nombre de prêts max. administrateur')}
        ${num('max_renewals', 'Prolongations autorisées')}
        <label class="check span-2" style="align-self:end"><input type="checkbox" name="block_if_overdue" ${s.block_if_overdue === '1' ? 'checked' : ''}>
          Bloquer les nouveaux prêts tant qu'un livre est en retard</label></div>
      <div class="actions"><button class="btn btn-primary">💾 Enregistrer</button></div></form>
    <div class="card"><h2 style="margin-top:0">Entretien du catalogue</h2>
      <p class="muted">Recalcule la cote de tous les documents selon les règles automatiques (préfixe du genre ou indice Dewey + 3 lettres de l'auteur).
        Attention : les cotes saisies à la main seront remplacées.</p>
      <button class="btn" id="recompute">🔁 Recalculer toutes les cotes</button></div>`;
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

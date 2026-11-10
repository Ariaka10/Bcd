import { api } from '../api.js';
import { esc, cover, $ } from '../ui.js';
import { state, navigate, typeLabel } from '../state.js';

export async function render(app) {
  const [s, rem] = await Promise.all([
    api.get('/stats'),
    state.user.role === 'admin' ? api.get('/admin/reminders').catch(() => ({})) : {},
  ]);
  const max = Math.max(1, ...s.by_class.map((c) => c.n));
  const maxType = Math.max(1, ...s.by_type.map((t) => t.n));
  app.innerHTML = `
    <div class="page-head"><div><h1>Bonjour ${esc(state.user.first_name)} 👋</h1>
      <p class="muted">${esc(state.info.school_name)} — tableau de bord de la BCD</p></div>
      <div class="row"><a class="btn btn-primary btn-lg" href="#/prets">📚 Prêts et retours</a></div></div>

    ${rem.rentree ? `<a class="card reminder" href="#/rentree">🎒 <b>Nouvelle année scolaire ${esc(rem.rentree.replace('-', ' – '))}</b> :
      lancez l'assistant de rentrée (import ONDE, élèves partis, classes)…</a>` : ''}
    ${rem.extra_backup_days != null ? `<a class="card reminder" href="#/parametres">🔑 <b>Branchez la clé USB de sauvegarde</b> :
      ${rem.extra_backup_days < 0 ? 'aucune copie faite pour le moment' : `pas de copie depuis ${rem.extra_backup_days} jours`}.
      La copie se fait toute seule à la fermeture de l'application.</a>` : ''}
    <form class="searchbar card" id="quick" style="margin-bottom:1rem">
      <input name="q" placeholder="Rechercher dans le catalogue : titre, auteur, sujet, ISBN, cote…" autofocus>
      <button class="btn btn-primary">Rechercher</button></form>

    <div class="stats">
      <a class="stat" href="#/catalogue"><b>${s.documents}</b><span>documents (${s.copies} exemplaires)</span></a>
      <a class="stat" href="#/prets"><b>${s.active_loans}</b><span>prêts en cours</span></a>
      <a class="stat ${s.overdue ? 'stat-alert' : ''}" href="#/retards"><b>${s.overdue}</b><span>retards</span></a>
      ${s.departed_loans ? `<a class="stat stat-warn" href="#/prets?vue=partis"><b>${s.departed_loans}</b><span>livre(s) chez des élèves partis</span></a>` : ''}
      ${s.reservations ? `<a class="stat stat-warn" href="#/prets?vue=reservations"><b>${s.reservations}</b><span>livre(s) réservé(s) à remettre</span></a>` : ''}
      <a class="stat" href="#/usagers"><b>${s.students}</b><span>élèves · ${s.classes} classes</span></a>
      <div class="stat"><b>${s.loans_this_year}</b><span>prêts depuis la rentrée</span></div>
    </div>

    <div class="grid grid-2 home-grid">
      <div class="card"><h2 style="margin-top:0">Prêts par classe (depuis la rentrée)</h2>
        ${s.by_class.length ? `<div class="bars">${s.by_class.map((c) => `<div class="bar"><span>${esc(c.name)}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(c.n / max) * 100}%"></div></div><span class="num">${c.n}</span></div>`).join('')}</div>`
        : '<p class="muted">Importez vos élèves pour voir les statistiques par classe.</p>'}
      </div>
      <div class="card"><h2 style="margin-top:0">Les plus empruntés</h2>
        ${s.top_documents.length ? `<ol>${s.top_documents.map((d) =>
          `<li><a href="#/document/${d.id}">${esc(d.title)}</a> <span class="muted small">(${d.n})</span></li>`).join('')}</ol>`
        : '<p class="muted">Pas encore de prêt cette année.</p>'}
      </div>
      <div class="card"><h2 style="margin-top:0">Fonds par type</h2>
        ${s.by_type.length ? `<div class="bars">${s.by_type.map((t) => `<div class="bar"><span>${esc(typeLabel(t.doc_type))}</span>
          <div class="bar-track"><div class="bar-fill" style="width:${(t.n / maxType) * 100}%;background:var(--accent)"></div></div><span class="num">${t.n}</span></div>`).join('')}</div>`
        : `<p class="muted">Catalogue vide. <a href="#/document/nouveau">Ajoutez un premier document</a> en scannant son ISBN.</p>`}
      </div>
      <div class="card"><h2 style="margin-top:0">Dernières acquisitions</h2>
        ${s.recent.length ? s.recent.map((d) => `<a class="doc-cell" href="#/document/${d.id}" style="margin-bottom:.5rem;text-decoration:none;color:inherit">
          ${cover(d)}<div><div class="doc-title">${esc(d.title)}</div><span class="cote">${esc(d.cote)}</span></div></a>`).join('')
        : '<p class="muted">—</p>'}
      </div>
    </div>`;
  $('#quick').onsubmit = (e) => {
    e.preventDefault();
    navigate('#/catalogue?q=' + encodeURIComponent(e.target.q.value));
  };
}

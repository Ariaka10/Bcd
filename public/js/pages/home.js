import { api } from '../api.js';
import { esc, cover, fmtDate, plural, $ } from '../ui.js';
import { state, navigate, typeLabel } from '../state.js';

export async function render(app) {
  if (state.user.role === 'catalogueur') return renderCataloguer(app);
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
    ${s.subscriptions?.length ? `<div class="card reminder">📰 <b>Abonnement${s.subscriptions.length > 1 ? 's' : ''} à renouveler :</b>
      ${s.subscriptions.map((p) => `<a href="#/document/${p.id}">${esc(p.title)}</a> (${p.subscription_end < new Date().toISOString().slice(0, 10)
        ? 'terminé le' : 'jusqu\'au'} ${fmtDate(p.subscription_end)})`).join(', ')}</div>` : ''}
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
    </div>

    <details class="card stats-more" id="stats-more">
      <summary><h2>📊 Statistiques détaillées</h2><span class="muted small">prêts par mois, lecteurs, rotation du fonds, classes…</span></summary>
      <div id="stats-body"><p class="muted">Chargement…</p></div></details>`;
  $('#quick').onsubmit = (e) => {
    e.preventDefault();
    navigate('#/catalogue?q=' + encodeURIComponent(e.target.q.value));
  };
  const more = $('#stats-more');
  more.ontoggle = () => {
    try { localStorage.setItem('bcd-stats-open', more.open ? '1' : ''); } catch { /* stockage indisponible */ }
    if (more.open) renderDetails();
  };
  let wasOpen = false;
  try { wasOpen = localStorage.getItem('bcd-stats-open') === '1'; } catch { /* stockage indisponible */ }
  if (wasOpen) more.open = true;
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Statistiques détaillées d'une année scolaire, chargées à l'ouverture du menu. */
async function renderDetails(year) {
  const box = $('#stats-body');
  if (!box) return;
  const d = await api.get('/stats/details' + (year ? `?year=${encodeURIComponent(year)}` : ''));
  if (!box.isConnected) return;
  const t = d.totals;
  const max = Math.max(1, ...d.months.map((m) => m.n));
  const best = d.months.reduce((a, m) => (m.n > a.n ? m : a), d.months[0]);
  const maxType = Math.max(1, ...d.by_type.map((x) => x.n));
  const maxTheme = Math.max(1, ...d.top_themes.map((x) => x.n));
  const bars = (rows, label, value, maxV) => `<div class="bars">${rows.map((r) => `<div class="bar"><span>${label(r)}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${(value(r) / maxV) * 100}%"></div></div><span class="num">${value(r)}</span></div>`).join('')}</div>`;

  box.innerHTML = `
    <div class="row no-print" style="margin:.4rem 0 1rem">
      <label class="row" style="gap:.4rem">Année scolaire
        <select id="stats-year" style="width:auto">${d.years.map((y) => `<option ${y === d.year ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select></label>
      <span class="grow"></span>
      <button class="btn" id="stats-print">🖨️ Imprimer le bilan</button></div>
    <h3 class="print-only">Bilan de la BCD — année ${esc(d.year)}</h3>

    <div class="stats">
      <div class="stat"><b>${t.loans}</b><span>prêts${t.class_loans ? ` (dont ${t.class_loans} aux classes)` : ''}</span></div>
      <div class="stat"><b>${t.readers}<small>/${t.students}</small></b><span>élèves ont emprunté (${pct(t.readers, t.students)} %)</span></div>
      <div class="stat"><b>${t.students ? (t.loans / t.students).toFixed(1).replace('.', ',') : '0'}</b><span>prêts par élève en moyenne</span></div>
      <div class="stat"><b>${pct(t.borrowed_docs, t.documents)} %</b><span>du fonds emprunté au moins une fois (${t.borrowed_docs}/${t.documents})</span></div>
      <div class="stat"><b>${t.never_borrowed}</b><span>livres jamais empruntés</span></div>
      <div class="stat"><b>${t.added}</b><span>livres ajoutés dans l'année</span></div>
      <div class="stat ${t.returned_late ? 'stat-warn' : ''}"><b>${pct(t.returned_late, t.returned)} %</b><span>des retours en retard${t.lost ? ` · ${plural(t.lost, 'livre perdu', 'livres perdus')}` : ''}</span></div>
    </div>

    <div class="card stats-chart"><h3 style="margin-top:0">Prêts par mois</h3>
      ${t.loans ? `<p class="small muted" style="margin-top:-.4rem">Mois le plus actif : <b>${esc(best.label)}</b> (${plural(best.n, 'prêt')})</p>` : ''}
      <div class="month-chart" role="img" aria-label="Prêts par mois, de septembre à août">
        ${d.months.map((m) => `<div class="month" title="${esc(m.label)} : ${plural(m.n, 'prêt')}">
          <div class="month-plot"><div class="month-bar" style="height:${(m.n / max) * 100}%">${m.n ? `<span class="month-val">${m.n}</span>` : ''}</div></div>
          <span class="month-label">${esc(m.label)}</span></div>`).join('')}</div>
      <details class="small" style="margin-top:.6rem"><summary class="muted">Voir les chiffres en tableau</summary>
        <table class="dense" data-no-tools><thead><tr>${d.months.map((m) => `<th>${esc(m.label)}</th>`).join('')}</tr></thead>
          <tbody><tr>${d.months.map((m) => `<td class="num">${m.n}</td>`).join('')}</tr></tbody></table></details>
    </div>

    <div class="grid grid-2 home-grid">
      <div class="card"><h3 style="margin-top:0">Par classe</h3>
        ${d.by_class.length ? `<table class="dense"><thead><tr><th>Classe</th><th class="num">Prêts</th><th class="num">Lecteurs</th><th class="num">Prêts / élève</th></tr></thead>
          <tbody>${d.by_class.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.loans}</td>
            <td class="num">${c.readers}/${c.students}</td><td class="num">${c.students ? (c.loans / c.students).toFixed(1).replace('.', ',') : '—'}</td></tr>`).join('')}</tbody></table>`
          : '<p class="muted">Aucune classe.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">Les 10 plus empruntés</h3>
        ${d.top_documents.length ? `<ol>${d.top_documents.map((x) => `<li><a href="#/document/${x.id}">${esc(x.title)}</a>
          <span class="muted small">(${plural(x.n, 'prêt')})</span></li>`).join('')}</ol>` : '<p class="muted">Aucun prêt cette année.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">Thèmes préférés</h3>
        ${d.top_themes.length ? bars(d.top_themes, (x) => `${esc(x.emoji ?? '')} ${esc(x.name)}`, (x) => x.n, maxTheme)
          : '<p class="muted">Pas de prêt de livres classés par thème.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">Prêts par type de document</h3>
        ${d.by_type.length ? bars(d.by_type, (x) => esc(typeLabel(x.doc_type)), (x) => x.n, maxType) : '<p class="muted">—</p>'}</div>
    </div>`;
  $('#stats-year').onchange = (e) => renderDetails(e.target.value);
  $('#stats-print').onclick = () => window.bcdPrint();
}

/** Accueil du compte « Ajout de livres » (bénévole, service civique, stagiaire) : pas d'accès aux élèves ni aux prêts. */
async function renderCataloguer(app) {
  const res = await api.get('/documents?sort=recent&limit=12');
  app.innerHTML = `
    <div class="page-head"><div><h1>Bonjour ${esc(state.user.first_name)} 👋</h1>
      <p class="muted">${esc(state.info.school_name)} — ajout et mise à jour des livres de la BCD</p></div></div>
    <div class="grid grid-2">
      <a class="card big-action" href="#/document/nouveau"><span>➕</span><b>Ajouter un livre</b>
        <span class="muted small">Tapez ou scannez son ISBN : la fiche arrive toute seule.</span></a>
      <a class="card big-action" href="#/inventaire"><span>📚</span><b>Tous les livres</b>
        <span class="muted small">${plural(res.total, 'livre')} dans la BCD.</span></a>
    </div>
    <div class="card"><h2 style="margin-top:0">Derniers livres ajoutés</h2>
      ${res.items.length ? res.items.map((d) => `<a class="doc-cell" href="#/document/${d.id}" style="margin-bottom:.5rem;text-decoration:none;color:inherit">
        ${cover(d)}<div><div class="doc-title">${esc(d.title)}</div><span class="cote">${esc(d.cote ?? '')}</span></div></a>`).join('')
      : '<p class="muted">Aucun livre pour le moment.</p>'}</div>`;
}

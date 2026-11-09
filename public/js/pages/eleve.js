/** Espace élève : recherche simplifiée avec couvertures, et « mes livres ». */
import { api, qs } from '../api.js';
import { esc, cover, fmtDate, $, $$ } from '../ui.js';
import { state, navigate } from '../state.js';

const CATS = [
  ['', '✨ Tout'], ['album', '🖼️ Albums'], ['premiere_lecture', '🔤 Premières lectures'], ['roman', '📖 Romans'],
  ['bd', '💬 BD'], ['manga', '🎌 Mangas'], ['conte', '🧚 Contes'], ['poesie', '🎵 Poésie'], ['documentaire', '🔬 Documentaires'],
];

export async function render(app, { path, query }) {
  if (path === '/mes-prets') return myLoans(app);
  const res = await api.get('/documents' + qs({ q: query.q, doc_type: query.type, sort: query.q ? '' : 'recent', limit: 60 }));
  app.innerHTML = `<div style="text-align:center"><h1>Bonjour ${esc(state.user.first_name)} ${esc(state.user.avatar)}</h1>
      <p class="muted">Quel livre cherches-tu ?</p></div>
    <form class="kid-search" id="f"><input name="q" value="${esc(query.q)}" placeholder="Un titre, un auteur, un sujet…" autocomplete="off">
      <button class="btn btn-primary">🔎</button></form>
    <div class="kid-cats">${CATS.map(([k, l]) => `<button type="button" data-t="${k}" class="${(query.type ?? '') === k ? 'active' : ''}">${l}</button>`).join('')}</div>
    ${!query.q && !query.type ? '<h2>📚 Les nouveautés</h2>' : ''}
    ${res.items.length ? `<div class="book-grid">${res.items.map((d) => `<a class="book-card" href="#/document/${d.id}">
      ${cover(d, 'cover-md')}<span class="t">${esc(d.title)}</span><span class="a">${esc(shortAuthors(d.authors))}</span>
      <span class="dispo ${d.available_count ? 'yes' : 'no'}">${d.available_count ? '✅ Disponible' : '⏳ Déjà emprunté'}</span>
      <span class="cote small" style="align-self:flex-start">${esc(d.cote ?? '')}</span></a>`).join('')}</div>`
    : '<div class="empty" style="font-size:1.2rem">🙈 Je n\'ai rien trouvé. Essaie un autre mot !</div>'}`;

  const go = (q, type) => navigate('#/' + qs({ q, type }));
  $('#f').onsubmit = (e) => { e.preventDefault(); go(e.target.q.value.trim(), query.type); };
  for (const b of $$('.kid-cats button')) b.onclick = () => go(query.q, b.dataset.t);
}

function shortAuthors(a) {
  return String(a ?? '').split(';').slice(0, 2).map((x) => {
    const [nom, prenom] = x.split(',').map((s) => s.trim());
    return prenom ? `${prenom} ${nom}` : nom;
  }).join(', ');
}

async function myLoans(app) {
  const { current, history } = await api.get('/me/loans');
  app.innerHTML = `<h1>${esc(state.user.avatar)} Mes livres</h1>
    ${current.length ? current.map((l) => `<div class="kid-loan ${l.overdue ? 'late' : ''}">
      ${cover(l)}<div class="grow"><b style="font-size:1.15rem">${esc(l.title)}</b><br>
      ${l.overdue ? `<span>⏰ Il faut le rendre vite : c'était le ${fmtDate(l.due_at)} !</span>`
        : `<span>📅 À rendre le <b>${fmtDate(l.due_at)}</b></span>`}</div></div>`).join('')
    : '<div class="empty" style="font-size:1.2rem">Tu n\'as pas de livre en ce moment. <a href="#/">Choisis-en un !</a></div>'}
    ${history.length ? `<h2>📜 Les livres que j'ai déjà lus</h2><div class="book-grid">${history.map((l) =>
      `<div class="book-card">${cover(l, 'cover-md')}<span class="t">${esc(l.title)}</span></div>`).join('')}</div>` : ''}`;
}

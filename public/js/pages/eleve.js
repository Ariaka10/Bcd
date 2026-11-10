/** Espace élève (maternelle) : thèmes en gros boutons, coups de cœur, « Mes livres » avec avis en émojis. */
import { api, qs } from '../api.js';
import { esc, cover, fmtDate, toast, $, $$ } from '../ui.js';
import { state, navigate, loadThemes } from '../state.js';

const TYPES = [['album', '🖼️ Albums'], ['conte', '🧚 Contes'], ['documentaire', '🔬 Pour apprendre'], ['bd', '💬 BD'], ['poesie', '🎵 Comptines']];
const REVIEWS = { 3: '😍', 2: '🙂', 1: '😐' };

function bookCard(d) {
  return `<a class="book-card" href="#/document/${d.id}">
    ${cover(d, 'cover-md')}<span class="t">${esc(d.title)}</span>
    <span class="dispo ${d.available_count ? 'yes' : 'no'}">${d.available_count ? '✅ Disponible' : '⏳ Emprunté'}</span>
    ${d.loves ? `<span class="small">😍 ${d.loves}</span>` : ''}</a>`;
}

export async function render(app, { path, query }) {
  if (path === '/mes-prets') return myLoans(app);
  const themes = await loadThemes();
  const filtering = query.q || query.theme || query.type;
  const [res, loves] = await Promise.all([
    api.get('/documents' + qs({ q: query.q, theme_id: query.theme, doc_type: query.type, sort: query.q ? '' : 'recent', limit: 60 })),
    filtering ? Promise.resolve([]) : api.get('/coups-de-coeur'),
  ]);
  const current = themes.find((t) => String(t.id) === String(query.theme));

  app.innerHTML = `<div style="text-align:center"><h1>Bonjour ${esc(state.user.first_name)} ${esc(state.user.avatar)}</h1>
      <p class="muted">Quel livre cherches-tu ?</p></div>
    ${themes.length ? `<div class="kid-themes">${themes.map((t) => `<button type="button" data-theme="${t.id}"
        class="${String(query.theme) === String(t.id) ? 'active' : ''}" style="${t.color ? `--chip:${t.color}` : ''}">
        <span class="kid-theme-emoji">${esc(t.emoji ?? '📚')}</span>${esc(t.name)}</button>`).join('')}</div>`
    : `<div class="kid-cats">${TYPES.map(([k, l]) => `<button type="button" data-type="${k}" class="${query.type === k ? 'active' : ''}">${l}</button>`).join('')}</div>`}
    <form class="kid-search" id="f"><input name="q" value="${esc(query.q)}" placeholder="🔎 Un titre, un mot…" autocomplete="off">
      <button class="btn btn-primary">🔎</button></form>
    ${filtering ? `<div class="row" style="justify-content:center;margin-bottom:1rem"><button class="btn btn-lg" id="all">✨ Tous les livres</button></div>` : ''}
    ${loves.length ? `<h2>😍 Les coups de cœur de l'école</h2><div class="book-grid">${loves.map(bookCard).join('')}</div>` : ''}
    <h2>${current ? `${esc(current.emoji ?? '')} ${esc(current.name)}` : query.q ? '🔎 Ta recherche' : '📚 Les nouveautés'}</h2>
    ${res.items.length ? `<div class="book-grid">${res.items.map(bookCard).join('')}</div>`
    : '<div class="empty" style="font-size:1.2rem">🙈 Je n\'ai rien trouvé. Essaie autre chose !</div>'}`;

  const go = (p) => navigate('#/' + qs(p));
  $('#f').onsubmit = (e) => { e.preventDefault(); go({ q: e.target.q.value.trim() }); };
  for (const b of $$('[data-theme]')) b.onclick = () => go(String(query.theme) === b.dataset.theme ? {} : { theme: b.dataset.theme });
  for (const b of $$('[data-type]')) b.onclick = () => go(query.type === b.dataset.type ? {} : { type: b.dataset.type });
  const all = $('#all');
  if (all) all.onclick = () => go({});
}

async function myLoans(app) {
  const { current, history, reservations, reviews } = await api.get('/me/loans');
  const seen = new Set();
  const read = history.filter((l) => l.document_id && !seen.has(l.document_id) && seen.add(l.document_id));
  app.innerHTML = `<h1>${esc(state.user.avatar)} Mes livres</h1>
    ${current.length ? current.map((l) => `<a class="kid-loan ${l.overdue ? 'late' : ''}" href="#/document/${l.document_id}">
      ${cover(l)}<div class="grow"><b style="font-size:1.15rem">${esc(l.title)}</b><br>
      ${l.overdue ? `<span>⏰ Il faut le rapporter vite : c'était le ${fmtDate(l.due_at)} !</span>`
        : `<span>📅 À rapporter le <b>${fmtDate(l.due_at)}</b></span>`}</div></a>`).join('')
    : '<div class="empty" style="font-size:1.2rem">Tu n\'as pas de livre en ce moment. <a href="#/">Choisis-en un !</a></div>'}
    ${reservations.length ? `<h2>🔖 Mes réservations</h2>${reservations.map((r) => `<a class="kid-loan" href="#/document/${r.document_id}">
      ${cover(r)}<div class="grow"><b style="font-size:1.15rem">${esc(r.title)}</b><br>
      ${r.status === 'prete' ? '🎉 Il t\'attend ! Demande-le à la maîtresse.' : '⏳ On te le garde quand il revient.'}</div></a>`).join('')}` : ''}
    ${read.length ? `<h2>📜 Les livres que j'ai lus</h2><p class="muted">Touche une frimousse pour dire si tu as aimé.</p>
      <div class="book-grid">${read.map((l) => `<div class="book-card">${cover(l, 'cover-md')}<span class="t">${esc(l.title)}</span>
        <div class="mini-reviews" data-doc="${l.document_id}">${[3, 2, 1].map((n) =>
          `<button class="${reviews[l.document_id] === n ? 'selected' : ''}" data-r="${n}">${REVIEWS[n]}</button>`).join('')}</div></div>`).join('')}</div>` : ''}`;

  for (const box of $$('.mini-reviews')) {
    for (const b of $$('button', box)) {
      b.onclick = async () => {
        const r = Number(b.dataset.r);
        const again = b.classList.contains('selected');
        await api.post(`/documents/${box.dataset.doc}/review`, { rating: again ? 0 : r });
        for (const x of $$('button', box)) x.classList.toggle('selected', !again && x === b);
        if (!again) toast('Merci ! 🎉');
      };
    }
  }
}

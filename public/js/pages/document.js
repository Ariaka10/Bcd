import { api } from '../api.js';
import { esc, cover, toast, modal, confirmBox, formData, fmtDate, plural, $, $$, debounce, resizeImage, pickImage, uploadCover } from '../ui.js';
import { state, navigate, isAdmin, typeLabel, loadThemes, themeChips } from '../state.js';
import { addToListDialog } from './catalogue.js';

const STATES = { ok: 'Bon état', abime: 'Abîmé', perdu: 'Perdu', reparation: 'En réparation' };

export async function render(app, { path, params }) {
  await loadThemes();
  if (path === '/document/nouveau') return renderForm(app, null);
  const doc = await api.get(`/documents/${params[0]}`);
  if (path.endsWith('/modifier')) return renderForm(app, doc);
  return renderDetail(app, doc);
}

const REVIEWS = { 3: ['😍', 'Adoré'], 2: ['🙂', 'Bien'], 1: ['😐', 'Bof'] };

function reviewSummary(d) {
  const total = d.reviews[1] + d.reviews[2] + d.reviews[3];
  if (!total) return '';
  return `<p class="reviews">${[3, 2, 1].filter((n) => d.reviews[n]).map((n) => `<span title="${REVIEWS[n][1]}">${REVIEWS[n][0]} ${d.reviews[n]}</span>`).join(' ')}</p>`;
}

function renderDetail(app, d) {
  if (state.user.role === 'eleve') return kidDetail(app, d);
  const meta = [
    ['Auteur(s)', d.authors], ['Éditeur', d.publisher], ['Année', d.pub_year], ['Pages', d.pages],
    ['Collection', d.series ? d.series + (d.series_number ? ' n° ' + d.series_number : '') : ''],
    ['Type', typeLabel(d.doc_type)], ['Mots-clés', d.keywords], ['Sujets', d.subjects], ['Public', d.audience], ['Dewey', d.dewey],
    ['ISBN / EAN', d.isbn], ['Emplacement', d.location], ['Notes', d.notes], ['Prêts au total', d.loan_count],
  ].filter(([, v]) => v !== null && v !== undefined && v !== '');

  app.innerHTML = `
    <div class="page-head no-print"><a href="javascript:history.back()" class="btn btn-ghost">← Retour</a>
      <div class="row">
        <button class="btn" id="reserve">🔖 Réserver pour…</button>
        <button class="btn" id="to-list">📋 Ajouter à une liste</button>
        <a class="btn" href="#/document/${d.id}/modifier">✏️ Modifier</a>
        ${isAdmin() ? '<button class="btn btn-danger" id="del">🗑️ Supprimer</button>' : ''}</div></div>
    <div class="card doc-detail">
      <div>${cover(d, 'cover-lg')}
        <div class="cover-actions no-print">
          <button class="btn btn-sm" id="set-cover">📷 ${d.cover_url ? 'Changer la couverture' : 'Ajouter une couverture'}</button>
          ${d.cover_url ? '<button class="btn btn-sm btn-ghost" id="rm-cover">Retirer l\'image</button>' : ''}</div></div>
      <div>
        <h1>${esc(d.title)}</h1>
        ${d.subtitle ? `<p class="muted" style="margin:0">${esc(d.subtitle)}</p>` : ''}
        <p><span class="cote" style="font-size:1.2rem">${esc(d.cote ?? '')}</span>
          <span class="badge ${d.available_count ? 'badge-ok' : 'badge-late'}" style="margin-left:.5rem">
          ${d.available_count ? `${plural(d.available_count, 'exemplaire disponible', 'exemplaires disponibles')}` : 'Tous les exemplaires sont empruntés'}</span></p>
        ${d.themes.length ? `<p>${themeChips(d.themes)}</p>` : ''}
        ${reviewSummary(d)}
        ${d.summary ? `<p>${esc(d.summary)}</p>` : ''}
        <dl class="meta-list">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${d.source_url ? `<p class="small"><a href="${esc(d.source_url)}" target="_blank" rel="noopener">Voir la notice d'origine (${esc(d.source)})</a></p>` : ''}
        ${d.lists?.length ? `<p class="small">Listes : ${d.lists.map((l) => `<a href="#/liste/${l.id}">${esc(l.name)}</a>`).join(', ')}</p>` : ''}
      </div>
    </div>
    ${d.reservations.length ? `<div class="card"><h2 style="margin-top:0">🔖 Réservations</h2><ul class="log">
      ${d.reservations.map((r) => `<li class="${r.status === 'prete' ? 'warn' : ''}">${esc(r.avatar)} <b>${esc(r.first_name)} ${esc(r.last_name)}</b>
        <span class="muted small">${esc(r.class_name ?? '')} · le ${fmtDate(r.created_at)}</span> —
        ${r.status === 'prete' ? '<b>mis de côté, à lui remettre</b>' : 'en attente du retour'}
        <button class="btn btn-sm cancel-res" data-id="${r.id}" style="float:right">Annuler</button></li>`).join('')}</ul></div>` : ''}
    <div class="card"><div class="row"><h2 class="grow" style="margin:0">Exemplaires</h2>
        <button class="btn btn-sm" id="add-copy">➕ Ajouter un exemplaire</button></div>
      <div class="table-wrap" style="margin-top:.8rem"><table><thead><tr><th>N°</th><th>État</th><th>Acquis le</th><th>Situation</th><th></th></tr></thead>
      <tbody>${d.copies.map((c) => `<tr>
        <td><b class="copy-number">${esc(c.barcode)}</b></td>
        <td><select class="copy-state" data-id="${c.id}" style="width:auto">${Object.entries(STATES).map(([k, l]) =>
          `<option value="${k}" ${c.state === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td>${fmtDate(c.acquired_at)}</td>
        <td>${c.loan_id ? `${c.user_id ? `<a href="#/usager/${c.user_id}">${esc(c.borrower)}</a>` : esc(c.borrower)}
          <span class="muted small">${c.user_id ? esc(c.borrower_class ?? '') : ''}</span><br>
          <span class="small ${c.due_at < today() ? 'badge badge-late' : 'muted'}">à rendre le ${fmtDate(c.due_at)}</span>`
          : '<span class="badge badge-ok">En rayon</span>'}</td>
        <td class="num">${isAdmin() && !c.loan_id ? `<button class="icon-btn del-copy" data-id="${c.id}" title="Supprimer l'exemplaire">🗑️</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">Aucun exemplaire</td></tr>'}</tbody></table></div></div>`;

  $('#to-list').onclick = () => addToListDialog([d.id]);
  $('#reserve').onclick = () => reserveDialog(d);
  $('#set-cover').onclick = async () => {
    const file = await pickImage();
    if (!file) return;
    try {
      await uploadCover(d.id, await resizeImage(file));
      toast('Couverture enregistrée');
      navigate(location.hash);
    } catch (e) { toast(e.message, 'error'); }
  };
  if ($('#rm-cover')) $('#rm-cover').onclick = async () => {
    if (!(await confirmBox('Retirer l\'image de couverture de ce livre ?'))) return;
    await api.del(`/documents/${d.id}/cover`);
    if (d.cover_url && !d.cover_url.startsWith('/api/')) await api.put(`/documents/${d.id}`, { cover_url: '' });
    navigate(location.hash);
  };
  for (const b of $$('.cancel-res')) {
    b.onclick = async () => {
      const r = await api.del(`/reservations/${b.dataset.id}`);
      toast(r.reserved_for ? `Réservation annulée — le livre est maintenant mis de côté pour ${r.reserved_for}` : 'Réservation annulée');
      navigate(location.hash);
    };
  }
  if ($('#del')) $('#del').onclick = async () => {
    if (!(await confirmBox(`Supprimer « ${d.title} » et ses ${d.copies.length} exemplaire(s) ?`, { ok: 'Supprimer', danger: true }))) return;
    try { await api.del(`/documents/${d.id}`); toast('Document supprimé'); navigate('#/catalogue'); } catch (e) { toast(e.message, 'error'); }
  };
  $('#add-copy').onclick = () => {
    const dlg = modal('Ajouter des exemplaires', `<form class="grid" id="f">
      <label>Nombre d'exemplaires<input name="count" type="number" min="1" max="50" value="1" autofocus></label>
      <p class="muted small" style="margin:0">Chaque exemplaire reçoit automatiquement le numéro suivant (à écrire sur le livre).</p>
      <details><summary class="small">Choisir le numéro moi-même</summary>
        <label style="margin-top:.4rem">Numéro<input name="barcode"></label></details>
      <div class="actions"><button type="button" class="btn" data-close>Annuler</button><button class="btn btn-primary">Ajouter</button></div></form>`);
    $('#f', dlg).onsubmit = async (e) => {
      e.preventDefault();
      const f = formData(e.target);
      try {
        const r = await api.post(`/documents/${d.id}/copies`, f.barcode ? { barcode: f.barcode } : { count: Number(f.count) });
        dlg.close(); toast(`Ajouté : n° ${r.barcodes.join(', ')}`); navigate(location.hash);
      } catch (err) { toast(err.message, 'error'); }
    };
  };
  for (const sel of $$('.copy-state')) {
    sel.onchange = async () => {
      try { await api.put(`/copies/${sel.dataset.id}`, { state: sel.value }); toast('État mis à jour'); } catch (e) { toast(e.message, 'error'); }
    };
  }
  for (const b of $$('.del-copy')) {
    b.onclick = async () => {
      if (!(await confirmBox('Supprimer cet exemplaire ?', { ok: 'Supprimer', danger: true }))) return;
      try { await api.del(`/copies/${b.dataset.id}`); navigate(location.hash); } catch (e) { toast(e.message, 'error'); }
    };
  }
}

async function reserveDialog(d) {
  const dlg = modal(`Réserver « ${d.title} »`, `<form class="grid" id="f">
    <label>Pour qui ?<input id="who" placeholder="Nom ou prénom…" autocomplete="off" autofocus></label>
    <div id="who-list"></div>
    <p class="muted small" style="margin:0">${d.available_count ? 'Un exemplaire est en rayon : il sera mis de côté tout de suite.'
      : 'Le livre sera mis de côté dès son retour.'}</p></form>`);
  const input = $('#who', dlg);
  const list = $('#who-list', dlg);
  input.oninput = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { list.innerHTML = ''; return; }
    const users = await api.get(`/users?q=${encodeURIComponent(q)}&limit=10`);
    list.innerHTML = `<div class="suggest">${users.map((u) => `<button type="button" data-id="${u.id}">
      <span class="avatar-sm">${esc(u.avatar)}</span><span class="grow">${esc(u.first_name)} ${esc(u.last_name)}</span>
      <span class="muted small">${esc(u.class_name ?? '')}</span></button>`).join('') || '<p class="muted small">Personne trouvé.</p>'}</div>`;
    for (const b of $$('button', list)) {
      b.onclick = async () => {
        try {
          const r = await api.post('/reservations', { document_id: d.id, user_id: Number(b.dataset.id) });
          dlg.close();
          toast(r.status === 'prete' ? 'Réservé — mettez un exemplaire de côté' : 'Réservé — il sera mis de côté au retour');
          navigate(location.hash);
        } catch (err) { toast(err.message, 'error'); }
      };
    }
  }, 200);
  $('#f', dlg).onsubmit = (e) => e.preventDefault();
}

/** Fiche simplifiée pour les élèves (maternelle) : grande image, avis en émojis, « Je le veux ! ». */
function kidDetail(app, d) {
  const myRes = d.reservations[0];
  app.innerHTML = `<div class="page-head"><a href="javascript:history.back()" class="btn btn-lg">⬅️ Retour</a></div>
    <div class="card kid-detail">
      ${cover(d, 'cover-xl')}
      <div class="grow">
        <h1>${esc(d.title)}</h1>
        ${d.themes.length ? `<p>${themeChips(d.themes)}</p>` : ''}
        <p class="dispo big ${d.available_count ? 'yes' : 'no'}">${d.available_count ? '✅ Il est dans la bibliothèque' : '⏳ Quelqu\'un l\'a emprunté'}</p>
        ${d.on_loan_to_me ? '<p class="big">📖 C\'est toi qui l\'as !</p>'
          : myRes ? `<p class="big">🔖 ${myRes.status === 'prete' ? 'Il t\'attend : demande-le à la maîtresse !' : 'Tu l\'as réservé. On te le garde quand il revient.'}</p>
            <button class="btn" id="unreserve">Je ne le veux plus</button>`
          : '<button class="btn btn-primary btn-xl" id="want">🙋 Je le veux !</button>'}
        <h2>Tu as aimé ce livre ?</h2>
        <div class="review-buttons">${[3, 2, 1].map((n) => `<button class="${d.my_review === n ? 'selected' : ''}" data-r="${n}">
          <span>${REVIEWS[n][0]}</span>${REVIEWS[n][1]}</button>`).join('')}</div>
      </div></div>`;
  for (const b of $$('.review-buttons button')) {
    b.onclick = async () => {
      const r = Number(b.dataset.r);
      await api.post(`/documents/${d.id}/review`, { rating: d.my_review === r ? 0 : r });
      d.my_review = d.my_review === r ? null : r;
      for (const x of $$('.review-buttons button')) x.classList.toggle('selected', Number(x.dataset.r) === d.my_review);
      if (d.my_review) toast('Merci ! 🎉');
    };
  }
  const want = $('#want');
  if (want) want.onclick = async () => {
    try { await api.post('/me/reservations', { document_id: d.id }); toast('C\'est noté ! 🔖'); navigate(location.hash); } catch (e) { toast(e.message, 'error'); }
  };
  const un = $('#unreserve');
  if (un) un.onclick = async () => { await api.del(`/reservations/${myRes.id}`); navigate(location.hash); };
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function renderForm(app, doc) {
  const d = doc ?? { doc_type: 'album' };
  const types = Object.entries(state.meta.doc_types);
  const field = (name, label, attrs = '', cls = '') => `<label class="${cls}">${label}<input name="${name}" value="${esc(d[name] ?? '')}" ${attrs}></label>`;
  app.innerHTML = `
    <div class="page-head"><h1>${doc ? 'Modifier la notice' : 'Ajouter un document'}</h1>
      <a href="${doc ? `#/document/${doc.id}` : '#/catalogue'}" class="btn btn-ghost">Annuler</a></div>
    ${doc ? '' : `<form class="isbn-box" id="isbn-form">
      <label>ISBN du livre <span class="muted small">— le numéro écrit sous le code-barres, au dos (978…)</span>
        <input name="isbn" id="isbn-input" inputmode="numeric" placeholder="978…" autofocus></label>
      <button class="btn btn-primary">🔎 Chercher la notice</button></form>
      <div id="isbn-result"></div>`}
    <form class="card" id="doc-form">
      <div class="grid grid-4">
        <label class="span-2">Titre *<input name="title" value="${esc(d.title ?? '')}" required></label>
        ${field('subtitle', 'Sous-titre', '', 'span-2')}
        <label class="span-2">Auteur(s) <span class="muted small">— « Nom, Prénom » séparés par « ; »</span>
          <input name="authors" value="${esc(d.authors ?? '')}" placeholder="Dahl, Roald ; Blake, Quentin"></label>
        ${field('publisher', 'Éditeur')}
        ${field('pub_year', 'Année', 'type="number" min="1500" max="2100"')}
        <label>Type de document<select name="doc_type">${types.map(([k, t]) =>
          `<option value="${k}" ${d.doc_type === k ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
        <label class="span-2">Mots-clés <span class="muted small">— séparés par « ; » (ex. : loup ; peur ; nuit)</span>
          <input name="keywords" value="${esc(d.keywords ?? '')}"></label>
        <div class="span-all"><b>Thèmes</b> ${state.themes.length ? '' : `<span class="muted small">— aucun thème : ${isAdmin()
          ? '<a href="#/themes">créez-en dans Catalogue → Thèmes</a>' : "l'administrateur peut en créer"}</span>`}
          <div class="theme-bar" style="margin-top:.4rem">${state.themes.map((t) => `<label class="chip chip-lg chip-check" style="${t.color ? `--chip:${t.color}` : ''}">
            <input type="checkbox" class="theme-cb" value="${t.id}" ${(d.themes ?? []).some((x) => x.id === t.id) ? 'checked' : ''}>
            ${esc(t.emoji ?? '')} ${esc(t.name)}</label>`).join('')}</div></div>
        ${field('series', 'Collection / série')}
        ${field('series_number', 'N° dans la série')}
        ${field('pages', 'Pages', 'type="number" min="0"')}
        <label class="span-2">Sujets <span class="muted small">— séparés par « ; »</span><input name="subjects" value="${esc(d.subjects ?? '')}"></label>
        ${field('dewey', 'Indice Dewey', 'placeholder="590"')}
        ${field('audience', 'Public / niveau', 'placeholder="Cycle 2, dès 6 ans…"')}
        <div class="cote-field span-2"><label>Cote <input name="cote" id="cote" value="${esc(d.cote ?? '')}" placeholder="Calculée automatiquement"></label>
          <button type="button" class="btn" id="calc-cote" title="Recalculer la cote">🔁 Calculer</button></div>
        ${field('location', 'Emplacement', 'placeholder="Bac albums, étagère 3…"')}
        ${field('isbn', 'ISBN / EAN')}
        <label class="span-all">Résumé<textarea name="summary" rows="3">${esc(d.summary ?? '')}</textarea></label>
        <div class="span-2 cover-box"><div id="cover-preview">${cover(d, 'cover-md')}</div>
          <div><b>Couverture</b>
            <div class="row" style="margin:.4rem 0"><button type="button" class="btn btn-sm" id="pick-cover">📷 Choisir une image ou une photo</button>
              <button type="button" class="btn btn-sm btn-ghost" id="clear-cover">✕ Aucune</button></div>
            <p class="muted small" style="margin:0">Astuce : une image copiée (clic droit → « Copier l'image ») se colle ici avec Ctrl+V.</p>
            <details style="margin-top:.4rem"><summary class="small">Adresse web de l'image</summary>
              <input name="cover_url" value="${esc(d.cover_url ?? '')}" style="margin-top:.3rem"></details></div></div>
        <label class="span-2">Notes internes<input name="notes" value="${esc(d.notes ?? '')}"></label>
        ${doc ? '' : `<label>Nombre d'exemplaires<input name="copies" type="number" min="0" max="50" value="1"></label>
        <p class="span-2 muted small" style="align-self:end">Chaque exemplaire reçoit un numéro (1, 2, 3…) à écrire sur le livre.</p>`}
        <input type="hidden" name="source" value="${esc(d.source ?? '')}">
        <input type="hidden" name="source_url" value="${esc(d.source_url ?? '')}">
      </div>
      <div class="actions">
        ${doc ? '' : '<label class="check" style="margin-right:auto"><input type="checkbox" id="again" checked> Enchaîner avec un autre document</label>'}
        <button class="btn btn-primary btn-lg">💾 Enregistrer</button></div>
    </form>`;

  const form = $('#doc-form');

  // Couverture choisie dans le formulaire : envoyée juste après l'enregistrement du livre.
  let pendingCover = null;
  const showCover = (url) => { $('#cover-preview').innerHTML = cover({ title: form.title.value || '?', cover_url: url }, 'cover-md'); };
  const setPending = async (file) => {
    try {
      pendingCover = await resizeImage(file);
      showCover(URL.createObjectURL(pendingCover));
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#pick-cover').onclick = async () => { const f = await pickImage(); if (f) setPending(f); };
  $('#clear-cover').onclick = () => { pendingCover = null; form.cover_url.value = ''; showCover(null); };
  form.cover_url.addEventListener('change', () => { pendingCover = null; showCover(form.cover_url.value); });
  form.addEventListener('paste', (e) => {
    const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (file) { e.preventDefault(); setPending(file); }
  });
  let coteTouched = Boolean(doc?.cote);
  const recompute = async (force) => {
    if (coteTouched && !force) return;
    try {
      const { cote } = await api.post('/cote', formData(form));
      form.cote.value = cote;
    } catch { /* ignore */ }
  };
  const auto = debounce(() => recompute(false), 300);
  for (const n of ['title', 'authors', 'doc_type', 'series', 'dewey', 'subjects']) form[n].addEventListener('input', auto);
  form.doc_type.addEventListener('change', auto);
  form.cote.addEventListener('input', () => { coteTouched = form.cote.value.trim() !== ''; });
  $('#calc-cote').onclick = () => { coteTouched = false; recompute(true); };

  const fill = (n) => {
    for (const [k, v] of Object.entries(n)) {
      if (form[k] && v !== null && v !== undefined && form[k].type !== 'checkbox') form[k].value = v;
    }
    if (!pendingCover) showCover(form.cover_url.value);
    coteTouched = false;
  };

  const isbnForm = $('#isbn-form');
  if (isbnForm) {
    isbnForm.onsubmit = async (e) => {
      e.preventDefault();
      const isbn = isbnForm.isbn.value.trim();
      if (!isbn) return;
      const box = $('#isbn-result');
      box.innerHTML = '<p class="muted">Recherche de la notice (BnF, Open Library, Google Books)…</p>';
      try {
        const r = await api.get(`/isbn/${encodeURIComponent(isbn)}`);
        if (r.error) { box.innerHTML = `<p class="badge badge-late">${esc(r.error)}</p>`; return; }
        let html = '';
        if (r.local) {
          html += `<div class="card" style="background:var(--warn-soft)">⚠️ Ce document est déjà au catalogue :
            <a href="#/document/${r.local.id}">${esc(r.local.title)}</a> <span class="cote">${esc(r.local.cote ?? '')}</span>
            <button class="btn btn-sm" id="add-copy-existing" style="margin-left:.5rem">➕ Ajouter un exemplaire</button></div>`;
        }
        if (r.found) {
          form.reset();
          fill(r.notice);
          html += `<p class="notice-source">✅ Notice trouvée (${esc({ bnf: 'BnF', openlibrary: 'Open Library', google: 'Google Books' }[r.notice.source] ?? r.notice.source)}).
            Vérifiez le type de document et la cote, puis enregistrez.</p>`;
        } else {
          form.reset();
          form.isbn.value = r.isbn;
          html += `<p class="notice-source">Aucune notice trouvée pour ${esc(r.isbn)}${r.errors?.length ? ` (${esc(r.errors.join(' ; '))})` : ''}. Saisissez-la à la main.</p>`;
        }
        box.innerHTML = html;
        const addBtn = $('#add-copy-existing');
        if (addBtn) addBtn.onclick = async () => {
          const res = await api.post(`/documents/${r.local.id}/copies`, { count: 1 });
          toast(`Exemplaire ${res.barcodes[0]} ajouté`);
          isbnForm.reset(); box.innerHTML = ''; isbnForm.isbn.focus();
        };
        if (r.found && !r.local) form.title.focus();
      } catch (err) { box.innerHTML = `<p class="badge badge-late">${esc(err.message)}</p>`; }
    };
  }

  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = formData(form);
    data.theme_ids = $$('.theme-cb', form).filter((cb) => cb.checked).map((cb) => Number(cb.value));
    const again = $('#again')?.checked;
    if (data.copies !== undefined) data.copies = Number(data.copies);
    try {
      if (doc) {
        await api.put(`/documents/${doc.id}`, data);
        if (pendingCover) await uploadCover(doc.id, pendingCover);
        toast('Notice enregistrée');
        navigate(`#/document/${doc.id}`);
      } else {
        const r = await api.post('/documents', data);
        if (pendingCover) await uploadCover(r.id, pendingCover).catch((e) => toast(e.message, 'error'));
        const next = again ? '#/document/nouveau' : `#/document/${r.id}`;
        if (!r.barcodes.length) {
          toast(`Ajouté — cote ${r.cote}`);
          return navigate(next);
        }
        // Le numéro à écrire sur le livre, bien visible.
        const dlg = modal('Livre enregistré ✅', `<div class="number-box">
            <p>Écrivez ${r.barcodes.length > 1 ? 'ces numéros sur les exemplaires' : 'ce numéro sur le livre'} :</p>
            <div class="big-numbers">${r.barcodes.map((b) => `<span>n° ${esc(b)}</span>`).join('')}</div>
            <p class="muted">Cote à coller sur le dos : <span class="cote">${esc(r.cote)}</span></p></div>
          <div class="actions"><button class="btn btn-primary btn-lg" data-close autofocus>${again ? '➕ Livre suivant' : 'OK'}</button></div>`);
        const here = location.hash;
        // Seulement si l'on est resté sur cette page (fermeture différée par le navigateur).
        dlg.addEventListener('close', () => { if (location.hash === here) navigate(next); });
      }
    } catch (err) { toast(err.message, 'error'); }
  };
}

/** Petits utilitaires d'interface. */

export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function on(root, event, selector, fn) {
  root.addEventListener(event, (e) => {
    const el = e.target.closest(selector);
    if (el && root.contains(el)) fn(e, el);
  });
}

export function toast(msg, type = 'ok') {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.classList.add('hide'), type === 'error' ? 5000 : 2800);
  setTimeout(() => el.remove(), type === 'error' ? 5600 : 3400);
}

/** Ouvre une fenêtre modale ; renvoie l'élément <dialog>. */
export function modal(title, bodyHtml, { wide } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (wide ? ' modal-wide' : '');
  dlg.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2>
    <button type="button" class="icon-btn" data-close aria-label="Fermer">✕</button></div>
    <div class="modal-body">${bodyHtml}</div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
  });
  dlg.showModal();
  return dlg;
}

export function confirmBox(message, { ok = 'Confirmer', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = modal('Confirmation', `<p>${esc(message)}</p>
      <div class="actions"><button class="btn" data-close>Annuler</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button></div>`);
    let result = false;
    dlg.querySelector('[data-ok]').onclick = () => { result = true; dlg.close(); };
    dlg.addEventListener('close', () => resolve(result));
  });
}

export function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function plural(n, one, many = one + 's') {
  return `${n} ${n > 1 ? many : one}`;
}

export function cover(doc, cls = '') {
  const letter = esc((doc.title ?? '?').trim()[0] ?? '?');
  const hue = [...String(doc.title ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const fallback = `<div class="cover-fallback" style="--h:${hue}"><span>${letter}</span></div>`;
  if (!doc.cover_url) return `<div class="cover ${cls}">${fallback}</div>`;
  return `<div class="cover ${cls}">${fallback}<img src="${esc(doc.cover_url)}" alt="" loading="lazy"
    onload="if(this.naturalWidth<2)this.remove()" onerror="this.remove()"></div>`;
}

/** Lit un fichier texte en devinant l'encodage (ONDE exporte souvent en Windows-1252). */
export async function readTextFile(file) {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-1252').decode(buf);
}

export function download(url) {
  const a = document.createElement('a');
  a.href = url;
  a.download = '';
  document.body.append(a);
  a.click();
  a.remove();
}

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Réduit une image (photo de téléphone…) à `max` pixels de côté, en JPEG : quelques dizaines de Ko. */
export async function resizeImage(file, max = 800) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible'));
      i.src = url;
    });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Ouvre le sélecteur de fichier (ou l'appareil photo sur tablette / téléphone) pour une image. */
export function pickImage() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files[0] ?? null);
    input.click();
  });
}

/** Envoie une couverture pour un document. */
export async function uploadCover(docId, blob) {
  const res = await fetch(`/api/documents/${docId}/cover`, {
    method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: blob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Envoi impossible');
  return data;
}

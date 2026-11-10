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

const TITLE_ARTICLES = new Set(['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd']);

/** Lettre affichée sur la vignette : celle du premier mot significatif (« Le loup… » → « L » de loup). */
function coverLetter(title) {
  const words = String(title ?? '').trim().split(/[\s'’]+/).filter(Boolean);
  const word = words.find((w) => !TITLE_ARTICLES.has(w.toLowerCase())) ?? words[0] ?? '?';
  return (word.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
}

/** Vignette sans image : l'icône de l'application (livre ouvert), la lettre sur la page de gauche. */
function coverFallback(title) {
  return `<div class="cover-fallback"><svg viewBox="0 0 200 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="200" height="300" fill="#2f6f5e"/>
    <g transform="translate(-28 18) scale(.5)">
      <path d="M256 168 C 214 136 150 128 96 138 L 96 368 C 150 358 214 366 256 398 Z" fill="#fff"/>
      <path d="M256 168 C 298 136 362 128 416 138 L 416 368 C 362 358 298 366 256 398 Z" fill="#f1eee6"/>
      <path d="M256 168 L 256 398" stroke="#2f6f5e" stroke-width="6"/>
      <g fill="none" stroke="#c9c2b2" stroke-width="10" stroke-linecap="round">
        <path d="M286 200 C 312 188 344 184 380 190"/><path d="M286 240 C 312 228 344 224 380 230"/>
        <path d="M286 280 C 312 268 344 264 380 270"/><path d="M286 320 C 312 308 344 304 380 310"/></g>
      <path d="M330 120 L 370 120 L 370 214 L 350 196 L 330 214 Z" fill="#e9a23b"/>
      <text x="176" y="318" text-anchor="middle" font-size="150" font-weight="800" fill="#2f6f5e"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif">${esc(coverLetter(title))}</text>
    </g></svg></div>`;
}

export function cover(doc, cls = '') {
  const fallback = coverFallback(doc.title);
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

/**
 * Aperçu avant impression : la page telle qu'elle sortira sur papier (format A4), avec le choix
 * portrait / paysage, puis « Imprimer » ouvre la fenêtre d'impression de Windows.
 */
let printCss = null;
export async function printPreview() {
  const view = document.querySelector('#app > div') ?? document.querySelector('#app');
  // Les styles « impression » sont appliqués à l'aperçu (@media print → toujours).
  printCss ??= (await (await fetch('/style.css')).text()).replace(/@media print/g, '@media all');
  const title = document.querySelector('#app h1')?.textContent?.trim() || document.title;
  const dlg = modal(`Aperçu avant impression — ${title}`, `
    <div class="print-toolbar">
      <label class="check"><input type="radio" name="orient" value="portrait" checked> Portrait</label>
      <label class="check"><input type="radio" name="orient" value="landscape"> Paysage</label>
      <span class="grow"></span>
      <button type="button" class="btn" data-close>Annuler</button>
      <button type="button" class="btn btn-primary" id="do-print">🖨️ Imprimer</button></div>
    <div class="print-stage"><iframe class="print-sheet" title="Aperçu"></iframe></div>
    <div class="actions"><button type="button" class="btn" data-close>Annuler</button>
      <button type="button" class="btn btn-primary btn-lg" id="do-print-2">🖨️ Imprimer</button></div>`, { wide: true });
  dlg.classList.add('modal-print');
  const frame = dlg.querySelector('iframe');
  const write = (orient) => {
    const landscape = orient === 'landscape';
    frame.style.width = landscape ? '297mm' : '210mm';
    frame.style.minHeight = landscape ? '210mm' : '297mm';
    frame.srcdoc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <style>${printCss}</style>
      <style>@page { size: A4 ${orient}; margin: 12mm; }
        html, body { background: #fff; } body { margin: 0; padding: 12mm; font-size: 12px; }
        @media print { body { padding: 0; } }</style></head>
      <body data-role="${esc(document.body.dataset.role ?? '')}"><main class="app">${view.innerHTML}</main></body></html>`;
  };
  write('portrait');
  // Ajuste la hauteur de la feuille au contenu (plusieurs pages à la suite).
  frame.onload = () => {
    const doc = frame.contentDocument;
    if (doc?.body) frame.style.height = `${Math.max(doc.documentElement.scrollHeight, frame.offsetWidth * 1.41)}px`;
  };
  for (const r of dlg.querySelectorAll('input[name=orient]')) r.onchange = () => write(r.value);
  const go = () => frame.contentWindow.print();
  dlg.querySelector('#do-print').onclick = go;
  dlg.querySelector('#do-print-2').onclick = go;
  return dlg;
}

/**
 * Clés USB (application Windows, administrateur) : proposition de sauvegarde quand une clé inconnue est branchée,
 * message quand une copie a été faite sur une clé mémorisée.
 */
import { api } from './api.js';
import { esc, toast, modal } from './ui.js';
import { state } from './state.js';

let timer = null;
let lastEvent = null; // dernier message déjà affiché
let askedFor = null; // clé pour laquelle la question a déjà été posée

const keyName = (k) => `${k.label ? `« ${esc(k.label)} »` : 'sans nom'}${k.letter ? ` (${esc(k.letter)}:)` : ''}`;

function stop() {
  clearInterval(timer);
  timer = null;
}

async function tick() {
  if (state.user?.role !== 'admin') return stop();
  let s;
  try { s = await api.get('/app/usb'); } catch { return; }
  if (!s.supported) return stop();
  for (const ev of s.events) {
    // Au premier passage, seuls les messages récents (clé branchée juste avant la connexion) sont montrés.
    const fresh = lastEvent === null ? Date.now() - Date.parse(ev.at) < 20000 : ev.id > lastEvent;
    if (!fresh) continue;
    if (ev.type === 'copied') toast(`💾 Sauvegarde copiée sur la clé ${ev.label ? `« ${ev.label} »` : ''}`);
    else toast(`Copie sur la clé ${ev.label ? `« ${ev.label} »` : ''} impossible : ${ev.error}`, 'error');
  }
  lastEvent = Math.max(lastEvent ?? 0, ...s.events.map((e) => e.id));
  if (s.pending && askedFor !== s.pending.serial && !document.querySelector('dialog[open]')) ask(s.pending);
  if (!s.pending) askedFor = null;
}

function ask(key) {
  askedFor = key.serial;
  const dlg = modal('🔑 Clé USB détectée', `
    <p>La clé ${keyName(key)} vient d'être branchée.<br>Voulez-vous y faire une <b>sauvegarde de la BCD</b> ?</p>
    <p class="muted small">La sauvegarde est rangée dans le dossier <code>BCD-sauvegardes</code> de la clé
      (les 10 dernières sont gardées). Vos autres fichiers ne sont pas touchés.</p>
    <div class="usb-choices">
      <button class="btn btn-primary" data-choice="always">✅ Toujours sur cette clé
        <span class="small">sauvegarde automatique dès qu'elle est branchée, et à la fermeture</span></button>
      <button class="btn" data-choice="once">💾 Une seule fois</button>
      <button class="btn" data-choice="later">Pas maintenant</button>
      <button class="btn btn-ghost" data-choice="never">Ne jamais demander pour cette clé</button>
    </div>`);
  let answered = false;
  for (const b of dlg.querySelectorAll('[data-choice]')) {
    b.onclick = async () => {
      answered = true;
      for (const x of dlg.querySelectorAll('[data-choice]')) x.disabled = true;
      try {
        await api.post('/app/usb/answer', { serial: key.serial, choice: b.dataset.choice });
        dlg.close();
        const msg = { always: 'Clé mémorisée — sauvegarde copiée ✅', once: 'Sauvegarde copiée sur la clé ✅', never: 'Cette clé ne sera plus proposée' };
        if (msg[b.dataset.choice]) toast(msg[b.dataset.choice]);
        // Le message de copie est déjà affiché ici : pas de doublon au passage suivant.
        lastEvent = null;
        const s = await api.get('/app/usb').catch(() => null);
        if (s) lastEvent = Math.max(0, ...s.events.map((e) => e.id));
        window.dispatchEvent(new Event('bcd-usb-changed'));
      } catch (e) {
        toast(e.message, 'error');
        dlg.close();
      }
    };
  }
  // Fermée avec ✕ : comme « Pas maintenant ».
  dlg.addEventListener('close', () => {
    if (!answered) api.post('/app/usb/answer', { serial: key.serial, choice: 'later' }).catch(() => {});
  });
}

/** À appeler après chaque changement de page : démarre la surveillance pour l'administrateur. */
export function watchUsb() {
  if (state.user?.role !== 'admin' || timer) return;
  timer = setInterval(tick, 3000);
  tick();
}

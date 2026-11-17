/**
 * Lecture à voix haute pour les élèves qui ne lisent pas encore : titres, disponibilité, messages.
 * Utilise la voix française installée avec Windows : fonctionne sans Internet.
 */

let auto = false; // lire aussi les messages qui s'affichent (espace élève)
let voice = null;

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Voix française, de préférence installée sur l'ordinateur (hors ligne). */
function pickVoice() {
  if (!supported()) return;
  const fr = speechSynthesis.getVoices().filter((v) => /^fr(-|_|$)/i.test(v.lang));
  voice = fr.find((v) => /fr-FR/i.test(v.lang) && v.localService) ?? fr.find((v) => v.localService) ?? fr[0] ?? null;
}
if (supported()) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

/** Texte prêt à être lu : sans émojis ni symboles, « Nom, Prénom » remis dans l'ordre. */
export function sayable(text) {
  return String(text ?? '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** « Donaldson, Julia ; Scheffler, Axel » → « Julia Donaldson et Axel Scheffler » */
export function authorsSpoken(authors) {
  const names = String(authors ?? '').split(';').map((a) => a.trim()).filter(Boolean)
    .map((a) => a.split(',').map((x) => x.trim()).reverse().join(' '));
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} et ${names.at(-1)}`;
}

export function speak(text) {
  const t = sayable(text);
  if (!supported() || !t) return;
  speechSynthesis.cancel(); // un seul texte à la fois : le dernier touché
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'fr-FR';
  if (voice) u.voice = voice;
  u.rate = 0.9; // un peu plus lent, pour les petits
  speechSynthesis.speak(u);
}

export const setAutoSpeak = (on) => { auto = Boolean(on); };
/** Messages à l'écran : lus seulement dans l'espace élève. */
export const speakIfAuto = (text) => { if (auto) speak(text); };

/**
 * Bouton 🔊 (élément <span> : il peut se placer dans un lien ou un bouton, sans déclencher leur action).
 * `big` : bouton « Écouter » bien visible.
 */
export function speakButton(text, { big = false, label = 'Écouter' } = {}) {
  if (!supported()) return '';
  const safe = String(text ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<span class="speak-btn${big ? ' speak-big' : ''}" role="button" tabindex="0" data-say="${safe}"
    title="${label}" aria-label="${label}">🔊${big ? ` ${label}` : ''}</span>`;
}

// Un seul écouteur pour tous les boutons 🔊 : lit le texte sans ouvrir le livre ni le thème.
if (typeof document !== 'undefined') {
  const handle = (e) => {
    const b = e.target.closest?.('.speak-btn');
    if (!b) return false;
    e.preventDefault();
    e.stopPropagation();
    speak(b.dataset.say);
    return true;
  };
  document.addEventListener('click', handle, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handle(e); }, true);
}

/** « 2026-12-03 » → « jeudi 3 décembre » (plus clair à l'oral que 03/12/2026). */
export function dateSpoken(s) {
  if (!s) return '';
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

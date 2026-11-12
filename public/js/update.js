import { api } from './api.js';
import { esc, modal } from './ui.js';

const mo = (n) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0).replace('.', ',')} Mo`;

/**
 * Lance la mise à jour de l'application et affiche son avancement :
 * barre de progression du téléchargement, puis annonce du redémarrage.
 */
export async function runUpdate(update) {
  const patch = update?.install_mode === 'patch';
  const dlg = modal(`⬇️ Mise à jour vers la version ${update?.version ?? ''}`, `
    <p id="upd-text">Préparation du téléchargement…</p>
    <div class="progress progress-lg"><span id="upd-bar" style="width:0%"></span></div>
    <p class="small muted" id="upd-detail">${patch
      ? 'Seule la partie modifiée de l\'application est téléchargée (version sans installation).'
      : 'Téléchargement du nouvel installateur.'} Vos données sont conservées.</p>
    <div class="actions" id="upd-actions" hidden><button class="btn" data-close>Fermer</button></div>`);
  // Pas de fermeture par Échap pendant le téléchargement.
  dlg.addEventListener('cancel', (e) => { if ($a(dlg).hidden) e.preventDefault(); });
  const $ = (sel) => dlg.querySelector(sel);
  function $a(d) { return d.querySelector('#upd-actions'); }

  try {
    await api.post('/app/install-update');
  } catch (e) {
    return fail(e.message);
  }

  let restarting = false;
  const timer = setInterval(async () => {
    let p;
    try {
      p = (await api.get('/app/update-progress')).progress;
    } catch {
      // Le serveur s'arrête : c'est le redémarrage.
      if (restarting) clearInterval(timer);
      return;
    }
    if (!p) return;
    if (p.phase === 'download') {
      const pct = p.total ? Math.min(100, Math.round((p.received / p.total) * 100)) : 0;
      $('#upd-bar').style.width = `${pct}%`;
      $('#upd-text').innerHTML = `Téléchargement… <b>${pct} %</b>${p.total ? ` <span class="muted">(${mo(p.received)} sur ${mo(p.total)})</span>` : ''}`;
    } else if (p.phase === 'restart') {
      restarting = true;
      $('#upd-bar').style.width = '100%';
      $('#upd-text').innerHTML = '✅ Téléchargement terminé.<br><b>L\'application va se fermer puis se rouvrir toute seule</b> dans quelques secondes.';
      $('#upd-detail').textContent = p.mode === 'patch'
        ? 'Ne touchez à rien : la nouvelle version s\'ouvrira d\'elle-même.'
        : 'Installation en cours, sans droits administrateur. Ne touchez à rien : BCD s\'ouvrira de lui-même.';
    } else if (p.phase === 'error') {
      clearInterval(timer);
      fail(p.error);
    }
  }, 500);
  dlg.addEventListener('close', () => { if (!restarting) clearInterval(timer); });

  function fail(message) {
    $('#upd-text').innerHTML = `⚠️ ${esc(message)}`;
    $('#upd-detail').innerHTML = `Vous pouvez réessayer plus tard, ou télécharger la nouvelle version depuis
      <a href="${esc(update?.url ?? '#')}" target="_blank" rel="noopener">la page GitHub</a>.`;
    $a(dlg).hidden = false;
  }
}

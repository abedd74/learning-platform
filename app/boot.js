// Entry point loaded by the shell (<script type="module" src="app/boot.js">).
// Reads version.json without caching, then imports main.js?v=<version>, so a
// stale engine is never paired with new content. If anything fails, a plain
// message is shown instead of a blank page.
import { versionFrom, versionedUrl, FALLBACK_VERSION } from './core/version.js';

const base = new URL('.', import.meta.url);

async function readVersion() {
  try {
    const res = await fetch(new URL('../version.json', base), { cache: 'no-store' });
    if (!res.ok) return FALLBACK_VERSION;
    return versionFrom(await res.json());
  } catch {
    return FALLBACK_VERSION;
  }
}

function showBootError(err) {
  const el = document.getElementById('boot-error') || document.body.appendChild(document.createElement('div'));
  el.id = 'boot-error';
  el.setAttribute('role', 'alert');
  el.style.cssText = 'margin:2rem auto;max-width:28rem;padding:1rem 1.25rem;font:16px/1.5 system-ui,sans-serif;background:#fff3f3;color:#7a1f1f;border-radius:12px;';
  el.textContent = 'Die Lernplattform konnte nicht starten. Bitte die Seite neu laden. ' +
    'Wenn es wieder passiert: im Eltern-Modus das Fehlerprotokoll zeigen. ' +
    `(${err && err.message ? err.message : err})`;
}

(async () => {
  const version = await readVersion();
  globalThis.LP_VERSION = version;
  try {
    const mod = await import(versionedUrl(base, 'main.js', version));
    await mod.start?.({ version });
  } catch (err) {
    console.error('[boot]', err);
    showBootError(err);
  }
})();

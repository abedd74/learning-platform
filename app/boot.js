// Entry point loaded by the shell (<script type="module" src="app/boot.js">).
// Reads version.json without caching. When this device last ran another
// version, every file of the app is fetched again first — so new code is
// never paired with old code out of the browser's cache — and only then
// main.js?v=<version> is imported. If anything fails, a plain message with a
// retry button is shown instead of a blank page.
import { versionFrom, filesFrom, versionedUrl, FALLBACK_VERSION } from './core/version.js';
import { keys } from './core/storage.js';

const base = new URL('.', import.meta.url);

async function readStamp() {
  try {
    const res = await fetch(new URL('../version.json', base), { cache: 'no-store' });
    if (!res.ok) return { version: FALLBACK_VERSION, files: [] };
    const json = await res.json();
    return { version: versionFrom(json), files: filesFrom(json) };
  } catch {
    return { version: FALLBACK_VERSION, files: [] };
  }
}

// what this device loaded last (device-local, registered as appBoot)
const bootKey = (globalThis.LP_NAMESPACE || '') + keys.appBoot();
function lastVersion() { try { return JSON.parse(localStorage.getItem(bootKey) || 'null')?.v ?? null; } catch { return null; } }
function rememberVersion(v) { try { localStorage.setItem(bootKey, JSON.stringify({ v })); } catch {} }

/** A new version: pull every app file past the cache before anything is imported. */
async function refresh(files) {
  const results = await Promise.all(files.map(f => fetch(new URL(f, base), { cache: 'reload' }).then(r => r.ok, () => false)));
  return results.every(Boolean);
}

function showBootError(err) {
  const el = document.getElementById('boot-error') || document.body.appendChild(document.createElement('div'));
  el.id = 'boot-error';
  el.setAttribute('role', 'alert');
  el.style.cssText = 'margin:2rem auto;max-width:28rem;padding:1rem 1.25rem;font:16px/1.5 system-ui,sans-serif;background:#fff3f3;color:#7a1f1f;border-radius:12px;';
  el.textContent = 'Die Lernplattform konnte nicht starten. ' +
    `(${err && err.message ? err.message : err}) `;
  const again = document.createElement('button');
  again.type = 'button';
  again.textContent = 'Nochmal versuchen';
  again.style.cssText = 'display:block;margin-top:.75rem;padding:.6rem 1rem;font:inherit;font-weight:700;border-radius:10px;border:0;background:#7a1f1f;color:#fff;';
  again.addEventListener('click', () => location.reload());
  el.appendChild(again);
  document.getElementById('boot-wait')?.remove();
}

(async () => {
  const { version, files } = await readStamp();
  globalThis.LP_VERSION = version;
  try {
    if (version !== FALLBACK_VERSION && files.length && lastVersion() !== version) {
      // only remember the version once every file really arrived; otherwise the next start tries again
      if (await refresh(files)) rememberVersion(version);
    }
    const mod = await import(versionedUrl(base, 'main.js', version));
    await mod.start?.({ version });
  } catch (err) {
    console.error('[boot]', err);
    showBootError(err);
  }
})();

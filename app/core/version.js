// The app's version: read from version.json (never cached) by boot.js, used
// to import main.js with a cache-breaker so that the iPad never runs an old
// engine against new content (DESIGN §8). Pure helpers, used by boot.js
// and by the footer.

export const FALLBACK_VERSION = 'dev';

/** Version string out of a parsed version.json (or a fallback). */
export function versionFrom(json) {
  const v = json && typeof json === 'object' ? json.version : null;
  return (typeof v === 'string' && /^[\w.+-]{1,40}$/.test(v)) ? v : FALLBACK_VERSION;
}

/** URL of a module next to `base`, with the version as a cache-breaker. */
export function versionedUrl(base, file, version) {
  const u = new URL(file, base);
  u.searchParams.set('v', version || FALLBACK_VERSION);
  return u.href;
}

/** What the footer shows: 'v2026.11.03 · Sync ✓' */
export function footerText(version, syncStatus) {
  const sync = { ok: 'Sync ✓', sync: 'Sync …', offline: 'Sync offline', aus: 'Sync aus' }[syncStatus] || 'Sync aus';
  return `v${version || FALLBACK_VERSION} · ${sync}`;
}

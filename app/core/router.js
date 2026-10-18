// Hash router: '#/module/whales?topic=arten' → { path: ['module','whales'], params: {topic:'arten'} }.
// The old pages passed the profile as '?profil=<name>' in the search part;
// the forwarders keep that, so profileFromSearch() reads it.

export function parseHash(hash) {
  let h = String(hash || '');
  if (h.startsWith('#')) h = h.slice(1);
  if (h.startsWith('/')) h = h.slice(1);
  const q = h.indexOf('?');
  const pathPart = q === -1 ? h : h.slice(0, q);
  const params = {};
  if (q !== -1) for (const [k, v] of new URLSearchParams(h.slice(q + 1))) params[k] = v;
  const path = pathPart.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch { return s; } });
  return { path, params };
}

export function buildHash(path, params = {}) {
  const p = (Array.isArray(path) ? path : String(path).split('/')).filter(Boolean).map(encodeURIComponent).join('/');
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return `#/${p}${qs ? '?' + qs : ''}`;
}

/** The '?profil=' value of a search string (old links and the forwarders), or null. */
export function profileFromSearch(search) {
  try {
    const v = new URLSearchParams(String(search || '')).get('profil');
    return v && v.trim() ? v.trim() : null;
  } catch { return null; }
}

/**
 * createRouter({ window, onChange }) — onChange(route) is called on start and
 * on every hash change. navigate(path, params, {replace}) sets the hash.
 */
export function createRouter({ window: win = globalThis, onChange = () => {} } = {}) {
  let current = parseHash(win.location?.hash);
  const handler = () => { current = parseHash(win.location.hash); onChange(current); };
  function start() {
    win.addEventListener?.('hashchange', handler);
    onChange(current);
    return () => win.removeEventListener?.('hashchange', handler);
  }
  function navigate(path, params = {}, { replace = false } = {}) {
    const hash = buildHash(path, params);
    if (replace && win.history?.replaceState) {
      win.history.replaceState(null, '', hash);
      handler();
    } else if (win.location) {
      if (win.location.hash === hash) handler(); else win.location.hash = hash;
    }
  }
  return { start, navigate, get current() { return current; } };
}

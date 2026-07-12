/* ═══════════════════════════════════════════════════════════════════
   FamilySync — schlanke Cloud-Synchronisation für die Lernplattform.

   Prinzip: LOKAL ZUERST. Die App liest und schreibt immer localStorage
   und funktioniert komplett offline. FamilySync gleicht im Hintergrund
   mit Firestore ab (REST, kein SDK): beim Laden wird gezogen, nach
   Änderungen (entprellt) geschoben. Konflikte werden pro Schlüsseltyp
   gemischt — „mehr Fortschritt gewinnt".

   Einrichtung pro Gerät: einmal den Familien-Link öffnen
   (…/index.html?familie=GEHEIMER-CODE). Der Code wird lokal gespeichert
   und darf NICHT ins Repository committet werden — er ist das Passwort.
═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Firebase-Projekt (öffentlich — Schutz kommt von den Firestore-Regeln
  //    plus geheimem Familien-Code im Pfad) ──
  const CONFIG = {
    projectId: 'lernplattform-e37fb',
    apiKey:    'AIzaSyAAY8ZR9fTht5zCdT1TcaY-8oyoaCxULuw',
  };

  const FAMILY_KEY = 'family_sync_id';
  const META_KEY   = 'family_sync_meta';   // { <storageKey>: zuletzt gesehener ts } für LWW
  const PUSH_DEBOUNCE_MS = 5000;
  const PULL_MIN_INTERVAL_MS = 60000;

  /* ── Was wird synchronisiert und wie werden Konflikte gemischt? ──
     merge: (lokal, entfernt) → gemischt.  merge === null → Last-Write-Wins. */
  const RULES = [
    { re: /^gram_srs_.+$/,    merge: mergeSrs },
    { re: /^gram_days_.+$/,   merge: mergeMaxPerEntry },
    { re: /^gram_case_.+$/,   merge: mergeMaxPerEntry },
    { re: /^gram_badges_.+$/, merge: mergeDeepUnion },
    { re: /^wq_srs_.+$/,    merge: mergeSrs },
    { re: /^wq_stats_.+$/,  merge: mergeMaxPerEntry },
    { re: /^wq_deck_.+$/,   merge: mergeDeepUnion },
    { re: /^wq_editor_QB\w*$/, merge: null },
    { re: /^wq_(?!deck_|stats_|editor|srs_)\S+$/, merge: mergeHistory },
  ];
  // Bewusst NICHT synchronisiert: gram_lastProfile, gram_it_on (gerätelokal).

  function ruleFor(key) {
    if (!key || /_ver$/.test(key)) return null;   // Schema-Versionsstempel bleiben gerätelokal
    return RULES.find(r => r.re.test(key)) || null;
  }

  /* ── Misch-Strategien ─────────────────────────────────────────── */
  function parse(raw) { try { return JSON.parse(raw); } catch { return null; } }

  // SRS: pro Wort gewinnt der Eintrag mit mehr Übungsgeschichte
  function mergeSrs(a, b) {
    const out = Object.assign({}, a || {});
    for (const [w, e] of Object.entries(b || {})) {
      const l = out[w];
      if (!l) { out[w] = e; continue; }
      out[w] =
        e.s !== l.s ? (e.s > l.s ? e : l) :
        e.b !== l.b ? (e.b > l.b ? e : l) :
        ((e.due || '') > (l.due || '') ? e : l);
    }
    return out;
  }

  // { schlüssel: {zahlenfelder} } → feldweises Maximum (Tage, Kasus, Fragen-Stats)
  function mergeMaxPerEntry(a, b) {
    const out = Object.assign({}, a || {});
    for (const [k, v] of Object.entries(b || {})) {
      if (!out[k] || typeof v !== 'object' || v === null) { out[k] = out[k] ?? v; continue; }
      const m = Object.assign({}, out[k]);
      for (const [f, val] of Object.entries(v)) {
        m[f] = (typeof val === 'number' && typeof m[f] === 'number') ? Math.max(m[f], val) : (m[f] ?? val);
      }
      out[k] = m;
    }
    return out;
  }

  // Decks (gesehene Fragen): Arrays vereinigen, Objekte rekursiv mischen
  function mergeDeepUnion(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) {
      const seen = new Set(a.map(x => JSON.stringify(x)));
      return a.concat(b.filter(x => !seen.has(JSON.stringify(x))));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      const out = Object.assign({}, a);
      for (const [k, v] of Object.entries(b)) out[k] = (k in out) ? mergeDeepUnion(out[k], v) : v;
      return out;
    }
    return a ?? b;
  }

  // Rundenverlauf: Vereinigung ohne Duplikate, chronologisch, letzte 10
  function histSortKey(h) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(h.date || '');
    return m ? `${m[3]}-${m[2]}-${m[1]} ${h.time || ''}` : `0000 ${h.date || ''}`;
  }
  function histId(h) { return [h.date, h.time, h.module, h.mode, h.pct].join('|'); }
  function mergeHistory(a, b) {
    const la = Array.isArray(a) ? a : [], lb = Array.isArray(b) ? b : [];
    const seen = new Set(la.map(histId));
    const merged = la.concat(lb.filter(h => !seen.has(histId(h))));
    merged.sort((x, y) => histSortKey(x).localeCompare(histSortKey(y)));
    return merged.slice(-10);
  }

  /* ── Firestore REST ───────────────────────────────────────────── */
  const enabled = () => !CONFIG.projectId.startsWith('PASTE') && !!familyId();

  function familyId() {
    try {
      const fromUrl = new URLSearchParams(location.search).get('familie');
      if (fromUrl) localStorage.setItem(FAMILY_KEY, fromUrl);
      return localStorage.getItem(FAMILY_KEY);
    } catch { return null; }
  }

  function baseUrl() {
    return `https://firestore.googleapis.com/v1/projects/${CONFIG.projectId}` +
           `/databases/(default)/documents/families/${encodeURIComponent(familyId())}/stores`;
  }

  async function listDocs() {
    const res = await fetch(`${baseUrl()}?pageSize=300&key=${CONFIG.apiKey}`);
    if (!res.ok) throw new Error(`list ${res.status}`);
    const data = await res.json();
    return (data.documents || []).map(d => ({
      key:  decodeURIComponent(d.name.split('/').pop()),
      json: d.fields?.json?.stringValue ?? null,
      ts:   Number(d.fields?.ts?.integerValue || 0),
    }));
  }

  async function getDoc(key) {
    const res = await fetch(`${baseUrl()}/${encodeURIComponent(key)}?key=${CONFIG.apiKey}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`get ${res.status}`);
    const d = await res.json();
    return {
      json: d.fields?.json?.stringValue ?? null,
      ts:   Number(d.fields?.ts?.integerValue || 0),
    };
  }

  async function patchDoc(key, raw) {
    const ts = Date.now();
    const body = JSON.stringify({ fields: {
      json: { stringValue: raw },
      ts:   { integerValue: String(ts) },
    }});
    const res = await fetch(`${baseUrl()}/${encodeURIComponent(key)}?key=${CONFIG.apiKey}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body,
    });
    if (!res.ok) throw new Error(`patch ${res.status}`);
    metaSet(key, ts);
  }

  /* ── Meta (zuletzt gesehener Zeitstempel je Schlüssel) ───────── */
  function metaAll() { return parse(localStorage.getItem(META_KEY)) || {}; }
  function metaSet(key, ts) {
    const m = metaAll(); m[key] = ts;
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {}
  }

  /* ── Status für die UI ────────────────────────────────────────── */
  let status = 'aus';   // aus | sync | ok | offline
  function setStatus(s) {
    status = s;
    try { window.dispatchEvent(new CustomEvent('familysync-status', { detail: { status: s } })); } catch {}
  }

  /* ── Pull: alles ziehen, mischen, App benachrichtigen ─────────── */
  let lastPull = 0;
  async function pullAll() {
    if (!enabled()) return;
    setStatus('sync');
    const changed = [];
    try {
      const docs = await listDocs();
      const remoteKeys = new Set();
      for (const d of docs) {
        remoteKeys.add(d.key);
        const rule = ruleFor(d.key);
        if (!rule || d.json === null) continue;
        const localRaw = localStorage.getItem(d.key);
        let finalRaw;
        if (localRaw === null) finalRaw = d.json;
        else if (rule.merge)   finalRaw = JSON.stringify(rule.merge(parse(localRaw), parse(d.json)));
        else                   finalRaw = d.ts > (metaAll()[d.key] || 0) ? d.json : localRaw;
        if (finalRaw !== localRaw) { localStorage.setItem(d.key, finalRaw); changed.push(d.key); }
        // Wenn das Mischen lokal Neues ergab, muss es auch nach oben
        if (rule.merge && finalRaw !== d.json) dirty.add(d.key);
        metaSet(d.key, d.ts);
      }
      // Erststart: lokale Schlüssel, die es entfernt noch nicht gibt, hochschieben
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (ruleFor(k) && !remoteKeys.has(k)) dirty.add(k);
      }
      lastPull = Date.now();
      setStatus('ok');
      if (dirty.size) schedulePush();
      if (changed.length) {
        try { window.dispatchEvent(new CustomEvent('familysync-pulled', { detail: { keys: changed } })); } catch {}
      }
    } catch (err) {
      console.warn('[FamilySync] pull fehlgeschlagen:', err.message);
      setStatus('offline');
    }
  }

  /* ── Push: geänderte Schlüssel entprellt hochschieben ─────────── */
  const dirty = new Set();
  let pushTimer = null;

  function markDirty(key) {
    if (!enabled() || !ruleFor(key)) return;
    dirty.add(key);
    schedulePush();
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushDirty, PUSH_DEBOUNCE_MS);
  }

  async function pushDirty() {
    if (!enabled() || !dirty.size) return;
    setStatus('sync');
    const keys = [...dirty]; dirty.clear();
    try {
      for (const key of keys) {
        const localRaw = localStorage.getItem(key);
        if (localRaw === null) continue;
        const rule = ruleFor(key);
        let finalRaw = localRaw;
        // Vor dem Schreiben kurz mischen, damit parallele Geräte nichts überschreiben
        const remote = await getDoc(key);
        if (remote && remote.json !== null && rule.merge) {
          finalRaw = JSON.stringify(rule.merge(parse(localRaw), parse(remote.json)));
          if (finalRaw !== localRaw) localStorage.setItem(key, finalRaw);
        }
        await patchDoc(key, finalRaw);
      }
      setStatus('ok');
    } catch (err) {
      console.warn('[FamilySync] push fehlgeschlagen:', err.message);
      keys.forEach(k => dirty.add(k));   // beim nächsten Anlass erneut versuchen
      setStatus('offline');
    }
  }

  /* ── Backup-Fallschirm: Export/Import als Datei ───────────────── */
  function exportAll() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (ruleFor(k)) out[k] = localStorage.getItem(k);
    }
    const blob = new Blob([JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), data: out }, null, 2)],
                          { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lernplattform-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importAll(fileText) {
    const payload = parse(fileText);
    if (!payload || !payload.data) throw new Error('Keine gültige Backup-Datei.');
    let n = 0;
    for (const [k, raw] of Object.entries(payload.data)) {
      const rule = ruleFor(k);
      if (!rule) continue;
      const localRaw = localStorage.getItem(k);
      const finalRaw = (localRaw && rule.merge)
        ? JSON.stringify(rule.merge(parse(localRaw), parse(raw)))
        : raw;
      localStorage.setItem(k, finalRaw);
      dirty.add(k); n++;
    }
    if (n) { schedulePush(); try { window.dispatchEvent(new CustomEvent('familysync-pulled', { detail: { keys: Object.keys(payload.data) } })); } catch {} }
    return n;
  }

  /* ── Start ────────────────────────────────────────────────────── */
  function init() {
    if (!enabled()) { setStatus('aus'); return; }
    pullAll();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPull > PULL_MIN_INTERVAL_MS) pullAll();
      if (document.visibilityState === 'hidden' && dirty.size) pushDirty();
    });
    window.addEventListener('pagehide', () => { if (dirty.size) pushDirty(); });
  }

  window.FamilySync = {
    init, markDirty, pullAll, exportAll, importAll,
    get status() { return status; },
    get familyId() { return familyId(); },
    get enabled() { return enabled(); },
  };
})();

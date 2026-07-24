/* ═══════════════════════════════════════════════════════════════════
   FamilySync — schlanke Cloud-Synchronisation für die Lernplattform.

   Prinzip: LOKAL ZUERST. Die App liest und schreibt immer localStorage
   und funktioniert komplett offline. FamilySync gleicht im Hintergrund
   mit Firestore ab (REST, kein SDK): beim Laden wird gezogen, nach
   Änderungen (entprellt) geschoben. Konflikte werden pro Schlüsseltyp
   gemischt — „mehr Fortschritt gewinnt".

   Löschungen: die App löscht über FamilySync.remove(key). Das entfernt
   lokal UND hinterlässt einen Grabstein (Tombstone), der als eigenes
   Dokument ({deleted:true, ts}) hochgeschoben wird. So wird eine
   Löschung auf alle Geräte übertragen, statt dass der nächste Pull die
   Daten wiederbelebt. Neuere Daten (ts über dem Grabstein) gewinnen
   wieder — absichtliches Neu-Anlegen bleibt also möglich.

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
  const TOMB_KEY   = 'family_sync_tombstones'; // { <storageKey>: Löschzeitpunkt (ms) }
  const PUSH_DEBOUNCE_MS = 5000;
  const PULL_MIN_INTERVAL_MS = 60000;

  /* ── Was wird synchronisiert und wie werden Konflikte gemischt? ──
     merge: (lokal, entfernt) → gemischt.  merge === null → Last-Write-Wins. */
  const RULES = [
    { re: /^gram_srs_.+$/,    merge: mergeSrs },
    { re: /^gram_days_.+$/,   merge: mergeMaxPerEntry },
    { re: /^gram_case_.+$/,   merge: mergeMaxPerEntry },
    { re: /^gram_badges_.+$/, merge: mergeDeepUnion },
    { re: /^gram_path_.+$/,   merge: mergeMaxPerEntry },   // Lernpfad: mehr Fortschritt gewinnt
    { re: /^wr_stats_.+$/,    merge: mergeDeepUnion },     // Wort-Regen: Sitzungs-Metriken (id-keyed, Vereinigung)
    { re: /^wr_high_.+$/,     merge: mergeMax },           // Wort-Regen: Rekord — der höchste gewinnt
    { re: /^wq_srs_.+$/,    merge: mergeSrs },
    { re: /^wq_stats_.+$/,  merge: mergeMaxPerEntry },
    { re: /^wq_deck_.+$/,   merge: mergeDeepUnion },
    { re: /^wq_editor_QB\w*$/, merge: mergeEditorBank },
    { re: /^wq_(?!deck_|stats_|editor|srs_)\S+$/, merge: mergeHistory },
  ];
  // Bewusst NICHT synchronisiert: gram_lastProfile, gram_it_on (gerätelokal).

  function ruleFor(key) {
    if (!key || /_ver$/.test(key)) return null;   // Schema-Versionsstempel bleiben gerätelokal
    return RULES.find(r => r.re.test(key)) || null;
  }

  /* ── Misch-Strategien ─────────────────────────────────────────── */
  function parse(raw) { try { return JSON.parse(raw); } catch { return null; } }

  // Skalarer Höchstwert (z.B. Spiel-Rekorde)
  function mergeMax(a, b) { return Math.max(Number(a) || 0, Number(b) || 0); }

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

  // Editor-Fragenbank { thema: [fragen], __meta:{topics:{ thema:{ts} }} }:
  // Themen einzeln mischen — pro Thema gewinnt der jüngere Speicherstand
  // (Zeitstempel aus __meta, gestempelt von editorSaveTopicToStorage).
  // So überschreiben zwei Geräte, die VERSCHIEDENE Themen bearbeiten,
  // einander nicht mehr, und ein frisch bearbeitetes Thema kann nicht von
  // einer älteren Cloud-Kopie verdrängt werden. Altbestände ohne __meta:
  // das Thema mit mehr Fragen gewinnt, bei Gleichstand das lokale (a).
  function mergeEditorBank(a, b) {
    a = (a && typeof a === 'object') ? a : {};
    b = (b && typeof b === 'object') ? b : {};
    const metaA = a.__meta?.topics || {};
    const metaB = b.__meta?.topics || {};
    const out = {}, outMeta = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (k === '__meta') continue;
      const va = a[k], vb = b[k];
      const ta = Number(metaA[k]?.ts || 0), tb = Number(metaB[k]?.ts || 0);
      let takeA;
      if (va === undefined)      takeA = false;
      else if (vb === undefined) takeA = true;
      else if (ta !== tb)        takeA = ta > tb;
      else {
        const la = Array.isArray(va) ? va.length : -1;
        const lb = Array.isArray(vb) ? vb.length : -1;
        takeA = la >= lb;
      }
      out[k] = takeA ? va : vb;
      const m = takeA ? metaA[k] : metaB[k];
      if (m) outMeta[k] = m;
    }
    if (Object.keys(outMeta).length) out.__meta = { topics: outMeta };
    return out;
  }

  /* ── Firestore REST ───────────────────────────────────────────── */
  const enabled = () => !CONFIG.projectId.startsWith('PASTE') && !!familyId();

  function familyId() {
    try {
      const params = new URLSearchParams(location.search);
      const fromUrl = params.get('familie');
      if (fromUrl) {
        localStorage.setItem(FAMILY_KEY, fromUrl);
        // Geheimcode sofort aus der Adresszeile entfernen — sonst bleibt er
        // in Browser-Verlauf, Lesezeichen und Screenshots sichtbar
        params.delete('familie');
        const clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + location.hash;
        history.replaceState(null, '', clean);
      }
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
      key:     decodeURIComponent(d.name.split('/').pop()),
      json:    d.fields?.json?.stringValue ?? null,
      ts:      Number(d.fields?.ts?.integerValue || 0),
      deleted: d.fields?.deleted?.booleanValue === true,
    }));
  }

  async function getDoc(key) {
    const res = await fetch(`${baseUrl()}/${encodeURIComponent(key)}?key=${CONFIG.apiKey}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`get ${res.status}`);
    const d = await res.json();
    return {
      json:    d.fields?.json?.stringValue ?? null,
      ts:      Number(d.fields?.ts?.integerValue || 0),
      deleted: d.fields?.deleted?.booleanValue === true,
    };
  }

  // PATCH ohne updateMask ersetzt das ganze Dokument — ein Daten-Patch
  // räumt also ein evtl. vorhandenes deleted-Feld weg und umgekehrt.
  // keepalive: beim Wegblättern (pagehide) überlebt der Request das
  // Entladen der Seite — nur bis ~64 KB Body, größere gehen normal raus.
  async function patchFields(key, fields, ts, keepalive) {
    const body = JSON.stringify({ fields });
    const init = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body };
    if (keepalive && body.length < 60000) init.keepalive = true;
    const res = await fetch(`${baseUrl()}/${encodeURIComponent(key)}?key=${CONFIG.apiKey}`, init);
    if (!res.ok) throw new Error(`patch ${res.status}`);
    metaSet(key, ts);
  }

  function patchDoc(key, raw, keepalive) {
    const ts = Date.now();
    return patchFields(key, {
      json: { stringValue: raw },
      ts:   { integerValue: String(ts) },
    }, ts, keepalive);
  }

  function patchTombstone(key, ts, keepalive) {
    return patchFields(key, {
      deleted: { booleanValue: true },
      ts:      { integerValue: String(ts) },
    }, ts, keepalive);
  }

  /* ── Meta (zuletzt gesehener Zeitstempel je Schlüssel) ───────── */
  function metaAll() { return parse(localStorage.getItem(META_KEY)) || {}; }
  function metaSet(key, ts) {
    const m = metaAll(); m[key] = ts;
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {}
  }

  /* ── Grabsteine (lokal ausgeführte Löschungen, noch gültig) ───── */
  function tombAll() { return parse(localStorage.getItem(TOMB_KEY)) || {}; }
  function tombSet(key, ts) {
    const t = tombAll(); t[key] = ts;
    try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch {}
  }
  function tombClear(key) {
    const t = tombAll();
    if (!(key in t)) return;
    delete t[key];
    try { localStorage.setItem(TOMB_KEY, JSON.stringify(t)); } catch {}
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
        if (!rule) continue;
        const localRaw = localStorage.getItem(d.key);
        const seenTs   = metaAll()[d.key] || 0;

        // Entfernter Grabstein: Löschung von einem anderen Gerät übernehmen —
        // außer der Schlüssel hat lokale, noch nicht hochgeschobene Änderungen
        // (dirty), dann gewinnen die und der nächste Push belebt ihn wieder.
        if (d.deleted) {
          if (d.ts > seenTs) {
            if (localRaw !== null && !dirty.has(d.key)) {
              localStorage.removeItem(d.key);
              tombSet(d.key, d.ts);
              changed.push(d.key);
            }
            metaSet(d.key, d.ts);
          }
          continue;
        }
        if (d.json === null) continue;

        let finalRaw;
        if (localRaw === null) {
          // Lokal gelöscht? Nur wiederbeleben, wenn die Cloud-Daten JÜNGER
          // als unser Grabstein sind — sonst Grabstein hochschieben.
          const tombTs = tombAll()[d.key] || 0;
          if (tombTs >= d.ts) { dirty.add(d.key); continue; }
          if (tombTs) tombClear(d.key);
          finalRaw = d.json;
        }
        else if (rule.merge) finalRaw = JSON.stringify(rule.merge(parse(localRaw), parse(d.json)));
        // LWW: lokale Daten nie verdrängen, solange sie ungesichert (dirty) sind
        else finalRaw = (dirty.has(d.key) || d.ts <= seenTs) ? localRaw : d.json;
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
    if (!ruleFor(key)) return;
    // Schlüssel wurde (wieder) beschrieben → ein evtl. alter Grabstein ist hinfällig
    if (localStorage.getItem(key) !== null) tombClear(key);
    if (!enabled()) return;
    dirty.add(key);
    schedulePush();
  }

  // Sync-bewusstes Löschen: lokal entfernen + Grabstein setzen, damit die
  // Löschung auf die anderen Geräte übertragen wird. Die App ruft das statt
  // localStorage.removeItem() für synchronisierte Schlüssel auf.
  function remove(key) {
    try { localStorage.removeItem(key); } catch {}
    if (!ruleFor(key)) return;
    tombSet(key, Date.now());
    if (!enabled()) return;
    dirty.add(key);
    schedulePush();
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushDirty, PUSH_DEBOUNCE_MS);
  }

  // flush=true: Seite wird gleich entladen (pagehide) — keine Vorab-GETs,
  // nur noch schnelle keepalive-Schreiber. Ein dabei übersprungenes Mischen
  // holt das andere Gerät bei seinem nächsten Pull nach (Mischen ist
  // symmetrisch, seine lokalen Daten hat es ja noch).
  async function pushDirty(flush) {
    if (!enabled() || !dirty.size) return;
    setStatus('sync');
    const keys = [...dirty]; dirty.clear();
    try {
      for (const key of keys) {
        const localRaw = localStorage.getItem(key);
        const rule = ruleFor(key);
        if (localRaw === null) {
          // Gelöschter Schlüssel → Grabstein hochschieben. Vorher nachsehen,
          // ob ein anderes Gerät NACH unserer Löschung neue Daten geschrieben
          // hat — dann gewinnen die Daten und wir beleben lokal wieder.
          const tombTs = tombAll()[key];
          if (!tombTs) continue;
          if (!flush) {
            const remote = await getDoc(key);
            if (remote && !remote.deleted && remote.json !== null && remote.ts > tombTs) {
              localStorage.setItem(key, remote.json);
              tombClear(key);
              metaSet(key, remote.ts);
              try { window.dispatchEvent(new CustomEvent('familysync-pulled', { detail: { keys: [key] } })); } catch {}
              continue;
            }
          }
          await patchTombstone(key, tombTs, flush);
          continue;
        }
        let finalRaw = localRaw;
        // Vor dem Schreiben kurz mischen, damit parallele Geräte nichts überschreiben
        if (!flush && rule.merge) {
          const remote = await getDoc(key);
          if (remote && remote.json !== null) {
            finalRaw = JSON.stringify(rule.merge(parse(localRaw), parse(remote.json)));
            if (finalRaw !== localRaw) localStorage.setItem(key, finalRaw);
          }
        }
        await patchDoc(key, finalRaw, flush);
        tombClear(key);   // Daten sind wieder da → Grabstein-Rest aufräumen
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
    // Schutz vor Verdrängung beim ersten Pull:
    //  – nie synchronisierte lokale Schlüssel (kein Meta-Eintrag) gelten als
    //    dirty, damit frisch erfasste Daten weder von einer alten Cloud-Kopie
    //    (LWW) noch von einem alten Grabstein verdrängt werden
    //  – LWW-Schlüssel mit lokalen Daten ebenso
    //  – offene Grabsteine (Löschung kurz vor einem Neuladen) wieder anmelden
    const meta = metaAll();
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const r = ruleFor(k);
      if (r && (!(k in meta) || !r.merge)) dirty.add(k);
    }
    for (const [k, ts] of Object.entries(tombAll())) {
      if (ruleFor(k) && ts > (meta[k] || 0)) dirty.add(k);
    }
    pullAll();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastPull > PULL_MIN_INTERVAL_MS) pullAll();
      if (document.visibilityState === 'hidden' && dirty.size) pushDirty(true);
    });
    window.addEventListener('pagehide', () => { if (dirty.size) pushDirty(true); });
  }

  window.FamilySync = {
    init, markDirty, remove, pullAll, exportAll, importAll,
    get status() { return status; },
    get familyId() { return familyId(); },
    get enabled() { return enabled(); },
  };
})();

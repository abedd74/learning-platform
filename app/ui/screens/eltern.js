// Eltern mode: the parents' view. Dense, tabular, the same tokens.
// Tabs: Überblick · Wörter · Sicherung · Fehler · Einstellungen
import { el, mount, clear, append } from '../dom.js';
import { horizon } from '../horizon.js';
import { keys as K } from '../../core/storage.js';
import { listProfiles } from '../../core/profiles.js';
import { summarize, config as srsConfig } from '../../core/srs.js';
import { streak } from '../../core/planner.js';
import { today as todayOf, addDays } from '../../core/time.js';
import { footerText } from '../../core/version.js';
import { practisedDays } from './home.js';
import { nounStatus } from '../../engines/ella/rules.js';

const STATUS = { hilfe: '🔴 Braucht Hilfe', arbeit: '🌱 In Arbeit', fast: '🌤 Fast sicher', sicher: '✅ Sicher', neu: '⬜ Noch neu' };
const TABS = [['overview', 'Überblick'], ['words', 'Wörter'], ['backup', 'Sicherung'], ['errors', 'Fehler'], ['settings', 'Einstellungen']];

export async function renderEltern(root, ctx, tab = 'overview') {
  const { store, i18n, sync, errors } = ctx;
  const profiles = listProfiles(store);
  let child = ctx.elternChild && profiles.some(p => p.key === ctx.elternChild) ? ctx.elternChild : profiles[0]?.key || null;

  const col = el('div', { class: 'col wide enter' });
  col.appendChild(el('div', { class: 'topbar' }, el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zurück', onClick: () => ctx.go(ctx.profile ? 'home' : 'welcome') }, '←'),
    el('h1', {}, 'Eltern'), el('span', { class: 'chip', style: { marginLeft: 'auto' } }, footerText(ctx.version, sync.status))));
  const tabs = el('div', { class: 'tabs' }, ...TABS.map(([id, label]) => el('button', { type: 'button', class: id === tab ? 'on' : '', onClick: () => renderEltern(root, ctx, id) }, label)));
  col.appendChild(tabs);
  const body = el('div', { class: 'stack' });
  col.appendChild(body);
  mount(root, el('div', { class: 'stage' }, horizon(), col));

  const childPicker = () => el('div', { class: 'tabs' }, ...profiles.map(p => el('button', { type: 'button', class: p.key === child ? 'on' : '', onClick: () => { ctx.elternChild = p.key; renderEltern(root, ctx, tab); } }, `${p.avatar} ${p.name}`)));

  if (tab === 'overview') {
    if (!child) { body.appendChild(el('div', { class: 'notice' }, 'Noch kein Profil.')); return; }
    body.appendChild(childPicker());
    const today = todayOf();
    const days = store.get(K.planDays(child), {}) || {};
    const practised = practisedDays(store, child);
    const week = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
    const sum = (f) => week.reduce((a, d) => a + (days[d]?.[f] || 0), 0);
    const todayRec = days[today] || {};
    body.appendChild(el('div', { class: 'facts' },
      fact(todayRec.a || 0, 'Antworten heute'), fact(sum('a'), 'Antworten, 7 Tage'), fact(streak(practised, today), 'Tage in Folge'),
      fact(Math.round(sum('ms') / 60000), 'Minuten, 7 Tage'), fact(sum('n'), 'neue Karten, 7 Tage'), fact(todayRec.c && todayRec.a ? `${Math.round(100 * todayRec.c / todayRec.a)} %` : '–', 'richtig beim 1. Versuch, heute')));
    const table = el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ...['Modul', 'Karten', 'gemeistert', 'fällig', 'Kletten'].map(h => el('th', {}, h)))));
    const tb = el('tbody', {});
    for (const m of ctx.modules) {
      const srsKey = m.engine === 'ella' ? K.gramSrs(child) : K.quizSrs(child);
      const all = store.get(srsKey, {}) || {};
      let recs = all;
      if (m.engine === 'quiz') { const qs = await ctx.content.questions(m); recs = Object.fromEntries(qs.map(q => [q.id, all[q.id]]).filter(([, r]) => r)); }
      const s = summarize(recs, today, srsConfig(m.srs || {}));
      tb.appendChild(el('tr', {}, el('td', {}, `${m.icon} ${m.name.de}${m.archive ? ' (Archiv)' : ''}`), td(m.count), td(s.mastered), td(s.due), td(s.leeches)));
    }
    table.appendChild(tb);
    body.appendChild(el('section', { class: 'card' }, table));
    // weakest quiz topics by stats
    const stats = store.get(K.quizStats(child), {}) || {};
    const byTopic = {};
    for (const m of ctx.modules.filter(x => x.engine === 'quiz')) {
      const qs = await ctx.content.questions(m);
      for (const q of qs) { const st = stats[q.id]; if (!st || !st.shown) continue; const k = `${m.name.de} · ${m.topics.find(t => t.id === q.topic)?.label?.de || q.topic}`; const e = byTopic[k] || (byTopic[k] = { shown: 0, correct: 0 }); e.shown += st.shown; e.correct += st.correct; }
    }
    const weak = Object.entries(byTopic).map(([k, v]) => ({ k, pct: v.correct / v.shown, n: v.shown })).filter(x => x.n >= 3).sort((a, b) => a.pct - b.pct).slice(0, 6);
    if (weak.length) body.appendChild(el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, 'Schwächste Themen'),
      ...weak.map(w => el('div', { class: 'row spread' }, el('span', {}, w.k), el('span', { class: 'chip' }, `${Math.round(w.pct * 100)} % · ${w.n}×`)))));
    // round history (old key)
    const hist = store.get(K.quizHistory(child), []);
    if (Array.isArray(hist) && hist.length) {
      const ht = el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ...['Datum', 'Zeit', 'Modul', 'Runde', 'Ergebnis'].map(h => el('th', {}, h)))));
      ht.appendChild(el('tbody', {}, ...hist.slice().reverse().map(h => el('tr', {}, td(h.date), td(h.time), td(ctx.moduleName(h.module)), td(h.mode), td(`${Math.round((h.pct || 0) * 100)} %`)))));
      body.appendChild(el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, 'Letzte Runden'), ht));
    }
  }

  if (tab === 'words') {
    const ella = ctx.ella;
    if (!child || !ella) { body.appendChild(el('div', { class: 'notice' }, 'Keine Wörter.')); return; }
    body.appendChild(childPicker());
    const srs = store.get(K.gramSrs(child), {}) || {};
    const cases = store.get(K.gramCase(child), {}) || {};
    const nouns = [...ella.byDe.values()];
    const counts = {};
    for (const n of nouns) { const s = nounStatus(srs[n.de]); counts[s] = (counts[s] || 0) + 1; }
    body.appendChild(el('div', { class: 'facts' }, ...Object.entries(STATUS).map(([k, l]) => fact(counts[k] || 0, l))));
    if (Object.keys(cases).length) body.appendChild(el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, 'Kasus-Übungen'),
      ...Object.entries(cases).map(([k, s]) => el('div', { class: 'row spread' }, el('span', {}, k === 'akk' ? 'Akkusativ' : k === 'dat' ? 'Dativ' : k), el('span', { class: 'chip' }, `${s.c}/${s.a} richtig · Genus-Fehler ${s.gErr} · Kasus-Fehler ${s.cErr} · beides ${s.bothErr}`)))));
    const filterStatus = ctx.elternStatus || 'hilfe';
    body.appendChild(el('div', { class: 'tabs' }, ...Object.entries(STATUS).map(([k, l]) => el('button', { type: 'button', class: k === filterStatus ? 'on' : '', onClick: () => { ctx.elternStatus = k; renderEltern(root, ctx, 'words'); } }, l))));
    const rows = nouns.filter(n => nounStatus(srs[n.de]) === filterStatus).sort((a, b) => (srs[b.de]?.w || 0) - (srs[a.de]?.w || 0));
    const t = el('table', { class: 'table' }, el('thead', {}, el('tr', {}, ...['Wort', 'Kasten', 'gesehen', 'richtig', 'falsch', 'fällig'].map(h => el('th', {}, h)))));
    t.appendChild(el('tbody', {}, ...rows.slice(0, 80).map(n => { const e = srs[n.de] || {}; return el('tr', {}, td(`${n.em} ${n.g} ${n.de}`), td(e.b ?? '–'), td(e.s ?? 0), td(e.r ?? 0), td(e.w ?? 0), td(e.due ?? '–')); })));
    body.appendChild(el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, `${rows.length} Wörter`), t));
  }

  if (tab === 'backup') {
    const info = el('section', { class: 'card stack' });
    info.appendChild(el('span', { class: 'eyebrow' }, 'Familien-Sync'));
    info.appendChild(el('div', {}, ctx.namespace ? 'Vorschau-Modus: Der Sync ist aus. Dieses Gerät arbeitet mit einer Kopie der Daten.' : sync.hasFamily ? `Dieses Gerät ist mit der Familie verbunden. Status: ${sync.status}.` : 'Dieses Gerät ist noch nicht mit der Familie verbunden. Öffne einmal den Familien-Link.'));
    if (ctx.namespace) info.appendChild(el('button', { class: 'btn small', type: 'button', onClick: () => { const n = store.copyFromLive(); info.appendChild(el('div', { class: 'notice' }, `${n} Einträge von diesem Gerät kopiert. Bitte neu laden.`)); } }, 'Daten von diesem Gerät kopieren'));
    body.appendChild(info);

    const exp = el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, 'Backup-Datei'));
    exp.appendChild(el('div', { class: 'row' },
      el('button', { class: 'btn small', type: 'button', onClick: () => { const p = sync.exportAll(); const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lernplattform-backup-${todayOf()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); } }, '💾 Backup speichern'),
      (() => { const inp = el('input', { type: 'file', accept: 'application/json,.json', hidden: true }); inp.addEventListener('change', () => { const f = inp.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const n = sync.importAll(String(r.result)); exp.appendChild(el('div', { class: 'notice' }, `${n} Einträge importiert und zusammengeführt.`)); } catch (e) { exp.appendChild(el('div', { class: 'notice' }, e.message)); } }; r.readAsText(f); }); return el('span', {}, inp, el('button', { class: 'btn small', type: 'button', onClick: () => inp.click() }, '📥 Backup einlesen')); })()));
    body.appendChild(exp);

    const snaps = el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, 'Tägliche Sicherungen in der Cloud'));
    body.appendChild(snaps);
    if (!sync.enabled) snaps.appendChild(el('div', { class: 'soft' }, 'Nur mit verbundener Familie.'));
    else {
      snaps.appendChild(el('div', { class: 'soft' }, 'Lade …'));
      try {
        const list = await sync.listSnapshots();
        clear(snaps); snaps.appendChild(el('span', { class: 'eyebrow' }, 'Tägliche Sicherungen in der Cloud'));
        if (!list.length) snaps.appendChild(el('div', { class: 'soft' }, 'Noch keine Sicherung.'));
        for (const s of list.slice().reverse()) {
          const row = el('div', { class: 'row spread' }, el('span', {}, `${s.day} · ${s.n} Einträge`));
          const btn = el('button', { class: 'btn small', type: 'button', onClick: () => {
            if (row.querySelector('.confirm')) return;
            row.appendChild(el('span', { class: 'confirm row' }, el('button', { class: 'btn small danger', type: 'button', onClick: async () => { try { const n = await sync.restoreSnapshot(s.day); snaps.appendChild(el('div', { class: 'notice' }, `${n} Einträge aus ${s.day} wiederhergestellt. Bitte neu laden.`)); } catch (e) { snaps.appendChild(el('div', { class: 'notice' }, e.message)); } } }, 'Ja, wiederherstellen'), el('button', { class: 'btn small ghost', type: 'button', onClick: () => row.querySelector('.confirm').remove() }, 'Abbrechen')));
          } }, 'Wiederherstellen …');
          row.appendChild(btn); snaps.appendChild(row);
        }
      } catch (e) { clear(snaps); snaps.appendChild(el('div', { class: 'notice' }, `Konnte die Sicherungen nicht laden: ${e.message}`)); }
    }
  }

  if (tab === 'errors') {
    const list = errors.list();
    errors.markSeen();
    const card = el('section', { class: 'card stack' }, el('div', { class: 'row spread' }, el('span', { class: 'eyebrow' }, `Fehlerprotokoll (${list.length})`),
      el('span', { class: 'row' },
        el('button', { class: 'btn small', type: 'button', onClick: async () => { const text = list.map(e => `${new Date(e.ts).toISOString()} v${e.v} ${e.page}\n${e.msg}\n${e.stack || ''}`).join('\n\n'); try { await navigator.clipboard.writeText(text); } catch { const ta = el('textarea', { readOnly: true, style: { width: '100%', height: '160px' } }, text); card.appendChild(ta); ta.select(); } } }, 'Kopieren'),
        el('button', { class: 'btn small ghost', type: 'button', onClick: () => { errors.clear(); renderEltern(root, ctx, 'errors'); } }, 'Leeren'))));
    if (!list.length) card.appendChild(el('div', { class: 'soft' }, 'Keine Fehler aufgezeichnet.'));
    else card.appendChild(el('pre', { class: 'log' }, list.slice(0, 50).map(e => `${new Date(e.ts).toLocaleString('de-DE')} · v${e.v} · ${e.page}\n${e.msg}${e.stack ? '\n' + e.stack : ''}`).join('\n\n')));
    body.appendChild(card);
  }

  if (tab === 'settings') {
    const card = el('section', { class: 'card stack' });
    card.appendChild(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: i18n.showItalian, onChange: e => i18n.setShowItalian(e.target.checked) }), i18n.t('settings.italian')));
    card.appendChild(el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: ctx.audio.enabled, onChange: e => ctx.audio.setEnabled(e.target.checked) }), i18n.t('settings.sound')));
    body.appendChild(card);
    const prof = el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, 'Profile'));
    for (const p of profiles) prof.appendChild(el('div', { class: 'row spread' }, el('span', {}, `${p.avatar} ${p.name}${p.grade ? ` · Klasse ${p.grade}` : ''}${p.gentle ? ' · sanft' : ''}`), el('button', { class: 'btn small', type: 'button', onClick: () => ctx.go('welcome', { form: { key: p.key, name: p.name, avatar: p.avatar, grade: p.grade, gentle: p.gentle, found: true } }) }, 'Bearbeiten')));
    body.appendChild(prof);
    body.appendChild(el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, 'Über'), el('div', { class: 'soft' }, `Version ${ctx.version}. Inhalte und Technik: siehe docs/ im Repository.`)));
  }
}

const fact = (v, l) => el('div', { class: 'fact' }, el('span', { class: 'v' }, String(v)), el('span', { class: 'l' }, l));
const td = v => el('td', { class: typeof v === 'number' ? 'num' : '' }, String(v));

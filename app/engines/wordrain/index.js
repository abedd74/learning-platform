// Wort-Regen — the falling-article game, ported from the old page.
// Word tiles stack in three columns; an article (der/die/das) falls; steer
// it onto a matching word to clear it. A mistake costs a heart, breaks the
// tile open (it shows its article) and drops the word one box in the
// trainer's records. Reads the noun pack, writes wr_stats_<P>, wr_high_<P>
// and gram_srs_<P> through the same records as everything else.
import { keys as K } from '../../core/storage.js';
import { review, config as srsConfig } from '../../core/srs.js';
import { today as todayOf } from '../../core/time.js';
import { el, mount, clear } from '../../ui/dom.js';
import { horizon } from '../../ui/horizon.js';

const COLS = 3;
const GENDERS = ['der', 'die', 'das'];
const fmtScore = s => (Number.isInteger(s) ? String(s) : String(s).replace('.', ','));

function conf(mode) {
  return mode === 'sanft'
    ? { tileH: 58, font: 1.05, showEm: true, fall: 42, fallMax: 90, rowMs: 14000, rowMsMin: 8000, softMult: 6 }
    : { tileH: 46, font: 0.95, showEm: false, fall: 70, fallMax: 170, rowMs: 9000, rowMsMin: 4500, softMult: 8 };
}

/** Sound effects from a tiny synthesiser (no files): a soft two-tone for a catch, a thud for a miss. */
function makeSfx(audio) {
  let actx = null;
  return kind => {
    if (!audio.enabled) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const t0 = actx.currentTime;
      if (kind === 'good') {
        for (const [f, at, dur] of [[660, 0, .09], [990, .08, .13]]) {
          const o = actx.createOscillator(), g = actx.createGain();
          o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(actx.destination);
          g.gain.setValueAtTime(.0001, t0 + at); g.gain.exponentialRampToValueAtTime(.12, t0 + at + .015); g.gain.exponentialRampToValueAtTime(.0001, t0 + at + dur);
          o.start(t0 + at); o.stop(t0 + at + dur + .05);
        }
      } else {
        const dur = 0.5;
        const buf = actx.createBuffer(1, Math.floor(actx.sampleRate * dur), actx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
        const src = actx.createBufferSource(); src.buffer = buf;
        const filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.setValueAtTime(1600, t0); filt.frequency.exponentialRampToValueAtTime(120, t0 + dur);
        const g = actx.createGain(); g.gain.setValueAtTime(.45, t0); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
        src.connect(filt); filt.connect(g); g.connect(actx.destination); src.start(t0);
        const o = actx.createOscillator(), og = actx.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(150, t0); o.frequency.exponentialRampToValueAtTime(40, t0 + .35);
        og.gain.setValueAtTime(.4, t0); og.gain.exponentialRampToValueAtTime(.0001, t0 + .4);
        o.connect(og); og.connect(actx.destination); o.start(t0); o.stop(t0 + .45);
      }
    } catch {}
  };
}

export function createWordRain(ctx, nouns) {
  const { store, audio } = ctx;
  const cfg = srsConfig(ctx.ella?.srs || {});
  const sfx = makeSfx(audio);

  /** The child's own fairly safe words (box ≥ 2), weighted; fallbacks for new profiles. */
  function buildPool(profile) {
    const srs = store.get(K.gramSrs(profile), {}) || {};
    const today = todayOf();
    const byName = new Map(nouns.map(n => [n.de, n]));
    const known = Object.keys(srs).filter(de => srs[de].b >= 2 && byName.has(de));
    let pool = [];
    for (const de of known) {
      const e = srs[de];
      const weight = (e.due && e.due <= today) ? 3 : e.b <= 3 ? 2 : 1;
      for (let i = 0; i < weight; i++) pool.push(byName.get(de));
    }
    if (known.length < 12) pool = Object.keys(srs).filter(de => byName.has(de)).map(de => byName.get(de));
    if (new Set(pool.map(w => w.de)).size < 12) pool = nouns.filter(n => ['tiere', 'essen', 'haus'].includes(n.cat)).slice(0, 40);
    return pool;
  }

  function render(root) {
    const profile = ctx.profile;
    let mode = profile.gentle ? 'sanft' : 'normal';
    const high = () => store.get(K.wrHigh(profile.key), 0) || 0;

    function start(root) {
      const col = el('div', { class: 'col enter' });
      col.appendChild(el('div', { class: 'topbar' }, el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Zurück', onClick: () => ctx.go('home') }, '←'),
        el('div', { class: 'greet' }, el('span', { class: 'disc' }, '🌧️'), el('div', {}, el('h1', {}, 'Wort-Regen'), el('div', { class: 'soft' }, 'Fang die Wörter mit dem richtigen Artikel!')))));
      const modes = el('div', { class: 'answers answers-2' });
      const paint = () => modes.querySelectorAll('button').forEach(b => b.classList.toggle('chosen', b.dataset.mode === mode));
      modes.append(
        el('button', { class: 'answer', type: 'button', dataset: { mode: 'normal' }, onClick: () => { mode = 'normal'; paint(); } }, '🚀 Normal', el('span', { class: 'it' }, 'schneller')),
        el('button', { class: 'answer', type: 'button', dataset: { mode: 'sanft' }, onClick: () => { mode = 'sanft'; paint(); } }, '🌸 Sanft', el('span', { class: 'it' }, 'langsamer + Bilder')));
      paint();
      col.appendChild(el('section', { class: 'card stack' }, modes,
        el('button', { class: 'btn primary', type: 'button', style: { width: '100%' }, onClick: () => play(root) }, 'Spielen! 🌧️'),
        el('div', { class: 'soft', style: { textAlign: 'center', fontWeight: '800' } }, high() ? `🏆 Rekord: ${fmtScore(high())} Punkte` : 'Noch kein Rekord — auf geht\'s!'),
        el('div', { class: 'muted', style: { textAlign: 'center', fontSize: '13px', fontWeight: '700' } }, 'Spalte antippen = dorthin fallen · dieselbe Spalte = schneller · Pfeiltasten gehen auch')));
      mount(root, el('div', { class: 'stage' }, horizon(), col));
    }

    function play(root) {
      const c = conf(mode);
      const wrap = el('div', { class: 'wr-wrap' });
      const hud = el('div', { class: 'wr-hud' });
      const score = el('span', { class: 'chip' }), hearts = el('span', { class: 'chip' });
      hud.append(el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Beenden', onClick: () => end(true) }, '✕'), score, hearts);
      const field = el('div', { class: 'wr-field' });
      const deadline = el('div', { class: 'wr-deadline', style: { top: `${c.tileH * 1.6}px` } });
      field.appendChild(deadline);
      wrap.append(hud, field);
      mount(root, el('div', { class: 'stage wr-stage' }, wrap));

      let G = null, rafId = 0;
      const begin = (retry = 0) => {
        const W = field.clientWidth, H = field.clientHeight;
        if ((W < 200 || H < 300) && retry < 60) { requestAnimationFrame(() => begin(retry + 1)); return; }
        G = { c, W, H, colW: W / COLS, cols: [[], [], []], pool: buildPool(profile.key), bag: [], score: 0, hearts: 3, faller: null, speed: c.fall, rowMs: c.rowMs,
          nextRow: performance.now() + 2500, last: performance.now(), over: false, learned: {},
          stats: { ts: Date.now(), mode, pool: 0, catches: 0, repairs: 0, mistakes: 0, wrongByArt: { der: 0, die: 0, das: 0 }, wordsWrong: [], rowsMax: 0 } };
        G.stats.pool = new Set(G.pool.map(w => w.de)).size;
        updateHud(); pushRow(); pushRow(); spawnFaller();
        cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick);
      };
      const drawWord = () => {
        if (!G.bag.length) G.bag = [...G.pool].sort(() => Math.random() - 0.5);
        const onField = new Set(G.cols.flat().map(t => t.word.de));
        for (let i = 0; i < G.bag.length; i++) if (!onField.has(G.bag[i].de)) return G.bag.splice(i, 1)[0];
        return G.bag.pop();
      };
      const tileEl = word => {
        const t = el('div', { class: 'wr-tile', style: { width: `${G.colW - 8}px`, height: `${c.tileH - 6}px`, fontSize: `${c.font}rem` } });
        if (c.showEm) t.appendChild(el('span', { class: 'em' }, word.em || ''));
        t.appendChild(document.createTextNode(word.de));
        return t;
      };
      const placeTile = (t, col, row) => { t.el.style.left = `${col * G.colW + 4}px`; t.el.style.bottom = `${row * c.tileH + 4}px`; };
      function pushRow() {
        for (let col = 0; col < COLS; col++) {
          const word = drawWord();
          const t = { word, el: tileEl(word), revealed: false };
          field.appendChild(t.el);
          G.cols[col].unshift(t);
          G.cols[col].forEach((tt, i) => placeTile(tt, col, i));
        }
        G.stats.rowsMax = Math.max(G.stats.rowsMax, ...G.cols.map(x => x.length));
        const maxRows = Math.floor((G.H - c.tileH * 1.6) / c.tileH);
        if (G.cols.some(x => x.length > maxRows)) end(false);
      }
      function spawnFaller() {
        const tops = G.cols.map(x => x[x.length - 1]).filter(Boolean);
        if (!tops.length) { pushRow(); return spawnFaller(); }
        const genders = [...new Set(tops.map(t => t.word.g))];
        const g = genders[Math.floor(Math.random() * genders.length)];
        const f = el('div', { class: `wr-faller g-${g}`, style: { width: `${G.colW - 20}px`, height: `${c.tileH - 10}px`, fontSize: `${c.font * 1.15}rem` } }, g);
        field.appendChild(f);
        G.faller = { g, col: 1, y: -c.tileH, el: f, soft: false };
        moveX();
      }
      const moveX = () => { G.faller.el.style.left = `${G.faller.col * G.colW + 10}px`; };
      function tick(now) {
        if (!G || G.over) return;
        const dt = Math.min(64, now - G.last) / 1000;
        G.last = now;
        if (now >= G.nextRow) { pushRow(); G.nextRow = now + G.rowMs; }
        const f = G.faller;
        if (f) {
          f.y += G.speed * (f.soft ? c.softMult : 1) * dt;
          f.el.style.top = `${f.y}px`;
          const stack = G.cols[f.col];
          const stackTopY = G.H - stack.length * c.tileH - 4;
          if (f.y + (c.tileH - 10) >= stackTopY) land(f);
        }
        rafId = requestAnimationFrame(tick);
      }
      function land(f) {
        const stack = G.cols[f.col];
        const top = stack[stack.length - 1];
        f.el.remove(); G.faller = null;
        if (top && top.word.g === f.g) {
          const gain = top.revealed ? 0.5 : 1;
          G.score += gain;
          if (gain === 1) G.stats.catches++; else G.stats.repairs++;
          sfx('good');
          setTimeout(() => audio.speak({ clip: `a_${audio.slug(top.word.de)}`, text: `${top.word.g} ${top.word.de}` }), 250);
          top.el.classList.add('pop');
          const p = el('div', { class: 'wr-plus', style: { left: `${f.col * G.colW + G.colW / 2 - 10}px`, bottom: `${stack.length * c.tileH}px` } }, gain === 1 ? '+1' : '+½');
          field.appendChild(p); setTimeout(() => p.remove(), 700);
          setTimeout(() => top.el.remove(), 280);
          stack.pop();
          G.speed = Math.min(c.fallMax, G.speed + 2.5);
          G.rowMs = Math.max(c.rowMsMin, G.rowMs - 140);
        } else if (top) {
          G.hearts--; G.stats.mistakes++; G.stats.wrongByArt[top.word.g]++;
          if (G.stats.wordsWrong.length < 15 && !G.stats.wordsWrong.includes(top.word.de)) G.stats.wordsWrong.push(top.word.de);
          sfx('boom');
          field.classList.remove('shake'); void field.offsetWidth; field.classList.add('shake');
          const cx = f.col * G.colW + G.colW / 2, cy = stack.length * c.tileH;
          for (const [em, size, delay] of [['💥', 3.2, 0], ['✨', 2.2, 90]]) setTimeout(() => { const b = el('div', { class: 'wr-boom', style: { fontSize: `${size}rem`, left: `${cx - 26}px`, bottom: `${cy}px` } }, em); field.appendChild(b); setTimeout(() => b.remove(), 650); }, delay);
          if (!top.revealed) {
            // the word drops a box in the trainer's records (same rule as a wrong answer)
            try {
              const key = K.gramSrs(profile.key);
              const all = store.get(key, {}) || {};
              if (all[top.word.de]) { all[top.word.de] = review(all[top.word.de], 'wrong', todayOf(), cfg); store.set(key, all); }
            } catch {}
            top.revealed = true;
            top.el.classList.add('broken', `b-${top.word.g}`);
            clear(top.el);
            top.el.appendChild(el('span', { class: `wr-art g-${top.word.g}` }, top.word.g));
            if (c.showEm) top.el.appendChild(el('span', { class: 'em' }, top.word.em || ''));
            top.el.appendChild(el('span', {}, ...[...top.word.de].map(ch => el('span', { class: 'ltr', style: { transform: `translateY(${(Math.random() * 5 - 2.5).toFixed(1)}px) rotate(${(Math.random() * 14 - 7).toFixed(1)}deg)` } }, ch))));
            G.learned[top.word.de] = top.word.g;
          }
          setTimeout(() => audio.speak({ clip: `a_${audio.slug(top.word.de)}`, text: `${top.word.g} ${top.word.de}` }), 350);
        }
        updateHud();
        if (G.hearts <= 0) { end(false); return; }
        if (!G.over) spawnFaller();
      }
      function updateHud() { score.textContent = `⭐ ${fmtScore(G.score)}`; hearts.textContent = '❤️'.repeat(Math.max(0, G.hearts)) + '🤍'.repeat(3 - Math.max(0, G.hearts)); }
      function recordStats(reason) {
        const s = G.stats;
        if (s.catches + s.repairs + s.mistakes === 0 && Date.now() - s.ts < 5000) return;
        const key = K.wrStats(profile.key);
        const all = store.get(key, {}) || {};
        all[s.ts.toString(36)] = { ...s, dur: Date.now() - s.ts, score: G.score, hearts: G.hearts, end: reason, speedEnd: Math.round(G.speed) };
        const ids = Object.keys(all).sort((a, b) => (all[a].ts || 0) - (all[b].ts || 0));
        while (ids.length > 60) delete all[ids.shift()];
        store.set(key, all);
      }
      function end(quit) {
        if (!G || G.over) { start(root); return; }
        G.over = true; cancelAnimationFrame(rafId); off();
        recordStats(quit ? 'quit' : G.hearts <= 0 ? 'hearts' : 'stack');
        const oldHi = high();
        const isRecord = G.score > oldHi;
        if (isRecord) store.set(K.wrHigh(profile.key), G.score);
        const learned = Object.entries(G.learned);
        const col = el('div', { class: 'col results enter' });
        col.append(
          el('div', { class: 'question .em', style: { fontSize: '64px' } }, isRecord ? '🏆' : G.score >= 10 ? '🌈' : '🌱'),
          el('h1', {}, isRecord ? 'Neuer Rekord!' : quit ? 'Bis bald!' : 'Der Stapel war schneller!'),
          el('div', { class: 'display', style: { fontSize: '32px' } }, G.score === 1 ? '1 Punkt' : `${fmtScore(G.score)} Punkte`),
          el('div', { class: 'soft' }, `🏆 Rekord: ${fmtScore(Math.max(G.score, oldHi))}`),
          el('div', { class: 'card', style: { width: '100%' } }, learned.length ? ['Merk dir: ', ...learned.flatMap(([w, g], i) => [i ? ' · ' : '', el('b', { class: `g-${g}` }, g), ` ${w}`])] : 'Alle Artikel richtig — stark! 💪'),
          el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onClick: () => start(root) }, 'Zurück'), el('button', { class: 'btn primary', type: 'button', onClick: () => play(root) }, 'Nochmal! 🌧️')),
        );
        mount(root, el('div', { class: 'stage' }, horizon(), col));
      }
      // controls
      const onKey = e => {
        if (!G || G.over || !G.faller) return;
        if (e.key === 'ArrowLeft' && G.faller.col > 0) { G.faller.col--; moveX(); }
        if (e.key === 'ArrowRight' && G.faller.col < COLS - 1) { G.faller.col++; moveX(); }
        if (e.key === 'ArrowDown' || e.key === ' ') { G.faller.soft = true; e.preventDefault(); }
      };
      const onKeyUp = e => { if (G && G.faller && (e.key === 'ArrowDown' || e.key === ' ')) G.faller.soft = false; };
      const onDown = e => {
        if (!G || G.over || !G.faller) return;
        const rect = field.getBoundingClientRect();
        const col = Math.max(0, Math.min(COLS - 1, Math.floor((e.clientX - rect.left) / G.colW)));
        if (col === G.faller.col) G.faller.soft = true; else { G.faller.col = col; moveX(); }
      };
      const onUp = () => { if (G && G.faller) G.faller.soft = false; };
      const onVis = () => { if (document.hidden) cancelAnimationFrame(rafId); else if (G && !G.over) { G.last = performance.now(); rafId = requestAnimationFrame(tick); } };
      document.addEventListener('keydown', onKey); document.addEventListener('keyup', onKeyUp);
      field.addEventListener('pointerdown', onDown); field.addEventListener('pointerup', onUp); field.addEventListener('pointercancel', onUp);
      document.addEventListener('visibilitychange', onVis);
      const off = () => { document.removeEventListener('keydown', onKey); document.removeEventListener('keyup', onKeyUp); document.removeEventListener('visibilitychange', onVis); };
      // leaving the screen by navigation ends the game
      const onHash = () => { if (G && !G.over) { G.over = true; cancelAnimationFrame(rafId); off(); recordStats('quit'); } window.removeEventListener('hashchange', onHash); };
      window.addEventListener('hashchange', onHash);
      begin();
    }

    start(root);
  }

  return { render };
}

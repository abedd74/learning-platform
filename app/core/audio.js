// One audio channel for the whole app: a recorded clip when there is one,
// the device's German voice otherwise; a new sound stops the previous one
// (the old trainer's "single audio channel"). iOS Safari only plays audio
// that was started inside a user gesture: unlock() is called on the first
// tap and reuses ONE Audio element from then on.

import { keys as K } from './storage.js';

/** File name of a word's clip, as the old trainer named them: 'Käse' → 'kaese'. */
export function slug(word) {
  return String(word || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

export function clipName(kind, word) {
  // 'w_' the noun alone, 'a_' article + noun
  return `${kind}_${slug(word)}`;
}

export function createAudio({
  store = null,
  AudioCtor = globalThis.Audio,
  speech = globalThis.speechSynthesis,
  Utterance = globalThis.SpeechSynthesisUtterance,
  clipUrl = name => `audio/${name}.mp3`,
  log = console,
} = {}) {
  let el = null;          // the one Audio element (created in unlock or on first play)
  let unlocked = false;
  let current = null;     // token of the sound playing now
  let voice = null;

  const settings = () => (store ? store.get(K.appSettings(), {}) || {} : {});
  function enabled() { const s = settings(); return typeof s.sound === 'boolean' ? s.sound : true; }
  function setEnabled(on) { if (store) store.set(K.appSettings(), { ...settings(), sound: !!on }); if (!on) stop(); }

  function element() {
    if (!el && AudioCtor) { el = new AudioCtor(); el.preload = 'auto'; }
    return el;
  }

  /** Call inside the first user gesture (tap). Harmless to call again. */
  function unlock() {
    if (unlocked) return;
    const a = element();
    if (!a) return;
    try {
      // a silent, tiny wav keeps the element "blessed" for later programmatic plays
      a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
      unlocked = true;
    } catch {}
    try { speech?.getVoices?.(); } catch {}
  }

  function stop() {
    current = null;
    try { if (el) { el.pause(); el.currentTime = 0; } } catch {}
    try { speech?.cancel?.(); } catch {}
  }

  function pickVoice(lang) {
    if (voice && voice.lang?.startsWith(lang.slice(0, 2))) return voice;
    try {
      const voices = speech?.getVoices?.() || [];
      voice = voices.find(v => v.lang === lang && /anna|petra|helena|katja|premium|enhanced/i.test(v.name))
        || voices.find(v => v.lang === lang) || voices.find(v => v.lang?.startsWith(lang.slice(0, 2))) || null;
    } catch { voice = null; }
    return voice;
  }

  function say(text, { lang = 'de-DE', rate = 0.92 } = {}) {
    if (!speech || !Utterance || !text) return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        const u = new Utterance(text);
        u.lang = lang; u.rate = rate;
        const v = pickVoice(lang);
        if (v) u.voice = v;
        u.onend = () => resolve(true);
        u.onerror = () => resolve(false);
        speech.speak(u);
      } catch { resolve(false); }
    });
  }

  function playClip(name) {
    const a = element();
    if (!a) return Promise.resolve(false);
    return new Promise(resolve => {
      const token = {};
      current = token;
      const done = ok => { if (current === token) current = null; cleanup(); resolve(ok); };
      const onEnded = () => done(true);
      const onError = () => done(false);
      const cleanup = () => { a.removeEventListener?.('ended', onEnded); a.removeEventListener?.('error', onError); };
      a.addEventListener?.('ended', onEnded);
      a.addEventListener?.('error', onError);
      try {
        a.src = clipUrl(name);
        const p = a.play();
        if (p && p.then) p.then(() => {}, () => done(false));
      } catch { done(false); }
    });
  }

  /**
   * speak({ clip, text, lang, rate }) — plays the clip; if there is none or it
   * fails, speaks the text. Stops whatever was playing. Resolves to
   * 'clip' | 'speech' | 'off' | 'none'.
   */
  async function speak({ clip = null, text = null, lang = 'de-DE', rate = 0.92 } = {}) {
    if (!enabled()) return 'off';
    stop();
    if (clip) {
      const ok = await playClip(clip);
      if (ok) return 'clip';
      if (text) log.warn?.(`[audio] clip "${clip}" failed, using speech`);
    }
    if (text) return (await say(text, { lang, rate })) ? 'speech' : 'none';
    return 'none';
  }

  return { speak, stop, unlock, say, slug, clipName, get enabled() { return enabled(); }, setEnabled, get unlocked() { return unlocked; } };
}

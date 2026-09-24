/* Nimre — core: state, API, translations, shared UI pieces */
(() => {
  'use strict';

  const CFG = window.NIMRE_CONFIG || {};
  /** True inside the Android app (Capacitor). The same code also runs as the website. */
  const IS_NATIVE = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());
  const LS = {
    lang: 'nimre.lang',
    token: 'nimre.teacherToken',
    links: 'nimre.studentLinks',
    cache: 'nimre.studentCache.'
  };

  const TYPES = ['final', 'midterm', 'quiz', 'homework', 'attendance', 'participation', 'project', 'seminar', 'presentation', 'other'];
  const TYPE_COLORS = {
    final: 'var(--seg-final)', midterm: '#2F6690', quiz: '#1E7A5A', homework: '#7B4F91', attendance: '#A86F0E',
    participation: '#2B7F7B', project: '#B4543A', seminar: '#5463B0', presentation: '#6E7F22', other: '#6B7785'
  };
  const SUBJECT_COLORS = ['#1E7A5A', '#2F6690', '#B4543A', '#7B4F91', '#A86F0E', '#2B7F7B', '#1B2A41'];
  const LEVELS = ['excellent', 'veryGood', 'good', 'fair', 'pass', 'fail'];

  const LANGS = ['ku', 'ar', 'en'];
  const LANG_RTL = { ku: true, ar: true, en: false };
  const LANG_HTML = { ku: 'ckb', ar: 'ar', en: 'en' };
  const LANG_LOCALE = { ku: 'ckb-IQ', ar: 'ar-IQ', en: 'en-GB' };
  const LANG_NAME = { ku: 'کوردی', ar: 'العربية', en: 'English' };
  const LANG_CODE = { ku: 'KU', ar: 'AR', en: 'EN' };

  const storage = {
    get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? fallback : v; } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    remove(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } },
    json(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch (e) { return fallback; } }
  };

  const S = {
    lang: LANGS.indexOf(storage.get(LS.lang, 'ku')) >= 0 ? storage.get(LS.lang, 'ku') : 'ku',
    token: storage.get(LS.token, ''),
    settings: null,
    subjects: null,
    mailQuota: null,
    cur: null,
    tab: 'grades',
    term: 1,
    compare: null,
    activityId: null,
    dirty: new Map(),
    report: { onlyReleased: false, includeActivities: true, includeLevel: false, sort: 'roster', term: 1 },
    installEvent: null,
    online: null,
    seq: 0,
    lastUrl: location.href
  };

  // ───────────── Text helpers ─────────────
  function t(key, vars) {
    const dict = window.I18N[S.lang] || {};
    let s = dict[key] ?? window.I18N.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? vars[k] : m));
    return s;
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const fmt = (n) => (n === '' || n === null || n === undefined ? '' : String(r2(n)));

  /** Kurdish/Arabic keyboards type ٠-٩ and ٫ — convert them so scores always parse. */
  function normDigits(s) {
    return String(s ?? '')
      .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
      .replace(/[\u066B,،]/g, '.')
      .replace(/\s+/g, '');
  }

  /** 1 or 2 — schools often split the year; universities leave it at 1. */
  const termsOf = (subject) => (Number(subject && subject.terms) === 2 ? 2 : 1);
  const termOf = (row) => (Number(row && row.term) === 2 ? 2 : 1);

  function levelOf(pct) {
    if (pct >= 90) return 'excellent';
    if (pct >= 80) return 'veryGood';
    if (pct >= 70) return 'good';
    if (pct >= 60) return 'fair';
    if (pct >= 50) return 'pass';
    return 'fail';
  }

  function dateText(ms, withTime) {
    const opts = withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'long' };
    try {
      return new Intl.DateTimeFormat(LANG_LOCALE[S.lang] || 'en-GB', Object.assign({ numberingSystem: 'latn' }, opts)).format(new Date(ms));
    } catch (e) {
      return new Date(ms).toLocaleString();
    }
  }

  const isRTL = () => !!LANG_RTL[S.lang];
  /** Kurdish and Arabic separate list items with an Arabic comma. */
  const listSep = () => (isRTL() ? '، ' : ', ');
  /** Sorting names the way each language expects. */
  const collator = () => new Intl.Collator(LANG_HTML[S.lang] || 'en');

  function applyLang() {
    document.documentElement.lang = LANG_HTML[S.lang] || 'en';
    document.documentElement.dir = isRTL() ? 'rtl' : 'ltr';
    document.title = 'Score-UOR';
  }

  function setLang(lang) {
    S.lang = LANGS.indexOf(lang) >= 0 ? lang : 'ku';
    storage.set(LS.lang, S.lang);
    applyLang();
  }

  /** Joins subject details; keeps values like 2026-2027 in the right order next to Kurdish text. */
  function metaJoin(parts) {
    const sep = listSep();
    return parts.filter(Boolean).map((p) => (/^[\d\s\-–/.]+$/.test(String(p)) ? '\u200E' + p + '\u200E' : p)).join(sep);
  }

  const appBase = () => location.origin + location.pathname;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  // ───────────── API ─────────────
  class ApiError extends Error {
    constructor(code, data) { super(code); this.code = code; this.data = data || {}; }
  }

  /** Everything is answered by the phone itself — there is no server. */
  async function api(action, payload = {}) {
    const out = await window.NimreLocal.call(action, payload);
    if (out.online) S.online = out.online;
    return out;
  }

  function errText(e) {
    const code = e && e.code ? e.code : 'SERVER_ERROR';
    const msg = t('err_' + code, e && e.data);
    return msg.indexOf('err_') === 0 ? t('err_SERVER_ERROR') : msg;
  }

  function setToken(tok) {
    S.token = tok || '';
    if (S.token) storage.set(LS.token, S.token); else storage.remove(LS.token);
  }

  // ───────────── Icons (24px, stroke) ─────────────
  const svg = (d, extra = '') => '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"' + extra + '>' + d + '</svg>';
  const ICON = {
    back: svg('<path d="M15 5l-7 7 7 7"/>', ' data-flip'),
    x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>'),
    more: svg('<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>'),
    copy: svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
    share: svg('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>'),
    download: svg('<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>'),
    mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>'),
    refresh: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    print: svg('<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>'),
    sheet: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>'),
    doc: svg('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>'),
    search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    clipboard: svg('<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4h6v3H9zM9 12h6M9 16h4"/>'),
    install: svg('<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3"/>'),
    lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')
  };

  /** App mark: clipboard with check marks. */
  function logo(size = 34) {
    return '<svg class="logo" width="' + size + '" height="' + size + '" viewBox="0 0 512 512" aria-hidden="true">' +
      '<rect width="512" height="512" rx="112" fill="#1B2A41"/>' +
      '<g transform="translate(256 256) scale(1.2) translate(-256 -256)"><rect x="146" y="118" width="220" height="292" rx="30" fill="#FFFFFF"/><rect x="198" y="90" width="116" height="60" rx="18" fill="#52C99A"/><rect x="226" y="108" width="60" height="16" rx="8" fill="#1B2A41"/><path d="M182 212 l18 18 l32 -34" fill="none" stroke="#1E7A5A" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="M254 214 H330" stroke="#C3CDCA" stroke-width="18" stroke-linecap="round"/><path d="M182 282 l18 18 l32 -34" fill="none" stroke="#1E7A5A" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="M254 284 H330" stroke="#C3CDCA" stroke-width="18" stroke-linecap="round"/><path d="M182 352 l18 18 l32 -34" fill="none" stroke="#1E7A5A" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="M254 354 H310" stroke="#C3CDCA" stroke-width="18" stroke-linecap="round"/></g></svg>';
  }

  /** A slightly uneven, overlapping circle — like a grade circled by hand. */
  function ringPath(cx, cy, r, wobble) {
    const pts = [];
    const start = -1.95, span = Math.PI * 2 + 0.55, steps = 64;
    for (let i = 0; i <= steps; i++) {
      const p = i / steps;
      const a = start + span * p;
      const rr = r + Math.sin(a * 2 + 0.7) * wobble * 0.6 + (p - 0.5) * wobble * 1.4;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    return 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
  }

  // ───────────── Rendering & events ─────────────
  const root = () => document.getElementById('app');

  function setView(html) {
    root().innerHTML = html;
  }

  const ACTIONS = {};   // data-act="name"      (click)
  const FORMS = {};     // data-form="name"     (submit)
  const CHANGES = {};   // data-change="name"   (change)
  const INPUTS = {};    // data-input="name"    (input)

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    const fn = FORMS[form.dataset.form];
    if (fn) fn(form, e);
  });
  document.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el && CHANGES[el.dataset.change]) CHANGES[el.dataset.change](el, e);
  });
  document.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el && INPUTS[el.dataset.input]) INPUTS[el.dataset.input](el, e);
  });

  // ───────────── Toast ─────────────
  let toastTimer = null;
  function toast(message, kind = 'ok') {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.className = 'toast toast--' + kind + ' is-on';
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-on'), kind === 'error' ? 5200 : 3000);
  }

  // ───────────── Bottom sheets ─────────────
  function openSheet({ title = '', body = '', onClose, className = '' }) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap ' + className;
    wrap.innerHTML =
      '<div class="sheet-backdrop" data-close></div>' +
      '<div class="sheet" role="dialog" aria-modal="true"' + (title ? ' aria-label="' + esc(title) + '"' : '') + '>' +
      '<div class="sheet-grip" aria-hidden="true"></div>' +
      '<div class="sheet-head"><h2>' + esc(title) + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="' + esc(t('close')) + '">' + ICON.x + '</button></div>' +
      '<div class="sheet-body">' + body + '</div></div>';
    document.body.appendChild(wrap);
    document.body.classList.add('has-sheet');
    const previous = document.activeElement;
    let closed = false;

    const onKey = (e) => { if (e.key === 'Escape') close(); };
    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      wrap.classList.remove('is-open');
      setTimeout(() => {
        wrap.remove();
        if (!document.querySelector('.sheet-wrap')) document.body.classList.remove('has-sheet');
      }, 200);
      if (previous && previous.focus && previous.isConnected) previous.focus({ preventScroll: true });
      if (onClose) onClose();
    }
    wrap._close = close;
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) { e.preventDefault(); close(); } });
    requestAnimationFrame(() => {
      wrap.classList.add('is-open');
      const first = wrap.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]), textarea');
      if (first && !window.matchMedia('(pointer: coarse)').matches) first.focus();
      else wrap.querySelector('.sheet').focus?.();
    });
    return { el: wrap, close };
  }

  const closeSheetOf = (el) => { const w = el.closest('.sheet-wrap'); if (w && w._close) w._close(); };
  const closeAllSheets = () => document.querySelectorAll('.sheet-wrap').forEach((w) => w._close && w._close());

  function confirmBox(message, { ok = t('delete'), cancel = t('cancel'), danger = true } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const sh = openSheet({
        className: 'sheet-wrap--confirm',
        body: '<p class="confirm-text">' + esc(message) + '</p>' +
          '<div class="sheet-actions"><button type="button" class="btn ' + (danger ? 'btn--danger' : 'btn--primary') + '" data-yes>' + esc(ok) + '</button>' +
          '<button type="button" class="btn btn--ghost" data-close>' + esc(cancel) + '</button></div>',
        onClose: () => { if (!answered) resolve(false); }
      });
      sh.el.querySelector('[data-yes]').addEventListener('click', () => { answered = true; resolve(true); sh.close(); });
    });
  }

  function formError(form, message) {
    let el = form.querySelector('.form-error');
    if (!el) {
      el = document.createElement('p');
      el.className = 'form-error';
      el.setAttribute('role', 'alert');
      form.prepend(el);
    }
    el.textContent = message || '';
    el.hidden = !message;
  }

  async function busy(btn, fn) {
    if (btn) {
      if (btn.getAttribute('aria-busy') === 'true') return undefined;
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
    }
    try {
      return await fn();
    } finally {
      if (btn) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (err) { /* ignore */ }
      ta.remove();
    }
    toast(t('copied'));
  }

  /** FileReader works on every Android WebView; Blob.text()/arrayBuffer() do not. */
  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result || ''));
      fr.onerror = () => reject(fr.error || new Error('read failed'));
      fr.readAsText(file);
    });
  }
  function readFileBuffer(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error('read failed'));
      fr.readAsArrayBuffer(file);
    });
  }

  /** A sheet with a real file button: tapping an actual <input type=file> is the reliable way in a WebView. */
  function chooseFile({ title, hint = '', accept = '', label, extra = '' }, onFile) {
    const sheet = openSheet({
      title,
      body: (hint ? '<p class="muted">' + esc(hint) + '</p>' : '') +
        '<label class="btn btn--primary btn--block file-btn">' + ICON.download +
        '<span>' + esc(label || t('chooseFile')) + '</span>' +
        '<input type="file"' + (accept ? ' accept="' + esc(accept) + '"' : '') + '></label>' + extra
    });
    const input = sheet.el.querySelector('input[type=file]');
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      await onFile(file, sheet);
    });
    return sheet;
  }

  function loadingBlock() {
    return '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span><span>' + esc(t('loading')) + '</span></div>';
  }

  function langButton() {
    return '<button type="button" class="lang-btn" data-act="lang" aria-label="' + esc(t('chooseLanguage')) + '">' + esc(LANG_CODE[S.lang]) + '</button>';
  }

  /** Navigation with an unsaved-changes guard. */
  async function guardDirty() {
    if (!S.dirty.size) return true;
    const ok = await confirmBox(t('unsavedLeave'), { ok: t('leave'), cancel: t('stay'), danger: true });
    if (ok) S.dirty.clear();
    return ok;
  }

  async function go(url, { replace = false, force = false } = {}) {
    if (!force && !(await guardDirty())) return;
    closeAllSheets();
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
    window.Nimre.route();
  }

  window.addEventListener('beforeunload', (e) => {
    if (S.dirty.size) { e.preventDefault(); e.returnValue = ''; }
  });

  window.Nimre = {
    CFG, IS_NATIVE, LS, TYPES, TYPE_COLORS, SUBJECT_COLORS, LEVELS, S, storage,
    LANGS, LANG_NAME, LANG_CODE, isRTL, listSep, collator,
    t, esc, r2, fmt, normDigits, metaJoin, levelOf, termsOf, termOf, dateText, applyLang, setLang, appBase, isIOS, isStandalone,
    ApiError, api, errText, setToken,
    ICON, logo, ringPath,
    setView, ACTIONS, FORMS, CHANGES, INPUTS,
    toast, openSheet, closeSheetOf, closeAllSheets, confirmBox, formError, busy, copyText, loadingBlock, langButton, readFileText, readFileBuffer, chooseFile,
    guardDirty, go
  };
})();

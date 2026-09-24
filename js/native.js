/* Nimre — Android integration (Capacitor): files, printing, back button, backups.
   Works without internet. When the online connection is on, files can also be emailed to you. */
(() => {
  'use strict';
  const N = window.Nimre;
  const { S, t, esc, ICON } = N;
  const isApp = N.IS_NATIVE;

  if (isApp) document.documentElement.classList.add('is-native');

  /** Opens the phone's email app with the message ready; the teacher only taps Send. */
  function openEmail(to, subject, body) {
    const url = 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 500);
  }

  // ───────────── Talking to Android ─────────────
  // Uses Capacitor's plugin proxy (js/vendor/capacitor.js). If that is missing, it talks to the native bridge directly.
  const proxies = {};
  function native(plugin, method, options) {
    const cap = window.Capacitor || {};
    try {
      if (typeof cap.registerPlugin === 'function') {
        const proxy = proxies[plugin] || (proxies[plugin] = cap.registerPlugin(plugin));
        return Promise.resolve(proxy[method](options || {}));
      }
      if (typeof cap.nativePromise === 'function') return cap.nativePromise(plugin, method, options || {});
    } catch (e) {
      return Promise.reject(e);
    }
    return Promise.reject(new Error('Android bridge is not available'));
  }

  const errMessage = (e) => String((e && (e.message || e.errorMessage)) || e || '').slice(0, 160);
  const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
  const androidVersion = () => Number((navigator.userAgent.match(/Android\s(\d+)/) || [])[1] || 0);
  const safeName = (name) => String(name).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'nimre';

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // ───────────── Files ─────────────
  /** Saves a file on the phone and shows what you can do with it: share, save elsewhere, or email it to yourself. Never throws. */
  async function saveFile(blob, filename) {
    const name = safeName(filename);
    if (!isApp) {   // running as a web page
      // iPhone and iPad don't download reliably from a home-screen app, so hand the file to the share sheet.
      if (N.isIOS() && navigator.canShare) {
        try {
          const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: name });
            return;
          }
        } catch (e) {
          if (e && e.name === 'AbortError') return;   // the person closed the share sheet
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    }
    let data = '';
    try { data = await blobToBase64(blob); } catch (e) { /* handled below */ }

    let cacheUri = '';
    let inDocuments = false;
    let problem = '';
    if (data) {
      try {
        const res = await withTimeout(native('Filesystem', 'writeFile', { path: 'exports/' + name, data, directory: 'CACHE', recursive: true }), 20000);
        cacheUri = (res && res.uri) || '';
      } catch (e) { problem = errMessage(e); }
      // Android 11+ lets apps add files to Documents without asking for permission.
      if (androidVersion() >= 11) {
        try {
          await withTimeout(native('Filesystem', 'writeFile', { path: 'Nimre/' + name, data, directory: 'DOCUMENTS', recursive: true }), 10000);
          inDocuments = true;
        } catch (e) { problem = problem || errMessage(e); }
      }
    } else {
      problem = 'empty file';
    }
    fileSheet({ name, data, mime: blob.type || 'application/octet-stream', cacheUri, inDocuments, problem });
  }

  function fileSheet(f) {
    const saved = !!(f.cacheUri || f.inDocuments);
    const sheet = N.openSheet({
      title: saved ? t('fileReady') : t('fileSaveFailed'),
      body:
        '<div class="file-ready' + (saved ? '' : ' is-problem') + '">' + (saved ? ICON.check : ICON.x) +
        '<strong dir="auto">' + esc(f.name) + '</strong>' +
        (f.inDocuments ? '<p class="muted">' + esc(t('savedInDocuments')) + '</p>' : '') +
        (!saved && f.problem ? '<p class="muted small" dir="ltr">' + esc(f.problem) + '</p>' : '') + '</div>' +
        '<div class="sheet-actions sheet-actions--stack">' +
        (f.cacheUri ? '<button type="button" class="btn btn--primary" data-share-file>' + ICON.share + esc(t('shareOrSave')) + '</button>' : '') +

        '<button type="button" class="btn btn--ghost" data-close>' + esc(t('close')) + '</button></div>'
    });
    const shareBtn = sheet.el.querySelector('[data-share-file]');
    if (shareBtn) {
      shareBtn.addEventListener('click', async () => {
        try {
          await native('Share', 'share', { title: f.name, files: [f.cacheUri], dialogTitle: f.name });
        } catch (e) {
          if (!/cancel/i.test(errMessage(e))) N.toast(t('shareFailed') + ' ' + errMessage(e), 'error');
        }
      });
    }
  }

  // ───────────── Opening a stored file ─────────────
  /** Types the browser can show by itself; anything else is downloaded. */
  const VIEWABLE = /^(application\/pdf|image\/|text\/plain)/;

  /** Opens a file in the phone's own viewer (PDF, Word, Excel…). Falls back to the share sheet. */
  async function openFile(blob, filename, mime) {
    const name = safeName(filename);
    const type = mime || blob.type || 'application/octet-stream';
    if (!isApp) {
      // iPhone: the share sheet previews the file and offers "Open in Word/Excel/Files".
      if (N.isIOS() && navigator.canShare) {
        try {
          const file = new File([blob], name, { type });
          if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
        } catch (e) {
          if (e && e.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type }));
      const a = document.createElement('a');
      a.href = url;
      if (VIEWABLE.test(type)) a.target = '_blank'; else a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    let data = '';
    try { data = await blobToBase64(blob); } catch (e) { /* handled below */ }
    if (!data) return N.toast(t('fileSaveFailed'), 'error');
    let uri = '';
    try {
      const res = await withTimeout(native('Filesystem', 'writeFile', { path: 'open/' + name, data, directory: 'CACHE', recursive: true }), 30000);
      uri = (res && res.uri) || '';
    } catch (e) {
      return N.toast(t('fileSaveFailed') + ' ' + errMessage(e), 'error');
    }
    try {
      await native('ScoreOpen', 'open', { uri, mime: type });
      return;
    } catch (e) {
      // No viewer installed for this type (or an older app build): offer the share sheet instead.
      try {
        await native('Share', 'share', { title: name, files: [uri], dialogTitle: name });
      } catch (e2) {
        if (!/cancel/i.test(errMessage(e2))) N.toast(t('noAppToOpen'), 'error');
      }
    }
  }

  // ───────────── Text ─────────────
  async function shareText(title, text) {
    if (!isApp) {
      if (navigator.share) { try { await navigator.share({ title, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
      await N.copyText(text);
      N.toast(t('copiedPaste'));
      return;
    }
    try {
      await native('Share', 'share', { title, text, dialogTitle: title });
    } catch (e) {
      if (/cancel/i.test(errMessage(e))) return;
      await N.copyText(text);
      N.toast(t('copiedPaste'));
    }
  }

  // ───────────── Print ─────────────
  /** Opens Android's print screen (it includes "Save as PDF"). */
  async function print(name, landscape) {
    if (!isApp) { window.print(); return; }
    try {
      await native('ScorePrint', 'print', { name: safeName(name), landscape: !!landscape });
    } catch (e) {
      N.toast(t('printFailed') + ' (' + errMessage(e) + ')', 'error');
    }
  }

  // ───────────── Backup ─────────────
  async function backup() {
    const obj = await window.NimreLocal.exportBackup();
    const d = new Date();
    const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    await saveFile(new Blob([JSON.stringify(obj)], { type: 'application/json' }), 'Nimre-backup-' + stamp + '.json');
  }

  async function applyBackup(text, sheet) {
    let obj;
    try {
      obj = JSON.parse(text);
    } catch (e) {
      N.toast(t('err_BAD_BACKUP'), 'error');
      return false;
    }
    if (!(await N.confirmBox(t('restoreConfirm'), { ok: t('restore'), danger: true }))) return false;
    try {
      const res = await window.NimreLocal.importBackup(obj);
      if (sheet) sheet.close();
      N.toast(t('restored', { n: res.subjects }));
      if (typeof N.onRestored === 'function') N.onRestored();
      return true;
    } catch (e) {
      N.toast(N.errText(e), 'error');
      return false;
    }
  }

  /** Restore: pick the backup file, or paste its text if the phone's file picker is unhelpful. */
  function restore() {
    N.chooseFile({
      title: t('restore'),
      hint: t('restoreHint'),
      accept: 'application/json,.json,text/plain',
      label: t('chooseBackupFile'),
      extra: '<hr class="rule"><form data-form="restorePaste" class="stack">' +
        '<label class="field"><span>' + esc(t('orPasteBackup')) + '</span>' +
        '<textarea name="text" rows="5" placeholder="{&quot;version&quot;:1,…}"></textarea></label>' +
        '<button class="btn btn--ghost">' + esc(t('restoreFromText')) + '</button></form>'
    }, async (file, sheet) => {
      let text = '';
      try {
        text = await N.readFileText(file);
      } catch (e) {
        N.toast(t('err_BAD_BACKUP'), 'error');
        return;
      }
      await applyBackup(text, sheet);
    });
    return false;
  }

  N.FORMS.restorePaste = (form) => N.busy(form.querySelector('button'), async () => {
    const wrap = form.closest('.sheet-wrap');
    await applyBackup(form.text.value.trim(), { close: () => wrap && wrap._close && wrap._close() });
  });

  // ───────────── Back button ─────────────
  function onBack() {
    const sheets = document.querySelectorAll('.sheet-wrap');
    if (sheets.length) {
      const top = sheets[sheets.length - 1];
      if (top._close) top._close();
      return;
    }
    if (/^#\/subject\//.test(location.hash)) {
      N.go(location.pathname + '#/teacher', { replace: true });
      return;
    }
    native('App', 'minimizeApp').catch(() => {});
  }
  try {
    const cap = (isApp && window.Capacitor) || {};
    if (typeof cap.registerPlugin === 'function') {
      const app = proxies.App || (proxies.App = cap.registerPlugin('App'));
      app.addListener('backButton', onBack);
    } else if (typeof cap.nativeCallback === 'function') {
      cap.nativeCallback('App', 'addListener', { eventName: 'backButton' }, onBack);
    }
  } catch (e) { /* not fatal */ }

  window.NimreNative = { saveFile, openFile, shareText, print, backup, restore, openEmail, applyBackup };
})();

/* Score-UOR — files kept with a subject: study plan, syllabus, exam papers, anything. */
(() => {
  'use strict';
  const N = window.Nimre;
  const { S, t, esc, ICON, ACTIONS, FORMS, CHANGES, toast, openSheet, closeSheetOf, confirmBox, formError, busy, errText } = N;
  const T = (window.NimreTabs = window.NimreTabs || { after: {} });
  const L = () => window.NimreLocal;
  const rerender = () => window.NimreTeacher.renderSubject();

  const extOf = (name) => (String(name).match(/\.([a-z0-9]{1,5})$/i) || [])[1] || '';
  const KIND = {
    pdf: 'pdf', doc: 'word', docx: 'word', odt: 'word', rtf: 'word',
    xls: 'excel', xlsx: 'excel', csv: 'excel', ods: 'excel',
    ppt: 'slides', pptx: 'slides', odp: 'slides',
    jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', heic: 'image'
  };
  const MIME = {
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    csv: 'text/csv', txt: 'text/plain', rtf: 'application/rtf', odt: 'application/vnd.oasis.opendocument.text',
    ods: 'application/vnd.oasis.opendocument.spreadsheet', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp'
  };
  /** Phones often report no type for Office files, so fall back to the extension. */
  const typeOf = (file) => file.type || MIME[extOf(file.name).toLowerCase()] || 'application/octet-stream';

  function sizeText(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function badge(name) {
    const ext = extOf(name).toLowerCase();
    return '<span class="file-badge file-badge--' + (KIND[ext] || 'other') + '" aria-hidden="true">' + esc((ext || 'file').toUpperCase().slice(0, 4)) + '</span>';
  }

  // ═════════════ The tab ═════════════
  T.files = (cur) => {
    const files = (cur.files || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const add = '<label class="btn btn--primary btn--sm file-btn">' + ICON.plus + '<span>' + esc(t('addFile')) + '</span>' +
      '<input type="file" multiple data-change="addFiles"></label>';
    const list = files.length
      ? '<ul class="rows file-list">' + files.map((f) =>
        '<li class="file-row">' +
        '<button type="button" class="file-open" data-act="openFile" data-id="' + esc(f.id) + '">' + badge(f.name) +
        '<span class="file-main"><strong dir="auto">' + esc(f.name) + '</strong>' +
        '<small>' + esc(sizeText(f.size)) + ' · ' + esc(N.dateText(f.createdAt)) + '</small></span></button>' +
        '<button type="button" class="icon-btn" data-act="fileMenu" data-id="' + esc(f.id) + '" aria-label="' + esc(f.name) + '">' + ICON.more + '</button>' +
        '</li>').join('') + '</ul>'
      : '<div class="empty empty--inline"><p>' + esc(t('emptyFiles')) + '</p></div>';
    return '<div class="section-head"><h2 class="h-sec">' + esc(t('tabFiles')) + '</h2>' + add + '</div>' +
      '<p class="muted small">' + esc(t('filesHint')) + '</p>' + list;
  };

  CHANGES.addFiles = async (input) => {
    const cur = S.cur;
    const picked = [...(input.files || [])];
    input.value = '';
    if (!picked.length) return;
    let added = 0;
    for (const file of picked) {
      if (file.size > L().FILE_LIMIT) { toast(file.name + ': ' + t('err_FILE_TOO_BIG'), 'error'); continue; }
      try {
        const buffer = await N.readFileBuffer(file);
        const row = await L().addFile(cur.subject.id, file.name, typeOf(file), buffer);
        cur.files.push(row);
        added++;
      } catch (e) {
        toast(file.name + ': ' + errText(e), 'error');
      }
    }
    if (added) toast(t('fileAdded', { n: added }));
    rerender();
  };

  async function load(id) {
    const { file, blob } = await L().readFile(id);
    return { file, blob };
  }

  ACTIONS.openFile = (el) => busy(el, async () => {
    try {
      const { file, blob } = await load(el.dataset.id);
      await window.NimreNative.openFile(blob, file.name, file.type);
    } catch (e) {
      toast(errText(e), 'error');
    }
  });

  ACTIONS.fileMenu = (el) => {
    const f = (S.cur.files || []).find((x) => x.id === el.dataset.id);
    if (!f) return;
    openSheet({
      title: f.name,
      body: '<div class="menu">' +
        '<button type="button" class="menu-item" data-act="openFile" data-id="' + esc(f.id) + '">' + ICON.doc + esc(t('openFile')) + '</button>' +
        '<button type="button" class="menu-item" data-act="shareFile" data-id="' + esc(f.id) + '">' + ICON.share + esc(t('shareOrSave')) + '</button>' +
        '<button type="button" class="menu-item" data-act="renameFile" data-id="' + esc(f.id) + '">' + ICON.edit + esc(t('renameFile')) + '</button>' +
        '<button type="button" class="menu-item menu-item--danger" data-act="deleteFile" data-id="' + esc(f.id) + '">' + ICON.trash + esc(t('deleteFile')) + '</button>' +
        '</div>'
    });
  };

  ACTIONS.shareFile = async (el) => {
    try {
      const { file, blob } = await load(el.dataset.id);
      N.closeAllSheets();
      await window.NimreNative.saveFile(blob, file.name);
    } catch (e) {
      toast(errText(e), 'error');
    }
  };

  ACTIONS.renameFile = (el) => {
    const f = (S.cur.files || []).find((x) => x.id === el.dataset.id);
    if (!f) return;
    N.closeAllSheets();
    openSheet({
      title: t('renameFile'),
      body: '<form data-form="renameFile" class="stack"><input type="hidden" name="id" value="' + esc(f.id) + '">' +
        '<label class="field"><span>' + esc(t('fileName')) + '</span><input name="name" required maxlength="120" dir="auto" value="' + esc(f.name) + '"></label>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('save')) + '</button></div></form>'
    });
  };

  FORMS.renameFile = (form) => busy(form.querySelector('.btn--primary'), async () => {
    try {
      const row = await L().renameFile(form.id.value, form.name.value);
      const i = S.cur.files.findIndex((x) => x.id === row.id);
      if (i >= 0) S.cur.files[i] = row;
      closeSheetOf(form);
      rerender();
    } catch (e) {
      formError(form, errText(e));
    }
  });

  ACTIONS.deleteFile = async (el) => {
    const f = (S.cur.files || []).find((x) => x.id === el.dataset.id);
    if (!f) return;
    N.closeAllSheets();
    if (!(await confirmBox(t('confirmDeleteFile', { name: f.name }), { danger: true }))) return;
    try {
      await L().deleteFile(f.id);
      S.cur.files = S.cur.files.filter((x) => x.id !== f.id);
      rerender();
    } catch (e) {
      toast(errText(e), 'error');
    }
  };
})();

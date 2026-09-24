/* Nimre — teacher: sign in, dashboard, subject screen shell, settings */
(() => {
  'use strict';
  const N = window.Nimre;
  const { S, t, esc, fmt, api, errText, ICON, ACTIONS, FORMS, CHANGES, go, toast, openSheet, closeSheetOf, confirmBox, formError, busy } = N;

  const TABS = ['grades', 'activities', 'students', 'register', 'report', 'files'];
  const TAB_LABEL = { grades: 'tabGrades', activities: 'tabActivities', students: 'tabStudents', register: 'tabRegister', report: 'tabReport', files: 'tabFiles' };
  const teacherHome = () => location.pathname + '#/teacher';
  const subjectUrl = (id, tab) => location.pathname + '#/subject/' + id + '/' + (tab || 'grades');

  function handleError(e, { silent = false } = {}) {
    if (e && e.code === 'AUTH') {
      toast(t('err_AUTH'), 'error');
      S.dirty.clear();
      go(location.pathname + '#/login', { replace: true, force: true });
      return true;
    }
    if (e && (e.code === 'REMOTE_AUTH' || e.code === 'NOT_CONNECTED')) {
      toast(errText(e), 'error');
      return true;
    }
    if (!silent) toast(errText(e), 'error');
    return false;
  }

  function teacherBar({ back = false, title = '', sub = '', actions = '' } = {}) {
    return '<header class="bar">' +
      (back
        ? '<button type="button" class="icon-btn icon-btn--bar" data-act="goHome" aria-label="' + esc(t('back')) + '">' + ICON.back + '</button>'
        : '<div class="brand">' + N.logo(32) + '<span>' + esc(t('appName')) + '</span></div>') +
      (title ? '<div class="bar-title"><strong>' + esc(title) + '</strong>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '</div>' : '<div class="bar-spacer"></div>') +
      '<div class="bar-actions">' + actions + N.langButton() + '</div></header>';
  }

  // ───────────── First run on Android (no password: data stays on this phone) ─────────────
  function nativeSetupView() {
    N.setView('<div class="screen screen--auth">' +
      '<header class="bar bar--plain"><div class="bar-spacer"></div>' + N.langButton() + '</header>' +
      '<main class="auth"><div class="auth-mark">' + N.logo(72) + '</div>' +
      '<form data-form="nativeSetup" class="stack">' +
      '<h1 class="h-display">' + esc(t('firstRunTitle')) + '</h1>' +
      '<p class="lead">' + esc(t('nativeFirstRunText')) + '</p>' +
      '<label class="field"><span>' + esc(t('teacherName')) + '</span><input name="teacherName" required maxlength="80" autocomplete="name"></label>' +
      '<label class="field"><span>' + esc(t('university')) + '</span><input name="university" maxlength="120" placeholder="' + esc(S.lang === 'en' ? 'University of Raparin' : S.lang === 'ar' ? 'جامعة رابرين' : 'زانکۆی ڕاپەڕین') + '"></label>' +
      '<button class="btn btn--primary btn--block">' + esc(t('startUsing')) + '</button>' +
      '<button type="button" class="link-btn" data-act="restoreBackup">' + ICON.download + esc(t('restoreFromBackup')) + '</button>' +
      '</form></main></div>');
  }

  FORMS.nativeSetup = (form) => busy(form.querySelector('.btn--primary'), async () => {
    formError(form, '');
    try {
      const res = await api('setup', { teacherName: form.teacherName.value, university: form.university.value });
      S.settings = res.settings;
      N.route();
    } catch (e) {
      formError(form, errText(e));
    }
  });

  function backupRow() {
    if (!S.subjects || !S.subjects.length || !S.online) return '';
    const last = S.online.lastBackupAt || 0;
    if (Date.now() - last < 7 * 86400000) return '';
    return '<button type="button" class="install-row install-row--warn" data-act="backupNow">' + ICON.download +
      '<span>' + esc(last ? t('backupReminder', { date: N.dateText(last) }) : t('backupNever')) + '</span></button>';
  }

  // ───────────── Dashboard ─────────────
  async function dashboardView() {
    const seq = S.seq;
    S.cur = null;
    const st = await api('status');
    if (seq !== S.seq) return;
    if (!st.initialized) return nativeSetupView();
    renderDashboard();
    try {
      const d = await api('bootstrap', { appUrl: N.appBase() });
      if (seq !== S.seq) return;
      S.settings = d.settings;
      S.subjects = d.subjects;
      S.mailQuota = d.mailQuota;
      renderDashboard();
    } catch (e) {
      if (seq !== S.seq) return;
      if (!handleError(e, { silent: true }) && !S.subjects) {
        N.setView(teacherBar({ actions: settingsBtn() }) + '<main class="page"><p class="notice notice--error">' + esc(errText(e)) + '</p>' +
          '<button type="button" class="btn btn--ghost" data-act="retryRoute">' + ICON.refresh + esc(t('refresh')) + '</button></main>');
      } else if (S.subjects) {
        toast(errText(e), 'error');
      }
    }
  }

  const settingsBtn = () => '<button type="button" class="icon-btn icon-btn--bar" data-act="settings" aria-label="' + esc(t('settings')) + '">' + ICON.gear + '</button>';

  function renderDashboard() {
    const name = S.settings && S.settings.teacherName;
    let body;
    if (!S.subjects) {
      body = N.loadingBlock();
    } else if (!S.subjects.length) {
      body = '<div class="empty"><p>' + esc(t('emptySubjects')) + '</p>' +
        '<button type="button" class="btn btn--primary" data-act="newSubject">' + ICON.plus + esc(t('newSubject')) + '</button></div>';
    } else {
      const groups = new Map();
      S.subjects.forEach((s) => {
        const key = s.department || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      });
      body = [...groups.entries()].map(([dept, list]) =>
        '<section class="dept"><h2 class="dept-name">' + esc(dept || t('noDepartment')) + '</h2><ul class="subject-list">' +
        list.map(subjectRow).join('') + '</ul></section>').join('');
    }

    N.setView(
      teacherBar({ actions: settingsBtn() }) +
      '<main class="page page--dash">' +
      '<div class="greet"><h1 class="h-display">' + esc(name ? t('hello', { name }) : t('helloNoName')) + '</h1>' +
      (S.settings && S.settings.university ? '<p class="muted">' + esc(S.settings.university) + '</p>' : '') + '</div>' +
      backupRow() + installRow() + body +
      (S.subjects && S.subjects.length > 1
        ? '<button type="button" class="btn btn--ghost btn--block compare-link" data-act="openCompare">' + ICON.sheet + esc(t('compareClasses')) + '</button>'
        : '') + '</main>' +
      (S.subjects && S.subjects.length ? '<button type="button" class="fab" data-act="newSubject">' + ICON.plus + '<span>' + esc(t('newSubject')) + '</span></button>' : '')
    );
  }

  function subjectRow(s) {
    const budget = N.r2((100 - (Number(s.finalMarks) || 0)) * N.termsOf(s));
    const pct = budget ? Math.min(100, ((s.distributed || 0) / budget) * 100) : 0;
    return '<li><a class="subject-row" href="' + esc(subjectUrl(s.id)) + '" data-act="openSubject" data-id="' + esc(s.id) + '" style="--tab:' + esc(s.color) + '">' +
      '<span class="subject-main"><strong>' + esc(s.name) + '</strong>' +
      '<span class="muted">' + esc(N.metaJoin([s.stage, s.year])) + '</span></span>' +
      '<span class="subject-facts"><span>' + esc(t('studentsCount', { n: s.studentCount })) + '</span><span>' + esc(t('activitiesCount', { n: s.activityCount })) + '</span></span>' +
      '<span class="meter' + (pct >= 100 ? ' meter--full' : '') + '" role="img" aria-label="' + esc(t('distributedOf', { n: fmt(s.distributed), b: fmt(budget) })) + '"><i style="inline-size:' + pct + '%"></i></span>' +
      '<span class="meter-label">' + esc(t('distributedOf', { n: fmt(s.distributed), b: fmt(budget) })) + '</span></a></li>';
  }

  function installRow() {
    if (N.IS_NATIVE || N.isStandalone()) return '';
    if (S.installEvent) {
      return '<button type="button" class="install-row" data-act="install">' + ICON.install + '<span>' + esc(t('install')) + '</span></button>';
    }
    // iPhone and iPad have no install button; Safari installs from the Share menu.
    if (N.isIOS()) {
      return '<p class="install-row install-row--hint">' + ICON.install + '<span>' + esc(t('installHintIos')) + '</span></p>';
    }
    return '';
  }

  ACTIONS.install = async () => {
    if (!S.installEvent) return;
    S.installEvent.prompt();
    try { await S.installEvent.userChoice; } catch (e) { /* ignore */ }
    S.installEvent = null;
    N.route();
  };

  ACTIONS.openSubject = (el) => go(subjectUrl(el.dataset.id));
  ACTIONS.openCompare = () => go(location.pathname + '#/compare');
  ACTIONS.goHome = () => go(teacherHome());
  ACTIONS.retryRoute = () => N.route();

  // ───────────── Subject form ─────────────
  function defaultYear() {
    const d = new Date();
    const y = d.getFullYear();
    return d.getMonth() >= 7 ? y + '-' + (y + 1) : (y - 1) + '-' + y;
  }

  function subjectForm(subject) {
    const s = subject || { color: N.SUBJECT_COLORS[(S.subjects ? S.subjects.length : 0) % N.SUBJECT_COLORS.length], year: defaultYear(), finalMarks: 50, finalMode: 'reserved', passPct: 50 };
    const mode = s.finalMode === 'included' ? 'included' : 'reserved';
    const depts = [...new Set((S.subjects || []).map((x) => x.department).filter(Boolean))];
    openSheet({
      title: subject ? t('editSubject') : t('newSubject'),
      body: '<form data-form="subject" class="stack">' +
        '<input type="hidden" name="id" value="' + esc(s.id || '') + '">' +
        '<label class="field"><span>' + esc(t('subjectName')) + '</span><input name="name" required maxlength="120" value="' + esc(s.name || '') + '"></label>' +
        '<label class="field"><span>' + esc(t('department')) + '</span><input name="department" maxlength="80" list="dept-options" value="' + esc(s.department || '') + '">' +
        '<datalist id="dept-options">' + depts.map((d) => '<option value="' + esc(d) + '">').join('') + '</datalist></label>' +
        '<div class="grid2">' +
        '<label class="field"><span>' + esc(t('stage')) + '</span><input name="stage" maxlength="40" value="' + esc(s.stage || '') + '"></label>' +
        '<label class="field"><span>' + esc(t('semester')) + '</span><input name="semester" maxlength="20" value="' + esc(s.semester || '') + '"></label></div>' +
        '<label class="field"><span>' + esc(t('academicYear')) + '</span><input name="year" maxlength="20" dir="ltr" value="' + esc(s.year || '') + '"></label>' +
        '<fieldset class="field"><legend>' + esc(t('termsLabel')) + '</legend><div class="seg seg--wrap">' +
        [1, 2].map((n) => '<label class="seg-btn' + (N.termsOf(s) === n ? ' is-on' : '') + '">' +
          '<input type="radio" name="terms" value="' + n + '"' + (N.termsOf(s) === n ? ' checked' : '') + ' data-change="termsPick">' +
          esc(t(n === 1 ? 'oneTerm' : 'twoTerms')) + '</label>').join('') +
        '</div><small class="field-hint">' + esc(t('termsHint')) + '</small></fieldset>' +
        '<fieldset class="field"><legend>' + esc(t('finalModeLabel')) + '</legend>' +
        '<div class="seg seg--wrap">' +
        '<button type="button" class="seg-btn' + (mode === 'reserved' ? ' is-on' : '') + '" data-act="finalMode" data-mode="reserved">' + esc(t('finalModeCommittee')) + '</button>' +
        '<button type="button" class="seg-btn' + (mode === 'included' ? ' is-on' : '') + '" data-act="finalMode" data-mode="included">' + esc(t('finalModeSelf')) + '</button>' +
        '</div><input type="hidden" name="finalMode" value="' + mode + '"></fieldset>' +
        '<label class="field" data-final-marks' + (mode === 'included' ? ' hidden' : '') + '><span>' + esc(t('finalExamMarks')) + '</span>' +
        '<input name="finalMarks" type="text" inputmode="decimal" dir="ltr" class="input-marks" value="' + esc(s.finalMarks === undefined ? 50 : s.finalMarks) + '">' +
        '<small class="field-hint">' + esc(t('finalExamHint')) + '</small></label>' +
        '<p class="field-hint" data-final-self' + (mode === 'included' ? '' : ' hidden') + '>' + esc(t('finalModeSelfHint')) + '</p>' +
        '<label class="field"><span>' + esc(t('passMarkField')) + '</span>' +
        '<input name="passPct" type="text" inputmode="decimal" dir="ltr" class="input-marks" value="' + esc(s.passPct === undefined ? 50 : s.passPct) + '">' +
        '<small class="field-hint">' + esc(t('passMarkHint')) + '</small></label>' +
        '<fieldset class="field"><legend>' + esc(t('color')) + '</legend><div class="swatches">' +
        N.SUBJECT_COLORS.map((c) => '<label class="swatch-pick" style="--c:' + c + '"><input type="radio" name="color" value="' + c + '"' + (c.toLowerCase() === String(s.color).toLowerCase() ? ' checked' : '') + '><span></span></label>').join('') +
        '</div></fieldset>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('save')) + '</button>' +
        (subject ? '<button type="button" class="btn btn--danger-ghost" data-act="deleteSubject" data-id="' + esc(s.id) + '">' + ICON.trash + esc(t('deleteSubject')) + '</button>' : '') +
        '</div></form>'
    });
  }

  /** Switches between "a committee marks the final exam" and "I enter it here". */
  ACTIONS.finalMode = (el) => {
    const form = el.closest('form');
    const mode = el.dataset.mode;
    form.finalMode.value = mode;
    form.querySelectorAll('[data-act="finalMode"]').forEach((b) => b.classList.toggle('is-on', b.dataset.mode === mode));
    form.querySelector('[data-final-marks]').hidden = mode === 'included';
    form.querySelector('[data-final-self]').hidden = mode !== 'included';
  };

  CHANGES.termsPick = (el) => {
    el.closest('.seg').querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', b.contains(el) && el.checked));
  };

  ACTIONS.newSubject = () => subjectForm(null);
  ACTIONS.editSubject = () => S.cur && subjectForm(S.cur.subject);

  FORMS.subject = (form) => busy(form.querySelector('.btn--primary'), async () => {
    formError(form, '');
    const f = new FormData(form);
    const subject = Object.fromEntries(f.entries());
    subject.finalMarks = subject.finalMode === 'included' ? '0' : N.normDigits(subject.finalMarks || '50');
    subject.passPct = N.normDigits(subject.passPct || '50');
    subject.terms = subject.terms === '2' ? 2 : 1;
    try {
      const res = await api('saveSubject', { subject });
      closeSheetOf(form);
      toast(t('saved'));
      if (subject.id && S.cur) {
        S.cur.subject = res.subject;
        N.route();
      } else {
        S.subjects = null;
        go(subjectUrl(res.subject.id, 'activities'));
      }
    } catch (e) {
      if (!handleError(e, { silent: true })) formError(form, errText(e));
    }
  });

  ACTIONS.deleteSubject = async (el) => {
    const subject = S.cur ? S.cur.subject : (S.subjects || []).find((x) => x.id === el.dataset.id);
    if (!subject) return;
    if (!(await confirmBox(t('confirmDeleteSubject', { name: subject.name })))) return;
    try {
      await api('deleteSubject', { subjectId: subject.id });
      N.closeAllSheets();
      S.cur = null;
      S.subjects = null;
      S.dirty.clear();
      toast(t('saved'));
      go(teacherHome(), { replace: true, force: true });
    } catch (e) {
      handleError(e);
    }
  };

  // ───────────── Subject screen ─────────────
  function toCur(d) {
    const scores = new Map();
    (d.scores || []).forEach(([a, s, v]) => scores.set(a + '|' + s, Number(v)));
    const absences = new Map();
    (d.absences || []).forEach(([sess, st, status]) => absences.set(sess + '|' + st, status));
    const partScores = new Map();
    (d.partScores || []).forEach(([a, p, st, v]) => partScores.set(a + '|' + p + '|' + st, Number(v)));
    return {
      subject: d.subject, students: d.students, activities: d.activities, scores,
      sessions: d.sessions || [], absences, partScores, files: d.files || []
    };
  }

  async function subjectView(id, tab) {
    const seq = S.seq;
    S.tab = TABS.indexOf(tab) >= 0 ? tab : 'grades';
    if (S.cur && S.cur.subject.id === id) return renderSubject();
    S.cur = null;
    S.activityId = null;
    S.dirty.clear();
    N.setView(teacherBar({ back: true }) + tabsNav(id) + '<main class="page">' + N.loadingBlock() + '</main>');
    await loadSubject(id, seq);
  }

  async function loadSubject(id, seq) {
    try {
      const d = await api('getSubject', { subjectId: id });
      if (seq !== undefined && seq !== S.seq) return;
      S.cur = toCur(d);
      S.settings = d.settings;
      S.mailQuota = d.mailQuota;
      renderSubject();
    } catch (e) {
      if (seq !== undefined && seq !== S.seq) return;
      if (handleError(e, { silent: true })) return;
      if (e.code === 'SUBJECT_NOT_FOUND') { toast(errText(e), 'error'); return go(teacherHome(), { replace: true, force: true }); }
      N.setView(teacherBar({ back: true }) + '<main class="page"><p class="notice notice--error">' + esc(errText(e)) + '</p>' +
        '<button type="button" class="btn btn--ghost" data-act="retryRoute">' + ICON.refresh + esc(t('refresh')) + '</button></main>');
    }
  }

  function tabsNav(id) {
    return '<nav class="tabs" aria-label="' + esc(t('subjects')) + '"><div class="tabs-track">' +
      TABS.map((k) => '<a href="' + esc(subjectUrl(id, k)) + '" class="tab' + (S.tab === k ? ' is-active' : '') + '" data-act="tab" data-tab="' + k + '"' + (S.tab === k ? ' aria-current="page"' : '') + '>' + esc(t(TAB_LABEL[k])) + '</a>').join('') +
      '</div></nav>';
  }

  function renderSubject() {
    const cur = S.cur;
    if (!cur) return;
    const s = cur.subject;
    const sep = N.listSep();
    const actions =
      '<button type="button" class="icon-btn icon-btn--bar" data-act="reloadSubject" aria-label="' + esc(t('refresh')) + '">' + ICON.refresh + '</button>' +
      '<button type="button" class="icon-btn icon-btn--bar" data-act="editSubject" aria-label="' + esc(t('editSubject')) + '">' + ICON.edit + '</button>';
    const T = window.NimreTabs;
    N.setView(
      teacherBar({ back: true, title: s.name, sub: [s.department, s.stage].filter(Boolean).join(sep), actions }) +
      tabsNav(s.id) +
      '<main class="page page--subject" style="--tab:' + esc(s.color) + '">' + T[S.tab](cur) + '</main>'
    );
    if (T.after[S.tab]) T.after[S.tab](cur);
    // Center the active tab and chosen activity inside their strips (without moving the page).
    ['.tab.is-active', '.chip.is-on'].forEach((sel) => {
      const el = document.querySelector(sel);
      const strip = el && el.closest('.tabs, .chips');
      if (!strip) return;
      const b = strip.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      strip.scrollLeft += (r.left + r.width / 2) - (b.left + b.width / 2);
    });
  }

  ACTIONS.tab = (el) => {
    const tab = el.dataset.tab;
    if (!S.cur || tab === S.tab) return;
    go(subjectUrl(S.cur.subject.id, tab), { replace: true });
    window.scrollTo(0, 0);
  };

  ACTIONS.reloadSubject = async (el) => {
    if (!S.cur || !(await N.guardDirty())) return;
    busy(el, () => loadSubject(S.cur.subject.id));
  };

  // ───────────── Compare classes ─────────────
  async function compareView() {
    const seq = S.seq;
    S.cur = null;
    N.setView(teacherBar({ back: true, title: t('compareClasses') }) + '<main class="page">' + N.loadingBlock() + '</main>');
    let rows;
    try {
      rows = (await api('compare')).subjects;
    } catch (e) {
      if (seq !== S.seq) return;
      return N.setView(teacherBar({ back: true }) + '<main class="page"><p class="notice notice--error">' + esc(errText(e)) + '</p></main>');
    }
    if (seq !== S.seq) return;
    S.compare = rows;

    const graded = rows.filter((r) => r.scored > 0);
    const body = graded.length
      ? '<p class="muted">' + esc(t('compareIntro')) + '</p>' +
        '<ul class="rows compare-list">' + graded.map((r) =>
          '<li class="cmp" style="--tab:' + esc(r.color) + '">' +
          '<a class="cmp-head" href="' + esc(subjectUrl(r.id, 'report')) + '" data-act="openSubject" data-id="' + esc(r.id) + '">' +
          '<strong>' + esc(r.name) + '</strong>' +
          '<small>' + esc(N.metaJoin([r.department, r.stage])) + ' · ' + esc(t('studentsCount', { n: r.students })) + '</small></a>' +
          '<div class="cmp-nums"><span>' + esc(t('statAverage')) + ' <b>' + fmt(r.averagePct) + '%</b></span>' +
          '<span>' + esc(t('passRate')) + ' <b>' + fmt(r.passRate) + '%</b></span>' +
          '<span>' + esc(t('statPassed')) + ' <b>' + r.passed + '</b> · ' + esc(t('statFailed')) + ' <b>' + r.failed + '</b></span></div>' +
          '<div class="cmp-bar" role="img" aria-label="' + esc(t('passRate') + ' ' + fmt(r.passRate) + '%') + '">' +
          '<i class="pf-pass" style="inline-size:' + r.passRate + '%"></i>' +
          '<i class="pf-fail" style="inline-size:' + (100 - r.passRate) + '%"></i></div>' +
          '<div class="cmp-avg"><i style="inline-size:' + Math.max(0, Math.min(100, r.averagePct)) + '%"></i></div>' +
          '</li>').join('') + '</ul>'
      : '<div class="empty"><p>' + esc(t('noSubjectsToCompare')) + '</p></div>';

    N.setView(teacherBar({ back: true, title: t('compareClasses') }) + '<main class="page">' + body + '</main>');
  }

  // ───────────── Settings ─────────────
  ACTIONS.settings = () => {
    const st = S.settings || {};
    const on = S.online || {};
    openSheet({
      title: t('settings'),
      body:
        '<form data-form="settings" class="stack">' +
        '<label class="field"><span>' + esc(t('teacherName')) + '</span><input name="teacherName" maxlength="80" value="' + esc(st.teacherName || '') + '"></label>' +
        '<label class="field"><span>' + esc(t('university')) + '</span><input name="university" maxlength="120" value="' + esc(st.university || '') + '"></label>' +
        '<button class="btn btn--primary">' + esc(t('save')) + '</button></form>' +
        '<hr class="rule"><div class="field"><span class="field-label">' + esc(t('language')) + '</span><div class="seg">' +
        N.LANGS.map((k) => '<button type="button" class="seg-btn' + (S.lang === k ? ' is-on' : '') + '" data-act="setLang" data-lang="' + k + '" lang="' + (k === 'ku' ? 'ckb' : k) + '">' + esc(N.LANG_NAME[k]) + '</button>').join('') +
        '</div></div>' +
        '<hr class="rule"><h3 class="h-sub">' + ICON.download + esc(t('backupTitle')) + '</h3>' +
        '<p class="muted">' + esc(t('backupIntro')) + '</p>' +
        (on.lastBackupAt ? '<p class="muted small">' + esc(t('lastBackup', { date: N.dateText(on.lastBackupAt, true) })) + '</p>' : '') +
        '<div class="btn-row btn-row--tight"><button type="button" class="btn btn--primary" data-act="backupNow">' + esc(t('backupNow')) + '</button>' +
        '<button type="button" class="btn btn--ghost" data-act="restoreBackup">' + esc(t('restore')) + '</button></div>' +
        '<p class="version muted">Score-UOR ' + esc(N.CFG.VERSION || '') + '</p>'
    });
  };

  ACTIONS.backupNow = (el) => busy(el, async () => {
    try {
      await window.NimreNative.backup();
      if (S.online) S.online.lastBackupAt = Date.now();
      const row = document.querySelector('.install-row--warn');
      if (row) row.remove();
    } catch (e) {
      toast(t('err_EXPORT'), 'error');
    }
  });

  ACTIONS.restoreBackup = () => window.NimreNative.restore();

  /** Called after a backup was restored. */
  N.onRestored = () => {
    N.closeAllSheets();
    S.subjects = null;
    S.cur = null;
    S.dirty.clear();
    go(location.pathname + '#/teacher', { replace: true, force: true });
  };

  ACTIONS.setLang = (el) => {
    N.setLang(el.dataset.lang);
    N.closeAllSheets();
    N.route();
  };

  FORMS.settings = (form) => busy(form.querySelector('button'), async () => {
    formError(form, '');
    try {
      const res = await api('saveSettings', { settings: { teacherName: form.teacherName.value, university: form.university.value } });
      S.settings = res.settings;
      closeSheetOf(form);
      toast(t('saved'));
      N.route();
    } catch (e) {
      if (!handleError(e, { silent: true })) formError(form, errText(e));
    }
  });

  window.NimreTeacher = { dashboardView, subjectView, compareView, renderSubject, handleError, subjectUrl, loadSubject };
})();

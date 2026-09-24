/* Score-UOR — subject tabs part 2: students (with email sending) and report */
(() => {
  'use strict';
  const N = window.Nimre;
  const { S, t, esc, fmt, r2, api, errText, ICON, ACTIONS, FORMS, CHANGES, INPUTS, toast, openSheet, closeSheetOf, confirmBox, formError, busy } = N;
  const T = (window.NimreTabs = window.NimreTabs || { after: {} });
  const teacher = () => window.NimreTeacher;
  const rerender = () => teacher().renderSubject();
  const X = () => window.NimreExport;
  const device = () => window.NimreNative;

  const budgetOf = (cur) => r2(100 - (Number(cur.subject.finalMarks) || 0));

  // ═════════════ Students ═════════════
  T.students = (cur) => {
    const withEmail = cur.students.filter((st) => st.email).length;
    const sent = cur.students.filter((st) => st.emailedAt).length;
    const list = cur.students.length
      ? '<label class="search"><span class="sr-only">' + esc(t('searchStudents')) + '</span>' + ICON.search +
        '<input type="search" data-input="filterRows" data-target=".student-list" placeholder="' + esc(t('searchStudents')) + '"></label>' +
        '<ol class="rows student-list">' + cur.students.map((st, i) =>
          '<li class="student-row" data-name="' + esc((st.name + ' ' + st.email).toLowerCase()) + '">' +
          '<span class="idx">' + (i + 1) + '</span>' +
          '<span class="st-main"><strong>' + esc(st.name) + '</strong>' +
          (st.email ? '<small dir="ltr">' + esc(st.email) + '</small>' : '<small class="warn">' + esc(t('noEmail')) + '</small>') +
          (st.emailedAt ? '<small class="ok">' + ICON.check + esc(t('sentOn', { date: N.dateText(st.emailedAt) })) + '</small>' : '') + '</span>' +
          '<button type="button" class="icon-btn" data-act="studentMenu" data-id="' + esc(st.id) + '" aria-label="' + esc(st.name) + '">' + ICON.more + '</button></li>').join('') +
        '</ol>'
      : '<div class="empty empty--inline"><p>' + esc(t('emptyStudents')) + '</p></div>';

    const mailBlock = withEmail
      ? '<section class="block send-block"><h2 class="h-sec">' + ICON.mail + esc(t('sendGradesTitle')) + '</h2>' +
        '<p class="muted">' + esc(t('sendGradesIntro')) + '</p>' +
        '<p class="muted small">' + esc(t('sentProgress', { a: sent, b: withEmail })) + '</p>' +
        '<button type="button" class="btn btn--primary btn--block" data-act="sendQueue">' + ICON.mail + esc(t('sendToAll')) + '</button></section>'
      : '';

    return '<div class="section-head"><h2 class="h-sec">' + esc(t('studentsCount', { n: cur.students.length })) + '</h2>' +
      '<div class="btn-row btn-row--tight">' +
      '<button type="button" class="btn btn--primary btn--sm" data-act="importStudents">' + ICON.sheet + esc(t('importFile')) + '</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-act="pasteStudents">' + ICON.clipboard + esc(t('pasteList')) + '</button>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-act="addStudent">' + ICON.plus + esc(t('addStudent')) + '</button></div></div>' +
      list + mailBlock;
  };

  function studentForm(st) {
    openSheet({
      title: st ? t('editStudent') : t('addStudent'),
      body: '<form data-form="student" class="stack">' +
        '<input type="hidden" name="id" value="' + esc(st ? st.id : '') + '">' +
        '<label class="field"><span>' + esc(t('name')) + '</span><input name="studentName" required maxlength="120" value="' + esc(st ? st.name : '') + '"></label>' +
        '<label class="field"><span>' + esc(t('email')) + '</span><input name="email" type="email" maxlength="160" dir="ltr" autocomplete="off" autocapitalize="off" value="' + esc(st ? st.email : '') + '"></label>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('save')) + '</button></div></form>'
    });
  }

  ACTIONS.addStudent = () => studentForm(null);

  ACTIONS.studentMenu = (el) => {
    const st = S.cur.students.find((s) => s.id === el.dataset.id);
    if (!st) return;
    openSheet({
      title: st.name,
      body: '<div class="menu">' +
        (st.email ? '<button type="button" class="menu-item" data-act="emailStudent" data-id="' + esc(st.id) + '">' + ICON.mail + esc(t('emailGrades')) + '<small dir="ltr">' + esc(st.email) + '</small></button>' : '') +
        '<button type="button" class="menu-item" data-act="shareGradesText" data-id="' + esc(st.id) + '">' + ICON.share + esc(t('shareGradesText')) + '</button>' +
        '<button type="button" class="menu-item" data-act="studentCard" data-id="' + esc(st.id) + '">' + ICON.print + esc(t('reportCard')) + '</button>' +
        '<button type="button" class="menu-item" data-act="editStudent" data-id="' + esc(st.id) + '">' + ICON.edit + esc(t('editStudent')) + '</button>' +
        '<button type="button" class="menu-item menu-item--danger" data-act="deleteStudent" data-id="' + esc(st.id) + '">' + ICON.trash + esc(t('deleteStudent')) + '</button>' +
        '</div>'
    });
  };

  ACTIONS.editStudent = (el) => { N.closeAllSheets(); setTimeout(() => studentForm(S.cur.students.find((s) => s.id === el.dataset.id)), 210); };

  ACTIONS.deleteStudent = async (el) => {
    const cur = S.cur;
    const st = cur.students.find((s) => s.id === el.dataset.id);
    if (!st || !(await confirmBox(t('confirmDeleteStudent', { name: st.name })))) return;
    try {
      await api('deleteStudent', { subjectId: cur.subject.id, studentId: st.id });
      cur.students = cur.students.filter((s) => s.id !== st.id);
      [...cur.scores.keys()].forEach((k) => { if (k.endsWith('|' + st.id)) cur.scores.delete(k); });
      S.dirty.delete(st.id);
      N.closeAllSheets();
      toast(t('saved'));
      rerender();
    } catch (e) {
      teacher().handleError(e);
    }
  };

  async function saveStudentList(form, students) {
    const res = await api('saveStudents', { subjectId: S.cur.subject.id, students });
    S.cur.students = res.students;
    closeSheetOf(form);
    toast(t('studentsAdded', { a: res.added, u: res.updated }) + (res.rejected.length ? ' — ' + t('rejectedRows', { n: res.rejected.length }) : ''), res.rejected.length ? 'error' : 'ok');
    rerender();
  }

  FORMS.student = (form) => busy(form.querySelector('.btn--primary'), async () => {
    formError(form, '');
    const email = form.email.value.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return formError(form, t('err_INVALID_EMAIL'));
    try {
      await saveStudentList(form, [{ id: form.id.value || undefined, name: form.studentName.value, email }]);
    } catch (e) {
      formError(form, errText(e));
    }
  });

  /** Accepts rows copied from Excel/Sheets (tabs), CSV, or "Name - email" lines. */
  function parseRoster(text) {
    const out = [];
    const header = /^(#|no\.?|name|names|full name|student|student name|email|e-mail|ناو|ناوی قوتابی|ناوی سیانی|ئیمەیڵ|ژ|ز)$/i;
    String(text).split(/\r?\n/).forEach((line) => {
      const raw = line.trim();
      if (!raw) return;
      const m = raw.match(/[^\s,;<>"'()]+@[^\s,;<>"'()]+\.[^\s,;<>"'()]{2,}/);
      const email = m ? m[0].toLowerCase() : '';
      const rest = m ? raw.replace(m[0], '\t') : raw;
      const parts = rest.split(/\t|;|,(?=\s*$)|\s[-–]\s|,/)
        .map((p) => p.replace(/^[\d\u0660-\u0669\u06F0-\u06F9]+[.)\-]?\s*/, '').trim())
        .filter((p) => p && !/^[\d\u0660-\u0669\u06F0-\u06F9+\s]+$/.test(p) && !header.test(p));
      const name = parts.join(' ').replace(/\s+/g, ' ').trim();
      if (name) out.push({ name, email });
    });
    return out;
  }

  ACTIONS.pasteStudents = () => {
    openSheet({
      title: t('pasteList'),
      body: '<form data-form="pasteStudents" class="stack">' +
        '<p class="muted">' + esc(t('pasteHint')) + '</p>' +
        '<textarea name="roster" rows="9" data-input="rosterPreview" placeholder="' + (S.lang === 'en' ? 'Aram Kamaran&#9;aram@uor.edu.krd' : S.lang === 'ar' ? 'آرام كامەران&#9;aram@uor.edu.krd' : 'ئارام کامەران&#9;aram@uor.edu.krd') + '"></textarea>' +
        '<p class="roster-preview muted" aria-live="polite"></p>' +
        '<div class="sheet-actions"><button class="btn btn--primary" disabled>' + esc(t('addStudents', { n: 0 })) + '</button></div></form>'
    });
  };

  INPUTS.rosterPreview = (ta) => {
    const form = ta.closest('form');
    const rows = parseRoster(ta.value);
    const noEmail = rows.filter((r) => !r.email).length;
    form.querySelector('.roster-preview').textContent = rows.length
      ? t('pastePreview', { n: rows.length }) + (noEmail ? ' — ' + t('pasteNoEmail', { n: noEmail }) : '')
      : '';
    const btn = form.querySelector('.btn--primary');
    btn.textContent = t('addStudents', { n: rows.length });
    btn.disabled = !rows.length;
  };

  FORMS.pasteStudents = (form) => busy(form.querySelector('.btn--primary'), async () => {
    formError(form, '');
    const rows = parseRoster(form.roster.value);
    if (!rows.length) return;
    try {
      await saveStudentList(form, rows);
    } catch (e) {
      formError(form, errText(e));
    }
  });

  // ── Import from an Excel or CSV file (works offline) ──
  ACTIONS.importStudents = () => {
    N.chooseFile({
      title: t('importFile'),
      hint: t('importHint'),
      accept: '.xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      label: t('chooseFile')
    }, async (file, fileSheet) => {
      let rows;
      try {
        rows = await X().readRoster(file);
      } catch (e) {
        return toast(t(e && e.code === 'XLS_OLD' ? 'err_XLS_OLD' : 'err_IMPORT'), 'error');
      }
      if (!rows.length) return toast(t('importNone'), 'error');
      fileSheet.close();
      const noEmail = rows.filter((r) => !r.email).length;
      const sheet = openSheet({
        title: t('importFile'),
        body: '<form data-form="importStudents" class="stack">' +
          '<p class="roster-preview">' + esc(t('pastePreview', { n: rows.length })) + (noEmail ? ' — ' + esc(t('pasteNoEmail', { n: noEmail })) : '') + '</p>' +
          '<ol class="rows import-preview">' + rows.slice(0, 50).map((r) =>
            '<li><strong>' + esc(r.name) + '</strong><small dir="ltr">' + esc(r.email || '—') + '</small></li>').join('') +
          (rows.length > 50 ? '<li class="muted">… +' + (rows.length - 50) + '</li>' : '') + '</ol>' +
          '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('addStudents', { n: rows.length })) + '</button></div></form>'
      });
      sheet.el.querySelector('form')._rows = rows;
    });
  };

  FORMS.importStudents = (form) => busy(form.querySelector('.btn--primary'), async () => {
    try {
      await saveStudentList(form, form._rows || []);
    } catch (e) {
      formError(form, errText(e));
    }
  });

  // ═════════════ Sending grades from your own email account ═════════════
  function gradesMessage(st) {
    const cur = S.cur;
    const s = cur.subject;
    let total = 0;
    const lines = cur.activities.map((a) => {
      const v = cur.scores.get(a.id + '|' + st.id);
      if (v !== undefined) total += v;
      return '• ' + a.name + ': ' + (v === undefined ? '—' : fmt(v)) + ' / ' + fmt(a.marks);
    });
    const head = [S.settings && S.settings.university, s.name, N.metaJoin([s.department, s.stage, s.year])].filter(Boolean).join('\n');
    return head + '\n\n' + st.name + '\n' +
      (lines.length ? lines.join('\n') + '\n\n' : '') +
      t('total') + ': ' + fmt(r2(total)) + ' / ' + fmt(budgetOf(cur)) +
      (S.settings && S.settings.teacherName ? '\n\n' + t('teacher') + ': ' + S.settings.teacherName : '');
  }

  async function sendTo(st) {
    device().openEmail(st.email, t('emailSubject', { subject: S.cur.subject.name }), gradesMessage(st));
    try {
      const res = await api('markEmailed', { subjectId: S.cur.subject.id, studentIds: [st.id] });
      S.cur.students = res.students;
    } catch (e) { /* the message still opened */ }
  }

  ACTIONS.emailStudent = async (el) => {
    const st = S.cur.students.find((s) => s.id === el.dataset.id);
    if (!st || !st.email) return;
    N.closeAllSheets();
    await sendTo(st);
    rerender();
  };

  ACTIONS.shareGradesText = (el) => {
    const st = S.cur.students.find((s) => s.id === el.dataset.id);
    if (!st) return;
    N.closeAllSheets();
    device().shareText(st.name + ' — ' + S.cur.subject.name, gradesMessage(st));
  };

  /** One ready-made message per student: tap Send in your email app, come back, tap the next one. */
  ACTIONS.sendQueue = () => {
    openSheet({ title: t('sendToAll'), body: '<div id="queue-slot">' + queueBody() + '</div>' });
  };

  function queueBody() {
    const cur = S.cur;
    const withEmail = cur.students.filter((st) => st.email);
    const pending = withEmail.filter((st) => !st.emailedAt);
    const next = pending[0];
    return '<p class="muted">' + esc(t('sendQueueHint')) + '</p>' +
      '<p class="queue-progress"><b>' + (withEmail.length - pending.length) + '</b> / ' + withEmail.length + ' ' + esc(t('sentWord')) + '</p>' +
      (next
        ? '<div class="queue-next"><small class="muted">' + esc(t('nextStudent')) + '</small><strong>' + esc(next.name) + '</strong><small dir="ltr">' + esc(next.email) + '</small></div>' +
          '<button type="button" class="btn btn--primary btn--block" data-act="sendNext">' + ICON.mail + esc(t('openEmailFor', { name: next.name })) + '</button>'
        : '<p class="notice">' + esc(t('allSent')) + '</p>') +
      '<div class="btn-row btn-row--center"><button type="button" class="btn btn--ghost btn--sm" data-act="resetSent">' + esc(t('markAllUnsent')) + '</button></div>';
  }

  function refreshQueue() {
    const slot = document.getElementById('queue-slot');
    if (slot) slot.innerHTML = queueBody();
    const open = [...document.querySelectorAll('.sheet-wrap')];
    rerender();
    open.forEach((el) => document.body.appendChild(el));
  }

  ACTIONS.sendNext = async (btn) => {
    const next = S.cur.students.filter((st) => st.email && !st.emailedAt)[0];
    if (!next) return;
    await busy(btn, () => sendTo(next));
    refreshQueue();
  };

  ACTIONS.resetSent = async (btn) => {
    await busy(btn, async () => {
      const res = await api('clearEmailed', { subjectId: S.cur.subject.id });
      S.cur.students = res.students;
    });
    refreshQueue();
  };

  // ═════════════ Report and statistics ═════════════
  /** A student passes at this share of the marks the app knows about (50% unless changed). */
  function passPctOf(cur) {
    const v = Number(cur.subject.passPct);
    return isFinite(v) && v >= 0 && v <= 100 ? v : 50;
  }

  function buildReport(cur, opts) {
    const terms = N.termsOf(cur.subject);
    const view = terms === 2 ? (opts.term === 2 ? 2 : opts.term === 'year' ? 'year' : 1) : 1;
    const isYear = view === 'year';
    const budget = budgetOf(cur);
    const actsOf = (n) => cur.activities.filter((a) => N.termOf(a) === n);
    // In the year view the two terms stand in for activities, so every export works unchanged.
    const all = isYear
      ? [1, 2].map((n) => ({ id: 'TERM' + n, name: t('term' + n), marks: budget, term: n }))
      : actsOf(view);
    // The teacher may count only some activities; the report is then out of their marks alone.
    const pick = !isYear && opts.pick ? opts.pick[cur.subject.id] : null;
    const chosen = pick && pick.length ? all.filter((a) => pick.indexOf(a.id) >= 0) : all;
    const acts = chosen.length ? chosen : all;
    const partial = acts.length < all.length;
    const max = partial ? r2(acts.reduce((sum, a) => sum + a.marks, 0)) : budget;
    const passPct = passPctOf(cur);
    const passMark = r2((max * passPct) / 100);

    let rows = cur.students.map((st, i) => {
      let cells;
      let total = 0;
      let entered = 0;
      if (isYear) {
        const per = [1, 2].map((n) => {
          const list = actsOf(n);
          let sum = 0;
          let got = 0;
          list.forEach((a) => {
            const v = cur.scores.get(a.id + '|' + st.id);
            if (v !== undefined) { sum += v; got++; }
          });
          return { has: list.length > 0, got, total: r2(sum) };
        });
        cells = per.map((p) => (p.has && p.got ? p.total : ''));
        const done = per.filter((p) => p.has && p.got);
        entered = done.length;
        total = done.length ? r2(done.reduce((a, p) => a + p.total, 0) / done.length) : 0;
      } else {
        cells = acts.map((a) => {
          const v = cur.scores.get(a.id + '|' + st.id);
          if (v === undefined) return '';
          total += v;
          entered++;
          return v;
        });
        total = r2(total);
      }
      const pct = max ? r2((total / max) * 100) : 0;
      return { order: i, st, cells, total, entered, pct, level: N.levelOf(pct), passed: total + 1e-9 >= passMark };
    });

    const done = finishRows(rows, opts);
    return {
      acts, max, rows: done.rows, passMark, passPct, terms, view, isYear, ranked: done.ranked,
      partial, allCount: all.length,
      stats: computeStats(done.rows, acts, max, passMark, passPct)
    };
  }

  /** Class rank (ties share a place), then the chosen order and row numbers. */
  function finishRows(rows, opts) {
    const ladder = rows.filter((r) => r.entered > 0).map((r) => r.total).sort((a, b) => b - a);
    rows.forEach((r) => { r.rank = r.entered ? ladder.indexOf(r.total) + 1 : 0; });
    const collator = N.collator();
    if (opts.sort === 'name') rows.sort((a, b) => collator.compare(a.st.name, b.st.name));
    else if (opts.sort === 'total') rows.sort((a, b) => b.total - a.total || a.order - b.order);
    return { rows: rows.map((r, i) => Object.assign(r, { n: i + 1 })), ranked: ladder.length };
  }

  function computeStats(rows, acts, max, passMark, passPct) {
    // Students with no score at all would drag every average to zero, so they are counted separately.
    const scored = rows.filter((r) => r.entered > 0);
    const sorted = scored.map((r) => r.total).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const average = sorted.length ? r2(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0;
    const passed = scored.filter((r) => r.passed).length;
    const share = (n) => (scored.length ? r2((n / scored.length) * 100) : 0);
    return {
      count: rows.length,
      scored: scored.length,
      notGraded: rows.length - scored.length,
      incomplete: scored.filter((r) => r.entered < acts.length).length,
      average,
      averagePct: max ? r2((average / max) * 100) : 0,
      median: sorted.length ? (sorted.length % 2 ? sorted[mid] : r2((sorted[mid - 1] + sorted[mid]) / 2)) : 0,
      highest: sorted.length ? sorted[sorted.length - 1] : 0,
      lowest: sorted.length ? sorted[0] : 0,
      passMark, passPct,
      passed,
      failed: scored.length - passed,
      passRate: share(passed),
      failRate: share(scored.length - passed),
      levels: N.LEVELS.map((k) => {
        const n = scored.filter((r) => r.level === k).length;
        return { key: k, n, pct: share(n) };
      }),
      activities: acts.map((a, i) => {
        const vals = rows.map((r) => r.cells[i]).filter((v) => v !== '');
        const avg = vals.length ? r2(vals.reduce((x, y) => x + y, 0) / vals.length) : 0;
        // Same rule for one activity as for the whole subject: at least the pass mark's share of its marks.
        const pass = vals.filter((v) => v + 1e-9 >= (a.marks * passPct) / 100).length;
        return {
          name: a.name, marks: a.marks, entered: vals.length, average: avg,
          avgPct: a.marks ? r2((avg / a.marks) * 100) : 0,
          highest: vals.length ? Math.max.apply(null, vals) : 0,
          lowest: vals.length ? Math.min.apply(null, vals) : 0,
          passed: pass, failed: vals.length - pass,
          passRate: vals.length ? r2((pass / vals.length) * 100) : 0
        };
      })
    };
  }

  const dateOf = (d) => (d ? N.dateText(new Date(d + 'T00:00:00').getTime()) : '');

  /** One activity on its own: its cells (if split), the total, and pass/fail on that activity. */
  function buildActivityReport(cur, act) {
    const passPct = passPctOf(cur);
    const max = act.marks;
    const passMark = r2((max * passPct) / 100);
    const parts = Array.isArray(act.parts) ? act.parts : [];
    const acts = parts.map((p) => ({ id: p.id, name: p.label + (p.date ? ' — ' + dateOf(p.date) : ''), marks: p.max, date: p.date }));
    const cells = cur.partScores || new Map();
    const rows = cur.students.map((st, i) => {
      const line = parts.map((p) => {
        const v = cells.get(act.id + '|' + p.id + '|' + st.id);
        return v === undefined ? '' : v;
      });
      const saved = cur.scores.get(act.id + '|' + st.id);
      const total = saved === undefined ? 0 : saved;
      const entered = parts.length ? line.filter((v) => v !== '').length : (saved === undefined ? 0 : 1);
      const pct = max ? r2((total / max) * 100) : 0;
      return { order: i, st, cells: line, total, entered, pct, level: N.levelOf(pct), passed: saved !== undefined && total + 1e-9 >= passMark };
    });
    const done = finishRows(rows, { sort: 'roster' });
    return {
      acts, max, rows: done.rows, passMark, passPct, terms: 1, view: 1, isYear: false, ranked: done.ranked,
      activity: act, stats: computeStats(done.rows, acts, max, passMark, passPct)
    };
  }

  const pctText = (n) => fmt(n) + '%';

  function statsSection(rep, cur) {
    const s = rep.stats;
    if (!s.scored) return '<section class="block"><h2 class="h-sec">' + esc(t('statistics')) + '</h2>' +
      '<p class="notice">' + esc(t('noStatsYet')) + '</p></section>';

    const tiles = [
      ['statStudents', String(s.count), ''],
      ['statAverage', fmt(s.average), '/' + fmt(rep.max)],
      ['statMedian', fmt(s.median), ''],
      ['statHighest', fmt(s.highest), ''],
      ['statLowest', fmt(s.lowest), ''],
      ['statNotGraded', String(s.notGraded), '']
    ].map(([k, v, suffix]) => '<div class="stat"><dt>' + esc(t(k)) + '</dt><dd><b>' + esc(v) + '</b>' +
      (suffix ? '<span>' + esc(suffix) + '</span>' : '') + '</dd></div>').join('');

    const passFail = '<div class="pf">' +
      '<div class="pf-bar" role="img" aria-label="' + esc(t('passRate') + ' ' + pctText(s.passRate)) + '">' +
      '<i class="pf-pass" style="inline-size:' + s.passRate + '%"></i>' +
      '<i class="pf-fail" style="inline-size:' + s.failRate + '%"></i></div>' +
      '<div class="pf-nums">' +
      '<div class="pf-num pf-num--pass"><b>' + esc(pctText(s.passRate)) + '</b>' +
      '<span>' + esc(t('statPassed')) + ' — ' + esc(t('studentsCount', { n: s.passed })) + '</span></div>' +
      '<div class="pf-num pf-num--fail"><b>' + esc(pctText(s.failRate)) + '</b>' +
      '<span>' + esc(t('statFailed')) + ' — ' + esc(t('studentsCount', { n: s.failed })) + '</span></div></div>' +
      '<p class="muted small">' + esc(t('passMark')) + ': <b>' + esc(fmt(s.passMark)) + '</b> ' +
      esc(t('ofMarks', { n: fmt(rep.max) })) + ' (' + esc(pctText(s.passPct)) + ') · ' +
      esc(t('statAverage')) + ' ' + esc(pctText(s.averagePct)) + '</p></div>';

    const levels = '<ul class="levels">' + s.levels.map((l) =>
      '<li class="lv lv--' + l.key + '"><span>' + esc(t('level_' + l.key)) + '</span>' +
      '<span class="lv-bar"><i style="inline-size:' + l.pct + '%"></i></span>' +
      '<b>' + l.n + '</b></li>').join('') + '</ul>';

    const acts = s.activities.length
      ? '<div class="table-wrap" tabindex="0"><table class="gradebook"><thead><tr>' +
        '<th class="c-name">' + esc(t('activityName')) + '</th><th>' + esc(t('marks')) + '</th>' +
        '<th>' + esc(t('colEntered')) + '</th><th>' + esc(t('colAverage')) + '</th>' +
        '<th>' + esc(t('colPercent')) + '</th><th>' + esc(t('colPassRate')) + '</th><th>' + esc(t('statHighest')) + '</th><th>' + esc(t('statLowest')) + '</th></tr></thead><tbody>' +
        s.activities.map((a) => '<tr><td class="c-name">' + esc(a.name) + '</td><td>' + fmt(a.marks) + '</td>' +
          '<td>' + a.entered + '</td><td>' + fmt(a.average) + '</td><td>' + esc(pctText(a.avgPct)) + '</td>' +
          '<td class="' + (a.passRate < 50 ? 'is-low' : '') + '">' + esc(pctText(a.passRate)) + '</td>' +
          '<td>' + fmt(a.highest) + '</td><td>' + fmt(a.lowest) + '</td></tr>').join('') +
        '</tbody></table></div>'
      : '';

    const notes =
      (rep.partial ? '<p class="notice notice--soft">' + esc(t('reportActsNote', { a: rep.acts.length, b: rep.allCount, n: fmt(rep.max) })) + '</p>' : '') +
      (cur.subject.finalMode !== 'included' && Number(cur.subject.finalMarks) > 0
        ? '<p class="notice notice--soft">' + esc(t('statsNoteCoursework', { n: fmt(rep.max) })) + '</p>' : '') +
      (s.incomplete ? '<p class="notice notice--soft">' + esc(t('statsNoteIncomplete', { n: s.incomplete })) + '</p>' : '');

    return '<dl class="stats stats--6">' + tiles + '</dl>' +
      '<section class="block"><h2 class="h-sec">' + esc(t('passFail')) + '</h2>' + passFail + '</section>' +
      '<section class="block"><h2 class="h-sec">' + esc(t('levelsTitle')) + '</h2>' + levels + '</section>' +
      (acts ? '<section class="block"><h2 class="h-sec">' + esc(t('byActivity')) + '</h2>' + acts + '</section>' : '') +
      notes;
  }

  T.report = (cur) => {
    if (!cur.activities.length) {
      return '<div class="empty"><p>' + esc(t('needActivitiesFirst')) + '</p><button type="button" class="btn btn--primary" data-act="tab" data-tab="activities">' + esc(t('goToActivities')) + '</button></div>';
    }
    if (!cur.students.length) {
      return '<div class="empty"><p>' + esc(t('needStudentsFirst')) + '</p><button type="button" class="btn btn--primary" data-act="tab" data-tab="students">' + esc(t('goToStudents')) + '</button></div>';
    }
    const o = S.report;
    const rep = buildReport(cur, o);

    const viewBar = N.termsOf(cur.subject) === 2
      ? '<div class="seg seg--terms">' + [[1, 'term1'], [2, 'term2'], ['year', 'yearView']].map(([k, label]) =>
        '<button type="button" class="seg-btn' + (String(o.term) === String(k) ? ' is-on' : '') + '" data-act="reportTerm" data-term="' + k + '">' +
        esc(t(label)) + '</button>').join('') + '</div>'
      : '';

    const options = '<div class="report-opts">' +
      (rep.isYear ? '' : '<label class="check"><input type="checkbox" data-change="reportOpt" data-key="includeActivities"' + (o.includeActivities ? ' checked' : '') + '><span>' + esc(t('includeActivities')) + '</span></label>') +
      (rep.isYear ? '' : '<button type="button" class="btn btn--ghost btn--sm report-acts" data-act="pickReportActs">' + ICON.sheet +
        esc(rep.partial ? t('reportActsSome', { a: rep.acts.length, b: rep.allCount }) : t('reportActsAll')) + '</button>') +
      '<label class="check"><input type="checkbox" data-change="reportOpt" data-key="includeLevel"' + (o.includeLevel ? ' checked' : '') + '><span>' + esc(t('includeLevel')) + '</span></label>' +
      '<label class="select"><span>' + esc(t('sortBy')) + '</span><select data-change="reportOpt" data-key="sort">' +
      ['roster', 'name', 'total'].map((k) => '<option value="' + k + '"' + (o.sort === k ? ' selected' : '') + '>' + esc(t('sort' + k.charAt(0).toUpperCase() + k.slice(1))) + '</option>').join('') +
      '</select></label></div>';

    const exportsBlock = '<section class="block export"><h2 class="h-sec">' + esc(t('exportTitle')) + '</h2><div class="export-grid">' +
      '<button type="button" class="export-btn" data-act="exportExcel">' + ICON.sheet + '<span>' + esc(t('downloadExcel')) + '</span><small>.xlsx</small></button>' +
      '<button type="button" class="export-btn" data-act="exportWord">' + ICON.doc + '<span>' + esc(t('downloadWord')) + '</span><small>.docx</small></button>' +
      '<button type="button" class="export-btn" data-act="exportPrint">' + ICON.print + '<span>' + esc(t('print')) + '</span><small>PDF</small></button>' +
      '<button type="button" class="export-btn export-btn--wide" data-act="exportCards">' + ICON.doc + '<span>' + esc(t('printCards')) + '</span><small>' + esc(t('reportCardsHint')) + '</small></button>' +
      '</div></section>';

    const showActs = rep.isYear ? true : o.includeActivities;
    const head = '<tr><th class="c-idx">#</th><th class="c-name">' + esc(t('name')) + '</th>' +
      (showActs ? rep.acts.map((a) => '<th><span>' + esc(a.name) + '</span><small>' + fmt(a.marks) + '</small></th>').join('') : '') +
      '<th class="c-total"><span>' + esc(rep.isYear ? t('yearAverage') : t('total')) + '</span><small>' + fmt(rep.max) + '</small></th>' +
      (o.includeLevel ? '<th>%</th><th>' + esc(t('level')) + '</th>' : '') + '</tr>';
    const body = rep.rows.map((r) => '<tr><td class="c-idx">' + r.n + '</td><td class="c-name">' + esc(r.st.name) + '</td>' +
      (showActs ? r.cells.map((v) => '<td>' + (v === '' ? '<span class="blank">—</span>' : fmt(v)) + '</td>').join('') : '') +
      '<td class="c-total">' + fmt(r.total) + '</td>' +
      (o.includeLevel ? '<td>' + fmt(r.pct) + '</td><td class="lvl lvl--' + r.level + '">' + esc(t('level_' + r.level)) + '</td>' : '') +
      '</tr>').join('');

    return viewBar + options +
      '<section class="block"><h2 class="h-sec">' + esc(t('statistics')) + '</h2></section>' +
      statsSection(rep, cur) +
      exportsBlock +
      '<section class="block"><h2 class="h-sec">' + esc(t('gradebook')) + '</h2>' +
      '<div class="table-wrap" tabindex="0"><table class="gradebook"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></section>';
  };

  T.after.report = () => {
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
    idle(() => { X().loadScript(X().LIBS.excel).catch(() => {}); X().loadScript(X().LIBS.docx).catch(() => {}); });
  };

  ACTIONS.reportTerm = (el) => {
    const v = el.dataset.term;
    S.report.term = v === 'year' ? 'year' : Number(v);
    rerender();
  };

  ACTIONS.pickReportActs = () => {
    const cur = S.cur;
    const view = N.termsOf(cur.subject) === 2 && S.report.term === 2 ? 2 : 1;
    const all = cur.activities.filter((a) => N.termOf(a) === view);
    const pick = (S.report.pick && S.report.pick[cur.subject.id]) || null;
    const on = (id) => !pick || !pick.length || pick.indexOf(id) >= 0;
    openSheet({
      title: t('reportActivities'),
      body: '<form data-form="reportActs" class="stack">' +
        '<div class="btn-row btn-row--tight"><button type="button" class="btn btn--ghost btn--sm" data-act="reportActsAll">' + ICON.check + esc(t('reportActsAll')) + '</button></div>' +
        '<ul class="rows pick-list">' + all.map((a) =>
          '<li><label class="check check--row"><input type="checkbox" name="act" value="' + esc(a.id) + '"' + (on(a.id) ? ' checked' : '') + '>' +
          '<span>' + esc(a.name) + '</span><b>' + fmt(a.marks) + '</b></label></li>').join('') + '</ul>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('apply')) + '</button></div></form>'
    });
  };

  ACTIONS.reportActsAll = (el) => {
    el.closest('form').querySelectorAll('input[name="act"]').forEach((c) => { c.checked = true; });
  };

  FORMS.reportActs = (form) => {
    const ids = [...form.querySelectorAll('input[name="act"]')].filter((c) => c.checked).map((c) => c.value);
    if (!ids.length) return formError(form, t('chooseAtLeastOne'));
    const total = form.querySelectorAll('input[name="act"]').length;
    S.report.pick = S.report.pick || {};
    S.report.pick[S.cur.subject.id] = ids.length === total ? null : ids;
    closeSheetOf(form);
    rerender();
  };

  CHANGES.reportOpt = (el) => {
    S.report[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.value;
    rerender();
  };

  function exportMeta() {
    const s = S.cur.subject;
    const reg = window.NimreRegister ? window.NimreRegister.tally(S.cur) : null;
    return {
      t, lang: S.lang, rtl: N.isRTL(), sep: N.listSep(), subject: s,
      attendance: reg && reg.sessions.length ? { sessions: reg.sessions.length, per: reg.per } : null,
      university: (S.settings && S.settings.university) || '',
      teacherName: (S.settings && S.settings.teacherName) || '',
      dateText: N.dateText(Date.now()),
      opts: S.report
    };
  }

  async function runExport(btn, kind) {
    await busy(btn, async () => {
      const small = btn.querySelector('small');
      const old = small ? small.textContent : '';
      if (small) small.textContent = t('preparing');
      try {
        await X()[kind](buildReport(S.cur, S.report), exportMeta());
      } catch (e) {
        console.error(e);
        toast(t('err_EXPORT'), 'error');
      } finally {
        if (small) small.textContent = old;
      }
    });
  }

  ACTIONS.exportExcel = (btn) => runExport(btn, 'excel');
  ACTIONS.exportWord = (btn) => runExport(btn, 'word');
  ACTIONS.exportPrint = () => X().print(buildReport(S.cur, S.report), exportMeta());
  ACTIONS.exportCards = () => X().cards(buildReport(S.cur, S.report), exportMeta());

  /** Heading and options for a single-activity download. */
  function activityMeta(act) {
    const m = exportMeta();
    const when = !(act.parts && act.parts.length) && act.date ? ' (' + dateOf(act.date) + ')' : '';
    m.subject = Object.assign({}, m.subject, { name: m.subject.name + ' — ' + act.name + when });
    m.opts = { includeActivities: true, includeLevel: true, sort: 'roster' };
    m.attendance = null;
    return m;
  }

  ACTIONS.activityExport = (btn) => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === (btn.dataset.id || S.activityId));
    if (!act) return;
    const kind = btn.dataset.kind;
    const rep = buildActivityReport(cur, act);
    if (kind === 'print') return X().print(rep, activityMeta(act));
    return busy(btn, async () => {
      try {
        await X()[kind](rep, activityMeta(act));
      } catch (e) {
        console.error(e);
        toast(t('err_EXPORT'), 'error');
      }
    });
  };

  /** One card, from the student menu. */
  ACTIONS.studentCard = (el) => {
    const id = el.dataset.id;
    N.closeAllSheets();
    X().cards(buildReport(S.cur, S.report), exportMeta(), [id]);
  };

  window.NimreReport = { buildReport, buildActivityReport, computeStats, parseRoster, gradesMessage, dateOf };
})();

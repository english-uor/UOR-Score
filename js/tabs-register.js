/* Score-UOR — the attendance register: one lesson at a time, then a mark out of it. */
(() => {
  'use strict';
  const N = window.Nimre;
  const { S, t, esc, fmt, r2, api, errText, ICON, ACTIONS, FORMS, toast, openSheet, closeSheetOf, confirmBox, formError, busy } = N;
  const T = (window.NimreTabs = window.NimreTabs || { after: {} });
  const teacher = () => window.NimreTeacher;
  const rerender = () => teacher().renderSubject();
  const TERM = () => window.NimreTerms;

  const STATUSES = ['', 'a', 'l'];
  const STATUS_LABEL = { '': 'present', a: 'absent', l: 'late' };

  const today = () => {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };

  const termSessions = (cur) => (cur.sessions || []).filter((x) => N.termOf(x) === TERM().curTerm(cur));

  /** How many lessons each student missed; a late counts as half. */
  function tally(cur) {
    const sessions = termSessions(cur);
    const out = new Map();
    cur.students.forEach((st) => {
      let absent = 0;
      let late = 0;
      sessions.forEach((x) => {
        const status = cur.absences.get(x.id + '|' + st.id);
        if (status === 'a') absent++;
        else if (status === 'l') late++;
      });
      const missed = absent + late / 2;
      out.set(st.id, {
        absent, late,
        attended: r2(sessions.length - missed),
        pct: sessions.length ? r2(((sessions.length - missed) / sessions.length) * 100) : 100
      });
    });
    return { sessions, per: out };
  }

  function sessionCounts(cur, session) {
    let absent = 0;
    let late = 0;
    cur.students.forEach((st) => {
      const status = cur.absences.get(session.id + '|' + st.id);
      if (status === 'a') absent++;
      else if (status === 'l') late++;
    });
    return { absent, late };
  }

  // ═════════════ The tab ═════════════
  T.register = (cur) => {
    if (!cur.students.length) {
      return '<div class="empty"><p>' + esc(t('needStudentsFirst')) + '</p>' +
        '<button type="button" class="btn btn--primary" data-act="tab" data-tab="students">' + esc(t('goToStudents')) + '</button></div>';
    }
    const { sessions, per } = tally(cur);

    const head = '<div class="section-head"><h2 class="h-sec">' + esc(t('sessionsCount', { n: sessions.length })) + '</h2>' +
      '<button type="button" class="btn btn--primary btn--sm" data-act="newSession">' + ICON.plus + esc(t('newSession')) + '</button></div>';

    const list = sessions.length
      ? '<ul class="rows session-list">' + sessions.slice().reverse().map((x) => {
        const c = sessionCounts(cur, x);
        const clean = !c.absent && !c.late;
        return '<li class="session-row">' +
          '<button type="button" class="session-open" data-act="openSession" data-id="' + esc(x.id) + '">' +
          '<span class="session-date" dir="ltr">' + esc(N.dateText(new Date(x.date + 'T00:00:00').getTime())) + '</span>' +
          '<span class="session-facts' + (clean ? ' is-ok' : '') + '">' +
          (clean ? ICON.check + esc(t('allPresent'))
            : [c.absent ? c.absent + ' ' + t('absent') : '', c.late ? c.late + ' ' + t('late') : ''].filter(Boolean).join(' · ')) +
          '</span>' + ICON.edit + '</button></li>';
      }).join('') + '</ul>'
      : '<div class="empty empty--inline"><p>' + esc(t('emptySessions')) + '</p></div>';

    const summary = sessions.length
      ? '<section class="block"><h2 class="h-sec">' + esc(t('attendanceRate')) + '</h2>' +
        '<ol class="rows attend-list">' + cur.students.map((st, i) => {
          const a = per.get(st.id);
          return '<li class="attend-row' + (a.pct < 75 ? ' is-low' : '') + '">' +
            '<span class="idx">' + (i + 1) + '</span>' +
            '<span class="st-main"><strong>' + esc(st.name) + '</strong>' +
            '<small>' + esc(t('attendedOf', { a: fmt(a.attended), b: sessions.length })) +
            (a.absent ? ' · ' + esc(t('absentTimes', { n: a.absent })) : '') +
            (a.late ? ' · ' + esc(t('lateTimes', { n: a.late })) : '') + '</small></span>' +
            '<span class="attend-pct"><b>' + fmt(a.pct) + '%</b>' +
            '<i class="attend-bar"><i style="inline-size:' + a.pct + '%"></i></i></span></li>';
        }).join('') + '</ol></section>'
      : '';

    return TERM().termBar(cur) + head + list + summary;
  };

  // ═════════════ Adding a lesson ═════════════
  ACTIONS.newSession = () => {
    openSheet({
      title: t('newSession'),
      body: '<form data-form="session" class="stack">' +
        '<label class="field"><span>' + esc(t('sessionDate')) + '</span>' +
        '<input name="date" type="date" required dir="ltr" value="' + today() + '"></label>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('save')) + '</button></div></form>'
    });
  };

  FORMS.session = (form) => busy(form.querySelector('.btn--primary'), async () => {
    formError(form, '');
    const cur = S.cur;
    try {
      const res = await api('saveSession', {
        subjectId: cur.subject.id,
        session: { date: form.date.value, term: TERM().curTerm(cur) }
      });
      cur.sessions = res.sessions;
      closeSheetOf(form);
      rerender();
      openRegister(res.session.id);
    } catch (e) {
      formError(form, errText(e));
    }
  });

  // ═════════════ Taking the register ═════════════
  ACTIONS.openSession = (el) => openRegister(el.dataset.id);

  function openRegister(sessionId) {
    const cur = S.cur;
    const session = (cur.sessions || []).find((x) => x.id === sessionId);
    if (!session) return;
    openSheet({
      title: N.dateText(new Date(session.date + 'T00:00:00').getTime()),
      className: 'sheet-wrap--tall',
      body: '<form data-form="attendance" class="stack">' +
        '<input type="hidden" name="sessionId" value="' + esc(session.id) + '">' +
        '<div class="btn-row btn-row--tight">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-act="allPresent">' + ICON.check + esc(t('allPresent')) + '</button>' +
        '<button type="button" class="btn btn--danger-ghost btn--sm" data-act="deleteSession" data-id="' + esc(session.id) + '">' + ICON.trash + esc(t('deleteSession')) + '</button>' +
        '</div>' +
        '<ol class="rows mark-list">' + cur.students.map((st, i) => {
          const status = cur.absences.get(session.id + '|' + st.id) || '';
          return '<li class="mark-row">' +
            '<span class="idx">' + (i + 1) + '</span>' +
            '<span class="mark-name">' + esc(st.name) + '</span>' +
            '<span class="seg seg--mark">' + STATUSES.map((v) =>
              '<label class="seg-btn seg-btn--' + (v || 'p') + (status === v ? ' is-on' : '') + '">' +
              '<input type="radio" name="st_' + esc(st.id) + '" value="' + v + '"' + (status === v ? ' checked' : '') + ' data-change="markStatus">' +
              esc(t(STATUS_LABEL[v])) + '</label>').join('') + '</span></li>';
        }).join('') + '</ol>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('save')) + '</button></div></form>'
    });
  }

  N.CHANGES.markStatus = (el) => {
    el.closest('.seg').querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('is-on', b.contains(el) && el.checked));
  };

  ACTIONS.allPresent = (el) => {
    const form = el.closest('form');
    form.querySelectorAll('input[type="radio"][value=""]').forEach((r) => { r.checked = true; });
    form.querySelectorAll('.seg--mark .seg-btn').forEach((b) => b.classList.toggle('is-on', b.classList.contains('seg-btn--p')));
  };

  FORMS.attendance = (form) => busy(form.querySelector('.btn--primary'), async () => {
    const cur = S.cur;
    const sessionId = form.sessionId.value;
    const entries = cur.students.map((st) => {
      const field = form.elements['st_' + st.id];
      return { studentId: st.id, status: field ? field.value : '' };
    });
    try {
      const res = await api('saveAttendance', { subjectId: cur.subject.id, sessionId, entries });
      cur.absences = new Map();
      res.absences.forEach(([sess, stId, status]) => cur.absences.set(sess + '|' + stId, status));
      closeSheetOf(form);
      toast(t('saved'));
      rerender();
    } catch (e) {
      formError(form, errText(e));
    }
  });

  ACTIONS.deleteSession = async (el) => {
    const cur = S.cur;
    const session = (cur.sessions || []).find((x) => x.id === el.dataset.id);
    if (!session) return;
    const label = N.dateText(new Date(session.date + 'T00:00:00').getTime());
    if (!(await confirmBox(t('confirmDeleteSession', { date: label })))) return;
    try {
      const res = await api('deleteSession', { subjectId: cur.subject.id, sessionId: session.id });
      cur.sessions = res.sessions;
      cur.absences = new Map();
      res.absences.forEach(([sess, stId, status]) => cur.absences.set(sess + '|' + stId, status));
      N.closeAllSheets();
      toast(t('saved'));
      rerender();
    } catch (e) {
      teacher().handleError(e);
    }
  };

  window.NimreRegister = { tally, termSessions };
})();

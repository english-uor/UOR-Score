/* Nimre — subject tabs part 1: grading and distribution */
(() => {
  'use strict';
  const N = window.Nimre;
  const { S, t, esc, fmt, r2, api, errText, ICON, ACTIONS, FORMS, CHANGES, INPUTS, toast, openSheet, closeSheetOf, confirmBox, formError, busy } = N;
  const T = (window.NimreTabs = window.NimreTabs || { after: {} });
  const teacher = () => window.NimreTeacher;
  const rerender = () => teacher().renderSubject();

  const typeLabel = (type) => t('type_' + type);
  /** Which term the teacher is looking at; subjects with one term always answer 1. */
  const curTerm = (cur) => (N.termsOf(cur.subject) === 2 ? (S.term === 2 ? 2 : 1) : 1);
  const termActs = (cur) => cur.activities.filter((a) => N.termOf(a) === curTerm(cur));
  const used = (cur, exceptId) => r2(termActs(cur).filter((a) => a.id !== exceptId).reduce((sum, a) => sum + a.marks, 0));
  /** Marks left for coursework after the final exam is set aside — per term. */
  const budgetOf = (cur) => r2(100 - (Number(cur.subject.finalMarks) || 0));

  /** Term 1 / Term 2 switch, shown only when the subject has two terms. */
  function termBar(cur) {
    if (N.termsOf(cur.subject) !== 2) return '';
    const now = curTerm(cur);
    return '<div class="seg seg--terms">' + [1, 2].map((n) =>
      '<button type="button" class="seg-btn' + (now === n ? ' is-on' : '') + '" data-act="pickTerm" data-term="' + n + '">' +
      esc(t('term' + n)) + '</button>').join('') + '</div>';
  }

  ACTIONS.pickTerm = async (el) => {
    const n = Number(el.dataset.term);
    if (n === S.term) return;
    if (!(await N.guardDirty())) return;
    S.term = n;
    S.activityId = null;
    document.body.classList.remove('has-savebar');
    rerender();
  };

  /** Turns the register into an attendance mark: a late counts as half an absence. */
  function attendanceFrom(cur, marks) {
    const sessions = (cur.sessions || []).filter((x) => N.termOf(x) === curTerm(cur));
    if (!sessions.length) return null;
    const out = new Map();
    cur.students.forEach((st) => {
      let missed = 0;
      sessions.forEach((x) => {
        const status = cur.absences.get(x.id + '|' + st.id);
        if (status === 'a') missed += 1;
        else if (status === 'l') missed += 0.5;
      });
      out.set(st.id, r2((marks * (sessions.length - missed)) / sessions.length));
    });
    return { values: out, sessions: sessions.length };
  }
  window.NimreAttendanceMarks = attendanceFrom;

  function emptyBlock(message, tab, label) {
    return '<div class="empty"><p>' + esc(message) + '</p>' +
      '<button type="button" class="btn btn--primary" data-act="tab" data-tab="' + tab + '">' + esc(label) + '</button></div>';
  }

  // ═════════════ Grading ═════════════
  T.grades = (cur) => {
    if (!cur.activities.length) return emptyBlock(t('needActivitiesFirst'), 'activities', t('goToActivities'));
    if (!cur.students.length) return emptyBlock(t('needStudentsFirst'), 'students', t('goToStudents'));
    const mine = termActs(cur);
    if (!mine.length) return termBar(cur) + emptyBlock(t('needActivitiesFirst'), 'activities', t('goToActivities'));
    if (!S.activityId || !mine.some((a) => a.id === S.activityId)) S.activityId = mine[0].id;
    const act = mine.find((a) => a.id === S.activityId);
    const entered = cur.students.filter((st) => cur.scores.has(act.id + '|' + st.id)).length;

    const chips = '<div class="chips" role="tablist" aria-label="' + esc(t('chooseActivity')) + '">' +
      mine.map((a) => '<button type="button" role="tab" class="chip' + (a.id === act.id ? ' is-on' : '') + '" aria-selected="' + (a.id === act.id) + '" data-act="pickActivity" data-id="' + esc(a.id) + '">' +
        '<span>' + esc(a.name) + '</span><b>' + fmt(a.marks) + '</b></button>').join('') +
      '</div>';

    const rows = cur.students.map((st, i) => {
      const saved = cur.scores.get(act.id + '|' + st.id);
      const dirty = S.dirty.has(st.id);
      const value = dirty ? S.dirty.get(st.id) : saved === undefined ? '' : fmt(saved);
      const invalid = dirty && !validScore(value, act.marks);
      return '<li class="score-row" data-name="' + esc(st.name.toLowerCase()) + '">' +
        '<span class="idx">' + (i + 1) + '</span>' +
        '<label class="st-name" for="sc-' + esc(st.id) + '">' + esc(st.name) + '</label>' +
        '<span class="score-cell"><input id="sc-' + esc(st.id) + '" class="score-input' + (dirty ? ' is-dirty' : '') + (invalid ? ' is-invalid' : '') + '"' +
        ' type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" dir="ltr" maxlength="6"' +
        ' data-input="score" data-sid="' + esc(st.id) + '" value="' + esc(value) + '" aria-describedby="of-' + esc(act.id) + '">' +
        '<span class="of" aria-hidden="true">/' + fmt(act.marks) + '</span></span></li>';
    }).join('');

    const split = isSplit(act);
    const when = act.date ? ' <span class="sep-dot"></span> ' + esc(dateOf(act.date)) : '';
    const head = '<section class="act-head">' +
      '<div><h2 class="h-sec">' + esc(act.name) + '</h2>' +
      '<p class="muted" id="of-' + esc(act.id) + '">' + esc(t('outOf', { n: fmt(act.marks) })) + ' <span class="sep-dot"></span> ' +
      esc(t('enteredCount', { a: entered, b: cur.students.length })) + when + '</p></div>' +
      (split ? '<button type="button" class="btn btn--ghost btn--sm" data-act="editParts">' + ICON.edit + esc(t('editParts')) + '</button>' : '') +
      '</section>' +
      // Enter one total, or split the activity into dated cells that add up to it.
      '<div class="seg seg--mode" role="group" aria-label="' + esc(t('entryMode')) + '">' +
      '<button type="button" class="seg-btn' + (split ? '' : ' is-on') + '" data-act="modeOnce">' + esc(t('modeOnce')) + '</button>' +
      '<button type="button" class="seg-btn' + (split ? ' is-on' : '') + '" data-act="modeSplit">' + esc(t('modeSplit')) + '</button></div>';

    const tools = '<div class="tools">' +
      '<label class="search"><span class="sr-only">' + esc(t('searchStudents')) + '</span>' + ICON.search +
      '<input type="search" data-input="filterRows" data-target="' + (split ? '.parts-body' : '.score-list') + '" placeholder="' + esc(t('searchStudents')) + '"></label>' +
      (split ? '' : '<button type="button" class="btn btn--ghost btn--sm" data-act="fillEmpty">' + esc(t('fillEmpty')) + '</button>' +
        (act.type === 'attendance' ? '<button type="button" class="btn btn--ghost btn--sm" data-act="fillAttendance">' + esc(t('fillFromRegister')) + '</button>' : '')) +
      '</div>';

    const body = split ? partsGrid(cur, act) : '<ol class="rows score-list">' + rows + '</ol>';

    return termBar(cur) + chips + head + tools + body + activityResult(cur, act) +
      '<div class="savebar" id="savebar" hidden><span class="savebar-count"></span>' +
      '<button type="button" class="btn btn--ghost btn--sm" data-act="discardScores">' + esc(t('discard')) + '</button>' +
      '<button type="button" class="btn btn--primary" data-act="saveScores"></button></div>';
  };

  // ═════════════ Activities split into cells ═════════════
  const isSplit = (act) => !!(act && Array.isArray(act.parts) && act.parts.length);
  const dateOf = (d) => (d ? N.dateText(new Date(d + 'T00:00:00').getTime()) : '');
  const cellKey = (pid, sid) => pid + '|' + sid;

  /** The value a cell shows right now: what was typed, or else what was saved. */
  function cellValue(cur, act, pid, sid) {
    const k = cellKey(pid, sid);
    if (S.dirty.has(k)) return S.dirty.get(k);
    const saved = cur.partScores.get(act.id + '|' + pid + '|' + sid);
    return saved === undefined ? '' : fmt(saved);
  }

  /** Live total of one student's cells, scaled to the activity's marks. */
  function rowTotal(cur, act, sid) {
    const possible = act.parts.reduce((sum, p) => sum + p.max, 0);
    let got = 0;
    let any = false;
    act.parts.forEach((p) => {
      const v = cellValue(cur, act, p.id, sid);
      if (v === '' || !validScore(v, p.max)) return;
      got += Number(v);
      any = true;
    });
    return any && possible ? fmt(r2((got / possible) * act.marks)) : '—';
  }

  function partsGrid(cur, act) {
    const head = '<tr><th class="c-idx">#</th><th class="c-name">' + esc(t('name')) + '</th>' +
      act.parts.map((p) => '<th class="c-part"><span>' + esc(p.label) + '</span>' +
        (p.date ? '<small>' + esc(dateOf(p.date)) + '</small>' : '') + '<small>/' + fmt(p.max) + '</small></th>').join('') +
      '<th class="c-total"><span>' + esc(t('total')) + '</span><small>' + fmt(act.marks) + '</small></th></tr>';
    const body = cur.students.map((st, i) => '<tr data-name="' + esc(st.name.toLowerCase()) + '">' +
      '<td class="c-idx">' + (i + 1) + '</td><td class="c-name">' + esc(st.name) + '</td>' +
      act.parts.map((p, j) => {
        const k = cellKey(p.id, st.id);
        const dirty = S.dirty.has(k);
        const value = cellValue(cur, act, p.id, st.id);
        const invalid = dirty && !validScore(value, p.max);
        return '<td class="c-part"><input class="part-input' + (dirty ? ' is-dirty' : '') + (invalid ? ' is-invalid' : '') + '"' +
          ' type="text" inputmode="decimal" enterkeyhint="next" autocomplete="off" dir="ltr" maxlength="6"' +
          ' aria-label="' + esc(st.name + ' — ' + p.label) + '"' +
          ' data-input="partScore" data-pid="' + esc(p.id) + '" data-sid="' + esc(st.id) + '" data-row="' + i + '" data-col="' + j + '" value="' + esc(value) + '"></td>';
      }).join('') +
      '<td class="c-total" data-total="' + esc(st.id) + '">' + rowTotal(cur, act, st.id) + '</td></tr>').join('');
    return '<div class="table-wrap parts-wrap" tabindex="0"><table class="gradebook parts-grid"><thead>' + head +
      '</thead><tbody class="parts-body">' + body + '</tbody></table></div>';
  }

  INPUTS.partScore = (input) => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    const part = act.parts.find((p) => p.id === input.dataset.pid);
    const normalized = N.normDigits(input.value);
    if (normalized !== input.value) input.value = normalized;
    const sid = input.dataset.sid;
    const saved = cur.partScores.get(act.id + '|' + part.id + '|' + sid);
    const savedText = saved === undefined ? '' : fmt(saved);
    const same = normalized === savedText || (normalized !== '' && savedText !== '' && Number(normalized) === Number(savedText));
    const k = cellKey(part.id, sid);
    if (same) S.dirty.delete(k); else S.dirty.set(k, normalized);
    input.classList.toggle('is-dirty', !same);
    const invalid = !validScore(normalized, part.max);
    input.classList.toggle('is-invalid', invalid);
    input.setCustomValidity(invalid ? t('scoreTooHigh', { max: fmt(part.max) }) : '');
    const cell = document.querySelector('[data-total="' + sid + '"]');
    if (cell) cell.textContent = rowTotal(cur, act, sid);
    updateSavebar();
  };

  // Enter moves down the same column, like a spreadsheet.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList || !e.target.classList.contains('part-input')) return;
    e.preventDefault();
    const col = e.target.dataset.col;
    const inputs = [...document.querySelectorAll('.part-input[data-col="' + col + '"]')].filter((i) => !i.closest('tr').hidden);
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) { next.focus(); next.select(); } else { e.target.blur(); }
  });

  async function savePartCells(btn, cur, act) {
    const maxOf = new Map(act.parts.map((p) => [p.id, p.max]));
    const entries = [...S.dirty.entries()].map(([k, v]) => {
      const cut = k.indexOf('|');
      return { partId: k.slice(0, cut), studentId: k.slice(cut + 1), score: v };
    });
    if (entries.some((e) => !validScore(e.score, maxOf.get(e.partId)))) {
      toast(t('fixInvalid'), 'error');
      const first = document.querySelector('.part-input.is-invalid');
      if (first) first.focus();
      return;
    }
    try {
      const res = await api('savePartScores', { subjectId: cur.subject.id, activityId: act.id, entries });
      applyActivityData(cur, act.id, res);
      S.dirty.clear();
      document.body.classList.remove('has-savebar');
      toast(t('saved'));
      rerender();
    } catch (e) {
      teacher().handleError(e);
    }
  }

  /** Puts fresh cell scores and totals for one activity into the screen's data. */
  function applyActivityData(cur, aid, res) {
    if (res.partScores) {
      [...cur.partScores.keys()].forEach((k) => { if (k.indexOf(aid + '|') === 0) cur.partScores.delete(k); });
      res.partScores.forEach(([a, p, st, v]) => cur.partScores.set(a + '|' + p + '|' + st, Number(v)));
    }
    if (res.scores) {
      [...cur.scores.keys()].forEach((k) => { if (k.indexOf(aid + '|') === 0) cur.scores.delete(k); });
      res.scores.forEach(([a, st, v]) => cur.scores.set(a + '|' + st, Number(v)));
    }
    if (res.activity) {
      const i = cur.activities.findIndex((a) => a.id === aid);
      if (i >= 0) cur.activities[i] = res.activity;
    }
  }

  // ── choosing the mode, and setting up the cells ──
  ACTIONS.modeSplit = async () => {
    const act = S.cur.activities.find((a) => a.id === S.activityId);
    if (isSplit(act)) return;
    if (!(await N.guardDirty())) return;
    document.body.classList.remove('has-savebar');
    partsForm(act);
  };

  ACTIONS.modeOnce = async () => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    if (!isSplit(act)) return;
    if (!(await N.guardDirty())) return;
    if (!(await confirmBox(t('confirmStopSplit'), { ok: t('apply'), danger: false }))) return;
    try {
      const res = await api('saveParts', { subjectId: cur.subject.id, activityId: act.id, parts: null });
      applyActivityData(cur, act.id, res);
      document.body.classList.remove('has-savebar');
      toast(t('saved'));
      rerender();
    } catch (e) {
      teacher().handleError(e);
    }
  };

  ACTIONS.editParts = async () => {
    if (!(await N.guardDirty())) return;
    document.body.classList.remove('has-savebar');
    partsForm(S.cur.activities.find((a) => a.id === S.activityId));
  };

  function partRow(p, i) {
    return '<li class="part-setup" data-id="' + esc(p.id || '') + '">' +
      '<span class="idx">' + (i + 1) + '</span>' +
      '<label class="field field--compact"><span>' + esc(t('partLabel')) + '</span><input name="p_label" maxlength="40" value="' + esc(p.label) + '"></label>' +
      '<label class="field field--compact"><span>' + esc(t('partDate')) + '</span><input name="p_date" type="date" dir="ltr" value="' + esc(p.date || '') + '"></label>' +
      '<label class="field field--compact"><span>' + esc(t('partMax')) + '</span><input name="p_max" type="text" inputmode="decimal" dir="ltr" class="input-marks" value="' + esc(fmt(p.max)) + '"></label>' +
      '</li>';
  }

  const evenSplit = (marks, n) => r2(marks / n);

  function partsForm(act) {
    const list = isSplit(act)
      ? act.parts
      : Array.from({ length: 5 }, (_, i) => ({ id: '', label: t('partDefault', { n: i + 1 }), date: '', max: evenSplit(act.marks, 5) }));
    openSheet({
      title: t('partsTitle') + ' — ' + act.name,
      className: 'sheet-wrap--tall',
      body: '<form data-form="parts" class="stack">' +
        '<p class="muted small">' + esc(t('partsHint', { n: fmt(act.marks) })) + '</p>' +
        '<label class="field"><span>' + esc(t('partsCount')) + '</span>' +
        '<input name="count" type="text" inputmode="numeric" dir="ltr" class="input-marks" maxlength="2" value="' + list.length + '" data-input="partsCount"></label>' +
        '<ol class="rows parts-setup-list">' + list.map(partRow).join('') + '</ol>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('save')) + '</button></div></form>'
    });
  }

  /** Grows or shrinks the list of cells; untouched maximums stay an even split of the marks. */
  INPUTS.partsCount = (input) => {
    const n = Number(N.normDigits(input.value));
    if (!(n >= 1 && n <= 40)) return;
    const act = S.cur.activities.find((a) => a.id === S.activityId);
    const ol = input.closest('form').querySelector('.parts-setup-list');
    const now = [...ol.children].map((li) => ({
      id: li.dataset.id || '',
      label: li.querySelector('[name="p_label"]').value,
      date: li.querySelector('[name="p_date"]').value,
      max: Number(N.normDigits(li.querySelector('[name="p_max"]').value)) || 0
    }));
    if (n === now.length) return;
    const even = now.length && now.every((p) => Math.abs(p.max - evenSplit(act.marks, now.length)) < 0.011);
    const next = now.slice(0, n);
    while (next.length < n) {
      next.push({ id: '', label: t('partDefault', { n: next.length + 1 }), date: '', max: now.length ? now[now.length - 1].max : evenSplit(act.marks, n) });
    }
    if (even) next.forEach((p) => { p.max = evenSplit(act.marks, n); });
    ol.innerHTML = next.map(partRow).join('');
  };

  FORMS.parts = (form) => busy(form.querySelector('.btn--primary'), async () => {
    formError(form, '');
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    const parts = [...form.querySelectorAll('.part-setup')].map((li) => ({
      id: li.dataset.id || '',
      label: li.querySelector('[name="p_label"]').value,
      date: li.querySelector('[name="p_date"]').value,
      max: Number(N.normDigits(li.querySelector('[name="p_max"]').value))
    }));
    if (!parts.length || parts.some((p) => !(p.max > 0))) return formError(form, t('err_INVALID_PARTS'));
    // Removing a cell that already has scores needs a yes.
    const kept = new Set(parts.map((p) => p.id).filter(Boolean));
    const losing = isSplit(act) && act.parts.some((p) => !kept.has(p.id) &&
      [...cur.partScores.keys()].some((k) => k.indexOf(act.id + '|' + p.id + '|') === 0));
    if (losing && !(await confirmBox(t('confirmRemoveParts')))) return;
    try {
      const res = await api('saveParts', { subjectId: cur.subject.id, activityId: act.id, parts });
      applyActivityData(cur, act.id, res);
      closeSheetOf(form);
      toast(t('saved'));
      rerender();
    } catch (e) {
      if (!teacher().handleError(e, { silent: true })) formError(form, errText(e));
    }
  });

  // ═════════════ Result of one activity (every activity, split or not) ═════════════
  function activityResult(cur, act) {
    const R = window.NimreReport;
    if (!R || !R.buildActivityReport) return '';
    const rep = R.buildActivityReport(cur, act);
    const s = rep.stats;
    if (!s.scored) return '';
    const pc = (n) => fmt(n) + '%';
    return '<section class="block act-result"><h2 class="h-sec">' + esc(t('activityStats')) + '</h2>' +
      '<div class="pf">' +
      '<div class="pf-bar" role="img" aria-label="' + esc(t('passRate') + ' ' + pc(s.passRate)) + '">' +
      '<i class="pf-pass" style="inline-size:' + s.passRate + '%"></i><i class="pf-fail" style="inline-size:' + s.failRate + '%"></i></div>' +
      '<div class="pf-nums">' +
      '<div class="pf-num pf-num--pass"><b>' + esc(pc(s.passRate)) + '</b><span>' + esc(t('statPassed')) + ' — ' + esc(t('studentsCount', { n: s.passed })) + '</span></div>' +
      '<div class="pf-num pf-num--fail"><b>' + esc(pc(s.failRate)) + '</b><span>' + esc(t('statFailed')) + ' — ' + esc(t('studentsCount', { n: s.failed })) + '</span></div></div>' +
      '<p class="muted small">' + esc(t('passMark')) + ': <b>' + esc(fmt(s.passMark)) + '</b> ' + esc(t('ofMarks', { n: fmt(act.marks) })) +
      ' · ' + esc(t('statAverage')) + ' ' + esc(fmt(s.average)) + ' (' + esc(pc(s.averagePct)) + ')' +
      ' · ' + esc(t('statHighest')) + ' ' + esc(fmt(s.highest)) + ' · ' + esc(t('statLowest')) + ' ' + esc(fmt(s.lowest)) + '</p></div>' +
      '<h3 class="h-sub">' + esc(t('downloadActivity')) + '</h3>' +
      '<div class="export-grid">' +
      '<button type="button" class="export-btn" data-act="activityExport" data-kind="excel" data-id="' + esc(act.id) + '">' + ICON.sheet + '<span>' + esc(t('downloadExcel')) + '</span><small>.xlsx</small></button>' +
      '<button type="button" class="export-btn" data-act="activityExport" data-kind="word" data-id="' + esc(act.id) + '">' + ICON.doc + '<span>' + esc(t('downloadWord')) + '</span><small>.docx</small></button>' +
      '<button type="button" class="export-btn" data-act="activityExport" data-kind="print" data-id="' + esc(act.id) + '">' + ICON.print + '<span>' + esc(t('print')) + '</span><small>PDF</small></button>' +
      '</div></section>';
  }

  T.after.grades = () => updateSavebar();

  function validScore(value, max) {
    if (value === '') return true;
    if (!/^\d+(\.\d{1,2})?$/.test(value)) return false;
    const v = Number(value);
    return v >= 0 && v <= max + 1e-9;
  }

  INPUTS.score = (input) => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    const normalized = N.normDigits(input.value);
    if (normalized !== input.value) input.value = normalized;
    const sid = input.dataset.sid;
    const saved = cur.scores.get(act.id + '|' + sid);
    const savedText = saved === undefined ? '' : fmt(saved);
    const isSame = normalized === savedText || (normalized !== '' && savedText !== '' && Number(normalized) === Number(savedText));
    if (isSame) S.dirty.delete(sid); else S.dirty.set(sid, normalized);
    input.classList.toggle('is-dirty', !isSame);
    const invalid = !validScore(normalized, act.marks);
    input.classList.toggle('is-invalid', invalid);
    input.setCustomValidity(invalid ? t('scoreTooHigh', { max: fmt(act.marks) }) : '');
    updateSavebar();
  };

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList || !e.target.classList.contains('score-input')) return;
    e.preventDefault();
    const inputs = [...document.querySelectorAll('.score-input')].filter((i) => !i.closest('.score-row').hidden);
    const next = inputs[inputs.indexOf(e.target) + 1];
    if (next) { next.focus(); next.select(); } else { e.target.blur(); }
  });

  function updateSavebar() {
    const bar = document.getElementById('savebar');
    if (!bar) return;
    const n = S.dirty.size;
    bar.hidden = n === 0;
    document.body.classList.toggle('has-savebar', n > 0);
    bar.querySelector('[data-act="saveScores"]').textContent = t('saveChanges', { n });
  }

  INPUTS.filterRows = (input) => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(input.dataset.target + ' > li, ' + input.dataset.target + ' > tr').forEach((li) => {
      li.hidden = !!q && (li.dataset.name || '').indexOf(q) < 0;
    });
  };

  ACTIONS.pickActivity = async (el) => {
    if (el.dataset.id === S.activityId) return;
    if (!(await N.guardDirty())) return;
    S.activityId = el.dataset.id;
    document.body.classList.remove('has-savebar');
    rerender();
  };

  ACTIONS.discardScores = () => {
    S.dirty.clear();
    document.body.classList.remove('has-savebar');
    rerender();
  };

  ACTIONS.saveScores = (btn) => busy(btn, async () => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    if (isSplit(act)) return savePartCells(btn, cur, act);
    const entries = [...S.dirty.entries()];
    const bad = entries.filter(([, v]) => !validScore(v, act.marks));
    if (bad.length) {
      toast(t('fixInvalid'), 'error');
      const first = document.querySelector('.score-input.is-invalid');
      if (first) first.focus();
      return;
    }
    try {
      const res = await api('saveScores', {
        subjectId: cur.subject.id, activityId: act.id,
        scores: entries.map(([studentId, score]) => ({ studentId, score }))
      });
      [...cur.scores.keys()].forEach((k) => { if (k.indexOf(act.id + '|') === 0) cur.scores.delete(k); });
      res.scores.forEach(([a, s, v]) => cur.scores.set(a + '|' + s, Number(v)));
      S.dirty.clear();
      document.body.classList.remove('has-savebar');
      toast(t('saved'));
      rerender();
    } catch (e) {
      teacher().handleError(e);
    }
  });

  ACTIONS.fillAttendance = () => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    const result = attendanceFrom(cur, act.marks);
    if (!result) return toast(t('needSessions'), 'error');
    openSheet({
      title: t('fillFromRegister'),
      body: '<p class="muted">' + esc(t('fillFromRegisterHint')) + '</p>' +
        '<p class="muted small">' + esc(t('sessionsCount', { n: result.sessions })) + '</p>' +
        '<ol class="rows import-preview">' + cur.students.map((st) =>
          '<li><strong>' + esc(st.name) + '</strong><small dir="ltr">' + fmt(result.values.get(st.id)) + ' / ' + fmt(act.marks) + '</small></li>').join('') + '</ol>' +
        '<div class="sheet-actions"><button type="button" class="btn btn--primary" data-act="applyAttendance">' + esc(t('apply')) + '</button></div>'
    });
  };

  ACTIONS.applyAttendance = (el) => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    const result = attendanceFrom(cur, act.marks);
    if (!result) return;
    let n = 0;
    cur.students.forEach((st) => {
      const value = fmt(result.values.get(st.id));
      const saved = cur.scores.get(act.id + '|' + st.id);
      if (saved !== undefined && Number(saved) === Number(value)) { S.dirty.delete(st.id); return; }
      S.dirty.set(st.id, value);
      n++;
    });
    N.closeAllSheets();
    toast(t('attendanceFilled', { n }));
    rerender();
  };

  ACTIONS.fillEmpty = () => {
    const act = S.cur.activities.find((a) => a.id === S.activityId);
    openSheet({
      title: t('fillEmpty'),
      body: '<form data-form="fillEmpty" class="stack"><p class="muted">' + esc(t('fillEmptyHint')) + '</p>' +
        '<label class="field"><span>' + esc(act.name) + ' (' + esc(t('outOf', { n: fmt(act.marks) })) + ')</span>' +
        '<input name="value" type="text" inputmode="decimal" required dir="ltr" value="' + fmt(act.marks) + '"></label>' +
        '<button class="btn btn--primary">' + esc(t('apply')) + '</button></form>'
    });
  };

  FORMS.fillEmpty = (form) => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === S.activityId);
    const value = N.normDigits(form.value.value);
    if (!validScore(value, act.marks) || value === '') return formError(form, t('scoreTooHigh', { max: fmt(act.marks) }));
    cur.students.forEach((st) => {
      if (!cur.scores.has(act.id + '|' + st.id) && !(S.dirty.has(st.id) && S.dirty.get(st.id) !== '')) S.dirty.set(st.id, value);
    });
    closeSheetOf(form);
    rerender();
  };

  // ═════════════ Distribution ═════════════
  T.activities = (cur) => {
    const mine = termActs(cur);
    const budget = budgetOf(cur);
    const total = used(cur);
    const remaining = r2(budget - total);
    const bar = '<div class="dist-bar" role="img" aria-label="' + esc(t('distributed') + ' ' + fmt(total) + '/100') + '">' +
      mine.map((a) => '<i style="flex:' + a.marks + ';background:' + N.TYPE_COLORS[a.type] + '" title="' + esc(a.name + ': ' + fmt(a.marks)) + '"></i>').join('') +
      (remaining > 0 ? '<i class="dist-empty" style="flex:' + remaining + '"></i>' : '') + '</div>';

    const list = mine.length
      ? '<ul class="rows act-list">' + mine.map((a) =>
        '<li class="act-row">' +
        '<button type="button" class="act-open" data-act="editActivity" data-id="' + esc(a.id) + '">' +
        '<i class="swatch" style="background:' + N.TYPE_COLORS[a.type] + '"></i>' +
        '<span class="act-name"><strong>' + esc(a.name) + '</strong>' + (a.name.indexOf(typeLabel(a.type)) === 0 ? '' : '<small>' + esc(typeLabel(a.type)) + '</small>') + '</span>' +
        '<span class="act-marks">' + fmt(a.marks) + '</span>' + ICON.edit + '</button></li>').join('') + '</ul>'
      : '<div class="empty empty--inline"><p>' + esc(t('emptyActivities')) + '</p></div>';

    const selfMarked = cur.subject.finalMode === 'included';
    const finalCard = '<section class="final-card' + (selfMarked ? ' final-card--self' : '') + '">' +
      '<div><h2 class="h-sec">' + esc(t('finalExam')) + '</h2>' +
      '<p class="muted small">' + esc(selfMarked ? t('finalIncludedNote') : t('finalExamNote')) + '</p></div>' +
      (selfMarked ? '' : '<p class="final-num">' + fmt(Number(cur.subject.finalMarks) || 0) + '</p>') +
      '<button type="button" class="btn btn--ghost btn--sm" data-act="editSubject">' + ICON.edit + esc(t('change')) + '</button></section>';

    return termBar(cur) + finalCard +
      '<section class="dist">' +
      '<div class="dist-head"><h2 class="h-sec">' + esc(t('distribution')) + '</h2>' +
      '<p class="dist-num"><b>' + fmt(total) + '</b><span>/' + fmt(budget) + '</span></p></div>' + bar +
      '<p class="dist-note' + (remaining <= 0 ? ' is-full' : '') + '">' +
      (remaining > 0 ? esc(t('remaining')) + ': <b>' + fmt(remaining) + '</b>' : ICON.check + esc(t('fullyDistributed'))) + '</p></section>' +
      list +
      '<div class="btn-row">' +
      (remaining > 0 ? '<button type="button" class="btn btn--primary" data-act="addActivity">' + ICON.plus + esc(t('addActivity')) + '</button>' : '') +
      (remaining > 0 ? '<button type="button" class="btn btn--ghost" data-act="copyPlan">' + ICON.copy + esc(t('copyPlan')) + '</button>' : '') +
      '</div>';
  };

  function autoName(cur, type, exceptId) {
    const base = typeLabel(type);
    if (type === 'midterm') return base;
    const same = termActs(cur).filter((a) => a.type === type && a.id !== exceptId).length;
    return same ? base + ' ' + (same + 1) : base;
  }

  function activityForm(act) {
    const cur = S.cur;
    const remaining = r2(budgetOf(cur) - used(cur, act && act.id));
    const type = act ? act.type : (termActs(cur).some((a) => a.type === 'midterm') ? 'quiz' : 'midterm');
    const marks = act ? fmt(act.marks) : '';
    const quick = [5, 10, 15, 20, 25, 30].filter((n) => n <= remaining);
    openSheet({
      title: act ? t('editActivity') : t('addActivity'),
      body: '<form data-form="activity" class="stack">' +
        '<input type="hidden" name="id" value="' + esc(act ? act.id : '') + '">' +
        '<input type="hidden" name="term" value="' + (act ? N.termOf(act) : curTerm(cur)) + '">' +
        '<label class="field"><span>' + esc(t('activityType')) + '</span>' +
        '<select name="type" class="select-field" data-change="activityType">' +
        N.TYPES.map((k) => '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' + esc(typeLabel(k)) + '</option>').join('') +
        '</select></label>' +
        '<label class="field"><span>' + esc(t('activityName')) + '</span><input name="name" required maxlength="80" value="' + esc(act ? act.name : autoName(cur, type)) + '" data-auto="' + (act ? '0' : '1') + '" data-input="markManual"></label>' +
        '<label class="field"><span>' + esc(t('marks')) + '</span><input name="marks" required type="text" inputmode="decimal" dir="ltr" value="' + marks + '" class="input-marks">' +
        '<small class="field-hint">' + esc(t('marksHint', { n: fmt(remaining) })) + '</small></label>' +
        '<label class="field"><span>' + esc(t('activityDate')) + '</span><input name="date" type="date" dir="ltr" value="' + esc(act && act.date ? act.date : '') + '"></label>' +
        '<div class="quick">' + quick.map((n) => '<button type="button" class="chip chip--sm" data-act="quickMarks" data-v="' + n + '">' + n + '</button>').join('') +
        (remaining > 0 && quick.indexOf(remaining) < 0 ? '<button type="button" class="chip chip--sm" data-act="quickMarks" data-v="' + remaining + '">' + esc(t('useRemaining', { n: fmt(remaining) })) + '</button>' : '') + '</div>' +
        '<div class="sheet-actions"><button class="btn btn--primary">' + esc(t('save')) + '</button>' +
        (act ? '<button type="button" class="btn btn--danger-ghost" data-act="deleteActivity" data-id="' + esc(act.id) + '">' + ICON.trash + esc(t('deleteActivity')) + '</button>' : '') +
        '</div></form>'
    });
  }

  ACTIONS.addActivity = () => activityForm(null);
  ACTIONS.editActivity = (el) => activityForm(S.cur.activities.find((a) => a.id === el.dataset.id));
  ACTIONS.quickMarks = (el) => { const f = el.closest('form'); f.marks.value = el.dataset.v; };
  INPUTS.markManual = (el) => { el.dataset.auto = '0'; };

  CHANGES.activityType = (select) => {
    const form = select.closest('form');
    if (form.name.dataset.auto === '1') form.name.value = autoName(S.cur, select.value, form.id.value);
  };

  FORMS.activity = (form) => busy(form.querySelector('.btn--primary'), async () => {
    formError(form, '');
    const cur = S.cur;
    const id = form.id.value;
    const marks = Number(N.normDigits(form.marks.value));
    const remaining = r2(budgetOf(cur) - used(cur, id));
    if (!(marks > 0) || marks > 100) return formError(form, t('err_INVALID_MARKS'));
    if (marks > remaining + 1e-9) return formError(form, t('err_OVER_BUDGET', { remaining: fmt(remaining) }));
    const activity = { id, name: form.name.value, marks, type: form.type.value || 'other', term: Number(form.term.value) || 1, date: form.date.value };
    try {
      const res = await api('saveActivity', { subjectId: cur.subject.id, activity });
      const i = cur.activities.findIndex((a) => a.id === res.activity.id);
      if (i >= 0) cur.activities[i] = res.activity; else cur.activities.push(res.activity);
      // A split activity's totals are rescaled when its marks change.
      if (res.scores) applyActivityData(cur, res.activity.id, { scores: res.scores });
      if (!id) S.activityId = res.activity.id;
      closeSheetOf(form);
      toast(t('saved'));
      rerender();
    } catch (e) {
      if (!teacher().handleError(e, { silent: true })) formError(form, errText(e));
    }
  });

  ACTIONS.deleteActivity = async (el) => {
    const cur = S.cur;
    const act = cur.activities.find((a) => a.id === el.dataset.id);
    if (!act || !(await confirmBox(t('confirmDeleteActivity', { name: act.name })))) return;
    try {
      await api('deleteActivity', { subjectId: cur.subject.id, activityId: act.id });
      cur.activities = cur.activities.filter((a) => a.id !== act.id);
      [...cur.scores.keys()].forEach((k) => { if (k.indexOf(act.id + '|') === 0) cur.scores.delete(k); });
      [...cur.partScores.keys()].forEach((k) => { if (k.indexOf(act.id + '|') === 0) cur.partScores.delete(k); });
      if (S.activityId === act.id) { S.activityId = null; S.dirty.clear(); }
      N.closeAllSheets();
      toast(t('saved'));
      rerender();
    } catch (e) {
      teacher().handleError(e);
    }
  };

  ACTIONS.copyPlan = async (btn) => {
    await busy(btn, async () => {
      try {
        if (!S.subjects) {
          const d = await api('bootstrap', {});
          S.subjects = d.subjects;
        }
      } catch (e) {
        return teacher().handleError(e);
      }
      const others = S.subjects.filter((s) => s.id !== S.cur.subject.id && s.activityCount > 0);
      openSheet({
        title: t('copyPlan'),
        body: others.length
          ? '<p class="muted">' + esc(t('copyPlanHint')) + '</p><ul class="rows pick-list">' + others.map((s) =>
            '<li><button type="button" class="pick-row" data-act="copyPlanFrom" data-id="' + esc(s.id) + '" style="--tab:' + esc(s.color) + '">' +
            '<span><strong>' + esc(s.name) + '</strong><small>' + esc([s.department, s.stage].filter(Boolean).join(N.listSep())) + '</small></span>' +
            '<span class="pick-meta">' + esc(t('activitiesCount', { n: s.activityCount })) + ' <b>' + fmt(s.distributed) + '</b></span></button></li>').join('') + '</ul>'
          : '<p class="muted">' + esc(t('noOtherPlans')) + '</p>'
      });
    });
  };

  ACTIONS.copyPlanFrom = (el) => busy(el, async () => {
    try {
      const res = await api('copyActivities', { fromSubjectId: el.dataset.id, toSubjectId: S.cur.subject.id });
      S.cur.activities = res.activities;
      N.closeAllSheets();
      toast(t('saved'));
      rerender();
    } catch (e) {
      teacher().handleError(e);
    }
  });
  window.NimreTerms = { curTerm, termActs, termBar };
})();

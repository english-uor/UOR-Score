/* Score-UOR — all data lives on this device (IndexedDB). No server, no setup, no internet. */
(() => {
  'use strict';
  const N = window.Nimre;
  const { ApiError, TYPES } = N;

  const DB_NAME = 'nimre';
  const STORE = 'kv';
  const KEY = 'db';
  const MAX_MARKS = 100;

  const blank = () => ({
    version: 1,
    settings: { teacherName: '', university: '' },
    subjects: [],
    students: [],
    activities: [],
    scores: [],
    sessions: [],
    absences: [],
    partScores: [],
    files: [],
    meta: { setupAt: 0, lastBackupAt: 0 }
  });

  let idbPromise = null;
  let data = null;
  let queue = Promise.resolve();

  // ───────────── Storage ─────────────
  function idb() {
    if (!idbPromise) {
      idbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return idbPromise;
  }

  function normalize(raw) {
    const d = Object.assign(blank(), raw || {});
    d.settings = Object.assign(blank().settings, d.settings);
    d.meta = Object.assign(blank().meta, d.meta);
    ['subjects', 'students', 'activities', 'scores', 'sessions', 'absences', 'partScores', 'files'].forEach((k) => { if (!Array.isArray(d[k])) d[k] = []; });
    return d;
  }

  async function load() {
    if (data) return data;
    const db = await idb();
    const stored = await new Promise((resolve, reject) => {
      const q = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      q.onsuccess = () => resolve(q.result || null);
      q.onerror = () => reject(q.error);
    });
    data = normalize(stored);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }
    return data;
  }

  async function persist() {
    const db = await idb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(data, KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (e) {
      data = null; // reload the last saved copy next time
      throw new ApiError('SAVE_FAILED');
    }
  }

  /** Runs one action at a time so saves never overlap. */
  function serial(fn) {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  }

  // ───────────── Helpers ─────────────
  const fail = (code, extra) => { throw new ApiError(code, extra); };
  const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const byOrder = (a, b) => a.order - b.order;
  const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/^[=+@\s]+/, '').replace(/\s+/g, ' ').trim().slice(0, max || 200);
  const normId = (v) => String(v || '').trim().toUpperCase();
  const normEmail = (v) => String(v || '').trim().toLowerCase();
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  const copy = (o) => JSON.parse(JSON.stringify(o));

  function rand(len) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(len));
    let out = '';
    for (let i = 0; i < len; i++) out += chars.charAt(bytes[i] % chars.length);
    return out;
  }
  function newToken() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') + rand(8);
  }
  function uniqueCode() {
    let code;
    do { code = rand(6); } while (data.subjects.some((s) => s.id === code));
    return code;
  }
  function findSubject(id) {
    const s = data.subjects.find((x) => x.id === normId(id));
    if (!s) fail('SUBJECT_NOT_FOUND');
    return s;
  }
  function touch() { /* nothing to publish: the data never leaves the phone */ }

  const MAX_PARTS = 40;
  const myPartScores = (aid) => data.partScores.filter((r) => r.activityId === aid).map((r) => [r.activityId, r.partId, r.studentId, r.score]);
  const myScores = (aid) => data.scores.filter((r) => r.activityId === aid).map((r) => [r.activityId, r.studentId, r.score]);

  /**
   * A split activity's mark comes from its cells: everything entered, over everything possible,
   * scaled to the activity's marks. An empty cell counts as 0 once the student has any cell.
   */
  function recomputeParts(act) {
    if (!Array.isArray(act.parts) || !act.parts.length) return;
    const possible = act.parts.reduce((sum, p) => sum + p.max, 0);
    const got = new Map();
    data.partScores.forEach((r) => {
      if (r.activityId !== act.id) return;
      got.set(r.studentId, (got.get(r.studentId) || 0) + r.score);
    });
    const now = Date.now();
    data.scores = data.scores.filter((r) => r.activityId !== act.id || got.has(r.studentId));
    const index = new Map();
    data.scores.forEach((r, i) => { if (r.activityId === act.id) index.set(r.studentId, i); });
    got.forEach((sum, stId) => {
      const v = possible ? r2((sum / possible) * act.marks) : 0;
      const i = index.get(stId);
      if (i !== undefined) { data.scores[i].score = v; data.scores[i].updatedAt = now; }
      else data.scores.push({ subjectId: act.subjectId, activityId: act.id, studentId: stId, score: v, updatedAt: now });
    });
  }
  const sessionIds = (sid) => new Set(data.sessions.filter((r) => r.subjectId === sid).map((r) => r.id));
  const mySessions = (sid) => copy(data.sessions.filter((r) => r.subjectId === sid).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)));
  const myAbsences = (sid) => {
    const ids = sessionIds(sid);
    return data.absences.filter((r) => ids.has(r.sessionId)).map((r) => [r.sessionId, r.studentId, r.status]);
  };
  function settingsOut() {
    return { teacherName: data.settings.teacherName, university: data.settings.university };
  }
  function onlineInfo() {
    return { lastBackupAt: data.meta.lastBackupAt || 0 };
  }
  /** Marks the final exam keeps out of the distribution; the rest is the coursework budget (per term). */
  function budgetOf(subject) { return r2(MAX_MARKS - (Number(subject.finalMarks) || 0)); }
  const termsOf = (subject) => (Number(subject.terms) === 2 ? 2 : 1);
  const termOf = (row) => (Number(row.term) === 2 ? 2 : 1);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(new Date(v).getTime());

  // ───────────── Local actions (same shape as the Apps Script API) ─────────────
  const LOCAL = {
    status: () => ({ initialized: !!data.meta.setupAt }),

    setup(req) {
      data.settings.teacherName = clean(req.teacherName, 80);
      data.settings.university = clean(req.university, 120);
      if (!data.meta.setupAt) data.meta.setupAt = Date.now();
      return { settings: settingsOut(), __save: true };
    },

    bootstrap() {
      const subjects = data.subjects.map((s) => {
        const acts = data.activities.filter((a) => a.subjectId === s.id);
        return Object.assign(copy(s), {
          studentCount: data.students.filter((x) => x.subjectId === s.id).length,
          activityCount: acts.length,
          releasedCount: acts.filter((a) => a.released).length,
          distributed: r2(acts.reduce((sum, a) => sum + a.marks, 0))
        });
      });
      return { settings: settingsOut(), subjects, mailQuota: null, online: onlineInfo() };
    },

    saveSettings(req) {
      const s = req.settings || {};
      if ('teacherName' in s) data.settings.teacherName = clean(s.teacherName, 80);
      if ('university' in s) data.settings.university = clean(s.university, 120);
      return { settings: settingsOut(), __save: true };
    },

    saveSubject(req) {
      const s = req.subject || {};
      const name = clean(s.name, 120);
      if (!name) fail('NAME_REQUIRED');
      const now = Date.now();
      let row;
      if (s.id) {
        row = data.subjects.find((r) => r.id === normId(s.id));
        if (!row) fail('NOT_FOUND');
      } else {
        row = { id: uniqueCode(), createdAt: now };
        data.subjects.push(row);
      }
      // 'included' = a school teacher who enters the final exam himself, as an ordinary activity.
      const finalMode = s.finalMode === 'included' ? 'included' : (s.finalMode === 'reserved' ? 'reserved' : (row.finalMode || 'reserved'));
      let finalMarks = s.finalMarks === undefined || s.finalMarks === '' ? (row.finalMarks === undefined ? 50 : row.finalMarks) : r2(Number(s.finalMarks));
      if (finalMode === 'included') finalMarks = 0;
      if (!(finalMarks >= 0 && finalMarks <= 100)) fail('INVALID_FINAL');
      const passPct = s.passPct === undefined || s.passPct === '' ? (row.passPct === undefined ? 50 : row.passPct) : r2(Number(s.passPct));
      if (!(passPct >= 0 && passPct <= 100)) fail('INVALID_PASS');
      const terms = s.terms === undefined || s.terms === '' ? termsOf(row) : (Number(s.terms) === 2 ? 2 : 1);
      const perTerm = [1, 2].map((tn) => data.activities.filter((a) => a.subjectId === row.id && termOf(a) === tn).reduce((sum, a) => sum + a.marks, 0));
      const used = Math.max(perTerm[0], terms === 2 ? perTerm[1] : 0);
      if (used > MAX_MARKS - finalMarks + 1e-9) fail('FINAL_TOO_HIGH', { max: r2(MAX_MARKS - used) });
      // Dropping the second term would orphan its activities, so move them back to term 1.
      if (terms === 1) data.activities.forEach((a) => { if (a.subjectId === row.id) a.term = 1; });
      Object.assign(row, {
        name,
        finalMarks,
        finalMode,
        passPct,
        terms,
        department: clean(s.department, 80),
        stage: clean(s.stage, 40),
        year: clean(s.year, 20),
        semester: clean(s.semester, 20),
        color: /^#[0-9a-f]{6}$/i.test(String(s.color)) ? String(s.color) : '#1E7A5A',
        updatedAt: now
      });
      touch(row.id);
      return { subject: copy(row), __save: true };
    },

    deleteSubject(req) {
      const sid = normId(req.subjectId);
      findSubject(sid);
      data.subjects = data.subjects.filter((r) => r.id !== sid);
      data.students = data.students.filter((r) => r.subjectId !== sid);
      data.activities = data.activities.filter((r) => r.subjectId !== sid);
      data.scores = data.scores.filter((r) => r.subjectId !== sid);
      data.partScores = data.partScores.filter((r) => r.subjectId !== sid);
      data.files.filter((r) => r.subjectId === sid).forEach((r) => { orphanFiles.push(r.id); });
      data.files = data.files.filter((r) => r.subjectId !== sid);
      const gone = new Set(data.sessions.filter((r) => r.subjectId === sid).map((r) => r.id));
      data.sessions = data.sessions.filter((r) => r.subjectId !== sid);
      data.absences = data.absences.filter((r) => !gone.has(r.sessionId));
      return { deleted: sid, __save: true };
    },

    getSubject(req) {
      const subject = findSubject(req.subjectId);
      const sid = subject.id;
      return {
        subject: copy(subject),
        students: copy(data.students.filter((r) => r.subjectId === sid).sort(byOrder)),
        activities: copy(data.activities.filter((r) => r.subjectId === sid).sort(byOrder)),
        scores: data.scores.filter((r) => r.subjectId === sid).map((r) => [r.activityId, r.studentId, r.score]),
        partScores: data.partScores.filter((r) => r.subjectId === sid).map((r) => [r.activityId, r.partId, r.studentId, r.score]),
        files: copy(data.files.filter((r) => r.subjectId === sid)),
        sessions: copy(data.sessions.filter((r) => r.subjectId === sid).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))),
        absences: data.absences.filter((r) => sessionIds(sid).has(r.sessionId)).map((r) => [r.sessionId, r.studentId, r.status]),
        settings: settingsOut(),
        mailQuota: null,
        online: onlineInfo(sid)
      };
    },

    saveStudents(req) {
      const sid = normId(req.subjectId);
      findSubject(sid);
      const input = Array.isArray(req.students) ? req.students : [];
      if (input.length > 3000) fail('TOO_MANY_ROWS');
      const mine = data.students.filter((r) => r.subjectId === sid);
      let maxOrder = mine.reduce((m, r) => Math.max(m, r.order), 0);
      let added = 0, updated = 0;
      const rejected = [];
      input.forEach((x, i) => {
        const name = clean(x.name, 120);
        const email = normEmail(x.email);
        if (!name || (email && !validEmail(email))) { rejected.push(i); return; }
        let row = null;
        if (x.id) {
          row = mine.find((r) => r.id === String(x.id));
          if (!row) { rejected.push(i); return; }
        } else if (email) {
          row = mine.find((r) => r.email === email);
        }
        if (row) {
          if (email && mine.some((r) => r !== row && r.email === email)) { rejected.push(i); return; }
          row.name = name;
          row.email = email;
          if (!row.token) row.token = newToken();
          updated++;
        } else {
          row = { id: 'T' + rand(10), subjectId: sid, name, email, order: ++maxOrder, createdAt: Date.now(), emailedAt: 0 };
          data.students.push(row);
          mine.push(row);
          added++;
        }
      });
      touch(sid);
      return { added, updated, rejected, students: copy(mine.sort(byOrder)), __save: true };
    },

    deleteStudent(req) {
      const sid = normId(req.subjectId);
      const stId = String(req.studentId || '');
      if (!data.students.some((r) => r.subjectId === sid && r.id === stId)) fail('NOT_FOUND');
      data.students = data.students.filter((r) => !(r.subjectId === sid && r.id === stId));
      data.scores = data.scores.filter((r) => !(r.subjectId === sid && r.studentId === stId));
      data.partScores = data.partScores.filter((r) => !(r.subjectId === sid && r.studentId === stId));
      const mySessions = sessionIds(sid);
      data.absences = data.absences.filter((r) => !(mySessions.has(r.sessionId) && r.studentId === stId));
      touch(sid);
      return { deleted: stId, __save: true };
    },

    saveActivity(req) {
      const sid = normId(req.subjectId);
      findSubject(sid);
      const a = req.activity || {};
      const name = clean(a.name, 80);
      if (!name) fail('NAME_REQUIRED');
      const marks = r2(Number(a.marks));
      if (!(marks > 0) || marks > MAX_MARKS) fail('INVALID_MARKS');
      const type = TYPES.indexOf(a.type) >= 0 ? a.type : 'other';
      const subject = findSubject(sid);
      const term = termsOf(subject) === 2 ? termOf(a) : 1;
      const mine = data.activities.filter((r) => r.subjectId === sid && termOf(r) === term);
      let row = null;
      if (a.id) {
        row = mine.find((r) => r.id === String(a.id));
        if (!row) fail('NOT_FOUND');
      }
      const budget = budgetOf(subject);
      const others = mine.filter((r) => r !== row).reduce((s, r) => s + r.marks, 0);
      if (others + marks > budget + 1e-9) fail('OVER_BUDGET', { remaining: r2(budget - others) });
      const split = row && Array.isArray(row.parts) && row.parts.length;
      if (row && marks < row.marks && !split) {
        const highest = data.scores.filter((r) => r.activityId === row.id).reduce((m, r) => Math.max(m, r.score), 0);
        if (highest > marks) fail('MARKS_BELOW_SCORES', { highest });
      }
      const now = Date.now();
      if (!row) {
        row = { id: 'A' + rand(10), subjectId: sid, createdAt: now, order: data.activities.filter((r) => r.subjectId === sid).reduce((m, r) => Math.max(m, r.order), 0) + 1 };
        data.activities.push(row);
      }
      row.name = name;
      row.type = type;
      row.marks = marks;
      row.term = term;
      row.date = isDate(a.date) ? String(a.date) : '';
      if (split) recomputeParts(row);
      touch(sid);
      return { activity: copy(row), scores: myScores(row.id), __save: true };
    },

    deleteActivity(req) {
      const sid = normId(req.subjectId);
      const aid = String(req.activityId || '');
      if (!data.activities.some((r) => r.subjectId === sid && r.id === aid)) fail('NOT_FOUND');
      data.activities = data.activities.filter((r) => r.id !== aid);
      data.scores = data.scores.filter((r) => r.activityId !== aid);
      data.partScores = data.partScores.filter((r) => r.activityId !== aid);
      touch(sid);
      return { deleted: aid, __save: true };
    },

    copyActivities(req) {
      const from = normId(req.fromSubjectId);
      const to = normId(req.toSubjectId);
      if (from === to) fail('BAD_REQUEST');
      findSubject(from);
      findSubject(to);
      const toSubject = findSubject(to);
      const maxTerm = termsOf(toSubject);
      const source = data.activities.filter((r) => r.subjectId === from && termOf(r) <= maxTerm).sort(byOrder);
      const target = data.activities.filter((r) => r.subjectId === to);
      const budget = budgetOf(toSubject);
      for (let tn = 1; tn <= maxTerm; tn++) {
        const used = target.filter((r) => termOf(r) === tn).reduce((s, r) => s + r.marks, 0);
        const adding = source.filter((r) => termOf(r) === tn).reduce((s, r) => s + r.marks, 0);
        if (used + adding > budget + 1e-9) fail('OVER_BUDGET', { remaining: r2(budget - used) });
      }
      let order = target.reduce((m, r) => Math.max(m, r.order), 0);
      const now = Date.now();
      source.forEach((r) => data.activities.push({
        id: 'A' + rand(10), subjectId: to, name: r.name, type: r.type, marks: r.marks, term: termOf(r), order: ++order, createdAt: now,
        parts: Array.isArray(r.parts) && r.parts.length ? r.parts.map((p) => ({ id: 'P' + rand(8), label: p.label, date: '', max: p.max })) : undefined
      }));
      touch(to);
      return { activities: copy(data.activities.filter((r) => r.subjectId === to).sort(byOrder)), __save: true };
    },

    /** Split an activity into cells (parts: [...]) or go back to one total (parts: null). */
    saveParts(req) {
      const sid = normId(req.subjectId);
      const aid = String(req.activityId || '');
      const act = data.activities.find((r) => r.subjectId === sid && r.id === aid);
      if (!act) fail('NOT_FOUND');
      if (req.parts === null) {
        // Back to one total: the current totals stay as they are.
        delete act.parts;
        data.partScores = data.partScores.filter((r) => r.activityId !== aid);
        touch(sid);
        return { activity: copy(act), partScores: [], scores: myScores(aid), __save: true };
      }
      const list = Array.isArray(req.parts) ? req.parts : [];
      if (!list.length || list.length > MAX_PARTS) fail('INVALID_PARTS');
      const old = new Map((act.parts || []).map((p) => [p.id, p]));
      const parts = list.map((p, i) => {
        const max = r2(Number(p.max));
        if (!(max > 0) || max > 1000) fail('INVALID_PARTS');
        const id = p.id && old.has(String(p.id)) ? String(p.id) : 'P' + rand(8);
        return { id, label: clean(p.label, 40) || String(i + 1), date: isDate(p.date) ? String(p.date) : '', max };
      });
      const keep = new Set(parts.map((p) => p.id));
      const maxOf = new Map(parts.map((p) => [p.id, p.max]));
      // Cells that were removed lose their scores; scores above a lowered maximum are capped.
      data.partScores = data.partScores.filter((r) => r.activityId !== aid || keep.has(r.partId));
      data.partScores.forEach((r) => { if (r.activityId === aid && r.score > maxOf.get(r.partId)) r.score = maxOf.get(r.partId); });
      const wasSplit = Array.isArray(act.parts) && act.parts.length;
      act.parts = parts;
      if (!wasSplit) {
        // Totals already entered are not thrown away: each is spread over the cells in proportion,
        // so every student keeps the same total until the teacher types over the cells.
        data.scores.forEach((r) => {
          if (r.activityId !== aid) return;
          parts.forEach((p) => {
            data.partScores.push({ subjectId: sid, activityId: aid, partId: p.id, studentId: r.studentId, score: r2((r.score / act.marks) * p.max) });
          });
        });
      }
      recomputeParts(act);
      touch(sid);
      return { activity: copy(act), partScores: myPartScores(aid), scores: myScores(aid), __save: true };
    },

    savePartScores(req) {
      const sid = normId(req.subjectId);
      const aid = String(req.activityId || '');
      const act = data.activities.find((r) => r.subjectId === sid && r.id === aid);
      if (!act || !Array.isArray(act.parts) || !act.parts.length) fail('NOT_FOUND');
      const maxOf = new Map(act.parts.map((p) => [p.id, p.max]));
      const studentIds = new Set(data.students.filter((r) => r.subjectId === sid).map((r) => r.id));
      const pending = [];
      (Array.isArray(req.entries) ? req.entries : []).forEach((e) => {
        const stId = String(e.studentId || '');
        const pid = String(e.partId || '');
        if (!studentIds.has(stId) || !maxOf.has(pid)) return;
        if (e.score === '' || e.score === null || e.score === undefined) { pending.push([pid, stId, '']); return; }
        const v = Number(e.score);
        if (!isFinite(v) || v < 0 || v > maxOf.get(pid) + 1e-9) fail('INVALID_PART_SCORE');
        pending.push([pid, stId, r2(v)]);
      });
      const key = (pid, stId) => pid + '|' + stId;
      const index = new Map();
      data.partScores.forEach((r, i) => { if (r.activityId === aid) index.set(key(r.partId, r.studentId), i); });
      const remove = new Set();
      pending.forEach(([pid, stId, v]) => {
        const i = index.get(key(pid, stId));
        if (v === '') { if (i !== undefined) remove.add(i); }
        else if (i !== undefined) data.partScores[i].score = v;
        else { data.partScores.push({ subjectId: sid, activityId: aid, partId: pid, studentId: stId, score: v }); index.set(key(pid, stId), data.partScores.length - 1); }
      });
      if (remove.size) data.partScores = data.partScores.filter((r, i) => !remove.has(i));
      recomputeParts(act);
      touch(sid);
      return { partScores: myPartScores(aid), scores: myScores(aid), __save: true };
    },

    /** One lesson of one subject; the teacher then marks who was missing. */
    saveSession(req) {
      const sid = normId(req.subjectId);
      const subject = findSubject(sid);
      const x = req.session || {};
      if (!isDate(x.date)) fail('INVALID_DATE');
      const term = termsOf(subject) === 2 ? termOf(x) : 1;
      const mine = data.sessions.filter((r) => r.subjectId === sid);
      let row = null;
      if (x.id) {
        row = mine.find((r) => r.id === String(x.id));
        if (!row) fail('NOT_FOUND');
      } else if (mine.some((r) => r.date === x.date)) {
        fail('SESSION_EXISTS');
      }
      if (!row) {
        row = { id: 'S' + rand(10), subjectId: sid, createdAt: Date.now() };
        data.sessions.push(row);
      }
      row.date = String(x.date);
      row.term = term;
      row.note = clean(x.note, 60);
      return { session: copy(row), sessions: mySessions(sid), __save: true };
    },

    deleteSession(req) {
      const sid = normId(req.subjectId);
      const id = String(req.sessionId || '');
      if (!data.sessions.some((r) => r.subjectId === sid && r.id === id)) fail('NOT_FOUND');
      data.sessions = data.sessions.filter((r) => r.id !== id);
      data.absences = data.absences.filter((r) => r.sessionId !== id);
      return { sessions: mySessions(sid), absences: myAbsences(sid), __save: true };
    },

    /** Only the students who were missing are stored; everyone else was there. */
    saveAttendance(req) {
      const sid = normId(req.subjectId);
      const id = String(req.sessionId || '');
      if (!data.sessions.some((r) => r.subjectId === sid && r.id === id)) fail('NOT_FOUND');
      const studentIds = new Set(data.students.filter((r) => r.subjectId === sid).map((r) => r.id));
      data.absences = data.absences.filter((r) => r.sessionId !== id);
      (Array.isArray(req.entries) ? req.entries : []).forEach((e) => {
        const stId = String(e.studentId || '');
        const status = e.status === 'a' || e.status === 'l' ? e.status : '';
        if (!status || !studentIds.has(stId)) return;
        data.absences.push({ sessionId: id, studentId: stId, status });
      });
      return { absences: myAbsences(sid), __save: true };
    },

    /** One line per subject, so the teacher can see all classes side by side. */
    compare() {
      const subjects = data.subjects.map((subject) => {
        const sid = subject.id;
        const acts = data.activities.filter((a) => a.subjectId === sid);
        const studs = data.students.filter((x) => x.subjectId === sid);
        const budget = budgetOf(subject);
        const terms = termsOf(subject);
        const passPct = isFinite(Number(subject.passPct)) ? Number(subject.passPct) : 50;
        const found = new Map();
        data.scores.forEach((r) => { if (r.subjectId === sid) found.set(r.activityId + '|' + r.studentId, r.score); });
        const pcts = [];
        studs.forEach((st) => {
          let sum = 0;
          let counted = 0;
          for (let tn = 1; tn <= terms; tn++) {
            const list = acts.filter((a) => termOf(a) === tn);
            if (!list.length) continue;
            let total = 0;
            let entered = 0;
            list.forEach((a) => {
              const v = found.get(a.id + '|' + st.id);
              if (v !== undefined) { total += v; entered++; }
            });
            if (entered) { sum += budget ? (total / budget) * 100 : 0; counted++; }
          }
          if (counted) pcts.push(r2(sum / counted));
        });
        const passed = pcts.filter((p) => p + 1e-9 >= passPct).length;
        return {
          id: sid, name: subject.name, department: subject.department, stage: subject.stage,
          color: subject.color, terms,
          students: studs.length, scored: pcts.length,
          averagePct: pcts.length ? r2(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0,
          passPct, passed, failed: pcts.length - passed,
          passRate: pcts.length ? r2((passed / pcts.length) * 100) : 0
        };
      });
      return { subjects };
    },

    saveScores(req) {
      const sid = normId(req.subjectId);
      const aid = String(req.activityId || '');
      const act = data.activities.find((r) => r.subjectId === sid && r.id === aid);
      if (!act) fail('NOT_FOUND');
      if (Array.isArray(act.parts) && act.parts.length) fail('SPLIT_ACTIVITY');
      const studentIds = new Set(data.students.filter((r) => r.subjectId === sid).map((r) => r.id));
      const list = Array.isArray(req.scores) ? req.scores : [];
      const invalid = [];
      const pending = [];
      list.forEach((x) => {
        const stId = String(x.studentId || '');
        if (!studentIds.has(stId)) return;
        if (x.score === '' || x.score === null || x.score === undefined) { pending.push([stId, '']); return; }
        const v = Number(x.score);
        if (!isFinite(v) || v < 0 || v > act.marks + 1e-9) { invalid.push(stId); return; }
        pending.push([stId, r2(v)]);
      });
      if (invalid.length) fail('INVALID_SCORES', { studentIds: invalid, max: act.marks });
      const index = new Map();
      data.scores.forEach((r, i) => { if (r.activityId === aid) index.set(r.studentId, i); });
      const now = Date.now();
      const remove = new Set();
      pending.forEach(([stId, v]) => {
        const i = index.get(stId);
        if (v === '') { if (i !== undefined) remove.add(i); }
        else if (i !== undefined) { data.scores[i].score = v; data.scores[i].updatedAt = now; }
        else { data.scores.push({ subjectId: sid, activityId: aid, studentId: stId, score: v, updatedAt: now }); index.set(stId, data.scores.length - 1); }
      });
      if (remove.size) data.scores = data.scores.filter((r, i) => !remove.has(i));
      touch(sid);
      return {
        saved: pending.length,
        scores: data.scores.filter((r) => r.activityId === aid).map((r) => [r.activityId, r.studentId, r.score]),
        __save: true
      };
    }
  };

  // ───────────── Online (only these need internet) ─────────────
  /** Remembers which students already got their grades by email. */
  function setEmailed(sid, ids, value) {
    const set = new Set(ids.map(String));
    data.students.forEach((st) => { if (st.subjectId === sid && (!ids.length || set.has(st.id))) st.emailedAt = value; });
  }

  const EXTRA = {
    markEmailed(req) {
      const sid = normId(req.subjectId);
      setEmailed(sid, req.studentIds || [], Date.now());
      return { students: copy(data.students.filter((r) => r.subjectId === sid).sort(byOrder)), __save: true };
    },
    clearEmailed(req) {
      const sid = normId(req.subjectId);
      setEmailed(sid, [], 0);
      return { students: copy(data.students.filter((r) => r.subjectId === sid).sort(byOrder)), __save: true };
    }
  };
  Object.assign(LOCAL, EXTRA);

  // ───────────── Files (study plans, syllabi, exam papers…) ─────────────
  const FILE_LIMIT = 25 * 1024 * 1024;
  const orphanFiles = [];

  function kv(mode, fn) {
    return idb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }
  const fileKey = (id) => 'file:' + id;

  async function dropOrphans() {
    while (orphanFiles.length) {
      const id = orphanFiles.pop();
      try { await kv('readwrite', (st) => st.delete(fileKey(id))); } catch (e) { /* harmless */ }
    }
  }

  function addFile(subjectId, name, type, buffer) {
    return serial(async () => {
      await load();
      const sid = normId(subjectId);
      findSubject(sid);
      if (!buffer || buffer.byteLength > FILE_LIMIT) fail('FILE_TOO_BIG');
      const row = {
        id: 'F' + rand(10), subjectId: sid, name: clean(name, 120) || 'file',
        type: String(type || 'application/octet-stream').slice(0, 120), size: buffer.byteLength, createdAt: Date.now()
      };
      try {
        await kv('readwrite', (st) => st.put({ type: row.type, buf: buffer }, fileKey(row.id)));
      } catch (e) {
        throw new ApiError('SAVE_FAILED');
      }
      data.files.push(row);
      await persist();
      return copy(row);
    });
  }

  function readFile(id) {
    return serial(async () => {
      await load();
      const row = data.files.find((r) => r.id === id);
      if (!row) fail('NOT_FOUND');
      const stored = await kv('readonly', (st) => st.get(fileKey(id)));
      if (!stored || !stored.buf) fail('NOT_FOUND');
      return { file: copy(row), blob: new Blob([stored.buf], { type: row.type }) };
    });
  }

  function renameFile(id, name) {
    return serial(async () => {
      await load();
      const row = data.files.find((r) => r.id === id);
      if (!row) fail('NOT_FOUND');
      const n = clean(name, 120);
      if (!n) fail('NAME_REQUIRED');
      row.name = n;
      await persist();
      return copy(row);
    });
  }

  function deleteFile(id) {
    return serial(async () => {
      await load();
      if (!data.files.some((r) => r.id === id)) fail('NOT_FOUND');
      data.files = data.files.filter((r) => r.id !== id);
      await persist();
      try { await kv('readwrite', (st) => st.delete(fileKey(id))); } catch (e) { /* the list no longer points at it */ }
      return { deleted: id };
    });
  }

  function toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromBase64(text) {
    const bin = atob(text);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // ───────────── Public ─────────────
  function call(action, payload = {}) {
    return serial(async () => {
      await load();
      if (LOCAL[action]) {
        const out = LOCAL[action](payload);
        const shouldSave = out.__save;
        delete out.__save;
        if (shouldSave) await persist();
        if (orphanFiles.length) await dropOrphans();
        if (!out.online) out.online = onlineInfo();
        return Object.assign({ ok: true }, out);
      }
      fail('UNKNOWN_ACTION');
    });
  }

  function exportBackup() {
    return serial(async () => {
      await load();
      data.meta.lastBackupAt = Date.now();
      await persist();
      const out = copy(data);
      out.exportedAt = Date.now();
      out.app = 'nimre';
      out.fileData = {};
      for (const f of data.files) {
        try {
          const stored = await kv('readonly', (st) => st.get(fileKey(f.id)));
          if (stored && stored.buf) out.fileData[f.id] = toBase64(stored.buf);
        } catch (e) { /* a file that can't be read is skipped */ }
      }
      return out;
    });
  }

  function importBackup(obj) {
    return serial(async () => {
      if (!obj || obj.app !== 'nimre' || !Array.isArray(obj.subjects) || !Array.isArray(obj.scores)) fail('BAD_BACKUP');
      await load();
      const oldFiles = data.files.map((f) => f.id);
      const fileData = obj.fileData || {};
      data = normalize(obj);
      if (!data.meta.setupAt) data.meta.setupAt = Date.now();
      delete data.exportedAt;
      delete data.app;
      delete data.fileData;
      const restored = [];
      for (const f of data.files) {
        if (!fileData[f.id]) continue;
        try {
          await kv('readwrite', (st) => st.put({ type: f.type, buf: fromBase64(fileData[f.id]) }, fileKey(f.id)));
          restored.push(f);
        } catch (e) { /* skipped */ }
      }
      data.files = restored;
      oldFiles.filter((id) => !restored.some((f) => f.id === id)).forEach((id) => orphanFiles.push(id));
      await persist();
      await dropOrphans();
      return { subjects: data.subjects.length, students: data.students.length };
    });
  }

  async function info() {
    await load();
    return onlineInfo();
  }

  window.NimreBudget = (subject) => budgetOf(subject);

  window.NimreLocal = { call, exportBackup, importBackup, info, addFile, readFile, renameFile, deleteFile, FILE_LIMIT };
})();

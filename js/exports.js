/* Nimre — file exports (Excel, Word, print) and QR codes. Libraries load only when needed. */
(() => {
  'use strict';

  // Bundled with the app, so exports and QR codes work without internet.
  const LIBS = {
    excel: 'js/vendor/exceljs.min.js',
    docx: 'js/vendor/docx.iife.js'
  };
  const loaded = {};

  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => { delete loaded[src]; s.remove(); reject(new Error('Failed to load ' + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => (n === '' || n === null || n === undefined ? '' : String(Math.round(Number(n) * 100) / 100));

  function fileName(meta, ext) {
    const base = [meta.subject.name, meta.subject.department].filter(Boolean).join(' - ');
    return (base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'grades') + '.' + ext;
  }

  async function saveBlob(blob, filename) {
    return window.NimreNative.saveFile(blob, filename);
    /* eslint-disable no-unreachable */
    let file = null;
    try { file = new File([blob], filename, { type: blob.type }); } catch (e) { /* old browsers */ }
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (file && touch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: filename });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // the person closed the share sheet
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  /** Columns shared by Excel, Word and print. */
  function columns(rep, meta) {
    const { t, opts } = meta;
    const cols = [
      { header: '#', kind: 'index', value: (r) => r.n },
      { header: t('name'), kind: 'name', value: (r) => r.st.name }
    ];
    if (opts.includeActivities) {
      rep.acts.forEach((a, i) => cols.push({
        header: a.name, sub: fmt(a.marks), kind: 'score', len: a.name.length,
        value: (r) => (r.cells[i] === '' ? '' : r.cells[i])
      }));
    }
    cols.push({ header: t('total'), sub: fmt(rep.max), kind: 'total', value: (r) => r.total });
    if (opts.includeLevel) {
      cols.push({ header: '%', kind: 'score', value: (r) => r.pct });
      cols.push({ header: t('level'), kind: 'level', value: (r) => t('level_' + r.level) });
    }
    return cols;
  }

  function metaLine(meta) {
    const { t, subject } = meta;
    const sep = meta.sep || (meta.lang === 'en' ? ', ' : '، ');
    return [subject.department, subject.stage, subject.semester ? t('semester') + ' ' + subject.semester : '', subject.year ? '\u200E' + subject.year + '\u200E' : '']
      .filter(Boolean).join(sep);
  }

  function summaryItems(rep, meta) {
    const { t } = meta;
    const s = rep.stats;
    const pc = (n) => fmt(n) + '%';
    const items = [
      [t('statStudents'), String(s.count)],
      [t('statAverage'), fmt(s.average) + ' / ' + fmt(rep.max) + ' (' + pc(s.averagePct) + ')'],
      [t('statMedian'), fmt(s.median)],
      [t('statHighest'), fmt(s.highest)],
      [t('statLowest'), fmt(s.lowest)],
      [t('statPassed'), s.passed + ' (' + pc(s.passRate) + ')'],
      [t('statFailed'), s.failed + ' (' + pc(s.failRate) + ')'],
      [t('passMark'), fmt(s.passMark) + ' / ' + fmt(rep.max) + ' (' + pc(s.passPct) + ')']
    ];
    if (s.notGraded) items.push([t('statNotGraded'), String(s.notGraded)]);
    return items;
  }

  /** How many students landed in each grade level. */
  function levelItems(rep, meta) {
    const { t } = meta;
    return rep.stats.levels.map((l) => [t('level_' + l.key), l.n + ' (' + fmt(l.pct) + '%)']);
  }

  function activityRows(rep, meta) {
    const { t } = meta;
    return {
      header: [t('activityName'), t('marks'), t('colEntered'), t('colAverage'), t('colPercent'), t('colPassRate'), t('statHighest'), t('statLowest')],
      rows: rep.stats.activities.map((a) => [a.name, a.marks, a.entered, a.average, fmt(a.avgPct) + '%', fmt(a.passRate || 0) + '%', a.highest, a.lowest])
    };
  }

  // ───────────── Excel ─────────────
  async function excel(rep, meta) {
    await loadScript(LIBS.excel);
    const { t } = meta;
    const rtl = meta.rtl !== undefined ? !!meta.rtl : meta.lang !== 'en';
    const cols = columns(rep, meta);
    const N = cols.length;
    const wb = new window.ExcelJS.Workbook();
    wb.creator = 'Nimre';
    wb.created = new Date();

    const sheetName = (meta.subject.name || 'Grades').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    const ws = wb.addWorksheet(sheetName, {
      views: [{ rightToLeft: rtl, showGridLines: false }],
      pageSetup: {
        paperSize: 9, orientation: N > 6 ? 'landscape' : 'portrait',
        fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 }
      },
      headerFooter: { oddFooter: '&C&P / &N' }
    });

    ws.columns = cols.map((c) => ({
      width: c.kind === 'index' ? 5 : c.kind === 'name' ? 32 : c.kind === 'level' ? 14 : Math.max(11, Math.min(20, (c.len || 6) + 4))
    }));

    const ink = 'FF1B2A41';
    const readingOrder = rtl ? 'rtl' : 'ltr';
    const thin = (argb) => ({ style: 'thin', color: { argb } });
    const box = (argb) => ({ top: thin(argb), bottom: thin(argb), left: thin(argb), right: thin(argb) });

    const title = (text, size, bold, color) => {
      const r = ws.addRow([text]);
      ws.mergeCells(r.number, 1, r.number, N);
      const c = r.getCell(1);
      c.font = { name: 'Calibri', size, bold, color: { argb: color } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder };
      r.height = Math.round(size * 1.9);
    };
    if (meta.university) title(meta.university, 12, false, 'FF4A5A70');
    title(meta.subject.name, 18, true, ink);
    const line = metaLine(meta);
    if (line) title(line, 12, false, 'FF4A5A70');
    title([meta.teacherName ? t('teacher') + ': ' + meta.teacherName : '', t('date') + ': ' + meta.dateText].filter(Boolean).join('     '), 11, false, 'FF6B7785');
    ws.addRow([]);

    const header = ws.addRow(cols.map((c) => (c.sub ? c.header + '\n(' + c.sub + ')' : c.header)));
    header.height = 40;
    header.eachCell((cell) => {
      cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder };
      cell.border = box(ink);
    });

    rep.rows.forEach((r, i) => {
      const row = ws.addRow(cols.map((c) => c.value(r)));
      row.height = 22;
      cols.forEach((c, ci) => {
        const cell = row.getCell(ci + 1);
        const strong = c.kind === 'total' || c.kind === 'coursework';
        cell.font = { name: 'Calibri', size: 11, bold: strong, color: { argb: ink } };
        cell.alignment = { horizontal: c.kind === 'name' ? (rtl ? 'right' : 'left') : 'center', vertical: 'middle', readingOrder, indent: c.kind === 'name' ? 1 : 0 };
        cell.border = box('FFDCE2E0');
        const fill = c.kind === 'total' ? (i % 2 ? 'FFD6EBE1' : 'FFE3F1EA') : (i % 2 ? 'FFF5F7F4' : null);
        if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      });
    });
    ws.views = [{ rightToLeft: rtl, showGridLines: false, state: 'frozen', ySplit: header.number }];

    ws.addRow([]);
    summaryItems(rep, meta).forEach(([label, value]) => {
      const r = ws.addRow(['', label, value]);
      r.getCell(2).font = { name: 'Calibri', size: 11, color: { argb: 'FF4A5A70' } };
      r.getCell(2).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder, indent: 1 };
      r.getCell(3).font = { name: 'Calibri', size: 11, bold: true, color: { argb: ink } };
      r.getCell(3).alignment = { horizontal: 'center', readingOrder };
    });

    // Second sheet: statistics, so the gradebook sheet stays printable as it is.
    const st = wb.addWorksheet(t('statistics').slice(0, 31), { views: [{ rightToLeft: rtl, showGridLines: false }] });
    st.columns = [{ width: 30 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 }];
    const heading = (text) => {
      const r = st.addRow([text]);
      r.getCell(1).font = { name: 'Calibri', size: 13, bold: true, color: { argb: ink } };
      r.getCell(1).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder };
      r.height = 24;
    };
    const pair = (label, value) => {
      const r = st.addRow([label, value]);
      r.getCell(1).font = { name: 'Calibri', size: 11, color: { argb: 'FF4A5A70' } };
      r.getCell(1).alignment = { horizontal: rtl ? 'right' : 'left', readingOrder };
      r.getCell(2).font = { name: 'Calibri', size: 11, bold: true, color: { argb: ink } };
      r.getCell(2).alignment = { horizontal: 'center', readingOrder };
    };
    heading(meta.subject.name + ' — ' + t('statistics'));
    st.addRow([]);
    summaryItems(rep, meta).forEach(([k, v]) => pair(k, v));
    st.addRow([]);
    heading(t('levelsTitle'));
    levelItems(rep, meta).forEach(([k, v]) => pair(k, v));
    st.addRow([]);
    heading(t('byActivity'));
    const at = activityRows(rep, meta);
    const ah = st.addRow(at.header);
    ah.eachCell((cell) => {
      cell.font = { name: 'Calibri', bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true, readingOrder };
    });
    at.rows.forEach((row) => {
      const r = st.addRow(row);
      r.eachCell((cell, i) => {
        cell.font = { name: 'Calibri', size: 11, color: { argb: ink } };
        cell.alignment = { horizontal: i === 1 ? (rtl ? 'right' : 'left') : 'center', readingOrder };
        cell.border = box('FFDCE2E0');
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    await saveBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName(meta, 'xlsx'));
  }

  // ───────────── Word ─────────────
  async function word(rep, meta) {
    await loadScript(LIBS.docx);
    const D = window.docx;
    const { t } = meta;
    const rtl = meta.rtl !== undefined ? !!meta.rtl : meta.lang !== 'en';
    const cols = columns(rep, meta);
    const landscape = cols.length > 6;
    const margin = 850;
    const tableW = (landscape ? 16838 : 11906) - margin * 2;

    // Column widths (DXA): fixed for small columns, the name column takes the rest.
    const fixed = cols.map((c) => (c.kind === 'index' ? 520 : c.kind === 'name' ? 0 : c.kind === 'level' ? 1250 : 1050));
    let nameW = Math.max(2400, tableW - fixed.reduce((a, b) => a + b, 0));
    const scoreCols = cols.filter((c) => c.kind === 'score' || c.kind === 'coursework').length;
    if (scoreCols && nameW > 4200) {
      const extra = Math.min(450, Math.floor((nameW - 4200) / scoreCols));
      cols.forEach((c, i) => { if (c.kind === 'score' || c.kind === 'coursework') fixed[i] += extra; });
      nameW -= extra * scoreCols;
    }
    let widths = fixed.map((w) => w || nameW);
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum !== tableW) widths = widths.map((w) => Math.floor((w * tableW) / sum));
    widths[1] += tableW - widths.reduce((a, b) => a + b, 0);

    const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Arial', eastAsia: 'Calibri' };
    const run = (text, o = {}) => new D.TextRun({
      text: String(text), bold: !!o.bold, size: o.size || 20, color: o.color || '1B2A41', font: FONT, rightToLeft: rtl
    });
    const para = (text, o = {}) => new D.Paragraph({
      bidirectional: rtl,
      alignment: o.align,
      spacing: { before: o.before || 0, after: o.after ?? 60 },
      children: [run(text, o)]
    });
    const border = (color) => ({ style: D.BorderStyle.SINGLE, size: 4, color });
    const cell = (lines, w, o = {}) => new D.TableCell({
      width: { size: w, type: D.WidthType.DXA },
      verticalAlign: D.VerticalAlign.CENTER,
      shading: o.fill ? { type: D.ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
      margins: { top: 50, bottom: 50, left: 80, right: 80 },
      borders: o.borders,
      children: [].concat(lines).map((txt, li) => para(txt, {
        bold: o.bold && li === 0, color: li ? (o.subColor || o.color) : o.color, size: li ? 16 : o.size, align: o.align, after: 0
      }))
    });

    const headerRow = new D.TableRow({
      tableHeader: true,
      cantSplit: true,
      children: cols.map((c, i) => cell(c.sub ? [c.header, '(' + c.sub + ')'] : [c.header], widths[i], {
        bold: true, color: 'FFFFFF', subColor: 'D6DEE8', fill: '1B2A41', align: D.AlignmentType.CENTER, size: 19
      }))
    });

    const bodyRows = rep.rows.map((r, ri) => new D.TableRow({
      cantSplit: true,
      children: cols.map((c, i) => {
        const v = c.value(r);
        const isTotal = c.kind === 'total';
        return cell([v === '' ? '' : String(v)], widths[i], {
          bold: isTotal,
          color: '1B2A41',
          fill: isTotal ? 'E3F1EA' : ri % 2 ? 'F5F7F4' : undefined,
          align: c.kind === 'name' ? undefined : D.AlignmentType.CENTER,
          size: 20
        });
      })
    }));

    const grid = border('C5CFCC');
    const table = new D.Table({
      width: { size: tableW, type: D.WidthType.DXA },
      columnWidths: widths,
      layout: D.TableLayoutType.FIXED,
      visuallyRightToLeft: rtl,
      borders: { top: grid, bottom: grid, left: grid, right: grid, insideHorizontal: grid, insideVertical: grid },
      rows: [headerRow, ...bodyRows]
    });

    const none = { style: D.BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    const noBorders = { top: none, bottom: none, left: none, right: none };
    const half = Math.floor(tableW / 2);
    const summary = summaryItems(rep, meta).map(([k, v]) => k + ': ' + v).join('     ');
    const signatures = new D.Table({
      width: { size: tableW, type: D.WidthType.DXA },
      columnWidths: [half, tableW - half],
      layout: D.TableLayoutType.FIXED,
      visuallyRightToLeft: rtl,
      borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
      rows: [new D.TableRow({
        children: [t('signatureTeacher'), t('signatureHead')].map((label, i) => cell(
          [label, '', '..................................'], i ? tableW - half : half,
          { align: D.AlignmentType.CENTER, color: '4A5A70', size: 20, borders: noBorders }
        ))
      })]
    });

    const head = [];
    if (meta.university) head.push(para(meta.university, { align: D.AlignmentType.CENTER, size: 22, color: '4A5A70' }));
    head.push(para(meta.subject.name, { align: D.AlignmentType.CENTER, size: 34, bold: true, after: 40 }));
    const line = metaLine(meta);
    if (line) head.push(para(line, { align: D.AlignmentType.CENTER, size: 22, color: '4A5A70' }));
    head.push(para([meta.teacherName ? t('teacher') + ': ' + meta.teacherName : '', t('date') + ': ' + meta.dateText].filter(Boolean).join('     '),
      { align: D.AlignmentType.CENTER, size: 20, color: '6B7785', after: 240 }));

    const doc = new D.Document({
      creator: 'Nimre',
      title: meta.subject.name,
      styles: { default: { document: { run: { font: FONT, size: 20 } } } },
      sections: [{
        properties: {
          page: {
            size: { width: 11906, height: 16838, orientation: landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
            margin: { top: 800, bottom: 800, left: margin, right: margin }
          }
        },
        footers: {
          default: new D.Footer({
            children: [new D.Paragraph({
              alignment: D.AlignmentType.CENTER,
              children: [new D.TextRun({ children: [t('page') + ' ', D.PageNumber.CURRENT, ' / ', D.PageNumber.TOTAL_PAGES], size: 16, color: '6B7785', font: FONT })]
            })]
          })
        },
        children: [
          ...head,
          table,
          para(t('statistics'), { size: 22, bold: true, before: 260, after: 80 }),
          para(summary, { size: 19, color: '4A5A70', after: 60 }),
          para(t('levelsTitle') + ': ' + levelItems(rep, meta).map(([k, v]) => k + ' ' + v).join('  ·  '),
            { size: 19, color: '4A5A70', after: 360 }),
          signatures
        ]
      }]
    });

    const blob = await D.Packer.toBlob(doc);
    await saveBlob(blob, fileName(meta, 'docx'));
  }

  const LEVEL_COLOR = { excellent: '#1E7A5A', veryGood: '#2F6690', good: '#2B7F7B', fair: '#A86F0E', pass: '#7B4F91', fail: '#B3261E' };

  /** Which slice of the year this report covers, for the page heading. */
  function termLabel(rep, meta) {
    if (rep.terms !== 2) return '';
    return rep.isYear ? meta.t('yearView') : meta.t('term' + rep.view);
  }

  /** A small bar chart of the level distribution — the thing heads of school look at first. */
  function levelChart(rep, meta) {
    const levels = rep.stats.levels;
    const top = Math.max(1, ...levels.map((l) => l.n));
    const W = 560;
    const H = 150;
    const pad = 26;
    const band = (W - pad * 2) / levels.length;
    const bars = levels.map((l, i) => {
      const h = Math.round((l.n / top) * (H - 58));
      const x = pad + band * i + band * 0.18;
      const w = band * 0.64;
      const y = H - 34 - h;
      return '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + h + '" rx="3" fill="' + LEVEL_COLOR[l.key] + '"/>' +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 6) + '" text-anchor="middle" font-size="12" fill="#1B2A41">' + l.n + '</text>' +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 18) + '" text-anchor="middle" font-size="11" fill="#44546A">' + esc(meta.t('level_' + l.key)) + '</text>' +
        '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle" font-size="10" fill="#667285">' + fmt(l.pct) + '%</text>';
    }).join('');
    return '<svg class="pr-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(meta.t('levelChart')) + '">' +
      '<line x1="' + pad + '" y1="' + (H - 34) + '" x2="' + (W - pad) + '" y2="' + (H - 34) + '" stroke="#C3CDCA" stroke-width="1"/>' + bars + '</svg>';
  }

  // ───────────── Report cards (one page per student) ─────────────
  function cardHtml(row, rep, meta) {
    const { t } = meta;
    const att = meta.attendance && meta.attendance.per.get(row.st.id);
    const term = termLabel(rep, meta);
    const lines = rep.acts.map((a, i) => '<tr><td class="k-name">' + esc(a.name) + '</td>' +
      '<td>' + (row.cells[i] === '' ? '—' : fmt(row.cells[i])) + '</td><td>' + fmt(a.marks) + '</td></tr>').join('');

    return '<section class="pr-card">' +
      '<header class="pr-head">' +
      (meta.university ? '<p>' + esc(meta.university) + '</p>' : '') +
      '<h1>' + esc(t('reportCard')) + '</h1>' +
      '<p>' + esc(meta.subject.name) + (term ? ' — ' + esc(term) : '') + '</p>' +
      '<p class="pr-small">' + esc(metaLine(meta)) + '</p></header>' +
      '<div class="pr-card-id"><strong>' + esc(row.st.name) + '</strong>' +
      (row.rank ? '<span>' + esc(t('rank')) + ': ' + esc(t('rankOf', { n: row.rank, total: rep.ranked })) + '</span>' : '') +
      '</div>' +
      '<table class="pr-table pr-card-table"><thead><tr>' +
      '<th class="k-name">' + esc(rep.isYear ? t('viewTerm') : t('activityName')) + '</th>' +
      '<th>' + esc(t('marks')) + '</th><th>' + esc(t('maxMarks')) + '</th></tr></thead><tbody>' + lines + '</tbody></table>' +
      '<div class="pr-card-total">' +
      '<span>' + esc(rep.isYear ? t('yearAverage') : t('total')) + '</span>' +
      '<b>' + fmt(row.total) + ' / ' + fmt(rep.max) + '</b>' +
      '<span class="pr-card-pct">' + fmt(row.pct) + '% — ' + esc(t('level_' + row.level)) + '</span></div>' +
      '<p class="pr-small pr-card-note">' + esc(t('classAverage')) + ': ' + fmt(rep.stats.average) + ' / ' + fmt(rep.max) +
      ' &nbsp; ' + esc(t('passMark')) + ': ' + fmt(rep.passMark) +
      (att ? ' &nbsp; ' + esc(t('attendanceRate')) + ': ' + fmt(att.pct) + '%' : '') + '</p>' +
      '<div class="pr-sign"><div>' + esc(t('signatureTeacher')) + '</div><div>' + esc(t('signatureParent')) + '</div></div>' +
      '</section>';
  }

  function cards(rep, meta, studentIds) {
    const rtl = meta.rtl !== undefined ? !!meta.rtl : meta.lang !== 'en';
    const list = studentIds && studentIds.length
      ? rep.rows.filter((r) => studentIds.indexOf(r.st.id) >= 0)
      : rep.rows;
    if (!list.length) return;
    const area = document.getElementById('print-area');
    area.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    area.innerHTML = '<div class="pr-cards">' + list.map((r) => cardHtml(r, rep, meta)).join('') + '</div>';
    document.getElementById('print-page-style').textContent = '@page { size: A4 portrait; margin: 14mm; }';
    setTimeout(() => {
      if (window.Nimre && window.Nimre.IS_NATIVE) window.NimreNative.print(fileName(meta, 'pdf').replace(/\.pdf$/, '') + ' - ' + meta.t('reportCards'), false);
      else window.print();
    }, 120);
  }

  // ───────────── Print / PDF ─────────────
  function print(rep, meta) {
    const { t } = meta;
    const rtl = meta.rtl !== undefined ? !!meta.rtl : meta.lang !== 'en';
    const cols = columns(rep, meta);
    const area = document.getElementById('print-area');
    area.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    area.innerHTML =
      '<header class="pr-head">' +
      (meta.university ? '<p>' + esc(meta.university) + '</p>' : '') +
      '<h1>' + esc(meta.subject.name) + '</h1>' +
      '<p>' + esc([metaLine(meta), termLabel(rep, meta)].filter(Boolean).join(' — ')) + '</p>' +
      '<p class="pr-small">' + esc([meta.teacherName ? t('teacher') + ': ' + meta.teacherName : '', t('date') + ': ' + meta.dateText].filter(Boolean).join('   ')) + '</p>' +
      '</header>' +
      '<table class="pr-table"><thead><tr>' +
      cols.map((c) => '<th class="k-' + c.kind + '">' + esc(c.header) + (c.sub ? '<small>(' + esc(c.sub) + ')</small>' : '') + '</th>').join('') +
      '</tr></thead><tbody>' +
      rep.rows.map((r) => '<tr>' + cols.map((c) => '<td class="k-' + c.kind + '">' + esc(c.value(r)) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table>' +
      '<h2 class="pr-h2">' + esc(t('statistics')) + '</h2>' +
      '<p class="pr-summary">' + summaryItems(rep, meta).map(([k, v]) => esc(k) + ': <b>' + esc(v) + '</b>').join(' &nbsp; ') + '</p>' +
      '<p class="pr-summary">' + esc(t('levelsTitle')) + ': ' + levelItems(rep, meta).map(([k, v]) => esc(k) + ' <b>' + esc(v) + '</b>').join(' &nbsp; ') + '</p>' +
      (rep.stats.scored ? levelChart(rep, meta) : '') +
      (rep.stats.activities.length
        ? '<table class="pr-table pr-table--stats"><thead><tr>' + activityRows(rep, meta).header.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
          activityRows(rep, meta).rows.map((row) => '<tr>' + row.map((v, i) => '<td class="' + (i ? '' : 'k-name') + '">' + esc(v) + '</td>').join('') + '</tr>').join('') +
          '</tbody></table>'
        : '') +
      '<div class="pr-sign"><div>' + esc(t('signatureTeacher')) + '</div><div>' + esc(t('signatureHead')) + '</div></div>';
    document.getElementById('print-page-style').textContent =
      '@page { size: A4 ' + (cols.length > 6 ? 'landscape' : 'portrait') + '; margin: 12mm; }';
    const landscape = cols.length > 6;
    setTimeout(() => {
      if (window.Nimre && window.Nimre.IS_NATIVE) window.NimreNative.print(fileName(meta, 'pdf').replace(/\.pdf$/, ''), landscape);
      else window.print();
    }, 120);
  }

  // ───────────── Import a class list (Excel .xlsx or CSV) ─────────────
  const NAME_HEADER = /^(name|names|full ?name|student|students|student ?name|ناو|ناوەکان|ناوی ?قوتابی|ناوی ?سیانی|ناوی ?تەواو|ناوی ?قوتابیان|الاسم|اسم ?الطالب)$/i;
  const EMAIL_HEADER = /^(e-?mail|emails?|e-?mail ?address|mail|gmail|ئیمەیڵ|ئیمەیل|ئیمێڵ|ئیمەیلی ?قوتابی|البريد|البريد ?الالكتروني)$/i;
  const EMAIL_RE = /[^\s,;<>"'()]+@[^\s,;<>"'()]+\.[^\s,;<>"'()]{2,}/;

  function parseDelimited(text) {
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
    const sample = lines.slice(0, 10).join('\n');
    const delim = ['\t', ';', ','].map((d) => [d, sample.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    return lines.map((line) => {
      const out = [];
      let cur = '', quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
        else if (ch === delim && !quoted) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((c) => c.trim());
    });
  }

  function pickRoster(rows) {
    rows = rows.map((r) => (r || []).map((c) => String(c ?? '').replace(/\s+/g, ' ').trim()));
    let start = 0, nameCol = -1, emailCol = -1;
    for (let r = 0; r < Math.min(rows.length, 12); r++) {
      const n = rows[r].findIndex((c) => NAME_HEADER.test(c));
      const e = rows[r].findIndex((c) => EMAIL_HEADER.test(c));
      if (n >= 0 || e >= 0) { nameCol = n; emailCol = e; start = r + 1; break; }
    }
    const data = rows.slice(start);
    const width = Math.max(0, ...data.map((r) => r.length));
    if (emailCol < 0) {
      let best = 0;
      for (let c = 0; c < width; c++) {
        const hits = data.filter((r) => EMAIL_RE.test(r[c] || '')).length;
        if (hits > best) { best = hits; emailCol = c; }
      }
    }
    if (nameCol < 0) {
      let best = 0;
      for (let c = 0; c < width; c++) {
        if (c === emailCol) continue;
        const cells = data.map((r) => r[c] || '').filter((v) => v && !EMAIL_RE.test(v) && /\p{L}/u.test(v) && !/^[\d\s.\-+/]+$/.test(v));
        const score = cells.length * 10 + cells.reduce((a, v) => a + Math.min(v.length, 40), 0) / Math.max(cells.length, 1);
        if (score > best) { best = score; nameCol = c; }
      }
    }
    const out = [];
    const seen = new Set();
    data.forEach((r) => {
      const name = nameCol >= 0 ? (r[nameCol] || '').replace(/^[\d\u0660-\u0669\u06F0-\u06F9]+[.)\-]\s*/, '').trim() : '';
      const m = (emailCol >= 0 ? r[emailCol] || '' : r.join(' ')).match(EMAIL_RE);
      const email = m ? m[0].replace(/^mailto:/i, '').toLowerCase() : '';
      if (!name || name.length > 80 || NAME_HEADER.test(name) || !/\p{L}/u.test(name)) return;   // skip notes and title lines
      const key = (email || name).toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, email });
    });
    return out;
  }

  /** Reads names and emails from an .xlsx or .csv file. Works offline. */
  async function readRoster(file) {
    const lower = String(file.name || '').toLowerCase();
    if (/\.xls$/.test(lower)) { const e = new Error('XLS_OLD'); e.code = 'XLS_OLD'; throw e; }
    const buffer = await window.Nimre.readFileBuffer(file);
    const head = new Uint8Array(buffer.slice(0, 4));
    const isZip = head[0] === 0x50 && head[1] === 0x4B;
    const isOldExcel = head[0] === 0xD0 && head[1] === 0xCF;
    if (isOldExcel) { const e = new Error('XLS_OLD'); e.code = 'XLS_OLD'; throw e; }
    let rows = [];
    if (isZip) {
      await loadScript(LIBS.excel);
      const wb = new window.ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.worksheets.find((w) => w.actualRowCount > 0) || wb.worksheets[0];
      if (sheet) {
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const values = [];
          row.eachCell({ includeEmpty: true }, (cell, col) => {
            let v = '';
            try { v = cell.text; } catch (e) { v = cell.value; }
            if (v && typeof v === 'object') v = v.text || v.result || v.hyperlink || '';
            values[col - 1] = String(v ?? '');
          });
          rows.push(values);
        });
      }
    } else {
      rows = parseDelimited(new TextDecoder('utf-8').decode(buffer));
    }
    return pickRoster(rows);
  }

  window.NimreExport = { LIBS, loadScript, saveBlob, excel, word, print, cards, levelChart, readRoster, pickRoster, parseDelimited, summaryItems, levelItems, activityRows };
})();

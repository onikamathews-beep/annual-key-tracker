(() => {
  'use strict';

  const STORAGE_KEY = 'annual-key-tracker-github-v1';
  const THEMES = ['sea-breeze', 'classic-blue', 'sage-stone', 'warm-sand', 'charcoal-gold'];
  const OUTCOMES = ['Contacted', 'Snoozed', 'Unable to Contact'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const todayISO = () => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  };

  const defaultState = () => ({
    version: 1,
    selectedDate: todayISO(),
    weekDate: todayISO(),
    welcomeDone: false,
    settings: { theme: 'sea-breeze', compactDashboard: false },
    days: {}
  });

  let state = loadState();
  let activeView = 'today';
  let installPrompt = null;
  let xlsxLoadPromise = null;

  function loadScript(source, timeoutMs) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => {
        script.remove();
        reject(new Error('The Excel library took too long to load.'));
      }, timeoutMs);
      script.src = source;
      script.async = true;
      script.onload = () => { clearTimeout(timer); resolve(); };
      script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error('The Excel library could not be loaded.')); };
      document.head.append(script);
    });
  }

  function ensureXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (xlsxLoadPromise) return xlsxLoadPromise;
    xlsxLoadPromise = loadScript('./vendor/xlsx.full.min.js', 1800)
      .catch(() => loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 12000))
      .then(() => {
        if (!window.XLSX) throw new Error('The Excel library loaded without the expected XLSX tools.');
        return window.XLSX;
      })
      .catch(error => { xlsxLoadPromise = null; throw error; });
    return xlsxLoadPromise;
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return defaultState();
      return {
        ...defaultState(),
        ...parsed,
        settings: { ...defaultState().settings, ...(parsed.settings || {}) },
        days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {}
      };
    } catch (error) {
      console.error('Could not load tracker data:', error);
      return defaultState();
    }
  }

  function saveState(message = 'Saved locally') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const status = $('#saveStatus');
      if (status) {
        status.textContent = message;
        clearTimeout(saveState.timer);
        saveState.timer = setTimeout(() => { status.textContent = 'Saved locally'; }, 1400);
      }
    } catch (error) {
      console.error('Could not save tracker data:', error);
      toast('This browser could not save the tracker. Download a backup now.');
    }
  }

  function dayTemplate() {
    return { mode: null, modeLocked: false, ppq: '', dayType: 'Work Day', entries: [] };
  }

  function getDay(date, create = true) {
    if (!state.days[date] && create) state.days[date] = dayTemplate();
    return state.days[date] || dayTemplate();
  }

  function sanitizeDay(day) {
    const clean = { ...dayTemplate(), ...(day || {}) };
    clean.entries = Array.isArray(clean.entries) ? clean.entries : [];
    clean.mode = clean.mode === 'keys' || clean.mode === 'tally' ? clean.mode : null;
    clean.modeLocked = Boolean(clean.modeLocked && clean.mode);
    return clean;
  }

  function isToday(date) { return date === todayISO(); }
  function isFuture(date) { return date > todayISO(); }
  function canEdit(date) { return isToday(date); }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return toISODate(value);
    if (typeof value === 'number' && window.XLSX?.SSF?.parse_date_code) {
      const parts = window.XLSX.SSF.parse_date_code(value);
      if (parts) return `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
    }
    const text = String(value).trim();
    const exact = text.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)$/);
    if (exact) return `${exact[1]}-${String(exact[2]).padStart(2, '0')}-${String(exact[3]).padStart(2, '0')}`;
    const mdY = text.match(/^([01]?\d)[-/]([0-3]?\d)[-/](\d{2,4})$/);
    if (mdY) {
      const year = mdY[3].length === 2 ? `20${mdY[3]}` : mdY[3];
      return `${year}-${String(mdY[1]).padStart(2, '0')}-${String(mdY[2]).padStart(2, '0')}`;
    }
    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : toISODate(date);
  }

  function toISODate(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function formatDate(date, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
    return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`));
  }

  function addDays(date, amount) {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + amount);
    return toISODate(d);
  }

  function startOfWeek(date) {
    const d = new Date(`${date}T12:00:00`);
    const day = d.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + offset);
    return toISODate(d);
  }

  function startOfMonth(date = todayISO()) { return `${date.slice(0, 7)}-01`; }

  function endOfMonth(date = todayISO()) {
    const d = new Date(`${date.slice(0, 7)}-01T12:00:00`);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return toISODate(d);
  }

  function createId(prefix = 'entry') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeOutcome(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('snooz')) return 'Snoozed';
    if (text.includes('unable') || text.includes('no contact') || text.includes('utc')) return 'Unable to Contact';
    return 'Contacted';
  }

  function normalizeMode(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('tally') || text === 'count') return 'tally';
    if (text.includes('key')) return 'keys';
    return null;
  }

  function safeImportedTime(date, value) {
    if (!value) return `${date}T12:00:00.000Z`;
    const parsed = new Date(`${date} ${String(value).trim()}`);
    return Number.isNaN(parsed.getTime()) ? `${date}T12:00:00.000Z` : parsed.toISOString();
  }

  function keyTokens(text) {
    const seen = new Set();
    return String(text || '')
      .split(/[\s,;|]+/)
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => {
        const key = item.toUpperCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function daySummary(date) {
    const day = sanitizeDay(getDay(date, false));
    const entries = day.entries;
    const total = entries.reduce((sum, entry) => sum + Math.max(0, Number(entry.count || (entry.keys || []).length || 0)), 0);
    const outcomes = { Contacted: 0, Snoozed: 0, 'Unable to Contact': 0 };
    entries.forEach(entry => {
      const count = Math.max(0, Number(entry.count || (entry.keys || []).length || 0));
      const outcome = normalizeOutcome(entry.outcome);
      outcomes[outcome] += count;
    });
    return {
      date,
      method: day.mode,
      ppq: day.ppq,
      dayType: day.dayType,
      total,
      interactions: entries.length,
      outcomes,
      entries
    };
  }

  function rangeDates(start, end) {
    if (!start || !end || start > end) return [];
    const dates = [];
    for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
    return dates;
  }

  function rangeSummaries(start, end) {
    return rangeDates(start, end).map(daySummary);
  }

  function toast(message) {
    const region = $('#toastRegion');
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    region.append(item);
    setTimeout(() => item.remove(), 3400);
  }

  function downloadBlob(content, filename, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function escapeCsv(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function chooseMode(mode) {
    const date = state.selectedDate;
    const day = getDay(date);
    if (!canEdit(date)) return toast('Only today can be changed. Older dates remain available for review.');
    if (day.modeLocked) return toast(`${day.mode === 'keys' ? 'Key Tracker' : 'Tally Counter'} is already locked for today.`);
    day.mode = mode;
    day.modeLocked = true;
    saveState(`${mode === 'keys' ? 'Key Tracker' : 'Tally Counter'} selected`);
    renderAll();
  }

  function addKeyBatch() {
    const date = state.selectedDate;
    const day = getDay(date);
    if (!canEdit(date) || day.dayType !== 'Work Day' || day.mode !== 'keys' || !day.modeLocked) return;
    const keys = keyTokens($('#keyInput').value);
    if (!keys.length) return toast('Paste or type at least one key.');
    const existing = new Set(day.entries.flatMap(entry => (entry.keys || []).map(key => String(key).toUpperCase())));
    const newKeys = keys.filter(key => !existing.has(key.toUpperCase()));
    if (!newKeys.length) return toast('Those keys are already recorded for today.');
    const duplicateCount = keys.length - newKeys.length;
    day.entries.push({
      id: createId('key'),
      type: 'keys',
      keys: newKeys,
      count: newKeys.length,
      outcome: $('#outcomeSelect').value,
      time: new Date().toISOString(),
      groupIndex: day.entries.length % 5
    });
    $('#keyInput').value = '';
    saveState();
    renderAll();
    toast(`${newKeys.length} key${newKeys.length === 1 ? '' : 's'} added${duplicateCount ? `; ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} skipped` : ''}.`);
  }

  function addTally(count) {
    const date = state.selectedDate;
    const day = getDay(date);
    const amount = Math.floor(Number(count));
    if (!canEdit(date) || day.dayType !== 'Work Day' || day.mode !== 'tally' || !day.modeLocked) return;
    if (!Number.isFinite(amount) || amount < 1) return toast('Enter a number greater than zero.');
    day.entries.push({
      id: createId('tally'),
      type: 'tally',
      count: amount,
      keys: [],
      outcome: $('#outcomeSelect').value,
      time: new Date().toISOString(),
      groupIndex: day.entries.length % 5
    });
    $('#customTallyInput').value = '';
    saveState();
    renderAll();
    toast(`${amount} added to today’s tally.`);
  }

  function undoLastTally() {
    const day = getDay(state.selectedDate);
    if (!canEdit(state.selectedDate) || day.mode !== 'tally') return;
    const index = [...day.entries].map(entry => entry.type).lastIndexOf('tally');
    if (index < 0) return toast('There is no tally batch to undo.');
    day.entries.splice(index, 1);
    saveState();
    renderAll();
    toast('Last tally batch removed.');
  }

  function removeEntry(id) {
    const day = getDay(state.selectedDate);
    if (!canEdit(state.selectedDate)) return;
    const before = day.entries.length;
    day.entries = day.entries.filter(entry => entry.id !== id);
    if (day.entries.length === before) return;
    saveState();
    renderAll();
    toast('Entry removed.');
  }

  function updateEntryOutcome(id, outcome) {
    const day = getDay(state.selectedDate);
    if (!canEdit(state.selectedDate)) return;
    const entry = day.entries.find(item => item.id === id);
    if (!entry) return;
    entry.outcome = normalizeOutcome(outcome);
    saveState();
    renderAll();
  }

  function clearSelectedDay() {
    const day = getDay(state.selectedDate);
    if (!canEdit(state.selectedDate)) return toast('Only today can be cleared.');
    if (!day.entries.length) return toast('There is no activity to clear.');
    if (!confirm('Clear all activity for today? The selected tracking method will remain locked.')) return;
    day.entries = [];
    saveState();
    renderAll();
    toast('Today’s activity was cleared.');
  }

  function copyDaySummary() {
    const summary = daySummary(state.selectedDate);
    const method = summary.method === 'keys' ? 'Key Tracker' : summary.method === 'tally' ? 'Tally Counter' : 'Not selected';
    const text = [
      `${formatDate(summary.date)} — ${method}`,
      `PPQ: ${summary.ppq || 'Not selected'}`,
      `Status: ${summary.dayType}`,
      `Total keys: ${summary.total}`,
      `Interactions: ${summary.interactions}`,
      `Contacted: ${summary.outcomes.Contacted}`,
      `Snoozed: ${summary.outcomes.Snoozed}`,
      `Unable to Contact: ${summary.outcomes['Unable to Contact']}`
    ].join('\n');
    navigator.clipboard?.writeText(text).then(() => toast('Daily summary copied.')).catch(() => {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.append(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('Daily summary copied.');
    });
  }

  function switchView(view) {
    activeView = view;
    $$('.nav-tab').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
    if (view === 'week') renderWeek();
    if (view === 'dashboard') renderDashboard();
    if (view === 'reports') renderReports();
  }

  function renderToday() {
    const date = state.selectedDate;
    const day = getDay(date);
    const summary = daySummary(date);
    const editable = canEdit(date);
    const workday = day.dayType === 'Work Day';

    $('#selectedDate').value = date;
    $('#dateBadge').textContent = isToday(date) ? 'Today' : isFuture(date) ? 'Future date' : 'Read only';
    $('#ppqSelect').value = day.ppq || '';
    $('#dayTypeSelect').value = day.dayType || 'Work Day';
    $('#outcomeSelect').value = OUTCOMES.includes($('#outcomeSelect').value) ? $('#outcomeSelect').value : 'Contacted';
    $('#dayStatusChip').textContent = day.dayType;

    $('#keyModeButton').classList.toggle('active', day.mode === 'keys');
    $('#tallyModeButton').classList.toggle('active', day.mode === 'tally');
    $('#keyModeButton').disabled = !editable || day.modeLocked;
    $('#tallyModeButton').disabled = !editable || day.modeLocked;
    $('#modeLockPill').textContent = day.modeLocked ? `${day.mode === 'keys' ? 'Key Tracker' : 'Tally Counter'} locked` : editable ? 'Choose once today' : 'View only';
    $('#modeLockPill').classList.toggle('locked', day.modeLocked);
    $('#modeHelp').textContent = day.modeLocked
      ? `${day.mode === 'keys' ? 'Key Tracker' : 'Tally Counter'} is saved only for ${formatDate(date)}. A new date starts unselected.`
      : editable ? 'Choose once for this workday. Tomorrow starts unselected.' : 'This date is available for review. Only today can be changed.';

    const title = day.mode === 'keys' ? 'Key Tracker' : day.mode === 'tally' ? 'Tally Counter' : 'Choose a tracking method';
    $('#entryTitle').textContent = title;
    $('#entrySubtitle').textContent = day.modeLocked ? 'This choice cannot be changed again for the selected date.' : 'Your choice applies only to the selected date.';
    $('#unselectedArea').classList.toggle('hidden', Boolean(day.mode));
    $('#keyEntryArea').classList.toggle('hidden', day.mode !== 'keys');
    $('#tallyEntryArea').classList.toggle('hidden', day.mode !== 'tally');

    $('#ppqSelect').disabled = !editable;
    $('#dayTypeSelect').disabled = !editable;
    $('#outcomeSelect').disabled = !editable || !workday || !day.modeLocked;
    $('#keyInput').disabled = !editable || !workday || day.mode !== 'keys';
    $('#addKeysButton').disabled = !editable || !workday || day.mode !== 'keys';
    $('#clearKeyInput').disabled = !editable || day.mode !== 'keys';
    $$('[data-tally]').forEach(button => { button.disabled = !editable || !workday || day.mode !== 'tally'; });
    $('#customTallyInput').disabled = !editable || !workday || day.mode !== 'tally';
    $('#addCustomTally').disabled = !editable || !workday || day.mode !== 'tally';
    $('#undoTally').disabled = !editable || day.mode !== 'tally' || !day.entries.some(entry => entry.type === 'tally');
    $('#clearDay').disabled = !editable || !day.entries.length;

    $('#tallyTotal').textContent = summary.total.toLocaleString();
    $('#dailyTotalMetric').textContent = summary.total.toLocaleString();
    $('#dailyInteractionMetric').textContent = summary.interactions.toLocaleString();
    $('#dailyContactedMetric').textContent = summary.outcomes.Contacted.toLocaleString();
    $('#dailySnoozedMetric').textContent = summary.outcomes.Snoozed.toLocaleString();
    $('#dailyUnableMetric').textContent = summary.outcomes['Unable to Contact'].toLocaleString();

    if (!day.mode) $('#entryNotice').textContent = 'Select Key Tracker or Tally Counter before entering activity. No file is required.';
    else if (!editable) $('#entryNotice').textContent = 'This date is read-only. Use Reports or Settings to import older activity.';
    else if (!workday) $('#entryNotice').textContent = `Activity entry is disabled while the day status is ${day.dayType}.`;
    else $('#entryNotice').textContent = 'Activity saves automatically in this browser.';

    renderDailyBreakdown(summary);
    renderHistory(day, editable);
  }

  function renderDailyBreakdown(summary) {
    const total = summary.total || 1;
    $('#dailyBreakdown').innerHTML = OUTCOMES.map(outcome => {
      const value = summary.outcomes[outcome];
      const percent = Math.round((value / total) * 100);
      return `<div class="summary-row"><span>${outcome}</span><div class="summary-bar"><span style="width:${percent}%"></span></div><strong>${value}</strong></div>`;
    }).join('');
  }

  function renderHistory(day, editable) {
    const body = $('#historyBody');
    if (!day.entries.length) {
      body.innerHTML = '<tr><td class="empty-row" colspan="6">No activity has been recorded for this date.</td></tr>';
      return;
    }
    body.innerHTML = day.entries.map((entry, index) => {
      const count = Number(entry.count || (entry.keys || []).length || 0);
      const description = entry.type === 'keys' ? (entry.keys || []).join(', ') : `× ${count}`;
      const time = entry.time ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(entry.time)) : '';
      const options = OUTCOMES.map(outcome => `<option${normalizeOutcome(entry.outcome) === outcome ? ' selected' : ''}>${outcome}</option>`).join('');
      return `<tr class="group-${Number(entry.groupIndex ?? index) % 5}">
        <td>${time}</td>
        <td>${entry.type === 'keys' ? 'Key group' : 'Tally batch'}</td>
        <td class="group-cell">${escapeHtml(description)}</td>
        <td><select data-outcome-id="${entry.id}" ${editable ? '' : 'disabled'}>${options}</select></td>
        <td>Interaction ${index + 1}</td>
        <td><button class="button button-danger" data-delete-id="${entry.id}" type="button" ${editable ? '' : 'disabled'}>Remove</button></td>
      </tr>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function renderWeek() {
    const anchor = state.weekDate || state.selectedDate;
    const start = startOfWeek(anchor);
    $('#weekDate').value = anchor;
    const cards = rangeDates(start, addDays(start, 6)).map(date => {
      const summary = daySummary(date);
      const dayName = formatDate(date, { weekday: 'long' });
      const method = summary.method === 'keys' ? 'Key Tracker' : summary.method === 'tally' ? 'Tally Counter' : 'Not selected';
      return `<article class="card week-day${isToday(date) ? ' today' : ''}">
        <h3>${dayName}</h3><div class="date">${formatDate(date)}</div>
        <div class="week-method">${method} · ${summary.dayType}</div>
        <div class="week-stats">
          <div class="week-stat"><span>Total</span><strong>${summary.total}</strong></div>
          <div class="week-stat"><span>Interactions</span><strong>${summary.interactions}</strong></div>
          <div class="week-stat"><span>Contacted</span><strong>${summary.outcomes.Contacted}</strong></div>
          <div class="week-stat"><span>Unable</span><strong>${summary.outcomes['Unable to Contact']}</strong></div>
        </div>
      </article>`;
    }).join('');
    $('#weekGrid').innerHTML = cards;
  }

  function renderDashboard() {
    const start = $('#dashboardStart').value || startOfMonth();
    const end = $('#dashboardEnd').value || endOfMonth();
    $('#dashboardStart').value = start;
    $('#dashboardEnd').value = end;
    const summaries = rangeSummaries(start, end);
    const totals = summaries.reduce((acc, item) => {
      acc.total += item.total;
      acc.interactions += item.interactions;
      acc.workDays += item.dayType === 'Work Day' && item.method ? 1 : 0;
      OUTCOMES.forEach(outcome => { acc.outcomes[outcome] += item.outcomes[outcome]; });
      return acc;
    }, { total: 0, interactions: 0, workDays: 0, outcomes: { Contacted: 0, Snoozed: 0, 'Unable to Contact': 0 } });
    const average = totals.workDays ? (totals.total / totals.workDays).toFixed(1) : '0';
    const contactRate = totals.total ? `${Math.round((totals.outcomes.Contacted / totals.total) * 100)}%` : '0%';
    const metrics = $('#dashboardMetrics');
    metrics.classList.toggle('compact', Boolean(state.settings.compactDashboard));
    metrics.innerHTML = `
      <div class="dashboard-metric"><span>Total keys</span><strong>${totals.total.toLocaleString()}</strong></div>
      <div class="dashboard-metric"><span>Interactions</span><strong>${totals.interactions.toLocaleString()}</strong></div>
      <div class="dashboard-metric"><span>Tracked workdays</span><strong>${totals.workDays}</strong></div>
      <div class="dashboard-metric"><span>Daily average</span><strong>${average}</strong></div>
      <div class="dashboard-metric full"><span>Contact rate</span><strong>${contactRate}</strong></div>`;

    const outcomeMax = Math.max(...Object.values(totals.outcomes), 1);
    $('#outcomeChart').innerHTML = OUTCOMES.map(outcome => `<div class="chart-row"><span>${outcome}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.round((totals.outcomes[outcome] / outcomeMax) * 100)}%"></div></div><strong>${totals.outcomes[outcome]}</strong></div>`).join('');

    const activeDays = summaries.filter(item => item.total > 0);
    const maxDaily = Math.max(...activeDays.map(item => item.total), 1);
    $('#dailyChart').innerHTML = activeDays.length
      ? activeDays.map(item => `<div class="daily-column" title="${formatDate(item.date)}: ${item.total}"><strong>${item.total}</strong><div class="daily-bar" style="height:${Math.max(3, Math.round((item.total / maxDaily) * 190))}px"></div><span>${formatDate(item.date, { month: 'short', day: 'numeric' })}</span></div>`).join('')
      : '<div class="empty-row">No activity is available in this range.</div>';
  }

  function reportRows() {
    const start = $('#reportStart').value || startOfMonth();
    const end = $('#reportEnd').value || endOfMonth();
    $('#reportStart').value = start;
    $('#reportEnd').value = end;
    return rangeSummaries(start, end).filter(item => item.method || item.total || item.dayType !== 'Work Day');
  }

  function renderReports() {
    const rows = reportRows();
    $('#reportBody').innerHTML = rows.length ? rows.map(item => `<tr>
      <td>${formatDate(item.date)}</td>
      <td>${item.method === 'keys' ? 'Key Tracker' : item.method === 'tally' ? 'Tally Counter' : ''}</td>
      <td>${escapeHtml(item.ppq || '')}</td>
      <td>${escapeHtml(item.dayType)}</td>
      <td>${item.total}</td>
      <td>${item.interactions}</td>
      <td>${item.outcomes.Contacted}</td>
      <td>${item.outcomes.Snoozed}</td>
      <td>${item.outcomes['Unable to Contact']}</td>
    </tr>`).join('') : '<tr><td class="empty-row" colspan="9">No report data is available in this range.</td></tr>';
  }

  function exportCsv() {
    const rows = reportRows();
    const headers = ['Date', 'Method', 'PPQ', 'Day Status', 'Total Keys', 'Interactions', 'Contacted', 'Snoozed', 'Unable to Contact'];
    const lines = [headers, ...rows.map(item => [
      item.date,
      item.method === 'keys' ? 'Key Tracker' : item.method === 'tally' ? 'Tally Counter' : '',
      item.ppq,
      item.dayType,
      item.total,
      item.interactions,
      item.outcomes.Contacted,
      item.outcomes.Snoozed,
      item.outcomes['Unable to Contact']
    ])].map(row => row.map(escapeCsv).join(','));
    downloadBlob(lines.join('\n'), `Annual_Key_Tracker_Report_${$('#reportStart').value}_to_${$('#reportEnd').value}.csv`, 'text/csv;charset=utf-8');
  }

  async function exportExcel() {
    try {
      await ensureXlsx();
    } catch (error) {
      console.error(error);
      toast('Excel export is unavailable. Exporting CSV instead.');
      return exportCsv();
    }
    const rows = reportRows().map(item => ({
      Date: item.date,
      Method: item.method === 'keys' ? 'Key Tracker' : item.method === 'tally' ? 'Tally Counter' : '',
      PPQ: item.ppq,
      'Day Status': item.dayType,
      'Total Keys': item.total,
      Interactions: item.interactions,
      Contacted: item.outcomes.Contacted,
      Snoozed: item.outcomes.Snoozed,
      'Unable to Contact': item.outcomes['Unable to Contact']
    }));
    const detailRows = [];
    Object.keys(state.days).sort().forEach(date => {
      const day = getDay(date, false);
      day.entries.forEach((entry, index) => detailRows.push({
        Date: date,
        Method: day.mode === 'keys' ? 'Key Tracker' : day.mode === 'tally' ? 'Tally Counter' : '',
        PPQ: day.ppq,
        'Day Status': day.dayType,
        Interaction: index + 1,
        Type: entry.type === 'keys' ? 'Key Group' : 'Tally Batch',
        Keys: (entry.keys || []).join(', '),
        Count: Number(entry.count || (entry.keys || []).length || 0),
        Outcome: normalizeOutcome(entry.outcome),
        Time: entry.time || ''
      }));
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Daily Summary');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), 'Activity Detail');
    XLSX.writeFile(workbook, `Annual_Key_Tracker_Report_${$('#reportStart').value}_to_${$('#reportEnd').value}.xlsx`);
  }

  function downloadBackup() {
    const backup = { ...state, exportedAt: new Date().toISOString(), app: 'Annual Key Tracker GitHub' };
    downloadBlob(JSON.stringify(backup, null, 2), `Annual_Key_Tracker_Backup_${todayISO()}.json`, 'application/json;charset=utf-8');
    toast('Backup downloaded.');
  }

  async function importBackup(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || typeof parsed !== 'object' || !parsed.days) throw new Error('This is not a recognized tracker backup.');
      const importedDays = {};
      Object.entries(parsed.days).forEach(([date, day]) => {
        const validDate = parseDate(date);
        if (validDate) importedDays[validDate] = sanitizeDay(day);
      });
      state = {
        ...defaultState(),
        ...parsed,
        days: importedDays,
        settings: { ...defaultState().settings, ...(parsed.settings || {}) },
        selectedDate: todayISO(),
        weekDate: todayISO(),
        welcomeDone: true
      };
      saveState('Backup imported');
      applySettings();
      closeOverlays();
      renderAll();
      toast(`${Object.keys(importedDays).length} day${Object.keys(importedDays).length === 1 ? '' : 's'} imported.`);
    } catch (error) {
      console.error(error);
      toast(error.message || 'The backup could not be imported.');
    }
  }

  async function importSpreadsheet(file) {
    try {
      await ensureXlsx();
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      let imported = 0;
      let skipped = 0;
      workbook.SheetNames.forEach(sheetName => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
        rows.forEach(row => {
          const normalized = {};
          Object.entries(row).forEach(([key, value]) => { normalized[String(key).trim().toLowerCase()] = value; });
          const date = parseDate(normalized.date || normalized['work date'] || normalized.day || normalized['activity date']);
          if (!date) { skipped += 1; return; }
          const day = getDay(date);
          const mode = normalizeMode(normalized.method || normalized.mode || normalized.type || normalized['tracking method']);
          const keyText = normalized.keys || normalized.key || normalized['key id'] || normalized['key(s)'] || normalized.activity || '';
          const keys = keyTokens(keyText);
          const count = Math.floor(Number(normalized.count || normalized.total || normalized['total keys'] || keys.length || 0));
          const outcome = normalizeOutcome(normalized.outcome || normalized.result || normalized.status);
          if (normalized.ppq) day.ppq = String(normalized.ppq);
          if (normalized['day status'] || normalized['day type']) day.dayType = String(normalized['day status'] || normalized['day type']);
          const resolvedMode = mode || (keys.length ? 'keys' : count > 0 ? 'tally' : null);
          if (!resolvedMode) { skipped += 1; return; }
          if (!day.mode) { day.mode = resolvedMode; day.modeLocked = true; }
          const entryCount = resolvedMode === 'keys' ? keys.length : count;
          if (entryCount < 1) { skipped += 1; return; }
          day.entries.push({
            id: createId('import'),
            type: resolvedMode,
            keys: resolvedMode === 'keys' ? keys : [],
            count: entryCount,
            outcome,
            time: safeImportedTime(date, normalized.time),
            groupIndex: day.entries.length % 5,
            importedFrom: file.name
          });
          imported += 1;
        });
      });
      if (!imported) throw new Error('No recognizable activity rows were found. Include a Date column and a Keys or Count column.');
      state.welcomeDone = true;
      saveState('Spreadsheet imported');
      closeOverlays();
      renderAll();
      toast(`${imported} activity row${imported === 1 ? '' : 's'} imported${skipped ? `; ${skipped} row${skipped === 1 ? '' : 's'} skipped` : ''}.`);
    } catch (error) {
      console.error(error);
      toast(error.message || 'The spreadsheet could not be imported.');
    }
  }

  function resetAllData() {
    if (!confirm('Reset all tracker data and settings in this browser? Download a backup first if you need the current data.')) return;
    state = defaultState();
    localStorage.removeItem(STORAGE_KEY);
    applySettings();
    closeOverlays();
    renderAll();
    showWelcome();
    toast('All local tracker data was reset.');
  }

  function openSettings() {
    $('#settingsOverlay').classList.add('open');
    $('#settingsOverlay').setAttribute('aria-hidden', 'false');
  }

  function showWelcome() {
    $('#welcomeOverlay').classList.add('open');
    $('#welcomeOverlay').setAttribute('aria-hidden', 'false');
  }

  function closeOverlays() {
    $$('.overlay').forEach(overlay => {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
    });
  }

  function applySettings() {
    const theme = THEMES.includes(state.settings.theme) ? state.settings.theme : 'sea-breeze';
    document.documentElement.dataset.theme = theme;
    $('#themeSelect').value = theme;
    $('#compactMode').checked = Boolean(state.settings.compactDashboard);
  }

  function renderAll() {
    state.days[state.selectedDate] = sanitizeDay(getDay(state.selectedDate));
    renderToday();
    if (activeView === 'week') renderWeek();
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'reports') renderReports();
  }

  function bindEvents() {
    $$('.nav-tab').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $('#settingsButton').addEventListener('click', openSettings);
    $('#closeSettings').addEventListener('click', closeOverlays);
    $('#settingsOverlay').addEventListener('click', event => { if (event.target === $('#settingsOverlay')) closeOverlays(); });

    $('#previousDay').addEventListener('click', () => { state.selectedDate = addDays(state.selectedDate, -1); saveState(); renderAll(); });
    $('#nextDay').addEventListener('click', () => { state.selectedDate = addDays(state.selectedDate, 1); saveState(); renderAll(); });
    $('#selectedDate').addEventListener('change', event => { if (event.target.value) { state.selectedDate = event.target.value; saveState(); renderAll(); } });
    $('#goToday').addEventListener('click', () => { state.selectedDate = todayISO(); saveState(); renderAll(); });

    $('#keyModeButton').addEventListener('click', () => chooseMode('keys'));
    $('#tallyModeButton').addEventListener('click', () => chooseMode('tally'));
    $('#ppqSelect').addEventListener('change', event => { const day = getDay(state.selectedDate); if (!canEdit(state.selectedDate)) return; day.ppq = event.target.value; saveState(); renderAll(); });
    $('#dayTypeSelect').addEventListener('change', event => { const day = getDay(state.selectedDate); if (!canEdit(state.selectedDate)) return; day.dayType = event.target.value; saveState(); renderAll(); });
    $('#addKeysButton').addEventListener('click', addKeyBatch);
    $('#clearKeyInput').addEventListener('click', () => { $('#keyInput').value = ''; $('#keyInput').focus(); });
    $('#keyInput').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') addKeyBatch(); });
    $$('[data-tally]').forEach(button => button.addEventListener('click', () => addTally(button.dataset.tally)));
    $('#addCustomTally').addEventListener('click', () => addTally($('#customTallyInput').value));
    $('#customTallyInput').addEventListener('keydown', event => { if (event.key === 'Enter') addTally(event.target.value); });
    $('#undoTally').addEventListener('click', undoLastTally);
    $('#clearDay').addEventListener('click', clearSelectedDay);
    $('#copyDaySummary').addEventListener('click', copyDaySummary);
    $('#historyBody').addEventListener('click', event => {
      const button = event.target.closest('[data-delete-id]');
      if (button) removeEntry(button.dataset.deleteId);
    });
    $('#historyBody').addEventListener('change', event => {
      const select = event.target.closest('[data-outcome-id]');
      if (select) updateEntryOutcome(select.dataset.outcomeId, select.value);
    });

    $('#previousWeek').addEventListener('click', () => { state.weekDate = addDays(state.weekDate || todayISO(), -7); saveState(); renderWeek(); });
    $('#nextWeek').addEventListener('click', () => { state.weekDate = addDays(state.weekDate || todayISO(), 7); saveState(); renderWeek(); });
    $('#weekDate').addEventListener('change', event => { if (event.target.value) { state.weekDate = event.target.value; saveState(); renderWeek(); } });

    ['dashboardStart', 'dashboardEnd'].forEach(id => $(`#${id}`).addEventListener('change', renderDashboard));
    ['reportStart', 'reportEnd'].forEach(id => $(`#${id}`).addEventListener('change', renderReports));
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#exportExcel').addEventListener('click', exportExcel);
    $('#printReport').addEventListener('click', () => window.print());

    $('#themeSelect').addEventListener('change', event => { state.settings.theme = event.target.value; applySettings(); saveState(); renderAll(); });
    $('#compactMode').addEventListener('change', event => { state.settings.compactDashboard = event.target.checked; saveState(); renderAll(); });
    $('#downloadBackup').addEventListener('click', downloadBackup);
    $('#importBackupButton').addEventListener('click', () => $('#backupFileInput').click());
    $('#importSpreadsheetButton').addEventListener('click', () => $('#spreadsheetFileInput').click());
    $('#backupFileInput').addEventListener('change', event => { const [file] = event.target.files; if (file) importBackup(file); event.target.value = ''; });
    $('#spreadsheetFileInput').addEventListener('change', event => { const [file] = event.target.files; if (file) importSpreadsheet(file); event.target.value = ''; });
    $('#resetAllData').addEventListener('click', resetAllData);

    $('#skipImport').addEventListener('click', () => { state.welcomeDone = true; saveState(); closeOverlays(); toast('Ready. No file was required.'); });
    $('#welcomeImport').addEventListener('click', () => { closeOverlays(); openSettings(); setTimeout(() => $('#importSpreadsheetButton').focus(), 50); });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      installPrompt = event;
      $('#installApp').hidden = false;
    });
    $('#installApp').addEventListener('click', async () => {
      if (!installPrompt) return;
      installPrompt.prompt();
      await installPrompt.userChoice;
      installPrompt = null;
      $('#installApp').hidden = true;
    });

    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeOverlays(); });
  }

  function initialize() {
    $('#dashboardStart').value = startOfMonth();
    $('#dashboardEnd').value = endOfMonth();
    $('#reportStart').value = startOfMonth();
    $('#reportEnd').value = endOfMonth();
    bindEvents();
    applySettings();
    renderAll();
    if (!state.welcomeDone) showWelcome();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker registration failed:', error));
    }
  }

  initialize();
})();

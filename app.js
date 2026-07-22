(() => {
  'use strict';

  const STORAGE_KEY = 'annual-key-tracker-github-v1';
  const APP_VERSION = 7;
  const THEMES = ['sea-breeze', 'classic-blue', 'sage-stone', 'warm-sand', 'charcoal-gold'];
  const OUTCOMES = ['Contacted', 'Snoozed', 'Unable to Contact'];
  const WORKFLOWS = ['PA PPQ', 'Appeals PPQ'];
  const NON_WORK_STATUSES = ['Scheduled Off', 'PTO', 'Holiday', 'Leave'];
  const NOTE_TYPES = ['Meeting', 'Lunch', 'Training', 'System Issue', 'Coaching', 'Other'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  let state = null;
  let activeView = 'today';
  let installPrompt = null;
  let xlsxLoadPromise = null;
  let duplicatePromptResolver = null;
  let duplicatePromptContext = null;

  function detectTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch (error) { return 'UTC'; }
  }

  function validTimeZone(value) {
    if (!value) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return true; }
    catch (error) { return false; }
  }

  function activeTimeZone() {
    const detected = detectTimeZone();
    if (!state?.settings || state.settings.automaticTimeZone !== false) return detected;
    return validTimeZone(state.settings.timeZone) ? state.settings.timeZone : detected;
  }

  function dateISOInTimeZone(value = new Date(), timeZone = detectTimeZone()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: validTimeZone(timeZone) ? timeZone : 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(value);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  const todayISO = () => dateISOInTimeZone(new Date(), activeTimeZone());

  function defaultState() {
    const detected = detectTimeZone();
    const today = dateISOInTimeZone(new Date(), detected);
    return {
      version: APP_VERSION,
      selectedDate: today,
      weekDate: today,
      customStart: `${today.slice(0, 7)}-01`,
      customEnd: today,
      lastMode: null,
      lastWorkflow: '',
      lastOutcome: 'Contacted',
      welcomeDone: false,
      employeeName: '',
      settings: {
        theme: 'sea-breeze',
        compactDashboard: false,
        automaticTimeZone: true,
        timeZone: detected,
        holidays: []
      },
      days: {}
    };
  }

  function dayTemplate() {
    return {
      mode: null,
      modeLocked: false,
      modeInherited: false,
      statusOverride: '',
      entries: [],
      notes: []
    };
  }

  function normalizeOutcome(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('snooz')) return 'Snoozed';
    if (text.includes('unable') || text.includes('no contact') || text === 'utc') return 'Unable to Contact';
    return 'Contacted';
  }

  function normalizeWorkflow(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('appeal')) return 'Appeals PPQ';
    if (text === 'pa ppq' || (text.includes('pa') && text.includes('ppq'))) return 'PA PPQ';
    return '';
  }

  function normalizeMode(value) {
    const text = String(value || '').trim().toLowerCase();
    if (text.includes('tally') || text === 'count') return 'tally';
    if (text.includes('key')) return 'keys';
    return null;
  }

  function sanitizeDay(day) {
    const source = day && typeof day === 'object' ? day : {};
    const fallbackWorkflow = normalizeWorkflow(source.workflow || source.ppq);
    const clean = { ...dayTemplate(), ...source };
    clean.mode = normalizeMode(clean.mode);
    clean.statusOverride = NON_WORK_STATUSES.includes(clean.statusOverride)
      ? clean.statusOverride
      : NON_WORK_STATUSES.includes(source.dayType) ? source.dayType : '';
    clean.entries = Array.isArray(source.entries) ? source.entries.flatMap((entry, index) => {
      const type = normalizeMode(entry.type || source.mode) || 'tally';
      const keys = Array.isArray(entry.keys) ? entry.keys.map(value => String(value).trim()).filter(Boolean) : [];
      const groupIndex = Number.isFinite(Number(entry.groupIndex)) ? Number(entry.groupIndex) : index % 5;
      const groupId = entry.groupId || entry.submissionId || entry.id || createId('group');
      const common = {
        ...entry,
        type,
        outcome: normalizeOutcome(entry.outcome),
        workflow: normalizeWorkflow(entry.workflow || entry.outcomesWorkflow || entry.ppq || fallbackWorkflow),
        groupId,
        groupIndex
      };
      if (type === 'keys') {
        return keys.map((key, keyIndex) => ({
          ...common,
          id: keyIndex === 0 ? (entry.id || createId('key')) : createId('key'),
          keys: [key],
          count: 1
        }));
      }
      const count = Math.max(1, Math.floor(Number(entry.count || 1)));
      return [{
        ...common,
        id: entry.id || createId('tally'),
        keys: [],
        count
      }];
    }) : [];
    clean.notes = Array.isArray(source.notes) ? source.notes.map(note => ({ ...note, id: note.id || createId('note') })) : [];
    if (!clean.mode && clean.entries.length) clean.mode = clean.entries[0].type;
    clean.modeLocked = Boolean(clean.entries.length || (source.modeLocked && clean.mode));
    clean.modeInherited = Boolean(!clean.modeLocked && clean.mode && source.modeInherited);
    delete clean.ppq;
    delete clean.dayType;
    return clean;
  }

  function deriveLatestMode(days) {
    return Object.keys(days).sort().reverse().map(date => sanitizeDay(days[date]).mode).find(Boolean) || null;
  }

  function deriveLatestWorkflow(days) {
    const dates = Object.keys(days).sort().reverse();
    for (const date of dates) {
      const entries = sanitizeDay(days[date]).entries.slice().reverse();
      const found = entries.map(entry => normalizeWorkflow(entry.workflow)).find(Boolean);
      if (found) return found;
    }
    return '';
  }

  function loadState() {
    const defaults = defaultState();
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return defaults;
      const settings = { ...defaults.settings, ...(parsed.settings || {}) };
      settings.automaticTimeZone = settings.automaticTimeZone !== false;
      settings.timeZone = validTimeZone(settings.timeZone) ? settings.timeZone : detectTimeZone();
      settings.holidays = [...new Set((Array.isArray(settings.holidays) ? settings.holidays : [])
        .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
      const days = {};
      Object.entries(parsed.days || {}).forEach(([date, day]) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(date)) days[date] = sanitizeDay(day);
      });
      return {
        ...defaults,
        ...parsed,
        version: APP_VERSION,
        selectedDate: defaults.selectedDate,
        weekDate: defaults.weekDate,
        settings,
        days,
        lastMode: normalizeMode(parsed.lastMode) || deriveLatestMode(days),
        lastWorkflow: normalizeWorkflow(parsed.lastWorkflow) || deriveLatestWorkflow(days),
        lastOutcome: normalizeOutcome(parsed.lastOutcome || 'Contacted')
      };
    } catch (error) {
      console.error('Could not load tracker data:', error);
      return defaults;
    }
  }

  state = loadState();

  function saveState(message = 'Saved locally') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      const status = $('#saveStatus');
      if (status) {
        status.textContent = message;
        clearTimeout(saveState.timer);
        saveState.timer = setTimeout(() => { status.textContent = 'Saved locally'; }, 1500);
      }
    } catch (error) {
      console.error('Could not save tracker data:', error);
      toast('This browser could not save the tracker. Download a backup now.');
    }
  }

  function getDay(date, create = true) {
    if (!state.days[date] && create) state.days[date] = dayTemplate();
    if (state.days[date]) state.days[date] = sanitizeDay(state.days[date]);
    return state.days[date] || dayTemplate();
  }

  function isToday(date) { return date === todayISO(); }
  function isFuture(date) { return date > todayISO(); }
  function isPast(date) { return date < todayISO(); }
  function canEditActivity(date) { return isToday(date); }

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
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return toISODate(d);
  }

  function startOfMonth(date = todayISO()) { return `${date.slice(0, 7)}-01`; }

  function endOfMonth(date = todayISO()) {
    const d = new Date(`${date.slice(0, 7)}-01T12:00:00`);
    d.setMonth(d.getMonth() + 1);
    d.setDate(0);
    return toISODate(d);
  }

  function isWeekend(date) {
    const day = new Date(`${date}T12:00:00`).getDay();
    return day === 0 || day === 6;
  }

  function holidayDates() {
    return Array.isArray(state.settings.holidays) ? state.settings.holidays : [];
  }

  function isSavedHoliday(date) { return holidayDates().includes(date); }

  function isExcludedHoliday(date) {
    const day = getDay(date, false);
    return isSavedHoliday(date) || day.statusOverride === 'Holiday';
  }

  function rangeDates(start, end) {
    if (!start || !end || start > end) return [];
    const dates = [];
    for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
    return dates;
  }

  function includedViewDates(start, end) {
    return rangeDates(start, end).filter(date => !isWeekend(date) && !isExcludedHoliday(date));
  }

  function previousModeBefore(date) {
    const dates = Object.keys(state.days).filter(item => item < date).sort().reverse();
    for (const item of dates) {
      const mode = getDay(item, false).mode;
      if (mode) return mode;
    }
    return state.lastMode;
  }

  function ensureTodayModeDefault() {
    const date = todayISO();
    const day = getDay(date);
    if (!day.mode && !day.entries.length) {
      const previous = previousModeBefore(date);
      if (previous) {
        day.mode = previous;
        day.modeInherited = true;
        day.modeLocked = false;
      }
    }
  }

  function currentTimeValue(timeZone = activeTimeZone()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${map.hour}:${map.minute}`;
  }

  function timeParts(iso, timeZone = activeTimeZone()) {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: validTimeZone(timeZone) ? timeZone : activeTimeZone(),
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return { hour: Number(map.hour), minute: Number(map.minute), value: `${map.hour}:${map.minute}` };
  }

  function formatClockTime(value, timeZone = activeTimeZone()) {
    if (!value) return '';
    if (/^\d{2}:\d{2}$/.test(value)) {
      const [hour, minute] = value.split(':').map(Number);
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
        .format(new Date(2020, 0, 1, hour, minute));
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric', minute: '2-digit', timeZone: validTimeZone(timeZone) ? timeZone : activeTimeZone()
    }).format(date);
  }

  function hourLabel(hour) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, hour, 0));
  }

  function createId(prefix = 'entry') {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function keyTokens(text) {
    return String(text || '')
      .split(/[\s,;|]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  function normalizedKey(value) {
    return String(value || '').trim().toUpperCase();
  }

  function nextGroupIndex(day) {
    const previous = [...day.entries].reverse().find(entry => Number.isFinite(Number(entry.groupIndex)));
    return previous ? (Number(previous.groupIndex) + 1) % 5 : 0;
  }

  function entryInteractions(entry) {
    return entry.type === 'keys' ? Math.max(0, (entry.keys || []).length) : Math.max(0, Number(entry.count || 0));
  }

  function entryKeyCount(entry) {
    return entry.type === 'keys' ? (entry.keys || []).length : 0;
  }

  function daySummary(date) {
    const day = sanitizeDay(getDay(date, false));
    const outcomes = { Contacted: 0, Snoozed: 0, 'Unable to Contact': 0 };
    const workflows = { 'PA PPQ': 0, 'Appeals PPQ': 0, 'Not selected': 0 };
    let totalInteractions = 0;
    let totalKeys = 0;
    day.entries.forEach(entry => {
      const units = entryInteractions(entry);
      totalInteractions += units;
      totalKeys += entryKeyCount(entry);
      outcomes[normalizeOutcome(entry.outcome)] += units;
      const workflow = normalizeWorkflow(entry.workflow) || 'Not selected';
      workflows[workflow] += units;
    });
    const provisional = { date, day, totalInteractions, totalKeys, outcomes, workflows };
    return {
      date,
      method: day.mode,
      status: effectiveStatus(date, provisional),
      statusOverride: day.statusOverride,
      totalInteractions,
      totalKeys,
      outcomes,
      workflows,
      entries: day.entries,
      notes: day.notes
    };
  }

  function effectiveStatus(date, summaryOrNull = null) {
    const day = summaryOrNull?.day || getDay(date, false);
    const total = summaryOrNull?.totalInteractions ?? day.entries.reduce((sum, entry) => sum + entryInteractions(entry), 0);
    if (day.statusOverride) return day.statusOverride;
    if (total > 0) return 'Work Day';
    if (isSavedHoliday(date)) return 'Holiday';
    if (isPast(date)) return 'Absent';
    if (isToday(date)) return 'In Progress';
    return 'Not set';
  }

  function statusCountsAsWorkday(status, totalInteractions) {
    return status === 'Work Day' && totalInteractions > 0;
  }

  function toast(message) {
    const region = $('#toastRegion');
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    region.append(item);
    setTimeout(() => item.remove(), 3400);
  }

  function closeDuplicatePrompt(action = 'cancel') {
    const overlay = $('#duplicateOverlay');
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    const resolver = duplicatePromptResolver;
    duplicatePromptResolver = null;
    const context = duplicatePromptContext;
    duplicatePromptContext = null;
    if (resolver) resolver({ action, context });
  }

  function promptForDuplicateKeys(duplicates, existingDuplicateKeys) {
    const uniqueDuplicates = [...new Set(duplicates.map(item => normalizedKey(item.key)))];
    const existingSet = new Set(existingDuplicateKeys.map(normalizedKey));
    duplicatePromptContext = { duplicates: uniqueDuplicates, existing: [...existingSet] };
    $('#duplicateMessage').textContent = `${duplicates.length} duplicate ${duplicates.length === 1 ? 'key was' : 'keys were'} found in this submission.`;
    $('#duplicateKeyList').innerHTML = uniqueDuplicates.map(key => {
      const label = existingSet.has(key) ? 'Already recorded for today' : 'Repeated in this paste';
      return `<div class="duplicate-key-item"><strong>${escapeHtml(key)}</strong><span>${label}</span></div>`;
    }).join('');
    $('#duplicateViewExisting').disabled = existingSet.size === 0;
    $('#duplicateOverlay').classList.add('open');
    $('#duplicateOverlay').setAttribute('aria-hidden', 'false');
    return new Promise(resolve => { duplicatePromptResolver = resolve; });
  }

  function showExistingDuplicateRows(keys) {
    const wanted = new Set(keys.map(normalizedKey));
    state.selectedDate = todayISO();
    activeView = 'today';
    $$('.view').forEach(section => section.classList.toggle('active', section.id === 'view-today'));
    $('#mainPeriodControls').classList.remove('hidden');
    $('#mainViewSelect').value = 'today';
    renderAll();
    setTimeout(() => {
      const rows = $$('[data-history-key]');
      rows.forEach(row => row.classList.remove('duplicate-highlight'));
      const matches = rows.filter(row => wanted.has(normalizedKey(row.dataset.historyKey)));
      matches.forEach(row => row.classList.add('duplicate-highlight'));
      const first = matches[0] || $('.history-card');
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => matches.forEach(row => row.classList.remove('duplicate-highlight')), 5000);
    }, 80);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
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

  function chooseModeForDate(date, mode) {
    const day = getDay(date);
    if (!canEditActivity(date) || day.modeLocked) return;
    if (day.modeInherited && day.mode === mode) return;
    day.mode = mode;
    day.modeLocked = true;
    day.modeInherited = false;
    state.lastMode = mode;
    saveState(`${mode === 'keys' ? 'Key Tracker' : 'Tally Counter'} selected`);
    renderAll();
  }

  function chooseMode(mode) {
    chooseModeForDate(state.selectedDate, mode);
  }

  function lockModeForFirstEntry(day) {
    if (!day.mode) return false;
    if (!day.modeLocked) {
      day.modeLocked = true;
      day.modeInherited = false;
      state.lastMode = day.mode;
    }
    return true;
  }

  function selectedWorkflow(selector = '#workflowSelect') {
    return normalizeWorkflow($(selector)?.value);
  }

  function selectedOutcome(selector = '#outcomeSelect') {
    return normalizeOutcome($(selector)?.value || state.lastOutcome);
  }

  async function addKeyBatchForDate(date, inputSelector, workflowSelector, outcomeSelector) {
    const day = getDay(date);
    if (!canEditActivity(date) || day.mode !== 'keys') return;
    const input = $(inputSelector);
    const keys = keyTokens(input?.value);
    if (!keys.length) return toast('Paste or type at least one key.');

    const existing = new Set(day.entries.flatMap(entry => (entry.keys || []).map(normalizedKey)));
    const seenInPaste = new Set();
    const duplicates = [];
    const nonDuplicates = [];
    const existingDuplicateKeys = [];

    keys.forEach(key => {
      const normalized = normalizedKey(key);
      const alreadyRecorded = existing.has(normalized);
      const repeatedInPaste = seenInPaste.has(normalized);
      if (alreadyRecorded || repeatedInPaste) {
        duplicates.push({ key, alreadyRecorded, repeatedInPaste });
        if (alreadyRecorded) existingDuplicateKeys.push(normalized);
      } else {
        nonDuplicates.push(key);
      }
      seenInPaste.add(normalized);
    });

    let keysToAdd = keys;
    if (duplicates.length) {
      const response = await promptForDuplicateKeys(duplicates, existingDuplicateKeys);
      if (response.action === 'cancel') return;
      if (response.action === 'view') {
        showExistingDuplicateRows(response.context?.existing || []);
        return;
      }
      if (response.action === 'skip') keysToAdd = nonDuplicates;
    }

    if (!keysToAdd.length) return toast('No new keys remain after skipping duplicates.');
    lockModeForFirstEntry(day);
    day.statusOverride = '';
    const workflow = selectedWorkflow(workflowSelector);
    const outcome = selectedOutcome(outcomeSelector);
    const submittedAt = new Date().toISOString();
    const timeZone = activeTimeZone();
    const groupId = createId('group');
    const groupIndex = nextGroupIndex(day);

    keysToAdd.forEach(key => {
      day.entries.push({
        id: createId('key'),
        type: 'keys',
        keys: [key],
        count: 1,
        outcome,
        workflow,
        time: submittedAt,
        timeZone,
        groupId,
        groupIndex
      });
    });

    if (workflow) state.lastWorkflow = workflow;
    state.lastOutcome = outcome;
    if (input) input.value = '';
    saveState();
    renderAll();
    toast(`${keysToAdd.length} interaction${keysToAdd.length === 1 ? '' : 's'} added in one group.`);
  }

  function addKeyBatch() {
    addKeyBatchForDate(state.selectedDate, '#keyInput', '#workflowSelect', '#outcomeSelect');
  }

  function addTallyForDate(date, count, workflowSelector, outcomeSelector, customInputSelector = '') {
    const day = getDay(date);
    const amount = Math.floor(Number(count));
    if (!canEditActivity(date) || day.mode !== 'tally') return;
    if (!Number.isFinite(amount) || amount < 1) return toast('Enter a number greater than zero.');
    lockModeForFirstEntry(day);
    day.statusOverride = '';
    const workflow = selectedWorkflow(workflowSelector);
    const outcome = selectedOutcome(outcomeSelector);
    day.entries.push({
      id: createId('tally'),
      type: 'tally',
      count: amount,
      keys: [],
      outcome,
      workflow,
      groupId: createId('group'),
      groupIndex: nextGroupIndex(day)
    });
    if (workflow) state.lastWorkflow = workflow;
    state.lastOutcome = outcome;
    const customInput = customInputSelector ? $(customInputSelector) : null;
    if (customInput) customInput.value = '';
    saveState();
    renderAll();
    toast(`${amount} interaction${amount === 1 ? '' : 's'} added.`);
  }

  function addTally(count) {
    addTallyForDate(state.selectedDate, count, '#workflowSelect', '#outcomeSelect', '#customTallyInput');
  }

  function undoLastTallyForDate(date) {
    const day = getDay(date);
    if (!canEditActivity(date) || day.mode !== 'tally') return;
    const index = [...day.entries].map(entry => entry.type).lastIndexOf('tally');
    if (index < 0) return toast('There is no tally batch to undo.');
    day.entries.splice(index, 1);
    saveState();
    renderAll();
    toast('Last tally batch removed.');
  }

  function undoLastTally() {
    undoLastTallyForDate(state.selectedDate);
  }

  function removeEntry(id) {
    const day = getDay(state.selectedDate);
    if (!canEditActivity(state.selectedDate)) return;
    const before = day.entries.length;
    day.entries = day.entries.filter(entry => entry.id !== id);
    if (day.entries.length === before) return;
    saveState();
    renderAll();
    toast('Entry removed.');
  }

  function updateEntryOutcome(id, outcome) {
    const day = getDay(state.selectedDate);
    if (!canEditActivity(state.selectedDate)) return;
    const entry = day.entries.find(item => item.id === id);
    if (!entry) return;
    entry.outcome = normalizeOutcome(outcome);
    saveState();
    renderAll();
  }

  function updateEntryWorkflow(id, workflow) {
    const day = getDay(state.selectedDate);
    if (!canEditActivity(state.selectedDate)) return;
    const entry = day.entries.find(item => item.id === id);
    if (!entry) return;
    entry.workflow = normalizeWorkflow(workflow);
    saveState();
    renderAll();
  }

  function addNote() {
    const date = state.selectedDate;
    const day = getDay(date);
    if (!canEditActivity(date)) return toast('Notes can be added only to today.');
    const type = NOTE_TYPES.includes($('#noteTypeSelect').value) ? $('#noteTypeSelect').value : 'Other';
    const localTime = $('#noteTimeInput').value || currentTimeValue();
    const text = $('#noteTextInput').value.trim();
    day.notes.push({ id: createId('note'), type, text, localTime, timeZone: activeTimeZone() });
    $('#noteTextInput').value = '';
    $('#noteTimeInput').value = currentTimeValue();
    saveState();
    renderAll();
    toast(`${type} note added.`);
  }

  function removeNote(id) {
    const day = getDay(state.selectedDate);
    if (!canEditActivity(state.selectedDate)) return;
    day.notes = day.notes.filter(note => note.id !== id);
    saveState();
    renderAll();
    toast('Note removed.');
  }

  function clearSelectedDay() {
    const day = getDay(state.selectedDate);
    if (!canEditActivity(state.selectedDate)) return toast('Only today can be cleared.');
    if (!day.entries.length && !day.notes.length) return toast('There is no activity or note to clear.');
    if (!confirm('Clear all activity and notes for today?')) return;
    day.entries = [];
    day.notes = [];
    saveState();
    renderAll();
    toast('Today’s activity and notes were cleared.');
  }

  function copyDaySummary() {
    const summary = daySummary(state.selectedDate);
    const text = [
      ...(state.employeeName ? [`Employee: ${state.employeeName}`] : []),
      `${formatDate(summary.date)} — ${summary.status}`,
      `Total Interactions: ${summary.totalInteractions}`,
      `Contacted: ${summary.outcomes.Contacted}`,
      `Snoozed: ${summary.outcomes.Snoozed}`,
      `Unable to Contact: ${summary.outcomes['Unable to Contact']}`,
      `PA PPQ: ${summary.workflows['PA PPQ']}`,
      `Appeals PPQ: ${summary.workflows['Appeals PPQ']}`,
      `Outcomes not selected: ${summary.workflows['Not selected']}`
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

  function updateDateStatus(value) {
    const date = state.selectedDate;
    if (isToday(date)) return;
    const day = getDay(date);
    if (value && day.entries.length) {
      const proceed = confirm(`This date already has recorded activity. Mark it as ${value} anyway?`);
      if (!proceed) {
        $('#dayTypeSelect').value = day.statusOverride || '';
        return;
      }
    }
    day.statusOverride = NON_WORK_STATUSES.includes(value) ? value : '';
    saveState(day.statusOverride ? 'Date status saved' : 'Automatic status restored');
    renderAll();
  }

  function openMenu() {
    $('#menuDrawer').classList.add('open');
    $('#menuDrawer').setAttribute('aria-hidden', 'false');
    $('#menuButton').setAttribute('aria-expanded', 'true');
    $('#menuScrim').hidden = false;
    requestAnimationFrame(() => $('#menuScrim').classList.add('open'));
  }

  function closeMenu() {
    $('#menuDrawer').classList.remove('open');
    $('#menuDrawer').setAttribute('aria-hidden', 'true');
    $('#menuButton').setAttribute('aria-expanded', 'false');
    $('#menuScrim').classList.remove('open');
    setTimeout(() => { $('#menuScrim').hidden = true; }, 180);
  }

  function switchView(view) {
    activeView = view;
    $$('.view').forEach(section => section.classList.toggle('active', section.id === `view-${view}`));
    $('#mainPeriodControls').classList.toggle('hidden', !['today', 'week'].includes(view));
    if (view === 'today' || view === 'week') $('#mainViewSelect').value = view;
    closeMenu();
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(updateStickyWorkbenchVisibility, 220);
  }

  function periodAnchor() {
    return activeView === 'week' ? (state.weekDate || todayISO()) : state.selectedDate;
  }

  function weekRangeLabel(anchor) {
    const start = startOfWeek(anchor);
    const end = addDays(start, 4);
    const sameMonth = start.slice(0, 7) === end.slice(0, 7);
    if (sameMonth) {
      return `${formatDate(start, { month: 'short', day: 'numeric' })}–${formatDate(end, { day: 'numeric', year: 'numeric' })}`;
    }
    return `${formatDate(start, { month: 'short', day: 'numeric' })}–${formatDate(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  function renderPeriodControls() {
    if (!['today', 'week'].includes(activeView)) return;
    const anchor = periodAnchor();
    $('#selectedDate').value = anchor;
    $('#mainViewSelect').value = activeView;
    $('#dateDisplayButton').textContent = activeView === 'week'
      ? weekRangeLabel(anchor)
      : isToday(anchor)
        ? `Today · ${formatDate(anchor, { month: 'short', day: 'numeric' })}`
        : formatDate(anchor, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const current = activeView === 'week'
      ? startOfWeek(anchor) === startOfWeek(todayISO())
      : isToday(anchor);
    $('#goToday').hidden = current;
  }

  function renderToday() {
    if (isToday(state.selectedDate)) ensureTodayModeDefault();
    const date = state.selectedDate;
    const day = getDay(date);
    const summary = daySummary(date);
    const editable = canEditActivity(date);

    $('#dailySummaryDate').textContent = formatDate(date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    $('#dailyStatusBadge').textContent = summary.status;
    $('#dailyStatusBadge').className = `date-status-badge status-${summary.status.toLowerCase().replaceAll(' ', '-')}`;
    $('#dailyTotalMetric').textContent = summary.totalInteractions.toLocaleString();
    $('#dailyContactedMetric').textContent = summary.outcomes.Contacted.toLocaleString();
    $('#dailySnoozedMetric').textContent = summary.outcomes.Snoozed.toLocaleString();
    $('#dailyUnableMetric').textContent = summary.outcomes['Unable to Contact'].toLocaleString();
    renderDailyBreakdown(summary);

    $('#nonWorkStatusCard').classList.toggle('hidden', editable);
    $('#dayTypeSelect').value = day.statusOverride || '';
    $('#dateStatusHelp').textContent = isPast(date)
      ? summary.status === 'Absent'
        ? 'No interactions were recorded, so this date defaults to Absent and is excluded from averages and goals. Select a reason only when needed.'
        : `Current status: ${summary.status}.`
      : `Current status: ${summary.status}. You may mark a future date as Scheduled Off, PTO, Holiday, or Leave.`;

    const chooserVisible = editable && !day.modeLocked;
    $('#modeChooser').classList.toggle('hidden', !chooserVisible);
    $('#keyModeButton').classList.toggle('active', day.mode === 'keys');
    $('#tallyModeButton').classList.toggle('active', day.mode === 'tally');
    $('#modeChooserHelp').textContent = day.modeInherited && day.mode
      ? `Continue with the previous workday’s choice or switch before the first entry.`
      : 'Choose a method to begin. There is no separate confirmation button.';

    $('#workflowSelect').value = state.lastWorkflow || '';
    $('#workflowSelect').disabled = !editable;
    $('#outcomeSelect').value = normalizeOutcome(state.lastOutcome);
    $('#outcomeSelect').disabled = !editable || !day.mode;

    $('#unselectedArea').classList.toggle('hidden', Boolean(day.mode));
    $('#keyEntryArea').classList.toggle('hidden', day.mode !== 'keys');
    $('#tallyEntryArea').classList.toggle('hidden', day.mode !== 'tally');

    $('#keyInput').disabled = !editable || day.mode !== 'keys';
    $('#addKeysButton').disabled = !editable || day.mode !== 'keys';
    $('#clearKeyInput').disabled = !editable || day.mode !== 'keys';
    $$('[data-tally]').forEach(button => { button.disabled = !editable || day.mode !== 'tally'; });
    $('#customTallyInput').disabled = !editable || day.mode !== 'tally';
    $('#addCustomTally').disabled = !editable || day.mode !== 'tally';
    $('#undoTally').disabled = !editable || day.mode !== 'tally' || !day.entries.some(entry => entry.type === 'tally');
    $('#clearDay').disabled = !editable || (!day.entries.length && !day.notes.length);
    $('#noteTypeSelect').disabled = !editable;
    $('#noteTimeInput').disabled = !editable;
    $('#noteTextInput').disabled = !editable;
    $('#addNoteButton').disabled = !editable;
    $('#tallyTotal').textContent = summary.totalInteractions.toLocaleString();

    if (!editable) $('#entryNotice').textContent = 'Activity is read-only for this date. Use Date Status above to record Scheduled Off, PTO, Holiday, or Leave.';
    else if (!day.mode) $('#entryNotice').textContent = 'Select Key Tracker or Tally Counter. No file is required.';
    else if (!day.modeLocked) $('#entryNotice').textContent = 'The previous workday’s method is ready. Enter activity to continue with it, or switch methods before the first entry.';
    else if (day.mode === 'keys') $('#entryNotice').textContent = `Each key counts as one interaction. Keys submitted together share one timestamp in ${activeTimeZone()} and save automatically.`;
    else $('#entryNotice').textContent = 'Tally additions save automatically.';

    renderHistory(day, editable);
    renderDailyTimeline(day, editable);
    renderHourlyChart(day);
  }

  function shouldShowStickyWorkbench() {
    if (!['today', 'week'].includes(activeView)) return false;
    if (activeView === 'week') return true;
    if (!isToday(state.selectedDate)) return true;
    return window.scrollY > 220;
  }

  function updateStickyWorkbenchVisibility() {
    const workbench = $('#stickyWorkbench');
    if (!workbench) return;
    const visible = shouldShowStickyWorkbench();
    const scrolledCompact = visible && window.scrollY > 220;
    const header = $('.compact-topbar');

    workbench.classList.toggle('show', visible);
    workbench.classList.toggle('compact', scrolledCompact);
    workbench.setAttribute('aria-hidden', String(!visible));
    header?.classList.toggle('scroll-compact', scrolledCompact);

    const scrollTotal = $('#scrollTotal');
    if (scrollTotal) scrollTotal.hidden = !scrolledCompact;
  }

  function renderStickyWorkbench() {
    ensureTodayModeDefault();
    const date = todayISO();
    const day = getDay(date);
    const summary = daySummary(date);

    $('#scrollTotalMetric').textContent = summary.totalInteractions.toLocaleString();

    const chooserVisible = !day.modeLocked;
    $('#stickyModeChooser').classList.toggle('hidden', !chooserVisible);
    $('#stickyKeyModeButton').classList.toggle('active', day.mode === 'keys');
    $('#stickyTallyModeButton').classList.toggle('active', day.mode === 'tally');

    $('#stickyWorkflowSelect').value = state.lastWorkflow || '';
    $('#stickyOutcomeSelect').value = normalizeOutcome(state.lastOutcome);
    $('#stickyOutcomeSelect').disabled = !day.mode;
    $('#stickyKeyEntryArea').classList.toggle('hidden', day.mode !== 'keys');
    $('#stickyTallyEntryArea').classList.toggle('hidden', day.mode !== 'tally');
    $('#stickyAwaitingMethod').classList.toggle('hidden', Boolean(day.mode));
    $('#stickyKeyInput').disabled = day.mode !== 'keys';
    $('#stickyAddKeysButton').disabled = day.mode !== 'keys';
    $$('[data-sticky-tally]').forEach(button => { button.disabled = day.mode !== 'tally'; });
    $('#stickyUndoTally').disabled = day.mode !== 'tally' || !day.entries.some(entry => entry.type === 'tally');
    updateStickyWorkbenchVisibility();
  }

  function renderDailyBreakdown(summary) {
    const total = summary.totalInteractions || 1;
    $('#dailyBreakdown').innerHTML = OUTCOMES.map(outcome => {
      const value = summary.outcomes[outcome];
      const percent = Math.round((value / total) * 100);
      return `<div class="summary-row"><span>${outcome}</span><div class="summary-bar"><span style="width:${percent}%"></span></div><strong>${value}</strong></div>`;
    }).join('');
  }

  function renderHistory(day, editable) {
    const body = $('#historyBody');
    const showTime = day.mode !== 'tally';
    $('#historyTimeHeader').hidden = !showTime;

    if (!day.entries.length) {
      body.innerHTML = `<tr><td class="empty-row" colspan="${showTime ? 5 : 4}">No activity has been recorded for this date.</td></tr>`;
      return;
    }

    body.innerHTML = day.entries.map((entry, index) => {
      const description = entry.type === 'keys' ? ((entry.keys || [])[0] || '') : `× ${entryInteractions(entry)}`;
      const timeCell = showTime
        ? `<td>${entry.type === 'keys' && entry.time ? formatClockTime(entry.time, entry.timeZone || activeTimeZone()) : ''}</td>`
        : '';
      const outcomeOptions = OUTCOMES.map(outcome => `<option${normalizeOutcome(entry.outcome) === outcome ? ' selected' : ''}>${outcome}</option>`).join('');
      const workflowOptions = ['', ...WORKFLOWS].map(workflow => `<option value="${escapeHtml(workflow)}"${normalizeWorkflow(entry.workflow) === workflow ? ' selected' : ''}>${workflow || 'Not selected'}</option>`).join('');
      const groupId = entry.groupId || entry.id;
      const previousGroupId = index > 0 ? (day.entries[index - 1].groupId || day.entries[index - 1].id) : '';
      const nextGroupId = index < day.entries.length - 1 ? (day.entries[index + 1].groupId || day.entries[index + 1].id) : '';
      const groupClasses = [
        `group-${Number(entry.groupIndex ?? index) % 5}`,
        groupId !== previousGroupId ? 'group-start' : '',
        groupId !== nextGroupId ? 'group-end' : ''
      ].filter(Boolean).join(' ');
      const keyAttribute = entry.type === 'keys' ? ` data-history-key="${escapeHtml(description)}"` : '';
      return `<tr class="${groupClasses}" data-group-id="${escapeHtml(groupId)}"${keyAttribute}>
        ${timeCell}
        <td><select data-workflow-id="${entry.id}" ${editable ? '' : 'disabled'}>${workflowOptions}</select></td>
        <td class="group-cell">${escapeHtml(description)}</td>
        <td><select data-outcome-id="${entry.id}" ${editable ? '' : 'disabled'}>${outcomeOptions}</select></td>
        <td><button class="button button-danger" data-delete-id="${entry.id}" type="button" ${editable ? '' : 'disabled'}>Remove</button></td>
      </tr>`;
    }).join('');
  }

  function renderDailyTimeline(day, editable) {
    const zone = activeTimeZone();
    const keyEntries = day.entries.filter(entry => entry.type === 'keys' && entry.time);
    const savedZones = [...new Set(keyEntries.map(entry => entry.timeZone || zone))];
    const events = [];
    const groups = new Map();

    keyEntries.forEach(entry => {
      const groupId = entry.groupId || entry.id;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(entry);
    });

    groups.forEach(entries => {
      const first = entries[0];
      const entryZone = first.timeZone || zone;
      const parts = timeParts(first.time, entryZone);
      if (!parts) return;
      const keys = entries.flatMap(entry => entry.keys || []);
      const outcomeCounts = { Contacted: 0, Snoozed: 0, 'Unable to Contact': 0 };
      const workflowCounts = { 'PA PPQ': 0, 'Appeals PPQ': 0, 'Not selected': 0 };
      entries.forEach(entry => {
        outcomeCounts[normalizeOutcome(entry.outcome)] += entryInteractions(entry);
        workflowCounts[normalizeWorkflow(entry.workflow) || 'Not selected'] += entryInteractions(entry);
      });
      const outcomeDetail = OUTCOMES.filter(outcome => outcomeCounts[outcome] > 0)
        .map(outcome => `${outcomeCounts[outcome]} ${outcome}`).join(' · ');
      const workflowDetail = [...WORKFLOWS, 'Not selected'].filter(workflow => workflowCounts[workflow] > 0)
        .map(workflow => `${workflowCounts[workflow]} ${workflow}`).join(' · ');
      events.push({
        sort: parts.hour * 60 + parts.minute,
        kind: 'entry',
        id: first.groupId || first.id,
        time: formatClockTime(first.time, entryZone),
        label: `${keys.length} interaction${keys.length === 1 ? '' : 's'}`,
        detail: `${workflowDetail} · ${outcomeDetail} · ${keys.join(', ')}`,
        zone: entryZone
      });
    });

    day.notes.forEach(note => {
      const localTime = /^\d{2}:\d{2}$/.test(note.localTime || '') ? note.localTime : '12:00';
      const [hour, minute] = localTime.split(':').map(Number);
      events.push({
        sort: hour * 60 + minute,
        kind: 'note',
        id: note.id,
        time: formatClockTime(localTime),
        label: NOTE_TYPES.includes(note.type) ? note.type : 'Other',
        detail: note.text || 'No additional details',
        zone: note.timeZone || zone
      });
    });
    events.sort((a, b) => a.sort - b.sort || a.kind.localeCompare(b.kind));
    const tallyMode = day.mode === 'tally';
    $('#timelineEyebrow').textContent = tallyMode ? 'Optional notes' : 'Timestamped activity';
    $('#timelineTimeZone').textContent = tallyMode
      ? `Notes use ${zone}`
      : (savedZones.length > 1 ? 'Multiple saved time zones' : `Time zone: ${savedZones[0] || zone}`);

    const emptyMessage = tallyMode
      ? 'No notes have been added for this date.'
      : 'No timestamped key groups or notes are available for this date.';

    $('#dailyTimeline').innerHTML = events.length ? events.map(event => `<div class="timeline-item ${event.kind}">
      <div class="timeline-time">${escapeHtml(event.time)}</div>
      <div class="timeline-dot" aria-hidden="true"></div>
      <div class="timeline-content"><strong>${escapeHtml(event.label)}</strong><span>${escapeHtml(event.detail)}</span>${event.zone !== zone ? `<small>${escapeHtml(event.zone)}</small>` : ''}</div>
      ${event.kind === 'note' ? `<button class="timeline-remove" data-note-delete-id="${event.id}" type="button" ${editable ? '' : 'disabled'} aria-label="Remove note">×</button>` : ''}
    </div>`).join('') : `<div class="empty-timeline">${emptyMessage}</div>`;
  }

  function renderHourlyChart(day) {
    const chart = $('#hourlyChart');
    const hourlyCard = $('#hourlyCard');
    const tallyMode = day.mode === 'tally';
    hourlyCard.classList.toggle('hidden', tallyMode);
    if (tallyMode) return;
    const keyEntries = day.entries.filter(entry => entry.type === 'keys' && entry.time);
    const savedZones = [...new Set(keyEntries.map(entry => validTimeZone(entry.timeZone) ? entry.timeZone : activeTimeZone()))];
    const chartZone = savedZones.length === 1 ? savedZones[0] : activeTimeZone();
    $('#hourlyTimeZone').textContent = savedZones.length > 1 ? `Multiple saved time zones · displayed in ${chartZone}` : `Time zone: ${chartZone}`;
    if (!keyEntries.length) {
      chart.innerHTML = '<div class="hourly-empty">No timestamped Key Tracker groups are available for this date.</div>';
      $('#hourlyChartNote').textContent = 'Each key counts as one interaction in the hour of its group timestamp.';
      return;
    }
    const buckets = new Map();
    keyEntries.forEach(entry => {
      const parts = timeParts(entry.time, chartZone);
      if (!parts) return;
      buckets.set(parts.hour, (buckets.get(parts.hour) || 0) + entryInteractions(entry));
    });
    const recordedHours = [...buckets.keys()];
    const startHour = Math.min(6, ...recordedHours);
    const endHour = Math.max(18, ...recordedHours);
    const maxValue = Math.max(...buckets.values(), 1);
    const rows = [];
    for (let hour = startHour; hour <= endHour; hour += 1) {
      const value = buckets.get(hour) || 0;
      rows.push(`<div class="hour-column" title="${hourLabel(hour)}: ${value} interaction${value === 1 ? '' : 's'}">
        <strong>${value || ''}</strong>
        <div class="hour-bar-wrap"><div class="hour-bar" style="height:${value ? Math.max(8, Math.round((value / maxValue) * 150)) : 2}px"></div></div>
        <span>${hourLabel(hour)}</span>
      </div>`);
    }
    chart.innerHTML = rows.join('');
    $('#hourlyChartNote').textContent = 'Each key counts as one interaction. Keys submitted together share one timestamp. Meetings, lunches, and other work may affect the pattern.';
  }

  function summarizeRange(dates) {
    const summaries = dates.map(daySummary);
    return summaries.reduce((acc, item) => {
      acc.totalInteractions += item.totalInteractions;
      OUTCOMES.forEach(outcome => { acc.outcomes[outcome] += item.outcomes[outcome]; });
      WORKFLOWS.forEach(workflow => { acc.workflows[workflow] += item.workflows[workflow]; });
      acc.workflows['Not selected'] += item.workflows['Not selected'];
      if (statusCountsAsWorkday(item.status, item.totalInteractions)) acc.workDays += 1;
      return acc;
    }, {
      totalInteractions: 0,
      workDays: 0,
      outcomes: { Contacted: 0, Snoozed: 0, 'Unable to Contact': 0 },
      workflows: { 'PA PPQ': 0, 'Appeals PPQ': 0, 'Not selected': 0 }
    });
  }

  function renderWeek() {
    const anchor = state.weekDate || todayISO();
    const start = startOfWeek(anchor);
    const end = addDays(start, 4);
    const weekdays = rangeDates(start, end);
    const included = weekdays.filter(date => !isExcludedHoliday(date));
    const holidayCount = weekdays.length - included.length;
    const summaries = included.map(daySummary);
    const totals = summarizeRange(included);
    const average = totals.workDays ? (totals.totalInteractions / totals.workDays).toFixed(1) : '0';
    $('#weekExclusionNote').textContent = `${included.length} weekday${included.length === 1 ? '' : 's'} shown. Weekends are always ignored${holidayCount ? ` and ${holidayCount} holiday${holidayCount === 1 ? ' is' : 's are'} excluded` : ''}. Absent and non-working days do not count toward averages.`;
    $('#weekSummaryStrip').innerHTML = `
      <div><span>Total interactions</span><strong>${totals.totalInteractions}</strong></div>
      <div><span>Worked days</span><strong>${totals.workDays}</strong></div>
      <div><span>Average per worked day</span><strong>${average}</strong></div>
      <div><span>Contacted</span><strong>${totals.outcomes.Contacted}</strong></div>`;
    $('#weekGrid').innerHTML = summaries.length ? summaries.map(item => `<article class="card week-day${isToday(item.date) ? ' today' : ''}">
      <h3>${formatDate(item.date, { weekday: 'long' })}</h3>
      <div class="date">${formatDate(item.date)}</div>
      <div class="week-method">${escapeHtml(item.status)}</div>
      <div class="week-stats">
        <div class="week-stat"><span>Total Interactions</span><strong>${item.totalInteractions}</strong></div>
        <div class="week-stat"><span>Contacted</span><strong>${item.outcomes.Contacted}</strong></div>
        <div class="week-stat"><span>Snoozed</span><strong>${item.outcomes.Snoozed}</strong></div>
        <div class="week-stat"><span>Unable</span><strong>${item.outcomes['Unable to Contact']}</strong></div>
      </div>
    </article>`).join('') : '<div class="card empty-business-range">No weekdays remain after holidays are excluded.</div>';
  }

  function renderCustom() {
    const start = $('#customStart').value || state.customStart || startOfMonth();
    const end = $('#customEnd').value || state.customEnd || todayISO();
    state.customStart = start;
    state.customEnd = end;
    $('#customStart').value = start;
    $('#customEnd').value = end;
    if (!start || !end || start > end) {
      $('#customExclusionNote').textContent = 'Choose a valid date range.';
      $('#customSummary').innerHTML = '';
      $('#customGrid').innerHTML = '';
      return;
    }
    const allDates = rangeDates(start, end);
    const includedDates = includedViewDates(start, end);
    const weekendCount = allDates.filter(isWeekend).length;
    const holidayCount = allDates.filter(date => !isWeekend(date) && isExcludedHoliday(date)).length;
    const summaries = includedDates.map(daySummary);
    const totals = summarizeRange(includedDates);
    const average = totals.workDays ? (totals.totalInteractions / totals.workDays).toFixed(1) : '0';
    $('#customExclusionNote').textContent = `${includedDates.length} weekday${includedDates.length === 1 ? '' : 's'} shown · ${weekendCount} weekend date${weekendCount === 1 ? '' : 's'} ignored · ${holidayCount} holiday${holidayCount === 1 ? '' : 's'} excluded. Absent and non-working days do not count toward averages.`;
    $('#customSummary').innerHTML = `
      <div class="dashboard-metric"><span>Worked days</span><strong>${totals.workDays}</strong></div>
      <div class="dashboard-metric"><span>Total interactions</span><strong>${totals.totalInteractions.toLocaleString()}</strong></div>
      <div class="dashboard-metric"><span>Contacted</span><strong>${totals.outcomes.Contacted.toLocaleString()}</strong></div>
      <div class="dashboard-metric"><span>Unable</span><strong>${totals.outcomes['Unable to Contact'].toLocaleString()}</strong></div>
      <div class="dashboard-metric"><span>Average per worked day</span><strong>${average}</strong></div>`;
    $('#customGrid').innerHTML = summaries.length ? summaries.map(item => `<article class="card custom-day${isToday(item.date) ? ' today' : ''}">
      <div><strong>${formatDate(item.date, { weekday: 'short', month: 'short', day: 'numeric' })}</strong><span>${escapeHtml(item.status)}</span></div>
      <div class="custom-day-stats"><span>Total <strong>${item.totalInteractions}</strong></span><span>Contacted <strong>${item.outcomes.Contacted}</strong></span><span>Unable <strong>${item.outcomes['Unable to Contact']}</strong></span></div>
    </article>`).join('') : '<div class="card empty-business-range">No weekdays are available in this range.</div>';
  }

  function renderDashboard() {
    const start = $('#dashboardStart').value || startOfMonth();
    const end = $('#dashboardEnd').value || endOfMonth();
    $('#dashboardStart').value = start;
    $('#dashboardEnd').value = end;
    const dates = includedViewDates(start, end);
    const summaries = dates.map(daySummary);
    const totals = summarizeRange(dates);
    const average = totals.workDays ? (totals.totalInteractions / totals.workDays).toFixed(1) : '0';
    const contactRate = totals.totalInteractions ? `${Math.round((totals.outcomes.Contacted / totals.totalInteractions) * 100)}%` : '0%';
    const metrics = $('#dashboardMetrics');
    metrics.classList.toggle('compact', Boolean(state.settings.compactDashboard));
    metrics.innerHTML = `
      <div class="dashboard-metric"><span>Total interactions</span><strong>${totals.totalInteractions.toLocaleString()}</strong></div>
      <div class="dashboard-metric"><span>Worked days</span><strong>${totals.workDays}</strong></div>
      <div class="dashboard-metric"><span>Daily average</span><strong>${average}</strong></div>
      <div class="dashboard-metric"><span>Contact rate</span><strong>${contactRate}</strong></div>
      <div class="dashboard-metric full"><span>Absent and non-working dates</span><strong>${summaries.filter(item => !statusCountsAsWorkday(item.status, item.totalInteractions)).length}</strong></div>`;

    const outcomeMax = Math.max(...Object.values(totals.outcomes), 1);
    $('#outcomeChart').innerHTML = OUTCOMES.map(outcome => `<div class="chart-row"><span>${outcome}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.round((totals.outcomes[outcome] / outcomeMax) * 100)}%"></div></div><strong>${totals.outcomes[outcome]}</strong></div>`).join('');

    const activeDays = summaries.filter(item => item.totalInteractions > 0);
    const maxDaily = Math.max(...activeDays.map(item => item.totalInteractions), 1);
    $('#dailyChart').innerHTML = activeDays.length
      ? activeDays.map(item => `<div class="daily-column" title="${formatDate(item.date)}: ${item.totalInteractions}"><strong>${item.totalInteractions}</strong><div class="daily-bar" style="height:${Math.max(3, Math.round((item.totalInteractions / maxDaily) * 190))}px"></div><span>${formatDate(item.date, { month: 'short', day: 'numeric' })}</span></div>`).join('')
      : '<div class="empty-row">No activity is available in this range.</div>';
  }

  function reportRows() {
    const start = $('#reportStart').value || startOfMonth();
    const end = $('#reportEnd').value || endOfMonth();
    $('#reportStart').value = start;
    $('#reportEnd').value = end;
    return rangeDates(start, end)
      .filter(date => !isWeekend(date))
      .map(daySummary)
      .filter(item => item.totalInteractions > 0 || item.status !== 'Not set' || item.statusOverride);
  }

  function renderReports() {
    const rows = reportRows();
    $('#reportBody').innerHTML = rows.length ? rows.map(item => `<tr>
      <td>${formatDate(item.date)}</td>
      <td>${escapeHtml(item.status)}</td>
      <td>${item.totalInteractions}</td>
      <td>${item.outcomes.Contacted}</td>
      <td>${item.outcomes.Snoozed}</td>
      <td>${item.outcomes['Unable to Contact']}</td>
      <td>${item.workflows['PA PPQ']}</td>
      <td>${item.workflows['Appeals PPQ']}</td>
      <td>${item.workflows['Not selected']}</td>
    </tr>`).join('') : '<tr><td class="empty-row" colspan="9">No report data is available in this range.</td></tr>';
  }

  function exportCsv() {
    const rows = reportRows();
    const headers = ['Employee', 'Date', 'Status', 'Total Interactions', 'Contacted', 'Snoozed', 'Unable to Contact', 'PA PPQ', 'Appeals PPQ', 'Outcomes Not Selected'];
    const lines = [headers, ...rows.map(item => [
      state.employeeName || '', item.date, item.status, item.totalInteractions, item.outcomes.Contacted, item.outcomes.Snoozed,
      item.outcomes['Unable to Contact'], item.workflows['PA PPQ'], item.workflows['Appeals PPQ'], item.workflows['Not selected']
    ])].map(row => row.map(escapeCsv).join(','));
    downloadBlob(lines.join('\n'), `Annual_Key_Tracker_Report_${$('#reportStart').value}_to_${$('#reportEnd').value}.csv`, 'text/csv;charset=utf-8');
  }

  function loadScript(source, timeoutMs) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => { script.remove(); reject(new Error('The Excel library took too long to load.')); }, timeoutMs);
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
    xlsxLoadPromise = loadScript('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js', 12000)
      .then(() => {
        if (!window.XLSX) throw new Error('The Excel library loaded without the expected XLSX tools.');
        return window.XLSX;
      })
      .catch(error => { xlsxLoadPromise = null; throw error; });
    return xlsxLoadPromise;
  }

  async function exportExcel() {
    try { await ensureXlsx(); }
    catch (error) {
      console.error(error);
      toast('Excel export is unavailable. Exporting CSV instead.');
      return exportCsv();
    }
    const rows = reportRows().map(item => ({
      Employee: state.employeeName || '',
      Date: item.date,
      Status: item.status,
      'Total Interactions': item.totalInteractions,
      Contacted: item.outcomes.Contacted,
      Snoozed: item.outcomes.Snoozed,
      'Unable to Contact': item.outcomes['Unable to Contact'],
      'PA PPQ': item.workflows['PA PPQ'],
      'Appeals PPQ': item.workflows['Appeals PPQ'],
      'Outcomes Not Selected': item.workflows['Not selected']
    }));
    const detailRows = [];
    const noteRows = [];
    Object.keys(state.days).sort().forEach(date => {
      const day = getDay(date, false);
      day.entries.forEach((entry, index) => detailRows.push({
        Employee: state.employeeName || '',
        Date: date,
        Status: effectiveStatus(date),
        Method: day.mode === 'keys' ? 'Key Tracker' : day.mode === 'tally' ? 'Tally Counter' : '',
        Interaction: index + 1,
        Outcomes: normalizeWorkflow(entry.workflow) || 'Not selected',
        Result: normalizeOutcome(entry.outcome),
        Keys: (entry.keys || []).join(', '),
        'Interaction Count': entryInteractions(entry),
        'Key Count': entryKeyCount(entry),
        Time: entry.type === 'keys' ? entry.time || '' : '',
        'Time Zone': entry.type === 'keys' ? entry.timeZone || '' : ''
      }));
      day.notes.forEach(note => noteRows.push({
        Employee: state.employeeName || '',
        Date: date,
        Time: note.localTime || '',
        'Time Zone': note.timeZone || '',
        Type: note.type || 'Other',
        Note: note.text || ''
      }));
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Daily Summary');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows), 'Activity Detail');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(noteRows), 'Daily Notes');
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
      const defaults = defaultState();
      const importedDays = {};
      Object.entries(parsed.days).forEach(([date, day]) => {
        const validDate = parseDate(date);
        if (validDate) importedDays[validDate] = sanitizeDay(day);
      });
      const importedSettings = { ...defaults.settings, ...(parsed.settings || {}) };
      importedSettings.automaticTimeZone = importedSettings.automaticTimeZone !== false;
      importedSettings.timeZone = validTimeZone(importedSettings.timeZone) ? importedSettings.timeZone : detectTimeZone();
      importedSettings.holidays = [...new Set((Array.isArray(importedSettings.holidays) ? importedSettings.holidays : [])
        .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
      state = {
        ...defaults,
        ...parsed,
        version: APP_VERSION,
        days: importedDays,
        settings: importedSettings,
        selectedDate: todayISO(),
        weekDate: todayISO(),
        lastMode: normalizeMode(parsed.lastMode) || deriveLatestMode(importedDays),
        lastWorkflow: normalizeWorkflow(parsed.lastWorkflow) || deriveLatestWorkflow(importedDays),
        welcomeDone: true
      };
      ensureTodayModeDefault();
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


  function employeeNameFromFilename(filename) {
    const base = String(filename || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const match = base.match(/^(.*?)\s+(?:20\d{2}\s+)?(?:annual\s+)?key\s+tracker\b/i);
    const name = (match?.[1] || '').trim();
    if (!name || /^(annual|key|tracker)$/i.test(name)) return '';
    return name;
  }

  function spreadsheetCellValue(sheet, row, column) {
    const address = XLSX.utils.encode_cell({ r: row, c: column });
    const cell = sheet[address];
    if (!cell) return '';
    if (cell.v !== undefined && cell.v !== null) return cell.v;
    return cell.w ?? '';
  }

  function cleanSpreadsheetText(value) {
    if (value instanceof Date) return value;
    return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function legacyColumnGroups(sheet) {
    if (!sheet?.['!ref']) return [];
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const groups = [];
    for (let column = range.s.c; column <= range.e.c - 2; column += 1) {
      const keyHeader = String(cleanSpreadsheetText(spreadsheetCellValue(sheet, 6, column))).toLowerCase();
      const contactHeader = String(cleanSpreadsheetText(spreadsheetCellValue(sheet, 6, column + 1))).toLowerCase();
      const snoozedHeader = String(cleanSpreadsheetText(spreadsheetCellValue(sheet, 6, column + 2))).toLowerCase();
      if (keyHeader !== 'keys' || !contactHeader.includes('contact') || !snoozedHeader.includes('snooz')) continue;

      const dateValue = spreadsheetCellValue(sheet, 1, column);
      const dateCell = sheet[XLSX.utils.encode_cell({ r: 1, c: column })];
      const date = parseDate(dateValue) || parseDate(dateCell?.w);
      if (!date) continue;

      groups.push({
        keyColumn: column,
        contactColumn: column + 1,
        snoozedColumn: column + 2,
        date,
        workflow: normalizeWorkflow(spreadsheetCellValue(sheet, 2, column))
      });
    }
    return groups;
  }

  function legacyMarker(value) {
    if (value === true) return true;
    if (typeof value === 'number') return value !== 0;
    const text = String(cleanSpreadsheetText(value)).toLowerCase();
    return ['x', 'yes', 'y', 'true', '1', 'checked', 'check'].includes(text);
  }

  function legacyResult(contactValue, snoozedValue) {
    const contactText = String(cleanSpreadsheetText(contactValue)).toLowerCase();
    const snoozedText = String(cleanSpreadsheetText(snoozedValue)).toLowerCase();
    const combined = `${contactText} ${snoozedText}`;

    if (combined.includes('snooz')) return { outcome: 'Snoozed', marked: true };
    if (combined.includes('unable') || combined.includes('no contact')) return { outcome: 'Unable to Contact', marked: true };
    if (combined.includes('contact')) return { outcome: 'Contacted', marked: true };
    if (legacyMarker(snoozedValue)) return { outcome: 'Snoozed', marked: true };
    if (legacyMarker(contactValue)) return { outcome: 'Contacted', marked: true };

    return { outcome: 'Unable to Contact', marked: false };
  }

  function parseLegacyMonthlyWorkbook(workbook, file) {
    const records = [];
    let recognizedSheets = 0;

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const groups = legacyColumnGroups(sheet);
      if (groups.length < 2) return;
      recognizedSheets += 1;
      const range = XLSX.utils.decode_range(sheet['!ref']);

      groups.forEach(group => {
        for (let row = 7; row <= range.e.r; row += 1) {
          const rawKey = cleanSpreadsheetText(spreadsheetCellValue(sheet, row, group.keyColumn));
          if (!rawKey || rawKey instanceof Date) continue;
          const keys = keyTokens(rawKey);
          if (!keys.length) continue;

          const contactValue = spreadsheetCellValue(sheet, row, group.contactColumn);
          const snoozedValue = spreadsheetCellValue(sheet, row, group.snoozedColumn);
          const result = legacyResult(contactValue, snoozedValue);
          const sourceAddress = XLSX.utils.encode_cell({ r: row, c: group.keyColumn });

          keys.forEach((key, keyIndex) => {
            records.push({
              date: group.date,
              key,
              workflow: group.workflow,
              outcome: result.outcome,
              resultMarked: result.marked,
              sheetName,
              sourceAddress,
              sourceRef: `legacy|${sheetName}|${sourceAddress}|${group.date}|${keyIndex}|${String(key).toUpperCase()}`
            });
          });
        }
      });
    });

    return {
      detected: recognizedSheets > 0,
      recognizedSheets,
      employeeName: employeeNameFromFilename(file.name),
      records
    };
  }

  function importLegacyMonthlyWorkbook(workbook, file) {
    const parsed = parseLegacyMonthlyWorkbook(workbook, file);
    if (!parsed.detected) return null;
    if (!parsed.records.length) throw new Error('The older monthly tracker layout was recognized, but no keys were found.');

    const dates = [...new Set(parsed.records.map(record => record.date))].sort();
    const unmarked = parsed.records.filter(record => !record.resultMarked).length;
    const nameText = parsed.employeeName ? ` for ${parsed.employeeName}` : '';
    const blankText = unmarked
      ? `\n\n${unmarked.toLocaleString()} key${unmarked === 1 ? '' : 's'} have no Contact or Snoozed mark. Those will be imported as Unable to Contact.`
      : '';
    const confirmed = confirm(
      `Import ${parsed.records.length.toLocaleString()} key${parsed.records.length === 1 ? '' : 's'} across ${dates.length.toLocaleString()} date${dates.length === 1 ? '' : 's'}${nameText}?${blankText}\n\nOlder entries will not receive timestamps, so they will not affect the hourly chart.`
    );
    if (!confirmed) return { cancelled: true };

    const existingSourceRefs = new Set();
    Object.values(state.days).forEach(sourceDay => {
      sanitizeDay(sourceDay).entries.forEach(entry => {
        if (entry.importSourceRef) existingSourceRefs.add(entry.importSourceRef);
      });
    });

    let imported = 0;
    let alreadyImported = 0;
    parsed.records.forEach(record => {
      if (existingSourceRefs.has(record.sourceRef)) {
        alreadyImported += 1;
        return;
      }

      const day = getDay(record.date);
      if (!day.mode || !day.entries.length) day.mode = 'keys';
      day.modeLocked = true;
      day.modeInherited = false;

      const groupIndex = day.entries.length % 5;
      day.entries.push({
        id: createId('legacy-key'),
        type: 'keys',
        keys: [record.key],
        count: 1,
        outcome: record.outcome,
        workflow: record.workflow,
        groupId: createId('legacy-group'),
        groupIndex,
        importedFrom: file.name,
        importSheet: record.sheetName,
        importCell: record.sourceAddress,
        importSourceRef: record.sourceRef,
        importedWithoutTimestamp: true
      });

      existingSourceRefs.add(record.sourceRef);
      if (record.workflow) state.lastWorkflow = record.workflow;
      imported += 1;
    });

    if (parsed.employeeName && !String(state.employeeName || '').trim()) {
      state.employeeName = parsed.employeeName;
    }
    state.lastMode = 'keys';

    return {
      imported,
      alreadyImported,
      dates: dates.length,
      employeeName: parsed.employeeName,
      unmarked
    };
  }

  function safeImportedTime(date, value) {
    if (!value) return `${date}T12:00:00.000Z`;
    const parsed = new Date(`${date} ${String(value).trim()}`);
    return Number.isNaN(parsed.getTime()) ? `${date}T12:00:00.000Z` : parsed.toISOString();
  }

  async function importSpreadsheet(file) {
    try {
      await ensureXlsx();
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });

      const legacyResult = importLegacyMonthlyWorkbook(workbook, file);
      if (legacyResult?.cancelled) return;
      if (legacyResult) {
        if (!legacyResult.imported && legacyResult.alreadyImported) {
          toast('This previous Key Tracker has already been imported.');
          return;
        }
        state.welcomeDone = true;
        saveState('Previous Key Tracker imported');
        applySettings();
        closeOverlays();
        renderAll();

        const nameText = legacyResult.employeeName ? ` for ${legacyResult.employeeName}` : '';
        const skippedText = legacyResult.alreadyImported
          ? `; ${legacyResult.alreadyImported.toLocaleString()} previously imported row${legacyResult.alreadyImported === 1 ? '' : 's'} skipped`
          : '';
        toast(`${legacyResult.imported.toLocaleString()} key${legacyResult.imported === 1 ? '' : 's'} imported across ${legacyResult.dates.toLocaleString()} date${legacyResult.dates === 1 ? '' : 's'}${nameText}${skippedText}.`);
        return;
      }

      let imported = 0;
      let skipped = 0;
      const filenameEmployee = employeeNameFromFilename(file.name);

      workbook.SheetNames.forEach(sheetName => {
        const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
        rows.forEach((row, rowIndex) => {
          const normalized = {};
          Object.entries(row).forEach(([key, value]) => { normalized[String(key).trim().toLowerCase()] = value; });
          const date = parseDate(normalized.date || normalized['work date'] || normalized.day || normalized['activity date']);
          if (!date) { skipped += 1; return; }

          const day = getDay(date);
          const mode = normalizeMode(normalized.method || normalized.mode || normalized.type || normalized['tracking method']);
          const keyText = normalized.keys || normalized.key || normalized['key id'] || normalized['key(s)'] || normalized.activity || '';
          const keys = keyTokens(keyText);
          const count = Math.floor(Number(normalized.count || normalized.total || normalized['total interactions'] || normalized['total keys'] || keys.length || 0));
          const possibleOutcomesField = normalized.outcomes || '';
          const workflow = normalizeWorkflow(normalized.workflow || normalized['outcomes workflow'] || normalized.ppq || possibleOutcomesField);
          const outcome = normalizeOutcome(normalized.outcome || normalized.result || (workflow ? '' : possibleOutcomesField) || normalized.status);
          const importedStatus = normalized['day status'] || normalized['day type'];

          if (NON_WORK_STATUSES.includes(importedStatus)) day.statusOverride = importedStatus;
          const resolvedMode = mode || (keys.length ? 'keys' : count > 0 ? 'tally' : null);
          if (!resolvedMode) { skipped += 1; return; }

          if (!day.mode || !day.entries.length) day.mode = resolvedMode;
          day.modeLocked = true;
          day.modeInherited = false;

          const groupId = createId('import-group');
          const groupIndex = day.entries.length % 5;

          if (resolvedMode === 'keys') {
            if (!keys.length) { skipped += 1; return; }
            keys.forEach((key, keyIndex) => {
              const entry = {
                id: createId('import-key'),
                type: 'keys',
                keys: [key],
                count: 1,
                outcome,
                workflow,
                groupId,
                groupIndex,
                importedFrom: file.name,
                importSheet: sheetName,
                importRow: rowIndex + 2
              };
              if (normalized.time) {
                entry.timeZone = validTimeZone(normalized['time zone'] || normalized.timezone)
                  ? (normalized['time zone'] || normalized.timezone)
                  : activeTimeZone();
                entry.time = safeImportedTime(date, normalized.time);
              } else {
                entry.importedWithoutTimestamp = true;
              }
              day.entries.push(entry);
              imported += 1;
            });
          } else {
            if (count < 1) { skipped += 1; return; }
            day.entries.push({
              id: createId('import-tally'),
              type: 'tally',
              keys: [],
              count,
              outcome,
              workflow,
              groupId,
              groupIndex,
              importedFrom: file.name,
              importSheet: sheetName,
              importRow: rowIndex + 2
            });
            imported += 1;
          }

          if (workflow) state.lastWorkflow = workflow;
          state.lastMode = resolvedMode;
        });
      });

      if (!imported) throw new Error('No recognizable activity rows were found. Use the older monthly Key Tracker workbook or include a Date column and a Keys or Count column.');
      if (filenameEmployee && !String(state.employeeName || '').trim()) state.employeeName = filenameEmployee;
      state.welcomeDone = true;
      saveState('Spreadsheet imported');
      applySettings();
      closeOverlays();
      renderAll();
      toast(`${imported.toLocaleString()} activity entr${imported === 1 ? 'y' : 'ies'} imported${skipped ? `; ${skipped.toLocaleString()} row${skipped === 1 ? '' : 's'} skipped` : ''}.`);
    } catch (error) {
      console.error(error);
      toast(error.message || 'The spreadsheet could not be imported.');
    }
  }

  function resetAllData() {
    if (!confirm('Reset all tracker data and settings in this browser? Download a backup first if you need the current data.')) return;
    state = defaultState();
    localStorage.removeItem(STORAGE_KEY);
    activeView = 'today';
    applySettings();
    closeOverlays();
    renderAll();
    showWelcome();
    toast('All local tracker data was reset.');
  }

  function openSettings(sectionId = '') {
    closeMenu();
    $('#settingsOverlay').classList.add('open');
    $('#settingsOverlay').setAttribute('aria-hidden', 'false');
    if (sectionId) setTimeout(() => $(`#${sectionId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
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

  function populateTimeZones() {
    const select = $('#timeZoneSelect');
    if (select.options.length) return;
    let zones = [];
    try { zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []; }
    catch (error) { zones = []; }
    const common = ['America/Phoenix', 'America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'America/Anchorage', 'Pacific/Honolulu', 'UTC'];
    zones = [...new Set([...common, ...zones])];
    select.innerHTML = zones.map(zone => `<option value="${escapeHtml(zone)}">${escapeHtml(zone.replaceAll('_', ' '))}</option>`).join('');
  }

  function renderHolidayList() {
    const dates = holidayDates();
    $('#holidayList').innerHTML = dates.length
      ? dates.map(date => `<div class="holiday-item"><span>${formatDate(date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</span><button type="button" data-remove-holiday="${date}" aria-label="Remove holiday">×</button></div>`).join('')
      : '<p class="privacy-note">No holidays or excluded dates have been added.</p>';
  }

  function applySettings() {
    const theme = THEMES.includes(state.settings.theme) ? state.settings.theme : 'sea-breeze';
    document.documentElement.dataset.theme = theme;
    $('#themeSelect').value = theme;
    $('#employeeNameInput').value = String(state.employeeName || '');
    $('#compactMode').checked = Boolean(state.settings.compactDashboard);
    populateTimeZones();
    const detected = detectTimeZone();
    const automatic = state.settings.automaticTimeZone !== false;
    $('#automaticTimeZone').checked = automatic;
    $('#detectedTimeZone').textContent = automatic ? `Detected from this device: ${detected}` : `Automatic detection available: ${detected}`;
    $('#manualTimeZoneField').classList.toggle('disabled-field', automatic);
    $('#timeZoneSelect').disabled = automatic;
    const selectedZone = validTimeZone(state.settings.timeZone) ? state.settings.timeZone : detected;
    if (![...$('#timeZoneSelect').options].some(option => option.value === selectedZone)) {
      $('#timeZoneSelect').insertAdjacentHTML('afterbegin', `<option value="${escapeHtml(selectedZone)}">${escapeHtml(selectedZone)}</option>`);
    }
    $('#timeZoneSelect').value = selectedZone;
    renderHolidayList();
  }

  function renderAll() {
    state.days[state.selectedDate] = sanitizeDay(getDay(state.selectedDate));
    renderPeriodControls();
    renderStickyWorkbench();
    if (activeView === 'today') renderToday();
    if (activeView === 'week') renderWeek();
    if (activeView === 'custom') renderCustom();
    if (activeView === 'dashboard') renderDashboard();
    if (activeView === 'reports') renderReports();
  }

  function bindEvents() {
    $('#duplicateCancel').addEventListener('click', () => closeDuplicatePrompt('cancel'));
    $('#duplicateAddAnyway').addEventListener('click', () => closeDuplicatePrompt('add'));
    $('#duplicateSkip').addEventListener('click', () => closeDuplicatePrompt('skip'));
    $('#duplicateViewExisting').addEventListener('click', () => closeDuplicatePrompt('view'));
    $('#duplicateOverlay').addEventListener('click', event => { if (event.target === $('#duplicateOverlay')) closeDuplicatePrompt('cancel'); });

    $('#menuButton').addEventListener('click', openMenu);
    $('#closeMenu').addEventListener('click', closeMenu);
    $('#menuScrim').addEventListener('click', closeMenu);
    $$('[data-menu-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.menuView)));
    $('#menuSettings').addEventListener('click', () => openSettings());
    $('#menuBackup').addEventListener('click', () => openSettings('backupSettings'));

    $('#mainViewSelect').addEventListener('change', event => {
      const view = event.target.value;
      if (view === 'week') state.weekDate = state.selectedDate || todayISO();
      switchView(view);
    });
$('#selectedDate').addEventListener('change', event => {
      if (!event.target.value) return;
      if (activeView === 'week') state.weekDate = event.target.value;
      else state.selectedDate = event.target.value;
      saveState();
      renderAll();
    });
    $('#goToday').addEventListener('click', () => {
      if (activeView === 'week') state.weekDate = todayISO();
      else state.selectedDate = todayISO();
      saveState();
      renderAll();
    });

$('#stickyKeyModeButton').addEventListener('click', () => chooseModeForDate(todayISO(), 'keys'));
    $('#stickyTallyModeButton').addEventListener('click', () => chooseModeForDate(todayISO(), 'tally'));
    $('#stickyWorkflowSelect').addEventListener('change', event => {
      state.lastWorkflow = normalizeWorkflow(event.target.value);
      $('#workflowSelect').value = state.lastWorkflow || '';
      saveState('Outcomes workflow saved');
    });
    $('#stickyOutcomeSelect').addEventListener('change', event => {
      state.lastOutcome = normalizeOutcome(event.target.value);
      $('#outcomeSelect').value = state.lastOutcome;
      saveState('Result selection saved');
    });
    $('#stickyAddKeysButton').addEventListener('click', () => addKeyBatchForDate(todayISO(), '#stickyKeyInput', '#stickyWorkflowSelect', '#stickyOutcomeSelect'));
    $('#stickyKeyInput').addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addKeyBatchForDate(todayISO(), '#stickyKeyInput', '#stickyWorkflowSelect', '#stickyOutcomeSelect');
      }
    });
    $$('[data-sticky-tally]').forEach(button => button.addEventListener('click', () => addTallyForDate(todayISO(), button.dataset.stickyTally, '#stickyWorkflowSelect', '#stickyOutcomeSelect')));
$('#stickyUndoTally').addEventListener('click', () => undoLastTallyForDate(todayISO()));

    $('#keyModeButton').addEventListener('click', () => chooseMode('keys'));
    $('#tallyModeButton').addEventListener('click', () => chooseMode('tally'));
    $('#workflowSelect').addEventListener('change', event => {
      state.lastWorkflow = normalizeWorkflow(event.target.value);
      $('#stickyWorkflowSelect').value = state.lastWorkflow || '';
      saveState('Outcomes workflow saved');
    });
    $('#outcomeSelect').addEventListener('change', event => {
      state.lastOutcome = normalizeOutcome(event.target.value);
      $('#stickyOutcomeSelect').value = state.lastOutcome;
      saveState('Result selection saved');
    });
    $('#dayTypeSelect').addEventListener('change', event => updateDateStatus(event.target.value));
    $('#addKeysButton').addEventListener('click', addKeyBatch);
    $('#clearKeyInput').addEventListener('click', () => { $('#keyInput').value = ''; $('#keyInput').focus(); });
    $('#keyInput').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') addKeyBatch(); });
    $$('[data-tally]').forEach(button => button.addEventListener('click', () => addTally(button.dataset.tally)));
    $('#addCustomTally').addEventListener('click', () => addTally($('#customTallyInput').value));
    $('#customTallyInput').addEventListener('keydown', event => { if (event.key === 'Enter') addTally(event.target.value); });
    $('#undoTally').addEventListener('click', undoLastTally);
    $('#clearDay').addEventListener('click', clearSelectedDay);
    $('#copyDaySummary').addEventListener('click', copyDaySummary);
    $('#addNoteButton').addEventListener('click', addNote);
    $('#noteTextInput').addEventListener('keydown', event => { if (event.key === 'Enter') addNote(); });
    $('#dailyTimeline').addEventListener('click', event => {
      const button = event.target.closest('[data-note-delete-id]');
      if (button) removeNote(button.dataset.noteDeleteId);
    });
    $('#historyBody').addEventListener('click', event => {
      const button = event.target.closest('[data-delete-id]');
      if (button) removeEntry(button.dataset.deleteId);
    });
    $('#historyBody').addEventListener('change', event => {
      const outcome = event.target.closest('[data-outcome-id]');
      const workflow = event.target.closest('[data-workflow-id]');
      if (outcome) updateEntryOutcome(outcome.dataset.outcomeId, outcome.value);
      if (workflow) updateEntryWorkflow(workflow.dataset.workflowId, workflow.value);
    });

    ['customStart', 'customEnd'].forEach(id => $(`#${id}`).addEventListener('change', () => {
      state.customStart = $('#customStart').value;
      state.customEnd = $('#customEnd').value;
      saveState();
      renderCustom();
    }));
    ['dashboardStart', 'dashboardEnd'].forEach(id => $(`#${id}`).addEventListener('change', renderDashboard));
    ['reportStart', 'reportEnd'].forEach(id => $(`#${id}`).addEventListener('change', renderReports));
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#exportExcel').addEventListener('click', exportExcel);
    $('#printReport').addEventListener('click', () => window.print());

    $('#closeSettings').addEventListener('click', closeOverlays);
    $('#settingsOverlay').addEventListener('click', event => { if (event.target === $('#settingsOverlay')) closeOverlays(); });
    $('#employeeNameInput').addEventListener('change', event => { state.employeeName = String(event.target.value || '').trim(); saveState('Employee name saved'); });
    $('#themeSelect').addEventListener('change', event => { state.settings.theme = event.target.value; applySettings(); saveState(); renderAll(); });
    $('#compactMode').addEventListener('change', event => { state.settings.compactDashboard = event.target.checked; saveState(); renderAll(); });
    $('#automaticTimeZone').addEventListener('change', event => {
      state.settings.automaticTimeZone = event.target.checked;
      if (event.target.checked) state.settings.timeZone = detectTimeZone();
      saveState('Time zone setting saved');
      applySettings();
      renderAll();
    });
    $('#timeZoneSelect').addEventListener('change', event => {
      state.settings.timeZone = event.target.value;
      state.settings.automaticTimeZone = false;
      saveState('Time zone saved');
      applySettings();
      renderAll();
    });
    $('#addHolidayButton').addEventListener('click', () => {
      const date = $('#holidayDateInput').value;
      if (!date) return toast('Choose a holiday or excluded date.');
      if (!state.settings.holidays.includes(date)) state.settings.holidays.push(date);
      state.settings.holidays.sort();
      $('#holidayDateInput').value = '';
      saveState('Holiday saved');
      applySettings();
      renderAll();
      toast(`${formatDate(date)} will be excluded from Weekly and Custom Range views.`);
    });
    $('#holidayList').addEventListener('click', event => {
      const button = event.target.closest('[data-remove-holiday]');
      if (!button) return;
      state.settings.holidays = state.settings.holidays.filter(date => date !== button.dataset.removeHoliday);
      saveState('Holiday removed');
      applySettings();
      renderAll();
    });
    $('#downloadBackup').addEventListener('click', downloadBackup);
    $('#importBackupButton').addEventListener('click', () => $('#backupFileInput').click());
    $('#importSpreadsheetButton').addEventListener('click', () => $('#spreadsheetFileInput').click());
    $('#backupFileInput').addEventListener('change', event => { const [file] = event.target.files; if (file) importBackup(file); event.target.value = ''; });
    $('#spreadsheetFileInput').addEventListener('change', event => { const [file] = event.target.files; if (file) importSpreadsheet(file); event.target.value = ''; });
    $('#resetAllData').addEventListener('click', resetAllData);

    $('#skipImport').addEventListener('click', () => { state.welcomeDone = true; saveState(); closeOverlays(); toast('Ready. No file was required.'); });
    $('#welcomeImport').addEventListener('click', () => { closeOverlays(); openSettings('backupSettings'); });

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

    let stickyScrollFrame = null;
    window.addEventListener('scroll', () => {
      if (stickyScrollFrame) return;
      stickyScrollFrame = requestAnimationFrame(() => {
        stickyScrollFrame = null;
        updateStickyWorkbenchVisibility();
      });
    }, { passive: true });
    window.addEventListener('resize', updateStickyWorkbenchVisibility);

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeMenu();
        closeOverlays();
      }
    });
  }

  function initialize() {
    ensureTodayModeDefault();
    $('#dashboardStart').value = startOfMonth();
    $('#dashboardEnd').value = endOfMonth();
    $('#reportStart').value = startOfMonth();
    $('#reportEnd').value = endOfMonth();
    $('#customStart').value = state.customStart || startOfMonth();
    $('#customEnd').value = state.customEnd || todayISO();
    $('#noteTimeInput').value = currentTimeValue();
    bindEvents();
    applySettings();
    renderAll();
    saveState();
    if (!state.welcomeDone) showWelcome();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./service-worker.js').catch(error => console.warn('Service worker registration failed:', error));
    }
  }

  initialize();
})();

window.VoiceInput = (function () {
  'use strict';

  var _tracker = 'expenses';

  // ── Synonym dictionary ─────────────────────────────────────────────────
  var SYNONYMS = {
    'food':'Groceries','grocery':'Groceries','groceries':'Groceries',
    'supermarket':'Groceries','market':'Groceries',
    'restaurant':'Dining Out','dining':'Dining Out','cafe':'Dining Out',
    'coffee shop':'Dining Out','lunch':'Dining Out','dinner':'Dining Out',
    'takeout':'Dining Out','takeaway':'Dining Out','delivery':'Dining Out',
    'transport':'Transport','uber':'Transport','taxi':'Transport',
    'bus':'Transport','train':'Transport','mrt':'Transport','subway':'Transport',
    'rent':'Housing','mortgage':'Housing',
    'electricity':'Utilities','internet':'Utilities','wifi':'Utilities',
    'phone bill':'Utilities','water bill':'Utilities',
    'doctor':'Healthcare','hospital':'Healthcare','pharmacy':'Healthcare',
    'gym':'Healthcare','medicine':'Healthcare',
    'clothes':'Shopping','clothing':'Shopping','shopping':'Shopping',
    'movie':'Entertainment','netflix':'Entertainment','spotify':'Entertainment',
    'streaming':'Entertainment','games':'Entertainment',
    'salary':'Salary','wage':'Salary','paycheck':'Salary','pay':'Salary',
    'freelance':'Freelance','consulting':'Freelance',
    'dividend':'Investments','interest':'Investments',
  };

  // ── Adaptive learning ──────────────────────────────────────────────────
  var LEARN_KEY = 'fiapp_voice_learned';
  var STOPWORDS = new Set(['i','on','to','a','the','and','at','for','some',
    'spent','paid','bought','earned','received','income','salary','expense',
    'cost','spend','purchase','made','got','my','in','of','from']);

  function _loadLearned() {
    try { return JSON.parse(localStorage.getItem(LEARN_KEY) || '{}'); } catch(e) { return {}; }
  }

  function _saveLearned(keys, rowId, rowLabel) {
    var d = _loadLearned();
    keys.forEach(function(k) {
      if (k.length < 3) return;
      if (!d[k]) d[k] = { rowId: rowId, rowLabel: rowLabel, count: 0 };
      if (d[k].rowId === rowId) {
        d[k].count++;
      } else {
        d[k] = { rowId: rowId, rowLabel: rowLabel, count: 1 };
      }
    });
    try { localStorage.setItem(LEARN_KEY, JSON.stringify(d)); } catch(e) {}
  }

  function _learnedKeys(transcript) {
    return transcript.toLowerCase()
      .replace(/\$?\s*\d+(?:[.,]\d+)?/g, '')
      .split(/\s+/)
      .filter(function(w) { return w.length >= 3 && !STOPWORDS.has(w); });
  }

  // ── NLU helpers ────────────────────────────────────────────────────────
  function _bridge() {
    return _tracker === 'income' ? window._incVoiceBridge : window._expVoiceBridge;
  }

  function _detectTracker(lower) {
    if (/\b(spent|paid|bought|expense|cost|spend|purchase)\b/.test(lower)) return 'expenses';
    if (/\b(earned|received|income|salary|wage|made|got paid)\b/.test(lower)) return 'income';
    return _tracker;
  }

  function _detectAction(lower) {
    if (/\b(delete|remove|subtract|minus|take off|deduct|reduce|cancel)\b/.test(lower)) return 'remove';
    return 'add';
  }

  function _extractRelative(lower) {
    if (/\b(all|everything|whole|entire)\b/.test(lower))                    return 'all';
    if (/\b(half|50\s*%|50\s*percent)\b/.test(lower))                      return 'half';
    if (/\b(quarter|a\s+quarter|25\s*%|25\s*percent)\b/.test(lower))       return 'quarter';
    if (/\b(third|a\s+third|one\s+third|33\s*%)\b/.test(lower))            return 'third';
    return null;
  }

  function _resolveRelative(rel, existing) {
    if (rel === 'all')     return existing;
    if (rel === 'half')    return existing / 2;
    if (rel === 'quarter') return existing / 4;
    if (rel === 'third')   return existing / 3;
    return null;
  }

  function _extractAmount(lower) {
    var m = lower.match(/\$?\s*(\d+(?:[.,]\d+)?)/);
    return m ? parseFloat(m[1].replace(',', '.')) : null;
  }

  function _extractWeekIndex(lower) {
    if (/\bweek\s*(1|one|1st|first)\b|\b(first|1st)\s+week\b/.test(lower))    return { index: 0, explicit: true };
    if (/\bweek\s*(2|two|2nd|second)\b|\b(second|2nd)\s+week\b/.test(lower))  return { index: 1, explicit: true };
    if (/\bweek\s*(3|three|3rd|third)\b|\b(third|3rd)\s+week\b/.test(lower))  return { index: 2, explicit: true };
    if (/\bweek\s*(4|four|4th|fourth)\b|\b(fourth|4th)\s+week\b/.test(lower)) return { index: 3, explicit: true };
    if (/\blast\s+week\b/.test(lower)) {
      var li = Math.max(0, Math.min(3, Math.floor((new Date().getDate() - 1) / 7)) - 1);
      return { index: li, explicit: true };
    }
    return { index: Math.min(3, Math.floor((new Date().getDate() - 1) / 7)), explicit: false };
  }

  function _matchCategory(lower, rows) {
    var best = { rowId: null, rowLabel: null, confidence: 0 };

    // 1. Adaptive learned dictionary (checked first)
    var learned = _loadLearned();
    var words = lower.split(/\s+/);
    words.forEach(function(w) {
      if (w.length < 3) return;
      var entry = learned[w];
      if (!entry) return;
      var conf = entry.count >= 2 ? 0.95 : 0.85;
      if (conf > best.confidence) {
        best = { rowId: entry.rowId, rowLabel: entry.rowLabel, confidence: conf };
      }
    });
    if (best.confidence >= 0.95) return best;

    // 2. Exact label match
    rows.forEach(function(row) {
      var label = row.label.toLowerCase();
      if (lower.indexOf(label) !== -1 && best.confidence < 1.0) {
        best = { rowId: row.id, rowLabel: row.label, confidence: 1.0 };
      }
    });
    if (best.confidence >= 1.0) return best;

    // 3. Partial: any label word (>2 chars) found in transcript
    rows.forEach(function(row) {
      var labelWords = row.label.toLowerCase().split(/\s+/);
      var hit = labelWords.some(function(lw) { return lw.length > 2 && lower.indexOf(lw) !== -1; });
      if (hit && best.confidence < 0.8) {
        best = { rowId: row.id, rowLabel: row.label, confidence: 0.8 };
      }
    });

    // 4. Synonym dictionary
    rows.forEach(function(row) {
      var label = row.label.toLowerCase();
      Object.keys(SYNONYMS).forEach(function(syn) {
        if (lower.indexOf(syn) !== -1 && SYNONYMS[syn].toLowerCase() === label) {
          if (best.confidence < 0.7) {
            best = { rowId: row.id, rowLabel: row.label, confidence: 0.7 };
          }
        }
      });
    });

    return best;
  }

  function _parseTranscript(transcript) {
    var lower   = transcript.toLowerCase();
    var br      = _bridge();
    var rows    = br.getRows();
    var cols    = br.getCols();
    var weekResult  = _extractWeekIndex(lower);
    var isForecast  = typeof br.isForecastMonth === 'function' ? br.isForecastMonth() : false;
    // On forecast months with no explicit week, default to week 1 (date-based default is meaningless)
    var weekIdx     = (!weekResult.explicit && isForecast) ? 0 : weekResult.index;
    var col         = cols[weekIdx] || cols[0] || {};
    var match       = _matchCategory(lower, rows);
    var isLastWeekInWeek1 = /\blast\s+week\b/.test(lower) && weekIdx === 0;
    return {
      transcript:      transcript,
      tracker:         _detectTracker(lower),
      action:          _detectAction(lower),
      amount:          _extractAmount(lower),
      relAmount:       _extractRelative(lower),
      weekIndex:       weekIdx,
      weekExplicit:    weekResult.explicit,
      rowId:           match.rowId,
      rowLabel:        match.rowLabel,
      confidence:      match.confidence,
      colId:           col.id || null,
      colLabel:        col.label || ('Week ' + (weekIdx + 1)),
      lastWeekInWeek1: isLastWeekInWeek1,
      isForecast:      isForecast,
    };
  }

  // ── Speech state ───────────────────────────────────────────────────────
  var _recognition   = null;
  var _isListening   = false;
  var _pendingResult = null;
  var _hardTimeout   = null;

  function _getSpeechAPI() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function _buildRecognition() {
    var API = _getSpeechAPI(); if (!API) return null;
    var r = new API();
    r.continuous     = false;
    r.interimResults = true;
    r.lang           = 'en-US';
    r._final         = '';
    r.onstart  = function () { _isListening = true; _showListening(); };
    r.onresult = function (e) {
      var t = '';
      for (var i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      var el = document.getElementById('_vi-live'); if (el) el.textContent = t;
      if (e.results[e.results.length - 1].isFinal) r._final = t;
    };
    r.onend = function () {
      _isListening = false;
      if (_hardTimeout) { clearTimeout(_hardTimeout); _hardTimeout = null; }
      _hideListening();
      if (r._final && r._final.trim()) _decide(_parseTranscript(r._final.trim()));
    };
    r.onerror = function (e) {
      _isListening = false;
      if (_hardTimeout) { clearTimeout(_hardTimeout); _hardTimeout = null; }
      _hideListening();
      if (e.error !== 'aborted') _toast('Voice error: ' + e.error);
    };
    return r;
  }

  function start() {
    if (_isListening) { stop(); return; }
    _recognition = _buildRecognition(); if (!_recognition) return;
    if (!sessionStorage.getItem('_vi_ringer_hint')) {
      sessionStorage.setItem('_vi_ringer_hint', '1');
      _toast('Tip: make sure your ringer is on for voice input');
    }
    try {
      _recognition.start();
      _hardTimeout = setTimeout(function () { stop(); }, 10000);
    } catch (e) { _toast('Could not start microphone.'); }
  }
  function stop() { if (_recognition) try { _recognition.stop(); } catch (e) {} }

  // ── Decision logic ─────────────────────────────────────────────────────
  function _alwaysConfirm() {
    return localStorage.getItem('fiapp_voice_always_confirm') === 'true';
  }

  function _hasSubcategories(rowId) {
    if (!rowId) return false;
    return _bridge().getRows().some(function (r) { return r.parentId === rowId; });
  }

  function _decide(p) {
    if (typeof _bridge().isLockedMonth === 'function' && _bridge().isLockedMonth()) {
      _toast('🔒 This month is locked — reopen it to make changes.');
      return;
    }
    var autoLog = (
      p.confidence >= 0.95
      && !_hasSubcategories(p.rowId)
      && p.amount !== null
      && !p.relAmount              // relative amounts always confirm so user sees resolved value
      && !_alwaysConfirm()
      && !p.lastWeekInWeek1
      && !(p.isForecast && !p.weekExplicit)  // forecast month with no stated week: confirm so user can verify which week
    );
    if (autoLog) { _applyResult(p); } else { _showConfirmSheet(p); }
  }

  // ── Apply (commit) ─────────────────────────────────────────────────────
  function _applyResult(p) {
    if (!p || !p.rowId || p.amount === null) return;
    var br = _bridge();
    var cols = br.getCols();
    var effectiveRowId = (p._subRowId !== null && p._subRowId !== undefined) ? p._subRowId : p.rowId;
    var colId = p.colId || ((cols[p.weekIndex] || cols[0] || {}).id);
    if (!colId) { _toast('Could not determine column.'); return; }
    br.forkCurrentMonth();
    br.snapshot();
    var existing = parseFloat(br.getCell(effectiveRowId, colId) || '0') || 0;
    var isRemove = p.action === 'remove';
    var newVal = isRemove ? Math.max(0, existing - p.amount) : existing + p.amount;
    br.setCell(effectiveRowId, colId, newVal.toFixed(2));
    br.updateAll(effectiveRowId);
    br.render();
    _saveLearned(_learnedKeys(p.transcript), p.rowId, p.rowLabel);
    _hideConfirmSheet();
    var verb = isRemove ? 'Removed' : 'Added';
    var prep  = isRemove ? 'from'    : 'to';
    var weekPart = p.colLabel ? ', ' + p.colLabel : '';
    _speak(verb + ' ' + p.amount.toFixed(0) + ' dollars ' + prep + ' ' + p.rowLabel + weekPart);
    _toast(verb + ' $' + p.amount.toFixed(2) + ' ' + prep + ' ' + p.rowLabel + weekPart);
  }

  // ── TTS ────────────────────────────────────────────────────────────────
  function _speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1;
    window.speechSynthesis.speak(u);
  }

  // ── Toast ──────────────────────────────────────────────────────────────
  function _toast(msg) {
    var el = document.createElement('div');
    el.className = 'voice-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  // ── UI state helpers ───────────────────────────────────────────────────
  function _showListening() {
    var fab = document.getElementById('_vi-fab');
    var ov  = document.getElementById('_vi-ov');
    if (fab) fab.classList.add('listening');
    if (ov)  ov.classList.add('active');
    var live = document.getElementById('_vi-live'); if (live) live.textContent = 'Listening…';
  }
  function _hideListening() {
    var fab = document.getElementById('_vi-fab'); if (fab) fab.classList.remove('listening');
    var ov  = document.getElementById('_vi-ov');  if (ov)  ov.classList.remove('active');
  }

  // ── Confirm sheet ──────────────────────────────────────────────────────
  function _showConfirmSheet(p) {
    _pendingResult = p;
    _refreshSheet();
    document.getElementById('_vi-sheet').classList.add('active');
    var _verb = p.action === 'remove' ? 'remove' : 'add';
    var _prep = p.action === 'remove' ? 'from'   : 'to';
    var msg = 'Please confirm: ' + _verb + ' ' +
      (p.amount !== null ? p.amount.toFixed(0) + ' dollars' : 'unknown amount') +
      (p.rowLabel ? ' ' + _prep + ' ' + p.rowLabel : '') +
      ' ' + (p.colLabel || '');
    _speak(msg);
    var ttsEl = document.getElementById('_vi-tts-text');
    if (ttsEl) ttsEl.textContent = '"' + msg + '"';
  }

  function _refreshSheet() {
    var p = _pendingResult; if (!p) return;
    var br = _bridge();

    document.getElementById('_vi-heard').textContent = '"' + p.transcript + '"';
    document.getElementById('_vi-last-week-note').style.display = p.lastWeekInWeek1 ? '' : 'none';
    document.getElementById('_vi-forecast-note').style.display  = p.isForecast      ? '' : 'none';

    // Resolve relative amount (re-runs on every refresh so week-chip changes update it)
    if (p.relAmount && p.rowId && p.colId) {
      var _cur = parseFloat(br.getCell(p.rowId, p.colId) || '0') || 0;
      var _resolved = _resolveRelative(p.relAmount, _cur);
      if (_resolved !== null) p.amount = Math.max(0, _resolved);
    }

    var nocat = !p.rowId;
    document.getElementById('_vi-no-cat').style.display     = nocat ? '' : 'none';
    document.getElementById('_vi-create-cat').style.display = nocat ? '' : 'none';

    var subSection = document.getElementById('_vi-sub-section');
    var subChips   = document.getElementById('_vi-sub-chips');
    var subs = p.rowId ? br.getRows().filter(function(r) { return r.parentId === p.rowId; }) : [];
    if (subs.length > 0) {
      subChips.innerHTML = '';
      p._subRowId = null;
      var gen = document.createElement('button');
      gen.className = 'voice-sub-chip';
      gen.textContent = p.rowLabel + ' (general)';
      gen.addEventListener('click', function () {
        p._subRowId = p.rowId;
        subChips.querySelectorAll('.voice-sub-chip').forEach(function(b){ b.classList.remove('selected'); });
        gen.classList.add('selected');
        _updateConfirmBtn();
      });
      subChips.appendChild(gen);
      subs.forEach(function (sub) {
        var btn = document.createElement('button');
        btn.className = 'voice-sub-chip'; btn.textContent = sub.label;
        btn.addEventListener('click', function () {
          p._subRowId = sub.id;
          subChips.querySelectorAll('.voice-sub-chip').forEach(function(b){ b.classList.remove('selected'); });
          btn.classList.add('selected');
          _updateConfirmBtn();
        });
        subChips.appendChild(btn);
      });
      subSection.style.display = '';
    } else {
      subSection.style.display = 'none';
      p._subRowId = undefined;
    }

    var catChip = document.getElementById('_vi-c-cat');
    catChip.textContent = p.rowLabel || 'Category ?';
    catChip.classList.toggle('voice-chip-unset', !p.rowId);

    var amtChip = document.getElementById('_vi-c-amt');
    if (p.amount !== null) {
      amtChip.textContent = p.relAmount
        ? p.relAmount + ' → $' + p.amount.toFixed(2)
        : '$' + p.amount.toFixed(2);
    } else {
      amtChip.textContent = 'Amount ?';
    }
    amtChip.classList.toggle('voice-chip-unset', p.amount === null);

    document.getElementById('_vi-c-wk').textContent = p.colLabel || ('Week ' + (p.weekIndex + 1));

    _updateConfirmBtn();
  }

  function _updateConfirmBtn() {
    var p = _pendingResult;
    var hasSubs = p && p.rowId
      ? _bridge().getRows().some(function(r){ return r.parentId === p.rowId; })
      : false;
    var subOk = !hasSubs || (p._subRowId !== null && p._subRowId !== undefined);
    var ok = !!(p && p.rowId && p.amount !== null && subOk);
    document.getElementById('_vi-confirm').disabled = !ok;
  }

  function _hideConfirmSheet() {
    document.getElementById('_vi-sheet').classList.remove('active');
    _pendingResult = null;
  }

  // ── Category picker ────────────────────────────────────────────────────
  function _showCatPicker(onSelect) {
    var rows = _bridge().getRows();
    var list = document.getElementById('_vi-cat-list');
    list.innerHTML = '';
    rows.forEach(function (row) {
      var li = document.createElement('li');
      li.className = 'voice-cat-item';
      li.dataset.label = row.label;
      li.textContent = (row.parentId ? '└ ' : '') + row.label;
      li.addEventListener('click', function () { _hideCatPicker(); onSelect(row); });
      list.appendChild(li);
    });
    document.getElementById('_vi-cat-search').value = '';
    document.getElementById('_vi-cat-picker').classList.add('active');
    setTimeout(function () { document.getElementById('_vi-cat-search').focus(); }, 80);
  }
  function _hideCatPicker() {
    document.getElementById('_vi-cat-picker').classList.remove('active');
  }

  // ── Wire event handlers ────────────────────────────────────────────────
  function _wireHandlers() {
    document.getElementById('_vi-c-cat').addEventListener('click', function () {
      _showCatPicker(function (row) {
        _pendingResult.rowId      = row.id;
        _pendingResult.rowLabel   = row.label;
        _pendingResult.confidence = 1.0;
        _refreshSheet();
      });
    });

    document.getElementById('_vi-c-amt').addEventListener('click', function () {
      var v = window.prompt('Enter amount:', _pendingResult.amount !== null ? _pendingResult.amount : '');
      var n = parseFloat(v);
      if (!isNaN(n) && n > 0) { _pendingResult.amount = n; _refreshSheet(); }
    });

    document.getElementById('_vi-c-wk').addEventListener('click', function () {
      var cols = _bridge().getCols();
      var next = (_pendingResult.weekIndex + 1) % cols.length;
      _pendingResult.weekIndex = next;
      _pendingResult.colId     = cols[next].id;
      _pendingResult.colLabel  = cols[next].label;
      _refreshSheet();
    });

    document.getElementById('_vi-confirm').addEventListener('click', function () {
      if (_pendingResult) _applyResult(_pendingResult);
    });

    document.getElementById('_vi-cancel').addEventListener('click', _hideConfirmSheet);

    document.getElementById('_vi-create-btn').addEventListener('click', function () {
      var name = window.prompt('New category name:');
      if (!name || !name.trim()) return;
      var br = _bridge();
      var before = br.getRows().length;
      br.forkCurrentMonth();
      br.addRow();
      var rows = br.getRows();
      if (rows.length === before) { _toast('Maximum rows reached.'); return; }
      var newRow = rows[rows.length - 1];
      newRow.label = name.trim();
      br.render();
      _pendingResult.rowId      = newRow.id;
      _pendingResult.rowLabel   = newRow.label;
      _pendingResult.confidence = 1.0;
      _refreshSheet();
    });

    document.getElementById('_vi-cat-back').addEventListener('click', _hideCatPicker);

    document.getElementById('_vi-cat-search').addEventListener('input', function () {
      var q = this.value.toLowerCase();
      document.querySelectorAll('.voice-cat-item').forEach(function (li) {
        li.style.display = li.dataset.label.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
      });
    });
  }

  // ── Build all DOM elements (called once in init) ───────────────────────
  function _buildUI() {
    // FAB
    var fab = document.createElement('button');
    fab.id = '_vi-fab'; fab.className = 'voice-fab';
    fab.setAttribute('aria-label', 'Voice input');
    fab.innerHTML = '🎤';
    fab.addEventListener('click', start);
    document.body.appendChild(fab);

    // Listening overlay
    var ov = document.createElement('div');
    ov.id = '_vi-ov'; ov.className = 'voice-listening-overlay';
    ov.innerHTML = '<div class="voice-pulse-ring"></div>' +
                   '<p id="_vi-live" class="voice-live-transcript">Listening…</p>';
    ov.addEventListener('click', stop);
    document.body.appendChild(ov);

    // Confirm sheet
    var sheet = document.createElement('div');
    sheet.id = '_vi-sheet'; sheet.className = 'voice-confirm-sheet';
    sheet.innerHTML =
      '<div id="_vi-tts-row" class="voice-tts-row"><span>&#x1F50A;</span><span id="_vi-tts-text"></span></div>' +
      '<div id="_vi-heard" class="voice-heard"></div>' +
      '<div id="_vi-last-week-note" class="voice-warning" style="display:none">' +
        'Did you mean last month\’s Week 4? If so, close and navigate to that month first.' +
      '</div>' +
      '<div id="_vi-forecast-note" class="voice-forecast-note" style="display:none">' +
        '📂 Forecast month — you\'re editing a future month.' +
      '</div>' +
      '<div id="_vi-no-cat" class="voice-warning" style="display:none">No category matched — tap Category to pick one.</div>' +
      '<div id="_vi-sub-section" style="display:none">' +
        '<div class="voice-sub-label">Which subcategory?</div>' +
        '<div id="_vi-sub-chips" class="voice-sub-chips"></div>' +
      '</div>' +
      '<div class="voice-chips">' +
        '<button id="_vi-c-cat" class="voice-chip">Category ?</button>' +
        '<button id="_vi-c-amt" class="voice-chip">Amount ?</button>' +
        '<button id="_vi-c-wk"  class="voice-chip">Week ?</button>' +
      '</div>' +
      '<div id="_vi-create-cat" style="display:none">' +
        '<button class="voice-create-cat" id="_vi-create-btn">+ Create new category</button>' +
      '</div>' +
      '<div class="voice-sheet-actions">' +
        '<button id="_vi-cancel" class="voice-btn-cancel">Cancel</button>' +
        '<button id="_vi-confirm" class="voice-btn-confirm" disabled>✓ Confirm</button>' +
      '</div>';
    document.body.appendChild(sheet);

    // Category picker
    var picker = document.createElement('div');
    picker.id = '_vi-cat-picker'; picker.className = 'voice-cat-picker';
    picker.innerHTML =
      '<div class="voice-cat-picker-header">' +
        '<button id="_vi-cat-back" class="voice-btn-cancel" style="flex:none;padding:.5rem .75rem;">←</button>' +
        '<input type="search" id="_vi-cat-search" placeholder="Search…" autocomplete="off">' +
      '</div>' +
      '<ul id="_vi-cat-list" class="voice-cat-list"></ul>';
    document.body.appendChild(picker);

    _wireHandlers();
  }

  // ── Public ─────────────────────────────────────────────────────────────
  function init(trackerType) {
    _tracker = trackerType || 'expenses';
    if (!_getSpeechAPI()) return;
    _buildUI();
  }

  return { init: init, start: start, stop: stop };
})();

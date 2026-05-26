// tracker-sync.js — Shared server-sync manager for FiApp trackers
// Usage:
//   var sync = createSyncManager(storageKey, saveApiPath, loadApiPath, opts);
//   var syncToServer   = sync.syncToServer;
//   var loadFromServer = sync.loadFromServer;
//   var setSyncStatus  = sync.setSyncStatus;
//   var saveLocal      = sync.saveLocal;
//
// opts (all optional):
//   getState()       : returns the tracker's current state object (required for saveLocal)
//   onReload()       : called after server data is loaded in the stale-reload path
//   showQuotaWarning(): called when localStorage quota is exceeded
//   contentGuard(data): returns true if server response has real content worth persisting
//                       default: checks data.rows || data.cells || data.rowsByMonth

function createSyncManager(storageKey, saveApiPath, loadApiPath, opts) {
  opts = opts || {};

  var _syncTimer      = null;
  var _syncPending    = false;
  var _serverLoaded   = false;
  var _wtWasBlocking  = false;
  var _reloadPending  = false;

  function setSyncStatus(msg, cls) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = msg; el.className = cls || '';
  }

  function syncToServer() {
    if (!window.__currentUser) { setSyncStatus('Offline', ''); return; }
    try {
      var _wts = JSON.parse(localStorage.getItem('fiapp_walkthrough_v1') || 'null');
      if (_wts && _wts.active) { setSyncStatus('', ''); return; }
    } catch (_) {}
    if (!_serverLoaded) {
      if (_wtWasBlocking && !_reloadPending) {
        _reloadPending = true;
        setSyncStatus('Loading…', '');
        loadFromServer().then(function() {
          if (opts.onReload) opts.onReload();
          _reloadPending = false;
          setSyncStatus('', '');
        }).catch(function() {
          _serverLoaded = true;
          _reloadPending = false;
          setSyncStatus('', '');
        });
      }
      return;
    }
    _syncPending = true;
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(function() {
      _syncPending = false;
      fetch(saveApiPath, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window._CSRF || ''
        },
        body: localStorage.getItem(storageKey) || 'null'
      })
      .then(function(r) {
        if (r.ok) {
          setSyncStatus(
            '☁ Saved at ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
            'synced'
          );
        } else {
          setSyncStatus('⚠ Sync failed', 'failed');
        }
      })
      .catch(function() { setSyncStatus('⚠ Offline', 'failed'); });
    }, 1500);

    // Flush to server immediately on page unload if a sync is still pending
    window.addEventListener('beforeunload', function() {
      if (!_syncPending) return;
      fetch(saveApiPath, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': window._CSRF || ''
        },
        body: localStorage.getItem(storageKey) || 'null'
      });
    }, { once: true });
  }

  function loadFromServer() {
    if (!window.__currentUser) return Promise.resolve();
    try {
      var _wtr = JSON.parse(localStorage.getItem('fiapp_walkthrough_v1') || 'null');
      if (_wtr && _wtr.active) {
        _wtWasBlocking = true;
        return Promise.resolve();
      }
    } catch (_) {}
    return fetch(loadApiPath).then(function(res) {
      if (!res.ok) { _serverLoaded = true; return; }
      return res.json().then(function(resp) {
        var data = resp && resp.data;
        var guard = opts.contentGuard || function(d) {
          return Array.isArray(d.rows) || d.cells || d.rowsByMonth;
        };
        if (data && typeof data === 'object' && guard(data)) {
          var _srvHas = data.cells && Object.keys(data.cells).length > 0;
          var _locRaw = localStorage.getItem(storageKey);
          var _locHas = _locRaw && (function() {
            try { var l = JSON.parse(_locRaw); return l.cells && Object.keys(l.cells).length > 0; }
            catch (_) { return false; }
          })();
          if (_srvHas || !_locHas) {
            try {
              var _ln = JSON.parse(_locRaw || 'null');
              if (_ln && _ln.currentYear != null) {
                data.currentYear = _ln.currentYear;
                data.currentMonth = _ln.currentMonth;
              }
            } catch (_) {}
            localStorage.setItem(storageKey, JSON.stringify(data));
          }
        }
        _serverLoaded = true;
      });
    }).catch(function() { _serverLoaded = true; });
  }

  function saveLocal() {
    try {
      var _s = JSON.stringify(opts.getState ? opts.getState() : {});
      if (localStorage.getItem(storageKey) !== _s) localStorage.setItem(storageKey, _s);
    } catch (e) {
      if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
        console.error('FiApp: localStorage quota exceeded');
        if (opts.showQuotaWarning) opts.showQuotaWarning();
      } else { throw e; }
    }
  }

  return {
    syncToServer:   syncToServer,
    loadFromServer: loadFromServer,
    setSyncStatus:  setSyncStatus,
    saveLocal:      saveLocal
  };
}

// rates-utils.js — Shared exchange-rate cache helper (localStorage + /api/exchange)
// Provides: fiappGetRates(base, force), fiappConvert(amount, from, to), fiappRatesCachedAt(base)
(function(global){
  var LS_TTL   = 7  * 24 * 3600 * 1000; // 7 days  — refresh interval
  var DEAD_TTL = 14 * 24 * 3600 * 1000; // 14 days — delete if unused this long

  function lsKey(base){ return 'fiapp_exchange_rates_' + base.toUpperCase(); }

  function lsGet(base){
    try {
      var k = lsKey(base);
      var raw = localStorage.getItem(k);
      if(!raw) return null;
      var obj = JSON.parse(raw);
      if(!obj || !obj.fetched_at) return null;
      var now = Date.now();
      var lastUsed = obj.last_used_at ? new Date(obj.last_used_at).getTime()
                                      : new Date(obj.fetched_at).getTime();
      // Unused for 14 days — delete
      if(now - lastUsed > DEAD_TTL){ localStorage.removeItem(k); return null; }
      // Stale (>7 days since fetch) — needs refresh; return null so caller fetches fresh
      if(now - new Date(obj.fetched_at).getTime() > LS_TTL) return null;
      // Fresh cache hit — bump last_used_at
      obj.last_used_at = new Date().toISOString();
      localStorage.setItem(k, JSON.stringify(obj));
      return obj;
    } catch(e){ return null; }
  }

  function lsSet(base, rates, fetched_at){
    try {
      localStorage.setItem(lsKey(base), JSON.stringify({
        rates: rates,
        fetched_at: fetched_at,
        last_used_at: new Date().toISOString()
      }));
    } catch(e){}
  }

  /**
   * fiappGetRates(base, force)
   * Returns Promise<{rates, fetched_at}>.
   * base:  currency code string, e.g. 'USD'
   * force: if true, bypass localStorage and request fresh data from server
   */
  global.fiappGetRates = async function(base, force){
    base = (base || 'USD').toUpperCase();
    if(!force){
      var cached = lsGet(base);
      if(cached) return cached;
    }
    var url = '/api/exchange?base=' + encodeURIComponent(base) + (force ? '&force=1' : '');
    var resp = await fetch(url);
    if(!resp.ok) throw new Error('Exchange API error ' + resp.status);
    var data = await resp.json();
    if(data.error) throw new Error(data.error);
    lsSet(base, data.rates, data.fetched_at);
    return {rates: data.rates, fetched_at: data.fetched_at};
  };

  /**
   * fiappConvert(amount, from, to)
   * Returns Promise<number>.
   */
  global.fiappConvert = async function(amount, from, to){
    from = (from || 'USD').toUpperCase();
    to   = (to   || 'USD').toUpperCase();
    if(from === to) return Number(amount);
    var obj  = await global.fiappGetRates(from);
    var rate = obj.rates[to];
    if(rate == null) throw new Error('Unknown currency: ' + to);
    return Number(amount) * rate;
  };

  /**
   * fiappRatesCachedAt(base)
   * Returns Date of last cached fetch, or null if not cached / expired.
   */
  global.fiappRatesCachedAt = function(base){
    var obj = lsGet(base || 'USD');
    return obj ? new Date(obj.fetched_at) : null;
  };

  // Init-time sweep: delete any rate cache entries unused for more than 14 days
  (function(){
    try {
      var prefix = 'fiapp_exchange_rates_';
      var now = Date.now();
      for(var i = localStorage.length - 1; i >= 0; i--){
        var k = localStorage.key(i);
        if(!k || k.indexOf(prefix) !== 0) continue;
        try {
          var obj = JSON.parse(localStorage.getItem(k) || 'null');
          if(!obj) { localStorage.removeItem(k); continue; }
          var lastUsed = obj.last_used_at ? new Date(obj.last_used_at).getTime()
                                          : new Date(obj.fetched_at || 0).getTime();
          if(now - lastUsed > DEAD_TTL) localStorage.removeItem(k);
        } catch(e){ localStorage.removeItem(k); }
      }
    } catch(e){}
  })();

})(window);

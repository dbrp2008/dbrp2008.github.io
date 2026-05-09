// rates-utils.js — Shared exchange-rate cache helper (localStorage + /api/exchange)
// Provides: fiappGetRates(base, force), fiappConvert(amount, from, to), fiappRatesCachedAt(base)
(function(global){
  var LS_TTL = 7 * 24 * 3600 * 1000; // 7 days in ms

  function lsKey(base){ return 'fiapp_exchange_rates_' + base.toUpperCase(); }

  function lsGet(base){
    try {
      var raw = localStorage.getItem(lsKey(base));
      if(!raw) return null;
      var obj = JSON.parse(raw);
      if(!obj || !obj.fetched_at) return null;
      if(Date.now() - new Date(obj.fetched_at).getTime() > LS_TTL) return null;
      return obj; // {rates, fetched_at}
    } catch(e){ return null; }
  }

  function lsSet(base, rates, fetched_at){
    try {
      localStorage.setItem(lsKey(base), JSON.stringify({rates: rates, fetched_at: fetched_at}));
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

})(window);

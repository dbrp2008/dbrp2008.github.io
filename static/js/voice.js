/**
 * voice.js
 * Editorial voice layer for FiApp. Context determines mode — no user-facing selector.
 * Rules:
 *   - Returns null (silence) when user is mid-task or message already shown/resolved
 *   - Guidance disappears permanently once its resolvedWhen() condition is met
 *   - One message per key per session (sessionStorage gate)
 *
 * Usage:
 *   voice.observation('spend-trend', 'Dining is up 12% vs last month.')
 *   voice.acknowledgment('close-complete', 'April is closed.')
 *   voice.guidance('add-income', 'Add income to calculate remaining budget.',
 *                  function(){ return grossForMonth(todayMK()) > 0; })
 */

var voice = (function() {

  var RESOLVED_PREFIX = 'voice_resolved_';
  var SHOWN_PREFIX    = 'voice_shown_';

  function _isMidTask() {
    var el = document.activeElement;
    if(!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.contentEditable === 'true';
  }

  function _isResolved(key) {
    return !!localStorage.getItem(RESOLVED_PREFIX + key);
  }

  function _isShownThisSession(key) {
    return !!sessionStorage.getItem(SHOWN_PREFIX + key);
  }

  function _markShown(key) {
    sessionStorage.setItem(SHOWN_PREFIX + key, '1');
  }

  function _markResolved(key) {
    localStorage.setItem(RESOLVED_PREFIX + key, '1');
  }

  /**
   * Observation: factual, no judgement. For snapshot & analytics.
   * Returns the text string, or null if silenced.
   */
  function observation(key, text) {
    if(_isMidTask() || _isShownThisSession(key)) return null;
    _markShown(key);
    return text;
  }

  /**
   * Acknowledgment: warm, behavior-focused. For close flow & return states.
   * Returns the text string, or null if silenced.
   */
  function acknowledgment(key, text) {
    if(_isMidTask() || _isShownThisSession(key)) return null;
    _markShown(key);
    return text;
  }

  /**
   * Guidance: directional, transitional. Disappears when resolvedWhen() returns true.
   * resolvedWhen: function() → boolean, called every render.
   * Returns the text string, or null if resolved/silenced.
   */
  function guidance(key, text, resolvedWhen) {
    if(_isResolved(key)) return null;
    if(typeof resolvedWhen === 'function' && resolvedWhen()) {
      _markResolved(key);
      return null;
    }
    if(_isMidTask()) return null;
    return text;
  }

  /**
   * Resolve a guidance key manually (e.g. after user completes the action).
   */
  function resolve(key) {
    _markResolved(key);
  }

  /**
   * Reset all resolved/shown state (useful after account switch or dev reset).
   */
  function reset() {
    Object.keys(localStorage).forEach(function(k) {
      if(k.startsWith(RESOLVED_PREFIX)) localStorage.removeItem(k);
    });
    Object.keys(sessionStorage).forEach(function(k) {
      if(k.startsWith(SHOWN_PREFIX)) sessionStorage.removeItem(k);
    });
  }

  return { observation: observation, acknowledgment: acknowledgment, guidance: guidance, resolve: resolve, reset: reset };

})();

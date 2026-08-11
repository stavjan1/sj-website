/* SJ / זרם — first-party pageview beacon.

   One fetch per page load to /api/analytics. No cookies, no third party, no
   identifiers stored on the device; the server counts a day's uniques from a
   salted hash it throws away the next day. An ad blocker cannot remove this
   the way it removes Clarity, so the numbers are the real numbers.

   Who is NOT counted, and how to control it:
     • Stav's own devices — visit any page once with ?notrack=1 and the device
       is excluded for good (?notrack=0 undoes it). Logging into זרם as the
       admin sets the same flag automatically.
     • Automation and headless browsers (navigator.webdriver, known agents) —
       this is what keeps Claude's own browsing out of the numbers.
     • localhost and file:// — development is not traffic.
   Bots that slip past the browser check are caught server-side and counted in
   a separate bucket, never folded into the real total. */
(function () {
  'use strict';

  var FLAG = 'sj_notrack';

  function excluded() {
    try {
      var qs = new URLSearchParams(location.search);
      if (qs.has('notrack')) {
        if (qs.get('notrack') === '0') localStorage.removeItem(FLAG);
        else localStorage.setItem(FLAG, '1');
      }
      if (localStorage.getItem(FLAG) === '1') return true;
    } catch (e) { /* private mode — fall through and count the visit */ }

    if (navigator.webdriver) return true;
    if (/headless|puppeteer|playwright|selenium|phantom|bot|crawl|spider/i.test(navigator.userAgent || '')) return true;

    var h = location.hostname;
    if (!h || h === 'localhost' || h === '127.0.0.1' || location.protocol === 'file:') return true;

    return false;
  }

  function site() {
    var p = location.pathname.toLowerCase();
    // זרם is the app and its own landing page; everything else is the office site.
    return (p.indexOf('/sale') === 0 || p.indexOf('/zerem') === 0 || p.indexOf('/ask') === 0) ? 'zerem' : 'site';
  }

  function send() {
    var payload = JSON.stringify({
      s: site(),
      p: location.pathname,
      r: document.referrer || '',
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/analytics', new Blob([payload], { type: 'application/json' }));
        return;
      }
    } catch (e) { /* fall through to fetch */ }
    // keepalive so the request survives the user navigating away immediately.
    fetch('/api/analytics', {
      method: 'POST', body: payload, keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }).catch(function () { /* analytics never breaks a page */ });
  }

  if (excluded()) return;
  if (document.visibilityState === 'prerender') {
    document.addEventListener('visibilitychange', function once() {
      if (document.visibilityState !== 'prerender') {
        document.removeEventListener('visibilitychange', once);
        send();
      }
    });
  } else {
    send();
  }
})();

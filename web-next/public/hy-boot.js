// Start-up safety net. Written in old-style JavaScript on purpose so it runs on every phone.
// If the app hasn't started after a while (very old phone browser, or a script error), show a clear
// message with Reload instead of a frozen splash, and report it once (browser version only, no
// personal data) so we can see how many phones are affected.
(function () {
  var errors = [];
  window.addEventListener('error', function (e) {
    if (errors.length < 3) errors.push(String((e && e.message) || 'error').slice(0, 160));
  });
  var shown = false;
  function report(reason) {
    try {
      var body = JSON.stringify({ reason: reason, errors: errors, ua: navigator.userAgent, path: location.pathname, t: Math.round((window.performance && performance.now()) || 0) });
      if (navigator.sendBeacon) navigator.sendBeacon('/api/boot-fail', body);
      else { var x = new XMLHttpRequest(); x.open('POST', '/api/boot-fail'); x.send(body); }
    } catch (e) {}
  }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.appendChild(document.createTextNode(text)); return n; }
  function show() {
    if (shown || window.__thBooted || !document.body) return;
    shown = true;
    report(errors.length ? 'error' : 'timeout');
    var android = /Android/i.test(navigator.userAgent);
    var box = el('div', 'boot-fail');
    var card = el('div', 'boot-fail-card');
    card.appendChild(el('h1', '', 'treehouse is taking too long to open'));
    card.appendChild(el('p', '', 'Your internet may be slow, or your phone’s web browser may be out of date.'));
    var again = el('button', 'btn btn-primary btn-block', 'Reload');
    again.onclick = function () { location.reload(); };
    card.appendChild(again);
    if (android) {
      card.appendChild(el('p', 'boot-fail-small', 'Still stuck? Update “Android System WebView” and “Chrome” in the Play Store, then open treehouse again.'));
      var wv = el('a', 'btn btn-soft btn-block', 'Update Android System WebView');
      wv.href = 'https://play.google.com/store/apps/details?id=com.google.android.webview';
      card.appendChild(wv);
    } else {
      card.appendChild(el('p', 'boot-fail-small', 'Still stuck? Update your phone’s software (Settings › General › Software Update), then open treehouse again.'));
    }
    box.appendChild(card);
    document.body.appendChild(box);
  }
  // A script error before start-up usually means an outdated browser: say so sooner.
  setTimeout(function () { if (errors.length) show(); }, 6000);
  setTimeout(show, 20000);
})();

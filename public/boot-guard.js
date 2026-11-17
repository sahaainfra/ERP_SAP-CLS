// The application's first script could not be loaded (part 166.4). The page would then stay blank: the browser reports a failed module script
// only on its <script> element, not to the page. Seen in Chromium with the service worker in control, on full page loads in quick succession (the
// page crawlers), as `net::ERR_ABORTED` on the entry script; a dropped connection on a phone does the same. This small classic script, loaded
// before the application, reloads the page once (twice at most) and, if that does not help, says so instead of showing nothing.
(function () {
  var KEY = 'erp.boot.retries';
  var done = false;
  function retries() { try { return Number(sessionStorage.getItem(KEY)) || 0; } catch (e) { return 0; } }
  function failed() {
    if (done || window.__erpBooted) return;
    done = true;
    var n = retries();
    if (n < 2) {
      try { sessionStorage.setItem(KEY, String(n + 1)); } catch (e) { /* reload anyway */ }
      window.location.reload();
      return;
    }
    try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing kept */ }
    var root = document.getElementById('root');
    if (root && (!root.firstChild || root.querySelector('[data-boot-shell]'))) { // empty, or still the shell drawn by the HTML
      root.innerHTML = '<main id="main" class="state state-error" role="alert"><h1>The application could not be loaded</h1>'
        + '<p>Check the connection, then reload the page.</p></main>';
    }
  }
  // a module script that fails fires "error" on its element only; the capture phase of the window sees it
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'SCRIPT' && t.type === 'module') failed();
  }, true);
  // module scripts run before "load"; if the application has not started by then, its script did not arrive
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (window.__erpBooted) { try { sessionStorage.removeItem(KEY); } catch (e) { /* nothing kept */ } return; }
      failed();
    }, 1000);
  });
}());

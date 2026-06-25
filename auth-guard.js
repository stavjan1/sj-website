/* ============================================================
   SJ – Access guard for the client area (/sale)
   Requires a logged-in Netlify Identity user. If the visitor is
   not authenticated, they are sent to the login page.
   Load order in the protected page <head>:
     1) <style id="auth-gate">body{visibility:hidden}</style>
     2) netlify-identity-widget.js
     3) this file (auth-guard.js)
   ============================================================ */
(function () {
    'use strict';

    var LOGIN_URL = '/login.html';

    function reveal() {
        var gate = document.getElementById('auth-gate');
        if (gate && gate.parentNode) gate.parentNode.removeChild(gate);
        document.documentElement.style.visibility = '';
        if (document.body) document.body.style.visibility = 'visible';
    }

    function deny() {
        // Remember where the user wanted to go, then bounce to login.
        try { sessionStorage.setItem('sj_return_to', window.location.pathname); } catch (e) {}
        window.location.replace(LOGIN_URL);
    }

    // If the widget script never loaded, fail safe to the login page
    if (!window.netlifyIdentity) { deny(); return; }

    netlifyIdentity.on('init', function (user) {
        if (user) { reveal(); } else { deny(); }
    });
    netlifyIdentity.on('login', function () { reveal(); });
    netlifyIdentity.on('logout', function () { deny(); });

    netlifyIdentity.init();
})();

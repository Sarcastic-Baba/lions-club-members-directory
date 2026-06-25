(function () {
    'use strict';

    function currentPage() {
        return window.location.pathname.replace(/^\//, '') + window.location.search + window.location.hash;
    }

    function redirectToLogin() {
        window.location.replace('login.html?next=' + encodeURIComponent(currentPage()));
    }

    if (typeof Auth === 'undefined' || !Auth.init) {
        redirectToLogin();
        return;
    }

    Auth.init()
        .then(function () {
            if (Auth.getUser()) {
                document.documentElement.classList.remove('auth-guard-pending');
                return;
            }
            redirectToLogin();
        })
        .catch(redirectToLogin);
})();

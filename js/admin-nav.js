(function () {
    'use strict';

    function adminLinkHtml(isActive) {
        return '<a href="admin.html" class="feed-nav-link' + (isActive ? ' active' : '') + '" data-admin-nav-link>' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">' +
                '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
                '<path d="M12 8v4M12 16h.01"/>' +
            '</svg>' +
            'Admin' +
        '</a>';
    }

    function landingAdminLinkHtml(isActive) {
        return '<a href="admin.html" class="' + (isActive ? 'active' : '') + '" data-admin-nav-link>Admin</a>';
    }

    function revealAdminLinks() {
        var isAdminPage = /(^|\/)admin\.html$/.test(window.location.pathname);
        document.querySelectorAll('.feed-nav').forEach(function (nav) {
            var existing = nav.querySelector('[data-admin-nav-link]');
            if (existing) {
                existing.hidden = false;
                return;
            }

            var profileLink = nav.querySelector('a[href="profile.html"]');
            var wrapper = document.createElement('div');
            wrapper.innerHTML = adminLinkHtml(isAdminPage);
            var link = wrapper.firstChild;

            if (profileLink && profileLink.parentNode === nav) {
                profileLink.insertAdjacentElement('afterend', link);
            } else {
                nav.appendChild(link);
            }
        });

        document.querySelectorAll('.landing-routebar').forEach(function (nav) {
            var existing = nav.querySelector('[data-admin-nav-link]');
            if (existing) {
                existing.hidden = false;
                return;
            }

            var profileLink = nav.querySelector('a[href="profile.html"]');
            var wrapper = document.createElement('div');
            wrapper.innerHTML = landingAdminLinkHtml(isAdminPage);
            var link = wrapper.firstChild;

            if (profileLink && profileLink.parentNode === nav) {
                profileLink.insertAdjacentElement('afterend', link);
            } else {
                nav.appendChild(link);
            }
        });
    }

    function removeAdminLinks() {
        document.querySelectorAll('[data-admin-nav-link]').forEach(function (link) {
            link.remove();
        });
    }

    function getProfile() {
        if (Auth.getProfile) {
            return Auth.getProfile({ forceRefresh: true });
        }

        return Auth.getToken().then(function (token) {
            if (!token) return null;
            return fetch('/api/profile', {
                headers: { Authorization: 'Bearer ' + token }
            }).then(function (r) {
                if (!r.ok) return null;
                return r.json();
            });
        }).then(function (data) {
            return data && data.profile ? data.profile : null;
        }).catch(function () {
            return null;
        });
    }

    function isAdminProfile(profile) {
        return profile &&
            profile.status === 'active' &&
            (profile.role === 'admin' || profile.role === 'district_admin');
    }

    function refreshAdminNav() {
        if (typeof Auth === 'undefined' || !Auth.init) return;

        Auth.init().then(function () {
            if (!Auth.getUser()) {
                removeAdminLinks();
                return;
            }

            var cachedProfile = Auth.getCachedProfile ? Auth.getCachedProfile() : null;
            if (cachedProfile) {
                if (isAdminProfile(cachedProfile)) revealAdminLinks();
                else removeAdminLinks();
            }

            getProfile().then(function (profile) {
                if (isAdminProfile(profile)) {
                    revealAdminLinks();
                } else if (profile || !cachedProfile) {
                    removeAdminLinks();
                }
            });
        });
    }

    refreshAdminNav();

    if (typeof Auth !== 'undefined' && Auth.onChange) {
        Auth.onChange(refreshAdminNav);
    }
})();

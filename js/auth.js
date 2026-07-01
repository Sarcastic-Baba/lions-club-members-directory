/**
 * Lions Club 321 C1 — Shared Clerk Authentication Module  (v6)
 * Include this script on every page. No other Clerk script tags needed.
 *
 * Config is fetched from /api/auth/config which must return:
 *   { clerkConfigured, clerkPublishableKey }
 */
var Auth = (function () {
    'use strict';

    var clerkInstance = null;
    var currentUser = null;
    var listeners = [];
    var initialized = false;
    var initPromise = null;
    var clerkReady = false;
    var stylesInjected = false;
    var tempAdminConfigured = false;
    var tempAdminTokenKey = 'lions_temp_admin_token';
    var authConfigCacheKey = 'lions_auth_config_cache';
    var authConfigCacheMs = 10 * 60 * 1000;
    var profileSnapshotCachePrefix = 'lions_profile_snapshot_';
    var profileSnapshotCacheMs = 30 * 1000;

    function installPageTransitions() {
        if (typeof document === 'undefined') return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

        document.documentElement.classList.add('page-transition-enabled');

        window.addEventListener('pageshow', function () {
            document.documentElement.classList.remove('page-transition-out');
        });

        document.addEventListener('click', function (event) {
            if (event.defaultPrevented || event.button !== 0) return;
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

            var link = event.target.closest ? event.target.closest('a[href]') : null;
            if (!link) return;
            if (link.target && link.target !== '_self') return;
            if (link.hasAttribute('download')) return;

            var href = link.getAttribute('href');
            if (!href || href.charAt(0) === '#') return;
            if (/^(mailto:|tel:|javascript:)/i.test(href)) return;

            var nextUrl;
            try {
                nextUrl = new URL(href, window.location.href);
            } catch (err) {
                return;
            }

            if (nextUrl.origin !== window.location.origin) return;
            if (nextUrl.href === window.location.href) return;
            if (nextUrl.pathname === window.location.pathname && nextUrl.search === window.location.search && nextUrl.hash) return;

            event.preventDefault();
            document.documentElement.classList.add('page-transition-out');
            window.setTimeout(function () {
                window.location.href = nextUrl.href;
            }, 170);
        });
    }

    installPageTransitions();

    function injectStyles() {
        if (stylesInjected) return;
        stylesInjected = true;
        var style = document.createElement('style');
        style.textContent = [
            '.supabase-auth-menu { display: flex; align-items: center; gap: 0.75rem; }',
            '.supabase-auth-name { font-size: 0.875rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }',
            '.supabase-auth-profile-link { font-size: 0.8rem; color: var(--gold, #FACE31); text-decoration: none; white-space: nowrap; }',
            '.supabase-auth-profile-link:hover { text-decoration: underline; }',
            '.supabase-auth-btn { padding: 0.4rem 1rem; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem; font-weight: 500; transition: opacity 0.2s; }',
            '.supabase-auth-btn:hover { opacity: 0.85; }',
            '.supabase-auth-btn-signin { background: var(--blue, #102053); color: #fff; }',
            '.supabase-auth-btn-signout { background: transparent; color: var(--white, #fff); border: 1px solid rgba(255,255,255,0.3); }',
            '.supabase-auth-btn-signout:hover { background: rgba(255,255,255,0.1); }',
            '.supabase-auth-info { padding: 1rem; text-align: center; color: var(--text-muted, #6b7280); font-size: 0.9rem; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    function notifyListeners() {
        listeners.forEach(function (fn) { fn(!!currentUser, currentUser); });
    }

    function buildTempAdminUser(user) {
        user = user || {};
        return {
            id: user.id || 'temp_admin',
            fullName: user.fullName || 'Temporary Admin',
            isTempAdmin: true,
            primaryEmailAddress: {
                emailAddress: user.email || ''
            }
        };
    }

    function restoreTempAdminSession() {
        var token = localStorage.getItem(tempAdminTokenKey);
        if (!token) return Promise.resolve(false);

        return fetch('/api/auth/temp-admin/session', {
            headers: { Authorization: 'Bearer ' + token }
        }).then(function (r) {
            if (!r.ok) throw new Error('No temporary admin session');
            return r.json();
        }).then(function (data) {
            injectStyles();
            currentUser = buildTempAdminUser(data.user);
            clerkReady = true;
            notifyListeners();
            return true;
        }).catch(function () {
            localStorage.removeItem(tempAdminTokenKey);
            return false;
        });
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function readCache(key, maxAgeMs) {
        try {
            var raw = sessionStorage.getItem(key);
            if (!raw) return null;

            var item = JSON.parse(raw);
            if (!item || !item.savedAt || !Object.prototype.hasOwnProperty.call(item, 'value')) return null;

            if (Date.now() - item.savedAt > maxAgeMs) {
                sessionStorage.removeItem(key);
                return null;
            }

            return item.value;
        } catch (err) {
            return null;
        }
    }

    function writeCache(key, value) {
        try {
            sessionStorage.setItem(key, JSON.stringify({
                savedAt: Date.now(),
                value: value
            }));
        } catch (err) {}
    }

    function removeCache(key) {
        try {
            sessionStorage.removeItem(key);
        } catch (err) {}
    }

    function clearCachePrefix(prefix) {
        try {
            for (var i = sessionStorage.length - 1; i >= 0; i--) {
                var key = sessionStorage.key(i);
                if (key && key.indexOf(prefix) === 0) sessionStorage.removeItem(key);
            }
        } catch (err) {}
    }

    function isLoginPage() {
        return !!document.getElementById('sign-in-container') || /(^|\/)login\.html$/i.test(window.location.pathname);
    }

    function currentPage() {
        return window.location.pathname.replace(/^\//, '') + window.location.search + window.location.hash;
    }

    function getLoginUrl() {
        return 'login.html?next=' + encodeURIComponent(currentPage());
    }

    function getAuthConfig() {
        var cached = readCache(authConfigCacheKey, authConfigCacheMs);
        if (cached) return Promise.resolve(cached);

        return fetch('/api/auth/config', { cache: 'force-cache' })
            .then(function (r) { return r.json(); })
            .then(function (config) {
                writeCache(authConfigCacheKey, config);
                return config;
            });
    }

    function getProfileCacheKey() {
        if (!currentUser || !currentUser.id) return null;
        return profileSnapshotCachePrefix + String(currentUser.id).replace(/[^a-zA-Z0-9._:-]/g, '_');
    }

    function normalizeProfileSnapshot(profile) {
        if (!profile) return null;
        return {
            id: profile.id,
            clerk_user_id: profile.clerk_user_id,
            name: profile.name,
            role: profile.role,
            status: profile.status,
            club: profile.club,
            designation: profile.designation,
            updated_at: profile.updated_at || null,
            isTempAdmin: !!profile.isTempAdmin
        };
    }

    function getCachedProfile() {
        var key = getProfileCacheKey();
        return key ? readCache(key, profileSnapshotCacheMs) : null;
    }

    function cacheProfile(profile) {
        var key = getProfileCacheKey();
        if (!key) return;

        var snapshot = normalizeProfileSnapshot(profile);
        if (snapshot) writeCache(key, snapshot);
        else removeCache(key);
    }

    function getProfile(options) {
        options = options || {};

        var cached = options.forceRefresh ? null : getCachedProfile();
        if (cached) return Promise.resolve(cached);

        return getToken().then(function (token) {
            if (!token) return null;
            return fetch('/api/profile', {
                cache: 'no-store',
                headers: { Authorization: 'Bearer ' + token }
            });
        }).then(function (r) {
            if (!r || !r.ok) return null;
            return r.json();
        }).then(function (data) {
            var profile = data && data.profile ? data.profile : null;
            cacheProfile(profile);
            return normalizeProfileSnapshot(profile);
        }).catch(function () {
            return null;
        });
    }

    // ==================== PUBLIC API ====================

    function init() {
        if (initPromise) return initPromise;
        initialized = true;

        initPromise = getAuthConfig()
            .then(function (config) {
                tempAdminConfigured = !!config.tempAdminConfigured;
                return restoreTempAdminSession().then(function (restored) {
                    if (restored) return null;

                    if (!config.clerkConfigured || !config.clerkPublishableKey) {
                        console.warn('[Auth] Clerk not configured');
                        if (tempAdminConfigured) {
                            injectStyles();
                            clerkReady = true;
                            notifyListeners();
                        }
                        return null;
                    }
                    injectStyles();
                    return loadClerkV6(config.clerkPublishableKey, { withUi: isLoginPage() });
                });
            })
            .catch(function (err) {
                console.warn('[Auth] Init failed:', err);
                return null;
            });

        return initPromise;
    }

    function signInTempAdmin(adminId, password) {
        return fetch('/api/auth/temp-admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ adminId: adminId, password: password })
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (err) {
                    throw new Error(err.error || 'Temporary admin sign in failed');
                });
            }
            return r.json();
        }).then(function (data) {
            localStorage.setItem(tempAdminTokenKey, data.token);
            currentUser = buildTempAdminUser(data.user);
            clerkReady = true;
            notifyListeners();
            var containers = document.querySelectorAll('[data-auth-ui]');
            containers.forEach(function (el) { doRender(el); });
            return currentUser;
        });
    }

    function isTempAdminConfigured() {
        return tempAdminConfigured;
    }

    function clearTempAdminSession() {
        localStorage.removeItem(tempAdminTokenKey);
        return fetch('/api/auth/temp-admin/logout', { method: 'POST' }).catch(function () {});
    }

    // Derive frontend API domain from publishable key (base64url encoded)
    function deriveDomain(publishableKey) {
        var parts = publishableKey.split('_');
        if (parts.length < 3) return null;
        var b64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
        while (b64.length % 4 !== 0) b64 += '=';
        try { return atob(b64).slice(0, -1); }
        catch (e) { return null; }
    }

    function loadClerkV6(publishableKey, options) {
        options = options || {};
        var domain = deriveDomain(publishableKey);
        if (!domain) {
            console.warn('[Auth] Failed to derive Clerk domain from key');
            return Promise.resolve(null);
        }

        var uiUrl = 'https://' + domain + '/npm/@clerk/ui@1/dist/ui.browser.js';
        var sdkUrl = 'https://' + domain + '/npm/@clerk/clerk-js@6/dist/clerk.browser.js';

        // Fallback: also try jsDelivr if Clerk CDN fails
        var uiUrlFallback = 'https://cdn.jsdelivr.net/npm/@clerk/ui/dist/ui.browser.js';
        var sdkUrlFallback = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@6/dist/clerk.browser.js';

        return Promise.resolve()
            .then(function () {
                if (!options.withUi) return null;
                return loadScriptWithFallback(uiUrl, uiUrlFallback, 'Clerk UI');
            })
            .then(function () {
                return loadClerkSdkWithFallback(sdkUrl, sdkUrlFallback, publishableKey);
            })
            .then(function () {
                if (!window.Clerk) throw new Error('window.Clerk not defined after loading SDK');
                if (options.withUi) {
                    return window.Clerk.load({
                        ui: { ClerkUI: window.__internal_ClerkUICtor }
                    });
                }
                return window.Clerk.load();
            })
            .then(function () {
                clerkInstance = window.Clerk;
                clerkReady = true;
                currentUser = clerkInstance.user || null;

                clerkInstance.addListener(function (payload) {
                    var previousUserId = currentUser && currentUser.id;
                    currentUser = payload.user || null;
                    if (previousUserId && (!currentUser || currentUser.id !== previousUserId)) {
                        clearCachePrefix(profileSnapshotCachePrefix);
                    }
                    notifyListeners();
                    var containers = document.querySelectorAll('[data-auth-ui]');
                    containers.forEach(function (el) { doRender(el); });
                });

                notifyListeners();
                return clerkInstance;
            })
            .catch(function (err) {
                console.warn('[Auth] Clerk load failed:', err.message || err);
                return null;
            });
    }

    function loadClerkSdkWithFallback(primaryUrl, fallbackUrl, publishableKey) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = primaryUrl;
            script.async = false;
            script.setAttribute('data-clerk-publishable-key', publishableKey);
            script.onload = resolve;
            script.onerror = function () {
                var fb = document.createElement('script');
                fb.src = fallbackUrl;
                fb.async = false;
                fb.setAttribute('data-clerk-publishable-key', publishableKey);
                fb.onload = resolve;
                fb.onerror = function () { reject(new Error('Clerk SDK failed to load from both CDNs')); };
                document.head.appendChild(fb);
            };
            document.head.appendChild(script);
        });
    }

    function loadScriptWithFallback(primaryUrl, fallbackUrl, label) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = primaryUrl;
            script.async = false;
            script.onload = resolve;
            script.onerror = function () {
                var fb = document.createElement('script');
                fb.src = fallbackUrl;
                fb.async = false;
                fb.onload = resolve;
                fb.onerror = function () { reject(new Error((label || 'Script') + ' failed to load from both CDNs')); };
                document.head.appendChild(fb);
            };
            document.head.appendChild(script);
        });
    }

    function getToken() {
        if (currentUser && currentUser.isTempAdmin) {
            return Promise.resolve(localStorage.getItem(tempAdminTokenKey));
        }
        if (!clerkInstance || !clerkInstance.session) {
            return Promise.resolve(null);
        }
        return clerkInstance.session.getToken().catch(function () { return null; });
    }

    function getUser() {
        return currentUser;
    }

    function onChange(fn) {
        listeners.push(fn);
    }

    function signOut() {
        clearCachePrefix(profileSnapshotCachePrefix);
        if (currentUser && currentUser.isTempAdmin) {
            clearTempAdminSession().then(function () {
                currentUser = null;
                notifyListeners();
                var containers = document.querySelectorAll('[data-auth-ui]');
                containers.forEach(function (el) { doRender(el); });
            });
            return;
        }
        if (clerkInstance) clerkInstance.signOut();
    }

    // ==================== UI RENDERING ====================

    function renderUI(containerEl) {
        if (!containerEl) return;
        var el = typeof containerEl === 'string' ? document.getElementById(containerEl) : containerEl;
        if (!el) return;

        el.setAttribute('data-auth-ui', 'true');
        doRender(el);
        onChange(function () { doRender(el); });
    }

    function doRender(el) {
        if (currentUser) renderSignedIn(el);
        else if (clerkReady) renderSignedOut(el);
        else el.innerHTML = '<div class="supabase-auth-menu"><span class="supabase-auth-name">Loading...</span></div>';
    }

    function renderSignedIn(el) {
        var name = '';
        if (currentUser) {
            name = currentUser.fullName || (currentUser.primaryEmailAddress ? currentUser.primaryEmailAddress.emailAddress : '') || '';
        }
        el.innerHTML =
            '<div class="supabase-auth-menu">' +
                '<a href="profile.html" class="supabase-auth-profile-link">My Profile</a>' +
                '<span class="supabase-auth-name">' + escapeHtml(name) + '</span>' +
                '<button class="supabase-auth-btn supabase-auth-btn-signout" id="supabaseSignOut">Sign Out</button>' +
            '</div>';
        var btn = document.getElementById('supabaseSignOut');
        if (btn) btn.addEventListener('click', signOut);
    }

    function renderSignedOut(el) {
        el.innerHTML = '<button class="supabase-auth-btn supabase-auth-btn-signin" id="supabaseSignIn">Sign In</button>';
        var btn = document.getElementById('supabaseSignIn');
        if (btn) btn.addEventListener('click', function () { showAuthForm(el); });
    }

    function showAuthForm(el) {
        if (!isLoginPage()) {
            window.location.href = getLoginUrl();
            return;
        }
        if (!clerkInstance || !clerkInstance.openSignIn) return;
        clerkInstance.openSignIn().catch(function () {});
    }

    function mountSignIn(containerEl) {
        if (!clerkInstance || !clerkInstance.mountSignIn) return false;
        var el = typeof containerEl === 'string' ? document.getElementById(containerEl) : containerEl;
        if (!el) return false;
        clerkInstance.mountSignIn(el);
        return true;
    }

    return {
        init: init,
        getToken: getToken,
        getUser: getUser,
        onChange: onChange,
        renderUI: renderUI,
        signOut: signOut,
        signInTempAdmin: signInTempAdmin,
        isTempAdminConfigured: isTempAdminConfigured,
        getCachedProfile: getCachedProfile,
        getProfile: getProfile,
        showAuthForm: showAuthForm,
        mountSignIn: mountSignIn
    };
})();

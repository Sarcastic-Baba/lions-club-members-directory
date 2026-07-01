var RightPanel = (function () {
    'use strict';

    var eventsCacheKey = 'lions_upcoming_events_cache';
    var eventsCacheMs = 60 * 1000;

    function init() {
        refresh();
    }

    function refresh() {
        var panels = getEventLists();
        if (panels.length === 0) return Promise.resolve();

        var cachedEvents = readEventsCache();
        if (cachedEvents) renderEvents(cachedEvents);

        return fetch('/api/events')
            .then(function (r) {
                if (!r.ok) throw new Error('Failed to load events');
                return r.json();
            })
            .then(function (data) {
                var events = data.events || [];
                writeEventsCache(events);
                renderEvents(events);
                return events;
            })
            .catch(function (err) {
                if (!cachedEvents) console.warn('Right panel events unavailable:', err.message);
                return cachedEvents || [];
            });
    }

    function getEventLists() {
        var lists = [];
        document.querySelectorAll('.right-panel-card').forEach(function (card) {
            var heading = card.querySelector('.right-panel-heading');
            var list = card.querySelector('.right-panel-list');
            if (!heading || !list) return;
            if (heading.textContent.trim().toLowerCase() === 'upcoming district events') {
                lists.push(list);
            }
        });
        return lists;
    }

    function renderEvents(events) {
        getEventLists().forEach(function (list) {
            if (!events || events.length === 0) {
                list.innerHTML = '<li class="right-panel-empty">No upcoming events</li>';
                return;
            }

            list.innerHTML = events.map(function (event) {
                return '<li><span class="right-panel-dot"></span><span>' +
                    escapeHtml(event.title || event) +
                    '</span></li>';
            }).join('');
        });
    }

    function setCachedEvents(events) {
        writeEventsCache(events || []);
        renderEvents(events || []);
    }

    function readEventsCache() {
        try {
            var raw = sessionStorage.getItem(eventsCacheKey);
            if (!raw) return null;

            var item = JSON.parse(raw);
            if (!item || !item.savedAt || !Array.isArray(item.events)) return null;
            if (Date.now() - item.savedAt > eventsCacheMs) {
                sessionStorage.removeItem(eventsCacheKey);
                return null;
            }

            return item.events;
        } catch (err) {
            return null;
        }
    }

    function writeEventsCache(events) {
        try {
            sessionStorage.setItem(eventsCacheKey, JSON.stringify({
                savedAt: Date.now(),
                events: Array.isArray(events) ? events : []
            }));
        } catch (err) {}
    }

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        refresh: refresh,
        setCachedEvents: setCachedEvents,
        renderEvents: renderEvents
    };
})();

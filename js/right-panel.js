var RightPanel = (function () {
    'use strict';

    function init() {
        refresh();
    }

    function refresh() {
        var panels = getEventLists();
        if (panels.length === 0) return Promise.resolve();

        return fetch('/api/events')
            .then(function (r) {
                if (!r.ok) throw new Error('Failed to load events');
                return r.json();
            })
            .then(function (data) {
                renderEvents(data.events || []);
            })
            .catch(function (err) {
                console.warn('Right panel events unavailable:', err.message);
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
        renderEvents: renderEvents
    };
})();

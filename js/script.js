(function () {
    'use strict';

    var members = [];
    var locations = [];
    var professions = [];

    // ==================== TAB LOGIC ====================

    var tabBtns = document.querySelectorAll('.tab-btn');
    var tabPanels = document.querySelectorAll('.tab-panel');

    function switchTab(tabName) {
        for (var i = 0; i < tabBtns.length; i++) {
            tabBtns[i].classList.remove('active');
        }
        for (var j = 0; j < tabPanels.length; j++) {
            tabPanels[j].classList.remove('active');
        }
        var targetBtn = document.querySelector('[data-tab="' + tabName + '"]');
        var targetPanel = document.getElementById('tab-' + tabName);
        if (targetBtn) targetBtn.classList.add('active');
        if (targetPanel) targetPanel.classList.add('active');
    }

    for (var k = 0; k < tabBtns.length; k++) {
        tabBtns[k].addEventListener('click', function () {
            switchTab(this.getAttribute('data-tab'));
        });
    }

    // ==================== DIRECTORY LOGIC ====================

    // DOM elements - Directory
    var searchText = document.getElementById('searchText');
    var filterLocation = document.getElementById('filterLocation');
    var filterProfession = document.getElementById('filterProfession');
    var btnClear = document.getElementById('btnClear');
    var membersGrid = document.getElementById('membersGrid');
    var noResults = document.getElementById('noResults');
    var resultCount = document.getElementById('resultCount');

    // DOM elements - AI Search
    var aiQuery = document.getElementById('aiQuery');
    var btnAiSearch = document.getElementById('btnAiSearch');
    var aiResults = document.getElementById('aiResults');
    var aiResponse = document.getElementById('aiResponse');
    var aiMembers = document.getElementById('aiMembers');
    var aiLoading = document.getElementById('aiLoading');
    var aiError = document.getElementById('aiError');

    // Load member data
    function loadMembers() {
        if (window.LIONS_MEMBERS && window.LIONS_MEMBERS.length > 0) {
            members = window.LIONS_MEMBERS;
            extractFilters();
            populateFilters();
            renderMembers(members);
            bindDirectoryEvents();
            bindAiEvents();
        } else {
            membersGrid.innerHTML = '<div class="loading">No member data found.</div>';
        }
    }

    // Extract unique locations and professions
    function extractFilters() {
        var locSet = {};
        var profSet = {};

        for (var i = 0; i < members.length; i++) {
            locSet[members[i].location] = true;
            profSet[members[i].profession] = true;
        }

        locations = Object.keys(locSet).sort();
        professions = Object.keys(profSet).sort();
    }

    // Populate filter dropdowns
    function populateFilters() {
        for (var i = 0; i < locations.length; i++) {
            var opt = document.createElement('option');
            opt.value = locations[i];
            opt.textContent = locations[i];
            filterLocation.appendChild(opt);
        }

        for (var j = 0; j < professions.length; j++) {
            var opt = document.createElement('option');
            opt.value = professions[j];
            opt.textContent = professions[j];
            filterProfession.appendChild(opt);
        }
    }

    // Filter members
    function filterMembers() {
        var query = searchText.value.toLowerCase().trim();
        var loc = filterLocation.value;
        var prof = filterProfession.value;

        var filtered = members.filter(function (member) {
            var matchesQuery = true;
            var matchesLoc = true;
            var matchesProf = true;

            if (query) {
                matchesQuery =
                    member.name.toLowerCase().indexOf(query) > -1 ||
                    member.club.toLowerCase().indexOf(query) > -1 ||
                    member.designation.toLowerCase().indexOf(query) > -1 ||
                    member.profession.toLowerCase().indexOf(query) > -1 ||
                    member.location.toLowerCase().indexOf(query) > -1;
            }

            if (loc) {
                matchesLoc = member.location === loc;
            }

            if (prof) {
                matchesProf = member.profession === prof;
            }

            return matchesQuery && matchesLoc && matchesProf;
        });

        renderMembers(filtered);
        updateClearButton();
    }

    // Debounce helper
    function debounce(fn, delay) {
        var timer;
        return function () {
            var context = this;
            var args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(context, args);
            }, delay);
        };
    }

    // Render member cards (Directory)
    function renderMembers(list) {
        membersGrid.innerHTML = '';

        if (list.length === 0) {
            noResults.classList.remove('hidden');
            resultCount.textContent = 'Showing 0 members';
            return;
        }

        noResults.classList.add('hidden');
        resultCount.textContent = 'Showing ' + list.length + ' member' + (list.length !== 1 ? 's' : '');

        for (var i = 0; i < list.length; i++) {
            membersGrid.appendChild(buildMemberCard(list[i]));
        }
    }

    // Build a member card DOM element
    function buildMemberCard(m) {
        var card = document.createElement('div');
        card.className = 'member-card';
        card.innerHTML = memberCardHTML(m);
        return card;
    }

    // Member card HTML (used by both directory and AI results)
    function memberCardHTML(m) {
        var relevanceHTML = '';
        if (m.relevance !== undefined) {
            relevanceHTML = '<span class="ai-relevance-badge">' + (m.relevance * 100).toFixed(0) + '% match</span>';
        }
        return '<div class="member-avatar" style="position:relative;">' + getInitials(m.name) + relevanceHTML + '</div>' +
            '<div class="member-info">' +
                '<h3 class="member-name">' + escapeHtml(m.name) + '</h3>' +
                '<span class="member-designation">' + escapeHtml(m.designation) + '</span>' +
                '<p class="member-club">' + escapeHtml(m.club) + '</p>' +
                '<div class="member-tags">' +
                    '<span class="tag tag-location">' +
                        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                        escapeHtml(m.location) +
                    '</span>' +
                    '<span class="tag tag-profession">' +
                        '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>' +
                        escapeHtml(m.profession) +
                    '</span>' +
                '</div>' +
                '<div class="member-contact">' +
                    '<a href="tel:' + escapeHtml(m.phone) + '" class="contact-item">' +
                        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>' +
                        escapeHtml(m.phone) +
                    '</a>' +
                    '<a href="mailto:' + escapeHtml(m.email) + '" class="contact-item">' +
                        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>' +
                        escapeHtml(m.email) +
                    '</a>' +
                '</div>' +
                '<div class="member-address">' +
                    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
                    escapeHtml(m.address) +
                '</div>' +
            '</div>';
    }

    // Get initials from name
    function getInitials(name) {
        if (!name) return '?';
        var parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    // Escape HTML
    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Update clear button visibility
    function updateClearButton() {
        var hasFilters =
            searchText.value.trim() !== '' ||
            filterLocation.value !== '' ||
            filterProfession.value !== '';

        if (hasFilters) {
            btnClear.classList.remove('hidden');
        } else {
            btnClear.classList.add('hidden');
        }
    }

    // Clear all filters
    function clearFilters() {
        searchText.value = '';
        filterLocation.value = '';
        filterProfession.value = '';
        filterMembers();
    }

    // Bind directory events
    function bindDirectoryEvents() {
        var debouncedFilter = debounce(filterMembers, 200);
        searchText.addEventListener('input', debouncedFilter);
        filterLocation.addEventListener('change', filterMembers);
        filterProfession.addEventListener('change', filterMembers);
        btnClear.addEventListener('click', clearFilters);
    }

    // ==================== AI SEARCH LOGIC ====================

    function bindAiEvents() {
        btnAiSearch.addEventListener('click', performAiSearch);
        aiQuery.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                performAiSearch();
            }
        });
    }

    function getAuthHeaders() {
        return Promise.resolve().then(function () {
            var headers = { 'Content-Type': 'application/json' };
            if (window.Clerk && window.Clerk.session) {
                return window.Clerk.session.getToken().then(function (token) {
                    if (token) headers['Authorization'] = 'Bearer ' + token;
                    return headers;
                });
            }
            return headers;
        });
    }

    function performAiSearch() {
        var query = aiQuery.value.trim();
        if (!query) return;

        // Show loading
        aiResults.classList.add('hidden');
        aiError.classList.add('hidden');
        aiLoading.classList.remove('hidden');
        btnAiSearch.disabled = true;

        getAuthHeaders().then(function (headers) {
            return fetch('/api/ai-search', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ query: query })
            });
        })
        .then(function (resp) {
            if (!resp.ok) {
                return resp.json().then(function (err) { throw new Error(err.error || 'Server error'); });
            }
            return resp.json();
        })
        .then(function (data) {
            aiLoading.classList.add('hidden');
            btnAiSearch.disabled = false;

            // Render AI response
            if (data.aiResponse) {
                aiResponse.innerHTML =
                    '<div class="ai-response-badge">' +
                        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/><path d="M8 12a4 4 0 0 1 8 0"/></svg>' +
                        'AI Analysis' +
                    '</div>' +
                    formatAIResponse(data.aiResponse);
            } else {
                aiResponse.innerHTML = '';
            }

            // Render member cards
            aiMembers.innerHTML = '';
            if (data.relevantMembers && data.relevantMembers.length > 0) {
                var header = document.createElement('div');
                header.className = 'ai-members-header';
                header.textContent = 'Matching Members (' + data.relevantMembers.length + ')';
                aiMembers.appendChild(header);

                for (var i = 0; i < data.relevantMembers.length; i++) {
                    var card = document.createElement('div');
                    card.className = 'ai-member-card';
                    card.innerHTML = memberCardHTML(data.relevantMembers[i]);
                    aiMembers.appendChild(card);
                }
            } else {
                aiMembers.innerHTML = '<div class="ai-members-header">No matching members found</div>';
            }

            if (!data.llmUsed && !data.aiResponse) {
                aiResponse.innerHTML =
                    '<div class="ai-response-badge" style="background:#fef3c7;color:#92400e;">' +
                        '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
                        'LLM not configured' +
                    '</div>' +
                    '<p style="margin-top:8px;color:var(--text-muted);">Showing keyword-based matches. Set <code>DEEPSEEK_API_KEY</code> in <code>server/.env</code> to enable AI-powered search.</p>';
            }

            aiResults.classList.remove('hidden');
        })
        .catch(function (err) {
            aiLoading.classList.add('hidden');
            btnAiSearch.disabled = false;
            aiError.classList.remove('hidden');
            aiError.textContent = 'Error: ' + err.message + '. Make sure the server is running (npm start).';
        });
    }

    // Simple markdown-to-HTML for AI responses
    function formatAIResponse(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            // Bold
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            // Headers
            .replace(/^### (.+)$/gm, '<h3>$1</h3>')
            .replace(/^## (.+)$/gm, '<h2>$1</h2>')
            .replace(/^# (.+)$/gm, '<h1>$1</h1>')
            // Bullet lists
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, function (match) {
                return '<ul>' + match + '</ul>';
            })
            // Numbered lists
            .replace(/^\d+\.\s(.+)$/gm, '<li>$1</li>')
            // Line breaks
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
    }

    // ==================== INIT ====================

    loadMembers();
})();

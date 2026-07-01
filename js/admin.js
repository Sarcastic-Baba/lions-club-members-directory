var Admin = (function () {
    'use strict';

    var elLoading = document.getElementById('adminLoading');
    var elError = document.getElementById('adminError');
    var elApprovalsBody = document.getElementById('approvalsTableBody');
    var elApprovalsEmpty = document.getElementById('approvalsEmpty');
    var elMembersBody = document.getElementById('membersTableBody');
    var elMembersEmpty = document.getElementById('membersEmpty');
    var elReportsContainer = document.getElementById('reportsContainer');
    var elReportsEmpty = document.getElementById('reportsEmpty');
    var elStatsForm = document.getElementById('statsForm');
    var elStatMembers = document.getElementById('statInputMembers');
    var elStatClubs = document.getElementById('statInputClubs');
    var elStatYears = document.getElementById('statInputYears');
    var elStatsComputedText = document.getElementById('statsComputedText');
    var elBtnUseComputedStats = document.getElementById('btnUseComputedStats');
    var elBtnSaveStats = document.getElementById('btnSaveStats');
    var elEventsForm = document.getElementById('eventsForm');
    var elEventsList = document.getElementById('eventsList');
    var elEventsStatus = document.getElementById('eventsStatus');
    var elBtnAddEvent = document.getElementById('btnAddEvent');
    var elBtnSaveEvents = document.getElementById('btnSaveEvents');
    var initialized = false;
    var lastComputedStats = null;

    function getAuthHeaders() {
        return Auth.getToken().then(function (token) {
            var headers = { 'Content-Type': 'application/json' };
            if (token) headers.Authorization = 'Bearer ' + token;
            return headers;
        });
    }

    function init() {
        if (!initialized) {
            bindTabEvents();
            bindStatsEvents();
            initialized = true;
        }
        loadActiveTab();
    }

    function loadActiveTab() {
        var activeTab = document.querySelector('.admin-tab.active');
        var target = activeTab ? activeTab.getAttribute('data-tab') : 'approvals';
        if (target === 'approvals') loadApprovals();
        else if (target === 'stats') loadStats();
        else if (target === 'reports') loadReports();
        else loadMembers();
    }

    function bindTabEvents() {
        var tabs = document.querySelectorAll('.admin-tab');
        tabs.forEach(function (tab) {
            tab.addEventListener('click', function () {
                var target = this.getAttribute('data-tab');
                tabs.forEach(function (t) { t.classList.remove('active'); });
                this.classList.add('active');
                document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
                var panel = document.getElementById('tab-' + target);
                if (panel) panel.classList.add('active');
                if (target === 'approvals') loadApprovals();
                else if (target === 'members') loadMembers();
                else if (target === 'stats') loadStats();
                else if (target === 'reports') loadReports();
            });
        });
    }

    function bindStatsEvents() {
        if (elStatsForm) {
            elStatsForm.addEventListener('submit', saveStats);
        }
        if (elBtnUseComputedStats) {
            elBtnUseComputedStats.addEventListener('click', function () {
                if (!lastComputedStats) return;
                setStatsInputs(lastComputedStats);
            });
        }
        if (elEventsForm) {
            elEventsForm.addEventListener('submit', saveEvents);
        }
        if (elBtnAddEvent) {
            elBtnAddEvent.addEventListener('click', function () {
                addEventRow('');
            });
        }
    }

    function loadApprovals() {
        showLoading();
        if (elApprovalsBody) elApprovalsBody.innerHTML = '';
        if (elApprovalsEmpty) elApprovalsEmpty.classList.add('hidden');

        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/members?status=pending', { headers: headers });
        }).then(function (r) {
            if (!r.ok) throw new Error('Failed to load pending approvals');
            return r.json();
        }).then(function (data) {
            hideLoading();
            var members = data.members || [];
            if (members.length === 0) {
                if (elApprovalsEmpty) elApprovalsEmpty.classList.remove('hidden');
                return;
            }
            renderApprovals(members);
        }).catch(function (err) {
            console.error('Load approvals error:', err);
            showError('Could not load pending approvals.');
        });
    }

    function renderApprovals(members) {
        if (!elApprovalsBody) return;

        var html = '';
        members.forEach(function (m) {
            html += '<tr>' +
                '<td><strong>' + escapeHtml(m.name || 'Unknown') + '</strong></td>' +
                '<td>' + escapeHtml(m.email || '-') + '</td>' +
                '<td>' + escapeHtml(m.club || '-') + '</td>' +
                '<td>' + escapeHtml(m.designation || '-') + '</td>' +
                '<td><div class="admin-actions">' +
                    '<button type="button" class="btn-admin-sm approve-member-btn" data-member-id="' + m.id + '">Approve</button>' +
                    '<button type="button" class="btn-admin-sm suspend-member-btn" data-member-id="' + m.id + '">Reject</button>' +
                    '<button type="button" class="btn-admin-sm danger delete-member-btn" data-member-id="' + m.id + '" data-member-name="' + escapeHtml(m.name || 'this member') + '">Delete Profile</button>' +
                '</div></td>' +
            '</tr>';
        });

        elApprovalsBody.innerHTML = html;
        bindMemberActionButtons(elApprovalsBody);
    }

    function loadMembers() {
        showLoading();
        elMembersBody.innerHTML = '';
        elMembersEmpty.classList.add('hidden');
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/members', { headers: headers });
        }).then(function (r) {
            if (!r.ok) throw new Error('Failed to load members');
            return r.json();
        }).then(function (data) {
            hideLoading();
            var members = data.members || [];
            if (members.length === 0) {
                elMembersEmpty.classList.remove('hidden');
                return;
            }
            renderMembers(members);
        }).catch(function (err) {
            console.error('Load members error:', err);
            showError('Could not load members.');
        });
    }

    function renderMembers(members) {
        var html = '';
        members.forEach(function (m) {
            var name = m.name || 'Unknown';
            var email = m.email || '-';
            var club = m.club || '-';
            var role = m.role === 'admin' ? 'admin' : 'member';
            var status = m.status || 'active';
            var statusClass = getStatusClass(status);
            html += '<tr>' +
                '<td><strong>' + escapeHtml(name) + '</strong></td>' +
                '<td>' + escapeHtml(email) + '</td>' +
                '<td>' + escapeHtml(club) + '</td>' +
                '<td><select class="role-select" data-member-id="' + m.id + '" data-current-role="' + escapeHtml(role) + '">' +
                    '<option value="member"' + (role === 'member' ? ' selected' : '') + '>Member</option>' +
                    '<option value="admin"' + (role === 'admin' ? ' selected' : '') + '>Admin</option>' +
                '</select></td>' +
                '<td><select class="status-select status-badge ' + statusClass + '" data-member-id="' + m.id + '" data-current-status="' + escapeHtml(status) + '">' +
                    '<option value="pending"' + (status === 'pending' ? ' selected' : '') + '>Pending</option>' +
                    '<option value="active"' + (status === 'active' ? ' selected' : '') + '>Active</option>' +
                    '<option value="suspended"' + (status === 'suspended' ? ' selected' : '') + '>Suspended</option>' +
                '</select></td>' +
                '<td><div class="admin-actions">' +
                    (status === 'pending' ? '<button type="button" class="btn-admin-sm approve-member-btn" data-member-id="' + m.id + '">Approve</button>' : '') +
                    '<button type="button" class="btn-admin-sm danger delete-member-btn" data-member-id="' + m.id + '" data-member-name="' + escapeHtml(name) + '">Delete Profile</button>' +
                '</div></td>' +
            '</tr>';
        });
        elMembersBody.innerHTML = html;
        elMembersBody.querySelectorAll('.role-select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                var memberId = this.getAttribute('data-member-id');
                var newRole = this.value;
                if (!confirm('Change role to "' + newRole + '"?')) {
                    this.value = this.getAttribute('data-current-role');
                    return;
                }
                updateRole(memberId, newRole, this);
            });
        });
        elMembersBody.querySelectorAll('.status-select').forEach(function (sel) {
            sel.addEventListener('change', function () {
                var memberId = this.getAttribute('data-member-id');
                var newStatus = this.value;
                if (!confirm('Change status to "' + newStatus + '"?')) {
                    this.value = this.getAttribute('data-current-status');
                    return;
                }
                updateMemberStatus(memberId, newStatus, this);
            });
        });
        bindMemberActionButtons(elMembersBody);
    }

    function updateRole(memberId, role, selectEl) {
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/members/' + memberId, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ role: role })
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Update failed'); });
            return r.json();
        }).then(function () {
            selectEl.setAttribute('data-current-role', role);
        }).catch(function (err) {
            alert('Failed to update role: ' + err.message);
            selectEl.value = selectEl.getAttribute('data-current-role');
        });
    }

    function updateMemberStatus(memberId, status, selectEl) {
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/members/' + memberId, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ status: status })
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Update failed'); });
            return r.json();
        }).then(function () {
            if (selectEl) selectEl.setAttribute('data-current-status', status);
            loadMembers();
        }).catch(function (err) {
            alert('Failed: ' + err.message);
            if (selectEl) selectEl.value = selectEl.getAttribute('data-current-status');
        });
    }

    function bindMemberActionButtons(root) {
        if (!root) return;

        root.querySelectorAll('.approve-member-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                approveMember(this.getAttribute('data-member-id'), this);
            });
        });

        root.querySelectorAll('.suspend-member-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                suspendMember(this.getAttribute('data-member-id'), this);
            });
        });

        root.querySelectorAll('.delete-member-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deleteMember(
                    this.getAttribute('data-member-id'),
                    this.getAttribute('data-member-name') || 'this member',
                    this
                );
            });
        });
    }

    function approveMember(memberId, btnEl) {
        if (!confirm('Approve this member profile?')) return;
        updateMember(memberId, { role: 'member', status: 'active' }, btnEl, 'Approval failed');
    }

    function suspendMember(memberId, btnEl) {
        if (!confirm('Reject this member profile? The profile will be marked suspended.')) return;
        updateMember(memberId, { role: 'member', status: 'suspended' }, btnEl, 'Rejection failed');
    }

    function updateMember(memberId, payload, btnEl, failureLabel) {
        setRowButtonsDisabled(btnEl, true);
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/members/' + memberId, {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(payload)
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Update failed'); });
            return r.json();
        }).then(function () {
            loadActiveTab();
        }).catch(function (err) {
            alert((failureLabel || 'Update failed') + ': ' + err.message);
            setRowButtonsDisabled(btnEl, false);
        });
    }

    function deleteMember(memberId, memberName, btnEl) {
        if (!confirm('Delete the profile for ' + memberName + '? This cannot be undone.')) return;
        setRowButtonsDisabled(btnEl, true);
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/members/' + memberId, {
                method: 'DELETE',
                headers: headers
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Delete failed'); });
            return r.json();
        }).then(function () {
            loadActiveTab();
        }).catch(function (err) {
            alert('Delete failed: ' + err.message);
            setRowButtonsDisabled(btnEl, false);
        });
    }

    function setRowButtonsDisabled(btnEl, disabled) {
        if (!btnEl) return;
        var row = btnEl.closest('tr');
        if (!row) return;
        row.querySelectorAll('button, select').forEach(function (control) {
            control.disabled = disabled;
        });
    }

    function loadStats() {
        showLoading();
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/stats', { headers: headers });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Failed to load stats'); });
            return r.json();
        }).then(function (data) {
            hideLoading();
            lastComputedStats = data.computed || null;
            setStatsInputs(data.stats || {});
            renderComputedStats(lastComputedStats);
            loadEvents();
        }).catch(function (err) {
            console.error('Load stats error:', err);
            showError('Could not load stats.');
        });
    }

    function saveStats(event) {
        event.preventDefault();

        var payload;
        try {
            payload = {
                members: readStatInput(elStatMembers, 'Members'),
                clubs: readStatInput(elStatClubs, 'Clubs'),
                years: readStatInput(elStatYears, 'Years')
            };
        } catch (err) {
            alert(err.message);
            return;
        }

        if (elBtnSaveStats) elBtnSaveStats.disabled = true;
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/stats', {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify(payload)
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Save failed'); });
            return r.json();
        }).then(function (data) {
            setStatsInputs(data.stats || payload);
            if (elStatsComputedText) {
                elStatsComputedText.textContent = 'Saved.';
            }
        }).catch(function (err) {
            alert('Failed to save stats: ' + err.message);
        }).finally(function () {
            if (elBtnSaveStats) elBtnSaveStats.disabled = false;
        });
    }

    function setStatsInputs(stats) {
        if (!stats) return;
        if (elStatMembers && stats.members != null) elStatMembers.value = stats.members;
        if (elStatClubs && stats.clubs != null) elStatClubs.value = stats.clubs;
        if (elStatYears && stats.years != null) elStatYears.value = stats.years;
    }

    function renderComputedStats(stats) {
        if (!elStatsComputedText || !stats) return;
        elStatsComputedText.textContent = 'Live: ' + stats.members + ' members, ' + stats.clubs + ' clubs, ' + stats.years + ' years';
    }

    function readStatInput(input, label) {
        var value = Number(input.value);
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(label + ' must be a non-negative integer.');
        }
        return value;
    }

    function loadEvents() {
        if (!elEventsList) return;

        setEventsStatus('Loading events...');
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/events', { headers: headers });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Failed to load events'); });
            return r.json();
        }).then(function (data) {
            renderEventsEditor(data.events || []);
            setEventsStatus('Leave the list empty to show "No upcoming events".');
        }).catch(function (err) {
            console.error('Load events error:', err);
            renderEventsEditor([]);
            setEventsStatus(err.message);
        });
    }

    function renderEventsEditor(events) {
        if (!elEventsList) return;
        elEventsList.innerHTML = '';
        (events || []).forEach(function (event) {
            addEventRow(event.title || event);
        });
        if (elEventsList.children.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'admin-events-empty';
            empty.textContent = 'No upcoming events saved.';
            elEventsList.appendChild(empty);
        }
    }

    function addEventRow(title) {
        if (!elEventsList) return;

        var empty = elEventsList.querySelector('.admin-events-empty');
        if (empty) empty.remove();

        var row = document.createElement('div');
        row.className = 'admin-event-row';
        row.innerHTML =
            '<input type="text" class="event-title-input" maxlength="80" placeholder="Event name" value="' + escapeHtml(title || '') + '">' +
            '<button type="button" class="btn-admin-sm danger event-remove-btn">Remove</button>';
        row.querySelector('.event-remove-btn').addEventListener('click', function () {
            row.remove();
            if (elEventsList.children.length === 0) {
                renderEventsEditor([]);
            }
        });
        elEventsList.appendChild(row);
    }

    function saveEvents(event) {
        event.preventDefault();

        var events;
        try {
            events = readEventInputs();
        } catch (err) {
            alert(err.message);
            return;
        }

        if (elBtnSaveEvents) elBtnSaveEvents.disabled = true;
        setEventsStatus('Saving events...');
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/events', {
                method: 'PUT',
                headers: headers,
                body: JSON.stringify({ events: events })
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Save failed'); });
            return r.json();
        }).then(function (data) {
            renderEventsEditor(data.events || []);
            setEventsStatus('Saved.');
            if (window.RightPanel && typeof window.RightPanel.setCachedEvents === 'function') {
                window.RightPanel.setCachedEvents(data.events || []);
            } else if (window.RightPanel && typeof window.RightPanel.refresh === 'function') {
                window.RightPanel.refresh();
            }
        }).catch(function (err) {
            alert('Failed to save events: ' + err.message);
            setEventsStatus(err.message);
        }).finally(function () {
            if (elBtnSaveEvents) elBtnSaveEvents.disabled = false;
        });
    }

    function readEventInputs() {
        var inputs = elEventsList ? elEventsList.querySelectorAll('.event-title-input') : [];
        var events = [];
        inputs.forEach(function (input) {
            var title = input.value.trim();
            if (!title) return;
            if (title.length > 80) {
                throw new Error('Event names must be 80 characters or less.');
            }
            events.push(title);
        });
        if (events.length > 10) {
            throw new Error('You can add up to 10 events.');
        }
        return events;
    }

    function setEventsStatus(message) {
        if (elEventsStatus) elEventsStatus.textContent = message || '';
    }

    function loadReports() {
        showLoading();
        elReportsContainer.innerHTML = '';
        elReportsEmpty.classList.add('hidden');
        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/reports', { headers: headers });
        }).then(function (r) {
            if (!r.ok) throw new Error('Failed to load reports');
            return r.json();
        }).then(function (data) {
            hideLoading();
            var reports = data.reports || [];
            if (reports.length === 0) {
                elReportsEmpty.classList.remove('hidden');
                return;
            }
            renderReports(reports);
        }).catch(function (err) {
            console.error('Load reports error:', err);
            showError('Could not load reports.');
        });
    }

    function renderReports(reports) {
        var html = '';
        reports.forEach(function (r) {
            var reporter = r.reporter || {};
            var post = r.post || {};
            var author = post.author || {};
            var reporterName = reporter.name || 'Unknown';
            var authorName = author.name || 'Unknown member';
            var postPreview = post.body || '(Image-only post)';
            if (postPreview.length > 220) postPreview = postPreview.substring(0, 220) + '...';
            var reason = r.reason || 'other';
            var status = post.status || 'missing';
            var date = r.created_at ? new Date(r.created_at).toLocaleString() : '-';
            var postDate = post.created_at ? new Date(post.created_at).toLocaleDateString() : '-';
            var statusClass = getStatusClass(status);
            var canDeletePost = post.id && status !== 'deleted';

            html += '<div class="report-card" data-report-id="' + escapeHtml(r.id) + '">' +
                '<div class="report-card-header">' +
                    '<div>' +
                        '<div class="report-card-title">Reported post</div>' +
                        '<div class="report-card-meta">' +
                            '<span>Reported by ' + escapeHtml(reporterName) + '</span>' +
                            '<span>' + escapeHtml(date) + '</span>' +
                            '<span class="status-badge status-pending">' + escapeHtml(formatReason(reason)) + '</span>' +
                            '<span class="status-badge ' + statusClass + '">' + escapeHtml(titleCase(status)) + '</span>' +
                        '</div>' +
                    '</div>' +
                    '<div class="admin-actions">' +
                        (canDeletePost ? '<button class="btn-admin-sm danger delete-report-post-btn" data-report-id="' + escapeHtml(r.id) + '" data-post-id="' + escapeHtml(post.id) + '">Delete Post</button>' : '') +
                        '<button class="btn-admin-sm dismiss-report-btn" data-report-id="' + escapeHtml(r.id) + '">Dismiss</button>' +
                    '</div>' +
                '</div>' +
                '<div class="report-post-preview">' + escapeHtml(postPreview) + '</div>' +
                '<div class="report-post-author">By ' + escapeHtml(authorName) +
                    (author.club ? ' - ' + escapeHtml(author.club) : '') +
                    ' - Posted ' + escapeHtml(postDate) +
                '</div>' +
            '</div>';
        });
        elReportsContainer.innerHTML = html;
        elReportsContainer.querySelectorAll('.dismiss-report-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                dismissReport(this.getAttribute('data-report-id'), this, false);
            });
        });
        elReportsContainer.querySelectorAll('.delete-report-post-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                deleteReportedPost(
                    this.getAttribute('data-report-id'),
                    this.getAttribute('data-post-id'),
                    this
                );
            });
        });
    }

    function deleteReportedPost(reportId, postId, btnEl) {
        if (!confirm('Delete this reported post?')) return;
        setCardButtonsDisabled(btnEl, true);
        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts/' + postId, { method: 'DELETE', headers: headers });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Delete failed'); });
            return r.json();
        }).then(function () {
            return dismissReport(reportId, btnEl, true);
        }).catch(function (err) {
            alert('Failed: ' + err.message);
            setCardButtonsDisabled(btnEl, false);
        });
    }

    function dismissReport(reportId, btnEl, skipConfirm) {
        if (!skipConfirm && !confirm('Dismiss this report?')) return Promise.resolve();
        setCardButtonsDisabled(btnEl, true);
        return getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/reports/' + reportId, { method: 'DELETE', headers: headers });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Dismiss failed'); });
            return r.json();
        }).then(function () {
            removeReportCard(btnEl);
        }).catch(function (err) {
            alert('Failed: ' + err.message);
            setCardButtonsDisabled(btnEl, false);
        });
    }

    function removeReportCard(btnEl) {
        var card = btnEl.closest('.report-card');
        if (card) card.remove();
        if (elReportsContainer.children.length === 0) {
            elReportsEmpty.classList.remove('hidden');
        }
    }

    function setCardButtonsDisabled(btnEl, disabled) {
        var card = btnEl.closest('.report-card');
        if (!card) return;
        card.querySelectorAll('button').forEach(function (button) {
            button.disabled = disabled;
        });
    }

    function showLoading() {
        elLoading.classList.remove('hidden');
        elError.classList.add('hidden');
    }

    function hideLoading() {
        elLoading.classList.add('hidden');
    }

    function showError(msg) {
        elLoading.classList.add('hidden');
        elError.textContent = msg;
        elError.classList.remove('hidden');
    }

    function getStatusClass(status) {
        if (status === 'active') return 'status-active';
        if (status === 'pending' || status === 'under_review') return 'status-pending';
        if (status === 'suspended' || status === 'deleted' || status === 'missing') return 'status-suspended';
        return 'status-pending';
    }

    function formatReason(reason) {
        if (reason === 'spam') return 'Spam';
        if (reason === 'offensive') return 'Offensive';
        if (reason === 'misinformation') return 'Misinformation';
        return 'Other';
    }

    function titleCase(str) {
        if (!str) return '';
        return String(str).replace(/_/g, ' ').replace(/\b\w/g, function (match) {
            return match.toUpperCase();
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

    return { init: init };
})();

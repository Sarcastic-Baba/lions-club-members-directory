var Feed = (function () {
    'use strict';

    var ALLOWED_REACTIONS = ['👍', '❤️', '👏', '🙏', '💡'];
    var REACTION_LABELS = { '👍': 'Like', '❤️': 'Love', '👏': 'Clap', '🙏': 'Grateful', '💡': 'Insightful' };
    var pageSize = 20;
    var nextCursor = null;
    var hasMore = false;
    var loading = false;
    var currentMember = null;
    var pendingImages = [];
    var reportPostId = null;

    // ==================== DOM REFERENCES ====================
    var elFeedAuthRequired = document.getElementById('feedAuthRequired');
    var elFeedVerifRequired = document.getElementById('feedVerificationRequired');
    var elFeedContainer = document.getElementById('feedContainer');
    var elFeedPosts = document.getElementById('feedPosts');
    var elFeedLoading = document.getElementById('feedLoading');
    var elFeedEmpty = document.getElementById('feedEmpty');
    var elFeedError = document.getElementById('feedError');
    var elComposer = document.getElementById('feedComposer');
    var elComposerBody = document.getElementById('composerBody');
    var elComposerText = document.getElementById('composerText');
    var elComposerAvatar = document.getElementById('composerAvatar');
    var elComposerLabel = document.getElementById('composerLabel');
    var elCharCount = document.getElementById('charCount');
    var elComposerImages = document.getElementById('composerImages');
    var elBtnSubmit = document.getElementById('btnSubmitPost');
    var elBtnAddImage = document.getElementById('btnAddImage');
    var elImageInput = document.getElementById('imageInput');
    var elBtnCancelPost = document.getElementById('btnCancelPost');
    var elComposerError = document.getElementById('composerError');
    var elComposerLoading = document.getElementById('composerLoading');
    var elLightbox = document.getElementById('lightbox');
    var elLightboxImg = document.getElementById('lightboxImg');
    var elLightboxClose = document.getElementById('lightboxClose');
    var elReportModal = document.getElementById('reportModal');

    // ==================== AUTH HELPERS ====================
    function getAuthHeaders() {
        return Auth.getToken().then(function (token) {
            var headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = 'Bearer ' + token;
            return headers;
        });
    }

    function onAuthChange(isSignedIn) {
        if (isSignedIn) {
            initFeed();
        } else {
            showAuthRequired();
        }
    }

    // ==================== INIT ====================
    function initFeed() {
        var profilePromise = Auth.getProfile
            ? Auth.getProfile()
            : getAuthHeaders().then(function (headers) {
                return fetch('/api/profile', { headers: headers });
            }).then(function (r) {
                if (!r.ok) throw new Error('Not authorized');
                return r.json();
            }).then(function (data) {
                return data.profile || null;
            });

        profilePromise.then(function (profile) {
            if (!profile) {
                showVerificationRequired();
                return;
            }
            currentMember = profile;
            if (currentMember.status !== 'active') {
                showVerificationRequired();
                return;
            }
            showFeed();
        }).catch(function () {
            showAuthRequired();
        });
    }

    function showAuthRequired() {
        elFeedAuthRequired.classList.remove('hidden');
        elFeedVerifRequired.classList.add('hidden');
        elFeedContainer.classList.add('hidden');
    }

    function showVerificationRequired() {
        elFeedAuthRequired.classList.add('hidden');
        elFeedVerifRequired.classList.remove('hidden');
        elFeedContainer.classList.add('hidden');
    }

    function showFeed() {
        elFeedAuthRequired.classList.add('hidden');
        elFeedVerifRequired.classList.add('hidden');
        elFeedContainer.classList.remove('hidden');

        // Set composer avatar
        if (currentMember) {
            var initials = getInitials(currentMember.name);
            elComposerAvatar.textContent = initials;
            elComposerLabel.textContent = 'Share something, ' + currentMember.name.split(' ')[0] + '...';
        }

        bindComposerEvents();
        bindLightboxEvents();
        bindReportModalEvents();
        loadPosts();
        setupInfiniteScroll();
    }

    // ==================== COMPOSER ====================
    function bindComposerEvents() {
        // Expand composer
        elComposerLabel.addEventListener('click', function () {
            elComposerBody.style.display = 'block';
            elComposerLabel.style.display = 'none';
            elComposerText.focus();
        });

        elComposerText.addEventListener('focus', function () {
            elComposerBody.style.display = 'block';
            elComposerLabel.style.display = 'none';
        });

        // Character count
        elComposerText.addEventListener('input', function () {
            var len = elComposerText.value.length;
            elCharCount.textContent = len;
            elCharCount.style.color = len > 1800 ? '#dc2626' : len > 1500 ? '#d97706' : '';
            updateSubmitButton();
        });

        // Image upload
        elBtnAddImage.addEventListener('click', function () { elImageInput.click(); });
        elImageInput.addEventListener('change', handleImageSelect);

        // Cancel
        elBtnCancelPost.addEventListener('click', collapseComposer);

        // Submit
        elBtnSubmit.addEventListener('click', submitPost);
    }

    function handleImageSelect(e) {
        var files = Array.from(e.target.files);
        var remaining = 4 - pendingImages.length;
        if (files.length > remaining) {
            files = files.slice(0, remaining);
            showComposerError('Maximum 4 images per post. Only ' + remaining + ' more allowed.');
        }

        files.forEach(function (file) {
            if (file.size > 5 * 1024 * 1024) {
                showComposerError('Image "' + file.name + '" exceeds 5 MB limit.');
                return;
            }
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
                showComposerError('Only JPEG, PNG, and WEBP images are allowed.');
                return;
            }
            uploadImage(file);
        });

        elImageInput.value = '';
    }

    function uploadImage(file) {
        var formData = new FormData();
        formData.append('image', file);

        getAuthHeaders().then(function (headers) {
            delete headers['Content-Type'];
            return fetch('/api/upload', {
                method: 'POST',
                headers: headers,
                body: formData
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Upload failed'); });
            return r.json();
        }).then(function (data) {
            pendingImages.push({ url: data.url, name: file.name });
            renderImagePreviews();
            updateSubmitButton();
        }).catch(function (err) {
            showComposerError('Image upload failed: ' + err.message);
        });
    }

    function renderImagePreviews() {
        var html = '';
        pendingImages.forEach(function (img, idx) {
            html += '<div class="composer-image-preview">' +
                '<img src="' + escapeHtml(img.url) + '" alt="">' +
                '<button class="composer-image-remove" data-idx="' + idx + '" title="Remove image">' +
                    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
                '</button>' +
            '</div>';
        });
        elComposerImages.innerHTML = html;

        // Bind remove buttons
        var btns = elComposerImages.querySelectorAll('.composer-image-remove');
        btns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(this.getAttribute('data-idx'));
                pendingImages.splice(idx, 1);
                renderImagePreviews();
                updateSubmitButton();
            });
        });
    }

    function updateSubmitButton() {
        var hasText = elComposerText.value.trim().length > 0;
        var hasImages = pendingImages.length > 0;
        elBtnSubmit.disabled = !hasText && !hasImages;
    }

    function collapseComposer() {
        elComposerBody.style.display = 'none';
        elComposerLabel.style.display = 'block';
        elComposerText.value = '';
        elCharCount.textContent = '0';
        elCharCount.style.color = '';
        pendingImages = [];
        elComposerImages.innerHTML = '';
        elComposerError.classList.add('hidden');
        elBtnSubmit.disabled = true;
    }

    function showComposerError(msg) {
        elComposerError.textContent = msg;
        elComposerError.classList.remove('hidden');
        setTimeout(function () { elComposerError.classList.add('hidden'); }, 4000);
    }

    function submitPost() {
        var bodyText = elComposerText.value.trim();
        var imageUrls = pendingImages.map(function (img) { return img.url; });

        if (!bodyText && imageUrls.length === 0) return;

        var contentType = imageUrls.length > 0 ? (bodyText ? 'text_image' : 'image') : 'text';

        elBtnSubmit.disabled = true;
        elComposerLoading.classList.remove('hidden');
        elComposerError.classList.add('hidden');

        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({
                    content_type: contentType,
                    body: bodyText || null,
                    image_urls: imageUrls.length > 0 ? imageUrls : null
                })
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error || 'Post failed'); });
            return r.json();
        }).then(function (data) {
            collapseComposer();
            elComposerLoading.classList.add('hidden');
            // Prepend new post to feed
            prependPost(data.post);
            elFeedEmpty.classList.add('hidden');
        }).catch(function (err) {
            elComposerLoading.classList.add('hidden');
            elBtnSubmit.disabled = false;
            showComposerError(err.message);
        });
    }

    // ==================== FEED LOADING ====================
    function loadPosts(cursor) {
        if (loading) return;
        loading = true;
        elFeedLoading.classList.remove('hidden');
        elFeedError.classList.add('hidden');

        var url = '/api/posts?limit=' + pageSize;
        if (cursor) url += '&cursor=' + encodeURIComponent(cursor);

        getAuthHeaders().then(function (headers) {
            return fetch(url, { headers: headers });
        }).then(function (r) {
            if (!r.ok) throw new Error('Failed to load posts');
            return r.json();
        }).then(function (data) {
            elFeedLoading.classList.add('hidden');
            loading = false;

            if (!cursor) elFeedPosts.innerHTML = '';

            var posts = data.posts || [];
            hasMore = data.hasMore;
            nextCursor = data.nextCursor;

            if (posts.length === 0 && !cursor) {
                elFeedEmpty.classList.remove('hidden');
            } else {
                elFeedEmpty.classList.add('hidden');
                posts.forEach(function (post) {
                    elFeedPosts.appendChild(buildPostCard(post));
                });
            }

            // Load reactions for visible posts
            loadReactions(posts);
        }).catch(function (err) {
            elFeedLoading.classList.add('hidden');
            loading = false;
            elFeedError.textContent = 'Error loading posts: ' + err.message;
            elFeedError.classList.remove('hidden');
        });
    }

    function setupInfiniteScroll() {
        window.addEventListener('scroll', function () {
            if (loading || !hasMore) return;
            var scrollBottom = window.innerHeight + window.scrollY;
            var docHeight = document.documentElement.scrollHeight;
            if (scrollBottom >= docHeight - 400) {
                loadPosts(nextCursor);
            }
        });
    }

    function prependPost(post) {
        var card = buildPostCard(post);
        elFeedPosts.insertBefore(card, elFeedPosts.firstChild);
    }

    // ==================== POST CARD BUILDING ====================
    function buildPostCard(post) {
        var card = document.createElement('div');
        card.className = 'post-card';
        card.setAttribute('data-post-id', post.id);

        if (post.status === 'deleted') {
            card.innerHTML = buildDeletedPostHTML();
            return card;
        }

        card.innerHTML = buildPostHTML(post);
        bindPostEvents(card, post);
        return card;
    }

    function buildPostHTML(post) {
        var author = post.author || {};
        var body = post.body || '';
        var images = post.image_urls || [];
        var isEdited = !!post.edited_at;

        var authorHTML = buildAuthorHTML(author, post.created_at, isEdited);
        var contentHTML = buildContentHTML(body, images, post.content_type);
        var actionsHTML = buildActionsHTML(post, author);

        return authorHTML + contentHTML + actionsHTML;
    }

    function buildDeletedPostHTML() {
        return '<div class="post-deleted">' +
            '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5">' +
                '<circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/>' +
            '</svg>' +
            'This post has been removed.</div>';
    }

    function buildAuthorHTML(author, createdAt, isEdited) {
        var initials = getInitials(author.name || '?');
        var photoHTML = author.profile_photo_url
            ? '<img src="' + escapeHtml(author.profile_photo_url) + '" alt="" class="post-author-photo">'
            : '<div class="post-author-avatar">' + initials + '</div>';

        return '<div class="post-header">' +
            photoHTML +
            '<div class="post-author-info">' +
                '<span class="post-author-name">' + escapeHtml(author.name || 'Unknown') + '</span>' +
                '<span class="post-author-meta">' +
                    escapeHtml(author.club || '') +
                    (author.location ? ' &middot; ' + escapeHtml(author.location) : '') +
                '</span>' +
            '</div>' +
            '<div class="post-header-right">' +
                '<span class="post-time" title="' + escapeHtml(createdAt || '') + '">' + relativeTime(createdAt) + '</span>' +
                (isEdited ? '<span class="post-edited-badge">Edited</span>' : '') +
                '<button class="post-menu-btn" title="More options">' +
                    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">' +
                        '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>' +
                    '</svg>' +
                '</button>' +
            '</div>' +
        '</div>';
    }

    function getRenderUrl(originalUrl, width) {
        if (!originalUrl) return originalUrl;
        // Convert /object/public/ to /render/image/public/ and append transformation params
        return originalUrl.replace('/object/public/', '/render/image/public/') +
            '?width=' + width + '&resize=cover&quality=85';
    }

    function buildContentHTML(body, images, contentType) {
        var html = '';

        if (body) {
            html += '<div class="post-body">' + formatPostText(escapeHtml(body)) + '</div>';
        }

        if (images && images.length > 0) {
            var feedWidth = 700;
            html += '<div class="post-images post-images-' + images.length + '">';
            images.forEach(function (url) {
                html += '<div class="post-image-wrapper">' +
                    '<img src="' + escapeHtml(getRenderUrl(url, feedWidth)) + '" data-full="' + escapeHtml(url) + '" alt="Post image" class="post-image" loading="lazy">' +
                '</div>';
            });
            html += '</div>';
        }

        return html;
    }

    function buildActionsHTML(post, author) {
        return '<div class="post-actions">' +
            '<div class="post-reaction-bar" id="reactions-' + post.id + '">' +
                '<div class="reaction-buttons" id="reactionBtns-' + post.id + '"></div>' +
                '<div class="reaction-counts" id="reactionCounts-' + post.id + '"></div>' +
            '</div>' +
            '<div class="post-comment-toggle" id="commentToggle-' + post.id + '">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' +
                '</svg>' +
                '<span id="commentCount-' + post.id + '">' + (post.comment_count || 0) + ' comments</span>' +
            '</div>' +
            '<div class="post-comments" id="comments-' + post.id + '" style="display:none;">' +
                '<div class="comments-list" id="commentsList-' + post.id + '"></div>' +
                '<div class="comment-input-area">' +
                    '<input type="text" class="comment-input" id="commentInput-' + post.id + '" placeholder="Write a comment..." maxlength="500">' +
                    '<button class="comment-submit-btn" id="commentSubmit-' + post.id + '" disabled>Post</button>' +
                '</div>' +
            '</div>' +
        '</div>';
    }

    function bindPostEvents(card, post) {
        // Author avatar click
        var avatar = card.querySelector('.post-author-avatar, .post-author-photo');
        if (avatar) {
            avatar.style.cursor = 'pointer';
            avatar.addEventListener('click', function () {
                window.location.href = 'profile.html';
            });
        }

        // Image click -> lightbox
        var imgs = card.querySelectorAll('.post-image');
        imgs.forEach(function (img) {
            img.addEventListener('click', function () {
                openLightbox(this.getAttribute('data-full') || this.src);
            });
        });

        // Three-dot menu
        var menuBtn = card.querySelector('.post-menu-btn');
        if (menuBtn) {
            menuBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                showPostMenu(post, card, this);
            });
        }

        // Comment toggle
        var commentToggle = card.querySelector('.post-comment-toggle');
        if (commentToggle) {
            commentToggle.addEventListener('click', function () {
                toggleComments(post.id);
            });
        }

        // Comment input
        var commentInput = card.querySelector('.comment-input');
        var commentSubmit = card.querySelector('.comment-submit-btn');
        if (commentInput && commentSubmit) {
            commentInput.addEventListener('input', function () {
                commentSubmit.disabled = !this.value.trim();
            });
            commentInput.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' && this.value.trim()) {
                    submitComment(post.id, this);
                }
            });
            commentSubmit.addEventListener('click', function () {
                submitComment(post.id, commentInput);
            });
        }

        // Reaction buttons
        renderReactionButtons(post.id, null);
    }

    function showPostMenu(post, card, anchor) {
        // Remove any existing menu
        var existing = document.querySelector('.post-context-menu');
        if (existing) existing.remove();

        var menu = document.createElement('div');
        menu.className = 'post-context-menu';

        var isOwn = currentMember && post.author && currentMember.id === post.author.id;
        var isAdmin = currentMember && currentMember.role === 'admin';

        var items = [];
        if (isOwn) {
            items.push({ label: 'Edit', action: function () { editPost(post, card); } });
            items.push({ label: 'Delete', action: function () { deletePost(post.id, card); } });
        }
        if (isAdmin && !isOwn) {
            items.push({ label: 'Delete (admin)', action: function () { deletePost(post.id, card); } });
        }
        if (!isOwn) {
            items.push({ label: 'Report', action: function () { openReportModal(post.id); } });
        }

        items.forEach(function (item) {
            var btn = document.createElement('button');
            btn.className = 'context-menu-item';
            btn.textContent = item.label;
            btn.addEventListener('click', function () {
                menu.remove();
                item.action();
            });
            menu.appendChild(btn);
        });

        var rect = anchor.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = rect.bottom + 4 + 'px';
        menu.style.right = (window.innerWidth - rect.right) + 'px';

        document.body.appendChild(menu);

        // Close on outside click
        setTimeout(function () {
            document.addEventListener('click', function closeMenu() {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            });
        }, 0);
    }

    function editPost(post, card) {
        var body = post.body || '';
        var editedHtml = '<textarea class="edit-post-textarea" id="editText-' + post.id + '" maxlength="2000">' + escapeHtml(body) + '</textarea>' +
            '<div class="edit-post-actions">' +
                '<button class="composer-btn composer-btn-cancel" id="cancelEdit-' + post.id + '">Cancel</button>' +
                '<button class="composer-btn composer-btn-submit" id="saveEdit-' + post.id + '">Save</button>' +
            '</div>';

        var editDiv = document.createElement('div');
        editDiv.className = 'post-edit-area';
        editDiv.innerHTML = editedHtml;

        var bodyEl = card.querySelector('.post-body');
        if (bodyEl) {
            bodyEl.style.display = 'none';
            bodyEl.parentNode.insertBefore(editDiv, bodyEl.nextSibling);
        } else {
            var headerEl = card.querySelector('.post-header');
            if (headerEl) headerEl.parentNode.insertBefore(editDiv, headerEl.nextSibling);
        }

        var editText = document.getElementById('editText-' + post.id);
        document.getElementById('cancelEdit-' + post.id).addEventListener('click', function () {
            editDiv.remove();
            if (bodyEl) bodyEl.style.display = '';
        });
        document.getElementById('saveEdit-' + post.id).addEventListener('click', function () {
            savePostEdit(post.id, card, editDiv, editText.value.trim(), bodyEl);
        });
        editText.focus();
    }

    function savePostEdit(postId, card, editDiv, newBody, bodyEl) {
        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts/' + postId, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ body: newBody })
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error); });
            return r.json();
        }).then(function (data) {
            editDiv.remove();
            if (bodyEl) {
                bodyEl.textContent = data.post.body;
                bodyEl.style.display = '';
            }
            // Add edited badge
            var headerRight = card.querySelector('.post-header-right');
            if (headerRight && !headerRight.querySelector('.post-edited-badge')) {
                var badge = document.createElement('span');
                badge.className = 'post-edited-badge';
                badge.textContent = 'Edited';
                var timeEl = headerRight.querySelector('.post-time');
                if (timeEl) {
                    timeEl.parentNode.insertBefore(badge, timeEl.nextSibling);
                }
            }
        }).catch(function (err) {
            alert('Edit failed: ' + err.message);
        });
    }

    function deletePost(postId, card) {
        if (!confirm('Delete this post?')) return;

        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts/' + postId, {
                method: 'DELETE',
                headers: headers
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error); });
            return r.json();
        }).then(function () {
            card.innerHTML = buildDeletedPostHTML();
            card.className = 'post-card post-card-deleted';
        }).catch(function (err) {
            alert('Delete failed: ' + err.message);
        });
    }

    // ==================== REACTIONS ====================
    function renderReactionButtons(postId, myReaction) {
        var btnsEl = document.getElementById('reactionBtns-' + postId);
        if (!btnsEl) return;

        var html = '';
        ALLOWED_REACTIONS.forEach(function (emoji) {
            var active = myReaction === emoji ? ' active' : '';
            html += '<button class="reaction-btn' + active + '" data-emoji="' + emoji + '" title="' + REACTION_LABELS[emoji] + '">' + emoji + '</button>';
        });
        btnsEl.innerHTML = html;

        btnsEl.querySelectorAll('.reaction-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                toggleReaction(postId, this.getAttribute('data-emoji'));
            });
        });
    }

    function updateReactionCounts(postId, counts, myReaction) {
        var countsEl = document.getElementById('reactionCounts-' + postId);
        if (!countsEl) return;

        var total = 0;
        for (var k in counts) { total += counts[k]; }
        if (!counts || total === 0) {
            countsEl.innerHTML = '';
            return;
        }

        var summary = '';
        var entries = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
        for (var i = 0; i < Math.min(entries.length, 3); i++) {
            summary += entries[i] + ' ' + counts[entries[i]];
            if (i < Math.min(entries.length, 3) - 1) summary += ' ';
        }
        if (total > 0) summary += ' ' + total;
        countsEl.textContent = summary;
    }

    function toggleReaction(postId, emoji) {
        getAuthHeaders().then(function (headers) {
            // Check if currently active
            var btn = document.querySelector('#reactionBtns-' + postId + ' .reaction-btn.active');
            var isRemoving = btn && btn.getAttribute('data-emoji') === emoji;

            if (isRemoving) {
                return fetch('/api/posts/' + postId + '/reactions', {
                    method: 'DELETE',
                    headers: headers
                });
            } else {
                return fetch('/api/posts/' + postId + '/reactions', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ emoji: emoji })
                });
            }
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error); });
            return r.json();
        }).then(function (data) {
            renderReactionButtons(postId, data.myReaction);
            updateReactionCounts(postId, data.reactionCounts, data.myReaction);
        }).catch(function (err) {
            console.error('Reaction error:', err);
        });
    }

    function loadReactions(posts) {
        var postIds = posts.map(function (p) { return p.id; });
        if (postIds.length === 0) return;

        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts/reactions', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ postIds: postIds })
            });
        }).then(function (r) {
            if (!r.ok) return;
            return r.json();
        }).then(function (data) {
            if (!data || !data.reactions) return;
            for (var postId in data.reactions) {
                var info = data.reactions[postId];
                renderReactionButtons(postId, info.myReaction);
                updateReactionCounts(postId, info.counts, info.myReaction);
            }
        }).catch(function () {});
    }

    // ==================== COMMENTS ====================
    function toggleComments(postId) {
        var commentsEl = document.getElementById('comments-' + postId);
        if (!commentsEl) return;
        var isVisible = commentsEl.style.display !== 'none';

        if (isVisible) {
            commentsEl.style.display = 'none';
        } else {
            commentsEl.style.display = 'block';
            loadComments(postId);
        }
    }

    function loadComments(postId) {
        var listEl = document.getElementById('commentsList-' + postId);
        if (!listEl) return;

        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts/' + postId + '/comments', { headers: headers });
        }).then(function (r) {
            if (!r.ok) throw new Error('Failed');
            return r.json();
        }).then(function (data) {
            var comments = data.comments || [];
            listEl.innerHTML = '';
            if (comments.length === 0) {
                listEl.innerHTML = '<div class="comments-empty">No comments yet</div>';
            } else {
                comments.forEach(function (c) {
                    listEl.appendChild(buildCommentEl(c, postId));
                });
            }
        }).catch(function (err) {
            listEl.innerHTML = '<div class="comments-empty">Failed to load comments</div>';
        });
    }

    function buildCommentEl(comment, postId) {
        var el = document.createElement('div');
        el.className = 'comment-item';
        var author = comment.author || {};
        var initials = getInitials(author.name || '?');
        var photoHTML = author.profile_photo_url
            ? '<img src="' + escapeHtml(author.profile_photo_url) + '" alt="" class="comment-author-photo">'
            : '<div class="comment-author-avatar">' + initials + '</div>';

        var isOwn = currentMember && currentMember.id === comment.author_id;
        var isAdmin = currentMember && currentMember.role === 'admin';

        el.innerHTML = photoHTML +
            '<div class="comment-content">' +
                '<div class="comment-header">' +
                    '<span class="comment-author-name">' + escapeHtml(author.name || 'Unknown') + '</span>' +
                    '<span class="comment-time">' + relativeTime(comment.created_at) + '</span>' +
                '</div>' +
                '<p class="comment-body">' + escapeHtml(comment.body) + '</p>' +
            '</div>' +
            ((isOwn || isAdmin) ? '<button class="comment-delete-btn" title="Delete comment">' +
                '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">' +
                    '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
                '</svg>' +
            '</button>' : '');

        var deleteBtn = el.querySelector('.comment-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                deleteComment(postId, comment.id, el);
            });
        }

        return el;
    }

    function submitComment(postId, inputEl) {
        var body = inputEl.value.trim();
        if (!body) return;

        var submitBtn = document.getElementById('commentSubmit-' + postId);
        if (submitBtn) submitBtn.disabled = true;

        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts/' + postId + '/comments', {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ body: body })
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error); });
            return r.json();
        }).then(function (data) {
            inputEl.value = '';
            if (submitBtn) submitBtn.disabled = true;

            var listEl = document.getElementById('commentsList-' + postId);
            if (listEl) {
                var emptyEl = listEl.querySelector('.comments-empty');
                if (emptyEl) emptyEl.remove();
                listEl.appendChild(buildCommentEl(data.comment, postId));
            }

            // Update comment count
            var countEl = document.getElementById('commentCount-' + postId);
            if (countEl) {
                var current = parseInt(countEl.textContent) || 0;
                countEl.textContent = (current + 1) + ' comments';
            }
        }).catch(function (err) {
            alert('Failed to add comment: ' + err.message);
            if (submitBtn) submitBtn.disabled = false;
        });
    }

    function deleteComment(postId, commentId, el) {
        if (!confirm('Delete this comment?')) return;

        getAuthHeaders().then(function (headers) {
            return fetch('/api/posts/' + postId + '/comments/' + commentId, {
                method: 'DELETE',
                headers: headers
            });
        }).then(function (r) {
            if (!r.ok) return r.json().then(function (err) { throw new Error(err.error); });
            return r.json();
        }).then(function () {
            el.remove();

            var countEl = document.getElementById('commentCount-' + postId);
            if (countEl) {
                var current = parseInt(countEl.textContent) || 1;
                countEl.textContent = Math.max(0, current - 1) + ' comments';
            }
        }).catch(function (err) {
            alert('Failed to delete comment: ' + err.message);
        });
    }

    // ==================== REPORT MODAL ====================
    function openReportModal(postId) {
        reportPostId = postId;
        elReportModal.classList.remove('hidden');
        document.getElementById('btnSubmitReport').disabled = true;
        var radios = elReportModal.querySelectorAll('input[name="reportReason"]');
        radios.forEach(function (r) { r.checked = false; });
    }

    function bindReportModalEvents() {
        var radios = elReportModal.querySelectorAll('input[name="reportReason"]');
        radios.forEach(function (r) {
            r.addEventListener('change', function () {
                document.getElementById('btnSubmitReport').disabled = false;
            });
        });

        document.getElementById('btnCancelReport').addEventListener('click', function () {
            elReportModal.classList.add('hidden');
            reportPostId = null;
        });

        document.getElementById('btnSubmitReport').addEventListener('click', function () {
            var selected = elReportModal.querySelector('input[name="reportReason"]:checked');
            if (!selected) return;

            getAuthHeaders().then(function (headers) {
                return fetch('/api/posts/' + reportPostId + '/report', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ reason: selected.value })
                });
            }).then(function (r) {
                if (!r.ok) return r.json().then(function (err) { throw new Error(err.error); });
                return r.json();
            }).then(function () {
                elReportModal.classList.add('hidden');
                reportPostId = null;
            }).catch(function (err) {
                alert('Failed to report: ' + err.message);
            });
        });

        // Close on overlay click
        elReportModal.addEventListener('click', function (e) {
            if (e.target === elReportModal) {
                elReportModal.classList.add('hidden');
                reportPostId = null;
            }
        });
    }

    // ==================== LIGHTBOX ====================
    function openLightbox(url) {
        elLightboxImg.src = url;
        elLightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function bindLightboxEvents() {
        elLightboxClose.addEventListener('click', function () {
            elLightbox.classList.add('hidden');
            document.body.style.overflow = '';
        });
        elLightbox.addEventListener('click', function (e) {
            if (e.target === elLightbox) {
                elLightbox.classList.add('hidden');
                document.body.style.overflow = '';
            }
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && !elLightbox.classList.contains('hidden')) {
                elLightbox.classList.add('hidden');
                document.body.style.overflow = '';
            }
        });
    }

    // ==================== UTILS ====================
    function getInitials(name) {
        if (!name) return '?';
        var parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
        return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatPostText(text) {
        return text
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>')
            .replace(/https?:\/\/[^\s<]+/g, function (url) {
                return '<a href="' + url + '" target="_blank" rel="noopener" class="post-link">' + url + '</a>';
            });
    }

    function relativeTime(isoString) {
        if (!isoString) return '';
        var then = new Date(isoString);
        var now = new Date();
        var diff = Math.floor((now - then) / 1000);

        if (diff < 60) return 'Just now';
        if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
        if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
        return then.toLocaleDateString();
    }

    // ==================== PUBLIC API ====================
    return {
        onAuthChange: onAuthChange
    };
})();

// Sign-in button for auth-required screen
document.addEventListener('DOMContentLoaded', function () {
    var signInBtn = document.getElementById('feedSignInBtn');
    if (signInBtn) {
        signInBtn.addEventListener('click', function () {
            if (typeof Auth !== 'undefined') {
                Auth.showAuthForm(document.getElementById('auth-container'));
            }
        });
    }
});

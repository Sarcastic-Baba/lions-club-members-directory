var Gallery = (function () {
    'use strict';

    var grid = document.getElementById('galleryGrid');
    var loading = document.getElementById('galleryLoading');
    var empty = document.getElementById('galleryEmpty');
    var adminPanel = document.getElementById('galleryAdminPanel');
    var uploadForm = document.getElementById('galleryUploadForm');
    var imageInput = document.getElementById('galleryImageInput');
    var fileLabel = document.getElementById('galleryFileLabel');
    var captionInput = document.getElementById('galleryCaptionInput');
    var uploadBtn = document.getElementById('galleryUploadBtn');
    var adminStatus = document.getElementById('galleryAdminStatus');
    var lightbox = document.getElementById('lightbox');
    var lightboxImg = document.getElementById('lightboxImg');
    var lightboxCaption = document.getElementById('lightboxCaption');
    var lightboxClose = document.getElementById('lightboxClose');
    var lightboxPrev = document.getElementById('lightboxPrev');
    var lightboxNext = document.getElementById('lightboxNext');
    var images = [];
    var currentIndex = 0;
    var isAdmin = false;

    function init() {
        bindLightbox();
        bindAdminForm();

        Auth.init()
            .then(function () {
                Auth.renderUI('auth-container');
                return refreshAdminState();
            })
            .then(loadGallery)
            .catch(function () {
                showGalleryError();
            });
    }

    function getAuthHeaders(includeContentType) {
        return Auth.getToken().then(function (token) {
            var headers = {};
            if (includeContentType !== false) headers['Content-Type'] = 'application/json';
            if (token) headers.Authorization = 'Bearer ' + token;
            return headers;
        });
    }

    function refreshAdminState() {
        var profilePromise = Auth.getProfile
            ? Auth.getProfile({ forceRefresh: true })
            : getAuthHeaders().then(function (headers) {
                return fetch('/api/profile', { headers: headers });
            }).then(function (r) {
                if (!r.ok) return null;
                return r.json();
            }).then(function (data) {
                return data && data.profile ? data.profile : null;
            }).catch(function () {
                return null;
            });

        return profilePromise.then(function (profile) {
            isAdmin = !!(profile &&
                profile.status === 'active' &&
                (profile.role === 'admin' || profile.role === 'district_admin'));

            if (adminPanel) adminPanel.classList.toggle('hidden', !isAdmin);
        });
    }

    function bindAdminForm() {
        if (imageInput && fileLabel) {
            imageInput.addEventListener('change', function () {
                var file = imageInput.files && imageInput.files[0];
                fileLabel.textContent = file ? file.name : 'Choose image';
            });
        }

        if (!uploadForm) return;
        uploadForm.addEventListener('submit', function (event) {
            event.preventDefault();
            if (!isAdmin) return;
            uploadGalleryImage();
        });
    }

    function loadGallery() {
        return getAuthHeaders().then(function (headers) {
            return fetch('/api/gallery', { headers: headers });
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (err) {
                    throw new Error(err.error || 'Failed to load gallery');
                });
            }
            return r.json();
        }).then(function (data) {
            renderGallery(data.images || []);
            if (isAdmin && data.schemaReady === false) {
                setAdminStatus('Gallery table missing. Run data/supabase-gallery-schema.sql in Supabase.', true);
            }
        }).catch(function (err) {
            console.warn('Gallery unavailable:', err.message);
            showGalleryError();
        });
    }

    function uploadGalleryImage() {
        var file = imageInput && imageInput.files ? imageInput.files[0] : null;
        if (!file) {
            setAdminStatus('Choose an image first.', true);
            return;
        }
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
            setAdminStatus('Only JPEG, PNG, and WEBP images are allowed.', true);
            return;
        }
        if (file.size > 5 * 1024 * 1024) {
            setAdminStatus('Image must be 5 MB or less.', true);
            return;
        }

        var formData = new FormData();
        formData.append('image', file);
        formData.append('caption', captionInput ? captionInput.value.trim() : '');

        setUploading(true);
        setAdminStatus('Uploading image...', false);

        getAuthHeaders(false).then(function (headers) {
            return fetch('/api/admin/gallery', {
                method: 'POST',
                headers: headers,
                body: formData
            });
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (err) {
                    throw new Error(err.error || 'Upload failed');
                });
            }
            return r.json();
        }).then(function () {
            if (uploadForm) uploadForm.reset();
            if (fileLabel) fileLabel.textContent = 'Choose image';
            setAdminStatus('Image added to gallery.', false);
            return loadGallery();
        }).catch(function (err) {
            setAdminStatus(err.message, true);
        }).finally(function () {
            setUploading(false);
        });
    }

    function deleteGalleryImage(id) {
        if (!id || !isAdmin) return;
        if (!confirm('Delete this gallery image?')) return;

        getAuthHeaders().then(function (headers) {
            return fetch('/api/admin/gallery/' + encodeURIComponent(id), {
                method: 'DELETE',
                headers: headers
            });
        }).then(function (r) {
            if (!r.ok) {
                return r.json().then(function (err) {
                    throw new Error(err.error || 'Delete failed');
                });
            }
            return r.json();
        }).then(function () {
            images = images.filter(function (image) { return image.id !== id; });
            renderGallery(images);
            setAdminStatus('Image deleted.', false);
        }).catch(function (err) {
            setAdminStatus(err.message, true);
        });
    }

    function renderGallery(items) {
        images = Array.isArray(items) ? items : [];
        if (loading) loading.classList.add('hidden');
        if (grid) grid.innerHTML = '';

        if (!images.length) {
            if (empty) empty.classList.remove('hidden');
            return;
        }

        if (empty) empty.classList.add('hidden');

        var fragment = document.createDocumentFragment();
        images.forEach(function (item, index) {
            var card = document.createElement('article');
            card.className = 'gallery-card';

            var imageWrap = document.createElement('div');
            imageWrap.className = 'gallery-card-img';

            var img = document.createElement('img');
            img.src = item.url || '';
            img.alt = item.caption || 'Gallery photo';
            img.loading = 'lazy';
            imageWrap.appendChild(img);
            card.appendChild(imageWrap);

            if (item.caption) {
                var caption = document.createElement('div');
                caption.className = 'gallery-card-caption';
                var text = document.createElement('p');
                text.textContent = item.caption;
                caption.appendChild(text);
                card.appendChild(caption);
            }

            if (isAdmin) {
                var actions = document.createElement('div');
                actions.className = 'gallery-card-actions';
                var deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'gallery-delete-btn';
                deleteBtn.textContent = 'Delete';
                deleteBtn.addEventListener('click', function (event) {
                    event.stopPropagation();
                    deleteGalleryImage(item.id);
                });
                actions.appendChild(deleteBtn);
                card.appendChild(actions);
            }

            card.addEventListener('click', function () { openLightbox(index); });
            fragment.appendChild(card);
        });

        if (grid) grid.appendChild(fragment);
    }

    function showGalleryError() {
        if (loading) loading.classList.add('hidden');
        if (empty) empty.classList.remove('hidden');
    }

    function setUploading(uploading) {
        if (!uploadBtn) return;
        uploadBtn.disabled = uploading;
        uploadBtn.textContent = uploading ? 'Adding...' : 'Add to Gallery';
    }

    function setAdminStatus(message, isError) {
        if (!adminStatus) return;
        adminStatus.textContent = message || '';
        adminStatus.classList.toggle('is-error', !!isError);
    }

    function bindLightbox() {
        if (!lightbox) return;

        if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
        lightbox.addEventListener('click', function (event) {
            if (event.target === lightbox) closeLightbox();
        });
        if (lightboxPrev) lightboxPrev.addEventListener('click', function () { navigateLightbox(-1); });
        if (lightboxNext) lightboxNext.addEventListener('click', function () { navigateLightbox(1); });
        document.addEventListener('keydown', function (event) {
            if (lightbox.classList.contains('hidden')) return;
            if (event.key === 'Escape') closeLightbox();
            if (event.key === 'ArrowLeft') navigateLightbox(-1);
            if (event.key === 'ArrowRight') navigateLightbox(1);
        });
    }

    function openLightbox(index) {
        if (!images[index]) return;
        currentIndex = index;
        updateLightboxImage();
        lightbox.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        lightbox.classList.add('hidden');
        document.body.style.overflow = '';
    }

    function navigateLightbox(direction) {
        if (!images.length) return;
        currentIndex = (currentIndex + direction + images.length) % images.length;
        updateLightboxImage();
    }

    function updateLightboxImage() {
        var item = images[currentIndex];
        if (!item) return;
        lightboxImg.src = item.url || '';
        lightboxCaption.textContent = item.caption || '';
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    return {
        loadGallery: loadGallery,
        renderGallery: renderGallery
    };
})();

// Re-export pure helpers under Node for backward compatibility with tests.
const logic =
    typeof module !== 'undefined' && module.exports
        ? require('./logic.js')
        : window.BacklogLogic;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = logic;
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        'use strict';

        const {
            ALL_FILTER,
            isSafeImageDataUrl,
            normalizeStoredItems,
            nextItemId,
            validateItemInput,
            processItems
        } = logic;

        // --- DOM Element References ---
        const inputFormSection = document.getElementById('input-form-section');
        const formTitle = document.getElementById('form-title');
        const itemForm = document.getElementById('item-form');
        const formError = document.getElementById('form-error');
        const statusMessage = document.getElementById('status-message');

        const nameInput = document.getElementById('name');
        const categoryInput = document.getElementById('category');
        const imageInput = document.getElementById('image');
        const imagePreviewArea = document.getElementById('current-image-preview');
        const purchaseDateInput = document.getElementById('purchase-date');
        const notesInput = document.getElementById('notes');
        const statusInput = document.getElementById('status');

        const addButton = document.getElementById('add-button');
        const updateButton = document.getElementById('update-button');
        const cancelButton = document.getElementById('cancel-button');

        const filterCategoryInput = document.getElementById('filter-category');
        const filterStatusInput = document.getElementById('filter-status');
        const sortByInput = document.getElementById('sort-by');
        const itemCountElement = document.getElementById('item-count');
        const resetFiltersButton = document.getElementById('reset-filters-btn');
        const itemListContainer = document.getElementById('item-list');

        const deleteDialog = document.getElementById('delete-dialog');
        const deleteDialogMessage = document.getElementById('delete-dialog-message');
        const deleteDialogCancel = document.getElementById('delete-dialog-cancel');
        const deleteDialogConfirm = document.getElementById('delete-dialog-confirm');

        // --- Application State ---
        const LOCAL_STORAGE_KEY = 'hobbyBacklogItems';
        const MAX_THUMBNAIL_DIM = 640;
        const MAX_IMAGE_DATA_URL_LENGTH = 300_000;

        let items = [];
        let currentItemIdBeingEdited = null;
        let pendingImageName = '';
        let pendingImageDataUrl = '';
        let imageRemovedInEdit = false;
        let pendingDeleteItemId = null;
        let lastFocusedBeforeDialog = null;
        let statusTimer = null;

        let currentFilterCategory = ALL_FILTER;
        let currentFilterStatus = ALL_FILTER;
        let currentSortOrder = 'date-desc';

        // --- Status & Validation UI Helpers ---

        function showStatusMessage(message, { isError = false, duration = 4000 } = {}) {
            if (statusTimer) {
                clearTimeout(statusTimer);
                statusTimer = null;
            }
            statusMessage.textContent = message;
            statusMessage.classList.toggle('is-error', isError);
            statusMessage.hidden = false;

            if (duration > 0) {
                statusTimer = setTimeout(() => {
                    statusMessage.hidden = true;
                    statusTimer = null;
                }, duration);
            }
        }

        function showFormError(message, focusEl) {
            formError.textContent = message;
            formError.hidden = false;
            if (focusEl) {
                focusEl.setAttribute('aria-invalid', 'true');
                focusEl.setAttribute('aria-describedby', 'form-error');
                focusEl.focus();
            }
        }

        function clearFormError() {
            formError.textContent = '';
            formError.hidden = true;
            nameInput.removeAttribute('aria-invalid');
            nameInput.removeAttribute('aria-describedby');
            purchaseDateInput.removeAttribute('aria-invalid');
            purchaseDateInput.removeAttribute('aria-describedby');
        }

        // --- LocalStorage Helpers ---

        function saveItemsToLocalStorage() {
            try {
                localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
                return true;
            } catch (error) {
                console.error('Error saving items to LocalStorage:', error);
                return false;
            }
        }

        function loadItemsFromLocalStorage() {
            try {
                const storedItems = localStorage.getItem(LOCAL_STORAGE_KEY);
                if (!storedItems) {
                    items = [];
                    return;
                }
                items = normalizeStoredItems(JSON.parse(storedItems));
            } catch (error) {
                console.error('Error loading items from LocalStorage:', error);
                items = [];
                showStatusMessage('保存データの読み込みに失敗したため、空の状態で開始しました。', { isError: true });
            }
        }

        // --- Image Reading & Compression ---

        /**
         * Reads an uploaded image File and downscales it on a Canvas into a compact data URL.
         * @param {File} file
         * @returns {Promise<string>}
         */
        function readAndCompressImage(file) {
            return new Promise((resolve) => {
                if (!file || !file.type.startsWith('image/')) {
                    resolve('');
                    return;
                }
                const reader = new FileReader();
                reader.onerror = () => resolve('');
                reader.onload = () => {
                    const rawDataUrl = typeof reader.result === 'string' ? reader.result : '';
                    if (!rawDataUrl) {
                        resolve('');
                        return;
                    }
                    const img = new Image();
                    img.onerror = () => {
                        resolve(isSafeImageDataUrl(rawDataUrl) && rawDataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH ? rawDataUrl : '');
                    };
                    img.onload = () => {
                        try {
                            const scale = Math.min(1, MAX_THUMBNAIL_DIM / Math.max(img.width || 1, img.height || 1));
                            const width = Math.max(1, Math.round(img.width * scale));
                            const height = Math.max(1, Math.round(img.height * scale));
                            const canvas = document.createElement('canvas');
                            canvas.width = width;
                            canvas.height = height;
                            const ctx = canvas.getContext('2d');
                            if (!ctx) {
                                resolve(isSafeImageDataUrl(rawDataUrl) && rawDataUrl.length <= MAX_IMAGE_DATA_URL_LENGTH ? rawDataUrl : '');
                                return;
                            }
                            if (file.type === 'image/png') {
                                ctx.drawImage(img, 0, 0, width, height);
                                const pngUrl = canvas.toDataURL('image/png');
                                if (isSafeImageDataUrl(pngUrl) && pngUrl.length <= MAX_IMAGE_DATA_URL_LENGTH) {
                                    resolve(pngUrl);
                                    return;
                                }
                                ctx.clearRect(0, 0, width, height);
                            }
                            ctx.fillStyle = '#ffffff';
                            ctx.fillRect(0, 0, width, height);
                            ctx.drawImage(img, 0, 0, width, height);
                            const compressed = canvas.toDataURL('image/jpeg', 0.78);
                            if (isSafeImageDataUrl(compressed) && compressed.length <= MAX_IMAGE_DATA_URL_LENGTH) {
                                resolve(compressed);
                            } else {
                                resolve('');
                            }
                        } catch {
                            resolve('');
                        }
                    };
                    img.src = rawDataUrl;
                };
                reader.readAsDataURL(file);
            });
        }

        function renderImagePreview(imageName, imageDataUrl) {
            imagePreviewArea.textContent = '';
            if (!imageName && !imageDataUrl) {
                imagePreviewArea.hidden = true;
                return;
            }

            const info = document.createElement('div');
            info.className = 'image-preview-info';

            if (isSafeImageDataUrl(imageDataUrl)) {
                const thumb = document.createElement('img');
                thumb.className = 'form-preview-thumbnail';
                thumb.src = imageDataUrl;
                thumb.alt = imageName ? `${imageName}のプレビュー` : '選択中の画像プレビュー';
                info.appendChild(thumb);
            }

            const label = document.createElement('span');
            label.className = 'image-preview-name';
            label.textContent = imageName ? `画像: ${imageName}` : '選択中の画像';
            info.appendChild(label);

            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.className = 'btn btn-link btn-sm';
            clearBtn.textContent = '画像を削除';
            clearBtn.addEventListener('click', () => {
                imageInput.value = '';
                pendingImageName = '';
                pendingImageDataUrl = '';
                imageRemovedInEdit = true;
                renderImagePreview('', '');
            });

            imagePreviewArea.appendChild(info);
            imagePreviewArea.appendChild(clearBtn);
            imagePreviewArea.hidden = false;
        }

        // --- Form State Management ---

        function setFormMode(mode) {
            const isEdit = mode === 'edit';
            addButton.hidden = isEdit;
            updateButton.hidden = !isEdit;
            inputFormSection.classList.toggle('is-editing', isEdit);
            formTitle.textContent = isEdit ? 'アイテム編集' : 'アイテム入力';

            if (!isEdit) {
                currentItemIdBeingEdited = null;
                pendingImageName = '';
                pendingImageDataUrl = '';
                imageRemovedInEdit = false;
                renderImagePreview('', '');
            }
        }

        function resetForm() {
            itemForm.reset();
            imageInput.value = '';
            clearFormError();
            setFormMode('add');
            processAndRenderItems();
        }

        function getFormValues() {
            return {
                name: nameInput.value.trim(),
                category: categoryInput.value,
                purchaseDate: purchaseDateInput.value.trim(),
                notes: notesInput.value.trim(),
                status: statusInput.value
            };
        }

        // --- Form Submission ---

        async function handleSubmit(event) {
            event.preventDefault();
            clearFormError();

            const values = getFormValues();
            const validation = validateItemInput(values);
            if (!validation.valid) {
                const targetInput = validation.field === 'purchaseDate' ? purchaseDateInput : nameInput;
                showFormError(validation.error, targetInput);
                return;
            }

            const selectedFile = imageInput.files && imageInput.files[0];
            let nextImageName = pendingImageName;
            let nextImageDataUrl = pendingImageDataUrl;

            if (selectedFile) {
                nextImageName = selectedFile.name;
                if (!nextImageDataUrl) {
                    nextImageDataUrl = await readAndCompressImage(selectedFile);
                }
            }

            let targetId = currentItemIdBeingEdited;
            let actionLabel = '';

            if (currentItemIdBeingEdited === null) {
                const newItem = {
                    id: nextItemId(items, Date.now()),
                    name: values.name,
                    category: values.category,
                    imageName: nextImageName,
                    imageDataUrl: nextImageDataUrl,
                    purchaseDate: values.purchaseDate,
                    notes: values.notes,
                    status: values.status
                };
                targetId = newItem.id;
                items.push(newItem);
                actionLabel = `「${values.name}」を追加しました。`;
            } else {
                items = items.map((item) => {
                    if (item.id !== currentItemIdBeingEdited) return item;
                    const resolvedImageName = selectedFile
                        ? nextImageName
                        : (imageRemovedInEdit ? '' : item.imageName);
                    const resolvedImageDataUrl = selectedFile
                        ? nextImageDataUrl
                        : (imageRemovedInEdit ? '' : item.imageDataUrl);
                    return {
                        ...item,
                        name: values.name,
                        category: values.category,
                        imageName: resolvedImageName,
                        imageDataUrl: resolvedImageDataUrl,
                        purchaseDate: values.purchaseDate,
                        notes: values.notes,
                        status: values.status
                    };
                });
                actionLabel = `「${values.name}」を更新しました。`;
            }

            let saved = saveItemsToLocalStorage();
            if (!saved && nextImageDataUrl) {
                // Fallback when LocalStorage quota is exceeded by image data: keep item metadata without thumbnail
                items = items.map((item) => (item.id === targetId ? { ...item, imageDataUrl: '' } : item));
                saved = saveItemsToLocalStorage();
                if (saved) {
                    showStatusMessage(`${actionLabel}（保存容量の上限のため画像プレビューは省略されました）`, { isError: true, duration: 6000 });
                }
            }

            if (!saved) {
                showStatusMessage('データの保存に失敗しました。ブラウザの保存容量を確認してください。', { isError: true, duration: 6000 });
            } else {
                const hiddenByFilter =
                    (currentFilterCategory !== ALL_FILTER && values.category !== currentFilterCategory) ||
                    (currentFilterStatus !== ALL_FILTER && values.status !== currentFilterStatus);
                if (!statusMessage.classList.contains('is-error') || statusMessage.hidden) {
                    const suffix = hiddenByFilter ? '（現在のフィルタ条件により非表示です）' : '';
                    showStatusMessage(`${actionLabel}${suffix}`);
                }
            }

            resetForm();
        }

        // --- Rendering ---

        function appendDetail(parent, label, value, extraClass) {
            const paragraph = document.createElement('p');
            if (extraClass) {
                paragraph.className = extraClass;
            }
            const strong = document.createElement('strong');
            strong.textContent = `${label}: `;
            paragraph.appendChild(strong);
            paragraph.appendChild(document.createTextNode(value));
            parent.appendChild(paragraph);
        }

        function updateSummary(visibleCount, totalCount) {
            const hasActiveFilter =
                currentFilterCategory !== ALL_FILTER || currentFilterStatus !== ALL_FILTER;
            itemCountElement.textContent = hasActiveFilter
                ? `表示中: ${visibleCount}件 / 全${totalCount}件`
                : `全${totalCount}件`;
            resetFiltersButton.hidden = !hasActiveFilter;
        }

        function createItemCard(item) {
            const itemCard = document.createElement('article');
            itemCard.className = 'item-card';
            itemCard.dataset.id = String(item.id);
            if (item.id === currentItemIdBeingEdited) {
                itemCard.classList.add('is-editing-target');
            }

            const header = document.createElement('div');
            header.className = 'item-card-header';

            const itemNameElement = document.createElement('h3');
            itemNameElement.textContent = item.name;
            header.appendChild(itemNameElement);

            const statusBadge = document.createElement('span');
            statusBadge.className = 'status-badge';
            statusBadge.dataset.status = item.status;
            statusBadge.textContent = item.status;
            header.appendChild(statusBadge);

            itemCard.appendChild(header);

            if (isSafeImageDataUrl(item.imageDataUrl)) {
                const thumb = document.createElement('img');
                thumb.className = 'item-thumbnail';
                thumb.src = item.imageDataUrl;
                thumb.alt = `${item.name}の画像`;
                thumb.loading = 'lazy';
                itemCard.appendChild(thumb);
            }

            const details = document.createElement('div');
            details.className = 'item-details';

            appendDetail(details, 'カテゴリ', item.category);
            if (item.imageName && !isSafeImageDataUrl(item.imageDataUrl)) {
                appendDetail(details, '画像', item.imageName);
            }
            appendDetail(details, '購入日', item.purchaseDate || '未設定');
            appendDetail(details, 'ステータス', item.status);
            if (item.notes) {
                appendDetail(details, 'メモ', item.notes, 'item-notes');
            }

            itemCard.appendChild(details);

            const actionButtonsDiv = document.createElement('div');
            actionButtonsDiv.className = 'action-buttons';

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.textContent = '編集';
            editButton.className = 'btn btn-sm edit-btn';
            editButton.dataset.action = 'edit';
            editButton.setAttribute('aria-label', `「${item.name}」を編集`);

            const deleteButton = document.createElement('button');
            deleteButton.type = 'button';
            deleteButton.textContent = '削除';
            deleteButton.className = 'btn btn-sm delete-btn';
            deleteButton.dataset.action = 'delete';
            deleteButton.setAttribute('aria-label', `「${item.name}」を削除`);

            actionButtonsDiv.appendChild(editButton);
            actionButtonsDiv.appendChild(deleteButton);
            itemCard.appendChild(actionButtonsDiv);

            return itemCard;
        }

        function renderItems(itemsToRender) {
            itemListContainer.textContent = '';
            updateSummary(itemsToRender.length, items.length);

            if (itemsToRender.length === 0) {
                const emptyBox = document.createElement('div');
                emptyBox.className = 'empty-state';

                const emptyMessage = document.createElement('p');
                const hasActiveFilter =
                    currentFilterCategory !== ALL_FILTER || currentFilterStatus !== ALL_FILTER;
                emptyMessage.textContent =
                    items.length === 0
                        ? 'アイテムはまだありません。フォームから追加してください。'
                        : '該当するアイテムはありません。';
                emptyBox.appendChild(emptyMessage);

                if (hasActiveFilter && items.length > 0) {
                    const clearFilterBtn = document.createElement('button');
                    clearFilterBtn.type = 'button';
                    clearFilterBtn.className = 'btn btn-link btn-sm';
                    clearFilterBtn.dataset.action = 'reset-filters';
                    clearFilterBtn.textContent = 'フィルタを解除してすべて表示';
                    emptyBox.appendChild(clearFilterBtn);
                }

                itemListContainer.appendChild(emptyBox);
                return;
            }

            const fragment = document.createDocumentFragment();
            for (const item of itemsToRender) {
                fragment.appendChild(createItemCard(item));
            }
            itemListContainer.appendChild(fragment);
        }

        function processAndRenderItems() {
            const processed = processItems(items, {
                category: currentFilterCategory,
                status: currentFilterStatus,
                sortOrder: currentSortOrder
            });
            renderItems(processed);
        }

        // --- Edit & Delete Actions ---

        function startEditingItem(item) {
            clearFormError();
            nameInput.value = item.name;
            categoryInput.value = item.category;
            purchaseDateInput.value = item.purchaseDate;
            notesInput.value = item.notes;
            statusInput.value = item.status;

            imageInput.value = '';
            pendingImageName = item.imageName || '';
            pendingImageDataUrl = item.imageDataUrl || '';
            imageRemovedInEdit = false;
            renderImagePreview(pendingImageName, pendingImageDataUrl);

            currentItemIdBeingEdited = item.id;
            setFormMode('edit');
            processAndRenderItems();
            inputFormSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            nameInput.focus();
        }

        function openDeleteDialog(item, triggerButton) {
            pendingDeleteItemId = item.id;
            lastFocusedBeforeDialog = triggerButton || null;
            deleteDialogMessage.textContent = `「${item.name}」を削除してもよろしいですか？この操作は取り消せません。`;
            if (typeof deleteDialog.showModal === 'function') {
                deleteDialog.showModal();
            } else {
                deleteDialog.setAttribute('open', '');
            }
            deleteDialogCancel.focus();
        }

        function closeDeleteDialog() {
            pendingDeleteItemId = null;
            if (typeof deleteDialog.close === 'function' && deleteDialog.open) {
                deleteDialog.close();
            } else {
                deleteDialog.removeAttribute('open');
            }
            if (lastFocusedBeforeDialog && document.contains(lastFocusedBeforeDialog)) {
                lastFocusedBeforeDialog.focus();
            }
            lastFocusedBeforeDialog = null;
        }

        function confirmDeleteItem() {
            if (pendingDeleteItemId === null) {
                closeDeleteDialog();
                return;
            }
            const target = items.find((i) => i.id === pendingDeleteItemId);
            const deletedId = pendingDeleteItemId;
            items = items.filter((i) => i.id !== deletedId);
            const saved = saveItemsToLocalStorage();
            closeDeleteDialog();

            if (currentItemIdBeingEdited === deletedId) {
                resetForm();
            } else {
                processAndRenderItems();
            }

            if (saved && target) {
                showStatusMessage(`「${target.name}」を削除しました。`);
            } else if (!saved) {
                showStatusMessage('削除後の保存に失敗しました。', { isError: true });
            }
        }

        function resetFilters() {
            currentFilterCategory = ALL_FILTER;
            currentFilterStatus = ALL_FILTER;
            filterCategoryInput.value = ALL_FILTER;
            filterStatusInput.value = ALL_FILTER;
            processAndRenderItems();
        }

        // --- Event Listeners ---

        itemForm.addEventListener('submit', handleSubmit);

        nameInput.addEventListener('input', () => {
            if (!formError.hidden && nameInput.value.trim()) {
                clearFormError();
            }
        });

        imageInput.addEventListener('change', async () => {
            const file = imageInput.files && imageInput.files[0];
            if (!file) {
                if (currentItemIdBeingEdited === null) {
                    pendingImageName = '';
                    pendingImageDataUrl = '';
                    renderImagePreview('', '');
                }
                return;
            }
            pendingImageName = file.name;
            imageRemovedInEdit = false;
            pendingImageDataUrl = await readAndCompressImage(file);
            renderImagePreview(pendingImageName, pendingImageDataUrl);
        });

        cancelButton.addEventListener('click', () => {
            resetForm();
        });

        resetFiltersButton.addEventListener('click', resetFilters);

        filterCategoryInput.addEventListener('change', (event) => {
            currentFilterCategory = event.target.value;
            processAndRenderItems();
        });

        filterStatusInput.addEventListener('change', (event) => {
            currentFilterStatus = event.target.value;
            processAndRenderItems();
        });

        sortByInput.addEventListener('change', (event) => {
            currentSortOrder = event.target.value;
            processAndRenderItems();
        });

        // Event delegation for card actions & empty-state filter reset
        itemListContainer.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-action]');
            if (!button) return;

            const action = button.dataset.action;
            if (action === 'reset-filters') {
                resetFilters();
                return;
            }

            const card = button.closest('.item-card');
            if (!card) return;
            const itemId = Number(card.dataset.id);
            const item = items.find((i) => i.id === itemId);
            if (!item) return;

            if (action === 'edit') {
                startEditingItem(item);
            } else if (action === 'delete') {
                openDeleteDialog(item, button);
            }
        });

        deleteDialogCancel.addEventListener('click', closeDeleteDialog);
        deleteDialogConfirm.addEventListener('click', confirmDeleteItem);
        deleteDialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeDeleteDialog();
        });
        deleteDialog.addEventListener('click', (event) => {
            if (event.target === deleteDialog) {
                closeDeleteDialog();
            }
        });

        // --- Initial Load and Render ---
        loadItemsFromLocalStorage();
        setFormMode('add');
        processAndRenderItems();
    });
}

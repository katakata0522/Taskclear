/**
 * Pure domain logic for Hobby Backlog Manager.
 * Shared between the browser (window.BacklogLogic) and Node tests (module.exports).
 */
(function (root, factory) {
    const exportsObj = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = exportsObj;
    }
    if (root) {
        root.BacklogLogic = exportsObj;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const CATEGORIES = Object.freeze(['本', 'ゲーム', 'プラモデル', 'その他']);
    const STATUSES = Object.freeze(['未着手', '進行中', '一時中断', '完了']);
    const DEFAULT_CATEGORY = 'その他';
    const DEFAULT_STATUS = '未着手';
    const ALL_FILTER = 'すべて';

    const SAFE_IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
    const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

    /**
     * Checks whether a string is a safe base64 raster image data URL.
     * @param {unknown} value
     * @returns {boolean}
     */
    function isSafeImageDataUrl(value) {
        return typeof value === 'string' && SAFE_IMAGE_DATA_URL_RE.test(value);
    }

    /**
     * Converts a strict "YYYY-MM-DD" string to a UTC timestamp, or null when missing/invalid.
     * Rejects calendar rollovers such as "2026-02-31".
     * @param {unknown} value
     * @returns {number|null}
     */
    function purchaseTime(value) {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        const match = ISO_DATE_RE.exec(trimmed);
        if (!match) return null;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        const timestamp = Date.UTC(year, month - 1, day);
        const date = new Date(timestamp);

        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day
        ) {
            return null;
        }
        return timestamp;
    }

    /**
     * Returns a new numeric item ID that does not collide with existing IDs.
     * @param {Array<{id?: unknown}>} existing
     * @param {number} now
     * @returns {number}
     */
    function nextItemId(existing, now) {
        const list = Array.isArray(existing) ? existing : [];
        const maxId = list.reduce((max, item) => {
            if (item && typeof item.id === 'number' && Number.isFinite(item.id) && item.id > max) {
                return item.id;
            }
            return max;
        }, 0);
        const safeNow = typeof now === 'number' && Number.isFinite(now) ? Math.floor(now) : 1;
        return safeNow > maxId ? safeNow : maxId + 1;
    }

    /**
     * Normalizes data read from LocalStorage so broken, partial, or legacy entries cannot crash rendering.
     * Guarantees unique finite numeric IDs, safe strings, valid category/status fallbacks,
     * and strips any unsafe imageDataUrl values.
     * @param {unknown} data
     * @returns {Array<Object>}
     */
    function normalizeStoredItems(data) {
        if (!Array.isArray(data)) return [];
        const text = (value) => (typeof value === 'string' ? value : (value == null ? '' : String(value)));
        const usedIds = new Set();
        const normalized = [];
        let fallbackSeq = 1;

        for (const raw of data) {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;

            let id = raw.id;
            if (typeof id !== 'number' || !Number.isFinite(id) || usedIds.has(id)) {
                while (usedIds.has(fallbackSeq)) {
                    fallbackSeq += 1;
                }
                id = nextItemId(normalized, fallbackSeq);
                fallbackSeq = id + 1;
            }
            usedIds.add(id);

            const rawCategory = text(raw.category).trim();
            const rawStatus = text(raw.status).trim();
            const rawImageName = text(raw.imageName).trim();
            const imageName = rawImageName === 'N/A' ? '' : rawImageName;
            const rawPurchaseDate = text(raw.purchaseDate).trim();

            normalized.push({
                ...raw,
                id,
                name: text(raw.name),
                category: CATEGORIES.includes(rawCategory) ? rawCategory : DEFAULT_CATEGORY,
                imageName,
                imageDataUrl: isSafeImageDataUrl(raw.imageDataUrl) ? raw.imageDataUrl : '',
                purchaseDate: purchaseTime(rawPurchaseDate) !== null ? rawPurchaseDate : '',
                notes: text(raw.notes),
                status: STATUSES.includes(rawStatus) ? rawStatus : DEFAULT_STATUS
            });
        }

        return normalized;
    }

    /**
     * Validates form input values before creating or updating an item.
     * @param {{name?: unknown, purchaseDate?: unknown}} input
     * @returns {{valid: boolean, error: string, field: string|null}}
     */
    function validateItemInput(input) {
        const name = typeof input?.name === 'string' ? input.name.trim() : '';
        if (!name) {
            return { valid: false, error: '名前は必須です。', field: 'name' };
        }
        const purchaseDate = typeof input?.purchaseDate === 'string' ? input.purchaseDate.trim() : '';
        if (purchaseDate && purchaseTime(purchaseDate) === null) {
            return { valid: false, error: '購入日の形式が正しくありません。', field: 'purchaseDate' };
        }
        return { valid: true, error: '', field: null };
    }

    /**
     * Filters items conjunctively by category and status.
     * @param {Array<Object>} list
     * @param {{category?: string, status?: string}} filters
     * @returns {Array<Object>}
     */
    function filterItems(list, filters) {
        if (!Array.isArray(list)) return [];
        const category = filters?.category || ALL_FILTER;
        const status = filters?.status || ALL_FILTER;

        return list.filter((item) => {
            if (category !== ALL_FILTER && item.category !== category) return false;
            if (status !== ALL_FILTER && item.status !== status) return false;
            return true;
        });
    }

    /**
     * Sorts a copy of items by the given order.
     * Missing or invalid dates always sort last; ties break deterministically by name then id.
     * @param {Array<Object>} list
     * @param {string} order
     * @returns {Array<Object>}
     */
    function sortItems(list, order) {
        if (!Array.isArray(list)) return [];
        const sorted = [...list];
        const nameOf = (item) => String(item?.name ?? '');
        const idOf = (item) => (typeof item?.id === 'number' && Number.isFinite(item.id) ? item.id : 0);
        const tieBreak = (a, b) => nameOf(a).localeCompare(nameOf(b), 'ja') || (idOf(b) - idOf(a));

        switch (order) {
            case 'date-desc':
                sorted.sort((a, b) => {
                    const ta = purchaseTime(a?.purchaseDate);
                    const tb = purchaseTime(b?.purchaseDate);
                    if (ta === null && tb === null) return tieBreak(a, b);
                    if (ta === null) return 1;
                    if (tb === null) return -1;
                    return (tb - ta) || tieBreak(a, b);
                });
                break;
            case 'date-asc':
                sorted.sort((a, b) => {
                    const ta = purchaseTime(a?.purchaseDate);
                    const tb = purchaseTime(b?.purchaseDate);
                    if (ta === null && tb === null) return tieBreak(a, b);
                    if (ta === null) return 1;
                    if (tb === null) return -1;
                    return (ta - tb) || tieBreak(a, b);
                });
                break;
            case 'name-asc':
                sorted.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'ja') || (idOf(b) - idOf(a)));
                break;
            case 'name-desc':
                sorted.sort((a, b) => nameOf(b).localeCompare(nameOf(a), 'ja') || (idOf(b) - idOf(a)));
                break;
        }
        return sorted;
    }

    /**
     * Applies filtering and sorting in one pure step.
     * @param {Array<Object>} list
     * @param {{category?: string, status?: string, sortOrder?: string}} options
     * @returns {Array<Object>}
     */
    function processItems(list, options) {
        const filtered = filterItems(list, options);
        return sortItems(filtered, options?.sortOrder || 'date-desc');
    }

    return {
        CATEGORIES,
        STATUSES,
        DEFAULT_CATEGORY,
        DEFAULT_STATUS,
        ALL_FILTER,
        isSafeImageDataUrl,
        purchaseTime,
        nextItemId,
        normalizeStoredItems,
        validateItemInput,
        filterItems,
        sortItems,
        processItems
    };
});

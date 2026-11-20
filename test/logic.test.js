const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeStoredItems,
  purchaseTime,
  nextItemId,
  validateItemInput,
  filterItems,
  sortItems,
  processItems,
  isSafeImageDataUrl,
} = require('../script.js');

test('broken stored data does not crash and normalizes missing/invalid fields', () => {
  assert.deepEqual(normalizeStoredItems(null), []);
  assert.deepEqual(normalizeStoredItems({ a: 1 }), []);
  const out = normalizeStoredItems([
    null,
    5,
    { id: 1, name: 'A', imageName: 'N/A', purchaseDate: '2026-02-31' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
  assert.equal(out[0].notes, '');
  assert.equal(out[0].purchaseDate, '');
  assert.equal(out[0].imageName, '');
  assert.equal(out[0].category, 'その他');
  assert.equal(out[0].status, '未着手');
});

test('normalizeStoredItems assigns unique numeric IDs and strips unsafe imageDataUrl', () => {
  const safePng = 'data:image/png;base64,iVBORw0KGgo=';
  const out = normalizeStoredItems([
    { id: 10, name: 'First', imageDataUrl: safePng },
    { id: 10, name: 'Duplicate', imageDataUrl: 'javascript:alert(1)' },
    { id: 'bad', name: 'BadId', imageDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' },
  ]);
  assert.equal(out.length, 3);
  const ids = new Set(out.map((i) => i.id));
  assert.equal(ids.size, 3);
  assert.equal(out[0].imageDataUrl, safePng);
  assert.equal(out[1].imageDataUrl, '');
  assert.equal(out[2].imageDataUrl, '');
  assert.equal(isSafeImageDataUrl(safePng), true);
  assert.equal(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false);
});

test('purchaseTime validates strict YYYY-MM-DD calendar dates', () => {
  assert.equal(purchaseTime('2026-01-15'), Date.UTC(2026, 0, 15));
  assert.equal(purchaseTime('2024-02-29'), Date.UTC(2024, 1, 29));
  assert.equal(purchaseTime('2026-02-29'), null);
  assert.equal(purchaseTime('2026-02-31'), null);
  assert.equal(purchaseTime('2026'), null);
  assert.equal(purchaseTime('bad'), null);
  assert.equal(purchaseTime(''), null);
});

test('ids never collide', () => {
  assert.equal(nextItemId([{ id: 100 }], 100), 101);
  assert.equal(nextItemId([], 50), 50);
  assert.equal(nextItemId([{ id: NaN }, { id: 10 }], 5), 11);
});

test('validateItemInput rejects empty/whitespace names and invalid dates', () => {
  assert.equal(validateItemInput({ name: '   ' }).valid, false);
  assert.equal(validateItemInput({ name: '本A', purchaseDate: '2026-02-31' }).valid, false);
  assert.equal(validateItemInput({ name: '本A', purchaseDate: '2026-03-01' }).valid, true);
  assert.equal(validateItemInput({ name: '本A', purchaseDate: '' }).valid, true);
});

test('filterItems applies category and status filters conjunctively', () => {
  const items = [
    { id: 1, name: 'A', category: '本', status: '未着手' },
    { id: 2, name: 'B', category: '本', status: '完了' },
    { id: 3, name: 'C', category: 'ゲーム', status: '完了' },
  ];
  assert.equal(filterItems(items, { category: 'すべて', status: 'すべて' }).length, 3);
  assert.deepEqual(filterItems(items, { category: '本', status: 'すべて' }).map((i) => i.id), [1, 2]);
  assert.deepEqual(filterItems(items, { category: '本', status: '完了' }).map((i) => i.id), [2]);
});

test('sorting puts missing/invalid dates last, breaks ties deterministically, and survives missing names', () => {
  const items = [
    { id: 1, name: 'D', purchaseDate: 'bad' },
    { id: 2, name: 'B', purchaseDate: '2026-01-02' },
    { id: 3, name: 'A', purchaseDate: '2025-01-01' },
    { id: 4, name: 'C' },
    { id: 5, name: 'A', purchaseDate: '2026-01-02' },
  ];
  assert.deepEqual(sortItems(items, 'date-desc').map((i) => i.id), [5, 2, 3, 4, 1]);
  assert.deepEqual(sortItems(items, 'date-asc').map((i) => i.id), [3, 5, 2, 4, 1]);
  assert.doesNotThrow(() => sortItems([{ name: undefined }, { name: 'b' }], 'name-asc'));
  assert.deepEqual(
    processItems(
      [
        { id: 1, name: 'あ', category: '本', status: '未着手', purchaseDate: '2026-01-01' },
        { id: 2, name: 'い', category: '本', status: '未着手', purchaseDate: '2026-01-05' },
      ],
      { category: '本', status: '未着手', sortOrder: 'name-desc' }
    ).map((i) => i.id),
    [2, 1]
  );
});

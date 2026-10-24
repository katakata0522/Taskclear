const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStoredItems, nextItemId, sortItems } = require('../script.js');

test('broken stored data does not crash', () => {
  assert.deepEqual(normalizeStoredItems(null), []);
  assert.deepEqual(normalizeStoredItems({ a: 1 }), []);
  const out = normalizeStoredItems([null, 5, { id: 1, name: 'A' }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].notes, '');
  assert.equal(out[0].purchaseDate, '');
});

test('ids never collide', () => {
  assert.equal(nextItemId([{ id: 100 }], 100), 101);
  assert.equal(nextItemId([], 50), 50);
});

test('sorting puts missing/invalid dates last and survives missing names', () => {
  const items = [{ id: 1, purchaseDate: 'bad' }, { id: 2, purchaseDate: '2026-01-02' }, { id: 3, purchaseDate: '2025-01-01' }, { id: 4 }];
  assert.deepEqual(sortItems(items, 'date-desc').map(i => i.id).slice(0, 2), [2, 3]);
  assert.deepEqual(sortItems(items, 'date-asc').map(i => i.id).slice(0, 2), [3, 2]);
  assert.doesNotThrow(() => sortItems([{ name: undefined }, { name: 'b' }], 'name-asc'));
});

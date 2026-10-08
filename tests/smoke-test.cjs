'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../script.js', 'utf8');

class Element {
  constructor(tag = 'div', doc) {
    this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.listeners = {};
    this.dataset = {}; this.value = ''; this.hidden = false; this.textContent = ''; this.id = ''; this.checked = false;
    this.open = false; this.style = {}; this.attributes = {}; this.files = []; this.max = '';
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...items) { for (const item of items) this.appendChild(item); }
  appendChild(item) { this.children.push(item); if (item && item.id) this.ownerDocument.ids[item.id] = item; return item; }
  remove() {}
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, extra = {}) {
    return (this.listeners[type] || []).map((fn) => fn({ preventDefault() {}, currentTarget: this, target: this, ...extra }));
  }
  click() { this.dispatch('click'); }
  focus() {}
  reset() { this.checked = false; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
  closest(selector) { return selector === 'button[data-action]' && this.dataset.action ? this : null; }
}
const findAll = (el, filter) => el.children.flatMap((child) => [...(filter(child) ? [child] : []), ...findAll(child, filter)]);
function launch(initial = {}, canSave = true, confirms = true) {
  const ids = {};
  const doc = { ids, createElement: (tag) => new Element(tag, doc), getElementById: (id) => ids[id], body: null,
    querySelectorAll: (selector) => selector === '[data-minutes]' ? presets : [] };
  doc.body = doc.createElement('body');
  const names = `storage-warning storage-warning-message storage-raw-export storage-import-trigger storage-reload toast focus-heading focus-content focus-counter focus-primary focus-complete focus-next count-waiting count-active count-done journal-total week-minutes log-empty log-list logs-more item-list result-count empty-state empty-title empty-message empty-add item-dialog item-form dialog-title form-save item-name item-category item-status item-date item-next item-notes add-top add-inline dialog-close form-cancel log-dialog log-form log-dialog-title log-item-title log-close log-cancel log-minutes log-date log-note log-finish search category-filter status-filter sort export import-trigger import-file`;
  for (const id of names.split(' ')) ids[id] = new Element('div', doc);
  const presets = [5, 15, 30, 60].map((n) => { const el = doc.createElement('button'); el.dataset.minutes = String(n); return el; });
  const data = new Map(Object.entries(initial));
  let downloaded = null; let reloadCount = 0;
  const storage = {
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => { if (!canSave) throw Error('QuotaExceeded'); data.set(key, value); },
    removeItem: (key) => data.delete(key),
  };
  const win = { listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatch(type, fields) { for (const fn of this.listeners[type] || []) fn(fields); } };
  const ctx = { document: doc, localStorage: storage, window: win, location: { reload: () => { reloadCount++; } },
    crypto: { randomUUID: (() => { let n = 0; return () => `id-${++n}`; })() },
    Intl, Date, Math, console, Blob,
    URL: { createObjectURL: (blob) => { downloaded = blob; return 'blob:test'; }, revokeObjectURL: () => {} },
    setTimeout: () => 1, clearTimeout: () => {}, confirm: () => confirms,
  };
  vm.runInNewContext(source, ctx);
  const send = (id, type, extra = {}) => ids[id].dispatch(type, extra);
  const get = () => JSON.parse(data.get('taskclear-mvp-v1'));
  const add = (name, category = '本', status = '未着手', next = '') => {
    send('add-inline', 'click'); ids['item-name'].value = name; ids['item-category'].value = category;
    ids['item-status'].value = status; ids['item-date'].value = ''; ids['item-notes'].value = '';
    ids['item-next'].value = next; send('item-form', 'submit');
  };
  const action = (name, place = 'item-list') => {
    const button = findAll(ids[place], (el) => el.dataset?.action === name)[0];
    assert(button, `missing action ${name} in ${place}`); send(place, 'click', { target: button });
  };
  const importFile = async (raw) => {
    ids['import-file'].files = [{ size: raw.length, text: async () => raw }];
    await Promise.all(send('import-file', 'change', { target: ids['import-file'] }));
  };
  return { ids, data, win, get, send, add, action, importFile, downloaded: () => downloaded,
    presets, reloads: () => reloadCount };
}

(async () => {
  const t = launch();
  assert.equal(t.ids['empty-state'].hidden, false);
  assert.equal(t.ids['log-empty'].hidden, false);
  t.add('<img src=x onerror=alert(1)>本', '本', '未着手', '第3章から再開する');
  assert.equal(t.get().version, 2);
  assert.equal(t.get().items.length, 1);
  assert.equal(t.ids['count-waiting'].textContent, 1);
  assert.equal(t.ids['focus-heading'].textContent, '<img src=x onerror=alert(1)>本');
  assert.equal(findAll(t.ids['item-list'], (x) => x.tagName === 'IMG').length, 0);
  assert.equal(t.get().items[0].nextStep, '第3章から再開する');
  t.add('積みゲーB', 'ゲーム');
  const old = t.ids['focus-heading'].textContent;
  t.send('focus-next', 'click');
  assert.notEqual(t.ids['focus-heading'].textContent, old);
  t.send('focus-primary', 'click');
  assert.equal(t.ids['count-active'].textContent, 1);
  assert.equal(t.ids['focus-primary'].dataset.action, 'log');
  assert.equal(t.ids['focus-complete'].hidden, false);
  t.send('focus-primary', 'click');
  assert.equal(t.ids['log-dialog'].open, true);
  assert.equal(t.ids['log-item-title'].textContent, '積みゲーB');
  t.presets[2].click();
  assert.equal(t.ids['log-minutes'].value, '30');
  t.ids['log-note'].value = '序盤を遊んだ';
  t.send('log-form', 'submit');
  assert.equal(t.get().logs.length, 1);
  assert.equal(t.get().logs[0].minutes, 30);
  assert.equal(t.ids['week-minutes'].textContent, '30分');
  assert.equal(t.ids['journal-total'].textContent, '合計 1回の記録');
  t.send('focus-primary', 'click');
  t.ids['log-minutes'].value = '0';
  t.send('log-form', 'submit');
  assert.equal(t.get().logs.length, 1);
  t.ids['log-minutes'].value = '15';
  t.ids['log-finish'].checked = true;
  t.send('log-form', 'submit');
  assert.equal(t.get().logs.length, 2);
  assert.equal(t.ids['count-done'].textContent, 1);
  assert.equal(t.ids['week-minutes'].textContent, '45分');
  assert.equal(t.ids['focus-complete'].hidden, true);
  t.action('delete-log', 'log-list');
  assert.equal(t.get().logs.length, 1);
  assert.equal(t.ids['week-minutes'].textContent, '30分');

  t.ids.search.value = '存在しない'; t.send('search', 'input');
  assert.equal(t.ids['empty-state'].hidden, false);
  assert.equal(t.ids['empty-add'].hidden, true);
  t.ids.search.value = '第3章'; t.send('search', 'input');
  assert.equal(t.ids['item-list'].children.length, 1);
  t.ids.search.value = ''; t.send('search', 'input');
  t.ids['category-filter'].value = 'ゲーム'; t.send('category-filter', 'change');
  assert.equal(t.ids['item-list'].children.length, 1);
  t.ids['category-filter'].value = 'all'; t.send('category-filter', 'change');
  t.action('edit');
  assert.equal(t.ids['item-dialog'].open, true);
  t.ids['item-name'].value = '編集済み'; t.send('item-form', 'submit');
  assert.equal(t.get().items.some((x) => x.name === '編集済み'), true);
  t.send('export', 'click');
  const saved = await t.downloaded().text();
  assert.equal(JSON.parse(saved).logs.length, 1);
  t.action('delete');
  assert.equal(t.get().items.length, 1);
  assert.equal(t.get().logs.length, 1);
  await t.importFile(saved);
  assert.equal(t.get().items.length, 2);
  assert.equal(t.get().logs.length, 1);

  const legacy = [{ id: 1001, name: '昔の本', category: '本', status: '一時中断',
    purchaseDate: '2024-11-02', notes: '昔のメモ', imageName: 'foo.jpg' }];
  const migrated = launch({ hobbyBacklogItems: JSON.stringify(legacy) });
  assert.equal(migrated.get().version, 2);
  assert.equal(migrated.get().items[0].name, '昔の本');
  assert.equal(migrated.get().items[0].notes, '昔のメモ');
  assert.equal(migrated.get().items[0].purchaseDate, '2024-11-02');
  assert.equal(migrated.get().logs.length, 0);
  assert.equal(migrated.data.get('hobbyBacklogItems'), JSON.stringify(legacy));

  const v1 = launch({ 'taskclear-mvp-v1': JSON.stringify({ version: 1,
    items: [{ id: 'A', name: '移行前のゲーム', status: '未着手' }], selectedId: 'A' }) });
  assert.equal(v1.ids['focus-heading'].textContent, '移行前のゲーム');
  assert.equal(v1.ids['log-empty'].hidden, false);
  v1.send('focus-primary', 'click');
  assert.equal(v1.get().version, 2);

  const broken = launch({ 'taskclear-mvp-v1': 'not json' });
  broken.add('安全のため保存しない');
  assert.equal(broken.data.get('taskclear-mvp-v1'), 'not json');
  assert.equal(broken.ids['storage-warning'].hidden, false);
  assert.equal(broken.ids['storage-raw-export'].hidden, false);
  assert.equal(broken.ids['storage-import-trigger'].hidden, false);
  broken.send('export', 'click');
  assert.equal(broken.downloaded(), null); // 空のバックアップを渡さない
  broken.send('storage-raw-export', 'click');
  assert.equal(await broken.downloaded().text(), 'not json');
  await broken.importFile(saved);
  assert.equal(broken.get().version, 2);
  assert.equal(broken.get().logs.length, 1);
  assert.equal(broken.ids['storage-warning'].hidden, true);

  const stale = launch();
  stale.add('別のタブの衝突を確認');
  const external = JSON.stringify({ version: 2, items: [], logs: [], selectedId: null });
  stale.data.set('taskclear-mvp-v1', external);
  stale.win.dispatch('storage', { key: 'taskclear-mvp-v1', newValue: external });
  assert.equal(stale.ids['storage-reload'].hidden, false);
  stale.add('上書きされない');
  assert.equal(stale.data.get('taskclear-mvp-v1'), external);
  stale.send('storage-reload', 'click');
  assert.equal(stale.reloads(), 1);

  const failed = launch({}, false);
  failed.add('容量超過');
  assert.equal(failed.ids['item-list'].children.length, 0);
  assert.equal(failed.ids['storage-warning'].hidden, false);

  const imports = launch();
  await imports.importFile(JSON.stringify({ version: 1, items: [
    { id: 'A', name: '本1' }, { id: 'A', name: '本2' }], selectedId: 'A' }));
  assert.equal(imports.get().items.length, 2);
  assert.notEqual(imports.get().items[0].id, imports.get().items[1].id);
  const bad = JSON.stringify({ version: 2, items: [{ name: 'OK' }], logs: [
    { id: 'L', itemId: 'Z', itemName: 'OK', date: 'not-date', minutes: 30 }] });
  await imports.importFile(bad);
  assert.equal(imports.get().items.length, 2);
  await imports.importFile(JSON.stringify({ version: 999, items: [], logs: [] }));
  assert.equal(imports.get().items.length, 2);
  const notConfirmed = launch({}, true, false);
  await notConfirmed.importFile(saved);
  assert.equal(notConfirmed.data.has('taskclear-mvp-v1'), false);

  console.log('PASS: v1.1 smoke — registration, v1/legacy migration, focus, journal, completion, invalid minutes, XSS, filtering, editing, backup and restore, corrupt-data recovery, external-tab conflict, storage failure');
})().catch((err) => { console.error(err); process.exitCode = 1; });

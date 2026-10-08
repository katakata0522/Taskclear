(() => {
  'use strict';
  const KEY = 'taskclear-mvp-v1';
  const LEGACY_KEY = 'hobbyBacklogItems';
  const CATEGORIES = ['本', 'ゲーム', 'プラモデル', 'その他'];
  const STATUSES = ['未着手', '進行中', '一時中断', '完了'];
  const MAX_ITEMS = 2000;
  const $ = (id) => document.getElementById(id);
  const collator = new Intl.Collator('ja');
  let state = { version: 1, items: [], selectedId: null };
  let editId = null;
  let query = '';
  let filterCategory = 'all';
  let filterStatus = 'all';
  let sortBy = 'recent';
  let storageBlocked = false;
  let toastTimer = null;

  function newId() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const clipped = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';
  function cleanItem(raw, seen) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const name = clipped(raw.name, 120);
    if (!name) return null;
    let id = typeof raw.id === 'string' || typeof raw.id === 'number' ? String(raw.id) : newId();
    if (!id || seen.has(id)) id = newId();
    seen.add(id);
    const validDate = typeof raw.purchaseDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.purchaseDate) && (() => { const [y, m, d] = raw.purchaseDate.split('-').map(Number); const date = new Date(Date.UTC(y, m - 1, d)); return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d; })();
    return {
      id,
      name,
      category: CATEGORIES.includes(raw.category) ? raw.category : 'その他',
      status: STATUSES.includes(raw.status) ? raw.status : '未着手',
      notes: clipped(raw.notes, 800),
      purchaseDate: validDate ? raw.purchaseDate : '',
      createdAt: Number.isFinite(raw.createdAt) && raw.createdAt > 0 ? raw.createdAt : (Number.isFinite(Number(raw.id)) && Number(raw.id) > 0 ? Number(raw.id) : Date.now()),
    };
  }
  function normalize(raw) {
    const list = Array.isArray(raw) ? raw : raw && raw.items;
    if (!Array.isArray(list) || list.length > MAX_ITEMS) throw new Error('データ形式または件数が正しくありません。');
    const seen = new Set();
    const items = list.map((entry) => cleanItem(entry, seen));
    if (items.some((item) => item === null)) throw new Error('作品名のない不正なレコードが含まれています。');
    const selectedId = raw && !Array.isArray(raw) && raw.selectedId != null ? String(raw.selectedId) : null;
    return { version: 1, items, selectedId: items.some((item) => item.id === selectedId && item.status !== '完了') ? selectedId : null };
  }
  function showWarning(message) {
    $('storage-warning').textContent = message;
    $('storage-warning').hidden = false;
  }
  function notify(message) {
    const el = $('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3300);
  }
  function load() {
    try {
      const current = localStorage.getItem(KEY);
      if (current !== null) { state = normalize(JSON.parse(current)); return; }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy !== null) {
        state = normalize(JSON.parse(legacy));
        localStorage.setItem(KEY, JSON.stringify(state)); // 旧データは消さずに移行する
        notify('以前の積みアイテムを引き継ぎました');
      }
    } catch (error) {
      storageBlocked = true;
      showWarning('保存データを読み込めませんでした。既存データの上書きを防ぐため編集を停止しています。ブラウザの保存データを確認してください。');
      console.error('Taskclear load failed', error);
    }
  }
  function commit(items, selectedId) {
    if (storageBlocked) { notify('保存データを確認するまで編集できません'); return false; }
    const next = { version: 1, items, selectedId };
    try { localStorage.setItem(KEY, JSON.stringify(next)); }
    catch (error) {
      showWarning('保存に失敗しました。ブラウザの容量・プライベートモードを確認してください。変更は反映していません。');
      console.error('Taskclear save failed', error);
      return false;
    }
    state = next;
    render();
    return true;
  }
  function candidates() { return state.items.filter((item) => item.status !== '完了'); }
  function picked() { return candidates().find((item) => item.id === state.selectedId) || candidates().slice().sort((a, b) => a.createdAt - b.createdAt)[0] || null; }
  function setStatus(id, status) {
    if (!STATUSES.includes(status)) return;
    const item = state.items.find((value) => value.id === id);
    if (!item) return;
    const items = state.items.map((value) => value.id === id ? { ...value, status } : value);
    const selection = status === '進行中' ? id : status === '完了' && state.selectedId === id ? null : state.selectedId;
    if (commit(items, selection)) notify(status === '完了' ? '楽しんだ記録が増えました！' : '状態を更新しました');
  }
  function cyclePick() {
    const available = candidates().slice().sort((a, b) => a.createdAt - b.createdAt);
    if (!available.length) return;
    const current = picked();
    const index = available.findIndex((item) => item.id === current?.id);
    const next = available[(index + 1) % available.length];
    commit(state.items, next.id);
  }
  function renderFocus() {
    const item = picked();
    const total = candidates().length;
    const content = $('focus-content');
    content.replaceChildren();
    const headingEl = document.createElement('h2');
    headingEl.id = 'focus-heading';
    const messageEl = document.createElement('p');
    let label;
    if (!state.items.length) {
      label = '今日、何から楽しもう？';
      messageEl.textContent = '最初のアイテムを登録すると、ここにおすすめが表示されます。';
    } else if (!item) {
      label = '全部、楽しみました。';
      messageEl.textContent = 'おつかれさま！ 新しい趣味ができたら、また登録しましょう。';
    } else {
      const meta = document.createElement('div');
      meta.className = 'focus-meta';
      meta.textContent = `${item.category}　/　${item.status}`;
      content.appendChild(meta);
      label = item.name;
      messageEl.textContent = item.status === '進行中' ? '続きから、楽しもう。終わったら完了を記録できます。' : '完璧な計画より、ちょっと手をつけるところから。';
    }
    headingEl.textContent = label;
    content.append(headingEl, messageEl);
    $('focus-counter').textContent = total ? `未完了 ${total}件から` : 'まずはひとつから';
    const primary = $('focus-primary');
    primary.textContent = !item ? '積みを追加する' : item.status === '進行中' ? '楽しみ終えた ✓' : 'これを始める ↗';
    primary.dataset.action = !item ? 'add' : item.status === '進行中' ? 'complete' : 'start';
    primary.dataset.id = item ? item.id : '';
    $('focus-next').hidden = total < 2;
  }
  function renderStats() {
    $('count-waiting').textContent = state.items.filter((item) => item.status === '未着手' || item.status === '一時中断').length;
    $('count-active').textContent = state.items.filter((item) => item.status === '進行中').length;
    $('count-done').textContent = state.items.filter((item) => item.status === '完了').length;
  }
  function actionButton(label, action, id, className = '', itemName = '') {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    if (itemName) button.setAttribute('aria-label', `「${itemName}」${label}`);
    button.dataset.action = action;
    button.dataset.id = id;
    if (className) button.className = className;
    return button;
  }
  function renderCards() {
    const list = $('item-list');
    list.replaceChildren();
    const selected = picked()?.id;
    const visible = state.items.filter((item) => {
      return (filterCategory === 'all' || item.category === filterCategory) &&
        (filterStatus === 'all' || item.status === filterStatus) &&
        (!query || `${item.name} ${item.notes}`.toLocaleLowerCase('ja').includes(query));
    }).sort((a, b) => sortBy === 'name' ? collator.compare(a.name, b.name) : sortBy === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
    $('result-count').textContent = `${visible.length}件を表示 / 全${state.items.length}件`;
    $('empty-state').hidden = visible.length !== 0;
    if (!visible.length) {
      const noItems = state.items.length === 0;
      $('empty-title').textContent = noItems ? 'まだアイテムがありません' : '該当するアイテムがありません';
      $('empty-message').textContent = noItems ? '気になっている本や、途中まで遊んだゲームから登録してみましょう。' : '検索や絞り込みの条件を変えてみてください。';
      $('empty-add').hidden = !noItems;
      return;
    }
    for (const item of visible) {
      const card = document.createElement('article');
      card.className = 'item-card' + (selected === item.id && item.status !== '完了' ? ' current' : '');
      const top = document.createElement('div');
      top.className = 'item-top';
      const category = document.createElement('span');
      category.className = 'item-category';
      category.textContent = item.category;
      const status = document.createElement('span');
      status.className = 'item-status' + (item.status === '進行中' ? ' active' : item.status === '完了' ? ' done' : item.status === '一時中断' ? ' paused' : '');
      status.textContent = item.status;
      top.append(category, status);
      const title = document.createElement('h3');
      title.textContent = item.name;
      card.append(top, title);
      if (item.notes) {
        const note = document.createElement('p');
        note.className = 'item-note';
        note.textContent = item.notes;
        card.appendChild(note);
      }
      if (item.purchaseDate) {
        const date = document.createElement('p');
        date.className = 'item-date';
        date.textContent = `購入日：${item.purchaseDate}`;
        card.appendChild(date);
      }
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      if (item.status !== '完了' && selected !== item.id) actions.appendChild(actionButton('今日に選ぶ', 'pick', item.id, 'item-go', item.name));
      if (item.status !== '進行中') actions.appendChild(actionButton(item.status === '完了' ? 'もう一度' : '始める', 'start', item.id, '', item.name));
      if (item.status !== '完了') actions.appendChild(actionButton('完了', 'complete', item.id, '', item.name));
      actions.appendChild(actionButton('編集', 'edit', item.id, '', item.name));
      actions.appendChild(actionButton('削除', 'delete', item.id, 'item-delete', item.name));
      card.appendChild(actions);
      list.appendChild(card);
    }
  }
  function render() { renderFocus(); renderStats(); renderCards(); }
  function openForm(item = null) {
    if (storageBlocked) { notify('保存データを確認するまで編集できません'); return; }
    editId = item ? item.id : null;
    $('item-form').reset();
    $('dialog-title').textContent = item ? '積みを編集する' : '積みを追加する';
    $('form-save').textContent = item ? '変更を保存' : '登録する';
    if (item) {
      $('item-name').value = item.name;
      $('item-category').value = item.category;
      $('item-status').value = item.status;
      $('item-date').value = item.purchaseDate;
      $('item-notes').value = item.notes;
    }
    $('item-dialog').showModal();
    $('item-name').focus();
  }
  function closeForm() { $('item-dialog').close(); editId = null; }
  function handleAction(action, id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    if (action === 'pick') { if (commit(state.items, id)) notify('今日のひとつに選びました'); return; }
    if (action === 'start') { setStatus(id, '進行中'); return; }
    if (action === 'complete') { setStatus(id, '完了'); return; }
    if (action === 'edit') { openForm(item); return; }
    if (action === 'delete' && confirm(`「${item.name}」を削除しますか？`)) {
      const next = state.items.filter((entry) => entry.id !== id);
      if (commit(next, state.selectedId === id ? null : state.selectedId)) notify('削除しました');
    }
  }
  function exportData() {
    const data = new Blob([JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(data);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `taskclear-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    notify('バックアップをダウンロードしました');
  }
  async function importData(file) {
    if (!file) return;
    if (file.size > 8_000_000) { notify('8MB以下のJSONファイルを選んでください'); return; }
    try {
      const data = normalize(JSON.parse(await file.text()));
      if (!confirm(`現在の${state.items.length}件を、ファイル内の${data.items.length}件で置き換えますか？`)) return;
      if (commit(data.items, data.selectedId)) notify(`${data.items.length}件を復元しました`);
    } catch (error) {
      notify('読み込めませんでした。タスクリアのJSONバックアップを指定してください');
      console.error('Taskclear import failed', error);
    }
  }
  function wireEvents() {
    ['add-top', 'add-inline', 'empty-add'].forEach((id) => $(id).addEventListener('click', () => openForm()));
    ['dialog-close', 'form-cancel'].forEach((id) => $(id).addEventListener('click', closeForm));
    $('item-dialog').addEventListener('click', (event) => { if (event.target === $('item-dialog')) closeForm(); });
    $('item-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = clipped($('item-name').value, 120);
      if (!name) { $('item-name').focus(); return; }
      const old = state.items.find((item) => item.id === editId);
      if (!old && state.items.length >= MAX_ITEMS) { notify('登録上限の2000件に達しています'); return; }
      const entry = {
        id: old ? old.id : newId(), name,
        category: $('item-category').value, status: $('item-status').value,
        purchaseDate: $('item-date').value, notes: clipped($('item-notes').value, 800),
        createdAt: old ? old.createdAt : Date.now()
      };
      const next = old ? state.items.map((item) => item.id === old.id ? entry : item) : [...state.items, entry];
      const selectedId = old && entry.status === '完了' && state.selectedId === old.id ? null : state.selectedId;
      if (commit(next, selectedId)) { closeForm(); notify(old ? '変更を保存しました' : '積みを追加しました'); }
    });
    $('focus-primary').addEventListener('click', (event) => {
      if (event.currentTarget.dataset.action === 'add') openForm();
      else handleAction(event.currentTarget.dataset.action, event.currentTarget.dataset.id);
    });
    $('focus-next').addEventListener('click', cyclePick);
    $('item-list').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (button) handleAction(button.dataset.action, button.dataset.id);
    });
    $('search').addEventListener('input', (event) => { query = event.target.value.trim().toLocaleLowerCase('ja'); renderCards(); });
    $('category-filter').addEventListener('change', (event) => { filterCategory = event.target.value; renderCards(); });
    $('status-filter').addEventListener('change', (event) => { filterStatus = event.target.value; renderCards(); });
    $('sort').addEventListener('change', (event) => { sortBy = event.target.value; renderCards(); });
    $('export').addEventListener('click', exportData);
    $('import-trigger').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async (event) => { const file = event.target.files?.[0]; await importData(file); event.target.value = ''; });
  }
  load();
  wireEvents();
  render();
})();

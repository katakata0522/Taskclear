(() => {
  'use strict';

  // v1のキーを維持して、旧MVPを使っていた人の内容を自動で引き継ぐ。
  const KEY = 'taskclear-mvp-v1';
  const LEGACY_KEY = 'hobbyBacklogItems';
  const CATEGORIES = ['本', 'ゲーム', 'プラモデル', 'その他'];
  const STATUSES = ['未着手', '進行中', '一時中断', '完了'];
  const MAX_ITEMS = 2000;
  const MAX_LOGS = 5000;
  const $ = (id) => document.getElementById(id);
  const collator = new Intl.Collator('ja');

  let state = { version: 2, items: [], selectedId: null, logs: [] };
  let lastSavedRaw = null;
  let rawRecovery = null;
  let storageBlocked = false;
  let editId = null;
  let logItemId = null;
  let query = '';
  let filterCategory = 'all';
  let filterStatus = 'all';
  let sortBy = 'recent';
  let visibleLogCount = 5;
  let toastTimer;

  function newId() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  const clipped = (value, length) => typeof value === 'string' ? value.trim().slice(0, length) : '';
  function validDate(text) {
    if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const [year, month, day] = text.split('-').map(Number);
    const result = new Date(Date.UTC(year, month - 1, day));
    return result.getUTCFullYear() === year && result.getUTCMonth() + 1 === month && result.getUTCDate() === day;
  }
  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function normalizedId(value, seen) {
    let id = (typeof value === 'string' || typeof value === 'number') ? String(value) : '';
    if (!id || seen.has(id)) {
      do { id = newId(); } while (seen.has(id));
    }
    seen.add(id);
    return id;
  }
  function cleanItem(raw, seen) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const name = clipped(raw.name, 120);
    if (!name) return null;
    return {
      id: normalizedId(raw.id, seen),
      name,
      category: CATEGORIES.includes(raw.category) ? raw.category : 'その他',
      status: STATUSES.includes(raw.status) ? raw.status : '未着手',
      notes: clipped(raw.notes, 800),
      nextStep: clipped(raw.nextStep, 120),
      purchaseDate: validDate(raw.purchaseDate) ? raw.purchaseDate : '',
      createdAt: Number.isFinite(raw.createdAt) && raw.createdAt > 0 ? raw.createdAt :
        (Number.isFinite(Number(raw.id)) && Number(raw.id) > 0 ? Number(raw.id) : Date.now()),
    };
  }
  function cleanLog(raw, seen) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (typeof raw.itemId !== 'string' && typeof raw.itemId !== 'number') return null;
    if (!validDate(raw.date) || !Number.isInteger(raw.minutes) || raw.minutes < 1 || raw.minutes > 600) return null;
    if (typeof raw.itemName !== 'string' || !raw.itemName.trim()) return null;
    return {
      id: normalizedId(raw.id, seen),
      itemId: String(raw.itemId),
      itemName: clipped(raw.itemName, 120),
      minutes: raw.minutes,
      date: raw.date,
      note: clipped(raw.note, 200),
      createdAt: Number.isFinite(raw.createdAt) && raw.createdAt > 0 ? raw.createdAt : Date.now(),
    };
  }
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('データの形式が違います');
    if (!Array.isArray(raw) && raw.version != null && raw.version !== 1 && raw.version !== 2) {
      throw new Error('未対応のデータバージョンです');
    }
    const list = Array.isArray(raw) ? raw : raw.items;
    if (!Array.isArray(list) || list.length > MAX_ITEMS) throw new Error('アイテム数・形式が正しくありません');
    const seenItems = new Set();
    const items = list.map((entry) => cleanItem(entry, seenItems));
    if (items.some((item) => !item)) throw new Error('アイテムの内容が正しくありません');
    const rawLogs = Array.isArray(raw) || raw.logs == null ? [] : raw.logs;
    if (!Array.isArray(rawLogs) || rawLogs.length > MAX_LOGS) throw new Error('趣味ログの件数・形式が正しくありません');
    const seenLogs = new Set();
    const logs = rawLogs.map((entry) => cleanLog(entry, seenLogs));
    if (logs.some((entry) => !entry)) throw new Error('趣味ログの内容が正しくありません');
    const selectedId = !Array.isArray(raw) && raw.selectedId != null ? String(raw.selectedId) : null;
    return {
      version: 2, items, logs,
      selectedId: items.some((item) => item.id === selectedId && item.status !== '完了') ? selectedId : null,
    };
  }

  function warning(message, recovery = false, reload = false) {
    $('storage-warning-message').textContent = message;
    $('storage-warning').hidden = false;
    $('storage-raw-export').hidden = !recovery;
    $('storage-import-trigger').hidden = !recovery;
    $('storage-reload').hidden = !reload;
  }
  function clearWarning() {
    $('storage-warning').hidden = true;
    $('storage-raw-export').hidden = true;
    $('storage-import-trigger').hidden = true;
    $('storage-reload').hidden = true;
  }
  function notify(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 3300);
  }
  function load() {
    let source = KEY;
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
      lastSavedRaw = raw;
      if (raw !== null) { state = normalize(JSON.parse(raw)); return; }
      source = LEGACY_KEY;
      raw = localStorage.getItem(LEGACY_KEY);
      if (raw !== null) {
        const migrated = normalize(JSON.parse(raw));
        const encoded = JSON.stringify(migrated);
        localStorage.setItem(KEY, encoded); // 旧データはそのまま残す
        state = migrated;
        lastSavedRaw = encoded;
        notify('以前の積みアイテムを引き継ぎました');
      }
    } catch (error) {
      rawRecovery = raw === null ? null : { source, raw };
      storageBlocked = true;
      warning('保存データの読み込みに失敗しました。既存データを上書きしないため編集を停止しています。原本を退避してから、正常なJSONバックアップで復元できます。', Boolean(rawRecovery));
      console.error('Taskclear load failed', error);
    }
  }
  function commit(items, selectedId, logs = state.logs, forceRestore = false) {
    if (storageBlocked && !forceRestore) { notify('保存データの安全を確認するまで編集できません'); return false; }
    const next = { version: 2, items, selectedId, logs };
    const encoded = JSON.stringify(next);
    try {
      const saved = localStorage.getItem(KEY);
      if (!forceRestore && saved !== lastSavedRaw) {
        warning('別のタブでデータが変わりました。上書きを避けるため保存していません。最新データを読み直してください。', false, true);
        return false;
      }
      localStorage.setItem(KEY, encoded);
    } catch (error) {
      warning('保存に失敗しました。容量・プライベートモードを確認してください。変更は反映していません。');
      console.error('Taskclear save failed', error);
      return false;
    }
    state = next;
    lastSavedRaw = encoded;
    storageBlocked = false;
    rawRecovery = null;
    clearWarning();
    render();
    return true;
  }

  function candidates() { return state.items.filter((item) => item.status !== '完了'); }
  function picked() {
    const list = candidates();
    return list.find((item) => item.id === state.selectedId) ||
      list.slice().sort((a, b) => a.createdAt - b.createdAt)[0] || null;
  }
  function setStatus(id, status) {
    if (!STATUSES.includes(status)) return;
    const original = state.items.find((item) => item.id === id);
    if (!original) return;
    const items = state.items.map((item) => item.id === id ? { ...item, status } : item);
    const selectedId = status === '進行中' ? id : status === '完了' && state.selectedId === id ? null : state.selectedId;
    if (commit(items, selectedId)) notify(status === '完了' ? 'おつかれさま！ 完了を記録しました' : '状態を更新しました');
  }
  function cyclePick() {
    const items = candidates().slice().sort((a, b) => a.createdAt - b.createdAt);
    if (items.length < 2) return;
    const index = items.findIndex((item) => item.id === picked()?.id);
    commit(state.items, items[(index + 1) % items.length].id);
  }

  function renderFocus() {
    const item = picked();
    const total = candidates().length;
    const content = $('focus-content');
    content.replaceChildren();
    const title = document.createElement('h2');
    title.id = 'focus-heading';
    const message = document.createElement('p');
    if (!state.items.length) {
      title.textContent = '今日、何から楽しもう？';
      message.textContent = '最初のアイテムを登録すると、ここにおすすめが表示されます。';
    } else if (!item) {
      title.textContent = '全部、楽しみました。';
      message.textContent = 'おつかれさま！ 新しい趣味ができたら、また登録しましょう。';
    } else {
      const meta = document.createElement('div');
      meta.className = 'focus-meta';
      meta.textContent = `${item.category}　/　${item.status}`;
      content.append(meta);
      title.textContent = item.name;
      message.textContent = item.status === '進行中' ? '少し楽しんだら、その時間とメモを残そう。' : '完璧な計画より、少し手をつけるところから。';
    }
    content.append(title, message);
    if (item?.nextStep) {
      const step = document.createElement('p');
      step.className = 'focus-next-step';
      step.textContent = `次にやること：${item.nextStep}`;
      content.appendChild(step);
    }
    $('focus-counter').textContent = total ? `未完了 ${total}件から` : 'まずはひとつから';
    const primary = $('focus-primary');
    primary.textContent = !item ? '積みを追加する' : item.status === '進行中' ? '楽しんだ時間を記録 ＋' : 'これを始める ↗';
    primary.dataset.action = !item ? 'add' : item.status === '進行中' ? 'log' : 'start';
    primary.dataset.id = item ? item.id : '';
    const complete = $('focus-complete');
    complete.hidden = !item || item.status !== '進行中';
    complete.dataset.id = item ? item.id : '';
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
    button.className = className;
    return button;
  }
  function renderCards() {
    const list = $('item-list');
    list.replaceChildren();
    const selected = picked()?.id;
    const minutes = new Map();
    for (const log of state.logs) minutes.set(log.itemId, (minutes.get(log.itemId) || 0) + log.minutes);
    const visible = state.items.filter((item) =>
      (filterCategory === 'all' || item.category === filterCategory) &&
      (filterStatus === 'all' || item.status === filterStatus) &&
      (!query || `${item.name} ${item.notes} ${item.nextStep}`.toLocaleLowerCase('ja').includes(query))
    ).sort((a, b) => sortBy === 'name' ? collator.compare(a.name, b.name) : sortBy === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt);
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
      if (item.nextStep) {
        const step = document.createElement('p');
        step.className = 'item-next-step';
        step.textContent = `次：${item.nextStep}`;
        card.append(step);
      }
      if (item.notes) {
        const note = document.createElement('p');
        note.className = 'item-note';
        note.textContent = item.notes;
        card.append(note);
      }
      if (item.purchaseDate || minutes.has(item.id)) {
        const meta = document.createElement('p');
        meta.className = 'item-date';
        meta.textContent = [item.purchaseDate && `購入：${item.purchaseDate}`, minutes.has(item.id) && `記録：${minutes.get(item.id)}分`].filter(Boolean).join(' · ');
        card.append(meta);
      }
      const actions = document.createElement('div');
      actions.className = 'item-actions';
      if (item.status !== '完了' && selected !== item.id) actions.append(actionButton('今日に選ぶ', 'pick', item.id, 'item-go', item.name));
      if (item.status === '進行中') actions.append(actionButton('時間を記録', 'log', item.id, 'item-go', item.name));
      else actions.append(actionButton(item.status === '完了' ? 'もう一度' : '始める', 'start', item.id, '', item.name));
      if (item.status !== '完了') actions.append(actionButton('完了', 'complete', item.id, '', item.name));
      actions.append(actionButton('編集', 'edit', item.id, '', item.name));
      actions.append(actionButton('削除', 'delete', item.id, 'item-delete', item.name));
      card.append(actions);
      list.append(card);
    }
  }
  function renderJournal() {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const weekStart = localDate(start);
    const todayKey = localDate(today);
    const weekMinutes = state.logs.filter((log) => log.date >= weekStart && log.date <= todayKey).reduce((sum, log) => sum + log.minutes, 0);
    $('week-minutes').textContent = `${weekMinutes}分`;
    $('journal-total').textContent = `合計 ${state.logs.length}回の記録`;
    $('log-empty').hidden = state.logs.length !== 0;
    const list = $('log-list');
    list.replaceChildren();
    const sorted = state.logs.slice().reverse().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    for (const log of sorted.slice(0, visibleLogCount)) {
      const row = document.createElement('li');
      const body = document.createElement('div');
      body.className = 'log-description';
      const title = document.createElement('strong');
      title.textContent = state.items.find((item) => item.id === log.itemId)?.name || log.itemName;
      const meta = document.createElement('span');
      meta.className = 'log-meta';
      meta.textContent = `${log.date} · ${log.minutes}分`;
      body.append(title, meta);
      if (log.note) {
        const note = document.createElement('p');
        note.textContent = log.note;
        body.append(note);
      }
      const remove = actionButton('削除', 'delete-log', log.id, 'log-remove', title.textContent);
      row.append(body, remove);
      list.append(row);
    }
    $('logs-more').hidden = sorted.length <= visibleLogCount;
    $('logs-more').textContent = `前の記録も見る（残り ${Math.max(0, sorted.length - visibleLogCount)} 件）`;
  }
  function render() { renderFocus(); renderStats(); renderJournal(); renderCards(); }

  function openForm(item = null) {
    if (storageBlocked) { notify('保存データの安全を確認するまで編集できません'); return; }
    editId = item ? item.id : null;
    $('item-form').reset();
    $('dialog-title').textContent = item ? '積みを編集する' : '積みを追加する';
    $('form-save').textContent = item ? '変更を保存' : '登録する';
    if (item) {
      $('item-name').value = item.name;
      $('item-category').value = item.category;
      $('item-status').value = item.status;
      $('item-date').value = item.purchaseDate;
      $('item-next').value = item.nextStep;
      $('item-notes').value = item.notes;
    }
    $('item-dialog').showModal();
    $('item-name').focus();
  }
  function closeForm() { $('item-dialog').close(); editId = null; }
  function openLog(item) {
    if (storageBlocked) { notify('保存データの安全を確認するまで編集できません'); return; }
    if (!item || item.status === '完了') return;
    logItemId = item.id;
    $('log-form').reset();
    $('log-minutes').value = '15';
    $('log-date').value = localDate(new Date());
    $('log-date').max = localDate(new Date());
    $('log-finish').checked = false;
    $('log-item-title').textContent = item.name;
    $('log-dialog').showModal();
    $('log-minutes').focus();
  }
  function closeLog() { $('log-dialog').close(); logItemId = null; }
  function handleAction(action, id) {
    if (action === 'delete-log') {
      const log = state.logs.find((entry) => entry.id === id);
      if (log && confirm(`${log.date} の ${log.minutes}分の記録を削除しますか？`)) {
        if (commit(state.items, state.selectedId, state.logs.filter((entry) => entry.id !== id))) notify('記録を削除しました');
      }
      return;
    }
    const item = state.items.find((entry) => entry.id === id);
    if (!item) return;
    if (action === 'pick') { if (commit(state.items, id)) notify('今日のひとつに選びました'); return; }
    if (action === 'start') { setStatus(id, '進行中'); return; }
    if (action === 'complete') { setStatus(id, '完了'); return; }
    if (action === 'log') { openLog(item); return; }
    if (action === 'edit') { openForm(item); return; }
    if (action === 'delete' && confirm(`「${item.name}」を削除しますか？ アイテムは消えますが、過去の趣味ログは残ります。`)) {
      const next = state.items.filter((entry) => entry.id !== id);
      if (commit(next, state.selectedId === id ? null : state.selectedId)) notify('アイテムを削除しました（記録は残っています）');
    }
  }

  function downloadData(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
  }
  function exportData() {
    if (storageBlocked) { notify('正常なバックアップは作成できません。元データの退避を利用してください'); return; }
    try {
      downloadData(JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2),
        `taskclear-backup-${localDate(new Date())}.json`, 'application/json;charset=utf-8');
      notify('バックアップを保存しました');
    } catch (error) { notify('書き出しに失敗しました'); console.error('Taskclear export failed', error); }
  }
  function exportRaw() {
    if (!rawRecovery) return;
    try {
      downloadData(rawRecovery.raw, `taskclear-unreadable-${rawRecovery.source}-${localDate(new Date())}.txt`, 'text/plain;charset=utf-8');
      notify('元データを退避しました。内容を確認してから復元してください');
    } catch (error) { notify('原本の書き出しに失敗しました'); console.error('Taskclear raw export failed', error); }
  }
  async function importData(file) {
    if (!file) return;
    if (file.size > 8_000_000) { notify('8MB以下のJSONファイルを選んでください'); return; }
    try {
      const data = normalize(JSON.parse(await file.text()));
      const warningText = storageBlocked ? '現在の読み取れないデータも上書きされます。原本を退避済みですか？' : '';
      if (!confirm(`現在の${state.items.length}件を、ファイル内の${data.items.length}件・記録${data.logs.length}件で置き換えますか？\n${warningText}`)) return;
      if (commit(data.items, data.selectedId, data.logs, storageBlocked)) {
        visibleLogCount = 5;
        notify(`${data.items.length}件と趣味ログ${data.logs.length}件を復元しました`);
      }
    } catch (error) {
      notify('読み込めませんでした。タスクリアのJSONバックアップを指定してください');
      console.error('Taskclear import failed', error);
    }
  }

  function wireEvents() {
    ['add-top', 'add-inline', 'empty-add'].forEach((id) => $(id).addEventListener('click', () => openForm()));
    ['dialog-close', 'form-cancel'].forEach((id) => $(id).addEventListener('click', closeForm));
    ['log-close', 'log-cancel'].forEach((id) => $(id).addEventListener('click', closeLog));
    $('item-dialog').addEventListener('click', (event) => { if (event.target === $('item-dialog')) closeForm(); });
    $('log-dialog').addEventListener('click', (event) => { if (event.target === $('log-dialog')) closeLog(); });
    $('item-dialog').addEventListener('close', () => { editId = null; });
    $('log-dialog').addEventListener('close', () => { logItemId = null; });
    $('item-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = clipped($('item-name').value, 120);
      if (!name) { $('item-name').focus(); return; }
      const old = state.items.find((item) => item.id === editId);
      if (!old && state.items.length >= MAX_ITEMS) { notify('登録上限の2000件に達しています'); return; }
      const entry = {
        id: old ? old.id : newId(), name,
        category: CATEGORIES.includes($('item-category').value) ? $('item-category').value : 'その他',
        status: STATUSES.includes($('item-status').value) ? $('item-status').value : '未着手',
        purchaseDate: validDate($('item-date').value) ? $('item-date').value : '',
        nextStep: clipped($('item-next').value, 120),
        notes: clipped($('item-notes').value, 800),
        createdAt: old ? old.createdAt : Date.now(),
      };
      const items = old ? state.items.map((item) => item.id === old.id ? entry : item) : [...state.items, entry];
      const selectedId = old && entry.status === '完了' && state.selectedId === old.id ? null : state.selectedId;
      if (commit(items, selectedId)) { closeForm(); notify(old ? '変更を保存しました' : '積みを追加しました'); }
    });
    $('log-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const item = state.items.find((entry) => entry.id === logItemId);
      if (!item || item.status === '完了') { notify('記録する作品を選び直してください'); return; }
      if (state.logs.length >= MAX_LOGS) { notify('趣味ログの上限5000件に達しています。JSONバックアップを保存してください'); return; }
      const minutes = Number($('log-minutes').value);
      const date = $('log-date').value;
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600 || !validDate(date) || date > localDate(new Date())) {
        notify('時間は1～600分、日付は今日以前の正しい日を入力してください');
        return;
      }
      const finish = $('log-finish').checked;
      const log = { id: newId(), itemId: item.id, itemName: item.name, minutes, date,
        note: clipped($('log-note').value, 200), createdAt: Date.now() };
      const items = state.items.map((entry) => entry.id === item.id ? { ...entry, status: finish ? '完了' : '進行中' } : entry);
      if (commit(items, finish ? (state.selectedId === item.id ? null : state.selectedId) : item.id,
        [...state.logs, log])) {
        closeLog();
        notify(finish ? '楽しんだ時間と完了を記録しました' : `${minutes}分の趣味時間を記録しました`);
      }
    });
    $('focus-primary').addEventListener('click', (event) => {
      if (event.currentTarget.dataset.action === 'add') openForm();
      else handleAction(event.currentTarget.dataset.action, event.currentTarget.dataset.id);
    });
    $('focus-complete').addEventListener('click', () => {
      const id = $('focus-complete').dataset.id;
      const item = state.items.find((entry) => entry.id === id);
      if (item && confirm(`「${item.name}」を完了にしますか？`)) setStatus(id, '完了');
    });
    $('focus-next').addEventListener('click', cyclePick);
    $('item-list').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (button) handleAction(button.dataset.action, button.dataset.id);
    });
    $('log-list').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (button) handleAction(button.dataset.action, button.dataset.id);
    });
    $('logs-more').addEventListener('click', () => { visibleLogCount += 10; renderJournal(); });
    for (const button of document.querySelectorAll('[data-minutes]')) {
      button.addEventListener('click', () => { $('log-minutes').value = button.dataset.minutes; $('log-minutes').focus(); });
    }
    $('search').addEventListener('input', (event) => { query = event.target.value.trim().toLocaleLowerCase('ja'); renderCards(); });
    $('category-filter').addEventListener('change', (event) => { filterCategory = event.target.value; renderCards(); });
    $('status-filter').addEventListener('change', (event) => { filterStatus = event.target.value; renderCards(); });
    $('sort').addEventListener('change', (event) => { sortBy = event.target.value; renderCards(); });
    $('export').addEventListener('click', exportData);
    $('storage-raw-export').addEventListener('click', exportRaw);
    $('storage-import-trigger').addEventListener('click', () => $('import-file').click());
    $('storage-reload').addEventListener('click', () => location.reload());
    $('import-trigger').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      await importData(file);
      event.target.value = '';
    });
    if (typeof window !== 'undefined') window.addEventListener('storage', (event) => {
      if (event.key === KEY && event.newValue !== lastSavedRaw) {
        warning('別のタブでデータが更新されました。上書きせず、最新データを読み直してください。', false, true);
      }
    });
  }

  load();
  wireEvents();
  render();
})();

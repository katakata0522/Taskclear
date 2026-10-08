const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(__dirname + '/../script.js', 'utf8');
class Element {
  constructor(tag = 'div', document) { this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; this.hidden = false; this.textContent = ''; this.id = ''; this.open = false; this.style = {}; this.attributes = {}; this.files = []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...items) { for (const item of items) this.appendChild(item); }
  appendChild(item) { this.children.push(item); if (item && item.id) this.ownerDocument.ids[item.id] = item; return item; }
  remove() { }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  addEventListener(type, cb) { (this.listeners[type] ||= []).push(cb); }
  dispatch(type, fields = {}) { for (const cb of this.listeners[type] || []) cb({ preventDefault() {}, currentTarget: this, target: this, ...fields }); }
  click() { this.dispatch('click'); }
  focus() {}
  reset() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  closest(selector) { return selector === 'button[data-action]' && this.dataset.action ? this : null; }
}
function launch(initial = {}, canSave = true) {
  const ids = {};
  const doc = {ids, createElement: tag => new Element(tag, doc), getElementById: id => ids[id], body: null};
  doc.body = doc.createElement('body');
  for(const id of ['storage-warning','toast','focus-heading','focus-content','focus-counter','focus-primary','focus-next','count-waiting','count-active','count-done','item-list','result-count','empty-state','empty-title','empty-message','empty-add','item-dialog','item-form','dialog-title','form-save','item-name','item-category','item-status','item-date','item-notes','add-top','add-inline','dialog-close','form-cancel','search','category-filter','status-filter','sort','export','import-trigger','import-file']) ids[id] = new Element('div', doc);
  const data = new Map(Object.entries(initial));
  let download = null;
  const storage = { getItem:k=>data.has(k)?data.get(k):null, setItem:(k,v)=>{if(!canSave)throw new Error('QuotaExceeded'); data.set(k,v);}, removeItem:k=>data.delete(k) };
  const ctx = { document:doc, localStorage:storage, crypto:{randomUUID: (()=>{let i=0;return()=>String(++i);})()}, Intl, Date, Math, console, Blob, URL:{createObjectURL:b=>{download=b;return'blob:test';},revokeObjectURL:()=>{}}, setTimeout:()=>1,clearTimeout:()=>{},confirm:()=>true };
  vm.runInNewContext(source, ctx);
  const get=()=>JSON.parse(data.get('taskclear-mvp-v1'));
  const send=(id,type,fields={})=>ids[id].dispatch(type,fields);
  const add=(name,category='本',status='未着手')=>{
    send('add-inline','click');ids['item-name'].value=name;ids['item-category'].value=category;ids['item-status'].value=status;
    ids['item-date'].value='';ids['item-notes'].value='';send('item-form','submit');
  };
  const action=(name)=>{const btn = findAll(ids['item-list'], x=>x.dataset?.action===name)[0];assert(btn,`missing action ${name}`);send('item-list','click',{target:btn});};
  return {ids,data,get,send,add,action,download:()=>download};
}
function findAll(el, filter) { let r=[]; for(const child of el.children) { if(filter(child)) r.push(child);r.push(...findAll(child,filter)); }return r; }

(async()=>{
  const t=launch();
  assert.equal(t.ids['empty-state'].hidden,false);
  t.add('<img src=x onerror=alert(1)>本');
  assert.equal(t.get().items.length,1);
  assert.equal(t.ids['count-waiting'].textContent,1);
  assert.equal(t.ids['focus-heading'].textContent,'<img src=x onerror=alert(1)>本');
  assert.equal(findAll(t.ids['item-list'],x=>x.tagName==='IMG').length,0);
  t.add('積みゲーB','ゲーム');
  assert.equal(t.get().items.length,2);
  const old=t.ids['focus-heading'].textContent;
  t.send('focus-next','click');
  assert.notEqual(t.ids['focus-heading'].textContent,old);
  t.send('focus-primary','click');
  assert.equal(t.ids['count-active'].textContent,1);
  t.send('focus-primary','click');
  assert.equal(t.ids['count-done'].textContent,1);
  t.ids.search.value='存在しない';t.send('search','input');
  assert.equal(t.ids['empty-state'].hidden,false);assert.equal(t.ids['empty-add'].hidden,true);
  t.ids.search.value='';t.send('search','input');
  t.ids['category-filter'].value='ゲーム';t.send('category-filter','change');
  assert.equal(t.ids['item-list'].children.length,1);
  t.ids['category-filter'].value='all';t.send('category-filter','change');
  t.action('edit');
  assert.equal(t.ids['item-dialog'].open,true);
  t.ids['item-name'].value='編集済み';t.send('item-form','submit');
  assert.equal(t.get().items.some(x=>x.name==='編集済み'),true);
  t.send('export','click');
  assert.equal(JSON.parse(await t.download().text()).items.length,2);
  t.action('delete');assert.equal(t.get().items.length,1);
  assert.equal(t.get().selectedId===null || typeof t.get().selectedId==='string',true);

  const legacy=[{id:1001,name:'昔の本',category:'本',status:'一時中断',purchaseDate:'2024-11-02',notes:'見えなくなるべきではない',imageName:'foo.jpg'}];
  const m=launch({hobbyBacklogItems:JSON.stringify(legacy)});
  assert.equal(m.get().items[0].name,'昔の本');assert.equal(m.get().items[0].notes,legacy[0].notes);
  assert.equal(m.get().items[0].purchaseDate,legacy[0].purchaseDate);
  assert.equal(m.data.get('hobbyBacklogItems'),JSON.stringify(legacy));

  const broken=launch({'taskclear-mvp-v1':'not json'});
  broken.add('安全のため保存しない');
  assert.equal(broken.data.get('taskclear-mvp-v1'),'not json');
  assert.equal(broken.ids['storage-warning'].hidden,false);
  const failed=launch({},false);
  failed.add('容量失敗');
  assert.equal(failed.ids['item-list'].children.length,0);

  const imports=launch();
  const f={size:100,text:async()=>JSON.stringify({version:1,items:[{id:'A',name:'本1'},{id:'A',name:'本2'}],selectedId:'A'})};
  imports.ids['import-file'].files=[f];
  await Promise.all(imports.ids['import-file'].listeners.change.map(cb=>cb({target:imports.ids['import-file']})));
  assert.equal(imports.get().items.length,2);
  assert.notEqual(imports.get().items[0].id,imports.get().items[1].id);
  const bad={size:100,text:async()=>JSON.stringify({items:[{id:'1',name:'valid'},{id:'2',name:''}]})};
  imports.ids['import-file'].files=[bad];
  await Promise.all(imports.ids['import-file'].listeners.change.map(cb=>cb({target:imports.ids['import-file']})));
  assert.equal(imports.get().items.length,2);
  console.log('PASS: 21 assertions covering create, focus, status, filter, edit, delete, XSS, export, import, duplicate IDs, legacy, corrupt data, quota');
})().catch(err=>{console.error(err);process.exitCode=1;});

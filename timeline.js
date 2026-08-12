// Autosize helper and app element references (no file attachments)
const timeline = document.getElementById('timeline');
const signInBtn = document.getElementById('signInBtn');
const resetPosBtn = document.getElementById('resetPosBtn');
const signOutBtn = document.getElementById('signOutBtn');
const userInfo = document.getElementById('userInfo');
let zIndexCounter = 1000;
const STORAGE_KEY = 'timelineEntries_v1'; // legacy localStorage key (migrated)

const CATEGORY_KEYS = ['c1','c2','c3'];
const DEFAULT_TITLES = { c1: 'カテゴリ1', c2: 'カテゴリ2', c3: 'カテゴリ3' };

function autosize(el){
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// IndexedDB helpers
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open('timeline-db', 2);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains('entries')){
        db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      }
      if(!db.objectStoreNames.contains('outbox')){
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      }
      if(!db.objectStoreNames.contains('categories')){
        const s = db.createObjectStore('categories', { keyPath: 'id' });
        // seed default titles
        s.add({ id: 'cats', titles: DEFAULT_TITLES });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

async function addEntryToIDB(entry){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(['entries','outbox'], 'readwrite');
    const entriesStore = tx.objectStore('entries');
    const outboxStore = tx.objectStore('outbox');
    if(!entry.category) entry.category = 'c1';
    const addReq = entriesStore.add(entry);
    addReq.onsuccess = (ev)=>{
      const id = ev.target.result;
      // Put a lightweight outbox record pointing to this entry for sync
      outboxStore.add({ entryId: id, ts: entry.ts, text: entry.text, category: entry.category });
    };
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
  });
}

async function getAllEntriesFromIDB(){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction('entries', 'readonly');
    const store = tx.objectStore('entries');
    const req = store.getAll();
    req.onsuccess = ()=>{
      let arr = req.result || [];
      // normalize category defaults and ensure stable tmp keys
      arr = arr.map(e=>{
        if(!e.category) e.category = 'c1';
        if(e.id === undefined || e.id === null){
          if(!e._tmpKey) e._tmpKey = 'tmp:' + Date.now() + ':' + Math.random();
        }
        return e;
      });
      // sort by ts desc
      arr.sort((a,b)=> b.ts.localeCompare(a.ts));
      resolve(arr);
    };
    req.onerror = ()=> reject(req.error);
  });
}

async function getCategoryTitlesFromIDB(){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction('categories', 'readonly');
    const store = tx.objectStore('categories');
    const req = store.get('cats');
    req.onsuccess = ()=>{
      resolve((req.result && req.result.titles) ? req.result.titles : DEFAULT_TITLES);
    };
    req.onerror = ()=> reject(req.error);
  });
}

async function saveCategoryTitlesToIDB(titles){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction('categories', 'readwrite');
    const store = tx.objectStore('categories');
    store.put({ id: 'cats', titles });
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

async function clearOutbox(){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction('outbox', 'readwrite');
    const store = tx.objectStore('outbox');
    const req = store.clear();
    req.onsuccess = ()=> resolve();
    req.onerror = ()=> reject(req.error);
  });
}

async function getOutboxEntries(){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction('outbox', 'readonly');
    const store = tx.objectStore('outbox');
    const req = store.getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}

// Migrate legacy localStorage entries to IDB (if present). This runs once if localStorage has data.
async function migrateLocalStorageToIDB(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const entries = JSON.parse(raw || '[]');
    if(!entries.length) return;
    for(const e of entries.reverse()){ // oldest first
      const entry = { text: e.text || '', ts: e.ts || new Date().toISOString(), category: 'c1' };
      if(e.imageData){
        // imageData previously stored as dataURL; convert to Blob
        try{
          const resp = await fetch(e.imageData);
          const blob = await resp.blob();
          entry.imageBlob = blob;
        }catch(err){
          console.warn('Failed to migrate image dataURL', err);
        }
      }
      await addEntryToIDB(entry);
    }
    localStorage.removeItem(STORAGE_KEY);
  }catch(err){ console.error('Migration failed', err); }
}



function createColumnDOM(catKey){
  const col = document.createElement('div');
  col.className = 'timeline-column';
  const headerRow = document.createElement('div');
  headerRow.className = 'title-row';

  const header = document.createElement('h3');
  header.className = 'timeline-title';
  header.dataset.key = catKey;
  header.contentEditable = 'true';
  header.spellcheck = false;

  // Drag handle (left of title) to avoid interfering with title editing
  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.setAttribute('aria-label', 'ドラッグして移動');
  dragHandle.title = 'ドラッグして移動';
  dragHandle.innerHTML = '\u2630'; // simple hamburger glyph

  // Confirm button to explicitly save title changes
  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'title-confirm';
  confirmBtn.type = 'button';
  confirmBtn.textContent = '確定';
  confirmBtn.style.display = 'none';

  // Show confirm when editing begins
  header.addEventListener('focus', ()=>{ confirmBtn.style.display = ''; });
  header.addEventListener('input', ()=>{ confirmBtn.style.display = ''; });
  // Hide confirm shortly after blur (allow click)
  header.addEventListener('blur', ()=>{ setTimeout(()=>{ if(document.activeElement !== confirmBtn) confirmBtn.style.display = 'none'; }, 200); });

  confirmBtn.addEventListener('click', async ()=>{
    const newTitle = header.textContent.trim() || DEFAULT_TITLES[catKey];
    header.textContent = newTitle;
    // save locally
    try{
      const titles = await getCategoryTitlesFromIDB();
      titles[catKey] = newTitle;
      await saveCategoryTitlesToIDB(titles);
    }catch(err){ console.warn('Failed to save category titles to IDB', err); }
    // save to Firestore (if signed in)
    if(currentUser && window._fb && window._fb.db){
      try{
        await window._fb.db.collection('users').doc(currentUser.uid).set({ categories: await getCategoryTitlesFromIDB() }, { merge: true });
      }catch(err){ console.warn('Failed to sync category titles to Firestore', err); alert('Firebaseへの保存に失敗しました: ' + (err && err.message ? err.message : '')); }
    }
    confirmBtn.style.display = 'none';
  });

  // insert drag handle before header so user drags handle, not title
  headerRow.appendChild(dragHandle);
  headerRow.appendChild(header);
  headerRow.appendChild(confirmBtn);
  col.appendChild(headerRow);

  // per-category input form (textarea + send button)
  const form = document.createElement('form');
  form.className = 'column-form';
  form.innerHTML = `
    <div class="input-row">
      <textarea class="autosize column-text" placeholder="このカテゴリに追加..." rows="1"></textarea>
      <div class="right-controls"><button class="sendBtn" type="submit">送信</button></div>
    </div>
  `;
  const textareaEl = form.querySelector('.column-text');
  textareaEl.addEventListener('input', ()=> autosize(textareaEl));
  // Ctrl+Enter or Cmd+Enter to submit from the textarea
  textareaEl.addEventListener('keydown', (ev)=>{
    if((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter'){
      ev.preventDefault();
      if(typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', {cancelable:true}));
    }
  });
  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const txt = textareaEl.value.trim();
    if(!txt) return;
    const entry = { text: txt, ts: new Date().toISOString(), category: catKey };
    if(currentUser && window._fb && window._fb.db){
      try{
        await window._fb.db.collection('users').doc(currentUser.uid).collection('entries').add({ text: entry.text, ts: entry.ts, category: entry.category });
      }catch(err){
        console.error('Failed to save to Firestore, falling back to IDB', err);
        alert('Firebaseへの保存に失敗しました。ローカルに保存します。エラー: ' + (err && err.message ? err.message : String(err)));
        await addEntryToIDB(entry);
        await render();
      }
    }else{
      try{ await addEntryToIDB(entry); }catch(err){ console.error('Failed to save to IDB', err); }
    }
    textareaEl.value = '';
    autosize(textareaEl);
    if(!currentUser) render();
  });
  col.appendChild(form);

  const list = document.createElement('div');
  list.className = 'column-list';
  list.dataset.key = catKey;
  col.appendChild(list);
  return col;
}

function initCategoryUI(titles){
  timeline.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'timeline-columns';
  for(const k of CATEGORY_KEYS){
    const col = createColumnDOM(k);
    col.querySelector('.timeline-title').textContent = titles && titles[k] ? titles[k] : DEFAULT_TITLES[k];
    container.appendChild(col);
  }
  timeline.appendChild(container);

  // Setup drag & drop positioning for desktop. JS computes pixel positions and enables dragging.
  const applyInitialPositions = ()=>{
    const cols = Array.from(container.querySelectorAll('.timeline-column'));
    if(window.innerWidth < 900){
      // revert to flow layout on small screens
      cols.forEach(c=>{
        c.style.position = '';
        c.style.left = '';
        c.style.top = '';
        c.style.width = '';
        c.style.zIndex = '';
        c.classList.remove('draggable');
      });
      return;
    }
    const cw = Math.max(container.clientWidth, timeline.clientWidth);
    const padding = 20;
    const colWidth = Math.min(360, Math.max(240, Math.floor((cw - padding*4)/3)));
    cols.forEach((col,i)=>{
      col.style.width = colWidth + 'px';
      let x = 0, y = 12;
      if(i === 0){ x = Math.floor((cw - colWidth)/2); y = 12; }
      else if(i === 1){ x = padding; y = 160; }
      else if(i === 2){ x = Math.max(cw - colWidth - padding, padding); y = 160; }
      else {
        const idx = i - 3;
        const perRow = Math.max(1, Math.floor(cw / (colWidth + padding)));
        const row = Math.floor(idx / perRow);
        const colPos = idx % perRow;
        x = padding + colPos * (colWidth + padding);
        y = 320 + row * 220;
      }
      col.style.position = 'absolute';
      col.style.left = x + 'px';
      col.style.top = y + 'px';
      col.dataset.x = x; col.dataset.y = y;
      col.classList.add('draggable');
      col.style.zIndex = ++zIndexCounter;
    });
  };

  applyInitialPositions();
  window.addEventListener('resize', ()=>{ applyInitialPositions(); });
  setupDrag(container);

  // Reset positions button
  if(typeof resetPosBtn !== 'undefined' && resetPosBtn){
    resetPosBtn.addEventListener('click', ()=>{
      const cols = Array.from(container.querySelectorAll('.timeline-column'));
      const padding = 20;
      const cw = Math.max(container.clientWidth, timeline.clientWidth);
      const colWidth = cols[0] ? cols[0].clientWidth : 280;
      cols.forEach((col,i)=>{
        const x = padding + i * (colWidth + padding);
        const y = 12;
        col.style.position = 'absolute';
        col.style.left = x + 'px';
        col.style.top = y + 'px';
        col.dataset.x = x; col.dataset.y = y;
        col.style.zIndex = ++zIndexCounter;
      });
    });
  }
}

// Drag support: attach event handlers to each column's header
function setupDrag(container){
  const cols = Array.from(container.querySelectorAll('.timeline-column'));
  cols.forEach(col=>{
    // prefer the dedicated drag handle; fall back to title-row or column itself
    const handle = col.querySelector('.drag-handle') || col.querySelector('.title-row') || col;
    handle.style.touchAction = 'none';
    handle.addEventListener('mousedown', startDrag);
    handle.addEventListener('touchstart', startDrag, {passive:false});
    // bring to front when clicked anywhere on column (not only handle)
    col.addEventListener('mousedown', ()=> bringToFront(col));
    function startDrag(e){
      if(window.innerWidth < 900) return;
      e.preventDefault();
      bringToFront(col);
      const isTouch = !!e.touches;
      const startX = (isTouch ? e.touches[0].clientX : e.clientX);
      const startY = (isTouch ? e.touches[0].clientY : e.clientY);
      const containerRect = container.getBoundingClientRect();
      const rect = col.getBoundingClientRect();
      const origLeft = rect.left - containerRect.left;
      const origTop = rect.top - containerRect.top;
      function onMove(ev){
        const mx = (ev.touches ? ev.touches[0].clientX : ev.clientX);
        const my = (ev.touches ? ev.touches[0].clientY : ev.clientY);
        const dx = mx - startX; const dy = my - startY;
        let nx = origLeft + dx; let ny = origTop + dy;
        // allow overlapping beyond container bounds a bit
        nx = Math.max(-100, Math.min(nx, container.clientWidth - rect.width + 100));
        ny = Math.max(-100, Math.min(ny, container.clientHeight - rect.height + 100));
        col.style.left = nx + 'px'; col.style.top = ny + 'px';
        col.dataset.x = nx; col.dataset.y = ny;
      }
      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, {passive:false});
      document.addEventListener('touchend', onUp);
    }
  });
}

function bringToFront(el){
  if(!el) return;
  el.style.zIndex = ++zIndexCounter;
}

function renderEntries(list){
  // list: array of entries with fields {id,text,ts,category}
  // Clear column lists
  for(const k of CATEGORY_KEYS){
    const el = document.querySelector('.column-list[data-key="'+k+'"]');
    if(el) el.innerHTML = '';
  }
  // If no entries at all, show placeholder in first column
  const totalCount = (list || []).length;
  if(!list || totalCount === 0){
    const el = document.querySelector('.column-list[data-key="c1"]');
    if(el){
      const p = document.createElement('div');
      p.className = 'no-entries';
      p.textContent = 'まだエントリーがありません。各カテゴリの下に入力欄があります。';
      el.appendChild(p);
    }
    return;
  }
  // For each category, collect entries and render latest 3, with toggle for the rest
  for(const k of CATEGORY_KEYS){
    const parent = document.querySelector('.column-list[data-key="'+k+'"]');
    if(!parent) continue;
    const items = (list || []).filter(e => (e.category || 'c1') === k);
    if(!items || items.length === 0){
      const p = document.createElement('div');
      p.className = 'no-entries';
      p.textContent = '';
      parent.appendChild(p);
      continue;
    }
    // show latest 3
    const visible = items.slice(0,3);
    const hidden = items.slice(3);
    for(const e of visible){
      const el = buildEntryElement(e);
      parent.appendChild(el);
    }
    if(hidden.length > 0){
      const extraContainer = document.createElement('div');
      extraContainer.className = 'extra-entries';
      for(const e of hidden){
        const el = buildEntryElement(e);
        extraContainer.appendChild(el);
      }
      parent.appendChild(extraContainer);
      const btn = document.createElement('button');
      btn.className = 'more-toggle';
      btn.textContent = `他 ${hidden.length} 件を表示`;
      btn.addEventListener('click', ()=>{
        const open = extraContainer.classList.toggle('open');
        btn.textContent = open ? '閉じる' : `他 ${hidden.length} 件を表示`;
      });
      parent.appendChild(btn);
    }
  }
}

function buildEntryElement(e){
  const el = document.createElement('article');
  el.className = 'entry';
  // expose id and category for optimistic updates and editing
  if(e.id !== undefined) el.dataset.id = String(e.id);
  el.dataset.category = e.category || 'c1';
  const key = getEntryKey(e);
  el.dataset.key = key;
  // keep pointer to entry object for selection handlers
  el._entryObject = e;

  const dot = document.createElement('div'); dot.className='dot';
  // Timestamp on the left: show as "yy/m/d" on first line and "hh:mm" on second
  const timeEl = document.createElement('div'); timeEl.className = 'entry-time';
  const d = new Date(e.ts || Date.now());
  const yy = String(d.getFullYear()).slice(-2);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2,'0');
  const mm = String(d.getMinutes()).padStart(2,'0');
  timeEl.innerHTML = `${yy}/${m}/${day}<br>${hh}:${mm}`;
  timeEl.title = d.toLocaleString();

  const body = document.createElement('div'); body.className='body';
  const text = document.createElement('div'); text.className='text';
  text.textContent = e.text || '';
  body.appendChild(text);

  el.appendChild(timeEl);
  el.appendChild(dot);
  el.appendChild(body);

  // make entry focusable for keyboard and add visual affordance
  el.tabIndex = 0;

  // Long-press / long-click support to enter selection mode
  let longPressTimer = null;
  let startX = 0, startY = 0;
  // flag to indicate this element's long-press handler already fired (so release shouldn't toggle it)
  el._longPressFired = false;
  const startPress = (ev)=>{
    if(selectionMode) return;
    const p = ev.touches ? ev.touches[0] : ev;
    startX = p.clientX; startY = p.clientY;
    el.classList.add('pressing');
    longPressTimer = setTimeout(()=>{
      longPressTimer = null; // mark that long-press fired
      el._longPressFired = true;
      enterSelectionMode(e, el);
      el.classList.remove('pressing');
    }, 600);
  };
  const cancelPress = ()=>{ if(longPressTimer){ clearTimeout(longPressTimer); longPressTimer = null; } el.classList.remove('pressing'); el._longPressFired = false; };
  el.addEventListener('touchstart', startPress, {passive:true});
  el.addEventListener('mousedown', startPress);
  el.addEventListener('touchmove', (ev)=>{ if(!longPressTimer) return; const p = ev.touches[0]; if(Math.hypot(p.clientX-startX, p.clientY-startY) > 10) cancelPress(); }, {passive:true});
  el.addEventListener('mousemove', (ev)=>{ if(!longPressTimer) return; if(Math.hypot(ev.clientX-startX, ev.clientY-startY) > 10) cancelPress(); });
  el.addEventListener('touchend', (ev)=>{
    if(longPressTimer){ cancelPress(); }
    if(selectionMode){
      // If this element's long-press just fired, keep it selected and clear the flag; otherwise toggle selection
      if(el._longPressFired){ el._longPressFired = false; }
      else { toggleSelectElement(el); }
    }
    el.classList.remove('pressing');
  }, {passive:true});
  el.addEventListener('mouseup', (ev)=>{
    if(longPressTimer){ cancelPress(); }
    if(selectionMode){
      if(el._longPressFired){ el._longPressFired = false; }
      else { toggleSelectElement(el); }
    }else {
      // if long-press fired, treat as starting selection and do not open edit modal
      if(!el._longPressFired) openEditModal(e);
      else el._longPressFired = false;
    }
    el.classList.remove('pressing');
  });
  // For accessibility: also handle simple click/keyboard activation
  el.addEventListener('click', (ev)=>{ if(selectionMode) ev.preventDefault(); });
  el.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); if(selectionMode) toggleSelectElement(el); else openEditModal(e); } });

  return el;
}

function toggleSelectElement(el){
  if(!el || !el._entryObject) return;
  const ent = el._entryObject;
  if(selectionCategory && ent.category !== selectionCategory) return; // disallow cross-category
  const key = getEntryKey(ent);
  if(selectedMap.has(key)){
    selectedMap.delete(key);
    el.classList.remove('selected');
  }else{
    selectedMap.set(key, ent);
    el.classList.add('selected');
  }
  updateSelectionBar();
}

// --- Edit modal, selection, and editing helpers ---
let _editingEntry = null;
let selectionMode = false;
let selectionCategory = null;
const selectedMap = new Map(); // key -> entry object

function getEntryKey(e){
  if(!e) return '';
  if(e.id !== undefined && e.id !== null){
    return (typeof e.id === 'string' ? 's:' : 'n:') + String(e.id);
  }
  // ensure a stable temporary key on the object
  if(!e._tmpKey) e._tmpKey = 'tmp:' + Date.now() + ':' + Math.random();
  return e._tmpKey;
}

function createSelectionBar(){
  if(document.getElementById('selectionBar')) return;
  const bar = document.createElement('div');
  bar.id = 'selectionBar';
  bar.className = 'selection-bar hidden';
  bar.innerHTML = `
    <div class="selection-inner">
      <span id="selectionCount">選択 0 件</span>
      <div class="selection-actions">
        <button id="selectionCancelBtn" type="button">キャンセル</button>
        <button id="selectionDeleteBtn" type="button" class="danger">削除</button>
      </div>
    </div>
  `;
  document.body.appendChild(bar);
  bar.querySelector('#selectionCancelBtn').addEventListener('click', ()=>{ exitSelectionMode(); });
  bar.querySelector('#selectionDeleteBtn').addEventListener('click', ()=>{ deleteSelectedEntries(); });
}

function showSelectionBar(){
  createSelectionBar();
  const bar = document.getElementById('selectionBar');
  if(bar) bar.classList.remove('hidden');
  updateSelectionBar();
}
function hideSelectionBar(){
  const bar = document.getElementById('selectionBar');
  if(bar) bar.classList.add('hidden');
}
function updateSelectionBar(){
  const cnt = selectedMap.size;
  const el = document.getElementById('selectionCount');
  if(el) el.textContent = `選択 ${cnt} 件`;
}

function enterSelectionMode(initialEntry, el){
  selectionMode = true;
  selectionCategory = initialEntry.category || 'c1';
  selectedMap.clear();
  // mark initial element
  const key = getEntryKey(initialEntry);
  selectedMap.set(key, initialEntry);
  if(el) el.classList.add('selected');
  showSelectionBar();
}

function exitSelectionMode(){
  selectionMode = false;
  selectionCategory = null;
  selectedMap.clear();
  document.querySelectorAll('.entry.selected').forEach(e=> e.classList.remove('selected'));
  hideSelectionBar();
}

async function deleteSelectedEntries(){
  if(selectedMap.size === 0) return;
  const entries = Array.from(selectedMap.values());
  const remoteDeletes = [];
  const localCandidates = [];
  for(const ent of entries){
    if(currentUser && window._fb && window._fb.db && typeof ent.id === 'string'){
      // remote doc id (Firestore)
      remoteDeletes.push(ent.id);
    }else{
      localCandidates.push(ent);
    }
  }

  // Perform local deletions in a single transaction to avoid intermediate inconsistent UI
  if(localCandidates.length > 0){
    try{
      await deleteEntriesFromIDBBulk(localCandidates);
    }catch(err){ console.warn('Failed bulk local delete', err); }
  }

  // Perform remote deletions in parallel (Firestore)
  if(remoteDeletes.length > 0){
    try{
      const colRef = window._fb.db.collection('users').doc(currentUser.uid).collection('entries');
      await Promise.all(remoteDeletes.map(id => colRef.doc(id).delete().catch(err=>{ console.warn('Failed remote delete', id, err); })));
    }catch(err){ console.warn('Failed remote deletes', err); }
  }

  exitSelectionMode();
  // If we deleted remote docs, the Firestore listener will update the UI — avoid immediate local render to prevent transient mismatch.
  if(remoteDeletes.length === 0){
    await render();
  }
}

async function deleteEntriesFromIDBBulk(candidates){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(['entries','outbox'], 'readwrite');
    const entriesStore = tx.objectStore('entries');
    const outboxStore = tx.objectStore('outbox');

    // gather numeric ids to delete and tmpKeys / ts-text matches
    const numericIds = new Set();
    const tmpKeys = new Set();
    const tsTextList = [];
    for(const c of candidates){
      if(c.id !== undefined && c.id !== null && typeof c.id === 'number') numericIds.add(c.id);
      else if(c.id !== undefined && c.id !== null && typeof c.id === 'string' && /^\d+$/.test(c.id)) numericIds.add(Number(c.id));
      else if(c._tmpKey) tmpKeys.add(c._tmpKey);
      else tsTextList.push({ ts: c.ts, text: c.text });
    }

    // Get all entries once, find matches for tmpKeys and ts/text
    const allReq = entriesStore.getAll();
    allReq.onsuccess = ()=>{
      const all = allReq.result || [];
      for(const e of all){
        if(tmpKeys.size > 0 && e._tmpKey && tmpKeys.has(e._tmpKey)) numericIds.add(e.id);
        for(const t of tsTextList){ if(e.ts === t.ts && e.text === t.text) numericIds.add(e.id); }
      }

      // Delete entries and corresponding outbox items
      for(const id of Array.from(numericIds)){
        try{ entriesStore.delete(id); }catch(e){/* ignore */}
      }

      // remove matching outbox items
      const cursorReq = outboxStore.openCursor();
      cursorReq.onsuccess = (ev)=>{
        const cursor = ev.target.result;
        if(cursor){
          if(cursor.value && numericIds.has(cursor.value.entryId)) cursor.delete();
          cursor.continue();
        }
      };
    };
    allReq.onerror = ()=>{/* ignore */};

    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

function createEditModal(){
  if(document.getElementById('editModal')) return;
  const modal = document.createElement('div');
  modal.id = 'editModal';
  modal.className = 'modal hidden';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-dialog" role="dialog" aria-modal="true">
      <button id="deleteBtn" class="trash-btn" aria-label="削除">🗑️</button>
      <h3>エントリーを編集</h3>
      <textarea id="editText" rows="6" placeholder="テキストを編集..." style="width:100%;padding:8px;border-radius:6px;border:1px solid #ddd"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
        <input id="editDatetime" type="datetime-local" style="flex:1;padding:6px;border-radius:6px;border:1px solid #ddd">
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="editCancelBtn" type="button">キャンセル</button>
        <button id="editSaveBtn" type="button" style="background:var(--accent);color:#fff;border:none;padding:6px 10px;border-radius:6px">保存</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // handlers
  modal.querySelector('.modal-backdrop').addEventListener('click', closeEditModal);
  modal.querySelector('#editCancelBtn').addEventListener('click', closeEditModal);
  modal.querySelector('#deleteBtn').addEventListener('click', deleteEntry);
  modal.querySelector('#editSaveBtn').addEventListener('click', saveEditedEntry);
}

function openEditModal(entry){
  createEditModal();
  _editingEntry = entry;
  const modal = document.getElementById('editModal');
  const ta = modal.querySelector('#editText');
  const dt = modal.querySelector('#editDatetime');
  ta.value = entry.text || '';
  // convert ISO ts to datetime-local value (local timezone)
  const d = entry.ts ? new Date(entry.ts) : new Date();
  const pad = n => String(n).padStart(2,'0');
  const toLocalDatetime = (date)=>{
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth()+1);
    const dd = pad(date.getDate());
    const hh = pad(date.getHours());
    const min = pad(date.getMinutes());
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  };
  dt.value = toLocalDatetime(d);
  modal.classList.remove('hidden');
  // mark body as modal-open so background cards are dimmed
  document.body.classList.add('modal-open');
  setTimeout(()=> ta.focus(), 50);
}

function closeEditModal(){
  const modal = document.getElementById('editModal');
  if(modal) modal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  _editingEntry = null;
}

async function updateEntryInIDB(entry){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(['entries'], 'readwrite');
    const store = tx.objectStore('entries');
    store.put(entry);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

async function saveEditedEntry(){
  if(!_editingEntry) return;
  const modal = document.getElementById('editModal');
  const ta = modal.querySelector('#editText');
  const dt = modal.querySelector('#editDatetime');
  let newText = ta.value.trim();
  if(!newText) return alert('テキストを空にできません。');
  const newTs = (dt.value) ? new Date(dt.value).toISOString() : new Date().toISOString();

  const updated = Object.assign({}, _editingEntry, { text: newText, ts: newTs });

  // If this appears to be a Firestore doc (string id) and user is signed in, update remote
  if(currentUser && window._fb && window._fb.db && typeof updated.id === 'string'){
    try{
      await window._fb.db.collection('users').doc(currentUser.uid).collection('entries').doc(updated.id).update({ text: updated.text, ts: updated.ts });
      // rely on Firestore listener to update UI; still close modal
      closeEditModal();
      return;
    }catch(err){
      console.error('Failed to update remote entry', err);
      alert('保存に失敗しました。' + (err && err.message ? err.message : ''));
    }
  }

  // Otherwise, update local IDB (numeric id or offline)
  try{
    // Ensure numeric id remains numeric if present as string numeric
    if(typeof updated.id === 'string' && /^\d+$/.test(updated.id)){
      updated.id = Number(updated.id);
    }
    await updateEntryInIDB(updated);
    await render();
    closeEditModal();
  }catch(err){
    console.error('Failed to update IDB entry', err);
    alert('ローカル保存に失敗しました。' + (err && err.message ? err.message : ''));
  }
}

// Deletion helpers
async function deleteEntryFromIDB(identifier){
  const db = await openDB();
  return new Promise((resolve, reject)=>{
    const tx = db.transaction(['entries','outbox'], 'readwrite');
    const entries = tx.objectStore('entries');
    const outbox = tx.objectStore('outbox');

    const deleteByNumericId = (numId)=>{
      try{ entries.delete(numId); }catch(e){}
      // remove outbox items that reference this id
      const req = outbox.openCursor();
      req.onsuccess = (ev)=>{
        const cursor = ev.target.result;
        if(cursor){
          if(cursor.value && cursor.value.entryId === numId) cursor.delete();
          cursor.continue();
        }
      };
    };

    // Helper to scan entries and find numeric id by matching _tmpKey or ts+text
    const findAndDelete = ()=>{
      const getAllReq = entries.getAll();
      getAllReq.onsuccess = ()=>{
        const all = getAllReq.result || [];
        let found = null;
        if(typeof identifier === 'string' && identifier.startsWith('tmp:')){
          found = all.find(e=> e._tmpKey === identifier);
        }
        if(!found && typeof identifier === 'object' && identifier !== null){
          found = all.find(e=> e.ts === identifier.ts && e.text === identifier.text);
        }
        if(!found && typeof identifier === 'string' && /^\d+$/.test(identifier)){
          // numeric string
          deleteByNumericId(Number(identifier));
        }else if(found){
          deleteByNumericId(found.id);
        }
      };
      getAllReq.onerror = ()=>{/* ignore */};
    };

    try{
      if(typeof identifier === 'number' && Number.isFinite(identifier)){
        deleteByNumericId(identifier);
      }else if(typeof identifier === 'string'){
        if(/^\d+$/.test(identifier)){
          deleteByNumericId(Number(identifier));
        }else if(identifier.startsWith('tmp:')){
          findAndDelete();
        }else{
          // fallback: try to find by ts+text pattern stored as string key
          findAndDelete();
        }
      }else if(typeof identifier === 'object' && identifier !== null){
        if(typeof identifier.id === 'number' && Number.isFinite(identifier.id)){
          deleteByNumericId(identifier.id);
        }else if(typeof identifier.id === 'string' && /^\d+$/.test(identifier.id)){
          deleteByNumericId(Number(identifier.id));
        }else if(identifier._tmpKey){
          // try match tmpKey
          const tmp = identifier._tmpKey;
          const getAllReq = entries.getAll();
          getAllReq.onsuccess = ()=>{
            const all = getAllReq.result || [];
            const found = all.find(e=> e._tmpKey === tmp);
            if(found) deleteByNumericId(found.id);
          };
        }else{
          // best-effort by ts+text
          findAndDelete();
        }
      }
    }catch(err){
      console.warn('deleteEntryFromIDB failed', err);
    }

    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  });
}

async function deleteEntry(){
  if(!_editingEntry) return;
  // If firestore doc id (string) and signed in, delete remote doc
  if(currentUser && window._fb && window._fb.db && typeof _editingEntry.id === 'string'){
    try{
      await window._fb.db.collection('users').doc(currentUser.uid).collection('entries').doc(_editingEntry.id).delete();
      closeEditModal();
      return;
    }catch(err){
      console.error('Failed to delete remote entry', err);
      alert('削除に失敗しました: ' + (err && err.message ? err.message : ''));
      return;
    }
  }
  // Otherwise, treat id as numeric (IndexedDB)
  try{
    const numericId = (typeof _editingEntry.id === 'number') ? _editingEntry.id : Number(_editingEntry.id);
    if(!Number.isFinite(numericId)){
      // Not a valid numeric id; try to find by timestamp & text
      const entries = await getAllEntriesFromIDB();
      const found = entries.find(e=> e.ts === _editingEntry.ts && e.text === _editingEntry.text);
      if(found) await deleteEntryFromIDB(found.id);
    }else{
      await deleteEntryFromIDB(numericId);
    }
    await render();
    closeEditModal();
  }catch(err){
    console.error('Failed to delete IDB entry', err);
    alert('ローカル削除に失敗しました: ' + (err && err.message ? err.message : ''));
  }
}


async function render(){
  await migrateLocalStorageToIDB();
  const titles = await getCategoryTitlesFromIDB();
  initCategoryUI(titles);
  const entries = await getAllEntriesFromIDB();
  renderEntries(entries);
}

// Firebase auth + Firestore integration (text-only sync)
let currentUser = null;
let firestoreListenerUnsub = null;
let firestoreCategoryUnsub = null;

async function listenToCategoryTitles(uid){
  if(!window._fb || !window._fb.db) return Promise.resolve();
  if(firestoreCategoryUnsub) firestoreCategoryUnsub();
  const docRef = window._fb.db.collection('users').doc(uid);
  let first = true;
  return new Promise((resolve, reject)=>{
    firestoreCategoryUnsub = docRef.onSnapshot(doc=>{
      const data = (doc && doc.exists) ? doc.data() : null;
      if(data && data.categories){
        // save to IDB and update UI
        saveCategoryTitlesToIDB(data.categories).then(()=>{
          // update UI titles without reloading entries
          const headers = document.querySelectorAll('.timeline-title');
          for(const k of CATEGORY_KEYS){
            const el = document.querySelector('.timeline-title[data-key="'+k+'"]');
            if(el) el.textContent = data.categories[k] || DEFAULT_TITLES[k];
          }
        }).catch(err=>console.warn('Failed to save category titles from snapshot', err));
      }
      if(first){ first = false; resolve(); }
    }, err=>{
      console.warn('Category titles listener failed', err);
      if(first){ first = false; reject(err); }
    });
  });
}


function showUser(u){
  if(u){
    signInBtn.style.display = 'none';
    signOutBtn.style.display = '';
    userInfo.textContent = u.displayName || u.email || u.uid;
  }else{
    signInBtn.style.display = '';
    signOutBtn.style.display = 'none';
    userInfo.textContent = '';
  }
}

async function listenToUserEntries(uid){
  if(!window._fb || !window._fb.db) return Promise.resolve();
  if(firestoreListenerUnsub) firestoreListenerUnsub();
  const col = window._fb.db.collection('users').doc(uid).collection('entries').orderBy('ts','desc');
  let first = true;
  return new Promise((resolve, reject)=>{
    firestoreListenerUnsub = col.onSnapshot(snapshot=>{
      const docs = snapshot.docs.map(d=>{
        const data = d.data() || {};
        if(!data.category) data.category = 'c1';
        return Object.assign({ id: d.id }, data);
      });
      // Firestore stores plain text entries (no images in this app)
      renderEntries(docs);
      if(first){ first = false; resolve(); }
    }, err=>{
      console.error('Firestore listener error', err);
      if(first){ first = false; reject(err); }
    });
  });
}

async function flushOutboxToFirestore(uid){
  if(!window._fb || !window._fb.db) return;
  const outbox = await getOutboxEntries();
  if(!outbox || outbox.length === 0) return;
  const col = window._fb.db.collection('users').doc(uid).collection('entries');
  try{
    for(const o of outbox){
      // Only sync text, timestamp, and category
      await col.add({ text: o.text || '', ts: o.ts, category: o.category || 'c1' });
    }
    await clearOutbox();
  }catch(err){
    console.error('Failed to flush outbox', err);
    alert('Firebaseへの同期に失敗しました: ' + (err && err.message ? err.message : String(err)));
  }
}

async function loadCategoryTitlesFromFirestore(uid){
  if(!window._fb || !window._fb.db) return null;
  try{
    const doc = await window._fb.db.collection('users').doc(uid).get();
    if(doc.exists && doc.data().categories) return doc.data().categories;
  }catch(err){ console.warn('Failed to load category titles from Firestore', err); }
  return null;
}

// Auth handlers
if(window._fb && window._fb.auth){
  const auth = window._fb.auth;
  auth.onAuthStateChanged(async (user)=>{
    currentUser = user;
    showUser(user);
    if(user){
      // load category titles from server (if present) and save to IDB
      const remoteTitles = await loadCategoryTitlesFromFirestore(user.uid);
      if(remoteTitles){
        await saveCategoryTitlesToIDB(remoteTitles);
      }
      // flush local outbox to Firestore then listen to remote category titles and entries
      await flushOutboxToFirestore(user.uid);
      try{
        // start listening to category titles first so UI headers show remote values quickly
        await listenToCategoryTitles(user.uid);
      }catch(err){
        console.warn('Listening to category titles failed', err);
      }
      try{
        await listenToUserEntries(user.uid);
      }catch(err){
        console.warn('Listening to Firestore entries failed, falling back to local render', err);
        await render();
      }
    }else{
      // stop listening and render local IDB
      if(firestoreListenerUnsub) firestoreListenerUnsub();
      if(firestoreCategoryUnsub) firestoreCategoryUnsub();
      render();
    }
  });

  signInBtn.addEventListener('click', ()=>{
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(err=>{
      console.error('Sign-in failed', err);
      alert('サインインに失敗しました: ' + err.message);
    });
  });

  signOutBtn.addEventListener('click', ()=>{
    auth.signOut().catch(err=> console.error('Sign-out failed', err));
  });
}


// initial render (if not authenticated yet)
render();

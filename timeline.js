// Autosize textarea and timeline diary with image attach + IndexedDB (sync-ready)
const form = document.getElementById('entryForm');
const textarea = document.getElementById('content');
const imageInput = document.getElementById('imageInput');
const preview = document.getElementById('preview');
const timeline = document.getElementById('timeline');
const STORAGE_KEY = 'timelineEntries_v1'; // legacy localStorage key (migrated)

function autosize(el){
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
textarea.addEventListener('input', ()=> autosize(textarea));
window.addEventListener('load', ()=> autosize(textarea));

// Use File object and ObjectURL for preview; store blobs in IndexedDB for sync.
let selectedImageFile = null;
let previewObjectUrl = null;
imageInput.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  preview.innerHTML = '';
  if(previewObjectUrl){ URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
  selectedImageFile = null;
  if(!f) return;
  selectedImageFile = f; // Blob/File
  previewObjectUrl = URL.createObjectURL(f);
  const img = document.createElement('img');
  img.src = previewObjectUrl;
  preview.appendChild(img);
});

// IndexedDB helpers
function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open('timeline-db', 1);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains('entries')){
        db.createObjectStore('entries', { keyPath: 'id', autoIncrement: true });
      }
      if(!db.objectStoreNames.contains('outbox')){
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
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
    const addReq = entriesStore.add(entry);
    addReq.onsuccess = (ev)=>{
      const id = ev.target.result;
      // Put a lightweight outbox record pointing to this entry for sync
      outboxStore.add({ entryId: id, ts: entry.ts });
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
      const arr = req.result || [];
      // sort by ts desc
      arr.sort((a,b)=> b.ts.localeCompare(a.ts));
      resolve(arr);
    };
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
      const entry = { text: e.text || '', ts: e.ts || new Date().toISOString() };
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

function clearPreviewAndFile(){
  if(previewObjectUrl){ URL.revokeObjectURL(previewObjectUrl); previewObjectUrl = null; }
  preview.innerHTML = '';
  selectedImageFile = null;
  imageInput.value = '';
}

function renderEntries(list){
  timeline.innerHTML = '';
  if(!list || list.length === 0){
    const p = document.createElement('div');
    p.className = 'no-entries';
    p.textContent = 'まだエントリーがありません。上の入力欄から追加できます。';
    timeline.appendChild(p);
    return;
  }
  for(const e of list){
    const el = document.createElement('article');
    el.className = 'entry';
    const dot = document.createElement('div'); dot.className='dot';
    const body = document.createElement('div'); body.className='body';
    const meta = document.createElement('div'); meta.className='meta';
    meta.textContent = new Date(e.ts).toLocaleString();
    const text = document.createElement('div'); text.className='text';
    text.textContent = e.text || '';
    body.appendChild(meta);
    body.appendChild(text);
    if(e.imageBlob){
      const img = document.createElement('img');
      try{
        const url = URL.createObjectURL(e.imageBlob);
        img.src = url;
        // revoke later when image loads to free memory
        img.onload = ()=> URL.revokeObjectURL(url);
      }catch(err){
        console.warn('Failed to create image URL', err);
      }
      body.appendChild(img);
    }
    el.appendChild(dot);
    el.appendChild(body);
    timeline.appendChild(el);
  }
}

async function render(){
  await migrateLocalStorageToIDB();
  const entries = await getAllEntriesFromIDB();
  renderEntries(entries);
}

form.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const txt = textarea.value.trim();
  if(!txt && !selectedImageFile) return; // nothing to save
  const entry = { text: txt, ts: new Date().toISOString() };
  if(selectedImageFile){ entry.imageBlob = selectedImageFile; }
  try{
    await addEntryToIDB(entry);
  }catch(err){
    console.error('Failed to save to IDB', err);
  }
  // reset
  textarea.value = '';
  autosize(textarea);
  clearPreviewAndFile();
  // re-render from IDB
  render();
});

// initial render
render();

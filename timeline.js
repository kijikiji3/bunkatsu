// Autosize textarea and basic timeline diary with image attach + localStorage
const form = document.getElementById('entryForm');
const textarea = document.getElementById('content');
const imageInput = document.getElementById('imageInput');
const preview = document.getElementById('preview');
const timeline = document.getElementById('timeline');
const STORAGE_KEY = 'timelineEntries_v1';

function autosize(el){
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}
textarea.addEventListener('input', ()=> autosize(textarea));
window.addEventListener('load', ()=> autosize(textarea));

let selectedImageData = null;
imageInput.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  preview.innerHTML = '';
  selectedImageData = null;
  if(!f) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    selectedImageData = reader.result;
    const img = document.createElement('img');
    img.src = selectedImageData;
    preview.appendChild(img);
  };
  reader.readAsDataURL(f);
});

function saveEntry(text, imageData){
  const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  entries.unshift({text, imageData, ts: new Date().toISOString()});
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

function render(){
  timeline.innerHTML = '';
  const entries = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  if(entries.length === 0){
    const p = document.createElement('div');
    p.className = 'no-entries';
    p.textContent = 'まだエントリーがありません。上の入力欄から追加できます。';
    timeline.appendChild(p);
    return;
  }
  for(const e of entries){
    const el = document.createElement('article');
    el.className = 'entry';
    const dot = document.createElement('div'); dot.className='dot';
    const body = document.createElement('div'); body.className='body';
    const meta = document.createElement('div'); meta.className='meta';
    meta.textContent = new Date(e.ts).toLocaleString();
    const text = document.createElement('div'); text.className='text';
    text.textContent = e.text;
    body.appendChild(meta);
    body.appendChild(text);
    if(e.imageData){
      const img = document.createElement('img');
      img.src = e.imageData;
      body.appendChild(img);
    }
    el.appendChild(dot);
    el.appendChild(body);
    timeline.appendChild(el);
  }
}

form.addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const txt = textarea.value.trim();
  if(!txt && !selectedImageData) return; // don't save empty
  saveEntry(txt, selectedImageData);
  // reset
  textarea.value = '';
  autosize(textarea);
  imageInput.value = '';
  preview.innerHTML = '';
  selectedImageData = null;
  render();
});

render();

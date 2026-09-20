// js/admin-reels.js
// Reels tab logic for admin.html: add a reel by uploading a video file OR
// pasting a video link, list existing reels, delete them.
// The homepage (index.html) reads the same Firestore "reels" collection.

import {
  db, collection, getDocs, addDoc, deleteDoc, doc, serverTimestamp,
  auth, onAuthStateChanged
} from './firebase-config.js';
import { uploadToImgbb } from './imgbb.js';

const MAX_VIDEO_MB = 100;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same rule the homepage uses to decide whether a URL is playable inline.
function isDirectVideo(url) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || /firebasestorage\.googleapis\.com|firebasestorage\.app/i.test(url);
}

// For YouTube links, grab the cover image automatically.
function youtubeThumb(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:shorts\/|watch\?v=|embed\/))([\w-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

function updateMode() {
  const link = $('rMode').value === 'link';
  $('rFileWrap').style.display = link ? 'none' : 'block';
  $('rLinkWrap').style.display = link ? 'block' : 'none';
}

async function addReel() {
  const btn = $('rSaveBtn');
  const status = $('rStatus');
  const mode = $('rMode').value;
  const caption = $('rCaption').value.trim();
  const href = $('rHref').value.trim();
  const order = Number($('rOrder').value) || 0;
  const thumbFile = $('rThumb').files[0];

  let videoFile = null;
  let link = '';
  if (mode === 'file') {
    videoFile = $('rFile').files[0];
    if (!videoFile) { status.textContent = 'Please choose a video file.'; return; }
    if (!(videoFile.type || '').startsWith('video/')) { status.textContent = 'That file is not a video.'; return; }
    if (videoFile.size > MAX_VIDEO_MB * 1024 * 1024) {
      status.textContent = `Video is too large (max ${MAX_VIDEO_MB} MB) — compress it, or paste a link instead.`;
      return;
    }
  } else {
    link = $('rLink').value.trim();
    if (!/^https?:\/\//i.test(link)) { status.textContent = 'Paste a full link starting with https://'; return; }
  }

  btn.disabled = true;
  try {
    let videoUrl = link;
    let storagePath = null;
    let thumbUrl = null;

    if (thumbFile) {
      status.textContent = 'Uploading cover image...';
      thumbUrl = await uploadToImgbb(thumbFile);
    }

    if (videoFile) {
      // Loaded on demand so a Storage problem can never break the rest of the admin.
      const { uploadVideoDetailed } = await import('./video-upload.js');
      status.textContent = 'Uploading video... 0%';
      const res = await uploadVideoDetailed(videoFile, (pct) => { status.textContent = `Uploading video... ${pct}%`; });
      videoUrl = res.url;
      storagePath = res.path;
    } else if (!thumbUrl && !isDirectVideo(link)) {
      thumbUrl = youtubeThumb(link);
    }

    status.textContent = 'Saving...';
    await addDoc(collection(db, 'reels'), {
      videoUrl,
      thumbUrl: thumbUrl || null,
      caption,
      href,
      order,
      source: videoFile ? 'upload' : 'link',
      storagePath,
      createdAt: serverTimestamp()
    });

    status.textContent = 'Saved — it is live on the homepage.';
    ['rCaption', 'rHref', 'rOrder', 'rLink'].forEach((id) => { $(id).value = ''; });
    $('rFile').value = '';
    $('rThumb').value = '';
    loadReelsList();
  } catch (e) {
    console.error('Reel save failed:', e);
    status.textContent = 'Failed: ' + (e && e.message ? e.message : e);
  }
  btn.disabled = false;
}

async function loadReelsList() {
  const list = $('reelsList');
  if (!list) return;
  list.innerHTML = 'Loading...';
  try {
    const snap = await getDocs(collection(db, 'reels'));
    if (snap.empty) {
      list.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;">No reels yet — the Reels section stays hidden on the site until you add one.</p>';
      return;
    }
    const reels = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
    list.innerHTML = '';
    reels.forEach((r) => {
      const el = document.createElement('div');
      el.className = 'item';
      let media;
      if (r.thumbUrl) media = `<img src="${esc(r.thumbUrl)}" alt="">`;
      else if (isDirectVideo(r.videoUrl || '')) media = `<video src="${esc(r.videoUrl)}#t=0.1" muted playsinline preload="metadata"></video>`;
      else media = '<div style="width:48px;height:48px;background:var(--bg-alt);border-radius:4px;flex-shrink:0;"></div>';
      el.innerHTML = `
        ${media}
        <div class="info">
          <h4>${esc(r.caption || 'Untitled reel')}</h4>
          <p>order: ${r.order || 0} · ${r.source === 'upload' ? 'uploaded video' : 'video link'}</p>
          <p style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.videoUrl)}</p>
        </div>
        <button class="del">Delete</button>`;
      const delBtn = el.querySelector('.del');
      delBtn.addEventListener('click', async () => {
        if (!confirm('Delete this reel?')) return;
        delBtn.disabled = true;
        try {
          await deleteDoc(doc(db, 'reels', r.id));
          if (r.storagePath) {
            try {
              const { deleteVideoByPath } = await import('./video-upload.js');
              await deleteVideoByPath(r.storagePath);
            } catch (e) { console.warn('Reel removed, but the stored video file could not be deleted:', e); }
          }
        } catch (e) {
          console.error('Reel delete failed:', e);
          $('rStatus').textContent = 'Could not delete: ' + (e && e.message ? e.message : e);
        }
        loadReelsList();
      });
      list.appendChild(el);
    });
  } catch (e) {
    console.error('Reels load failed:', e);
    list.innerHTML = 'Failed to load: ' + esc(e && e.message ? e.message : e);
  }
}

$('rMode').addEventListener('change', updateMode);
$('rSaveBtn').addEventListener('click', addReel);
updateMode();

const reelsTab = document.querySelector('.tab[data-panel="reelsPanel"]');
if (reelsTab) reelsTab.addEventListener('click', loadReelsList);
onAuthStateChanged(auth, (user) => { if (user) loadReelsList(); });

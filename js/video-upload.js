// js/video-upload.js
// Uploads a reel video File to Firebase Storage and returns its public URL.
// Used by js/admin-reels.js (Reels tab in admin.html).

import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { app } from "./firebase-config.js";

const storage = getStorage(app);

// Uploads a video and reports progress (0-100). Resolves to { url, path }.
export function uploadVideoDetailed(file, onProgress) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `reels/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);
  const task = uploadBytesResumable(fileRef, file, { contentType: file.type || "video/mp4" });
  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (onProgress) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
      },
      reject,
      async () => {
        try { resolve({ url: await getDownloadURL(fileRef), path }); }
        catch (e) { reject(e); }
      }
    );
  });
}

// Backwards-compatible helper: resolves to just the public URL.
export async function uploadVideo(file, onProgress) {
  return (await uploadVideoDetailed(file, onProgress)).url;
}

// Removes an uploaded video from Storage (used when a reel is deleted).
export async function deleteVideoByPath(path) {
  await deleteObject(ref(storage, path));
}

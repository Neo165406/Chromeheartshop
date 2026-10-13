// js/video-upload.js
// Uploads a reel video File to Firebase Storage and returns its public URL.
// Used by js/admin-reels.js (Reels tab in admin.html).

import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { app } from "./firebase-config.js";

const storage = getStorage(app);

// By default the SDK silently keeps retrying a failing upload for ~10 minutes,
// which leaves the admin staring at "Uploading video... 0%" with no message.
// Shorter limits make a bad connection / blocked request fail fast, with a
// real error code that the Reels tab prints.
storage.maxUploadRetryTime = 45000;
storage.maxOperationRetryTime = 30000;

// If not a single byte has gone out after this long, give up and say why.
const NO_PROGRESS_TIMEOUT_MS = 40000;

// Uploads a video and reports progress (0-100). Resolves to { url, path }.
// Rejects with an Error whose message starts with the Firebase error code,
// e.g. "storage/unauthorized: ..." or "storage/retry-limit-exceeded: ...".
export function uploadVideoDetailed(file, onProgress) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `reels/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);
  const task = uploadBytesResumable(fileRef, file, { contentType: file.type || "video/mp4" });
  return new Promise((resolve, reject) => {
    let started = false;
    const watchdog = setTimeout(() => {
      if (started) return;
      reject(new Error(
        "storage/no-progress: the upload did not start within " + (NO_PROGRESS_TIMEOUT_MS / 1000) +
        " seconds — the connection to Firebase Storage (firebasestorage.googleapis.com) is blocked or too slow. " +
        "Try another network (Wi-Fi / mobile data) or a smaller video."
      ));
      try { task.cancel(); } catch (e) { /* already finished */ }
    }, NO_PROGRESS_TIMEOUT_MS);

    task.on(
      "state_changed",
      (snap) => {
        if (snap.bytesTransferred > 0) started = true;
        if (onProgress) onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
      },
      (err) => {
        clearTimeout(watchdog);
        const code = (err && err.code) || "storage/unknown";
        const msg = (err && err.message) || String(err);
        reject(new Error(code + ": " + msg));
      },
      async () => {
        clearTimeout(watchdog);
        try { resolve({ url: await getDownloadURL(fileRef), path }); }
        catch (e) {
          reject(new Error(((e && e.code) || "storage/unknown") + ": " + ((e && e.message) || e)));
        }
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

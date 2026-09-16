// js/video-upload.js
// Uploads a reel video File to Firebase Storage and returns its public URL.
// Used by admin.html in the Reels tab.

import {
  getStorage, ref, uploadBytes, getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-storage.js";
import { app } from "./firebase-config.js";

const storage = getStorage(app);

export async function uploadVideo(file) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `reels/${Date.now()}-${safeName}`;
  const fileRef = ref(storage, path);
  await uploadBytes(fileRef, file, { contentType: file.type || "video/mp4" });
  return await getDownloadURL(fileRef);
}

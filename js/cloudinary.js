// js/cloudinary.js
// Uploads a reel video File to Cloudinary (unsigned upload) and returns its
// public URL. Used by js/admin-reels.js (Reels tab in admin.html).
//
// Cloudinary dashboard setup (one time):
//   Settings -> Upload -> Upload presets -> Add upload preset
//     Preset name = fashion1sta_reels, Signing mode = Unsigned, Folder = reels.
// Neither value below is secret - they are meant to be used from the browser.

const CLOUDINARY_CLOUD_NAME = "ksorx9qy";
const CLOUDINARY_UPLOAD_PRESET = "fashion1sta_reels";

// If the upload makes no progress at all for this long, give up and say why.
const STALL_TIMEOUT_MS = 90000;

function isConfigured() {
  return CLOUDINARY_CLOUD_NAME && CLOUDINARY_UPLOAD_PRESET &&
    !CLOUDINARY_CLOUD_NAME.startsWith("YOUR_") && !CLOUDINARY_UPLOAD_PRESET.startsWith("YOUR_");
}

// Uploads a video and reports progress (0-100).
// Resolves to { url, thumbUrl, path } - same shape the Reels tab already uses.
// Rejects with an Error whose message says what went wrong.
export function uploadVideoDetailed(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) {
      reject(new Error("cloudinary/not-configured: set CLOUDINARY_CLOUD_NAME and CLOUDINARY_UPLOAD_PRESET in js/cloudinary.js."));
      return;
    }

    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`);

    let stallTimer = null;
    const armStallTimer = () => {
      clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        try { xhr.abort(); } catch (e) { /* already done */ }
        reject(new Error(
          "cloudinary/stalled: no upload progress for " + (STALL_TIMEOUT_MS / 1000) +
          " seconds - the connection is too slow or blocked. Try Wi-Fi or a smaller video."
        ));
      }, STALL_TIMEOUT_MS);
    };
    armStallTimer();

    xhr.upload.onprogress = (e) => {
      armStallTimer();
      if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };

    xhr.onload = () => {
      clearTimeout(stallTimer);
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && data && data.secure_url) {
        // Cloudinary can make a still cover frame from the video for free:
        // same URL, first frame (so_0), .jpg extension.
        const thumbUrl = data.secure_url
          .replace("/video/upload/", "/video/upload/so_0,w_480,c_limit/")
          .replace(/\.[a-z0-9]+$/i, ".jpg");
        resolve({ url: data.secure_url, thumbUrl, path: data.public_id || null });
      } else {
        const msg = (data && data.error && data.error.message) || ("HTTP " + xhr.status);
        reject(new Error("cloudinary/" + xhr.status + ": " + msg));
      }
    };

    xhr.onerror = () => {
      clearTimeout(stallTimer);
      reject(new Error("cloudinary/network: could not reach Cloudinary - check your connection and try again."));
    };

    xhr.send(form);
  });
}

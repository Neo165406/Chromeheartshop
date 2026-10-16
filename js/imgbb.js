// js/imgbb.js
// Uploads a File to imgbb and returns the hosted image URL.
// Used by admin.html when adding/editing slides and products.
// On failure it throws an Error that starts with the exact code, e.g.
// "imgbb/400: ..." or "imgbb/network: ...", so the admin page shows what went wrong.

const IMGBB_API_KEY = "90190545c139a9442906f08503d04465";

export async function uploadToImgbb(file) {
  const formData = new FormData();
  formData.append("image", file);

  let res;
  try {
    res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
      method: "POST",
      body: formData
    });
  } catch (e) {
    throw new Error("imgbb/network: could not reach imgbb - " + (e && e.message ? e.message : e));
  }

  let data = null;
  try { data = await res.json(); } catch (e) { /* response was not JSON */ }

  if (res.ok && data && data.success) return data.data.url;

  const code = (data && data.status_code) || res.status;
  const msg = (data && data.error && data.error.message) || "no details returned";
  throw new Error("imgbb/" + code + ": " + msg);
}

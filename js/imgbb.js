// js/imgbb.js
// Uploads a File to imgbb and returns the hosted image URL.
// Used by admin.html when adding/editing slides and products.

const IMGBB_API_KEY = "90190545c139a9442906f08503d04465";

export async function uploadToImgbb(file) {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData
  });
  const data = await res.json();
  if (data.success) return data.data.url;
  throw new Error(data.error?.message || "Image upload failed");
}

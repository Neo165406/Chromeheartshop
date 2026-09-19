// api/generate-image.js — Vercel serverless function
// Creates the scroll-spin product image with AI. The AI API key lives ONLY here on
// the server (Vercel environment variable OPENAI_API_KEY) — it is never sent to the
// browser, so nobody can steal it from the site's code.
//
// Only a signed-in admin can call it: the admin page sends its Firebase login token,
// and we verify that token with Firebase before spending any AI credit.
//
// Optional env var ADMIN_EMAILS (comma separated) — if set, only those emails may generate.

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)

module.exports = async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  if(req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const openaiKey = process.env.OPENAI_API_KEY;
  if(!openaiKey){
    return res.status(500).json({ error: 'OPENAI_API_KEY is not set. Add it in Vercel → Project → Settings → Environment Variables, then redeploy.' });
  }

  // ---- 1) Must be a signed-in admin ----
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if(!idToken) return res.status(401).json({ error: 'Please sign in to the admin panel first.' });

  let user = null;
  try{
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    const j = await r.json();
    user = j && j.users && j.users[0];
  }catch(e){ /* treated as not signed in below */ }
  if(!user) return res.status(401).json({ error: 'Your admin session is not valid — sign in again.' });

  const allowed = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if(allowed.length && !allowed.includes(String(user.email || '').toLowerCase())){
    return res.status(403).json({ error: 'This account is not allowed to generate images.' });
  }

  // ---- 2) Read the prompt ----
  let body = req.body;
  if(typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){ body = {}; } }
  const userPrompt = String((body && body.prompt) || '').trim().slice(0, 500);
  if(!userPrompt) return res.status(400).json({ error: 'Describe the image you want.' });

  const fullPrompt = userPrompt +
    '. Single object, centered, three-quarter view, isolated on a fully transparent background, ' +
    'no text, no watermark, no shadow, no props. Premium gothic-luxury silver jewelry / eyewear ' +
    'product photography, sharp details, dark moody studio lighting.';

  // ---- 3) Ask the AI ----
  try{
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + openaiKey },
      body: JSON.stringify({
        model: 'gpt-image-1',
        prompt: fullPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'medium',
        background: 'transparent',
        output_format: 'webp',
        output_compression: 90
      })
    });
    const j = await r.json();
    if(!r.ok){
      const msg = (j && j.error && j.error.message) || ('AI request failed (' + r.status + ')');
      return res.status(502).json({ error: msg });
    }
    const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
    if(!b64) return res.status(502).json({ error: 'The AI did not return an image. Try a different description.' });
    return res.status(200).json({ image: 'data:image/webp;base64,' + b64 });
  }catch(e){
    return res.status(500).json({ error: 'Could not reach the AI service: ' + (e && e.message ? e.message : 'unknown error') });
  }
};

// api/og-image.js — serves the share-preview image at /og.png.
//
// Why this exists: og-image.png in the repo root was stored as base64 TEXT
// (13,920 bytes of characters) instead of real PNG bytes, so browsers and
// Instagram/WhatsApp crawlers got a broken image. This function reads that
// file and, if it isn't a real PNG, decodes the base64 into the real image
// before sending it. If og-image.png is later replaced with a proper binary
// PNG, this keeps working unchanged (it just passes the bytes through).

const fs = require('fs');
const path = require('path');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf){
  return buf.length > 8 && buf.subarray(0, 8).equals(PNG_SIG);
}

module.exports = function handler(req, res){
  try{
    const raw = fs.readFileSync(path.join(__dirname, '..', 'og-image.png'));
    let buf = raw;
    if(!isPng(raw)){
      buf = Buffer.from(raw.toString('utf8').replace(/\s+/g, ''), 'base64');
    }
    if(!isPng(buf)) throw new Error('og-image.png is neither a PNG nor base64 PNG data');

    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
    res.status(200).send(buf);
  }catch(e){
    console.error('og-image failed:', e);
    res.status(404).send('Not found');
  }
};

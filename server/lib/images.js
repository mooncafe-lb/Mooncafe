'use strict';
const crypto = require('crypto');
const { httpError } = require('./util');

// sharp (resizing) is a native module. If it cannot load on the server, uploads must still work, so the original
// file is stored after a magic-number check instead of failing silently.
let sharpLib;
let sharpLoader = () => require('sharp');
const getSharp = () => {
  if (sharpLib === undefined) {
    try { sharpLib = sharpLoader(); } catch (err) { sharpLib = null; console.warn(`[images] sharp is not available (${err.message}); uploads are stored without resizing`); }
  }
  return sharpLib;
};
// tests only
const setSharpLoader = (fn) => { sharpLoader = fn; sharpLib = undefined; };

const ALLOWED = ['jpeg', 'png', 'webp', 'gif'];
const PIXEL_LIMIT = 50000000;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// file type from the first bytes (never from the file name or the browser's claim)
function sniff(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 12 && buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'gif';
  return null;
}

// Photos become WebP (main 1600px + 480px thumbnail). A logo stays a PNG so transparency survives.
async function processImage(buffer, kind = 'photo') {
  const format = sniff(buffer);
  if (!format) throw httpError(400, 'unsupported_image_type');
  const sharp = getSharp();
  if (!sharp) return { mime: `image/${format}`, data: buffer, width: null, height: null, thumb: null, processed: false };
  const open = () => sharp(buffer, { limitInputPixels: PIXEL_LIMIT }).rotate();
  let meta;
  try { meta = await sharp(buffer, { limitInputPixels: PIXEL_LIMIT }).metadata(); } catch (_) { throw httpError(400, 'invalid_image'); }
  if (!ALLOWED.includes(meta.format)) throw httpError(400, 'unsupported_image_type');
  try {
    if (kind === 'logo') {
      const { data, info } = await open().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
      return { mime: 'image/png', data, width: info.width, height: info.height, thumb: null, processed: true };
    }
    const { data, info } = await open().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await open().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return { mime: 'image/webp', data, width: info.width, height: info.height, thumb, processed: true };
  } catch (err) { console.error(`[images] processing failed: ${err.message}`); throw httpError(400, 'invalid_image'); }
}

async function saveImage(db, buffer, { kind = 'photo', name = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'empty_upload');
  if (buffer.length > MAX_UPLOAD_BYTES) throw httpError(413, 'payload_too_large');
  const img = await processImage(buffer, kind);
  let rows;
  try {
    ({ rows } = await db.query(
      `INSERT INTO images (mime, data, width, height, sha256, byte_size, thumb, original_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [img.mime, img.data, img.width, img.height, crypto.createHash('sha256').update(img.data).digest('hex'), img.data.length, img.thumb, String(name).slice(0, 120)]));
  } catch (err) { console.error(`[images] database insert failed: ${err.message}`); throw httpError(500, 'image_save_failed'); }
  console.log(`[images] stored image ${rows[0].id}: ${img.mime}, ${img.data.length} bytes${img.processed ? '' : ' (not resized)'}`);
  return { id: rows[0].id, width: img.width, height: img.height, bytes: img.data.length, processed: img.processed };
}

async function loadImage(db, id, variant) {
  const { rows } = await db.query('SELECT mime, data, thumb FROM images WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return null;
  const pick = variant === 'thumb' && row.thumb ? row.thumb : row.data;
  return { mime: row.mime, data: Buffer.from(pick) };
}

module.exports = { processImage, saveImage, loadImage, sniff, setSharpLoader, MAX_UPLOAD_BYTES };

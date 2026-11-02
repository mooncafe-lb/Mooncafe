'use strict';
const crypto = require('crypto');
const { httpError } = require('./util');

let sharpLib;
const getSharp = () => { if (!sharpLib) sharpLib = require('sharp'); return sharpLib; };
const ALLOWED = ['jpeg', 'png', 'webp', 'gif'];
const PIXEL_LIMIT = 50000000;

// Photos become WebP (main 1600px + 480px thumbnail). A logo stays a PNG so transparency survives.
async function processImage(buffer, kind = 'photo') {
  const sharp = getSharp();
  const open = () => sharp(buffer, { limitInputPixels: PIXEL_LIMIT }).rotate();
  let meta;
  try { meta = await sharp(buffer, { limitInputPixels: PIXEL_LIMIT }).metadata(); } catch (_) { throw httpError(400, 'invalid_image'); }
  if (!ALLOWED.includes(meta.format)) throw httpError(400, 'unsupported_image_type');
  try {
    if (kind === 'logo') {
      const { data, info } = await open().resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
      return { mime: 'image/png', data, width: info.width, height: info.height, thumb: null };
    }
    const { data, info } = await open().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await open().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    return { mime: 'image/webp', data, width: info.width, height: info.height, thumb };
  } catch (_) { throw httpError(400, 'invalid_image'); }
}

async function saveImage(db, buffer, { kind = 'photo', name = '' } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw httpError(400, 'empty_upload');
  const img = await processImage(buffer, kind);
  const { rows } = await db.query(
    `INSERT INTO images (mime, data, width, height, sha256, byte_size, thumb, original_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [img.mime, img.data, img.width, img.height, crypto.createHash('sha256').update(img.data).digest('hex'), img.data.length, img.thumb, String(name).slice(0, 120)]);
  return { id: rows[0].id, width: img.width, height: img.height, bytes: img.data.length };
}

async function loadImage(db, id, variant) {
  const { rows } = await db.query('SELECT mime, data, thumb FROM images WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) return null;
  const pick = variant === 'thumb' && row.thumb ? row.thumb : row.data;
  return { mime: row.mime, data: Buffer.from(pick) };
}

module.exports = { processImage, saveImage, loadImage };

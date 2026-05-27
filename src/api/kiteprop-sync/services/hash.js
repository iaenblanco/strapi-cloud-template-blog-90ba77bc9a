'use strict';

const crypto = require('crypto');

const SYNC_TECH_FIELDS = new Set([
  'Imagenes',
  'kiteprop_imagenes',
  'kiteprop_raw',
  'kiteprop_synced_at',
  'kiteprop_data_hash',
  'kiteprop_images_hash',
  'kiteprop_last_synced_at',
  'kiteprop_last_images_synced_at',
  'kiteprop_sync_status',
  'kiteprop_sync_error',
]);

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sha1(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex');
}

function normalizeUrl(url) {
  if (url === null || url === undefined) return null;
  const normalized = String(url).trim();
  return normalized.length > 0 ? normalized : null;
}

function buildPropertyDataHash(mappedPayload) {
  const clean = {};
  for (const [key, value] of Object.entries(mappedPayload || {})) {
    if (SYNC_TECH_FIELDS.has(key)) continue;
    clean[key] = value;
  }
  return sha256(stableStringify(clean));
}

function buildPropertyImagesHash(normalizedImages) {
  const clean = (normalizedImages || []).map((image) => ({
    image_key: image.image_key,
    remote_url: image.remote_url,
    order: image.order,
  }));
  return sha256(stableStringify(clean));
}

module.exports = {
  stableStringify,
  sha1,
  sha256,
  normalizeUrl,
  buildPropertyDataHash,
  buildPropertyImagesHash,
};

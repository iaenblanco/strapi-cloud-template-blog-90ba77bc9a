'use strict';

const { sha1, normalizeUrl } = require('./hash');

function pickImageUrl(image) {
  return image?.lg || image?.md || image?.sm || image?.url || null;
}

function buildImageKey(kitepropPropertyId, image) {
  const propertyId = String(kitepropPropertyId);
  if (image?.id !== null && image?.id !== undefined && String(image.id).trim() !== '') {
    return `${propertyId}:${String(image.id).trim()}`;
  }

  const url = normalizeUrl(pickImageUrl(image));
  return `${propertyId}:url:${sha1(url || '')}`;
}

function normalizeKitepropImages(images, kitepropPropertyId, maxImages) {
  const limit = Number.isFinite(Number(maxImages)) && Number(maxImages) > 0 ? Number(maxImages) : 12;
  return (images || []).slice(0, limit).map((image, index) => {
    const remoteUrl = normalizeUrl(pickImageUrl(image));
    return {
      kiteprop_property_id: String(kitepropPropertyId),
      image_key: buildImageKey(kitepropPropertyId, image),
      remote_image_id:
        image?.id !== null && image?.id !== undefined && String(image.id).trim() !== ''
          ? String(image.id).trim()
          : null,
      remote_url: remoteUrl,
      remote_url_hash: sha1(remoteUrl || ''),
      order: index,
      title: image?.title || null,
      source: image,
    };
  }).filter((image) => image.remote_url);
}

module.exports = {
  pickImageUrl,
  buildImageKey,
  normalizeKitepropImages,
};

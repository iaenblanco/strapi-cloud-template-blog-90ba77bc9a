'use strict';

/**
 * properties-sync.js
 *
 * Phase 1 — Properties only.
 *
 * Public methods:
 *   syncOne(id, opts)       — sync a single KiteProp property by id (manual / on demand).
 *   runDelta(opts)          — walk /properties/activities since the stored cursor.
 *   runSniffer(opts)        — detect newly created properties via /properties?order=id:desc.
 *   reconcile(opts)         — (TODO Phase 1.x) full reconciliation pass; not yet implemented.
 *
 * Behaviors enforced here:
 *   - Soft delete only. Never hard delete (per Phase 1 rules).
 *   - Upsert by `kiteprop_id`. Never create duplicates.
 *   - Idempotency: if remote `updated_at` <= local, skip.
 *   - Preserves Strapi-only fields: mapper returns only fields it owns.
 *   - Dry-run: when true, NO writes happen but logs and console output do.
 *   - Failure isolation: error in one entity does not abort the run.
 */

const crypto = require('crypto');
const fs = require('fs-extra');
const os = require('os');
const path = require('path');
const mime = require('mime-types');

const PROPIEDAD_UID = 'api::propiedad.propiedad';
const KITEPROP_IMAGE_UID = 'api::kiteprop-image.kiteprop-image';

const ACTIVITY_TYPE_DELETE = 'delete_property';
const ACTIVITY_TYPES_RELEVANT = new Set([
  'status_changed',
  'price_update',
  'user_assignment',
  'data_changed',
  'category_changed',
  'delete_property',
]);

function newRunId() {
  return `run_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readPositiveNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

function readDeleteStrategy() {
  const raw = String(process.env.KITEPROP_DELETE_STRATEGY || 'soft').toLowerCase();
  if (raw !== 'soft') {
    strapi.log.warn(
      `[kiteprop-sync] Unsupported KITEPROP_DELETE_STRATEGY="${raw}" in Phase 1; forcing "soft"`
    );
  }
  return 'soft';
}

module.exports = ({ strapi: _strapi } = {}) => {
  const client = () => strapi.service('api::kiteprop-sync.client');
  const mappers = require('./mappers');
  const hashes = require('./hash');
  const imageHelpers = require('./images');
  const state = () => strapi.service('api::kiteprop-sync.state');
  const logger = () => strapi.service('api::kiteprop-sync.logger');
  const frontendDeploy = () => strapi.service('api::kiteprop-sync.frontend-deploy');
  const docs = () => strapi.documents(PROPIEDAD_UID);
  const imageDocs = () => strapi.documents(KITEPROP_IMAGE_UID);

  /**
   * Find an existing Strapi propiedad by KiteProp id.
   * Returns the document (with documentId) or null.
   */
  async function findByKitepropId(kitepropId) {
    if (!kitepropId) return null;
    const found = await docs().findFirst({
      filters: { kiteprop_id: Number(kitepropId) },
      // We need kiteprop_updated_at for idempotency and Publicado for delete decisions.
      fields: [
        'id',
        'documentId',
        'Slug',
        'kiteprop_id',
        'kiteprop_updated_at',
        'kiteprop_status',
        'kiteprop_data_hash',
        'kiteprop_images_hash',
        'kiteprop_sync_status',
        'Publicado',
      ],
      populate: {
        Imagenes: {
          fields: ['id', 'name', 'url'],
        },
      },
      status: 'draft', // include unpublished items
    });
    return found || null;
  }

  function isImageImportEnabled() {
    return String(process.env.KITEPROP_SYNC_IMPORT_IMAGES || 'true').toLowerCase() === 'true';
  }

  function maxImagesPerProperty() {
    return readPositiveNumber(
      process.env.KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY,
      12
    );
  }

  function buildImageName(normalizedImage) {
    return `kiteprop-${normalizedImage.image_key.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
  }

  async function findKitepropImage(normalizedImage) {
    return imageDocs().findFirst({
      filters: {
        kiteprop_property_id: normalizedImage.kiteprop_property_id,
        image_key: normalizedImage.image_key,
      },
      fields: [
        'id',
        'documentId',
        'kiteprop_property_id',
        'image_key',
        'remote_image_id',
        'remote_url',
        'remote_url_hash',
        'order',
        'status',
      ],
      populate: {
        file: {
          fields: ['id', 'name', 'url'],
        },
      },
    });
  }

  async function findLegacyUploadedImage(normalizedImage) {
    const legacyKeys = [];
    if (normalizedImage.remote_image_id) legacyKeys.push(normalizedImage.remote_image_id);
    legacyKeys.push(normalizedImage.remote_url_hash.slice(0, 10));

    for (const key of legacyKeys) {
      const name = `kiteprop-${normalizedImage.kiteprop_property_id}-${key}`;
      const found = await strapi.db.query('plugin::upload.file').findOne({
        where: { name },
        select: ['id', 'name', 'url'],
      });
      if (found?.id) return found;
    }
    return null;
  }

  async function downloadRemoteImage(url, name) {
    const controller = new AbortController();
    const timeoutMs = readEnvNumber('KITEPROP_SYNC_IMAGE_TIMEOUT_MS', 20000);
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`image download failed with HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        throw new Error(`remote file is not an image (${contentType})`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const maxBytes = readEnvNumber('KITEPROP_SYNC_IMAGE_MAX_BYTES', 15 * 1024 * 1024);
      if (buffer.length > maxBytes) {
        throw new Error(`remote image exceeds max size (${buffer.length} bytes)`);
      }

      const ext = mime.extension(contentType) || 'jpg';
      const filepath = path.join(os.tmpdir(), `${name}.${ext}`);
      await fs.writeFile(filepath, buffer);

      return {
        filepath,
        originalFilename: `${name}.${ext}`,
        mimetype: contentType,
        size: buffer.length,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  async function uploadKitepropImage(normalizedImage) {
    const name = buildImageName(normalizedImage);
    let file;
    try {
      file = await downloadRemoteImage(normalizedImage.remote_url, name);
      const uploaded = await strapi.plugin('upload').service('upload').upload({
        data: {
          fileInfo: {
            name,
            alternativeText:
              normalizedImage.title ||
              `KiteProp property ${normalizedImage.kiteprop_property_id}`,
            caption: normalizedImage.title || null,
          },
        },
        files: file,
      });
      return Array.isArray(uploaded) ? uploaded[0] : uploaded;
    } finally {
      if (file?.filepath) await fs.remove(file.filepath).catch(() => {});
    }
  }

  async function markImageMappingError(normalizedImage, err, ctx) {
    const existing = await findKitepropImage(normalizedImage).catch(() => null);
    if (!existing || ctx.dryRun) return;
    await imageDocs().update({
      documentId: existing.documentId,
      data: {
        status: 'error',
        last_error: String(err?.message || err).slice(0, 1000),
        last_seen_at: new Date().toISOString(),
      },
    }).catch(() => {});
  }

  async function resolveOneImage(normalizedImage, ctx, stats) {
    const existing = await findKitepropImage(normalizedImage);

    if (existing?.file?.id) {
      if (String(existing.kiteprop_property_id) !== normalizedImage.kiteprop_property_id) {
        throw new Error(
          `image_key ${normalizedImage.image_key} belongs to property ${existing.kiteprop_property_id}, not ${normalizedImage.kiteprop_property_id}`
        );
      }
      stats.images_reused += 1;
      if (!ctx.dryRun) {
        await imageDocs().update({
          documentId: existing.documentId,
          data: {
            remote_url: normalizedImage.remote_url,
            remote_url_hash: normalizedImage.remote_url_hash,
            remote_image_id: normalizedImage.remote_image_id,
            order: normalizedImage.order,
            last_seen_at: new Date().toISOString(),
            status: 'active',
            last_error: null,
          },
        });
      }
      return existing.file.id;
    }

    if (ctx.dryRun) {
      stats.images_uploaded += 1;
      return null;
    }

    let uploaded = await findLegacyUploadedImage(normalizedImage);
    if (uploaded?.id) {
      stats.images_reused += 1;
    } else {
      uploaded = await uploadKitepropImage(normalizedImage);
      if (!uploaded?.id) throw new Error(`upload did not return a file id for ${normalizedImage.image_key}`);
      stats.images_uploaded += 1;
    }

    const mappingPayload = {
      kiteprop_property_id: normalizedImage.kiteprop_property_id,
      image_key: normalizedImage.image_key,
      remote_image_id: normalizedImage.remote_image_id,
      remote_url: normalizedImage.remote_url,
      remote_url_hash: normalizedImage.remote_url_hash,
      order: normalizedImage.order,
      file: uploaded.id,
      last_seen_at: new Date().toISOString(),
      status: 'active',
      last_error: null,
    };

    if (existing?.documentId) {
      await imageDocs().update({
        documentId: existing.documentId,
        data: mappingPayload,
      });
    } else {
      await imageDocs().create({ data: mappingPayload });
    }

    return uploaded.id;
  }

  async function syncImageRelation({ kp, existing, remoteImagesHash, normalizedImages, ctx }) {
    const stats = {
      images_changed: false,
      images_uploaded: 0,
      images_reused: 0,
      images_linked: Array.isArray(existing?.Imagenes) ? existing.Imagenes.length : 0,
      imageIds: undefined,
    };

    if (!isImageImportEnabled()) {
      await logger().record({
        run_id: ctx.runId,
        source: ctx.source,
        resource: 'property',
        action: 'images',
        kiteprop_id: kp.id,
        status: 'noop',
        message: 'image import disabled by KITEPROP_SYNC_IMPORT_IMAGES=false',
        dry_run: !!ctx.dryRun,
      });
      return stats;
    }

    if (existing?.kiteprop_images_hash && existing.kiteprop_images_hash === remoteImagesHash) {
      await logger().record({
        run_id: ctx.runId,
        source: ctx.source,
        resource: 'property',
        action: 'images',
        kiteprop_id: kp.id,
        status: 'noop',
        message: 'images_hash unchanged; skipping download/upload',
        dry_run: !!ctx.dryRun,
      });
      return stats;
    }

    stats.images_changed = true;

    if (normalizedImages.length === 0) {
      stats.imageIds = [];
      stats.images_linked = 0;
      return stats;
    }

    const imageIds = [];
    for (const normalizedImage of normalizedImages) {
      try {
        const fileId = await resolveOneImage(normalizedImage, ctx, stats);
        if (fileId) imageIds.push(fileId);
      } catch (err) {
        await markImageMappingError(normalizedImage, err, ctx);
        await logger().record({
          run_id: ctx.runId,
          source: ctx.source,
          resource: 'property',
          action: 'images',
          kiteprop_id: kp.id,
          status: 'error',
          message: `image import failed for ${normalizedImage.image_key}: ${err.message}`,
          error_details: { image: normalizedImage, stack: err.stack },
          dry_run: !!ctx.dryRun,
        });
        throw err;
      }
    }

    stats.imageIds = imageIds;
    stats.images_linked = imageIds.length;
    return stats;
  }

  async function writeProperty({ existing, payload, publish }) {
    const data = { ...payload };

    if (!existing) {
      return docs().create({
        status: publish ? 'published' : 'draft',
        data,
      });
    }

    const updated = await docs().update({
      documentId: existing.documentId,
      status: publish ? 'published' : 'draft',
      data,
    });

    if (!publish) {
      await docs().unpublish({ documentId: existing.documentId });
    }

    return updated;
  }

  /**
   * Upsert a property in Strapi from a KiteProp payload.
   *
   * @returns { action, status, message, kiteprop_id, durationMs }
   */
  async function upsertProperty(kp, ctx) {
    const startedAt = Date.now();
    const dryRun = !!ctx.dryRun;
    const runId = ctx.runId;
    const source = ctx.source;
    const result = {
      action: 'skip',
      status: 'noop',
      kiteprop_id: kp?.id,
      data_changed: false,
      images_changed: false,
      images_uploaded: 0,
      images_reused: 0,
      images_linked: 0,
      errors: [],
      duration_ms: 0,
    };

    let payload;
    try {
      payload = mappers.mapPropertyToStrapi(kp);
    } catch (err) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'error',
        kiteprop_id: kp?.id,
        status: 'error',
        message: `mapper failure: ${err.message}`,
        error_details: { stack: err.stack },
        dry_run: dryRun,
        duration_ms: Date.now() - startedAt,
      });
      return { action: 'error', status: 'error', message: err.message, kiteprop_id: kp?.id };
    }

    const mappedImages = mappers.mapKitepropImagenes(kp.images_list);
    const normalizedImages = imageHelpers.normalizeKitepropImages(
      mappedImages,
      payload.kiteprop_id,
      maxImagesPerProperty()
    );
    const remoteDataHash = hashes.buildPropertyDataHash(payload);
    const remoteImagesHash = hashes.buildPropertyImagesHash(normalizedImages);
    const existing = await findByKitepropId(payload.kiteprop_id);

    result.kiteprop_id = payload.kiteprop_id;
    result.documentId = existing?.documentId;

    await logger().record({
      run_id: runId,
      source,
      resource: 'property',
      action: 'hash',
      kiteprop_id: payload.kiteprop_id,
      status: 'ok',
      message:
        `data_hash=${remoteDataHash.slice(0, 12)} images_hash=${remoteImagesHash.slice(0, 12)} ` +
        `images=${normalizedImages.length}/${mappedImages.length}`,
      dry_run: dryRun,
    });

    const existingHasSlug = !!String(existing?.Slug || '').trim();
    const shouldWriteGeneratedSlug = !!payload.Slug && (!existing || !existingHasSlug);

    const dataChanged =
      !existing ||
      shouldWriteGeneratedSlug ||
      existing.kiteprop_data_hash !== remoteDataHash ||
      mappers.isRemoteNewer(payload.kiteprop_updated_at, existing.kiteprop_updated_at);
    const imageHashChanged = !existing || existing.kiteprop_images_hash !== remoteImagesHash;

    result.data_changed = dataChanged;
    result.images_changed = isImageImportEnabled() && imageHashChanged;

    if (!dataChanged && !result.images_changed) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'skip',
        kiteprop_id: payload.kiteprop_id,
        status: 'noop',
        message: 'data_hash and images_hash unchanged',
        dry_run: dryRun,
        duration_ms: Date.now() - startedAt,
      });
      result.duration_ms = Date.now() - startedAt;
      return result;
    }

    if (dryRun) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: existing ? 'update' : 'create',
        kiteprop_id: payload.kiteprop_id,
        status: 'ok',
        message:
          `[dry-run] would ${existing ? 'UPDATE' : 'CREATE'} propiedad ` +
          `(data_changed=${dataChanged}, images_changed=${result.images_changed})`,
        dry_run: true,
        duration_ms: Date.now() - startedAt,
      });
      result.action = existing ? 'update' : 'create';
      result.status = 'ok';
      result.dry_run = true;
      result.duration_ms = Date.now() - startedAt;
      return result;
    }

    let imageStats;
    try {
      imageStats = await syncImageRelation({
        kp,
        existing,
        remoteImagesHash,
        normalizedImages,
        ctx,
      });
      result.images_changed = imageStats.images_changed;
      result.images_uploaded = imageStats.images_uploaded;
      result.images_reused = imageStats.images_reused;
      result.images_linked = imageStats.images_linked;
    } catch (err) {
      result.action = 'error';
      result.status = 'error';
      result.message = err.message;
      result.errors.push(err.message);
      result.duration_ms = Date.now() - startedAt;

      if (existing?.documentId) {
        await docs().update({
          documentId: existing.documentId,
          status: 'draft',
          data: {
            kiteprop_sync_status: 'error',
            kiteprop_sync_error: String(err.message).slice(0, 1000),
          },
        }).catch(() => {});
      }

      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'error',
        kiteprop_id: payload.kiteprop_id,
        status: 'error',
        message: `images failed; property write skipped: ${err.message}`,
        error_details: { stack: err.stack },
        dry_run: false,
        duration_ms: result.duration_ms,
      });
      return result;
    }

    const writePayload = {};
    if (dataChanged) {
      const dataPayload = { ...payload };
      if (existingHasSlug) delete dataPayload.Slug;

      Object.assign(writePayload, dataPayload, {
        kiteprop_data_hash: remoteDataHash,
        kiteprop_last_synced_at: new Date().toISOString(),
        kiteprop_synced_at: new Date().toISOString(),
      });
    }

    if (imageStats.images_changed) {
      writePayload.Imagenes = imageStats.imageIds || [];
      writePayload.kiteprop_images_hash = remoteImagesHash;
      writePayload.kiteprop_last_images_synced_at = new Date().toISOString();
      writePayload.kiteprop_imagenes = normalizedImages.map((image) => ({
        image_key: image.image_key,
        remote_image_id: image.remote_image_id,
        remote_url: image.remote_url,
        remote_url_hash: image.remote_url_hash,
        order: image.order,
      }));
    }

    writePayload.kiteprop_sync_status = 'ok';
    writePayload.kiteprop_sync_error = null;

    if (!existing) {
      try {
        const created = await writeProperty({
          existing: null,
          payload: writePayload,
          publish: !!payload.Publicado,
        });
        await logger().record({
          run_id: runId,
          source,
          resource: 'property',
          action: 'create',
          kiteprop_id: payload.kiteprop_id,
          status: 'ok',
          message: `created documentId=${created.documentId}`,
          dry_run: false,
          duration_ms: Date.now() - startedAt,
        });
        return {
          ...result,
          action: 'create',
          status: 'ok',
          documentId: created.documentId,
          duration_ms: Date.now() - startedAt,
        };
      } catch (err) {
        await logger().record({
          run_id: runId,
          source,
          resource: 'property',
          action: 'error',
          kiteprop_id: payload.kiteprop_id,
          status: 'error',
          message: `create failed: ${err.message}`,
          error_details: { stack: err.stack },
          dry_run: false,
          duration_ms: Date.now() - startedAt,
        });
        return {
          ...result,
          action: 'error',
          status: 'error',
          message: err.message,
          kiteprop_id: payload.kiteprop_id,
          errors: [err.message],
          duration_ms: Date.now() - startedAt,
        };
      }
    }

    try {
      const updated = await writeProperty({
        existing,
        payload: writePayload,
        publish: !!payload.Publicado,
      });
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'update',
        kiteprop_id: payload.kiteprop_id,
        status: 'ok',
        message: `updated documentId=${updated.documentId}`,
        dry_run: false,
        duration_ms: Date.now() - startedAt,
      });
      return {
        ...result,
        action: 'update',
        status: 'ok',
        kiteprop_id: payload.kiteprop_id,
        documentId: updated.documentId,
        duration_ms: Date.now() - startedAt,
      };
    } catch (err) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'error',
        kiteprop_id: payload.kiteprop_id,
        status: 'error',
        message: `update failed: ${err.message}`,
        error_details: { stack: err.stack },
        dry_run: false,
        duration_ms: Date.now() - startedAt,
      });
      return {
        ...result,
        action: 'error',
        status: 'error',
        message: err.message,
        kiteprop_id: payload.kiteprop_id,
        errors: [err.message],
        duration_ms: Date.now() - startedAt,
      };
    }
  }

  /**
   * Soft delete (Phase 1 enforced policy).
   *   - Publicado = false
   *   - Strapi published version is removed with documents().unpublish()
   *   - kiteprop_status = "deleted"
   * If the propiedad doesn't exist locally, log noop.
   */
  async function softDeleteProperty(kitepropId, ctx) {
    const startedAt = Date.now();
    const dryRun = !!ctx.dryRun;
    const runId = ctx.runId;
    const source = ctx.source;

    readDeleteStrategy(); // Phase 1 enforces "soft"

    const existing = await findByKitepropId(kitepropId);
    if (!existing) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'soft_delete',
        kiteprop_id: kitepropId,
        status: 'noop',
        message: 'no local propiedad with this kiteprop_id; nothing to delete',
        dry_run: dryRun,
        duration_ms: Date.now() - startedAt,
      });
      return { action: 'soft_delete', status: 'noop', kiteprop_id: kitepropId };
    }

    if (dryRun) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'soft_delete',
        kiteprop_id: kitepropId,
        status: 'ok',
        message: `[dry-run] would SOFT DELETE documentId=${existing.documentId}`,
        dry_run: true,
        duration_ms: Date.now() - startedAt,
      });
      return {
        action: 'soft_delete',
        status: 'ok',
        kiteprop_id: kitepropId,
        documentId: existing.documentId,
        dry_run: true,
      };
    }

    try {
      const payload = mappers.buildSoftDeletePayload();
      await docs().update({
        documentId: existing.documentId,
        status: 'draft',
        data: payload,
      });
      await docs().unpublish({ documentId: existing.documentId });
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'soft_delete',
        kiteprop_id: kitepropId,
        status: 'ok',
        message: `soft-deleted documentId=${existing.documentId}`,
        dry_run: false,
        duration_ms: Date.now() - startedAt,
      });
      return {
        action: 'soft_delete',
        status: 'ok',
        kiteprop_id: kitepropId,
        documentId: existing.documentId,
      };
    } catch (err) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'error',
        kiteprop_id: kitepropId,
        status: 'error',
        message: `soft delete failed: ${err.message}`,
        error_details: { stack: err.stack },
        dry_run: false,
        duration_ms: Date.now() - startedAt,
      });
      return { action: 'error', status: 'error', message: err.message, kiteprop_id: kitepropId };
    }
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Fetch a property from KiteProp and upsert it locally.
   * Convenient for testing and for processing a single activity.
   */
  async function syncOne(id, opts = {}) {
    const runId = opts.runId || newRunId();
    const dryRun = !!opts.dryRun;
    const source = opts.source || 'syncOne';
    const startedAt = Date.now();

    await logger().record({
      run_id: runId,
      source,
      resource: 'property',
      action: 'fetch',
      kiteprop_id: id,
      status: 'ok',
      message: `fetch property ${id}`,
      dry_run: dryRun,
    });

    let res;
    try {
      res = await client().getProperty(id);
    } catch (err) {
      // Per Phase 1 rule: soft_delete is RESERVED for activity.type === 'delete_property'.
      // A 404 from /properties/{id} is logged as a noop fetch — we deliberately do NOT
      // mutate the local Strapi propiedad. The next runDelta will pick up the
      // delete_property activity (if KiteProp truly deleted the resource) and apply
      // the soft delete through the proper code path. Statuses like inactive/sold/rented
      // never produce a 404; they are returned as 200 with the real status string and
      // are handled by the mapper (kiteprop_status updated, Publicado derived from status).
      if (err.status === 404) {
        await logger().record({
          run_id: runId,
          source,
          resource: 'property',
          action: 'fetch',
          kiteprop_id: id,
          status: 'noop',
          message: '404 from KiteProp; not applying soft_delete (reserved for delete_property activity)',
          dry_run: dryRun,
          duration_ms: Date.now() - startedAt,
        });
        return {
          run_id: runId,
          dry_run: dryRun,
          summary: summarize([]),
          items: [
            {
              action: 'fetch',
              status: 'noop',
              kiteprop_id: id,
              message: '404 from KiteProp',
            },
          ],
          duration_ms: Date.now() - startedAt,
        };
      }
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'error',
        kiteprop_id: id,
        status: 'error',
        message: `fetch failed: ${err.message}`,
        error_details: { status: err.status, body: err.body || null },
        dry_run: dryRun,
        duration_ms: Date.now() - startedAt,
      });
      return {
        run_id: runId,
        dry_run: dryRun,
        summary: summarize([{ action: 'error', status: 'error', kiteprop_id: id }]),
        items: [{ action: 'error', status: 'error', message: err.message, kiteprop_id: id }],
        duration_ms: Date.now() - startedAt,
      };
    }

    const payload = res?.data?.data;
    if (!payload || !payload.id) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'error',
        kiteprop_id: id,
        status: 'error',
        message: 'empty payload from KiteProp',
        dry_run: dryRun,
      });
      return {
        run_id: runId,
        dry_run: dryRun,
        summary: summarize([{ action: 'error', status: 'error', kiteprop_id: id }]),
        items: [{ action: 'error', status: 'error', kiteprop_id: id, message: 'empty payload' }],
        duration_ms: Date.now() - startedAt,
      };
    }

    const result = await upsertProperty(payload, { runId, dryRun, source });
    const syncResult = {
      run_id: runId,
      dry_run: dryRun,
      summary: summarize([result]),
      items: [result],
      duration_ms: Date.now() - startedAt,
    };
    if (!opts.suppressDeploy) {
      await maybeTriggerFrontendDeploy(syncResult, {
        reason: `syncOne property ${id}`,
        source,
        runId,
      });
    }
    return syncResult;
  }

  /**
   * Walk /properties/activities since the stored cursor.
   *
   * Order: created_at:DESC (lo más NUEVO primero).
   *   POR QUÉ desc y no asc: en asc, la página 1 trae las actividades más
   *   VIEJAS. Con el cursor adelantado (p.ej. last_activity_id muy atrás), todas
   *   las de la página 1 son <= cursor, el walk no "avanza" y corta sin llegar
   *   nunca a las actividades nuevas. Resultado real observado: activities_seen=50,
   *   items_processed=0 aunque sí había cambios recientes. Con desc recolectamos
   *   lo nuevo desde el inicio sin quedarnos atrapados en una página antigua.
   *
   * Estrategia (dos fases, conservadora con los API calls):
   *   FASE 1 — COLLECT: recorre desc y junta actividades con id > last_activity_id,
   *     hasta CRUZAR el cursor (ver un id <= last_activity_id) o agotar maxPages /
   *     llegar a la última página.
   *   FASE 2 — PROCESS: ordena las nuevas ASCENDENTE (cursor monotónico), deduplica
   *     por property_id (una propiedad con varias actividades se sincroniza una sola
   *     vez con su estado final, porque syncOne trae el estado actual de KiteProp),
   *     y procesa con stop-on-first-failure.
   *
   * Seguridad del cursor (sin pérdida de datos):
   *   Solo avanzamos el cursor si confirmamos haber visto el conjunto COMPLETO de
   *   actividades nuevas (cruzamos el cursor o leímos hasta la última página). Si
   *   agotamos maxPages sin cruzar el cursor, hay actividades nuevas más viejas que
   *   no vimos: procesamos las nuevas recolectadas (para refrescar el sitio, y es
   *   idempotente) pero NO movemos el cursor, para no saltarnos las no vistas.
   */
  async function runDelta(opts = {}) {
    const runId = opts.runId || newRunId();
    const dryRun = !!opts.dryRun;
    const source = opts.source || 'runDelta';
    const startedAt = Date.now();
    const maxPages = opts.maxPages || readEnvNumber('KITEPROP_SYNC_DELTA_MAX_PAGES', 10);
    const maxItems = readPositiveNumber(
      opts.maxItems,
      readEnvNumber('KITEPROP_SYNC_MAX_ITEMS_PER_RUN', 1)
    );
    const pageSize = readEnvNumber('KITEPROP_SYNC_PAGE_SIZE_PROPERTIES', 50);

    // Dry-run is strictly read-only against sync-state. We do NOT acquire the
    // lock and we do NOT advance any cursor — so dry-runs are safe to run
    // concurrently and never affect what the next REAL run will process.
    if (!dryRun) {
      const lock = await state().acquireLock(runId);
      if (!lock.acquired) {
        strapi.log.warn(`[kiteprop-sync] runDelta skipped: ${lock.reason}`);
        return {
          run_id: runId,
          dry_run: dryRun,
          skipped: true,
          reason: lock.reason,
          duration_ms: Date.now() - startedAt,
        };
      }
    }

    const items = [];
    const propertiesProcessed = new Set();
    const deletionsProcessed = new Set();
    let lastError = null;
    let activitiesSeen = 0;
    let itemsProcessed = 0;
    let pagesRead = 0;
    let newActivitiesCollected = 0;
    let relevantActivities = 0;
    let ignoredOldActivities = 0;
    let ignoredIrrelevantActivities = 0;
    let abortedAtActivityId = null;
    let lastSuccessfulActivityId = null;
    let fromActivityId = 0;
    let boundaryReached = false;

    try {
      const current = await state().read();
      fromActivityId =
        opts.fromActivityId !== undefined
          ? Number(opts.fromActivityId)
          : current.last_activity_id
            ? Number(current.last_activity_id)
            : 0;

      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'delta',
        status: 'ok',
        message: `start runDelta order=created_at:desc fromActivityId=${fromActivityId} maxPages=${maxPages} maxItems=${maxItems}${dryRun ? ' (dry-run: cursor will NOT advance)' : ''}`,
        dry_run: dryRun,
      });

      // -----------------------------------------------------------------------
      // FASE 1 — COLLECT (created_at:desc, lo más nuevo primero)
      // -----------------------------------------------------------------------
      const newActivities = [];
      let reachedKnown = false; // cruzamos el cursor (id <= fromActivityId)
      let reachedEnd = false; // leímos la última página (no quedan más viejas)
      let page = 1;
      while (page <= maxPages) {
        const res = await client().listActivities({
          page,
          limit: pageSize,
          order: 'created_at:desc',
        });
        const activities = res?.data?.data || [];
        pagesRead += 1;
        if (activities.length === 0) {
          reachedEnd = true;
          break;
        }

        for (const activity of activities) {
          activitiesSeen += 1;
          const activityId = Number(activity.id);
          if (!Number.isFinite(activityId)) continue;
          if (activityId <= fromActivityId) {
            // Cruzamos al territorio ya conocido: de aquí en más todo es viejo.
            ignoredOldActivities += 1;
            reachedKnown = true;
            break;
          }
          newActivities.push(activity);
        }

        if (reachedKnown) break;
        // Página incompleta = última página (las actividades más viejas).
        if (activities.length < pageSize) {
          reachedEnd = true;
          break;
        }
        page += 1;
      }

      newActivitiesCollected = newActivities.length;
      // Solo es seguro avanzar el cursor si vimos el conjunto completo de nuevas.
      boundaryReached = reachedKnown || reachedEnd;
      if (!boundaryReached) {
        strapi.log.warn(
          `[kiteprop-sync] runDelta: hay backlog > maxPages(${maxPages}); se procesan las nuevas recolectadas pero el cursor NO avanza esta corrida para no saltar actividades. Subir KITEPROP_SYNC_DELTA_MAX_PAGES para drenar de una vez.`
        );
      }

      // -----------------------------------------------------------------------
      // FASE 2 — PROCESS ascendente (cursor monotónico) con dedupe + stop-on-fail
      // -----------------------------------------------------------------------
      newActivities.sort((a, b) => Number(a.id) - Number(b.id));

      // Solo movemos el cursor real si NO es dry-run y confirmamos contigüidad.
      const canAdvanceCursor = !dryRun && boundaryReached;

      for (const activity of newActivities) {
        const activityId = Number(activity.id);

        // Tipos irrelevantes: no son fallos, solo no los procesamos. Acusables
        // (avanzan el cursor) para no re-mirarlos.
        if (!ACTIVITY_TYPES_RELEVANT.has(activity.type)) {
          ignoredIrrelevantActivities += 1;
          if (canAdvanceCursor) await state().bumpActivityCursor(activity);
          lastSuccessfulActivityId = activityId;
          continue;
        }

        // Actividad mal formada (sin property_id): glitch de datos, no un fallo.
        const propertyId = Number(activity.property_id);
        if (!Number.isFinite(propertyId) || propertyId <= 0) {
          if (canAdvanceCursor) await state().bumpActivityCursor(activity);
          lastSuccessfulActivityId = activityId;
          continue;
        }

        relevantActivities += 1;

        // softDeleteProperty y syncOne SIEMPRE retornan (nunca lanzan):
        //   - éxito  -> { status: 'ok' | 'noop', ... }
        //   - fallo  -> { status: 'error', ... } DESPUÉS de loguear.
        // Inspeccionamos el retorno para decidir si avanzar el cursor.
        let activityFailed = false;
        let activityFailureReason = null;
        let processedThisActivity = false;

        if (activity.type === ACTIVITY_TYPE_DELETE) {
          if (!deletionsProcessed.has(propertyId)) {
            const r = await softDeleteProperty(propertyId, { runId, dryRun, source });
            items.push(r);
            deletionsProcessed.add(propertyId);
            processedThisActivity = true;
            if (r && r.status === 'error') {
              activityFailed = true;
              activityFailureReason = r.message || 'softDeleteProperty returned error';
            }
          }
        } else {
          // Dedupe por property_id: una propiedad con varias actividades nuevas se
          // sincroniza una sola vez (estado final desde KiteProp).
          if (!propertiesProcessed.has(propertyId) && !deletionsProcessed.has(propertyId)) {
            const r = await syncOne(propertyId, { runId, dryRun, source, suppressDeploy: true });
            items.push(...r.items);
            propertiesProcessed.add(propertyId);
            processedThisActivity = true;
            const failedItem = (r.items || []).find((it) => it && it.status === 'error');
            if (failedItem) {
              activityFailed = true;
              activityFailureReason = failedItem.message || 'syncOne returned an error item';
            }
          }
        }

        if (activityFailed) {
          // No avanzar el cursor más allá de la última actividad exitosa: la
          // próxima corrida reintenta desde aquí. La idempotencia (data_hash)
          // hace barato re-procesar las que ya estaban OK.
          abortedAtActivityId = activityId;
          lastError = new Error(
            `Activity ${activityId} (property_id=${propertyId}, type=${activity.type}) failed: ${activityFailureReason}`
          );
          await logger().record({
            run_id: runId,
            source,
            resource: 'property',
            action: 'delta',
            kiteprop_id: propertyId,
            status: 'error',
            message:
              `Aborting runDelta at activity_id=${activityId} to avoid losing changes. ` +
              `Cursor stays at ${lastSuccessfulActivityId ?? fromActivityId}. ` +
              `Reason: ${activityFailureReason}`,
            dry_run: dryRun,
          });
          break;
        }

        // Éxito: avanzar cursor (solo en corridas reales y con contigüidad).
        if (canAdvanceCursor) await state().bumpActivityCursor(activity);
        lastSuccessfulActivityId = activityId;

        if (processedThisActivity) {
          itemsProcessed += 1;
          if (itemsProcessed >= maxItems) break;
        }
      }
    } catch (err) {
      // Errores de listActivities (transporte) o cualquier throw inesperado.
      // No avanzamos cursor más allá de lo ya commiteado item-a-item.
      lastError = err;
      strapi.log.error(`[kiteprop-sync] runDelta error: ${err.message}`);
    } finally {
      if (!dryRun) {
        await state().releaseLock({ success: !lastError, error: lastError });
      }
    }

    // El cursor real solo cambió si NO fue dry-run y hubo contigüidad confirmada.
    const finalCursor =
      !dryRun && boundaryReached && lastSuccessfulActivityId !== null
        ? lastSuccessfulActivityId
        : fromActivityId;

    const summary = summarize(items);
    summary.activities_seen = activitiesSeen;
    summary.items_processed = itemsProcessed;
    summary.max_items = maxItems;
    summary.pages_read = pagesRead;
    summary.new_activities_collected = newActivitiesCollected;
    summary.relevant_activities = relevantActivities;
    summary.ignored_old_activities = ignoredOldActivities;
    summary.ignored_irrelevant_activities = ignoredIrrelevantActivities;
    summary.boundary_reached = boundaryReached;
    summary.from_activity_id = fromActivityId;
    summary.final_cursor = finalCursor;
    summary.last_successful_activity_id = lastSuccessfulActivityId;
    summary.aborted_at_activity_id = abortedAtActivityId;

    await logger().record({
      run_id: runId,
      source,
      resource: 'property',
      action: 'delta',
      status: lastError ? 'error' : 'ok',
      message:
        `runDelta finished — fromActivityId=${fromActivityId} pagesRead=${pagesRead} ` +
        `activitiesSeen=${activitiesSeen} newActivitiesCollected=${newActivitiesCollected} ` +
        `relevantActivities=${relevantActivities} ignoredOldActivities=${ignoredOldActivities} ` +
        `ignoredIrrelevantActivities=${ignoredIrrelevantActivities} itemsProcessed=${itemsProcessed} ` +
        `boundaryReached=${boundaryReached} finalCursor=${finalCursor} ${JSON.stringify(summary)}`,
      error_details: lastError ? { message: lastError.message } : null,
      dry_run: dryRun,
      duration_ms: Date.now() - startedAt,
    });

    const result = {
      run_id: runId,
      dry_run: dryRun,
      summary,
      items,
      error: lastError ? lastError.message : null,
      aborted_at_activity_id: abortedAtActivityId,
      last_successful_activity_id: lastSuccessfulActivityId,
      duration_ms: Date.now() - startedAt,
    };
    if (!opts.suppressDeploy) {
      await maybeTriggerFrontendDeploy(result, {
        reason: 'runDelta real property changes',
        source,
        runId,
      });
    }
    return result;
  }

  /**
   * Detect newly created properties using GET /properties?order=id:desc.
   *
   * Two-phase design (stop-on-first-failure safe):
   *
   *   PHASE 1 — COLLECT
   *     Walk /properties?order=id:desc gathering candidate ids that are
   *     STRICTLY greater than `last_max_property_id`. Stop walking pages as
   *     soon as we see an id <= knownMaxId (KiteProp returns id:desc, so
   *     anything beyond that point is older and already known).
   *
   *   PHASE 2 — PROCESS
   *     Sort the candidate ids ASCENDING and process them one by one via
   *     syncOne(). After each successful candidate (create/update/noop), the
   *     sniffer cursor advances to that id and our local
   *     `lastSuccessfulPropertyId` is recorded for the response payload.
   *
   *     If any property fails (HTTP error, mapper error, Strapi write
   *     error), we ABORT the run: we do NOT process subsequent ids and we
   *     do NOT advance last_max_property_id past the failed id. This
   *     guarantees the failed property AND every newer property remain
   *     visible to the next sniffer run (which will re-collect them).
   *
   * First-run guard:
   *   When last_max_property_id is 0 (never synced), we cap the collection
   *   to a single page (`pageSize` properties) to avoid an unintended
   *   full-catalog backfill on day 1.
   */
  async function runSniffer(opts = {}) {
    const runId = opts.runId || newRunId();
    const dryRun = !!opts.dryRun;
    const source = opts.source || 'runSniffer';
    const startedAt = Date.now();
    const pageSize = readEnvNumber('KITEPROP_SYNC_PAGE_SIZE_PROPERTIES', 50);
    const maxPages = opts.maxPages || readEnvNumber('KITEPROP_SYNC_SNIFFER_MAX_PAGES', 1);
    const maxItems = readPositiveNumber(
      opts.maxItems,
      readEnvNumber('KITEPROP_SYNC_MAX_ITEMS_PER_RUN', 1)
    );

    // Dry-run is strictly read-only against sync-state. We do NOT acquire the
    // lock and we do NOT advance last_max_property_id (that happens inside
    // runSniffer's per-candidate success path via bumpMaxPropertyId).
    if (!dryRun) {
      const lock = await state().acquireLock(runId);
      if (!lock.acquired) {
        strapi.log.warn(`[kiteprop-sync] runSniffer skipped: ${lock.reason}`);
        return {
          run_id: runId,
          dry_run: dryRun,
          skipped: true,
          reason: lock.reason,
          duration_ms: Date.now() - startedAt,
        };
      }
    }

    const items = [];
    let lastError = null;
    let propertiesSeen = 0;
    let isFirstRun = false;
    let abortedAtPropertyId = null;
    let lastSuccessfulPropertyId = null;
    const candidateIds = [];

    try {
      const current = await state().read();
      const knownMaxId = current.last_max_property_id ? Number(current.last_max_property_id) : 0;
      isFirstRun = knownMaxId === 0;
      const effectiveMaxPages = isFirstRun ? 1 : maxPages;

      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'sniffer',
        status: 'ok',
        message: `start runSniffer knownMaxId=${knownMaxId} maxPages=${effectiveMaxPages}, maxItems=${maxItems}${isFirstRun ? ' (first-run; capped to 1 page)' : ''}${dryRun ? ' (dry-run: state will NOT advance)' : ''}`,
        dry_run: dryRun,
      });

      // ---------------------------------------------------------------------
      // PHASE 1 — COLLECT candidate ids (id:desc walk, filter > knownMaxId)
      // ---------------------------------------------------------------------
      let stopCollecting = false;
      let page = 1;
      while (page <= effectiveMaxPages && !stopCollecting) {
        const res = await client().listProperties({ page, limit: pageSize, order: 'id:desc' });
        const list = res?.data?.data || [];
        if (list.length === 0) break;

        for (const remoteSummary of list) {
          propertiesSeen += 1;
          const remoteId = Number(remoteSummary.id);
          if (!Number.isFinite(remoteId)) continue;

          // Strictly greater. KiteProp returns id:desc, so as soon as we hit
          // an id <= knownMaxId, every subsequent id on this page (and on
          // later pages) is already known. We can stop collecting safely.
          if (!isFirstRun && remoteId <= knownMaxId) {
            stopCollecting = true;
            break;
          }

          candidateIds.push(remoteId);
        }

        if (stopCollecting) break;
        if (list.length < pageSize) break;
        page += 1;
      }

      // ---------------------------------------------------------------------
      // PHASE 2 — PROCESS ascending with stop-on-first-failure
      // ---------------------------------------------------------------------
      candidateIds.sort((a, b) => a - b);

      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'sniffer',
        status: 'ok',
        message: `collected ${candidateIds.length} candidate id(s) > ${knownMaxId}; processing up to ${maxItems} ascending`,
        dry_run: dryRun,
      });

      const candidateIdsToProcess = candidateIds.slice(0, maxItems);
      for (const candidateId of candidateIdsToProcess) {
        const r = await syncOne(candidateId, { runId, dryRun, source, suppressDeploy: true });
        items.push(...r.items);

        // syncOne never throws; failures surface as items with status === 'error'.
        // Note: a 404 returns status='noop' (after the earlier fix) and is NOT
        // treated as a failure here.
        const failedItem = (r.items || []).find((it) => it && it.status === 'error');

        if (failedItem) {
          abortedAtPropertyId = candidateId;
          lastError = new Error(
            `Property ${candidateId} failed during sniffer: ${failedItem.message || 'see logs'}`
          );
          await logger().record({
            run_id: runId,
            source,
            resource: 'property',
            action: 'sniffer',
            kiteprop_id: candidateId,
            status: 'error',
            message:
              `Aborting runSniffer at property_id=${candidateId} to avoid losing new properties. ` +
              `last_max_property_id stays at ${lastSuccessfulPropertyId ?? knownMaxId}. ` +
              `Reason: ${failedItem.message || 'syncOne returned an error item'}`,
            dry_run: dryRun,
          });
          break;
        }

        // Success path: only sniffer advances the id cursor. Delta/manual sync
        // can touch high ids and must not hide lower, not-yet-sniffed creations.
        if (!dryRun) await state().bumpMaxPropertyId(candidateId);
        lastSuccessfulPropertyId = candidateId;
      }
    } catch (err) {
      // Errors here come from listProperties (HTTP transport) or any unexpected
      // throw outside the per-item try/catch. The cursor advances ONLY through
      // bumpMaxPropertyId on real successful sniffer candidates, so partial progress is safe.
      lastError = err;
      strapi.log.error(`[kiteprop-sync] runSniffer error: ${err.message}`);
    } finally {
      // Lock + last_run_at / last_success_at / last_error are written only on
      // real runs. Dry-run leaves sync-state untouched.
      if (!dryRun) {
        await state().releaseLock({ success: !lastError, error: lastError });
      }
    }

    const summary = summarize(items);
    summary.properties_seen = propertiesSeen;
    summary.candidates_count = candidateIds.length;
    summary.items_processed = items.length;
    summary.max_items = maxItems;
    summary.first_run = isFirstRun;
    summary.last_successful_property_id = lastSuccessfulPropertyId;
    summary.aborted_at_property_id = abortedAtPropertyId;

    await logger().record({
      run_id: runId,
      source,
      resource: 'property',
      action: 'sniffer',
      status: lastError ? 'error' : 'ok',
      message: `runSniffer finished — ${JSON.stringify(summary)}`,
      error_details: lastError ? { message: lastError.message } : null,
      dry_run: dryRun,
      duration_ms: Date.now() - startedAt,
    });

    const result = {
      run_id: runId,
      dry_run: dryRun,
      summary,
      items,
      error: lastError ? lastError.message : null,
      aborted_at_property_id: abortedAtPropertyId,
      last_successful_property_id: lastSuccessfulPropertyId,
      duration_ms: Date.now() - startedAt,
    };
    if (!opts.suppressDeploy) {
      await maybeTriggerFrontendDeploy(result, {
        reason: 'runSniffer real property changes',
        source,
        runId,
      });
    }
    return result;
  }

  async function runNext(opts = {}) {
    const runId = opts.runId || newRunId();
    const dryRun = !!opts.dryRun;
    const startedAt = Date.now();
    const maxPages = opts.maxPages || readEnvNumber('KITEPROP_SYNC_DELTA_MAX_PAGES', 1);
    const maxItems = 1;

    const delta = await runDelta({
      ...opts,
      runId,
      dryRun,
      source: opts.source || 'runNext:delta',
      maxPages,
      maxItems,
      suppressDeploy: true,
    });

    if (delta.skipped || delta.error || (delta.items || []).length > 0) {
      await maybeTriggerFrontendDeploy(delta, {
        reason: 'runNext real property changes',
        source: opts.source || 'runNext:delta',
        runId,
      });
      return formatRunNextResult(delta, startedAt);
    }

    const sniffer = await runSniffer({
      ...opts,
      runId,
      dryRun,
      source: opts.source || 'runNext:sniffer',
      maxPages: opts.maxPages || readEnvNumber('KITEPROP_SYNC_SNIFFER_MAX_PAGES', 1),
      maxItems,
      suppressDeploy: true,
    });

    await maybeTriggerFrontendDeploy(sniffer, {
      reason: 'runNext real property changes',
      source: opts.source || 'runNext:sniffer',
      runId,
    });
    return formatRunNextResult(sniffer, startedAt);
  }

  async function runAll(opts = {}) {
    const runId = opts.runId || newRunId();
    const dryRun = !!opts.dryRun;
    const startedAt = Date.now();
    const source = opts.source || 'runAll';

    const delta = await runDelta({
      ...opts,
      runId,
      dryRun,
      source: `${source}:delta`,
      suppressDeploy: true,
    });

    const sniffer = await runSniffer({
      ...opts,
      runId,
      dryRun,
      source: `${source}:sniffer`,
      suppressDeploy: true,
    });

    const combined = combineSyncResults({
      runId,
      dryRun,
      results: [delta, sniffer],
      durationMs: Date.now() - startedAt,
    });

    await maybeTriggerFrontendDeploy(combined, {
      reason: 'runAll real property changes',
      source,
      runId,
    });

    return { ok: !combined.error, dry_run: dryRun, delta, sniffer, combined };
  }

  async function runInterval(opts = {}) {
    const runId = opts.runId || newRunId();
    const dryRun = !!opts.dryRun;
    const startedAt = Date.now();
    const source = opts.source || 'interval';

    const delta = await runDelta({
      ...opts,
      runId,
      dryRun,
      source: `${source}:delta`,
      suppressDeploy: true,
    });

    const sniffer = await runSniffer({
      ...opts,
      runId,
      dryRun,
      source: `${source}:sniffer`,
      suppressDeploy: true,
    });

    const combined = combineSyncResults({
      runId,
      dryRun,
      results: [delta, sniffer],
      durationMs: Date.now() - startedAt,
    });

    await maybeTriggerFrontendDeploy(combined, {
      reason: 'interval real property changes',
      source,
      runId,
    });

    return { ok: !combined.error, dry_run: dryRun, delta, sniffer, combined };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function summarize(items) {
    const summary = { created: 0, updated: 0, soft_deleted: 0, skipped: 0, errors: 0 };
    for (const it of items) {
      if (!it) continue;
      if (it.action === 'create' && it.status === 'ok') summary.created += 1;
      else if (it.action === 'update' && it.status === 'ok') summary.updated += 1;
      else if (it.action === 'soft_delete' && it.status === 'ok') summary.soft_deleted += 1;
      else if (it.status === 'noop') summary.skipped += 1;
      else if (it.status === 'error') summary.errors += 1;
    }
    return summary;
  }

  function formatRunNextResult(runResult, startedAt) {
    const item = (runResult.items || [])[0] || null;
    const errors = [];
    if (runResult.error) errors.push(runResult.error);
    if (item?.status === 'error' && item.message) errors.push(item.message);

    return {
      ok: errors.length === 0,
      run_id: runResult.run_id,
      dry_run: !!runResult.dry_run,
      skipped: !!runResult.skipped,
      reason: runResult.reason || null,
      kiteprop_id: item?.kiteprop_id || null,
      action: item?.action || (runResult.skipped ? 'skipped' : 'skip'),
      data_changed: !!item?.data_changed,
      images_changed: !!item?.images_changed,
      images_uploaded: item?.images_uploaded || 0,
      images_reused: item?.images_reused || 0,
      images_linked: item?.images_linked || 0,
      errors,
      summary: runResult.summary || null,
      duration_ms: Date.now() - startedAt,
    };
  }

  function combineSyncResults({ runId, dryRun, results, durationMs }) {
    const items = results.flatMap((result) => result?.items || []);
    const summary = summarize(items);
    const errors = results
      .map((result) => result?.error)
      .filter((error) => typeof error === 'string' && error.trim());

    return {
      run_id: runId,
      dry_run: !!dryRun,
      summary,
      items,
      error: errors.length > 0 ? errors.join('; ') : null,
      duration_ms: durationMs,
    };
  }

  async function maybeTriggerFrontendDeploy(syncResult, { reason, source, runId }) {
    // Un dry-run nunca debe deployar ni tocar el estado de deploy.
    if (syncResult && syncResult.dry_run) return null;

    const deploy = frontendDeploy();
    const decision = deploy.shouldTriggerDeployFromSyncResult(syncResult);

    // Delegamos SIEMPRE al coordinador (punto único de decisión):
    //   - si hubo cambios reales -> marca pendiente y deploya (respetando debounce);
    //   - si no hubo cambios -> igualmente intenta drenar un deploy que pudiera
    //     haber quedado pendiente de una corrida anterior (hook caído / debounce).
    // El coordinador NO deploya solo por haber corrido: solo si pending_deploy=true.
    return deploy.maybeTriggerDeploy({
      reason,
      source,
      runId,
      changedItems: decision.changedItems,
      dryRun: !!syncResult.dry_run,
      error: syncResult.error,
    });
  }

  /**
   * Envuelve un método público del sync para señalar a los lifecycles de
   * `propiedad` que el sync está escribiendo en Strapi. POR QUÉ: así los
   * lifecycles NO marcan deploy por cada write del sync (evita el loop /
   * deploys duplicados). El deploy lo decide el final de la corrida, agrupado.
   */
  function withSyncWrites(fn) {
    return async function (...args) {
      const deploy = frontendDeploy();
      deploy.beginSyncWrites();
      try {
        return await fn(...args);
      } finally {
        deploy.endSyncWrites();
      }
    };
  }

  return {
    syncOne: withSyncWrites(syncOne),
    runDelta: withSyncWrites(runDelta),
    runSniffer: withSyncWrites(runSniffer),
    runNext: withSyncWrites(runNext),
    runAll: withSyncWrites(runAll),
    runInterval: withSyncWrites(runInterval),
    // Internal helpers exposed for testing/ops
    _internal: {
      upsertProperty,
      softDeleteProperty,
      findByKitepropId,
      summarize,
      formatRunNextResult,
      combineSyncResults,
    },
  };
};

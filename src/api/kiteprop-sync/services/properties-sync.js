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
  const state = () => strapi.service('api::kiteprop-sync.state');
  const logger = () => strapi.service('api::kiteprop-sync.logger');
  const docs = () => strapi.documents(PROPIEDAD_UID);

  /**
   * Find an existing Strapi propiedad by KiteProp id.
   * Returns the document (with documentId) or null.
   */
  async function findByKitepropId(kitepropId) {
    if (!kitepropId) return null;
    const found = await docs().findFirst({
      filters: { kiteprop_id: Number(kitepropId) },
      // We need kiteprop_updated_at for idempotency and Publicado for delete decisions.
      fields: ['id', 'documentId', 'kiteprop_id', 'kiteprop_updated_at', 'kiteprop_status', 'Publicado'],
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

  function pickImageUrl(image) {
    return image?.lg || image?.md || image?.sm || image?.url || null;
  }

  function buildImageName(kitepropId, image, index) {
    const remoteKey =
      image?.id ||
      crypto.createHash('sha1').update(pickImageUrl(image) || String(index)).digest('hex').slice(0, 10);
    return `kiteprop-${kitepropId}-${remoteKey}`;
  }

  async function findUploadedImageByName(name) {
    return strapi.db.query('plugin::upload.file').findOne({
      where: { name },
      select: ['id', 'name', 'url'],
    });
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

  async function uploadKitepropImage({ kitepropId, image, index }) {
    const url = pickImageUrl(image);
    if (!url) return null;

    const name = buildImageName(kitepropId, image, index);
    const existing = await findUploadedImageByName(name);
    if (existing) return existing;

    let file;
    try {
      file = await downloadRemoteImage(url, name);
      const uploaded = await strapi.plugin('upload').service('upload').upload({
        data: {
          fileInfo: {
            name,
            alternativeText: image?.title || `KiteProp property ${kitepropId}`,
            caption: image?.title || null,
          },
        },
        files: file,
      });
      return Array.isArray(uploaded) ? uploaded[0] : uploaded;
    } finally {
      if (file?.filepath) await fs.remove(file.filepath).catch(() => {});
    }
  }

  async function buildImageRelationPayload(kp, existing, ctx) {
    if (!isImageImportEnabled()) return undefined;

    const images = mappers.mapKitepropImagenes(kp.images_list);
    if (images.length === 0) return [];

    const uploadedIds = [];
    for (let i = 0; i < images.length; i += 1) {
      try {
        const uploaded = await uploadKitepropImage({
          kitepropId: kp.id,
          image: images[i],
          index: i,
        });
        if (uploaded?.id) uploadedIds.push(uploaded.id);
      } catch (err) {
        await logger().record({
          run_id: ctx.runId,
          source: ctx.source,
          resource: 'property',
          action: 'error',
          kiteprop_id: kp.id,
          status: 'error',
          message: `image import failed: ${err.message}`,
          error_details: { image: images[i], stack: err.stack },
          dry_run: !!ctx.dryRun,
        });
      }
    }

    if (uploadedIds.length > 0) return uploadedIds;
    if (existing?.Imagenes?.length) return existing.Imagenes.map((img) => img.id).filter(Boolean);
    return undefined;
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

    const existing = await findByKitepropId(payload.kiteprop_id);
    const remoteImageCount = mappers.mapKitepropImagenes(kp.images_list).length;
    const localImageCount = Array.isArray(existing?.Imagenes) ? existing.Imagenes.length : 0;
    const imageDrift = isImageImportEnabled() && remoteImageCount !== localImageCount;

    // Idempotency: skip when nothing changed.
    if (
      existing &&
      !imageDrift &&
      !mappers.isRemoteNewer(payload.kiteprop_updated_at, existing.kiteprop_updated_at)
    ) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'skip',
        kiteprop_id: payload.kiteprop_id,
        status: 'noop',
        message: `local kiteprop_updated_at >= remote (${existing.kiteprop_updated_at})`,
        dry_run: dryRun,
        duration_ms: Date.now() - startedAt,
      });
      return {
        action: 'skip',
        status: 'noop',
        kiteprop_id: payload.kiteprop_id,
        documentId: existing.documentId,
      };
    }

    // Decide CREATE vs UPDATE.
    if (!existing) {
      if (dryRun) {
        await logger().record({
          run_id: runId,
          source,
          resource: 'property',
          action: 'create',
          kiteprop_id: payload.kiteprop_id,
          status: 'ok',
          message: `[dry-run] would CREATE propiedad`,
          dry_run: true,
          duration_ms: Date.now() - startedAt,
        });
        return { action: 'create', status: 'ok', kiteprop_id: payload.kiteprop_id, dry_run: true };
      }

      try {
        const imageIds = await buildImageRelationPayload(kp, existing, ctx);
        if (imageIds !== undefined) payload.Imagenes = imageIds;

        const created = await writeProperty({
          existing: null,
          payload,
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
        await state().bumpMaxPropertyId(payload.kiteprop_id);
        return {
          action: 'create',
          status: 'ok',
          kiteprop_id: payload.kiteprop_id,
          documentId: created.documentId,
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
          action: 'error',
          status: 'error',
          message: err.message,
          kiteprop_id: payload.kiteprop_id,
        };
      }
    }

    // UPDATE
    if (dryRun) {
      await logger().record({
        run_id: runId,
        source,
        resource: 'property',
        action: 'update',
        kiteprop_id: payload.kiteprop_id,
        status: 'ok',
        message: `[dry-run] would UPDATE documentId=${existing.documentId}`,
        dry_run: true,
        duration_ms: Date.now() - startedAt,
      });
      return {
        action: 'update',
        status: 'ok',
        kiteprop_id: payload.kiteprop_id,
        documentId: existing.documentId,
        dry_run: true,
      };
    }

    try {
      const imageIds = await buildImageRelationPayload(kp, existing, ctx);
      if (imageIds !== undefined) payload.Imagenes = imageIds;

      const updated = await writeProperty({
        existing,
        payload,
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
      await state().bumpMaxPropertyId(payload.kiteprop_id);
      return {
        action: 'update',
        status: 'ok',
        kiteprop_id: payload.kiteprop_id,
        documentId: updated.documentId,
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
        action: 'error',
        status: 'error',
        message: err.message,
        kiteprop_id: payload.kiteprop_id,
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
    return {
      run_id: runId,
      dry_run: dryRun,
      summary: summarize([result]),
      items: [result],
      duration_ms: Date.now() - startedAt,
    };
  }

  /**
   * Walk /properties/activities since the stored cursor.
   *   - Order: created_at:asc (so we can advance the cursor monotonically).
   *   - For each activity:
   *       - delete_property → softDeleteProperty(property_id)
   *       - any other relevant type → syncOne(property_id)
   *   - Activities for the same property are deduplicated within a run
   *     (we only fetch each property once per run).
   *
   * Limitations from KiteProp docs:
   *   - There is no "property_created" activity type. Use runSniffer() for new IDs.
   */
  async function runDelta(opts = {}) {
    const runId = opts.runId || newRunId();
    const dryRun = !!opts.dryRun;
    const source = opts.source || 'runDelta';
    const startedAt = Date.now();
    const maxPages = opts.maxPages || readEnvNumber('KITEPROP_SYNC_DELTA_MAX_PAGES', 20);
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
    let abortedAtActivityId = null;
    let lastSuccessfulActivityId = null;

    try {
      const current = await state().read();
      const fromActivityId =
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
        message: `start runDelta from activity_id>${fromActivityId}, maxPages=${maxPages}${dryRun ? ' (dry-run: cursor will NOT advance)' : ''}`,
        dry_run: dryRun,
      });

      let page = 1;
      while (page <= maxPages && abortedAtActivityId === null) {
        const res = await client().listActivities({
          page,
          limit: pageSize,
          order: 'created_at:asc',
        });
        const activities = res?.data?.data || [];
        if (activities.length === 0) break;

        let advanced = false;

        for (const activity of activities) {
          activitiesSeen += 1;
          const activityId = Number(activity.id);
          if (!Number.isFinite(activityId)) continue;
          if (activityId <= fromActivityId) continue;
          advanced = true;

          // Skip irrelevant activity types — these are not "failures",
          // just things we don't process. Safe to advance the cursor.
          if (!ACTIVITY_TYPES_RELEVANT.has(activity.type)) {
            if (!dryRun) await state().bumpActivityCursor(activity);
            lastSuccessfulActivityId = activityId;
            continue;
          }

          // Same for malformed activities (missing property_id) — KiteProp data
          // glitch, not a sync failure. Advance and move on.
          const propertyId = Number(activity.property_id);
          if (!Number.isFinite(propertyId) || propertyId <= 0) {
            if (!dryRun) await state().bumpActivityCursor(activity);
            lastSuccessfulActivityId = activityId;
            continue;
          }

          // Process the activity. Capture the result so we can detect failures.
          // Both `softDeleteProperty` and `syncOne` ALWAYS return (never throw):
          //   - On success they return { status: 'ok' | 'noop', ... }
          //   - On failure they return { status: 'error', ... } AFTER logging.
          // We must inspect the return value to decide whether to advance the
          // cursor — otherwise a transient HTTP/DB failure would silently lose
          // the activity forever.
          let activityFailed = false;
          let activityFailureReason = null;

          if (activity.type === ACTIVITY_TYPE_DELETE) {
            if (!deletionsProcessed.has(propertyId)) {
              const r = await softDeleteProperty(propertyId, { runId, dryRun, source });
              items.push(r);
              deletionsProcessed.add(propertyId);
              if (r && r.status === 'error') {
                activityFailed = true;
                activityFailureReason = r.message || 'softDeleteProperty returned error';
              }
            }
          } else {
            // Group changes per property within this run to avoid duplicate fetches.
            if (!propertiesProcessed.has(propertyId) && !deletionsProcessed.has(propertyId)) {
              const r = await syncOne(propertyId, { runId, dryRun, source });
              items.push(...r.items);
              propertiesProcessed.add(propertyId);
              const failedItem = (r.items || []).find((it) => it && it.status === 'error');
              if (failedItem) {
                activityFailed = true;
                activityFailureReason = failedItem.message || 'syncOne returned an error item';
              }
            }
          }

          if (activityFailed) {
            // CRITICAL: do NOT advance the cursor. Abort the run so the next
            // run retries from this exact activity. Idempotency in upsertProperty
            // (`isRemoteNewer`) makes any re-processed siblings cheap on retry.
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
            break; // exit for-of (will also exit while via abortedAtActivityId guard)
          }

          // Success path: advance cursor (only on real runs).
          if (!dryRun) await state().bumpActivityCursor(activity);
          lastSuccessfulActivityId = activityId;
        }

        if (abortedAtActivityId !== null) break;
        if (!advanced) break;
        if (activities.length < pageSize) break;
        page += 1;
      }
    } catch (err) {
      // Errors here come from listActivities (HTTP transport) or any unexpected
      // throw. Either way: do NOT advance any cursor beyond what was already
      // committed item-by-item (we already only commit on success).
      lastError = err;
      strapi.log.error(`[kiteprop-sync] runDelta error: ${err.message}`);
    } finally {
      // Lock + last_run_at / last_success_at / last_error are written only on
      // real runs. Dry-run leaves sync-state untouched.
      if (!dryRun) {
        await state().releaseLock({ success: !lastError, error: lastError });
      }
    }

    const summary = summarize(items);
    summary.activities_seen = activitiesSeen;
    summary.last_successful_activity_id = lastSuccessfulActivityId;
    summary.aborted_at_activity_id = abortedAtActivityId;

    await logger().record({
      run_id: runId,
      source,
      resource: 'property',
      action: 'delta',
      status: lastError ? 'error' : 'ok',
      message: `runDelta finished — ${JSON.stringify(summary)}`,
      error_details: lastError ? { message: lastError.message } : null,
      dry_run: dryRun,
      duration_ms: Date.now() - startedAt,
    });

    return {
      run_id: runId,
      dry_run: dryRun,
      summary,
      items,
      error: lastError ? lastError.message : null,
      aborted_at_activity_id: abortedAtActivityId,
      last_successful_activity_id: lastSuccessfulActivityId,
      duration_ms: Date.now() - startedAt,
    };
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
   *     syncOne(). After each successful upsert, `bumpMaxPropertyId` is
   *     called inside upsertProperty (non-dry path only) and our local
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
    const maxPages = opts.maxPages || readEnvNumber('KITEPROP_SYNC_SNIFFER_MAX_PAGES', 5);

    // Dry-run is strictly read-only against sync-state. We do NOT acquire the
    // lock and we do NOT advance last_max_property_id (that happens inside
    // upsertProperty's non-dry branch via bumpMaxPropertyId).
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
        message: `start runSniffer knownMaxId=${knownMaxId} maxPages=${effectiveMaxPages}${isFirstRun ? ' (first-run; capped to 1 page)' : ''}${dryRun ? ' (dry-run: state will NOT advance)' : ''}`,
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
        message: `collected ${candidateIds.length} candidate id(s) > ${knownMaxId}; processing ascending`,
        dry_run: dryRun,
      });

      for (const candidateId of candidateIds) {
        const r = await syncOne(candidateId, { runId, dryRun, source });
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

        // Success path: bumpMaxPropertyId was already invoked inside
        // upsertProperty (non-dry path), advancing the state cursor to this id.
        // We track the high-water mark here for the response payload.
        lastSuccessfulPropertyId = candidateId;
      }
    } catch (err) {
      // Errors here come from listProperties (HTTP transport) or any unexpected
      // throw outside the per-item try/catch. The cursor advances ONLY through
      // bumpMaxPropertyId on real successful upserts, so partial progress is safe.
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

    return {
      run_id: runId,
      dry_run: dryRun,
      summary,
      items,
      error: lastError ? lastError.message : null,
      aborted_at_property_id: abortedAtPropertyId,
      last_successful_property_id: lastSuccessfulPropertyId,
      duration_ms: Date.now() - startedAt,
    };
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

  return {
    syncOne,
    runDelta,
    runSniffer,
    // Internal helpers exposed for testing/ops
    _internal: {
      upsertProperty,
      softDeleteProperty,
      findByKitepropId,
      summarize,
    },
  };
};

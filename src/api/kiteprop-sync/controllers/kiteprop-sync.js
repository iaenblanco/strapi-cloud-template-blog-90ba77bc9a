'use strict';

/**
 * kiteprop-sync controller
 *
 * All endpoints are protected by the `has-trigger-token` policy
 * (Bearer token in the Authorization header).
 *
 * Endpoints (Phase 1 — Properties only):
 *   GET    /kiteprop-sync/health
 *   POST   /kiteprop-sync/properties/:id           (sync a single property)
 *   POST   /kiteprop-sync/properties/run-delta     (activities-based delta)
 *   POST   /kiteprop-sync/properties/run-sniffer   (id-desc sniffer for new entries)
 *   POST   /kiteprop-sync/properties/run-all       (delta + sniffer in one call)
 *   POST   /kiteprop-sync/properties/run-next      (one changed/new property)
 *   GET    /kiteprop-sync/reconciliation/summary   (read-only ID audit)
 *   GET    /kiteprop-sync/reconciliation/mapping-audit (read-only mapping audit)
 *   GET    /kiteprop-sync/state                    (read sync-state)
 *
 * Dry-run is controlled by:
 *   - Body param `dryRun` (true/false), OR
 *   - Env var KITEPROP_SYNC_DRY_RUN=true (default if param is omitted)
 */

function resolveDryRun(ctx) {
  const body = ctx.request.body || {};
  if (typeof body.dryRun === 'boolean') return body.dryRun;
  if (typeof body.dry_run === 'boolean') return body.dry_run;
  return String(process.env.KITEPROP_SYNC_DRY_RUN || 'true').toLowerCase() === 'true';
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function parseKitePropLimit(value) {
  const parsed = parsePositiveInt(value, 50, { max: 50 });
  return [15, 30, 50].includes(parsed) ? parsed : 50;
}

function parseReconciliationQuery(query = {}) {
  const allowedOrders = new Set(['id:asc', 'id:desc', 'price:asc', 'price:desc']);
  const order = allowedOrders.has(query.order) ? query.order : 'id:desc';

  return {
    status: typeof query.status === 'string' && query.status.trim() ? query.status.trim() : 'active',
    // KiteProp docs for Properties - List allow only 15, 30, and 50; 50 is the maximum documented value.
    limit: parseKitePropLimit(query.limit),
    maxPages: parsePositiveInt(query.maxPages, 20, { max: 1000 }),
    includeIds: parseBoolean(query.includeIds, true),
    includeSamples: parseBoolean(query.includeSamples, true),
    sampleSize: parsePositiveInt(query.sampleSize, 20, { max: 1000 }),
    order,
  };
}

function parseMappingAuditQuery(query = {}) {
  return {
    status: typeof query.status === 'string' && query.status.trim() ? query.status.trim() : 'active',
    kitepropId: query.kitepropId ? Number(query.kitepropId) : null,
    limit: parseKitePropLimit(query.limit),
    maxPages: parsePositiveInt(query.maxPages, 20, { max: 1000 }),
    includeDetails: parseBoolean(query.includeDetails, true),
    includeRawSample: parseBoolean(query.includeRawSample, false),
    sampleSize: parsePositiveInt(query.sampleSize, 20, { max: 1000 }),
    checkImages: parseBoolean(query.checkImages, true),
    checkFrontRisk: parseBoolean(query.checkFrontRisk, true),
  };
}

module.exports = {
  /**
   * Health check — calls KiteProp /profile to validate API key + connectivity.
   */
  async health(ctx) {
    const client = strapi.service('api::kiteprop-sync.client');
    try {
      const res = await client.getProfile();
      const profile = res?.data?.data || null;
      ctx.body = {
        ok: true,
        kiteprop: {
          status: res.status,
          authenticated: !!profile?.id,
          user: profile
            ? {
                id: profile.id,
                email: profile.email,
                full_name: profile.full_name,
                role_id: profile.role_id,
                office_id: profile.office_id,
              }
            : null,
        },
        config: {
          base_url: process.env.KITEPROP_BASE_URL || null,
          cron_enabled: String(process.env.CRON_ENABLED || 'false') === 'true',
          sync_enabled: String(process.env.KITEPROP_SYNC_ENABLED || 'false') === 'true',
          dry_run_default: String(process.env.KITEPROP_SYNC_DRY_RUN || 'true') === 'true',
          delete_strategy: process.env.KITEPROP_DELETE_STRATEGY || 'soft',
          import_images: String(process.env.KITEPROP_SYNC_IMPORT_IMAGES || 'true') === 'true',
          max_images_per_property: Number(process.env.KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY || 12),
        },
      };
    } catch (err) {
      ctx.status = 502;
      ctx.body = {
        ok: false,
        error: {
          message: err.message,
          status: err.status || null,
        },
      };
    }
  },

  /**
   * Sync a single property by KiteProp ID.
   * Body: { dryRun?: boolean }
   */
  async syncOne(ctx) {
    const id = Number(ctx.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      ctx.throw(400, 'Invalid property id');
    }
    const dryRun = resolveDryRun(ctx);
    const sync = strapi.service('api::kiteprop-sync.properties-sync');
    const result = await sync.syncOne(id, { dryRun, source: 'manual:syncOne' });
    ctx.body = { ok: true, dry_run: dryRun, result };
  },

  /**
   * Run delta sync via /properties/activities (cursor-based).
   * Body: { dryRun?: boolean, fromActivityId?: number, maxPages?: number, maxItems?: number }
   */
  async runDelta(ctx) {
    const dryRun = resolveDryRun(ctx);
    const body = ctx.request.body || {};
    const sync = strapi.service('api::kiteprop-sync.properties-sync');
    const result = await sync.runDelta({
      dryRun,
      source: 'manual:runDelta',
      fromActivityId: body.fromActivityId ? Number(body.fromActivityId) : undefined,
      maxPages: body.maxPages ? Number(body.maxPages) : undefined,
      maxItems: body.maxItems ? Number(body.maxItems) : undefined,
    });
    ctx.body = { ok: true, dry_run: dryRun, result };
  },

  /**
   * Run id-desc sniffer for newly created properties.
   * Body: { dryRun?: boolean, maxPages?: number, maxItems?: number }
   */
  async runSniffer(ctx) {
    const dryRun = resolveDryRun(ctx);
    const body = ctx.request.body || {};
    const sync = strapi.service('api::kiteprop-sync.properties-sync');
    const result = await sync.runSniffer({
      dryRun,
      source: 'manual:runSniffer',
      maxPages: body.maxPages ? Number(body.maxPages) : undefined,
      maxItems: body.maxItems ? Number(body.maxItems) : undefined,
    });
    ctx.body = { ok: true, dry_run: dryRun, result };
  },

  /**
   * Run one professional per-property sync candidate.
   * Body: { dryRun?: boolean, maxPages?: number, maxItems?: number }
   */
  async runNext(ctx) {
    const dryRun = resolveDryRun(ctx);
    const body = ctx.request.body || {};
    const sync = strapi.service('api::kiteprop-sync.properties-sync');
    const result = await sync.runNext({
      dryRun,
      source: 'manual:runNext',
      maxPages: body.maxPages ? Number(body.maxPages) : undefined,
      maxItems: body.maxItems ? Number(body.maxItems) : undefined,
    });
    ctx.status = result.ok ? 200 : 500;
    ctx.body = result;
  },

  /**
   * Convenience: delta + sniffer in a single call.
   */
  async runAll(ctx) {
    const dryRun = resolveDryRun(ctx);
    const body = ctx.request.body || {};
    const sync = strapi.service('api::kiteprop-sync.properties-sync');
    const delta = await sync.runDelta({
      dryRun,
      source: 'manual:runAll',
      maxPages: body.maxPages ? Number(body.maxPages) : undefined,
      maxItems: body.maxItems ? Number(body.maxItems) : undefined,
    });
    const sniffer = await sync.runSniffer({
      dryRun,
      source: 'manual:runAll',
      maxPages: body.maxPages ? Number(body.maxPages) : undefined,
      maxItems: body.maxItems ? Number(body.maxItems) : undefined,
    });
    ctx.body = { ok: true, dry_run: dryRun, delta, sniffer };
  },

  /**
   * Read current sync-state (cursors, lock, last run/error).
   */
  async getState(ctx) {
    const state = strapi.service('api::kiteprop-sync.state');
    const current = await state.read();
    ctx.body = { ok: true, state: current };
  },

  /**
   * Read-only reconciliation between active KiteProp IDs and local kiteprop_id values.
   */
  async reconciliationSummary(ctx) {
    const reconciliation = strapi.service('api::kiteprop-sync.reconciliation');
    try {
      ctx.body = await reconciliation.summary(parseReconciliationQuery(ctx.query));
    } catch (err) {
      if (err.source === 'kiteprop') {
        ctx.status = 502;
        ctx.body = {
          ok: false,
          read_only: true,
          error: {
            message: err.message,
            status: err.status || null,
          },
        };
        return;
      }

      ctx.status = 500;
      ctx.body = {
        ok: false,
        read_only: true,
        error: {
          message: err.message,
        },
      };
    }
  },

  /**
   * Read-only mapping audit from KiteProp payload to Strapi fields and frontend risk.
   */
  async mappingAudit(ctx) {
    const mappingAudit = strapi.service('api::kiteprop-sync.mapping-audit');
    try {
      ctx.body = await mappingAudit.audit(parseMappingAuditQuery(ctx.query));
    } catch (err) {
      if (err.source === 'kiteprop' || err.status) {
        ctx.status = 502;
        ctx.body = {
          ok: false,
          read_only: true,
          error: {
            message: err.message,
            status: err.status || null,
          },
        };
        return;
      }

      ctx.status = 500;
      ctx.body = {
        ok: false,
        read_only: true,
        error: {
          message: err.message,
        },
      };
    }
  },
};

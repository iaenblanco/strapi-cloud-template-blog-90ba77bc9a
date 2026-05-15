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
          sync_enabled: String(process.env.KITEPROP_SYNC_ENABLED || 'false') === 'true',
          dry_run_default: String(process.env.KITEPROP_SYNC_DRY_RUN || 'true') === 'true',
          delete_strategy: process.env.KITEPROP_DELETE_STRATEGY || 'soft',
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
   * Body: { dryRun?: boolean, fromActivityId?: number, maxPages?: number }
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
    });
    ctx.body = { ok: true, dry_run: dryRun, result };
  },

  /**
   * Run id-desc sniffer for newly created properties.
   * Body: { dryRun?: boolean, maxPages?: number }
   */
  async runSniffer(ctx) {
    const dryRun = resolveDryRun(ctx);
    const body = ctx.request.body || {};
    const sync = strapi.service('api::kiteprop-sync.properties-sync');
    const result = await sync.runSniffer({
      dryRun,
      source: 'manual:runSniffer',
      maxPages: body.maxPages ? Number(body.maxPages) : undefined,
    });
    ctx.body = { ok: true, dry_run: dryRun, result };
  },

  /**
   * Convenience: delta + sniffer in a single call.
   */
  async runAll(ctx) {
    const dryRun = resolveDryRun(ctx);
    const sync = strapi.service('api::kiteprop-sync.properties-sync');
    const delta = await sync.runDelta({ dryRun, source: 'manual:runAll' });
    const sniffer = await sync.runSniffer({ dryRun, source: 'manual:runAll' });
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
};

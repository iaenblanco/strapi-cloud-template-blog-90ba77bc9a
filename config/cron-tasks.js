'use strict';

/**
 * cron-tasks.js — Phase 1
 *
 * The cron file is loaded by `config/server.js` only when CRON_ENABLED=true.
 * Even when loaded, each task GUARDS itself with KITEPROP_SYNC_ENABLED so the
 * scheduler can start in a "registered but inactive" state safely.
 *
 * The cron is OFF by default. To enable in production, set:
 *   CRON_ENABLED=true
 *   KITEPROP_SYNC_ENABLED=true
 *   KITEPROP_SYNC_DRY_RUN=false   (optional; default keeps dry-run on)
 *
 * Default schedules (override via env):
 *   KITEPROP_SYNC_PROPERTIES_DELTA_CRON   default: every 5 minutes
 *   KITEPROP_SYNC_PROPERTIES_SNIFFER_CRON default: every 5 minutes (offset by 30s)
 */

function isSyncEnabled() {
  return String(process.env.KITEPROP_SYNC_ENABLED || 'false').toLowerCase() === 'true';
}

function isDryRunDefault() {
  return String(process.env.KITEPROP_SYNC_DRY_RUN || 'true').toLowerCase() === 'true';
}

const DELTA_CRON = process.env.KITEPROP_SYNC_PROPERTIES_DELTA_CRON || '*/5 * * * *';
const SNIFFER_CRON = process.env.KITEPROP_SYNC_PROPERTIES_SNIFFER_CRON || '30 */5 * * * *';

module.exports = {
  [DELTA_CRON]: {
    task: async ({ strapi }) => {
      if (!isSyncEnabled()) {
        strapi.log.debug('[kiteprop-sync][cron] delta skipped: KITEPROP_SYNC_ENABLED is false');
        return;
      }
      try {
        const sync = strapi.service('api::kiteprop-sync.properties-sync');
        await sync.runDelta({ source: 'cron:delta', dryRun: isDryRunDefault() });
      } catch (err) {
        strapi.log.error(`[kiteprop-sync][cron] delta failed: ${err.message}`);
      }
    },
    options: {
      // node-cron timezone is UTC by default; override with KITEPROP_SYNC_TIMEZONE if needed.
      tz: process.env.KITEPROP_SYNC_TIMEZONE || 'UTC',
    },
  },
  [SNIFFER_CRON]: {
    task: async ({ strapi }) => {
      if (!isSyncEnabled()) {
        strapi.log.debug('[kiteprop-sync][cron] sniffer skipped: KITEPROP_SYNC_ENABLED is false');
        return;
      }
      try {
        const sync = strapi.service('api::kiteprop-sync.properties-sync');
        await sync.runSniffer({ source: 'cron:sniffer', dryRun: isDryRunDefault() });
      } catch (err) {
        strapi.log.error(`[kiteprop-sync][cron] sniffer failed: ${err.message}`);
      }
    },
    options: {
      tz: process.env.KITEPROP_SYNC_TIMEZONE || 'UTC',
    },
  },
};

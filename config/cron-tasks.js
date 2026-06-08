'use strict';

/**
 * cron-tasks.js
 *
 * El backend/Strapi es la FUENTE PRINCIPAL de ejecución del sync (no GitHub Actions).
 *
 * El cron se carga desde `config/server.js` solo cuando CRON_ENABLED=true.
 * Aun cargado, la tarea se AUTOPROTEGE con KITEPROP_SYNC_ENABLED para poder
 * arrancar en estado "registrado pero inactivo".
 *
 * Para activar en producción:
 *   CRON_ENABLED=true
 *   KITEPROP_SYNC_ENABLED=true
 *   KITEPROP_SYNC_DRY_RUN=false
 *
 * QUÉ HACE LA CORRIDA HORARIA:
 *   - Cada 1 hora revisa KiteProp con runAll (delta + sniffer) EN LOTE.
 *   - runAll procesa todos los cambios pendientes razonables (no uno por uno) y,
 *     AL FINAL de la corrida completa, decide UN SOLO deploy de Cloudflare si
 *     hubo cambios reales (o si había un deploy pendiente). Si no hubo cambios
 *     reales, NO deploya. La hora solo sirve para revisar KiteProp, nunca para
 *     gatillar un deploy por sí sola.
 *
 * Schedule por defecto (override por env KITEPROP_SYNC_CRON): cada hora en punto.
 */

function isSyncEnabled() {
  return String(process.env.KITEPROP_SYNC_ENABLED || 'false').toLowerCase() === 'true';
}

function isDryRunDefault() {
  return String(process.env.KITEPROP_SYNC_DRY_RUN || 'true').toLowerCase() === 'true';
}

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

// Cada hora en punto. La hora solo dispara la REVISIÓN de KiteProp.
const SYNC_CRON = process.env.KITEPROP_SYNC_CRON || '0 * * * *';

module.exports = {
  'kiteprop-sync-hourly': {
    task: async ({ strapi }) => {
      if (!isSyncEnabled()) {
        strapi.log.debug('[kiteprop-sync][cron] omitido: KITEPROP_SYNC_ENABLED es false');
        return;
      }
      const dryRun = isDryRunDefault();
      // Lote conservador: procesamos varios cambios en la MISMA corrida para que
      // se agrupen en un único deploy al final de runAll.
      const maxItems = readEnvNumber('KITEPROP_SYNC_MAX_ITEMS_PER_RUN', 50);
      const maxPages = readEnvNumber('KITEPROP_SYNC_MAX_PAGES_PER_RUN', 5);
      try {
        strapi.log.info(
          `[kiteprop-sync][cron] corrida KiteProp iniciada (runAll) dryRun=${dryRun} maxItems=${maxItems} maxPages=${maxPages}`
        );
        const sync = strapi.service('api::kiteprop-sync.properties-sync');
        const result = await sync.runAll({ source: 'cron:runAll', dryRun, maxItems, maxPages });
        const summary = result?.combined?.summary || {};
        strapi.log.info(
          `[kiteprop-sync][cron] corrida KiteProp finalizada — revisadas(items)=${summary.skipped ?? 0}+cambios; ` +
            `cambios reales: created=${summary.created || 0} updated=${summary.updated || 0} soft_deleted=${summary.soft_deleted || 0} errors=${summary.errors || 0}`
        );
      } catch (err) {
        strapi.log.error(`[kiteprop-sync][cron] runAll falló: ${err.message}`);
      }
    },
    options: {
      rule: SYNC_CRON,
      tz: process.env.KITEPROP_SYNC_TIMEZONE || 'UTC',
    },
  },
};

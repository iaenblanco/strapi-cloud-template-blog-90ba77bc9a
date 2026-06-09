'use strict';

/**
 * auto-sync.js — Intervalo interno seguro para Strapi Cloud.
 *
 * POR QUÉ EXISTE (problema real en producción):
 *   El cron nativo de Strapi Cloud no siempre se ejecuta (last_run_at quedó
 *   congelado más de una hora). Además, KiteProp /activities no refleja todos
 *   los cambios reales (un cambio real en una propiedad no apareció como
 *   activity nueva, pero un syncOne directo sí detectó la diferencia). Por eso
 *   no podemos depender SOLO del cron nativo ni SOLO del delta basado en
 *   activities.
 *
 * QUÉ HACE:
 *   Un setInterval propio (independiente del cron de Strapi y de GitHub Actions)
 *   que cada N ms ejecuta UNA verificación robusta y conservadora:
 *     - mode=reconcile (recomendado): runReconcile -> recorre el catálogo y
 *       actualiza SOLO diferencias reales (idempotente vía syncOne). Apto para
 *       proyectos con pocas propiedades activas.
 *     - mode=delta: runAll (delta + sniffer).
 *
 * GARANTÍAS (no quemar Cloudflare/API calls):
 *   - 0 deploys si no hubo cambios reales.
 *   - 1 solo deploy por lote (lo decide runReconcile/runAll al final).
 *   - pending_deploy se respeta: el deploy lo coordina el sync, este módulo
 *     NO toca el coordinador de deploy.
 *   - Evita doble ejecución leyendo el sync-state (is_running) y, como segunda
 *     barrera, el propio lock dentro de runReconcile/runAll.
 *
 * ENV:
 *   KITEPROP_AUTO_SYNC_ENABLED   (default false — seguro)
 *   KITEPROP_AUTO_SYNC_MODE      (reconcile | delta; default reconcile)
 *   KITEPROP_AUTO_SYNC_INTERVAL_MS (default 3600000 = 1h)
 *   KITEPROP_AUTO_SYNC_MAX_PAGES (default 20)
 *   KITEPROP_AUTO_SYNC_MAX_ITEMS (default 1000)
 *   KITEPROP_AUTO_SYNC_DRY_RUN   (default true — seguro)
 *   KITEPROP_AUTO_SYNC_STARTUP_DELAY_MS (default 60000)
 *
 * Reglas:
 *   - enabled=false  -> no corre nada.
 *   - mode=reconcile -> runReconcile.
 *   - mode=delta     -> runAll.
 *   - Default seguro: enabled=false, dryRun=true.
 *   - En producción: enabled=true, mode=reconcile, dryRun=false.
 */

const INTERVAL_KEY = Symbol.for('propinvest.kitepropAutoSyncInterval');
const STATE_UID = 'api::kiteprop-sync-state.kiteprop-sync-state';

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function envMode() {
  const raw = String(process.env.KITEPROP_AUTO_SYNC_MODE || 'reconcile').toLowerCase();
  return raw === 'delta' ? 'delta' : 'reconcile';
}

module.exports = ({ strapi: _strapi } = {}) => {
  const state = () => strapi.service('api::kiteprop-sync.state');
  const sync = () => strapi.service('api::kiteprop-sync.properties-sync');

  function getConfig() {
    return {
      enabled: envBool('KITEPROP_AUTO_SYNC_ENABLED', false),
      mode: envMode(),
      intervalMs: envNumber('KITEPROP_AUTO_SYNC_INTERVAL_MS', 60 * 60 * 1000),
      maxPages: envNumber('KITEPROP_AUTO_SYNC_MAX_PAGES', 20),
      maxItems: envNumber('KITEPROP_AUTO_SYNC_MAX_ITEMS', 1000),
      dryRun: envBool('KITEPROP_AUTO_SYNC_DRY_RUN', true),
      startupDelayMs: envNumber('KITEPROP_AUTO_SYNC_STARTUP_DELAY_MS', 60 * 1000),
    };
  }

  /**
   * Ejecuta UNA verificación. Es la unidad testeable del auto-sync.
   *
   * Devuelve un objeto descriptivo (nunca lanza): permite al caller del interval
   * loguear y seguir vivo. El deploy lo decide internamente runReconcile/runAll
   * (este método NO toca el coordinador de deploy).
   */
  async function runOnce(opts = {}) {
    const cfg = getConfig();
    const source = opts.source || 'auto-sync:interval';
    const runId = opts.runId || `autosync_${Date.now().toString(36)}`;

    // Regla: si está deshabilitado, no corre nada.
    if (!cfg.enabled) {
      strapi.log.debug('[kiteprop-auto-sync] omitido: KITEPROP_AUTO_SYNC_ENABLED != true');
      return { skipped: true, reason: 'disabled' };
    }

    // Evitar doble ejecución usando el state existente: si ya hay un sync
    // corriendo, saltamos la corrida (la segunda barrera es el lock interno de
    // runReconcile/runAll, que también devolvería skipped si tomáramos esta vía).
    let current;
    try {
      current = await state().read();
    } catch (err) {
      strapi.log.error(`[kiteprop-auto-sync] omitido: no se pudo leer el sync-state (${err.message})`);
      return { skipped: true, reason: 'state_unreadable', error: err.message };
    }

    if (current && current.is_running) {
      strapi.log.warn(
        `[kiteprop-auto-sync] omitido: ya hay un sync corriendo (current_run_id=${current.current_run_id || 'n/a'})`
      );
      return { skipped: true, reason: 'sync_in_progress' };
    }

    const runOpts = {
      source,
      runId,
      dryRun: cfg.dryRun,
      maxPages: cfg.maxPages,
      maxItems: cfg.maxItems,
    };

    strapi.log.info(
      `[kiteprop-auto-sync] inicio mode=${cfg.mode} dryRun=${cfg.dryRun} ` +
        `maxPages=${cfg.maxPages} maxItems=${cfg.maxItems} runId=${runId}`
    );

    const startedAt = Date.now();
    try {
      const result =
        cfg.mode === 'delta'
          ? await sync().runAll(runOpts)
          : await sync().runReconcile(runOpts);

      // runAll devuelve { combined: { summary } }; runReconcile devuelve { summary }.
      const summary = (result && (result.combined?.summary || result.summary)) || {};
      strapi.log.info(
        `[kiteprop-auto-sync] fin mode=${cfg.mode} dryRun=${cfg.dryRun} ms=${Date.now() - startedAt} ` +
          `created=${summary.created || 0} updated=${summary.updated || 0} ` +
          `soft_deleted=${summary.soft_deleted || 0} skipped=${summary.skipped || 0} ` +
          `errors=${summary.errors || 0}`
      );
      return { skipped: false, mode: cfg.mode, dry_run: cfg.dryRun, run_id: runId, result };
    } catch (err) {
      strapi.log.error(`[kiteprop-auto-sync] error mode=${cfg.mode}: ${err.message}`);
      return { skipped: false, mode: cfg.mode, run_id: runId, error: err.message };
    }
  }

  /**
   * Arranca el intervalo interno (idempotente por proceso). Llamado desde el
   * bootstrap. En Strapi Cloud esta es la vía PRINCIPAL recomendada.
   */
  function start() {
    const cfg = getConfig();

    if (!cfg.enabled) {
      strapi.log.info('[kiteprop-auto-sync] interval no iniciado: KITEPROP_AUTO_SYNC_ENABLED != true');
      return null;
    }

    if (global[INTERVAL_KEY]) {
      strapi.log.info('[kiteprop-auto-sync] interval ya estaba activo (no se duplica)');
      return global[INTERVAL_KEY];
    }

    // Compatibilidad: si además está activo el cron/interval legacy de Strapi,
    // el lock evitará doble corrida, pero advertimos porque en Strapi Cloud se
    // recomienda usar SOLO el auto-sync interno.
    if (envBool('CRON_ENABLED', false) || envBool('KITEPROP_SYNC_ENABLED', false)) {
      strapi.log.warn(
        '[kiteprop-auto-sync] CRON_ENABLED/KITEPROP_SYNC_ENABLED activos junto al auto-sync interno: ' +
          'el lock del sync-state evitará doble corrida, pero en Strapi Cloud se recomienda usar ' +
          'SOLO el auto-sync interno (KITEPROP_AUTO_SYNC_ENABLED) como vía principal.'
      );
    }

    strapi.log.info(
      `[kiteprop-auto-sync] interval habilitado cada ${cfg.intervalMs}ms ` +
        `(mode=${cfg.mode}, dryRun=${cfg.dryRun}, maxPages=${cfg.maxPages}, maxItems=${cfg.maxItems})`
    );

    const handle = setInterval(() => {
      runOnce({ source: 'auto-sync:interval' }).catch((err) => {
        strapi.log.error(`[kiteprop-auto-sync] tick del interval falló: ${err.message}`);
      });
    }, cfg.intervalMs);
    handle.unref?.();
    global[INTERVAL_KEY] = handle;

    // Primera corrida diferida para no competir con el arranque de Strapi.
    const kickoff = setTimeout(() => {
      runOnce({ source: 'auto-sync:startup' }).catch((err) => {
        strapi.log.error(`[kiteprop-auto-sync] corrida inicial falló: ${err.message}`);
      });
    }, cfg.startupDelayMs);
    kickoff.unref?.();

    return handle;
  }

  function stop() {
    if (global[INTERVAL_KEY]) {
      clearInterval(global[INTERVAL_KEY]);
      global[INTERVAL_KEY] = null;
    }
  }

  return { getConfig, runOnce, start, stop, _internal: { STATE_UID } };
};

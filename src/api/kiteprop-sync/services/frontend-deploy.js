'use strict';

/**
 * frontend-deploy.js — Coordinador central de despliegue del frontend (Cloudflare).
 *
 * POR QUÉ EXISTE ESTE COORDINADOR:
 *   El frontend es un sitio estático en Cloudflare. Cada deploy reconstruye TODO
 *   el sitio con el estado actual de Strapi. NO queremos un deploy por propiedad
 *   ni uno por cada update interno. En versiones anteriores se dispararon muchos
 *   deploys y se agotaron casi todos los API calls de Cloudflare.
 *
 *   Por eso este módulo es el ÚNICO punto autorizado a llamar al deploy hook, y
 *   aplica una política conservadora y agrupada:
 *     - 0 deploys si no hubo cambios reales.
 *     - 1 deploy por lote de cambios.
 *     - "deploy pendiente" persistente si todavía no corresponde deployar
 *       (debounce / intervalo mínimo / hook caído) para reintentarlo luego.
 *     - nunca deploys repetidos por cada propiedad.
 *
 * ESTADO PERSISTENTE (sobrevive reinicios de Strapi) en el plugin store:
 *   - pending_deploy            -> ¿hay cambios sin deployar todavía?
 *   - last_frontend_deploy_at   -> último deploy exitoso (base del intervalo mínimo)
 *   - deploy_in_progress        -> hay un deploy ejecutándose ahora
 *   - last_frontend_deploy_reason / last_pending_reason
 *   - last_changed_count        -> cuántas propiedades cambiaron en el último lote
 *   - last_error                -> último error del hook (si corresponde)
 *   - last_pending_at           -> cuándo se marcó pendiente por última vez
 */

const STORE_NAME = 'kiteprop-frontend-deploy';

// Claves históricas (NO renombrar: hay tests y un endpoint de status que dependen de ellas).
const LAST_DEPLOY_AT_KEY = 'last_frontend_deploy_at';
const LAST_DEPLOY_REASON_KEY = 'last_frontend_deploy_reason';
const LAST_DEPLOY_RUN_ID_KEY = 'last_frontend_deploy_run_id';

// Claves nuevas del coordinador de estado persistente.
const PENDING_DEPLOY_KEY = 'frontend_deploy_pending';
const DEPLOY_IN_PROGRESS_KEY = 'frontend_deploy_in_progress';
const DEPLOY_IN_PROGRESS_AT_KEY = 'frontend_deploy_in_progress_at';
const LAST_CHANGED_COUNT_KEY = 'frontend_deploy_last_changed_count';
const LAST_ERROR_KEY = 'frontend_deploy_last_error';
const LAST_PENDING_AT_KEY = 'frontend_deploy_last_pending_at';
const LAST_PENDING_REASON_KEY = 'frontend_deploy_last_pending_reason';

const DEFAULT_MIN_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function envPositiveInt(name, fallback) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function countRealChangesFromItems(items = []) {
  const counts = { created: 0, updated: 0, soft_deleted: 0 };
  for (const item of items) {
    if (!item || item.status !== 'ok' || item.dry_run) continue;
    if (item.action === 'create') counts.created += 1;
    if (item.action === 'update') counts.updated += 1;
    if (item.action === 'soft_delete') counts.soft_deleted += 1;
  }
  return counts;
}

function countRealChangesFromSummary(summary = {}) {
  return {
    created: Number(summary.created || 0),
    updated: Number(summary.updated || 0),
    soft_deleted: Number(summary.soft_deleted || 0),
  };
}

function hasRealChanges(counts) {
  return (counts.created || 0) + (counts.updated || 0) + (counts.soft_deleted || 0) > 0;
}

function totalChanges(counts = {}) {
  return (counts.created || 0) + (counts.updated || 0) + (counts.soft_deleted || 0);
}

module.exports = ({ strapi: _strapi } = {}) => {
  // Lock de concurrencia EN MEMORIA: garantiza que dentro de este proceso nunca
  // haya dos POST al hook simultáneos. El estado persistido (deploy_in_progress)
  // es para observabilidad y para limpiar estados colgados tras un crash.
  let inFlight = false;

  // Flag anti-loop EN MEMORIA: cuando el sync de KiteProp está escribiendo en
  // Strapi, los lifecycles del content type propiedad NO deben marcar deploy
  // (el deploy lo decide el final de runAll, agrupado). Usamos un contador para
  // soportar llamadas anidadas (runAll -> runDelta -> syncOne).
  let syncWriteDepth = 0;

  function store() {
    return strapi.store({
      environment: strapi.config?.environment,
      type: 'plugin',
      name: STORE_NAME,
    });
  }

  function config() {
    return {
      enabled: envBool('FRONTEND_DEPLOY_ENABLED', false),
      hookUrl: process.env.FRONTEND_DEPLOY_HOOK_URL || '',
      minIntervalMs: envPositiveInt('FRONTEND_DEPLOY_MIN_INTERVAL_MS', DEFAULT_MIN_INTERVAL_MS),
      reasonLog: envBool('FRONTEND_DEPLOY_REASON_LOG', true),
      timeoutMs: envPositiveInt('FRONTEND_DEPLOY_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    };
  }

  // ---------------------------------------------------------------------------
  // Anti-loop: marca de "el sync está escribiendo".
  // ---------------------------------------------------------------------------
  function beginSyncWrites() {
    syncWriteDepth += 1;
  }

  function endSyncWrites() {
    syncWriteDepth = Math.max(0, syncWriteDepth - 1);
  }

  function isSyncWriteInProgress() {
    return syncWriteDepth > 0;
  }

  function shouldTriggerDeployFromSyncResult(result = {}) {
    if (!result || result.dry_run || result.error) {
      return { shouldTrigger: false, changedItems: countRealChangesFromItems(result.items || []) };
    }

    const changedItems = result.summary
      ? countRealChangesFromSummary(result.summary)
      : countRealChangesFromItems(result.items || []);

    return {
      shouldTrigger: hasRealChanges(changedItems),
      changedItems,
    };
  }

  async function getDeployStatus() {
    const cfg = config();
    const deployStore = store();
    const [
      lastFrontendDeployAt,
      lastFrontendDeployReason,
      lastFrontendDeployRunId,
      pendingDeploy,
      deployInProgress,
      lastChangedCount,
      lastError,
      lastPendingAt,
      lastPendingReason,
    ] = await Promise.all([
      deployStore.get({ key: LAST_DEPLOY_AT_KEY }),
      deployStore.get({ key: LAST_DEPLOY_REASON_KEY }),
      deployStore.get({ key: LAST_DEPLOY_RUN_ID_KEY }),
      deployStore.get({ key: PENDING_DEPLOY_KEY }),
      deployStore.get({ key: DEPLOY_IN_PROGRESS_KEY }),
      deployStore.get({ key: LAST_CHANGED_COUNT_KEY }),
      deployStore.get({ key: LAST_ERROR_KEY }),
      deployStore.get({ key: LAST_PENDING_AT_KEY }),
      deployStore.get({ key: LAST_PENDING_REASON_KEY }),
    ]);

    return {
      enabled: cfg.enabled,
      has_hook_url: !!cfg.hookUrl,
      min_interval_ms: cfg.minIntervalMs,
      pending_deploy: !!pendingDeploy,
      deploy_in_progress: !!deployInProgress || inFlight,
      last_changed_count: Number(lastChangedCount || 0),
      last_error: lastError || null,
      last_pending_at: lastPendingAt || null,
      last_pending_reason: lastPendingReason || null,
      last_frontend_deploy_at: lastFrontendDeployAt || null,
      last_frontend_deploy_reason: lastFrontendDeployReason || null,
      last_frontend_deploy_run_id: lastFrontendDeployRunId || null,
      now: new Date().toISOString(),
    };
  }

  async function writeDeployState({ at, reason, runId }) {
    const deployStore = store();
    await Promise.all([
      deployStore.set({ key: LAST_DEPLOY_AT_KEY, value: at }),
      deployStore.set({ key: LAST_DEPLOY_REASON_KEY, value: reason || null }),
      deployStore.set({ key: LAST_DEPLOY_RUN_ID_KEY, value: runId || null }),
    ]);
  }

  /**
   * Marca un deploy como pendiente de forma PERSISTENTE.
   * Se llama cuando hubo cambios reales pero todavía no se pudo (o no correspondía)
   * deployar: así no perdemos el cambio aunque Strapi se reinicie.
   */
  async function markDeployPending({ reason, changedCount, source } = {}) {
    const deployStore = store();
    await Promise.all([
      deployStore.set({ key: PENDING_DEPLOY_KEY, value: true }),
      deployStore.set({ key: LAST_PENDING_AT_KEY, value: new Date().toISOString() }),
      deployStore.set({ key: LAST_PENDING_REASON_KEY, value: reason || null }),
      deployStore.set({ key: LAST_CHANGED_COUNT_KEY, value: Number(changedCount || 0) }),
    ]);
    strapi.log.info(
      `[frontend-deploy] deploy pendiente creado source=${source || 'unknown'} reason=${reason || 'n/a'} changedCount=${Number(changedCount || 0)}`
    );
  }

  async function clearDeployPending() {
    const deployStore = store();
    await Promise.all([
      deployStore.set({ key: PENDING_DEPLOY_KEY, value: false }),
      deployStore.set({ key: LAST_ERROR_KEY, value: null }),
    ]);
    strapi.log.info('[frontend-deploy] deploy pendiente limpiado');
  }

  /**
   * Limpia un estado "deploy_in_progress" colgado (p.ej. tras un crash en mitad
   * de un deploy). Se invoca en el bootstrap. POR QUÉ: si quedara en true, el
   * coordinador no volvería a deployar nunca.
   */
  async function clearStaleInProgress() {
    const deployStore = store();
    const inProgress = await deployStore.get({ key: DEPLOY_IN_PROGRESS_KEY });
    if (inProgress) {
      await deployStore.set({ key: DEPLOY_IN_PROGRESS_KEY, value: false });
      strapi.log.warn('[frontend-deploy] limpiando deploy_in_progress colgado de una corrida anterior');
    }
    inFlight = false;
  }

  async function postDeployHook(hookUrl, timeoutMs) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(hookUrl, {
        method: 'POST',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Cloudflare deploy hook returned HTTP ${response.status}`);
      }
      return response;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  /**
   * PUNTO ÚNICO que decide si se llama o no al hook de Cloudflare.
   *
   * Regla central: el hook SOLO puede llamarse cuando:
   *   - pending_deploy === true (hubo cambios reales o quedó pendiente)
   *   - FRONTEND_DEPLOY_ENABLED === true
   *   - existe FRONTEND_DEPLOY_HOOK_URL
   *   - no hay un deploy en curso
   *   - se cumple FRONTEND_DEPLOY_MIN_INTERVAL_MS desde el último deploy exitoso
   *
   * Si NO se cumple, loguea claramente por qué no deployó y MANTIENE el estado
   * pendiente para reintentarlo en la próxima oportunidad segura.
   */
  async function processPendingDeploy({ reason, source, runId } = {}) {
    const cfg = config();
    const deployStore = store();

    const pending = await deployStore.get({ key: PENDING_DEPLOY_KEY });
    if (!pending) {
      // No es un error: simplemente no hubo cambios reales que deployar.
      strapi.log.info('[frontend-deploy] deploy no requerido: no hubo cambios reales (sin pendiente)');
      return { triggered: false, skipped: true, reason: 'no_pending' };
    }

    if (!cfg.enabled) {
      strapi.log.info('[frontend-deploy] deploy omitido: FRONTEND_DEPLOY_ENABLED != true (se mantiene pendiente)');
      return { triggered: false, skipped: true, reason: 'disabled' };
    }

    if (!cfg.hookUrl) {
      strapi.log.warn('[frontend-deploy] deploy omitido: falta FRONTEND_DEPLOY_HOOK_URL (se mantiene pendiente)');
      return { triggered: false, skipped: true, reason: 'missing_hook_url' };
    }

    // Anti-spam de concurrencia: nunca dos deploys a la vez.
    const persistedInProgress = await deployStore.get({ key: DEPLOY_IN_PROGRESS_KEY });
    if (inFlight || persistedInProgress) {
      strapi.log.warn('[frontend-deploy] deploy omitido: ya hay un deploy en curso (se mantiene pendiente)');
      return { triggered: false, skipped: true, reason: 'in_progress' };
    }

    // Intervalo mínimo (debounce): evita una ráfaga de deploys seguidos.
    // Si todavía no corresponde, el estado pendiente queda guardado y se
    // reintentará en la próxima corrida segura.
    const lastDeployAt = await deployStore.get({ key: LAST_DEPLOY_AT_KEY });
    const lastDeployMs = lastDeployAt ? Date.parse(lastDeployAt) : 0;
    const nowMs = Date.now();
    if (Number.isFinite(lastDeployMs) && lastDeployMs > 0 && nowMs - lastDeployMs < cfg.minIntervalMs) {
      const waitMs = cfg.minIntervalMs - (nowMs - lastDeployMs);
      strapi.log.info(
        `[frontend-deploy] deploy omitido por intervalo mínimo: last=${lastDeployAt}, faltan ${waitMs}ms (se mantiene pendiente)`
      );
      return { triggered: false, skipped: true, reason: 'debounce' };
    }

    // A partir de aquí ejecutamos el deploy real.
    inFlight = true;
    const deployedAt = new Date(nowMs).toISOString();
    await deployStore.set({ key: DEPLOY_IN_PROGRESS_KEY, value: true });
    await deployStore.set({ key: DEPLOY_IN_PROGRESS_AT_KEY, value: deployedAt });

    try {
      await postDeployHook(cfg.hookUrl, cfg.timeoutMs);
      await writeDeployState({ at: deployedAt, reason, runId });
      // Éxito: limpiamos el pendiente.
      await clearDeployPending();
      strapi.log.info(
        `[frontend-deploy] deploy ejecutado source=${source || 'unknown'} runId=${runId || 'n/a'}`
      );
      if (cfg.reasonLog && reason) {
        strapi.log.info(`[frontend-deploy] reason=${reason}`);
      }
      return { triggered: true, skipped: false, at: deployedAt };
    } catch (err) {
      // POR QUÉ mantenemos pending=true: si el hook falla, no perdemos el cambio;
      // se reintentará en la próxima oportunidad segura (cron horario, etc.).
      await deployStore.set({ key: LAST_ERROR_KEY, value: String(err.message).slice(0, 1000) });
      strapi.log.error(`[frontend-deploy] deploy fallido: ${err.message} (se mantiene pendiente para reintentar)`);
      return { triggered: false, skipped: false, reason: 'hook_error', error: err.message };
    } finally {
      inFlight = false;
      await deployStore.set({ key: DEPLOY_IN_PROGRESS_KEY, value: false });
    }
  }

  /**
   * Entrada principal usada por el flujo de sync.
   * Marca pendiente si hubo cambios reales y delega SIEMPRE la decisión final al
   * punto único (processPendingDeploy), que además aprovecha para reintentar un
   * deploy que hubiera quedado pendiente antes.
   */
  async function maybeTriggerDeploy({ reason, source, runId, changedItems, dryRun, error } = {}) {
    // Un dry-run jamás deploya ni toca el estado: no representa cambios reales.
    if (dryRun) {
      strapi.log.info('[frontend-deploy] deploy omitido: dryRun=true');
      return { triggered: false, skipped: true, reason: 'dry_run' };
    }

    const normalizedChanges = changedItems || {};
    const hasChanges = hasRealChanges(normalizedChanges);

    // CASO BORDE: una corrida puede aplicar cambios reales en Strapi y DESPUÉS
    // terminar con error (p.ej. falla la siguiente página/actividad). Si hubo
    // cambios reales, SIEMPRE marcamos pending_deploy=true ANTES de cualquier
    // early-return, para no perder el deploy aunque la corrida haya fallado.
    if (hasChanges) {
      await markDeployPending({
        reason,
        changedCount: totalChanges(normalizedChanges),
        source,
      });
    }

    // Si la corrida tuvo error de sync NO deployamos ahora (conservador), pero el
    // pendiente queda guardado para procesarse en la próxima oportunidad segura.
    if (error) {
      if (hasChanges) {
        strapi.log.warn(
          `[frontend-deploy] cambios reales con error de sync: deploy diferido, se mantiene pendiente (${String(error).slice(0, 200)})`
        );
        return { triggered: false, skipped: true, reason: 'sync_error_pending', pending: true };
      }
      strapi.log.warn(`[frontend-deploy] deploy omitido: error de sync sin cambios reales (${String(error).slice(0, 200)})`);
      return { triggered: false, skipped: true, reason: 'sync_error' };
    }

    return processPendingDeploy({ reason, source, runId });
  }

  /**
   * Notificación de cambio manual desde Strapi (lifecycles).
   * Marca pendiente y deja que el coordinador aplique el mismo anti-spam/debounce.
   */
  async function notifyManualChange({ reason, source } = {}) {
    await markDeployPending({ reason, changedCount: 1, source });
    return processPendingDeploy({ reason, source });
  }

  return {
    maybeTriggerDeploy,
    shouldTriggerDeployFromSyncResult,
    getDeployStatus,
    markDeployPending,
    processPendingDeploy,
    notifyManualChange,
    clearStaleInProgress,
    // Anti-loop sync -> lifecycles
    beginSyncWrites,
    endSyncWrites,
    isSyncWriteInProgress,
    _internal: {
      countRealChangesFromItems,
      countRealChangesFromSummary,
      hasRealChanges,
      totalChanges,
    },
  };
};

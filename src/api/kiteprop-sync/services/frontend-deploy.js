'use strict';

const STORE_NAME = 'kiteprop-frontend-deploy';
const LAST_DEPLOY_AT_KEY = 'last_frontend_deploy_at';
const LAST_DEPLOY_REASON_KEY = 'last_frontend_deploy_reason';
const LAST_DEPLOY_RUN_ID_KEY = 'last_frontend_deploy_run_id';
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

module.exports = ({ strapi: _strapi } = {}) => {
  let inFlight = false;

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
    ] = await Promise.all([
      deployStore.get({ key: LAST_DEPLOY_AT_KEY }),
      deployStore.get({ key: LAST_DEPLOY_REASON_KEY }),
      deployStore.get({ key: LAST_DEPLOY_RUN_ID_KEY }),
    ]);

    return {
      enabled: cfg.enabled,
      has_hook_url: !!cfg.hookUrl,
      min_interval_ms: cfg.minIntervalMs,
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

  async function maybeTriggerDeploy({ reason, source, runId, changedItems, dryRun, error } = {}) {
    const cfg = config();

    if (!cfg.enabled) {
      strapi.log.info('[frontend-deploy] skipped: FRONTEND_DEPLOY_ENABLED is not true');
      return { triggered: false, skipped: true, reason: 'disabled' };
    }

    if (!cfg.hookUrl) {
      strapi.log.warn('[frontend-deploy] skipped: FRONTEND_DEPLOY_HOOK_URL is missing');
      return { triggered: false, skipped: true, reason: 'missing_hook_url' };
    }

    if (dryRun) {
      strapi.log.info('[frontend-deploy] skipped: dryRun=true');
      return { triggered: false, skipped: true, reason: 'dry_run' };
    }

    if (error) {
      strapi.log.warn(`[frontend-deploy] skipped: sync error (${String(error).slice(0, 200)})`);
      return { triggered: false, skipped: true, reason: 'sync_error' };
    }

    const normalizedChanges = changedItems || {};
    if (!hasRealChanges(normalizedChanges)) {
      strapi.log.info('[frontend-deploy] skipped: no real public property changes');
      return { triggered: false, skipped: true, reason: 'no_changes' };
    }

    if (inFlight) {
      strapi.log.warn('[frontend-deploy] skipped: deploy hook already in flight');
      return { triggered: false, skipped: true, reason: 'in_flight' };
    }

    const deployStore = store();
    const lastDeployAt = await deployStore.get({ key: LAST_DEPLOY_AT_KEY });
    const lastDeployMs = lastDeployAt ? Date.parse(lastDeployAt) : 0;
    const nowMs = Date.now();

    if (Number.isFinite(lastDeployMs) && lastDeployMs > 0 && nowMs - lastDeployMs < cfg.minIntervalMs) {
      strapi.log.info(
        `[frontend-deploy] deploy skipped by debounce: last=${lastDeployAt}, minIntervalMs=${cfg.minIntervalMs}`
      );
      return { triggered: false, skipped: true, reason: 'debounce' };
    }

    inFlight = true;
    const deployedAt = new Date(nowMs).toISOString();
    try {
      await postDeployHook(cfg.hookUrl, cfg.timeoutMs);
      await writeDeployState({ at: deployedAt, reason, runId });
      const counts = JSON.stringify(normalizedChanges);
      strapi.log.info(
        `[frontend-deploy] Cloudflare Pages deploy hook triggered source=${source || 'unknown'} runId=${runId || 'n/a'} changes=${counts}`
      );
      if (cfg.reasonLog && reason) {
        strapi.log.info(`[frontend-deploy] reason=${reason}`);
      }
      return { triggered: true, skipped: false, at: deployedAt };
    } catch (err) {
      strapi.log.error(`[frontend-deploy] Cloudflare deploy hook failed: ${err.message}`);
      return { triggered: false, skipped: false, reason: 'hook_error', error: err.message };
    } finally {
      inFlight = false;
    }
  }

  return {
    maybeTriggerDeploy,
    shouldTriggerDeployFromSyncResult,
    getDeployStatus,
    _internal: {
      countRealChangesFromItems,
      countRealChangesFromSummary,
      hasRealChanges,
    },
  };
};

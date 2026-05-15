'use strict';

/**
 * logger.js — persists sync events to the `kiteprop-sync-log` collection.
 *
 * Each call also mirrors the event to strapi.log for live observability.
 * IMPORTANT: never include API keys or full payloads (we keep payloads
 * separately on the propiedad row inside `kiteprop_raw`).
 */

const UID = 'api::kiteprop-sync-log.kiteprop-sync-log';

const VALID_RESOURCES = new Set(['property']);
const VALID_ACTIONS = new Set([
  'create',
  'update',
  'soft_delete',
  'skip',
  'fetch',
  'sniffer',
  'delta',
  'health',
  'error',
]);
const VALID_STATUS = new Set(['ok', 'noop', 'error']);

module.exports = ({ strapi: _strapi } = {}) => {
  const docs = () => strapi.documents(UID);

  async function record(entry) {
    const data = {
      run_id: entry.run_id || null,
      source: entry.source || null,
      resource: VALID_RESOURCES.has(entry.resource) ? entry.resource : entry.resource || 'property',
      action: VALID_ACTIONS.has(entry.action) ? entry.action : entry.action || 'update',
      kiteprop_id: entry.kiteprop_id != null ? Number(entry.kiteprop_id) : null,
      status: VALID_STATUS.has(entry.status) ? entry.status : entry.status || 'ok',
      message: entry.message ? String(entry.message).slice(0, 5000) : null,
      error_details: entry.error_details || null,
      duration_ms: Number.isFinite(entry.duration_ms) ? entry.duration_ms : null,
      dry_run: !!entry.dry_run,
    };

    const tag = `[kiteprop-sync][${data.run_id || '-'}][${data.resource}/${data.action}/${data.status}]`;
    const idTag = data.kiteprop_id ? ` kp=${data.kiteprop_id}` : '';
    const msg = `${tag}${idTag}${data.dry_run ? ' (dry-run)' : ''} ${data.message || ''}`.trim();

    if (data.status === 'error') strapi.log.error(msg);
    else if (data.status === 'noop') strapi.log.debug(msg);
    else strapi.log.info(msg);

    try {
      await docs().create({ data });
    } catch (err) {
      strapi.log.error(`[kiteprop-sync] failed to persist log entry: ${err.message}`);
    }
  }

  return { record };
};

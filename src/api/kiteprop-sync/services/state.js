'use strict';

/**
 * state.js - wrapper around the `kiteprop-sync-state` single-type.
 *
 * Provides:
 *   - read()                              -> current state row (creates if missing)
 *   - update(partial)                     -> patch state fields
 *   - acquireLock(runId)                  -> returns true if the run can proceed
 *   - releaseLock({ success, error })     -> clears the lock and updates timestamps
 *   - bumpActivityCursor(activity)        -> advance cursor after processing one activity
 *   - bumpMaxPropertyId(id)               -> advance sniffer cursor
 */

const UID = 'api::kiteprop-sync-state.kiteprop-sync-state';

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = ({ strapi: _strapi } = {}) => {
  const docs = () => strapi.documents(UID);

  async function read() {
    let current = await docs().findFirst({});
    if (!current) {
      current = await docs().create({
        data: {
          is_running: false,
        },
      });
    }
    return current;
  }

  async function update(partial) {
    const current = await read();
    return docs().update({
      documentId: current.documentId,
      data: partial,
    });
  }

  async function acquireLock(runId) {
    const lockTimeoutMs = readEnvNumber('KITEPROP_SYNC_LOCK_TIMEOUT_MS', 600000);
    const current = await read();
    const now = new Date().toISOString();
    let staleLock = false;

    if (current.is_running && current.lock_acquired_at) {
      const acquiredAt = new Date(current.lock_acquired_at).getTime();
      const ageMs = Date.now() - acquiredAt;
      if (Number.isFinite(acquiredAt) && ageMs < lockTimeoutMs) {
        return { acquired: false, reason: 'locked', current };
      }
      staleLock = true;
      strapi.log.warn(
        `[kiteprop-sync] stale lock detected (age=${ageMs}ms) - forcing release for new run ${runId}`
      );
    }

    const locked = await strapi.db.query(UID).update({
      where: staleLock
        ? { documentId: current.documentId }
        : { documentId: current.documentId, is_running: false },
      data: {
        is_running: true,
        lock_acquired_at: now,
        current_run_id: runId,
      },
    });

    if (!locked) {
      return { acquired: false, reason: 'locked', current };
    }

    return { acquired: true, current: locked };
  }

  async function releaseLock({ success, error } = {}) {
    const patch = {
      is_running: false,
      lock_acquired_at: null,
      current_run_id: null,
      last_run_at: new Date().toISOString(),
    };
    if (success) {
      patch.last_success_at = new Date().toISOString();
      patch.last_error = null;
    }
    if (error) {
      patch.last_error = String(error?.message || error).slice(0, 1000);
    }
    return update(patch);
  }

  async function bumpActivityCursor(activity) {
    if (!activity || activity.id === undefined) return;
    const current = await read();
    const currentId = current.last_activity_id ? Number(current.last_activity_id) : 0;
    const newId = Number(activity.id);
    if (Number.isFinite(newId) && newId > currentId) {
      await update({
        last_activity_id: newId,
        last_activity_created_at: activity.created_at || null,
      });
    }
  }

  async function bumpMaxPropertyId(propertyId) {
    if (propertyId === undefined || propertyId === null) return;
    const current = await read();
    const currentMax = current.last_max_property_id ? Number(current.last_max_property_id) : 0;
    const incoming = Number(propertyId);
    if (Number.isFinite(incoming) && incoming > currentMax) {
      await update({ last_max_property_id: incoming });
    }
  }

  return {
    read,
    update,
    acquireLock,
    releaseLock,
    bumpActivityCursor,
    bumpMaxPropertyId,
  };
};

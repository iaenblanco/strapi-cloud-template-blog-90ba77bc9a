'use strict';

/**
 * KiteProp HTTP client.
 *
 * Responsibilities:
 *   - Build absolute URLs from KITEPROP_BASE_URL.
 *   - Inject X-API-Key header on every request.
 *   - Apply a request timeout via AbortController.
 *   - Retry transient errors (network, 5xx, 429) with exponential backoff + jitter.
 *   - Never log secrets (X-API-Key is redacted).
 *
 * Pure transport layer: it knows nothing about Strapi entities or business rules.
 */

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 5;
const DEFAULT_RETRY_BASE_MS = 500;
const DEFAULT_REQUEST_DELAY_MS = 2000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
let lastRequestStartedAt = 0;

function readEnvNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getConfig() {
  const baseUrl = (process.env.KITEPROP_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.KITEPROP_API_KEY || '';

  return {
    baseUrl,
    apiKey,
    timeoutMs: readEnvNumber('KITEPROP_SYNC_REQUEST_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    maxRetries: readEnvNumber('KITEPROP_SYNC_MAX_RETRIES', DEFAULT_MAX_RETRIES),
    retryBaseMs: readEnvNumber('KITEPROP_SYNC_RETRY_BASE_MS', DEFAULT_RETRY_BASE_MS),
    requestDelayMs: readEnvNumber('KITEPROP_SYNC_REQUEST_DELAY_MS', DEFAULT_REQUEST_DELAY_MS),
  };
}

function assertConfigured(cfg) {
  if (!cfg.baseUrl) {
    throw new Error('[kiteprop-sync] KITEPROP_BASE_URL is not configured');
  }
  if (!cfg.apiKey) {
    throw new Error('[kiteprop-sync] KITEPROP_API_KEY is not configured');
  }
}

function buildUrl(baseUrl, path, query) {
  const url = new URL(path.replace(/^\//, ''), `${baseUrl}/`);
  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(`${key}[]`, String(item));
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  return url.toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(attempt, baseMs) {
  const exp = baseMs * Math.pow(2, attempt - 1);
  const jitter = Math.floor(Math.random() * baseMs);
  return exp + jitter;
}

function isRetryable(error, response) {
  if (error) {
    if (error.name === 'AbortError') return true;
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') return true;
    if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') return true;
    return false;
  }
  if (response && RETRYABLE_STATUS.has(response.status)) return true;
  return false;
}

/**
 * Performs an HTTP request against the KiteProp API with retry + timeout.
 *
 * @param {object} opts
 * @param {string} opts.method - HTTP method (GET, POST, PUT, DELETE).
 * @param {string} opts.path   - API path (e.g. "/properties" or "/properties/123").
 * @param {object} [opts.query] - Query string params (arrays become repeated keys with []).
 * @param {object} [opts.body]  - JSON body (will be stringified).
 * @returns {Promise<{ status: number, ok: boolean, data: any, raw: any }>}
 */
async function request({ method, path, query, body, logger = console }) {
  const cfg = getConfig();
  assertConfigured(cfg);

  const url = buildUrl(cfg.baseUrl, path, query);
  const safeUrl = url.replace(cfg.apiKey, '***');

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt += 1) {
    const elapsedSinceLastRequest = Date.now() - lastRequestStartedAt;
    if (cfg.requestDelayMs > 0 && elapsedSinceLastRequest < cfg.requestDelayMs) {
      await sleep(cfg.requestDelayMs - elapsedSinceLastRequest);
    }
    lastRequestStartedAt = Date.now();

    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const startedAt = Date.now();

    try {
      const headers = {
        'X-API-Key': cfg.apiKey,
        Accept: 'application/json',
      };
      if (body !== undefined) headers['Content-Type'] = 'application/json';

      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutHandle);
      lastResponse = response;

      const elapsedMs = Date.now() - startedAt;
      const text = await response.text();
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = { raw: text };
        }
      }

      if (response.ok) {
        return { status: response.status, ok: true, data: parsed, raw: parsed };
      }

      if (isRetryable(null, response) && attempt < cfg.maxRetries) {
        const wait = computeBackoff(attempt, cfg.retryBaseMs);
        logger.warn(
          `[kiteprop-sync] ${method} ${safeUrl} -> ${response.status} (attempt ${attempt}/${cfg.maxRetries}, retrying in ${wait}ms)`
        );
        await sleep(wait);
        continue;
      }

      const error = new Error(
        `KiteProp API error: ${response.status} ${response.statusText} on ${method} ${path}`
      );
      error.status = response.status;
      error.body = parsed;
      error.elapsedMs = elapsedMs;
      throw error;
    } catch (err) {
      clearTimeout(timeoutHandle);

      if (err.status) {
        throw err;
      }

      lastError = err;
      if (isRetryable(err, null) && attempt < cfg.maxRetries) {
        const wait = computeBackoff(attempt, cfg.retryBaseMs);
        logger.warn(
          `[kiteprop-sync] ${method} ${safeUrl} -> ${err.code || err.name || 'error'} (attempt ${attempt}/${cfg.maxRetries}, retrying in ${wait}ms)`
        );
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }

  if (lastError) throw lastError;
  if (lastResponse) {
    const err = new Error(`KiteProp API failed after ${cfg.maxRetries} attempts`);
    err.status = lastResponse.status;
    throw err;
  }
  throw new Error('KiteProp API: unreachable code path');
}

module.exports = ({ strapi: _strapi } = {}) => ({
  /**
   * GET /profile — used as health check.
   */
  async getProfile() {
    return request({ method: 'GET', path: '/profile', logger: _strapi?.log || console });
  },

  /**
   * GET /properties/{id} — fetch a single property with full payload.
   */
  async getProperty(id) {
    if (!id) throw new Error('getProperty requires a numeric id');
    return request({
      method: 'GET',
      path: `/properties/${id}`,
      logger: _strapi?.log || console,
    });
  },

  /**
   * GET /properties — paginated list. Use `order=id:desc` + `limit=50`
   * to detect newly created properties (sniffer).
   */
  async listProperties({ page = 1, limit = 50, order = 'id:desc', status, type } = {}) {
    return request({
      method: 'GET',
      path: '/properties',
      query: { page, limit, order, status, type },
      logger: _strapi?.log || console,
    });
  },

  /**
   * GET /properties/activities — activity log.
   * Use `order=created_at:asc` and a stored cursor to walk only new entries.
   * Activity types: status_changed, price_update, user_assignment,
   * data_changed, category_changed, delete_property.
   */
  async listActivities({ page = 1, limit = 50, order = 'created_at:asc', date, property_id, type } = {}) {
    return request({
      method: 'GET',
      path: '/properties/activities',
      query: { page, limit, order, date, property_id, type },
      logger: _strapi?.log || console,
    });
  },

  /**
   * Expose a generic request for future extensions (Phase 2).
   */
  raw: request,

  _internal: {
    getConfig,
    buildUrl,
    isRetryable,
    computeBackoff,
  },
});

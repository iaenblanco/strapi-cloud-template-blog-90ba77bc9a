'use strict';

/**
 * has-trigger-token policy
 *
 * Protects manual KiteProp sync endpoints with a header-based token check.
 *
 * Rules:
 *   - Token MUST be provided via the `Authorization: Bearer <token>` header.
 *   - Token MUST NEVER be accepted via query string or URL path.
 *   - Token is compared in constant time against KITEPROP_SYNC_TRIGGER_TOKEN.
 *   - If KITEPROP_SYNC_TRIGGER_TOKEN is not configured, all requests are denied.
 *
 * The token is a server-side secret. It is independent from the KiteProp API key
 * and from Strapi's built-in API tokens, so we can rotate it without touching
 * either system.
 */

const crypto = require('crypto');

function constantTimeEquals(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

function extractBearer(ctx) {
  const header = ctx.request.header['authorization'] || ctx.request.header['Authorization'];
  if (!header || typeof header !== 'string') return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  return match[1].trim();
}

module.exports = (policyContext, _config, { strapi }) => {
  const expected = process.env.KITEPROP_SYNC_TRIGGER_TOKEN;

  if (!expected) {
    strapi.log.error(
      '[kiteprop-sync] KITEPROP_SYNC_TRIGGER_TOKEN is not configured; manual trigger endpoints are disabled'
    );
    return false;
  }

  const provided = extractBearer(policyContext);
  if (!provided) {
    strapi.log.warn('[kiteprop-sync] manual trigger rejected: missing Authorization header');
    return false;
  }

  const ok = constantTimeEquals(provided, expected);
  if (!ok) {
    strapi.log.warn('[kiteprop-sync] manual trigger rejected: invalid token');
    return false;
  }

  return true;
};

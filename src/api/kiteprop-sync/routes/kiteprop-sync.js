'use strict';

/**
 * kiteprop-sync routes
 *
 * All routes are protected by the `has-trigger-token` policy.
 * `auth: false` disables Strapi's built-in auth (API token / users-permissions),
 * so the ONLY accepted credential is the Bearer token in the Authorization
 * header that the policy validates against KITEPROP_SYNC_TRIGGER_TOKEN.
 *
 * Tokens MUST NEVER be passed via query string or URL.
 */

const policy = ['api::kiteprop-sync.has-trigger-token'];

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/kiteprop-sync/health',
      handler: 'kiteprop-sync.health',
      config: { policies: policy, auth: false },
    },
    {
      method: 'GET',
      path: '/kiteprop-sync/state',
      handler: 'kiteprop-sync.getState',
      config: { policies: policy, auth: false },
    },
    {
      method: 'POST',
      path: '/kiteprop-sync/properties/run-delta',
      handler: 'kiteprop-sync.runDelta',
      config: { policies: policy, auth: false },
    },
    {
      method: 'POST',
      path: '/kiteprop-sync/properties/run-sniffer',
      handler: 'kiteprop-sync.runSniffer',
      config: { policies: policy, auth: false },
    },
    {
      method: 'POST',
      path: '/kiteprop-sync/properties/run-all',
      handler: 'kiteprop-sync.runAll',
      config: { policies: policy, auth: false },
    },
    {
      method: 'POST',
      path: '/kiteprop-sync/properties/:id',
      handler: 'kiteprop-sync.syncOne',
      config: { policies: policy, auth: false },
    },
  ],
};

'use strict';

const { createCoreRouter } = require('@strapi/strapi').factories;

/**
 * Default core router is intentionally NOT exposed publicly.
 * The state is managed via the `kiteprop-sync` controller (header-protected)
 * and the Strapi admin panel. Public REST routes for this content-type
 * stay disabled by default in Strapi 5 (no public permission granted).
 */
module.exports = createCoreRouter('api::kiteprop-sync-state.kiteprop-sync-state');

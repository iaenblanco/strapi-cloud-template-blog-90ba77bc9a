module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  // Cron is OFF by default. Enable with CRON_ENABLED=true (and
  // KITEPROP_SYNC_ENABLED=true to actually run the KiteProp sync tasks).
  cron: {
    enabled: env.bool('CRON_ENABLED', false),
    tasks: require('./cron-tasks'),
  },
});

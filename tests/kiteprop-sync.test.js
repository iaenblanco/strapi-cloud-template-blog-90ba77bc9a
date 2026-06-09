'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const mappers = require('../src/api/kiteprop-sync/services/mappers');
const hashes = require('../src/api/kiteprop-sync/services/hash');
const imageHelpers = require('../src/api/kiteprop-sync/services/images');

const PROPIEDAD_UID = 'api::propiedad.propiedad';
const KITEPROP_IMAGE_UID = 'api::kiteprop-image.kiteprop-image';
const originalFetch = global.fetch;

function sampleProperty(overrides = {}) {
  return {
    id: 101,
    code: 'KP101',
    status: 'active',
    title: 'Casa 101',
    description: 'Desc',
    type: 'houses',
    for_sale: true,
    for_sale_price: 100,
    currency: 'clp',
    updated_at: '2026-05-01T10:00:00.000000Z',
    images_list: [
      {
        id: 11,
        title: 'A',
        position: 0,
        main: true,
        lg: ' https://cdn.example.com/101/11-lg.jpg ',
      },
      {
        id: 12,
        title: 'B',
        position: 1,
        main: false,
        lg: 'https://cdn.example.com/101/12-lg.jpg',
      },
    ],
    ...overrides,
  };
}

function computedHashes(kp) {
  const payload = mappers.mapPropertyToStrapi(kp);
  const mappedImages = mappers.mapKitepropImagenes(kp.images_list);
  const normalizedImages = imageHelpers.normalizeKitepropImages(mappedImages, payload.kiteprop_id, 12);
  return {
    dataHash: hashes.buildPropertyDataHash(payload),
    imagesHash: hashes.buildPropertyImagesHash(normalizedImages),
    normalizedImages,
  };
}

function loadService() {
  delete require.cache[require.resolve('../src/api/kiteprop-sync/services/properties-sync')];
  return require('../src/api/kiteprop-sync/services/properties-sync')({});
}

function loadReconciliationService() {
  delete require.cache[require.resolve('../src/api/kiteprop-sync/services/reconciliation')];
  return require('../src/api/kiteprop-sync/services/reconciliation')({});
}

function loadMappingAuditService() {
  delete require.cache[require.resolve('../src/api/kiteprop-sync/services/mapping-audit')];
  return require('../src/api/kiteprop-sync/services/mapping-audit')({});
}

function loadFrontendDeployService() {
  delete require.cache[require.resolve('../src/api/kiteprop-sync/services/frontend-deploy')];
  return require('../src/api/kiteprop-sync/services/frontend-deploy')({});
}

function loadAutoSyncService() {
  delete require.cache[require.resolve('../src/api/kiteprop-sync/services/auto-sync')];
  return require('../src/api/kiteprop-sync/services/auto-sync')({});
}

function loadController() {
  delete require.cache[require.resolve('../src/api/kiteprop-sync/controllers/kiteprop-sync')];
  return require('../src/api/kiteprop-sync/controllers/kiteprop-sync');
}

function localPropertyFromKiteProp(kp, overrides = {}) {
  const payload = mappers.mapPropertyToStrapi(kp);
  const { dataHash, imagesHash, normalizedImages } = computedHashes(kp);
  return {
    id: 1,
    documentId: `prop-${kp.id}`,
    Slug: `prop-${kp.id}`,
    ...payload,
    kiteprop_data_hash: dataHash,
    kiteprop_images_hash: imagesHash,
    kiteprop_sync_status: 'ok',
    kiteprop_sync_error: null,
    Imagenes: normalizedImages.map((image, index) => ({
      id: 500 + index,
      url: `/uploads/${image.image_key}.jpg`,
    })),
    kiteprop_imagenes: normalizedImages.map((image) => ({
      image_key: image.image_key,
      remote_image_id: image.remote_image_id,
      remote_url: image.remote_url,
      remote_url_hash: image.remote_url_hash,
      order: image.order,
    })),
    ...overrides,
  };
}

function kitepropImageRowsFor(kp, overrides = {}) {
  return computedHashes(kp).normalizedImages.map((image, index) => ({
    id: 100 + index,
    documentId: `map-${index}`,
    kiteprop_property_id: String(kp.id),
    image_key: image.image_key,
    remote_image_id: image.remote_image_id,
    remote_url: image.remote_url,
    remote_url_hash: image.remote_url_hash,
    order: image.order,
    status: 'active',
    file: { id: 500 + index, url: `/uploads/${image.image_key}.jpg` },
    ...overrides[image.image_key],
  }));
}

function installStrapiMock(options = {}) {
  const calls = {
    propertyCreates: [],
    propertyUpdates: [],
    propertyCreateStatuses: [],
    propertyUpdateStatuses: [],
    propertyUnpublishes: [],
    imageCreates: [],
    imageUpdates: [],
    uploadCalls: [],
    logs: [],
    bumpActivityCursor: [],
    bumpMaxPropertyId: [],
    releaseLock: [],
    findImageFilters: [],
    listProperties: [],
    listActivities: [],
    getProperty: [],
    strapiFindMany: [],
    storeGets: [],
    storeSets: [],
    infoLogs: [],
    warnLogs: [],
    errorLogs: [],
    serviceRequests: [],
  };

  let currentProperty = options.existingProperty || null;
  const imageMappings = new Map();
  for (const mapping of options.imageMappings || []) {
    imageMappings.set(`${mapping.kiteprop_property_id}:${mapping.image_key}`, mapping);
  }

  const propertyDocs = {
    async findFirst({ filters, status } = {}) {
      const requestedKitepropId = filters?.kiteprop_id ? Number(filters.kiteprop_id) : null;
      if (status === 'published') {
        if (Object.prototype.hasOwnProperty.call(options, 'publishedLocalProperties')) {
          return requestedKitepropId ? options.publishedLocalProperties?.[requestedKitepropId] || null : null;
        }
      }
      if (requestedKitepropId && options.localProperties?.[requestedKitepropId]) {
        return options.localProperties[requestedKitepropId];
      }
      if (!currentProperty) return null;
      if (requestedKitepropId && requestedKitepropId !== Number(currentProperty.kiteprop_id)) {
        return null;
      }
      return currentProperty;
    },
    async create({ status, data }) {
      calls.propertyCreateStatuses.push(status);
      calls.propertyCreates.push(data);
      currentProperty = { id: 1, documentId: 'prop-created', ...data };
      return currentProperty;
    },
    async update({ documentId, status, data }) {
      calls.propertyUpdateStatuses.push(status);
      calls.propertyUpdates.push({ documentId, data });
      currentProperty = { ...(currentProperty || {}), documentId, ...data };
      return currentProperty;
    },
    async unpublish({ documentId }) {
      calls.propertyUnpublishes.push(documentId);
    },
  };

  const imageDocs = {
    async findFirst({ filters } = {}) {
      calls.findImageFilters.push(filters);
      return imageMappings.get(`${filters?.kiteprop_property_id}:${filters?.image_key}`) || null;
    },
    async create({ data }) {
      calls.imageCreates.push(data);
      const created = { id: calls.imageCreates.length, documentId: `img-${calls.imageCreates.length}`, ...data };
      imageMappings.set(`${data.kiteprop_property_id}:${data.image_key}`, created);
      return created;
    },
    async update({ documentId, data }) {
      calls.imageUpdates.push({ documentId, data });
      return { documentId, ...data };
    },
    async findMany() {
      if (options.kitepropImageFindManyError) throw options.kitepropImageFindManyError;
      return options.kitepropImageRows || [];
    },
  };

  const state = {
    async read() {
      return options.state || { last_activity_id: 0, last_max_property_id: 0 };
    },
    async acquireLock(runId) {
      return options.lock || { acquired: true, current: { current_run_id: runId } };
    },
    async releaseLock(payload) {
      calls.releaseLock.push(payload);
    },
    async bumpActivityCursor(activity) {
      calls.bumpActivityCursor.push(activity);
    },
    async bumpMaxPropertyId(id) {
      calls.bumpMaxPropertyId.push(id);
    },
  };

  const client = {
    async getProperty(id) {
      calls.getProperty.push(Number(id));
      const value = options.properties?.[id];
      if (value instanceof Error) throw value;
      return { data: { data: value || sampleProperty({ id }) } };
    },
    async listActivities(params = {}) {
      calls.listActivities.push(params);
      if (options.activityListError) throw options.activityListError;
      // Soporta paginación explícita (options.activityPages keyed by page) para
      // simular el orden created_at:desc real de KiteProp. Si no, devuelve la
      // lista plana options.activities en la página 1.
      if (options.activityPages) {
        const page = options.activityPages[params.page] || [];
        return { data: { data: page } };
      }
      return { data: { data: params.page === 1 ? options.activities || [] : [] } };
    },
    async listProperties() {
      const params = arguments[0] || {};
      calls.listProperties.push(params);
      if (options.listPropertiesError) throw options.listPropertiesError;
      if (options.propertyListPages) {
        const page = options.propertyListPages[params.page] || [];
        return { data: { data: page, meta: options.propertyListMeta?.[params.page] || {} } };
      }
      return { data: { data: options.propertyList || [] } };
    },
  };

  const strapiRows = options.strapiRows || [];
  const storeValues = new Map(Object.entries(options.storeValues || {}));

  global.strapi = {
    config: {
      environment: 'test',
    },
    contentTypes: {
      [PROPIEDAD_UID]: {
        attributes: {
          kiteprop_id: { type: 'biginteger' },
          kiteprop_status: { type: 'string' },
        },
      },
    },
    documents(uid) {
      if (uid === PROPIEDAD_UID) return propertyDocs;
      if (uid === KITEPROP_IMAGE_UID) return imageDocs;
      throw new Error(`Unexpected uid ${uid}`);
    },
    db: {
      query(uid) {
        if (uid === PROPIEDAD_UID) {
          return {
            async findMany(params) {
              calls.strapiFindMany.push(params);
              if (options.strapiFindManyError) throw options.strapiFindManyError;
              const offset = params?.offset || 0;
              const limit = params?.limit || strapiRows.length;
              return strapiRows.slice(offset, offset + limit);
            },
          };
        }
        return {
          async findOne({ where }) {
            return options.legacyUploads?.[where.name] || null;
          },
          async update() {
            return {};
          },
        };
      },
    },
    plugin(name) {
      assert.equal(name, 'upload');
      return {
        service(serviceName) {
          assert.equal(serviceName, 'upload');
          return {
            async upload(payload) {
              calls.uploadCalls.push(payload);
              if (options.uploadError) throw options.uploadError;
              return [{ id: options.uploadedFileId || 999, name: payload.data.fileInfo.name }];
            },
          };
        },
      };
    },
    service(uid) {
      calls.serviceRequests.push(uid);
      if (uid === 'api::kiteprop-sync.logger') {
        return {
          async record(entry) {
            calls.logs.push(entry);
          },
        };
      }
      if (uid === 'api::kiteprop-sync.state') return state;
      if (uid === 'api::kiteprop-sync.client') return client;
      if (uid === 'api::kiteprop-sync.reconciliation') return loadReconciliationService();
      if (uid === 'api::kiteprop-sync.mapping-audit') return loadMappingAuditService();
      if (uid === 'api::kiteprop-sync.frontend-deploy') return loadFrontendDeployService();
      if (uid === 'api::kiteprop-sync.properties-sync') {
        return options.syncServiceOverride || loadService();
      }
      throw new Error(`Unexpected service ${uid}`);
    },
    store() {
      return {
        async get({ key }) {
          calls.storeGets.push(key);
          return storeValues.get(key);
        },
        async set({ key, value }) {
          calls.storeSets.push({ key, value });
          storeValues.set(key, value);
        },
      };
    },
    log: {
      info(message) { calls.infoLogs.push(message); },
      warn(message) { calls.warnLogs.push(message); },
      error(message) { calls.errorLogs.push(message); },
      debug() {},
    },
  };

  return calls;
}

test.beforeEach(() => {
  global.fetch = originalFetch;
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'true';
  process.env.KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY = '12';
  delete process.env.KITEPROP_SYNC_PAGE_SIZE_PROPERTIES;
  delete process.env.KITEPROP_SYNC_DELTA_MAX_PAGES;
  delete process.env.FRONTEND_DEPLOY_ENABLED;
  delete process.env.FRONTEND_DEPLOY_HOOK_URL;
  delete process.env.FRONTEND_DEPLOY_MIN_INTERVAL_MS;
  delete process.env.FRONTEND_DEPLOY_REASON_LOG;
  delete process.env.FRONTEND_DEPLOY_TIMEOUT_MS;
  delete process.env.KITEPROP_AUTO_SYNC_ENABLED;
  delete process.env.KITEPROP_AUTO_SYNC_MODE;
  delete process.env.KITEPROP_AUTO_SYNC_INTERVAL_MS;
  delete process.env.KITEPROP_AUTO_SYNC_MAX_PAGES;
  delete process.env.KITEPROP_AUTO_SYNC_MAX_ITEMS;
  delete process.env.KITEPROP_AUTO_SYNC_DRY_RUN;
});

test('mapper assigns UF sale price only to Precio', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ currency: 'uf', for_sale_price: 8096 }));

  assert.equal(payload.Precio, 8096);
  assert.equal(payload.Precio_CLP, null);
});

test('mapper assigns CLP sale price only to Precio_CLP', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ currency: 'clp', for_sale_price: 27000000 }));

  assert.equal(payload.Precio, null);
  assert.equal(payload.Precio_CLP, 27000000);
});

test('mapper assigns CLP rent price only to Precio_CLP', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({
    currency: 'clp',
    for_sale: false,
    for_rent: true,
    for_rent_price: 500000,
  }));

  assert.equal(payload.Precio, null);
  assert.equal(payload.Precio_CLP, 500000);
});

test('mapper assigns UF rent price only to Precio', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({
    currency: 'uf',
    for_sale: false,
    for_rent: true,
    for_rent_price: 20,
  }));

  assert.equal(payload.Precio, 20);
  assert.equal(payload.Precio_CLP, null);
});

test('mapper leaves prices empty for unknown currency', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ currency: 'usd', for_sale_price: 1000 }));

  assert.equal(payload.Precio, null);
  assert.equal(payload.Precio_CLP, null);
});

// ---------------------------------------------------------------------------
// Destacado / Oportunidades — postal code logic
// ---------------------------------------------------------------------------

test('postal code "000000" sets Destacado=true Oportunidades=false', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ postal_code: '000000' }));

  assert.equal(payload.Destacado, true);
  assert.equal(payload.Oportunidades, false);
});

test('postal code "000001" sets Destacado=false Oportunidades=true', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ postal_code: '000001' }));

  assert.equal(payload.Destacado, false);
  assert.equal(payload.Oportunidades, true);
});

test('postal code "000002" sets Destacado=true Oportunidades=true', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ postal_code: '000002' }));

  assert.equal(payload.Destacado, true);
  assert.equal(payload.Oportunidades, true);
});

test('postal code null/undefined/absent sets both flags to false', () => {
  for (const override of [{ postal_code: null }, { postal_code: undefined }, {}]) {
    const payload = mappers.mapPropertyToStrapi(sampleProperty(override));

    assert.equal(payload.Destacado, false, `Failed for postal_code=${JSON.stringify(override.postal_code)}`);
    assert.equal(payload.Oportunidades, false, `Failed for postal_code=${JSON.stringify(override.postal_code)}`);
  }
});

test('postal code empty string sets both flags to false', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ postal_code: '' }));

  assert.equal(payload.Destacado, false);
  assert.equal(payload.Oportunidades, false);
});

test('postal code "123456" (unrecognized) sets both flags to false', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ postal_code: '123456' }));

  assert.equal(payload.Destacado, false);
  assert.equal(payload.Oportunidades, false);
});

test('tags with "destacado" do NOT influence flags when postal code does not match', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({
    tags: ['destacado'],
    postal_code: '999999',
  }));

  assert.equal(payload.Destacado, false);
  assert.equal(payload.Oportunidades, false);
});

test('previously featured property gets flags cleared when postal code changes to non-matching', () => {
  const payload = mappers.mapPropertyToStrapi(sampleProperty({ postal_code: '12345' }));

  assert.equal(payload.Destacado, false);
  assert.equal(payload.Oportunidades, false);
});

test('getKitepropPostalCode preserves leading zeros from string', () => {
  assert.equal(mappers.getKitepropPostalCode({ postal_code: '000001' }), '000001');
});

test('getKitepropPostalCode converts number 0 to "0" (not "000000")', () => {
  assert.equal(mappers.getKitepropPostalCode({ postal_code: 0 }), '0');
});

test('getKitepropPostalCode trims whitespace', () => {
  assert.equal(mappers.getKitepropPostalCode({ postal_code: '  000000  ' }), '000000');
});

test('getKitepropPostalCode returns empty string for null/undefined', () => {
  assert.equal(mappers.getKitepropPostalCode({ postal_code: null }), '');
  assert.equal(mappers.getKitepropPostalCode({ postal_code: undefined }), '');
  assert.equal(mappers.getKitepropPostalCode(null), '');
  assert.equal(mappers.getKitepropPostalCode({}), '');
});

test('slug helper includes kiteprop_id and normalizes accents and symbols', () => {
  const slug = mappers.buildKitepropSlug(
    'Oportunidad de Inversión: Depto 1D/1B en Estación Central',
    510853
  );

  assert.equal(slug, 'oportunidad-de-inversion-depto-1d-1b-en-estacion-central-510853');
});

test('generates Slug when creating a new KiteProp property', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp = sampleProperty({
    id: 510853,
    title: 'Oportunidad de Inversión: Depto 1D/1B en Estación Central',
  });
  const calls = installStrapiMock();
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.action, 'create');
  assert.equal(calls.propertyCreates.length, 1);
  assert.equal(
    calls.propertyCreates[0].Slug,
    'oportunidad-de-inversion-depto-1d-1b-en-estacion-central-510853'
  );
});

test('generates Slug when updating an existing KiteProp property with empty Slug', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp = sampleProperty({ id: 510853, title: 'Casa Ñuñoa / Metro' });
  const { dataHash, imagesHash } = computedHashes(kp);
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-510853',
      Slug: '',
      kiteprop_id: 510853,
      kiteprop_updated_at: kp.updated_at,
      kiteprop_data_hash: dataHash,
      kiteprop_images_hash: imagesHash,
      Imagenes: [],
    },
  });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.action, 'update');
  assert.equal(calls.propertyUpdates.length, 1);
  assert.equal(calls.propertyUpdates[0].data.Slug, 'casa-nunoa-metro-510853');
});

test('does not overwrite an existing Slug when updating a KiteProp property', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp = sampleProperty({ id: 510853, title: 'Nuevo titulo remoto' });
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-510853',
      Slug: 'slug-manual',
      kiteprop_id: 510853,
      kiteprop_updated_at: '2026-04-01T10:00:00.000000Z',
      kiteprop_data_hash: 'old',
      kiteprop_images_hash: 'old',
      Imagenes: [],
    },
  });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.action, 'update');
  assert.equal(calls.propertyUpdates.length, 1);
  assert.equal(calls.propertyUpdates[0].data.Slug, undefined);
});

test('does not create a duplicate property when kiteprop_id already exists', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp = sampleProperty({ title: 'Updated title' });
  const existing = {
    documentId: 'prop-1',
    kiteprop_id: 101,
    kiteprop_updated_at: '2026-04-01T10:00:00.000000Z',
    kiteprop_data_hash: 'old',
    Imagenes: [],
  };
  const calls = installStrapiMock({ existingProperty: existing });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.action, 'update');
  assert.equal(calls.propertyCreates.length, 0);
  assert.equal(calls.propertyUpdates.length, 1);
});

test('does not upload images when images_hash is unchanged', async () => {
  const kp = sampleProperty();
  const { dataHash, imagesHash } = computedHashes(kp);
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-1',
      Slug: mappers.buildKitepropSlug(kp.title, kp.id),
      kiteprop_id: 101,
      kiteprop_updated_at: kp.updated_at,
      kiteprop_data_hash: dataHash,
      kiteprop_images_hash: imagesHash,
      Imagenes: [{ id: 11 }, { id: 12 }],
    },
    uploadError: new Error('upload should not happen'),
  });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.action, 'skip');
  assert.equal(calls.uploadCalls.length, 0);
  assert.equal(calls.propertyUpdates.length, 0);
});

test('publishes existing KiteProp draft even when data and images hashes are unchanged', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp = sampleProperty();
  const { dataHash, imagesHash } = computedHashes(kp);
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-1',
      Slug: mappers.buildKitepropSlug(kp.title, kp.id),
      kiteprop_id: 101,
      kiteprop_updated_at: kp.updated_at,
      kiteprop_data_hash: dataHash,
      kiteprop_images_hash: imagesHash,
      Imagenes: [{ id: 11 }, { id: 12 }],
      Publicado: true,
    },
    publishedLocalProperties: {},
  });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.action, 'update');
  assert.equal(calls.propertyUpdates.length, 1);
  assert.equal(calls.propertyUpdateStatuses[0], 'published');
  assert.equal(calls.propertyUpdates[0].data.Publicado, true);
  assert.equal(calls.propertyUnpublishes.length, 0);
});

test('reuses an existing image mapping by image_key', async () => {
  const kp = sampleProperty({ images_list: [sampleProperty().images_list[0]] });
  const { dataHash, normalizedImages } = computedHashes(kp);
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-1',
      Slug: mappers.buildKitepropSlug(kp.title, kp.id),
      kiteprop_id: 101,
      kiteprop_updated_at: kp.updated_at,
      kiteprop_data_hash: dataHash,
      kiteprop_images_hash: 'old',
      Imagenes: [],
    },
    imageMappings: [
      {
        documentId: 'map-1',
        kiteprop_property_id: '101',
        image_key: normalizedImages[0].image_key,
        file: { id: 77, name: 'existing' },
      },
    ],
    uploadError: new Error('upload should not happen'),
  });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.images_reused, 1);
  assert.equal(calls.uploadCalls.length, 0);
  assert.deepEqual(calls.propertyUpdates.at(-1).data.Imagenes, [77]);
});

test('reorders images without re-uploading existing files', async () => {
  const original = sampleProperty();
  const kp = sampleProperty({
    images_list: [
      { ...original.images_list[1], position: 0, main: true },
      { ...original.images_list[0], position: 1, main: false },
    ],
  });
  const { dataHash, normalizedImages } = computedHashes(kp);
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-1',
      Slug: mappers.buildKitepropSlug(kp.title, kp.id),
      kiteprop_id: 101,
      kiteprop_updated_at: kp.updated_at,
      kiteprop_data_hash: dataHash,
      kiteprop_images_hash: 'old',
      Imagenes: [{ id: 11 }, { id: 12 }],
    },
    imageMappings: [
      {
        documentId: 'map-12',
        kiteprop_property_id: '101',
        image_key: normalizedImages[0].image_key,
        file: { id: 12 },
      },
      {
        documentId: 'map-11',
        kiteprop_property_id: '101',
        image_key: normalizedImages[1].image_key,
        file: { id: 11 },
      },
    ],
    uploadError: new Error('upload should not happen'),
  });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.images_reused, 2);
  assert.equal(calls.uploadCalls.length, 0);
  assert.deepEqual(calls.propertyUpdates.at(-1).data.Imagenes, [12, 11]);
});

test('does not save images_hash when an image import fails', async () => {
  const kp = sampleProperty({ images_list: [sampleProperty().images_list[0]] });
  const { dataHash } = computedHashes(kp);
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-1',
      Slug: mappers.buildKitepropSlug(kp.title, kp.id),
      kiteprop_id: 101,
      kiteprop_updated_at: kp.updated_at,
      kiteprop_data_hash: dataHash,
      kiteprop_images_hash: 'old',
      Imagenes: [],
    },
    uploadError: new Error('download failed'),
  });
  const service = loadService();

  const result = await service._internal.upsertProperty(kp, {
    runId: 'run-test',
    source: 'test',
    dryRun: false,
  });

  assert.equal(result.status, 'error');
  assert.equal(calls.propertyUpdates.length, 1);
  assert.equal(calls.propertyUpdates[0].data.kiteprop_images_hash, undefined);
});

test('respects KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY', () => {
  const images = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    lg: `https://cdn.example.com/${index + 1}.jpg`,
  }));

  const normalized = imageHelpers.normalizeKitepropImages(images, 101, 12);

  assert.equal(normalized.length, 12);
});

test('does not mix image identity across properties', () => {
  const sameRemoteImage = { id: 11, lg: 'https://cdn.example.com/shared.jpg' };

  assert.notEqual(
    imageHelpers.buildImageKey(101, sameRemoteImage),
    imageHelpers.buildImageKey(202, sameRemoteImage)
  );
});

test('runDelta does not advance cursor when a property fails', async () => {
  const error = new Error('KiteProp unavailable');
  const calls = installStrapiMock({
    activities: [{ id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' }],
    properties: { 101: error },
  });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-test', dryRun: false, maxPages: 1, maxItems: 1 });

  assert.equal(result.summary.errors, 1);
  assert.equal(calls.bumpActivityCursor.length, 0);
});

test('runSniffer does not advance property cursor when a property fails', async () => {
  const error = new Error('KiteProp unavailable');
  const calls = installStrapiMock({
    state: { last_activity_id: 0, last_max_property_id: 100 },
    propertyList: [{ id: 101 }],
    properties: { 101: error },
  });
  const service = loadService();

  const result = await service.runSniffer({ runId: 'run-test', dryRun: false, maxPages: 1, maxItems: 1 });

  assert.equal(result.summary.errors, 1);
  assert.equal(calls.bumpMaxPropertyId.length, 0);
});

test('dryRun does not write properties, image mappings, hashes, or cursors', async () => {
  const kp = sampleProperty();
  const calls = installStrapiMock({
    activities: [{ id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' }],
    properties: { 101: kp },
  });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-test', dryRun: true, maxPages: 1, maxItems: 1 });

  assert.equal(result.summary.errors, 0);
  assert.equal(calls.propertyCreates.length, 0);
  assert.equal(calls.propertyUpdates.length, 0);
  assert.equal(calls.imageCreates.length, 0);
  assert.equal(calls.imageUpdates.length, 0);
  assert.equal(calls.bumpActivityCursor.length, 0);
  assert.equal(calls.bumpMaxPropertyId.length, 0);
});

test('frontend deploy does not call hook when disabled', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'false';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'test',
    source: 'test',
    runId: 'run-test',
    changedItems: { created: 1 },
  });

  assert.equal(result.reason, 'disabled');
  assert.equal(fetchCalls.length, 0);
});

test('frontend deploy does not call hook when URL is missing', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'test',
    source: 'test',
    runId: 'run-test',
    changedItems: { created: 1 },
  });

  assert.equal(result.reason, 'missing_hook_url');
  assert.equal(fetchCalls.length, 0);
});

test('frontend deploy does not call hook for dryRun', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    dryRun: true,
    changedItems: { created: 1 },
  });

  assert.equal(result.reason, 'dry_run');
  assert.equal(fetchCalls.length, 0);
});

test('frontend deploy ignores summaries with only skips/noops', () => {
  const deploy = loadFrontendDeployService();
  const decision = deploy.shouldTriggerDeployFromSyncResult({
    dry_run: false,
    summary: { created: 0, updated: 0, soft_deleted: 0, errors: 0, skipped: 3 },
    items: [{ action: 'skip', status: 'noop' }],
  });

  assert.equal(decision.shouldTrigger, false);
});

test('frontend deploy ignores noop and skip items', () => {
  const deploy = loadFrontendDeployService();
  const decision = deploy.shouldTriggerDeployFromSyncResult({
    dry_run: false,
    items: [
      { action: 'fetch', status: 'ok' },
      { action: 'skip', status: 'noop' },
      { action: 'update', status: 'noop' },
    ],
  });

  assert.equal(decision.shouldTrigger, false);
});

test('frontend deploy triggers for created property changes', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'created',
    source: 'test',
    runId: 'run-created',
    changedItems: { created: 1, updated: 0, soft_deleted: 0 },
  });

  assert.equal(result.triggered, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][1].method, 'POST');
  assert.ok(calls.storeSets.some((item) => item.key === 'last_frontend_deploy_at'));
});

test('frontend deploy triggers for updated property changes', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'updated',
    source: 'test',
    runId: 'run-updated',
    changedItems: { updated: 1 },
  });

  assert.equal(result.triggered, true);
  assert.equal(fetchCalls.length, 1);
});

test('frontend deploy triggers for soft-deleted property changes', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'soft delete',
    source: 'test',
    runId: 'run-soft-delete',
    changedItems: { soft_deleted: 1 },
  });

  assert.equal(result.triggered, true);
  assert.equal(fetchCalls.length, 1);
});

test('frontend deploy does not call hook twice inside minimum interval', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  process.env.FRONTEND_DEPLOY_MIN_INTERVAL_MS = '600000';
  installStrapiMock({
    storeValues: {
      last_frontend_deploy_at: new Date().toISOString(),
    },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'debounced',
    source: 'test',
    runId: 'run-debounce',
    changedItems: { created: 1 },
  });

  assert.equal(result.reason, 'debounce');
  assert.equal(fetchCalls.length, 0);
});

function lastStoreValue(calls, key) {
  const entry = [...calls.storeSets].reverse().find((item) => item.key === key);
  return entry ? entry.value : undefined;
}

test('coordinador: sin cambios ni pendiente no deploya', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().processPendingDeploy({ source: 'test' });

  assert.equal(result.reason, 'no_pending');
  assert.equal(fetchCalls.length, 0);
});

test('coordinador: el debounce deja un deploy pendiente persistente', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  process.env.FRONTEND_DEPLOY_MIN_INTERVAL_MS = '600000';
  const calls = installStrapiMock({
    storeValues: { last_frontend_deploy_at: new Date().toISOString() },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'changes within debounce',
    source: 'test',
    changedItems: { created: 2 },
  });

  assert.equal(result.reason, 'debounce');
  assert.equal(fetchCalls.length, 0);
  // POR QUÉ: no perdemos el cambio; queda pendiente para la próxima corrida segura.
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), true);
  assert.equal(lastStoreValue(calls, 'frontend_deploy_last_changed_count'), 2);
});

test('coordinador: si el hook falla, mantiene pending_deploy=true', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock();
  global.fetch = async () => ({ ok: false, status: 500 });

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'hook will fail',
    source: 'test',
    changedItems: { updated: 1 },
  });

  assert.equal(result.reason, 'hook_error');
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), true);
  assert.ok(lastStoreValue(calls, 'frontend_deploy_last_error'));
});

test('coordinador: un deploy exitoso limpia el pendiente', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'real change',
    source: 'test',
    changedItems: { created: 1 },
  });

  assert.equal(result.triggered, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), false);
});

test('coordinador: cambio manual marca pendiente y deploya cuando corresponde', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().notifyManualChange({
    reason: 'manual update propiedad',
    source: 'lifecycle:update',
  });

  assert.equal(result.triggered, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), false);
});

test('coordinador: cambio manual respeta el debounce y deja pendiente', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  process.env.FRONTEND_DEPLOY_MIN_INTERVAL_MS = '600000';
  const calls = installStrapiMock({
    storeValues: { last_frontend_deploy_at: new Date().toISOString() },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().notifyManualChange({
    reason: 'manual create propiedad',
    source: 'lifecycle:create',
  });

  assert.equal(result.reason, 'debounce');
  assert.equal(fetchCalls.length, 0);
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), true);
});

test('coordinador: anti-loop begin/end marca escritura de sync en progreso', () => {
  installStrapiMock();
  const deploy = loadFrontendDeployService();

  assert.equal(deploy.isSyncWriteInProgress(), false);
  deploy.beginSyncWrites();
  deploy.beginSyncWrites();
  assert.equal(deploy.isSyncWriteInProgress(), true);
  deploy.endSyncWrites();
  assert.equal(deploy.isSyncWriteInProgress(), true);
  deploy.endSyncWrites();
  assert.equal(deploy.isSyncWriteInProgress(), false);
});

test('coordinador: deploy pendiente previo se drena en una corrida sin cambios nuevos', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock({
    storeValues: { frontend_deploy_pending: true },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  // Sin cambios nuevos (changedItems vacío) pero con pendiente previo: debe deployar.
  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'drain pending',
    source: 'test',
    changedItems: {},
  });

  assert.equal(result.triggered, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), false);
});

test('runDelta: detecta actividad nueva aunque el cursor esté atrasado (desc, multipágina)', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.KITEPROP_SYNC_PAGE_SIZE_PROPERTIES = '2';
  const calls = installStrapiMock({
    state: { last_activity_id: 117977, last_max_property_id: 0 },
    activityPages: {
      // created_at:desc -> lo más nuevo primero.
      1: [
        { id: 118002, property_id: 506022, type: 'data_changed', created_at: '2026-06-01T10:00:00Z' },
        { id: 118001, property_id: 999, type: 'data_changed', created_at: '2026-06-01T09:00:00Z' },
      ],
      2: [
        { id: 118000, property_id: 888, type: 'data_changed', created_at: '2026-05-31T10:00:00Z' },
        // cruza el cursor: de aquí en más es viejo.
        { id: 117977, property_id: 1, type: 'data_changed', created_at: '2026-04-27T10:00:00Z' },
      ],
    },
    properties: {
      506022: sampleProperty({ id: 506022 }),
      999: sampleProperty({ id: 999 }),
      888: sampleProperty({ id: 888 }),
    },
  });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-desc', dryRun: false, maxPages: 5, maxItems: 10 });

  // Encontró las 3 nuevas (118000, 118001, 118002) pese al cursor atrasado.
  assert.equal(result.summary.created, 3);
  assert.equal(result.summary.new_activities_collected, 3);
  assert.equal(result.summary.boundary_reached, true);
  assert.ok(calls.getProperty.includes(506022));
  // Cursor avanza hasta la actividad nueva más alta.
  assert.equal(result.summary.final_cursor, 118002);
});

test('runDelta: no se queda atrapado si la primera página trae solo actividades ya conocidas', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const calls = installStrapiMock({
    state: { last_activity_id: 117977, last_max_property_id: 0 },
    activityPages: {
      1: [
        { id: 117977, property_id: 1, type: 'data_changed', created_at: '2026-04-27T10:00:00Z' },
        { id: 117000, property_id: 2, type: 'data_changed', created_at: '2026-04-20T10:00:00Z' },
      ],
    },
  });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-known', dryRun: false, maxPages: 5, maxItems: 10 });

  assert.equal(result.summary.new_activities_collected, 0);
  assert.equal(result.summary.items_processed, 0);
  assert.equal(result.summary.created, 0);
  assert.equal(calls.getProperty.length, 0);
  assert.equal(calls.bumpActivityCursor.length, 0);
});

test('runDelta: procesa las actividades nuevas en orden ascendente seguro', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.KITEPROP_SYNC_PAGE_SIZE_PROPERTIES = '2';
  const calls = installStrapiMock({
    state: { last_activity_id: 100, last_max_property_id: 0 },
    activityPages: {
      1: [
        { id: 203, property_id: 503, type: 'data_changed', created_at: '2026-06-03T00:00:00Z' },
        { id: 202, property_id: 502, type: 'data_changed', created_at: '2026-06-02T00:00:00Z' },
      ],
      2: [
        { id: 201, property_id: 501, type: 'data_changed', created_at: '2026-06-01T00:00:00Z' },
        { id: 100, property_id: 1, type: 'data_changed', created_at: '2026-04-01T00:00:00Z' },
      ],
    },
    properties: {
      501: sampleProperty({ id: 501 }),
      502: sampleProperty({ id: 502 }),
      503: sampleProperty({ id: 503 }),
    },
  });
  const service = loadService();

  await service.runDelta({ runId: 'run-order', dryRun: false, maxPages: 5, maxItems: 10 });

  const bumpedIds = calls.bumpActivityCursor.map((activity) => Number(activity.id));
  assert.deepEqual(bumpedIds, [201, 202, 203]);
});

test('runDelta: varias actividades de una misma propiedad hacen un solo syncOne', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const calls = installStrapiMock({
    state: { last_activity_id: 100, last_max_property_id: 0 },
    activityPages: {
      1: [
        { id: 205, property_id: 506022, type: 'price_update', created_at: '2026-06-05T00:00:00Z' },
        { id: 204, property_id: 506022, type: 'status_changed', created_at: '2026-06-04T00:00:00Z' },
        { id: 203, property_id: 506022, type: 'data_changed', created_at: '2026-06-03T00:00:00Z' },
      ],
    },
    properties: { 506022: sampleProperty({ id: 506022 }) },
  });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-dedupe', dryRun: false, maxPages: 5, maxItems: 10 });

  // Una sola llamada a getProperty pese a 3 actividades de la misma propiedad.
  assert.equal(calls.getProperty.filter((id) => id === 506022).length, 1);
  assert.equal(result.summary.created, 1);
  // Las 3 actividades se acusan (avanzan cursor) aunque solo haya 1 syncOne.
  assert.equal(calls.bumpActivityCursor.length, 3);
  assert.equal(result.summary.final_cursor, 205);
});

test('runDelta: sin actividades nuevas no procesa nada ni deploya', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock({
    state: { last_activity_id: 500, last_max_property_id: 0 },
    activityPages: { 1: [] },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-empty', dryRun: false, maxPages: 5, maxItems: 10 });

  assert.equal(result.summary.new_activities_collected, 0);
  assert.equal(result.summary.created, 0);
  assert.equal(calls.getProperty.length, 0);
  assert.equal(fetchCalls.length, 0);
});

test('runDelta: dryRun no avanza cursor', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const calls = installStrapiMock({
    state: { last_activity_id: 100, last_max_property_id: 0 },
    activityPages: {
      1: [
        { id: 201, property_id: 506022, type: 'data_changed', created_at: '2026-06-01T00:00:00Z' },
      ],
    },
    properties: { 506022: sampleProperty({ id: 506022 }) },
  });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-dry', dryRun: true, maxPages: 5, maxItems: 10 });

  assert.equal(calls.bumpActivityCursor.length, 0);
  assert.equal(calls.propertyCreates.length, 0);
  assert.equal(result.summary.final_cursor, 100);
});

test('runDelta: backlog mayor a maxPages NO avanza el cursor (sin pérdida de actividades)', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.KITEPROP_SYNC_PAGE_SIZE_PROPERTIES = '2';
  const calls = installStrapiMock({
    state: { last_activity_id: 100, last_max_property_id: 0 },
    activityPages: {
      // Dos páginas llenas (==pageSize) sin cruzar el cursor: hay más viejas sin ver.
      1: [
        { id: 310, property_id: 510, type: 'data_changed', created_at: '2026-06-10T00:00:00Z' },
        { id: 309, property_id: 509, type: 'data_changed', created_at: '2026-06-09T00:00:00Z' },
      ],
      2: [
        { id: 308, property_id: 508, type: 'data_changed', created_at: '2026-06-08T00:00:00Z' },
        { id: 307, property_id: 507, type: 'data_changed', created_at: '2026-06-07T00:00:00Z' },
      ],
    },
    properties: {
      507: sampleProperty({ id: 507 }),
      508: sampleProperty({ id: 508 }),
      509: sampleProperty({ id: 509 }),
      510: sampleProperty({ id: 510 }),
    },
  });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-backlog', dryRun: false, maxPages: 2, maxItems: 10 });

  // Procesa lo recolectado (refresca el sitio) pero NO mueve el cursor.
  assert.equal(result.summary.boundary_reached, false);
  assert.equal(result.summary.final_cursor, 100);
  assert.equal(calls.bumpActivityCursor.length, 0);
  assert.ok(result.summary.created >= 1);
});

test('runDelta: error no avanza cursor más allá del último exitoso y conserva pending', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock({
    state: { last_activity_id: 100, last_max_property_id: 0 },
    activityPages: {
      1: [
        { id: 202, property_id: 102, type: 'data_changed', created_at: '2026-06-02T00:00:00Z' },
        { id: 201, property_id: 101, type: 'data_changed', created_at: '2026-06-01T00:00:00Z' },
      ],
    },
    properties: {
      101: sampleProperty({ id: 101 }),
      102: new Error('KiteProp unavailable'),
    },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-err', dryRun: false, maxPages: 5, maxItems: 10 });

  // 201 (101) OK, 202 (102) falla -> aborta.
  assert.equal(result.summary.created, 1);
  assert.equal(result.summary.errors, 1);
  assert.ok(result.error);
  // Cursor solo avanzó hasta la última exitosa (201), no hasta 202.
  assert.deepEqual(calls.bumpActivityCursor.map((a) => Number(a.id)), [201]);
  // Hubo cambios reales + error -> no deploya ya, pero queda pendiente.
  assert.equal(fetchCalls.length, 0);
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), true);
});

test('coordinador: cambios reales + error de corrida conserva pending y no deploya', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'partial success then error',
    source: 'test',
    changedItems: { updated: 1 },
    error: 'KiteProp unavailable on next page',
  });

  // Decisión conservadora: no deploya YA por el error...
  assert.equal(result.reason, 'sync_error_pending');
  assert.equal(result.triggered, false);
  assert.equal(result.pending, true);
  assert.equal(fetchCalls.length, 0);
  // ...pero el cambio NO se pierde: queda pendiente para la próxima corrida segura.
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), true);
  assert.equal(lastStoreValue(calls, 'frontend_deploy_last_changed_count'), 1);
});

test('coordinador: error de corrida sin cambios reales no marca pendiente', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock();
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };

  const result = await loadFrontendDeployService().maybeTriggerDeploy({
    reason: 'error without changes',
    source: 'test',
    changedItems: {},
    error: 'KiteProp unavailable',
  });

  assert.equal(result.reason, 'sync_error');
  assert.equal(fetchCalls.length, 0);
  // 0 cambios -> no se marca pendiente (regla: 0 deploys si no hubo cambios).
  assert.equal(calls.storeSets.some((item) => item.key === 'frontend_deploy_pending' && item.value === true), false);
});

test('runDelta: cambios exitosos seguidos de error dejan pending_deploy=true sin deployar', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock({
    activities: [
      { id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' },
      { id: 51, property_id: 102, type: 'data_changed', created_at: '2026-05-01T00:01:00Z' },
    ],
    properties: {
      101: sampleProperty({ id: 101 }),
      102: new Error('KiteProp unavailable'),
    },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-partial', dryRun: false, maxPages: 1, maxItems: 2 });

  // Hubo un cambio real (101 creado) y luego error (102).
  assert.equal(result.summary.created, 1);
  assert.ok(result.error);
  // No se deploya en el acto por el error...
  assert.equal(fetchCalls.length, 0);
  // ...pero el deploy queda pendiente: el cambio en Strapi no se pierde.
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), true);
});

test('runDelta keeps sync successful when Cloudflare hook fails', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock({
    activities: [{ id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' }],
    properties: { 101: sampleProperty() },
  });
  global.fetch = async () => ({ ok: false, status: 500 });
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-test', dryRun: false, maxPages: 1, maxItems: 1 });

  assert.equal(result.error, null);
  assert.equal(result.summary.created, 1);
  assert.equal(calls.bumpActivityCursor.length, 1);
  assert.ok(calls.errorLogs.some((message) => /deploy fallido/.test(message)));
});

test('runDelta alone can trigger frontend deploy', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock({
    activities: [{ id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' }],
    properties: { 101: sampleProperty() },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runDelta({ runId: 'run-delta-deploy', dryRun: false, maxPages: 1, maxItems: 1 });

  assert.equal(result.summary.created, 1);
  assert.equal(fetchCalls.length, 1);
});

test('runSniffer alone can trigger frontend deploy', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock({
    state: { last_activity_id: 0, last_max_property_id: 100 },
    propertyList: [{ id: 101 }, { id: 100 }],
    properties: { 101: sampleProperty({ id: 101 }) },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runSniffer({ runId: 'run-sniffer-deploy', dryRun: false, maxPages: 1, maxItems: 1 });

  assert.equal(result.summary.created, 1);
  assert.equal(fetchCalls.length, 1);
});

test('runAll triggers one deploy after delta and sniffer finish', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock({
    state: { last_activity_id: 0, last_max_property_id: 100 },
    activities: [{ id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' }],
    propertyList: [{ id: 102 }, { id: 100 }],
    properties: {
      101: sampleProperty({ id: 101 }),
      102: sampleProperty({ id: 102 }),
    },
  });
  const deploySnapshots = [];
  global.fetch = async (...args) => {
    deploySnapshots.push({
      args,
      propertyCreates: calls.propertyCreates.length,
      listProperties: calls.listProperties.length,
    });
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runAll({ runId: 'run-all-deploy', dryRun: false, maxPages: 1, maxItems: 2 });

  assert.equal(result.combined.summary.created, 2);
  assert.equal(deploySnapshots.length, 1);
  assert.equal(deploySnapshots[0].propertyCreates, 2);
  assert.equal(deploySnapshots[0].listProperties, 1);
});

test('runNext triggers at most one frontend deploy', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  installStrapiMock({
    activities: [{ id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' }],
    properties: { 101: sampleProperty({ id: 101 }) },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runNext({ runId: 'run-next-deploy', dryRun: false, maxPages: 1 });

  assert.equal(result.summary.created, 1);
  assert.equal(fetchCalls.length, 1);
});

test('runInterval triggers one deploy after delta and sniffer finish', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const calls = installStrapiMock({
    state: { last_activity_id: 0, last_max_property_id: 100 },
    activities: [{ id: 50, property_id: 101, type: 'data_changed', created_at: '2026-05-01T00:00:00Z' }],
    propertyList: [{ id: 102 }, { id: 100 }],
    properties: {
      101: sampleProperty({ id: 101 }),
      102: sampleProperty({ id: 102 }),
    },
  });
  const deploySnapshots = [];
  global.fetch = async (...args) => {
    deploySnapshots.push({
      args,
      propertyCreates: calls.propertyCreates.length,
      listProperties: calls.listProperties.length,
    });
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runInterval({ runId: 'run-interval-deploy', dryRun: false, maxPages: 1, maxItems: 2 });

  assert.equal(result.combined.summary.created, 2);
  assert.equal(deploySnapshots.length, 1);
  assert.equal(deploySnapshots[0].propertyCreates, 2);
  assert.equal(deploySnapshots[0].listProperties, 1);
});

test('frontend deploy status endpoint does not expose hook URL', async () => {
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/very-secret';
  process.env.FRONTEND_DEPLOY_MIN_INTERVAL_MS = '12345';
  installStrapiMock({
    storeValues: {
      last_frontend_deploy_at: '2026-06-01T00:00:00.000Z',
      last_frontend_deploy_reason: 'test reason',
      last_frontend_deploy_run_id: 'run-status',
    },
  });
  const controller = loadController();
  const ctx = { status: 200, body: null };

  await controller.frontendDeployStatus(ctx);

  assert.equal(ctx.body.enabled, true);
  assert.equal(ctx.body.has_hook_url, true);
  assert.equal(ctx.body.min_interval_ms, 12345);
  assert.equal(ctx.body.last_frontend_deploy_run_id, 'run-status');
  assert.equal(JSON.stringify(ctx.body).includes('very-secret'), false);
});

test('frontend deploy status route is protected by has-trigger-token and auth false', () => {
  const routes = require('../src/api/kiteprop-sync/routes/kiteprop-sync').routes;
  const route = routes.find((item) => item.method === 'GET' && item.path === '/kiteprop-sync/frontend-deploy/status');

  assert.ok(route);
  assert.equal(route.handler, 'kiteprop-sync.frontendDeployStatus');
  assert.deepEqual(route.config.policies, ['api::kiteprop-sync.has-trigger-token']);
  assert.equal(route.config.auth, false);
});

test('reconciliation returns missing_in_strapi when KiteProp has IDs absent locally', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }],
    strapiRows: [{ id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active' }],
  });
  const result = await loadReconciliationService().summary();

  assert.equal(result.diff.missing_in_strapi_count, 1);
  assert.deepEqual(result.diff.missing_in_strapi_ids, [102]);
  assert.equal(result.health.healthy, false);
});

test('reconciliation returns extra_in_strapi when Strapi has IDs absent from KiteProp scan', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }],
    strapiRows: [
      { id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active' },
      { id: 2, documentId: 'prop-202', kiteprop_id: 202, kiteprop_status: 'inactive' },
    ],
  });
  const result = await loadReconciliationService().summary();

  assert.equal(result.diff.extra_in_strapi_count, 1);
  assert.deepEqual(result.diff.extra_in_strapi_ids, [202]);
  assert.equal(result.health.healthy, true);
  assert.match(result.warnings.join('\n'), /absent from the scanned KiteProp set/);
});

test('reconciliation detects duplicate_kiteprop_ids and duplicate_details', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }],
    strapiRows: [
      { id: 1, documentId: 'prop-a', kiteprop_id: 101, kiteprop_status: 'active' },
      { id: 2, documentId: 'prop-b', kiteprop_id: '101', kiteprop_status: 'active' },
    ],
  });
  const result = await loadReconciliationService().summary();

  assert.equal(result.strapi.duplicate_count, 1);
  assert.deepEqual(result.diff.duplicate_kiteprop_ids, [101]);
  assert.deepEqual(result.diff.duplicate_details, [
    { kiteprop_id: 101, count: 2, documentIds: ['prop-a', 'prop-b'] },
  ]);
  assert.equal(result.health.healthy, false);
});

test('reconciliation does not count repeated draft/published rows with same documentId as duplicates', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }],
    strapiRows: [
      { id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active', publishedAt: null },
      { id: 2, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active', publishedAt: '2026-05-01' },
    ],
  });
  const result = await loadReconciliationService().summary();

  assert.equal(result.strapi.count, 1);
  assert.equal(result.strapi.duplicate_count, 0);
  assert.deepEqual(result.diff.duplicate_kiteprop_ids, []);
  assert.equal(result.health.healthy, true);
});

test('reconciliation includeIds=false keeps counts but omits diff arrays', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }],
    strapiRows: [
      { id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active' },
      { id: 2, documentId: 'prop-extra-a', kiteprop_id: 303, kiteprop_status: 'inactive' },
      { id: 3, documentId: 'prop-extra-b', kiteprop_id: 303, kiteprop_status: 'inactive' },
    ],
  });
  const result = await loadReconciliationService().summary({ includeIds: false });

  assert.equal(result.diff.missing_in_strapi_count, 1);
  assert.equal(result.diff.extra_in_strapi_count, 1);
  assert.equal(result.strapi.duplicate_count, 1);
  assert.deepEqual(result.diff.missing_in_strapi_ids, []);
  assert.deepEqual(result.diff.extra_in_strapi_ids, []);
  assert.deepEqual(result.diff.duplicate_kiteprop_ids, []);
  assert.deepEqual(result.diff.duplicate_details, []);
});

test('reconciliation respects includeSamples=true and sampleSize', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }, { id: 103 }],
    strapiRows: [
      { id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active' },
      { id: 2, documentId: 'prop-102', kiteprop_id: 102, kiteprop_status: 'active' },
      { id: 3, documentId: 'prop-103', kiteprop_id: 103, kiteprop_status: 'active' },
    ],
  });
  const result = await loadReconciliationService().summary({ includeSamples: true, sampleSize: 2 });

  assert.deepEqual(result.kiteprop.ids_sample, [101, 102]);
  assert.deepEqual(result.strapi.ids_sample, [101, 102]);
});

test('reconciliation respects maxPages and warns when scan is partial', async () => {
  installStrapiMock({
    propertyListPages: {
      1: Array.from({ length: 50 }, (_, index) => ({ id: index + 1 })),
      2: Array.from({ length: 50 }, (_, index) => ({ id: index + 51 })),
    },
    propertyListMeta: {
      2: { last_page: 3 },
    },
    strapiRows: [],
  });
  const result = await loadReconciliationService().summary({ maxPages: 2, limit: 50 });

  assert.equal(result.kiteprop.pages_read, 2);
  assert.equal(result.kiteprop.count, 100);
  assert.match(result.warnings.join('\n'), /stopped at maxPages/);
});

test('reconciliation is read-only and does not call writes or upload', async () => {
  const calls = installStrapiMock({
    propertyList: [{ id: 101 }],
    strapiRows: [{ id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active' }],
  });
  const result = await loadReconciliationService().summary();

  assert.equal(result.ok, true);
  assert.equal(result.read_only, true);
  assert.equal(calls.propertyCreates.length, 0);
  assert.equal(calls.propertyUpdates.length, 0);
  assert.equal(calls.propertyUnpublishes.length, 0);
  assert.equal(calls.imageCreates.length, 0);
  assert.equal(calls.imageUpdates.length, 0);
  assert.equal(calls.uploadCalls.length, 0);
  assert.equal(calls.bumpActivityCursor.length, 0);
  assert.equal(calls.bumpMaxPropertyId.length, 0);
});

test('reconciliation route is protected by has-trigger-token and auth false', () => {
  const routes = require('../src/api/kiteprop-sync/routes/kiteprop-sync').routes;
  const route = routes.find((item) => item.method === 'GET' && item.path === '/kiteprop-sync/reconciliation/summary');

  assert.ok(route);
  assert.equal(route.handler, 'kiteprop-sync.reconciliationSummary');
  assert.deepEqual(route.config.policies, ['api::kiteprop-sync.has-trigger-token']);
  assert.equal(route.config.auth, false);
});

test('reconciliation controller returns 502 when KiteProp read fails', async () => {
  const error = new Error('KiteProp unavailable');
  error.status = 503;
  installStrapiMock({ listPropertiesError: error });
  const controller = loadController();
  const ctx = { query: {}, status: 200, body: null };

  await controller.reconciliationSummary(ctx);

  assert.equal(ctx.status, 502);
  assert.equal(ctx.body.ok, false);
  assert.equal(ctx.body.read_only, true);
  assert.equal(ctx.body.error.status, 503);
});

test('reconciliation controller returns 500 when Strapi read fails', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }],
    strapiFindManyError: new Error('database unavailable'),
  });
  const controller = loadController();
  const ctx = { query: {}, status: 200, body: null };

  await controller.reconciliationSummary(ctx);

  assert.equal(ctx.status, 500);
  assert.equal(ctx.body.ok, false);
  assert.equal(ctx.body.read_only, true);
  assert.match(ctx.body.error.message, /database unavailable/);
});

test('reconciliation health is true when ID sets match and there are no duplicates', async () => {
  installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }],
    strapiRows: [
      { id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active' },
      { id: 2, documentId: 'prop-102', kiteprop_id: 102, kiteprop_status: 'active' },
    ],
  });
  const result = await loadReconciliationService().summary();

  assert.equal(result.health.healthy, true);
  assert.equal(result.diff.missing_in_strapi_count, 0);
  assert.equal(result.strapi.duplicate_count, 0);
  assert.deepEqual(result.strapi.status_summary, { active: 2 });
});

test('mapping audit detects legacy CLP property with Precio filled as backend assignment mismatch', async () => {
  const kp = sampleProperty({ currency: 'clp', for_sale_price: 120000000 });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Precio: 120000000, Precio_CLP: 120000000 }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.equal(result.properties[0].checks.price.front_risk.risk, 'high');
  assert.equal(result.properties[0].checks.price.status, 'critical');
  assert.equal(result.properties[0].checks.price.expected.Precio, null);
  assert.equal(result.properties[0].checks.price.expected.Precio_CLP, 120000000);
  assert.ok(result.properties[0].issues.some((item) => item.code === 'precio_field_assignment_mismatch'));
});

test('mapping audit detects Precio mismatch', async () => {
  const kp = sampleProperty({ currency: 'uf', for_sale_price: 9000 });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Precio: 8000 }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'precio_mismatch'));
  assert.equal(result.summary.critical_count, 1);
});

test('mapping audit detects missing Precio_CLP for CLP currency', async () => {
  const kp = sampleProperty({ currency: 'clp', for_sale_price: 120000000 });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Precio_CLP: null }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101, checkFrontRisk: false });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'missing_precio_clp'));
});

test('mapping audit warns when unknown currency price is intentionally not mapped', async () => {
  const kp = sampleProperty({ currency: 'usd', for_sale_price: 120000000 });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.equal(result.properties[0].checks.price.expected.Precio, null);
  assert.equal(result.properties[0].checks.price.expected.Precio_CLP, null);
  assert.ok(result.properties[0].issues.some((item) => item.code === 'unknown_currency_price_not_mapped'));
});

test('mapping audit does not mark missing_slug when Slug exists', async () => {
  const kp = sampleProperty({ title: 'Casa con Slug' });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Slug: 'slug-manual-o-generado' }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.equal(result.properties[0].checks.title_slug.expected.Slug, 'slug-manual-o-generado');
  assert.ok(!result.properties[0].issues.some((item) => item.code === 'missing_slug'));
});

test('mapping audit detects incorrect Objetivo', async () => {
  const kp = sampleProperty({ for_sale: true, for_rent: false });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Objetivo: 'Arriendo' }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'objetivo_mismatch'));
});

test('mapping audit detects Tipo fallback to Otros Inmuebles', async () => {
  const kp = sampleProperty({ type: 'castle' });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'type_fallback_otros_inmuebles'));
});

test('mapping audit detects Publicado incorrect for active status', async () => {
  const kp = sampleProperty({ status: 'active' });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Publicado: false }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'active_not_published'));
  assert.equal(result.properties[0].checks.status_publication.status, 'critical');
});

test('mapping audit detects specs mismatches', async () => {
  const kp = sampleProperty({ bedrooms: 4, bathrooms: 3, total_meters: 180 });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Dormitorios: 3, Banos: 2, Superficie: 100 }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'dormitorios_mismatch'));
  assert.ok(result.properties[0].issues.some((item) => item.code === 'banos_mismatch'));
  assert.ok(result.properties[0].issues.some((item) => item.code === 'superficie_mismatch'));
});

test('mapping audit detects image_count_mismatch', async () => {
  const kp = sampleProperty();
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Imagenes: [] }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'image_count_mismatch'));
});

test('mapping audit does not mark image order mismatch when legacy kiteprop_imagenes lacks image_key but media mapping matches', async () => {
  const kp = sampleProperty();
  installStrapiMock({
    properties: { 101: kp },
    localProperties: {
      101: localPropertyFromKiteProp(kp, {
        kiteprop_imagenes: mappers.mapKitepropImagenes(kp.images_list),
      }),
    },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });
  const issues = result.properties[0].issues.map((item) => item.code);

  assert.equal(result.properties[0].checks.images.strapi.comparison_basis, 'media_mapping');
  assert.equal(result.properties[0].checks.images.kiteprop.expected_first_image_key, '101:11');
  assert.equal(result.properties[0].checks.images.strapi.actual_first_image_key, '101:11');
  assert.ok(!issues.includes('image_order_mismatch'));
  assert.ok(!issues.includes('media_order_mismatch'));
  assert.ok(!issues.includes('kiteprop_imagenes_json_mismatch'));
});

test('mapping audit detects media_order_mismatch and first_image_mismatch', async () => {
  const kp = sampleProperty();
  installStrapiMock({
    properties: { 101: kp },
    localProperties: {
      101: localPropertyFromKiteProp(kp, {
        Imagenes: [
          { id: 501, url: '/uploads/second.jpg' },
          { id: 500, url: '/uploads/first.jpg' },
        ],
      }),
    },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'media_order_mismatch'));
  assert.ok(result.properties[0].issues.some((item) => item.code === 'first_image_mismatch'));
});

test('mapping audit detects missing_kiteprop_image_mapping', async () => {
  const kp = sampleProperty();
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp) },
    kitepropImageRows: kitepropImageRowsFor(kp).slice(0, 1),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'missing_kiteprop_image_mapping'));
});

test('mapping audit detects orphan_kiteprop_image_mapping', async () => {
  const kp = sampleProperty();
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp) },
    kitepropImageRows: [
      ...kitepropImageRowsFor(kp),
      { id: 999, documentId: 'orphan', kiteprop_property_id: '101', image_key: '101:orphan', file: { id: 999 } },
    ],
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'orphan_kiteprop_image_mapping'));
});

test('mapping audit detects duplicate_image_key', async () => {
  const kp = sampleProperty();
  const rows = kitepropImageRowsFor(kp);
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp) },
    kitepropImageRows: [...rows, { ...rows[0], id: 999, documentId: 'duplicate' }],
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'duplicate_image_key'));
});

test('mapping audit detects Destacado mismatch from postal code', async () => {
  const kp = sampleProperty({ postal_code: '000000' });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Destacado: false }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'destacado_mismatch'));
  assert.equal(result.properties[0].checks.featured_flags.kiteprop.postal_code, '000000');
  assert.equal(result.properties[0].checks.featured_flags.expected.Destacado, true);
});

test('mapping audit detects Oportunidades mismatch from postal code', async () => {
  const kp = sampleProperty({ postal_code: '000001' });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { Oportunidades: false }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'oportunidades_mismatch'));
  assert.equal(result.properties[0].checks.featured_flags.expected.Oportunidades, true);
});

test('mapping audit shows healthy featured_flags when postal code matches Strapi', async () => {
  const kp = sampleProperty({ postal_code: '000002' });
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.equal(result.properties[0].checks.featured_flags.status, 'ok');
  assert.equal(result.properties[0].checks.featured_flags.expected.Destacado, true);
  assert.equal(result.properties[0].checks.featured_flags.expected.Oportunidades, true);
});

test('mapping audit detects data_hash mismatch', async () => {
  const kp = sampleProperty();
  installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { kiteprop_data_hash: 'wrong' }) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.ok(result.properties[0].issues.some((item) => item.code === 'data_hash_mismatch'));
});

test('mapping audit route is protected by has-trigger-token and auth false', () => {
  const routes = require('../src/api/kiteprop-sync/routes/kiteprop-sync').routes;
  const route = routes.find((item) => item.method === 'GET' && item.path === '/kiteprop-sync/reconciliation/mapping-audit');

  assert.ok(route);
  assert.equal(route.handler, 'kiteprop-sync.mappingAudit');
  assert.deepEqual(route.config.policies, ['api::kiteprop-sync.has-trigger-token']);
  assert.equal(route.config.auth, false);
});

test('mapping audit is read-only and does not call writes or upload', async () => {
  const kp = sampleProperty({ currency: 'uf' });
  const calls = installStrapiMock({
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp) },
    kitepropImageRows: kitepropImageRowsFor(kp),
  });
  const result = await loadMappingAuditService().audit({ kitepropId: 101 });

  assert.equal(result.ok, true);
  assert.equal(result.read_only, true);
  assert.equal(calls.propertyCreates.length, 0);
  assert.equal(calls.propertyUpdates.length, 0);
  assert.equal(calls.propertyUnpublishes.length, 0);
  assert.equal(calls.imageCreates.length, 0);
  assert.equal(calls.imageUpdates.length, 0);
  assert.equal(calls.uploadCalls.length, 0);
  assert.equal(calls.bumpActivityCursor.length, 0);
  assert.equal(calls.bumpMaxPropertyId.length, 0);
});

test('mapping audit controller returns 502 when KiteProp fails', async () => {
  const error = new Error('KiteProp unavailable');
  error.status = 503;
  installStrapiMock({ properties: { 101: error } });
  const controller = loadController();
  const ctx = { query: { kitepropId: '101' }, status: 200, body: null };

  await controller.mappingAudit(ctx);

  assert.equal(ctx.status, 502);
  assert.equal(ctx.body.ok, false);
  assert.equal(ctx.body.read_only, true);
});

test('mapping audit controller returns 500 when Strapi fails', async () => {
  const kp = sampleProperty();
  installStrapiMock({
    properties: { 101: kp },
    existingProperty: null,
    localProperties: {},
    kitepropImageFindManyError: new Error('database unavailable'),
  });
  global.strapi.documents = (uid) => {
    if (uid === PROPIEDAD_UID) {
      return { async findFirst() { throw new Error('database unavailable'); } };
    }
    throw new Error(`Unexpected uid ${uid}`);
  };
  const controller = loadController();
  const ctx = { query: { kitepropId: '101' }, status: 200, body: null };

  await controller.mappingAudit(ctx);

  assert.equal(ctx.status, 500);
  assert.equal(ctx.body.ok, false);
  assert.equal(ctx.body.read_only, true);
});

// ---------------------------------------------------------------------------
// Cambio de mapeo — Ubicacion / Direccion provienen de kp.address
// ---------------------------------------------------------------------------

test('mapper sets Ubicacion from kp.address (not from kp.neighborhood)', () => {
  const payload = mappers.mapPropertyToStrapi(
    sampleProperty({ address: 'Av Siempre Viva 742', neighborhood: 'Springfield' })
  );

  assert.equal(payload.Ubicacion, 'Av Siempre Viva 742');
  // Confirmamos explícitamente que NO usa neighborhood.
  assert.notEqual(payload.Ubicacion, 'Springfield');
});

test('mapper keeps Direccion from kp.address and equal to Ubicacion', () => {
  const payload = mappers.mapPropertyToStrapi(
    sampleProperty({ address: 'Av Siempre Viva 742', neighborhood: 'Springfield' })
  );

  assert.equal(payload.Direccion, 'Av Siempre Viva 742');
  assert.equal(payload.Ubicacion, payload.Direccion);
});

// ---------------------------------------------------------------------------
// Reconciliación completa / backfill — runReconcile
// ---------------------------------------------------------------------------

test('reconcile route is protected by has-trigger-token and auth false', () => {
  const routes = require('../src/api/kiteprop-sync/routes/kiteprop-sync').routes;
  const route = routes.find((item) => item.method === 'POST' && item.path === '/kiteprop-sync/properties/reconcile');

  assert.ok(route);
  assert.equal(route.handler, 'kiteprop-sync.reconcile');
  assert.deepEqual(route.config.policies, ['api::kiteprop-sync.has-trigger-token']);
  assert.equal(route.config.auth, false);
});

test('reconcile dryRun reports would-be changes but does not write, advance cursors, or deploy', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const kp = sampleProperty({ id: 101, address: 'Calle 1' });
  const calls = installStrapiMock({
    propertyList: [{ id: 101 }],
    properties: { 101: kp },
    localProperties: { 101: localPropertyFromKiteProp(kp, { kiteprop_data_hash: 'old' }) },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-dry', dryRun: true, maxPages: 5, maxItems: 10 });

  // Reporta que 1 propiedad cambiaría...
  assert.equal(result.summary.updated, 1);
  assert.equal(result.dry_run, true);
  // ...pero NO escribe en Strapi, NO avanza cursores y NO deploya.
  assert.equal(calls.propertyCreates.length, 0);
  assert.equal(calls.propertyUpdates.length, 0);
  assert.equal(calls.imageCreates.length, 0);
  assert.equal(calls.imageUpdates.length, 0);
  assert.equal(calls.bumpActivityCursor.length, 0);
  assert.equal(calls.bumpMaxPropertyId.length, 0);
  assert.equal(fetchCalls.length, 0);
});

test('reconcile real updates only properties with real differences', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp101 = sampleProperty({ id: 101, address: 'Calle 1' });
  const kp102 = sampleProperty({ id: 102, address: 'Calle 2' });
  const calls = installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }],
    properties: { 101: kp101, 102: kp102 },
    localProperties: {
      101: localPropertyFromKiteProp(kp101), // coincide -> skip
      102: localPropertyFromKiteProp(kp102, { kiteprop_data_hash: 'old' }), // difiere -> update
    },
  });
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-real', dryRun: false, maxPages: 5, maxItems: 10 });

  assert.equal(result.summary.created, 0);
  assert.equal(result.summary.updated, 1);
  assert.equal(result.summary.skipped, 1);
  assert.equal(calls.propertyUpdates.length, 1);
  assert.equal(calls.propertyCreates.length, 0);
  // Solo la 102 (la que difería) se escribió en Strapi.
  assert.equal(Number(calls.propertyUpdates[0].data.kiteprop_id), 102);
  // No toca cursores de delta/sniffer.
  assert.equal(calls.bumpActivityCursor.length, 0);
  assert.equal(calls.bumpMaxPropertyId.length, 0);
});

test('reconcile marks local property missing from active set as Publicado=false but keeps it published in Strapi', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp101 = sampleProperty({ id: 101, status: 'active', address: 'Calle Activa' });
  const kp202ActiveLocal = sampleProperty({ id: 202, status: 'active', address: 'Calle Sale Active' });
  const kp202InactiveRemote = sampleProperty({
    id: 202,
    status: 'inactive',
    address: 'Calle Sale Active',
    updated_at: '2026-05-02T10:00:00.000000Z',
  });
  const calls = installStrapiMock({
    propertyList: [{ id: 101 }],
    properties: {
      101: kp101,
      202: kp202InactiveRemote,
    },
    localProperties: {
      101: localPropertyFromKiteProp(kp101),
      202: localPropertyFromKiteProp(kp202ActiveLocal),
    },
    strapiRows: [
      { id: 1, documentId: 'prop-101', kiteprop_id: 101, kiteprop_status: 'active', Publicado: true },
      { id: 2, documentId: 'prop-202', kiteprop_id: 202, kiteprop_status: 'active', Publicado: true },
    ],
  });
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-missing-active', dryRun: false, maxPages: 5, maxItems: 10 });

  assert.equal(result.summary.updated, 1);
  assert.equal(result.summary.inactive_candidates, 1);
  assert.equal(calls.propertyUpdates.length, 1);
  assert.equal(calls.propertyUpdateStatuses[0], 'published');
  assert.equal(calls.propertyUnpublishes.length, 0);
  assert.equal(calls.propertyUpdates[0].documentId, 'prop-202');
  assert.equal(calls.propertyUpdates[0].data.Publicado, false);
  assert.equal(calls.propertyUpdates[0].data.kiteprop_status, 'inactive');
  assert.equal(calls.propertyUpdates[0].data.kiteprop_raw.status, 'inactive');
  assert.equal(calls.propertyUpdates[0].data.kiteprop_sync_status, 'ok');
  assert.ok(calls.propertyUpdates[0].data.kiteprop_synced_at);
  assert.ok(calls.propertyUpdates[0].data.kiteprop_last_synced_at);
});

test('reconcile real creates properties missing in Strapi', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const kp = sampleProperty({ id: 303, address: 'Calle Nueva' });
  const calls = installStrapiMock({
    propertyList: [{ id: 303 }],
    properties: { 303: kp },
    // sin localProperties -> findFirst devuelve null -> create
  });
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-create', dryRun: false, maxPages: 5, maxItems: 10 });

  assert.equal(result.summary.created, 1);
  assert.equal(calls.propertyCreates.length, 1);
  assert.equal(Number(calls.propertyCreates[0].kiteprop_id), 303);
});

test('reconcile real triggers exactly one deploy at the end when there were changes', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const kp101 = sampleProperty({ id: 101, address: 'Calle 1' });
  const kp102 = sampleProperty({ id: 102, address: 'Calle 2' });
  const calls = installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }],
    properties: { 101: kp101, 102: kp102 },
    localProperties: {
      101: localPropertyFromKiteProp(kp101, { kiteprop_data_hash: 'old' }),
      102: localPropertyFromKiteProp(kp102, { kiteprop_data_hash: 'old' }),
    },
  });
  const deploySnapshots = [];
  global.fetch = async () => {
    deploySnapshots.push({ propertyUpdates: calls.propertyUpdates.length });
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-deploy', dryRun: false, maxPages: 5, maxItems: 10 });

  assert.equal(result.summary.updated, 2);
  // Un único deploy, disparado DESPUÉS de aplicar las 2 actualizaciones.
  assert.equal(deploySnapshots.length, 1);
  assert.equal(deploySnapshots[0].propertyUpdates, 2);
});

test('reconcile real does not deploy when there are no real differences', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const kp101 = sampleProperty({ id: 101, address: 'Calle 1' });
  const kp102 = sampleProperty({ id: 102, address: 'Calle 2' });
  const calls = installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }],
    properties: { 101: kp101, 102: kp102 },
    localProperties: {
      101: localPropertyFromKiteProp(kp101),
      102: localPropertyFromKiteProp(kp102),
    },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-nochange', dryRun: false, maxPages: 5, maxItems: 10 });

  assert.equal(result.summary.created, 0);
  assert.equal(result.summary.updated, 0);
  assert.equal(result.summary.skipped, 2);
  assert.equal(calls.propertyUpdates.length, 0);
  assert.equal(calls.propertyCreates.length, 0);
  assert.equal(fetchCalls.length, 0);
});

test('reconcile deduplicates by kiteprop_id and respects maxItems', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  const calls = installStrapiMock({
    propertyListPages: {
      1: [{ id: 101 }, { id: 101 }, { id: 102 }],
    },
    properties: {
      101: sampleProperty({ id: 101 }),
      102: sampleProperty({ id: 102 }),
    },
  });
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-dedupe', dryRun: true, maxPages: 1, maxItems: 1 });

  assert.equal(result.summary.properties_seen, 3);
  assert.equal(result.summary.unique_candidates, 2);
  assert.equal(result.summary.processed, 1);
  assert.equal(result.summary.stopped_at_max_items, true);
  // Sólo se consultó 1 propiedad en KiteProp (conservador con API calls).
  assert.equal(calls.getProperty.length, 1);
});

test('reconcile keeps successful changes and leaves pending_deploy when a property fails', async () => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const kp101 = sampleProperty({ id: 101, address: 'Calle 1' });
  const calls = installStrapiMock({
    propertyList: [{ id: 101 }, { id: 102 }],
    properties: {
      101: kp101,
      102: new Error('KiteProp unavailable'),
    },
    localProperties: {
      101: localPropertyFromKiteProp(kp101, { kiteprop_data_hash: 'old' }),
    },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const service = loadService();

  const result = await service.runReconcile({ runId: 'rec-partial', dryRun: false, maxPages: 5, maxItems: 10 });

  // 101 se actualizó OK; 102 falló de forma aislada (no aborta el resto).
  assert.equal(result.summary.updated, 1);
  assert.equal(result.summary.errors, 1);
  assert.ok(result.error);
  // El cambio exitoso NO se pierde y NO se deploya en el acto por el error...
  assert.equal(fetchCalls.length, 0);
  // ...queda pendiente para la próxima corrida segura.
  assert.equal(lastStoreValue(calls, 'frontend_deploy_pending'), true);
});

// ---------------------------------------------------------------------------
// Auto-sync interno (intervalo seguro para Strapi Cloud)
// ---------------------------------------------------------------------------

function makeSyncSpy(resultByMethod = {}) {
  const calls = { runReconcile: [], runAll: [] };
  return {
    calls,
    async runReconcile(opts) {
      calls.runReconcile.push(opts);
      return resultByMethod.runReconcile || { summary: { created: 0, updated: 0, skipped: 0, errors: 0 } };
    },
    async runAll(opts) {
      calls.runAll.push(opts);
      return (
        resultByMethod.runAll || {
          ok: true,
          combined: { summary: { created: 0, updated: 0, skipped: 0, errors: 0 } },
        }
      );
    },
  };
}

test('auto-sync deshabilitado no ejecuta nada', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'false';
  const syncSpy = makeSyncSpy();
  installStrapiMock({ syncServiceOverride: syncSpy, state: { is_running: false } });
  const autoSync = loadAutoSyncService();

  const result = await autoSync.runOnce({ source: 'test' });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(syncSpy.calls.runReconcile.length, 0);
  assert.equal(syncSpy.calls.runAll.length, 0);
});

test('auto-sync enabled + mode=reconcile llama runReconcile', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'true';
  process.env.KITEPROP_AUTO_SYNC_MODE = 'reconcile';
  const syncSpy = makeSyncSpy();
  installStrapiMock({ syncServiceOverride: syncSpy, state: { is_running: false } });
  const autoSync = loadAutoSyncService();

  const result = await autoSync.runOnce({ source: 'test' });

  assert.equal(result.skipped, false);
  assert.equal(result.mode, 'reconcile');
  assert.equal(syncSpy.calls.runReconcile.length, 1);
  assert.equal(syncSpy.calls.runAll.length, 0);
});

test('auto-sync enabled + mode=delta llama runAll', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'true';
  process.env.KITEPROP_AUTO_SYNC_MODE = 'delta';
  const syncSpy = makeSyncSpy();
  installStrapiMock({ syncServiceOverride: syncSpy, state: { is_running: false } });
  const autoSync = loadAutoSyncService();

  const result = await autoSync.runOnce({ source: 'test' });

  assert.equal(result.skipped, false);
  assert.equal(result.mode, 'delta');
  assert.equal(syncSpy.calls.runAll.length, 1);
  assert.equal(syncSpy.calls.runReconcile.length, 0);
});

test('auto-sync respeta dryRun/maxPages/maxItems desde ENV', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'true';
  process.env.KITEPROP_AUTO_SYNC_MODE = 'reconcile';
  process.env.KITEPROP_AUTO_SYNC_DRY_RUN = 'true';
  process.env.KITEPROP_AUTO_SYNC_MAX_PAGES = '7';
  process.env.KITEPROP_AUTO_SYNC_MAX_ITEMS = '33';
  const syncSpy = makeSyncSpy();
  installStrapiMock({ syncServiceOverride: syncSpy, state: { is_running: false } });
  const autoSync = loadAutoSyncService();

  await autoSync.runOnce({ source: 'test' });

  const opts = syncSpy.calls.runReconcile[0];
  assert.equal(opts.dryRun, true);
  assert.equal(opts.maxPages, 7);
  assert.equal(opts.maxItems, 33);
});

test('auto-sync no corre si el sync-state indica is_running=true', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'true';
  process.env.KITEPROP_AUTO_SYNC_MODE = 'reconcile';
  const syncSpy = makeSyncSpy();
  installStrapiMock({
    syncServiceOverride: syncSpy,
    state: { is_running: true, current_run_id: 'run-en-curso' },
  });
  const autoSync = loadAutoSyncService();

  const result = await autoSync.runOnce({ source: 'test' });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'sync_in_progress');
  assert.equal(syncSpy.calls.runReconcile.length, 0);
  assert.equal(syncSpy.calls.runAll.length, 0);
});

test('auto-sync NO toca el coordinador de deploy (delega en el sync)', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'true';
  process.env.KITEPROP_AUTO_SYNC_MODE = 'reconcile';
  const syncSpy = makeSyncSpy();
  const calls = installStrapiMock({ syncServiceOverride: syncSpy, state: { is_running: false } });
  const autoSync = loadAutoSyncService();

  await autoSync.runOnce({ source: 'test' });

  // El auto-sync nunca pide directamente el servicio frontend-deploy: el deploy
  // lo decide internamente runReconcile/runAll (1 deploy al final si corresponde).
  assert.equal(calls.serviceRequests.includes('api::kiteprop-sync.frontend-deploy'), false);
});

test('auto-sync (reconcile real) no deploya cuando no hubo cambios reales', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'true';
  process.env.KITEPROP_AUTO_SYNC_MODE = 'reconcile';
  process.env.KITEPROP_AUTO_SYNC_DRY_RUN = 'false';
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const kp101 = sampleProperty({ id: 101, address: 'Calle 1' });
  const kp102 = sampleProperty({ id: 102, address: 'Calle 2' });
  installStrapiMock({
    state: { is_running: false, last_activity_id: 0, last_max_property_id: 0 },
    propertyList: [{ id: 101 }, { id: 102 }],
    properties: { 101: kp101, 102: kp102 },
    localProperties: {
      101: localPropertyFromKiteProp(kp101),
      102: localPropertyFromKiteProp(kp102),
    },
  });
  const fetchCalls = [];
  global.fetch = async (...args) => {
    fetchCalls.push(args);
    return { ok: true, status: 200 };
  };
  const autoSync = loadAutoSyncService();

  const result = await autoSync.runOnce({ source: 'test' });

  assert.equal(result.skipped, false);
  assert.equal(result.result.summary.created, 0);
  assert.equal(result.result.summary.updated, 0);
  assert.equal(fetchCalls.length, 0);
});

test('auto-sync (reconcile real) hace 1 solo deploy al final cuando hubo cambios', async () => {
  process.env.KITEPROP_AUTO_SYNC_ENABLED = 'true';
  process.env.KITEPROP_AUTO_SYNC_MODE = 'reconcile';
  process.env.KITEPROP_AUTO_SYNC_DRY_RUN = 'false';
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'false';
  process.env.FRONTEND_DEPLOY_ENABLED = 'true';
  process.env.FRONTEND_DEPLOY_HOOK_URL = 'https://hooks.example.com/secret';
  const kp101 = sampleProperty({ id: 101, address: 'Calle 1' });
  const kp102 = sampleProperty({ id: 102, address: 'Calle 2' });
  const calls = installStrapiMock({
    state: { is_running: false, last_activity_id: 0, last_max_property_id: 0 },
    propertyList: [{ id: 101 }, { id: 102 }],
    properties: { 101: kp101, 102: kp102 },
    localProperties: {
      101: localPropertyFromKiteProp(kp101, { kiteprop_data_hash: 'old' }),
      102: localPropertyFromKiteProp(kp102, { kiteprop_data_hash: 'old' }),
    },
  });
  const deploySnapshots = [];
  global.fetch = async () => {
    deploySnapshots.push({ propertyUpdates: calls.propertyUpdates.length });
    return { ok: true, status: 200 };
  };
  const autoSync = loadAutoSyncService();

  const result = await autoSync.runOnce({ source: 'test' });

  assert.equal(result.result.summary.updated, 2);
  // Un único deploy, disparado DESPUÉS de aplicar las 2 actualizaciones.
  assert.equal(deploySnapshots.length, 1);
  assert.equal(deploySnapshots[0].propertyUpdates, 2);
});

test('auto-sync default seguro: enabled=false y dryRun=true', () => {
  const cfg = loadAutoSyncService().getConfig();

  assert.equal(cfg.enabled, false);
  assert.equal(cfg.dryRun, true);
  assert.equal(cfg.mode, 'reconcile');
});

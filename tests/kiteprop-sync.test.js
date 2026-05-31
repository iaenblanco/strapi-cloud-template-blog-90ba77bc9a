'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const mappers = require('../src/api/kiteprop-sync/services/mappers');
const hashes = require('../src/api/kiteprop-sync/services/hash');
const imageHelpers = require('../src/api/kiteprop-sync/services/images');

const PROPIEDAD_UID = 'api::propiedad.propiedad';
const KITEPROP_IMAGE_UID = 'api::kiteprop-image.kiteprop-image';

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
    strapiFindMany: [],
  };

  let currentProperty = options.existingProperty || null;
  const imageMappings = new Map();
  for (const mapping of options.imageMappings || []) {
    imageMappings.set(`${mapping.kiteprop_property_id}:${mapping.image_key}`, mapping);
  }

  const propertyDocs = {
    async findFirst({ filters } = {}) {
      const requestedKitepropId = filters?.kiteprop_id ? Number(filters.kiteprop_id) : null;
      if (requestedKitepropId && options.localProperties?.[requestedKitepropId]) {
        return options.localProperties[requestedKitepropId];
      }
      if (!currentProperty) return null;
      if (requestedKitepropId && requestedKitepropId !== Number(currentProperty.kiteprop_id)) {
        return null;
      }
      return currentProperty;
    },
    async create({ data }) {
      calls.propertyCreates.push(data);
      currentProperty = { id: 1, documentId: 'prop-created', ...data };
      return currentProperty;
    },
    async update({ documentId, data }) {
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
      const value = options.properties?.[id];
      if (value instanceof Error) throw value;
      return { data: { data: value || sampleProperty({ id }) } };
    },
    async listActivities() {
      return { data: { data: options.activities || [] } };
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

  global.strapi = {
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
      throw new Error(`Unexpected service ${uid}`);
    },
    log: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
  };

  return calls;
}

test.beforeEach(() => {
  process.env.KITEPROP_SYNC_IMPORT_IMAGES = 'true';
  process.env.KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY = '12';
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

test('reuses an existing image mapping by image_key', async () => {
  const kp = sampleProperty({ images_list: [sampleProperty().images_list[0]] });
  const { dataHash, normalizedImages } = computedHashes(kp);
  const calls = installStrapiMock({
    existingProperty: {
      documentId: 'prop-1',
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

test('mapping audit detects first_image_mismatch', async () => {
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

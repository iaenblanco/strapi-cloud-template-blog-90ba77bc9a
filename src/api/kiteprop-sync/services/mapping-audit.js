'use strict';

const PROPIEDAD_UID = 'api::propiedad.propiedad';
const KITEPROP_IMAGE_UID = 'api::kiteprop-image.kiteprop-image';
const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_SAMPLE_SIZE = 20;

const mappers = require('./mappers');
const imageHelpers = require('./images');
const hashes = require('./hash');

const SEVERITY_RANK = { ok: 0, warning: 1, error: 2, critical: 3 };
const FIELD_GROUPS = [
  'price',
  'currency',
  'objective',
  'type',
  'status_publication',
  'location',
  'specs',
  'images',
  'front_rendering',
];

const MANUAL_FIELDS = [
  'Contribuciones',
  'Servicio',
  'suites',
  'Bodega',
  'Walk_in_closet',
  'Terrazas',
  'Orientacion',
  'Piscina',
  'Quincho',
  'sala_multiuso',
  'Gimnasio',
  'Lavanderia',
  'Tipo_de_seguridad',
];

function toPositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeKitePropLimit(value) {
  const parsed = toPositiveInt(value, DEFAULT_LIMIT, { max: DEFAULT_LIMIT });
  return [15, 30, 50].includes(parsed) ? parsed : DEFAULT_LIMIT;
}

function normalizeId(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function toIntOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function sameNumber(a, b) {
  return toIntOrNull(a) === toIntOrNull(b);
}

function sameText(a, b) {
  const left = a === null || a === undefined ? null : String(a);
  const right = b === null || b === undefined ? null : String(b);
  return left === right;
}

function maxStatus(statuses) {
  return statuses.reduce((current, next) => (
    SEVERITY_RANK[next] > SEVERITY_RANK[current] ? next : current
  ), 'ok');
}

function fieldSummaryTemplate() {
  return Object.fromEntries(FIELD_GROUPS.map((field) => [field, { ok: 0, warning: 0, error: 0 }]));
}

function bumpField(summary, field, status) {
  const bucket = status === 'critical' ? 'error' : status;
  summary[field][bucket] += 1;
}

function issue(code, severity, message, extra = {}) {
  return { code, severity, message, ...extra };
}

function isImageImportEnabled() {
  return String(process.env.KITEPROP_SYNC_IMPORT_IMAGES || 'true').toLowerCase() === 'true';
}

function maxImagesPerProperty() {
  return toPositiveInt(process.env.KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY, 12, { max: 1000 });
}

function readListPayload(response) {
  const data = response?.data?.data;
  return Array.isArray(data) ? data : [];
}

function readOnePayload(response) {
  return response?.data?.data || null;
}

function sanitizeRawSample(kp) {
  if (!kp) return null;
  return {
    id: kp.id,
    status: kp.status,
    currency: kp.currency,
    for_sale: kp.for_sale,
    for_rent: kp.for_rent,
    for_temp_rental: kp.for_temp_rental,
    for_sale_price: kp.for_sale_price,
    for_rent_price: kp.for_rent_price,
    for_temp_rental_price_month: kp.for_temp_rental_price_month,
    type: kp.type,
    title: kp.title,
    images_count: Array.isArray(kp.images_list) ? kp.images_list.length : 0,
    tags: Array.isArray(kp.tags) ? kp.tags : [],
  };
}

function mediaUrl(media) {
  return media?.url || media?.attributes?.url || null;
}

function mediaId(media) {
  return media?.id || media?.attributes?.id || null;
}

function imageMappingFileId(mapping) {
  return mapping?.file?.id || mapping?.file?.attributes?.id || null;
}

function imageMappingRemoteId(mapping) {
  return mapping?.remote_image_id === null || mapping?.remote_image_id === undefined
    ? null
    : String(mapping.remote_image_id);
}

function sameArray(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sampleList(values, size = 5) {
  return values.slice(0, size);
}

function rawImageSignature(image) {
  return {
    id: image?.id === null || image?.id === undefined ? null : String(image.id),
    main: !!image?.main,
    position: image?.position ?? null,
    url: hashes.normalizeUrl(imageHelpers.pickImageUrl(image)),
  };
}

function normalizedJsonSignature(image) {
  return {
    image_key: image?.image_key || null,
    remote_image_id: image?.remote_image_id === null || image?.remote_image_id === undefined ? null : String(image.remote_image_id),
    remote_url_hash: image?.remote_url_hash || null,
    order: image?.order ?? null,
  };
}

function buildFrontRisk(kp, strapiProperty, enabled) {
  const price = toIntOrNull(strapiProperty?.Precio);
  const currency = String(kp?.currency || '').toLowerCase();
  const risk = {
    detail_page_would_render: price ? `UF ${price.toLocaleString('es-CL')} and CLP as Precio * tasaUF` : null,
    carousel_would_render: price ? `UF ${price.toLocaleString('es-CL')}` : null,
    risk: 'none',
  };

  // Evidence from iaenblanco/propinvest-front:
  // - src/pages/propiedades/[slug].astro formats Precio as UF and derives CLP from Precio * tasaUF.
  // - public/assets/js/featured-carousel.js formats Precio as UF first, only using Precio_CLP when Precio is empty.
  if (enabled && currency === 'clp' && price) {
    risk.risk = 'high';
  }
  return risk;
}

function hasRemotePrimaryPrice(kp) {
  return mappers.getPrimaryPrice(kp) !== null;
}

module.exports = ({ strapi: _strapi } = {}) => {
  const app = () => _strapi || strapi;
  const client = () => app().service('api::kiteprop-sync.client');
  const propiedadDocs = () => app().documents(PROPIEDAD_UID);
  const kitepropImageDocs = () => app().documents(KITEPROP_IMAGE_UID);

  async function listKitePropIds(options) {
    const ids = [];
    const warnings = ['Mapping audit fetches KiteProp detail with getProperty for each listed id; keep maxPages/limit controlled in production.'];

    for (let page = 1; page <= options.maxPages; page += 1) {
      let response;
      try {
        response = await client().listProperties({
          page,
          limit: options.limit,
          order: 'id:desc',
          status: options.status,
        });
      } catch (err) {
        err.source = 'kiteprop';
        throw err;
      }
      const items = readListPayload(response);
      for (const item of items) {
        const id = normalizeId(item?.id);
        if (id) ids.push(id);
        else warnings.push(`KiteProp property with invalid id ignored on page ${page}.`);
      }
      if (items.length < options.limit) break;
      if (page === options.maxPages && items.length >= options.limit) {
        warnings.push('KiteProp mapping audit stopped at maxPages; result may be partial.');
      }
    }

    return { ids, warnings };
  }

  async function readKitePropProperty(id) {
    try {
      const response = await client().getProperty(id);
      return readOnePayload(response);
    } catch (err) {
      err.source = 'kiteprop';
      throw err;
    }
  }

  async function readStrapiProperty(kitepropId) {
    try {
      return await propiedadDocs().findFirst({
      filters: { kiteprop_id: Number(kitepropId) },
      fields: [
        'id',
        'documentId',
        'Titulo',
        'Slug',
        'Objetivo',
        'Tipo',
        'Region',
        'Ubicacion',
        'Direccion',
        'Comuna',
        'Precio',
        'Precio_CLP',
        'Gastos_comunes',
        'Dormitorios',
        'Banos',
        'Estacionamientos',
        'Superficie',
        'M2utiles',
        'Piso',
        'ano_construccion',
        'Destacado',
        'Oportunidades',
        'Publicado',
        'publishedAt',
        'kiteprop_id',
        'kiteprop_status',
        'kiteprop_data_hash',
        'kiteprop_images_hash',
        'kiteprop_sync_status',
        'kiteprop_sync_error',
        'kiteprop_imagenes',
        ...MANUAL_FIELDS,
      ],
      populate: {
        Imagenes: {
          fields: ['id', 'name', 'url'],
        },
      },
      status: 'draft',
      });
    } catch (err) {
      err.source = 'strapi';
      throw err;
    }
  }

  async function readImageMappings(kitepropId) {
    const rows = [];
    const pageSize = 200;
    for (let start = 0; ; start += pageSize) {
      let page;
      try {
        page = await kitepropImageDocs().findMany({
        filters: { kiteprop_property_id: String(kitepropId) },
        fields: [
          'id',
          'documentId',
          'kiteprop_property_id',
          'image_key',
          'remote_image_id',
          'remote_url',
          'remote_url_hash',
          'order',
          'status',
          'last_error',
        ],
        populate: {
          file: {
            fields: ['id', 'name', 'url'],
          },
        },
        sort: ['order:asc', 'id:asc'],
        pagination: { start, limit: pageSize },
        });
      } catch (err) {
        err.source = 'strapi';
        throw err;
      }
      const items = Array.isArray(page) ? page : [];
      rows.push(...items);
      if (items.length < pageSize) break;
    }
    return rows;
  }

  async function collectTargets(options) {
    if (options.kitepropId) {
      return { ids: [options.kitepropId], warnings: [] };
    }
    return listKitePropIds(options);
  }

  function checkPrice(kp, local, expected, options) {
    const issues = [];
    const currency = String(kp.currency || '').toLowerCase();
    const frontRisk = buildFrontRisk(kp, local, options.checkFrontRisk);

    if (currency === 'clp' && toIntOrNull(local?.Precio)) {
      issues.push(issue(
        'precio_field_assignment_mismatch',
        'critical',
        'currency=clp must map only to Precio_CLP; Precio must be null.'
      ));
    }
    if (currency === 'clp' && toIntOrNull(local?.Precio_CLP) === null) {
      issues.push(issue('missing_precio_clp', 'error', 'currency=clp requires Precio_CLP; Precio must remain null.'));
    }
    if (currency === 'uf' && toIntOrNull(local?.Precio) === null) {
      issues.push(issue('missing_precio_uf', 'error', 'currency=uf requires Precio; Precio_CLP must remain null.'));
    }
    if (currency === 'uf' && toIntOrNull(local?.Precio_CLP) !== null) {
      issues.push(issue('unexpected_precio_clp_for_uf', 'error', 'currency=uf must map only to Precio; Precio_CLP must be null.'));
    }
    if (currency && !['uf', 'clp'].includes(currency) && hasRemotePrimaryPrice(kp)) {
      issues.push(issue('unknown_currency_price_not_mapped', 'warning', 'KiteProp currency is unknown; remote price was intentionally not mapped.'));
    }
    if (!sameNumber(local?.Precio, expected.Precio)) {
      issues.push(issue('precio_mismatch', 'critical', 'Strapi Precio differs from current mapper output.'));
    }
    if (!sameNumber(local?.Precio_CLP, expected.Precio_CLP)) {
      issues.push(issue('precio_clp_mismatch', 'error', 'Strapi Precio_CLP differs from current mapper output.'));
    }
    if ((kp.for_sale || kp.for_rent || kp.for_temp_rental) && expected.Precio === null && expected.Precio_CLP === null) {
      issues.push(issue('missing_commercial_price', 'warning', 'Property has an operation flag but no mapped price.'));
    }

    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: {
        currency: kp.currency || null,
        for_sale: !!kp.for_sale,
        for_rent: !!kp.for_rent,
        for_temp_rental: !!kp.for_temp_rental,
        for_sale_price: kp.for_sale_price ?? null,
        for_rent_price: kp.for_rent_price ?? null,
        for_temp_rental_price_month: kp.for_temp_rental_price_month ?? null,
      },
      strapi: {
        Precio: local?.Precio ?? null,
        Precio_CLP: local?.Precio_CLP ?? null,
      },
      expected: {
        Precio: expected.Precio ?? null,
        Precio_CLP: expected.Precio_CLP ?? null,
      },
      front_risk: frontRisk,
      issues,
      message: issues.length ? issues.map((item) => item.message).join(' ') : 'Price and currency mapping match current mapper.',
    };
  }

  function checkObjective(kp, local, expected) {
    const issues = [];
    if (kp.for_sale && (kp.for_rent || kp.for_temp_rental)) {
      issues.push(issue('multiple_operation_flags', 'warning', 'KiteProp has sale and rental flags; current mapper prioritizes Venta.'));
    }
    if (!sameText(local?.Objetivo, expected.Objetivo)) {
      issues.push(issue('objetivo_mismatch', 'error', 'Strapi Objetivo differs from current mapper output.'));
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: { for_sale: !!kp.for_sale, for_rent: !!kp.for_rent, for_temp_rental: !!kp.for_temp_rental },
      strapi: { Objetivo: local?.Objetivo ?? null },
      expected: { Objetivo: expected.Objetivo ?? null },
      issues,
    };
  }

  function checkType(kp, local, expected) {
    const issues = [];
    const remoteType = kp.type ? String(kp.type).toLowerCase() : null;
    if (remoteType && !Object.prototype.hasOwnProperty.call(mappers.TYPE_MAP, remoteType)) {
      issues.push(issue('type_fallback_otros_inmuebles', 'warning', 'KiteProp type is not in TYPE_MAP and falls back to Otros Inmuebles.'));
    }
    if (!sameText(local?.Tipo, expected.Tipo)) {
      issues.push(issue('tipo_mismatch', 'error', 'Strapi Tipo differs from current mapper output.'));
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: { type: kp.type ?? null },
      strapi: { Tipo: local?.Tipo ?? null },
      expected: { Tipo: expected.Tipo ?? null },
      issues,
    };
  }

  function checkPublication(kp, local, expected) {
    const issues = [];
    const remoteStatus = String(kp.status || '').toLowerCase();
    const localPublished = local?.Publicado === true;
    if (!sameText(local?.kiteprop_status, kp.status ?? null)) {
      issues.push(issue('kiteprop_status_mismatch', 'error', 'Strapi kiteprop_status differs from KiteProp status.'));
    }
    if (remoteStatus === 'active' && !localPublished) {
      issues.push(issue('active_not_published', 'critical', 'KiteProp status is active but Strapi Publicado is false.'));
    }
    if (remoteStatus && remoteStatus !== 'active' && localPublished) {
      issues.push(issue('inactive_status_published', 'error', 'KiteProp status is not active but Strapi Publicado is true.'));
    }
    if (local?.Publicado !== expected.Publicado) {
      issues.push(issue('publicado_mismatch', 'error', 'Strapi Publicado differs from current mapper output.'));
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: { status: kp.status ?? null },
      strapi: {
        kiteprop_status: local?.kiteprop_status ?? null,
        Publicado: local?.Publicado ?? null,
        publishedAt: local?.publishedAt ?? null,
      },
      expected: { Publicado: expected.Publicado },
      issues,
    };
  }

  function checkLocation(kp, local, expected) {
    const fields = [
      ['state', 'Region'],
      ['city', 'Comuna'],
      ['neighborhood', 'Ubicacion'],
      ['address', 'Direccion'],
    ];
    const issues = [];
    for (const [remoteField, localField] of fields) {
      if (!sameText(local?.[localField], expected[localField])) {
        issues.push(issue(`${localField.toLowerCase()}_mismatch`, 'error', `${localField} differs from current mapper output.`));
      }
      if (kp?.[remoteField] && !local?.[localField]) {
        issues.push(issue(`${localField.toLowerCase()}_empty`, 'warning', `${localField} is empty while KiteProp has ${remoteField}.`));
      }
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: { state: kp.state ?? null, city: kp.city ?? null, neighborhood: kp.neighborhood ?? null, address: kp.address ?? null },
      strapi: { Region: local?.Region ?? null, Comuna: local?.Comuna ?? null, Ubicacion: local?.Ubicacion ?? null, Direccion: local?.Direccion ?? null },
      expected: { Region: expected.Region ?? null, Comuna: expected.Comuna ?? null, Ubicacion: expected.Ubicacion ?? null, Direccion: expected.Direccion ?? null },
      issues,
    };
  }

  function checkSpecs(kp, local, expected) {
    const fields = [
      ['bedrooms', 'Dormitorios'],
      ['bathrooms', 'Banos'],
      ['parkings', 'Estacionamientos'],
      ['total_meters', 'Superficie'],
      ['covered_meters', 'M2utiles'],
      ['floor', 'Piso'],
      ['year_built', 'ano_construccion'],
      ['expenses', 'Gastos_comunes'],
    ];
    const issues = [];
    for (const [, localField] of fields) {
      if (!sameNumber(local?.[localField], expected[localField])) {
        issues.push(issue(`${localField.toLowerCase()}_mismatch`, 'error', `${localField} differs from current mapper output.`));
      }
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: Object.fromEntries(fields.map(([remote]) => [remote, kp?.[remote] ?? null])),
      strapi: Object.fromEntries(fields.map(([, localField]) => [localField, local?.[localField] ?? null])),
      expected: Object.fromEntries(fields.map(([, localField]) => [localField, expected[localField] ?? null])),
      issues,
    };
  }

  function checkFeaturedFlags(kp, local, expected) {
    const postalCode = mappers.getKitepropPostalCode(kp);
    const issues = [];
    if (local?.Destacado !== expected.Destacado) {
      issues.push(issue('destacado_mismatch', 'warning', 'Destacado differs from postal-code-based mapper output.'));
    }
    if (local?.Oportunidades !== expected.Oportunidades) {
      issues.push(issue('oportunidades_mismatch', 'warning', 'Oportunidades differs from postal-code-based mapper output.'));
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: { postal_code: postalCode || null },
      strapi: { Destacado: local?.Destacado ?? null, Oportunidades: local?.Oportunidades ?? null },
      expected: {
        Destacado: expected.Destacado,
        Oportunidades: expected.Oportunidades,
      },
      issues,
    };
  }

  function checkTitleSlug(kp, local, expected) {
    const issues = [];
    if (!sameText(local?.Titulo, expected.Titulo)) {
      issues.push(issue('titulo_mismatch', 'error', 'Titulo differs from current mapper output.'));
    }
    if (!local?.Slug) {
      issues.push(issue('missing_slug', 'warning', 'Slug is empty; frontend static routes require Slug.'));
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: { title: kp.title ?? null },
      strapi: { Titulo: local?.Titulo ?? null, Slug: local?.Slug ?? null },
      expected: {
        Titulo: expected.Titulo ?? null,
        Slug: local?.Slug || expected.Slug || null,
      },
      issues,
    };
  }

  function checkHashes(local, expectedPayload, normalizedImages) {
    const expectedDataHash = hashes.buildPropertyDataHash(expectedPayload);
    const expectedImagesHash = hashes.buildPropertyImagesHash(normalizedImages);
    const issues = [];
    if (local?.kiteprop_data_hash && local.kiteprop_data_hash !== expectedDataHash) {
      issues.push(issue('data_hash_mismatch', 'error', 'Stored kiteprop_data_hash does not match current mapped KiteProp payload.'));
    }
    if (local?.kiteprop_images_hash && local.kiteprop_images_hash !== expectedImagesHash) {
      issues.push(issue('images_hash_mismatch', 'error', 'Stored kiteprop_images_hash does not match current normalized images.'));
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      strapi: {
        kiteprop_data_hash: local?.kiteprop_data_hash ?? null,
        kiteprop_images_hash: local?.kiteprop_images_hash ?? null,
      },
      expected: {
        kiteprop_data_hash: expectedDataHash,
        kiteprop_images_hash: expectedImagesHash,
      },
      issues,
    };
  }

  function checkSyncStatus(local) {
    const issues = [];
    if (local?.kiteprop_sync_status && local.kiteprop_sync_status !== 'ok') {
      issues.push(issue('sync_status_not_ok', 'warning', 'kiteprop_sync_status is not ok.'));
    }
    if (local?.kiteprop_sync_error) {
      issues.push(issue('sync_error_present', 'error', 'kiteprop_sync_error is present.'));
    }
    return {
      status: maxStatus(issues.map((item) => item.severity)),
      strapi: {
        kiteprop_sync_status: local?.kiteprop_sync_status ?? null,
        kiteprop_sync_error: local?.kiteprop_sync_error ?? null,
      },
      issues,
    };
  }

  function checkManualFields(local) {
    const present = {};
    for (const field of MANUAL_FIELDS) {
      if (local?.[field] !== null && local?.[field] !== undefined && local?.[field] !== '') {
        present[field] = true;
      }
    }
    return {
      status: 'ok',
      manual_fields_summary: {
        tracked_fields: MANUAL_FIELDS,
        present_count: Object.keys(present).length,
        note: 'These fields are treated as manual Strapi enrichment and are not errors when absent from KiteProp mapping.',
      },
      issues: [],
    };
  }

  function checkImages(kp, local, mappings, normalizedImages) {
    const issues = [];
    const remoteImages = Array.isArray(kp.images_list) ? kp.images_list : [];
    const localImages = Array.isArray(local?.Imagenes) ? local.Imagenes : [];
    const localJsonImages = Array.isArray(local?.kiteprop_imagenes) ? local.kiteprop_imagenes : [];
    const normalizedKeys = normalizedImages.map((image) => image.image_key);
    const normalizedKeySet = new Set(normalizedKeys);
    const mappingByKey = new Map();
    const duplicateKeys = new Set();

    for (const image of normalizedImages) {
      if (normalizedKeys.indexOf(image.image_key) !== normalizedKeys.lastIndexOf(image.image_key)) {
        duplicateKeys.add(image.image_key);
      }
      if (!image.remote_url) {
        issues.push(issue('empty_remote_url', 'error', 'Normalized image has empty remote_url.', { image_key: image.image_key }));
      }
      if (image.remote_url && !/^https?:\/\//i.test(image.remote_url)) {
        issues.push(issue('invalid_remote_url', 'warning', 'Normalized image remote_url is not absolute HTTP(S).', { image_key: image.image_key }));
      }
    }

    for (const key of duplicateKeys) {
      issues.push(issue('duplicate_image_key', 'error', 'Normalized image_key appears more than once.', { image_key: key }));
    }

    for (const mapping of mappings) {
      if (mappingByKey.has(mapping.image_key)) {
        issues.push(issue('duplicate_image_key', 'error', 'KiteProp Image mapping image_key appears more than once.', { image_key: mapping.image_key }));
      }
      mappingByKey.set(mapping.image_key, mapping);
      if (!normalizedKeySet.has(mapping.image_key)) {
        issues.push(issue('orphan_kiteprop_image_mapping', 'warning', 'KiteProp Image mapping is not present in normalized images.', { image_key: mapping.image_key }));
      }
      if (!imageMappingFileId(mapping)) {
        issues.push(issue('missing_media_file', 'error', 'KiteProp Image mapping has no associated media file.', { image_key: mapping.image_key }));
      }
    }

    for (const image of normalizedImages) {
      const mapping = mappingByKey.get(image.image_key);
      if (!mapping) {
        issues.push(issue('missing_kiteprop_image_mapping', 'error', 'Missing KiteProp Image mapping for normalized image.', { image_key: image.image_key }));
        continue;
      }
      if (mapping.remote_url_hash !== image.remote_url_hash) {
        issues.push(issue('remote_url_hash_mismatch', 'error', 'KiteProp Image remote_url_hash differs from normalized image.', { image_key: image.image_key }));
      }
    }

    if (isImageImportEnabled() && localImages.length !== normalizedImages.length) {
      issues.push(issue(
        'image_count_mismatch',
        remoteImages.length > 0 && localImages.length === 0 ? 'critical' : 'error',
        'Strapi Imagenes count differs from normalized KiteProp image count.'
      ));
    }

    if (localJsonImages.length > 0) {
      const jsonHasNormalizedShape = localJsonImages.some((image) => image?.image_key || image?.remote_url_hash);
      if (jsonHasNormalizedShape) {
        const localJsonNormalized = localJsonImages.map(normalizedJsonSignature);
        const expectedJsonNormalized = normalizedImages.map(normalizedJsonSignature);
        if (!sameArray(localJsonNormalized, expectedJsonNormalized)) {
          issues.push(issue('kiteprop_imagenes_json_mismatch', 'warning', 'Propiedad.kiteprop_imagenes normalized JSON differs from normalized KiteProp images.'));
        }
      } else {
        const localJsonRaw = localJsonImages.map(rawImageSignature);
        const expectedJsonRaw = mappers.mapKitepropImagenes(remoteImages).map(rawImageSignature);
        if (!sameArray(localJsonRaw, expectedJsonRaw)) {
          issues.push(issue('kiteprop_imagenes_json_mismatch', 'warning', 'Propiedad.kiteprop_imagenes raw JSON differs from mapKitepropImagenes output.'));
        }
      }
    }

    const expectedFileIds = normalizedImages
      .map((image) => imageMappingFileId(mappingByKey.get(image.image_key)));
    const localFileIds = localImages.map(mediaId).filter(Boolean);
    const completeExpectedFileIds = expectedFileIds.length === normalizedImages.length && expectedFileIds.every(Boolean);
    const expectedFileIdsForCompare = expectedFileIds.filter(Boolean);

    if (
      completeExpectedFileIds &&
      localFileIds.length >= expectedFileIdsForCompare.length &&
      !sameArray(localFileIds.slice(0, expectedFileIdsForCompare.length), expectedFileIdsForCompare)
    ) {
      issues.push(issue('media_order_mismatch', 'error', 'Propiedad.Imagenes media order differs from normalized KiteProp image mappings.'));
    }

    if (expectedFileIdsForCompare.length && localFileIds.length && expectedFileIdsForCompare[0] !== localFileIds[0]) {
      issues.push(issue('first_image_mismatch', 'critical', 'First Strapi media file does not match first normalized KiteProp image.'));
    }

    const mappingsInStoredOrder = [...mappings].sort((a, b) => {
      const ao = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const mappingRemoteIdsInOrder = mappingsInStoredOrder
      .filter((mapping) => normalizedKeySet.has(mapping.image_key))
      .map(imageMappingRemoteId);
    const expectedRemoteIdsInOrder = normalizedImages.map((image) => image.remote_image_id);
    if (
      mappingRemoteIdsInOrder.length === expectedRemoteIdsInOrder.length &&
      !sameArray(mappingRemoteIdsInOrder, expectedRemoteIdsInOrder)
    ) {
      issues.push(issue('kiteprop_image_mapping_order_mismatch', 'error', 'KiteProp Image mapping order differs from normalized KiteProp images.'));
    }

    const mappingByFileId = new Map();
    for (const mapping of mappings) {
      const fileId = imageMappingFileId(mapping);
      if (fileId) mappingByFileId.set(String(fileId), mapping);
    }
    const actualImageKeys = localFileIds.map((fileId) => mappingByFileId.get(String(fileId))?.image_key || null);
    const actualRemoteIds = localFileIds.map((fileId) => imageMappingRemoteId(mappingByFileId.get(String(fileId))));
    const comparisonBasis = completeExpectedFileIds
      ? 'media_mapping'
      : localJsonImages.length > 0
        ? 'kiteprop_imagenes_json'
        : 'unknown';

    const mainRemote = remoteImages.find((image) => image?.main);
    if (mainRemote && normalizedImages[0]?.remote_image_id && String(mainRemote.id) !== String(normalizedImages[0].remote_image_id)) {
      issues.push(issue('first_image_mismatch', 'critical', 'KiteProp main image is not first after current sorting.'));
    }

    return {
      status: maxStatus(issues.map((item) => item.severity)),
      kiteprop: {
        remote_count: remoteImages.length,
        main_remote_image_id: mainRemote?.id ?? null,
        normalized_count: normalizedImages.length,
        normalized_first_image_key: normalizedImages[0]?.image_key || null,
        expected_first_image_key: normalizedImages[0]?.image_key || null,
        expected_remote_image_ids_sample: sampleList(expectedRemoteIdsInOrder),
      },
      strapi: {
        imagenes_count: localImages.length,
        kiteprop_image_mapping_count: mappings.length,
        first_media_id: localFileIds[0] || null,
        first_media_url: mediaUrl(localImages[0]),
        actual_first_image_key: actualImageKeys[0] || null,
        actual_remote_image_ids_sample: sampleList(actualRemoteIds),
        comparison_basis: comparisonBasis,
      },
      issues,
    };
  }

  async function auditOne(kp, options) {
    const kitepropId = normalizeId(kp?.id);
    if (!kitepropId) {
      return {
        kiteprop_id: kp?.id ?? null,
        overall_status: 'error',
        checks: {},
        issues: [issue('invalid_kiteprop_id', 'error', 'KiteProp property has invalid id.')],
      };
    }

    const expected = mappers.mapPropertyToStrapi(kp);
    const mappedImages = mappers.mapKitepropImagenes(kp.images_list);
    const normalizedImages = imageHelpers.normalizeKitepropImages(mappedImages, expected.kiteprop_id, maxImagesPerProperty());
    const local = await readStrapiProperty(kitepropId);
    const mappings = options.checkImages ? await readImageMappings(kitepropId) : [];

    if (!local) {
      return {
        kiteprop_id: kitepropId,
        documentId: null,
        title: kp.title ?? null,
        overall_status: 'critical',
        checks: {},
        issues: [issue('missing_strapi_property', 'critical', 'KiteProp property is missing in Strapi.')],
      };
    }

    const checks = {
      price: checkPrice(kp, local, expected, options),
      currency: { status: 'ok', kiteprop: { currency: kp.currency ?? null }, strapi: {}, issues: [] },
      objective: checkObjective(kp, local, expected),
      type: checkType(kp, local, expected),
      status_publication: checkPublication(kp, local, expected),
      location: checkLocation(kp, local, expected),
      specs: checkSpecs(kp, local, expected),
      featured_flags: checkFeaturedFlags(kp, local, expected),
      title_slug: checkTitleSlug(kp, local, expected),
      hashes: checkHashes(local, expected, normalizedImages),
      sync_status: checkSyncStatus(local),
      manual_fields: checkManualFields(local),
    };

    checks.front_rendering = {
      status: checks.price.front_risk.risk === 'high' ? 'critical' : 'ok',
      front_risk: checks.price.front_risk,
      issues: checks.price.front_risk.risk === 'high'
        ? [issue('precio_field_assignment_mismatch', 'critical', 'Frontend risk is caused by CLP stored in Precio instead of only Precio_CLP.')]
        : [],
    };

    checks.images = options.checkImages
      ? checkImages(kp, local, mappings, normalizedImages)
      : { status: 'ok', skipped: true, issues: [] };

    if (options.includeRawSample) {
      checks.raw_sample = sanitizeRawSample(kp);
    }

    const allIssues = Object.values(checks).flatMap((check) => check?.issues || []);
    return {
      kiteprop_id: kitepropId,
      documentId: local.documentId || null,
      title: local.Titulo || kp.title || null,
      overall_status: maxStatus(Object.values(checks).map((check) => check.status || 'ok')),
      checks,
      issues: allIssues,
    };
  }

  async function audit(options = {}) {
    const normalizedOptions = {
      status: options.status || 'active',
      kitepropId: normalizeId(options.kitepropId),
      limit: normalizeKitePropLimit(options.limit),
      maxPages: toPositiveInt(options.maxPages, DEFAULT_MAX_PAGES, { max: 1000 }),
      includeDetails: options.includeDetails !== false,
      includeRawSample: options.includeRawSample === true,
      sampleSize: toPositiveInt(options.sampleSize, DEFAULT_SAMPLE_SIZE, { max: 1000 }),
      checkImages: options.checkImages !== false,
      checkFrontRisk: options.checkFrontRisk !== false,
    };

    const targetResult = await collectTargets(normalizedOptions);
    const warnings = [...targetResult.warnings];
    const properties = [];

    for (const id of targetResult.ids) {
      const kp = await readKitePropProperty(id);
      properties.push(await auditOne(kp, normalizedOptions));
    }

    const fieldSummary = fieldSummaryTemplate();
    const summary = {
      properties_audited: properties.length,
      healthy_count: 0,
      warning_count: 0,
      error_count: 0,
      critical_count: 0,
    };

    for (const property of properties) {
      if (property.overall_status === 'ok') summary.healthy_count += 1;
      if (property.overall_status === 'warning') summary.warning_count += 1;
      if (property.overall_status === 'error') summary.error_count += 1;
      if (property.overall_status === 'critical') summary.critical_count += 1;

      for (const field of FIELD_GROUPS) {
        const check = property.checks[field];
        bumpField(fieldSummary, field, check?.status || 'ok');
      }
    }

    const allIssues = properties.flatMap((property) =>
      (property.issues || []).map((item) => ({
        kiteprop_id: property.kiteprop_id,
        documentId: property.documentId || null,
        ...item,
      }))
    );

    return {
      ok: true,
      read_only: true,
      filters: {
        status: normalizedOptions.status,
        kitepropId: normalizedOptions.kitepropId,
        limit: normalizedOptions.limit,
        maxPages: normalizedOptions.maxPages,
        checkImages: normalizedOptions.checkImages,
        checkFrontRisk: normalizedOptions.checkFrontRisk,
      },
      summary,
      field_summary: fieldSummary,
      issues: allIssues.slice(0, normalizedOptions.sampleSize),
      properties: normalizedOptions.includeDetails ? properties : [],
      warnings,
    };
  }

  return {
    audit,
    _internal: {
      auditOne,
      checkPrice,
      checkImages,
      normalizeKitePropLimit,
    },
  };
};

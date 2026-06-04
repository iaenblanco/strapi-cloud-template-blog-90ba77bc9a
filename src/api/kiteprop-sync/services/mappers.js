'use strict';

/**
 * mappers — pure functions that translate KiteProp payloads into Strapi entities.
 *
 * Design contracts (DO NOT BREAK):
 *   1. Pure: no I/O, no `strapi`, no DB calls. Only data in → data out.
 *   2. Conservative: only sets fields that come from KiteProp. Returns `undefined`
 *      for fields that should NOT be touched (preserves Strapi-side enrichment).
 *   3. Stable: KiteProp `id` is the canonical key (`kiteprop_id` in Strapi).
 *   4. Lossless: the original payload is preserved in `kiteprop_raw` so we never
 *      lose information that we don't currently map (e.g. for_sale + for_rent flags).
 *
 * Limitations documented inline as TODOs.
 */

// ---------------------------------------------------------------------------
// Type & Objetivo mapping tables
// ---------------------------------------------------------------------------

/**
 * KiteProp `type` → Strapi `Tipo` enum.
 * Strapi enum: Casa, Terreno, Oficina, Departamento, Locales Comerciales,
 *              Sitio, Bodega, Industriales, Estacionamientos, Parcela, Otros Inmuebles.
 *
 * Note: KiteProp does not have a "Sitio" equivalent.
 */
const TYPE_MAP = {
  houses: 'Casa',
  apartments: 'Departamento',
  ph: 'Casa', // PH = "propiedad horizontal" (closest equivalent in Strapi enum)
  offices: 'Oficina',
  residential_lands: 'Terreno',
  industrial_lands: 'Terreno',
  warehouses: 'Bodega',
  industrial_warehouses: 'Industriales',
  farms: 'Parcela',
  parking_spaces: 'Estacionamientos',
  retail_spaces: 'Locales Comerciales',
  medical_spaces: 'Otros Inmuebles',
  cemetery_lots: 'Otros Inmuebles',
  businesses: 'Otros Inmuebles',
  boat_storages: 'Otros Inmuebles',
};

const MAX_SLUG_BASE_LENGTH = 90;

function mapTipo(kpType) {
  if (!kpType) return null;
  return TYPE_MAP[String(kpType).toLowerCase()] || 'Otros Inmuebles';
}

/**
 * Per the user's rule (Phase 1):
 *   - If for_sale && for_rent are both true → "Venta" (sale wins).
 *   - Original flags are preserved in kiteprop_raw for full fidelity.
 */
function mapObjetivo(remote) {
  if (remote.for_sale) return 'Venta';
  if (remote.for_rent) return 'Arriendo';
  if (remote.for_temp_rental) return 'Arriendo';
  return null;
}

function getPrimaryPrice(remote) {
  if (remote.for_sale && remote.for_sale_price != null) return Math.round(Number(remote.for_sale_price));
  if (remote.for_rent && remote.for_rent_price != null) return Math.round(Number(remote.for_rent_price));
  if (remote.for_temp_rental && remote.for_temp_rental_price_month != null) {
    return Math.round(Number(remote.for_temp_rental_price_month));
  }
  return null;
}

function mapPrecio(remote) {
  const currency = String(remote.currency || '').toLowerCase();
  if (currency !== 'uf') return null;
  return getPrimaryPrice(remote);
}

function mapPrecioCLP(remote) {
  const currency = String(remote.currency || '').toLowerCase();
  if (currency !== 'clp') return null;
  const p = getPrimaryPrice(remote);
  return p != null ? Math.round(p) : null;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function buildKitepropSlug(title, kitepropId) {
  const id = String(kitepropId || '').trim();
  if (!id) return null;

  const base = slugify(title) || 'propiedad';
  const trimmedBase = base
    .slice(0, MAX_SLUG_BASE_LENGTH)
    .replace(/-+$/g, '');

  return `${trimmedBase || 'propiedad'}-${id}`;
}

function toIntOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toBoolOrUndefined(v) {
  if (v === true) return true;
  if (v === false) return false;
  return undefined;
}

// ---------------------------------------------------------------------------
// Destacado / Oportunidades — driven by KiteProp postal_code
// ---------------------------------------------------------------------------

/**
 * KiteProp uses `postal_code` as an internal signal for featured flags.
 * The field can be a string, a number, null, or absent.
 */
function getKitepropPostalCode(remote) {
  if (remote == null || typeof remote !== 'object') return '';
  const raw = remote.postal_code;
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

const POSTAL_CODE_FLAGS = {
  '000000': { Destacado: true, Oportunidades: false },
  '000001': { Destacado: false, Oportunidades: true },
  '000002': { Destacado: true, Oportunidades: true },
};

function mapFeaturedFlagsFromPostalCode(remote) {
  const code = getKitepropPostalCode(remote);
  return POSTAL_CODE_FLAGS[code] || { Destacado: false, Oportunidades: false };
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

/**
 * Phase 1 image strategy: store CDN URLs as JSON, do not mirror to Strapi media.
 */
function mapKitepropImagenes(images_list) {
  if (!Array.isArray(images_list)) return [];
  return images_list
    .filter((img) => img && (img.id !== undefined || img.sm || img.md || img.lg))
    .map((img) => ({
      id: img.id ?? null,
      title: img.title ?? null,
      main: !!img.main,
      blueprint: !!img.blueprint,
      internal: !!img.internal,
      position: img.position ?? null,
      sm: img.sm || null,
      md: img.md || null,
      lg: img.lg || null,
      created_at: img.created_at || null,
      updated_at: img.updated_at || null,
    }))
    .sort((a, b) => {
      if (a.main && !b.main) return -1;
      if (!a.main && b.main) return 1;
      const pa = a.position ?? Number.MAX_SAFE_INTEGER;
      const pb = b.position ?? Number.MAX_SAFE_INTEGER;
      return pa - pb;
    });
}

// ---------------------------------------------------------------------------
// Status / publishedAt
// ---------------------------------------------------------------------------

/**
 * KiteProp status → Strapi `Publicado` boolean + lifecycle.
 *
 * "Publicado" in Strapi means the property is visible publicly. We map only
 * `status === 'active'` to true. For "active_unpublished" we set Publicado=false.
 * The full KiteProp status string is preserved in `kiteprop_status`.
 */
function isPublishedFromStatus(kpStatus) {
  return String(kpStatus || '').toLowerCase() === 'active';
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build a partial Strapi `propiedad` payload from a KiteProp property.
 *
 * The payload is "partial" by design: any field whose value is `undefined`
 * is meant to be IGNORED by the upsert step (so manual Strapi-only fields
 * are preserved). Fields whose value is `null` ARE explicitly sent (clearing
 * the value in Strapi).
 *
 * @param {object} kp - KiteProp property payload (the inner `data` object).
 * @returns {object} - Strapi-compatible partial payload (camel/PascalCase fields
 *                     matching the existing `propiedad` schema, plus kiteprop_*).
 */
function mapPropertyToStrapi(kp) {
  if (!kp || typeof kp !== 'object') {
    throw new Error('mapPropertyToStrapi: payload must be an object');
  }
  if (!kp.id) {
    throw new Error('mapPropertyToStrapi: KiteProp payload is missing `id`');
  }

  const tipo = mapTipo(kp.type);
  const objetivo = mapObjetivo(kp);
  const precio = mapPrecio(kp);
  const precioClp = mapPrecioCLP(kp);
  const featuredFlags = mapFeaturedFlagsFromPostalCode(kp);

  const out = {
    // kiteprop_* technical fields (always set on sync)
    kiteprop_id: kp.id,
    kiteprop_code: kp.code ?? null,
    kiteprop_internal_id: kp.internal_id ?? null,
    kiteprop_source_id: kp.source_id ?? null,
    kiteprop_status: kp.status ?? null,
    kiteprop_updated_at: kp.updated_at || null,
    kiteprop_synced_at: new Date().toISOString(),
    kiteprop_imagenes: mapKitepropImagenes(kp.images_list),
    kiteprop_raw: kp,

    // Mapped business fields (only set when KiteProp provides them)
    Titulo: kp.title ?? null,
    Slug: buildKitepropSlug(kp.title, kp.id),
    Descripcion: kp.description ?? null,
    Tipo: tipo ?? undefined,
    Objetivo: objetivo ?? undefined,

    Region: kp.state ?? null,
    Comuna: kp.city ?? null,
    Ubicacion: kp.neighborhood ?? null,
    Direccion: kp.address ?? null,

    Precio: precio,
    Precio_CLP: precioClp,
    Gastos_comunes: toIntOrNull(kp.expenses),

    Dormitorios: toIntOrNull(kp.bedrooms),
    Banos: toIntOrNull(kp.bathrooms),
    Estacionamientos: toIntOrNull(kp.parkings),
    Superficie: toIntOrNull(kp.total_meters),
    M2utiles: toIntOrNull(kp.covered_meters),
    Piso: toIntOrNull(kp.floor),
    ano_construccion: toIntOrNull(kp.year_built),

    // Booleans driven by status and postal_code
    Publicado: isPublishedFromStatus(kp.status),
    Destacado: featuredFlags.Destacado,
    Oportunidades: featuredFlags.Oportunidades,
  };

  // Strip undefined keys so Strapi treats them as "not provided"
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }

  return out;
}

/**
 * Build the Strapi payload to apply when KiteProp reports a deletion.
 * Phase 1 policy = soft delete only:
 *   - Publicado = false
 *   - Strapi publication state is handled by the sync service with unpublish()
 *   - kiteprop_status = "deleted"
 *
 * Other fields are NOT touched, so manually enriched data survives.
 */
function buildSoftDeletePayload() {
  return {
    Publicado: false,
    kiteprop_status: 'deleted',
    kiteprop_synced_at: new Date().toISOString(),
    kiteprop_last_synced_at: new Date().toISOString(),
    kiteprop_sync_status: 'ok',
    kiteprop_sync_error: null,
  };
}

/**
 * Helper: decide whether a remote payload is newer than the local one.
 * Returns true if either local has no kiteprop_updated_at OR remote is strictly newer.
 */
function isRemoteNewer(remoteUpdatedAt, localUpdatedAt) {
  if (!remoteUpdatedAt) return false;
  if (!localUpdatedAt) return true;
  const r = new Date(remoteUpdatedAt).getTime();
  const l = new Date(localUpdatedAt).getTime();
  if (!Number.isFinite(r) || !Number.isFinite(l)) return true;
  return r > l;
}

module.exports = {
  TYPE_MAP,
  mapTipo,
  mapObjetivo,
  getPrimaryPrice,
  mapPrecio,
  mapPrecioCLP,
  slugify,
  buildKitepropSlug,
  mapKitepropImagenes,
  getKitepropPostalCode,
  mapFeaturedFlagsFromPostalCode,
  isPublishedFromStatus,
  mapPropertyToStrapi,
  buildSoftDeletePayload,
  isRemoteNewer,
};

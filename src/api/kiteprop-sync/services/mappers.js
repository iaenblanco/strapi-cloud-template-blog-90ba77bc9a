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

function mapPrecio(remote) {
  if (remote.for_sale && remote.for_sale_price != null) return Number(remote.for_sale_price);
  if (remote.for_rent && remote.for_rent_price != null) return Number(remote.for_rent_price);
  if (remote.for_temp_rental && remote.for_temp_rental_price_month != null) {
    return Number(remote.for_temp_rental_price_month);
  }
  return null;
}

function mapPrecioCLP(remote) {
  const currency = String(remote.currency || '').toLowerCase();
  if (currency !== 'clp') return null;
  const p = mapPrecio(remote);
  return p != null ? Math.round(p) : null;
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
// Tag-based booleans (CONFIGURABLE — see TODO below)
// ---------------------------------------------------------------------------

/**
 * Destacado / Oportunidades flag derivation.
 *
 * TODO (configurable): The exact tag conventions used by KiteProp to mark
 * "destacado" and "oportunidad" properties are not yet confirmed by the user.
 * Until confirmed, these are read from env vars with safe defaults:
 *
 *   KITEPROP_TAGS_DESTACADO   (comma-separated, default: "destacado")
 *   KITEPROP_TAGS_OPORTUNIDAD (comma-separated, default: "oportunidad,oportunidades")
 *
 * If neither tag is present, the field is NOT set (returns undefined) so any
 * manual value in Strapi is preserved.
 */
function getTagSet(envName, fallback) {
  const raw = process.env[envName];
  const list = (raw && raw.length > 0 ? raw : fallback)
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

function tagsInclude(tags, set) {
  if (!Array.isArray(tags)) return false;
  return tags.some((t) => set.has(String(t).toLowerCase()));
}

function mapDestacado(tags) {
  const set = getTagSet('KITEPROP_TAGS_DESTACADO', 'destacado');
  return tagsInclude(tags, set);
}

function mapOportunidades(tags) {
  const set = getTagSet('KITEPROP_TAGS_OPORTUNIDAD', 'oportunidad,oportunidades');
  return tagsInclude(tags, set);
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
  const tags = Array.isArray(kp.tags) ? kp.tags : [];

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

    // Booleans driven by status / tags
    Publicado: isPublishedFromStatus(kp.status),
  };

  // Tag-based booleans: only set when tag is detected (preserve manual edits otherwise)
  if (tags.length > 0) {
    out.Destacado = mapDestacado(tags);
    out.Oportunidades = mapOportunidades(tags);
  }

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
  mapPrecio,
  mapPrecioCLP,
  mapKitepropImagenes,
  mapDestacado,
  mapOportunidades,
  isPublishedFromStatus,
  mapPropertyToStrapi,
  buildSoftDeletePayload,
  isRemoteNewer,
};

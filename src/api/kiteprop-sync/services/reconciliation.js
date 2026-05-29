'use strict';

const PROPIEDAD_UID = 'api::propiedad.propiedad';
const DEFAULT_LIMIT = 50;
const DEFAULT_MAX_PAGES = 20;
const DEFAULT_SAMPLE_SIZE = 20;
const STRAPI_PAGE_SIZE = 200;

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
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function sortedNumbers(values) {
  return Array.from(values).sort((a, b) => a - b);
}

function sampleIds(ids, sampleSize) {
  return ids.slice(0, sampleSize);
}

function minOrNull(ids) {
  return ids.length ? ids[0] : null;
}

function maxOrNull(ids) {
  return ids.length ? ids[ids.length - 1] : null;
}

function hasAttribute(strapiApp, name) {
  return !!strapiApp?.contentTypes?.[PROPIEDAD_UID]?.attributes?.[name];
}

function readListPayload(response) {
  const data = response?.data?.data;
  return Array.isArray(data) ? data : [];
}

function documentKey(row) {
  return row?.documentId || String(row?.id || '');
}

function isMaxPageCutLikely(response, page, maxPages, itemsLength, limit) {
  if (page < maxPages) return false;
  const meta = response?.data?.meta;
  if (meta?.last_page && Number(meta.last_page) > page) return true;
  return itemsLength >= limit;
}

function buildHealth({ missingCount, duplicateCount, readErrors }) {
  const healthy = missingCount === 0 && duplicateCount === 0 && readErrors === 0;
  let reason = 'KiteProp active IDs match Strapi kiteprop_id set with no duplicates.';
  if (!healthy) {
    const reasons = [];
    if (missingCount > 0) reasons.push(`${missingCount} KiteProp IDs are missing in Strapi`);
    if (duplicateCount > 0) reasons.push(`${duplicateCount} duplicated kiteprop_id values exist in Strapi`);
    if (readErrors > 0) reasons.push(`${readErrors} read errors occurred`);
    reason = reasons.join('; ');
  }
  return { healthy, reason };
}

module.exports = ({ strapi: _strapi } = {}) => {
  const client = () => (_strapi || strapi).service('api::kiteprop-sync.client');
  const app = () => _strapi || strapi;

  async function readKitePropIds(options) {
    const warnings = [];
    const ids = new Set();
    let pagesRead = 0;
    let stoppedAtMaxPages = false;

    for (let page = 1; page <= options.maxPages; page += 1) {
      const response = await client().listProperties({
        page,
        limit: options.limit,
        order: options.order,
        status: options.status,
      });
      const items = readListPayload(response);
      pagesRead += 1;

      for (const item of items) {
        const id = normalizeId(item?.id);
        if (id === null) {
          warnings.push(`KiteProp property with invalid id ignored on page ${page}.`);
          continue;
        }
        ids.add(id);
      }

      if (items.length < options.limit) break;
      if (isMaxPageCutLikely(response, page, options.maxPages, items.length, options.limit)) {
        stoppedAtMaxPages = true;
        break;
      }
    }

    if (stoppedAtMaxPages) {
      warnings.push('KiteProp scan stopped at maxPages; result may be partial.');
    }

    return { ids, pagesRead, warnings };
  }

  async function readStrapiProperties() {
    const rows = [];
    const select = ['id', 'documentId', 'kiteprop_id'];
    if (hasAttribute(app(), 'kiteprop_status')) select.push('kiteprop_status');
    select.push('publishedAt');

    for (let offset = 0; ; offset += STRAPI_PAGE_SIZE) {
      const page = await app().db.query(PROPIEDAD_UID).findMany({
        where: { kiteprop_id: { $notNull: true } },
        select,
        limit: STRAPI_PAGE_SIZE,
        offset,
        orderBy: { id: 'asc' },
      });
      const items = Array.isArray(page) ? page : [];
      rows.push(...items);
      if (items.length < STRAPI_PAGE_SIZE) break;
    }

    return rows;
  }

  async function summary(options = {}) {
    const normalizedOptions = {
      status: options.status || 'active',
      limit: normalizeKitePropLimit(options.limit),
      maxPages: toPositiveInt(options.maxPages, DEFAULT_MAX_PAGES, { max: 1000 }),
      includeIds: options.includeIds !== false,
      includeSamples: options.includeSamples !== false,
      sampleSize: toPositiveInt(options.sampleSize, DEFAULT_SAMPLE_SIZE, { max: 1000 }),
      order: options.order || 'id:desc',
    };

    const warnings = [];

    let kitepropResult;
    try {
      kitepropResult = await readKitePropIds(normalizedOptions);
      warnings.push(...kitepropResult.warnings);
    } catch (err) {
      err.source = 'kiteprop';
      throw err;
    }

    let strapiRows;
    try {
      strapiRows = await readStrapiProperties();
    } catch (err) {
      err.source = 'strapi';
      throw err;
    }

    const kitepropIds = sortedNumbers(kitepropResult.ids);
    const strapiIdMap = new Map();
    const strapiAllIds = [];
    const duplicateDetails = [];
    const statusSummary = {};

    for (const row of strapiRows) {
      const id = normalizeId(row?.kiteprop_id);
      if (id === null) {
        warnings.push(`Strapi Propiedad with invalid kiteprop_id ignored: ${row?.documentId || row?.id || 'unknown'}.`);
        continue;
      }

      if (!strapiIdMap.has(id)) strapiIdMap.set(id, new Map());
      const documentsForId = strapiIdMap.get(id);
      const key = documentKey(row);
      if (!documentsForId.has(key)) {
        documentsForId.set(key, row);
        strapiAllIds.push(id);

        if (Object.prototype.hasOwnProperty.call(row, 'kiteprop_status')) {
          const status = row.kiteprop_status || '(empty)';
          statusSummary[status] = (statusSummary[status] || 0) + 1;
        }
      }
    }

    for (const [kitepropId, documentMap] of strapiIdMap.entries()) {
      const rows = Array.from(documentMap.values());
      if (rows.length > 1) {
        duplicateDetails.push({
          kiteprop_id: kitepropId,
          count: rows.length,
          documentIds: rows.map((row) => row.documentId || String(row.id)).filter(Boolean),
        });
      }
    }

    duplicateDetails.sort((a, b) => a.kiteprop_id - b.kiteprop_id);

    const strapiUniqueIds = sortedNumbers(strapiIdMap.keys());
    const kitepropSet = new Set(kitepropIds);
    const strapiSet = new Set(strapiUniqueIds);
    const missingIds = kitepropIds.filter((id) => !strapiSet.has(id));
    const extraIds = strapiUniqueIds.filter((id) => !kitepropSet.has(id));

    if (extraIds.length > 0) {
      warnings.push(
        'Strapi contains kiteprop_id values absent from the scanned KiteProp set; they may be inactive, deleted, or outside the selected filter.'
      );
    }

    const duplicateIds = duplicateDetails.map((item) => item.kiteprop_id);
    const readErrors = 0;

    return {
      ok: true,
      read_only: true,
      filters: {
        kiteprop_status: normalizedOptions.status,
        limit: normalizedOptions.limit,
        maxPages: normalizedOptions.maxPages,
        order: normalizedOptions.order,
      },
      kiteprop: {
        count: kitepropIds.length,
        pages_read: kitepropResult.pagesRead,
        ids_sample: normalizedOptions.includeSamples ? sampleIds(kitepropIds, normalizedOptions.sampleSize) : [],
        min_id: minOrNull(kitepropIds),
        max_id: maxOrNull(kitepropIds),
      },
      strapi: {
        count: strapiAllIds.length,
        unique_count: strapiUniqueIds.length,
        duplicate_count: duplicateIds.length,
        ids_sample: normalizedOptions.includeSamples ? sampleIds(strapiUniqueIds, normalizedOptions.sampleSize) : [],
        min_id: minOrNull(strapiUniqueIds),
        max_id: maxOrNull(strapiUniqueIds),
        status_summary: statusSummary,
      },
      diff: {
        missing_in_strapi_count: missingIds.length,
        missing_in_strapi_ids: normalizedOptions.includeIds ? missingIds : [],
        extra_in_strapi_count: extraIds.length,
        extra_in_strapi_ids: normalizedOptions.includeIds ? extraIds : [],
        duplicate_kiteprop_ids: normalizedOptions.includeIds ? duplicateIds : [],
        duplicate_details: normalizedOptions.includeIds ? duplicateDetails : [],
      },
      health: buildHealth({
        missingCount: missingIds.length,
        duplicateCount: duplicateIds.length,
        readErrors,
      }),
      warnings,
    };
  }

  return {
    summary,
    _internal: {
      normalizeId,
      toPositiveInt,
      normalizeKitePropLimit,
      readKitePropIds,
      readStrapiProperties,
    },
  };
};

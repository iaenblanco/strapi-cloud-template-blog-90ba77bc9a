# KiteProp Sync Audit

## Plan tecnico

- Mantener solo endpoints KiteProp ya documentados y usados: `/profile`, `/properties`, `/properties/{id}` y `/properties/activities`.
- Procesar una propiedad completa por vez, con `run-next` como endpoint operativo recomendado.
- Identificar propiedades por `kiteprop_id` y evitar duplicados con busqueda previa mas el `unique` existente.
- Calcular `kiteprop_data_hash` sobre datos mapeados no volatiles y `kiteprop_images_hash` sobre imagenes normalizadas.
- Crear `api::kiteprop-image.kiteprop-image` para mapear imagen remota a archivo de Media Library por `image_key` estable.
- Limitar imagenes por propiedad con `KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY`, default `12`.
- Saltar descarga/subida completa cuando `images_hash` no cambia.
- Si cambia el orden de imagenes, reutilizar archivos existentes y actualizar solo la relacion ordenada.
- No borrar archivos antiguos de Media Library; esta fase solo desasocia al reemplazar la relacion `Imagenes`.
- Mantener cursores y locks existentes; no avanzar cursor de actividad ni sniffer ante errores criticos.

## Evidencia local revisada

- Documentacion KiteProp: `docs/KiteProp_API_documentation.md`.
- Servicios: `client.js`, `properties-sync.js`, `mappers.js`, `state.js`, `logger.js`.
- Endpoints Strapi: controller y routes de `kiteprop-sync`.
- Content-types: `Propiedad`, `KiteProp Sync Log`, `KiteProp Sync State`.
- Workflow: `.github/workflows/kiteprop-sync.yml`.
- Commits revisados: `573e453`, `65733e5`, `2a42528`.

## Endpoints KiteProp usados

- `GET /profile`: health check de credenciales.
- `GET /properties/activities`: delta por actividades. Tipos relevantes documentados: `status_changed`, `price_update`, `user_assignment`, `data_changed`, `category_changed`, `delete_property`.
- `GET /properties`: sniffer de propiedades nuevas con `order=id:desc`.
- `GET /properties/{id}`: payload completo de una propiedad.

No se agregaron endpoints KiteProp nuevos. La documentacion incluye endpoints de escritura y manejo de imagenes en KiteProp, pero esta integracion solo lee desde KiteProp y escribe en Strapi.

## Riesgos encontrados

- La version anterior decidia idempotencia por `updated_at` y por diferencia de conteo de imagenes, lo que no detectaba bien cambios de orden y podia reintentar imagenes innecesariamente.
- El commit `2a42528` elimino `KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY`, permitiendo importar todas las imagenes y elevando riesgo de tiempo, memoria y storage.
- La identidad de imagen dependia de nombre de archivo en Upload; no habia mapping tecnico por propiedad + imagen remota.
- Sin mapping auxiliar, dos propiedades podian compartir nombres ambiguos si el fallback no incluia claramente la propiedad.
- GitHub Actions invocaba delta y sniffer en la misma corrida, dejando el trabajo pesado dentro de Strapi y duplicando llamadas al backend.

## Cambios implementados

- Nuevo helper `hash.js`:
  - `stableStringify(obj)` ordena claves.
  - `sha256(value)` y `sha1(value)`.
  - `normalizeUrl(url)` hace normalizacion conservadora.
  - `buildPropertyDataHash(mappedPayload)`.
  - `buildPropertyImagesHash(normalizedImages)`.
- Nuevo helper `images.js`:
  - `image_key = kiteprop_property_id + remote_image_id`.
  - Fallback: `kiteprop_property_id + sha1(url_normalizada)`.
  - El indice solo se usa como `order`.
- Nuevo content-type `api::kiteprop-image.kiteprop-image`:
  - `kiteprop_property_id`, `image_key`, `remote_image_id`, `remote_url`, `remote_url_hash`, `order`, `file`, `last_seen_at`, `status`, `last_error`.
  - `image_key` es unico globalmente porque incluye el id de propiedad. Strapi no ofrece unicidad compuesta simple por schema JSON, por eso tambien se busca antes de crear.
- Nuevos campos tecnicos en `Propiedad`:
  - `kiteprop_data_hash`
  - `kiteprop_images_hash`
  - `kiteprop_last_synced_at`
  - `kiteprop_last_images_synced_at`
  - `kiteprop_sync_status`
  - `kiteprop_sync_error`
- `properties-sync.js` ahora:
  - Calcula hashes antes de escribir.
  - No sube imagenes si `images_hash` no cambio.
  - Reutiliza mapping existente por `image_key`.
  - Adopta archivos legados con nombre `kiteprop-{propertyId}-{remoteImageId}` o fallback de hash corto cuando existen.
  - Actualiza `Imagenes` con la lista final exacta y ordenada.
  - No persiste `kiteprop_images_hash` si una imagen falla.
  - Mantiene retry seguro sin duplicar propiedad ni mapping.
- Nuevo endpoint:
  - `POST /api/kiteprop-sync/properties/run-next`
- GitHub Actions:
  - Ejecuta solo `run-next` con `maxPages=1` y `maxItems=1`.
  - Mantiene `concurrency.cancel-in-progress=false`.

## Operacion manual

Sincronizar una propiedad especifica:

```bash
curl --fail --show-error --silent \
  --request POST \
  --header "Authorization: Bearer $STRAPI_SYNC_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"dryRun":false}' \
  "$STRAPI_SYNC_URL/api/kiteprop-sync/properties/12345"
```

Ejecutar dry-run:

```bash
curl --fail --show-error --silent \
  --request POST \
  --header "Authorization: Bearer $STRAPI_SYNC_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"dryRun":true,"maxPages":1,"maxItems":1}' \
  "$STRAPI_SYNC_URL/api/kiteprop-sync/properties/run-next"
```

Revisar logs:

- En Strapi Admin abrir `KiteProp Sync Log`.
- Filtrar por `run_id`, `kiteprop_id`, `status=error` o `step=images/hash/fetch/delta/sniffer`.
- Revisar `error_details` sin exponer secretos.

Pausar importacion de imagenes:

```env
KITEPROP_SYNC_IMPORT_IMAGES=false
```

Limitar imagenes por propiedad:

```env
KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY=12
```

## Variables env recomendadas en Strapi Cloud

```env
KITEPROP_SYNC_IMPORT_IMAGES=true
KITEPROP_SYNC_MAX_IMAGES_PER_PROPERTY=12
KITEPROP_SYNC_IMAGE_TIMEOUT_MS=20000
KITEPROP_SYNC_IMAGE_MAX_BYTES=15728640
KITEPROP_SYNC_MAX_ITEMS_PER_RUN=1
KITEPROP_SYNC_DELTA_MAX_PAGES=1
KITEPROP_SYNC_SNIFFER_MAX_PAGES=1
KITEPROP_SYNC_LOCK_TIMEOUT_MS=600000
```

## Limites Strapi Cloud considerados

Los limites dependen del plan. A mayo de 2026, las paginas oficiales de Strapi indican cuotas de API requests, asset storage, asset bandwidth y database entries por plan, y limites tecnicos de asset size. Por eso esta implementacion reduce trabajo por corrida, evita re-subidas cuando los hashes no cambian y conserva `maxItems=1`.

El content-type `KiteProp Image` agrega una database entry tecnica por imagen remota importada. Con el limite recomendado de 12 imagenes por propiedad, el impacto estimado maximo es:

| Propiedades | KiteProp Image entries | Propiedad entries | Total incremental aproximado |
| --- | ---: | ---: | ---: |
| 100 | 1.200 | 100 | 1.300 |
| 300 | 3.600 | 300 | 3.900 |
| 500 | 6.000 | 500 | 6.500 |

Este total no cuenta entries ya existentes de `plugin::upload.file`, que Strapi tambien guarda por archivo subido, ni otros content-types del sitio. En la practica, si algunas propiedades tienen menos de 12 imagenes, el numero baja.

Referencias:

- https://strapi.io/pricing-cloud
- https://strapi.io/cloud-legal
- https://support.strapi.io/articles/4986923984-are-there-any-asset-upload-limits-on-strapi-cloud

## Validaciones

- `npm test`
- `npm run build`

## Pendientes conscientes

- No se implementa borrado fisico de archivos antiguos.
- No se implementa soft delete por 404; sigue reservado a `activity.type === delete_property`.
- No se inventa endpoint KiteProp para obtener "siguiente pendiente"; `run-next` usa delta y luego sniffer con los endpoints documentados.

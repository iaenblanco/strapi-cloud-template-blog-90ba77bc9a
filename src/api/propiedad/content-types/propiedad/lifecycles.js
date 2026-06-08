'use strict';

/**
 * lifecycles.js — content type `propiedad`.
 *
 * POR QUÉ EXISTE:
 *   Si alguien crea, edita, publica, despublica o elimina una propiedad
 *   MANUALMENTE desde Strapi, el sitio estático de Cloudflare quedó desfasado y
 *   hay que reconstruirlo. Marcamos "deploy pendiente" para que el coordinador
 *   central (api::kiteprop-sync.frontend-deploy) gatille UN solo deploy
 *   respetando el mismo anti-spam/debounce que el sync de KiteProp.
 *
 * ANTI-LOOP (clave):
 *   El sync de KiteProp también escribe propiedades vía documents().update(),
 *   lo que dispararía estos lifecycles. Si dejáramos que marquen/deployen aquí,
 *   tendríamos deploys duplicados por cada propiedad. Por eso, mientras el sync
 *   está escribiendo (isSyncWriteInProgress === true) los lifecycles NO hacen
 *   nada: el deploy lo decide el final de runAll, agrupado.
 *
 * NO BLOQUEANTE:
 *   No esperamos (await) la decisión del coordinador para no añadir latencia al
 *   guardado en el admin. El POST al hook tiene su propio timeout y debounce.
 */

function notifyManualChange(action) {
  try {
    const deploy = strapi.service('api::kiteprop-sync.frontend-deploy');
    if (!deploy) return;

    // Anti-loop: si el cambio proviene del sync de KiteProp, no marcamos nada.
    if (deploy.isSyncWriteInProgress && deploy.isSyncWriteInProgress()) {
      return;
    }

    strapi.log.info(`[frontend-deploy] cambio manual en propiedad detectado: ${action}`);
    // Fire-and-forget: marca pendiente + procesa (con debounce) sin bloquear el request.
    deploy
      .notifyManualChange({
        reason: `manual ${action} propiedad`,
        source: `lifecycle:${action}`,
      })
      .catch((err) => {
        strapi.log.error(`[frontend-deploy] error procesando cambio manual (${action}): ${err.message}`);
      });
  } catch (err) {
    strapi.log.error(`[frontend-deploy] lifecycle ${action} falló: ${err.message}`);
  }
}

module.exports = {
  afterCreate() {
    notifyManualChange('create');
  },
  afterUpdate() {
    // afterUpdate cubre edición y publish/unpublish (cambia publishedAt).
    notifyManualChange('update');
  },
  afterDelete() {
    notifyManualChange('delete');
  },
};

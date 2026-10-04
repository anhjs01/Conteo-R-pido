import { CONFIG } from "./config.js";
import { getAll, getByKey, put, del } from "./db.js";
import { activeLot } from "./lots.js";

/*
  ============================================================
  NUMERACIÓN ACTUAL DEL INVENTARIO
  ============================================================

  "sequence" representa la posición actual de la unidad dentro
  del lote.

  Ejemplo:

  1
  2
  3
  4
  5

  Si se elimina la 3:

  1
  2
  3
  4

  Y la siguiente unidad nueva será la 5.

  El ID de la diadema (unitId) es independiente de esta
  numeración y NO se reutiliza.
*/

/**
 * Devuelve las unidades del lote activo ordenadas por su número.
 */
export async function unitsForActiveLot() {
  const lot = await activeLot();

  if (!lot) return [];

  const units = (await getAll(CONFIG.store))
    .filter(unit => unit.lotId === lot.id);

  return units.sort(compareUnits);
}

/**
 * Orden estable para poder reconstruir la numeración.
 */
function compareUnits(a, b) {
  const sequenceA = Number(a?.sequence || 0);
  const sequenceB = Number(b?.sequence || 0);

  if (sequenceA !== sequenceB) {
    return sequenceA - sequenceB;
  }

  const createdA = String(a?.createdAt || "");
  const createdB = String(b?.createdAt || "");

  if (createdA !== createdB) {
    return createdA.localeCompare(createdB);
  }

  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

/**
 * Reorganiza la numeración de un lote para que siempre sea:
 *
 * 1, 2, 3, 4, 5...
 *
 * sin huecos.
 *
 * IMPORTANTE:
 * Esto NO modifica el unitId de las diademas.
 * Solamente modifica "sequence", que es el número visible
 * de orden dentro del inventario.
 */
async function normalizeLotSequences(lotId) {
  if (!lotId) return [];

  const units = (await getAll(CONFIG.store))
    .filter(unit => unit.lotId === lotId)
    .sort(compareUnits);

  let sequence = 1;
  const normalized = [];

  for (const unit of units) {
    if (unit.sequence !== sequence) {
      unit.sequence = sequence;
      unit.updatedAt = new Date().toISOString();

      await put(CONFIG.store, unit);
    }

    normalized.push(unit);
    sequence++;
  }

  return normalized;
}

/**
 * Estadísticas del inventario.
 */
export function stats(units) {
  return {
    total: units.length,

    reparable: units.filter(
      unit =>
        unit.diagnosis === "Reparable" ||
        unit.diagnosis === "Reparado"
    ).length,

    nonrepairable: units.filter(
      unit => unit.diagnosis === "No reparable"
    ).length,

    ready: units.filter(
      unit => unit.packaging === "Listo para empacar"
    ).length,

    packed: units.filter(
      unit => unit.packaging === "Empacado"
    ).length
  };
}

/**
 * Genera un unitId que todavía no haya sido utilizado.
 *
 * El unitId NO depende del número visible de la tabla.
 *
 * Esto es importante porque podemos volver a utilizar el número
 * 5 en la tabla después de eliminar la unidad 5, pero NO debemos
 * reutilizar el ID real que tenía esa diadema.
 */
async function generateUnusedUnitId(usedIds) {
  let number = 1;

  while (true) {
    const candidate = `J${String(number).padStart(3, "0")}`;

    if (!usedIds.includes(candidate)) {
      return candidate;
    }

    number++;
  }
}

/**
 * Guarda una unidad nueva o modifica una existente.
 */
export async function saveUnit(data, oldId) {
  const lot = await activeLot();

  if (!lot) {
    throw new Error("No hay lote activo.");
  }

  const old = oldId
    ? await getByKey(CONFIG.store, oldId)
    : null;

  /*
    Si es una unidad existente, conserva su número actual.

    Si es una unidad nueva, primero normalizamos el lote y
    obtenemos el siguiente número disponible.
  */
  let sequence;

  if (old) {
    sequence = Number(old.sequence || 1);
  } else {
    const currentUnits = await normalizeLotSequences(lot.id);
    sequence = currentUnits.length + 1;
  }

  /*
    Historial de IDs utilizados.
    Los IDs reales NO se reutilizan aunque la numeración visible
    sí pueda reutilizarse.
  */
  const history = await getByKey(CONFIG.meta, "usedIds");

  const usedIds = Array.isArray(history?.value)
    ? [...history.value]
    : [];

  let unitId = (data.unitId || "").trim();

  /*
    Unidad nueva sin ID:
    generamos uno que nunca haya sido utilizado.
  */
  if (!unitId) {
    unitId = await generateUnusedUnitId(usedIds);
  }

  /*
    Si es una unidad nueva, no permitimos reutilizar un ID anterior.
  */
  if (!old && usedIds.includes(unitId)) {
    throw new Error(
      "Ese ID ya fue utilizado y no puede reutilizarse."
    );
  }

  /*
    Registramos el ID en el historial.
  */
  if (!usedIds.includes(unitId)) {
    usedIds.push(unitId);

    await put(CONFIG.meta, {
      key: "usedIds",
      value: usedIds
    });
  }

  const unit = {
    ...data,

    unitId,

    /*
      Este es el número visible de la tabla.
    */
    sequence,

    id:
      old?.id ||
      "unit-" + crypto.randomUUID(),

    lotId: lot.id,
    lotDate: lot.date,

    createdAt:
      old?.createdAt ||
      new Date().toISOString(),

    updatedAt:
      new Date().toISOString()
  };

  await put(CONFIG.store, unit);

  /*
    Por seguridad, volvemos a normalizar el lote después de
    guardar una unidad nueva.
  */
  await normalizeLotSequences(lot.id);

  /*
    Recuperamos la unidad ya normalizada para devolverla con
    su número correcto.
  */
  const saved = await getByKey(CONFIG.store, unit.id);

  return saved || unit;
}

/**
 * Elimina una unidad.
 *
 * El ID queda reservado para impedir que vuelva a utilizarse,
 * pero la numeración visible del inventario se reorganiza.
 */
export async function removeUnit(id) {
  const unit = await getByKey(CONFIG.store, id);

  if (!unit) return;

  /*
    Guardamos el ID como eliminado.
    Esto NO afecta la numeración.
  */
  const history = await getByKey(
    CONFIG.meta,
    "deletedIds"
  );

  const deletedIds = Array.isArray(history?.value)
    ? [...history.value]
    : [];

  if (
    unit.unitId &&
    !deletedIds.includes(unit.unitId)
  ) {
    deletedIds.push(unit.unitId);

    await put(CONFIG.meta, {
      key: "deletedIds",
      value: deletedIds
    });
  }

  /*
    Eliminamos físicamente la unidad.
  */
  await del(CONFIG.store, id);

  /*
    Después de eliminar, reconstruimos la numeración del lote.
  */
  await normalizeLotSequences(unit.lotId);
}
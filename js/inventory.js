import { CONFIG } from "./config.js";
import { getAll, getByKey, put, del } from "./db.js";
import { activeLot } from "./lots.js";

/*
  ============================================================
  NUMERACIÓN DEL INVENTARIO
  ============================================================

  "sequence" es únicamente el número visible de la unidad
  dentro del lote.

  El "unitId" es el ID real de la diadema y NO se modifica
  ni se reutiliza desde este módulo.
*/

/**
 * Orden estable de las unidades.
 *
 * Primero usamos el sequence existente.
 * Si hay números repetidos, usamos fecha de creación y luego
 * el id interno para mantener un orden determinista.
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
 * Normaliza la numeración de un lote.
 *
 * Si encuentra:
 *
 * 1
 * 2
 * 3
 * 4
 * 8
 *
 * lo convierte en:
 *
 * 1
 * 2
 * 3
 * 4
 * 5
 *
 * IMPORTANTE:
 * Solamente modifica "sequence".
 *
 * NO modifica:
 * - unitId
 * - ticket
 * - fabricante
 * - diagnóstico
 * - reparaciones
 * - observaciones
 * - empaque
 * - lote
 */
export async function normalizeLotSequences(lotId) {
  if (!lotId) return [];

  const units = (await getAll(CONFIG.store))
    .filter(unit => unit.lotId === lotId)
    .sort(compareUnits);

  let sequence = 1;
  let changed = false;

  for (const unit of units) {
    if (Number(unit.sequence) !== sequence) {
      unit.sequence = sequence;
      unit.updatedAt = new Date().toISOString();

      await put(CONFIG.store, unit);

      changed = true;
    }

    sequence++;
  }

  return {
    units,
    changed
  };
}

/**
 * Devuelve las unidades del lote activo.
 *
 * IMPORTANTE:
 * Antes de mostrarlas, comprueba y corrige automáticamente
 * cualquier salto de numeración.
 */
export async function unitsForActiveLot() {
  const lot = await activeLot();

  if (!lot) return [];

  const result = await normalizeLotSequences(lot.id);

  return result.units.sort(compareUnits);
}

/**
 * Permite cambiar manualmente la posición de una unidad.
 *
 * Ejemplo:
 *
 * Antes:
 * 1
 * 2
 * 3
 * 4
 * 5
 *
 * Si la unidad 5 se mueve a la posición 2:
 *
 * 1
 * 5
 * 2
 * 3
 * 4
 *
 * Los IDs reales permanecen exactamente iguales.
 *
 * Al terminar siempre queda:
 *
 * 1
 * 2
 * 3
 * 4
 * 5
 */
export async function setUnitSequence(unitId, requestedSequence) {
  const unit = await getByKey(CONFIG.store, unitId);

  if (!unit) {
    throw new Error("No se encontró la unidad.");
  }

  const lotId = unit.lotId;

  const units = (await getAll(CONFIG.store))
    .filter(x => x.lotId === lotId)
    .sort(compareUnits);

  if (!units.length) {
    throw new Error("No hay unidades en este lote.");
  }

  let target = Number(requestedSequence);

  if (!Number.isFinite(target)) {
    throw new Error("El número de casilla no es válido.");
  }

  target = Math.round(target);

  /*
    Limitamos el número al tamaño real del inventario.
  */
  target = Math.max(1, Math.min(target, units.length));

  /*
    Primero normalizamos la lista actual en memoria.
    Esto evita trabajar con huecos o números duplicados.
  */
  const normalized = units.map((x, index) => ({
    ...x,
    sequence: index + 1
  }));

  const currentIndex =
    normalized.findIndex(x => x.id === unitId);

  if (currentIndex === -1) {
    throw new Error("No se encontró la unidad dentro del lote.");
  }

  const [movingUnit] =
    normalized.splice(currentIndex, 1);

  /*
    target es 1-based.
    Array.splice utiliza posición 0-based.
  */
  normalized.splice(target - 1, 0, movingUnit);

  /*
    Reasignamos solamente sequence.
  */
  for (let i = 0; i < normalized.length; i++) {
    const x = normalized[i];

    x.sequence = i + 1;
    x.updatedAt = new Date().toISOString();

    await put(CONFIG.store, x);
  }

  return normalized.find(x => x.id === unitId);
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
 * ESTE BLOQUE SE CONSERVA.
 * No cambia la lógica actual de IDs.
 */
async function generateUnusedUnitId(usedIds) {
  let number = 1;

  while (true) {
    const candidate =
      `J${String(number).padStart(3, "0")}`;

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

  let sequence;

  if (old) {
    sequence = Number(old.sequence || 1);
  } else {
    /*
      Antes de agregar una unidad nueva,
      corregimos cualquier hueco existente.
    */
    const normalized =
      await normalizeLotSequences(lot.id);

    sequence = normalized.units.length + 1;
  }

  /*
    ==========================================================
    HISTORIAL DE IDS
    ==========================================================

    NO MODIFICAMOS ESTA LÓGICA.
    ==========================================================
  */

  const history =
    await getByKey(CONFIG.meta, "usedIds");

  const usedIds =
    Array.isArray(history?.value)
      ? [...history.value]
      : [];

  let unitId =
    (data.unitId || "").trim();

  if (!unitId) {
    unitId =
      await generateUnusedUnitId(usedIds);
  }

  if (
    !old &&
    usedIds.includes(unitId)
  ) {
    throw new Error(
      "Ese ID ya fue utilizado y no puede reutilizarse."
    );
  }

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
    Corregimos nuevamente después de guardar.
  */
  await normalizeLotSequences(lot.id);

  const saved =
    await getByKey(
      CONFIG.store,
      unit.id
    );

  return saved || unit;
}

/**
 * Elimina una unidad.
 *
 * Se conserva la lógica actual.
 * El ID continúa quedando reservado.
 */
export async function removeUnit(id) {
  const unit =
    await getByKey(
      CONFIG.store,
      id
    );

  if (!unit) return;

  const history =
    await getByKey(
      CONFIG.meta,
      "deletedIds"
    );

  const deletedIds =
    Array.isArray(history?.value)
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

  await del(
    CONFIG.store,
    id
  );

  await normalizeLotSequences(
    unit.lotId
  );
}
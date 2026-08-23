// src/utils/sincronizarNombresOperaciones.ts
//
// ✅ NUEVO (V00114) — SINCRONIZACIÓN DE NOMBRES COMPARTIDA.
//   Las operaciones guardan COPIAS de nombres (tipoOperacionNombre,
//   statusNombre, clienteNombre, origenNombre…) para pintar tablas y PDFs sin
//   leer catálogos. Al renombrar en Catálogos o en Empresas, esas copias
//   quedan viejas en los registros ya creados. Esta utilidad re-resuelve un
//   lote de operaciones contra los catálogos ACTUALES y reescribe SOLO los
//   nombres que difieren.
//
//   ⚠ REGLA DE ORO: SOLO NOMBRES. Esta utilidad NUNCA toca montos, tarifas,
//   monedas, tipos de cambio ni ningún valor numérico o financiero guardado.
//   Los campos permitidos están listados explícitamente abajo; nada más se
//   escribe.
//
//   La usan: Operaciones Activas, Servicios Completados y Servicios
//   Cancelados (botón "Sincronizar nombres" en cada toolbar).

import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../config/firebase';
import { registrarLog } from './logger';

// Campos de operación que apuntan a EMPRESAS por id → su campo de nombre.
const PARES_EMPRESA: Array<[string, string]> = [
  ['cliente', 'clienteNombre'],
  ['origen', 'origenNombre'],
  ['destino', 'destinoNombre'],
  ['clienteMercancia', 'clienteMercanciaNombre'],
  ['proveedorUnidad', 'proveedorUnidadNombre'],
  ['provServicios', 'provServiciosNombre'],
];

export interface ResultadoSincronizacion {
  /** Cambios aplicados por id de operación (para refrescar el estado local). */
  cambiosPorId: Record<string, Record<string, string>>;
  /** Cuántas operaciones se corrigieron. */
  corregidos: number;
}

/**
 * Sincroniza los nombres de las operaciones recibidas contra los catálogos
 * actuales. Escribe en Firestore solo los campos de NOMBRE que difieren y
 * devuelve los cambios para que el módulo actualice su estado en pantalla.
 *
 * @param operaciones  Operaciones cargadas en el módulo (con id).
 * @param origenLog    Nombre del módulo para el historial de actividad.
 */
export async function sincronizarNombresOperaciones(
  operaciones: Array<Record<string, unknown> & { id: string }>,
  origenLog: string
): Promise<ResultadoSincronizacion> {
  // Catálogos actuales (lectura directa; colecciones pequeñas salvo empresas)
  const [snapTipoOp, snapStatus, snapEmp, snapCV] = await Promise.all([
    getDocs(collection(db, 'catalogo_tipo_operacion')),
    getDocs(collection(db, 'catalogo_status_servicio')),
    getDocs(collection(db, 'empresas')),
    getDocs(collection(db, 'catalogo_carga_vacia')),
  ]);
  const mapTipoOp: Record<string, string> = {};
  snapTipoOp.docs.forEach((d) => { mapTipoOp[d.id] = String((d.data() as { tipo_operacion?: unknown }).tipo_operacion || ''); });
  const mapStatus: Record<string, string> = {};
  snapStatus.docs.forEach((d) => { mapStatus[d.id] = String((d.data() as { nombre?: unknown }).nombre || ''); });
  const mapEmp: Record<string, string> = {};
  snapEmp.docs.forEach((d) => { mapEmp[d.id] = String((d.data() as { nombre?: unknown }).nombre || ''); });
  const nombresCV = snapCV.docs
    .map((d) => String((d.data() as { nombre?: unknown }).nombre || ''))
    .filter(Boolean);

  // "Carga" se guarda como TEXTO (sin id): los valores que ya no existen en el
  // catálogo C/V se remapean preguntando UNA vez por cada valor distinto.
  const remapCarga: Record<string, string> = {};
  if (nombresCV.length > 0) {
    const huerfanos = Array.from(new Set(
      operaciones.map((o) => String(o.carga || '').trim()).filter((v) => v && !nombresCV.includes(v))
    ));
    for (const viejo of huerfanos) {
      const nuevo = window.prompt(
        `El valor de Carga "${viejo}" ya no existe en el catálogo C/V.\n\n` +
        `Escribe el valor NUEVO por el que se reemplazará.\n` +
        `Opciones del catálogo: ${nombresCV.join(', ')}\n\n` +
        `Deja vacío o cancela para NO cambiar "${viejo}".`, ''
      );
      const limpio = String(nuevo || '').trim();
      if (limpio && nombresCV.includes(limpio)) remapCarga[viejo] = limpio;
      else if (limpio) alert(`"${limpio}" no está en el catálogo C/V; el valor "${viejo}" se dejará sin cambios.`);
    }
  }

  // Cálculo de diferencias — SOLO campos de nombre listados aquí.
  const cambiosPorId: Record<string, Record<string, string>> = {};
  operaciones.forEach((op) => {
    const cambios: Record<string, string> = {};
    const nomTipo = mapTipoOp[String(op.tipoOperacion || '')] || mapTipoOp[String(op.tipoOperacionId || '')];
    if (nomTipo && nomTipo !== String(op.tipoOperacionNombre || '')) cambios.tipoOperacionNombre = nomTipo;
    const nomStatus = mapStatus[String(op.status || '')];
    if (nomStatus && nomStatus !== String(op.statusNombre || '')) cambios.statusNombre = nomStatus;
    PARES_EMPRESA.forEach(([campoId, campoNombre]) => {
      const n = mapEmp[String(op[campoId] || '')];
      if (n && n !== String(op[campoNombre] || '')) cambios[campoNombre] = n;
    });
    const cargaActual = String(op.carga || '').trim();
    if (cargaActual && remapCarga[cargaActual]) cambios.carga = remapCarga[cargaActual];
    if (Object.keys(cambios).length > 0) cambiosPorId[String(op.id)] = cambios;
  });

  // Escritura en lotes de 400
  const ids = Object.keys(cambiosPorId);
  for (let i = 0; i < ids.length; i += 400) {
    const lote = ids.slice(i, i + 400);
    const batch = writeBatch(db);
    lote.forEach((id) => batch.update(doc(db, 'operaciones', id), cambiosPorId[id]));
    await batch.commit();
  }

  if (ids.length > 0) {
    try {
      await registrarLog(origenLog, 'Edición', `Sincronizó nombres en ${ids.length} operación(es) contra los catálogos actuales.`);
    } catch { /* el log nunca debe romper la sincronización */ }
  }
  return { cambiosPorId, corregidos: ids.length };
}

// src/features/operaciones/config/statusRules.ts
import { doc, getDoc } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';

// ✅ V00407: un id de documento de Firestore NO puede llevar "/" (p. ej. el servicio
//   "Rentas (Patio / Equipo)" rompía al guardar). Se cambia por "／" (barra ancha),
//   igual al guardar y al leer; es idempotente.
// ✅ V00441 (Fase 5.7): la elección del flujo vive en src/shared/dominio/flujos.ts
//   (la usa también el servidor para cobrar el puente); aquí solo se lee el catálogo.
export { idDocFlujo } from '../../../shared/dominio/flujos';
import { buscarFlujo, descuentaPuenteSegunFlujo, idDocFlujo, normalizarNombreFlujo, reglaPuenteDelPaso } from '../../../shared/dominio/flujos';
import type { ReglaPuenteFlujo } from '../../../shared/dominio/cobroPuente';
import { db } from '../../../config/firebase';
import { idReal, obtenerCatalogo } from '../../../shared/data/catalogos';
import type { DocCatalogo } from '../../../shared/data/catalogos';

// ✅ V00439 (Fase 3.x): los flujos salen del listener compartido de catálogos
//   (config_flujos_operacion, siempre en vivo). Sin caché propia en memoria ni
//   en localStorage (flujo_v1__) ni TTL de 6 h: un cambio en Reglas de Estatus
//   llega al instante a todos los usuarios.

/** Ya no hay caché que limpiar; se conserva por compatibilidad con quien la llama. */
export const limpiarCacheFlujos = (configId?: string): void => { void configId; };

// ✅ FIX: Función de normalización para comparar nombres de status
// de forma TOLERANTE (ignora acentos, espacios extra, mayúsculas).
// Esto evita que un status como "5. En Tránsito (a Origen)" no matchee
// con "5. En Transito (a Origen) " si hay alguna pequeña diferencia.
const normalizarNombre = (str: string): string => normalizarNombreFlujo(str);

// ✅ FIX: Buscador de nodo por nombre TOLERANTE.
// Primero intenta match exacto (rápido), si falla intenta match normalizado.
const buscarNodoPorNombre = (reglas: any[], nombre: string): any | null => {
  if (!nombre) return null;
  // Intento 1: match exacto
  let nodo = reglas.find(r => r.nombreStatus === nombre);
  if (nodo) return nodo;
  // Intento 2: match normalizado (tolerante a acentos/espacios/casing)
  const nombreNorm = normalizarNombre(nombre);
  nodo = reglas.find(r => normalizarNombre(r.nombreStatus) === nombreNorm);
  if (nodo) {
    console.log(`[statusRules] Match tolerante: "${nombre}" → "${nodo.nombreStatus}"`);
  }
  return nodo || null;
};

// Misma forma que un DocumentSnapshot (exists/data) para no tocar a quien lo usa.
const docFlujo = (data: DocCatalogo) => ({ exists: () => true, data: () => data });

// Exacto → sin acentos → variantes Cargada/Llena → índice tolerante (V00379/V00405).
const obtenerDocFlujo = async (operacionInfo: any) => {
  const flujos = await obtenerCatalogo('config_flujos_operacion');
  const f = buscarFlujo(operacionInfo, flujos.map((x) => ({ id: idReal(x), datos: x })));
  if (!f) {
    console.warn('[statusRules] ❌ No se encontró flujo para la operación', {
      tipoOperacion: operacionInfo?.tipoOperacionNombre || operacionInfo?.tipoOperacion,
      trafico: operacionInfo?.trafico, carga: operacionInfo?.carga,
    });
    return null;
  }
  return docFlujo(f.datos as DocCatalogo);
};

// =========================================================================
// SALTO AUTOMÁTICO (EVALUADO AL GUARDAR EL FORMULARIO)
// ✅ FIX: usa buscarNodoPorNombre() para ser tolerante a diferencias menores
// =========================================================================
/** Lee el documento de flujo FRESCO de Firestore (sin la caché de 6 h). */
export const leerFlujoFresco = async (configId: string): Promise<DocumentData | null> => {
  const snap = await getDoc(doc(db, 'config_flujos_operacion', idDocFlujo(configId)));
  return snap.exists() ? snap.data() : null;
};

export const calcularStatusDinamico = async (
  configId: string,
  formData: any,
  statusActual?: string,
  opciones: { leerFlujo?: (configId: string) => Promise<DocumentData | null> } = {},
): Promise<string> => {
  if (!configId || configId.includes('N/A') || configId === '__') {
    throw new Error("⛔ Faltan datos para determinar el flujo. Asegúrate de que el Convenio generó correctamente el Servicio, Tráfico y Carga.");
  }

  // ✅ V00438 (Fase 2.6): la vista previa pasa su propio lector (una lectura FRESCA por
  //   formulario abierto, no una por tecla); el guardado lee el documento fresco.
  const datosFlujo = opciones.leerFlujo ? await opciones.leerFlujo(configId) : await leerFlujoFresco(configId);

  if (!datosFlujo || !datosFlujo.flujo || datosFlujo.flujo.length === 0) {
    throw new Error(`⛔ BLOQUEO: No existe un flujo configurado para la combinación:\n"${configId.replace(/_/g, ' ')}"\n\nPor favor, créalo primero en el menú "Reglas de Estatus".`);
  }

  // ✅ V00438 (Fase 2.6): copia, porque abajo se ordena en sitio y el arreglo puede vivir en la caché.
  const reglas = (datosFlujo.flujo as any[]).slice();
  let currentState = statusActual;

  if (!currentState) {
    const primerPaso = reglas.sort((a, b) => a.orden - b.orden)[0];
    currentState = primerPaso.nombreStatus;
  }

  let advanced = true;
  let loopProtection = 0;

  while (advanced && loopProtection < 20) {
    advanced = false;
    loopProtection++;

    // ✅ FIX: búsqueda tolerante
    const reglaActual = buscarNodoPorNombre(reglas, currentState!);
    if (!reglaActual) break;

    const idsSiguientes: string[] = reglaActual.opcionesSiguientes || [];
    if (idsSiguientes.length === 0) break;

    const reglasSiguientesAuto = idsSiguientes
      .map(id => reglas.find(r => r.id === id))
      .filter((r: any) => r && r.tipoMecanismo === 'automatico')
      .sort((a: any, b: any) => a.orden - b.orden);

    for (const reglaSiguiente of reglasSiguientesAuto) {
      const camposRequeridos = reglaSiguiente.camposRequeridos || [];
      if (camposRequeridos.length === 0) {
        currentState = reglaSiguiente.nombreStatus;
        advanced = true;
        break;
      }
      const cumpleTodos = camposRequeridos.every((campo: string) => {
        const valor = formData[campo];
        return valor !== undefined && valor !== null && String(valor).trim() !== '';
      });

      if (cumpleTodos) {
        currentState = reglaSiguiente.nombreStatus;
        advanced = true;
        break;
      }
    }
  }

  return currentState || statusActual || reglas.sort((a, b) => a.orden - b.orden)[0].nombreStatus;
};

// =========================================================================
// ✅ RESOLUCIÓN DE CASCADA AUTOMÁTICA DESPUÉS DE UN BOTÓN
//
// Cuando el operador presiona un botón (manual/decisión), si el destino tiene
// como siguiente paso un nodo AUTOMÁTICO que cumple sus campos requeridos
// (o no tiene ninguno), avanzamos automáticamente y repetimos. Devuelve la
// cadena completa de estados que se atravesaron (para guardar en bitácora).
//
// ✅ FIX: usa buscarNodoPorNombre() para ser tolerante a diferencias menores.
// =========================================================================
export const resolverCascadaStatus = async (
  statusInicial: string,
  operacionInfo: any
): Promise<string[]> => {
  if (!statusInicial) return [];

  try {
    const snap = await obtenerDocFlujo(operacionInfo);
    if (!snap || !snap.exists() || !snap.data().flujo) {
      console.warn('[statusRules] No se pudo cargar el flujo para resolver cascada.');
      return [statusInicial];
    }

    const reglas = snap.data().flujo as any[];
    const cadena: string[] = [statusInicial];
    // ✅ Usamos nombres NORMALIZADOS en visitados para evitar falsos negativos
    const visitados = new Set<string>([normalizarNombre(statusInicial)]);

    let actual = statusInicial;
    let loopProtection = 0;

    while (loopProtection < 20) {
      loopProtection++;

      // ✅ FIX: búsqueda tolerante
      const reglaActual = buscarNodoPorNombre(reglas, actual);
      if (!reglaActual) {
        console.warn(`[statusRules] Cascada: nodo "${actual}" no encontrado en flujo. Detenida.`);
        break;
      }

      const idsSiguientes: string[] = reglaActual.opcionesSiguientes || [];
      if (idsSiguientes.length === 0) {
        console.log(`[statusRules] Cascada: "${actual}" no tiene siguientes. Detenida.`);
        break;
      }

      const candidatosAuto = idsSiguientes
        .map(id => reglas.find(r => r.id === id))
        .filter((r: any) => r && r.tipoMecanismo === 'automatico' && !visitados.has(normalizarNombre(r.nombreStatus)))
        .sort((a: any, b: any) => a.orden - b.orden);

      let avanzo = false;
      for (const candidato of candidatosAuto) {
        const camposRequeridos = candidato.camposRequeridos || [];
        const cumple = camposRequeridos.length === 0 || camposRequeridos.every((campo: string) => {
          const valor = operacionInfo[campo];
          return valor !== undefined && valor !== null && String(valor).trim() !== '';
        });

        if (cumple) {
          actual = candidato.nombreStatus;
          cadena.push(actual);
          visitados.add(normalizarNombre(actual));
          avanzo = true;
          console.log(`[statusRules] Cascada: → "${actual}" (automático)`);
          break;
        } else {
          console.log(`[statusRules] Cascada detenida en "${candidato.nombreStatus}": faltan campos requeridos.`);
        }
      }

      if (!avanzo) break;
    }

    console.log('[statusRules] Cadena de cascada resuelta:', cadena);
    return cadena;
  } catch (e) {
    console.error('[statusRules] Error en cascada:', e);
    return [statusInicial];
  }
};

// =========================================================================
// ✅ OBTENCIÓN DE BOTONES PARA LA OPERACIÓN (MANUAL O DECISIÓN)
// =========================================================================
// CAMBIOS RESPECTO A LA VERSIÓN ANTERIOR:
//
// 1) ✅ FIX (búsqueda tolerante): usa buscarNodoPorNombre() para encontrar
//    el nodo actual aunque haya diferencias menores (acentos, espacios).
//
// 2) ✅ FIX MAYOR (cascada virtual hacia adelante): si el nodo actual es
//    AUTOMÁTICO (la operación quedó parada en un auto sin manuales inmediatos
//    como siguientes), SEGUIMOS recorriendo el flujo "virtualmente" hacia
//    adelante, siempre por nodos automáticos, hasta encontrar un nodo con
//    siguientes manuales/decisión. Esto evita que la operación quede
//    "huérfana" cuando un nodo automático no tiene manual inmediato.
//
//    Ejemplo del caso reportado:
//      [En Tránsito (auto)] → [5.1 Llegada (manual)] → [6. En Origen (auto)]
//      Si la operación quedó en "En Tránsito", la función muestra el botón
//      "5.1 Llegada" (cumple porque es el siguiente directo manual).
//
//    Caso adicional cubierto ahora:
//      [En Tránsito (auto)] → [En Aduana (auto)] → [Llegada (manual)]
//      Si la operación queda en "En Tránsito", AHORA mostramos "Llegada"
//      porque seguimos cruzando automáticos hasta el primer manual.
// =========================================================================
// ✅ V00377: nombres de TODOS los estatus del flujo aplicable a la operación
//   (para que "Registrar Movimiento" solo ofrezca los de la regla), en orden.
export const obtenerNombresStatusDelFlujo = async (operacionInfo: any): Promise<string[] | null> => {
  try {
    const snap = await obtenerDocFlujo(operacionInfo);
    if (!snap || !snap.exists() || !snap.data().flujo) return null;
    const reglas = snap.data().flujo as any[];
    const nombres = reglas.slice().sort((a, b) => (Number(a?.orden) || 0) - (Number(b?.orden) || 0)).map((r) => String(r?.nombreStatus || '')).filter(Boolean);
    return nombres.length > 0 ? nombres : null;
  } catch { return null; }
};

// ✅ V00377: ¿este estatus DESCUENTA el puente según la regla del flujo?
//   true/false cuando el flujo define nodos con descuentaPuente;
//   null cuando no hay flujo o ningún nodo lo define (aplica el fallback).
/**
 * ✅ V00473: la regla 🌉 del flujo para ese estatus (`flag`: true/false si el flujo marca pasos con 🌉, null si no) y el puente
 * elegido en Reglas de Estatus para ese paso (`regla`), con UNA búsqueda del flujo.
 */
export const puenteSegunFlujo = async (operacionInfo: Record<string, unknown>, statusNombre: string): Promise<{ flag: boolean | null; regla: ReglaPuenteFlujo | null }> => {
  try {
    const snap = await obtenerDocFlujo(operacionInfo);
    if (!snap || !snap.exists()) return { flag: null, regla: null };
    const datos = snap.data();
    return { flag: descuentaPuenteSegunFlujo(datos, statusNombre), regla: reglaPuenteDelPaso(datos, statusNombre) };
  } catch { return { flag: null, regla: null }; }
};

export const obtenerBotonesHorarioDinamicos = async (operacionInfo: any): Promise<string[]> => {
  if (!operacionInfo) return [];

  try {
    const snap = await obtenerDocFlujo(operacionInfo);
    if (!snap || !snap.exists() || !snap.data().flujo) {
      console.warn('[statusRules] No se encontró documento de flujo para la operación.');
      return [];
    }

    const reglas = snap.data().flujo as any[];
    const statusActual = operacionInfo.statusNombre || operacionInfo.status || '';

    // -------------------------------------------------------------------
    // Caso A: sin status actual → primeros nodos del flujo (orden = 1)
    // -------------------------------------------------------------------
    if (!statusActual) {
      const opcionesCandidatas = reglas
        .filter(r => (r.tipoMecanismo === 'manual' || r.tipoMecanismo === 'boton_decision') && r.orden === 1)
        .map(r => r.nombreStatus);
      console.log('[statusRules] Sin status actual. Candidatos del paso 1:', opcionesCandidatas);

      return filtrarPorCamposRequeridos(reglas, opcionesCandidatas, operacionInfo);
    }

    // -------------------------------------------------------------------
    // Caso B: con status actual → buscar nodo y seguir cascada virtual
    // -------------------------------------------------------------------
    // ✅ FIX: búsqueda tolerante
    const reglaActual = buscarNodoPorNombre(reglas, statusActual);
    if (!reglaActual) {
      console.warn('[statusRules] ❌ Status actual no encontrado en el flujo:', statusActual);
      console.warn('[statusRules] Status disponibles en el flujo:', reglas.map(r => r.nombreStatus));
      return [];
    }

    // ✅ FIX MAYOR: Recorremos virtualmente la cadena de nodos automáticos
    // hacia adelante, partiendo del nodo actual, hasta encontrar nodos manuales/decisión.
    //
    // Cubre 3 escenarios:
    //   A) Nodo actual es MANUAL/DECISIÓN → exploramos sus opcionesSiguientes
    //      directos buscando manuales/decisión.
    //   B) Nodo actual es AUTOMÁTICO con manual/decisión como siguiente
    //      → los mostramos directamente.
    //   C) Nodo actual es AUTOMÁTICO sin manual/decisión inmediato → seguimos
    //      atravesando automáticos hasta encontrar manuales/decisión.
    const candidatosNombres = new Set<string>();
    const visitados = new Set<string>([normalizarNombre(reglaActual.nombreStatus)]);
    const cola: any[] = [reglaActual];
    let proteccion = 0;

    while (cola.length > 0 && proteccion < 30) {
      proteccion++;
      const nodo = cola.shift()!;
      const idsSiguientes: string[] = nodo.opcionesSiguientes || [];

      for (const idSig of idsSiguientes) {
        const sig = reglas.find(r => r.id === idSig);
        if (!sig) {
          console.warn(`[statusRules] Referencia rota en opcionesSiguientes: "${idSig}" (desde "${nodo.nombreStatus}")`);
          continue;
        }
        const claveNorm = normalizarNombre(sig.nombreStatus);
        if (visitados.has(claveNorm)) continue;
        visitados.add(claveNorm);

        if (sig.tipoMecanismo === 'manual' || sig.tipoMecanismo === 'boton_decision') {
          // Encontramos un nodo decisión/manual → es un candidato a botón
          candidatosNombres.add(sig.nombreStatus);
        } else if (sig.tipoMecanismo === 'automatico') {
          // Atravesar el automático buscando los manuales/decisión que vienen después.
          // Solo lo cruzamos si sus campos requeridos están cumplidos (o no tiene).
          const camposReq = sig.camposRequeridos || [];
          const cumpleAuto = camposReq.length === 0 || camposReq.every((c: string) => {
            const v = operacionInfo[c];
            return v !== undefined && v !== null && String(v).trim() !== '';
          });
          if (cumpleAuto) {
            cola.push(sig);
            console.log(`[statusRules] Cascada virtual: atravesando "${sig.nombreStatus}" (automático)`);
          } else {
            console.log(`[statusRules] Cascada virtual detenida en "${sig.nombreStatus}": faltan campos para atravesar.`);
          }
        }
      }
    }

    const opcionesCandidatas = Array.from(candidatosNombres);
    console.log('[statusRules] Status actual:', statusActual, '→ candidatos siguientes (incluye cascada virtual):', opcionesCandidatas);

    if (opcionesCandidatas.length === 0) {
      // Diagnóstico extra: ¿el nodo actual es automático sin manuales accesibles?
      if (reglaActual.tipoMecanismo === 'automatico') {
        console.warn(
          `[statusRules] ⚠ La operación está parada en un nodo AUTOMÁTICO ("${reglaActual.nombreStatus}") ` +
          `y no se encontró ningún nodo manual/decisión accesible desde aquí. ` +
          `Verifica la configuración del flujo.`
        );
      }
      return [];
    }

    return filtrarPorCamposRequeridos(reglas, opcionesCandidatas, operacionInfo);
  } catch (error) {
    console.error("[statusRules] Error validando los botones dinámicos:", error);
    return [];
  }
};

// ✅ Helper: dado un conjunto de nombres candidatos, filtra los que cumplen
// con sus campos requeridos. Devuelve los nombres en el orden del flujo.
const filtrarPorCamposRequeridos = (reglas: any[], candidatos: string[], operacionInfo: any): string[] => {
  if (candidatos.length === 0) return [];

  const candidatosNorm = new Set(candidatos.map(normalizarNombre));
  const reglasCandidatas = reglas
    .filter(r => (r.tipoMecanismo === 'manual' || r.tipoMecanismo === 'boton_decision')
              && candidatosNorm.has(normalizarNombre(r.nombreStatus)))
    .sort((a, b) => a.orden - b.orden);

  console.log('[statusRules] Reglas candidatas (manual/decisión):', reglasCandidatas.map(r => r.nombreStatus));

  const botonesPermitidos = reglasCandidatas.filter(reglaSiguiente => {
    const camposRequeridos = reglaSiguiente.camposRequeridos || [];
    if (camposRequeridos.length === 0) return true;

    const cumple = camposRequeridos.every((campo: string) => {
      const valor = operacionInfo[campo];
      return valor !== undefined && valor !== null && String(valor).trim() !== '';
    });

    if (!cumple) {
      const faltantes = camposRequeridos.filter((c: string) => {
        const v = operacionInfo[c];
        return v === undefined || v === null || String(v).trim() === '';
      });
      console.log(`[statusRules] Botón "${reglaSiguiente.nombreStatus}" bloqueado. Faltan campos:`, faltantes);
    }

    return cumple;
  }).map(r => r.nombreStatus);

  console.log('[statusRules] ✅ Botones finales permitidos:', botonesPermitidos);
  return botonesPermitidos;
};
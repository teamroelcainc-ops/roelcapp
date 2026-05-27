// src/features/operaciones/config/statusRules.ts
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';

// ✅ CACHÉ DE FLUJOS EN MEMORIA + localStorage (sin cambios)
const flujoCache = new Map<string, { data: any; ts: number }>();
const FLUJO_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas

const lsGetFlujo = (configId: string): { data: any; ts: number } | null => {
  try {
    const raw = localStorage.getItem(`flujo_v1__${configId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch { return null; }
};

const lsSetFlujo = (configId: string, data: any) => {
  try {
    localStorage.setItem(`flujo_v1__${configId}`, JSON.stringify({ data, ts: Date.now() }));
  } catch {}
};

export const limpiarCacheFlujos = (configId?: string) => {
  if (configId) {
    flujoCache.delete(configId);
    try { localStorage.removeItem(`flujo_v1__${configId}`); } catch {}
  } else {
    flujoCache.clear();
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('flujo_v1__'))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
  }
};

const obtenerFlujoConCache = async (configId: string): Promise<any | null> => {
  const enMem = flujoCache.get(configId);
  if (enMem && Date.now() - enMem.ts < FLUJO_TTL_MS) {
    return enMem.data;
  }

  const enLS = lsGetFlujo(configId);
  if (enLS && Date.now() - enLS.ts < FLUJO_TTL_MS) {
    flujoCache.set(configId, enLS);
    return enLS.data;
  }

  console.log(`[statusRules] 📡 Leyendo flujo "${configId}" de Firestore...`);
  const snap = await getDoc(doc(db, 'config_flujos_operacion', configId));
  if (!snap.exists()) return null;

  const data = snap.data();
  const entry = { data, ts: Date.now() };
  flujoCache.set(configId, entry);
  lsSetFlujo(configId, data);
  return data;
};

const formatTitleCase = (str: string): string => {
  if (!str || str === 'N/A') return 'N/A';
  const limpio = String(str).trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
};

const sinAcentos = (str: string): string =>
  String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// ✅ FIX: Función de normalización para comparar nombres de status
// de forma TOLERANTE (ignora acentos, espacios extra, mayúsculas).
// Esto evita que un status como "5. En Tránsito (a Origen)" no matchee
// con "5. En Transito (a Origen) " si hay alguna pequeña diferencia.
const normalizarNombre = (str: string): string =>
  sinAcentos(String(str || '').trim().toLowerCase()).replace(/\s+/g, ' ');

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

const inferirCargaDeConvenio = (operacionInfo: any): string => {
  const fuentes = [
    operacionInfo.convenioNombre,
    operacionInfo.convenio,
    operacionInfo.convenioTarifa,
    operacionInfo.tarifaNombre,
  ].filter(Boolean).map(v => sinAcentos(String(v)).toLowerCase());

  const texto = fuentes.join(' ');

  if (texto.includes('cargada') || texto.includes('llena')) return 'Cargada';
  if (texto.includes('vacia')   || texto.includes('vacío')) return 'Vacía';
  return 'N/A';
};

const inferirTraficoDeConvenio = (operacionInfo: any): string => {
  const fuentes = [
    operacionInfo.convenioNombre,
    operacionInfo.convenio,
    operacionInfo.convenioTarifa,
    operacionInfo.tarifaNombre,
  ].filter(Boolean).map(v => sinAcentos(String(v)).toLowerCase());

  const texto = fuentes.join(' ');

  if (texto.includes('importacion')) return 'Importación';
  if (texto.includes('exportacion')) return 'Exportación';
  if (texto.includes('nacional'))    return 'Nacional';
  return 'N/A';
};

const construirConfigId = (operacionInfo: any): string => {
  let tipoOpText = operacionInfo.tipoOperacionNombre
    || operacionInfo.tipoOperacion
    || operacionInfo.tipoServicio
    || 'N/A';
  if (String(tipoOpText).toLowerCase() === 'logistica') tipoOpText = 'Logística';
  else if (tipoOpText !== 'N/A') tipoOpText = formatTitleCase(tipoOpText);

  let traficoRaw = operacionInfo.trafico;
  if (!traficoRaw || String(traficoRaw).trim() === '' || String(traficoRaw).toUpperCase() === 'N/A') {
    traficoRaw = inferirTraficoDeConvenio(operacionInfo);
  }
  const trafico = formatTitleCase(traficoRaw || 'N/A');

  let cargaRaw = operacionInfo.carga;
  if (!cargaRaw || String(cargaRaw).trim() === '' || String(cargaRaw).toUpperCase() === 'N/A') {
    cargaRaw = inferirCargaDeConvenio(operacionInfo);
  }
  const carga = formatTitleCase(cargaRaw || 'N/A');

  return `${tipoOpText}_${trafico}_${carga}`;
};

const obtenerDocFlujo = async (operacionInfo: any) => {
  const idPrincipal = construirConfigId(operacionInfo);

  console.log('[statusRules] configId construido:', idPrincipal, {
    tipoOperacion: operacionInfo.tipoOperacionNombre || operacionInfo.tipoOperacion,
    trafico: operacionInfo.trafico,
    carga: operacionInfo.carga,
    convenioNombre: operacionInfo.convenioNombre || operacionInfo.convenio,
  });

  let data = await obtenerFlujoConCache(idPrincipal);
  if (data) {
    console.log('[statusRules] ✅ Match exacto con:', idPrincipal);
    return { exists: () => true, data: () => data };
  }

  const idSinAcentos = sinAcentos(idPrincipal);
  if (idSinAcentos !== idPrincipal) {
    data = await obtenerFlujoConCache(idSinAcentos);
    if (data) {
      console.log('[statusRules] ✅ Match (sin acentos) con:', idSinAcentos);
      return { exists: () => true, data: () => data };
    }
  }

  const variantes = new Set<string>();
  variantes.add(idPrincipal.replace(/_Cargada$/, '_Llena'));
  variantes.add(idPrincipal.replace(/_Llena$/, '_Cargada'));
  variantes.add(idSinAcentos.replace(/_Cargada$/, '_Llena'));
  variantes.add(idSinAcentos.replace(/_Llena$/, '_Cargada'));
  variantes.delete(idPrincipal);
  variantes.delete(idSinAcentos);

  for (const idVar of variantes) {
    data = await obtenerFlujoConCache(idVar);
    if (data) {
      console.log('[statusRules] ✅ Match (variante) con:', idVar);
      return { exists: () => true, data: () => data };
    }
  }

  console.warn('[statusRules] ❌ No se encontró flujo. Probé:', [idPrincipal, idSinAcentos, ...variantes]);
  return null;
};

// =========================================================================
// SALTO AUTOMÁTICO (EVALUADO AL GUARDAR EL FORMULARIO)
// ✅ FIX: usa buscarNodoPorNombre() para ser tolerante a diferencias menores
// =========================================================================
export const calcularStatusDinamico = async (configId: string, formData: any, statusActual?: string): Promise<string> => {
  if (!configId || configId.includes('N/A') || configId === '__') {
    throw new Error("⛔ Faltan datos para determinar el flujo. Asegúrate de que el Convenio generó correctamente el Servicio, Tráfico y Carga.");
  }

  const docRef = doc(db, 'config_flujos_operacion', configId);
  const snap = await getDoc(docRef);

  if (!snap.exists() || !snap.data().flujo || snap.data().flujo.length === 0) {
    throw new Error(`⛔ BLOQUEO: No existe un flujo configurado para la combinación:\n"${configId.replace(/_/g, ' ')}"\n\nPor favor, créalo primero en el menú "Reglas de Estatus".`);
  }

  const reglas = snap.data().flujo as any[];
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
// src/features/configuracion/config/statusRules.ts
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';

// ✅ CACHÉ DE FLUJOS EN MEMORIA + localStorage
// Los flujos de status casi nunca cambian (los configura el admin una vez).
// Antes: cada apertura de operación leía Firestore una vez. Con 50 operaciones
// abiertas al día = 50 lecturas. Ahora: 1 lectura por flujo único, por sesión.
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

// ✅ Limpia el caché de flujos (úsalo después de guardar cambios en el editor de flujos)
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
  // L1: memoria
  const enMem = flujoCache.get(configId);
  if (enMem && Date.now() - enMem.ts < FLUJO_TTL_MS) {
    return enMem.data;
  }

  // L2: localStorage
  const enLS = lsGetFlujo(configId);
  if (enLS && Date.now() - enLS.ts < FLUJO_TTL_MS) {
    flujoCache.set(configId, enLS);
    return enLS.data;
  }

  // L3: Firestore
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

// Infiere "carga" (Cargada / Vacía) buscando en el nombre del convenio.
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

// Infiere "trafico" del convenio.
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

  // ✅ Intenta cargar el flujo principal desde caché o Firestore (una sola lectura por sesión)
  let data = await obtenerFlujoConCache(idPrincipal);
  if (data) {
    console.log('[statusRules] ✅ Match exacto con:', idPrincipal);
    return { exists: () => true, data: () => data };
  }

  // Fallback 1: sin acentos
  const idSinAcentos = sinAcentos(idPrincipal);
  if (idSinAcentos !== idPrincipal) {
    data = await obtenerFlujoConCache(idSinAcentos);
    if (data) {
      console.log('[statusRules] ✅ Match (sin acentos) con:', idSinAcentos);
      return { exists: () => true, data: () => data };
    }
  }

  // Fallback 2: variantes Cargada↔Llena
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

    const reglaActual = reglas.find(r => r.nombreStatus === currentState);
    if (!reglaActual) break;

    // opcionesSiguientes guarda IDs de nodos. Resolvemos a reglas y filtramos automáticos.
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
// ✅ NUEVO: Resolución de cascada automática después de un botón.
//
// Cuando el operador presiona un botón (manual/decisión), recibimos el nombre del status
// destino. Luego, si ese destino tiene como siguiente paso un nodo AUTOMÁTICO que ya cumple
// sus campos requeridos (o no tiene ninguno), avanzamos automáticamente y repetimos.
// Devuelve la cadena completa de estados que se atravesaron (para guardar en bitácora).
//
// Ejemplo del usuario:
//   Flujo configurado:
//     [Documentado] → [Salida del Patio (manual)] → [En Tránsito a Origen (auto, sin campos)] → [En Origen (manual)]
//
//   Operador presiona "Salida del Patio" estando en "Documentado":
//     resolverCascadaStatus("Salida del Patio", operacionInfo)
//       → ["Salida del Patio", "En Tránsito a Origen"]
//
//   Resultado:
//     - El status final guardado en la operación es "En Tránsito a Origen"
//     - La bitácora registra ambos pasos
//     - El siguiente botón disponible es "En Origen"
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
    const visitados = new Set<string>([statusInicial]);

    let actual = statusInicial;
    let loopProtection = 0;

    while (loopProtection < 20) {
      loopProtection++;

      const reglaActual = reglas.find(r => r.nombreStatus === actual);
      if (!reglaActual) break;

      const idsSiguientes: string[] = reglaActual.opcionesSiguientes || [];
      if (idsSiguientes.length === 0) break;

      // Buscar SOLO nodos automáticos como siguiente paso.
      // Los manuales/decisión esperan al usuario y rompen la cascada.
      const candidatosAuto = idsSiguientes
        .map(id => reglas.find(r => r.id === id))
        .filter((r: any) => r && r.tipoMecanismo === 'automatico' && !visitados.has(r.nombreStatus))
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
          visitados.add(actual);
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
// OBTENCIÓN DE BOTONES PARA LA OPERACIÓN (MANUAL O DECISIÓN)
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

    let opcionesCandidatas: string[] = [];

    if (!statusActual) {
      opcionesCandidatas = reglas
        .filter(r => (r.tipoMecanismo === 'manual' || r.tipoMecanismo === 'boton_decision') && r.orden === 1)
        .map(r => r.nombreStatus);
      console.log('[statusRules] Sin status actual. Candidatos del paso 1:', opcionesCandidatas);
    } else {
      const reglaActual = reglas.find(r => r.nombreStatus === statusActual);
      if (!reglaActual) {
        console.warn('[statusRules] ❌ Status actual no encontrado en el flujo:', statusActual);
        console.warn('[statusRules] Status disponibles en el flujo:', reglas.map(r => r.nombreStatus));
        return [];
      }
      const idsSiguientes = reglaActual.opcionesSiguientes || [];
      opcionesCandidatas = idsSiguientes
        .map((id: string) => reglas.find(r => r.id === id)?.nombreStatus)
        .filter(Boolean);
      console.log('[statusRules] Status actual:', statusActual, '→ candidatos siguientes:', opcionesCandidatas);
    }

    if (opcionesCandidatas.length === 0) return [];

    const reglasCandidatas = reglas
      .filter(r => (r.tipoMecanismo === 'manual' || r.tipoMecanismo === 'boton_decision') && opcionesCandidatas.includes(r.nombreStatus))
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
  } catch (error) {
    console.error("[statusRules] Error validando los botones dinámicos:", error);
    return [];
  }
};
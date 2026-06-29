// src/features/operaciones/services/operacionesService.ts
//
// Guarda una operación de forma SEGURA generando una referencia con un
// CONSECUTIVO ÚNICO, IRREPETIBLE y SIN BRINCOS por (tipo + fecha de servicio).
//
// Formato de referencia: <PREFIJO>-<DDMMYY>-<NNN>   (ej. TR-270626-001)
//   · PREFIJO : TR / LO / FL / OP según el tipo de operación.
//   · DDMMYY  : tomado de la FECHA DE SERVICIO de la operación (respaldo: hoy).
//   · NNN     : consecutivo por (tipo, fecha de servicio), empezando en 001.
//
// ============================================================================
// POR QUÉ ANTES SE REPETÍA O SE BRINCABA EL CONSECUTIVO
// ============================================================================
// El consecutivo se calculaba con `Math.max(contador, maxExistente)` donde
// `maxExistente` se leía UNA sola vez ANTES de la transacción. Eso fallaba en
// dos casos:
//   1) Si el contador quedaba por DEBAJO de la realidad (p. ej. al migrar al
//      contador por-tipo los contadores nuevos arrancaron en 0 aunque ya había
//      operaciones 001..00N) y `maxExistente` fallaba en silencio (devolvía 0),
//      el número nuevo nacía por debajo → REPETIDO.
//   2) Nunca se VERIFICABA, después de asignar, que ese número no existiera ya.
//
// ============================================================================
// CÓMO SE GARANTIZA AHORA (a prueba de repetidos y de brincos)
// ============================================================================
// Es un ciclo "reservar → verificar → escribir":
//
//   A) RESERVA ATÓMICA. Dentro de una `runTransaction` se lee el contador del
//      (tipo, fecha) y se reserva  asignado = max(contador, pisoReal) + 1,
//      dejando el contador en `asignado`. La transacción de Firestore es
//      atómica y se reintenta sola si dos personas chocan, así que DOS GUARDADOS
//      SIMULTÁNEOS NUNCA RESERVAN EL MISMO NÚMERO (esto elimina los repetidos
//      por concurrencia).
//
//   B) VERIFICACIÓN CONTRA LA REALIDAD. Ya con el número reservado, se consulta
//      por IGUALDAD (`ref == <referencia>`, consulta sólida y autoindexada) si
//      ya existe alguna operación con esa referencia. Si existe (señal de que
//      el contador venía por detrás de la realidad), se SUBE el piso y se
//      REINTENTA con un número mayor. Esto elimina los repetidos por contador
//      desincronizado, que era el caso grave.
//
//   C) ESCRITURA. Como el número ya quedó reservado en el contador (ningún otro
//      guardado puede tomarlo) y se verificó que no existe, se escribe la
//      operación. Además se guardan dos campos estructurados nuevos
//      (`refPrefijo` y `refConsecutivo`) para que conocer "el último" sea
//      siempre confiable a futuro.
//
// `pisoReal` (el máximo consecutivo REAL ya existente) se calcula una vez al
// inicio para que el ciclo normalmente acierte al primer intento; la
// verificación del paso (B) es la red de seguridad definitiva contra repetidos.

import { doc, getDoc, getDocs, runTransaction, setDoc, collection, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { generarReferencia, fechaDDMMYY, prefijoTipoOperacion } from '../../../utils/generarReferencia';

// Caché de sesión del tipo de operación (evita releer el catálogo en cada guardado).
const tipoOperacionCache = new Map<string, { clave?: string; acronimo?: string; tipo_operacion?: string }>();

// Detecta si el error es por cuota de Firestore agotada (mensaje claro al usuario).
const esErrorDeCuota = (error: any): boolean => {
  const msg = String(error?.message || error?.code || error || '').toLowerCase();
  return msg.includes('resource-exhausted')
      || msg.includes('quota')
      || msg.includes('429')
      || msg.includes('too many requests');
};

// ──────────────────────────────────────────────────────────────────────
// Convierte la FECHA DE SERVICIO a DDMMYY para la referencia.
// El formulario entrega la fecha como ISO `YYYY-MM-DD` (input type="date"),
// pero también se aceptan respaldos como `DD/MM/YYYY` o `MM/DD/YYYY`. Devuelve
// null si no se puede parsear (en ese caso el guardado usará la fecha de hoy).
// ──────────────────────────────────────────────────────────────────────
const ddmmyyDeFechaServicio = (fechaServicio: any): string | null => {
  const raw = String(fechaServicio || '').trim();
  if (!raw) return null;

  let y = '', m = '', d = '';

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    y = iso[1]; m = iso[2]; d = iso[3];
  } else {
    const partes = raw.split(/[\/\-.]/).map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 3) {
      if (partes[0].length === 4) {
        y = partes[0]; m = partes[1]; d = partes[2];
      } else {
        d = partes[0]; m = partes[1]; y = partes[2];
      }
    }
  }

  if (!y || !m || !d) return null;

  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const yy = String(y).slice(-2).padStart(2, '0');

  const nd = Number(dd), nm = Number(mm);
  if (!Number.isFinite(nd) || !Number.isFinite(nm) || nd < 1 || nd > 31 || nm < 1 || nm > 12) {
    return null;
  }

  return `${dd}${mm}${yy}`;
};

// ──────────────────────────────────────────────────────────────────────
// Resuelve el PREFIJO corto (TR / LO / FL / OP) del tipo de operación.
// ──────────────────────────────────────────────────────────────────────
const resolverPrefijoCorto = async (operacionData: any): Promise<string> => {
  const tipoId = operacionData.tipoOperacionId;

  const cacheado = tipoId ? tipoOperacionCache.get(tipoId) : null;
  if (cacheado) {
    return prefijoTipoOperacion(
      cacheado.clave || cacheado.acronimo || cacheado.tipo_operacion || 'OP'
    );
  }

  if (tipoId) {
    try {
      const tipoSnap = await getDoc(doc(db, 'catalogo_tipo_operacion', tipoId));
      if (tipoSnap.exists()) {
        const dataTipo = tipoSnap.data() as any;
        tipoOperacionCache.set(tipoId, {
          clave: dataTipo.clave,
          acronimo: dataTipo.acronimo,
          tipo_operacion: dataTipo.tipo_operacion,
        });
        return prefijoTipoOperacion(
          dataTipo.clave || dataTipo.acronimo || dataTipo.tipo_operacion || 'OP'
        );
      }
    } catch (e) {
      console.warn('No se pudo leer catalogo_tipo_operacion; uso respaldo por nombre.', e);
    }
  }

  if (operacionData.tipoOperacionNombre) return prefijoTipoOperacion(operacionData.tipoOperacionNombre);
  if (operacionData.tipoOperacion)       return prefijoTipoOperacion(operacionData.tipoOperacion);

  return 'OP';
};

// ──────────────────────────────────────────────────────────────────────
// Extrae el consecutivo (NNN) de una referencia tipo "TR-270626-003".
// Solo cuenta si la referencia EMPIEZA con el prefijo+fecha esperado.
// ──────────────────────────────────────────────────────────────────────
const consecutivoDeReferencia = (valorRef: any, prefijoRef: string): number => {
  const s = String(valorRef || '').trim();
  if (!s || !s.startsWith(prefijoRef)) return 0;
  const resto = s.slice(prefijoRef.length);
  const m = resto.match(/^(\d+)/);
  return m ? (parseInt(m[1], 10) || 0) : 0;
};

// ──────────────────────────────────────────────────────────────────────
// MÁXIMO consecutivo REAL ya existente para un (prefijo + fecha de servicio).
//
// "Conocer el último para saber el siguiente". Se calcula de forma redundante
// para que sea confiable:
//   • Por el campo numérico estructurado nuevo `refConsecutivo` filtrando por
//     `refPrefijo == "<PREFIJO>-<DDMMYY>"` (consulta por IGUALDAD, sólida).
//   • Por rango de texto sobre `ref` y `referencia` (cubre registros viejos que
//     aún no tienen los campos estructurados).
// Se toma el MAYOR de todos. Si una vía falla, las otras siguen aportando.
// ──────────────────────────────────────────────────────────────────────
const obtenerMaximoConsecutivoExistente = async (prefijoCorto: string, ddmmyy: string): Promise<number> => {
  let maximo = 0;
  const prefijoRef = `${prefijoCorto}-${ddmmyy}-`;
  const refPrefijo = `${prefijoCorto}-${ddmmyy}`;

  // 1) Vía estructurada (nueva): refPrefijo == ... → max(refConsecutivo)
  try {
    const qEstruct = query(collection(db, 'operaciones'), where('refPrefijo', '==', refPrefijo));
    const snap = await getDocs(qEstruct);
    snap.forEach((d) => {
      const n = Number((d.data() as any).refConsecutivo) || 0;
      if (n > maximo) maximo = n;
    });
  } catch (e) {
    console.warn('Máximo por refConsecutivo no disponible; continúo con el texto.', e);
  }

  // 2) Vía texto (compatibilidad con registros viejos): rango sobre ref/referencia
  for (const campo of ['ref', 'referencia']) {
    try {
      const qExist = query(
        collection(db, 'operaciones'),
        where(campo, '>=', prefijoRef),
        where(campo, '<', prefijoRef + '\uf8ff'),
      );
      const snap = await getDocs(qExist);
      snap.forEach((d) => {
        const n = consecutivoDeReferencia((d.data() as any)[campo], prefijoRef);
        if (n > maximo) maximo = n;
      });
    } catch (e) {
      console.warn(`No se pudo calcular el máximo consecutivo existente por "${campo}"; continúo.`, e);
    }
  }

  return maximo;
};

// ──────────────────────────────────────────────────────────────────────
// ¿Ya existe una operación con esta referencia exacta? (consulta por IGUALDAD)
// Es la red de seguridad definitiva contra repetidos: si el contador venía por
// detrás de la realidad, aquí se detecta y se fuerza un número mayor.
// ──────────────────────────────────────────────────────────────────────
const existeReferenciaDuplicada = async (referencia: string): Promise<boolean> => {
  for (const campo of ['ref', 'referencia']) {
    try {
      const snap = await getDocs(query(collection(db, 'operaciones'), where(campo, '==', referencia)));
      if (!snap.empty) return true;
    } catch (e) {
      console.warn(`Verificación de duplicado por "${campo}" falló; continúo.`, e);
    }
  }
  return false;
};

export const guardarOperacionSegura = async (operacionData: any) => {
  // DDMMYY tomado de la FECHA DE SERVICIO (con respaldo a hoy).
  const ddmmyy = ddmmyyDeFechaServicio(operacionData.fechaServicio) || fechaDDMMYY();

  // Prefijo del tipo (TR/LO/FL/OP).
  const prefijoCorto = await resolverPrefijoCorto(operacionData);

  // Contador POR TIPO Y POR FECHA DE SERVICIO: cada (tipo, fecha) arranca en 001.
  const counterRef = doc(db, 'counters', `operaciones_${prefijoCorto}_${ddmmyy}`);

  // Piso = máximo consecutivo REAL ya existente (se calcula una vez; la
  // verificación posterior es la garantía final).
  let pisoReal = await obtenerMaximoConsecutivoExistente(prefijoCorto, ddmmyy);

  const MAX_INTENTOS = 60;

  try {
    for (let intento = 0; intento < MAX_INTENTOS; intento++) {
      // ===== A) RESERVA ATÓMICA del número (sólo el contador entra a la tx) =====
      let asignado = 0;
      await runTransaction(db, async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        const actual = counterDoc.exists() ? (Number(counterDoc.data().count) || 0) : 0;
        // El consecutivo NUNCA baja ni se repite: parte del MAYOR entre el
        // contador y el piso real. Si dos personas guardan a la vez, la
        // transacción reintenta y cada quien recibe un número distinto.
        asignado = Math.max(actual, pisoReal) + 1;
        transaction.set(
          counterRef,
          { count: asignado, prefijo: prefijoCorto, fecha: ddmmyy },
          { merge: true }
        );
      });

      const referenciaFinal = generarReferencia(prefijoCorto, asignado, ddmmyy);

      // ===== B) VERIFICACIÓN contra la realidad (anti-repetido definitivo) =====
      const duplicada = await existeReferenciaDuplicada(referenciaFinal);
      if (duplicada) {
        // El contador venía por detrás: sube el piso y reintenta con uno mayor.
        pisoReal = Math.max(pisoReal, asignado);
        console.warn(`[Consecutivo] ${referenciaFinal} ya existía; reintento con un número mayor.`);
        continue;
      }

      // ===== C) ESCRITURA (el número ya quedó reservado y verificado libre) =====
      const nuevaOperacionRef = doc(collection(db, 'operaciones'));
      await setDoc(nuevaOperacionRef, {
        ...operacionData,
        ref: referenciaFinal,
        // Campos estructurados nuevos → permiten conocer "el último" con certeza.
        refPrefijo: `${prefijoCorto}-${ddmmyy}`,
        refConsecutivo: asignado,
        createdAt: new Date().toISOString(),
      });

      return {
        success: true,
        id: nuevaOperacionRef.id,
        ref: referenciaFinal,
      };
    }

    throw new Error(
      'No se pudo asignar un consecutivo único tras varios intentos. ' +
      'Vuelve a intentar; si persiste, revisa el contador en la colección "counters".'
    );
  } catch (error: any) {
    console.error('Guardado de operación fallido: ', error);

    if (esErrorDeCuota(error)) {
      const horaActual = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
      throw new Error(
        `⚠️ CUOTA DE FIRESTORE AGOTADA (${horaActual})\n\n` +
        `Tu proyecto superó el límite gratuito diario de lecturas/escrituras.\n\n` +
        `Soluciones:\n` +
        `  • La cuota se reinicia automáticamente cada día a las 2 AM (hora México)\n` +
        `  • Activa el plan Blaze en Firebase Console (sigue siendo gratis hasta cierto uso)\n\n` +
        `Por ahora no se puede guardar la operación. Intenta más tarde.`
      );
    }

    throw error;
  }
};

// Limpia la caché de tipos de operación (p. ej. al cerrar sesión o editar el catálogo).
export const limpiarCacheTipoOperacion = () => tipoOperacionCache.clear();
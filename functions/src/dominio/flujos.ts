// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/flujos.ts
// ---------------------------------------------------------------------------
// ✅ V00441 (Fase 5.7) — elegir el FLUJO DE ESTATUS de una operación, sin Firebase.
// Era la lógica de obtenerDocFlujo (statusRules.ts, V00379/V00405/V00407); se
// mueve aquí, IGUAL, para que el servidor cobre el puente con la misma regla
// "🌉 aquí se descuenta el puente" que la web. statusRules.ts la usa de aquí.
// ✅ V00469: flujos POR ADUANA. En Reglas de Estatus se puede elegir la aduana (junto a la
//   carga): el flujo queda como "Servicio_Tráfico_Carga_Aduana" con el campo `aduana`. Una
//   operación de esa aduana usa ese flujo; si no hay uno de su aduana, el general (sin aduana),
//   como siempre. Los flujos de una aduana nunca se usan para otra.
// ---------------------------------------------------------------------------

type Datos = Record<string, unknown>;

/** Un documento de config_flujos_operacion. */
export interface FlujoDoc { id: string; datos: Datos }

/**
 * ✅ V00407: un id de documento de Firestore NO puede llevar "/" (p. ej. el servicio
 * "Rentas (Patio / Equipo)"). Se cambia por "／" (barra ancha), al guardar y al leer.
 */
export const idDocFlujo = (configId: unknown): string => String(configId ?? '').replace(/\//g, '／');

export const sinAcentosFlujo = (str: unknown): string =>
  String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Comparación TOLERANTE de nombres de estatus (acentos, espacios, mayúsculas). */
export const normalizarNombreFlujo = (str: unknown): string =>
  sinAcentosFlujo(String(str || '').trim().toLowerCase()).replace(/\s+/g, ' ');

const formatTitleCase = (str: unknown): string => {
  if (!str || str === 'N/A') return 'N/A';
  const limpio = String(str).trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1).toLowerCase();
};

const textoConvenioBasico = (op: Datos): string =>
  [op.convenioNombre, op.convenio, op.convenioTarifa, op.tarifaNombre]
    .filter(Boolean).map((v) => sinAcentosFlujo(String(v)).toLowerCase()).join(' ');

const inferirCargaDeConvenio = (op: Datos): string => {
  const texto = textoConvenioBasico(op);
  if (texto.includes('cargada') || texto.includes('llena')) return 'Cargada';
  if (texto.includes('vacia') || texto.includes('vacío')) return 'Vacía';
  return 'N/A';
};

const inferirTraficoDeConvenio = (op: Datos): string => {
  const texto = textoConvenioBasico(op);
  if (texto.includes('importacion')) return 'Importación';
  if (texto.includes('exportacion')) return 'Exportación';
  if (texto.includes('nacional')) return 'Nacional';
  return 'N/A';
};

/** Id "Tipo_Tráfico_Carga" del flujo de la operación (como lo arma el configurador). */
export const construirConfigId = (op: Datos): string => {
  let tipoOpText: unknown = op.tipoOperacionNombre || op.tipoOperacion || op.tipoServicio || 'N/A';
  if (String(tipoOpText).toLowerCase() === 'logistica') tipoOpText = 'Logística';
  else if (tipoOpText !== 'N/A') tipoOpText = formatTitleCase(tipoOpText);

  let traficoRaw: unknown = op.trafico;
  if (!traficoRaw || String(traficoRaw).trim() === '' || String(traficoRaw).toUpperCase() === 'N/A') traficoRaw = inferirTraficoDeConvenio(op);
  const trafico = formatTitleCase(traficoRaw || 'N/A');

  let cargaRaw: unknown = op.carga;
  if (!cargaRaw || String(cargaRaw).trim() === '' || String(cargaRaw).toUpperCase() === 'N/A') cargaRaw = inferirCargaDeConvenio(op);
  const carga = formatTitleCase(cargaRaw || 'N/A');

  return `${String(tipoOpText)}_${trafico}_${carga}`;
};

// Cargado/Cargada/Llena/Lleno → 'cargado'; Vacio/Vacía → 'vacio'
const canonCarga = (s: unknown): string => {
  const n = normalizarNombreFlujo(String(s ?? ''));
  if (n.startsWith('cargad') || n.startsWith('llen')) return 'cargado';
  if (n.startsWith('vaci')) return 'vacio';
  return n;
};

const textoConvenio = (op: Datos): string =>
  [op.convenioNombre, op.convenio, op.convenioTarifa, op.tarifaNombre, op.tipoConvenioNombre]
    .filter(Boolean).map((v) => normalizarNombreFlujo(String(v))).join(' ');

const utilValor = (v: unknown): string => {
  const s = String(v ?? '').trim();
  return s && s.toUpperCase() !== 'N/A' ? s : '';
};

/** ✅ V00469: aduana de la operación para elegir el flujo (la que mantiene el servidor, V00258). */
export const aduanaParaFlujo = (op: Datos): string => utilValor(op.aduanaNombre);

/** ✅ V00469: aduana del flujo ('' = flujo general, para todas las aduanas). */
export const aduanaDeFlujo = (f: FlujoDoc): string => {
  const a = utilValor(f.datos.aduana);
  return normalizarNombreFlujo(a) === 'todas' ? '' : a;
};

/**
 * ✅ V00469: ¿es la misma aduana? Sin acentos ni mayúsculas y también sin el número del
 * catálogo: "800 Colombia" = "Colombia"; "240 Nuevo Laredo" = "Nuevo Laredo".
 */
export const mismaAduana = (a: unknown, b: unknown): boolean => {
  const na = normalizarNombreFlujo(String(a ?? ''));
  const nb = normalizarNombreFlujo(String(b ?? ''));
  if (!na || !nb) return false;
  if (na === nb) return true;
  const sinNumero = (x: string) => x.replace(/^\d+\s*/, '').trim();
  const sa = sinNumero(na); const sb = sinNumero(nb);
  return !!sa && sa === sb;
};

/**
 * ✅ V00379/V00405: respaldo TOLERANTE por los campos guardados del flujo
 * (tipoServicio, trafico, carga). Un flujo sin tráfico o sin carga es comodín;
 * se prefiere el más específico.
 */
export const buscarFlujoPorIndice = (op: Datos, flujos: readonly FlujoDoc[]): string | null => {
  const conv = textoConvenio(op);
  const tipos = new Set([op.tipoOperacionNombre, op.tipoOperacion, op.tipoServicio].map(utilValor).filter(Boolean).map(normalizarNombreFlujo));
  const traficos = new Set([utilValor(op.trafico)].filter(Boolean).map(normalizarNombreFlujo));
  if (conv.includes('importacion')) traficos.add('importacion');
  if (conv.includes('exportacion')) traficos.add('exportacion');
  if (conv.includes('nacional')) traficos.add('nacional');
  const cargas = new Set([op.carga, op.cargadoVacio].map(utilValor).filter(Boolean).map(canonCarga));
  if (/\b(cargad[oa]|llen[oa])\b/.test(conv)) cargas.add('cargado');
  if (/\bvaci[oa]\b/.test(conv)) cargas.add('vacio');
  if (tipos.size === 0) return null;

  const lista = flujos.map((f) => ({
    id: f.id, tipoServicio: String(f.datos.tipoServicio ?? ''), trafico: String(f.datos.trafico ?? ''), carga: String(f.datos.carga ?? ''),
  }));
  const traficoOp = normalizarNombreFlujo(utilValor(op.trafico));
  const cargaOp = canonCarga(utilValor(op.carga));
  const esComodin = (v: string) => { const n = normalizarNombreFlujo(v); return !n || n === 'todos' || n === 'n/a'; };
  const candidatos = lista.filter((f) =>
    tipos.has(normalizarNombreFlujo(f.tipoServicio))
    && (esComodin(f.trafico) || traficos.has(normalizarNombreFlujo(f.trafico)))
    && (esComodin(f.carga) || cargas.has(canonCarga(f.carga))));
  if (candidatos.length === 0) return null;
  const puntaje = (f: { trafico: string; carga: string }) =>
    (esComodin(f.trafico) ? 0 : (normalizarNombreFlujo(f.trafico) === traficoOp ? 4 : 2))
    + (esComodin(f.carga) ? 0 : (canonCarga(f.carga) === cargaOp ? 2 : 1));
  return [...candidatos].sort((x, y) => puntaje(y) - puntaje(x))[0].id;
};

/** Ids que se prueban, en orden: exacto, sin acentos, variantes Cargada/Llena. */
export const idsCandidatosFlujo = (op: Datos): string[] => {
  const principal = construirConfigId(op);
  const sinAc = sinAcentosFlujo(principal);
  const variantes = new Set<string>([
    principal.replace(/_Cargada$/, '_Llena'), principal.replace(/_Llena$/, '_Cargada'),
    sinAc.replace(/_Cargada$/, '_Llena'), sinAc.replace(/_Llena$/, '_Cargada'),
  ]);
  variantes.delete(principal);
  variantes.delete(sinAc);
  return Array.from(new Set([principal, sinAc, ...variantes]));
};

/** El flujo de la operación (o null): mismos pasos que obtenerDocFlujo. */
export const buscarFlujo = (op: Datos, flujos: readonly FlujoDoc[]): FlujoDoc | null => {
  // ✅ V00469: primero los flujos de SU aduana (mismos pasos, solo entre ellos); luego los generales.
  const aduana = aduanaParaFlujo(op);
  const deSuAduana = aduana ? flujos.filter((f) => mismaAduana(aduanaDeFlujo(f), aduana)) : [];
  if (deSuAduana.length > 0) {
    const porIdA = new Map(deSuAduana.map((f) => [f.id, f]));
    const sufijos = Array.from(new Set(deSuAduana.map(aduanaDeFlujo)));
    for (const id of idsCandidatosFlujo(op)) {
      for (const sufijo of sufijos) {
        const f = porIdA.get(idDocFlujo(`${id}_${sufijo}`));
        if (f) return f;
      }
    }
    const porIndiceA = buscarFlujoPorIndice(op, deSuAduana);
    if (porIndiceA) return porIdA.get(idDocFlujo(porIndiceA)) ?? null;
  }
  const generales = flujos.filter((f) => !aduanaDeFlujo(f));
  const porId = new Map(generales.map((f) => [f.id, f]));
  for (const id of idsCandidatosFlujo(op)) {
    const f = porId.get(idDocFlujo(id));
    if (f) return f;
  }
  const porIndice = buscarFlujoPorIndice(op, generales);
  return porIndice ? (porId.get(idDocFlujo(porIndice)) ?? null) : null;
};

/**
 * ✅ V00377: ¿este estatus DESCUENTA el puente según la regla del flujo?
 * true/false cuando el flujo define nodos con descuentaPuente; null cuando no hay
 * flujo o ningún nodo lo define (aplica el respaldo: verdes y Completado).
 */
export const descuentaPuenteSegunFlujo = (flujo: Datos | null | undefined, statusNombre: unknown): boolean | null => {
  const reglas = Array.isArray(flujo?.flujo) ? (flujo.flujo as Datos[]) : null;
  if (!reglas) return null;
  const conFlag = reglas.filter((r) => !!r?.descuentaPuente);
  if (conFlag.length === 0) return null;
  const n = normalizarNombreFlujo(String(statusNombre || ''));
  return conFlag.some((r) => normalizarNombreFlujo(String(r?.nombreStatus || '')) === n);
};

/**
 * ✅ V00469: ¿al estatus se llega SOLO (mecanismo "automático" del flujo)? Entonces pudo ser el
 * final de una cascada y el paso anterior (p. ej. Verde USA) es el que cobra el puente.
 */
export const esStatusAutomatico = (flujo: Datos | null | undefined, statusNombre: unknown): boolean => {
  const reglas = Array.isArray(flujo?.flujo) ? (flujo.flujo as Datos[]) : [];
  const n = normalizarNombreFlujo(String(statusNombre || ''));
  return !!n && reglas.some((r) => r?.tipoMecanismo === 'automatico' && normalizarNombreFlujo(String(r?.nombreStatus || '')) === n);
};

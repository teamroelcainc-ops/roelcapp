// src/features/operaciones/components/formulario/direcciones.ts
// ---------------------------------------------------------------------------
// ✅ V00444 (Fase 8.3) — PAÍS y FORMATO de una dirección (Origen/Destino por
// tráfico) y color por tipo de operación (antes dentro de FormularioOperacion.tsx).
//   Importación: Origen = Estados Unidos, Destino = México.
//   Exportación: Origen = México, Destino = Estados Unidos. Movimiento: todo.
//   Formato MX:  Calle #Num Int., Col. Colonia, C.P. 12345, Ciudad, Estado, México
//   Formato USA: 123 Street, Suite X, City, ST 78041, Estados Unidos
// ---------------------------------------------------------------------------
type Direccion = Record<string, unknown>;

export const normalizarTxtDir = (s: unknown): string =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const paisDeDireccion = (dir: Direccion | null | undefined, textoRespaldo?: unknown): 'USA' | 'MX' | '' => {
  const p = normalizarTxtDir(dir?.pais || dir?.country || '');
  if (p) {
    if (p.includes('unido') || p.includes('united') || p === 'us' || p === 'usa' || p.includes('eua')) return 'USA';
    if (p.includes('mex')) return 'MX';
  }
  const t = normalizarTxtDir(textoRespaldo || dir?.direccionCompleta || '');
  if (!t) return '';
  if (/(estados unidos|united states|\busa\b|\beua\b|\bu\.s\.a\b)/.test(t)) return 'USA';
  if (/(mexico|\bmx\b|tamaulipas|nuevo leon|coahuila|c\.p\.)/.test(t)) return 'MX';
  if (/\b(texas|tx|laredo, tx)\b/.test(t)) return 'USA';
  return '';
};

export const formatearDireccionPorPais = (dir: Direccion | null | undefined, textoRespaldo?: unknown): string => {
  const respaldo = String(textoRespaldo || '').trim();
  if (!dir) return respaldo;
  const v = (x: unknown) => String(x ?? '').trim();
  const pais = paisDeDireccion(dir, textoRespaldo);
  const calle = v(dir.calle || dir.direccion || dir.street);
  const num = v(dir.numExterior ?? dir.numeroExterior ?? dir.numero ?? dir.numExt);
  const interior = v(dir.numInterior ?? dir.numeroInterior ?? dir.interior);
  const colonia = v(dir.colonia);
  const cp = v(dir.cp ?? dir.codigoPostal ?? dir.zip ?? dir.zipCode);
  const ciudad = v(dir.ciudad || dir.municipio || dir.city);
  const estadoDir = v(dir.estado || dir.state);
  if (!calle && !ciudad) return v(dir.direccionCompleta) || respaldo;

  if (pais === 'USA') {
    const linea1 = [[num, calle].filter(Boolean).join(' '), interior ? `Suite ${interior}` : ''].filter(Boolean).join(', ');
    const linea2 = [ciudad, [estadoDir, cp].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [linea1, linea2, 'Estados Unidos'].filter(Boolean).join(', ') || v(dir.direccionCompleta) || respaldo;
  }
  const partes = [
    [calle, num ? `#${num}` : ''].filter(Boolean).join(' ') + (interior ? ` Int. ${interior}` : ''),
    colonia ? `Col. ${colonia}` : '',
    cp ? `C.P. ${cp}` : '',
    ciudad,
    estadoDir,
    pais === 'MX' ? 'México' : '',
  ].map((x) => String(x).trim()).filter(Boolean);
  return partes.join(', ') || v(dir.direccionCompleta) || respaldo;
};

/** Color por TIPO DE OPERACIÓN: Transfer → naranja, Logística → azul, Fletes → verde; otro → neutro. */
export const colorTipoOperacion = (nombre: unknown): string => {
  const n = String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('transfer')) return '#fb923c';
  if (n.includes('logist')) return '#58a6ff';
  if (n.includes('flete')) return '#3fb950';
  return '#c9d1d9';
};

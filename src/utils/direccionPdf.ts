// src/utils/direccionPdf.ts
// ✅ V00419: desglose de la dirección de una empresa para los PDF (Carta de
//   Instrucciones / Prueba de Entrega), común a Activas, Completados y Cancelados.
//   1) Registro del catálogo `direcciones` por direccionId (o por texto igual).
//   2) Campos estructurados; lo que falte se completa parseando el texto.
//   3) Sin registro: se parsea el texto guardado en la empresa.
//   El catálogo se lee FRESCO de Firestore (con caché corta) para no depender
//   de que el estado de la pantalla ya lo tenga cargado.
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../config/firebase';

type Fila = Record<string, unknown> & { id: string };
export type DireccionPdf = { direccion: string; colonia: string; cp: string; ciudad: string; municipio: string; estado: string; pais: string; completa: string };

let cache: { ts: number; data: Fila[] } | null = null;
export const direccionesParaPdf = async (): Promise<Fila[]> => {
  if (cache && Date.now() - cache.ts < 5 * 60 * 1000 && cache.data.length) return cache.data;
  try {
    const snap = await getDocs(collection(db, 'direcciones'));
    cache = { ts: Date.now(), data: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) })) };
    return cache.data;
  } catch (e) {
    console.error('[PDF] No se pudo leer el catálogo de direcciones:', e);
    return cache?.data || [];
  }
};

export const parsearDireccionTexto = (texto: string) => {
  const t = String(texto || '');
  const partes = t.split(',').map((x) => x.trim()).filter(Boolean);
  const mCol = t.match(/col(?:onia)?\.?\s*([^,]+)/i);
  const mCP = t.match(/c\.?\s*p\.?\s*:?\s*(\d{4,6})/i) || t.match(/(?:^|[\s,])(\d{5})(?![\d-])/);
  const esPais = (x: string) => /^(m[eé]xico|estados unidos|usa|eua|united states)$/i.test(x.trim());
  const esCPtxt = (x: string) => /c\.?\s*p\.?/i.test(x) || /^\d{5}$/.test(x.trim());
  const esColTxt = (x: string) => /^col(?:onia)?\.?\s/i.test(x.trim());
  const candidatas = partes.slice(1).filter((x) => !esPais(x) && !esCPtxt(x) && !esColTxt(x));
  return {
    direccion: partes[0] || t.trim(),
    colonia: mCol ? mCol[1].trim() : '',
    cp: mCP ? mCP[1] : '',
    municipio: candidatas.length >= 2 ? candidatas[candidatas.length - 2] : '',
    estado: candidatas.length >= 1 ? candidatas[candidatas.length - 1] : '',
    pais: partes.find((x) => esPais(x)) || '',
  };
};

export const datosDireccionEmpresaPdf = (emp: Record<string, unknown> | null | undefined, lista: Fila[]): DireccionPdf => {
  const vacio: DireccionPdf = { direccion: 'N/A', colonia: 'N/A', cp: 'N/A', ciudad: 'N/A', municipio: 'N/A', estado: 'N/A', pais: 'N/A', completa: 'N/A' };
  if (!emp) return vacio;
  const v = (x: unknown) => String(x ?? '').trim();
  const textoEmp = v(emp.direccion) || v(emp.direccionLabel);
  let dir = lista.find((d) => String(d.id) === String(emp.direccionId)) || null;
  if (!dir && textoEmp) dir = lista.find((d) => v(d.direccionCompleta) && v(d.direccionCompleta).toLowerCase() === textoEmp.toLowerCase()) || null;
  const completa = v(dir?.direccionCompleta) || textoEmp;
  if (dir) {
    const r = parsearDireccionTexto(completa);
    const calle = [v(dir.calleNombre), v(dir.numExterior) ? `#${v(dir.numExterior)}` : '', v(dir.numInterior) ? `Int. ${v(dir.numInterior)}` : ''].filter(Boolean).join(' ');
    const municipio = v(dir.municipioNombre) || r.municipio;
    const estado = v(dir.estadoNombre) || r.estado;
    return {
      direccion: calle || r.direccion || 'N/A',
      colonia: v(dir.coloniaNombre) || r.colonia || 'N/A',
      cp: v(dir.cpNombre) || r.cp || 'N/A',
      municipio: municipio || 'N/A',
      estado: estado || 'N/A',
      pais: v(dir.paisNombre) || r.pais || 'N/A',
      ciudad: [municipio, estado].filter(Boolean).join(', ') || 'N/A',
      completa: completa || 'N/A',
    };
  }
  if (!textoEmp) return vacio;
  const r = parsearDireccionTexto(textoEmp);
  return {
    direccion: r.direccion || 'N/A', colonia: r.colonia || 'N/A', cp: r.cp || 'N/A',
    municipio: r.municipio || 'N/A', estado: r.estado || 'N/A', pais: r.pais || 'N/A',
    ciudad: [r.municipio, r.estado].filter(Boolean).join(', ') || 'N/A', completa: textoEmp,
  };
};

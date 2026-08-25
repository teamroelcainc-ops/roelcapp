import { useState, useEffect, useMemo, useCallback, useRef, cloneElement } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs, setDoc, deleteDoc, addDoc, query, where, limit, orderBy } from 'firebase/firestore';
import { prefijoTipoOperacion } from '../../../utils/generarReferencia';
import { db, storage, auth } from '../../../config/firebase';
import { useUsuarioStore } from '../../../stores/useUsuarioStore';
import { guardarOperacionSegura } from '../services/operacionesService';
// ✅ AUTORIZACIONES: interceptar guardado cuando la acción/campo lo requiere.
import { cargarConfigModulo, evaluarAutorizacion, camposModificadosDe, obtenerUsuarioAut, MODULOS_AUTORIZABLES } from '../../autorizaciones/autorizaciones';
// ✅ NUEVO: historial de actividad (colección historial_actividad)
import { registrarLog } from '../../../utils/logger';
import { calcularStatusDinamico } from '../config/statusRules';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';

import { FormularioEmpresa } from '../../empresas/components/FormularioEmpresa';
import { FormularioRemolque } from '../../remolques/components/FormularioRemolque';
import { FormularioUnidad } from '../../unidades/components/FormularioUnidad';
import { EmployeeForm } from '../../empleados/components/EmployeeForm';
import { CostosAdicionalesDashboard } from '../../costosAdicionales/CostosAdicionalesDashboard';
import './FormularioOperacion.css';
import { notificarOperacionGuardada } from '../../../utils/operacionesBus';
import { EditorDetalleConvenioModal } from './EditorDetalleConvenioModal';
import { almacenSesion } from '../../../utils/cacheMemoria';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';

// ✅ NUEVO: utilidades para el Historial de Actividad (historial_actividad).
//   Nunca deben romper el guardado: los llamados a registrarLog van con .catch.
const truncarValorLog = (v: any): string => {
  if (v === null || v === undefined || String(v).trim() === '') return '(vacío)';
  const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return t.length > 60 ? t.slice(0, 57) + '...' : t;
};

const describirCambiosLog = (nuevo: any, anterior: any, etiquetas: Record<string, string> = {}): string => {
  const cmp = (x: any) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? ''));
  const cambios: string[] = [];
  Object.keys(nuevo || {}).forEach((k) => {
    const a = anterior ? anterior[k] : undefined;
    if (cmp(a) === cmp(nuevo[k])) return;
    cambios.push(`${etiquetas[k] || k}: "${truncarValorLog(a)}" → "${truncarValorLog(nuevo[k])}"`);
  });
  if (cambios.length === 0) return 'sin cambios de valor detectados';
  const visibles = cambios.slice(0, 15);
  const resto = cambios.length - visibles.length;
  return visibles.join(' | ') + (resto > 0 ? ` | ...y ${resto} campos más` : '');
};

// ✅ NUEVO (auditoría NO editable): lista completa de cambios "campo: viejo → nuevo"
//   que se guarda DENTRO de la operación (historialEdiciones) para saber cuántas
//   veces se editó una referencia, quién lo hizo y qué cambió exactamente.
const listaCambiosAuditoria = (nuevo: any, anterior: any, etiquetas: Record<string, string> = {}): string[] => {
  const cmp = (x: any) => (typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? ''));
  const cambios: string[] = [];
  Object.keys(nuevo || {}).forEach((k) => {
    if (k === 'historialEdiciones' || k === 'creadoPor' || k === 'creadoEn') return;
    const a = anterior ? anterior[k] : undefined;
    if (cmp(a) === cmp(nuevo[k])) return;
    cambios.push(`${etiquetas[k] || k}: "${truncarValorLog(a)}" → "${truncarValorLog(nuevo[k])}"`);
  });
  return cambios.slice(0, 40);
};

const describirCamposCapturadosLog = (datos: any, etiquetas: Record<string, string> = {}): string => {
  const claves = Object.keys(datos || {}).filter((k) => {
    const v = datos[k];
    return v !== '' && v !== null && v !== undefined && v !== false;
  });
  const visibles = claves.slice(0, 20);
  const resto = claves.length - visibles.length;
  return visibles.map((k) => `${etiquetas[k] || k}: "${truncarValorLog(datos[k])}"`).join(' | ') + (resto > 0 ? ` | ...y ${resto} campos más` : '');
};

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: any;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  catalogosCacheados: any;
  onSave?: (opNueva: any) => void; 
}

type TabType = 'general' | 'pedimento' | 'manifiesto' | 'unidad' | 'cobrar';

const TODAS_LAS_PESTANAS: TabType[] = ['general', 'pedimento', 'manifiesto', 'unidad', 'cobrar'];

const CAMPO_TAB_MAP: Record<string, TabType> = {
  tipoOperacionId: 'general', fechaServicio: 'general', fechaCita: 'general',
  clientePaga: 'general', convenio: 'general', numeroRemolque: 'general',
  refCliente: 'general', origen: 'general', destino: 'general', kilometrajeEstimado: 'general', observacionesEjecutivo: 'general',

  clienteMercancia: 'pedimento', descripcionMercancia: 'pedimento', cantidad: 'pedimento',
  embalaje: 'pedimento', pesoKg: 'pedimento', numDoda: 'pedimento', fechaEmisionDoda: 'pedimento',
  pdfCartaPorte: 'pedimento', pdfDoda: 'pedimento',

  numeroEntrys: 'manifiesto', cantEntrys: 'manifiesto', pdfsEntrys: 'manifiesto',
  numManifiesto: 'manifiesto', provServicios: 'manifiesto', montoManifiesto: 'manifiesto', pdfManifiesto: 'manifiesto',

  proveedorUnidad: 'unidad', facturadoEnUnidad: 'unidad', convenioProveedor: 'unidad',
  totalAPagarProv: 'unidad', cargosAdicionalesProv: 'unidad', unidad: 'unidad', operador: 'unidad',
  sueldoOperador: 'unidad', sueldoExtra: 'unidad', combustible: 'unidad', combustibleExtra: 'unidad',
  unidadProveedor: 'unidad', operadorProveedor: 'unidad', observacionesUnidad: 'unidad',

  facturadoEnCobrar: 'cobrar', montoConvenioCliente: 'cobrar', cargosAdicionales: 'cobrar',
  tipoCambioAprobado: 'cobrar', observacionesCobrar: 'cobrar',
};

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

const ID_GASTO_SUELDO = '25b772d3';

const TIPO_OP_PROVEEDOR_FIJO = '8ec24dfe';
const PROVEEDOR_FIJO_ID = '349123';

// ✅ (Origen/Destino — regla AppSheet restaurada)
//   Tipos de operación cuyo Origen/Destino se filtra por país según el tráfico:
//     8ec24dfe y 24da3608  → Exportación: Origen MX / Destino USA;
//                            Importación: Origen USA / Destino MX;
//                            Movimiento: sin filtro.
//   Tipo 3e5b0035 → sin filtro (todas las direcciones).
//   Tipos con TrompoExpo/TrompoImpo = true → misma regla por país en su tráfico.
const TIPOS_OP_FILTRO_PAIS = ['8ec24dfe', '24da3608'];
const TIPO_OP_SIN_FILTRO_PAIS = '3e5b0035';
const esTrueAppSheet = (v: any): boolean => v === true || String(v ?? '').trim().toLowerCase() === 'true';

// ═══════════════════════════════════════════════════════════════════════
// ✅ (Origen/Destino por tráfico) Detección de PAÍS y FORMATO de dirección.
//   Importación: Origen = Estados Unidos, Destino = México.
//   Exportación: Origen = México, Destino = Estados Unidos.
//   Movimiento: se muestra todo.
//   (La regla por tipo de operación está en TIPOS_OP_FILTRO_PAIS / TIPO_OP_SIN_FILTRO_PAIS.)
//   Formato MX:  Calle #Num Int., Col. Colonia, C.P. 12345, Ciudad, Estado, México
//   Formato USA: 123 Street, Suite X, City, ST 78041, Estados Unidos
// ═══════════════════════════════════════════════════════════════════════
const normalizarTxtDir = (s: any): string =>
  String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const paisDeDireccion = (dir: any, textoRespaldo?: any): 'USA' | 'MX' | '' => {
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

const formatearDireccionPorPais = (dir: any, textoRespaldo?: any): string => {
  const respaldo = String(textoRespaldo || '').trim();
  if (!dir) return respaldo;
  const v = (x: any) => String(x ?? '').trim();
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
  ].map(x => String(x).trim()).filter(Boolean);
  return partes.join(', ') || v(dir.direccionCompleta) || respaldo;
};

// ✅ Color por TIPO DE OPERACIÓN: Transfer → naranja, Logística → azul,
//   Fletes → verde. Cualquier otro tipo conserva el color neutro.
const colorTipoOperacion = (nombre: any): string => {
  const n = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (n.includes('transfer')) return '#fb923c';
  if (n.includes('logist')) return '#58a6ff';
  if (n.includes('flete')) return '#3fb950';
  return '#c9d1d9';
};

// ✅ Envuelve un input de dinero y le antepone el símbolo "$" dentro del campo.
const ConSimboloMoneda = ({ children, style, className }: { children: any; style?: any; className?: string }) => (
  <div className={className} style={{ position: 'relative', ...(style || {}) }}>
    <span className="fo-x1">$</span>
    {cloneElement(children, { style: { ...((children.props as any)?.style || {}), paddingLeft: '24px' } })}
  </div>
);

const COSTO_MANIFIESTO_DEFAULT = 8.52;
// ✅ (Proveedor de Servicios / Manifiesto) El buscador solo muestra empresas con
//   tiposEmpresa que contenga 11894dfd Y tiposServicio que contenga alguno de
//   los dos servicios permitidos. Solo el servicio 42afffd3 coloca el costo
//   por defecto del manifiesto; cualquier otro coloca 0.
const TIPO_EMPRESA_PROV_SERVICIOS_ID = '11894dfd';
const TIPOS_SERVICIO_PROV_MANIFIESTO = ['42afffd3', '7e70a3f7'];
const TIPO_SERVICIO_CON_COSTO_MANIFIESTO = '42afffd3';
// ✅ (Caseta/Puente automático según tráfico)
const PUENTE_IMPORTACION_ID = '4614ec51'; // Caseta Avi
const PUENTE_EXPORTACION_ID = '49ce0a0e'; // Caseta Puente III

const TIPO_EMP_CLIENTE_PAGA      = 'Cliente (Paga)';
const TIPO_EMP_CLIENTE_MERCANCIA = 'Cliente (Mercancía)';
const TIPO_EMP_ORIGEN_DESTINO    = 'Origen / Destino';
const TIPO_EMP_PROV_TRANSPORTE   = 'Proveedor (Transporte)';
const TIPO_EMP_PROV_SERVICIOS    = 'Proveedor (Servicios)';

export const TIPOS_DOCUMENTO_OPERACION = [
  'Otros documentos',
  'Factura',
  'Comprobante de Pago',
  'Evidencia de Entrega (POD)',
  'Carta Porte',
  'DODA',
  'Manifiesto',
  "Entry's",
  'Otro',
];

const sanitizarRutaOp = (s: string) =>
  String(s || '').trim().replace(/[\/\\:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();

const referenciaDeOperacion = (idOp: string, ref?: string): string =>
  (ref && String(ref).trim()) || (idOp ? String(idOp).substring(0, 6) : 'Operacion');

const normClave = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

const normalizarFechaISO = (valor: any): string => {
  if (valor === null || valor === undefined || valor === '') return '';

  if (typeof valor === 'object') {
    try {
      if (typeof valor.toDate === 'function') return valor.toDate().toISOString().split('T')[0];
      if (typeof valor.seconds === 'number') return new Date(valor.seconds * 1000).toISOString().split('T')[0];
      if (valor instanceof Date && !isNaN(valor.getTime())) return valor.toISOString().split('T')[0];
    } catch { /* sigue abajo */ }
  }

  const s = String(valor).trim();
  if (!s) return '';

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (dmy) {
    const a = parseInt(dmy[1], 10);
    const b = parseInt(dmy[2], 10);
    const y = dmy[3];
    let dd = a, mm = b;
    if (a <= 12 && b > 12) { mm = a; dd = b; }
    if (mm < 1 || mm > 12) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    const d = new Date(n > 1e12 ? n : n * 1000);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];

  return '';
};

// ✅ FIX TIPO DE CAMBIO: respaldo del catálogo de "Tipo de Cambio Oficial"
//   cargado DIRECTAMENTE de Firestore por si no viene en catalogosCacheados
//   (causa de "Sin Registro"). Se cachea a nivel de módulo y se prueban varios
//   nombres posibles de la colección.
let catalogoTCRespaldo: any[] | null = null;
const COLECCIONES_TC_POSIBLES = [
  'tipo_cambio', 'tipos_cambio', 'catalogo_tipo_cambio', 'catalogo_tipos_cambio',
  'catalogo_tc', 'tipo_cambio_oficial', 'tipoCambio', 'tc', 'tc_dof', 'tipos_de_cambio',
];

const cargarCatalogoTCRespaldo = async (): Promise<any[]> => {
  if (catalogoTCRespaldo) return catalogoTCRespaldo;
  for (const nombre of COLECCIONES_TC_POSIBLES) {
    try {
      const snap = await getDocs(collection(db, nombre));
      if (!snap.empty) {
        catalogoTCRespaldo = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        return catalogoTCRespaldo;
      }
    } catch { /* colección inexistente o sin acceso: se prueba la siguiente */ }
  }
  catalogoTCRespaldo = [];
  return catalogoTCRespaldo;
};

const extraerRateDeFilaTC = (row: any): number | null => {
  if (!row || typeof row !== 'object') return null;
  const keys = Object.keys(row);
  const valKey = keys.find((k) => {
    const kk = String(k).toLowerCase();
    return kk.includes('dof') || kk.includes('valor') || kk === 'tc' ||
           kk.includes('cambio') || kk.includes('monto') || kk.includes('t.c');
  });
  if (valKey) {
    const n = Number(String(row[valKey]).replace(/[^0-9.-]+/g, ''));
    if (!isNaN(n) && n > 0) return n;
  }
  const posibles = Object.values(row)
    .map((v: any) => parseFloat(String(v).replace(/[^0-9.-]+/g, '')))
    .filter((n: any) => !isNaN(n) && n > 5 && n < 60);
  return posibles.length > 0 ? posibles[0] : null;
};

const filaTCEsDeLaFecha = (row: any, objetivoISO: string): boolean => {
  if (!objetivoISO || !row || typeof row !== 'object') return false;
  return Object.values(row).some((v: any) => normalizarFechaISO(v) === objetivoISO);
};

const subirDocumentoOperacion = async (
  file: File,
  idOp: string,
  refOp: string,
  campoLabel: string,
  sufijoUnico?: string,
) => {
  const carpeta = sanitizarRutaOp(refOp) || sanitizarRutaOp(idOp) || 'sin_referencia';
  const subcarpeta = sanitizarRutaOp(campoLabel) || 'otros documentos';
  const nombreBase = sufijoUnico ? `${subcarpeta} ${sufijoUnico}` : subcarpeta;
  const punto = file.name.lastIndexOf('.');
  const extension = punto >= 0 ? file.name.slice(punto) : '';
  const nombreFinal = `${nombreBase}${extension}`;
  const ruta = `operaciones/${carpeta}/${subcarpeta}/${nombreFinal}`;

  const r = storageRef(storage, ruta);
  await uploadBytes(r, file, file.type ? { contentType: file.type } : undefined);
  const url = await getDownloadURL(r);

  const docId = sanitizarRutaOp(`operaciones__${idOp}__${nombreBase}`).replace(/\s+/g, '_');
  await setDoc(doc(db, 'documentos', docId), {
    coleccionOrigen: 'operaciones',
    registroId: idOp,
    registroNombre: refOp,
    tipoDocumento: sufijoUnico ? `${campoLabel} ${sufijoUnico}` : campoLabel,
    carpeta,
    subcarpeta,
    nombreArchivo: nombreFinal,
    path: ruta,
    url,
    vence: false,
    fechaExpedicion: '',
    fechaVencimiento: '',
    observaciones: '',
    createdAt: new Date().toISOString(),
  }, { merge: true });
};


const IconBriefcase     = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
const IconFileText      = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const IconTruck         = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
const IconClipboard     = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>;
const IconDollar        = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
const IconUsers         = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconMapPin        = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconCalendar      = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconPackage       = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
const IconReceipt       = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2h16v20l-3-2-2 2-3-2-3 2-2-2-3 2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>;
const IconTrendingUp    = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
const IconRoute         = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>;
const IconEdit          = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IconSave          = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
const IconX             = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconMinimize      = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="19" x2="19" y2="19"/></svg>;
const IconAlert         = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IconCheck         = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const IconArrowRight    = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
const IconPlus          = (p: { size?: number }) => <svg className="fo-x2" width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;

const tipoTarifarioCache = new Map<string, any>();
const traficoCache = new Map<string, string>();

const BotonAgregar = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <button className="fo-x3"
    type="button"
    onClick={onClick}
    title={title}
    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.20)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.10)'; }}
  >
    <IconPlus size={17} />
  </button>
);

// ✅ FIX ARRASTRE DE DOCUMENTOS:
//   - Contenedor <div> con onClick explícito (el <label> re-disparaba un "click"
//     al soltar y, si se cancelaba, borraba el archivo recién arrastrado).
//   - input con ref + DataTransfer para asignar un FileList real.
//   - onChange del input SOLO se propaga cuando de verdad hay archivos (cancelar
//     el diálogo ya NO borra el archivo cargado).
//   - dragDepth evita el parpadeo al pasar sobre elementos hijos.
const CampoArchivo = ({
  label,
  file,
  onChange,
  accept = '.pdf',
  resaltar = false,
}: {
  label: string;
  file: File | null | undefined;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  accept?: string;
  resaltar?: boolean;
}) => {
  const cargado = !!file;
  const [arrastrando, setArrastrando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const emitirArchivos = (lista: FileList | File[] | null) => {
    const arr = lista ? Array.from(lista as any).filter(Boolean) : [];
    if (arr.length === 0) {
      if (inputRef.current) inputRef.current.value = '';
      onChange({ target: { value: '', files: null } } as unknown as React.ChangeEvent<HTMLInputElement>);
      return;
    }
    try {
      const dt = new DataTransfer();
      arr.forEach((f: any) => dt.items.add(f));
      if (inputRef.current) inputRef.current.files = dt.files;
      onChange({ target: { files: dt.files } } as unknown as React.ChangeEvent<HTMLInputElement>);
    } catch {
      onChange({ target: { files: lista as any } } as unknown as React.ChangeEvent<HTMLInputElement>);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current += 1;
    setArrastrando(true);
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) { dragDepth.current = 0; setArrastrando(false); }
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth.current = 0;
    setArrastrando(false);
    const archivos = e.dataTransfer?.files;
    if (archivos && archivos.length > 0) emitirArchivos(archivos);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) onChange(e);
  };

  const abrirDialogo = () => { inputRef.current?.click(); };

  const quitarArchivo = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = '';
    onChange({ target: { value: '', files: null } } as unknown as React.ChangeEvent<HTMLInputElement>);
  };

  const fondo = arrastrando
    ? 'rgba(251, 146, 60, 0.14)'
    : cargado ? 'rgba(63, 185, 80, 0.10)' : (resaltar ? 'rgba(248, 81, 73, 0.06)' : '#010409');
  const borde = arrastrando
    ? '1px dashed #fb923c'
    : cargado ? '1px solid rgba(63, 185, 80, 0.45)' : (resaltar ? '1px dashed #f85149' : '1px dashed #30363d');

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div
        role="button"
        onClick={abrirDialogo}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s ease', backgroundColor: fondo, border: borde }}
      >
        <span style={{ flexShrink: 0, width: '26px', height: '26px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: cargado ? '#238636' : '#21262d', color: cargado ? '#fff' : '#8b949e' }}>
          {cargado ? <IconCheck size={15} /> : <IconPlus size={15} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: cargado ? 600 : 400, color: arrastrando ? '#fb923c' : (cargado ? '#3fb950' : '#8b949e'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {arrastrando ? 'Suelta el archivo aquí…' : (cargado ? `✓ ${file!.name}` : 'Haz clic o arrastra un archivo aquí')}
        </span>
        {cargado && !arrastrando && (
          <button className="fo-x4"
            type="button"
            title="Quitar archivo"
            onClick={quitarArchivo}
          >
            <IconX size={12} /> Quitar
          </button>
        )}
        <input className="fo-x5" ref={inputRef} type="file" accept={accept} onChange={handleInputChange} />
      </div>
    </div>
  );
};

type CatalogoCreable =
  | { tipo: 'empresa'; tipoEmpresaPreseleccionado: string; coleccion: 'empresas' }
  | { tipo: 'remolque'; coleccion: 'remolques' }
  | { tipo: 'unidad'; coleccion: 'unidades' }
  | { tipo: 'empleado'; coleccion: 'empleados' };

export const FormularioOperacion = ({ estado, initialData, onClose, onMinimize, onRestore, catalogosCacheados, onSave }: FormProps) => {
  const [pestañaActiva, setPestañaActiva] = useState<TabType>('general');
  const [cargando, setCargando] = useState(false);
  const [mostrarCostosAdic, setMostrarCostosAdic] = useState<false | 'cliente' | 'proveedor'>(false);
  // ✅ V00126: editar el detalle del convenio elegido (moneda/tarifa) sin salir de Operaciones
  const [detalleConvenioEdit, setDetalleConvenioEdit] = useState<{ tipo: 'cliente' | 'proveedor'; detalleId: string } | null>(null);
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);

  const [mostrarConveniosCliente, setMostrarConveniosCliente] = useState(false);
  const [detalleConvEditando, setDetalleConvEditando] = useState<any | null>(null);
  const [guardandoDetalleConv, setGuardandoDetalleConv] = useState(false);

  const [mostrarConveniosProveedor, setMostrarConveniosProveedor] = useState(false);
  const [detalleConvProvEditando, setDetalleConvProvEditando] = useState<any | null>(null);
  const [guardandoDetalleConvProv, setGuardandoDetalleConvProv] = useState(false);

  const [puedeEditarRef, setPuedeEditarRef] = useState(false);

  // ✅ AUTORIZACIONES: config del módulo 'operaciones' y usuario actual.
  const [configAut, setConfigAut] = useState<any>(undefined); // undefined = aún cargando
  const [usuarioAut, setUsuarioAut] = useState<any>(null);
  useEffect(() => {
    cargarConfigModulo('operaciones').then(setConfigAut).catch(() => setConfigAut(null));
    obtenerUsuarioAut().then(setUsuarioAut).catch(() => {});
  }, []);

  // ✅ Bloqueo proactivo en la UI: campos que autorizaciones marca como
  //    controlados para los roles del usuario actual. Admin nunca se bloquea.
  //    (El guardado sigue validando TODO como respaldo.)
  const camposBloqueadosAut = useMemo(() => {
    if (!configAut || !usuarioAut || usuarioAut.esAdmin) return new Set<string>();
    const claves = Object.keys(configAut.campos || {});
    const r = evaluarAutorizacion(configAut, 'editar', usuarioAut, claves, {});
    return new Set(r.camposControlados);
  }, [configAut, usuarioAut]);
  const campoBloqueadoAut = (k: string) => camposBloqueadosAut.has(k);
  const [referencia, setReferencia] = useState('');

  const [statusPreview, setStatusPreview] = useState<string>('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const [camposSiguienteStatus, setCamposSiguienteStatus] = useState<{ campo: string; etiqueta: string; cumplido: boolean }[]>([]);
  const [nombreSiguienteAuto, setNombreSiguienteAuto] = useState<string>('');

  const [pestanasVisiblesConfig, setPestanasVisiblesConfig] = useState<TabType[] | null>(null);
  const [camposObligatoriosConfig, setCamposObligatoriosConfig] = useState<string[] | null>(null);

  const [flujosIndex, setFlujosIndex] = useState<{ id: string; tipoServicio: string; trafico: string; carga: string }[]>([]);

  const [modalCatalogo, setModalCatalogo] = useState<{
    catalogo: CatalogoCreable;
    idsPrevios: Set<string>;
    onCreado: (nuevoId: string, registro: any) => void;
  } | null>(null);

  const [empresasLocal, setEmpresasLocal] = useState<any[]>(catalogosCacheados?.empresas || []);
  const [remolquesLocal, setRemolquesLocal] = useState<any[]>(catalogosCacheados?.remolques || []);
  const [unidadesLocal, setUnidadesLocal] = useState<any[]>(catalogosCacheados?.unidades || []);
  const [empleadosLocalState, setEmpleadosLocalState] = useState<any[]>(catalogosCacheados?.empleados || []);
  const [tarifasLocal, setTarifasLocal] = useState<any[]>(catalogosCacheados?.tarifas || []);
  const [embalajesLocal, setEmbalajesLocal] = useState<any[]>(catalogosCacheados?.embalajes || []);
  const [convClientesLocal, setConvClientesLocal] = useState<any[]>(catalogosCacheados?.catalogoConvClientes || []);
  const [convDetallesLocal, setConvDetallesLocal] = useState<any[]>(catalogosCacheados?.catalogoConvDetalles || []);
  const [convProvLocal, setConvProvLocal] = useState<any[]>(catalogosCacheados?.conveniosProv || []);
  const [convProvDetallesLocal, setConvProvDetallesLocal] = useState<any[]>(catalogosCacheados?.catalogoConvProvDetalles || []);
  const [gastosIncluidosLocal, setGastosIncluidosLocal] = useState<any[]>(catalogosCacheados?.tarifasGastosIncluidos || []);
  const [rendimientoLocal, setRendimientoLocal] = useState<any[]>(catalogosCacheados?.tarifasRendimiento || []);
  const [tiposGastosLocal, setTiposGastosLocal] = useState<any[]>(catalogosCacheados?.tiposGastos || []);

  useEffect(() => { setEmpresasLocal(catalogosCacheados?.empresas || []); }, [catalogosCacheados?.empresas]);
  useEffect(() => { setRemolquesLocal(catalogosCacheados?.remolques || []); }, [catalogosCacheados?.remolques]);
  useEffect(() => { setUnidadesLocal(catalogosCacheados?.unidades || []); }, [catalogosCacheados?.unidades]);
  useEffect(() => { setEmpleadosLocalState(catalogosCacheados?.empleados || []); }, [catalogosCacheados?.empleados]);
  useEffect(() => { setTarifasLocal(catalogosCacheados?.tarifas || []); }, [catalogosCacheados?.tarifas]);
  useEffect(() => { setEmbalajesLocal(catalogosCacheados?.embalajes || []); }, [catalogosCacheados?.embalajes]);
  useEffect(() => { setConvClientesLocal(catalogosCacheados?.catalogoConvClientes || []); }, [catalogosCacheados?.catalogoConvClientes]);
  useEffect(() => { setConvDetallesLocal(catalogosCacheados?.catalogoConvDetalles || []); }, [catalogosCacheados?.catalogoConvDetalles]);
  useEffect(() => { setConvProvLocal(catalogosCacheados?.conveniosProv || []); }, [catalogosCacheados?.conveniosProv]);
  useEffect(() => { setConvProvDetallesLocal(catalogosCacheados?.catalogoConvProvDetalles || []); }, [catalogosCacheados?.catalogoConvProvDetalles]);

  useEffect(() => {
    let activo = true;
    const fuentes: { alias: string; coleccion: string; setter: (d: any[]) => void }[] = [
      { alias: 'empresas',                 coleccion: 'empresas',                       setter: setEmpresasLocal },
      { alias: 'remolques',                coleccion: 'remolques',                      setter: setRemolquesLocal },
      { alias: 'unidades',                 coleccion: 'unidades',                       setter: setUnidadesLocal },
      { alias: 'empleados',                coleccion: 'empleados',                      setter: setEmpleadosLocalState },
      { alias: 'tarifas',                  coleccion: 'catalogo_tarifas_referencia',    setter: setTarifasLocal },
      { alias: 'embalajes',                coleccion: 'catalogo_embalaje',              setter: setEmbalajesLocal },
      { alias: 'catalogoConvClientes',     coleccion: 'convenios_clientes',             setter: setConvClientesLocal },
      { alias: 'catalogoConvDetalles',     coleccion: 'convenios_clientes_detalles',    setter: setConvDetallesLocal },
      { alias: 'conveniosProv',            coleccion: 'convenios_proveedores',          setter: setConvProvLocal },
      { alias: 'catalogoConvProvDetalles', coleccion: 'convenios_proveedores_detalles', setter: setConvProvDetallesLocal },
      { alias: 'tarifasGastosIncluidos',   coleccion: 'tarifas_gastos_incluidos',       setter: setGastosIncluidosLocal },
      { alias: 'tarifasRendimiento',       coleccion: 'tarifas_rendimiento',            setter: setRendimientoLocal },
      { alias: 'tiposGastos',              coleccion: 'catalogo_tipos_gastos',          setter: setTiposGastosLocal },
    ];
    (async () => {await Promise.all(fuentes.map(async ({ alias, coleccion, setter }) => {
        try {
          const snap = await getDocs(collection(db, coleccion));
          const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          if (!activo) return;
          setter(docs);
          // ✅ CORREGIDO: los dashboards leen las cachés con clave "cat_v2__" (las
          //   v1 se ELIMINAN en cada arranque). Antes se escribía en v1 y por eso
          //   los clientes/proveedores/bodegas nuevos tardaban hasta 24 h (TTL) en
          //   verse en tablas y documentos. Nunca se cachean listas vacías.
          try { if (docs.length > 0) localStorage.setItem(`cat_v2__${alias}`, JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* noop */ }
        } catch (e) {
          console.error(`Error refrescando catálogo "${coleccion}":`, e);
        }
      }));
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let activo = true;
    const norm = (s: any) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    (async () => {
      try {
        const u = auth.currentUser;
        if (!u) { if (activo) setPuedeEditarRef(true); return; }
        const snap = await getDoc(doc(db, 'usuarios', u.uid));
        if (!activo) return;
        if (!snap.exists()) { setPuedeEditarRef(true); return; }
        const data = snap.data() as any;
        const rolesUsuario: string[] = Array.isArray(data.roles) ? data.roles : (data.rol ? [String(data.rol)] : []);
        const rolesSet = new Set(rolesUsuario.map(norm));

        if ([...rolesSet].some((r) => r.includes('ADMIN'))) { setPuedeEditarRef(true); return; }

        const rolesSnap = await getDocs(collection(db, 'roles'));
        if (!activo) return;
        const permitido = rolesSnap.docs.some((d: any) => {
          const rd = d.data() || {};
          const esDelUsuario = rolesSet.has(norm(rd.nombre)) || rolesSet.has(norm(d.id));
          if (!esDelUsuario) return false;
          const mods: string[] = Array.isArray(rd.modulosPermitidos) ? rd.modulosPermitidos : [];
          return mods.some((m) => norm(m).includes('EDITAR REF'));
        });
        if (activo) setPuedeEditarRef(permitido);
      } catch { if (activo) setPuedeEditarRef(false); }
    })();
    return () => { activo = false; };
  }, []);

  const {
    tiposOperacion = [],
    catalogoTC = [],
    statusServicio = [],
    catalogoMoneda = [],
    unidadesProveedor = catalogosCacheados?.unidades_proveedor || [],
    proveedoresUnidad = catalogosCacheados?.proveedores_unidad || []
  } = catalogosCacheados || {};

  const empresas = empresasLocal;
  const remolques = remolquesLocal;
  const unidades = unidadesLocal;
  const empleados = empleadosLocalState;
  const tarifas = tarifasLocal;
  const conveniosProv = convProvLocal;
  const catalogoConvProvDetalles = convProvDetallesLocal;
  const catalogoConvClientes = convClientesLocal;
  const catalogoConvDetalles = convDetallesLocal;

  const catalogoTrafico = useMemo(() =>
    catalogosCacheados?.catalogo_trafico
    || catalogosCacheados?.traficos
    || catalogosCacheados?.trafico
    || [],
  [catalogosCacheados]);

  // ✅ FIX TIPO DE CAMBIO: resuelve el catálogo de TC venga como venga en
  //   catalogosCacheados (a veces la clave no es exactamente `catalogoTC`).
  const catalogoTCResuelto = useMemo(() => {
    if (Array.isArray(catalogoTC) && catalogoTC.length) return catalogoTC;
    return (
      catalogosCacheados?.tipoCambio
      || catalogosCacheados?.tipo_cambio
      || catalogosCacheados?.catalogo_tipo_cambio
      || catalogosCacheados?.catalogoTipoCambio
      || catalogosCacheados?.tiposCambio
      || catalogosCacheados?.tipos_cambio
      || catalogosCacheados?.tc
      || catalogosCacheados?.catalogoTC
      || catalogoTC
      || []
    );
  }, [catalogoTC, catalogosCacheados]);

  const listaEmpleadosLocal: any[] = empleados;
  const listaUniProvLocal: any[] = unidadesProveedor;
  const listaOpeProvLocal: any[] = proveedoresUnidad;
  const listaMonedasLocal: any[] = catalogoMoneda;

  // ✅ V00129: ACTUALIZAR MONEDA — relee la empresa en Firestore y ajusta
  //   "Facturado En" de este registro a la moneda actual de la tabla Empresas
  //   (útil cuando la moneda del cliente/proveedor cambió después de crear la operación).
  const [actualizandoMoneda, setActualizandoMoneda] = useState<'' | 'cliente' | 'proveedor'>('');
  const actualizarMonedaDesdeEmpresa = async (lado: 'cliente' | 'proveedor') => {
    const empresaId = String(lado === 'cliente' ? formData.clientePaga : formData.proveedorUnidad || '');
    if (!empresaId) { alert(lado === 'cliente' ? 'Primero selecciona el Cliente (Paga).' : 'Primero selecciona el Proveedor de Transporte.'); return; }
    setActualizandoMoneda(lado);
    try {
      const snapE = await getDoc(doc(db, 'empresas', empresaId));
      const emp: any = snapE.exists() ? { id: snapE.id, ...snapE.data() } : (empresas || []).find((e: any) => String(e.id) === empresaId);
      const monId = emp ? resolverMonedaIdDeEmpresa(emp) : '';
      if (!monId) { alert('Esta empresa no tiene moneda registrada en la tabla Empresas. Asígnala en el módulo Empresas y vuelve a intentar.'); return; }
      const nombre = listaMonedasLocal.find((m: any) => String(m.id) === monId)?.moneda || monId;
      setEmpresasLocal(prev => prev.some((e: any) => String(e.id) === empresaId) ? prev.map((e: any) => String(e.id) === empresaId ? { ...e, ...emp } : e) : prev);
      if (lado === 'cliente') setFormData(prev => ({ ...prev, facturadoEnCobrar: monId }));
      else setFormData(prev => ({ ...prev, facturadoEnUnidad: monId }));
      alert(`Facturado En actualizado a "${nombre}" (moneda actual de la empresa).\n\nRecuerda presionar Guardar para que quede en la operación.`);
    } catch (e: any) {
      alert(`No se pudo leer la empresa: ${e?.message || String(e)}`);
    } finally { setActualizandoMoneda(''); }
  };

  const resolverMonedaIdDeEmpresa = (emp: any): string => {
    if (!emp) return '';
    const raw = String(emp.moneda ?? emp.monedaId ?? emp.monedaRef ?? '').trim();
    if (!raw) return '';
    if (listaMonedasLocal.some((m: any) => String(m.id) === raw)) return raw;
    const up = raw.toUpperCase();
    const porTexto = listaMonedasLocal.find((m: any) => {
      const nom = String(m.moneda || '').toUpperCase();
      return nom === up || (!!nom && (nom.includes(up) || up.includes(nom)));
    });
    if (porTexto) return String(porTexto.id);
    if (up.includes('USD') || up.includes('DOLAR') || up.includes('DÓLAR') || up === 'US') return ID_USD;
    if (up.includes('MXN') || up.includes('PESO') || up === 'MX') return ID_MXN;
    return '';
  };

  // ✅ V00130: opciones de moneda para "Facturado En" — SALEN DEL CATÁLOGO de
  //   Monedas (más los ids canónicos por compatibilidad). Antes el <select> solo
  //   tenía los dos ids fijos; si la empresa guardaba OTRO id del catálogo, el
  //   navegador no encontraba la opción y seguía mostrando la selección anterior
  //   ("Actualizar moneda" avisaba Dólares pero se veía Pesos).
  const opcionesFacturadoEn = (): Array<{ id: string; nombre: string }> => {
    const out: Array<{ id: string; nombre: string }> = [];
    const vistos = new Set<string>();
    (listaMonedasLocal || []).forEach((m: any) => { const id = String(m.id); if (!vistos.has(id)) { vistos.add(id); out.push({ id, nombre: String(m.moneda || id) }); } });
    if (!vistos.has(ID_USD)) out.push({ id: ID_USD, nombre: 'Dólares' });
    if (!vistos.has(ID_MXN)) out.push({ id: ID_MXN, nombre: 'Pesos' });
    return out;
  };

  const nombreMoneda = (monedaId: any) =>
    listaMonedasLocal.find((m:any) => String(m.id) === String(monedaId))?.moneda || '';
  const fmtMoney = (n: number) => `$${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  // ✅ V00126: etiqueta del convenio en el dropdown = nombre + monto + moneda
  const etiquetaConvenioCliente = (c: any) => `${c.descripcion || ''} — ${fmtMoney(c.tarifaMonto)}${nombreMoneda(c.monedaMaestro) ? ` ${nombreMoneda(c.monedaMaestro)}` : ''}`;
  const etiquetaConvenioProveedor = (c: any) => `${c.tipoConvenioNombre || ''} — ${fmtMoney(c.tarifaMonto)}${nombreMoneda(c.monedaBase) ? ` ${nombreMoneda(c.monedaBase)}` : ''}`;

  const [tipoCambioDia, setTipoCambioDia] = useState<number | null>(null);
  const [buscandoTC, setBuscandoTC] = useState(false);

  const [searchOrigen, setSearchOrigen] = useState('');
  const [showDropdownOrigen, setShowDropdownOrigen] = useState(false);
  const [searchDestino, setSearchDestino] = useState('');
  const [showDropdownDestino, setShowDropdownDestino] = useState(false);
  const [searchClientePaga, setSearchClientePaga] = useState('');
  const [showDropdownClientePaga, setShowDropdownClientePaga] = useState(false);
  const [searchRemolque, setSearchRemolque] = useState('');
  const [showDropdownRemolque, setShowDropdownRemolque] = useState(false);
  const [searchClienteMercancia, setSearchClienteMercancia] = useState('');
  const [showDropdownClienteMercancia, setShowDropdownClienteMercancia] = useState(false);
  const [searchProvServicios, setSearchProvServicios] = useState('');
  const [showDropdownProvServicios, setShowDropdownProvServicios] = useState(false);
  const [searchProvTransporte, setSearchProvTransporte] = useState('');
  const [showDropdownProvTransporte, setShowDropdownProvTransporte] = useState(false);
  const [searchUnidad, setSearchUnidad] = useState('');

  const [showDropdownUnidad, setShowDropdownUnidad] = useState(false);
  const [searchOperador, setSearchOperador] = useState('');
  const [showDropdownOperador, setShowDropdownOperador] = useState(false);
  const [searchUnidadProveedor, setSearchUnidadProveedor] = useState('');
  const [showDropdownUnidadProveedor, setShowDropdownUnidadProveedor] = useState(false);
  const [searchOperadorProveedor, setSearchOperadorProveedor] = useState('');
  const [showDropdownOperadorProveedor, setShowDropdownOperadorProveedor] = useState(false);
  const [searchConvenio, setSearchConvenio] = useState('');
  const [showDropdownConvenio, setShowDropdownConvenio] = useState(false);
  const [searchConvenioProveedor, setSearchConvenioProveedor] = useState('');
  const [showDropdownConvenioProveedor, setShowDropdownConvenioProveedor] = useState(false);


  const [formData, setFormData] = useState({
    tipoServicio: '', trafico: '', carga: '',
    tipoOperacionId: '',
    fechaServicio: hoyLocalISO(),
    fechaCita: '',
    clientePaga: '', convenio: '', convenioNombre: '', numeroRemolque: '', refCliente: '',
    origen: '', destino: '', kilometrajeEstimado: '', observacionesEjecutivo: '',
    clienteMercancia: '', descripcionMercancia: '', cantidad: '', embalaje: '',
    pesoKg: '', numDoda: '', fechaEmisionDoda: '',
    pdfCartaPorte: null as File | null, pdfDoda: null as File | null,
    numeroEntrys: '', cantEntrys: 0, numManifiesto: '', provServicios: '', montoManifiesto: 0,
    pdfManifiesto: null as File | null, pdfsEntrys: [] as (File | null)[],
    proveedorUnidad: '', facturadoEnUnidad: '', convenioProveedor: '', monedaConvenioProv: '',
    totalAPagarProv: 0, cargosAdicionalesProv: 0, subtotalProv: 0, 
    dolaresProv: 0, pesosProv: 0, conversionProv: 0,
    unidad: '', operador: '', sueldoOperador: 0, sueldoExtra: 0, sueldoTotal: 0, 
    combustible: 0, combustibleExtra: 0, combustibleTotal: 0,
    sueldoExtraNotas: '', combustibleExtraNotas: '',
    puenteId: '', puenteNombre: '', puenteMonto: 0,
    unidadProveedor: '', operadorProveedor: '', observacionesUnidad: '', observacionesCobrar: '',
    totalGastos: 0,
    facturadoEnCobrar: '', monedaConvenioCliente: '', montoConvenioCliente: 0,
    cargosAdicionales: 0, subtotalCliente: 0,
    dolaresCliente: 0, pesosCliente: 0, conversionCliente: 0,
    utilidadEstimada: 0, tipoCambioAprobado: 0
  });

  // ✅ NUEVO — INFO DE LA UNIDAD SELECCIONADA: al elegir unidad se consulta su
  //   ÚLTIMO SERVICIO (operación más reciente) y la ÚLTIMA REFERENCIA DE
  //   DIESEL donde cargó, y se muestran debajo del campo.
  const [infoUnidad, setInfoUnidad] = useState<{ ultimaOpRef?: string; ultimaOpFecha?: string; dieselConsecutivo?: string; dieselFecha?: string; dieselGalones?: number } | null>(null);
  const [cargandoInfoUnidad, setCargandoInfoUnidad] = useState(false);

  useEffect(() => {
    const uid = String(formData.unidad || '').trim();
    if (!uid) { setInfoUnidad(null); return; }
    let cancelado = false;
    (async () => {
      setCargandoInfoUnidad(true);
      try {
        // Último servicio: operaciones de la unidad (campo `unidad` y respaldo
        // `unidadId` en registros viejos), la más reciente por fechaServicio.
        const [s1, s2, sd] = await Promise.all([
          getDocs(query(collection(db, 'operaciones'), where('unidad', '==', uid), limit(300))),
          getDocs(query(collection(db, 'operaciones'), where('unidadId', '==', uid), limit(300))),
          getDocs(query(collection(db, 'referencias_diesel'), where('unidadId', '==', uid), limit(300))),
        ]);
        const opsMap = new Map<string, any>();
        [...s1.docs, ...s2.docs].forEach((d) => opsMap.set(d.id, { id: d.id, ...(d.data() as any) }));
        const ops = Array.from(opsMap.values())
          .filter((o: any) => !initialData?.id || o.id !== initialData.id) // sin contar la que se edita
          .sort((a: any, b: any) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
        const ultimaOp = ops[0] || null;

        const refsDiesel = sd.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))
          .sort((a: any, b: any) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
        const ultimaDiesel = refsDiesel[0] || null;

        if (!cancelado) {
          setInfoUnidad({
            ultimaOpRef: ultimaOp?.ref || '',
            ultimaOpFecha: ultimaOp?.fechaServicio || '',
            dieselConsecutivo: ultimaDiesel?.consecutivo || '',
            dieselFecha: ultimaDiesel?.fecha || '',
            dieselGalones: Number(ultimaDiesel?.galonesCargados || ultimaDiesel?.galonesAutorizados || 0),
          });
        }
      } catch (e) {
        console.warn('No se pudo cargar el historial de la unidad:', e);
        if (!cancelado) setInfoUnidad(null);
      }
      if (!cancelado) setCargandoInfoUnidad(false);
    })();
    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.unidad]);


  const recargarColeccion = useCallback(async (coleccion: string) => {
    const snap = await getDocs(collection(db, coleccion));
    return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
  }, []);

  const aplicarColeccionRecargada = useCallback((coleccion: string, docs: any[]) => {
    if (coleccion === 'empresas') setEmpresasLocal(docs);
    else if (coleccion === 'remolques') setRemolquesLocal(docs);
    else if (coleccion === 'unidades') setUnidadesLocal(docs);
    else if (coleccion === 'empleados') setEmpleadosLocalState(docs);

    try {
      const cacheStr = almacenSesion.getItem('roelca_catalogos_v2');
      if (cacheStr) {
        const cache = JSON.parse(cacheStr);
        if (coleccion === 'empresas') cache.empresas = docs;
        else if (coleccion === 'remolques') cache.remolques = docs;
        else if (coleccion === 'unidades') cache.unidades = docs;
        else if (coleccion === 'empleados') cache.empleados = docs;
        almacenSesion.setItem('roelca_catalogos_v2', JSON.stringify(cache));
      }
    } catch { /* noop */ }

    try {
      // ✅ CORREGIDO: clave v2 (la que leen los dashboards) y sin cachear vacíos.
      if (docs.length > 0) localStorage.setItem(`cat_v2__${coleccion}`, JSON.stringify({ ts: Date.now(), data: docs }));
    } catch { /* noop */ }
  }, []);

  const abrirCreacion = useCallback((
    catalogo: CatalogoCreable,
    onCreado: (nuevoId: string, registro: any) => void
  ) => {
    const listaActual =
      catalogo.coleccion === 'empresas' ? empresasLocal :
      catalogo.coleccion === 'remolques' ? remolquesLocal :
      catalogo.coleccion === 'unidades' ? unidadesLocal :
      empleadosLocalState;
    const idsPrevios = new Set(listaActual.map((r: any) => String(r.id)));
    setModalCatalogo({ catalogo, idsPrevios, onCreado });
  }, [empresasLocal, remolquesLocal, unidadesLocal, empleadosLocalState]);

  const cerrarCreacion = useCallback(async () => {
    if (!modalCatalogo) return;
    const { catalogo, idsPrevios, onCreado } = modalCatalogo;

    setModalCatalogo(null);

    try {
      let docs: any[] = [];
      let nuevos: any[] = [];

      for (let intento = 0; intento < 4; intento++) {
        docs = await recargarColeccion(catalogo.coleccion);
        nuevos = docs.filter((d: any) => !idsPrevios.has(String(d.id)));
        if (nuevos.length > 0) break;
        await new Promise((r) => setTimeout(r, 300));
      }

      aplicarColeccionRecargada(catalogo.coleccion, docs);

      if (nuevos.length >= 1) {
        const elegido = nuevos[nuevos.length - 1];
        onCreado(String(elegido.id), elegido);
      }
    } catch (e) {
      console.error('Error recargando catálogo tras crear:', e);
    }
  }, [modalCatalogo, recargarColeccion, aplicarColeccionRecargada]);

  const nombreCortoEmpresa = (e: any): string => String(
    e?.nombreCorto ?? e?.nombre_corto ?? e?.nombrecorto ?? e?.shortName ?? e?.alias ?? ''
  ).trim();
  const nombreEmpresaMostrar = (e: any): string =>
    nombreCortoEmpresa(e) || e?.nombre || e?.empresa || e?.razonSocial || '';

  const labelEmpresa = (e: any) => nombreEmpresaMostrar(e);
  const labelRemolque = (r: any) => `${r?.nombre || ''} ${r?.placas || r?.placa || ''}`.trim();
  const labelUnidad = (u: any) => u?.unidad || u?.nombre || '';
  const labelEmpleado = (o: any) => `${o?.firstName || ''} ${o?.lastNamePaternal || ''}`.trim();

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'config_flujos_operacion'));
        if (!activo) return;
        setFlujosIndex(snap.docs.map(d => {
          const x = d.data() as any;
          return { id: d.id, tipoServicio: x.tipoServicio || '', trafico: x.trafico || '', carga: x.carga || '' };
        }));
      } catch (e) { console.warn('No se pudo cargar el índice de flujos:', e); }
    })();
    return () => { activo = false; };
  }, []);

  const buildConfigId = () => {
    const tipoOpText = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || 'N/A';
    const traficoTxt = formData.trafico || 'N/A';
    const cargaTxt = formData.carga || 'N/A';

    const idCrudo = `${tipoOpText}_${traficoTxt}_${cargaTxt}`;

    const match = flujosIndex.find(f =>
      normClave(f.tipoServicio) === normClave(tipoOpText) &&
      normClave(f.trafico) === normClave(traficoTxt) &&
      normClave(f.carga) === normClave(cargaTxt)
    );

    const idGenerado = match ? match.id : idCrudo;
    console.log('🔑 configId generado:', idGenerado, match ? '(resuelto por índice)' : '(crudo)');
    return idGenerado;
  };

  const statusPrevioParaCalculo = (): string | undefined => {
    if (!initialData) return undefined;
    const tipoCambiado = String(formData.tipoOperacionId || '') !== String(initialData.tipoOperacionId || '');
    return tipoCambiado ? undefined : initialData?.status;
  };

  // ✅ NUEVO: nombre del status GUARDADO de la operación, siempre visible al editar.
  //    Resuelve por id -> nombre del catálogo; si statusNombre quedó guardado con la
  //    DESCRIPCIÓN (bug previo), la mapea de regreso al nombre correcto.
  const statusActualGuardado = useMemo(() => {
    if (!initialData) return '';
    const lista: any[] = statusServicio || [];
    const idOp = String(initialData.status || '').trim();
    const porId = lista.find((st: any) => String(st.id || '').trim() === idOp);
    if (porId?.nombre) return String(porId.nombre);
    const den = String(initialData.statusNombre || '').trim();
    if (den) {
      const porNombre = lista.find((st: any) => String(st.nombre || '').trim().toLowerCase() === den.toLowerCase());
      if (porNombre?.nombre) return String(porNombre.nombre);
      const porDescripcion = lista.find((st: any) => String(st.descripcion || '').trim() === den);
      if (porDescripcion?.nombre) return String(porDescripcion.nombre);
    }
    const idComoNombre = lista.find((st: any) => String(st.nombre || '').trim().toLowerCase() === idOp.toLowerCase());
    if (idComoNombre?.nombre) return String(idComoNombre.nombre);
    return den || idOp;
  }, [initialData, statusServicio]);

  useEffect(() => {
    let cancelado = false;
    const configId = buildConfigId();

    if (!configId || configId.includes('N/A') || configId === '__' || !formData.tipoOperacionId) {
      setPestanasVisiblesConfig(null);
      setCamposObligatoriosConfig(null);
      return;
    }

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'config_flujos_operacion', configId));
        if (cancelado) return;
        const data = snap.exists() ? (snap.data() as any) : null;
        setPestanasVisiblesConfig(data && Array.isArray(data.pestanasVisibles) ? data.pestanasVisibles : null);
        setCamposObligatoriosConfig(data && Array.isArray(data.camposObligatorios) ? data.camposObligatorios : null);
      } catch {
        if (!cancelado) {
          setPestanasVisiblesConfig(null);
          setCamposObligatoriosConfig(null);
        }
      }
    })();

    return () => { cancelado = true; };
  }, [formData.tipoOperacionId, formData.trafico, formData.carga, tiposOperacion, flujosIndex]);

  const pestanasVisibles = useMemo<TabType[]>(
    () => (pestanasVisiblesConfig === null ? TODAS_LAS_PESTANAS : pestanasVisiblesConfig),
    [pestanasVisiblesConfig]
  );

  useEffect(() => {
    if (pestanasVisibles.length > 0 && !pestanasVisibles.includes(pestañaActiva)) {
      setPestañaActiva(pestanasVisibles[0]);
    }
  }, [pestanasVisibles, pestañaActiva]);

  useEffect(() => {
    const timerId = setTimeout(async () => {
      const configId = buildConfigId();

      if (!configId || configId.includes('N/A') || configId === '__' || !formData.tipoOperacionId) {
        setStatusPreview('');
        setStatusError('Para conocer el Estatus de la operación, primero selecciona el Tipo de Operación, un Cliente y un Convenio válido.');
        setCamposSiguienteStatus([]);
        setNombreSiguienteAuto('');
        return;
      }

      try {
        const statusCalculado = await calcularStatusDinamico(configId, formData, statusPrevioParaCalculo());
        const statusObj = statusServicio?.find((s:any) => s.id === statusCalculado);
        setStatusPreview(statusObj?.nombre || statusObj?.descripcion || statusCalculado);
        setStatusError(null);

        await calcularCamposSiguienteAuto(configId, statusCalculado);
      } catch (error: any) {
        setStatusPreview('');
        setCamposSiguienteStatus([]);
        setNombreSiguienteAuto('');
        const msjLimpio = error.message.replace('BLOQUEO: ', '').replace('', '');
        setStatusError(msjLimpio);
        // ✅ Aunque el cálculo dinámico falle, al EDITAR se arma el checklist
        //    del siguiente status partiendo del status GUARDADO de la operación,
        //    para que "qué falta para avanzar" siempre esté visible.
        if (initialData && statusActualGuardado) {
          try { await calcularCamposSiguienteAuto(configId, statusActualGuardado); } catch { /* sin flujo configurado */ }
        }
      }
    }, 800);

    return () => clearTimeout(timerId);
  }, [formData, initialData, tiposOperacion, statusServicio, flujosIndex]);

  const etiquetaCampo = (campo: string): string => {
    const mapa: Record<string, string> = {
      clientePaga: 'Cliente (Paga)', convenio: 'Convenio', numeroRemolque: '# de Remolque',
      refCliente: 'Ref Cliente', origen: 'Origen', destino: 'Destino',
      clienteMercancia: 'Cliente (Mercancía)', descripcionMercancia: 'Descripción Mercancía',
      cantidad: 'Cantidad', embalaje: 'Embalaje', pesoKg: 'Peso (Kg)', numDoda: '# DODA',
      fechaEmisionDoda: 'Fecha Emisión DODA', pdfCartaPorte: 'PDF Carta Porte', pdfDoda: 'PDF DODA',
      numeroEntrys: "# de Entry's", cantEntrys: "Cantidad de Entry's", numManifiesto: '# Manifiesto',
      provServicios: 'Proveedor de Servicios', montoManifiesto: 'Costo Manifiesto', pdfManifiesto: 'PDF Manifiesto',
      proveedorUnidad: 'Proveedor de Transporte', facturadoEnUnidad: 'Facturado En (Unidad)',
      convenioProveedor: 'Convenio Proveedor', totalAPagarProv: 'Monto a Pagar Proveedor',
      unidad: 'Unidad', operador: 'Operador', sueldoOperador: 'Sueldo Operador',
      combustible: 'Combustible', unidadProveedor: 'Unidad del Proveedor', operadorProveedor: 'Operador del Proveedor',
      facturadoEnCobrar: 'Facturado En (Cobrar)', montoConvenioCliente: 'Monto Convenio Cliente',
      fechaServicio: 'Fecha de Servicio', fechaCita: 'Fecha de Cita',
    };
    return mapa[campo] || campo;
  };

  const camposObligatoriosFaltantes = useMemo(() => {
    const lista = camposObligatoriosConfig || [];
    if (lista.length === 0) return [] as { campo: string; etiqueta: string }[];

    const esVacio = (valor: any): boolean => {
      if (valor === undefined || valor === null) return true;
      if (Array.isArray(valor)) return valor.length === 0 || valor.every((v: any) => !v);
      return String(valor).trim() === '';
    };

    return lista
      .filter(campo => {
        const tab = CAMPO_TAB_MAP[campo];
        return !tab || pestanasVisibles.includes(tab);
      })
      .filter(campo => esVacio((formData as any)[campo]))
      .map(campo => ({ campo, etiqueta: etiquetaCampo(campo) }));
  }, [camposObligatoriosConfig, pestanasVisibles, formData]);

  const camposObligatoriosFaltantesSet = useMemo(
    () => new Set(camposObligatoriosFaltantes.map(f => f.campo)),
    [camposObligatoriosFaltantes]
  );

  const claseSiFalta = (campoId: string): string =>
    camposObligatoriosFaltantesSet.has(campoId) ? ' campo-obligatorio-faltante' : '';

  const calcularCamposSiguienteAuto = async (configId: string, statusActual: string) => {
    try {
      const snap = await getDoc(doc(db, 'config_flujos_operacion', configId));
      if (!snap.exists() || !snap.data().flujo) { setCamposSiguienteStatus([]); setNombreSiguienteAuto(''); return; }
      const reglas = snap.data().flujo as any[];

      const norm = (s: string) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
      const reglaActual = reglas.find(r => r.nombreStatus === statusActual) || reglas.find(r => norm(r.nombreStatus) === norm(statusActual));
      if (!reglaActual) { setCamposSiguienteStatus([]); setNombreSiguienteAuto(''); return; }

      const idsSiguientes: string[] = reglaActual.opcionesSiguientes || [];
      const siguienteAuto = idsSiguientes
        .map(id => reglas.find(r => r.id === id))
        .filter((r: any) => r && r.tipoMecanismo === 'automatico')
        .sort((a: any, b: any) => a.orden - b.orden)[0];

      if (!siguienteAuto) { setCamposSiguienteStatus([]); setNombreSiguienteAuto(''); return; }

      const campos: string[] = siguienteAuto.camposRequeridos || [];
      const lista = campos.map((campo: string) => {
        const valor = (formData as any)[campo];
        const cumplido = valor !== undefined && valor !== null && String(valor).trim() !== '';
        return { campo, etiqueta: etiquetaCampo(campo), cumplido };
      });
      setNombreSiguienteAuto(siguienteAuto.nombreStatus || '');
      setCamposSiguienteStatus(lista);
    } catch {
      setCamposSiguienteStatus([]);
      setNombreSiguienteAuto('');
    }
  };

  useEffect(() => {
    const sOp = Number(formData.sueldoOperador) || 0;
    const sExt = Number(formData.sueldoExtra) || 0;
    setFormData(prev => ({ ...prev, sueldoTotal: sOp + sExt }));
  }, [formData.sueldoOperador, formData.sueldoExtra]);

  useEffect(() => {if (formData.tipoOperacionId !== TIPO_OP_PROVEEDOR_FIJO) return;
    if (formData.proveedorUnidad === PROVEEDOR_FIJO_ID) return;
    const prov = empresas.find((e: any) => String(e.id) === PROVEEDOR_FIJO_ID);
    setFormData(prev => ({
      ...prev,
      proveedorUnidad: PROVEEDOR_FIJO_ID,
      convenioProveedor: '',
      facturadoEnUnidad: resolverMonedaIdDeEmpresa(prov) || prev.facturadoEnUnidad,
    }));
    if (prov) setSearchProvTransporte(prov.nombre || '');
  }, [formData.tipoOperacionId, empresas]);

  useEffect(() => {
    // ✅ Combustible siempre en números ENTEROS.
    const cBase = Math.round(Number(formData.combustible) || 0);
    const cExt = Math.round(Number(formData.combustibleExtra) || 0);
    setFormData(prev => ({ ...prev, combustibleTotal: cBase + cExt }));
  }, [formData.combustible, formData.combustibleExtra]);

  useEffect(() => {
    const manifiesto = Number(formData.montoManifiesto) || 0;
    const sueldo = Number(formData.sueldoTotal) || 0;
    setFormData(prev => ({ ...prev, totalGastos: manifiesto + sueldo }));
  }, [formData.montoManifiesto, formData.sueldoTotal]);

  useEffect(() => {
    if (initialData && empresas && remolques) {
      const safeInitialData = {
        ...initialData,
        fechaServicio: normalizarFechaISO(initialData.fechaServicio),
        fechaEmisionDoda: normalizarFechaISO(initialData.fechaEmisionDoda),
        fechaCita: initialData.fechaCita || '',
        pdfsEntrys: initialData.pdfsEntrys || [],
        numeroEntrys: initialData.numeroEntrys || '', 
        cantEntrys: Number(initialData.cantEntrys) || 0,
        montoManifiesto: Number(initialData.montoManifiesto) || 0, 
        totalAPagarProv: Number(initialData.totalAPagarProv) || 0,
        cargosAdicionalesProv: Number(initialData.cargosAdicionalesProv) || 0,
        cargosAdicionales: Number(initialData.cargosAdicionales) || 0,
        sueldoOperador: Number(initialData.sueldoOperador) || 0, 
        sueldoExtra: Number(initialData.sueldoExtra) || 0,        
        combustible: Math.round(Number(initialData.combustible) || 0),        
        combustibleExtra: Math.round(Number(initialData.combustibleExtra) || 0),  
        unidadProveedor: initialData.unidadProveedor || '',
        operadorProveedor: initialData.operadorProveedor || '',
        sueldoExtraNotas: initialData.sueldoExtraNotas || '',
        combustibleExtraNotas: initialData.combustibleExtraNotas || '',
        observacionesUnidad: initialData.observacionesUnidad || '',
        observacionesCobrar: initialData.observacionesCobrar || '',     
        totalGastos: Number(initialData.totalGastos) || 0,
        puenteId: initialData.puenteId || initialData.puente || '',
        puenteNombre: initialData.puenteNombre || '',
        puenteMonto: Number(initialData.puenteMonto) || 0,
      };

      setFormData(prev => ({ ...prev, ...safeInitialData }));

      const getNombreEmpresa = (id: string) => {
        if (!id) return '';
        const item = empresas.find((e: any) => e.id === id);
        return item ? (nombreEmpresaMostrar(item) || id) : id;
      };
      const getNombreRemolque = (id: string) => {
        if (!id) return '';
        const item = remolques.find((r: any) => r.id === id);
        return item ? `${item.nombre || ''} ${item.placas || item.placa || ''}`.trim() : id;
      };
      const getNombreOperador = (id: string) => {
        if (!id) return '';
        const item = listaEmpleadosLocal.find((e: any) => e.id === id);
        return item ? `${item.firstName || ''} ${item.lastNamePaternal || ''}`.trim() : id;
      };
      const getNombreUnidad = (id: string) => {
        if (!id) return '';
        const item = unidades.find((u: any) => u.id === id);
        return item ? item.unidad || item.nombre : id;
      };

      const remIdGuardado = String(
        initialData.numeroRemolque || initialData.remolque || initialData.remolqueId || initialData.numero_remolque || ''
      ).trim();

      setSearchClientePaga(initialData.clienteNombre || getNombreEmpresa(initialData.clientePaga));
      setSearchOrigen(initialData.origenNombre || getNombreEmpresa(initialData.origen));
      setSearchDestino(initialData.destinoNombre || getNombreEmpresa(initialData.destino));
      setSearchClienteMercancia(initialData.clienteMercanciaNombre || getNombreEmpresa(initialData.clienteMercancia));
      setSearchProvServicios(initialData.provServiciosNombre || getNombreEmpresa(initialData.provServicios));
      setSearchProvTransporte(initialData.proveedorUnidadNombre || getNombreEmpresa(initialData.proveedorUnidad));
      setSearchRemolque(initialData.remolqueNombre || getNombreRemolque(remIdGuardado) || initialData.remolquePlaca || ''); 
      setSearchUnidad(initialData.unidadNombre || getNombreUnidad(initialData.unidad));
      setSearchOperador(initialData.operadorNombre || getNombreOperador(initialData.operador));

      const uProv = listaUniProvLocal.find((e: any) => e.id === initialData.unidadProveedor);
      setSearchUnidadProveedor(initialData.unidadProveedorNombre || (uProv ? (uProv.numeroUnidad || uProv.numero_unidad || uProv.unidad || uProv.placas) : initialData.unidadProveedor || ''));
      const opProv = listaOpeProvLocal.find((e: any) => e.id === initialData.operadorProveedor);
      setSearchOperadorProveedor(initialData.operadorProveedorNombre || (opProv ? (opProv.nombre || opProv.nombres || opProv.nombreCompleto) : initialData.operadorProveedor || ''));
      setSearchConvenio(initialData.convenioNombre || '');
      setSearchConvenioProveedor(initialData.convenioProveedorNombre || '');
      setReferencia(initialData.ref || (initialData as any).referencia || '');
    }
  }, [initialData, empresas, remolques, unidades, listaEmpleadosLocal, listaUniProvLocal, listaOpeProvLocal]);

  // ✅ FIX TIPO DE CAMBIO: al colocar la fecha busca el TC de forma TOLERANTE al
  //   formato (Timestamp/ISO/DD-MM-YYYY, etc.). Si no está en memoria lo trae
  //   DIRECTO de Firestore y lo autocompleta.
  useEffect(() => {
    if (!formData.fechaServicio) return;

    let cancelado = false;
    setBuscandoTC(true);

    const objetivoISO = normalizarFechaISO(formData.fechaServicio);

    const buscarEn = (fuente: any[]): number | null => {
      for (const row of (Array.isArray(fuente) ? fuente : [])) {
        if (filaTCEsDeLaFecha(row, objetivoISO)) {
          const r = extraerRateDeFilaTC(row);
          if (r !== null) return r;
        }
      }
      return null;
    };

    (async () => {
      if (!objetivoISO) { if (!cancelado) { setTipoCambioDia(null); setBuscandoTC(false); } return; }

      let tcEncontrado = buscarEn(catalogoTCResuelto);

      if (tcEncontrado === null) {
        try {
          const respaldo = await cargarCatalogoTCRespaldo();
          if (!cancelado) tcEncontrado = buscarEn(respaldo);
        } catch { /* noop */ }
      }

      if (cancelado) return;

      setTipoCambioDia(tcEncontrado);

      const fechaInicialISO = normalizarFechaISO(initialData?.fechaServicio);
      if (tcEncontrado !== null && (!initialData || objetivoISO !== fechaInicialISO)) {
        setFormData(prev => ({ ...prev, tipoCambioAprobado: tcEncontrado as number }));
      }
      setBuscandoTC(false);
    })();

    return () => { cancelado = true; };
  }, [formData.fechaServicio, catalogoTCResuelto, initialData]);

  const refMaestroDetalle = (d: any): string => String(
    d.convenioId ?? d.convenio ?? d.id_convenio ?? d.convenioClienteId ?? d.convenioProveedorId ??
    d.maestroId ?? d.padreId ?? d.convenio_id ?? ''
  ).trim();
  const ownerClienteDetalle = (d: any): string => String(
    d.clienteId ?? d.cliente ?? d.id_cliente ?? d.clientePaga ?? d.empresaId ?? ''
  ).trim();
  const ownerProvDetalle = (d: any): string => String(
    d.proveedorId ?? d.proveedor ?? d.id_proveedor ?? d.empresaId ?? ''
  ).trim();
  const montoDetalle = (d: any): number => Number(
    d.tarifa ?? d.monto ?? d.precio ?? d.importe ?? d.costo ?? d.montoConvenio ?? d.monto_convenio ??
    d.tarifaMonto ?? d.valor ?? 0
  ) || 0;

  const listaConveniosCliente = useMemo(() => {
    let clientId = formData.clientePaga;
    if (!clientId && searchClientePaga && empresas) {
      const emp = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchClientePaga.toLowerCase().trim());
      if (emp) clientId = emp.id;
    }
    if (!clientId || !catalogoConvClientes || !catalogoConvDetalles) {
      const convId = String(initialData?.convenio || '').trim();
      if (initialData && convId) {
        return [{
          id: convId,
          tarifaBaseId: '',
          descripcion: initialData.convenioNombre || 'Convenio guardado',
          monedaMaestro: initialData.monedaConvenioCliente || ID_USD,
          tarifaMonto: Number(initialData.montoConvenioCliente) || 0,
        }];
      }
      return [];
    }
    const cid = String(clientId).trim();

    const maestros = catalogoConvClientes.filter((c: any) => String(
      c.clienteId ?? c.cliente ?? c.id_cliente ?? c.clientePaga ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === cid);
    const maestroIds = new Set<string>();
    maestros.forEach((m: any) => {
      if (m.id != null) maestroIds.add(String(m.id).trim());
      const nc = String(m.numeroConvenio ?? '').trim(); if (nc) maestroIds.add(nc);
      const nm = String(m.numero ?? '').trim(); if (nm) maestroIds.add(nm);
    });

    const union = new Map<string, any>();
    catalogoConvDetalles.forEach((d: any) => {
      const ref = refMaestroDetalle(d);
      const directo = ownerClienteDetalle(d);
      if ((ref && maestroIds.has(ref)) || (directo && directo === cid)) {
        union.set(String(d.id), d);
      }
    });
    const detallesAsociados = Array.from(union.values());

    const lista = detallesAsociados.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio_id || d.tipoConvenio || d.tipo_convenio || d.tarifaId || d.tarifa_id || d['TIPO DE CONVENIO'];
      const tObj = tarifas?.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const ref = refMaestroDetalle(d);
      const maestroAsociado = maestros.find((m: any) =>
        String(m.id).trim() === ref ||
        String(m.numeroConvenio ?? '').trim() === ref ||
        String(m.numero ?? '').trim() === ref
      );
      const nombreTarifa = tObj?.descripcion || tObj?.nombre || tObj?.tarifa || tObj?.concepto || tObj?.tipo;
      const nombreFinal = d.tipoConvenioNombre || nombreTarifa || (tarifaId ? `Tarifa (${tarifaId})` : 'Sin Asignar');
      return {
        ...d,
        id: d.id, tarifaBaseId: tarifaId, descripcion: nombreFinal,
        // ✅ V00126: la moneda del DETALLE manda (se resuelve a id de catálogo aunque venga como texto "Pesos"/"Dólares")
        monedaMaestro: resolverMonedaIdDeEmpresa({ moneda: d.moneda }) || maestroAsociado?.monedaId || maestroAsociado?.moneda || ID_USD,
        tarifaMonto: montoDetalle(d),
      };
    });

    const convGuardadoId = String(initialData?.convenio || '').trim();
    if (initialData && convGuardadoId && !lista.some((c: any) => String(c.id) === convGuardadoId)) {
      const detReal = (catalogoConvDetalles || []).find((d: any) => String(d.id) === convGuardadoId);
      const tarifaId = detReal ? (detReal.tipoConvenioId || detReal.tipo_convenio_id || detReal.tipoConvenio || detReal.tipo_convenio || detReal.tarifaId || detReal.tarifa_id || detReal['TIPO DE CONVENIO']) : '';
      lista.push({
        ...(detReal || {}),
        id: convGuardadoId,
        tarifaBaseId: tarifaId,
        descripcion: initialData.convenioNombre || (detReal as any)?.tipoConvenioNombre || 'Convenio guardado',
        monedaMaestro: initialData.monedaConvenioCliente || resolverMonedaIdDeEmpresa({ moneda: (detReal as any)?.moneda }) || ID_USD,
        tarifaMonto: Number(initialData.montoConvenioCliente ?? montoDetalle(detReal || {})) || 0,
      });
    }

    return lista;
  }, [formData.clientePaga, searchClientePaga, catalogoConvClientes, catalogoConvDetalles, tarifas, empresas, initialData]);

  const listaConveniosProveedor = useMemo(() => {
    let provId = formData.proveedorUnidad;
    if (!provId && searchProvTransporte && empresas) {
      const prov = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchProvTransporte.toLowerCase().trim());
      if (prov) provId = prov.id;
    }
    if (!provId || !conveniosProv || !Array.isArray(conveniosProv)) {
      const convProvId = String(initialData?.convenioProveedor || '').trim();
      if (initialData && convProvId) {
        return [{
          id: convProvId,
          tarifaBaseId: '',
          tipoConvenioNombre: initialData.convenioProveedorNombre || 'Convenio guardado',
          monedaBase: initialData.monedaConvenioProv || ID_USD,
          tarifaMonto: Number(initialData.totalAPagarProv) || 0,
        }];
      }
      return [];
    }
    const pid = String(provId).trim();

    const maestrosAsociados = conveniosProv.filter((c: any) => String(
      c.proveedorId ?? c.proveedor ?? c.id_proveedor ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === pid);
    const maestroIds = new Set(maestrosAsociados.map((m: any) => String(m.id).trim()));

    const union = new Map<string, any>();
    (catalogoConvProvDetalles || []).forEach((d: any) => {
      const ref = refMaestroDetalle(d);
      const directo = ownerProvDetalle(d);
      if ((ref && maestroIds.has(ref)) || (directo && directo === pid)) {
        union.set(String(d.id), d);
      }
    });
    const detallesAsociados = Array.from(union.values());

    const lista = detallesAsociados.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio || d.tipoConvenio || d.tarifaId || d.tarifa_id || d['TIPO DE CONVENIO'];
      const tObj = tarifas?.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const ref = refMaestroDetalle(d);
      const maestroParent = maestrosAsociados.find((m: any) => String(m.id).trim() === ref);
      const nombreFinal = tObj?.descripcion || tObj?.nombre || tObj?.tarifa || tObj?.concepto || d.tipoConvenioNombre || 'Concepto sin nombre';
      return {
        ...d,
        id: d.id, tarifaBaseId: tarifaId, tipoConvenioNombre: nombreFinal,
        // ✅ V00126: la moneda del DETALLE manda (se resuelve a id de catálogo aunque venga como texto)
        monedaBase: resolverMonedaIdDeEmpresa({ moneda: d.moneda }) || maestroParent?.monedaId || maestroParent?.moneda || ID_USD,
        tarifaMonto: montoDetalle(d),
      };
    });

    const convProvGuardadoId = String(initialData?.convenioProveedor || '').trim();
    if (initialData && convProvGuardadoId && !lista.some((c: any) => String(c.id) === convProvGuardadoId)) {
      const detReal = (catalogoConvProvDetalles || []).find((d: any) => String(d.id) === convProvGuardadoId);
      const tarifaId = detReal ? (detReal.tipoConvenioId || detReal.tipo_convenio || detReal.tipoConvenio || detReal.tarifaId || detReal.tarifa_id || detReal['TIPO DE CONVENIO']) : '';
      lista.push({
        ...(detReal || {}),
        id: convProvGuardadoId,
        tarifaBaseId: tarifaId,
        tipoConvenioNombre: initialData.convenioProveedorNombre || (detReal as any)?.tipoConvenioNombre || 'Convenio guardado',
        monedaBase: initialData.monedaConvenioProv || resolverMonedaIdDeEmpresa({ moneda: (detReal as any)?.moneda }) || ID_USD,
        tarifaMonto: Number(initialData.totalAPagarProv ?? montoDetalle(detReal || {})) || 0,
      });
    }

    return lista;
  }, [formData.proveedorUnidad, searchProvTransporte, conveniosProv, catalogoConvProvDetalles, tarifas, empresas, initialData]);

  useEffect(() => {
    if (!initialData) return;
    if (!formData.convenio) return;
    if (searchConvenio && searchConvenio.trim()) return;
    const conv = listaConveniosCliente.find((c: any) => String(c.id) === String(formData.convenio));
    const nombre = conv ? etiquetaConvenioCliente(conv) : (initialData.convenioNombre || '');
    if (nombre) setSearchConvenio(nombre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, formData.convenio, searchConvenio, listaConveniosCliente]);

  useEffect(() => {
    if (!initialData) return;
    if (!formData.convenioProveedor) return;
    if (searchConvenioProveedor && searchConvenioProveedor.trim()) return;
    const conv = listaConveniosProveedor.find((c: any) => String(c.id) === String(formData.convenioProveedor));
    const nombre = conv ? etiquetaConvenioProveedor(conv) : (initialData.convenioProveedorNombre || '');
    if (nombre) setSearchConvenioProveedor(nombre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, formData.convenioProveedor, searchConvenioProveedor, listaConveniosProveedor]);

  useEffect(() => {
    if (!initialData) return;
    if (searchRemolque && searchRemolque.trim()) return;
    const remId = String(
      initialData.numeroRemolque || initialData.remolque || initialData.remolqueId || initialData.numero_remolque || ''
    ).trim();
    if (initialData.remolqueNombre) { setSearchRemolque(initialData.remolqueNombre); return; }
    if (!remId) return;
    const item = (remolques || []).find((r: any) => String(r.id) === remId);
    if (item) {
      setSearchRemolque(`${item.nombre || ''} ${item.placas || item.placa || ''}`.trim() || remId);
    } else {
      setSearchRemolque(initialData.remolquePlaca || remId);
    }
    if (!formData.numeroRemolque) setFormData(prev => ({ ...prev, numeroRemolque: remId }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, remolques, searchRemolque, formData.numeroRemolque]);

  const clientePagaIdResuelto = useMemo(() => {
    let clientId = formData.clientePaga;
    if (!clientId && searchClientePaga && empresas) {
      const emp = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchClientePaga.toLowerCase().trim());
      if (emp) clientId = emp.id;
    }
    return String(clientId || '').trim();
  }, [formData.clientePaga, searchClientePaga, empresas]);

  const convenioClienteMaestroId = useMemo(() => {
    if (!clientePagaIdResuelto || !catalogoConvClientes) return '';
    const maestro = catalogoConvClientes.find((c: any) => String(
      c.clienteId ?? c.cliente ?? c.id_cliente ?? c.clientePaga ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === clientePagaIdResuelto);
    return maestro ? String(maestro.id) : '';
  }, [clientePagaIdResuelto, catalogoConvClientes]);

  const proveedorIdResuelto = useMemo(() => {
    let provId = formData.proveedorUnidad;
    if (!provId && searchProvTransporte && empresas) {
      const prov = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchProvTransporte.toLowerCase().trim());
      if (prov) provId = prov.id;
    }
    return String(provId || '').trim();
  }, [formData.proveedorUnidad, searchProvTransporte, empresas]);

  const convenioProvMaestroId = useMemo(() => {
    if (!proveedorIdResuelto || !conveniosProv) return '';
    const maestro = conveniosProv.find((c: any) => String(
      c.proveedorId ?? c.proveedor ?? c.id_proveedor ?? c.empresaId ?? c.empresa ?? ''
    ).trim() === proveedorIdResuelto);
    return maestro ? String(maestro.id) : '';
  }, [proveedorIdResuelto, conveniosProv]);

  useEffect(() => {
    if (!pestanasVisibles.includes('unidad')) return;
    if (!formData.convenio) return;

    const _tipoTxt = (tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '').toLowerCase();
    const _isTransfer = _tipoTxt.includes('transfer');
    const _isLog = _tipoTxt.includes('logistica') || _tipoTxt.includes('logística');
    const _isFle = _tipoTxt.includes('fletes') || _tipoTxt.includes('flete');
    const _isRoelcaProv = searchProvTransporte.toLowerCase().includes('roelca');
    if (_isTransfer || ((_isLog || _isFle) && _isRoelcaProv)) return;

    if (formData.convenioProveedor) return;

    const convCliente = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
    if (!convCliente) return;
    const tarifaCliente = String(convCliente.tarifaBaseId ?? '').trim();
    if (!tarifaCliente) return;

    if (!(formData.proveedorUnidad || searchProvTransporte)) return;

    const convProvMatch = listaConveniosProveedor.find(
      (c: any) => String(c.tarifaBaseId ?? '').trim() === tarifaCliente
    );

    if (convProvMatch) {
      setFormData(prev => ({
        ...prev,
        convenioProveedor: convProvMatch.id,
        monedaConvenioProv: convProvMatch.monedaBase,
        totalAPagarProv: convProvMatch.tarifaMonto,
      }));
      setSearchConvenioProveedor(convProvMatch.tipoConvenioNombre);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pestanasVisibles, formData.convenio, formData.convenioProveedor, formData.proveedorUnidad, searchProvTransporte, listaConveniosCliente, listaConveniosProveedor]);

  const resolverNombreTrafico = useCallback(async (movRaw: any): Promise<string> => {
    const valor = String(movRaw || '').trim();
    if (!valor) return 'N/A';

    if (traficoCache.has(valor)) return traficoCache.get(valor)!;

    const enMemoria = catalogoTrafico.find((t: any) => String(t.id) === valor);
    if (enMemoria) {
      const nombre = enMemoria.nombre || valor;
      traficoCache.set(valor, nombre);
      return nombre;
    }

    try {
      const snap = await getDoc(doc(db, 'catalogo_trafico', valor));
      if (snap.exists()) {
        const nombre = snap.data().nombre || valor;
        traficoCache.set(valor, nombre);
        return nombre;
      }
    } catch { /* noop */ }

    traficoCache.set(valor, valor);
    return valor;
  }, [catalogoTrafico]);

  useEffect(() => {
    const resolverFlujo = async () => {
      if (!formData.convenio) return;
      try {
        const detalleElegido = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
        if (!detalleElegido) return;
        setFormData(prev => ({ ...prev, monedaConvenioCliente: detalleElegido.monedaMaestro, montoConvenioCliente: detalleElegido.tarifaMonto }));
        const tarifaObj = tarifas?.find((t: any) => t.id === detalleElegido.tarifaBaseId);
        if (!tarifaObj) return;
        const tipoOpId = String(tarifaObj.tipo_operacion);
        let tipoData = tipoTarifarioCache.get(tipoOpId);
        if (!tipoData) {
          const tipoRef = doc(db, 'catalogo_tipos_tarifarios', tipoOpId);
          const tipoSnap = await getDoc(tipoRef);
          if (tipoSnap.exists()) { tipoData = tipoSnap.data(); tipoTarifarioCache.set(tipoOpId, tipoData); }
        }
        if (tipoData) {
          const nombreTrafico = await resolverNombreTrafico(tipoData.movimiento);
          setFormData(prev => ({
            ...prev,
            tipoServicio: tipoData.descripcion || 'N/A',
            trafico: nombreTrafico,
            carga: tarifaObj.estado_carga || 'N/A'
          }));
        }
      } catch (error) { console.error('Error resolviendo flujo:', error); }
    };
    if (!initialData) resolverFlujo();
  }, [formData.convenio, listaConveniosCliente, tarifas, initialData, resolverNombreTrafico]);

  useEffect(() => {
    if (!initialData) return;
    if (!formData.convenio) return;

    // ✅ Si el usuario CAMBIÓ el convenio respecto al que traía la operación,
    //   tráfico / carga / tipo de servicio se RE-DERIVAN y sobrescriben (antes
    //   solo se rellenaban cuando venían vacíos, y al cambiar el convenio se
    //   quedaban los valores del convenio anterior). Si el convenio no cambió,
    //   se conserva el comportamiento de solo completar faltantes.
    const convenioCambiado = String(formData.convenio) !== String(initialData.convenio || '');

    const traficoOk = formData.trafico && formData.trafico !== 'N/A';
    const cargaOk = formData.carga && formData.carga !== 'N/A';
    if (!convenioCambiado && traficoOk && cargaOk) return;

    let cancelado = false;
    (async () => {
      const detalle = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
      if (!detalle) return;
      const tarifaObj = tarifas?.find((t: any) => String(t.id) === String(detalle.tarifaBaseId));
      if (!tarifaObj) return;

      const tipoOpId = String(tarifaObj.tipo_operacion);
      let tipoData = tipoTarifarioCache.get(tipoOpId);
      if (!tipoData) {
        try {
          const tipoSnap = await getDoc(doc(db, 'catalogo_tipos_tarifarios', tipoOpId));
          if (tipoSnap.exists()) { tipoData = tipoSnap.data(); tipoTarifarioCache.set(tipoOpId, tipoData); }
        } catch { /* noop */ }
      }
      if (cancelado || !tipoData) return;

      const nombreTrafico = await resolverNombreTrafico(tipoData.movimiento);
      if (cancelado) return;

      setFormData(prev => {
        const nuevoTipo = convenioCambiado
          ? (tipoData.descripcion || 'N/A')
          : (prev.tipoServicio || tipoData.descripcion || 'N/A');
        const nuevoTrafico = convenioCambiado
          ? nombreTrafico
          : ((prev.trafico && prev.trafico !== 'N/A') ? prev.trafico : nombreTrafico);
        const nuevaCarga = convenioCambiado
          ? (tarifaObj.estado_carga || 'N/A')
          : ((prev.carga && prev.carga !== 'N/A') ? prev.carga : (tarifaObj.estado_carga || 'N/A'));
        // Guard anti-bucle: si nada cambia, no se dispara otro render.
        if (prev.tipoServicio === nuevoTipo && prev.trafico === nuevoTrafico && prev.carga === nuevaCarga) return prev;
        return { ...prev, tipoServicio: nuevoTipo, trafico: nuevoTrafico, carga: nuevaCarga };
      });
    })();

    return () => { cancelado = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, formData.convenio, formData.trafico, formData.carga, listaConveniosCliente, tarifas, resolverNombreTrafico]);

  useEffect(() => {
    if (initialData) return;
    if (!formData.convenio) return;

    const convCliente = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
    if (!convCliente) return;
    const tarifaBase = String(convCliente.tarifaBaseId ?? '').trim();
    if (!tarifaBase) return;

    const filaSueldo = gastosIncluidosLocal.find((g: any) => {
      const ref = String(
        g.tarifa_referencia_id ?? g.tarifaReferenciaId ?? g.tarifa_referencia ?? g.tarifaReferencia ??
        g.ID_SERVICES ?? g.id_services ?? g.idServices ?? g.tarifaId ?? ''
      ).trim();
      const gastoId = String(g.gasto ?? g.gastoId ?? g.gasto_id ?? '').trim();
      return ref === tarifaBase && gastoId === ID_GASTO_SUELDO;
    });
    const sueldo = filaSueldo ? Number(filaSueldo.monto ?? filaSueldo.importe ?? filaSueldo.cantidad ?? filaSueldo.valor ?? 0) : null;

    const filaRend = rendimientoLocal.find((r: any) => {
      const ref = String(r.ID_SERVICES ?? r.id_services ?? r.idServices ?? r.tarifa_referencia_id ?? r.tarifaId ?? '').trim();
      return ref === tarifaBase;
    });
    const combustible = filaRend ? Number(filaRend.Quantity ?? filaRend.quantity ?? filaRend.QUANTITY ?? filaRend.cantidad ?? 0) : null;

    if ((sueldo === null || isNaN(sueldo)) && (combustible === null || isNaN(combustible))) return;

    setFormData(prev => ({
      ...prev,
      ...(sueldo !== null && !isNaN(sueldo) ? { sueldoOperador: sueldo } : {}),
      ...(combustible !== null && !isNaN(combustible) ? { combustible: Math.round(combustible) } : {}),
    }));
  }, [formData.convenio, listaConveniosCliente, gastosIncluidosLocal, rendimientoLocal, initialData]);

  // ✅ Desglose Dólares/Pesos/Conversión considerando la MONEDA DEL CONVENIO y
  //   la MONEDA DE LA FACTURA (pueden ser distintas):
  //   - Convenio USD + Factura USD: Dólares = monto; Conversión = monto × TC.
  //   - Convenio USD + Factura MXN: se CONVIERTE → Pesos = monto × TC y
  //     Conversión = monto × TC (el monto en dólares NUNCA va en pesos directo).
  //   - Convenio MXN + Factura MXN: Pesos = monto; Conversión = monto directo.
  //   - Convenio MXN + Factura USD: Dólares = monto ÷ TC; Conversión = monto (ya es MXN).
  //   Si la moneda del convenio no se identifica, se usa la de la factura (regla anterior).
  const esMonedaUSD = (id: any) => id === ID_USD || (listaMonedasLocal.find((m: any) => m.id === id)?.moneda || '').toUpperCase().includes('USD') || (listaMonedasLocal.find((m: any) => m.id === id)?.moneda || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().includes('DOLAR');
  const esMonedaMXN = (id: any) => id === ID_MXN || (listaMonedasLocal.find((m: any) => m.id === id)?.moneda || '').toUpperCase().includes('MXN') || (listaMonedasLocal.find((m: any) => m.id === id)?.moneda || '').toUpperCase().includes('PESO');
  const desglosarPorMonedas = (subtotal: number, tc: number, monConvenio: any, monFactura: any) => {
    let dol = 0, pes = 0, conv = 0;
    const convUSD = esMonedaUSD(monConvenio), convMXN = esMonedaMXN(monConvenio);
    const factUSD = esMonedaUSD(monFactura), factMXN = esMonedaMXN(monFactura);
    const cUSD = convUSD || (!convMXN && factUSD);
    const cMXN = convMXN || (!convUSD && factMXN);
    if (cUSD && factMXN) { dol = 0; pes = subtotal * tc; conv = subtotal * tc; }
    else if (cUSD) { dol = subtotal; pes = 0; conv = subtotal * tc; }
    else if (cMXN && factUSD) { dol = tc > 0 ? subtotal / tc : 0; pes = 0; conv = subtotal; }
    else if (cMXN) { dol = 0; pes = subtotal; conv = subtotal; }
    return { dol, pes, conv };
  };

  // ✅ V00126: MONTO DEL CONVENIO EXPRESADO EN LA MONEDA DE LA FACTURA.
  //   - Convenio USD + Factura MXN → monto × TC
  //   - Convenio MXN + Factura USD → monto ÷ TC
  //   - Misma moneda (o no identificada) → monto sin cambios
  //   Sin redondeo: el valor se guarda y muestra tal cual resulta de la operación.
  const convertirAMonedaFactura = (monto: number, tc: number, monConvenio: any, monFactura: any): { monto: number; convertido: boolean; sinTC: boolean } => {
    const m = Number(monto) || 0;
    const convUSD = esMonedaUSD(monConvenio), convMXN = esMonedaMXN(monConvenio);
    const factUSD = esMonedaUSD(monFactura), factMXN = esMonedaMXN(monFactura);
    if (convUSD && factMXN) return { monto: tc > 0 ? m * tc : 0, convertido: true, sinTC: !(tc > 0) };
    if (convMXN && factUSD) return { monto: tc > 0 ? m / tc : 0, convertido: true, sinTC: !(tc > 0) };
    return { monto: m, convertido: false, sinTC: false };
  };

  useEffect(() => {
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.totalAPagarProv || 0) + Number(formData.cargosAdicionalesProv || 0);
    // ✅ CORREGIDO: si la moneda del convenio del PROVEEDOR quedó VACÍA, se toma
    //   la del convenio elegido y, en último término, USD (igual que el lado del
    //   cliente). Antes, con la moneda vacía y el pago facturado en Pesos, el
    //   desglose caía al caso "pesos" y NO multiplicaba por el TC: "Pesos (Prov)"
    //   y "Conversión (MXN)" quedaban con el monto en dólares sin convertir.
    let monConvProv: any = formData.monedaConvenioProv;
    if (!monConvProv) {
      const detConvProv = listaConveniosProveedor.find((c: any) => String(c.id) === String(formData.convenioProveedor || ''));
      monConvProv = detConvProv?.monedaBase || ID_USD;
    }
    // ✅ V00126: el monto del convenio se convierte a la moneda de la factura ANTES de sumar cargos.
    const montoFactProv = convertirAMonedaFactura(Number(formData.totalAPagarProv || 0), tc, monConvProv, formData.facturadoEnUnidad).monto;
    const subtotalFact = montoFactProv + Number(formData.cargosAdicionalesProv || 0);
    const monFactProv = formData.facturadoEnUnidad || monConvProv;
    const { dol, pes, conv } = desglosarPorMonedas(subtotalFact, tc, monFactProv, monFactProv);
    void subtotal;
    setFormData(prev => ({ ...prev, subtotalProv: subtotalFact, dolaresProv: dol, pesosProv: pes, conversionProv: conv }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.facturadoEnUnidad, formData.monedaConvenioProv, formData.totalAPagarProv, formData.cargosAdicionalesProv, tipoCambioDia, formData.tipoCambioAprobado, formData.convenioProveedor, listaConveniosProveedor, listaMonedasLocal]);

  useEffect(() => {
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.montoConvenioCliente || 0) + Number(formData.cargosAdicionales || 0);
    // ✅ CORREGIDO: si la moneda del convenio quedó VACÍA (el detalle no se pudo
    //   cargar al capturar), se toma la del convenio elegido y, en último término,
    //   USD (el estándar de los convenios). Antes, con la moneda vacía y la
    //   facturación en Pesos, el desglose caía al caso "pesos" y NO multiplicaba
    //   por el TC: "Pesos (Cliente)" y "Conversión Cliente (MXN)" quedaban con el
    //   monto en dólares sin convertir.
    let monConvCli: any = formData.monedaConvenioCliente;
    if (!monConvCli) {
      const detConv = listaConveniosCliente.find((c: any) => String(c.id) === String(formData.convenio || ''));
      monConvCli = detConv?.monedaMaestro || ID_USD;
    }
    // ✅ V00126: el monto del convenio se convierte a la moneda de la factura ANTES de sumar cargos
    //   (Convenio USD facturado en Pesos → 120 × TC, sin redondear).
    const montoFactCli = convertirAMonedaFactura(Number(formData.montoConvenioCliente || 0), tc, monConvCli, formData.facturadoEnCobrar).monto;
    const subtotalFact = montoFactCli + Number(formData.cargosAdicionales || 0);
    const monFactCli = formData.facturadoEnCobrar || monConvCli;
    const { dol, pes, conv } = desglosarPorMonedas(subtotalFact, tc, monFactCli, monFactCli);
    void subtotal;
    const utilidad = conv - Number(formData.conversionProv || 0); 
    setFormData(prev => ({ ...prev, subtotalCliente: subtotalFact, dolaresCliente: dol, pesosCliente: pes, conversionCliente: conv, utilidadEstimada: utilidad }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.facturadoEnCobrar, formData.monedaConvenioCliente, formData.montoConvenioCliente, formData.cargosAdicionales, tipoCambioDia, formData.conversionProv, formData.tipoCambioAprobado, formData.convenio, listaConveniosCliente, listaMonedasLocal]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: string, index?: number) => {
    const file = e.target.files?.[0] || null;
    if (index !== undefined) {
      const nuevosPdfs = [...(formData.pdfsEntrys || [])]; 
      nuevosPdfs[index] = file;
      setFormData(prev => ({ ...prev, pdfsEntrys: nuevosPdfs }));
    } else {
      setFormData(prev => ({ ...prev, [field]: file }));
    }
  };

  // ✅ Helper: los campos de tipos pueden venir como arreglo de IDs o como texto.
  const contieneId = (campo: any, id: string): boolean => {
    if (!campo) return false;
    if (Array.isArray(campo)) return campo.map((x: any) => String(x)).includes(id);
    return String(campo).includes(id);
  };
  // ✅ Los filtros aceptan el ID del catálogo O el nombre del tipo, porque en la
  //   base conviven registros guardados en ambos formatos. Así, un cliente de
  //   mercancía recién creado desde este formulario aparece de inmediato.
  // ✅ V00126: en Cliente (Paga) solo se listan las empresas que TIENEN convenio
  //   (se conserva siempre la del registro que se está editando).
  const idsClientesConConvenio = useMemo(() => {
    const set = new Set<string>();
    (catalogoConvClientes || []).forEach((c: any) => {
      const id = String(c.clienteId ?? c.cliente ?? c.id_cliente ?? c.clientePaga ?? c.empresaId ?? c.empresa ?? '').trim();
      if (id) set.add(id);
    });
    (catalogoConvDetalles || []).forEach((d: any) => { const id = ownerClienteDetalle(d); if (id) set.add(id); });
    return set;
  }, [catalogoConvClientes, catalogoConvDetalles]);
  const filClientesPaga = useMemo(() => empresas?.filter((e:any) =>
    (contieneId(e.tiposEmpresa, '7eec9cbb') || contieneId(e.tiposEmpresa, TIPO_EMP_CLIENTE_PAGA)) &&
    (idsClientesConConvenio.has(String(e.id)) || String(e.id) === String(initialData?.clientePaga || ''))
  ) || [], [empresas, idsClientesConConvenio, initialData?.clientePaga]);
  const filClientesMercancia = useMemo(() => empresas?.filter((e:any) => (contieneId(e.tiposEmpresa, '51246232') || contieneId(e.tiposEmpresa, TIPO_EMP_CLIENTE_MERCANCIA)) && e.status === 'Activa') || [], [empresas]);
  // ✅ Solo empresas con tiposEmpresa 11894dfd (o su nombre) Y tiposServicio 42afffd3 o 7e70a3f7.
  const filProveedoresServicios = useMemo(() => empresas?.filter((e:any) =>
    (contieneId(e.tiposEmpresa, TIPO_EMPRESA_PROV_SERVICIOS_ID) || contieneId(e.tiposEmpresa, TIPO_EMP_PROV_SERVICIOS)) &&
    TIPOS_SERVICIO_PROV_MANIFIESTO.some(idServ => contieneId(e.tiposServicio, idServ))
  ) || [], [empresas]);
  // ✅ Costo del manifiesto automático según el tipo de servicio del proveedor:
  //   42afffd3 -> costo por defecto ($8.52); cualquier otro -> 0.
  const montoManifiestoDeProveedor = (emp: any): number =>
    contieneId(emp?.tiposServicio, TIPO_SERVICIO_CON_COSTO_MANIFIESTO) ? COSTO_MANIFIESTO_DEFAULT : 0;
  const filOrigenesDestinos = useMemo(() => empresas?.filter((e:any) => (contieneId(e.tiposEmpresa, '6e7af5ab') || contieneId(e.tiposEmpresa, TIPO_EMP_ORIGEN_DESTINO)) && e.status === 'Activa') || [], [empresas]);

  // ✅ Catálogo de DIRECCIONES por id (las empresas guardan direccionId).
  //   Se lee UNA vez al abrir el formulario con getDocs (ya importado).
  const [mapaDirecciones, setMapaDirecciones] = useState<Record<string, any>>({});
  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'direcciones'));
        if (cancelado) return;
        const m: Record<string, any> = {};
        snap.docs.forEach(d => { m[d.id] = { id: d.id, ...(d.data() as any) }; });
        setMapaDirecciones(m);
      } catch (e) {
        console.warn('[FormularioOperacion] No se pudo leer el catálogo de direcciones:', e);
      }
    })();
    return () => { cancelado = true; };
  }, []);

  const direccionDeEmpresaOD = (e: any) => mapaDirecciones[String(e?.direccionId || '')] || null;
  const direccionFormateadaOD = (e: any) => formatearDireccionPorPais(direccionDeEmpresaOD(e), e?.direccion || e?.direccionLabel || '');
  const paisDeEmpresaOD = (e: any) => paisDeDireccion(direccionDeEmpresaOD(e), e?.direccion || e?.direccionLabel || '');
  // ✅ V00126: en Proveedor de Transporte solo se listan los que TIENEN convenio
  //   (se conserva siempre el del registro que se está editando y la flota propia forzada).
  const idsProveedoresConConvenio = useMemo(() => {
    const set = new Set<string>();
    (conveniosProv || []).forEach((c: any) => {
      const id = String(c.proveedorId ?? c.proveedor ?? c.id_proveedor ?? c.empresaId ?? c.empresa ?? '').trim();
      if (id) set.add(id);
    });
    (catalogoConvProvDetalles || []).forEach((d: any) => { const id = ownerProvDetalle(d); if (id) set.add(id); });
    return set;
  }, [conveniosProv, catalogoConvProvDetalles]);
  const filProveedoresTransporte = useMemo(() => empresas?.filter((e:any) =>
    (contieneId(e.tiposEmpresa, 'ca21ab07') || contieneId(e.tiposEmpresa, TIPO_EMP_PROV_TRANSPORTE)) && e.status === 'Activa' &&
    (idsProveedoresConConvenio.has(String(e.id)) || String(e.id) === String(initialData?.proveedorUnidad || '') || String(e.id) === String(formData.proveedorUnidad || ''))
  ) || [], [empresas, idsProveedoresConConvenio, initialData?.proveedorUnidad, formData.proveedorUnidad]);

  const sOrigen = (searchOrigen || '').toLowerCase();
  const sDestino = (searchDestino || '').toLowerCase();
  const sClientePaga = (searchClientePaga || '').toLowerCase();
  const sRemolque = (searchRemolque || '').toLowerCase();
  const sClienteMerc = (searchClienteMercancia || '').toLowerCase();
  const sProvServicios = (searchProvServicios || '').toLowerCase();
  const sProvTransp = (searchProvTransporte || '').toLowerCase();
  const sUnidad = (searchUnidad || '').toLowerCase();
  const sOperador = (searchOperador || '').toLowerCase();
  const sUnidadProv = (searchUnidadProveedor || '').toLowerCase();
  const sOperadorProv = (searchOperadorProveedor || '').toLowerCase();
  const sConvenio = (searchConvenio || '').toLowerCase();
  const sConvenioProveedor = (searchConvenioProveedor || '').toLowerCase();

  const empresaCoincide = (e:any, q:string) =>
    nombreEmpresaMostrar(e).toLowerCase().includes(q) || (e.nombre || '').toLowerCase().includes(q);

  // ✅ RESTAURADO (regla AppSheet): Origen y Destino se filtran por PAÍS según
  //   el tráfico y el tipo de operación, replicando el IFS(...) original:
  //   · Tipos 8ec24dfe / 24da3608:
  //       Exportación → Origen: México          / Destino: Estados Unidos.
  //       Importación → Origen: Estados Unidos  / Destino: México.
  //       Movimiento  → sin filtro (todas).
  //   · Tipo 3e5b0035 → sin filtro (todas).
  //   · Cualquier tipo con TrompoExpo=true (en Exportación) o TrompoImpo=true
  //     (en Importación) aplica la misma regla por país.
  //   · Si ninguna regla aplica (p. ej. aún no se elige tráfico/tipo), se
  //     muestran todas para no dejar el buscador vacío. Los resultados se
  //     ordenan alfabéticamente por nombre (ORDERBY(..., [nombre]) de AppSheet).
  const paisRequeridoOD = useMemo((): { origen: 'USA' | 'MX' | ''; destino: 'USA' | 'MX' | '' } => {
    const tipoId = String(formData.tipoOperacionId || '');
    const tipoOp: any = tiposOperacion?.find((op: any) => String(op.id) === tipoId) || {};
    const trompoExpo = esTrueAppSheet(tipoOp.TrompoExpo ?? tipoOp.trompoExpo ?? tipoOp.trompo_expo);
    const trompoImpo = esTrueAppSheet(tipoOp.TrompoImpo ?? tipoOp.trompoImpo ?? tipoOp.trompo_impo);
    const traf = normalizarTxtDir(formData.trafico);
    const esExpo = traf.includes('expo');
    const esImpo = traf.includes('impo');
    if (TIPOS_OP_FILTRO_PAIS.includes(tipoId)) {
      if (esExpo) return { origen: 'MX', destino: 'USA' };
      if (esImpo) return { origen: 'USA', destino: 'MX' };
      return { origen: '', destino: '' }; // Movimiento u otro tráfico → todas
    }
    if (tipoId === TIPO_OP_SIN_FILTRO_PAIS) return { origen: '', destino: '' };
    if (esExpo && trompoExpo) return { origen: 'MX', destino: 'USA' };
    if (esImpo && trompoImpo) return { origen: 'USA', destino: 'MX' };
    return { origen: '', destino: '' };
  }, [formData.tipoOperacionId, formData.trafico, tiposOperacion]);

  const coincideOD = (e: any, q: string) =>
    empresaCoincide(e, q) || (e.direccion || '').toLowerCase().includes(q) || direccionFormateadaOD(e).toLowerCase().includes(q);
  const filtraPorPaisOD = (lista: any[], pais: 'USA' | 'MX' | '') =>
    pais ? lista.filter((e: any) => paisDeEmpresaOD(e) === pais) : lista;
  const ordenaPorNombreOD = (lista: any[]) =>
    [...lista].sort((a: any, b: any) => nombreEmpresaMostrar(a).localeCompare(nombreEmpresaMostrar(b), 'es', { sensitivity: 'base' }));
  const resultadosOrigen = ordenaPorNombreOD(filtraPorPaisOD(filOrigenesDestinos.filter((e:any) => coincideOD(e, sOrigen)), paisRequeridoOD.origen));
  const resultadosDestino = ordenaPorNombreOD(filtraPorPaisOD(filOrigenesDestinos.filter((e:any) => coincideOD(e, sDestino)), paisRequeridoOD.destino));
  const resultadosClientePaga = filClientesPaga.filter((e:any) => empresaCoincide(e, sClientePaga));
  const resultadosRemolque = remolques?.filter((e:any) => `${e.nombre || ''} ${e.placas || e.placa || ''}`.toLowerCase().trim().includes(sRemolque)) || [];
  const resultadosClienteMercancia = filClientesMercancia.filter((e:any) => empresaCoincide(e, sClienteMerc));
  const resultadosProvServicios = filProveedoresServicios.filter((e:any) => empresaCoincide(e, sProvServicios));
  const resultadosProvTransporte = filProveedoresTransporte.filter((e:any) => empresaCoincide(e, sProvTransp));
  const resultadosUnidad = unidades?.filter((u:any) => (u.unidad || '').toLowerCase().includes(sUnidad)) || [];
  const resultadosOperador = listaEmpleadosLocal.filter((o:any) => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim().toLowerCase().includes(sOperador));
  const resultadosUnidadProveedor = listaUniProvLocal.filter((u:any) => String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || '').toLowerCase().includes(sUnidadProv));
  const resultadosOperadorProveedor = listaOpeProvLocal.filter((o:any) => String(o.nombre || o.nombres || o.nombreCompleto || '').toLowerCase().includes(sOperadorProv));
  const resultadosConvenio = listaConveniosCliente.filter((c:any) =>
    (c.descripcion || '').toLowerCase().includes(sConvenio) ||
    etiquetaConvenioCliente(c).toLowerCase().includes(sConvenio) ||
    String(c.tarifaBaseId || '').toLowerCase().includes(sConvenio)
  );
  const resultadosConvenioProveedor = listaConveniosProveedor.filter((c:any) =>
    (c.tipoConvenioNombre || '').toLowerCase().includes(sConvenioProveedor) ||
    etiquetaConvenioProveedor(c).toLowerCase().includes(sConvenioProveedor) ||
    String(c.tarifaBaseId || '').toLowerCase().includes(sConvenioProveedor)
  );

  const convClienteSel = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
  const convProvSelObj = listaConveniosProveedor.find((c:any) => c.id === formData.convenioProveedor);
  const tarifaIdCliente = String(convClienteSel?.tarifaBaseId || '').trim();
  const tarifaIdProveedor = String(convProvSelObj?.tarifaBaseId || '').trim();
  const montoCliente = Number(convClienteSel?.tarifaMonto || 0);
  // ✅ V00126: Subtotal mostrado en la MONEDA DE LA FACTURA (sin redondeo)
  const tcVigente = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0;
  const monConvCliActual = formData.monedaConvenioCliente || convClienteSel?.monedaMaestro;
  const monConvProvActual = formData.monedaConvenioProv || convProvSelObj?.monedaBase;
  const subtotalClienteFact = convertirAMonedaFactura(Number(formData.montoConvenioCliente || 0), tcVigente, monConvCliActual, formData.facturadoEnCobrar);
  const subtotalProvFact = convertirAMonedaFactura(Number(formData.totalAPagarProv || 0), tcVigente, monConvProvActual, formData.facturadoEnUnidad);
  const leyendaConversion = (r: { convertido: boolean; sinTC: boolean }, monto: number, monConv: any) =>
    !r.convertido ? '' : r.sinTC ? `⚠ Falta el Tipo de Cambio del día para convertir ${fmtMoney(monto)} ${nombreMoneda(monConv)}` : `${fmtMoney(monto)} ${nombreMoneda(monConv)} × TC ${tcVigente}`;
  const montoProveedor = Number(convProvSelObj?.tarifaMonto || 0);
  const monedaClienteId = convClienteSel?.monedaMaestro;
  const monedaProveedorId = convProvSelObj?.monedaBase;
  const tarifasCoinciden = !!tarifaIdCliente && tarifaIdCliente === tarifaIdProveedor;

  // ✅ Color de los montos según la moneda de facturación:
  //   Dólares → azul (#58a6ff)   ·   Pesos → verde (#3fb950).
  const colorPorMonedaId = (idMoneda: any): string | undefined => {
    const n = String(nombreMoneda(idMoneda) || '').toUpperCase();
    if (n.includes('USD') || n.includes('DOLAR') || n.includes('DÓLAR')) return '#58a6ff';
    if (n.includes('MXN') || n.includes('PESO')) return '#3fb950';
    return undefined;
  };
  const colorMonedaProv = colorPorMonedaId(formData.facturadoEnUnidad);
  const colorMonedaCliente = colorPorMonedaId(formData.facturadoEnCobrar);

  const nombreTarifaPorId = (tarifaId: any): string => {
    const id = String(tarifaId || '').trim();
    if (!id) return '';
    const t = (tarifas || []).find((x: any) => String(x.id).trim() === id);
    return t?.descripcion || t?.nombre || t?.tarifa || t?.concepto || '';
  };
  const nombreTarifaCli = convClienteSel?.descripcion || nombreTarifaPorId(tarifaIdCliente);
  const nombreTarifaProv = convProvSelObj?.tipoConvenioNombre || nombreTarifaPorId(tarifaIdProveedor);


  const tipoOpTextNormalizado = (tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '').toLowerCase();
  const isTransfer = tipoOpTextNormalizado.includes('transfer');
  const isLogistica = tipoOpTextNormalizado.includes('logistica') || tipoOpTextNormalizado.includes('logística');
  const isFletes = tipoOpTextNormalizado.includes('fletes') || tipoOpTextNormalizado.includes('flete');
  const isRoelca = searchProvTransporte.toLowerCase().includes('roelca');
  const proveedorForzado = formData.tipoOperacionId === TIPO_OP_PROVEEDOR_FIJO;
  const showInternalFleet = isTransfer || ((isLogistica || isFletes) && isRoelca);
  const showExternalFleet = (isLogistica || isFletes) && !isRoelca;
  const esFlotaPropiaRoelca = showInternalFleet;

  // ✅ Puente: se muestra SOLO en Transfer, o en Logística cuando el Proveedor
  //    de Transporte es Roelca. En Fletes (o Logística con proveedor externo) no.
  const mostrarPuente = isTransfer || (isLogistica && isRoelca);
  // Opciones de puente desde catalogo_tipos_gastos (categoria_gasto === "Puente").
  const opcionesPuente = (tiposGastosLocal || []).filter(
    (g: any) => String(g.categoria_gasto || '').trim().toLowerCase() === 'puente'
  );

  // ✅ (Caseta/Puente automático) Importación -> Caseta Avi (4614ec51);
  //   Exportación -> Caseta Puente III (49ce0a0e), cada una con el importe de
  //   su catálogo. El listado del select sigue mostrando TODOS los puentes y
  //   el usuario puede cambiarlo a mano: la auto-asignación solo aplica cuando
  //   el puente está vacío o tiene la caseta automática del otro tráfico, y no
  //   pisa el puente ya guardado al editar una operación existente.
  useEffect(() => {
    if (!mostrarPuente) return;
    if (initialData && formData.puenteId) return;
    const traficoTxt = String(formData.trafico || '').toLowerCase();
    let idAuto = '';
    if (traficoTxt.includes('impo')) idAuto = PUENTE_IMPORTACION_ID;
    else if (traficoTxt.includes('expo')) idAuto = PUENTE_EXPORTACION_ID;
    if (!idAuto || formData.puenteId === idAuto) return;
    if (formData.puenteId && formData.puenteId !== PUENTE_IMPORTACION_ID && formData.puenteId !== PUENTE_EXPORTACION_ID) return;
    const row = opcionesPuente.find((g: any) => String(g.id) === idAuto);
    if (!row) return;
    const importe = Number(row.Importe ?? row.importe ?? 0) || 0;
    setFormData(prev => ({ ...prev, puenteId: idAuto, puenteNombre: String(row.nombre_gasto || ''), puenteMonto: importe }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.trafico, formData.puenteId, mostrarPuente, opcionesPuente.length, initialData]);

  const ID_STATUS_CANCELADO = '7607f692';
  const usuarioActualCancel = useUsuarioStore((s) => s.usuario);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ✅ CANCELACIÓN CONTROLADA: si la operación pasa a Cancelado, se exige
    //   una observación del motivo y se registra QUIÉN la canceló y cuándo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- status vive fuera del tipo del formulario (mismo criterio del archivo).
    const statusNuevo = String((formData as any).status || '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- initialData sin tipo canónico (mismo criterio del archivo).
    const statusPrevio = String((initialData as any)?.status || '');
    let datosCancelacion: Record<string, string> | null = null;
    if (statusNuevo === ID_STATUS_CANCELADO && statusPrevio !== ID_STATUS_CANCELADO) {
      let motivo = '';
      while (!motivo.trim()) {
        const respuesta = window.prompt('Para CANCELAR esta referencia escribe el motivo de la cancelación (obligatorio):', '');
        if (respuesta === null) { return; } // el usuario desistió: no se guarda nada
        motivo = respuesta;
      }
      datosCancelacion = {
        observacionCancelacion: motivo.trim(),
        canceladoPor: String(usuarioActualCancel?.nombre || usuarioActualCancel?.email || usuarioActualCancel?.id || 'Desconocido'),
        canceladoPorUid: String(usuarioActualCancel?.id || ''),
        fechaCancelacion: new Date().toISOString(),
      };
    }

    setCargando(true);
    try {
      const configId = buildConfigId();
      let statusCalculado: string;
      try {
        statusCalculado = await calcularStatusDinamico(configId, formData, statusPrevioParaCalculo());
      } catch (errStatus) {
        console.warn('No se pudo calcular el status para el flujo actual; se usa un valor de respaldo.', errStatus);
        statusCalculado = String((initialData as any)?.status || (formData as any).status || '');
      }
      // ✅ Si aun así quedó vacío (operación NUEVA con flujo sin configurar),
      //   se asigna el status INICIAL del catálogo (el que empieza con "1")
      //   para que la operación nunca quede sin status en la tabla.
      if (!statusCalculado) {
        const statusInicial = (statusServicio || []).find((st: any) =>
          /^\s*1(?![\d.])|^\s*1\.\s*/.test(String(st.nombre || st.descripcion || '')));
        if (statusInicial) {
          statusCalculado = statusInicial.id;
          console.warn('[Status] Operación sin flujo calculable; se asignó el status inicial:', statusInicial.nombre || statusInicial.descripcion);
        }
      }
      const detalleDoc = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
      const { pdfCartaPorte, pdfDoda, pdfManifiesto, pdfsEntrys, ...datosLimpios } = formData;
      const tipoOpObj = tiposOperacion.find((t:any) => t.id === formData.tipoOperacionId);
      const statusObj = statusServicio?.find((s:any) => s.id === statusCalculado);
      const monedaCobroObj = listaMonedasLocal.find((m:any) => m.id === formData.facturadoEnCobrar);
      const monedaUnidadObj = listaMonedasLocal.find((m:any) => m.id === formData.facturadoEnUnidad);
      const convProvObj = listaConveniosProveedor.find((c:any) => c.id === formData.convenioProveedor);
      const monedaConvProvObj = listaMonedasLocal.find((m:any) => m.id === formData.monedaConvenioProv);
      const embalajeObj = (embalajesLocal || []).find((em:any) => String(em.id) === String(formData.embalaje));
      const embalajeNombreResuelto = embalajeObj
        ? String(embalajeObj.clave ?? embalajeObj.embalaje ?? embalajeObj.nombre ?? embalajeObj.descripcion ?? embalajeObj.tipo ?? '').trim()
        : ((initialData as any)?.embalajeNombre || '');

      let resolvedClientePaga = formData.clientePaga;
      if (!resolvedClientePaga && searchClientePaga) { const f = filClientesPaga.find((x:any) => x.nombre?.toLowerCase() === searchClientePaga.toLowerCase()); if (f) resolvedClientePaga = f.id; }
      let resolvedOrigen = formData.origen;
      if (!resolvedOrigen && searchOrigen) { const f = filOrigenesDestinos.find((x:any) => x.nombre?.toLowerCase() === searchOrigen.toLowerCase()); if (f) resolvedOrigen = f.id; }
      let resolvedDestino = formData.destino;
      if (!resolvedDestino && searchDestino) { const f = filOrigenesDestinos.find((x:any) => x.nombre?.toLowerCase() === searchDestino.toLowerCase()); if (f) resolvedDestino = f.id; }
      let resolvedRemolque = formData.numeroRemolque;
      if (!resolvedRemolque && searchRemolque) { const f = remolques.find((x:any) => `${x.nombre || ''} ${x.placas || x.placa || ''}`.trim().toLowerCase() === searchRemolque.toLowerCase()); if (f) resolvedRemolque = f.id; }
      let resolvedClienteMercancia = formData.clienteMercancia;
      if (!resolvedClienteMercancia && searchClienteMercancia) { const f = filClientesMercancia.find((x:any) => x.nombre?.toLowerCase() === searchClienteMercancia.toLowerCase()); if (f) resolvedClienteMercancia = f.id; }
      let resolvedProvServicios = formData.provServicios;
      if (!resolvedProvServicios && searchProvServicios) { const f = filProveedoresServicios.find((x:any) => x.nombre?.toLowerCase() === searchProvServicios.toLowerCase()); if (f) resolvedProvServicios = f.id; }
      let resolvedProvTransporte = formData.proveedorUnidad;
      if (!resolvedProvTransporte && searchProvTransporte) { const f = filProveedoresTransporte.find((x:any) => x.nombre?.toLowerCase() === searchProvTransporte.toLowerCase()); if (f) resolvedProvTransporte = f.id; }
      let resolvedUnidad = formData.unidad;
      if (!resolvedUnidad && searchUnidad) { const f = unidades.find((x:any) => (x.unidad || x.nombre)?.toLowerCase() === searchUnidad.toLowerCase()); if (f) resolvedUnidad = f.id; }
      let resolvedOperador = formData.operador;
      if (!resolvedOperador && searchOperador) { const f = listaEmpleadosLocal.find((x:any) => `${x.firstName || ''} ${x.lastNamePaternal || ''}`.trim().toLowerCase() === searchOperador.toLowerCase()); if (f) resolvedOperador = f.id; }
      let resolvedUnidadProv = formData.unidadProveedor;
      if (!resolvedUnidadProv && searchUnidadProveedor) { const f = listaUniProvLocal.find((x:any) => String(x.numeroUnidad || x.numero_unidad || x.unidad || x.placas || x.placa || '').toLowerCase() === searchUnidadProveedor.toLowerCase()); if (f) resolvedUnidadProv = f.id; }
      let resolvedOperadorProv = formData.operadorProveedor;
      if (!resolvedOperadorProv && searchOperadorProveedor) { const f = listaOpeProvLocal.find((x:any) => String(x.nombre || x.nombres || x.nombreCompleto || '').toLowerCase() === searchOperadorProveedor.toLowerCase()); if (f) resolvedOperadorProv = f.id; }

      const operacionData: any = { 
        ...datosLimpios, 
        clientePaga: resolvedClientePaga, origen: resolvedOrigen, destino: resolvedDestino,
        numeroRemolque: resolvedRemolque, clienteMercancia: resolvedClienteMercancia,
        provServicios: resolvedProvServicios, proveedorUnidad: resolvedProvTransporte,
        unidad: resolvedUnidad, operador: resolvedOperador,
        unidadProveedor: resolvedUnidadProv, operadorProveedor: resolvedOperadorProv,
        convenioNombre: detalleDoc?.descripcion || formData.convenioNombre || 'Sin descripción', 
        status: statusCalculado || 'Pendiente', 
        // ✅ FIX: se guarda el NOMBRE del status (la descripción larga del catálogo
        //    solo es texto de ayuda y estaba filtrándose a la tabla del dashboard)
        statusNombre: statusObj?.nombre || statusObj?.descripcion || statusCalculado || 'Pendiente',
        tienePdfDoda: !!pdfDoda, cantPdfsEntrys: (pdfsEntrys || []).filter(Boolean).length,
        clienteNombre: searchClientePaga || '', origenNombre: searchOrigen || '',
        destinoNombre: searchDestino || '', remolqueNombre: searchRemolque || '',clienteMercanciaNombre: searchClienteMercancia || '', provServiciosNombre: searchProvServicios || '',
        proveedorUnidadNombre: searchProvTransporte || '', unidadNombre: searchUnidad || '',
        operadorNombre: searchOperador || '', tipoOperacionNombre: tipoOpObj?.tipo_operacion || '',
        monedaCobroNombre: monedaCobroObj?.moneda || '', monedaUnidadNombre: monedaUnidadObj?.moneda || '',
        convenioProveedorNombre: convProvObj?.tipoConvenioNombre || '',
        embalajeNombre: embalajeNombreResuelto,
        monedaConvProvNombre: monedaConvProvObj?.moneda || ''
      };

      if (esFlotaPropiaRoelca) {
        operacionData.convenioProveedor = '';
        operacionData.convenioProveedorNombre = '';
        operacionData.monedaConvenioProv = '';
        operacionData.monedaConvProvNombre = '';
        operacionData.totalAPagarProv = 0;
        operacionData.cargosAdicionalesProv = 0;
        operacionData.subtotalProv = 0;
        operacionData.dolaresProv = 0;
        operacionData.pesosProv = 0;
        operacionData.conversionProv = 0;
      }

      if (!mostrarPuente) {
        operacionData.puenteId = '';
        operacionData.puenteNombre = '';
        operacionData.puenteMonto = 0;
      }

      Object.keys(operacionData).forEach(key => { if (operacionData[key] === undefined) delete operacionData[key]; });

      if (initialData && puedeEditarRef && referencia.trim() && referencia.trim() !== String((initialData as any).ref || '')) {
        operacionData.ref = referencia.trim();
      }

      // ── ✅ AUTORIZACIONES (modelo de bloqueo directo): si la acción o algún
      //    campo modificado está controlado para los roles del usuario (y no
      //    es Admin), el guardado se RECHAZA. Los roles no seleccionados en el
      //    configurador editan libremente. No se crean solicitudes.
      //    El formulario NO se cierra: el usuario puede revertir los campos
      //    bloqueados y guardar el resto de su captura. ──
      const etiquetasCamposAut: Record<string, string> = {};
      (MODULOS_AUTORIZABLES.find(m => m.clave === 'operaciones')?.campos || []).forEach(c => { etiquetasCamposAut[c.key] = c.label; });
      const accionAut: 'crear' | 'editar' = initialData ? 'editar' : 'crear';
      const camposCambiadosAut = initialData ? camposModificadosDe(operacionData, initialData as any) : [];
      const usuarioA = usuarioAut || await obtenerUsuarioAut();
      const configA = configAut !== undefined ? configAut : await cargarConfigModulo('operaciones');
      const evalAut = evaluarAutorizacion(configA, accionAut, usuarioA, camposCambiadosAut, etiquetasCamposAut);
      if (evalAut.requiere) {
        alert(`No tienes permiso para realizar esta modificación:\n\n${evalAut.motivos.join('\n')}\n\nRevierte esos campos para poder guardar el resto de los cambios.`);
        return;
      }

      // ── ✅ NUEVO (auditoría NO editable): quién y a qué hora creó la
      //    referencia, y bitácora embebida de cada edición con sus cambios.
      //    Estos campos NO existen en el formulario: en cada edición se
      //    preservan desde el registro original, por lo que nadie puede
      //    modificarlos desde la interfaz. ──
      // El nombre se resuelve desde el perfil del usuario (colección `usuarios`),
      //   nunca el UID: si lo que trae la autorización es el UID, se busca el
      //   nombre real o el correo como respaldo.
      let nombreAuditoria = '';
      try {
        const uidA = auth.currentUser?.uid || '';
        const candidatos = [(usuarioA as any)?.nombre, (usuarioA as any)?.nombreCompleto, (usuarioA as any)?.email];
        nombreAuditoria = String(candidatos.find((v: any) => v && String(v).trim() && String(v).trim() !== uidA) || '');
        if (!nombreAuditoria && uidA) {
          const snapU = await getDoc(doc(db, 'usuarios', uidA));
          const dU: any = snapU.exists() ? snapU.data() : {};
          nombreAuditoria = String(dU.nombre || dU.nombreCompleto || dU.displayName || dU.email || '');
        }
        if (!nombreAuditoria) nombreAuditoria = String(auth.currentUser?.displayName || auth.currentUser?.email || 'Desconocido');
      } catch {
        nombreAuditoria = String(auth.currentUser?.displayName || auth.currentUser?.email || 'Desconocido');
      }
      const ahoraAuditoria = new Date().toISOString();
      if (initialData) {
        const cambiosAud = listaCambiosAuditoria(operacionData, initialData as any, etiquetasCamposAut);
        (operacionData as any).creadoPor = (initialData as any).creadoPor || '';
        (operacionData as any).creadoEn = (initialData as any).creadoEn || '';
        if (cambiosAud.length > 0) {
          (operacionData as any).historialEdiciones = [
            ...((Array.isArray((initialData as any).historialEdiciones) ? (initialData as any).historialEdiciones : [])),
            { fecha: ahoraAuditoria, usuario: nombreAuditoria, cambios: cambiosAud },
          ];
        }
      } else {
        (operacionData as any).creadoPor = nombreAuditoria;
        (operacionData as any).creadoEn = ahoraAuditoria;
        (operacionData as any).historialEdiciones = [];
      }

      let idGuardado = '';
      let refGuardado = '';
      if (initialData) {
        if (datosCancelacion) Object.assign(operacionData, datosCancelacion);

        // ✅ NUEVO — CAMBIO DE LÍNEA = NUEVA REFERENCIA: si al editar se cambió
        //   el TIPO DE OPERACIÓN (ej. Transfer -> Logística), la referencia se
        //   regenera con el prefijo de la NUEVA línea y el SIGUIENTE
        //   consecutivo de esa línea para el día (si no hay registros, 001).
        try {
          const refActual = String((initialData as any).ref || '');
          const matchRef = refActual.match(/^([A-Z]{2})-(\d{6})-(\d+)$/);
          const tipoNuevoNombre = tiposOperacion?.find((t: any) => t.id === formData.tipoOperacionId)?.tipo_operacion || '';
          const prefijoNuevo = prefijoTipoOperacion(tipoNuevoNombre);
          if (matchRef && tipoNuevoNombre && prefijoNuevo !== matchRef[1]) {
            const ddmmyy = matchRef[2]; // se conserva la fecha de la referencia
            const inicio = `${prefijoNuevo}-${ddmmyy}-`;
            const snapUlt = await getDocs(query(
              collection(db, 'operaciones'),
              where('ref', '>=', inicio),
              where('ref', '<=', `${inicio}\uf8ff`),
              orderBy('ref', 'desc'),
              limit(1)
            ));
            let siguiente = 1;
            if (!snapUlt.empty) {
              const ultRef = String((snapUlt.docs[0].data() as any).ref || '');
              const mUlt = ultRef.match(/-(\d+)$/);
              if (mUlt) siguiente = parseInt(mUlt[1], 10) + 1;
            }
            (operacionData as any).ref = `${inicio}${String(siguiente).padStart(3, '0')}`;
            console.log(`Referencia regenerada por cambio de línea: ${refActual} -> ${(operacionData as any).ref}`);
          }
        } catch (eRef) {
          console.warn('No se pudo regenerar la referencia por cambio de línea:', eRef);
        }

        await updateDoc(doc(db, 'operaciones', String(initialData.id)), operacionData);
        idGuardado = String(initialData.id);
        notificarOperacionGuardada(idGuardado, { ...(initialData as any), ...operacionData }); // ✅ V00126: avisa a Facturación/Pagos
        refGuardado = referenciaDeOperacion(idGuardado, operacionData.ref || (initialData as any).ref);
        if (onSave) onSave({ id: initialData.id, ...operacionData });
      } else {
        const resultado = await guardarOperacionSegura(operacionData);
        const nuevoId = (typeof resultado === 'object' && resultado?.id) ? resultado.id : Date.now().toString();
        idGuardado = String(nuevoId);
        notificarOperacionGuardada(idGuardado, { ...operacionData, ref: (resultado as any)?.ref || operacionData.ref }); // ✅ V00126: avisa a Facturación/Pagos
        refGuardado = referenciaDeOperacion(idGuardado, (resultado as any)?.ref || operacionData.ref);
        if (onSave) onSave({ id: nuevoId, ...operacionData });
      }

      // ── ✅ HISTORIAL DE ACTIVIDAD: constancia de quién guardó, qué campos
      //    capturó (creación) o qué campos cambió con anterior → nuevo (edición)
      //    y cuándo. El usuario y la fecha los resuelve registrarLog. ──
      try {
        if (initialData) {
          registrarLog('Operaciones', 'Edición', `Editó la operación ${refGuardado}. Cambios → ${describirCambiosLog(operacionData, initialData as any, etiquetasCamposAut)}`).catch(() => {});
        } else {
          registrarLog('Operaciones', 'Creación', `Creó la operación ${refGuardado} con los campos → ${describirCamposCapturadosLog(operacionData, etiquetasCamposAut)}`).catch(() => {});
        }
      } catch { /* el log nunca debe romper el guardado */ }

      const archivosPorCampo: { file: File; campo: string; sufijo?: string }[] = [];
      if (pdfCartaPorte) archivosPorCampo.push({ file: pdfCartaPorte, campo: 'Carta Porte' });
      if (pdfDoda) archivosPorCampo.push({ file: pdfDoda, campo: 'DODA' });
      if (pdfManifiesto) archivosPorCampo.push({ file: pdfManifiesto, campo: 'Manifiesto' });
      (pdfsEntrys || []).forEach((f: File | null, i: number) => { if (f) archivosPorCampo.push({ file: f, campo: "Entry's", sufijo: String(i + 1) }); });

      let subidos = 0;
      for (const a of archivosPorCampo) {
        try { await subirDocumentoOperacion(a.file, idGuardado, refGuardado, a.campo, a.sufijo); subidos++; }
        catch (err) { console.error('Error subiendo documento de operación:', a.campo, err); }
      }

      const resumenDocs = archivosPorCampo.length > 0 ? `\n\nDocumentos subidos a "${refGuardado}": ${subidos}/${archivosPorCampo.length}` : '';
      alert(`Operación ${initialData ? 'actualizada' : 'guardada'} correctamente.${resumenDocs}`);
      onClose();
    } catch (error: any) {
      console.error('Error al guardar operación:', error);
      alert(error?.message || 'Error al guardar');
    } finally { setCargando(false); }
  };

  const handleCancelarConfirmado = () => {
    const ok = window.confirm('¿Seguro que deseas cancelar esta operación? Se perderán los datos que no hayas guardado.');
    if (ok) onClose();
  };

  const tipoOpNombreResumen = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '';
  const convenioNombreResumen = listaConveniosCliente.find((c: any) => c.id === formData.convenio)?.descripcion || '';
  const tcResumen = formData.tipoCambioAprobado || tipoCambioDia;

  const fmtFecha = (f: string) => { if (!f) return ''; try { return new Date(f).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }); } catch { return f; } };

  const opcionesTarifasRef = useMemo(() => {
    return (tarifas || [])
      .map((t: any) => ({ id: String(t.id), nombre: t.descripcion || t.nombre || t.tarifa || t.concepto || String(t.id) }))
      .sort((a: any, b: any) => String(a.nombre).localeCompare(String(b.nombre), 'es', { sensitivity: 'base' }));
  }, [tarifas]);

  const costoPorTarifa = useMemo(() => {
    const m: Record<string, number> = {};
    const tomar = (arr: any[]) => (arr || []).forEach((d: any) => {
      const tid = String(d.tipoConvenioId ?? d.tipo_convenio_id ?? d.tipoConvenio ?? d.tipo_convenio ?? d.tarifaId ?? d.tarifa_id ?? '').trim();
      if (!tid) return;
      const monto = montoDetalle(d);
      if (monto > 0 && m[tid] === undefined) m[tid] = monto;
    });
    tomar(catalogoConvDetalles);
    tomar(catalogoConvProvDetalles);
    return m;
  }, [catalogoConvDetalles, catalogoConvProvDetalles]);

  const [usoTarifaMap, setUsoTarifaMap] = useState<Record<string, number>>({});
  const usoTarifaCargadoRef = useRef(false);

  const cargarUsoTarifas = useCallback(async () => {
    if (usoTarifaCargadoRef.current) return;
    if (!((catalogoConvDetalles && catalogoConvDetalles.length) || (catalogoConvProvDetalles && catalogoConvProvDetalles.length))) return;
    usoTarifaCargadoRef.current = true;
    try {
      const detCli = new Map<string, string>();
      (catalogoConvDetalles || []).forEach((d: any) => {
        const tid = String(d.tipoConvenioId ?? d.tipo_convenio_id ?? d.tipoConvenio ?? d.tipo_convenio ?? d.tarifaId ?? d.tarifa_id ?? '').trim();
        if (tid) detCli.set(String(d.id), tid);
      });
      const detProv = new Map<string, string>();
      (catalogoConvProvDetalles || []).forEach((d: any) => {
        const tid = String(d.tipoConvenioId ?? d.tipo_convenio_id ?? d.tipoConvenio ?? d.tipo_convenio ?? d.tarifaId ?? d.tarifa_id ?? '').trim();
        if (tid) detProv.set(String(d.id), tid);
      });
      const snap = await getDocs(collection(db, 'operaciones'));
      const conteo: Record<string, number> = {};
      snap.docs.forEach((docu: any) => {
        const op = docu.data() || {};
        const tarifasOp = new Set<string>();
        const cCli = String(op.convenio ?? '').trim();
        if (cCli && detCli.has(cCli)) tarifasOp.add(detCli.get(cCli) as string);
        const cProv = String(op.convenioProveedor ?? '').trim();
        if (cProv && detProv.has(cProv)) tarifasOp.add(detProv.get(cProv) as string);
        tarifasOp.forEach((tid) => { conteo[tid] = (conteo[tid] || 0) + 1; });
      });
      setUsoTarifaMap(conteo);
    } catch (e) {
      console.error('Error contando uso de tarifas en operaciones:', e);
      usoTarifaCargadoRef.current = false;
    }
  }, [catalogoConvDetalles, catalogoConvProvDetalles]);

  const etiquetaOpcionTarifa = (o: any): string => {
    const partes: string[] = [o.nombre, `ID: ${o.id}`];
    const costo = costoPorTarifa[o.id];
    if (costo !== undefined) partes.push(fmtMoney(costo));
    const uso = usoTarifaMap[o.id] || 0;
    partes.push(`${uso} op${uso === 1 ? '' : 's'}`);
    return partes.join('  ·  ');
  };

  useEffect(() => {
    if (mostrarConveniosCliente || mostrarConveniosProveedor || detalleConvEditando || detalleConvProvEditando) {
      cargarUsoTarifas();
    }
  }, [mostrarConveniosCliente, mostrarConveniosProveedor, detalleConvEditando, detalleConvProvEditando, cargarUsoTarifas]);

  const refrescarConvDetallesCliente = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'convenios_clientes_detalles'));
      const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      setConvDetallesLocal(docs);
      try { if (docs.length > 0) localStorage.setItem('cat_v2__catalogoConvDetalles', JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* noop */ }
    } catch (e) {
      console.error('Error refrescando detalles de convenios:', e);
    }
  }, []);

  const abrirEditorConvenio = (c: any) => {
    setDetalleConvEditando({
      id: c.id,
      tipoConvenioId: c.tipoConvenioId ?? c.tarifaBaseId ?? '',
      tipoConvenioNombre: c.tipoConvenioNombre ?? c.descripcion ?? '',
      origenNombre: c.origenNombre ?? c.origen ?? '',
      destinoNombre: c.destinoNombre ?? c.destino ?? '',
      tarifa: c.tarifa ?? '',
      costo: c.costo ?? '',
      venta: c.venta ?? '',
    });
  };

  const abrirNuevoConvenioCliente = () => {
    if (!clientePagaIdResuelto) { alert('Selecciona primero un Cliente (Paga) para agregarle un convenio.'); return; }
    setDetalleConvEditando({
      id: '', esNuevo: true,
      tipoConvenioId: '', tipoConvenioNombre: '',
      origenNombre: '', destinoNombre: '',
      tarifa: '', costo: '', venta: '',
    });
  };

  const guardarDetalleConvenio = async () => {
    if (!detalleConvEditando) return;
    setGuardandoDetalleConv(true);
    try {
      const numOrUndef = (v: any) => (v === '' || v === null || v === undefined) ? undefined : Number(v);
      const payload: any = {
        tipoConvenioId: detalleConvEditando.tipoConvenioId || '',
        tipoConvenioNombre: detalleConvEditando.tipoConvenioNombre || '',
      };
      const t = numOrUndef(detalleConvEditando.tarifa);
      if (t !== undefined) payload.tarifa = t;

      if (detalleConvEditando.esNuevo) {
        if (!clientePagaIdResuelto) { alert('Selecciona un Cliente (Paga) válido antes de agregar el convenio.'); setGuardandoDetalleConv(false); return; }
        payload.clienteId = clientePagaIdResuelto;
        if (convenioClienteMaestroId) payload.convenioId = convenioClienteMaestroId;
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'convenios_clientes_detalles'), payload);
      } else {
        await updateDoc(doc(db, 'convenios_clientes_detalles', String(detalleConvEditando.id)), payload);
      }
      await refrescarConvDetallesCliente();
      setDetalleConvEditando(null);
    } catch (e) {
      console.error('Error guardando detalle de convenio:', e);
      alert('No se pudo guardar el convenio. Revisa tu conexión.');
    } finally {
      setGuardandoDetalleConv(false);
    }
  };

  const eliminarDetalleConvenio = async (c: any) => {
    const nombre = c.descripcion || c.tipoConvenioNombre || 'esta tarifa';
    if (!window.confirm(`¿Eliminar el convenio/tarifa "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteDoc(doc(db, 'convenios_clientes_detalles', String(c.id)));
      if (formData.convenio === c.id) { setFormData(prev => ({ ...prev, convenio: '' })); setSearchConvenio(''); }
      await refrescarConvDetallesCliente();
    } catch (e) {
      console.error('Error eliminando detalle de convenio:', e);
      alert('No se pudo eliminar. Revisa tu conexión.');
    }
  };

  const refrescarConvProvDetalles = useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, 'convenios_proveedores_detalles'));
      const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      setConvProvDetallesLocal(docs);
      try { if (docs.length > 0) localStorage.setItem('cat_v2__catalogoConvProvDetalles', JSON.stringify({ ts: Date.now(), data: docs })); } catch { /* noop */ }
    } catch (e) {
      console.error('Error refrescando detalles de convenios de proveedor:', e);
    }
  }, []);

  const abrirEditorConvenioProv = (c: any) => {
    setDetalleConvProvEditando({
      id: c.id,
      tipoConvenioId: c.tipoConvenioId ?? c.tarifaBaseId ?? '',
      tipoConvenioNombre: c.tipoConvenioNombre ?? '',
      tarifa: c.tarifa ?? '',
      costo: c.costo ?? '',
      venta: c.venta ?? '',
    });
  };

  const abrirNuevoConvenioProv = () => {
    if (!proveedorIdResuelto) { alert('Selecciona primero un Proveedor de Transporte para agregarle un convenio.'); return; }
    setDetalleConvProvEditando({
      id: '', esNuevo: true,
      tipoConvenioId: '', tipoConvenioNombre: '',
      tarifa: '', costo: '', venta: '',
    });
  };

  const guardarDetalleConvenioProv = async () => {
    if (!detalleConvProvEditando) return;
    setGuardandoDetalleConvProv(true);
    try {
      const numOrUndef = (v: any) => (v === '' || v === null || v === undefined) ? undefined : Number(v);
      const payload: any = {
        tipoConvenioId: detalleConvProvEditando.tipoConvenioId || '',
        tipoConvenioNombre: detalleConvProvEditando.tipoConvenioNombre || '',
      };
      const t = numOrUndef(detalleConvProvEditando.tarifa);
      if (t !== undefined) payload.tarifa = t;

      if (detalleConvProvEditando.esNuevo) {
        if (!proveedorIdResuelto) { alert('Selecciona un Proveedor de Transporte válido antes de agregar el convenio.'); setGuardandoDetalleConvProv(false); return; }
        payload.proveedorId = proveedorIdResuelto;
        if (convenioProvMaestroId) payload.convenioId = convenioProvMaestroId;
        payload.createdAt = new Date().toISOString();
        await addDoc(collection(db, 'convenios_proveedores_detalles'), payload);
      } else {
        await updateDoc(doc(db, 'convenios_proveedores_detalles', String(detalleConvProvEditando.id)), payload);
      }
      await refrescarConvProvDetalles();
      setDetalleConvProvEditando(null);
    } catch (e) {
      console.error('Error guardando detalle de convenio de proveedor:', e);
      alert('No se pudo guardar el convenio. Revisa tu conexión.');
    } finally {
      setGuardandoDetalleConvProv(false);
    }
  };

  const eliminarDetalleConvenioProv = async (c: any) => {
    const nombre = c.tipoConvenioNombre || c.descripcion || 'esta tarifa';
    if (!window.confirm(`¿Eliminar el convenio/tarifa "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await deleteDoc(doc(db, 'convenios_proveedores_detalles', String(c.id)));
      if (formData.convenioProveedor === c.id) { setFormData(prev => ({ ...prev, convenioProveedor: '' })); setSearchConvenioProveedor(''); }
      await refrescarConvProvDetalles();
    } catch (e) {
      console.error('Error eliminando detalle de convenio de proveedor:', e);
      alert('No se pudo eliminar. Revisa tu conexión.');
    }
  };


  const idOperacion = (initialData as any)?.id || '';
  const referenciaOperacion = referenciaDeOperacion(idOperacion, (initialData as any)?.ref);

  if (!catalogosCacheados || !catalogosCacheados.empresas) return <div className={`modal-overlay`}><div className="form-card fo-x6">Cargando catálogos de Roelca...</div></div>;

  return (
    <div
      className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}
      style={
        estado === 'minimizado'
          ? { padding: 0, background: 'transparent', pointerEvents: 'none', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, margin: 0 }
          : { padding: 0, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, margin: 0 }
      }
    >
      <style>{`
        .campo-badge { display: inline-block; font-family: monospace; font-size: 0.62rem; font-weight: 400; color: #6e7681; background: rgba(110,118,129,0.14); padding: 1px 5px; border-radius: 4px; margin-left: 6px; vertical-align: middle; letter-spacing: 0; }
        .roelca-form-shell { width: 100%; height: 100%; max-width: 100%; background-color: #0a0d14; border-radius: 0; display: flex; overflow: hidden; box-shadow: none; border: none; }
        .roelca-form-left { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; background-color: #0a0d14; }
        .roelca-form-right { width: 400px; background-color: #0d1117; border-left: 1px solid #1f2733; display: flex; flex-direction: column; flex-shrink: 0; }
        .roelca-form-header { padding: 20px 32px; border-bottom: 1px solid #1f2733; display: flex; align-items: flex-start; justify-content: space-between; flex-shrink: 0; background-color: #0d1117; }
        .roelca-form-header h2 { margin: 0; font-size: 1.4rem; font-weight: 700; color: #f0f6fc; letter-spacing: -0.2px; }
        .roelca-form-header p { margin: 4px 0 0 0; font-size: 0.82rem; color: #7d8590; font-weight: 400; }
        .roelca-window-btn { background: transparent; border: 1px solid #2d333b; color: #8b949e; width: 36px; height: 36px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
        .roelca-window-btn:hover { background-color: #1f2733; color: #c9d1d9; border-color: #3d444d; }
        .roelca-window-btn.danger:hover { color: #f85149; border-color: rgba(248,81,73,0.4); background-color: rgba(248,81,73,0.08); }
        .roelca-tabs { display: flex; gap: 2px; padding: 0 32px; border-bottom: 1px solid #1f2733; background-color: #0d1117; flex-shrink: 0; overflow-x: auto; white-space: nowrap; }
        .roelca-tabs::-webkit-scrollbar { height: 0; }
        .roelca-tab { display: inline-flex; align-items: center; gap: 8px; padding: 15px 20px; background: transparent; border: none; border-bottom: 2px solid transparent; color: #7d8590; font-weight: 500; font-size: 0.9rem; cursor: pointer; transition: all 0.15s ease; margin-bottom: -1px; letter-spacing: 0.1px; }
        .roelca-tab:hover { color: #c9d1d9; }
        .roelca-tab.active { color: #fb923c; border-bottom-color: #fb923c; font-weight: 600; }
        .roelca-scroll { flex: 1; overflow-y: auto; padding: 28px 32px; background-color: #0a0d14; }
        .roelca-scroll::-webkit-scrollbar { width: 8px; }
        .roelca-scroll::-webkit-scrollbar-track { background: transparent; }
        .roelca-scroll::-webkit-scrollbar-thumb { background: #21262d; border-radius: 4px; }
        .roelca-scroll::-webkit-scrollbar-thumb:hover { background: #2d333b; }
        .roelca-card { background-color: #0d1117; border: 1px solid #1f2733; border-radius: 12px; padding: 24px 26px; margin-bottom: 18px; transition: border-color 0.2s ease; max-width: 1100px; }
        .roelca-card:hover { border-color: #2d333b; }
        .roelca-card-header { display: flex; align-items: center; gap: 12px; margin: 0 0 20px 0; padding-bottom: 14px; border-bottom: 1px solid #1f2733; }
        .roelca-card-icon { width: 36px; height: 36px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background-color: rgba(251, 146, 60, 0.08); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.18); }
        .roelca-card-title { margin: 0; font-size: 0.98rem; font-weight: 600; color: #e6edf3; letter-spacing: 0.1px; }
        .roelca-sidebar-section { padding: 16px 18px; background-color: #161b22; border: 1px solid #1f2733; border-radius: 10px; margin-bottom: 12px; transition: border-color 0.2s ease; }
        .roelca-sidebar-section:hover { border-color: #2d333b; }
        .roelca-sidebar-label { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 0.68rem; color: #7d8590; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
        .roelca-sidebar-icon { width: 26px; height: 26px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; background-color: rgba(251, 146, 60, 0.08); color: #fb923c; border: 1px solid rgba(251, 146, 60, 0.15); }
        .roelca-sidebar-value { color: #e6edf3; font-weight: 600; font-size: 0.92rem; word-break: break-word; line-height: 1.35; }
        .roelca-sidebar-muted { color: #6e7681; font-size: 0.85rem; font-weight: 400; }
        .roelca-sidebar-secondary { color: #8b949e; font-size: 0.8rem; margin-top: 5px; font-weight: 400; }
        .roelca-route-line { display: flex; align-items: center; gap: 8px; color: #8b949e; font-size: 0.8rem; margin-top: 8px; }
        .roelca-chip { display: inline-flex; align-items: center; padding: 3px 9px; background-color: #1f2733; border: 1px solid #2d333b; border-radius: 12px; font-size: 0.7rem; color: #c9d1d9; font-weight: 500; letter-spacing: 0.2px; }
        .roelca-money-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 0.85rem; }
        .roelca-money-row .lbl { color: #8b949e; font-weight: 400; }
        .roelca-money-row .val { color: #e6edf3; font-weight: 600; }
        .roelca-utility-box { margin-top: 10px; padding: 16px 18px; background: linear-gradient(135deg, rgba(63, 185, 80, 0.08), rgba(63, 185, 80, 0.02)); border: 1px solid rgba(63, 185, 80, 0.3); border-radius: 10px; }
        .roelca-utility-box.negative { background: linear-gradient(135deg, rgba(248, 81, 73, 0.08), rgba(248, 81, 73, 0.02)); border-color: rgba(248, 81, 73, 0.3); }
        .roelca-utility-label { font-size: 0.68rem; color: #7d8590; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 6px; }
        .roelca-utility-value { font-size: 1.75rem; font-weight: 700; line-height: 1.1; color: #3fb950; letter-spacing: -0.5px; font-variant-numeric: tabular-nums; }
        .roelca-utility-box.negative .roelca-utility-value { color: #f85149; }
        .roelca-form-footer { padding: 20px; border-top: 1px solid #1f2733; background-color: #0d1117; display: flex; flex-direction: column; gap: 10px; flex-shrink: 0; }
        .roelca-btn-primary { width: 100%; padding: 14px 18px; background: linear-gradient(180deg, #ea580c, #c2410c); color: white; border: 1px solid rgba(255,255,255,0.08); border-radius: 9px; font-size: 0.95rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 8px; letter-spacing: 0.2px; box-shadow: 0 2px 4px rgba(234, 88, 12, 0.15), 0 4px 12px rgba(0,0,0,0.2); }
        .roelca-btn-primary:hover:not(:disabled) { background: linear-gradient(180deg, #f97316, #ea580c); transform: translateY(-1px); }
        .roelca-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .roelca-btn-outline { width: 100%; padding: 13px 18px; background: transparent; color: #c9d1d9; border: 1px solid #2d333b; border-radius: 9px; font-size: 0.88rem; font-weight: 500; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
        .roelca-btn-outline:hover { background-color: #1f2733; border-color: #3d444d; }
        .status-badge-ok { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 20px; background-color: rgba(63, 185, 80, 0.1); color: #3fb950; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; border: 1px solid rgba(63, 185, 80, 0.25); }
        .status-badge-error { display: inline-flex; align-items: center; gap: 4px; padding: 5px 11px; border-radius: 20px; background-color: rgba(248, 81, 73, 0.1); color: #f85149; font-size: 0.68rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; border: 1px solid rgba(248, 81, 73, 0.25); }
        .status-preview-card { padding: 14px 16px; background: linear-gradient(135deg, rgba(63, 185, 80, 0.06), rgba(63, 185, 80, 0.02)); border: 1px solid rgba(63, 185, 80, 0.25); border-radius: 10px; margin-bottom: 14px; }
        .status-error-card { padding: 14px 16px; background: linear-gradient(135deg, rgba(248, 81, 73, 0.06), rgba(248, 81, 73, 0.02)); border: 1px solid rgba(248, 81, 73, 0.25); border-radius: 10px; margin-bottom: 14px; }
        .roelca-lookup-row { display: flex; gap: 8px; align-items: flex-start; }
        .roelca-lookup-row > .roelca-lookup-input { flex: 1; min-width: 0; position: relative; }
        .campo-obligatorio-faltante, .campo-obligatorio-faltante:focus { border-color: #f85149 !important; background-color: rgba(248, 81, 73, 0.06) !important; box-shadow: 0 0 0 1px rgba(248, 81, 73, 0.35) !important; }
        @media (max-width: 1024px) { .roelca-form-shell { flex-direction: column; } .roelca-form-right { width: 100%; border-left: none; border-top: 1px solid #1f2733; max-height: 40vh; } }
      `}</style>

      <div className="roelca-form-shell" style={{ display: estado === 'minimizado' ? 'none' : 'flex' }}>
        <div className="roelca-form-left">
          <div className="roelca-form-header">
            <div>
              <h2>{initialData ? `Editar Operación ${initialData.ref || initialData.id?.substring(0,6)}` : 'Nueva Operación'}</h2>
              <p>{initialData ? 'Modifica los datos y guarda los cambios' : 'Completa el formulario para registrar una nueva operación'}</p>
            </div>
            <div className="fo-x7">
              <button type="button" onClick={() => { if (!idOperacion) { alert('Guarda la operación primero para poder adjuntarle documentos.'); return; } setMostrarSubirDoc(true); }} className="roelca-window-btn" title={idOperacion ? 'Subir documentos de la operación' : 'Guarda la operación primero'} style={{ width: 'auto', padding: '0 12px', gap: '6px', color: idOperacion ? '#fb923c' : '#6e7681', borderColor: idOperacion ? 'rgba(251,146,60,0.4)' : '#2d333b' }}>
                <IconFileText size={15} /> <span className="fo-x8">Documentos</span>
              </button>
              <button type="button" onClick={onMinimize} className="roelca-window-btn" title="Minimizar"><IconMinimize size={16} /></button>
              <button type="button" onClick={handleCancelarConfirmado} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
          </div>

          <div className="roelca-tabs">
            {pestanasVisibles.includes('general') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'general' ? 'active' : ''}`} onClick={() => setPestañaActiva('general')}><IconBriefcase size={15} /> Información General</button>)}
            {pestanasVisibles.includes('pedimento') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'pedimento' ? 'active' : ''}`} onClick={() => setPestañaActiva('pedimento')}><IconFileText size={15} /> Pedimento y CT</button>)}
            {pestanasVisibles.includes('manifiesto') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'manifiesto' ? 'active' : ''}`} onClick={() => setPestañaActiva('manifiesto')}><IconClipboard size={15} /> Entry's y Manifiestos</button>)}
            {pestanasVisibles.includes('unidad') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'unidad' ? 'active' : ''}`} onClick={() => setPestañaActiva('unidad')}><IconTruck size={15} /> Unidad y Operador</button>)}
            {pestanasVisibles.includes('cobrar') && (<button type="button" className={`roelca-tab ${pestañaActiva === 'cobrar' ? 'active' : ''}`} onClick={() => setPestañaActiva('cobrar')}><IconDollar size={15} /> Por Cobrar</button>)}
          </div>

          <form className="fo-x9" onSubmit={handleSubmit}>
            <div className="roelca-scroll">
              {pestañaActiva === 'general' && pestanasVisibles.includes('general') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconBriefcase /></div><h3 className="roelca-card-title">Tipo de Servicio y Fechas</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label orange">Referencia <span className="campo-badge">ref</span></label>
                        {initialData ? (
                          <input type="text" name="referencia" className="form-control" value={referencia} onChange={(e) => setReferencia(e.target.value)} readOnly={!puedeEditarRef} title={puedeEditarRef ? 'Tienes permiso para corregir la referencia' : 'No tienes permiso para editar la referencia'} style={{ color: colorTipoOperacion(tiposOperacion?.find((op:any) => op.id === formData.tipoOperacionId)?.tipo_operacion), fontWeight: 'bold', ...(puedeEditarRef ? { borderColor: '#fb923c' } : { opacity: 0.65, cursor: 'not-allowed' }) }} />
                        ) : (
                          <input type="text" className="form-control fo-x10" value="Se generará al guardar" readOnly />
                        )}
                      </div>
                      <div className="form-group"><label className="form-label orange">Tipo de Operación <span className="campo-badge">tipoOperacionId</span></label><select name="tipoOperacionId" className={`form-control${claseSiFalta('tipoOperacionId')}`} value={formData.tipoOperacionId || ''} onChange={handleChange} required style={{ color: formData.tipoOperacionId ? colorTipoOperacion(tiposOperacion?.find((op:any) => op.id === formData.tipoOperacionId)?.tipo_operacion) : undefined, fontWeight: formData.tipoOperacionId ? 'bold' : undefined }}><option value="">-- Seleccionar --</option>{tiposOperacion?.map((op:any) => <option key={op.id} value={op.id} style={{ color: colorTipoOperacion(op.tipo_operacion), fontWeight: 'bold' }}>{op.tipo_operacion}</option>)}</select></div>
                      <div className="form-group"><label className="form-label orange">Fecha de Servicio <span className="campo-badge">fechaServicio</span></label><input type="date" name="fechaServicio" className={`form-control${claseSiFalta('fechaServicio')}`} value={formData.fechaServicio || ''} onChange={handleChange} required />{buscandoTC ? <small className="fo-x11">Buscando TC...</small> : <small style={{ color: (formData.tipoCambioAprobado || tipoCambioDia) ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>TC Oficial: {(formData.tipoCambioAprobado || tipoCambioDia) ? `$${(formData.tipoCambioAprobado || tipoCambioDia)}` : 'Sin Registro'}</small>}</div>
                      {isFletes && (<div className="form-group"><label className="form-label orange">Fecha de Cita <span className="campo-badge">fechaCita</span></label><input type="datetime-local" name="fechaCita" className={`form-control${claseSiFalta('fechaCita')}`} value={formData.fechaCita || ''} onChange={handleChange} /></div>)}
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconUsers /></div><h3 className="roelca-card-title">Cliente y Convenio</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Cliente (Paga) <span className="campo-badge">clientePaga</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('clientePaga')}`} placeholder="Escriba para buscar cliente..." required={!formData.clientePaga && !searchClientePaga} value={searchClientePaga} onChange={e => { setSearchClientePaga(e.target.value); setShowDropdownClientePaga(true); if (formData.clientePaga) setFormData(prev => ({ ...prev, clientePaga: '', convenio: '' })); }} onFocus={() => setShowDropdownClientePaga(true)} onBlur={() => setTimeout(() => setShowDropdownClientePaga(false), 200)} />
                            {showDropdownClientePaga && searchClientePaga && (
                              <div className="fo-x12">
                                {resultadosClientePaga.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosClientePaga.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); const monedaDefault = resolverMonedaIdDeEmpresa(c); setFormData(prev => ({ ...prev, clientePaga: c.id, convenio: '', facturadoEnCobrar: monedaDefault })); setSearchClientePaga(nombreEmpresaMostrar(c)); setSearchConvenio(''); setShowDropdownClientePaga(false); }}>
                                    <div className="fo-x15">{nombreEmpresaMostrar(c)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <BotonAgregar title="Agregar nuevo Cliente (Paga)" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_CLIENTE_PAGA }, (id, reg) => { setFormData(prev => ({ ...prev, clientePaga: id, convenio: '', facturadoEnCobrar: resolverMonedaIdDeEmpresa(reg) })); setSearchClientePaga(labelEmpresa(reg)); setSearchConvenio(''); })} />
                        </div>
                      </div>
                      <div className="form-group">
                        <div className="fo-x16">
                          <label className="form-label fo-x17">Convenio (Tarifa) <span className="campo-badge">convenio</span></label>
                          {(formData.clientePaga || searchClientePaga) && (
                            <button className="fo-x18" type="button" onClick={() => setMostrarConveniosCliente(true)} title="Ver y editar los convenios (tarifas) de este cliente">
                              <IconReceipt size={12} /> Ver / editar ({listaConveniosCliente.length})
                            </button>
                          )}
                          {/* ✅ V00126: editar la MONEDA/tarifa del detalle elegido, directo desde aquí */}
                          {formData.convenio && <button className="fo-x18 fo-btn-det" type="button" onClick={() => setDetalleConvenioEdit({ tipo: 'cliente', detalleId: String(formData.convenio) })} title="Cambiar la moneda o tarifa del detalle del convenio elegido">✎ Moneda del detalle</button>}
                        </div>
                        <div className="fo-x19">
                          <input type="text" className={`form-control${claseSiFalta('convenio')}`} placeholder="Buscar por nombre o ID de tarifa..." required={!formData.convenio} disabled={listaConveniosCliente.length === 0} value={searchConvenio} onChange={e => { setSearchConvenio(e.target.value); setShowDropdownConvenio(true); if (formData.convenio) setFormData(prev => ({ ...prev, convenio: '' })); }} onFocus={() => setShowDropdownConvenio(true)} onBlur={() => setTimeout(() => setShowDropdownConvenio(false), 200)} />
                          {showDropdownConvenio && (
                            <div className="fo-x12">
                              {resultadosConvenio.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosConvenio.map((c:any) => (
                                <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, convenio: c.id })); setSearchConvenio(etiquetaConvenioCliente(c)); setShowDropdownConvenio(false); }}>
                                  {/* ✅ V00126: nombre + monto + moneda en la misma línea */}
                                  <div className="fo-x15">{etiquetaConvenioCliente(c)}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {listaConveniosCliente.length === 0 && searchClientePaga && <small className="fo-x21">Este cliente no tiene convenios asignados</small>}
                      </div>
                      <div className="form-group">
                        <label className="form-label">Importación / Exportación <span className="campo-badge">trafico</span></label>
                        <input type="text" className="form-control fo-x22" value={(formData.trafico && formData.trafico !== 'N/A') ? formData.trafico : ''} readOnly placeholder="Se define por el convenio" title="Se asigna automáticamente según el convenio (no editable)" />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Cargada / Vacía <span className="campo-badge">carga</span></label>
                        <input type="text" className="form-control fo-x22" value={(formData.carga && formData.carga !== 'N/A') ? formData.carga : ''} readOnly placeholder="Se define por el convenio" title="Se asigna automáticamente según el convenio (no editable)" />
                      </div>
                      <div className="form-group">
                        <label className="form-label"># de Remolque <span className="campo-badge">numeroRemolque</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('numeroRemolque')}`} placeholder="Buscar remolque..." value={searchRemolque} onChange={e => { setSearchRemolque(e.target.value); setShowDropdownRemolque(true); if (formData.numeroRemolque) setFormData(prev => ({ ...prev, numeroRemolque: '' })); }} onFocus={() => setShowDropdownRemolque(true)} onBlur={() => setTimeout(() => setShowDropdownRemolque(false), 200)} />
                            {showDropdownRemolque && searchRemolque && (<div className="fo-x12">{resultadosRemolque.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosRemolque.map((r:any) => (<div className="fo-x14" key={r.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, numeroRemolque: r.id })); setSearchRemolque(labelRemolque(r)); setShowDropdownRemolque(false); }}><div className="fo-x15">{labelRemolque(r)}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Remolque" onClick={() => abrirCreacion({ tipo: 'remolque', coleccion: 'remolques' }, (id, reg) => { setFormData(prev => ({ ...prev, numeroRemolque: id })); setSearchRemolque(labelRemolque(reg)); })} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Ref Cliente <span className="campo-badge">refCliente</span></label><input type="text" name="refCliente" className={`form-control${claseSiFalta('refCliente')}`} value={formData.refCliente || ''} onChange={handleChange} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconRoute /></div><h3 className="roelca-card-title">Ruta y Observaciones</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label orange">Origen <span className="campo-badge">origen</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('origen')}`} placeholder="Buscar origen..." value={searchOrigen} onChange={e => { setSearchOrigen(e.target.value); setShowDropdownOrigen(true); }} onFocus={() => setShowDropdownOrigen(true)} onBlur={() => setTimeout(() => setShowDropdownOrigen(false), 200)} />
                            {showDropdownOrigen && searchOrigen && (<div className="fo-x12">{resultadosOrigen.map((o:any) => (<div className="fo-x14" key={o.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, origen: o.id })); setSearchOrigen(nombreEmpresaMostrar(o)); setShowDropdownOrigen(false); }}><div className="fo-x23">{nombreEmpresaMostrar(o)}{paisDeEmpresaOD(o) && <span style={{ fontSize: '0.65rem', fontWeight: 'bold', padding: '1px 6px', borderRadius: '999px', border: `1px solid ${paisDeEmpresaOD(o) === 'USA' ? '#3b82f6' : '#3fb950'}`, backgroundColor: paisDeEmpresaOD(o) === 'USA' ? 'rgba(59,130,246,0.15)' : 'rgba(63,185,80,0.15)', color: paisDeEmpresaOD(o) === 'USA' ? '#3b82f6' : '#3fb950' }}>{paisDeEmpresaOD(o) === 'USA' ? 'EE.UU.' : 'MX'}</span>}</div><div style={{ fontSize: '0.8rem', fontWeight: 500, color: paisDeEmpresaOD(o) === 'USA' ? '#3b82f6' : paisDeEmpresaOD(o) === 'MX' ? '#3fb950' : '#8b949e' }}>{direccionFormateadaOD(o)}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Origen/Destino" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_ORIGEN_DESTINO }, (id, reg) => { setFormData(prev => ({ ...prev, origen: id })); setSearchOrigen(labelEmpresa(reg)); })} />
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label orange">Destino <span className="campo-badge">destino</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('destino')}`} placeholder="Buscar destino..." value={searchDestino} onChange={e => { setSearchDestino(e.target.value); setShowDropdownDestino(true); }} onFocus={() => setShowDropdownDestino(true)} onBlur={() => setTimeout(() => setShowDropdownDestino(false), 200)} />
                            {showDropdownDestino && searchDestino && (<div className="fo-x12">{resultadosDestino.map((d:any) => (<div className="fo-x14" key={d.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, destino: d.id })); setSearchDestino(nombreEmpresaMostrar(d)); setShowDropdownDestino(false); }}><div className="fo-x23">{nombreEmpresaMostrar(d)}{paisDeEmpresaOD(d) && <span style={{ fontSize: '0.65rem', fontWeight: 'bold', padding: '1px 6px', borderRadius: '999px', border: `1px solid ${paisDeEmpresaOD(d) === 'USA' ? '#3b82f6' : '#3fb950'}`, backgroundColor: paisDeEmpresaOD(d) === 'USA' ? 'rgba(59,130,246,0.15)' : 'rgba(63,185,80,0.15)', color: paisDeEmpresaOD(d) === 'USA' ? '#3b82f6' : '#3fb950' }}>{paisDeEmpresaOD(d) === 'USA' ? 'EE.UU.' : 'MX'}</span>}</div><div style={{ fontSize: '0.8rem', fontWeight: 500, color: paisDeEmpresaOD(d) === 'USA' ? '#3b82f6' : paisDeEmpresaOD(d) === 'MX' ? '#3fb950' : '#8b949e' }}>{direccionFormateadaOD(d)}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Origen/Destino" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_ORIGEN_DESTINO }, (id, reg) => { setFormData(prev => ({ ...prev, destino: id })); setSearchDestino(labelEmpresa(reg)); })} />
                        </div>
                      </div>
                      {/* ✅ NUEVO: kilometraje estimado del viaje (junto a Destino) */}
                      <div className="form-group">
                        <label className="form-label">Kilometraje Estimado <span className="campo-badge">kilometrajeEstimado</span></label>
                        <input type="number" min="0" step="1" name="kilometrajeEstimado" className={`form-control${claseSiFalta('kilometrajeEstimado')}`} value={formData.kilometrajeEstimado ?? ''} onChange={handleChange} placeholder="km" />
                      </div>
                      <div className="form-group fo-x24"><label className="form-label">Observaciones Ejecutivo <span className="campo-badge">observacionesEjecutivo</span></label><input type="text" name="observacionesEjecutivo" className={`form-control${claseSiFalta('observacionesEjecutivo')}`} value={formData.observacionesEjecutivo || ''} onChange={handleChange} /></div>
                    </div>
                  </div>
                </>
              )}

              {pestañaActiva === 'pedimento' && pestanasVisibles.includes('pedimento') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconPackage /></div><h3 className="roelca-card-title">Cliente y Mercancía</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Cliente (Mercancía) <span className="campo-badge">clienteMercancia</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('clienteMercancia')}`} placeholder="Buscar cliente de mercancía..." value={searchClienteMercancia} onChange={e => { setSearchClienteMercancia(e.target.value); setShowDropdownClienteMercancia(true); if (formData.clienteMercancia) setFormData(prev => ({ ...prev, clienteMercancia: '' })); }} onFocus={() => setShowDropdownClienteMercancia(true)} onBlur={() => setTimeout(() => setShowDropdownClienteMercancia(false), 200)} />
                            {showDropdownClienteMercancia && searchClienteMercancia && (
                              <div className="fo-x12">
                                {resultadosClienteMercancia.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosClienteMercancia.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, clienteMercancia: c.id })); setSearchClienteMercancia(nombreEmpresaMostrar(c)); setShowDropdownClienteMercancia(false); }}>
                                    <div className="fo-x15">{nombreEmpresaMostrar(c)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <BotonAgregar title="Agregar nuevo Cliente (Mercancía)" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_CLIENTE_MERCANCIA }, (id, reg) => { setFormData(prev => ({ ...prev, clienteMercancia: id })); setSearchClienteMercancia(labelEmpresa(reg)); })} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Descripción de Mercancía <span className="campo-badge">descripcionMercancia</span></label><input type="text" name="descripcionMercancia" className={`form-control${claseSiFalta('descripcionMercancia')}`} value={formData.descripcionMercancia || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Cantidad <span className="campo-badge">cantidad</span></label><input type="text" name="cantidad" className={`form-control${claseSiFalta('cantidad')}`} value={formData.cantidad || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Embalaje <span className="campo-badge">embalaje</span></label><select name="embalaje" className={`form-control${claseSiFalta('embalaje')}`} value={formData.embalaje || ''} onChange={handleChange}><option value="">-- Seleccionar --</option>{(embalajesLocal || []).map((em:any) => ({ id: String(em.id), texto: String(em.clave ?? em.Clave ?? em.CLAVE ?? em.embalaje ?? em.nombre ?? em.descripcion ?? em.tipo ?? '').trim() })).filter((o:any) => o.texto !== '').sort((a:any, b:any) => a.texto.localeCompare(b.texto, 'es', { sensitivity: 'base' })).map((o:any) => <option key={o.id} value={o.id}>{o.texto}</option>)}</select></div>
                      <div className="form-group"><label className="form-label">Peso (Kg) <span className="campo-badge">pesoKg</span></label><input type="number" name="pesoKg" className={`form-control${claseSiFalta('pesoKg')}`} value={formData.pesoKg || ''} onChange={handleChange} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconFileText /></div><h3 className="roelca-card-title">Documentación (Carta Porte / DODA)</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># DODA <span className="campo-badge">numDoda</span></label><input type="text" name="numDoda" className={`form-control${claseSiFalta('numDoda')}`} value={formData.numDoda || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Fecha Emisión DODA <span className="campo-badge">fechaEmisionDoda</span></label><input type="date" name="fechaEmisionDoda" className={`form-control${claseSiFalta('fechaEmisionDoda')}`} value={formData.fechaEmisionDoda || ''} onChange={handleChange} /></div>
                      <CampoArchivo label="PDF Carta Porte" file={formData.pdfCartaPorte} resaltar={camposObligatoriosFaltantesSet.has('pdfCartaPorte')} onChange={(e) => handleFileChange(e, 'pdfCartaPorte')} />
                      <CampoArchivo label="PDF DODA" file={formData.pdfDoda} resaltar={camposObligatoriosFaltantesSet.has('pdfDoda')} onChange={(e) => handleFileChange(e, 'pdfDoda')} />
                    </div>
                  </div>
                </>
              )}

              {pestañaActiva === 'manifiesto' && pestanasVisibles.includes('manifiesto') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconClipboard /></div><h3 className="roelca-card-title">Entry's</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># de Entry's <span className="campo-badge">numeroEntrys</span></label><input type="text" name="numeroEntrys" className={`form-control${claseSiFalta('numeroEntrys')}`} value={formData.numeroEntrys || ''} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Cantidad de Entry's <span className="campo-badge">cantEntrys</span></label>
                        <input type="number" min={0} name="cantEntrys" className={`form-control${claseSiFalta('cantEntrys')}`} value={formData.cantEntrys || 0} onChange={(e) => { const n = Math.max(0, parseInt(e.target.value || '0', 10) || 0); setFormData(prev => { const arr = [...(prev.pdfsEntrys || [])]; arr.length = n; return { ...prev, cantEntrys: n, pdfsEntrys: arr }; }); }} />
                      </div>
                    </div>
                    {Number(formData.cantEntrys) > 0 && (
                      <div className="form-grid fo-x25">
                        {Array.from({ length: Number(formData.cantEntrys) }).map((_, i) => (
                          <CampoArchivo key={i} label={`PDF Entry #${i + 1}`} file={formData.pdfsEntrys?.[i]} onChange={(e) => handleFileChange(e, 'pdfsEntrys', i)} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconReceipt /></div><h3 className="roelca-card-title">Manifiesto</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># Manifiesto <span className="campo-badge">numManifiesto</span></label><input type="text" name="numManifiesto" className={`form-control${claseSiFalta('numManifiesto')}`} value={formData.numManifiesto || ''} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Proveedor de Servicios <span className="campo-badge">provServicios</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('provServicios')}`} placeholder="Buscar proveedor de servicios..." value={searchProvServicios} onChange={e => { setSearchProvServicios(e.target.value); setShowDropdownProvServicios(true); if (formData.provServicios) setFormData(prev => ({ ...prev, provServicios: '' })); }} onFocus={() => setShowDropdownProvServicios(true)} onBlur={() => setTimeout(() => setShowDropdownProvServicios(false), 200)} />
                            {showDropdownProvServicios && searchProvServicios && (
                              <div className="fo-x12">
                                {resultadosProvServicios.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosProvServicios.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, provServicios: c.id, montoManifiesto: montoManifiestoDeProveedor(c) })); setSearchProvServicios(nombreEmpresaMostrar(c)); setShowDropdownProvServicios(false); }}>
                                    <div className="fo-x15">{nombreEmpresaMostrar(c)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <BotonAgregar title="Agregar nuevo Proveedor (Servicios)" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_PROV_SERVICIOS }, (id, reg) => { setFormData(prev => ({ ...prev, provServicios: id, montoManifiesto: montoManifiestoDeProveedor(reg) })); setSearchProvServicios(labelEmpresa(reg)); })} />
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Costo Manifiesto <span className="campo-badge">montoManifiesto</span></label>
                        <ConSimboloMoneda><input type="number" step="0.01" name="montoManifiesto" className={`form-control${claseSiFalta('montoManifiesto')}`} value={formData.montoManifiesto || 0} onChange={handleChange} /></ConSimboloMoneda>
                        <small className="fo-x21">Costo por defecto: ${COSTO_MANIFIESTO_DEFAULT.toFixed(2)}</small>
                      </div>
                      <CampoArchivo label="PDF Manifiesto" file={formData.pdfManifiesto} resaltar={camposObligatoriosFaltantesSet.has('pdfManifiesto')} onChange={(e) => handleFileChange(e, 'pdfManifiesto')} />
                    </div>
                  </div>
                </>
              )}

              {pestañaActiva === 'unidad' && pestanasVisibles.includes('unidad') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconTruck /></div><h3 className="roelca-card-title">Proveedor de Transporte</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Proveedor de Transporte <span className="campo-badge">proveedorUnidad</span></label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('proveedorUnidad')}`} placeholder="Buscar proveedor de transporte..." value={searchProvTransporte} disabled={proveedorForzado} onChange={e => { setSearchProvTransporte(e.target.value); setShowDropdownProvTransporte(true); if (formData.proveedorUnidad) setFormData(prev => ({ ...prev, proveedorUnidad: '', convenioProveedor: '' })); }} onFocus={() => setShowDropdownProvTransporte(true)} onBlur={() => setTimeout(() => setShowDropdownProvTransporte(false), 200)} style={proveedorForzado ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} />
                            {showDropdownProvTransporte && searchProvTransporte && !proveedorForzado && (
                              <div className="fo-x12">
                                {resultadosProvTransporte.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosProvTransporte.map((c:any) => (
                                  <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); const monedaDefault = resolverMonedaIdDeEmpresa(c); setFormData(prev => ({ ...prev, proveedorUnidad: c.id, convenioProveedor: '', facturadoEnUnidad: monedaDefault || prev.facturadoEnUnidad })); setSearchProvTransporte(nombreEmpresaMostrar(c)); setSearchConvenioProveedor(''); setShowDropdownProvTransporte(false); }}>
                                    <div className="fo-x15">{nombreEmpresaMostrar(c)}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {!proveedorForzado && (
                            <BotonAgregar title="Agregar nuevo Proveedor (Transporte)" onClick={() => abrirCreacion({ tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_PROV_TRANSPORTE }, (id, reg) => { setFormData(prev => ({ ...prev, proveedorUnidad: id, convenioProveedor: '', facturadoEnUnidad: resolverMonedaIdDeEmpresa(reg) || prev.facturadoEnUnidad })); setSearchProvTransporte(labelEmpresa(reg)); setSearchConvenioProveedor(''); })} />
                          )}
                        </div>
                      </div>

                      {!esFlotaPropiaRoelca && (
                      <div className="form-group">
                        <div className="fo-x16">
                          <label className="form-label fo-x17">Convenio Proveedor <span className="campo-badge">convenioProveedor</span></label>
                          {(formData.proveedorUnidad || searchProvTransporte) && (
                            <button className="fo-x18" type="button" onClick={() => setMostrarConveniosProveedor(true)} title="Ver y editar los convenios (tarifas) de este proveedor">
                              <IconReceipt size={12} /> Ver / editar ({listaConveniosProveedor.length})
                            </button>
                          )}
                          {/* ✅ V00126: editar la MONEDA/tarifa del detalle elegido, directo desde aquí */}
                          {formData.convenioProveedor && <button className="fo-x18 fo-btn-det" type="button" onClick={() => setDetalleConvenioEdit({ tipo: 'proveedor', detalleId: String(formData.convenioProveedor) })} title="Cambiar la moneda o tarifa del detalle del convenio elegido">✎ Moneda del detalle</button>}
                        </div>
                        <div className="fo-x19">
                          <input type="text" className={`form-control${claseSiFalta('convenioProveedor')}`} placeholder="Buscar por nombre o ID de tarifa..." disabled={listaConveniosProveedor.length === 0} value={searchConvenioProveedor} onChange={e => { setSearchConvenioProveedor(e.target.value); setShowDropdownConvenioProveedor(true); if (formData.convenioProveedor) setFormData(prev => ({ ...prev, convenioProveedor: '' })); }} onFocus={() => setShowDropdownConvenioProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownConvenioProveedor(false), 200)} />
                          {showDropdownConvenioProveedor && (
                            <div className="fo-x12">
                              {resultadosConvenioProveedor.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosConvenioProveedor.map((c:any) => (
                                <div className="fo-x14" key={c.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, convenioProveedor: c.id, monedaConvenioProv: c.monedaBase, totalAPagarProv: c.tarifaMonto })); setSearchConvenioProveedor(etiquetaConvenioProveedor(c)); setShowDropdownConvenioProveedor(false); }}>
                                  {/* ✅ V00126: nombre + monto + moneda en la misma línea */}
                                  <div className="fo-x15">{etiquetaConvenioProveedor(c)}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {listaConveniosProveedor.length === 0 && searchProvTransporte && <small className="fo-x21">Este proveedor no tiene convenios asignados</small>}
                      </div>
                      )}

                      {!esFlotaPropiaRoelca && (
                      <div className="form-group">
                        <label className="form-label">Facturado En <span className="campo-badge">facturadoEnUnidad</span></label>
                        {/* ✅ V00129: re-sincronizar con la moneda actual de la empresa */}
                        <button type="button" className="fo-btn-act-moneda" disabled={actualizandoMoneda === 'proveedor'} onClick={() => actualizarMonedaDesdeEmpresa('proveedor')} title="Vuelve a leer la moneda del proveedor en la tabla Empresas y la aplica a este registro">{actualizandoMoneda === 'proveedor' ? '⏳…' : '⟳ Actualizar moneda'}</button>
                        {/* ✅ CAMBIO: ahora EDITABLE — se precarga del proveedor,
                            pero puedes corregir en qué moneda se factura. */}
                        {/* ✅ V00132: EDITABLE otra vez a petición — se precarga de la empresa (y "⟳ Actualizar moneda" la re-sincroniza), pero aquí puedes corregirla para esta operación */}
                        <select title="Se precarga de la moneda de la empresa; puedes cambiarla para esta operación" className="form-control" value={formData.facturadoEnUnidad || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, facturadoEnUnidad: e.target.value }))}
                          >
                          <option value="">— Sin definir —</option>
                          {opcionesFacturadoEn().map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                        </select>
                      </div>
                      )}
                    </div>
                  </div>

                  {showInternalFleet && (
                    <div className="roelca-card">
                      <div className="roelca-card-header"><div className="roelca-card-icon"><IconTruck /></div><h3 className="roelca-card-title">Flota Interna (Roelca)</h3></div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label className="form-label">Unidad <span className="campo-badge">unidad</span></label>
                          <div className="roelca-lookup-row">
                            <div className="roelca-lookup-input">
                              <input type="text" className={`form-control${claseSiFalta('unidad')}`} placeholder="Buscar unidad..." value={searchUnidad} onChange={e => { setSearchUnidad(e.target.value); setShowDropdownUnidad(true); if (formData.unidad) setFormData(prev => ({ ...prev, unidad: '' })); }} onFocus={() => setShowDropdownUnidad(true)} onBlur={() => setTimeout(() => setShowDropdownUnidad(false), 200)} />
                              {showDropdownUnidad && searchUnidad && (
                                <div className="fo-x12">
                                  {resultadosUnidad.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosUnidad.map((u:any) => (
                                    <div className="fo-x14" key={u.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, unidad: u.id })); setSearchUnidad(labelUnidad(u)); setShowDropdownUnidad(false); }}>
                                      <div className="fo-x15">{labelUnidad(u)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <BotonAgregar title="Agregar nueva Unidad" onClick={() => abrirCreacion({ tipo: 'unidad', coleccion: 'unidades' }, (id, reg) => { setFormData(prev => ({ ...prev, unidad: id })); setSearchUnidad(labelUnidad(reg)); })} />
                          </div>
                          {/* ✅ NUEVO: último servicio y última carga de diesel de la unidad */}
                          {formData.unidad && (
                            <div style={{ marginTop: '6px', fontSize: '0.75rem', lineHeight: 1.6, color: '#8b949e' }}>
                              {cargandoInfoUnidad ? (
                                <span>Consultando historial de la unidad…</span>
                              ) : infoUnidad ? (
                                <>
                                  <span style={{ display: 'block' }}>
                                    Último servicio: {infoUnidad.ultimaOpRef
                                      ? <><b style={{ color: '#58a6ff' }}>{infoUnidad.ultimaOpRef}</b> · {fmtFecha(infoUnidad.ultimaOpFecha || '')}</>
                                      : <span>sin servicios previos</span>}
                                  </span>
                                  <span style={{ display: 'block' }}>
                                    Última carga diesel: {infoUnidad.dieselConsecutivo
                                      ? <><b style={{ color: '#D84315' }}>{infoUnidad.dieselConsecutivo}</b> · {fmtFecha(infoUnidad.dieselFecha || '')}{infoUnidad.dieselGalones ? ` · ${infoUnidad.dieselGalones.toFixed(2)} gal` : ''}</>
                                      : <span>sin recargas registradas</span>}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          )}
                        </div>
                        <div className="form-group">
                          <label className="form-label">Operador <span className="campo-badge">operador</span></label>
                          <div className="roelca-lookup-row">
                            <div className="roelca-lookup-input">
                              <input type="text" className={`form-control${claseSiFalta('operador')}`} placeholder="Buscar operador..." value={searchOperador} onChange={e => { setSearchOperador(e.target.value); setShowDropdownOperador(true); if (formData.operador) setFormData(prev => ({ ...prev, operador: '' })); }} onFocus={() => setShowDropdownOperador(true)} onBlur={() => setTimeout(() => setShowDropdownOperador(false), 200)} />
                              {showDropdownOperador && searchOperador && (
                                <div className="fo-x12">
                                  {resultadosOperador.length === 0 ? <div className="fo-x13">Sin resultados</div> : resultadosOperador.map((o:any) => (
                                    <div className="fo-x14" key={o.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, operador: o.id })); setSearchOperador(labelEmpleado(o)); setShowDropdownOperador(false); }}>
                                      <div className="fo-x15">{labelEmpleado(o)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <BotonAgregar title="Agregar nuevo Operador" onClick={() => abrirCreacion({ tipo: 'empleado', coleccion: 'empleados' }, (id, reg) => { setFormData(prev => ({ ...prev, operador: id })); setSearchOperador(labelEmpleado(reg)); })} />
                          </div>
                        </div>
                        {/* Sueldo/Combustible base: BLOQUEADOS (vienen del tarifario de rendimientos). Los totales son calculados. */}
                        <div className="form-group"><label className="form-label">Sueldo Operador <span className="campo-badge">sueldoOperador</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.sueldoOperador || 0} readOnly={campoBloqueadoAut('sueldoOperador')} onChange={e => setFormData(prev => ({ ...prev, sueldoOperador: Number(e.target.value) || 0 }))} title={campoBloqueadoAut('sueldoOperador') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del tarifario de rendimientos; puedes ajustarlo manualmente'} style={campoBloqueadoAut('sueldoOperador') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} /></ConSimboloMoneda></div>
                        <div className="form-group"><label className="form-label">Sueldo Extra <span className="campo-badge">sueldoExtra</span></label><ConSimboloMoneda><input type="number" step="0.01" name="sueldoExtra" className="form-control" value={formData.sueldoExtra || 0} onChange={handleChange} /></ConSimboloMoneda></div>
                        <div className="form-group"><label className="form-label">Sueldo Total <span className="campo-badge">sueldoTotal</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x22" value={formData.sueldoTotal || 0} readOnly /></ConSimboloMoneda></div>
                        {/* Notas del Sueldo Extra: solo aparecen cuando el extra es distinto de 0. */}
                        {Number(formData.sueldoExtra) !== 0 && (
                          <div className="form-group fo-x24"><label className="form-label fo-x26">Notas del Sueldo Extra <span className="campo-badge">sueldoExtraNotas</span></label><input type="text" name="sueldoExtraNotas" className="form-control" placeholder="Motivo del sueldo extra..." value={formData.sueldoExtraNotas || ''} onChange={handleChange} /></div>
                        )}
                        <div className="form-group"><label className="form-label">Combustible <span className="campo-badge">combustible</span></label><input type="number" step="1" className="form-control" value={Math.round(Number(formData.combustible) || 0)} readOnly={campoBloqueadoAut('combustible')} onChange={e => setFormData(prev => ({ ...prev, combustible: Number(e.target.value) || 0 }))} title={campoBloqueadoAut('combustible') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del tarifario de rendimientos; puedes ajustarlo manualmente'} style={campoBloqueadoAut('combustible') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} /></div>
                        <div className="form-group"><label className="form-label">Combustible Extra <span className="campo-badge">combustibleExtra</span></label><input type="number" step="1" className="form-control" value={Math.round(Number(formData.combustibleExtra) || 0)} onChange={(e) => setFormData(prev => ({ ...prev, combustibleExtra: Math.round(Number(e.target.value) || 0) }))} /></div>
                        <div className="form-group"><label className="form-label">Combustible Total <span className="campo-badge">combustibleTotal</span></label><input type="number" step="1" className="form-control fo-x22" value={Math.round(Number(formData.combustibleTotal) || 0)} readOnly /></div>
                        {/* Notas del Combustible Extra: solo aparecen cuando el extra es distinto de 0. */}
                        {Number(formData.combustibleExtra) !== 0 && (
                          <div className="form-group fo-x24"><label className="form-label fo-x26">Notas del Combustible Extra <span className="campo-badge">combustibleExtraNotas</span></label><input type="text" name="combustibleExtraNotas" className="form-control" placeholder="Motivo del combustible extra..." value={formData.combustibleExtraNotas || ''} onChange={handleChange} /></div>
                        )}
                      </div>
                    </div>
                  )}

                  {showExternalFleet && (
                    <div className="roelca-card">
                      <div className="roelca-card-header"><div className="roelca-card-icon"><IconTruck /></div><h3 className="roelca-card-title">Flota Externa (Proveedor)</h3></div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label className="form-label">Unidad del Proveedor <span className="campo-badge">unidadProveedor</span></label>
                          <div className="fo-x19">
                            <input type="text" className={`form-control${claseSiFalta('unidadProveedor')}`} placeholder="Buscar/escribir unidad del proveedor..." value={searchUnidadProveedor} onChange={e => { setSearchUnidadProveedor(e.target.value); setShowDropdownUnidadProveedor(true); setFormData(prev => ({ ...prev, unidadProveedor: e.target.value })); }} onFocus={() => setShowDropdownUnidadProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownUnidadProveedor(false), 200)} />
                            {showDropdownUnidadProveedor && searchUnidadProveedor && resultadosUnidadProveedor.length > 0 && (
                              <div className="fo-x12">
                                {resultadosUnidadProveedor.map((u:any) => { const txt = String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || ''); return (
                                  <div className="fo-x14" key={u.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, unidadProveedor: u.id })); setSearchUnidadProveedor(txt); setShowDropdownUnidadProveedor(false); }}>
                                    <div className="fo-x15">{txt}</div>
                                  </div>
                                ); })}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Operador del Proveedor <span className="campo-badge">operadorProveedor</span></label>
                          <div className="fo-x19">
                            <input type="text" className={`form-control${claseSiFalta('operadorProveedor')}`} placeholder="Buscar/escribir operador del proveedor..." value={searchOperadorProveedor} onChange={e => { setSearchOperadorProveedor(e.target.value); setShowDropdownOperadorProveedor(true); setFormData(prev => ({ ...prev, operadorProveedor: e.target.value })); }} onFocus={() => setShowDropdownOperadorProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownOperadorProveedor(false), 200)} />
                            {showDropdownOperadorProveedor && searchOperadorProveedor && resultadosOperadorProveedor.length > 0 && (
                              <div className="fo-x12">
                                {resultadosOperadorProveedor.map((o:any) => { const txt = String(o.nombre || o.nombres || o.nombreCompleto || ''); return (
                                  <div className="fo-x14" key={o.id} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, operadorProveedor: o.id })); setSearchOperadorProveedor(txt); setShowDropdownOperadorProveedor(false); }}>
                                    <div className="fo-x15">{txt}</div>
                                  </div>
                                ); })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!esFlotaPropiaRoelca && (
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Pago al Proveedor</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">Monto a Pagar Proveedor <span className="campo-badge">totalAPagarProv</span></label><ConSimboloMoneda><input type="number" step="0.01" name="totalAPagarProv" className={`form-control${claseSiFalta('totalAPagarProv')}`} value={formData.totalAPagarProv || 0} onChange={handleChange} style={{ color: colorMonedaProv, fontWeight: colorMonedaProv ? 600 : undefined }} /></ConSimboloMoneda>{subtotalProvFact.convertido && <small className={subtotalProvFact.sinTC ? 'fo-conv-alerta' : 'fo-conv-ok'}>{/* ✅ V00126 */}Subtotal en moneda de factura: {fmtMoney(subtotalProvFact.monto)} {nombreMoneda(formData.facturadoEnUnidad)} · {leyendaConversion(subtotalProvFact, Number(formData.totalAPagarProv || 0), monConvProvActual)}</small>}</div>
                      {/* ✅ NUEVO: moneda del monto del proveedor, visible y corregible. */}
                      <div className="form-group">
                        <label className="form-label">Moneda del Monto <span className="campo-badge">monedaConvenioProv</span></label>
                        <select
                          className="form-control"
                          value={esMonedaMXN(formData.monedaConvenioProv) ? ID_MXN : ID_USD}
                          onChange={e => setFormData(prev => ({ ...prev, monedaConvenioProv: e.target.value }))}
                          title="Moneda en la que está capturado el Monto a Pagar Proveedor. Se toma del convenio; corrígela si el convenio la trae mal."
                        >
                          <option value={ID_USD}>Dólares</option>
                          <option value={ID_MXN}>Pesos</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Cargos Adicionales (Prov) <span className="campo-badge">cargosAdicionalesProv</span></label>
                        <div className="roelca-lookup-row">
                          <ConSimboloMoneda className="fo-x27"><input type="number" step="0.01" name="cargosAdicionalesProv" className={`form-control${claseSiFalta('cargosAdicionalesProv')}`} value={formData.cargosAdicionalesProv || 0} onChange={handleChange} style={{ color: colorMonedaProv, fontWeight: colorMonedaProv ? 600 : undefined }} /></ConSimboloMoneda>
                          <BotonAgregar title="Administrar costos adicionales del PROVEEDOR de esta operación" onClick={() => { if (!initialData?.id && !(formData as any).id) { alert('Guarda la operación primero; los costos adicionales se ligan a la operación ya guardada.'); return; } setMostrarCostosAdic('proveedor'); }} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Subtotal Proveedor <span className="campo-badge">subtotalProv</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.subtotalProv || 0} readOnly style={{ opacity: 0.9, color: colorMonedaProv, fontWeight: colorMonedaProv ? 600 : undefined }} /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Dólares (Prov) <span className="campo-badge">dolaresProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x28" value={Number(formData.dolaresProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Pesos (Prov) <span className="campo-badge">pesosProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.pesosProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Conversión (MXN) <span className="campo-badge">conversionProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.conversionProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                    </div>
                  </div>
                  )}


                  {mostrarPuente && (
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Caseta / Puente</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Puente <span className="campo-badge">puenteId</span></label>
                        <select name="puenteId" className="form-control" value={formData.puenteId || ''} onChange={(e) => {
                          const id = e.target.value;
                          const row = opcionesPuente.find((g:any) => String(g.id) === id);
                          const importe = row ? (Number(row.Importe ?? row.importe ?? 0) || 0) : 0;
                          setFormData(prev => ({ ...prev, puenteId: id, puenteNombre: row ? String(row.nombre_gasto || '') : '', puenteMonto: id ? importe : 0 }));
                        }}>
                          <option value="">-- Seleccionar --</option>
                          {opcionesPuente.map((g:any) => <option key={g.id} value={g.id}>{g.nombre_gasto}</option>)}
                          {formData.puenteId && !opcionesPuente.some((g:any) => String(g.id) === String(formData.puenteId)) && (<option value={formData.puenteId}>{formData.puenteNombre || formData.puenteId}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label className="form-label">Puente Monto <span className="campo-badge">puenteMonto</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.puenteMonto || 0} readOnly={campoBloqueadoAut('puenteMonto')} onChange={e => setFormData(prev => ({ ...prev, puenteMonto: Number(e.target.value) || 0 }))} title={campoBloqueadoAut('puenteMonto') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del catálogo (Importe); puedes ajustarlo manualmente'} style={campoBloqueadoAut('puenteMonto') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} /></ConSimboloMoneda></div>
                    </div>
                  </div>
                  )}
                </>
              )}

              {pestañaActiva === 'cobrar' && pestanasVisibles.includes('cobrar') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Facturación al Cliente</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Facturado En <span className="campo-badge">facturadoEnCobrar</span></label>
                        {/* ✅ V00129: re-sincronizar con la moneda actual de la empresa */}
                        <button type="button" className="fo-btn-act-moneda" disabled={actualizandoMoneda === 'cliente'} onClick={() => actualizarMonedaDesdeEmpresa('cliente')} title="Vuelve a leer la moneda del cliente en la tabla Empresas y la aplica a este registro">{actualizandoMoneda === 'cliente' ? '⏳…' : '⟳ Actualizar moneda'}</button>
                        {/* ✅ CAMBIO: ahora EDITABLE — se precarga del cliente,
                            pero puedes corregir en qué moneda se factura. */}
                        {/* ✅ V00132: EDITABLE otra vez a petición — se precarga de la empresa (y "⟳ Actualizar moneda" la re-sincroniza), pero aquí puedes corregirla para esta operación */}
                        <select title="Se precarga de la moneda de la empresa; puedes cambiarla para esta operación" className="form-control" value={formData.facturadoEnCobrar || ''}
                          onChange={(e) => setFormData(prev => ({ ...prev, facturadoEnCobrar: e.target.value }))}
                          >
                          <option value="">— Sin definir —</option>
                          {opcionesFacturadoEn().map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label className="form-label">Subtotal <span className="campo-badge">montoConvenioCliente</span></label><ConSimboloMoneda><input type="number" step="any" className="form-control" value={subtotalClienteFact.convertido ? subtotalClienteFact.monto : (formData.montoConvenioCliente || 0)} readOnly={campoBloqueadoAut('montoConvenioCliente') || subtotalClienteFact.convertido} onChange={e => setFormData(prev => ({ ...prev, montoConvenioCliente: Number(e.target.value) || 0 }))} title={campoBloqueadoAut('montoConvenioCliente') ? 'Bloqueado por autorizaciones para tu rol' : subtotalClienteFact.convertido ? leyendaConversion(subtotalClienteFact, Number(formData.montoConvenioCliente || 0), monConvCliActual) : 'Se toma del convenio (tarifario) del cliente; puedes ajustarlo manualmente'} style={{ color: colorMonedaCliente, fontWeight: colorMonedaCliente ? 600 : undefined, ...(campoBloqueadoAut('montoConvenioCliente') ? { opacity: 0.65, cursor: 'not-allowed' } : {}) }} /></ConSimboloMoneda>{subtotalClienteFact.convertido && <small className={subtotalClienteFact.sinTC ? 'fo-conv-alerta' : 'fo-conv-ok'}>{leyendaConversion(subtotalClienteFact, Number(formData.montoConvenioCliente || 0), monConvCliActual)}</small>}</div>
                      {/* ✅ V00126: se eliminó el selector "Moneda del Monto"; la moneda del monto viene del detalle del convenio (monedaConvenioCliente se sigue guardando). */}
                      <div className="form-group">
                        <label className="form-label">Cargos Adicionales <span className="campo-badge">cargosAdicionales</span></label>
                        <div className="roelca-lookup-row">
                          <ConSimboloMoneda className="fo-x27"><input type="number" step="0.01" name="cargosAdicionales" className={`form-control${claseSiFalta('cargosAdicionales')}`} value={formData.cargosAdicionales || 0} onChange={handleChange} style={{ color: colorMonedaCliente, fontWeight: colorMonedaCliente ? 600 : undefined }} /></ConSimboloMoneda>
                          <BotonAgregar title="Administrar costos adicionales del CLIENTE de esta operación" onClick={() => { if (!initialData?.id && !(formData as any).id) { alert('Guarda la operación primero; los costos adicionales se ligan a la operación ya guardada.'); return; } setMostrarCostosAdic('cliente'); }} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Total <span className="campo-badge">subtotalCliente</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.subtotalCliente || 0} readOnly style={{ opacity: 0.9, color: colorMonedaCliente, fontWeight: colorMonedaCliente ? 600 : undefined }} /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Tipo de Cambio <span className="campo-badge">tipoCambioAprobado</span></label><ConSimboloMoneda><input type="number" className="form-control" value={formData.tipoCambioAprobado || 0} readOnly={campoBloqueadoAut('tipoCambioAprobado')} onChange={e => setFormData(prev => ({ ...prev, tipoCambioAprobado: Number(e.target.value) || 0 }))} title={campoBloqueadoAut('tipoCambioAprobado') ? 'Bloqueado por autorizaciones para tu rol' : 'Se toma del TC oficial del día; puedes ajustarlo manualmente'} style={campoBloqueadoAut('tipoCambioAprobado') ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} /></ConSimboloMoneda></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconTrendingUp /></div><h3 className="roelca-card-title">Conversión y Utilidad</h3></div>
                    <div className="form-grid">
                      
                      <div className="form-group"><label className="form-label">Dólares (Cliente) <span className="campo-badge">dolaresCliente</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x28" value={Number(formData.dolaresCliente || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Pesos (Cliente) <span className="campo-badge">pesosCliente</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.pesosCliente || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      <div className="form-group"><label className="form-label">Conversión Cliente (MXN) <span className="campo-badge">conversionCliente</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.conversionCliente || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      {!esFlotaPropiaRoelca && (
                        <div className="form-group"><label className="form-label">Conversión Proveedor (MXN) <span className="campo-badge">conversionProv</span></label><ConSimboloMoneda><input type="number" className="form-control fo-x29" value={Number(formData.conversionProv || 0).toFixed(2)} readOnly /></ConSimboloMoneda></div>
                      )}
                      <div className="form-group">
                        <label className="form-label">Utilidad Estimada (MXN) <span className="campo-badge">utilidadEstimada</span></label>
                        <ConSimboloMoneda><input type="number" className="form-control" value={Number(formData.utilidadEstimada || 0).toFixed(2)} readOnly style={{ opacity: 0.95, color: Number(formData.utilidadEstimada) >= 0 ? '#3fb950' : '#f85149', fontWeight: 700 }} /></ConSimboloMoneda>
                      </div>
                      <div className="form-group fo-x24"><label className="form-label">Observaciones Cobranza <span className="campo-badge">observacionesCobrar</span></label><textarea name="observacionesCobrar" className="form-control" rows={2} value={formData.observacionesCobrar || ''} onChange={handleChange} /></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </form>
        </div>

        <aside className="roelca-form-right">
          <div className="roelca-scroll fo-x30">
            {initialData && statusActualGuardado && (
              <div className="status-preview-card fo-x31">
                <div className="fo-x32">
                  <span className="status-badge-ok fo-x33"><IconCheck size={12} /> Status de la operación</span>
                </div>
                <div className="fo-x34">{statusActualGuardado}</div>
                {nombreSiguienteAuto && camposSiguienteStatus.length > 0 && (
                  <div className="fo-x35">
                    <div className="fo-x36">
                      Para avanzar a "{nombreSiguienteAuto}":
                    </div>
                    {camposSiguienteStatus.map((c) => (
                      <div key={c.campo} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: c.cumplido ? '#3fb950' : '#8b949e', padding: '2px 0' }}>
                        <span className="fo-x37">{c.cumplido ? <IconCheck size={12} /> : <IconArrowRight size={12} />}</span>
                        {c.etiqueta}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {statusError ? (
              (!initialData || camposSiguienteStatus.length === 0) && (
                <div className="status-error-card">
                  <div className="fo-x32">
                    <span className="status-badge-error"><IconAlert size={12} /> Estatus</span>
                  </div>
                  <div className="fo-x38">{statusError}</div>
                </div>
              )
            ) : statusPreview && !initialData ? (
              <div className="status-preview-card">
                <div className="fo-x32">
                  <span className="status-badge-ok"><IconCheck size={12} /> Estatus calculado</span>
                </div>
                <div className="fo-x34">{statusPreview}</div>
                {nombreSiguienteAuto && camposSiguienteStatus.length > 0 && (
                  <div className="fo-x39">
                    <div className="fo-x36">
                      Para avanzar a "{nombreSiguienteAuto}":
                    </div>
                    {camposSiguienteStatus.map((c) => (
                      <div key={c.campo} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: c.cumplido ? '#3fb950' : '#8b949e', padding: '2px 0' }}>
                        <span className="fo-x37">{c.cumplido ? <IconCheck size={12} /> : <IconArrowRight size={12} />}</span>
                        {c.etiqueta}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {(tarifaIdCliente || tarifaIdProveedor) && (
              <div className="roelca-sidebar-section">
                <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconReceipt size={13} /></span> Tarifa (Convenio)</div>
                <div className="roelca-money-row fo-x40">
                  <span className="lbl">Cliente</span>
                  <span className="val fo-x41">
                    {nombreTarifaCli || '—'}
                    {tarifaIdCliente && <span className="fo-x42">ID: {tarifaIdCliente}</span>}
                  </span>
                </div>
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row fo-x40">
                    <span className="lbl">Proveedor</span>
                    <span className="val fo-x41">
                      {nombreTarifaProv || '—'}
                      {tarifaIdProveedor && <span className="fo-x42">ID: {tarifaIdProveedor}</span>}
                    </span>
                  </div>
                )}
                <div className="roelca-money-row"><span className="lbl">Monto Cliente</span><span className="val">{fmtMoney(montoCliente)}{nombreMoneda(monedaClienteId) ? ` ${nombreMoneda(monedaClienteId)}` : ''}</span></div>
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row"><span className="lbl">Monto Proveedor</span><span className="val">{fmtMoney(montoProveedor)}{nombreMoneda(monedaProveedorId) ? ` ${nombreMoneda(monedaProveedorId)}` : ''}</span></div>
                )}
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row fo-x43">
                    <span className="lbl">¿Tarifas coinciden?</span>
                    <span className="val" style={{ color: tarifasCoinciden ? '#3fb950' : '#fb923c' }}>{tarifaIdCliente && tarifaIdProveedor ? (tarifasCoinciden ? '✓ Sí' : '✕ No') : '—'}</span>
                  </div>
                )}
              </div>
            )}

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconUsers size={13} /></span> Cliente y Ruta</div>
              <div className="roelca-sidebar-value">{searchClientePaga || <span className="roelca-sidebar-muted">Sin cliente</span>}</div>
              {convenioNombreResumen && <div className="roelca-sidebar-secondary">Convenio: {convenioNombreResumen}</div>}
              <div className="roelca-route-line"><IconMapPin size={13} /> {searchOrigen || '—'} <IconArrowRight size={12} /> {searchDestino || '—'}</div>
            </div>

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconBriefcase size={13} /></span> Servicio</div>
              <div className="roelca-sidebar-value">{tipoOpNombreResumen || <span className="roelca-sidebar-muted">Sin tipo de operación</span>}</div>
              <div className="fo-x44">
                {formData.trafico && formData.trafico !== 'N/A' && <span className="roelca-chip">{formData.trafico}</span>}
                {formData.carga && formData.carga !== 'N/A' && <span className="roelca-chip">{formData.carga}</span>}
                {searchProvTransporte && <span className="roelca-chip">{searchProvTransporte}</span>}
              </div>
            </div>

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconCalendar size={13} /></span> Fechas y Tipo de Cambio</div>
              <div className="roelca-money-row"><span className="lbl">Servicio</span><span className="val">{fmtFecha(formData.fechaServicio) || '—'}</span></div>
              {isFletes && <div className="roelca-money-row"><span className="lbl">Cita</span><span className="val">{formData.fechaCita ? fmtFecha(formData.fechaCita) : '—'}</span></div>}
              <div className="roelca-money-row"><span className="lbl">Tipo de Cambio</span><span className="val" style={{ color: tcResumen ? '#3fb950' : '#f85149' }}>{tcResumen ? `$${tcResumen}` : 'Sin registro'}</span></div>
            </div>

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconTrendingUp size={13} /></span> Financiero</div>
              <div className="roelca-money-row"><span className="lbl">Total</span><span className="val">{fmtMoney(formData.subtotalCliente)}</span></div>
              {!esFlotaPropiaRoelca && (
                <div className="roelca-money-row"><span className="lbl">Subtotal Proveedor</span><span className="val">{fmtMoney(formData.subtotalProv)}</span></div>
              )}
              <div className="roelca-money-row"><span className="lbl">Total Gastos</span><span className="val">{fmtMoney(formData.totalGastos)}</span></div>
              <div className={`roelca-utility-box ${Number(formData.utilidadEstimada) < 0 ? 'negative' : ''}`}>
                <div className="roelca-utility-label">Utilidad Estimada (MXN)</div>
                <div className="roelca-utility-value">{fmtMoney(formData.utilidadEstimada)}</div>
              </div>
            </div>
          </div>

          <div className="roelca-form-footer">
            <button type="button" onClick={handleSubmit} className="roelca-btn-primary" disabled={cargando}>
              <IconSave size={16} /> {cargando ? 'Guardando…' : (initialData ? 'Guardar Cambios' : 'Guardar Operación')}
            </button>
            <button type="button" onClick={handleCancelarConfirmado} className="roelca-btn-outline">
              <IconX size={15} /> Cancelar
            </button>
          </div>
        </aside>
      </div>

      {estado === 'minimizado' && (
        <div className="fo-x45" onClick={onRestore}>
          <span className="fo-x26"><IconBriefcase size={18} /></span>
          <div className="fo-x46">{initialData ? `Editar ${initialData.ref || initialData.id?.substring(0,6)}` : 'Nueva Operación'}</div>
          <span className="fo-x21"><IconArrowRight size={15} /></span>
        </div>
      )}

      {modalCatalogo && modalCatalogo.catalogo.tipo === 'empresa' && (
        <FormularioEmpresa estado="abierto" registros={empresasLocal} tipoEmpresaPreseleccionado={modalCatalogo.catalogo.tipoEmpresaPreseleccionado} onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}
      {modalCatalogo && modalCatalogo.catalogo.tipo === 'remolque' && (
        <FormularioRemolque estado="abierto" onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}
      {modalCatalogo && modalCatalogo.catalogo.tipo === 'unidad' && (
        <FormularioUnidad estado="abierto" onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}
      {modalCatalogo && modalCatalogo.catalogo.tipo === 'empleado' && (
        <EmployeeForm estado="abierto" onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
      )}

      {detalleConvenioEdit && (
        <EditorDetalleConvenioModal
          tipo={detalleConvenioEdit.tipo}
          detalleId={detalleConvenioEdit.detalleId}
          monedas={listaMonedasLocal}
          onClose={() => setDetalleConvenioEdit(null)}
          onGuardado={(det) => {
            const monId = resolverMonedaIdDeEmpresa({ moneda: det.moneda });
            if (detalleConvenioEdit.tipo === 'cliente') {
              setConvDetallesLocal(prev => prev.map((d: any) => String(d.id) === det.id ? { ...d, tarifa: det.tarifa, moneda: det.moneda } : d));
              setFormData(prev => ({ ...prev, montoConvenioCliente: det.tarifa, monedaConvenioCliente: monId || prev.monedaConvenioCliente }));
              setSearchConvenio('');
            } else {
              setConvProvDetallesLocal(prev => prev.map((d: any) => String(d.id) === det.id ? { ...d, tarifa: det.tarifa, moneda: det.moneda } : d));
              setFormData(prev => ({ ...prev, totalAPagarProv: det.tarifa, monedaConvenioProv: monId || prev.monedaConvenioProv }));
              setSearchConvenioProveedor('');
            }
            setDetalleConvenioEdit(null);
          }}
        />
      )}
      {mostrarCostosAdic && (
        <div className="modal-overlay fo-x47">
          <CostosAdicionalesDashboard
            /* ✅ V00126: abre DIRECTO en esta operación (antes mostraba la lista para elegir una) */
            operacionFija={{ id: String(initialData?.id || (formData as any).id || ''), ref: (formData as any).ref || initialData?.ref || '', clienteNombre: searchClientePaga || (formData as any).clientePagaNombre || '', proveedorUnidadNombre: searchProvTransporte || (formData as any).proveedorUnidadNombre || '', fechaServicio: formData.fechaServicio, convenio: formData.convenio, convenioProveedor: formData.convenioProveedor, tipoCambioAprobado: formData.tipoCambioAprobado, utilidadEstimada: formData.utilidadEstimada }}
            soloTipo={mostrarCostosAdic === 'cliente' || mostrarCostosAdic === 'proveedor' ? mostrarCostosAdic : undefined}
            onCerrar={() => setMostrarCostosAdic(false)}
            /* ✅ V00126: la firma correcta es un objeto { cargosAdicionales, cargosAdicionalesProv } */
            onCostosActualizados={(cambios) => { const c = Number(cambios?.cargosAdicionales); const p = Number(cambios?.cargosAdicionalesProv); setFormData(prev => ({ ...prev, ...(Number.isFinite(c) ? { cargosAdicionales: c } : {}), ...(Number.isFinite(p) ? { cargosAdicionalesProv: p } : {}) })); }}
          />
        </div>
      )}

      {mostrarSubirDoc && idOperacion && (
        <DocumentoUploadModal isOpen={true} coleccionOrigen="operaciones" registroId={idOperacion} registroNombre={referenciaOperacion} tiposDocumento={TIPOS_DOCUMENTO_OPERACION} onClose={() => setMostrarSubirDoc(false)} />
      )}

      {mostrarConveniosCliente && (
        <div className="modal-overlay fo-x47" onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarConveniosCliente(false); }}>
          <div className="form-card fo-x48">
            <div className="fo-x49">
              <div>
                <h3 className="fo-x50">Convenios del Cliente</h3>
                <p className="fo-x51">{searchClientePaga || 'Cliente'} · {listaConveniosCliente.length} convenio(s)</p>
              </div>
              <div className="fo-x7">
                <button className="fo-x52" type="button" onClick={abrirNuevoConvenioCliente}><IconPlus size={14} /> Nuevo</button>
                <button type="button" onClick={() => setMostrarConveniosCliente(false)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
              </div>
            </div>
            <div className="fo-x53">
              {listaConveniosCliente.length === 0 ? (
                <div className="fo-x54">Este cliente no tiene convenios.</div>
              ) : (
                <table className="fo-x55">
                  <thead>
                    <tr className="fo-x56">
                      <th className="fo-x57">Tarifa</th>
                      <th className="fo-x58">Monto</th>
                      <th className="fo-x58">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaConveniosCliente.map((c:any) => (
                      <tr className="fo-x59" key={c.id}>
                        <td className="fo-x60">{c.descripcion}</td>
                        <td className="fo-x61">{fmtMoney(c.tarifaMonto)}</td>
                        <td className="fo-x62">
                          <button className="fo-x63" type="button" onClick={() => abrirEditorConvenio(c)} title="Editar"><IconEdit size={13} /></button>
                          <button className="fo-x64" type="button" onClick={() => eliminarDetalleConvenio(c)} title="Eliminar"><IconX size={13} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {detalleConvEditando && (
        <div className="modal-overlay fo-x65" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetalleConvEditando(null); }}>
          <div className="form-card fo-x66">
            <div className="fo-x49">
              <h3 className="fo-x67">{detalleConvEditando.esNuevo ? 'Nuevo Convenio (Cliente)' : 'Editar Convenio (Cliente)'}</h3>
              <button type="button" onClick={() => setDetalleConvEditando(null)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
            <div className="fo-x68">
              <div className="form-group">
                <label className="form-label">Tarifa (catálogo)</label>
                <select className="form-control" value={detalleConvEditando.tipoConvenioId || ''} onChange={(e) => { const id = e.target.value; const op = opcionesTarifasRef.find((o:any) => o.id === id); setDetalleConvEditando((prev:any) => ({ ...prev, tipoConvenioId: id, tipoConvenioNombre: op?.nombre || prev.tipoConvenioNombre })); }}>
                  <option value="">-- Seleccionar tarifa --</option>
                  {opcionesTarifasRef.map((o:any) => <option key={o.id} value={o.id}>{etiquetaOpcionTarifa(o)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Nombre del convenio</label>
                <input type="text" className="form-control" value={detalleConvEditando.tipoConvenioNombre || ''} onChange={(e) => setDetalleConvEditando((prev:any) => ({ ...prev, tipoConvenioNombre: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Monto / Tarifa</label>
                <input type="number" step="0.01" className="form-control" value={detalleConvEditando.tarifa ?? ''} onChange={(e) => setDetalleConvEditando((prev:any) => ({ ...prev, tarifa: e.target.value }))} />
              </div>
            </div>
            <div className="fo-x69">
              <button type="button" onClick={() => setDetalleConvEditando(null)} className="roelca-btn-outline fo-x70">Cancelar</button>
              <button type="button" onClick={guardarDetalleConvenio} className="roelca-btn-primary fo-x71" disabled={guardandoDetalleConv}>{guardandoDetalleConv ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {mostrarConveniosProveedor && (
        <div className="modal-overlay fo-x47" onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarConveniosProveedor(false); }}>
          <div className="form-card fo-x48">
            <div className="fo-x49">
              <div>
                <h3 className="fo-x50">Convenios del Proveedor</h3>
                <p className="fo-x51">{searchProvTransporte || 'Proveedor'} · {listaConveniosProveedor.length} convenio(s)</p>
              </div>
              <div className="fo-x7">
                <button className="fo-x52" type="button" onClick={abrirNuevoConvenioProv}><IconPlus size={14} /> Nuevo</button>
                <button type="button" onClick={() => setMostrarConveniosProveedor(false)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
              </div>
            </div>
            <div className="fo-x53">
              {listaConveniosProveedor.length === 0 ? (
                <div className="fo-x54">Este proveedor no tiene convenios.</div>
              ) : (
                <table className="fo-x55">
                  <thead>
                    <tr className="fo-x56">
                      <th className="fo-x57">Tarifa</th>
                      <th className="fo-x58">Monto</th>
                      <th className="fo-x58">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaConveniosProveedor.map((c:any) => (
                      <tr className="fo-x59" key={c.id}>
                        <td className="fo-x60">{c.tipoConvenioNombre}</td>
                        <td className="fo-x61">{fmtMoney(c.tarifaMonto)}</td>
                        <td className="fo-x62">
                          <button className="fo-x63" type="button" onClick={() => abrirEditorConvenioProv(c)} title="Editar"><IconEdit size={13} /></button>
                          <button className="fo-x64" type="button" onClick={() => eliminarDetalleConvenioProv(c)} title="Eliminar"><IconX size={13} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {detalleConvProvEditando && (
        <div className="modal-overlay fo-x65" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetalleConvProvEditando(null); }}>
          <div className="form-card fo-x66">
            <div className="fo-x49">
              <h3 className="fo-x67">{detalleConvProvEditando.esNuevo ? 'Nuevo Convenio (Proveedor)' : 'Editar Convenio (Proveedor)'}</h3>
              <button type="button" onClick={() => setDetalleConvProvEditando(null)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
            <div className="fo-x68">
              <div className="form-group">
                <label className="form-label">Tarifa (catálogo)</label>
                <select className="form-control" value={detalleConvProvEditando.tipoConvenioId || ''} onChange={(e) => { const id = e.target.value; const op = opcionesTarifasRef.find((o:any) => o.id === id); setDetalleConvProvEditando((prev:any) => ({ ...prev, tipoConvenioId: id, tipoConvenioNombre: op?.nombre || prev.tipoConvenioNombre })); }}>
                  <option value="">-- Seleccionar tarifa --</option>
                  {opcionesTarifasRef.map((o:any) => <option key={o.id} value={o.id}>{etiquetaOpcionTarifa(o)}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Nombre del convenio</label>
                <input type="text" className="form-control" value={detalleConvProvEditando.tipoConvenioNombre || ''} onChange={(e) => setDetalleConvProvEditando((prev:any) => ({ ...prev, tipoConvenioNombre: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Monto / Tarifa</label>
                <input type="number" step="0.01" className="form-control" value={detalleConvProvEditando.tarifa ?? ''} onChange={(e) => setDetalleConvProvEditando((prev:any) => ({ ...prev, tarifa: e.target.value }))} />
              </div>
            </div>
            <div className="fo-x69">
              <button type="button" onClick={() => setDetalleConvProvEditando(null)} className="roelca-btn-outline fo-x70">Cancelar</button>
              <button type="button" onClick={guardarDetalleConvenioProv} className="roelca-btn-primary fo-x71" disabled={guardandoDetalleConvProv}>{guardandoDetalleConvProv ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
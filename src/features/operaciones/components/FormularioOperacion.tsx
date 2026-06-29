import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { doc, getDoc, updateDoc, collection, getDocs, setDoc, deleteDoc, addDoc } from 'firebase/firestore';
import { db, storage, auth } from '../../../config/firebase';
import { guardarOperacionSegura } from '../services/operacionesService';
import { calcularStatusDinamico } from '../config/statusRules';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';

import { FormularioEmpresa } from '../../empresas/components/FormularioEmpresa';
import { FormularioRemolque } from '../../remolques/components/FormularioRemolque';
import { FormularioUnidad } from '../../unidades/components/FormularioUnidad';
import { EmployeeForm } from '../../empleados/components/EmployeeForm';
import { CostosAdicionalesDashboard } from '../../costosAdicionales/CostosAdicionalesDashboard';

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
  refCliente: 'general', origen: 'general', destino: 'general', observacionesEjecutivo: 'general',

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
const COSTO_MANIFIESTO_DEFAULT = 8.52;

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

// ✅ NUEVO: normaliza una clave (Servicio/Tráfico/Carga) para comparar de forma
//   TOLERANTE: sin acentos, sin distinguir mayúsculas y con espacios colapsados.
//   Así "Logística"=="Logistica" y "Movimiento LDO"=="Movimiento ldo".
const normClave = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// ✅ NUEVO: normaliza CUALQUIER formato de fecha a "YYYY-MM-DD" para que el
//   <input type="date"> la muestre. Los registros viejos/migrados pueden guardar
//   la fecha como Timestamp de Firestore, ISO con hora, "DD/MM/YYYY", etc. y por
//   eso al editar el campo de fecha aparecía vacío. Devuelve '' si no se puede.
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


const IconBriefcase     = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
const IconFileText      = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const IconTruck         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
const IconClipboard     = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>;
const IconDollar        = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
const IconUsers         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconMapPin        = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconCalendar      = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconPackage       = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
const IconReceipt       = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M4 2h16v20l-3-2-2 2-3-2-3 2-2-2-3 2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>;
const IconTrendingUp    = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
const IconRoute         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>;
const IconEdit          = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IconSave          = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
const IconX             = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconMinimize      = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="5" y1="19" x2="19" y2="19"/></svg>;
const IconAlert         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IconCheck         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>;
const IconArrowRight    = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;
const IconPlus          = (p: { size?: number }) => <svg width={p.size || 16} height={p.size || 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;

const tipoTarifarioCache = new Map<string, any>();
const traficoCache = new Map<string, string>();

const BotonAgregar = ({ onClick, title }: { onClick: () => void; title: string }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    style={{
      flexShrink: 0,
      width: '38px',
      height: '38px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(251, 146, 60, 0.10)',
      border: '1px solid rgba(251, 146, 60, 0.35)',
      borderRadius: '8px',
      color: '#fb923c',
      cursor: 'pointer',
      transition: 'all 0.15s ease',
    }}
    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.20)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.10)'; }}
  >
    <IconPlus size={17} />
  </button>
);

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

  const onDrop = (e: React.DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setArrastrando(false);
    const archivos = e.dataTransfer?.files;
    if (archivos && archivos.length > 0) {
      onChange({ target: { files: archivos } } as unknown as React.ChangeEvent<HTMLInputElement>);
    }
  };

  const quitarArchivo = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
      <label
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (!arrastrando) setArrastrando(true); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setArrastrando(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setArrastrando(false); }}
        onDrop={onDrop}
        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', transition: 'all 0.15s ease', backgroundColor: fondo, border: borde }}
      >
        <span style={{ flexShrink: 0, width: '26px', height: '26px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', backgroundColor: cargado ? '#238636' : '#21262d', color: cargado ? '#fff' : '#8b949e' }}>
          {cargado ? <IconCheck size={15} /> : <IconPlus size={15} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, fontSize: '0.85rem', fontWeight: cargado ? 600 : 400, color: arrastrando ? '#fb923c' : (cargado ? '#3fb950' : '#8b949e'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {arrastrando ? 'Suelta el archivo aquí…' : (cargado ? `✓ ${file!.name}` : 'Haz clic o arrastra un archivo aquí')}
        </span>
        {cargado && !arrastrando && (
          <button
            type="button"
            title="Quitar archivo"
            onClick={quitarArchivo}
            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '4px 10px', fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', color: '#f85149', backgroundColor: 'rgba(248,81,73,0.08)', border: '1px solid rgba(248,81,73,0.35)', borderRadius: '6px', cursor: 'pointer' }}
          >
            <IconX size={12} /> Quitar
          </button>
        )}
        <input type="file" accept={accept} onChange={onChange} style={{ display: 'none' }} />
      </label>
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
  const [mostrarCostosAdic, setMostrarCostosAdic] = useState(false);
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);

  // ✅ NUEVO: ver / editar los convenios (tarifas) del cliente desde la operación.
  const [mostrarConveniosCliente, setMostrarConveniosCliente] = useState(false);
  const [detalleConvEditando, setDetalleConvEditando] = useState<any | null>(null);
  const [guardandoDetalleConv, setGuardandoDetalleConv] = useState(false);

  // ✅ NUEVO: ver / editar los convenios (tarifas) del proveedor desde la operación.
  const [mostrarConveniosProveedor, setMostrarConveniosProveedor] = useState(false);
  const [detalleConvProvEditando, setDetalleConvProvEditando] = useState<any | null>(null);
  const [guardandoDetalleConvProv, setGuardandoDetalleConvProv] = useState(false);

  const [puedeEditarRef, setPuedeEditarRef] = useState(false);
  const [referencia, setReferencia] = useState('');

  const [statusPreview, setStatusPreview] = useState<string>('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const [camposSiguienteStatus, setCamposSiguienteStatus] = useState<{ campo: string; etiqueta: string; cumplido: boolean }[]>([]);
  const [nombreSiguienteAuto, setNombreSiguienteAuto] = useState<string>('');

  const [pestanasVisiblesConfig, setPestanasVisiblesConfig] = useState<TabType[] | null>(null);
  const [camposObligatoriosConfig, setCamposObligatoriosConfig] = useState<string[] | null>(null);

  // ✅ NUEVO: índice de los flujos YA guardados (id real del documento + sus
  //   claves Servicio/Tráfico/Carga). Sirve para resolver el flujo de forma
  //   tolerante a mayúsculas/acentos en lugar de depender de un ID exacto.
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
    ];
    (async () => {await Promise.all(fuentes.map(async ({ alias, coleccion, setter }) => {
        try {
          const snap = await getDocs(collection(db, coleccion));
          const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          if (!activo) return;
          setter(docs);
          try { localStorage.setItem(`cat_v1__${alias}`, JSON.stringify({ data: docs, ts: Date.now() })); } catch { /* noop */ }
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

  const listaEmpleadosLocal: any[] = empleados;
  const listaUniProvLocal: any[] = unidadesProveedor;
  const listaOpeProvLocal: any[] = proveedoresUnidad;
  const listaMonedasLocal: any[] = catalogoMoneda;

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
    fechaServicio: new Date().toISOString().split('T')[0],
    fechaCita: '',
    clientePaga: '', convenio: '', convenioNombre: '', numeroRemolque: '', refCliente: '',
    origen: '', destino: '', observacionesEjecutivo: '',
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
    unidadProveedor: '', operadorProveedor: '', observacionesUnidad: '', observacionesCobrar: '',
    totalGastos: 0,
    facturadoEnCobrar: '', monedaConvenioCliente: '', montoConvenioCliente: 0,
    cargosAdicionales: 0, subtotalCliente: 0,
    dolaresCliente: 0, pesosCliente: 0, conversionCliente: 0,
    utilidadEstimada: 0, tipoCambioAprobado: 0
  });

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
      const cacheStr = sessionStorage.getItem('roelca_catalogos_v2');
      if (cacheStr) {
        const cache = JSON.parse(cacheStr);
        if (coleccion === 'empresas') cache.empresas = docs;
        else if (coleccion === 'remolques') cache.remolques = docs;
        else if (coleccion === 'unidades') cache.unidades = docs;
        else if (coleccion === 'empleados') cache.empleados = docs;
        sessionStorage.setItem('roelca_catalogos_v2', JSON.stringify(cache));
      }
    } catch { /* noop */ }

    try {
      localStorage.setItem(`cat_v1__${coleccion}`, JSON.stringify({ data: docs, ts: Date.now() }));
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

  const labelEmpresa = (e: any) => e?.nombre || e?.empresa || e?.razonSocial || '';
  const labelRemolque = (r: any) => `${r?.nombre || ''} ${r?.placas || r?.placa || ''}`.trim();
  const labelUnidad = (u: any) => u?.unidad || u?.nombre || '';
  const labelEmpleado = (o: any) => `${o?.firstName || ''} ${o?.lastNamePaternal || ''}`.trim();

  // ✅ NUEVO: carga (una vez) la lista de flujos guardados para poder resolver
  //   el flujo correcto aunque el texto difiera en mayúsculas/acentos.
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
    // Valores CRUDOS, exactamente como los guarda el Editor de Flujos
    //   (Servicio = tipo_operacion tal cual; Tráfico = nombre de catalogo_trafico;
    //   Carga = "Cargada"/"Vacía"/"N/A"). NO se fuerza acento ni se cambia el
    //   case, porque eso era justo lo que rompía la coincidencia del ID.
    const tipoOpText = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || 'N/A';
    const traficoTxt = formData.trafico || 'N/A';
    const cargaTxt = formData.carga || 'N/A';

    const idCrudo = `${tipoOpText}_${traficoTxt}_${cargaTxt}`;

    // ✅ Resolución TOLERANTE: si ya existe un flujo guardado cuya combinación
    //   coincide ignorando mayúsculas/acentos/espacios, se usa su ID REAL de
    //   documento. Así "Logística/Movimiento ldo" encuentra el guardado como
    //   "Logistica/Movimiento LDO". Si no hay match, se usa el id crudo.
    const match = flujosIndex.find(f =>
      normClave(f.tipoServicio) === normClave(tipoOpText) &&
      normClave(f.trafico) === normClave(traficoTxt) &&
      normClave(f.carga) === normClave(cargaTxt)
    );

    const idGenerado = match ? match.id : idCrudo;
    console.log('🔑 configId generado:', idGenerado, match ? '(resuelto por índice)' : '(crudo)');
    return idGenerado;
  };

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
        const statusCalculado = await calcularStatusDinamico(configId, formData, initialData?.status);
        const statusObj = statusServicio?.find((s:any) => s.id === statusCalculado);
        setStatusPreview(statusObj?.descripcion || statusObj?.nombre || statusCalculado);
        setStatusError(null);

        await calcularCamposSiguienteAuto(configId, statusCalculado);
      } catch (error: any) {
        setStatusPreview('');
        setCamposSiguienteStatus([]);
        setNombreSiguienteAuto('');
        const msjLimpio = error.message.replace('⛔ BLOQUEO: ', '').replace('⛔ ', '');
        setStatusError(msjLimpio);
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
    const cBase = Number(formData.combustible) || 0;
    const cExt = Number(formData.combustibleExtra) || 0;
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
        combustible: Number(initialData.combustible) || 0,        
        combustibleExtra: Number(initialData.combustibleExtra) || 0,  
        unidadProveedor: initialData.unidadProveedor || '',
        operadorProveedor: initialData.operadorProveedor || '',
        observacionesUnidad: initialData.observacionesUnidad || '',
        observacionesCobrar: initialData.observacionesCobrar || '',     
        totalGastos: Number(initialData.totalGastos) || 0,
      };

      setFormData(prev => ({ ...prev, ...safeInitialData }));

      const getNombreEmpresa = (id: string) => {
        if (!id) return '';
        const item = empresas.find((e: any) => e.id === id);
        return item ? item.nombre : id;
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

  useEffect(() => {
    if (!formData.fechaServicio || !catalogoTC || catalogoTC.length === 0) return;
    setBuscandoTC(true);
    const [y, m, d] = formData.fechaServicio.split('-');
    const fechaLatina = `${d}/${m}/${y}`; 
    const fechaUS = `${m}/${d}/${y}`; 
    const fechaISO = `${y}-${m}-${d}`; 
    let tcEncontrado = null;
    for (const tc of catalogoTC) {
      const valoresFila = Object.values(tc).map((v: any) => String(v).trim());
      if (valoresFila.includes(fechaLatina) || valoresFila.includes(fechaUS) || valoresFila.includes(fechaISO)) {
        const keys = Object.keys(tc);
        const valKey = keys.find((k: any) => String(k).toLowerCase().includes('dof') || String(k).toLowerCase().includes('valor') || String(k).toLowerCase() === 'tc' || String(k).toLowerCase().includes('cambio'));
        if (valKey) tcEncontrado = Number(String(tc[valKey]).replace(/[^0-9.-]+/g, ""));
        else {
          const posiblesRates = valoresFila.map((v: any) => parseFloat(v.replace(/[^0-9.-]+/g, ""))).filter((n: any) => !isNaN(n) && n > 15 && n < 25);
          if (posiblesRates.length > 0) tcEncontrado = posiblesRates[0];
        }
        break;
      }
    }
    setTipoCambioDia(tcEncontrado);
    const fechaInicialISO = normalizarFechaISO(initialData?.fechaServicio);
    if(tcEncontrado && (!initialData || formData.fechaServicio !== fechaInicialISO)) {
       setFormData(prev => ({...prev, tipoCambioAprobado: tcEncontrado}));
    }
    setBuscandoTC(false);
  }, [formData.fechaServicio, catalogoTC, initialData]);

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
        monedaMaestro: d.moneda || maestroAsociado?.monedaId || maestroAsociado?.moneda || ID_USD,
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
        monedaMaestro: initialData.monedaConvenioCliente || (detReal as any)?.moneda || ID_USD,
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
        monedaBase: maestroParent?.monedaId || maestroParent?.moneda || d.moneda || ID_USD,
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
        monedaBase: initialData.monedaConvenioProv || (detReal as any)?.moneda || ID_USD,
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
    const nombre = conv?.descripcion || initialData.convenioNombre || '';
    if (nombre) setSearchConvenio(nombre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, formData.convenio, searchConvenio, listaConveniosCliente]);

  useEffect(() => {
    if (!initialData) return;
    if (!formData.convenioProveedor) return;
    if (searchConvenioProveedor && searchConvenioProveedor.trim()) return;
    const conv = listaConveniosProveedor.find((c: any) => String(c.id) === String(formData.convenioProveedor));
    const nombre = conv?.tipoConvenioNombre || initialData.convenioProveedorNombre || '';
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

    // ✅ NUEVO: si es FLOTA PROPIA de Roelca (Transfer, o Logística/Fletes con
    //   proveedor Roelca) NO se autosugiere convenio ni monto a pagar al
    //   proveedor, para que no aparezca un costo de proveedor inexistente.
    const _tipoTxt = (tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '').toLowerCase();
    const _isTransfer = _tipoTxt.includes('transfer');
    const _isLog = _tipoTxt.includes('logistica') || _tipoTxt.includes('logística');
    const _isFle = _tipoTxt.includes('fletes') || _tipoTxt.includes('flete');
    const _isRoelcaProv = searchProvTransporte.toLowerCase().includes('roelca');
    if (_isTransfer || ((_isLog || _isFle) && _isRoelcaProv)) return;

    // Si el proveedor YA tiene un convenio elegido, no tocar nada (pueden diferir).
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

    const traficoOk = formData.trafico && formData.trafico !== 'N/A';
    const cargaOk = formData.carga && formData.carga !== 'N/A';
    if (traficoOk && cargaOk) return;

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

      setFormData(prev => ({
        ...prev,
        tipoServicio: prev.tipoServicio || tipoData.descripcion || 'N/A',
        trafico: (prev.trafico && prev.trafico !== 'N/A') ? prev.trafico : nombreTrafico,
        carga: (prev.carga && prev.carga !== 'N/A') ? prev.carga : (tarifaObj.estado_carga || 'N/A'),
      }));
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
      ...(combustible !== null && !isNaN(combustible) ? { combustible } : {}),
    }));
  }, [formData.convenio, listaConveniosCliente, gastosIncluidosLocal, rendimientoLocal, initialData]);

  useEffect(() => {
    const fact = formData.facturadoEnUnidad; 
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.totalAPagarProv || 0) + Number(formData.cargosAdicionalesProv || 0);
    let dol = 0; let pes = 0; let conv = 0;
    const esDolar = fact === ID_USD || (listaMonedasLocal.find((m: any) => m.id === fact)?.moneda || '').toUpperCase().includes('USD');
    const esPeso = fact === ID_MXN || (listaMonedasLocal.find((m: any) => m.id === fact)?.moneda || '').toUpperCase().includes('MXN');
    if (esDolar) { dol = subtotal; pes = 0; conv = subtotal * tc; } 
    else if (esPeso) { dol = 0; pes = subtotal; conv = subtotal; }
    setFormData(prev => ({ ...prev, subtotalProv: subtotal, dolaresProv: dol, pesosProv: pes, conversionProv: conv }));
  }, [formData.facturadoEnUnidad, formData.totalAPagarProv, formData.cargosAdicionalesProv, tipoCambioDia, formData.tipoCambioAprobado, listaMonedasLocal]);

  useEffect(() => {
    const fact = formData.facturadoEnCobrar; 
    const tc = Number(formData.tipoCambioAprobado || tipoCambioDia) || 0; 
    const subtotal = Number(formData.montoConvenioCliente || 0) + Number(formData.cargosAdicionales || 0);
    let dol = 0; let pes = 0; let conv = 0;
    const esDolar = fact === ID_USD || (listaMonedasLocal.find((m: any) => m.id === fact)?.moneda || '').toUpperCase().includes('USD');
    const esPeso = fact === ID_MXN || (listaMonedasLocal.find((m: any) => m.id === fact)?.moneda || '').toUpperCase().includes('MXN');
    if (esDolar) { dol = subtotal; pes = 0; conv = subtotal * tc; } 
    else if (esPeso) { dol = 0; pes = subtotal; conv = subtotal; }
    const utilidad = conv - Number(formData.conversionProv || 0); 
    setFormData(prev => ({ ...prev, subtotalCliente: subtotal, dolaresCliente: dol, pesosCliente: pes, conversionCliente: conv, utilidadEstimada: utilidad }));
  }, [formData.facturadoEnCobrar, formData.montoConvenioCliente, formData.cargosAdicionales, tipoCambioDia, formData.conversionProv, formData.tipoCambioAprobado, listaMonedasLocal]);

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

  const filClientesPaga = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('7eec9cbb')) || [], [empresas]);
  const filClientesMercancia = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('51246232') && e.status === 'Activa') || [], [empresas]);
  const filProveedoresServicios = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('11894dfd')) || [], [empresas]);
  const filOrigenesDestinos = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('6e7af5ab') && e.status === 'Activa') || [], [empresas]);
  const filProveedoresTransporte = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('ca21ab07') && e.status === 'Activa') || [], [empresas]);

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

  const resultadosOrigen = filOrigenesDestinos.filter((e:any) => (e.nombre || '').toLowerCase().includes(sOrigen) || (e.direccion || '').toLowerCase().includes(sOrigen));
  const resultadosDestino = filOrigenesDestinos.filter((e:any) => (e.nombre || '').toLowerCase().includes(sDestino) || (e.direccion || '').toLowerCase().includes(sDestino));
  const resultadosClientePaga = filClientesPaga.filter((e:any) => (e.nombre || '').toLowerCase().includes(sClientePaga));
  const resultadosRemolque = remolques?.filter((e:any) => `${e.nombre || ''} ${e.placas || e.placa || ''}`.toLowerCase().trim().includes(sRemolque)) || [];
  const resultadosClienteMercancia = filClientesMercancia.filter((e:any) => (e.nombre || '').toLowerCase().includes(sClienteMerc));
  const resultadosProvServicios = filProveedoresServicios.filter((e:any) => (e.nombre || '').toLowerCase().includes(sProvServicios));
  const resultadosProvTransporte = filProveedoresTransporte.filter((e:any) => (e.nombre || '').toLowerCase().includes(sProvTransp));
  const resultadosUnidad = unidades?.filter((u:any) => (u.unidad || '').toLowerCase().includes(sUnidad)) || [];
  const resultadosOperador = listaEmpleadosLocal.filter((o:any) => `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim().toLowerCase().includes(sOperador));
  const resultadosUnidadProveedor = listaUniProvLocal.filter((u:any) => String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || '').toLowerCase().includes(sUnidadProv));
  const resultadosOperadorProveedor = listaOpeProvLocal.filter((o:any) => String(o.nombre || o.nombres || o.nombreCompleto || '').toLowerCase().includes(sOperadorProv));
  const resultadosConvenio = listaConveniosCliente.filter((c:any) =>
    (c.descripcion || '').toLowerCase().includes(sConvenio) ||
    String(c.tarifaBaseId || '').toLowerCase().includes(sConvenio)
  );
  const resultadosConvenioProveedor = listaConveniosProveedor.filter((c:any) =>
    (c.tipoConvenioNombre || '').toLowerCase().includes(sConvenioProveedor) ||
    String(c.tarifaBaseId || '').toLowerCase().includes(sConvenioProveedor)
  );

  const convClienteSel = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
  const convProvSelObj = listaConveniosProveedor.find((c:any) => c.id === formData.convenioProveedor);
  const tarifaIdCliente = String(convClienteSel?.tarifaBaseId || '').trim();
  const tarifaIdProveedor = String(convProvSelObj?.tarifaBaseId || '').trim();
  const montoCliente = Number(convClienteSel?.tarifaMonto || 0);
  const montoProveedor = Number(convProvSelObj?.tarifaMonto || 0);
  const monedaClienteId = convClienteSel?.monedaMaestro;
  const monedaProveedorId = convProvSelObj?.monedaBase;
  const tarifasCoinciden = !!tarifaIdCliente && tarifaIdCliente === tarifaIdProveedor;
  const nombreMoneda = (monedaId: any) =>
    listaMonedasLocal.find((m:any) => String(m.id) === String(monedaId))?.moneda || '';

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
  // ✅ NUEVO: cuando es flota PROPIA de Roelca (Transfer, o Logística/Fletes con
  //   proveedor Roelca) NO se le paga a un proveedor externo. Se ocultan el
  //   "Convenio Proveedor" y la sección "Pago al Proveedor" (no se pide tarifa
  //   ni se muestra lo que habría que pagarle).
  const esFlotaPropiaRoelca = showInternalFleet;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      const configId = buildConfigId();
      const statusCalculado = await calcularStatusDinamico(configId, formData, initialData?.status);
      const detalleDoc = listaConveniosCliente.find((c:any) => c.id === formData.convenio);
      const { pdfCartaPorte, pdfDoda, pdfManifiesto, pdfsEntrys, ...datosLimpios } = formData;
      const tipoOpObj = tiposOperacion.find((t:any) => t.id === formData.tipoOperacionId);
      const statusObj = statusServicio?.find((s:any) => s.id === statusCalculado);
      const monedaCobroObj = listaMonedasLocal.find((m:any) => m.id === formData.facturadoEnCobrar);
      const monedaUnidadObj = listaMonedasLocal.find((m:any) => m.id === formData.facturadoEnUnidad);
      const convProvObj = listaConveniosProveedor.find((c:any) => c.id === formData.convenioProveedor);

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
        statusNombre: statusObj?.descripcion || statusObj?.nombre || statusCalculado || 'Pendiente',
        tienePdfDoda: !!pdfDoda, cantPdfsEntrys: (pdfsEntrys || []).filter(Boolean).length,
        clienteNombre: searchClientePaga || '', origenNombre: searchOrigen || '',
        destinoNombre: searchDestino || '', remolqueNombre: searchRemolque || '',clienteMercanciaNombre: searchClienteMercancia || '', provServiciosNombre: searchProvServicios || '',
        proveedorUnidadNombre: searchProvTransporte || '', unidadNombre: searchUnidad || '',
        operadorNombre: searchOperador || '', tipoOperacionNombre: tipoOpObj?.tipo_operacion || '',
        monedaCobroNombre: monedaCobroObj?.moneda || '', monedaUnidadNombre: monedaUnidadObj?.moneda || '',
        convenioProveedorNombre: convProvObj?.tipoConvenioNombre || ''
      };

      // ✅ NUEVO: en flota PROPIA de Roelca no hay pago a proveedor externo.
      //   Se limpian los campos del proveedor para que NO se guarde un costo
      //   inexistente (que afectaría la utilidad). El gasto real de la flota
      //   propia se calcula con sueldo + combustible + manifiesto.
      if (esFlotaPropiaRoelca) {
        operacionData.convenioProveedor = '';
        operacionData.convenioProveedorNombre = '';
        operacionData.monedaConvenioProv = '';
        operacionData.totalAPagarProv = 0;
        operacionData.cargosAdicionalesProv = 0;
        operacionData.subtotalProv = 0;
        operacionData.dolaresProv = 0;
        operacionData.pesosProv = 0;
        operacionData.conversionProv = 0;
      }

      Object.keys(operacionData).forEach(key => { if (operacionData[key] === undefined) delete operacionData[key]; });

      if (initialData && puedeEditarRef && referencia.trim() && referencia.trim() !== String((initialData as any).ref || '')) {
        operacionData.ref = referencia.trim();
      }

      let idGuardado = '';
      let refGuardado = '';
      if (initialData) {
        await updateDoc(doc(db, 'operaciones', String(initialData.id)), operacionData);
        idGuardado = String(initialData.id);
        refGuardado = referenciaDeOperacion(idGuardado, operacionData.ref || (initialData as any).ref);
        if (onSave) onSave({ id: initialData.id, ...operacionData });
      } else {
        const resultado = await guardarOperacionSegura(operacionData);
        const nuevoId = (typeof resultado === 'object' && resultado?.id) ? resultado.id : Date.now().toString();
        idGuardado = String(nuevoId);
        refGuardado = referenciaDeOperacion(idGuardado, (resultado as any)?.ref || operacionData.ref);
        if (onSave) onSave({ id: nuevoId, ...operacionData });
      }

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
  const fmtMoney = (n: number) => `$${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      try { localStorage.setItem('cat_v1__catalogoConvDetalles', JSON.stringify({ data: docs, ts: Date.now() })); } catch { /* noop */ }
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
      try { localStorage.setItem('cat_v1__catalogoConvProvDetalles', JSON.stringify({ data: docs, ts: Date.now() })); } catch { /* noop */ }
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

  if (!catalogosCacheados || !catalogosCacheados.empresas) return <div className={`modal-overlay`}><div className="form-card" style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando catálogos de Roelca...</div></div>;

  return (
    <div
      className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}
      style={
        estado === 'minimizado'
          ? { padding: 0, background: 'transparent', pointerEvents: 'none' }
          : { padding: 0 }
      }
    >
      <style>{`
        .roelca-form-shell {
          width: 100vw;
          height: 100vh;
          max-width: 100vw;
          background-color: #0a0d14;
          border-radius: 0;
          display: flex;
          overflow: hidden;
          box-shadow: none;
          border: none;
        }
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
        .campo-obligatorio-faltante,
        .campo-obligatorio-faltante:focus {
          border-color: #f85149 !important;
          background-color: rgba(248, 81, 73, 0.06) !important;
          box-shadow: 0 0 0 1px rgba(248, 81, 73, 0.35) !important;
        }
        @media (max-width: 1024px) {
          .roelca-form-shell { flex-direction: column; }
          .roelca-form-right { width: 100%; border-left: none; border-top: 1px solid #1f2733; max-height: 40vh; }
        }
      `}</style>

      <div className="roelca-form-shell" style={{ display: estado === 'minimizado' ? 'none' : 'flex' }}>
        <div className="roelca-form-left">
          <div className="roelca-form-header">
            <div>
              <h2>{initialData ? `Editar Operación ${initialData.ref || initialData.id?.substring(0,6)}` : 'Nueva Operación'}</h2>
              <p>{initialData ? 'Modifica los datos y guarda los cambios' : 'Completa el formulario para registrar una nueva operación'}</p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => { if (!idOperacion) { alert('Guarda la operación primero para poder adjuntarle documentos.'); return; } setMostrarSubirDoc(true); }}
                className="roelca-window-btn"
                title={idOperacion ? 'Subir documentos de la operación' : 'Guarda la operación primero'}
                style={{ width: 'auto', padding: '0 12px', gap: '6px', color: idOperacion ? '#fb923c' : '#6e7681', borderColor: idOperacion ? 'rgba(251,146,60,0.4)' : '#2d333b' }}
              >
                <IconFileText size={15} /> <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Documentos</span>
              </button>
              <button type="button" onClick={onMinimize} className="roelca-window-btn" title="Minimizar"><IconMinimize size={16} /></button>
              <button type="button" onClick={handleCancelarConfirmado} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
          </div>

          <div className="roelca-tabs">
            {pestanasVisibles.includes('general') && (
              <button type="button" className={`roelca-tab ${pestañaActiva === 'general' ? 'active' : ''}`} onClick={() => setPestañaActiva('general')}><IconBriefcase size={15} /> Información General</button>
            )}
            {pestanasVisibles.includes('pedimento') && (
              <button type="button" className={`roelca-tab ${pestañaActiva === 'pedimento' ? 'active' : ''}`} onClick={() => setPestañaActiva('pedimento')}><IconFileText size={15} /> Pedimento y CT</button>
            )}
            {pestanasVisibles.includes('manifiesto') && (
              <button type="button" className={`roelca-tab ${pestañaActiva === 'manifiesto' ? 'active' : ''}`} onClick={() => setPestañaActiva('manifiesto')}><IconClipboard size={15} /> Entry's y Manifiestos</button>
            )}
            {pestanasVisibles.includes('unidad') && (
              <button type="button" className={`roelca-tab ${pestañaActiva === 'unidad' ? 'active' : ''}`} onClick={() => setPestañaActiva('unidad')}><IconTruck size={15} /> Unidad y Operador</button>
            )}
            {pestanasVisibles.includes('cobrar') && (
              <button type="button" className={`roelca-tab ${pestañaActiva === 'cobrar' ? 'active' : ''}`} onClick={() => setPestañaActiva('cobrar')}><IconDollar size={15} /> Por Cobrar</button>
            )}
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="roelca-scroll">
              {pestañaActiva === 'general' && pestanasVisibles.includes('general') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconBriefcase /></div><h3 className="roelca-card-title">Tipo de Servicio y Fechas</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label orange">Referencia</label>
                        {initialData ? (
                          <input type="text" name="referencia" className="form-control" value={referencia}
                            onChange={(e) => setReferencia(e.target.value)} readOnly={!puedeEditarRef}
                            title={puedeEditarRef ? 'Tienes permiso para corregir la referencia' : 'No tienes permiso para editar la referencia'}
                            style={puedeEditarRef ? { borderColor: '#fb923c' } : { opacity: 0.65, cursor: 'not-allowed' }} />
                        ) : (
                          <input type="text" className="form-control" value="Se generará al guardar" readOnly style={{ opacity: 0.6, cursor: 'not-allowed' }} />
                        )}
                        <small style={{ color: initialData ? (puedeEditarRef ? '#fb923c' : '#8b949e') : '#8b949e' }}>
                          {initialData ? (puedeEditarRef ? 'Editable (Admin o permiso "Editar Referencia").' : 'No tienes permiso para editarla.') : 'Formato: TR/LO/FL-DDMMYY-### (consecutivo único del día).'}
                        </small>
                      </div>
                      <div className="form-group"><label className="form-label orange">Tipo de Operación</label><select name="tipoOperacionId" className={`form-control${claseSiFalta('tipoOperacionId')}`} value={formData.tipoOperacionId || ''} onChange={handleChange} required><option value="">-- Seleccionar --</option>{tiposOperacion?.map((op:any) => <option key={op.id} value={op.id}>{op.tipo_operacion}</option>)}</select></div>
                      <div className="form-group"><label className="form-label orange">Fecha de Servicio</label><input type="date" name="fechaServicio" className={`form-control${claseSiFalta('fechaServicio')}`} value={formData.fechaServicio || ''} onChange={handleChange} required />{buscandoTC ? <small style={{ color: '#58a6ff' }}>Buscando TC...</small> : <small style={{ color: (formData.tipoCambioAprobado || tipoCambioDia) ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>TC Oficial: {(formData.tipoCambioAprobado || tipoCambioDia) ? `$${(formData.tipoCambioAprobado || tipoCambioDia)}` : 'Sin Registro'}</small>}</div>
                      {isFletes && (<div className="form-group"><label className="form-label orange">Fecha de Cita</label><input type="datetime-local" name="fechaCita" className={`form-control${claseSiFalta('fechaCita')}`} value={formData.fechaCita || ''} onChange={handleChange} /></div>)}
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconUsers /></div><h3 className="roelca-card-title">Cliente y Convenio</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Cliente (Paga)</label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('clientePaga')}`} placeholder="Escriba para buscar cliente..." required={!formData.clientePaga && !searchClientePaga} value={searchClientePaga}
                              onChange={e => { setSearchClientePaga(e.target.value); setShowDropdownClientePaga(true); if (formData.clientePaga) setFormData(prev => ({ ...prev, clientePaga: '', convenio: '' })); }}
                              onFocus={() => setShowDropdownClientePaga(true)} onBlur={() => setTimeout(() => setShowDropdownClientePaga(false), 200)} />
                            {showDropdownClientePaga && searchClientePaga && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                {resultadosClientePaga.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosClientePaga.map((c:any) => (
                                  <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); const monedaDefault = resolverMonedaIdDeEmpresa(c); setFormData(prev => ({ ...prev, clientePaga: c.id, convenio: '', facturadoEnCobrar: monedaDefault })); setSearchClientePaga(c.nombre); setSearchConvenio(''); setShowDropdownClientePaga(false); }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <BotonAgregar title="Agregar nuevo Cliente (Paga)" onClick={() => abrirCreacion(
                            { tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_CLIENTE_PAGA },
                            (id, reg) => { setFormData(prev => ({ ...prev, clientePaga: id, convenio: '', facturadoEnCobrar: resolverMonedaIdDeEmpresa(reg) })); setSearchClientePaga(labelEmpresa(reg)); setSearchConvenio(''); }
                          )} />
                        </div>
                      </div>
                      <div className="form-group">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <label className="form-label" style={{ margin: 0 }}>Convenio (Tarifa)</label>
                          {(formData.clientePaga || searchClientePaga) && (
                            <button
                              type="button"
                              onClick={() => setMostrarConveniosCliente(true)}
                              title="Ver y editar los convenios (tarifas) de este cliente"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 9px', fontSize: '0.7rem', fontWeight: 600, color: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.10)', border: '1px solid rgba(88,166,255,0.35)', borderRadius: '6px', cursor: 'pointer' }}
                            >
                              <IconReceipt size={12} /> Ver / editar ({listaConveniosCliente.length})
                            </button>
                          )}
                        </div>
                        <div style={{ position: 'relative' }}>
                          <input type="text" className={`form-control${claseSiFalta('convenio')}`} placeholder="Buscar por nombre o ID de tarifa..." required={!formData.convenio} disabled={listaConveniosCliente.length === 0} value={searchConvenio}
                            onChange={e => { setSearchConvenio(e.target.value); setShowDropdownConvenio(true); if (formData.convenio) setFormData(prev => ({ ...prev, convenio: '' })); }}
                            onFocus={() => setShowDropdownConvenio(true)} onBlur={() => setTimeout(() => setShowDropdownConvenio(false), 200)} />
                          {showDropdownConvenio && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                              {resultadosConvenio.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosConvenio.map((c:any) => (
                                <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, convenio: c.id })); setSearchConvenio(c.descripcion); setShowDropdownConvenio(false); }}>
                                  <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.descripcion}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#fb923c', fontFamily: 'monospace', marginTop: '2px' }}>ID tarifa: {c.tarifaBaseId || '—'}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#3fb950', fontFamily: 'monospace', marginTop: '1px' }}>Monto: {fmtMoney(c.tarifaMonto)}{nombreMoneda(c.monedaMaestro) ? ` ${nombreMoneda(c.monedaMaestro)}` : ''}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {listaConveniosCliente.length === 0 && searchClientePaga && <small style={{ color: '#8b949e' }}>Este cliente no tiene convenios asignados</small>}
                        {formData.convenio && tarifaIdCliente && (
                          <small style={{ display: 'block', marginTop: '4px', color: tarifasCoinciden ? '#3fb950' : '#fb923c', fontFamily: 'monospace', fontWeight: 600 }}>
                            ID tarifa: {tarifaIdCliente} · Monto: {fmtMoney(montoCliente)}{nombreMoneda(monedaClienteId) ? ` ${nombreMoneda(monedaClienteId)}` : ''}{tarifaIdProveedor && !esFlotaPropiaRoelca ? (tarifasCoinciden ? '  ✓ coincide con el del proveedor' : '  ✕ NO coincide con el del proveedor') : ''}
                          </small>
                        )}
                      </div>
                      <div className="form-group">
                        <label className="form-label"># de Remolque</label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('numeroRemolque')}`} placeholder="Buscar remolque..." value={searchRemolque} onChange={e => { setSearchRemolque(e.target.value); setShowDropdownRemolque(true); if (formData.numeroRemolque) setFormData(prev => ({ ...prev, numeroRemolque: '' })); }} onFocus={() => setShowDropdownRemolque(true)} onBlur={() => setTimeout(() => setShowDropdownRemolque(false), 200)} />
                            {showDropdownRemolque && searchRemolque && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosRemolque.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosRemolque.map((r:any) => (<div key={r.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, numeroRemolque: r.id })); setSearchRemolque(labelRemolque(r)); setShowDropdownRemolque(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{labelRemolque(r)}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Remolque" onClick={() => abrirCreacion(
                            { tipo: 'remolque', coleccion: 'remolques' },
                            (id, reg) => { setFormData(prev => ({ ...prev, numeroRemolque: id })); setSearchRemolque(labelRemolque(reg)); }
                          )} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Ref Cliente</label><input type="text" name="refCliente" className={`form-control${claseSiFalta('refCliente')}`} value={formData.refCliente || ''} onChange={handleChange} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconRoute /></div><h3 className="roelca-card-title">Ruta y Observaciones</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label orange">Origen</label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('origen')}`} placeholder="Buscar origen..." value={searchOrigen} onChange={e => { setSearchOrigen(e.target.value); setShowDropdownOrigen(true); }} onFocus={() => setShowDropdownOrigen(true)} onBlur={() => setTimeout(() => setShowDropdownOrigen(false), 200)} />
                            {showDropdownOrigen && searchOrigen && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosOrigen.map((o:any) => (<div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, origen: o.id })); setSearchOrigen(o.nombre); setShowDropdownOrigen(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{o.nombre}</div><div style={{ fontSize: '0.8rem', color: '#8b949e' }}>{o.direccion}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Origen/Destino" onClick={() => abrirCreacion(
                            { tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_ORIGEN_DESTINO },
                            (id, reg) => { setFormData(prev => ({ ...prev, origen: id })); setSearchOrigen(labelEmpresa(reg)); }
                          )} />
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label orange">Destino</label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('destino')}`} placeholder="Buscar destino..." value={searchDestino} onChange={e => { setSearchDestino(e.target.value); setShowDropdownDestino(true); }} onFocus={() => setShowDropdownDestino(true)} onBlur={() => setTimeout(() => setShowDropdownDestino(false), 200)} />
                            {showDropdownDestino && searchDestino && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosDestino.map((d:any) => (<div key={d.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, destino: d.id })); setSearchDestino(d.nombre); setShowDropdownDestino(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{d.nombre}</div><div style={{ fontSize: '0.8rem', color: '#8b949e' }}>{d.direccion}</div></div>))}</div>)}
                          </div>
                          <BotonAgregar title="Agregar nuevo Origen/Destino" onClick={() => abrirCreacion(
                            { tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_ORIGEN_DESTINO },
                            (id, reg) => { setFormData(prev => ({ ...prev, destino: id })); setSearchDestino(labelEmpresa(reg)); }
                          )} />
                        </div>
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Observaciones Ejecutivo</label><input type="text" name="observacionesEjecutivo" className={`form-control${claseSiFalta('observacionesEjecutivo')}`} value={formData.observacionesEjecutivo || ''} onChange={handleChange} /></div>
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
                        <label className="form-label">Cliente (Mercancía)</label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('clienteMercancia')}`} placeholder="Buscar cliente de mercancía..." value={searchClienteMercancia}
                              onChange={e => { setSearchClienteMercancia(e.target.value); setShowDropdownClienteMercancia(true); if (formData.clienteMercancia) setFormData(prev => ({ ...prev, clienteMercancia: '' })); }}
                              onFocus={() => setShowDropdownClienteMercancia(true)} onBlur={() => setTimeout(() => setShowDropdownClienteMercancia(false), 200)} />
                            {showDropdownClienteMercancia && searchClienteMercancia && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                {resultadosClienteMercancia.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosClienteMercancia.map((c:any) => (
                                  <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, clienteMercancia: c.id })); setSearchClienteMercancia(c.nombre); setShowDropdownClienteMercancia(false); }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <BotonAgregar title="Agregar nuevo Cliente (Mercancía)" onClick={() => abrirCreacion(
                            { tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_CLIENTE_MERCANCIA },
                            (id, reg) => { setFormData(prev => ({ ...prev, clienteMercancia: id })); setSearchClienteMercancia(labelEmpresa(reg)); }
                          )} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Descripción de Mercancía</label><input type="text" name="descripcionMercancia" className={`form-control${claseSiFalta('descripcionMercancia')}`} value={formData.descripcionMercancia || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Cantidad</label><input type="text" name="cantidad" className={`form-control${claseSiFalta('cantidad')}`} value={formData.cantidad || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Embalaje</label><select name="embalaje" className={`form-control${claseSiFalta('embalaje')}`} value={formData.embalaje || ''} onChange={handleChange}><option value="">-- Seleccionar --</option>{(embalajesLocal || [])
                        .map((em:any) => ({ id: String(em.id), texto: String(em.clave ?? em.Clave ?? em.CLAVE ?? em.embalaje ?? em.nombre ?? em.descripcion ?? em.tipo ?? '').trim() }))
                        .filter((o:any) => o.texto !== '')
                        .sort((a:any, b:any) => a.texto.localeCompare(b.texto, 'es', { sensitivity: 'base' }))
                        .map((o:any) => <option key={o.id} value={o.id}>{o.texto}</option>)}</select></div>
                      <div className="form-group"><label className="form-label">Peso (Kg)</label><input type="number" name="pesoKg" className={`form-control${claseSiFalta('pesoKg')}`} value={formData.pesoKg || ''} onChange={handleChange} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconFileText /></div><h3 className="roelca-card-title">Documentación (Carta Porte / DODA)</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># DODA</label><input type="text" name="numDoda" className={`form-control${claseSiFalta('numDoda')}`} value={formData.numDoda || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Fecha Emisión DODA</label><input type="date" name="fechaEmisionDoda" className={`form-control${claseSiFalta('fechaEmisionDoda')}`} value={formData.fechaEmisionDoda || ''} onChange={handleChange} /></div>
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
                      <div className="form-group"><label className="form-label"># de Entry's</label><input type="text" name="numeroEntrys" className={`form-control${claseSiFalta('numeroEntrys')}`} value={formData.numeroEntrys || ''} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Cantidad de Entry's</label>
                        <input type="number" min={0} name="cantEntrys" className={`form-control${claseSiFalta('cantEntrys')}`} value={formData.cantEntrys || 0}
                          onChange={(e) => {
                            const n = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                            setFormData(prev => {
                              const arr = [...(prev.pdfsEntrys || [])];
                              arr.length = n;
                              return { ...prev, cantEntrys: n, pdfsEntrys: arr };
                            });
                          }} />
                      </div>
                    </div>
                    {Number(formData.cantEntrys) > 0 && (
                      <div className="form-grid" style={{ marginTop: '14px' }}>
                        {Array.from({ length: Number(formData.cantEntrys) }).map((_, i) => (
                          <CampoArchivo key={i} label={`PDF Entry #${i + 1}`} file={formData.pdfsEntrys?.[i]} onChange={(e) => handleFileChange(e, 'pdfsEntrys', i)} />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconReceipt /></div><h3 className="roelca-card-title">Manifiesto</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># Manifiesto</label><input type="text" name="numManifiesto" className={`form-control${claseSiFalta('numManifiesto')}`} value={formData.numManifiesto || ''} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Proveedor de Servicios</label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('provServicios')}`} placeholder="Buscar proveedor de servicios..." value={searchProvServicios}
                              onChange={e => { setSearchProvServicios(e.target.value); setShowDropdownProvServicios(true); if (formData.provServicios) setFormData(prev => ({ ...prev, provServicios: '' })); }}
                              onFocus={() => setShowDropdownProvServicios(true)} onBlur={() => setTimeout(() => setShowDropdownProvServicios(false), 200)} />
                            {showDropdownProvServicios && searchProvServicios && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                {resultadosProvServicios.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosProvServicios.map((c:any) => (
                                  <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, provServicios: c.id })); setSearchProvServicios(c.nombre); setShowDropdownProvServicios(false); }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <BotonAgregar title="Agregar nuevo Proveedor (Servicios)" onClick={() => abrirCreacion(
                            { tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_PROV_SERVICIOS },
                            (id, reg) => { setFormData(prev => ({ ...prev, provServicios: id })); setSearchProvServicios(labelEmpresa(reg)); }
                          )} />
                        </div>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Costo Manifiesto</label>
                        <input type="number" step="0.01" name="montoManifiesto" className={`form-control${claseSiFalta('montoManifiesto')}`} value={formData.montoManifiesto || 0} onChange={handleChange} />
                        <small style={{ color: '#8b949e' }}>Costo por defecto: ${COSTO_MANIFIESTO_DEFAULT.toFixed(2)}</small>
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
                        <label className="form-label">Proveedor de Transporte</label>
                        <div className="roelca-lookup-row">
                          <div className="roelca-lookup-input">
                            <input type="text" className={`form-control${claseSiFalta('proveedorUnidad')}`} placeholder="Buscar proveedor de transporte..." value={searchProvTransporte} disabled={proveedorForzado}
                              onChange={e => { setSearchProvTransporte(e.target.value); setShowDropdownProvTransporte(true); if (formData.proveedorUnidad) setFormData(prev => ({ ...prev, proveedorUnidad: '', convenioProveedor: '' })); }}
                              onFocus={() => setShowDropdownProvTransporte(true)} onBlur={() => setTimeout(() => setShowDropdownProvTransporte(false), 200)}
                              style={proveedorForzado ? { opacity: 0.65, cursor: 'not-allowed' } : undefined} />
                            {showDropdownProvTransporte && searchProvTransporte && !proveedorForzado && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                {resultadosProvTransporte.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosProvTransporte.map((c:any) => (
                                  <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); const monedaDefault = resolverMonedaIdDeEmpresa(c); setFormData(prev => ({ ...prev, proveedorUnidad: c.id, convenioProveedor: '', facturadoEnUnidad: monedaDefault || prev.facturadoEnUnidad })); setSearchProvTransporte(c.nombre); setSearchConvenioProveedor(''); setShowDropdownProvTransporte(false); }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          {!proveedorForzado && (
                            <BotonAgregar title="Agregar nuevo Proveedor (Transporte)" onClick={() => abrirCreacion(
                              { tipo: 'empresa', coleccion: 'empresas', tipoEmpresaPreseleccionado: TIPO_EMP_PROV_TRANSPORTE },
                              (id, reg) => { setFormData(prev => ({ ...prev, proveedorUnidad: id, convenioProveedor: '', facturadoEnUnidad: resolverMonedaIdDeEmpresa(reg) || prev.facturadoEnUnidad })); setSearchProvTransporte(labelEmpresa(reg)); setSearchConvenioProveedor(''); }
                            )} />
                          )}
                        </div>
                        {proveedorForzado && <small style={{ color: '#fb923c' }}>Este tipo de operación usa un proveedor fijo.</small>}
                        {esFlotaPropiaRoelca && <small style={{ color: '#3fb950' }}>Flota propia de Roelca: no se paga a un proveedor externo.</small>}
                      </div>

                      {/* ✅ Convenio Proveedor: SOLO cuando NO es flota propia de Roelca. */}
                      {!esFlotaPropiaRoelca && (
                      <div className="form-group">
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                          <label className="form-label" style={{ margin: 0 }}>Convenio Proveedor</label>
                          {(formData.proveedorUnidad || searchProvTransporte) && (
                            <button type="button" onClick={() => setMostrarConveniosProveedor(true)} title="Ver y editar los convenios (tarifas) de este proveedor"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 9px', fontSize: '0.7rem', fontWeight: 600, color: '#58a6ff', backgroundColor: 'rgba(88,166,255,0.10)', border: '1px solid rgba(88,166,255,0.35)', borderRadius: '6px', cursor: 'pointer' }}>
                              <IconReceipt size={12} /> Ver / editar ({listaConveniosProveedor.length})
                            </button>
                          )}
                        </div>
                        <div style={{ position: 'relative' }}>
                          <input type="text" className={`form-control${claseSiFalta('convenioProveedor')}`} placeholder="Buscar por nombre o ID de tarifa..." disabled={listaConveniosProveedor.length === 0} value={searchConvenioProveedor}
                            onChange={e => { setSearchConvenioProveedor(e.target.value); setShowDropdownConvenioProveedor(true); if (formData.convenioProveedor) setFormData(prev => ({ ...prev, convenioProveedor: '' })); }}
                            onFocus={() => setShowDropdownConvenioProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownConvenioProveedor(false), 200)} />
                          {showDropdownConvenioProveedor && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                              {resultadosConvenioProveedor.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosConvenioProveedor.map((c:any) => (
                                <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, convenioProveedor: c.id, monedaConvenioProv: c.monedaBase, totalAPagarProv: c.tarifaMonto })); setSearchConvenioProveedor(c.tipoConvenioNombre); setShowDropdownConvenioProveedor(false); }}>
                                  <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.tipoConvenioNombre}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#fb923c', fontFamily: 'monospace', marginTop: '2px' }}>ID tarifa: {c.tarifaBaseId || '—'}</div>
                                  <div style={{ fontSize: '0.72rem', color: '#3fb950', fontFamily: 'monospace', marginTop: '1px' }}>Monto: {fmtMoney(c.tarifaMonto)}{nombreMoneda(c.monedaBase) ? ` ${nombreMoneda(c.monedaBase)}` : ''}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        {listaConveniosProveedor.length === 0 && searchProvTransporte && <small style={{ color: '#8b949e' }}>Este proveedor no tiene convenios asignados</small>}
                        {formData.convenioProveedor && tarifaIdProveedor && (
                          <small style={{ display: 'block', marginTop: '4px', color: tarifasCoinciden ? '#3fb950' : '#fb923c', fontFamily: 'monospace', fontWeight: 600 }}>
                            ID tarifa: {tarifaIdProveedor} · Monto: {fmtMoney(montoProveedor)}{nombreMoneda(monedaProveedorId) ? ` ${nombreMoneda(monedaProveedorId)}` : ''}{tarifaIdCliente ? (tarifasCoinciden ? '  ✓ coincide con el del cliente' : '  ✕ NO coincide con el del cliente') : ''}
                          </small>
                        )}
                      </div>
                      )}

                      {/* ✅ Facturado En: SOLO cuando NO es flota propia (es parte del pago al proveedor). */}
                      {!esFlotaPropiaRoelca && (
                      <div className="form-group">
                        <label className="form-label">Facturado En</label>
                        <select name="facturadoEnUnidad" className={`form-control${claseSiFalta('facturadoEnUnidad')}`} value={formData.facturadoEnUnidad || ''} onChange={handleChange}>
                          <option value="">-- Seleccionar --</option>
                          {listaMonedasLocal?.map((m:any) => <option key={m.id} value={m.id}>{m.moneda}</option>)}
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
                          <label className="form-label">Unidad</label>
                          <div className="roelca-lookup-row">
                            <div className="roelca-lookup-input">
                              <input type="text" className={`form-control${claseSiFalta('unidad')}`} placeholder="Buscar unidad..." value={searchUnidad}
                                onChange={e => { setSearchUnidad(e.target.value); setShowDropdownUnidad(true); if (formData.unidad) setFormData(prev => ({ ...prev, unidad: '' })); }}
                                onFocus={() => setShowDropdownUnidad(true)} onBlur={() => setTimeout(() => setShowDropdownUnidad(false), 200)} />
                              {showDropdownUnidad && searchUnidad && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                  {resultadosUnidad.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosUnidad.map((u:any) => (
                                    <div key={u.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, unidad: u.id })); setSearchUnidad(labelUnidad(u)); setShowDropdownUnidad(false); }}>
                                      <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{labelUnidad(u)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <BotonAgregar title="Agregar nueva Unidad" onClick={() => abrirCreacion(
                              { tipo: 'unidad', coleccion: 'unidades' },
                              (id, reg) => { setFormData(prev => ({ ...prev, unidad: id })); setSearchUnidad(labelUnidad(reg)); }
                            )} />
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Operador</label>
                          <div className="roelca-lookup-row">
                            <div className="roelca-lookup-input">
                              <input type="text" className={`form-control${claseSiFalta('operador')}`} placeholder="Buscar operador..." value={searchOperador}
                                onChange={e => { setSearchOperador(e.target.value); setShowDropdownOperador(true); if (formData.operador) setFormData(prev => ({ ...prev, operador: '' })); }}
                                onFocus={() => setShowDropdownOperador(true)} onBlur={() => setTimeout(() => setShowDropdownOperador(false), 200)} />
                              {showDropdownOperador && searchOperador && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                  {resultadosOperador.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosOperador.map((o:any) => (
                                    <div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, operador: o.id })); setSearchOperador(labelEmpleado(o)); setShowDropdownOperador(false); }}>
                                      <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{labelEmpleado(o)}</div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <BotonAgregar title="Agregar nuevo Operador" onClick={() => abrirCreacion(
                              { tipo: 'empleado', coleccion: 'empleados' },
                              (id, reg) => { setFormData(prev => ({ ...prev, operador: id })); setSearchOperador(labelEmpleado(reg)); }
                            )} />
                          </div>
                        </div>
                        <div className="form-group"><label className="form-label">Sueldo Operador</label><input type="number" step="0.01" name="sueldoOperador" className={`form-control${claseSiFalta('sueldoOperador')}`} value={formData.sueldoOperador || 0} onChange={handleChange} /></div>
                        <div className="form-group"><label className="form-label">Sueldo Extra</label><input type="number" step="0.01" name="sueldoExtra" className="form-control" value={formData.sueldoExtra || 0} onChange={handleChange} /></div>
                        <div className="form-group"><label className="form-label">Sueldo Total</label><input type="number" className="form-control" value={formData.sueldoTotal || 0} readOnly style={{ opacity: 0.75 }} /></div>
                        <div className="form-group"><label className="form-label">Combustible</label><input type="number" step="0.01" name="combustible" className={`form-control${claseSiFalta('combustible')}`} value={formData.combustible || 0} onChange={handleChange} /></div>
                        <div className="form-group"><label className="form-label">Combustible Extra</label><input type="number" step="0.01" name="combustibleExtra" className="form-control" value={formData.combustibleExtra || 0} onChange={handleChange} /></div>
                        <div className="form-group"><label className="form-label">Combustible Total</label><input type="number" className="form-control" value={formData.combustibleTotal || 0} readOnly style={{ opacity: 0.75 }} /></div>
                      </div>
                    </div>
                  )}

                  {showExternalFleet && (
                    <div className="roelca-card">
                      <div className="roelca-card-header"><div className="roelca-card-icon"><IconTruck /></div><h3 className="roelca-card-title">Flota Externa (Proveedor)</h3></div>
                      <div className="form-grid">
                        <div className="form-group">
                          <label className="form-label">Unidad del Proveedor</label>
                          <div style={{ position: 'relative' }}>
                            <input type="text" className={`form-control${claseSiFalta('unidadProveedor')}`} placeholder="Buscar/escribir unidad del proveedor..." value={searchUnidadProveedor}
                              onChange={e => { setSearchUnidadProveedor(e.target.value); setShowDropdownUnidadProveedor(true); setFormData(prev => ({ ...prev, unidadProveedor: e.target.value })); }}
                              onFocus={() => setShowDropdownUnidadProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownUnidadProveedor(false), 200)} />
                            {showDropdownUnidadProveedor && searchUnidadProveedor && resultadosUnidadProveedor.length > 0 && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                {resultadosUnidadProveedor.map((u:any) => { const txt = String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || ''); return (
                                  <div key={u.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, unidadProveedor: u.id })); setSearchUnidadProveedor(txt); setShowDropdownUnidadProveedor(false); }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{txt}</div>
                                  </div>
                                ); })}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Operador del Proveedor</label>
                          <div style={{ position: 'relative' }}>
                            <input type="text" className={`form-control${claseSiFalta('operadorProveedor')}`} placeholder="Buscar/escribir operador del proveedor..." value={searchOperadorProveedor}
                              onChange={e => { setSearchOperadorProveedor(e.target.value); setShowDropdownOperadorProveedor(true); setFormData(prev => ({ ...prev, operadorProveedor: e.target.value })); }}
                              onFocus={() => setShowDropdownOperadorProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownOperadorProveedor(false), 200)} />
                            {showDropdownOperadorProveedor && searchOperadorProveedor && resultadosOperadorProveedor.length > 0 && (
                              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                                {resultadosOperadorProveedor.map((o:any) => { const txt = String(o.nombre || o.nombres || o.nombreCompleto || ''); return (
                                  <div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, operadorProveedor: o.id })); setSearchOperadorProveedor(txt); setShowDropdownOperadorProveedor(false); }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{txt}</div>
                                  </div>
                                ); })}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ✅ Pago al Proveedor: SOLO cuando NO es flota propia de Roelca. */}
                  {!esFlotaPropiaRoelca && (
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Pago al Proveedor</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">Monto a Pagar Proveedor</label><input type="number" step="0.01" name="totalAPagarProv" className={`form-control${claseSiFalta('totalAPagarProv')}`} value={formData.totalAPagarProv || 0} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Cargos Adicionales (Prov)</label>
                        <div className="roelca-lookup-row">
                          <input type="number" step="0.01" name="cargosAdicionalesProv" className={`form-control${claseSiFalta('cargosAdicionalesProv')}`} value={formData.cargosAdicionalesProv || 0} onChange={handleChange} style={{ flex: 1, minWidth: 0 }} />
                          <BotonAgregar title="Administrar costos adicionales" onClick={() => setMostrarCostosAdic(true)} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Subtotal Proveedor</label><input type="number" className="form-control" value={formData.subtotalProv || 0} readOnly style={{ opacity: 0.75 }} /></div>
                      <div className="form-group"><label className="form-label">Conversión (MXN)</label><input type="number" className="form-control" value={Number(formData.conversionProv || 0).toFixed(2)} readOnly style={{ opacity: 0.75 }} /></div>
                    </div>
                  </div>
                  )}

                  {/* ✅ Observaciones de Unidad: SIEMPRE visible (aplica también a flota propia). */}
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconFileText /></div><h3 className="roelca-card-title">Observaciones de Unidad</h3></div>
                    <div className="form-grid">
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Observaciones Unidad</label><textarea name="observacionesUnidad" className="form-control" rows={2} value={formData.observacionesUnidad || ''} onChange={handleChange} /></div>
                    </div>
                  </div>
                </>
              )}

              {pestañaActiva === 'cobrar' && pestanasVisibles.includes('cobrar') && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconDollar /></div><h3 className="roelca-card-title">Facturación al Cliente</h3></div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Facturado En</label>
                        <select name="facturadoEnCobrar" className={`form-control${claseSiFalta('facturadoEnCobrar')}`} value={formData.facturadoEnCobrar || ''} onChange={handleChange}>
                          <option value="">-- Seleccionar --</option>
                          {listaMonedasLocal?.map((m:any) => <option key={m.id} value={m.id}>{m.moneda}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label className="form-label">Monto Convenio Cliente</label><input type="number" step="0.01" name="montoConvenioCliente" className={`form-control${claseSiFalta('montoConvenioCliente')}`} value={formData.montoConvenioCliente || 0} onChange={handleChange} /></div>
                      <div className="form-group">
                        <label className="form-label">Cargos Adicionales</label>
                        <div className="roelca-lookup-row">
                          <input type="number" step="0.01" name="cargosAdicionales" className={`form-control${claseSiFalta('cargosAdicionales')}`} value={formData.cargosAdicionales || 0} onChange={handleChange} style={{ flex: 1, minWidth: 0 }} />
                          <BotonAgregar title="Administrar costos adicionales" onClick={() => setMostrarCostosAdic(true)} />
                        </div>
                      </div>
                      <div className="form-group"><label className="form-label">Tipo de Cambio Aprobado</label><input type="number" step="0.0001" name="tipoCambioAprobado" className={`form-control${claseSiFalta('tipoCambioAprobado')}`} value={formData.tipoCambioAprobado || 0} onChange={handleChange} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header"><div className="roelca-card-icon"><IconTrendingUp /></div><h3 className="roelca-card-title">Conversión y Utilidad</h3></div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">Subtotal Cliente</label><input type="number" className="form-control" value={formData.subtotalCliente || 0} readOnly style={{ opacity: 0.75 }} /></div>
                      <div className="form-group"><label className="form-label">Conversión Cliente (MXN)</label><input type="number" className="form-control" value={Number(formData.conversionCliente || 0).toFixed(2)} readOnly style={{ opacity: 0.75 }} /></div>
                      {!esFlotaPropiaRoelca && (
                        <div className="form-group"><label className="form-label">Conversión Proveedor (MXN)</label><input type="number" className="form-control" value={Number(formData.conversionProv || 0).toFixed(2)} readOnly style={{ opacity: 0.75 }} /></div>
                      )}
                      <div className="form-group">
                        <label className="form-label">Utilidad Estimada (MXN)</label>
                        <input type="number" className="form-control" value={Number(formData.utilidadEstimada || 0).toFixed(2)} readOnly
                          style={{ opacity: 0.95, color: Number(formData.utilidadEstimada) >= 0 ? '#3fb950' : '#f85149', fontWeight: 700 }} />
                      </div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Observaciones Cobranza</label><textarea name="observacionesCobrar" className="form-control" rows={2} value={formData.observacionesCobrar || ''} onChange={handleChange} /></div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </form>
        </div>

        <aside className="roelca-form-right">
          <div className="roelca-scroll" style={{ padding: '20px' }}>
            {statusError ? (
              <div className="status-error-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span className="status-badge-error"><IconAlert size={12} /> Estatus</span>
                </div>
                <div style={{ color: '#f0a3a0', fontSize: '0.82rem', lineHeight: 1.4 }}>{statusError}</div>
              </div>
            ) : statusPreview ? (
              <div className="status-preview-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span className="status-badge-ok"><IconCheck size={12} /> Estatus actual</span>
                </div>
                <div style={{ color: '#e6edf3', fontSize: '1rem', fontWeight: 700 }}>{statusPreview}</div>
                {nombreSiguienteAuto && camposSiguienteStatus.length > 0 && (
                  <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid rgba(63,185,80,0.18)' }}>
                    <div style={{ fontSize: '0.68rem', color: '#7d8590', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 600, marginBottom: '6px' }}>
                      Para avanzar a "{nombreSiguienteAuto}":
                    </div>
                    {camposSiguienteStatus.map((c) => (
                      <div key={c.campo} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: c.cumplido ? '#3fb950' : '#8b949e', padding: '2px 0' }}>
                        <span style={{ width: '14px', display: 'inline-flex' }}>{c.cumplido ? <IconCheck size={12} /> : <IconArrowRight size={12} />}</span>
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
                <div className="roelca-money-row" style={{ alignItems: 'flex-start' }}>
                  <span className="lbl">Cliente</span>
                  <span className="val" style={{ color: '#e6edf3', textAlign: 'right', maxWidth: '62%', lineHeight: 1.3 }}>
                    {nombreTarifaCli || '—'}
                    {tarifaIdCliente && <span style={{ display: 'block', fontSize: '0.66rem', color: '#7d8590', fontFamily: 'monospace', fontWeight: 400, marginTop: '2px' }}>ID: {tarifaIdCliente}</span>}
                  </span>
                </div>
                {/* ✅ Filas del proveedor: SOLO cuando NO es flota propia de Roelca. */}
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row" style={{ alignItems: 'flex-start' }}>
                    <span className="lbl">Proveedor</span>
                    <span className="val" style={{ color: '#e6edf3', textAlign: 'right', maxWidth: '62%', lineHeight: 1.3 }}>
                      {nombreTarifaProv || '—'}
                      {tarifaIdProveedor && <span style={{ display: 'block', fontSize: '0.66rem', color: '#7d8590', fontFamily: 'monospace', fontWeight: 400, marginTop: '2px' }}>ID: {tarifaIdProveedor}</span>}
                    </span>
                  </div>
                )}
                <div className="roelca-money-row"><span className="lbl">Monto Cliente</span><span className="val">{fmtMoney(montoCliente)}{nombreMoneda(monedaClienteId) ? ` ${nombreMoneda(monedaClienteId)}` : ''}</span></div>
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row"><span className="lbl">Monto Proveedor</span><span className="val">{fmtMoney(montoProveedor)}{nombreMoneda(monedaProveedorId) ? ` ${nombreMoneda(monedaProveedorId)}` : ''}</span></div>
                )}
                {!esFlotaPropiaRoelca && (
                  <div className="roelca-money-row" style={{ borderTop: '1px solid #1f2733', marginTop: '4px', paddingTop: '8px' }}>
                    <span className="lbl">¿Tarifas coinciden?</span>
                    <span className="val" style={{ color: tarifasCoinciden ? '#3fb950' : '#fb923c' }}>
                      {tarifaIdCliente && tarifaIdProveedor ? (tarifasCoinciden ? '✓ Sí' : '✕ No') : '—'}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconUsers size={13} /></span> Cliente y Ruta</div>
              <div className="roelca-sidebar-value">{searchClientePaga || <span className="roelca-sidebar-muted">Sin cliente</span>}</div>
              {convenioNombreResumen && <div className="roelca-sidebar-secondary">Convenio: {convenioNombreResumen}</div>}
              <div className="roelca-route-line">
                <IconMapPin size={13} /> {searchOrigen || '—'} <IconArrowRight size={12} /> {searchDestino || '—'}
              </div>
            </div>

            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label"><span className="roelca-sidebar-icon"><IconBriefcase size={13} /></span> Servicio</div>
              <div className="roelca-sidebar-value">{tipoOpNombreResumen || <span className="roelca-sidebar-muted">Sin tipo de operación</span>}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
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
              <div className="roelca-money-row"><span className="lbl">Subtotal Cliente</span><span className="val">{fmtMoney(formData.subtotalCliente)}</span></div>
              {/* ✅ Subtotal Proveedor: SOLO cuando NO es flota propia de Roelca. */}
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
        <div
          onClick={onRestore}
          style={{ position: 'fixed', bottom: '20px', right: '20px', backgroundColor: '#0d1117', border: '1px solid #fb923c', borderRadius: '10px', padding: '12px 18px', cursor: 'pointer', pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 1000 }}
        >
          <span style={{ color: '#fb923c' }}><IconBriefcase size={18} /></span>
          <div style={{ color: '#e6edf3', fontSize: '0.85rem', fontWeight: 600 }}>
            {initialData ? `Editar ${initialData.ref || initialData.id?.substring(0,6)}` : 'Nueva Operación'}
          </div>
          <span style={{ color: '#8b949e' }}><IconArrowRight size={15} /></span>
        </div>
      )}

      {modalCatalogo && modalCatalogo.catalogo.tipo === 'empresa' && (
        <FormularioEmpresa estado="abierto" registros={empresasLocal} onClose={cerrarCreacion} onMinimize={() => {}} onRestore={() => {}} />
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

      {mostrarCostosAdic && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <CostosAdicionalesDashboard
            onCerrar={() => setMostrarCostosAdic(false)}
            onCostosActualizados={(totalProv?: any, totalCliente?: any) => {
              const p = Number(totalProv);
              const c = Number(totalCliente);
              setFormData(prev => ({
                ...prev,
                ...(Number.isFinite(p) ? { cargosAdicionalesProv: p } : {}),
                ...(Number.isFinite(c) ? { cargosAdicionales: c } : {}),
              }));
            }}
          />
        </div>
      )}

      {mostrarSubirDoc && idOperacion && (
        <DocumentoUploadModal
          isOpen={true}
          coleccionOrigen="operaciones"
          registroId={idOperacion}
          registroNombre={referenciaOperacion}
          tiposDocumento={TIPOS_DOCUMENTO_OPERACION}
          onClose={() => setMostrarSubirDoc(false)}
        />
      )}

      {/* === Ver / editar convenios (tarifas) del CLIENTE === */}
      {mostrarConveniosCliente && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarConveniosCliente(false); }}>
          <div className="form-card" style={{ width: 'min(820px, 94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0d1117', border: '1px solid #1f2733', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #1f2733', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 700 }}>Convenios del Cliente</h3>
                <p style={{ margin: '3px 0 0', color: '#7d8590', fontSize: '0.8rem' }}>{searchClientePaga || 'Cliente'} · {listaConveniosCliente.length} convenio(s)</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={abrirNuevoConvenioCliente} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', fontSize: '0.82rem', fontWeight: 600, color: '#fff', background: 'linear-gradient(180deg, #ea580c, #c2410c)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><IconPlus size={14} /> Nuevo</button>
                <button type="button" onClick={() => setMostrarConveniosCliente(false)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 0' }}>
              {listaConveniosCliente.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#8b949e' }}>Este cliente no tiene convenios.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ color: '#7d8590', textAlign: 'left' }}>
                      <th style={{ padding: '8px 16px', fontWeight: 600 }}>Tarifa</th>
                      <th style={{ padding: '8px 16px', fontWeight: 600 }}>ID</th>
                      <th style={{ padding: '8px 16px', fontWeight: 600, textAlign: 'right' }}>Monto</th>
                      <th style={{ padding: '8px 16px', fontWeight: 600, textAlign: 'right' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaConveniosCliente.map((c:any) => (
                      <tr key={c.id} style={{ borderTop: '1px solid #1f2733', color: '#c9d1d9' }}>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>{c.descripcion}</td>
                        <td style={{ padding: '10px 16px', fontFamily: 'monospace', color: '#fb923c' }}>{c.tarifaBaseId || '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: '#3fb950', fontFamily: 'monospace' }}>{fmtMoney(c.tarifaMonto)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" onClick={() => abrirEditorConvenio(c)} title="Editar" style={{ background: 'transparent', border: '1px solid #2d333b', color: '#58a6ff', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', marginRight: '6px' }}><IconEdit size={13} /></button>
                          <button type="button" onClick={() => eliminarDetalleConvenio(c)} title="Eliminar" style={{ background: 'transparent', border: '1px solid rgba(248,81,73,0.35)', color: '#f85149', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer' }}><IconX size={13} /></button>
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

      {/* === Editor de un convenio del CLIENTE (crear/editar) === */}
      {detalleConvEditando && (
        <div className="modal-overlay" style={{ zIndex: 1200 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setDetalleConvEditando(null); }}>
          <div className="form-card" style={{ width: 'min(520px, 94vw)', backgroundColor: '#0d1117', border: '1px solid #1f2733', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #1f2733', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.05rem', fontWeight: 700 }}>{detalleConvEditando.esNuevo ? 'Nuevo Convenio (Cliente)' : 'Editar Convenio (Cliente)'}</h3>
              <button type="button" onClick={() => setDetalleConvEditando(null)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label className="form-label">Tarifa (catálogo)</label>
                <select className="form-control" value={detalleConvEditando.tipoConvenioId || ''}
                  onChange={(e) => { const id = e.target.value; const op = opcionesTarifasRef.find((o:any) => o.id === id); setDetalleConvEditando((prev:any) => ({ ...prev, tipoConvenioId: id, tipoConvenioNombre: op?.nombre || prev.tipoConvenioNombre })); }}>
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
            <div style={{ padding: '16px 22px', borderTop: '1px solid #1f2733', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setDetalleConvEditando(null)} className="roelca-btn-outline" style={{ width: 'auto', padding: '10px 16px' }}>Cancelar</button>
              <button type="button" onClick={guardarDetalleConvenio} className="roelca-btn-primary" style={{ width: 'auto', padding: '10px 18px' }} disabled={guardandoDetalleConv}>{guardandoDetalleConv ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* === Ver / editar convenios (tarifas) del PROVEEDOR === */}
      {mostrarConveniosProveedor && (
        <div className="modal-overlay" style={{ zIndex: 1100 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setMostrarConveniosProveedor(false); }}>
          <div className="form-card" style={{ width: 'min(820px, 94vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0d1117', border: '1px solid #1f2733', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #1f2733', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.1rem', fontWeight: 700 }}>Convenios del Proveedor</h3>
                <p style={{ margin: '3px 0 0', color: '#7d8590', fontSize: '0.8rem' }}>{searchProvTransporte || 'Proveedor'} · {listaConveniosProveedor.length} convenio(s)</p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button type="button" onClick={abrirNuevoConvenioProv} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 12px', fontSize: '0.82rem', fontWeight: 600, color: '#fff', background: 'linear-gradient(180deg, #ea580c, #c2410c)', border: 'none', borderRadius: '8px', cursor: 'pointer' }}><IconPlus size={14} /> Nuevo</button>
                <button type="button" onClick={() => setMostrarConveniosProveedor(false)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
              </div>
            </div>
            <div style={{ overflowY: 'auto', padding: '8px 0' }}>
              {listaConveniosProveedor.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#8b949e' }}>Este proveedor no tiene convenios.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                  <thead>
                    <tr style={{ color: '#7d8590', textAlign: 'left' }}>
                      <th style={{ padding: '8px 16px', fontWeight: 600 }}>Tarifa</th>
                      <th style={{ padding: '8px 16px', fontWeight: 600 }}>ID</th>
                      <th style={{ padding: '8px 16px', fontWeight: 600, textAlign: 'right' }}>Monto</th>
                      <th style={{ padding: '8px 16px', fontWeight: 600, textAlign: 'right' }}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {listaConveniosProveedor.map((c:any) => (
                      <tr key={c.id} style={{ borderTop: '1px solid #1f2733', color: '#c9d1d9' }}>
                        <td style={{ padding: '10px 16px', fontWeight: 600 }}>{c.tipoConvenioNombre}</td>
                        <td style={{ padding: '10px 16px', fontFamily: 'monospace', color: '#fb923c' }}>{c.tarifaBaseId || '—'}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', color: '#3fb950', fontFamily: 'monospace' }}>{fmtMoney(c.tarifaMonto)}</td>
                        <td style={{ padding: '10px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button type="button" onClick={() => abrirEditorConvenioProv(c)} title="Editar" style={{ background: 'transparent', border: '1px solid #2d333b', color: '#58a6ff', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer', marginRight: '6px' }}><IconEdit size={13} /></button>
                          <button type="button" onClick={() => eliminarDetalleConvenioProv(c)} title="Eliminar" style={{ background: 'transparent', border: '1px solid rgba(248,81,73,0.35)', color: '#f85149', borderRadius: '6px', padding: '5px 8px', cursor: 'pointer' }}><IconX size={13} /></button>
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

      {/* === Editor de un convenio del PROVEEDOR (crear/editar) === */}
      {detalleConvProvEditando && (
        <div className="modal-overlay" style={{ zIndex: 1200 }} onMouseDown={(e) => { if (e.target === e.currentTarget) setDetalleConvProvEditando(null); }}>
          <div className="form-card" style={{ width: 'min(520px, 94vw)', backgroundColor: '#0d1117', border: '1px solid #1f2733', borderRadius: '12px', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #1f2733', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.05rem', fontWeight: 700 }}>{detalleConvProvEditando.esNuevo ? 'Nuevo Convenio (Proveedor)' : 'Editar Convenio (Proveedor)'}</h3>
              <button type="button" onClick={() => setDetalleConvProvEditando(null)} className="roelca-window-btn danger" title="Cerrar"><IconX size={16} /></button>
            </div>
            <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div className="form-group">
                <label className="form-label">Tarifa (catálogo)</label>
                <select className="form-control" value={detalleConvProvEditando.tipoConvenioId || ''}
                  onChange={(e) => { const id = e.target.value; const op = opcionesTarifasRef.find((o:any) => o.id === id); setDetalleConvProvEditando((prev:any) => ({ ...prev, tipoConvenioId: id, tipoConvenioNombre: op?.nombre || prev.tipoConvenioNombre })); }}>
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
            <div style={{ padding: '16px 22px', borderTop: '1px solid #1f2733', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setDetalleConvProvEditando(null)} className="roelca-btn-outline" style={{ width: 'auto', padding: '10px 16px' }}>Cancelar</button>
              <button type="button" onClick={guardarDetalleConvenioProv} className="roelca-btn-primary" style={{ width: 'auto', padding: '10px 18px' }} disabled={guardandoDetalleConvProv}>{guardandoDetalleConvProv ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { guardarOperacionSegura } from '../services/operacionesService';
import { calcularStatusDinamico } from '../config/statusRules';

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

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// ============================================================
// ICONOS SVG (estilo línea fina, monocromáticos, profesional)
// Tamaño 18 por defecto. currentColor para heredar el color del padre.
// ============================================================

const IconBriefcase     = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>;
const IconFileText      = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>;
const IconTruck         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
const IconClipboard     = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4h6v3H9z"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="13" y2="15"/></svg>;
const IconDollar        = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>;
const IconUser          = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>;
const IconUsers         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
const IconMapPin        = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconCalendar      = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>;
const IconPackage       = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>;
const IconReceipt       = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M4 2h16v20l-3-2-2 2-3-2-3 2-2-2-3 2z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>;
const IconChart         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="3" y1="20" x2="21" y2="20"/></svg>;
const IconTrendingUp    = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>;
const IconRefresh       = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>;
const IconRoute         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>;
const IconEdit          = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IconSave          = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>;
const IconX             = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconMinimize      = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="5" y1="19" x2="19" y2="19"/></svg>;
const IconAlert         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>;
const IconCheck         = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><polyline points="20 6 9 17 4 12"/></svg>;
const IconArrowRight    = (p: { size?: number }) => <svg width={p.size || 18} height={p.size || 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>;


// ✅ Caché de "tipo tarifario" en memoria. Es un catálogo pequeño y nunca cambia.
// Antes: cada selección de convenio leía Firestore. Ahora: 1 lectura por tarifa, por sesión.
const tipoTarifarioCache = new Map<string, any>();

export const FormularioOperacion = ({ estado, initialData, onClose, onMinimize, onRestore, catalogosCacheados, onSave }: FormProps) => {
  const [pestañaActiva, setPestañaActiva] = useState<TabType>('general');
  const [cargando, setCargando] = useState(false);

  const [statusPreview, setStatusPreview] = useState<string>('');
  const [statusError, setStatusError] = useState<string | null>(null);

  const {
    empresas = [],
    tiposOperacion = [],
    embalajes = [],
    remolques = [],
    tarifas = [],
    conveniosProv = [],
    catalogoTC = [],
    catalogoConvProvDetalles = [],
    catalogoConvClientes = [],            // ✅ Ahora SÍ lo usamos (en lugar de leer Firestore)
    catalogoConvDetalles = [],            // ✅ Ahora SÍ lo usamos
    unidades = [],
    empleados = [], 
    statusServicio = [],
    catalogoMoneda = [],
    unidadesProveedor = catalogosCacheados?.unidades_proveedor || [],
    proveedoresUnidad = catalogosCacheados?.proveedores_unidad || []
  } = catalogosCacheados || {};

  // ✅ Estos arrays vienen del caché global del dashboard. NO se mutan dentro del formulario,
  // así que no necesitan useState (eso era código muerto del fallback antiguo).
  // Si llegan vacíos significa que el dashboard aún no los cargó, y se muestra "Cargando catálogos..."
  const listaEmpleadosLocal: any[] = empleados;
  const listaUniProvLocal: any[] = unidadesProveedor;
  const listaOpeProvLocal: any[] = proveedoresUnidad;
  const listaMonedasLocal: any[] = catalogoMoneda;

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

  // ✅ ELIMINADO el useEffect que descargaba 4 colecciones completas como fallback.
  // El dashboard ahora cachea TODO en localStorage con TTL, así que estos arrays siempre vienen
  // listos al abrir el formulario. Si no, se mostrará un mensaje claro ("Cargando catálogos...").

  const buildConfigId = () => {
    let tipoOpText = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || 'N/A';
    
    if (tipoOpText.toLowerCase() === 'logistica') {
      tipoOpText = 'Logística';
    } else if (tipoOpText !== 'N/A') {
      tipoOpText = tipoOpText.charAt(0).toUpperCase() + tipoOpText.slice(1).toLowerCase();
    }

    const formatTitleCase = (str: string) => {
      if (!str || str === 'N/A') return 'N/A';
      return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    };

    return `${tipoOpText}_${formatTitleCase(formData.trafico)}_${formatTitleCase(formData.carga)}`;
  };

  useEffect(() => {
    const timerId = setTimeout(async () => {
      const configId = buildConfigId();
      
      if (!configId || configId.includes('N/A') || configId === '__' || !formData.tipoOperacionId) {
        setStatusPreview('');
        setStatusError('Para conocer el Estatus de la operación, primero selecciona el Tipo de Operación, un Cliente y un Convenio válido.');
        return;
      }

      try {
        const statusCalculado = await calcularStatusDinamico(configId, formData, initialData?.status);
        const statusObj = statusServicio?.find((s:any) => s.id === statusCalculado);
        setStatusPreview(statusObj?.descripcion || statusObj?.nombre || statusCalculado);
        setStatusError(null);
      } catch (error: any) {
        setStatusPreview('');
        const msjLimpio = error.message.replace('⛔ BLOQUEO: ', '').replace('⛔ ', '');
        setStatusError(msjLimpio);
      }
    }, 800);

    return () => clearTimeout(timerId);
  }, [formData, initialData, tiposOperacion, statusServicio]);

  useEffect(() => {
    const sOp = Number(formData.sueldoOperador) || 0;
    const sExt = Number(formData.sueldoExtra) || 0;
    setFormData(prev => ({ ...prev, sueldoTotal: sOp + sExt }));
  }, [formData.sueldoOperador, formData.sueldoExtra]);

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

      setSearchClientePaga(initialData.clienteNombre || getNombreEmpresa(initialData.clientePaga));
      setSearchOrigen(initialData.origenNombre || getNombreEmpresa(initialData.origen));
      setSearchDestino(initialData.destinoNombre || getNombreEmpresa(initialData.destino));
      setSearchClienteMercancia(initialData.clienteMercanciaNombre || getNombreEmpresa(initialData.clienteMercancia));
      setSearchProvServicios(initialData.provServiciosNombre || getNombreEmpresa(initialData.provServicios));
      setSearchProvTransporte(initialData.proveedorUnidadNombre || getNombreEmpresa(initialData.proveedorUnidad));
      
      setSearchRemolque(initialData.remolqueNombre || getNombreRemolque(initialData.numeroRemolque)); 
      setSearchUnidad(initialData.unidadNombre || getNombreUnidad(initialData.unidad));
      setSearchOperador(initialData.operadorNombre || getNombreOperador(initialData.operador));

      const uProv = listaUniProvLocal.find((e: any) => e.id === initialData.unidadProveedor);
      setSearchUnidadProveedor(initialData.unidadProveedorNombre || (uProv ? (uProv.numeroUnidad || uProv.numero_unidad || uProv.unidad || uProv.placas) : initialData.unidadProveedor || ''));

      const opProv = listaOpeProvLocal.find((e: any) => e.id === initialData.operadorProveedor);
      setSearchOperadorProveedor(initialData.operadorProveedorNombre || (opProv ? (opProv.nombre || opProv.nombres || opProv.nombreCompleto) : initialData.operadorProveedor || ''));
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
    if(tcEncontrado && (!initialData || formData.fechaServicio !== initialData.fechaServicio)) {
       setFormData(prev => ({...prev, tipoCambioAprobado: tcEncontrado}));
    }
    setBuscandoTC(false);
  }, [formData.fechaServicio, catalogoTC, initialData]);

  /* ============================================================
     ✅ OPTIMIZADO: Convenios del cliente filtrados DEL CACHÉ EN MEMORIA.
     
     Antes: cada vez que cambiaba el cliente, hacía 2 consultas a Firestore:
       1. query(convenios_clientes, where clienteId == X)         → N lecturas
       2. getDocs(convenios_clientes_detalles)                    → ¡TODA la colección!
     
     Si tenías 500 detalles en la colección, eran 500+ lecturas POR cada cambio de cliente.
     Multiplica eso por cada vez que un usuario edita una operación = consumo masivo.
     
     Ahora: filtramos `catalogoConvClientes` y `catalogoConvDetalles` que YA están en memoria
     (cargados una sola vez desde el dashboard con caché de localStorage). 0 lecturas a Firestore.
  ============================================================ */
  const listaConveniosCliente = useMemo(() => {
    let clientId = formData.clientePaga;
    if (!clientId && searchClientePaga && empresas) {
      const emp = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchClientePaga.toLowerCase().trim());
      if (emp) clientId = emp.id;
    }

    if (!clientId || !catalogoConvClientes || !catalogoConvDetalles) return [];

    // Filtramos maestros que correspondan al cliente seleccionado
    const maestros = catalogoConvClientes.filter((c: any) => String(c.clienteId).trim() === String(clientId).trim());
    if (maestros.length === 0) return [];

    const maestroIds = new Set(maestros.map((m: any) => String(m.id).trim()));

    // Filtramos detalles asociados a esos maestros
    const detallesAsociados = catalogoConvDetalles.filter((d: any) => maestroIds.has(String(d.convenioId).trim()));

    return detallesAsociados.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio_id || d.tipoConvenio || d['TIPO DE CONVENIO'];
      const tObj = tarifas?.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const maestroAsociado = maestros.find((m: any) => String(m.id).trim() === String(d.convenioId).trim());

      const nombreFinal = d.tipoConvenioNombre || tObj?.descripcion || tObj?.nombre || (tarifaId ? `Tarifa (${tarifaId})` : 'Sin Asignar');

      return {
        id: d.id,
        tarifaBaseId: tarifaId,
        descripcion: nombreFinal,
        monedaMaestro: d.moneda || maestroAsociado?.monedaId || maestroAsociado?.moneda || ID_USD,
        tarifaMonto: Number(d.tarifa || d.monto || d.precio || 0),
        ...d
      };
    });
  }, [formData.clientePaga, searchClientePaga, catalogoConvClientes, catalogoConvDetalles, tarifas, empresas]);

  /* ============================================================
     ✅ OPTIMIZADO: Convenios del proveedor también filtrados DEL CACHÉ.
     
     Antes: si `catalogoConvProvDetalles` estaba vacío, hacía un getDocs completo de Firestore.
     Ahora: confiamos en el catálogo del dashboard y filtramos en memoria.
  ============================================================ */
  const listaConveniosProveedor = useMemo(() => {
    let provId = formData.proveedorUnidad;
    if (!provId && searchProvTransporte && empresas) {
      const prov = empresas.find((e: any) => e.nombre?.toLowerCase().trim() === searchProvTransporte.toLowerCase().trim());
      if (prov) provId = prov.id;
    }

    if (!provId || !conveniosProv || !Array.isArray(conveniosProv)) return [];

    const maestrosAsociados = conveniosProv.filter((c: any) =>
      String(c.proveedorId || c.proveedor || c.id_proveedor || '').trim() === String(provId).trim()
    );
    if (maestrosAsociados.length === 0) return [];

    const maestroIds = new Set(maestrosAsociados.map((m: any) => String(m.id).trim()));

    const detallesAsociados = (catalogoConvProvDetalles || []).filter((d: any) => {
      const convRef = String(d.convenioId || d.convenio || d.id_convenio || '').trim();
      return maestroIds.has(convRef);
    });

    return detallesAsociados.map((d: any) => {
      const tarifaId = d.tipoConvenioId || d.tipo_convenio || d.tarifaId || d['TIPO DE CONVENIO'];
      const tObj = tarifas?.find((t: any) => String(t.id).trim() === String(tarifaId).trim());
      const maestroParent = maestrosAsociados.find((m: any) => String(m.id).trim() === String(d.convenioId).trim());
      const nombreFinal = tObj?.descripcion || tObj?.nombre || d.tipoConvenioNombre || 'Concepto sin nombre';

      return {
        id: d.id,
        tarifaBaseId: tarifaId,
        tipoConvenioNombre: nombreFinal,
        monedaBase: maestroParent?.monedaId || maestroParent?.moneda || d.moneda || ID_USD,
        tarifaMonto: Number(d.tarifa || d.monto || d.precio || 0)
      };
    });
  }, [formData.proveedorUnidad, searchProvTransporte, conveniosProv, catalogoConvProvDetalles, tarifas, empresas]);

  /* ============================================================
     ✅ OPTIMIZADO: Resolver flujo (tipo tarifario) con caché en memoria.
     
     Antes: cada cambio de convenio leía `catalogo_tipos_tarifarios/{id}` de Firestore.
     Si seleccionas/cambias el convenio 5 veces, eran 5 lecturas.
     
     Ahora: cacheamos el tipo tarifario en un Map global. Una sola lectura por tipo, por sesión.
  ============================================================ */
  useEffect(() => {
    const resolverFlujo = async () => {
      if (!formData.convenio) return;
      try {
        const detalleElegido = listaConveniosCliente.find((c: any) => c.id === formData.convenio);
        if (!detalleElegido) return;

        setFormData(prev => ({ 
          ...prev, 
          monedaConvenioCliente: detalleElegido.monedaMaestro, 
          montoConvenioCliente: detalleElegido.tarifaMonto 
        }));

        const tarifaObj = tarifas?.find((t: any) => t.id === detalleElegido.tarifaBaseId);
        if (!tarifaObj) return;

        const tipoOpId = String(tarifaObj.tipo_operacion);

        // ✅ Buscar en caché de memoria primero
        let tipoData = tipoTarifarioCache.get(tipoOpId);
        if (!tipoData) {
          const tipoRef = doc(db, 'catalogo_tipos_tarifarios', tipoOpId);
          const tipoSnap = await getDoc(tipoRef);
          if (tipoSnap.exists()) {
            tipoData = tipoSnap.data();
            tipoTarifarioCache.set(tipoOpId, tipoData);
          }
        }

        if (tipoData) {
          setFormData(prev => ({
            ...prev,
            tipoServicio: tipoData.descripcion || 'N/A',
            trafico: tipoData.movimiento || 'N/A',
            carga: tarifaObj.estado_carga || 'N/A'
          }));
        }
      } catch (error) {
        console.error('Error resolviendo flujo:', error);
      }
    };
    if (!initialData) resolverFlujo();
  }, [formData.convenio, listaConveniosCliente, tarifas, initialData]);

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
    setFormData(prev => ({ 
      ...prev, subtotalCliente: subtotal, dolaresCliente: dol, pesosCliente: pes, conversionCliente: conv, utilidadEstimada: utilidad 
    }));
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

  // ✅ OPTIMIZADO: filtros calculados con useMemo para evitar recalcular en cada render.
  const filClientesPaga = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('7eec9cbb') && e.status === 'Activa') || [], [empresas]);
  const filClientesMercancia = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('51246232') && e.status === 'Activa') || [], [empresas]);
  const filProveedoresServicios = useMemo(() => empresas?.filter((e:any) => e.tiposEmpresa?.includes('11894dfd') && e.status === 'Activa') || [], [empresas]);
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

  const resultadosOrigen = filOrigenesDestinos.filter((e:any) => (e.nombre || '').toLowerCase().includes(sOrigen) || (e.direccion || '').toLowerCase().includes(sOrigen));
  const resultadosDestino = filOrigenesDestinos.filter((e:any) => (e.nombre || '').toLowerCase().includes(sDestino) || (e.direccion || '').toLowerCase().includes(sDestino));
  const resultadosClientePaga = filClientesPaga.filter((e:any) => (e.nombre || '').toLowerCase().includes(sClientePaga));
  
  const resultadosRemolque = remolques?.filter((e:any) => {
    const texto = `${e.nombre || ''} ${e.placas || e.placa || ''}`.toLowerCase().trim();
    return texto.includes(sRemolque);
  }) || [];
  
  const resultadosClienteMercancia = filClientesMercancia.filter((e:any) => (e.nombre || '').toLowerCase().includes(sClienteMerc));
  const resultadosProvServicios = filProveedoresServicios.filter((e:any) => (e.nombre || '').toLowerCase().includes(sProvServicios));
  const resultadosProvTransporte = filProveedoresTransporte.filter((e:any) => (e.nombre || '').toLowerCase().includes(sProvTransp));
  
  const resultadosUnidad = unidades?.filter((u:any) => {
    const texto = (u.unidad || '').toLowerCase();
    return texto.includes(sUnidad);
  }) || [];
  
  const resultadosOperador = listaEmpleadosLocal.filter((o:any) => {
    const nombreCompleto = `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim().toLowerCase();
    return nombreCompleto.includes(sOperador);
  });

  const resultadosUnidadProveedor = listaUniProvLocal.filter((u:any) => {
    const stringUnidad = String(u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || '');
    return stringUnidad.toLowerCase().includes(sUnidadProv);
  });

  const resultadosOperadorProveedor = listaOpeProvLocal.filter((o:any) => {
    const nombreOp = String(o.nombre || o.nombres || o.nombreCompleto || '');
    return nombreOp.toLowerCase().includes(sOperadorProv);
  });

  const tipoOpTextNormalizado = (tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '').toLowerCase();
  const isTransfer = tipoOpTextNormalizado.includes('transfer');
  const isLogistica = tipoOpTextNormalizado.includes('logistica') || tipoOpTextNormalizado.includes('logística');
  const isFletes = tipoOpTextNormalizado.includes('fletes') || tipoOpTextNormalizado.includes('flete');
  const isRoelca = searchProvTransporte.toLowerCase().includes('roelca');

  const showInternalFleet = isTransfer || ((isLogistica || isFletes) && isRoelca);
  const showExternalFleet = (isLogistica || isFletes) && !isRoelca;

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
        clientePaga: resolvedClientePaga,
        origen: resolvedOrigen,
        destino: resolvedDestino,
        numeroRemolque: resolvedRemolque,
        clienteMercancia: resolvedClienteMercancia,
        provServicios: resolvedProvServicios,
        proveedorUnidad: resolvedProvTransporte,
        unidad: resolvedUnidad,
        operador: resolvedOperador,
        unidadProveedor: resolvedUnidadProv,
        operadorProveedor: resolvedOperadorProv,

        convenioNombre: detalleDoc?.descripcion || formData.convenioNombre || 'Sin descripción', 
        status: statusCalculado || 'Pendiente', 
        statusNombre: statusObj?.descripcion || statusObj?.nombre || statusCalculado || 'Pendiente',
        tienePdfDoda: !!pdfDoda, 
        cantPdfsEntrys: (pdfsEntrys || []).filter(Boolean).length,
        
        clienteNombre: searchClientePaga || '',
        origenNombre: searchOrigen || '',
        destinoNombre: searchDestino || '',
        remolqueNombre: searchRemolque || '',
        clienteMercanciaNombre: searchClienteMercancia || '',
        provServiciosNombre: searchProvServicios || '',
        proveedorUnidadNombre: searchProvTransporte || '',
        unidadNombre: searchUnidad || '',
        operadorNombre: searchOperador || '',
        tipoOperacionNombre: tipoOpObj?.tipo_operacion || '',
        monedaCobroNombre: monedaCobroObj?.moneda || '',
        monedaUnidadNombre: monedaUnidadObj?.moneda || '',
        convenioProveedorNombre: convProvObj?.tipoConvenioNombre || ''
      };

      Object.keys(operacionData).forEach(key => {
        if (operacionData[key] === undefined) {
          delete operacionData[key];
        }
      });
      
      if (initialData) {
        await updateDoc(doc(db, 'operaciones', String(initialData.id)), operacionData);
        alert(`Operación actualizada correctamente.`);
        if (onSave) onSave({ id: initialData.id, ...operacionData });
      } else {
        const resultado = await guardarOperacionSegura(operacionData);
        alert('Operación guardada exitosamente');
        if (onSave) {
          // ✅ Usar el id real devuelto por el servicio (no Date.now())
          const nuevoId = (typeof resultado === 'object' && resultado?.id) ? resultado.id : Date.now().toString();
          onSave({ id: nuevoId, ...operacionData });
        }
      }
      onClose();
    } catch (error: any) {
      // ✅ Mostrar el mensaje real del error (importante para ver el de cuota agotada)
      console.error('Error al guardar operación:', error);
      const msg = error?.message || 'Error al guardar';
      alert(msg);
    } finally { 
      setCargando(false); 
    }
  };

  // ============================================================
  // ✅ Helpers para construir el sidebar de resumen
  // ============================================================
  const tipoOpNombreResumen = tiposOperacion?.find((op: any) => op.id === formData.tipoOperacionId)?.tipo_operacion || '';
  const convenioNombreResumen = listaConveniosCliente.find((c: any) => c.id === formData.convenio)?.descripcion || '';
  const tcResumen = formData.tipoCambioAprobado || tipoCambioDia;

  const fmtMoney = (n: number) => `$${(Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtFecha = (f: string) => {
    if (!f) return '';
    try {
      const d = new Date(f);
      return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch { return f; }
  };

  if (!catalogosCacheados || !catalogosCacheados.empresas) return <div className={`modal-overlay`}><div className="form-card" style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando catálogos de Roelca...</div></div>;

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <style>{`
        /* ========== SHELL DEL MODAL ========== */
        .roelca-form-shell {
          width: 95vw;
          max-width: 1440px;
          height: 92vh;
          background-color: #0a0d14;
          border-radius: 14px;
          display: flex;
          overflow: hidden;
          box-shadow: 0 30px 60px -15px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04);
          border: 1px solid #1f2733;
        }
        .roelca-form-left {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-width: 0;
          overflow: hidden;
          background-color: #0a0d14;
        }
        .roelca-form-right {
          width: 380px;
          background-color: #0d1117;
          border-left: 1px solid #1f2733;
          display: flex;
          flex-direction: column;
          flex-shrink: 0;
        }

        /* ========== HEADER ========== */
        .roelca-form-header {
          padding: 22px 28px;
          border-bottom: 1px solid #1f2733;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          flex-shrink: 0;
          background-color: #0d1117;
        }
        .roelca-form-header h2 {
          margin: 0;
          font-size: 1.35rem;
          font-weight: 700;
          color: #f0f6fc;
          letter-spacing: -0.2px;
        }
        .roelca-form-header p {
          margin: 4px 0 0 0;
          font-size: 0.82rem;
          color: #7d8590;
          font-weight: 400;
        }
        .roelca-window-btn {
          background: transparent;
          border: 1px solid #2d333b;
          color: #8b949e;
          width: 34px;
          height: 34px;
          border-radius: 8px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.15s ease;
        }
        .roelca-window-btn:hover { background-color: #1f2733; color: #c9d1d9; border-color: #3d444d; }
        .roelca-window-btn.danger:hover { color: #f85149; border-color: rgba(248,81,73,0.4); background-color: rgba(248,81,73,0.08); }

        /* ========== TABS ========== */
        .roelca-tabs {
          display: flex;
          gap: 2px;
          padding: 0 28px;
          border-bottom: 1px solid #1f2733;
          background-color: #0d1117;
          flex-shrink: 0;
          overflow-x: auto;
          white-space: nowrap;
        }
        .roelca-tabs::-webkit-scrollbar { height: 0; }
        .roelca-tab {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 18px;
          background: transparent;
          border: none;
          border-bottom: 2px solid transparent;
          color: #7d8590;
          font-weight: 500;
          font-size: 0.875rem;
          cursor: pointer;
          transition: all 0.15s ease;
          margin-bottom: -1px;
          letter-spacing: 0.1px;
        }
        .roelca-tab:hover { color: #c9d1d9; }
        .roelca-tab.active {
          color: #fb923c;
          border-bottom-color: #fb923c;
          font-weight: 600;
        }

        /* ========== SCROLL Y CARDS ========== */
        .roelca-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 24px 28px;
          background-color: #0a0d14;
        }
        .roelca-scroll::-webkit-scrollbar { width: 8px; }
        .roelca-scroll::-webkit-scrollbar-track { background: transparent; }
        .roelca-scroll::-webkit-scrollbar-thumb { background: #21262d; border-radius: 4px; }
        .roelca-scroll::-webkit-scrollbar-thumb:hover { background: #2d333b; }

        .roelca-card {
          background-color: #0d1117;
          border: 1px solid #1f2733;
          border-radius: 12px;
          padding: 22px 24px;
          margin-bottom: 16px;
          transition: border-color 0.2s ease;
        }
        .roelca-card:hover { border-color: #2d333b; }
        .roelca-card-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 0 0 20px 0;
          padding-bottom: 14px;
          border-bottom: 1px solid #1f2733;
        }
        .roelca-card-icon {
          width: 36px;
          height: 36px;
          border-radius: 9px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background-color: rgba(251, 146, 60, 0.08);
          color: #fb923c;
          border: 1px solid rgba(251, 146, 60, 0.18);
        }
        .roelca-card-title {
          margin: 0;
          font-size: 0.95rem;
          font-weight: 600;
          color: #e6edf3;
          letter-spacing: 0.1px;
        }
        .roelca-card-subtitle {
          margin: 2px 0 0 0;
          font-size: 0.78rem;
          color: #7d8590;
          font-weight: 400;
        }

        /* ========== SIDEBAR ========== */
        .roelca-sidebar-section {
          padding: 16px 18px;
          background-color: #161b22;
          border: 1px solid #1f2733;
          border-radius: 10px;
          margin-bottom: 12px;
          transition: border-color 0.2s ease;
        }
        .roelca-sidebar-section:hover { border-color: #2d333b; }
        .roelca-sidebar-label {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
          font-size: 0.68rem;
          color: #7d8590;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
        }
        .roelca-sidebar-icon {
          width: 26px;
          height: 26px;
          border-radius: 7px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background-color: rgba(251, 146, 60, 0.08);
          color: #fb923c;
          border: 1px solid rgba(251, 146, 60, 0.15);
        }
        .roelca-sidebar-value {
          color: #e6edf3;
          font-weight: 600;
          font-size: 0.92rem;
          word-break: break-word;
          line-height: 1.35;
        }
        .roelca-sidebar-muted {
          color: #6e7681;
          font-size: 0.85rem;
          font-style: normal;
          font-weight: 400;
        }
        .roelca-sidebar-secondary {
          color: #8b949e;
          font-size: 0.8rem;
          margin-top: 5px;
          font-weight: 400;
        }
        .roelca-route-line {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #8b949e;
          font-size: 0.8rem;
          margin-top: 8px;
        }
        .roelca-chip {
          display: inline-flex;
          align-items: center;
          padding: 3px 9px;
          background-color: #1f2733;
          border: 1px solid #2d333b;
          border-radius: 12px;
          font-size: 0.7rem;
          color: #c9d1d9;
          font-weight: 500;
          letter-spacing: 0.2px;
        }

        .roelca-money-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 0.85rem;
        }
        .roelca-money-row .lbl { color: #8b949e; font-weight: 400; }
        .roelca-money-row .val { color: #e6edf3; font-weight: 600; }

        .roelca-utility-box {
          margin-top: 10px;
          padding: 16px 18px;
          background: linear-gradient(135deg, rgba(63, 185, 80, 0.08), rgba(63, 185, 80, 0.02));
          border: 1px solid rgba(63, 185, 80, 0.3);
          border-radius: 10px;
        }
        .roelca-utility-box.negative {
          background: linear-gradient(135deg, rgba(248, 81, 73, 0.08), rgba(248, 81, 73, 0.02));
          border-color: rgba(248, 81, 73, 0.3);
        }
        .roelca-utility-label {
          font-size: 0.68rem;
          color: #7d8590;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          margin-bottom: 6px;
        }
        .roelca-utility-value {
          font-size: 1.75rem;
          font-weight: 700;
          line-height: 1.1;
          color: #3fb950;
          letter-spacing: -0.5px;
          font-variant-numeric: tabular-nums;
        }
        .roelca-utility-box.negative .roelca-utility-value { color: #f85149; }

        /* ========== FOOTER ========== */
        .roelca-form-footer {
          padding: 20px;
          border-top: 1px solid #1f2733;
          background-color: #0d1117;
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex-shrink: 0;
        }
        .roelca-btn-primary {
          width: 100%;
          padding: 13px 18px;
          background: linear-gradient(180deg, #ea580c, #c2410c);
          color: white;
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 9px;
          font-size: 0.92rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          letter-spacing: 0.2px;
          box-shadow: 0 2px 4px rgba(234, 88, 12, 0.15), 0 4px 12px rgba(0,0,0,0.2);
        }
        .roelca-btn-primary:hover:not(:disabled) {
          background: linear-gradient(180deg, #f97316, #ea580c);
          transform: translateY(-1px);
          box-shadow: 0 4px 8px rgba(234, 88, 12, 0.25), 0 8px 20px rgba(0,0,0,0.25);
        }
        .roelca-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .roelca-btn-outline {
          width: 100%;
          padding: 13px 18px;
          background: transparent;
          color: #c9d1d9;
          border: 1px solid #2d333b;
          border-radius: 9px;
          font-size: 0.88rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }
        .roelca-btn-outline:hover { background-color: #1f2733; border-color: #3d444d; }

        /* ========== BADGES DE STATUS ========== */
        .status-badge-ok {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 11px;
          border-radius: 20px;
          background-color: rgba(63, 185, 80, 0.1);
          color: #3fb950;
          font-size: 0.68rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          border: 1px solid rgba(63, 185, 80, 0.25);
        }
        .status-badge-error {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 11px;
          border-radius: 20px;
          background-color: rgba(248, 81, 73, 0.1);
          color: #f85149;
          font-size: 0.68rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          border: 1px solid rgba(248, 81, 73, 0.25);
        }
        .status-preview-card {
          padding: 14px 16px;
          background: linear-gradient(135deg, rgba(63, 185, 80, 0.06), rgba(63, 185, 80, 0.02));
          border: 1px solid rgba(63, 185, 80, 0.25);
          border-radius: 10px;
          margin-bottom: 14px;
        }
        .status-error-card {
          padding: 14px 16px;
          background: linear-gradient(135deg, rgba(248, 81, 73, 0.06), rgba(248, 81, 73, 0.02));
          border: 1px solid rgba(248, 81, 73, 0.25);
          border-radius: 10px;
          margin-bottom: 14px;
        }

        /* ========== RESPONSIVE ========== */
        @media (max-width: 1024px) {
          .roelca-form-shell { flex-direction: column; height: 95vh; }
          .roelca-form-right { width: 100%; border-left: none; border-top: 1px solid #1f2733; max-height: 45vh; }
        }
      `}</style>

      <div className="roelca-form-shell" style={{ display: estado === 'minimizado' ? 'none' : 'flex' }}>

        {/* ============================================================ */}
        {/* LADO IZQUIERDO: FORMULARIO CON PESTAÑAS Y CARDS              */}
        {/* ============================================================ */}
        <div className="roelca-form-left">

          {/* HEADER */}
          <div className="roelca-form-header">
            <div>
              <h2>
                {initialData ? `Editar Operación ${initialData.ref || initialData.id?.substring(0,6)}` : 'Nueva Operación'}
              </h2>
              <p>
                {initialData ? 'Modifica los datos y guarda los cambios' : 'Completa el formulario para registrar una nueva operación'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" onClick={onMinimize} className="roelca-window-btn" title="Minimizar">
                <IconMinimize size={16} />
              </button>
              <button type="button" onClick={onClose} className="roelca-window-btn danger" title="Cerrar">
                <IconX size={16} />
              </button>
            </div>
          </div>

          {/* TABS */}
          <div className="roelca-tabs">
            <button type="button" className={`roelca-tab ${pestañaActiva === 'general' ? 'active' : ''}`} onClick={() => setPestañaActiva('general')}>
              <IconBriefcase size={15} /> Información General
            </button>
            <button type="button" className={`roelca-tab ${pestañaActiva === 'pedimento' ? 'active' : ''}`} onClick={() => setPestañaActiva('pedimento')}>
              <IconFileText size={15} /> Pedimento y CT
            </button>
            <button type="button" className={`roelca-tab ${pestañaActiva === 'manifiesto' ? 'active' : ''}`} onClick={() => setPestañaActiva('manifiesto')}>
              <IconClipboard size={15} /> Entry's y Manifiestos
            </button>
            <button type="button" className={`roelca-tab ${pestañaActiva === 'unidad' ? 'active' : ''}`} onClick={() => setPestañaActiva('unidad')}>
              <IconTruck size={15} /> Unidad y Operador
            </button>
            <button type="button" className={`roelca-tab ${pestañaActiva === 'cobrar' ? 'active' : ''}`} onClick={() => setPestañaActiva('cobrar')}>
              <IconDollar size={15} /> Por Cobrar
            </button>
          </div>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <div className="roelca-scroll">

              {/* ============ PESTAÑA: GENERAL ============ */}
              {pestañaActiva === 'general' && (
                <>
                  {/* CARD 1: Tipo y Fechas */}
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconBriefcase /></div>
                      <h3 className="roelca-card-title">Tipo de Servicio y Fechas</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label orange">Tipo de Operación</label><select name="tipoOperacionId" className="form-control" value={formData.tipoOperacionId || ''} onChange={handleChange} required><option value="">-- Seleccionar --</option>{tiposOperacion?.map((op:any) => <option key={op.id} value={op.id}>{op.tipo_operacion}</option>)}</select></div>
                      <div className="form-group"><label className="form-label orange">Fecha de Servicio</label><input type="date" name="fechaServicio" className="form-control" value={formData.fechaServicio || ''} onChange={handleChange} required />{buscandoTC ? <small style={{ color: '#58a6ff' }}>Buscando TC...</small> : <small style={{ color: (formData.tipoCambioAprobado || tipoCambioDia) ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>TC Oficial: {(formData.tipoCambioAprobado || tipoCambioDia) ? `$${(formData.tipoCambioAprobado || tipoCambioDia)}` : 'Sin Registro'}</small>}</div>
                      {isFletes && (
                        <div className="form-group">
                          <label className="form-label orange">Fecha de Cita</label>
                          <input type="datetime-local" name="fechaCita" className="form-control" value={formData.fechaCita || ''} onChange={handleChange} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* CARD 2: Cliente y Convenio */}
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconUsers /></div>
                      <h3 className="roelca-card-title">Cliente y Convenio</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group" style={{ position: 'relative' }}>
                        <label className="form-label">Cliente (Paga)</label>
                        <input type="text" className="form-control" placeholder="Escriba para buscar cliente..." required={!formData.clientePaga && !searchClientePaga} value={searchClientePaga} 
                        onChange={e => { setSearchClientePaga(e.target.value); setShowDropdownClientePaga(true); if (formData.clientePaga) setFormData(prev => ({ ...prev, clientePaga: '', convenio: '' })); }} 
                        onFocus={() => setShowDropdownClientePaga(true)} />
                        {showDropdownClientePaga && searchClientePaga && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                            {resultadosClientePaga.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosClientePaga.map((c:any) => (
                              <div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                              onMouseDown={(e) => { 
                                e.preventDefault();
                                const monedaDefault = c.monedaId || c.moneda || '';
                                setFormData(prev => ({ ...prev, clientePaga: c.id, convenio: '', facturadoEnCobrar: monedaDefault })); 
                                setSearchClientePaga(c.nombre); setShowDropdownClientePaga(false); 
                              }}>
                                <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="form-group"><label className="form-label">Convenio (Tarifa)</label><select name="convenio" className="form-control" value={formData.convenio || ''} onChange={handleChange} required disabled={listaConveniosCliente.length === 0}><option value="">-- Seleccione un Convenio --</option>{listaConveniosCliente.map((c:any) => (<option key={c.id} value={c.id}>{c.descripcion}</option>))}</select>{listaConveniosCliente.length === 0 && searchClientePaga && <small style={{ color: '#8b949e' }}>Este cliente no tiene convenios asignados</small>}</div>
                      <div className="form-group" style={{ position: 'relative' }}>
                        <label className="form-label"># de Remolque</label>
                        <input type="text" className="form-control" placeholder="Buscar remolque..." value={searchRemolque} onChange={e => { setSearchRemolque(e.target.value); setShowDropdownRemolque(true); if (formData.numeroRemolque) setFormData(prev => ({ ...prev, numeroRemolque: '' })); }} onFocus={() => setShowDropdownRemolque(true)} onBlur={() => setTimeout(() => setShowDropdownRemolque(false), 200)} />
                        {showDropdownRemolque && searchRemolque && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosRemolque.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosRemolque.map((r:any) => (<div key={r.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, numeroRemolque: r.id })); setSearchRemolque(`${r.nombre || ''} ${r.placas || r.placa || ''}`.trim()); setShowDropdownRemolque(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{`${r.nombre || ''} ${r.placas || r.placa || ''}`.trim()}</div></div>))}</div>)}
                      </div>
                      <div className="form-group"><label className="form-label">Ref Cliente</label><input type="text" name="refCliente" className="form-control" value={formData.refCliente || ''} onChange={handleChange} /></div>
                    </div>
                  </div>

                  {/* CARD 3: Ruta */}
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconRoute /></div>
                      <h3 className="roelca-card-title">Ruta y Observaciones</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group" style={{ position: 'relative' }}><label className="form-label orange">Origen</label><input type="text" className="form-control" placeholder="Buscar origen..." value={searchOrigen} onChange={e => { setSearchOrigen(e.target.value); setShowDropdownOrigen(true); }} onFocus={() => setShowDropdownOrigen(true)} onBlur={() => setTimeout(() => setShowDropdownOrigen(false), 200)} />{showDropdownOrigen && searchOrigen && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosOrigen.map((o:any) => (<div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, origen: o.id })); setSearchOrigen(o.nombre); setShowDropdownOrigen(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{o.nombre}</div><div style={{ fontSize: '0.8rem', color: '#8b949e' }}>{o.direccion}</div></div>))}</div>)}</div>
                      <div className="form-group" style={{ position: 'relative' }}><label className="form-label orange">Destino</label><input type="text" className="form-control" placeholder="Buscar destino..." value={searchDestino} onChange={e => { setSearchDestino(e.target.value); setShowDropdownDestino(true); }} onFocus={() => setShowDropdownDestino(true)} onBlur={() => setTimeout(() => setShowDropdownDestino(false), 200)} />{showDropdownDestino && searchDestino && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosDestino.map((d:any) => (<div key={d.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, destino: d.id })); setSearchDestino(d.nombre); setShowDropdownDestino(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{d.nombre}</div><div style={{ fontSize: '0.8rem', color: '#8b949e' }}>{d.direccion}</div></div>))}</div>)}</div>
                      <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Observaciones Ejecutivo</label><input type="text" name="observacionesEjecutivo" className="form-control" value={formData.observacionesEjecutivo || ''} onChange={handleChange} /></div>
                    </div>
                  </div>
                </>
              )}

              {/* ============ PESTAÑA: PEDIMENTO ============ */}
              {pestañaActiva === 'pedimento' && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconPackage /></div>
                      <h3 className="roelca-card-title">Cliente y Mercancía</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group" style={{ position: 'relative', gridColumn: 'span 2' }}><label className="form-label">Cliente (Mercancía)</label><input type="text" className="form-control" placeholder="Escriba para buscar cliente mercancía..." value={searchClienteMercancia} onChange={e => { setSearchClienteMercancia(e.target.value); setShowDropdownClienteMercancia(true); if (formData.clienteMercancia) setFormData(prev => ({ ...prev, clienteMercancia: '' })); }} onFocus={() => setShowDropdownClienteMercancia(true)} onBlur={() => setTimeout(() => setShowDropdownClienteMercancia(false), 200)} />{showDropdownClienteMercancia && searchClienteMercancia && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosClienteMercancia.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosClienteMercancia.map((c:any) => (<div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, clienteMercancia: c.id })); setSearchClienteMercancia(c.nombre); setShowDropdownClienteMercancia(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div></div>))}</div>)}</div>
                      <div className="form-group"><label className="form-label">Descripción de la Mercancía</label><input type="text" name="descripcionMercancia" className="form-control" value={formData.descripcionMercancia || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Cantidad (Enteros)</label><input type="number" step="1" name="cantidad" className="form-control" value={formData.cantidad || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Embalaje</label><select name="embalaje" className="form-control" value={formData.embalaje || ''} onChange={handleChange}><option value="">-- Seleccionar --</option>{embalajes?.map((e:any) => <option key={e.id} value={e.id}>{e.clave || e.nombre}</option>)}</select></div>
                      <div className="form-group"><label className="form-label">Peso (Kg) Decimales</label><input type="number" step="0.01" name="pesoKg" className="form-control" value={formData.pesoKg || ''} onChange={handleChange} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconFileText /></div>
                      <h3 className="roelca-card-title">Documentación (CT y DODA)</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">PDF - Carta Porte</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, 'pdfCartaPorte')} /></div>
                      <div className="form-group"><label className="form-label"># DODA</label><input type="text" name="numDoda" className="form-control" value={formData.numDoda || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Fecha de Emisión DODA</label><input type="date" name="fechaEmisionDoda" className="form-control" value={formData.fechaEmisionDoda || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">PDF - DODA</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, 'pdfDoda')} /></div>
                    </div>
                  </div>
                </>
              )}

              {/* ============ PESTAÑA: MANIFIESTO ============ */}
              {pestañaActiva === 'manifiesto' && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconClipboard /></div>
                      <h3 className="roelca-card-title">Entry's</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label"># de Entry's</label>
                        <input type="text" name="numeroEntrys" className="form-control" value={formData.numeroEntrys || ''} onChange={handleChange} />
                      </div>
                      <div className="form-group"><label className="form-label">Cantidad de Entry's (Max 10)</label><input type="number" max="10" min="0" name="cantEntrys" className="form-control" value={formData.cantEntrys || 0} onChange={(e) => { const val = Math.min(10, Math.max(0, parseInt(e.target.value) || 0)); setFormData(prev => ({ ...prev, cantEntrys: val, pdfsEntrys: new Array(val).fill(null) })); }} /></div>
                      {Array.from({ length: Number(formData.cantEntrys) || 0 }).map((_, i) => (<div className="form-group" key={i}><label className="form-label">PDF Entry #{i + 1}</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, '', i)} /></div>))}
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconReceipt /></div>
                      <h3 className="roelca-card-title">Manifiesto</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label"># Manifiesto</label><input type="text" name="numManifiesto" className="form-control" value={formData.numManifiesto || ''} onChange={handleChange} /></div>
                      <div className="form-group" style={{ position: 'relative' }}><label className="form-label">Proveedor de Servicios</label><input type="text" className="form-control" placeholder="Escriba para buscar proveedor..." value={searchProvServicios} onChange={e => { setSearchProvServicios(e.target.value); setShowDropdownProvServicios(true); if (formData.provServicios) setFormData(prev => ({ ...prev, provServicios: '' })); }} onFocus={() => setShowDropdownProvServicios(true)} onBlur={() => setTimeout(() => setShowDropdownProvServicios(false), 200)} />{showDropdownProvServicios && searchProvServicios && (<div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>{resultadosProvServicios.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosProvServicios.map((c:any) => (<div key={c.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, provServicios: c.id })); setSearchProvServicios(c.nombre); setShowDropdownProvServicios(false); }}><div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{c.nombre}</div></div>))}</div>)}</div>
                      <div className="form-group"><label className="form-label">Costo Manifiesto ($)</label><input type="number" step="0.01" name="montoManifiesto" className="form-control" value={formData.montoManifiesto || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">PDF Manifiesto</label><input type="file" accept=".pdf" className="form-control" onChange={(e) => handleFileChange(e, 'pdfManifiesto')} /></div>
                    </div>
                  </div>
                </>
              )}

              {/* ============ PESTAÑA: UNIDAD ============ */}
              {pestañaActiva === 'unidad' && (
                <>
                  {/* CARD 1: Proveedor de Transporte */}
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconTruck /></div>
                      <h3 className="roelca-card-title">Proveedor de Transporte</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group" style={{ position: 'relative', gridColumn: '1 / -1' }}>
                        <label className="form-label">Proveedor de Transporte</label>
                        <input type="text" className="form-control" placeholder="Escriba para buscar proveedor de transporte..." value={searchProvTransporte} 
                        onChange={e => { setSearchProvTransporte(e.target.value); setShowDropdownProvTransporte(true); if (formData.proveedorUnidad) setFormData(prev => ({ ...prev, proveedorUnidad: '', convenioProveedor: '' })); }} 
                        onFocus={() => setShowDropdownProvTransporte(true)} onBlur={() => setTimeout(() => setShowDropdownProvTransporte(false), 200)} />
                        {showDropdownProvTransporte && searchProvTransporte && (
                          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                            {resultadosProvTransporte.length === 0 ? <div style={{ padding: '8px', color: '#8b949e' }}>Sin resultados</div> : resultadosProvTransporte.map((p:any) => (
                              <div key={p.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                              onMouseDown={(e) => { 
                                e.preventDefault();
                                const monedaDefault = p.monedaId || p.moneda || '';
                                setFormData(prev => ({ ...prev, proveedorUnidad: p.id, convenioProveedor: '', facturadoEnUnidad: monedaDefault })); 
                                setSearchProvTransporte(p.nombre); setShowDropdownProvTransporte(false); 
                              }}>
                                <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{p.nombre}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="form-group">
                        <label className="form-label">Facturado En:</label>
                        <select name="facturadoEnUnidad" className="form-control" value={formData.facturadoEnUnidad || ''} onChange={handleChange}>
                          <option value="">-- Seleccionar --</option>
                          {listaMonedasLocal.map((m: any) => <option key={m.id} value={m.id}>{m.moneda}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Convenio Proveedor</label>
                        <select 
                          name="convenioProveedor" 
                          className="form-control" 
                          value={formData.convenioProveedor || ''} 
                          onChange={e => { 
                            const val = e.target.value; 
                            const conv = listaConveniosProveedor.find((c: any) => String(c.id) === val); 
                            setFormData(prev => ({ 
                              ...prev, 
                              convenioProveedor: val, 
                              monedaConvenioProv: conv ? conv.monedaBase : '',
                              totalAPagarProv: conv ? conv.tarifaMonto : 0 
                            })); 
                          }}
                          disabled={listaConveniosProveedor.length === 0}
                        >
                          <option value="">-- Seleccionar --</option>
                          {listaConveniosProveedor.map((c:any) => <option key={c.id} value={c.id}>{c.tipoConvenioNombre}</option>)}
                        </select>
                        {listaConveniosProveedor.length === 0 && searchProvTransporte && <small style={{ color: '#8b949e' }}>Este proveedor no tiene convenios registrados</small>}
                      </div>
                      <div className="form-group"><label className="form-label">Moneda del Convenio (Base)</label><input type="text" className="form-control" readOnly value={listaMonedasLocal.find((m: any) => m.id === formData.monedaConvenioProv)?.moneda || 'Sin Asignar'} /></div>
                    </div>
                  </div>

                  {/* CARD 2: Cálculo de Pago al Proveedor */}
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconDollar /></div>
                      <h3 className="roelca-card-title">Pago al Proveedor</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">Monto a Pagar (Base)</label><input type="number" name="totalAPagarProv" className="form-control" value={formData.totalAPagarProv || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label">Costos Adicionales</label><input type="number" name="cargosAdicionalesProv" className="form-control" value={formData.cargosAdicionalesProv || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label orange">Subtotal (Convenio + Costos)</label><div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>${(Number(formData.subtotalProv) || 0).toFixed(2)}</div></div>
                      <div className="form-group"><label className="form-label">Tipo de Cambio del Día</label><input type="text" className="form-control" readOnly value={formData.tipoCambioAprobado || tipoCambioDia || 'No encontrado'} /></div>
                      <div className="form-group"><label className="form-label">Dólares</label><div style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.dolaresProv) || 0).toFixed(2)}</div></div>
                      <div className="form-group"><label className="form-label">Pesos</label><div style={{ color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.pesosProv) || 0).toFixed(2)}</div></div>
                      <div className="form-group" style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                        <label className="form-label orange">Conversión Final (Contabilidad)</label>
                        <div style={{ color: '#f85149', fontSize: '1.4rem', fontWeight: 'bold', padding: '10px 14px', backgroundColor: 'rgba(248, 81, 73, 0.08)', borderRadius: '8px', border: '1px solid rgba(248, 81, 73, 0.3)', textAlign: 'center' }}>${(Number(formData.conversionProv) || 0).toFixed(2)}</div>
                      </div>
                    </div>
                  </div>

                  {/* CARD 3: Flota Interna (condicional) */}
                  {showInternalFleet && (
                    <div className="roelca-card">
                      <div className="roelca-card-header">
                        <div className="roelca-card-icon"><IconUser /></div>
                        <h3 className="roelca-card-title">Unidad y Operador (Flota Interna)</h3>
                      </div>
                      <div className="form-grid">
                        <div className="form-group" style={{ position: 'relative' }}>
                          <label className="form-label">Unidad</label>
                          <input type="text" className="form-control" placeholder="Buscar unidad..." value={searchUnidad} onChange={e => { setSearchUnidad(e.target.value); setShowDropdownUnidad(true); if (formData.unidad) setFormData(prev => ({ ...prev, unidad: '' })); }} onFocus={() => setShowDropdownUnidad(true)} onBlur={() => setTimeout(() => setShowDropdownUnidad(false), 200)} />
                          {showDropdownUnidad && searchUnidad && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                              {resultadosUnidad.map((u:any) => (
                                <div key={u.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} onMouseDown={(e) => { e.preventDefault(); setFormData(prev => ({ ...prev, unidad: u.id })); setSearchUnidad(u.unidad || u.nombre); setShowDropdownUnidad(false); }}>
                                  <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{u.unidad || u.nombre}</div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="form-group" style={{ position: 'relative' }}>
                          <label className="form-label">Operador</label>
                          <input type="text" className="form-control" placeholder="Buscar operador..." value={searchOperador} 
                          onChange={e => { setSearchOperador(e.target.value); setShowDropdownOperador(true); if (formData.operador) setFormData(prev => ({ ...prev, operador: '' })); }} 
                          onFocus={() => setShowDropdownOperador(true)} onBlur={() => setTimeout(() => setShowDropdownOperador(false), 200)} />
                          {showDropdownOperador && searchOperador && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                              {resultadosOperador.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>Sin resultados</div> : resultadosOperador.map((o:any) => {
                                const nombreCompleto = `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim();
                                return (
                                  <div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                                  onMouseDown={(e) => { 
                                    e.preventDefault();
                                    setFormData(prev => ({ ...prev, operador: o.id })); 
                                    setSearchOperador(nombreCompleto); 
                                    setShowDropdownOperador(false); 
                                  }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{nombreCompleto}</div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="form-group">
                          <label className="form-label">Sueldo del Operador</label>
                          <input type="number" step="0.01" name="sueldoOperador" className="form-control" value={formData.sueldoOperador || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Sueldo Extra</label>
                          <input type="number" step="0.01" name="sueldoExtra" className="form-control" value={formData.sueldoExtra || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                          <label className="form-label orange">Sueldo Total</label>
                          <div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>
                            ${(Number(formData.sueldoTotal) || 0).toFixed(2)}
                          </div>
                        </div>
                        <div className="form-group" style={{ gridColumn: '1 / -1' }}><hr style={{ borderColor: '#30363d', margin: '4px 0' }} /></div>
                        <div className="form-group">
                          <label className="form-label">Combustible</label>
                          <input type="number" step="0.01" name="combustible" className="form-control" value={formData.combustible || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                          <label className="form-label">Combustible Extra</label>
                          <input type="number" step="0.01" name="combustibleExtra" className="form-control" value={formData.combustibleExtra || ''} onChange={handleChange} />
                        </div>
                        <div className="form-group">
                          <label className="form-label orange">Total Combustible</label>
                          <div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>
                            ${(Number(formData.combustibleTotal) || 0).toFixed(2)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CARD 4: Flota Externa (condicional) */}
                  {showExternalFleet && (
                    <div className="roelca-card">
                      <div className="roelca-card-header">
                        <div className="roelca-card-icon"><IconUsers /></div>
                        <h3 className="roelca-card-title">Unidad y Operador (Flota Externa)</h3>
                      </div>
                      <div className="form-grid">
                        <div className="form-group" style={{ position: 'relative' }}>
                          <label className="form-label" style={{ color: '#58a6ff' }}>Unidad del Proveedor</label>
                          <input type="text" className="form-control" style={{ border: '1px solid #58a6ff' }} placeholder="Buscar unidad externa..."
                            value={searchUnidadProveedor}
                            onChange={e => { 
                                setSearchUnidadProveedor(e.target.value); 
                                setShowDropdownUnidadProveedor(true); 
                                setFormData(prev => ({ ...prev, unidadProveedor: e.target.value })); 
                            }}
                            onFocus={() => setShowDropdownUnidadProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownUnidadProveedor(false), 200)} />
                          {showDropdownUnidadProveedor && searchUnidadProveedor && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                              {resultadosUnidadProveedor.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem' }}>Sin resultados (Se guardará como texto)</div> : resultadosUnidadProveedor.map((u:any) => {
                                const valorUnidad = u.numeroUnidad || u.numero_unidad || u.unidad || u.placas || u.placa || 'Sin Número';
                                return (
                                  <div key={u.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                                  onMouseDown={(e) => { 
                                      e.preventDefault();
                                      setFormData(prev => ({ ...prev, unidadProveedor: u.id })); 
                                      setSearchUnidadProveedor(valorUnidad); 
                                      setShowDropdownUnidadProveedor(false); 
                                  }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{valorUnidad}</div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                        <div className="form-group" style={{ position: 'relative', gridColumn: 'span 2' }}>
                          <label className="form-label" style={{ color: '#58a6ff' }}>Operador del Proveedor</label>
                          <input type="text" className="form-control" style={{ border: '1px solid #58a6ff' }} placeholder="Buscar operador externo..."
                            value={searchOperadorProveedor}
                            onChange={e => { 
                                setSearchOperadorProveedor(e.target.value); 
                                setShowDropdownOperadorProveedor(true); 
                                setFormData(prev => ({ ...prev, operadorProveedor: e.target.value })); 
                            }}
                            onFocus={() => setShowDropdownOperadorProveedor(true)} onBlur={() => setTimeout(() => setShowDropdownOperadorProveedor(false), 200)} />
                          {showDropdownOperadorProveedor && searchOperadorProveedor && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', zIndex: 10, maxHeight: '200px', overflowY: 'auto' }}>
                              {resultadosOperadorProveedor.length === 0 ? <div style={{ padding: '8px', color: '#8b949e', fontSize: '0.85rem' }}>Sin resultados (Se guardará como texto)</div> : resultadosOperadorProveedor.map((o:any) => {
                                const valorNombre = o.nombre || o.nombres || o.nombreCompleto || 'Sin Nombre';
                                return (
                                  <div key={o.id} style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid #21262d' }} 
                                  onMouseDown={(e) => { 
                                      e.preventDefault();
                                      setFormData(prev => ({ ...prev, operadorProveedor: o.id })); 
                                      setSearchOperadorProveedor(valorNombre); 
                                      setShowDropdownOperadorProveedor(false); 
                                  }}>
                                    <div style={{ fontWeight: 'bold', color: '#c9d1d9' }}>{valorNombre}</div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* CARD 5: Resumen de gastos y observaciones */}
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconChart /></div>
                      <h3 className="roelca-card-title">Total y Observaciones</h3>
                    </div>
                    <div style={{ backgroundColor: 'rgba(248, 81, 73, 0.08)', border: '1px solid rgba(248, 81, 73, 0.3)', padding: '20px', borderRadius: '8px', textAlign: 'center', marginBottom: '16px' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px', fontWeight: 700 }}>Total Gastos [Sueldos + Manifiesto]</div>
                      <div style={{ color: '#f85149', fontSize: '2rem', fontWeight: 800 }}>${(Number(formData.totalGastos) || 0).toFixed(2)}</div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Observaciones</label>
                      <textarea name="observacionesUnidad" className="form-control" value={formData.observacionesUnidad || ''} onChange={handleChange} placeholder="Notas adicionales sobre la unidad o proveedor..." style={{ minHeight: '80px', resize: 'vertical', width: '100%', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }} />
                    </div>
                  </div>
                </>
              )}

              {/* ============ PESTAÑA: COBRAR ============ */}
              {pestañaActiva === 'cobrar' && (
                <>
                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconDollar /></div>
                      <h3 className="roelca-card-title">Facturación al Cliente</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group">
                        <label className="form-label">Facturado En:</label>
                        <select name="facturadoEnCobrar" className="form-control" value={formData.facturadoEnCobrar || ''} onChange={handleChange}>
                          <option value="">-- Seleccionar Moneda --</option>
                          {listaMonedasLocal.map((m: any) => <option key={m.id} value={m.id}>{m.moneda}</option>)}
                        </select>
                      </div>
                      <div className="form-group"><label className="form-label">Moneda Convenio (Cliente)</label><input type="text" className="form-control" readOnly value={listaMonedasLocal.find((m: any) => m.id === formData.monedaConvenioCliente)?.moneda || 'Sin Asignar'} /></div>
                      <div className="form-group"><label className="form-label">Convenio Seleccionado (Monto Base)</label><input type="number" className="form-control" readOnly value={formData.montoConvenioCliente || 0} /></div>
                      <div className="form-group"><label className="form-label">Cargos Adicionales</label><input type="number" name="cargosAdicionales" className="form-control" value={formData.cargosAdicionales || ''} onChange={handleChange} /></div>
                      <div className="form-group"><label className="form-label orange">Subtotal (Convenio + Cargos)</label><div style={{ color: '#f0f6fc', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 12px', backgroundColor: '#161b22', borderRadius: '6px', border: '1px solid #30363d' }}>${(Number(formData.subtotalCliente) || 0).toFixed(2)}</div></div>
                      <div className="form-group"><label className="form-label">Tipo de Cambio del Día</label><input type="text" className="form-control" readOnly value={formData.tipoCambioAprobado || tipoCambioDia || 'No encontrado'} /></div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconTrendingUp /></div>
                      <h3 className="roelca-card-title">Conversión e Ingreso</h3>
                    </div>
                    <div className="form-grid">
                      <div className="form-group"><label className="form-label">Dólares (Cliente)</label><div style={{ color: '#3fb950', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.dolaresCliente) || 0).toFixed(2)}</div></div>
                      <div className="form-group"><label className="form-label">Pesos (Cliente)</label><div style={{ color: '#58a6ff', fontSize: '1.2rem', fontWeight: 'bold' }}>${(Number(formData.pesosCliente) || 0).toFixed(2)}</div></div>
                      <div className="form-group"><label className="form-label orange">Conversión Final (Ingreso)</label><div style={{ color: '#f85149', fontSize: '1.2rem', fontWeight: 'bold', border: '1px solid #f85149', padding: '4px 8px', borderRadius: '4px' }}>${(Number(formData.conversionCliente) || 0).toFixed(2)}</div></div>
                    </div>

                    <div style={{ backgroundColor: 'rgba(63, 185, 80, 0.08)', border: '1px solid rgba(63, 185, 80, 0.3)', padding: '20px', borderRadius: '8px', textAlign: 'center', marginTop: '20px' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px', fontWeight: 700 }}>UTILIDAD ESTIMADA DE LA OPERACIÓN</div>
                      <div style={{ color: '#3fb950', fontSize: '2rem', fontWeight: 800 }}>${(Number(formData.utilidadEstimada) || 0).toFixed(2)}</div>
                    </div>
                  </div>

                  <div className="roelca-card">
                    <div className="roelca-card-header">
                      <div className="roelca-card-icon"><IconEdit /></div>
                      <h3 className="roelca-card-title">Observaciones de Cobranza</h3>
                    </div>
                    <div className="form-group">
                      <textarea name="observacionesCobrar" className="form-control" value={formData.observacionesCobrar || ''} onChange={handleChange} placeholder="Notas o justificaciones de cobranza..." style={{ minHeight: '100px', resize: 'vertical', width: '100%', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', padding: '10px 14px', borderRadius: '6px' }} />
                    </div>
                  </div>
                </>
              )}

            </div>
          </form>
        </div>

        {/* ============================================================ */}
        {/* LADO DERECHO: SIDEBAR DE RESUMEN                              */}
        {/* ============================================================ */}
        <aside className="roelca-form-right">
          <div style={{ padding: '22px 20px', flex: 1, overflowY: 'auto' }}>

            {/* Título y badge de status */}
            <div style={{ marginBottom: '22px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '6px' }}>
                <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#f0f6fc', letterSpacing: '-0.2px' }}>Resumen Operación</h2>
                {statusError ? (
                  <span className="status-badge-error"><IconAlert size={11} /> Atención</span>
                ) : (
                  <span className="status-badge-ok"><IconCheck size={11} /> Listo</span>
                )}
              </div>
              <p style={{ margin: 0, fontSize: '0.78rem', color: '#7d8590', fontWeight: 400 }}>
                {initialData ? 'Editando registro existente' : 'Vista previa antes de guardar'}
              </p>
            </div>

            {/* Próximo status (preview) */}
            {!statusError && statusPreview && (
              <div className="status-preview-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.66rem', color: '#7ee787', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '6px' }}>
                  <IconArrowRight size={12} /> Próximo Estatus
                </div>
                <div style={{ color: '#e6edf3', fontWeight: 600, fontSize: '0.92rem' }}>{statusPreview}</div>
              </div>
            )}
            {statusError && (
              <div className="status-error-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.66rem', color: '#ff7b72', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '6px' }}>
                  <IconAlert size={12} /> Atención
                </div>
                <div style={{ color: '#ff9b94', fontSize: '0.82rem', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{statusError}</div>
              </div>
            )}

            {/* Cliente + Ruta */}
            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label">
                <span className="roelca-sidebar-icon"><IconUser size={14} /></span>
                Cliente y Ruta
              </div>
              <div className={searchClientePaga ? 'roelca-sidebar-value' : 'roelca-sidebar-muted'}>
                {searchClientePaga || 'Sin cliente asignado'}
              </div>
              {(searchOrigen || searchDestino) && (
                <div className="roelca-route-line">
                  <IconMapPin size={12} />
                  <span style={{ color: '#c9d1d9' }}>{searchOrigen || '—'}</span>
                  <IconArrowRight size={12} />
                  <span style={{ color: '#c9d1d9' }}>{searchDestino || '—'}</span>
                </div>
              )}
            </div>

            {/* Tipo Operación + Convenio */}
            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label">
                <span className="roelca-sidebar-icon"><IconBriefcase size={14} /></span>
                Servicio
              </div>
              <div className={tipoOpNombreResumen ? 'roelca-sidebar-value' : 'roelca-sidebar-muted'}>
                {tipoOpNombreResumen || 'Sin tipo de operación'}
              </div>
              {convenioNombreResumen && (
                <div className="roelca-sidebar-secondary">
                  {convenioNombreResumen}
                </div>
              )}
              {(formData.trafico || formData.carga) && (
                <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                  {formData.trafico && <span className="roelca-chip">{formData.trafico}</span>}
                  {formData.carga && <span className="roelca-chip">{formData.carga}</span>}
                </div>
              )}
            </div>

            {/* Fechas */}
            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label">
                <span className="roelca-sidebar-icon"><IconCalendar size={14} /></span>
                Fechas
              </div>
              <div className="roelca-money-row">
                <span className="lbl">Servicio</span>
                <span className="val">{formData.fechaServicio ? fmtFecha(formData.fechaServicio) : '—'}</span>
              </div>
              {isFletes && (
                <div className="roelca-money-row">
                  <span className="lbl">Cita</span>
                  <span className="val">{formData.fechaCita ? fmtFecha(formData.fechaCita) : '—'}</span>
                </div>
              )}
            </div>

            {/* TC del día */}
            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label">
                <span className="roelca-sidebar-icon"><IconRefresh size={14} /></span>
                Tipo de Cambio
              </div>
              {tcResumen ? (
                <div className="roelca-sidebar-value" style={{ fontSize: '1.35rem', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.3px' }}>${Number(tcResumen).toFixed(4)}</div>
              ) : (
                <div className="roelca-sidebar-muted">Sin TC para esta fecha</div>
              )}
            </div>

            {/* Montos y Utilidad */}
            <div className="roelca-sidebar-section">
              <div className="roelca-sidebar-label">
                <span className="roelca-sidebar-icon"><IconDollar size={14} /></span>
                Financiero
              </div>
              <div className="roelca-money-row">
                <span className="lbl">Subtotal Proveedor</span>
                <span className="val" style={{ color: '#f85149', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(Number(formData.conversionProv) || Number(formData.subtotalProv))}</span>
              </div>
              <div className="roelca-money-row">
                <span className="lbl">Subtotal Cobrar</span>
                <span className="val" style={{ color: '#3fb950', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(Number(formData.conversionCliente) || Number(formData.subtotalCliente))}</span>
              </div>
              <div className={`roelca-utility-box ${Number(formData.utilidadEstimada) < 0 ? 'negative' : ''}`}>
                <div className="roelca-utility-label">Utilidad Estimada</div>
                <div className="roelca-utility-value">{fmtMoney(Number(formData.utilidadEstimada))}</div>
              </div>
            </div>

          </div>

          {/* Footer del sidebar con botones */}
          <div className="roelca-form-footer">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); (document.querySelector('.roelca-form-left form') as HTMLFormElement)?.requestSubmit(); }}
              className="roelca-btn-primary"
              disabled={cargando || !!statusError}
            >
              {cargando ? (
                <>
                  <IconRefresh size={16} /> Guardando...
                </>
              ) : (
                <>
                  <IconSave size={16} /> {initialData ? 'Actualizar Operación' : 'Guardar Operación'}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="roelca-btn-outline"
              disabled={cargando}
            >
              <IconX size={15} /> Cancelar
            </button>
          </div>
        </aside>

      </div>

      {/* Vista minimizada */}
      {estado === 'minimizado' && (
        <div style={{ position: 'fixed', bottom: '20px', right: '20px', padding: '12px 18px', backgroundColor: '#0d1117', border: '1px solid #1f2733', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '12px', boxShadow: '0 10px 20px rgba(0,0,0,0.4)' }}>
          <IconBriefcase size={16} />
          <span style={{ color: '#c9d1d9', fontSize: '0.88rem', fontWeight: 500 }}>Operación en curso</span>
          <button type="button" onClick={onRestore} className="roelca-window-btn" title="Restaurar">
            <IconArrowRight size={14} />
          </button>
          <button type="button" onClick={onClose} className="roelca-window-btn danger" title="Cerrar">
            <IconX size={14} />
          </button>
        </div>
      )}

    </div>
  );
};
// src/features/operaciones/components/OperacionesDashboard.tsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FormularioOperacion, TIPOS_DOCUMENTO_OPERACION } from './FormularioOperacion';
import { collection, doc, writeBatch, query, getDocs, orderBy, limit, where, startAfter } from 'firebase/firestore';
import { db, eliminarRegistro } from '../../../config/firebase'; 
import { obtenerBotonesHorarioDinamicos, resolverCascadaStatus } from '../config/statusRules';
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF, setLogoPdf } from '../../../utils/pdfGenerator'; 
import * as XLSX from 'xlsx';
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import { EmpresaBrand } from '../../configuracion/EmpresaBrand';
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

const TAMANO_PAGINA = 50;

const DIA_MS = 24 * 60 * 60 * 1000;
const CATALOGOS_TTL_MS: Record<string, number> = {
  statusServicio: 7 * DIA_MS, tiposOperacion: 7 * DIA_MS, embalajes: 7 * DIA_MS,
  catalogoMoneda: 7 * DIA_MS, tarifas: 7 * DIA_MS,
  empresas: DIA_MS, remolques: DIA_MS, unidades: DIA_MS, empleados: DIA_MS,
  unidades_proveedor: DIA_MS, proveedores_unidad: DIA_MS,
  conveniosProv: DIA_MS, catalogoConvProvDetalles: DIA_MS,
  catalogoConvClientes: DIA_MS, catalogoConvDetalles: DIA_MS, catalogoTC: DIA_MS,
};
const TTL_DEFAULT = DIA_MS;
// ✅ v2: se sube la versión de la clave para INVALIDAR cualquier caché vieja
// (incluidas las que quedaron VACÍAS cuando un bloqueador cortó la llamada a
// Firestore). Con v2, las cachés v1 dañadas se ignoran y todo se baja de nuevo.
const claveCacheCatalogo = (alias: string) => `cat_v2__${alias}`;
const leerCacheCatalogo = (alias: string): { ts: number; data: any[] } | null => {
  try {
    const raw = localStorage.getItem(claveCacheCatalogo(alias));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && Array.isArray(obj.data) ? obj : null;
  } catch { return null; }
};
// ✅ NO guardar un catálogo VACÍO. Si una descarga vuelve con 0 documentos
// (p. ej. la bloqueó una extensión), NO se cachea, para que se reintente en la
// siguiente carga en lugar de quedarse pegado mostrando IDs para siempre.
const escribirCacheCatalogo = (alias: string, data: any[]) => {
  try {
    if (!Array.isArray(data) || data.length === 0) return;
    localStorage.setItem(claveCacheCatalogo(alias), JSON.stringify({ ts: Date.now(), data }));
  } catch {}
};
// ✅ Una caché VACÍA NO se considera vigente → fuerza re-descarga.
const cacheVigente = (alias: string): boolean => {
  const obj = leerCacheCatalogo(alias);
  if (!obj || !Array.isArray(obj.data) || obj.data.length === 0) return false;
  const ttl = CATALOGOS_TTL_MS[alias] ?? TTL_DEFAULT;
  return (Date.now() - (obj.ts || 0)) < ttl;
};

const COLUMNAS_BASE = [
  { id: 'ref', label: '# Referencia', visible: true },
  { id: 'fechaServicio', label: 'Fecha Servicio', visible: true },
  { id: 'fechaCita', label: 'Fecha Cita', visible: false },
  { id: 'tipoOperacion', label: 'Tipo de Operación', visible: true },
  { id: 'status', label: 'Status', visible: true },
  { id: 'trafico', label: 'Tráfico', visible: false },
  { id: 'cliente', label: 'Cliente (Paga)', visible: true },
  { id: 'convenioTarifa', label: 'Convenio Cliente (Tarifa)', visible: true },
  { id: 'refCliente', label: 'Ref. Cliente', visible: false },
  { id: 'facturadoEnCobrar', label: 'Moneda Cobro', visible: false },
  { id: 'montoConvenioCliente', label: 'Monto Convenio (Cliente)', visible: false },
  { id: 'cargosAdicionales', label: 'Cargos Adic. (Cliente)', visible: true },
  { id: 'subtotal', label: 'Subtotal Cliente', visible: true },
  { id: 'tipoCambioAprobado', label: 'Tipo Cambio', visible: false },
  { id: 'dolaresCliente', label: 'Dólares (Cliente)', visible: false },
  { id: 'pesosCliente', label: 'Pesos (Cliente)', visible: false },
  { id: 'conversionCliente', label: 'Conversión Ingreso', visible: false },
  { id: 'origen', label: 'Origen', visible: false },
  { id: 'destino', label: 'Destino', visible: false },
  { id: 'remolque', label: '# Remolque', visible: true },
  { id: 'proveedor', label: 'Proveedor de Unidad', visible: true },
  { id: 'unidadProveedor', label: 'Unidad Externa', visible: false },
  { id: 'operadorProveedor', label: 'Operador Externo', visible: false },
  { id: 'convenioProv', label: 'Convenio Prov.', visible: true },
  { id: 'facturadoEnUnidad', label: 'Moneda Prov.', visible: false },
  { id: 'monedaConvenioProv', label: 'Moneda Conv. Prov.', visible: false },
  { id: 'totalAPagarProv', label: 'Monto Base Prov.', visible: false },
  { id: 'cargosAdicionalesProv', label: 'Cargos Adic. Prov.', visible: false },
  { id: 'subtotalProv', label: 'Subtotal Prov.', visible: false },
  { id: 'dolaresProv', label: 'Dólares Prov.', visible: false },
  { id: 'pesosProv', label: 'Pesos Prov.', visible: false },
  { id: 'conversionProv', label: 'Conversión Gasto', visible: false },
  { id: 'unidad', label: 'Unidad Roelca', visible: true },
  { id: 'operador', label: 'Operador Roelca', visible: false },
  { id: 'sueldoOperador', label: 'Sueldo Operador', visible: false },
  { id: 'sueldoExtra', label: 'Sueldo Extra', visible: false },
  { id: 'sueldoTotal', label: 'Sueldo Total', visible: false },
  { id: 'combustible', label: 'Combustible', visible: false },
  { id: 'combustibleExtra', label: 'Combustible Extra', visible: false },
  { id: 'combustibleTotal', label: 'Combustible Total', visible: false },
  { id: 'clienteMercancia', label: 'Cliente Mercancía', visible: false },
  { id: 'descripcionMercancia', label: 'Desc. Mercancía', visible: false },
  { id: 'cantidad', label: 'Cantidad', visible: false },
  { id: 'embalaje', label: 'Embalaje', visible: false },
  { id: 'pesoKg', label: 'Peso (Kg)', visible: false },
  { id: 'numDoda', label: '# DODA', visible: false },
  { id: 'fechaEmisionDoda', label: 'Fecha DODA', visible: false },
  { id: 'numeroEntrys', label: '# Entrys', visible: false },
  { id: 'cantEntrys', label: 'Cant. Entrys', visible: false },
  { id: 'numManifiesto', label: '# Manifiesto', visible: false },
  { id: 'provServicios', label: 'Prov. Servicios', visible: false },
  { id: 'montoManifiesto', label: 'Costo Manifiesto', visible: false },
  { id: 'totalGastos', label: 'Total Gastos', visible: false },
  { id: 'utilidadEstimada', label: 'Utilidad Estimada', visible: false },
  { id: 'observacionesEjecutivo', label: 'Obs. Ejecutivo', visible: false },
  { id: 'observacionesUnidad', label: 'Obs. Unidad', visible: false },
  { id: 'observacionesCobrar', label: 'Obs. Cobro', visible: false }
];

const OperacionesDashboard = () => {
  const { config: empresaConfig } = useEmpresaConfig();

  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [operacionEditando, setOperacionEditando] = useState<any | null>(null);
  
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(true);
  const [operacionViendo, setOperacionViendo] = useState<any | null>(null);
  
  const [hayMasOperaciones, setHayMasOperaciones] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);

  const [modalHorarios, setModalHorarios] = useState<'cerrado' | 'registrar' | 'historial'>('cerrado');
  const [mostrarDocumentos, setMostrarDocumentos] = useState(false);
  const [mostrarSubirDocOp, setMostrarSubirDocOp] = useState(false);
  const [historialList, setHistorialList] = useState<any[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  const [nuevoStatus, setNuevoStatus] = useState('');
  const [nuevaFechaHora, setNuevaFechaHora] = useState('');
  
  const [guardandoStatusRapido, setGuardandoStatusRapido] = useState<string | null>(null);
  const [ultimoStatusGuardado, setUltimoStatusGuardado] = useState<string | null>(null);
  
  const [botonesDisponibles, setBotonesDisponibles] = useState<string[]>([]);
  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});

  const [busqueda, setBusqueda] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const mapaStatus = useMemo(() => {
    const lista = (catalogosGlobales.statusServicio || []) as any[];
    const porId: Record<string, { id: string; nombre: string }> = {};
    const porNombre: Record<string, { id: string; nombre: string }> = {};
    lista.forEach(s => {
      const entry = { id: String(s.id || ''), nombre: String(s.nombre || s.id || '') };
      if (entry.id) porId[entry.id] = entry;
      if (entry.nombre) porNombre[entry.nombre.trim().toLowerCase()] = entry;
    });
    return { porId, porNombre };
  }, [catalogosGlobales.statusServicio]);

  const resolverStatus = (valor: string | null | undefined): { id: string; nombre: string } => {
    if (!valor) return { id: '', nombre: '' };
    const v = String(valor).trim();
    if (mapaStatus.porId[v]) return mapaStatus.porId[v];
    const porNom = mapaStatus.porNombre[v.toLowerCase()];
    if (porNom) return porNom;
    return { id: v, nombre: v };
  };

  const COLECCIONES_CATALOGOS: Record<string, string> = {
    statusServicio:            'catalogo_status_servicio',
    tiposOperacion:            'catalogo_tipo_operacion',
    embalajes:                 'catalogo_embalaje',
    catalogoMoneda:            'catalogo_moneda',
    tarifas:                   'catalogo_tarifas_referencia',
    empresas:                  'empresas',
    remolques:                 'remolques',
    unidades:                  'unidades',
    empleados:                 'empleados',
    unidades_proveedor:        'unidades_proveedor',
    proveedores_unidad:        'proveedores_unidad',
    conveniosProv:             'convenios_proveedores',
    catalogoConvProvDetalles:  'convenios_proveedores_detalles',
    catalogoConvClientes:      'convenios_clientes',
    catalogoConvDetalles:      'convenios_clientes_detalles',
    catalogoTC:                'tipo_cambio',
  };

  const catalogosEnVueloRef = useRef<Set<string>>(new Set());

  const cargarCatalogosSiEsNecesario = async () => {
    const pendientes = Object.entries(COLECCIONES_CATALOGOS)
      .filter(([alias]) => !cacheVigente(alias) && !catalogosEnVueloRef.current.has(alias))
      .map(([alias, col]) => ({ alias, col }));
    if (pendientes.length === 0) return;
    pendientes.forEach(p => catalogosEnVueloRef.current.add(p.alias));
    await Promise.all(pendientes.map(async ({ alias, col }) => {
      try {
        const snap = await getDocs(collection(db, col));
        const data = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
        escribirCacheCatalogo(alias, data);
        setCatalogosGlobales((prev: any) => ({ ...prev, [alias]: data }));
      } catch (e) {
        console.error(`Error cargando catálogo "${col}":`, e);
      } finally {
        catalogosEnVueloRef.current.delete(alias);
      }
    }));
  };

  const hidratarCatalogosDesdeCache = () => {
    const inicial: any = {};
    Object.keys(COLECCIONES_CATALOGOS).forEach(alias => {
      const c = leerCacheCatalogo(alias);
      if (c && Array.isArray(c.data)) inicial[alias] = c.data;
    });
    if (Object.keys(inicial).length) {
      setCatalogosGlobales((prev: any) => ({ ...prev, ...inicial }));
    }
  };

  const descargarOperaciones = async () => {
    setCargandoOperaciones(true);
    try {
      const queryOperaciones = query(
        collection(db, 'operaciones'),
        orderBy('fechaServicio', 'desc'),
        limit(TAMANO_PAGINA)
      );
      const operacionesSnap = await getDocs(queryOperaciones);
      
      const opDataRaw = operacionesSnap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      const idsExcluidos = ['f557b751', 'c2d57403', '7607f692'];
      
      const operacionesActivas = opDataRaw.filter((op: any) => {
        const statusId = String(op.status || '').trim();
        const statusTexto = String(op.statusNombre || op.status || '').toLowerCase();
        return !idsExcluidos.includes(statusId) && !statusTexto.includes('completado');
      });

      setOperacionesGlobales(operacionesActivas);
      setHayMasOperaciones(operacionesSnap.docs.length === TAMANO_PAGINA);
    } catch (e: any) {
      console.error("Error al cargar operaciones:", e);
      const msg = String(e?.message || e?.code || e || '').toLowerCase();
      if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
        alert("⚠️ Cuota de lecturas de Firestore agotada.\n\nEl plan gratuito permite 50,000 lecturas/día y entre varias personas se agota. Se reinicia a las 2 AM (hora México).\n\nRecomendación: activa el plan Blaze en Firebase Console.");
      } else if (msg.includes('index')) {
        alert("Falta un índice en Firestore para esta consulta. Abre la consola del navegador (F12); el error de Firebase trae un enlace para crear el índice con un clic.");
      } else {
        alert("Hubo un problema al cargar las operaciones. Verifica tu conexión.");
      }
    }
    setCargandoOperaciones(false);
  };

  const cargarMasOperaciones = async () => {
    if (!hayMasOperaciones || cargandoMas || operacionesGlobales.length === 0) return;
    setCargandoMas(true);
    try {
      const ultimo = operacionesGlobales[operacionesGlobales.length - 1];
      const cursorFecha = ultimo.fechaServicio || '';

      const q = query(
        collection(db, 'operaciones'),
        orderBy('fechaServicio', 'desc'),
        startAfter(cursorFecha),
        limit(TAMANO_PAGINA)
      );
      const snap = await getDocs(q);
      const nuevasRaw = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      const idsExcluidos = ['f557b751', 'c2d57403', '7607f692'];
      const nuevasFiltradas = nuevasRaw.filter((op: any) => {
        const statusId = String(op.status || '').trim();
        const statusTexto = String(op.statusNombre || op.status || '').toLowerCase();
        return !idsExcluidos.includes(statusId) && !statusTexto.includes('completado');
      });

      setOperacionesGlobales(prev => [...prev, ...nuevasFiltradas]);
      setHayMasOperaciones(snap.docs.length === TAMANO_PAGINA);
    } catch (e) {
      console.error("Error al cargar más operaciones:", e);
      alert("No se pudieron cargar más operaciones.");
    }
    setCargandoMas(false);
  };

  useEffect(() => {
    // 0) ✅ LIMPIEZA AUTOMÁTICA: borra cachés viejas (v1) y cualquier caché que
    //    haya quedado VACÍA (0 docs) por un bloqueo previo de Firestore. Así el
    //    estado atascado (Tipo/Status mostrando ID) se cura solo al cargar.
    try {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('cat_v1__')) { localStorage.removeItem(k); return; }
        if (k.startsWith('cat_v2__')) {
          try {
            const obj = JSON.parse(localStorage.getItem(k) || '{}');
            if (!obj || !Array.isArray(obj.data) || obj.data.length === 0) localStorage.removeItem(k);
          } catch { localStorage.removeItem(k); }
        }
      });
    } catch {}

    hidratarCatalogosDesdeCache();
    cargarCatalogosSiEsNecesario();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    descargarOperaciones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const b64 = empresaConfig?.logoBase64;
    setLogoPdf(b64 && b64.startsWith('data:') ? b64 : '');
  }, [empresaConfig?.logoBase64]);

  useEffect(() => { setPaginaActual(1); }, [busqueda]);

  useEffect(() => {
    const cargarBotones = async () => {
      if (operacionViendo) {
        let op = operacionViendo;
        if (!op.statusNombre && op.status) {
          const resuelto = resolverStatus(op.status);
          if (resuelto.nombre && resuelto.nombre !== resuelto.id) {
            op = { ...op, statusNombre: resuelto.nombre };
          }
        }
        const botones = await obtenerBotonesHorarioDinamicos(op);
        setBotonesDisponibles(botones || []);
      } else {
        setBotonesDisponibles([]);
      }
    };
    cargarBotones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionViendo, mapaStatus]);

  const handleNuevo = async () => { 
    await cargarCatalogosSiEsNecesario();
    setOperacionEditando(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const editarOperacion = async (operacion: any) => { 
    await cargarCatalogosSiEsNecesario();
    setOperacionEditando(operacion); 
    setOperacionViendo(null); 
    setEstadoFormulario('abierto'); 
  };
  
  const eliminarOperacion = async (id: string) => {
    if (!id) return;
    if (window.confirm('¿Estás seguro de eliminar este registro permanentemente?')) {
      try {
        await eliminarRegistro('operaciones', id); 
        setOperacionesGlobales(prev => prev.filter((op: any) => String(op.id) !== String(id)));
        setOperacionViendo(null);
      } catch (error) {
        console.error("Error al eliminar:", error);
        alert("Hubo un error al intentar eliminar el registro.");
      }
    }
  };
  
  const mostrarDato = (dato: any) => (dato && dato !== '' ? dato : '-');
  
  const formatearFechaHora = (isoString: string | undefined | null) => {
    if (!isoString) return '-';
    return new Date(isoString).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  
  const mostrarMoneda = (val: string | null | undefined) => {
    if (val === ID_USD) return 'USD';
    if (val === ID_MXN) return 'MXN';
    return val || '-';
  };

  const mostrarDatoMapeado = (id: string | null | undefined, catalogo: keyof typeof catalogosGlobales, campoRetorno: string = 'nombre', valorDesnormalizado?: string) => {
    if (valorDesnormalizado && valorDesnormalizado.trim() !== '' && valorDesnormalizado !== '-' && String(valorDesnormalizado).trim() !== String(id).trim()) {
      if (catalogo === 'statusServicio' && valorDesnormalizado.length > 30) {
        // Fallback
      } else {
        return valorDesnormalizado; 
      }
    }

    if (!id) return '-';
    if (!catalogosGlobales[catalogo] || !Array.isArray(catalogosGlobales[catalogo])) return id;
    
    const objetivo = String(id).trim().toLowerCase();
    const elementoEncontrado = catalogosGlobales[catalogo].find((item: any) => {
      const candidatos = [item.id, item.nombre, item.codigo, item.clave, item.uuid, item.uid, item._id, item.tipo_operacion];
      return candidatos.some((c: any) => c != null && String(c).trim().toLowerCase() === objetivo);
    });
    if (!elementoEncontrado) return id;

    if (catalogo === 'empleados') {
      return `${elementoEncontrado.firstName || ''} ${elementoEncontrado.lastNamePaternal || ''}`.trim() || elementoEncontrado.nombre || id;
    }
    if (catalogo === 'remolques') {
      return `${elementoEncontrado.nombre || ''} ${elementoEncontrado.placas || elementoEncontrado.placa || ''}`.trim() || id;
    }
    if (catalogo === 'unidades') {
      return elementoEncontrado.unidad || elementoEncontrado.nombre || id;
    }
    if (catalogo === 'catalogoMoneda' || catalogo === 'catalogo_moneda') {
      return elementoEncontrado.moneda || id;
    }
    if (catalogo === 'statusServicio') {
      return elementoEncontrado.nombre || id;
    }
    if (catalogo === 'tiposOperacion') {
      return elementoEncontrado.tipo_operacion || elementoEncontrado.nombre || elementoEncontrado.descripcion || elementoEncontrado.tipoOperacion || elementoEncontrado.tipo || id;
    }

    return elementoEncontrado[campoRetorno] || elementoEncontrado.nombre || elementoEncontrado.descripcion || id;
  };

  const obtenerNombreConvenioCliente = (id: string, valorDesnormalizado?: string) => {
    if (valorDesnormalizado && valorDesnormalizado.trim() !== '' && valorDesnormalizado !== '-' && String(valorDesnormalizado).trim() !== String(id).trim()) return valorDesnormalizado;
    if (!id) return '-';
    const detalle = catalogosGlobales.catalogoConvDetalles?.find((d:any) => String(d.id).trim() === String(id).trim());
    if (detalle) {
        const tarifaId = detalle.tipoConvenioId || detalle.tipo_convenio_id || detalle.tipoConvenio || detalle.tipo_convenio || detalle['TIPO DE CONVENIO'];
        const tObj = catalogosGlobales.tarifas?.find((t:any) => String(t.id).trim() === String(tarifaId).trim());
        return tObj?.descripcion || tObj?.nombre || id;
    }
    return id;
  };

  const obtenerNombreConvenioProv = (id: string, valorDesnormalizado?: string) => {
    if (valorDesnormalizado && valorDesnormalizado.trim() !== '' && valorDesnormalizado !== '-' && String(valorDesnormalizado).trim() !== String(id).trim()) return valorDesnormalizado;
    if (!id) return '-';
    const detalle = catalogosGlobales.catalogoConvProvDetalles?.find((d:any) => String(d.id).trim() === String(id).trim());
    if (detalle) {
        const tarifaId = detalle.tipoConvenioId || detalle.tipo_convenio || detalle.tarifaId || detalle['TIPO DE CONVENIO'];
        const tObj = catalogosGlobales.tarifas?.find((t:any) => String(t.id).trim() === String(tarifaId).trim());
        return tObj?.descripcion || tObj?.nombre || detalle.tipoConvenioNombre || id;
    }
    return id;
  };

  const formatoMoneda = (monto: any) => {
    if (!monto) return '$ 0.00';
    return `$ ${parseFloat(monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const resolverRemolqueParaPDF = (): { nombre: string; placa: string } => {
    const lista: any[] = Array.isArray(catalogosGlobales.remolques) ? catalogosGlobales.remolques : [];
    const ref = operacionViendo?.numeroRemolque;
    const combinado = String(operacionViendo?.remolqueNombre || ref || '').trim();
    const primerToken = combinado.split(/\s+/)[0] || '';

    let obj = ref ? lista.find((r: any) => String(r.id).trim() === String(ref).trim()) : undefined;
    if (!obj && ref) obj = lista.find((r: any) => String(r.nombre || '').trim() === String(ref).trim());
    if (!obj && primerToken) obj = lista.find((r: any) => String(r.nombre || '').trim() === primerToken);
    if (!obj && combinado) {
      obj = lista.find((r: any) => `${r.nombre || ''} ${r.placas || r.placa || ''}`.trim() === combinado);
    }

    let nombre = obj?.nombre ? String(obj.nombre).trim() : '';
    let placa = (obj?.placa || obj?.placas) ? String(obj?.placa || obj?.placas).trim() : '';

    if (!nombre || !placa) {
      const partes = combinado.split(/\s+/).filter(Boolean);
      if (!nombre) nombre = partes[0] || '';
      if (!placa && partes.length > 1) placa = partes.slice(1).join(' ');
    }

    if (!placa) placa = String(operacionViendo?.remolquePlaca || operacionViendo?.remolquePlacas || '').trim();

    return { nombre: nombre || 'N/A', placa: placa || 'N/A' };
  };

  // =====================================================================
  // ✅ RESOLUCIÓN ROBUSTA DE LA UNIDAD (TRACTOR) PARA LOS PDF.
  // Devuelve { nombre, placa } sin imprimir nunca "undefined". El nombre de la
  // unidad en el catálogo `unidades` está en el campo `unidad` (no en
  // `numeroEconomico`/`nombre`), por eso antes salía undefined. Aquí se prueban
  // todos los campos posibles y, si es flota externa, se busca en
  // `unidades_proveedor`. Como último recurso usa el valor desnormalizado.
  // =====================================================================
  const resolverUnidadParaPDF = (): { nombre: string; placa: string } => {
    const refUnidad = operacionViendo?.unidad;
    const listaU: any[] = Array.isArray(catalogosGlobales.unidades) ? catalogosGlobales.unidades : [];
    const uObj = refUnidad ? listaU.find((u: any) => String(u.id).trim() === String(refUnidad).trim()) : undefined;

    let nombre = String(
      operacionViendo?.unidadNombre ||
      (uObj ? (uObj.unidad || uObj.numeroEconomico || uObj.numeroUnidad || uObj.nombre || uObj.economico) : '') ||
      ''
    ).trim();
    let placa = String(
      operacionViendo?.unidadPlacas ||
      operacionViendo?.unidadPlaca ||
      (uObj ? (uObj.placas || uObj.placa) : '') ||
      ''
    ).trim();

    // Flota externa: si no hubo unidad propia, intenta con unidades_proveedor.
    if (!nombre && operacionViendo?.unidadProveedor) {
      const listaP: any[] = Array.isArray(catalogosGlobales.unidades_proveedor) ? catalogosGlobales.unidades_proveedor : [];
      const pObj = listaP.find((u: any) => String(u.id).trim() === String(operacionViendo.unidadProveedor).trim());
      if (pObj) {
        nombre = String(pObj.numeroUnidad || pObj.numeroEconomico || pObj.unidad || pObj.nombre || '').trim();
        if (!placa) placa = String(pObj.placas || pObj.placa || '').trim();
      }
    }

    return { nombre: nombre || 'N/A', placa: placa || 'N/A' };
  };

  // ✅ Nombre del operador para PDF, sin "undefined".
  const resolverOperadorParaPDF = (): string => {
    if (operacionViendo?.operadorNombre) return String(operacionViendo.operadorNombre).trim();
    const mapeado = mostrarDatoMapeado(operacionViendo?.operador, 'empleados');
    if (mapeado && mapeado !== '-' && mapeado !== operacionViendo?.operador) return String(mapeado).trim();
    if (operacionViendo?.operadorProveedor) {
      const listaP: any[] = Array.isArray(catalogosGlobales.proveedores_unidad) ? catalogosGlobales.proveedores_unidad : [];
      const oObj = listaP.find((o: any) => String(o.id).trim() === String(operacionViendo.operadorProveedor).trim());
      if (oObj) return String(oObj.nombre || oObj.firstName || '').trim() || 'N/A';
    }
    return 'N/A';
  };

  const abrirRegistroHorario = () => {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    const localISOTime = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
    setNuevaFechaHora(localISOTime);
    setNuevoStatus(botonesDisponibles[0] || ''); 
    setModalHorarios('registrar');
  };

  const verHistorial = async () => {
    setModalHorarios('historial');
    setCargandoHorarios(true);
    try {
      const dbQuery = query(collection(db, 'horarios'), where('operacionId', '==', operacionViendo.id));
      const snap = await getDocs(dbQuery);
      const data = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      data.sort((a: any, b: any) => new Date(b.fechaHora).getTime() - new Date(a.fechaHora).getTime());
      setHistorialList(data);
    } catch (e) {}
    setCargandoHorarios(false);
  };

  const guardarHorario = async () => {
    if (!nuevoStatus || !nuevaFechaHora) return alert("Completa la fecha y el estatus.");
    setCargandoHorarios(true);
    try {
      const { id: statusId, nombre: statusNombreResuelto } = resolverStatus(nuevoStatus);

      const batch = writeBatch(db);
      const horarioRef = doc(collection(db, 'horarios'));
      batch.set(horarioRef, {
        operacionId: operacionViendo.id,
        status: statusId,
        statusNombre: statusNombreResuelto,
        fechaHora: nuevaFechaHora,
        registradoEn: new Date().toISOString()
      });
      const opRef = doc(db, 'operaciones', String(operacionViendo.id));
      batch.update(opRef, { status: statusId, statusNombre: statusNombreResuelto });

      await batch.commit();

      const operacionActualizada = {
        ...operacionViendo,
        status: statusId,
        statusNombre: statusNombreResuelto
      };
      setOperacionViendo(operacionActualizada);
      setOperacionesGlobales(prev => prev.map((op: any) =>
        op.id === operacionViendo.id ? operacionActualizada : op
      ));

      alert('Horario registrado y Estatus actualizado.');
      setModalHorarios('cerrado');
    } catch (e) {
      console.error('Error guardarHorario:', e);
      alert("Error al actualizar la base de datos.");
    }
    setCargandoHorarios(false);
  };

  const registrarStatusRapido = async (statusNombre: string) => {
    if (!operacionViendo || !statusNombre) return;
    if (guardandoStatusRapido) return;

    const _normalizar = (s: string) =>
      String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (_normalizar(statusNombre).includes('cancel')) {
      const refOp = operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'esta operación';
      const confirmado = window.confirm(
        `¿Seguro que deseas CANCELAR la operación ${refOp}?\n\n` +
        `Se registrará el status "${statusNombre}" y la referencia quedará cancelada.`
      );
      if (!confirmado) return;
    }

    setGuardandoStatusRapido(statusNombre);

    const operacionPrevia = operacionViendo;
    const operacionesPrevias = operacionesGlobales;
    const botonesPrevios = botonesDisponibles;

    try {
      let opParaCascada = operacionViendo;
      if (!opParaCascada.statusNombre && opParaCascada.status) {
        const r = resolverStatus(opParaCascada.status);
        opParaCascada = { ...opParaCascada, statusNombre: r.nombre };
      }

      const cadenaStatus = await resolverCascadaStatus(statusNombre, opParaCascada);
      const cadenaResuelta = cadenaStatus.map(resolverStatus);
      const statusFinal = cadenaResuelta[cadenaResuelta.length - 1];

      const operacionActualizada = {
        ...operacionViendo,
        status: statusFinal.id,
        statusNombre: statusFinal.nombre
      };
      setOperacionViendo(operacionActualizada);
      setOperacionesGlobales(prev => prev.map((op: any) =>
        op.id === operacionViendo.id ? operacionActualizada : op
      ));

      obtenerBotonesHorarioDinamicos(operacionActualizada)
        .then(botones => setBotonesDisponibles(botones || []))
        .catch(() => {});

      const now = new Date();
      const tzOffset = now.getTimezoneOffset() * 60000;
      const fechaHoraLocal = (new Date(Date.now() - tzOffset)).toISOString().slice(0, 16);
      const registradoEn = new Date().toISOString();

      (async () => {
        try {
          const batch = writeBatch(db);

          cadenaResuelta.forEach((statusPaso, idx) => {
            const horarioRef = doc(collection(db, 'horarios'));
            batch.set(horarioRef, {
              operacionId: operacionViendo.id,
              status: statusPaso.id,
              statusNombre: statusPaso.nombre,
              fechaHora: fechaHoraLocal,
              registradoEn: registradoEn,
              ordenCascada: idx,
              esAutomatico: idx > 0,
            });
          });

          const opRef = doc(db, 'operaciones', String(operacionViendo.id));
          batch.update(opRef, {
            status: statusFinal.id,
            statusNombre: statusFinal.nombre
          });

          await batch.commit();

          setGuardandoStatusRapido(null);
          setUltimoStatusGuardado(statusNombre);
          setTimeout(() => setUltimoStatusGuardado(null), 1500);} catch (e: any) {
          console.error("Error al registrar status:", e);
          setOperacionViendo(operacionPrevia);
          setOperacionesGlobales(operacionesPrevias);
          setBotonesDisponibles(botonesPrevios);
          setGuardandoStatusRapido(null);

          const msg = String(e?.message || e?.code || e || '').toLowerCase();
          if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
            alert(
              "⚠️ Cuota de Firestore agotada.\n\n" +
              "Tu proyecto superó el límite gratuito diario. La cuota se reinicia a las 2 AM (hora México).\n\n" +
              "Recomendación: activa el plan Blaze en Firebase Console para evitar este límite."
            );
          } else {
            alert("Error al guardar el status. Se revirtió el cambio.");
          }
        }
      })();
    } catch (e) {
      console.error("Error resolviendo cascada:", e);
      setGuardandoStatusRapido(null);
      alert("Error al procesar el cambio de status. Intenta de nuevo.");
    }
  };

  const handleOperacionGuardada = () => {
    descargarOperaciones();
    setEstadoFormulario('cerrado');
    setOperacionEditando(null);
  };

  const forzarRecarga = () => {
    if (!window.confirm(
      '¿Recargar todos los catálogos desde Firestore?\n\n' +
      'Esto consumirá un buen número de lecturas (~500-2000). ' +
      'Hazlo solo si editaste un catálogo en otra pantalla o sospechas datos viejos.'
    )) return;
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('cat_v1__') || k.startsWith('cat_v2__') || k.startsWith('flujo_v1__'))
        .forEach(k => localStorage.removeItem(k));
    } catch {}
    sessionStorage.removeItem('roelca_catalogos_v2');
    window.location.reload();
  };

  const handleDescargarSolicitudRetiro = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origen = mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueRes = resolverRemolqueParaPDF();
    const unidadRes = resolverUnidadParaPDF();
    const operadorRes = resolverOperadorParaPDF();

    generarSolicitudRetiroPDF({
      bodegaNombre: origen,
      tipoMovimiento: operacionViendo.trafico || 'N/A',
      remolqueNombre: remolqueRes.nombre,
      remolquePlacas: remolqueRes.placa,
      clienteMercancia: operacionViendo.clienteMercanciaNombre || mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      unidadNombre: unidadRes.nombre,
      unidadPlacas: unidadRes.placa,
      empleadoNombre: operadorRes,
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    });
  };

  const handleDescargarInstruccionesServicio = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueRes = resolverRemolqueParaPDF();
    const unidadRes = resolverUnidadParaPDF();
    const operadorRes = resolverOperadorParaPDF();

    generarInstruccionesServicioPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'N/A',
      fecha: operacionViendo.fechaServicio || '',
      unidadNombre: unidadRes.nombre,
      empleadoNombre: operadorRes,
      remolqueNombre: remolqueRes.nombre,
      remolquePlacas: remolqueRes.placa,
      tipoOperacion: operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion'),
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      clienteMercancia: operacionViendo.clienteMercanciaNombre || mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    });
  };

  const handleDescargarCheckList = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);
    const unidadRes = resolverUnidadParaPDF();
    const empNombre = resolverOperadorParaPDF();
    const uniNombre = unidadRes.nombre;
    const uniPlacas = unidadRes.placa;

    generarCheckListPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fecha: operacionViendo.fechaServicio || '',
      cliente: operacionViendo.clienteNombre || mostrarDatoMapeado(operacionViendo.clientePaga, 'empresas'),
      remolque: operacionViendo.remolqueNombre || (remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A'),
      proveedor: operacionViendo.proveedorUnidadNombre || mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas'),
      tractorInfo: `${uniNombre} / ${uniPlacas} / ${empNombre}`,
      numeroPedimento: operacionViendo.numDoda || 'N/A',
      prefileEntrys: String(operacionViendo.cantEntrys || '0'),
      entryReferencia: operacionViendo.numeroEntrys || 'N/A',
      manifiesto: operacionViendo.numManifiesto || 'N/A',
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      operadorNombre: empNombre,
      supervisor: operacionViendo.observacionesEjecutivo || 'Despacho',
    });
  };

  const handleDescargarPruebaEntrega = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);
    const empNombre = resolverOperadorParaPDF();

    generarPruebaEntregaPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      origenCP: origenObj ? (origenObj.cp || origenObj.codigoPostal || 'N/A') : 'N/A',
      origenCiudad: origenObj ? (origenObj.ciudad || origenObj.estado || 'N/A') : 'N/A',
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      destinoCP: destinoObj ? (destinoObj.cp || destinoObj.codigoPostal || 'N/A') : 'N/A',
      destinoCiudad: destinoObj ? (destinoObj.ciudad || destinoObj.estado || 'N/A') : 'N/A',
      tipoServicio: `${operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion')} ${operacionViendo.trafico || ''}`,
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: operacionViendo.remolqueNombre || (remolqueObj ? remolqueObj.nombre : 'N/A'),
      placas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A'
    });
  };

  const handleDescargarCartaInstrucciones = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);
    const empNombre = resolverOperadorParaPDF();

    generarCartaInstruccionesPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      tipoServicio: operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion'),
      trafico: operacionViendo.trafico || '',
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: operacionViendo.remolqueNombre || (remolqueObj ? remolqueObj.nombre : 'N/A'),
      placas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A',
      origenCiudad: origenObj ? (origenObj.ciudad || origenObj.estado || 'N/A') : 'N/A', 
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: 'N/A', origenColonia: 'N/A', origenCP: 'N/A',
      destinoCiudad: destinoObj ? (destinoObj.ciudad || destinoObj.estado || 'N/A') : 'N/A', 
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: 'N/A', destinoColonia: 'N/A', destinoCP: 'N/A',
    });
  };

  const operacionesFiltradas = useMemo(() => {
    const b = busqueda.toLowerCase();
    return operacionesGlobales.filter(op => {
      return (
        String(op.ref || op.id || '').toLowerCase().includes(b) ||
        String(op.fechaServicio || '').toLowerCase().includes(b) ||
        String(op.clienteNombre || op.nombreCliente || '').toLowerCase().includes(b) ||
        String(op.tipoOperacionNombre || op.tipoServicio || '').toLowerCase().includes(b) ||
        String(op.trafico || '').toLowerCase().includes(b) ||
        String(op.statusNombre || op.status || '').toLowerCase().includes(b) 
      );
    });
  }, [busqueda, operacionesGlobales]);

  const totalPaginas = Math.ceil(operacionesFiltradas.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const operacionesEnPantalla = operacionesFiltradas.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.effectAllowed = 'move';
    setDraggedColIndex(index);
  };

  const handleDragEnter = (index: number) => {
    if (draggedColIndex === null || draggedColIndex === index) return;
    const nuevasColumnas = [...columnasTabla];
    const colMovida = nuevasColumnas.splice(draggedColIndex, 1)[0];
    nuevasColumnas.splice(index, 0, colMovida);
    setDraggedColIndex(index);
    setColumnasTabla(nuevasColumnas);
  };

  const toggleColumnaVisible = (index: number) => {
    const nuevas = [...columnasTabla];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasTabla(nuevas);
  };

  const renderCellContent = (op: any, colId: string) => {
    switch (colId) {
      case 'ref': return <span className="font-mono" style={{ color: '#58a6ff', fontWeight: 'bold' }}>{op.ref || op.id?.substring(0,6)}</span>;
      case 'fechaServicio': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.fechaServicio)}</span>;
      case 'fechaCita': return <span style={{ color: '#c9d1d9' }}>{formatearFechaHora(op.fechaCita)}</span>;
      case 'tipoOperacion': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre)}</span>;
      case 'status': return <span style={{ color: '#10b981', fontWeight: 'bold' }}>{mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre)}</span>;
      case 'trafico': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.trafico)}</span>;
      case 'cliente': return <span style={{ color: '#f0f6fc', fontWeight: '500' }}>{mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente)}</span>;
      case 'convenioTarifa': return <span style={{ color: '#c9d1d9', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}>{obtenerNombreConvenioCliente(op.convenio, op.convenioNombre)}</span>;
      case 'refCliente': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.refCliente)}</span>;
      case 'facturadoEnCobrar': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre)}</span>;
      case 'montoConvenioCliente': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.montoConvenioCliente)}</span>;
      case 'cargosAdicionales': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.cargosAdicionales)}</span>;
      case 'subtotal': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.subtotalCliente)}</span>;
      case 'tipoCambioAprobado': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.tipoCambioAprobado)}</span>;
      case 'dolaresCliente': return <span style={{ color: '#10b981' }}>{formatoMoneda(op.dolaresCliente)}</span>;
      case 'pesosCliente': return <span style={{ color: '#3b82f6' }}>{formatoMoneda(op.pesosCliente)}</span>;
      case 'conversionCliente': return <span style={{ color: '#D84315' }}>{formatoMoneda(op.conversionCliente)}</span>;
      case 'origen': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre)}</span>;
      case 'destino': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre)}</span>;
      case 'remolque': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre)}</span>;
      case 'proveedor': return <span style={{ color: '#c9d1d9', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={op.proveedorUnidadNombre || op.proveedorUnidad}>{mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre)}</span>;
      case 'unidadProveedor': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.unidadProveedor)}</span>;
      case 'operadorProveedor': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.operadorProveedor)}</span>;
      case 'convenioProv': return <span style={{ color: '#c9d1d9', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}>{obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre)}</span>;
      case 'facturadoEnUnidad': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre)}</span>;
      case 'monedaConvenioProv': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre)}</span>;
      case 'totalAPagarProv': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.totalAPagarProv)}</span>;
      case 'cargosAdicionalesProv': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.cargosAdicionalesProv)}</span>;
      case 'subtotalProv': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.subtotalProv)}</span>;
      case 'dolaresProv': return <span style={{ color: '#3b82f6' }}>{formatoMoneda(op.dolaresProv)}</span>;
      case 'pesosProv': return <span style={{ color: '#3b82f6' }}>{formatoMoneda(op.pesosProv)}</span>;
      case 'conversionProv': return <span style={{ color: '#f85149' }}>{formatoMoneda(op.conversionProv)}</span>;
      case 'unidad': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre)}</span>;
      case 'operador': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre)}</span>;
      case 'sueldoOperador': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.sueldoOperador)}</span>;
      case 'sueldoExtra': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.sueldoExtra)}</span>;
      case 'sueldoTotal': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.sueldoTotal)}</span>;
      case 'combustible': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.combustible)}</span>;
      case 'combustibleExtra': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.combustibleExtra)}</span>;
      case 'combustibleTotal': return <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(op.combustibleTotal)}</span>;
      case 'clienteMercancia': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre)}</span>;
      case 'descripcionMercancia': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.descripcionMercancia)}</span>;
      case 'cantidad': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.cantidad)}</span>;
      case 'embalaje': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.embalaje, 'embalajes', 'nombre', op.embalajeNombre)}</span>;
      case 'pesoKg': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.pesoKg)}</span>;
      case 'numDoda': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.numDoda)}</span>;
      case 'fechaEmisionDoda': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.fechaEmisionDoda)}</span>;
      case 'numeroEntrys': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.numeroEntrys)}</span>;
      case 'cantEntrys': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.cantEntrys)}</span>;
      case 'numManifiesto': return <span style={{ color: '#c9d1d9' }}>{mostrarDato(op.numManifiesto)}</span>;
      case 'provServicios': return <span style={{ color: '#c9d1d9' }}>{mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre)}</span>;
      case 'montoManifiesto': return <span style={{ color: '#c9d1d9' }}>{formatoMoneda(op.montoManifiesto)}</span>;
      case 'totalGastos': return <span style={{ color: '#f85149', fontWeight: 'bold' }}>{formatoMoneda(op.totalGastos)}</span>;
      case 'utilidadEstimada': return <span style={{ color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(op.utilidadEstimada)}</span>;
      case 'observacionesEjecutivo': return <span style={{ color: '#8b949e', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mostrarDato(op.observacionesEjecutivo)}</span>;
      case 'observacionesUnidad': return <span style={{ color: '#8b949e', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mostrarDato(op.observacionesUnidad)}</span>;
      case 'observacionesCobrar': return <span style={{ color: '#8b949e', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis' }}>{mostrarDato(op.observacionesCobrar)}</span>;
      default: return '-';
    }
  };

  const exportarExcel = async () => {
    if (operacionesFiltradas.length === 0) return alert("No hay datos para exportar.");
    const columnasVisibles = columnasTabla.filter(c => c.visible);
    await cargarCatalogosSiEsNecesario();

    const datosExcel = operacionesFiltradas.map(op => {
      const fila: any = {};
      columnasVisibles.forEach(col => {
        let val: any = '-';
        switch (col.id) {
          case 'ref': val = op.ref || op.id?.substring(0,6) || ''; break;
          case 'fechaServicio': val = op.fechaServicio || ''; break;
          case 'fechaCita': val = formatearFechaHora(op.fechaCita); break;
          case 'tipoOperacion': val = mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', op.tipoOperacionNombre); break;
          case 'status': val = mostrarDatoMapeado(op.status, 'statusServicio', 'nombre', op.statusNombre); break; 
          case 'trafico': val = op.trafico || ''; break;
          case 'cliente': val = mostrarDatoMapeado(op.clientePaga || op.clienteId, 'empresas', 'nombre', op.clienteNombre || op.nombreCliente); break;
          case 'convenioTarifa': val = obtenerNombreConvenioCliente(op.convenio, op.convenioNombre); break;
          case 'refCliente': val = op.refCliente || ''; break;
          case 'facturadoEnCobrar': val = mostrarDatoMapeado(op.facturadoEnCobrar, 'catalogoMoneda', 'moneda', op.monedaCobroNombre); break;
          case 'montoConvenioCliente': val = Number(op.montoConvenioCliente) || 0; break;
          case 'cargosAdicionales': val = Number(op.cargosAdicionales) || 0; break;
          case 'subtotal': val = Number(op.subtotalCliente) || 0; break;
          case 'tipoCambioAprobado': val = op.tipoCambioAprobado || ''; break;
          case 'dolaresCliente': val = Number(op.dolaresCliente) || 0; break;
          case 'pesosCliente': val = Number(op.pesosCliente) || 0; break;
          case 'conversionCliente': val = Number(op.conversionCliente) || 0; break;
          case 'origen': val = mostrarDatoMapeado(op.origen, 'empresas', 'nombre', op.origenNombre); break;
          case 'destino': val = mostrarDatoMapeado(op.destino, 'empresas', 'nombre', op.destinoNombre); break;
          case 'remolque': val = mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'nombre', op.remolqueNombre); break;
          case 'proveedor': val = mostrarDatoMapeado(op.proveedorUnidad, 'empresas', 'nombre', op.proveedorUnidadNombre); break;
          case 'unidadProveedor': val = op.unidadProveedor || ''; break;
          case 'operadorProveedor': val = op.operadorProveedor || ''; break;
          case 'convenioProv': val = obtenerNombreConvenioProv(op.convenioProveedor, op.convenioProveedorNombre); break;
          case 'facturadoEnUnidad': val = mostrarDatoMapeado(op.facturadoEnUnidad, 'catalogoMoneda', 'moneda', op.monedaUnidadNombre); break;
          case 'monedaConvenioProv': val = mostrarDatoMapeado(op.monedaConvenioProv, 'catalogoMoneda', 'moneda', op.monedaConvProvNombre); break;
          case 'totalAPagarProv': val = Number(op.totalAPagarProv) || 0; break;
          case 'cargosAdicionalesProv': val = Number(op.cargosAdicionalesProv) || 0; break;
          case 'subtotalProv': val = Number(op.subtotalProv) || 0; break;
          case 'dolaresProv': val = Number(op.dolaresProv) || 0; break;
          case 'pesosProv': val = Number(op.pesosProv) || 0; break;
          case 'conversionProv': val = Number(op.conversionProv) || 0; break;
          case 'unidad': val = mostrarDatoMapeado(op.unidad, 'unidades', 'unidad', op.unidadNombre); break;
          case 'operador': val = mostrarDatoMapeado(op.operador, 'empleados', 'nombre', op.operadorNombre); break;
          case 'sueldoOperador': val = Number(op.sueldoOperador) || 0; break;
          case 'sueldoExtra': val = Number(op.sueldoExtra) || 0; break;
          case 'sueldoTotal': val = Number(op.sueldoTotal) || 0; break;
          case 'combustible': val = Number(op.combustible) || 0; break;
          case 'combustibleExtra': val = Number(op.combustibleExtra) || 0; break;
          case 'combustibleTotal': val = Number(op.combustibleTotal) || 0; break;
          case 'clienteMercancia': val = mostrarDatoMapeado(op.clienteMercancia, 'empresas', 'nombre', op.clienteMercanciaNombre); break;
          case 'descripcionMercancia': val = op.descripcionMercancia || ''; break;
          case 'cantidad': val = op.cantidad || ''; break;
          case 'embalaje': val = mostrarDatoMapeado(op.embalaje, 'embalajes', 'nombre', op.embalajeNombre); break;
          case 'pesoKg': val = op.pesoKg || ''; break;
          case 'numDoda': val = op.numDoda || ''; break;
          case 'fechaEmisionDoda': val = op.fechaEmisionDoda || ''; break;
          case 'numeroEntrys': val = op.numeroEntrys || ''; break;
          case 'cantEntrys': val = op.cantEntrys || ''; break;
          case 'numManifiesto': val = op.numManifiesto || ''; break;
          case 'provServicios': val = mostrarDatoMapeado(op.provServicios, 'empresas', 'nombre', op.provServiciosNombre); break;
          case 'montoManifiesto': val = Number(op.montoManifiesto) || 0; break;
          case 'totalGastos': val = Number(op.totalGastos) || 0; break;
          case 'utilidadEstimada': val = Number(op.utilidadEstimada) || 0; break;
          case 'observacionesEjecutivo': val = op.observacionesEjecutivo || ''; break;
          case 'observacionesUnidad': val = op.observacionesUnidad || ''; break;
          case 'observacionesCobrar': val = op.observacionesCobrar || ''; break;
        }
        fila[col.label] = val;
      });
      return fila;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Operaciones Activas');
    XLSX.writeFile(workbook, `Operaciones_Activas_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = String(operacionViendo?.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo?.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo?.tipoOperacionNombre) || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = String(operacionViendo?.proveedorUnidadNombre || operacionViendo?.proveedorUnidad || '').toLowerCase().includes('roelca');
  
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  const evalTipoOpId = String(operacionViendo?.tipoOperacionId || '').trim();
  const DOCS_POR_TIPO: Record<string, string[]> = {
    '3e5b0035': ['checklist', 'solicitud'],
  };
  const docsPermitidos = DOCS_POR_TIPO[evalTipoOpId] || null;
  const puedeMostrarDoc = (doc: string) => !docsPermitidos || docsPermitidos.includes(doc);

  const refOperacionViendo = operacionViendo ? (operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'Operacion') : '';

  const btnSecondaryActionStyle = { background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', gap: '8px', fontWeight: 'bold', transition: 'background 0.2s', fontSize: '0.85rem' };
  const btnDocStyle = { background: 'transparent', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px12px', borderRadius: '6px', gap: '6px', fontSize: '0.85rem', transition: 'all 0.2s' };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioOperacion 
          estado={estadoFormulario} initialData={operacionEditando}
          onClose={() => { setEstadoFormulario('cerrado'); setOperacionEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} onRestore={() => setEstadoFormulario('abierto')}
          catalogosCacheados={catalogosGlobales} 
          onSave={handleOperacionGuardada}
        />
      )}

     <div style={{ width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '0 0 24px 0' }}>
          <EmpresaBrand tamanoLogo={36} />
          <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: 0, fontWeight: 'bold' }}>
            Operaciones Activas
          </h1>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9' }}>
              <option>Filtro: Todo</option>
            </select>
          </div>
          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Buscar por Ref, Cliente, Status..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '280px' }}>
            <button className="btn btn-outline" onClick={() => setModalColumnas(true)} style={{ fontSize: '0.9rem', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px' }} title="Configurar Columnas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button className="btn btn-outline" onClick={forzarRecarga} style={{ fontSize: '0.9rem', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '6px' }} title="Recargar Catálogos (pide confirmación)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 0 20.49 15"></path></svg>
            </button>
            <button className="btn btn-outline" onClick={exportarExcel} style={{ display: 'flex', alignItems: 'center', padding: '8px 12px' }} title="Exportar a Excel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button className="btn btn-primary" onClick={handleNuevo} style={{ display: 'flex', alignItems: 'center', padding: '8px 16px', gap: '6px' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            {cargandoOperaciones ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones activas...</div>
            ) : (
              <table className="data-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px', width: '100px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>
                      Acciones
                    </th>
                    {columnasTabla.filter(c => c.visible).map(col => (
                      <th key={`th_${col.id}`} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {operacionesEnPantalla.length === 0 ? (
                    <tr><td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Sin resultados.</td></tr>
                  ) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button type="button" title="Editar Operación"
                              onClick={(e) => { e.stopPropagation(); editarOperacion(op); }} 
                              style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                            </button>
                            <button type="button" title="Ver Documentos"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setMostrarDocumentos(true); }}
                              style={{ background: 'transparent', border: '1px solid #fb923c', borderRadius: '4px', color: '#fb923c', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                            </button>
                            <button type="button" title="Eliminar Operación"
                              onClick={(e) => { e.stopPropagation(); eliminarOperacion(op.id); }} 
                              style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        {columnasTabla.filter(c => c.visible).map(col => (
                          <td key={`cell_${op.id}_${col.id}`} style={{ padding: '16px', whiteSpace: 'nowrap' }}>
                            {renderCellContent(op, col.id)}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>

          {operacionesFiltradas.length > 0 && !cargandoOperaciones && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesFiltradas.length)} de {operacionesFiltradas.length} operaciones activas
                {hayMasOperaciones && <span style={{ color: '#8b949e', marginLeft: 8, fontStyle: 'italic' }}>(hay más en el servidor)</span>}
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {hayMasOperaciones && (
                  <button
                    onClick={cargarMasOperaciones}
                    disabled={cargandoMas}
                    style={{ padding: '6px 14px', backgroundColor: cargandoMas ? '#0d1117' : '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: cargandoMas ? 'wait' : 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                    title="Descargar 50 operaciones más desde Firestore"
                  >
                    {cargandoMas ? 'Cargando...' : '+ Cargar más (50)'}
                  </button>
                )}
                <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {modalColumnas && (
        <div className="modal-overlay" style={{ zIndex: 2000, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', backdropFilter: 'blur(4px)' }}>
          <div style={{ backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', width: '1000px', maxWidth: '95%', padding: '24px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '12px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Configurar Columnas</h3>
              <button onClick={() => setModalColumnas(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '24px' }}>Arrastra los campos para reordenarlos. Desmarca los que desees ocultar de la tabla principal y del reporte de Excel.</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
              {columnasTabla.map((col, idx) => (
                <li key={col.id} draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab', transition: 'background-color 0.2s' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} style={{ cursor: 'pointer', transform: 'scale(1.2)' }} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px', borderTop: '1px solid #30363d', paddingTop: '16px' }}>
              <button onClick={() => setModalColumnas(false)} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {operacionViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '1100px', maxHeight: '94vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            
           <div className="form-header" style={{ padding: '16px 32px 0 32px', borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                 <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.5px' }}>Detalle de Operación</h2>
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: '#D84315', fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '0.5px' }}>
                      {operacionViendo.ref || operacionViendo.id?.substring(0,6)}
                    </span>
                    <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.15)', color: '#10b981', padding: '4px 12px', borderRadius: '12px', fontSize: '0.85rem', border: '1px solid rgba(16, 185, 129, 0.3)', fontWeight: 'bold' }}>
                      {mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button onClick={() => setMostrarDocumentos(true)} title="Ver / Subir Documentos" style={{ ...btnSecondaryActionStyle, color: '#fb923c', borderColor: 'rgba(251, 146, 60, 0.4)' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#30363d'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21262d'}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                    Documentos
                  </button>
                  <button onClick={verHistorial} title="Ver Bitácora (Historial)" style={btnSecondaryActionStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#30363d'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#21262d'}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    Bitácora
                  </button>
                  <div style={{ width: '1px', height: '24px', backgroundColor: '#30363d', margin: '0 8px' }}></div>
                  <button onClick={() => setOperacionViendo(null)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#f0f6fc'} onMouseLeave={(e) => e.currentTarget.style.color = '#8b949e'}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 0 10px 0', borderTop: '1px solid #30363d', flexWrap: 'wrap' }}>
                <span style={{ color: '#8b949e', fontSize: '0.7rem', fontWeight: 'bold', letterSpacing: '1px', marginRight: '4px' }}>SIGUIENTE PASO</span>
                {botonesDisponibles.length > 0 ? (
                  <>
                    {botonesDisponibles.map((botonStr: string) => {
                      const esExitoso = ultimoStatusGuardado === botonStr;
                      return (
                        <button key={botonStr} onClick={() => registrarStatusRapido(botonStr)} disabled={guardandoStatusRapido !== null} className="status-pill"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '6px 18px 6px 6px', borderRadius: '999px', border: 'none',
                            background: esExitoso ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)',
                            color: '#fff', cursor: guardandoStatusRapido && !esExitoso ? 'wait' : 'pointer', fontWeight: 600, fontSize: '0.9rem',
                            boxShadow: esExitoso ? '0 4px 14px rgba(16, 185, 129, 0.4)' : '0 4px 14px rgba(234, 88, 12, 0.35)',
                            transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                            opacity: guardandoStatusRapido && !esExitoso && guardandoStatusRapido !== botonStr ? 0.4 : 1, position: 'relative', overflow: 'hidden' }}
                          title={`Marcar como: ${botonStr}`}>
                          <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {esExitoso ? (
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'pop 0.3s ease-out' }}>
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="9 18 15 12 9 6"></polyline>
                              </svg>
                            )}
                          </span>
                          <span style={{ whiteSpace: 'nowrap' }}>{botonStr}</span>
                        </button>
                      );
                    })}
                    <button onClick={abrirRegistroHorario} className="status-circle-btn"
                      style={{ width: 36, height: 36, borderRadius: '50%', background: '#21262d', border: '1px solid #30363d', color: '#8b949e',
                        cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s ease', flexShrink: 0 }}
                      title="Registrar con fecha/hora distinta (retroactivo)">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                        <line x1="16" y1="2" x2="16" y2="6"></line>
                        <line x1="8" y1="2" x2="8" y2="6"></line>
                        <line x1="3" y1="10" x2="21" y2="10"></line>
                      </svg>
                    </button>
                  </>
                ) : (
                  <>
                    <span style={{ color: '#8b949e', fontSize: '0.85rem', fontStyle: 'italic', marginRight: '8px' }}>
                      No hay transiciones automáticas configuradas.
                    </span>
                    <button onClick={abrirRegistroHorario} className="status-pill"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', padding: '6px 18px 6px 6px', borderRadius: '999px', border: 'none',
                        background: 'linear-gradient(135deg, #ea580c 0%, #c2410c 100%)', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                        boxShadow: '0 4px 14px rgba(234, 88, 12, 0.35)', transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)' }}
                      title="Registrar status manualmente">
                      <span style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.22)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                      </span>
                      Registrar Status
                    </button>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderTop: '1px solid #30363d', marginTop: '4px', flexWrap: 'wrap' }}>
                <span style={{ color: '#8b949e', fontSize: '0.75rem', fontWeight: 'bold', letterSpacing: '0.5px', marginRight: '8px' }}>GENERAR DOCUMENTOS:</span>
                {(docsPermitidos ? puedeMostrarDoc('carta') : evalIsFletes) && (
                  <button onClick={handleDescargarCartaInstrucciones} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Carta Instrucciones
                  </button>
                )}
                {(docsPermitidos ? puedeMostrarDoc('prueba') : evalIsFletes) && (
                  <button onClick={handleDescargarPruebaEntrega} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Prueba Entrega
                  </button>
                )}
                {puedeMostrarDoc('checklist') && (
                  <button onClick={handleDescargarCheckList} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Check List
                  </button>
                )}
                {puedeMostrarDoc('solicitud') && (
                  <button onClick={handleDescargarSolicitudRetiro} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Solicitud Retiro
                  </button>
                )}
                {puedeMostrarDoc('instrucciones') && (
                  <button onClick={handleDescargarInstruccionesServicio} style={btnDocStyle} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    Instrucciones Serv.
                  </button>
                )}
              </div>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 32px', overflowX: 'auto', flexShrink: 0 }}>
              {tabsDetalle.map(tab => (
                <button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)}
                  style={{ padding: '12px 16px', background: 'none', border: 'none',
                    borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent',
                    color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
                    fontWeight: pestañaDetalleActiva === tab.id ? '600' : 'normal', fontSize: '0.95rem', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="detail-content" style={{ padding: '18px 32px', overflowY: 'auto', flex: 1 }}>
              
              {pestañaDetalleActiva === 'general' && (
                <div style={{ animation: 'fadeIn 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Operación</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion', operacionViendo.tipoOperacionNombre)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Servicio / Status</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.fechaServicio)} <span style={{color: '#30363d', margin: '0 8px'}}>|</span> <span style={{color: '#10b981', fontWeight: 'bold'}}>{mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre', operacionViendo.statusNombre)}</span></span>
                  </div>
                  {evalIsFletes ? (
                     <div>
                       <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Cita</span>
                       <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatearFechaHora(operacionViendo.fechaCita)}</span>
                     </div>
                  ) : (<div></div>)}
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Paga)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.clientePaga || operacionViendo.clienteId, 'empresas', 'nombre', operacionViendo.clienteNombre || operacionViendo.nombreCliente)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio (Tarifa)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{obtenerNombreConvenioCliente(operacionViendo.convenio, operacionViendo.convenioNombre)}</span> 
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Remolque</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.numeroRemolque, 'remolques', 'nombre', operacionViendo.remolqueNombre)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Ref Cliente</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.refCliente)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Origen</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Destino</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.destino, 'empresas', 'nombre', operacionViendo.destinoNombre)}</span></div>
                  <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Observaciones Ejecutivo</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>
                      {mostrarDato(operacionViendo.observacionesEjecutivo)}
                    </div>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'pedimento' && (
                <div style={{ animation: 'fadeIn 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 2' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Mercancía)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas', 'nombre', operacionViendo.clienteMercanciaNombre)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Descripción de la Mercancía</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.descripcionMercancia)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad (Enteros)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.cantidad)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Embalaje</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.embalaje, 'embalajes', 'nombre', operacionViendo.embalajeNombre)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Peso (Kg) Decimales</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.pesoKg)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># DODA</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.numDoda)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Emisión (DODA)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.fechaEmisionDoda)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'manifiestos' && (
                <div style={{ animation: 'fadeIn 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Entry's</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.numeroEntrys)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cantidad de Entry's</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.cantEntrys)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># Manifiesto</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.numManifiesto)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Servicios</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.provServicios, 'empresas', 'nombre', operacionViendo.provServiciosNombre)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Costo Manifiesto ($)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: 'bold', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.montoManifiesto)}</span>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'unidad' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                    <div style={{ gridColumn: 'span 3' }}>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Proveedor de Transporte</span>
                      <span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas', 'nombre', operacionViendo.proveedorUnidadNombre)}</span>
                    </div>
                  </div>

                  <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '12px', border: '1px solid #30363d', marginBottom: '24px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '16px' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Facturado En:</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio Proveedor</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{obtenerNombreConvenioProv(operacionViendo.convenioProveedor, operacionViendo.convenioProveedorNombre)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Moneda del Convenio (Base)</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.monedaConvenioProv)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d', marginBottom: '16px' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Monto a Pagar (Base)</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.totalAPagarProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Costos Adicionales</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.cargosAdicionalesProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Subtotal (Convenio + Costos)</span>
                        <span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.subtotalProv)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Dólares</span>
                        <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.dolaresProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Pesos</span>
                        <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.pesosProv)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#f85149', fontWeight: 'bold', marginBottom: '4px' }}>Conversión Final (Gasto)</span>
                        <span style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.conversionProv)}</span>
                      </div>
                    </div>
                  </div>

                  {showDetailInternalFleet && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#f0f6fc', margin: '0 0 8px 0' }}>Flota Operativa (Roelca)</h4></div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Unidad Asignada</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.unidad, 'unidades', 'unidad', operacionViendo.unidadNombre)}</span>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Operador Asignado</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDatoMapeado(operacionViendo.operador, 'empleados', 'nombre', operacionViendo.operadorNombre)}</span>
                      </div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo del Operador</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.sueldoOperador)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo Extra</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.sueldoExtra)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Sueldo Total</span>
                        <span style={{ color: '#f0f6fc', fontWeight: 'bold', backgroundColor: '#161b22', padding: '6px 10px', borderRadius: '4px', border: '1px solid #30363d', display: 'inline-block' }}>{formatoMoneda(operacionViendo.sueldoTotal)}</span>
                      </div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Combustible</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.combustible)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Combustible Extra</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.combustibleExtra)}</span>
                      </div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Total Combustible</span>
                        <span style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.combustibleTotal)}</span>
                      </div>
                    </div>
                  )}

                  {showDetailExternalFleet && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#58a6ff', margin: '0 0 8px 0' }}>Flota Externa (Proveedor)</h4></div>
                      <div>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Unidad Externa</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.unidadProveedor)}</span>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Operador Externo</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.operadorProveedor)}</span>
                      </div>
                    </div>
                  )}

                  <div style={{ gridColumn: 'span 3', marginTop: '20px' }}>
                    <div style={{ backgroundColor: '#0d1117', border: '1px solid #f85149', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                      <div style={{ color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Total Gastos [Sueldos + Manifiesto]</div>
                      <div style={{ color: '#f85149', fontSize: '2rem', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.totalGastos)}</div>
                    </div>
                  </div>

                  <div style={{ marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px' }}>Observaciones (Unidad / Proveedor)</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>
                      {mostrarDato(operacionViendo.observacionesUnidad)}
                    </div>
                  </div>
                </div>
              )}

              {pestañaDetalleActiva === 'cobrar' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '24px' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Facturado En:</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.facturadoEnCobrar)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Moneda Convenio (Cliente)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarMoneda(operacionViendo.monedaConvenioCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio Seleccionado (Base)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.montoConvenioCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cargos Adicionales</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatoMoneda(operacionViendo.cargosAdicionales)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Subtotal (Convenio + Cargos)</span>
                      <span style={{ color: '#c9d1d9', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.subtotalCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Cambio del Día</span>
                      <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.tipoCambioAprobado)}</span>
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingBottom: '24px', borderBottom: '1px solid #30363d' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Dólares (Cliente)</span>
                      <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.dolaresCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Pesos (Cliente)</span>
                      <span style={{ color: '#3b82f6', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.pesosCliente)}</span>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Conversión Final (Ingreso)</span>
                      <span style={{ color: '#D84315', fontWeight: 'bold', fontSize: '1.1rem' }}>{formatoMoneda(operacionViendo.conversionCliente)}</span>
                    </div>
                  </div>

                  <div style={{ marginTop: '24px', padding: '24px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '12px', textAlign: 'center' }}>
                    <span style={{ display: 'block', fontSize: '0.9rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: '8px' }}>Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                    <span style={{ fontSize: '2.5rem', color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.utilidadEstimada)}</span>
                  </div>

                  <div style={{ marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '8px' }}>Observaciones (Facturación / Cobro)</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>
                      {mostrarDato(operacionViendo.observacionesCobrar)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="form-actions detail-actions" style={{ padding: '12px 32px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline" style={{ padding: '10px 32px', borderRadius: '6px' }}>Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {mostrarDocumentos && operacionViendo && (
        <div className="modal-overlay" style={{ zIndex: 2100 }}>
          <div className="form-card" style={{ maxWidth: '760px', width: '95%', maxHeight: '88vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '18px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#f0f6fc' }}>Documentos de la Operación</h2>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#8b949e' }}>
                  Referencia: <span style={{ color: '#fb923c', fontWeight: 600 }}>{refOperacionViendo}</span>
                </p>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setMostrarSubirDocOp(true)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Subir Documento
                </button>
                <button onClick={() => setMostrarDocumentos(false)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }} title="Cerrar">✕</button>
              </div>
            </div>
            <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
              <DocumentosLista coleccionOrigen="operaciones" registroId={operacionViendo.id} />
            </div>
            <div style={{ padding: '14px 24px', borderTop: '1px solid #30363d', textAlign: 'right', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
              <button onClick={() => setMostrarDocumentos(false)} className="btn btn-outline" style={{ padding: '10px 24px', borderRadius: '6px' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {operacionViendo && (
        <DocumentoUploadModal
          isOpen={mostrarSubirDocOp && !!operacionViendo}
          onClose={() => setMostrarSubirDocOp(false)}
          coleccionOrigen="operaciones"
          registroId={operacionViendo.id}
          registroNombre={refOperacionViendo}
          tiposDocumento={TIPOS_DOCUMENTO_OPERACION}
        />
      )}

      {modalHorarios === 'registrar' && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="form-card" style={{ maxWidth: '450px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '20px 24px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#f0f6fc' }}>Registrar Movimiento (Fecha Personalizada)</h2>
              <button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button>
            </div>
            <div style={{ padding: '24px' }}>
              <p style={{ color: '#8b949e', fontSize: '0.85rem', marginBottom: '16px' }}>
                Usa este formulario solo si necesitas registrar un movimiento con una fecha y hora distinta a la actual.
              </p>
              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e' }}>Fecha y Hora</label>
                <input type="datetime-local" className="form-control" value={nuevaFechaHora} onChange={e => setNuevaFechaHora(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label" style={{ color: '#8b949e' }}>Estatus / Hito</label>
                <select className="form-control" value={nuevoStatus} onChange={e => setNuevoStatus(e.target.value)}>
                  <option value="">-- Selecciona un status --</option>
                  {botonesDisponibles.length > 0 ? (
                    botonesDisponibles.map((botonStr: string) => (
                      <option key={botonStr} value={botonStr}>{botonStr}</option>
                    ))
                  ) : (
                    (catalogosGlobales.statusServicio || [])
                      .filter((s: any) => s.nombre) 
                      .map((s: any) => (
                        <option key={s.id} value={s.nombre}>{s.nombre}</option>
                      ))
                  )}
                </select>
              </div>
              <button onClick={guardarHorario} disabled={cargandoHorarios} className="btn btn-primary" style={{ width: '100%', marginTop: '24px', padding: '12px', borderRadius: '6px', fontWeight: 'bold' }}>
                {cargandoHorarios ? 'Actualizando...' : 'Guardar y Actualizar Operación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalHorarios === 'historial' && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="form-card" style={{ maxWidth: '650px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '20px 24px' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#f0f6fc' }}>Bitácora de Movimientos</h2>
              <button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button>
            </div>
            <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
              {cargandoHorarios ? (
                <div style={{ textAlign: 'center', color: '#8b949e', padding: '20px' }}>Descargando historial...</div>
              ) : (
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ backgroundColor: '#161b22', color: '#8b949e' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #30363d' }}>Fecha y Hora</th>
                      <th style={{ padding: '12px', textAlign: 'left', borderBottom: '1px solid #30363d' }}>Estatus Marcado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historialList.length === 0 ? (
                      <tr><td colSpan={2} style={{ textAlign: 'center', padding: '20px', color: '#8b949e' }}>Sin movimientos registrados.</td></tr>
                    ) : (
                      historialList.map((h: any) => (
                        <tr key={h.id} style={{ borderBottom: '1px solid #21262d' }}>
                          <td style={{ padding: '16px 12px', color: '#c9d1d9' }}>{new Date(h.fechaHora).toLocaleString('es-MX')}</td>
                          <td style={{ padding: '16px 12px', color: '#10b981', fontWeight: 'bold' }}>{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre', h.statusNombre)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', textAlign: 'right', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px' }}>
              <button onClick={() => setModalHorarios('cerrado')} className="btn btn-outline" style={{ padding: '10px 24px', borderRadius: '6px' }}>Cerrar Historial</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pop {
          0%   { transform: scale(0); opacity: 0; }
          60%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .status-pill { transform: translateY(0); }
        .status-pill:not(:disabled):hover {
          transform: translateY(-2px);
          filter: brightness(1.08);
          box-shadow: 0 8px 20px rgba(234, 88, 12, 0.5) !important;
        }
        .status-pill:not(:disabled):active { transform: translateY(0); filter: brightness(0.95); }
        .status-circle-btn:hover {
          background: #30363d !important;
          color: #ea580c !important;
          border-color: #ea580c !important;
          transform: scale(1.08);
        }
      `}</style>
    </div>
  );
};

export default OperacionesDashboard;
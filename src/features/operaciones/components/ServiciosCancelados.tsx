// src/features/operaciones/components/ServiciosCancelados.tsx
import { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF, setLogoPdf } from '../../../utils/pdfGenerator'; 
// ✅ NUEVO: visor y subida de documentos ligados a la operación
import { TIPOS_DOCUMENTO_OPERACION } from './FormularioOperacion';
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
// ✅ NUEVO: logo + nombre de la empresa (lee de la configuración)
import { EmpresaBrand } from '../../configuracion/EmpresaBrand';
import { useEmpresaConfig } from '../../configuracion/useEmpresaConfig';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// ID hex del status "Cancelado" en catalogo_status_servicio
const STATUS_CANCELADO_ID = '7607f692';

const ServiciosCancelados = () => {
  // ✅ NUEVO: logo de la empresa para los PDFs generados desde este módulo
  const { config: empresaConfig } = useEmpresaConfig();

  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(true);
  const [operacionViendo, setOperacionViendo] = useState<any | null>(null);
  // ✅ NUEVO: mensaje de error real de carga (distinto a "no hay canceladas")
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [modalHorarios, setModalHorarios] = useState<'cerrado' | 'historial'>('cerrado');
  const [historialList, setHistorialList] = useState<any[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  // ✅ NUEVO: control del visor de documentos y del modal de subida
  const [mostrarDocumentos, setMostrarDocumentos] = useState(false);
  const [mostrarSubirDocOp, setMostrarSubirDocOp] = useState(false);
  
  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // ✅ 1. CARGA RÁPIDA: Solo trae operaciones canceladas (Desnormalizado)
  //    Robusto: si falta el índice compuesto (status + fechaServicio), hace
  //    fallback a una consulta simple (solo where) y ordena del lado del cliente.
  //    Si no hay canceladas, NO lanza error: deja la lista vacía y la UI lo informa.
  const descargarOperaciones = async () => {
    setCargandoOperaciones(true);
    setErrorCarga(null);
    try {
      let docs: any[] = [];

      try {
        // Consulta ideal (requiere índice compuesto status + fechaServicio desc)
        const queryIdeal = query(
          collection(db, 'operaciones'),
          where('status', '==', STATUS_CANCELADO_ID),
          orderBy('fechaServicio', 'desc'),
          limit(150)
        );
        const snap = await getDocs(queryIdeal);
        docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
      } catch (errIndex: any) {
        const msg = String(errIndex?.message || errIndex?.code || '').toLowerCase();
        // Si Firestore se queja por falta de índice, reintentamos sin orderBy.
        if (msg.includes('index') || msg.includes('failed-precondition')) {
          console.warn('[ServiciosCancelados] Falta índice compuesto; usando consulta simple + orden en cliente.');
          const querySimple = query(
            collection(db, 'operaciones'),
            where('status', '==', STATUS_CANCELADO_ID),
            limit(150)
          );
          const snap = await getDocs(querySimple);
          docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          docs.sort((a, b) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
        } else {
          throw errIndex;
        }
      }

      console.log(`[FIREBASE READ] Descargadas ${docs.length} operaciones canceladas.`);
      setOperacionesGlobales(docs);
    } catch (e: any) {
      console.error("Error al cargar operaciones canceladas:", e);
      setOperacionesGlobales([]);
      const msg = String(e?.message || e?.code || e || '').toLowerCase();
      if (msg.includes('resource-exhausted') || msg.includes('quota') || msg.includes('429')) {
        setErrorCarga('Se agotó la cuota de lecturas de Firestore. Se reinicia a las 2 AM (hora México). Considera activar el plan Blaze.');
      } else {
        setErrorCarga('Hubo un problema al cargar las operaciones canceladas. Verifica tu conexión e inténtalo de nuevo.');
      }
    }
    setCargandoOperaciones(false);
  };

  // ✅ 2. CARGA PEREZOSA DE CATÁLOGOS (Solo cuando se necesitan para PDFs)
  const cargarCatalogosSiEsNecesario = async () => {
    if (Object.keys(catalogosGlobales).length > 0) return; 

    const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v2');
    if (cacheCatStr) {
      setCatalogosGlobales(JSON.parse(cacheCatStr));
      return;
    }

    console.warn(`[FIREBASE READ] Descargando catálogos pesados por primera vez...`);
    const [empSnap, opSnap, embSnap, remSnap, tarSnap, convProvSnap, convProvDetSnap, tcSnap, convCliSnap, convDetSnap, uniSnap, operSnap, statusSnap, uniProvSnap, opeProvSnap] = await Promise.all([
      getDocs(collection(db, 'empresas')),
      getDocs(collection(db, 'catalogo_tipo_operacion')),
      getDocs(collection(db, 'catalogo_embalaje')),
      getDocs(collection(db, 'remolques')),
      getDocs(collection(db, 'catalogo_tarifas_referencia')), 
      getDocs(collection(db, 'convenios_proveedores')),
      getDocs(collection(db, 'convenios_proveedores_detalles')), 
      getDocs(collection(db, 'tipo_cambio')),
      getDocs(collection(db, 'convenios_clientes')),
      getDocs(collection(db, 'convenios_clientes_detalles')),
      getDocs(collection(db, 'unidades')),
      getDocs(collection(db, 'empleados')),
      getDocs(collection(db, 'catalogo_status_servicio')),
      getDocs(collection(db, 'unidades_proveedor')),
      getDocs(collection(db, 'proveedores_unidad'))
    ]);

    const catGuardados = {
      empresas: empSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      tiposOperacion: opSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      embalajes: embSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      remolques: remSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      tarifas: tarSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      conveniosProv: convProvSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoConvProvDetalles: convProvDetSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })), 
      catalogoTC: tcSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoConvClientes: convCliSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoConvDetalles: convDetSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      unidades: uniSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      empleados: operSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      statusServicio: statusSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      unidades_proveedor: uniProvSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      proveedores_unidad: opeProvSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    };
    
    sessionStorage.setItem('roelca_catalogos_v2', JSON.stringify(catGuardados));
    setCatalogosGlobales(catGuardados);
  };

  useEffect(() => {
    descargarOperaciones();
  }, []);

  // ✅ Logo para los PDF: si en la config hay un logo en base64 (data:...), úsalo;
  // si no, dejamos el global vacío para que el generador use el logo INCRUSTADO por
  // defecto. NO leemos la URL de Storage, para no provocar errores de CORS.
  useEffect(() => {
    const b64 = empresaConfig?.logoBase64;
    setLogoPdf(b64 && b64.startsWith('data:') ? b64 : '');
  }, [empresaConfig?.logoBase64]);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda]);
  
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

  // ✅ Función robusta para leer del catálogo si existe, o usar el dato desnormalizado
  const mostrarDatoMapeado = (id: string | null | undefined, catalogo: keyof typeof catalogosGlobales, campoRetorno: string = 'nombre', valorDesnormalizado?: string) => {
    if (valorDesnormalizado) return valorDesnormalizado; // Prioridad al valor estático de la operación
    if (!id) return '-';
    if (!catalogosGlobales[catalogo] || !Array.isArray(catalogosGlobales[catalogo])) return id;
    
    const elementoEncontrado = catalogosGlobales[catalogo].find((item: any) => item.id === id);
    if (!elementoEncontrado) return id;

    if (catalogo === 'empleados') {
      return elementoEncontrado.firstName ? `${elementoEncontrado.firstName} ${elementoEncontrado.lastNamePaternal || ''}`.trim() : elementoEncontrado.nombre || id;
    }

    return elementoEncontrado[campoRetorno] || elementoEncontrado.nombre || elementoEncontrado.descripcion || elementoEncontrado.placa || id;
  };

  const formatoMoneda = (monto: any) => {
    if (!monto) return '$ 0.00';
    return `$ ${parseFloat(monto).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  
  const verHistorial = async () => {
    setModalHorarios('historial');
    setCargandoHorarios(true);
    try {
      const q = query(collection(db, 'horarios'), where('operacionId', '==', operacionViendo.id));
      const snap = await getDocs(q);
      const data = snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
      data.sort((a: any, b: any) => new Date(b.fechaHora).getTime() - new Date(a.fechaHora).getTime());
      setHistorialList(data);
    } catch (e) {
      console.error(e);
    }
    setCargandoHorarios(false);
  };

  // ✅ PDFs: Descargan catálogos solo si se solicita generar documento
  const handleDescargarSolicitudRetiro = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origen = mostrarDatoMapeado(operacionViendo.origen, 'empresas', 'nombre', operacionViendo.origenNombre);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor 
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    generarSolicitudRetiroPDF({
      bodegaNombre: origen,
      tipoMovimiento: operacionViendo.trafico || 'N/A',
      remolqueNombre: operacionViendo.remolquePlaca || operacionViendo.remolqueNombre || (remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A'),
      remolquePlacas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
      clienteMercancia: operacionViendo.clienteMercanciaNombre || mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      unidadNombre: operacionViendo.unidadNombre || (unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal),
      unidadPlacas: unidadObj ? (unidadObj.placa || 'N/A') : 'N/A',
      empleadoNombre: operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal),
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    });
  };

  const handleDescargarInstruccionesServicio = async () => {
    await cargarCatalogosSiEsNecesario();
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor 
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    generarInstruccionesServicioPDF({
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'N/A',
      fecha: operacionViendo.fechaServicio || '',
      unidadNombre: operacionViendo.unidadNombre || (unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal),
      empleadoNombre: operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal),
      remolqueNombre: operacionViendo.remolqueNombre || (remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A'),
      remolquePlacas: operacionViendo.remolquePlaca || (remolqueObj ? remolqueObj.placa : 'N/A'),
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
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor 
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) : 'N/A';
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);
    const uniNombre = operacionViendo.unidadNombre || (unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal);
    const uniPlacas = unidadObj ? (unidadObj.placa || 'N/A') : 'N/A';

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

    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);

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

    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = operacionViendo.operadorNombre || (mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal);

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
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      origenColonia: origenObj ? (origenObj.colonia || 'N/A') : 'N/A',
      origenCP: origenObj ? (origenObj.cp || origenObj.codigoPostal || 'N/A') : 'N/A',
      destinoCiudad: destinoObj ? (destinoObj.ciudad || destinoObj.estado || 'N/A') : 'N/A',
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      destinoColonia: destinoObj ? (destinoObj.colonia || 'N/A') : 'N/A',
      destinoCP: destinoObj ? (destinoObj.cp || destinoObj.codigoPostal || 'N/A') : 'N/A',
    });
  };

  const forzarRecarga = () => {
    sessionStorage.removeItem('roelca_catalogos_v2');
    window.location.reload();
  };

  // ✅ FILTRO BASADO EN TEXTOS DESNORMALIZADOS
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

  const exportarCSV = () => {
    if (operacionesFiltradas.length === 0) return alert("No hay datos para exportar.");
    const encabezados = ['# Ref', 'Fecha', 'Tipo de Operación', 'Status', 'Convenio (Tarifa)', '# de Remolque', 'Proveedor', 'Unidad', 'Cliente (Paga)', 'Convenio (Prov)', 'Cargos Adicionales', 'Subtotal'];
    const lineas = operacionesFiltradas.map(op => [
      `"${op.ref || op.id?.substring(0,6) || ''}"`, 
      `"${op.fechaServicio || ''}"`, 
      `"${op.tipoOperacionNombre || op.tipoOperacionId || ''}"`, 
      `"${op.statusNombre || op.status || ''}"`, 
      `"${op.convenioNombre || op.convenio || ''}"`, 
      `"${op.remolquePlaca || op.numeroRemolque || ''}"`, 
      `"${op.proveedorUnidadNombre || op.proveedorUnidad || ''}"`, 
      `"${op.unidadNombre || op.unidad || ''}"`, 
      `"${op.clienteNombre || op.nombreCliente || ''}"`, 
      `"${op.convenioProveedorNombre || op.convenioProveedor || ''}"`, 
      `"${formatoMoneda(op.cargosAdicionales)}"`, 
      `"${formatoMoneda(op.subtotalCliente)}"`
    ].join(','));
    const csvContent = [encabezados.join(','), ...lineas].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Servicios_Cancelados_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = String(operacionViendo?.tipoOperacionNombre || operacionViendo?.tipoOperacionId || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = String(operacionViendo?.proveedorUnidadNombre || operacionViendo?.proveedorUnidad || '').toLowerCase().includes('roelca');
  
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  // ✅ Referencia legible de la operación en curso (carpeta de Storage)
  const refOperacionViendo = operacionViendo ? (operacionViendo.ref || operacionViendo.id?.substring(0, 6) || 'Operacion') : '';

  // ✅ Estado vacío real: terminó de cargar, sin error y sin canceladas
  const sinCanceladas = !cargandoOperaciones && !errorCarga && operacionesGlobales.length === 0;

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
     <div style={{ width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '0 0 24px 0' }}>
          <EmpresaBrand tamanoLogo={36} />
          <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#ef4444', margin: 0, fontWeight: 'bold' }}>🚫 Servicios Cancelados</h1>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '10px', borderRadius: '6px' }}><option>Filtro: Todo</option></select>
          </div>
          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Buscar por Ref, Cliente, Status..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '280px' }}>
            <button className="btn btn-outline" onClick={forzarRecarga} title="Recargar Catálogos" style={{ background: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 0 20.49 15"></path></svg>
            </button>
            <button className="btn btn-outline" onClick={exportarCSV} title="Exportar CSV" style={{ background: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', display: 'flex', alignItems: 'center', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>
        </div>
        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          {cargandoOperaciones ? (
            <div style={{ border: '1px solid #30363d', borderRadius: '8px', padding: '60px 24px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones canceladas...</div>
          ) : errorCarga ? (
            <div style={{ border: '1px solid rgba(248,81,73,0.4)', backgroundColor: 'rgba(248,81,73,0.06)', borderRadius: '8px', padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: '8px' }}>⚠️</div>
              <div style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1.05rem', marginBottom: '8px' }}>No se pudieron cargar las operaciones</div>
              <div style={{ color: '#8b949e', fontSize: '0.9rem', maxWidth: '520px', margin: '0 auto 16px' }}>{errorCarga}</div>
              <button onClick={descargarOperaciones} style={{ padding: '8px 18px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>Reintentar</button>
            </div>
          ) : sinCanceladas ? (
            <div style={{ border: '1px dashed #30363d', borderRadius: '8px', padding: '60px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: '2.4rem', marginBottom: '10px' }}>📭</div>
              <div style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '6px' }}>No existen servicios cancelados</div>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Cuando una operación se marque como cancelada aparecerá aquí.</div>
            </div>
          ) : (
          <>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
              <table className="data-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr>
                    <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># Ref</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Fecha</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Tipo de Operación</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Status</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Convenio (Tarifa)</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># Remolque</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Proveedor</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Unidad</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Cliente (Paga)</th>
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {operacionesEnPantalla.length === 0 ? (<tr><td colSpan={11} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Sin resultados para tu búsqueda.</td></tr>) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              type="button" 
                              title="Ver Detalles"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setPestañaDetalleActiva('general'); }}
                              style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button 
                              type="button" 
                              title="Ver Documentos"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setMostrarDocumentos(true); }}
                              style={{ background: 'transparent', border: '1px solid #fb923c', borderRadius: '4px', color: '#fb923c', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                            </button>
                          </div>
                        </td>
                        <td style={{ padding: '16px', color: '#58a6ff', fontWeight: 'bold', fontFamily: 'monospace' }}>{op.ref || op.id?.substring(0,6)}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.fechaServicio}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.tipoOperacionNombre || op.tipoOperacionId || '-'}</td>
                        <td style={{ padding: '16px', color: '#ef4444', fontWeight: 'bold' }}>{op.statusNombre || op.status || '-'}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.convenioNombre || op.convenio || '-'}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.remolquePlaca || op.numeroRemolque || '-'}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.proveedorUnidadNombre || op.proveedorUnidad || '-'}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{op.unidadNombre || op.unidad || '-'}</td>
                        <td style={{ padding: '16px', color: '#f0f6fc', fontWeight: '500' }}>{op.clienteNombre || op.nombreCliente || op.clientePaga || '-'}</td>
                        <td style={{ padding: '16px', color: '#c9d1d9' }}>{formatoMoneda(op.subtotalCliente)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
          </div>
          {operacionesFiltradas.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesFiltradas.length)} de {operacionesFiltradas.length} operaciones canceladas</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button 
                  title="Página Siguiente"
                  onClick={irPaginaSiguiente} 
                  disabled={paginaActual === totalPaginas || totalPaginas === 0}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>
      {operacionViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '1100px', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            <div className="form-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: 'none' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem' }}>Detalle de Servicio Cancelado <span style={{ color: '#ef4444', marginLeft: '12px' }}>{operacionViendo.ref || operacionViendo.id?.substring(0,6)}</span></h2>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
                
                {evalIsFletes && (
                  <>
                    <button onClick={handleDescargarCartaInstrucciones} title="Descargar Carta de Instrucciones" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                      📄 Carta Instrucciones
                    </button>
                    <button onClick={handleDescargarPruebaEntrega} title="Descargar Prueba de Entrega" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                      📄 Prueba Entrega
                    </button>
                  </>
                )}

                <button onClick={handleDescargarCheckList} title="Descargar Check List" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                  📄 Check List
                </button>
                <button onClick={handleDescargarSolicitudRetiro} title="Descargar Solicitud de Retiro" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                  📄 Solicitud
                </button>
                <button onClick={handleDescargarInstruccionesServicio} title="Descargar Instrucciones de Servicio" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>
                  📄 Instrucciones
                </button>

                <button onClick={() => setMostrarDocumentos(true)} title="Ver / Subir Documentos" style={{ background: '#21262d', border: '1px solid rgba(251, 146, 60, 0.4)', color: '#fb923c', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>📎 Documentos</button>
                <button onClick={verHistorial} style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '8px' }}>📋 Bitácora</button>
                <button onClick={() => setOperacionViendo(null)} className="btn-window close" style={{ padding: '6px', borderRadius: '50%' }}>✕</button>
              </div>
            </div>
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px', overflowX: 'auto' }}>
              {tabsDetalle.map(tab => (<button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)} style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer' }}>{tab.label}</button>))}
            </div>
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {pestañaDetalleActiva === 'general' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Tipo</span><span>{operacionViendo.tipoOperacionNombre || operacionViendo.tipoOperacionId || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Fecha / Status</span><span>{mostrarDato(operacionViendo.fechaServicio)} | <span style={{color: '#ef4444'}}>{operacionViendo.statusNombre || operacionViendo.status || '-'}</span></span></div>
                  {evalIsFletes && (<div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Fecha de Cita</span><span>{formatearFechaHora(operacionViendo.fechaCita)}</span></div>)}
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cliente (Paga)</span><span>{mostrarDato(operacionViendo.clienteNombre || operacionViendo.nombreCliente || operacionViendo.clientePaga)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio (Tarifa)</span><span>{operacionViendo.convenioNombre || operacionViendo.convenio || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># de Remolque</span><span>{operacionViendo.remolquePlaca || operacionViendo.numeroRemolque || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Ref Cliente</span><span>{mostrarDato(operacionViendo.refCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Origen</span><span>{operacionViendo.origenNombre || operacionViendo.origen || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Destino</span><span>{operacionViendo.destinoNombre || operacionViendo.destino || '-'}</span></div>
                  <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Observaciones Ejecutivo</span><div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>{mostrarDato(operacionViendo.observacionesEjecutivo)}</div></div>
                </div>
              )}
              {pestañaDetalleActiva === 'pedimento' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cliente (Mercancía)</span><span>{operacionViendo.clienteMercanciaNombre || operacionViendo.clienteMercancia || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Descripción de la Mercancía</span><span>{mostrarDato(operacionViendo.descripcionMercancia)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cantidad</span><span>{mostrarDato(operacionViendo.cantidad)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Embalaje</span><span>{operacionViendo.embalajeNombre || operacionViendo.embalaje || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Peso (Kg)</span><span>{mostrarDato(operacionViendo.pesoKg)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># DODA</span><span>{mostrarDato(operacionViendo.numDoda)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Fecha DODA</span><span>{mostrarDato(operacionViendo.fechaEmisionDoda)}</span></div>
                </div>
              )}
              {pestañaDetalleActiva === 'manifiestos' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># de Entry's</span><span>{mostrarDato(operacionViendo.numeroEntrys)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cant. Entry's</span><span>{mostrarDato(operacionViendo.cantEntrys)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># Manifiesto</span><span>{mostrarDato(operacionViendo.numManifiesto)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Prov. Servicios</span><span>{operacionViendo.provServiciosNombre || operacionViendo.provServicios || '-'}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Costo Manifiesto</span><span>{formatoMoneda(operacionViendo.montoManifiesto)}</span></div>
                </div>
              )}
              {pestañaDetalleActiva === 'unidad' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 3' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Prov. Transporte</span><span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{operacionViendo.proveedorUnidadNombre || operacionViendo.proveedorUnidad || '-'}</span></div>
                  <div style={{ gridColumn: 'span 3', backgroundColor: '#161b22', padding: '20px', borderRadius: '12px', border: '1px solid #30363d' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '16px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Facturado En:</span><span>{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio Proveedor</span><span>{operacionViendo.convenioProveedorNombre || operacionViendo.convenioProveedor || '-'}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Moneda Base</span><span>{mostrarMoneda(operacionViendo.monedaConvenioProv)}</span></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Monto (Base)</span><span>{formatoMoneda(operacionViendo.totalAPagarProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Costos Adicionales</span><span>{formatoMoneda(operacionViendo.cargosAdicionalesProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Subtotal</span><span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.subtotalProv)}</span></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', paddingTop: '16px', borderTop: '1px solid #30363d' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Dólares</span><span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.dolaresProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Pesos</span><span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.pesosProv)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#f85149', fontWeight: 'bold' }}>Conversión Final</span><span style={{ color: '#f85149', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.conversionProv)}</span></div>
                    </div>
                  </div>
                  {showDetailInternalFleet && (
                    <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#f0f6fc', margin: '0' }}>Flota Operativa (Roelca)</h4></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Unidad Asignada</span><span>{operacionViendo.unidadNombre || operacionViendo.unidad || '-'}</span></div>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Operador Asignado</span><span>{operacionViendo.operadorNombre || operacionViendo.operador || '-'}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Sueldo Operador</span><span>{formatoMoneda(operacionViendo.sueldoOperador)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Sueldo Extra</span><span>{formatoMoneda(operacionViendo.sueldoExtra)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Sueldo Total</span><span style={{ color: '#f0f6fc', fontWeight: 'bold', backgroundColor: '#161b22', padding: '6px 10px', borderRadius: '4px', border: '1px solid #30363d' }}>{formatoMoneda(operacionViendo.sueldoTotal)}</span></div>
                      <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '0' }} /></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Combustible</span><span>{formatoMoneda(operacionViendo.combustible)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Combustible Extra</span><span>{formatoMoneda(operacionViendo.combustibleExtra)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Total Combustible</span><span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.combustibleTotal)}</span></div>
                    </div>
                  )}
                  {showDetailExternalFleet && (
                    <div style={{ gridColumn: 'span 3', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                      <div style={{ gridColumn: 'span 3' }}><h4 style={{ color: '#58a6ff', margin: '0' }}>Flota Externa (Proveedor)</h4></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Unidad Externa</span><span>{mostrarDato(operacionViendo.unidadProveedor)}</span></div>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Operador Externo</span><span>{mostrarDato(operacionViendo.operadorProveedor)}</span></div>
                    </div>
                  )}
                  <div style={{ gridColumn: 'span 3', marginTop: '20px', backgroundColor: '#0d1117', border: '1px solid #f85149', padding: '20px', borderRadius: '8px', textAlign: 'center' }}>
                    <div style={{ color: '#8b949e', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Total Gastos [Sueldos + Manifiesto]</div>
                    <div style={{ color: '#f85149', fontSize: '2rem', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.totalGastos)}</div>
                  </div>
                  <div style={{ gridColumn: 'span 3', marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Observaciones (Unidad / Proveedor)</span>
                    <div style={{ color: '#c9d1d9', fontWeight: '500', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(operacionViendo.observacionesUnidad)}</div>
                  </div>
                </div>
              )}
              {pestañaDetalleActiva === 'cobrar' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Facturado En:</span><span>{mostrarMoneda(operacionViendo.facturadoEnCobrar)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Moneda Convenio</span><span>{mostrarMoneda(operacionViendo.monedaConvenioCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio (Base)</span><span>{formatoMoneda(operacionViendo.montoConvenioCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cargos Adicionales</span><span>{formatoMoneda(operacionViendo.cargosAdicionales)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Subtotal</span><span style={{ color: '#c9d1d9', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.subtotalCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Tipo de Cambio del Día</span><span>{mostrarDato(operacionViendo.tipoCambioAprobado)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Dólares (Cliente)</span><span style={{ color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.dolaresCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Pesos (Cliente)</span><span style={{ color: '#3b82f6', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.pesosCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Conversión Final</span><span style={{ color: '#D84315', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.conversionCliente)}</span></div>
                  <div style={{ gridColumn: 'span 3', marginTop: '24px', backgroundColor: '#0d1117', border: '1px solid #10b981', padding: '24px', borderRadius: '12px', textAlign: 'center' }}>
                    <span style={{ display: 'block', fontSize: '0.9rem', color: '#8b949e', textTransform: 'uppercase' }}>Utilidad Estimada de la Operación</span>
                    <span style={{ fontSize: '2.5rem', color: '#10b981', fontWeight: 'bold' }}>{formatoMoneda(operacionViendo.utilidadEstimada)}</span>
                  </div>
                  <div style={{ gridColumn: 'span 3', marginTop: '24px' }}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Observaciones (Cobro)</span>
                    <div style={{ color: '#c9d1d9', backgroundColor: '#010409', padding: '16px', borderRadius: '8px', border: '1px solid #30363d', minHeight: '60px' }}>{mostrarDato(operacionViendo.observacionesCobrar)}</div>
                  </div>
                </div>
              )}
            </div>
            <div className="form-actions" style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d' }}>
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO: Visor de documentos de la operación cancelada */}
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

      {/* ✅ NUEVO: Subida de documentos ligada a la operación */}
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

      {modalHorarios === 'historial' && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="form-card" style={{ maxWidth: '650px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
            <div className="form-header"><h2>Bitácora de Movimientos</h2><button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button></div>
            <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
              {cargandoHorarios ? (<div>Descargando...</div>) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ color: '#8b949e' }}><th style={{ textAlign: 'left' }}>Fecha y Hora</th><th style={{ textAlign: 'left' }}>Estatus</th></tr></thead>
                  <tbody>{historialList.map((h: any) => (<tr key={h.id} style={{ borderBottom: '1px solid #21262d' }}><td style={{ padding: '12px' }}>{new Date(h.fechaHora).toLocaleString('es-MX')}</td><td style={{ padding: '12px', color: '#ef4444' }}>{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre')}</td></tr>))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ServiciosCancelados;
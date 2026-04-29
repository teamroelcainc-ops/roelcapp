// src/features/operaciones/components/ServiciosCompletados.tsx
import { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, orderBy, limit, where } from 'firebase/firestore'; 
import { db } from '../../../config/firebase'; 
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF } from '../../../utils/pdfGenerator'; 

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

const ServiciosCompletados = () => {
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(true);
  const [operacionViendo, setOperacionViendo] = useState<any | null>(null);

  const [modalHorarios, setModalHorarios] = useState<'cerrado' | 'historial'>('cerrado');
  const [historialList, setHistorialList] = useState<any[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  
  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const descargarTodo = async () => {
    setCargandoOperaciones(true);
    try {
      let catGuardados = null;
      const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v2');

      if (cacheCatStr) {
        catGuardados = JSON.parse(cacheCatStr);
        setCatalogosGlobales(catGuardados);
      } else {
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

        catGuardados = {
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
      }

      const operacionesSnap = await getDocs(query(collection(db, 'operaciones'), orderBy('fechaServicio', 'desc'), limit(100)));

      const opDataRaw = operacionesSnap.docs.map((d: any) => {
        const data = d.data() as any;
        const clienteObj = catGuardados.empresas.find((e: any) => e.id === data.clientePaga);
        return { id: d.id, ...data, nombreCliente: clienteObj ? clienteObj.nombre : (data.clientePaga || 'Desconocido') };
      });

      const idsPermitidos = ['f557b751', 'c2d57403'];
      const operacionesCompletadas = opDataRaw.filter((op: any) => idsPermitidos.includes(String(op.status).trim()));

      setOperacionesGlobales(operacionesCompletadas);

    } catch (e) {
      console.error("Error al pre-cargar datos:", e);
    }
    setCargandoOperaciones(false);
  };

  useEffect(() => {
    descargarTodo();
  }, []);

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

  const mostrarDatoMapeado = (id: string | null | undefined, catalogo: keyof typeof catalogosGlobales, campoRetorno: string = 'nombre') => {
    if (!id) return '-';
    if (!catalogosGlobales[catalogo] || !Array.isArray(catalogosGlobales[catalogo])) return id;
    const elementoEncontrado = catalogosGlobales[catalogo].find((item: any) => item.id === id);
    if (!elementoEncontrado) return id;
    if (catalogo === 'empleados') {
      return elementoEncontrado.firstName ? `${elementoEncontrado.firstName} ${elementoEncontrado.lastNamePaternal || ''}`.trim() : elementoEncontrado.nombre || id;
    }
    return elementoEncontrado[campoRetorno] || elementoEncontrado.nombre || elementoEncontrado.descripcion || elementoEncontrado.placa || id;
  };

  const obtenerNombreConvenioCliente = (id: string) => {
    if (operacionViendo?.convenioNombre) return operacionViendo.convenioNombre;
    if (!id) return '-';
    const detalle = catalogosGlobales.catalogoConvDetalles?.find((d:any) => d.id === id);
    if (detalle) {
        const tarifaId = detalle.tipoConvenioId || detalle.tipo_convenio_id || detalle.tipoConvenio || detalle.tipo_convenio || detalle['TIPO DE CONVENIO'];
        const tObj = catalogosGlobales.tarifas?.find((t:any) => String(t.id).trim() === String(tarifaId).trim());
        return tObj?.descripcion || tObj?.nombre || id;
    }
    return id;
  };

  const obtenerNombreConvenioProv = (id: string) => {
    if (!id) return '-';
    const detalle = catalogosGlobales.catalogoConvProvDetalles?.find((d:any) => d.id === id);
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

  const handleDescargarSolicitudRetiro = () => {
    if (!operacionViendo) return;
    const origen = mostrarDatoMapeado(operacionViendo.origen, 'empresas');
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor 
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) 
      : 'N/A';
      
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor)
      : 'N/A';

    generarSolicitudRetiroPDF({
      bodegaNombre: origen,
      tipoMovimiento: operacionViendo.trafico || 'N/A',
      remolqueNombre: remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A',
      remolquePlacas: remolqueObj ? remolqueObj.placa : 'N/A',
      clienteMercancia: mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      unidadNombre: unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal,
      unidadPlacas: unidadObj ? (unidadObj.placa || 'N/A') : 'N/A',
      empleadoNombre: mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal,
      destinoNombre: destinoObj ? destinoObj.nombre : 'N/A',
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    });
  };

  const handleDescargarInstruccionesServicio = () => {
    if (!operacionViendo) return;

    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor 
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) 
      : 'N/A';
      
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor)
      : 'N/A';

    const datosPDF = {
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'N/A',
      fecha: operacionViendo.fechaServicio || '',
      unidadNombre: unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal,
      empleadoNombre: mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal,
      remolqueNombre: remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A',
      remolquePlacas: remolqueObj ? remolqueObj.placa : 'N/A',
      tipoOperacion: mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion'),
      origenNombre: origenObj ? origenObj.nombre : 'N/A',
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      clienteMercancia: mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas'),
      destinoNombre: destinoObj ? destinoObj.nombre : 'N/A',
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
    };

    generarInstruccionesServicioPDF(datosPDF);
  };

  const handleDescargarCheckList = () => {
    if (!operacionViendo) return;

    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const unidadObj = catalogosGlobales.unidades?.find((u: any) => u.id === operacionViendo.unidad);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const unidadProvVal = operacionViendo.unidadProveedor 
      ? (catalogosGlobales.unidades_proveedor?.find((u:any) => u.id === operacionViendo.unidadProveedor)?.numeroUnidad || operacionViendo.unidadProveedor) 
      : 'N/A';
      
    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor)
      : 'N/A';

    const empNombre = mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal;
    const uniNombre = unidadObj ? (unidadObj.numeroEconomico || unidadObj.nombre) : unidadProvVal;
    const uniPlacas = unidadObj ? (unidadObj.placa || 'N/A') : 'N/A';
    
    const tractorInfoStr = `${uniNombre} / ${uniPlacas} / ${empNombre}`;

    const datosPDF = {
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fecha: operacionViendo.fechaServicio || '',
      cliente: mostrarDatoMapeado(operacionViendo.clientePaga, 'empresas'),
      remolque: remolqueObj ? (remolqueObj.placa || remolqueObj.nombre) : 'N/A',
      proveedor: mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas'),
      tractorInfo: tractorInfoStr,
      numeroPedimento: operacionViendo.numDoda || 'N/A',
      prefileEntrys: String(operacionViendo.cantEntrys || '0'),
      entryReferencia: operacionViendo.numeroEntrys || 'N/A',
      manifiesto: operacionViendo.numManifiesto || 'N/A',
      origenNombre: origenObj ? origenObj.nombre : 'N/A',
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      destinoNombre: destinoObj ? destinoObj.nombre : 'N/A',
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      operadorNombre: empNombre,
      supervisor: operacionViendo.observacionesEjecutivo || 'Despacho',
    };

    generarCheckListPDF(datosPDF);
  };

  const handleDescargarPruebaEntrega = () => {
    if (!operacionViendo) return;

    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor)
      : 'N/A';

    const empNombre = mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal;
    const tipoOpNombre = mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion');
    const trafico = operacionViendo.trafico || '';

    const datosPDF = {
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      origenNombre: origenObj ? origenObj.nombre : 'N/A',
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      origenCP: origenObj ? (origenObj.cp || origenObj.codigoPostal || 'N/A') : 'N/A',
      origenCiudad: origenObj ? (origenObj.ciudad || origenObj.estado || 'N/A') : 'N/A',
      destinoNombre: destinoObj ? destinoObj.nombre : 'N/A',
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      destinoCP: destinoObj ? (destinoObj.cp || destinoObj.codigoPostal || 'N/A') : 'N/A',
      destinoCiudad: destinoObj ? (destinoObj.ciudad || destinoObj.estado || 'N/A') : 'N/A',
      tipoServicio: `${tipoOpNombre} ${trafico}`,
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: remolqueObj ? remolqueObj.nombre : 'N/A',
      placas: remolqueObj ? remolqueObj.placa : 'N/A',
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A'
    };

    generarPruebaEntregaPDF(datosPDF);
  };

  const handleDescargarCartaInstrucciones = () => {
    if (!operacionViendo) return;
    const origenObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.origen);
    const destinoObj = catalogosGlobales.empresas?.find((e: any) => e.id === operacionViendo.destino);
    const remolqueObj = catalogosGlobales.remolques?.find((r: any) => r.id === operacionViendo.numeroRemolque);

    const operadorProvVal = operacionViendo.operadorProveedor
      ? (catalogosGlobales.proveedores_unidad?.find((o:any) => o.id === operacionViendo.operadorProveedor)?.nombre || operacionViendo.operadorProveedor) : 'N/A';

    const empNombre = mostrarDatoMapeado(operacionViendo.operador, 'empleados') !== '-' ? mostrarDatoMapeado(operacionViendo.operador, 'empleados') : operadorProvVal;

    generarCartaInstruccionesPDF({
      referencia: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      consecutivo: operacionViendo.ref || operacionViendo.id?.substring(0,6) || 'S/R',
      fechaServicio: operacionViendo.fechaServicio || 'N/A',
      fechaCita: operacionViendo.fechaCita ? new Date(operacionViendo.fechaCita).toLocaleString('es-MX') : 'N/A',
      tipoServicio: mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion'),
      trafico: operacionViendo.trafico || '',
      tipoUnidad: remolqueObj ? (remolqueObj.tipo || remolqueObj.descripcion || 'Remolque') : 'N/A',
      numeroEconomico: remolqueObj ? remolqueObj.nombre : 'N/A',
      placas: remolqueObj ? remolqueObj.placa : 'N/A',
      operador: empNombre,
      descripcionMercancia: operacionViendo.descripcionMercancia || 'N/A',
      origenCiudad: origenObj ? (origenObj.ciudad || origenObj.estado || 'N/A') : 'N/A',
      origenNombre: origenObj ? origenObj.nombre : 'N/A',
      origenDireccion: origenObj ? origenObj.direccion : 'N/A',
      origenColonia: origenObj ? (origenObj.colonia || 'N/A') : 'N/A',
      origenCP: origenObj ? (origenObj.cp || origenObj.codigoPostal || 'N/A') : 'N/A',
      destinoCiudad: destinoObj ? (destinoObj.ciudad || destinoObj.estado || 'N/A') : 'N/A',
      destinoNombre: destinoObj ? destinoObj.nombre : 'N/A',
      destinoDireccion: destinoObj ? destinoObj.direccion : 'N/A',
      destinoColonia: destinoObj ? (destinoObj.colonia || 'N/A') : 'N/A',
      destinoCP: destinoObj ? (destinoObj.cp || destinoObj.codigoPostal || 'N/A') : 'N/A',
    });
  };

  const forzarRecarga = () => {
    sessionStorage.removeItem('roelca_catalogos_v2');
    window.location.reload();
  };

  const operacionesFiltradas = useMemo(() => {
    const b = busqueda.toLowerCase();
    return operacionesGlobales.filter(op => {
      const statusTexto = mostrarDatoMapeado(op.status, 'statusServicio', 'nombre').toLowerCase();
      return (
        String(op.ref || op.id || '').toLowerCase().includes(b) ||
        String(op.fechaServicio || '').toLowerCase().includes(b) ||
        String(op.nombreCliente || '').toLowerCase().includes(b) ||
        String(op.tipoServicio || '').toLowerCase().includes(b) ||
        String(op.trafico || '').toLowerCase().includes(b) ||
        String(statusTexto || '').toLowerCase().includes(b) 
      );
    });
  }, [busqueda, operacionesGlobales, catalogosGlobales]);

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
      `"${op.ref || op.id?.substring(0,6) || ''}"`, `"${op.fechaServicio || ''}"`, `"${mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion')}"`, `"${mostrarDatoMapeado(op.status, 'statusServicio', 'nombre')}"`, `"${op.convenioNombre || obtenerNombreConvenioCliente(op.convenio)}"`, `"${mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'placa')}"`, `"${mostrarDatoMapeado(op.proveedorUnidad, 'empresas')}"`, `"${mostrarDatoMapeado(op.unidad, 'unidades')}"`, `"${op.nombreCliente || ''}"`, `"${obtenerNombreConvenioProv(op.convenioProveedor)}"`, `"${formatoMoneda(op.cargosAdicionales)}"`, `"${formatoMoneda(op.subtotalCliente)}"`
    ].join(','));
    const csvContent = [encabezados.join(','), ...lineas].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Servicios_Completados_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = operacionViendo ? (catalogosGlobales.tiposOperacion?.find((op: any) => op.id === operacionViendo.tipoOperacionId)?.tipo_operacion || '').toLowerCase() : '';
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = mostrarDatoMapeado(operacionViendo?.proveedorUnidad, 'empresas').toLowerCase().includes('roelca');
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
     <div style={{ width: '100%', margin: '0 auto' }}>
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#10b981', margin: '0 0 24px 0', fontWeight: 'bold' }}>✓ Servicios Completados</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '120px' }}>
            <select className="form-control" style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9' }}><option>Filtro: Todo</option></select>
          </div>
          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Buscar por Ref, Cliente, Status..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '280px' }}>
            <button className="btn btn-outline" onClick={forzarRecarga} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>↻ Actualizar</button>
            <button className="btn btn-outline" onClick={exportarCSV} style={{ display: 'flex', alignItems: 'center', gap: '8px', whiteSpace: 'nowrap' }}>Exportar CSV</button>
          </div>
        </div>
        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            {cargandoOperaciones ? (<div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones...</div>) : (
              <table className="data-table" style={{ width: '100%', minWidth: '1300px', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                  <tr><th style={{ padding: '16px' }}># Ref</th><th style={{ padding: '16px' }}>Fecha</th><th style={{ padding: '16px' }}>Tipo de Operación</th><th style={{ padding: '16px' }}>Status</th><th style={{ padding: '16px' }}>Convenio (Tarifa)</th><th style={{ padding: '16px' }}># Remolque</th><th style={{ padding: '16px' }}>Proveedor</th><th style={{ padding: '16px' }}>Unidad</th><th style={{ padding: '16px' }}>Cliente (Paga)</th><th style={{ padding: '16px' }}>Convenio (Prov)</th><th style={{ padding: '16px' }}>Cargos Adic.</th><th style={{ padding: '16px' }}>Subtotal</th></tr>
                </thead>
                <tbody>
                  {operacionesEnPantalla.length === 0 ? (<tr><td colSpan={12} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>Sin resultados.</td></tr>) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td style={{ padding: '16px' }}>{op.ref || op.id?.substring(0,6)}</td><td style={{ padding: '16px' }}>{op.fechaServicio}</td><td style={{ padding: '16px' }}>{mostrarDatoMapeado(op.tipoOperacionId, 'tiposOperacion', 'tipo_operacion')}</td><td style={{ padding: '16px', color: '#10b981', fontWeight: 'bold' }}>{mostrarDatoMapeado(op.status, 'statusServicio', 'nombre')}</td><td style={{ padding: '16px' }}>{op.convenioNombre || obtenerNombreConvenioCliente(op.convenio)}</td><td style={{ padding: '16px' }}>{mostrarDatoMapeado(op.numeroRemolque, 'remolques', 'placa')}</td><td style={{ padding: '16px' }}>{mostrarDatoMapeado(op.proveedorUnidad, 'empresas')}</td><td style={{ padding: '16px' }}>{mostrarDatoMapeado(op.unidad, 'unidades')}</td><td style={{ padding: '16px' }}>{op.nombreCliente}</td><td style={{ padding: '16px' }}>{obtenerNombreConvenioProv(op.convenioProveedor)}</td><td style={{ padding: '16px' }}>{formatoMoneda(op.cargosAdicionales)}</td><td style={{ padding: '16px' }}>{formatoMoneda(op.subtotalCliente)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
          {operacionesFiltradas.length > 0 && !cargandoOperaciones && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesFiltradas.length)} de {operacionesFiltradas.length} operaciones</div>
              <div style={{ display: 'flex', gap: '8px' }}><button onClick={irPaginaAnterior} disabled={paginaActual === 1}>Anterior</button><span style={{ padding: '6px 12px' }}>{paginaActual} / {totalPaginas || 1}</span><button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas}>Siguiente</button></div>
            </div>
          )}
        </div>
      </div>
      {operacionViendo && (
        <div className="modal-overlay" style={{ zIndex: 1500 }}>
          <div className="form-card detail-card" style={{ maxWidth: '1100px', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            
            <div className="form-header" style={{ padding: '20px 24px', borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.4rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  Detalle de Operación 
                  <span style={{ color: '#10b981', padding: '4px 10px', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderRadius: '6px', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '1.2rem' }}>
                    {operacionViendo.ref || operacionViendo.id?.substring(0,6)}
                  </span>
                </h2>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button onClick={verHistorial} title="Ver Bitácora (Historial)" style={{ background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', gap: '8px', fontWeight: 'bold', transition: '0.2s' }}>
                    📋 Bitácora
                  </button>
                  <div style={{ width: '1px', height: '24px', backgroundColor: '#30363d', margin: '0 4px' }}></div>
                  <button onClick={() => setOperacionViendo(null)} className="btn-window close" style={{ padding: '6px', borderRadius: '50%' }}>✕</button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: '#010409', padding: '12px 16px', borderRadius: '8px', border: '1px solid #30363d', flexWrap: 'wrap' }}>
                <span style={{ color: '#8b949e', fontSize: '0.8rem', fontWeight: 'bold', letterSpacing: '0.5px' }}>DOCUMENTOS:</span>
                
                {evalIsFletes && (
                  <>
                    <button onClick={handleDescargarCartaInstrucciones} title="Descargar Carta de Instrucciones" style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#58a6ff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', gap: '6px', fontSize: '0.85rem', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                      📄 Carta Instrucciones
                    </button>
                    <button onClick={handleDescargarPruebaEntrega} title="Descargar Prueba de Entrega" style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#58a6ff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', gap: '6px', fontSize: '0.85rem', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                      📄 Prueba Entrega
                    </button>
                  </>
                )}

                <button onClick={handleDescargarCheckList} title="Descargar Check List" style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#58a6ff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', gap: '6px', fontSize: '0.85rem', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  📄 Check List
                </button>
                <button onClick={handleDescargarSolicitudRetiro} title="Descargar Solicitud de Retiro" style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#58a6ff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', gap: '6px', fontSize: '0.85rem', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  📄 Solicitud Retiro
                </button>
                <button onClick={handleDescargarInstruccionesServicio} title="Descargar Instrucciones de Servicio" style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#58a6ff', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '4px', gap: '6px', fontSize: '0.85rem', transition: '0.2s' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  📄 Instrucciones Serv.
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px', overflowX: 'auto' }}>
              {tabsDetalle.map(tab => (<button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)} style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer' }}>{tab.label}</button>))}
            </div>
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {pestañaDetalleActiva === 'general' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Tipo</span><span>{mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion')}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Fecha / Status</span><span>{mostrarDato(operacionViendo.fechaServicio)} | <span style={{color: '#10b981'}}>{mostrarDatoMapeado(operacionViendo.status, 'statusServicio', 'nombre')}</span></span></div>
                  {evalIsFletes && (<div><span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold' }}>Fecha de Cita</span><span>{formatearFechaHora(operacionViendo.fechaCita)}</span></div>)}
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cliente (Paga)</span><span>{mostrarDato(operacionViendo.nombreCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio (Tarifa)</span><span>{obtenerNombreConvenioCliente(operacionViendo.convenio)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}># de Remolque</span><span>{mostrarDatoMapeado(operacionViendo.numeroRemolque, 'remolques', 'placa')}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Ref Cliente</span><span>{mostrarDato(operacionViendo.refCliente)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Origen</span><span>{mostrarDatoMapeado(operacionViendo.origen, 'empresas')}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold' }}>Destino</span><span>{mostrarDatoMapeado(operacionViendo.destino, 'empresas')}</span></div>
                  <div style={{ gridColumn: '1 / -1', marginTop: '8px' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Observaciones Ejecutivo</span><div style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>{mostrarDato(operacionViendo.observacionesEjecutivo)}</div></div>
                </div>
              )}
              {pestañaDetalleActiva === 'pedimento' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cliente (Mercancía)</span><span>{mostrarDatoMapeado(operacionViendo.clienteMercancia, 'empresas')}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Descripción de la Mercancía</span><span>{mostrarDato(operacionViendo.descripcionMercancia)}</span></div>
                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Cantidad</span><span>{mostrarDato(operacionViendo.cantidad)}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Embalaje</span><span>{mostrarDatoMapeado(operacionViendo.embalaje, 'embalajes', 'clave')}</span></div>
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
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Prov. Servicios</span><span>{mostrarDatoMapeado(operacionViendo.provServicios, 'empresas')}</span></div>
                  <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Costo Manifiesto</span><span>{formatoMoneda(operacionViendo.montoManifiesto)}</span></div>
                </div>
              )}
              {pestañaDetalleActiva === 'unidad' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div style={{ gridColumn: 'span 3' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Prov. Transporte</span><span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{mostrarDatoMapeado(operacionViendo.proveedorUnidad, 'empresas')}</span></div>
                  <div style={{ gridColumn: 'span 3', backgroundColor: '#161b22', padding: '20px', borderRadius: '12px', border: '1px solid #30363d' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', marginBottom: '16px' }}>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Facturado En:</span><span>{mostrarMoneda(operacionViendo.facturadoEnUnidad)}</span></div>
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Convenio Proveedor</span><span>{obtenerNombreConvenioProv(operacionViendo.convenioProveedor)}</span></div>
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
                      <div><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Unidad Asignada</span><span>{mostrarDatoMapeado(operacionViendo.unidad, 'unidades', 'numeroEconomico') || mostrarDatoMapeado(operacionViendo.unidad, 'unidades', 'nombre')}</span></div>
                      <div style={{ gridColumn: 'span 2' }}><span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold' }}>Operador Asignado</span><span>{mostrarDatoMapeado(operacionViendo.operador, 'empleados')}</span></div>
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
      {modalHorarios === 'historial' && (
        <div className="modal-overlay" style={{ zIndex: 2000 }}>
          <div className="form-card" style={{ maxWidth: '650px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px' }}>
            <div className="form-header"><h2>Bitácora de Movimientos</h2><button onClick={() => setModalHorarios('cerrado')} className="btn-window close">✕</button></div>
            <div style={{ padding: '24px', maxHeight: '60vh', overflowY: 'auto' }}>
              {cargandoHorarios ? (<div>Descargando...</div>) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ color: '#8b949e' }}><th style={{ textAlign: 'left' }}>Fecha y Hora</th><th style={{ textAlign: 'left' }}>Estatus</th></tr></thead>
                  <tbody>{historialList.map((h: any) => (<tr key={h.id} style={{ borderBottom: '1px solid #21262d' }}><td style={{ padding: '12px' }}>{new Date(h.fechaHora).toLocaleString('es-MX')}</td><td style={{ padding: '12px', color: '#10b981' }}>{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre')}</td></tr>))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
export default ServiciosCompletados;
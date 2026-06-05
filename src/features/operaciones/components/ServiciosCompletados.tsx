import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, getDocs, orderBy, limit, where } from 'firebase/firestore'; 
import { db } from '../../../config/firebase'; 
import { generarSolicitudRetiroPDF, generarInstruccionesServicioPDF, generarCheckListPDF, generarPruebaEntregaPDF, generarCartaInstruccionesPDF } from '../../../utils/pdfGenerator'; 
import * as XLSX from 'xlsx';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

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

const ServiciosCompletados = () => {
  const [operacionesGlobales, setOperacionesGlobales] = useState<any[]>([]);
  const [cargandoOperaciones, setCargandoOperaciones] = useState(false);
  const [operacionViendo, setOperacionViendo] = useState<any | null>(null);

  const [modalHorarios, setModalHorarios] = useState<'cerrado' | 'historial'>('cerrado');
  const [historialList, setHistorialList] = useState<any[]>([]);
  const [cargandoHorarios, setCargandoHorarios] = useState(false);
  
  const [catalogosGlobales, setCatalogosGlobales] = useState<any>({});
  const [busqueda, setBusqueda] = useState('');

  const [filterFecha, setFilterFecha] = useState('');
  const [filterRemolque, setFilterRemolque] = useState('');
  const [filterCliente, setFilterCliente] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  // ✅ MODIFICADO: ahora requiere clienteId. Hace una query específica por cliente
  // (where + orderBy + limit 500) en lugar de descargar las últimas 400 sin filtro.
  // Esto trae incluso operaciones viejas del cliente y ahorra cuota de Firestore
  // porque solo descarga cuando el usuario elige un cliente.
  const descargarOperaciones = async (clienteId: string) => {
    if (!clienteId) {
      setOperacionesGlobales([]);
      return;
    }
    setCargandoOperaciones(true);
    try {
      const queryClienteCompletadas = query(
        collection(db, 'operaciones'),
        where('clientePaga', '==', clienteId),
        orderBy('fechaServicio', 'desc'),
        limit(500)
      );

      const operacionesSnap = await getDocs(queryClienteCompletadas);
      
      const operacionesCompletadas = operacionesSnap.docs
        .map((d: any) => ({ id: d.id, ...d.data() }))
        .filter((op: any) => {
          const statusId = String(op.status || '').trim();
          const statusTexto = String(op.statusNombre || op.status || '').toLowerCase();
          return ['f557b751', 'c2d57403'].includes(statusId) || statusTexto.includes('completado');
        });

      setOperacionesGlobales(operacionesCompletadas);

    } catch (e) {
      console.error(e);
      alert("Hubo un problema al cargar las operaciones. Verifica tu conexión.");
    }
    setCargandoOperaciones(false);
  };

  const cargarCatalogosSiEsNecesario = async () => {
    if (Object.keys(catalogosGlobales).length > 0) return; 

    const cacheCatStr = sessionStorage.getItem('roelca_catalogos_v2');
    if (cacheCatStr) {
      setCatalogosGlobales(JSON.parse(cacheCatStr));
      return;
    }

    const [empSnap, opSnap, embSnap, remSnap, tarSnap, convProvSnap, convProvDetSnap, tcSnap, convCliSnap, convDetSnap, uniSnap, operSnap, statusSnap, uniProvSnap, opeProvSnap, monSnap] = await Promise.all([
      getDocs(collection(db, 'empresas')), getDocs(collection(db, 'catalogo_tipo_operacion')),
      getDocs(collection(db, 'catalogo_embalaje')), getDocs(collection(db, 'remolques')),
      getDocs(collection(db, 'catalogo_tarifas_referencia')), getDocs(collection(db, 'convenios_proveedores')),
      getDocs(collection(db, 'convenios_proveedores_detalles')), getDocs(collection(db, 'tipo_cambio')),
      getDocs(collection(db, 'convenios_clientes')), getDocs(collection(db, 'convenios_clientes_detalles')),
      getDocs(collection(db, 'unidades')), getDocs(collection(db, 'empleados')),
      getDocs(collection(db, 'catalogo_status_servicio')), getDocs(collection(db, 'unidades_proveedor')),
      getDocs(collection(db, 'proveedores_unidad')), getDocs(collection(db, 'catalogo_moneda'))
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
      proveedores_unidad: opeProvSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) })),
      catalogoMoneda: monSnap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }))
    };
    
    sessionStorage.setItem('roelca_catalogos_v2', JSON.stringify(catGuardados));
    setCatalogosGlobales(catGuardados);
  };

  // ✅ MODIFICADO: al montar solo cargamos catálogos (no operaciones).
  // Las operaciones se cargarán cuando el usuario elija un cliente.
  useEffect(() => { 
    cargarCatalogosSiEsNecesario();
  }, []);

  // ✅ NUEVO: cuando cambia el cliente seleccionado, se hace la query específica.
  useEffect(() => {
    descargarOperaciones(filterCliente);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCliente]);

  useEffect(() => { setPaginaActual(1); }, [busqueda, filterFecha, filterRemolque, filterCliente]);
  
  const mostrarDato = (text: any) => (text && text !== '' ? text : '-');
  
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
      } else {
        return valorDesnormalizado; 
      }
    }

    if (!id) return '-';
    if (!catalogosGlobales[catalogo] || !Array.isArray(catalogosGlobales[catalogo])) return id;
    
    const elementoEncontrado = catalogosGlobales[catalogo].find((item: any) => String(item.id).trim() === String(id).trim() || String(item.nombre).trim() === String(id).trim());
    if (!elementoEncontrado) return id;

    if (catalogo === 'empleados') {
      return `${elementoEncontrado.firstName || ''} ${elementoEncontrado.lastNamePaternal || ''}`.trim() || id;
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
      return elementoEncontrado.tipo_operacion || id;
    }

    return elementoEncontrado[campoRetorno] || elementoEncontrado.nombre || id;
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

  const handleDescSolicitudRetiro = async () => {
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
    const tipoOpNombre = operacionViendo.tipoOperacionNombre || mostrarDatoMapeado(operacionViendo.tipoOperacionId, 'tiposOperacion', 'tipo_operacion');

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
      tipoServicio: `${tipoOpNombre} ${operacionViendo.trafico || ''}`,
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
      origenCiudad: 'N/A', 
      origenNombre: operacionViendo.origenNombre || (origenObj ? origenObj.nombre : 'N/A'),
      origenDireccion: 'N/A', origenColonia: 'N/A', origenCP: 'N/A',
      destinoCiudad: 'N/A', 
      destinoNombre: operacionViendo.destinoNombre || (destinoObj ? destinoObj.nombre : 'N/A'),
      destinoDireccion: 'N/A', destinoColonia: 'N/A', destinoCP: 'N/A',
    });
  };

  const forzarRecarga = () => {
    sessionStorage.removeItem('roelca_catalogos_v2');
    window.location.reload();
  };

  // ✅ MODIFICADO: el cliente ya está aplicado en la query a Firestore (no se vuelve a filtrar aquí).
  // Sólo refinamos en memoria por fecha, remolque o búsqueda general.
  const operacionesFiltradas = useMemo(() => {
    if (!filterCliente) return [];

    let filtradas = operacionesGlobales;

    if (filterFecha) {
      filtradas = filtradas.filter(op => String(op.fechaServicio || '').includes(filterFecha));
    }
    if (filterRemolque) {
      filtradas = filtradas.filter(op => String(op.numeroRemolque || '') === filterRemolque || String(op.remolqueNombre || '').toLowerCase().includes(filterRemolque.toLowerCase()));
    }

    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      filtradas = filtradas.filter(op => {
        return (
          String(op.ref || op.id || '').toLowerCase().includes(b) ||
          String(op.fechaServicio || '').toLowerCase().includes(b) ||
          String(op.clienteNombre || op.nombreCliente || '').toLowerCase().includes(b) ||
          String(op.tipoOperacionNombre || op.tipoServicio || '').toLowerCase().includes(b) ||
          String(op.trafico || '').toLowerCase().includes(b) ||
          String(op.statusNombre || op.status || '').toLowerCase().includes(b) 
        );
      });
    }

    return filtradas;
  }, [busqueda, operacionesGlobales, filterFecha, filterRemolque, filterCliente]);

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
      case 'ref': return <span className="font-mono" style={{ color: '#10b981', fontWeight: 'bold' }}>{op.ref || op.id?.substring(0,6)}</span>;
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
      case 'embalaje': return <span style={{ color: '#c9d1d9' }}>{op.embalajeNombre || op.embalaje || '-'}</span>;
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
          case 'embalaje': val = op.embalajeNombre || op.embalaje || ''; break;
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
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Completados');
    XLSX.writeFile(workbook, `Servicios_Completados_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const tabsDetalle = [{ id: 'general', label: 'Información General' }, { id: 'pedimento', label: 'Pedimento y CT' }, { id: 'manifiestos', label: "Entry's y Manifiestos" }, { id: 'unidad', label: 'Unidad y Operador' }, { id: 'cobrar', label: 'Por Cobrar' }];

  const evalTipoOpText = String(operacionViendo?.tipoOperacionNombre || operacionViendo?.tipoOperacionId || '').toLowerCase();
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsRoelca = String(operacionViendo?.proveedorUnidadNombre || operacionViendo?.proveedorUnidad || '').toLowerCase().includes('roelca');
  
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  const btnSecondaryActionStyle = { background: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '8px 16px', borderRadius: '6px', gap: '8px', fontWeight: 'bold', transition: 'background 0.2s', fontSize: '0.85rem' };
  const btnDocStyle = { background: 'transparent', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '6px 12px', borderRadius: '6px', gap: '6px', fontSize: '0.85rem', transition: 'all 0.2s' };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', margin: '0 auto' }}>
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#10b981', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          ✓ Servicios Completados
        </h1>

        {/* ✅ MODIFICADO: Cliente ahora es el primer filtro y es el principal.
            Al elegir cliente se dispara la query a Firestore. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
          <div style={{ flex: '1 1 260px' }}>
            <label style={{ display: 'block', color: '#10b981', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>CLIENTE QUE PAGA ★</label>
            <select value={filterCliente} onChange={(e) => setFilterCliente(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #10b981', borderRadius: '6px', color: '#c9d1d9' }}>
              <option value="">Seleccionar Cliente...</option>
              {catalogosGlobales.empresas?.map((emp: any) => (
                <option key={emp.id} value={emp.id}>{emp.nombre || emp.id}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '1 1 180px' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FECHA</label>
            <input type="date" value={filterFecha} onChange={(e) => setFilterFecha(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }} />
          </div>

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>REMOLQUE</label>
            <select value={filterRemolque} onChange={(e) => setFilterRemolque(e.target.value)} style={{ width: '100%', padding: '10px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9' }}>
              <option value="">Seleccionar Remolque...</option>
              {catalogosGlobales.remolques?.map((rem: any) => (
                <option key={rem.id} value={rem.id}>{`${rem.nombre || ''} ${rem.placas || rem.placa || ''}`.trim()}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: '1 1 200px' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '6px', fontWeight: 'bold' }}>FILTRO GENERAL</label>
            <div style={{ position: 'relative' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder="Buscar por Ref..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 10px 10px 36px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignSelf: 'flex-end', marginLeft: 'auto', paddingBottom: '2px' }}>
            <button className="btn btn-outline" onClick={() => setModalColumnas(true)} style={{ padding: '10px 12px' }} title="Configurar Columnas">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button className="btn btn-outline" onClick={forzarRecarga} style={{ padding: '10px 12px' }} title="Recargar Catálogos">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 0 20.49 15"></path></svg>
            </button>
            <button className="btn btn-outline" onClick={exportarExcel} style={{ padding: '10px 12px' }} title="Exportar a Excel">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            {cargandoOperaciones ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando operaciones completadas...</div>
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
                  {!filterCliente ? (
                    <tr>
                      <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e', fontWeight: '500' }}>
                        Selecciona un cliente para ver sus servicios completados.
                      </td>
                    </tr>
                  ) : operacionesEnPantalla.length === 0 ? (
                    <tr>
                      <td colSpan={columnasTabla.length + 1} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                        Sin resultados para los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    operacionesEnPantalla.map((op: any) => (
                      <tr key={op.id} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === op.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(op.id)} onMouseLeave={() => setHoveredRowId(null)} onClick={() => { setOperacionViendo(op); setPestañaDetalleActiva('general'); }}>
                        <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                          <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                            <button 
                              type="button" 
                              title="Ver Detalles"
                              onClick={(e) => { e.stopPropagation(); setOperacionViendo(op); setPestañaDetalleActiva('general'); }} 
                              style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} 
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(16, 185, 129, 0.1)'} 
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
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
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, operacionesFiltradas.length)} de {operacionesFiltradas.length} operaciones completadas</div>
              <div style={{ display: 'flex', gap: '8px' }}>
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
            
            <ul style={{ 
              listStyle: 'none', padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto', 
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' 
            }}>
              {columnasTabla.map((col, idx) => (
                <li 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ 
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', 
                    backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', 
                    border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab',
                    transition: 'background-color 0.2s'
                  }}
                >
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
          <div className="form-card detail-card" style={{ maxWidth: '1100px', maxHeight: '90vh', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', display: 'flex', flexDirection: 'column' }}>
            
            <div className="form-header" style={{ padding: '24px 32px 16px 32px', borderBottom: 'none', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.6rem', fontWeight: 600, letterSpacing: '-0.5px' }}>
                    Detalle de Operación Completada
                  </h2>
                  <div style={{ marginTop: '8px', color: '#10b981', fontWeight: 'bold', fontSize: '1.1rem', letterSpacing: '0.5px' }}>
                    {operacionViendo.ref || operacionViendo.id?.substring(0,6)}
                  </div>
                </div>
                
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button onClick={verHistorial} title="Ver Bitácora (Historial)" style={btnSecondaryActionStyle}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    Bitácora
                  </button>
                  <div style={{ width: '1px', height: '24px', backgroundColor: '#30363d', margin: '0 8px' }}></div>
                  <button onClick={() => setOperacionViendo(null)} style={{ background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', transition: '0.2s' }}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0', borderTop: '1px solid #30363d', marginTop: '4px', flexWrap: 'wrap' }}>
                <span style={{ display: 'block', fontSize: '0.75rem', color: '#8b949e', fontWeight: 'bold', letterSpacing: '0.5px', marginRight: '8px' }}>GENERAR DOCUMENTOS:</span>
                
                {evalIsFletes && (
                  <>
                    <button onClick={handleDescargarCartaInstrucciones} style={btnDocStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      Carta Instrucciones
                    </button>
                    <button onClick={handleDescargarPruebaEntrega} style={btnDocStyle}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                      Prueba Entrega
                    </button>
                  </>
                )}

                <button onClick={handleDescargarCheckList} style={btnDocStyle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Check List
                </button>
                <button onClick={handleDescSolicitudRetiro} style={btnDocStyle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Solicitud Retiro
                </button>
                <button onClick={handleDescargarInstruccionesServicio} style={btnDocStyle}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  Instrucciones Serv.
                </button>
              </div>

            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 32px', overflowX: 'auto', flexShrink: 0 }}>
              {tabsDetalle.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setPestañaDetalleActiva(tab.id)}
                  style={{
                    padding: '12px 16px',
                    background: 'none',
                    border: 'none',
                    borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent',
                    color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e',
                    cursor: 'pointer',
                    fontWeight: pestañaDetalleActiva === tab.id ? '600' : 'normal',
                    fontSize: '0.95rem',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s'
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="detail-content" style={{ padding: '24px 32px', overflowY: 'auto', flex: 1 }}>
              
              {pestañaDetalleActiva === 'general' && (
                <div style={{ animation: 'fadeIn 0.2s ease', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Tipo de Operación</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.tipoOperacionNombre || operacionViendo.tipoOperacionId || '-'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Servicio / Status</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.fechaServicio)} <span style={{color: '#30363d', margin: '0 8px'}}>|</span> <span style={{color: '#10b981', fontWeight: 'bold'}}>{operacionViendo.statusNombre || operacionViendo.status || '-'}</span></span>
                  </div>
                  
                  {evalIsFletes ? (
                     <div>
                       <span style={{ display: 'block', fontSize: '0.8rem', color: '#D84315', fontWeight: 'bold', marginBottom: '4px' }}>Fecha de Cita</span>
                       <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{formatearFechaHora(operacionViendo.fechaCita)}</span>
                     </div>
                  ) : (
                    <div></div> 
                  )}

                  <div style={{ gridColumn: 'span 3' }}><hr style={{ borderColor: '#30363d', margin: '8px 0' }} /></div>

                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Cliente (Paga)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.clienteNombre || operacionViendo.nombreCliente || operacionViendo.clientePaga)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Convenio (Tarifa)</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.convenioNombre || operacionViendo.convenio || '-'}</span> 
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}># de Remolque</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.remolquePlaca || operacionViendo.numeroRemolque || '-'}</span>
                  </div>
                  
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Ref Cliente</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{mostrarDato(operacionViendo.refCliente)}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Origen</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.origenNombre || operacionViendo.origen || '-'}</span>
                  </div>
                  <div>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#58a6ff', fontWeight: 'bold', marginBottom: '4px' }}>Destino</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.destinoNombre || operacionViendo.destino || '-'}</span>
                  </div>
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
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.clienteMercanciaNombre || operacionViendo.clienteMercancia || '-'}</span>
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
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.embalajeNombre || operacionViendo.embalaje || '-'}</span>
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
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.provServiciosNombre || operacionViendo.provServicios || '-'}</span>
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
                      <span style={{ color: '#58a6ff', fontWeight: 'bold', fontSize: '1.1rem' }}>{operacionViendo.proveedorUnidadNombre || operacionViendo.proveedorUnidad || '-'}</span>
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
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.convenioProveedorNombre || operacionViendo.convenioProveedor || '-'}</span>
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
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.unidadNombre || operacionViendo.unidad || '-'}</span>
                      </div>
                      <div style={{ gridColumn: 'span 2' }}>
                        <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px' }}>Operador Asignado</span>
                        <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '1.05rem' }}>{operacionViendo.operadorNombre || operacionViendo.operador || '-'}</span>
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

            <div className="form-actions detail-actions" style={{ padding: '16px 32px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #30363d', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
              <button onClick={() => setOperacionViendo(null)} className="btn btn-outline" style={{ padding: '10px 32px', borderRadius: '6px' }}>Cerrar Ficha</button>
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
                          <td style={{ padding: '16px 12px', color: '#10b981', fontWeight: 'bold' }}>{mostrarDatoMapeado(h.status, 'statusServicio', 'nombre')}</td>
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

    </div>
  );
};

export default ServiciosCompletados;
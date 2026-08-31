// src/features/empresas/components/EmpresasDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { propagarMonedaEmpresa } from '../services/propagarMoneda';
import { notificarOperacionGuardada } from '../../../utils/operacionesBus';
import { collection, onSnapshot, getDocs, query, where, limit, orderBy, writeBatch, doc, deleteDoc } from 'firebase/firestore';
import { db, eliminarRegistro, actualizarRegistro } from '../../../config/firebase';
import { FormularioEmpresa, TIPOS_DOCUMENTO_EMPRESA } from './FormularioEmpresa';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import { CargaMasivaDocumentosModal } from '../../documentos/CargaMasivaDocumentosModal';
import { DocumentosLista } from '../../documentos/DocumentosLista';
import { registrarLog } from '../../../utils/logger';
import * as XLSX from 'xlsx';
import './EmpresasDashboard.css';
import { almacenSesion } from '../../../utils/cacheMemoria';
import { hoyLocalISO, fechaLocalISO } from '../../../utils/fechaHoraLocal';

const opcionesFiltro = [
  'Todo', 'Proveedor (Servicios)', 'Empresa Inactiva', 'Baja', 'Cliente (Mercancía)', 
  'Propietario (Remolques)', 'Bodega', 'Cliente (Paga)', 'Proveedor (Transporte)', 'Empresas Roelca'
];

const opcionesColumnasExcel = [
  { key: 'numCliente', label: '# de Cliente' },
  { key: 'nombre', label: 'Razón Social' },
  { key: 'nombreCorto', label: 'Nombre Corto' },
  { key: 'status', label: 'Status' },
  { key: 'tiposEmpresa', label: 'Tipo(s) de Empresa' },
  { key: 'servicios', label: 'Servicios Ofrecidos' },
  { key: 'clienteRelacionado', label: 'Cliente Relacionado' },
  { key: 'rfcTaxId', label: 'RFC/Tax ID' },
  { key: 'fechaUltimoServicio', label: 'Último Servicio' },
  { key: 'regimenFiscal', label: 'Régimen Fiscal' },
  { key: 'moneda', label: 'Moneda' },
  { key: 'tipoFactura', label: 'Tipo de Factura' },
  { key: 'condicionPago', label: 'Condición de Pago' },
  { key: 'diasCredito', label: 'Días de Crédito' },
  { key: 'limiteCredito', label: 'Límite de Crédito' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'maps', label: 'Maps' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'correo', label: 'Correo' },
  { key: 'fechaBaja', label: 'Fecha de Baja' },
  { key: 'observacionesBaja', label: 'Observaciones de Baja' }
];

// ✅ NUEVO (V00117): Cliente (Paga) y Proveedor (Transporte) DEBEN tener
//   moneda y tipo de factura (regla de negocio obligatoria).
const requiereMonedaFactura = (emp: any): boolean => {
  const tipos: string[] = emp?._tiposEmpresaArray || [];
  return tipos.includes('Cliente (Paga)') || tipos.includes('Proveedor (Transporte)');
};
const esEmpresaActiva = (emp: any): boolean => emp?.status !== 'Inactiva' && emp?.status !== 'Baja';

// ✅ GRID DINÁMICO DE COLUMNAS BASE PARA LA TABLA PRINCIPAL
const COLUMNAS_BASE = [
  { id: 'numCliente', label: '# de Cliente', visible: true },
  { id: 'nombre', label: 'Empresa', visible: true },
  { id: 'nombreCorto', label: 'Nombre Corto', visible: true },
  { id: 'tiposEmpresa', label: 'Tipo de Empresa', visible: true },
  { id: 'servicios', label: 'Servicios', visible: true },
  { id: 'rfcTaxId', label: 'RFC / Tax Id', visible: true },
  { id: 'moneda', label: 'Moneda', visible: true }, // ✅ NUEVO (V00117)
  { id: 'fechaServicio', label: 'Fecha Serv.', visible: true }
];

const EmpresasDashboard = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [empresaEditando, setEmpresaEditando] = useState<any | null>(null);
  
  const [empresaViendo, setEmpresaViendo] = useState<any | null>(null);
  // ✅ Documentos COMPLETOS del catálogo de direcciones (país, estado, colonia,
  //   calle, C.P., números) para el desglose en el detalle de la empresa.
  const [direccionesDocs, setDireccionesDocs] = useState<Record<string, any>>({});
  const [activeTabDetalle, setActiveTabDetalle] = useState<'general' | 'fiscal' | 'contacto' | 'uso' | 'documentos' | 'referencias'>('general');
  // ✅ NUEVO: referencias (operaciones) del cliente, cargadas al abrir su pestaña.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- docs de operación sin tipo canónico (mismo criterio del resto del módulo).
  const [refsCliente, setRefsCliente] = useState<any[] | null>(null);
  const [cargandoRefs, setCargandoRefs] = useState(false);
  const [busquedaRefs, setBusquedaRefs] = useState('');

  // ═══════════════════════════════════════════════════════════════════════
  // ✅ EMPRESAS DUPLICADAS: grupos con el MISMO NOMBRE (normalizado) o el
  //   MISMO RFC real, y análisis de USO por registro (en qué lugares de la
  //   app aparece cada duplicado) para decidir cuál conservar al depurar.
  // ═══════════════════════════════════════════════════════════════════════
  const [modalDuplicadas, setModalDuplicadas] = useState(false);
  const [cargandoDuplicadas, setCargandoDuplicadas] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- docs de empresa sin tipo canónico (criterio del módulo).
  const [gruposDuplicadas, setGruposDuplicadas] = useState<{ clave: string; criterio: 'nombre' | 'RFC' | 'similar'; miembros: any[] }[] | null>(null);
  const [usoPorEmpresa, setUsoPorEmpresa] = useState<Record<string, { etiqueta: string; cuantos: number; refs?: string[] }[] | 'cargando'>>({});

  const RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];
  const normalizarNombre = (s: string) =>
    String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim();

  const analizarDuplicadas = async () => {
    setModalDuplicadas(true);
    if (gruposDuplicadas) return; // ya analizado en esta visita
    setCargandoDuplicadas(true);
    try {
      const snap = await getDocs(collection(db, 'empresas'));
      // ⚠️ Orden del spread: el id del DOCUMENTO al final, para que un campo
      //   interno llamado "id" (herencia de AppSheet) no lo pise — con ids
      //   pisados las keys de React chocaban y los grupos se veían vacíos.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de empresa sin tipo canónico.
      const todas = snap.docs.map(d => ({ ...(d.data() as any), id: d.id }));

      const porNombre = new Map<string, typeof todas>();
      const porRfc = new Map<string, typeof todas>();
      // ✅ SIMILARES: clave = primera + última palabra del nombre. Atrapa
      //   variaciones con palabras intermedias distintas u omitidas:
      //   "Jesús Molero" y "Jesus Levi Molero" → clave "jesus|molero".
      const porSimilar = new Map<string, typeof todas>();

      todas.forEach(e => {
        const n = normalizarNombre(e.nombre);
        if (n) {
          porNombre.set(n, [...(porNombre.get(n) || []), e]);
          const palabras = n.split(' ').filter(Boolean);
          if (palabras.length >= 2) {
            const claveSim = `${palabras[0]}|${palabras[palabras.length - 1]}`;
            porSimilar.set(claveSim, [...(porSimilar.get(claveSim) || []), e]);
          }
        }
        const rfc = String(e.rfcTaxId || '').trim().toUpperCase();
        if (rfc && !RFC_GENERICOS.includes(rfc)) porRfc.set(rfc, [...(porRfc.get(rfc) || []), e]);
      });

      const grupos: { clave: string; criterio: 'nombre' | 'RFC' | 'similar'; miembros: typeof todas }[] = [];
      porNombre.forEach((miembros, clave) => {
        if (miembros.length > 1) grupos.push({ clave: String(miembros[0].nombre || clave), criterio: 'nombre', miembros });
      });
      const enGrupoExacto = new Set(grupos.flatMap(g => g.miembros.map(m => m.id)));
      porSimilar.forEach((miembros) => {
        // Solo si hay nombres DISTINTOS entre sí (los idénticos ya salieron arriba).
        const nombresUnicos = new Set(miembros.map(m => normalizarNombre(m.nombre)));
        if (miembros.length > 1 && nombresUnicos.size > 1) {
          grupos.push({
            clave: miembros.map(m => String(m.nombre || '(sin nombre)')).slice(0, 2).join('  ≈  ') + (miembros.length > 2 ? '  …' : ''),
            criterio: 'similar',
            miembros,
          });
          miembros.forEach(m => enGrupoExacto.add(m.id));
        }
      });
      porRfc.forEach((miembros, rfc) => {
        if (miembros.length > 1 && !miembros.every(m => enGrupoExacto.has(m.id))) {
          grupos.push({ clave: rfc, criterio: 'RFC', miembros });
        }
      });
      grupos.sort((a, b) => b.miembros.length - a.miembros.length || a.clave.localeCompare(b.clave));
      console.log('[Duplicadas] grupos:', grupos.length, 'ejemplo:', grupos[0]);
      setGruposDuplicadas(grupos);
    } catch (e) {
      console.error('No se pudieron analizar las duplicadas:', e);
      alert('No se pudo analizar las empresas duplicadas.');
      setModalDuplicadas(false);
    } finally {
      setCargandoDuplicadas(false);
    }
  };

  // ✅ ¿Dónde se usa una empresa dentro de la app? (conteos por lugar)
  const analizarUsoEmpresa = async (empresaId: string) => {
    if (usoPorEmpresa[empresaId]) return;
    setUsoPorEmpresa(prev => ({ ...prev, [empresaId]: 'cargando' }));
    try {
      const consultas: { etiqueta: string; col: string; campo: string; conRefs?: boolean }[] = [
        { etiqueta: 'Operaciones · Cliente que Paga', col: 'operaciones', campo: 'clientePaga', conRefs: true },
        { etiqueta: 'Operaciones · Origen', col: 'operaciones', campo: 'origen', conRefs: true },
        { etiqueta: 'Operaciones · Destino', col: 'operaciones', campo: 'destino', conRefs: true },
        { etiqueta: 'Facturas de Clientes', col: 'facturas_clientes', campo: 'clienteId' },
        { etiqueta: 'Facturas de Proveedores', col: 'facturas_proveedores', campo: 'proveedorId' },
        { etiqueta: 'Pagos', col: 'pagos', campo: 'entidadId' },
        { etiqueta: 'Convenios de Clientes', col: 'convenios_clientes', campo: 'clienteId' },
        { etiqueta: 'Contactos', col: 'contactos', campo: 'empresaId' },
      ];
      const resultados = await Promise.all(consultas.map(async (c) => {
        try {
          const snap = await getDocs(query(collection(db, c.col), where(c.campo, '==', empresaId), limit(300)));
          return {
            etiqueta: c.etiqueta,
            cuantos: snap.size,
            refs: c.conRefs
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de operación sin tipo canónico.
              ? snap.docs.slice(0, 30).map(d => String((d.data() as any).ref || d.id))
              : undefined,
          };
        } catch {
          return { etiqueta: c.etiqueta, cuantos: 0 };
        }
      }));
      setUsoPorEmpresa(prev => ({ ...prev, [empresaId]: resultados }));
    } catch (e) {
      console.error('No se pudo analizar el uso de la empresa:', e);
      setUsoPorEmpresa(prev => ({ ...prev, [empresaId]: [] }));
    }
  };

  // ✅ Cargar las operaciones del cliente al abrir su pestaña de Referencias.
  useEffect(() => {
    if (!empresaViendo?.id || activeTabDetalle !== 'referencias') return;
    let activo = true;
    setCargandoRefs(true);
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'operaciones'),
          where('clientePaga', '==', empresaViendo.id),
          limit(1000)
        ));
        if (!activo) return;
        const lista = snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- doc de operación sin tipo canónico.
          .sort((a: any, b: any) => String(b.fechaServicio || '').localeCompare(String(a.fechaServicio || '')));
        setRefsCliente(lista);
      } catch (e) {
        console.error('No se pudieron cargar las referencias del cliente:', e);
        if (activo) setRefsCliente([]);
      } finally {
        if (activo) setCargandoRefs(false);
      }
    })();
    return () => { activo = false; };
  }, [empresaViendo?.id, activeTabDetalle]);

  // Al cambiar de empresa, las referencias del anterior se descartan.
  useEffect(() => { setRefsCliente(null); setBusquedaRefs(''); }, [empresaViendo?.id]);
  const [operacionesUso, setOperacionesUso] = useState<any[]>([]);
  const [cargandoUso, setCargandoUso] = useState(false);
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);
  // ✅ V00156: carga masiva de documentos por carpetas (como en Colaboradores)
  const [mostrarCargaMasiva, setMostrarCargaMasiva] = useState(false);
  // ✅ NUEVO: empresa a la que se le subirá un documento DIRECTO desde la fila
  //   (sin abrir la ficha). Si es null, el modal usa la empresa de la ficha.
  const [empresaDocs, setEmpresaDocs] = useState<any | null>(null);

  const [empresas, setEmpresas] = useState<any[]>([]);
  const [lastUsedMap, setLastUsedMap] = useState<Record<string, string>>({}); 
  const [filtroActivo, setFiltroActivo] = useState('Todo');
  const [busqueda, setBusqueda] = useState('');
  // ✅ NUEVO: panel lateral derecho de filtros + tabla VACÍA hasta presionar Buscar.
  const [drawerFiltrosAbierto, setDrawerFiltrosAbierto] = useState(false);
  const [busquedaHecha, setBusquedaHecha] = useState(false);

  const [modalBajaAbierto, setModalBajaAbierto] = useState(false);
  const [empresaParaBaja, setEmpresaParaBaja] = useState<any | null>(null);
  const [fechaBaja, setFechaBaja] = useState(hoyLocalISO());
  const [observacionesBaja, setObservacionesBaja] = useState('');
  const [guardandoBaja, setGuardandoBaja] = useState(false);

  const [modalExcelAbierto, setModalExcelAbierto] = useState(false);
  const [excelFiltroTipo, setExcelFiltroTipo] = useState('Todo');
  const [excelColumnasSeleccionadas, setExcelColumnasSeleccionadas] = useState<string[]>(
    opcionesColumnasExcel.map(col => col.key)
  );

  const [diccionarios, setDiccionarios] = useState<any>({});
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  // Estados para configuración interactiva de columnas en la tabla
  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasTabla, setColumnasTabla] = useState(COLUMNAS_BASE.map(c => ({ ...c })));
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  useEffect(() => {
    const unsubscribeEmpresas = onSnapshot(collection(db, 'empresas'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      data.sort((a: any, b: any) => {
        if (a.numCliente && b.numCliente) {
          return b.numCliente.localeCompare(a.numCliente, undefined, { numeric: true, sensitivity: 'base' });
        }
        return 0;
      });
      setEmpresas(data);
    });

    const qOps = query(collection(db, 'operaciones'), orderBy('fechaServicio', 'desc'), limit(1500));
    const unsubscribeOperaciones = onSnapshot(qOps, (snap) => {
      const usageMap: Record<string, string> = {};
      
      snap.docs.forEach(doc => {
        const data = doc.data();
        const date = data.fechaServicio || data.createdAt;
        if (!date) return;
        
        const fields = [
          data.clientePaga, 
          data.clienteMercancia, 
          data.provServicios, 
          data.proveedorUnidad, 
          data.destino, 
          data.origen
        ];
        
        fields.forEach(f => {
          if (f && typeof f === 'string') {
            if (!usageMap[f] || new Date(date) > new Date(usageMap[f])) {
              usageMap[f] = date.split('T')[0];
            }
          }
        });
      });
      setLastUsedMap(usageMap);
    });

    // ✅ OPTIMIZACIÓN DE LECTURAS Y DICCIONARIOS A PRUEBA DE FALLOS
    const fetchDiccionarios = async () => {
      const cacheKey = 'roelca_empresas_dict_v2'; // Cambiamos la llave para obligar a que se limpie la caché antigua
      const cacheData = almacenSesion.getItem(cacheKey);
      if (cacheData) {
        setDiccionarios(JSON.parse(cacheData));
        return;
      }

      console.warn(`[FIREBASE READ] Descargando diccionarios de empresas a caché...`);
      try {
        const getDict = async (col: string, labelField: string, formatFn?: Function) => {
          const snap = await getDocs(collection(db, col));
          const dict: any = {};
          snap.forEach(doc => {
            const data = doc.data();
            // A prueba de fallos: busca el campo deseado, o nombre, o tipo, o descripción.
            dict[doc.id] = formatFn ? formatFn(data) : (data[labelField] || data.nombre || data.tipo || data.descripcion || doc.id);
          });
          return dict;
        };

        // ✅ Docs completos de direcciones para el desglose del detalle.
        getDocs(collection(db, 'direcciones')).then(snapDir => {
          const m: Record<string, any> = {};
          snapDir.docs.forEach(dd => { m[dd.id] = { id: dd.id, ...(dd.data() as any) }; });
          setDireccionesDocs(m);
        }).catch(() => {});

        const [reg, mon, fac, dir, tEmpresa, tServicio] = await Promise.all([
          getDict('catalogo_regimen_fiscal', '', (d: any) => `${d.clave} - ${d.descripcion}`),
          getDict('catalogo_moneda', 'moneda'),
          getDict('catalogo_tipo_factura', 'nombre'),
          getDict('direcciones', 'direccionCompleta'),
          getDict('catalogo_tipo_empresa', 'nombre'),
          getDict('catalogo_tipo_servicio', 'nombre')
        ]);

        const totalDict = { 
          regimenes: reg, monedas: mon, facturas: fac, direcciones: dir, 
          tiposEmpresa: tEmpresa, tiposServicio: tServicio 
        };

        almacenSesion.setItem(cacheKey, JSON.stringify(totalDict));
        setDiccionarios(totalDict);
      } catch (error) {
        console.error("Error cargando diccionarios:", error);
      }
    };

    fetchDiccionarios();
    
    return () => {
      unsubscribeEmpresas();
      unsubscribeOperaciones();
    };
  }, []);

  useEffect(() => {
    const syncStatusAutomatico = async () => {
      if (empresas.length === 0 || Object.keys(lastUsedMap).length === 0) return;
      const batch = writeBatch(db);
      let updates = 0;
      const hoy = new Date();

      empresas.forEach(emp => {
        const statusActual = emp.status || 'Activa'; 
        const fechaUso = lastUsedMap[emp.id] || emp.fechaUltimoServicio;
        
        if (!fechaUso) return;

        const diffTime = hoy.getTime() - new Date(fechaUso + 'T00:00:00').getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 91 && statusActual !== 'Baja') {
          batch.update(doc(db, 'empresas', emp.id), {
            status: 'Baja',
            fechaBaja: fechaLocalISO(hoy),
            observacionesBaja: 'Sistema: Baja automática por inactividad mayor a 90 días (Semáforo Rojo).'
          });
          updates++;
        } 
        else if (diffDays <= 90 && statusActual === 'Baja' && emp.observacionesBaja?.includes('Sistema: Baja automática')) {
          batch.update(doc(db, 'empresas', emp.id), {
            status: 'Activa',
            fechaBaja: '',
            observacionesBaja: ''
          });
          updates++;
        }
      });

      if (updates > 0) {
        try {
          await batch.commit();
          console.log(`[SEMÁFORO] Se sincronizó el estatus de ${updates} empresas por inactividad.`);
        } catch (error) {
          console.error("Error al aplicar bajas automáticas:", error);
        }
      }
    };

    const timer = setTimeout(syncStatusAutomatico, 2500);
    return () => clearTimeout(timer);
  }, [empresas, lastUsedMap]);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroActivo]);

  const handleNuevo = () => { setEmpresaEditando(null); setEstadoFormulario('abierto'); };
  
  const editarEmpresa = (empresa: any) => { 
    setEmpresaEditando(empresa); 
    setEmpresaViendo(null); 
    setEstadoFormulario('abierto'); 
  };

  const verDetailDirecto = (empresa: any) => {
    setEmpresaViendo(empresa);
    setActiveTabDetalle('general');
    setCargandoUso(true);
    setOperacionesUso([]);

    const camposConsulta = [
      { field: 'clientePaga', label: 'Cliente (Paga)' },
      { field: 'clienteMercancia', label: 'Cliente (Mercancía)' },
      { field: 'provServicios', label: 'Prov. Servicios' },
      { field: 'proveedorUnidad', label: 'Prov. Unidad' },
      { field: 'destino', label: 'Destino' },
      { field: 'origen', label: 'Origen' }
    ];

    const opsMap = new Map();

    Promise.all(camposConsulta.map(async (c) => {
      const q = query(collection(db, 'operaciones'), where(c.field, '==', empresa.id), limit(15));
      const snap = await getDocs(q);
      
      snap.forEach(doc => {
        if (!opsMap.has(doc.id)) {
          opsMap.set(doc.id, { id: doc.id, ...doc.data(), rolesUso: [c.label] });
        } else {
          opsMap.get(doc.id).rolesUso.push(c.label);
        }
      });
    })).then(() => {
      const opsList = Array.from(opsMap.values()).sort((a, b) => 
        new Date(b.fechaServicio || b.createdAt || 0).getTime() - new Date(a.fechaServicio || a.createdAt || 0).getTime()
      );
      setOperacionesUso(opsList);
      setCargandoUso(false);
    }).catch(() => setCargandoUso(false));
  };
  
  // ═══════════ ✅ NUEVO — UNIR EMPRESAS DUPLICADAS ═══════════
  //   Se seleccionan 2+ registros duplicados y "Unir" conserva UNO,
  //   REAPUNTANDO todas las referencias en los demás módulos (operaciones,
  //   facturación de clientes y proveedores, convenios, unidades de
  //   proveedor, referencias de diesel y documentos) hacia el registro
  //   conservado, y elimina los duplicados. Así la unión aplica en toda la app.
  const [seleccionUnir, setSeleccionUnir] = useState<string[]>([]);
  const [modalUnir, setModalUnir] = useState(false);
  const [conservarId, setConservarId] = useState('');
  const [uniendo, setUniendo] = useState(false);

  const toggleSeleccionUnir = (id: string) => {
    setSeleccionUnir((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const abrirModalUnir = () => {
    if (seleccionUnir.length < 2) return;
    // Por defecto se conserva el registro con MÁS campos llenos (empate: el más antiguo).
    const regs = seleccionUnir.map((id) => empresas.find((e: any) => e.id === id)).filter(Boolean);
    const llenos = (r: any) => Object.values(r || {}).filter((v) => v !== undefined && v !== null && v !== '').length;
    const mejor = [...regs].sort((a: any, b: any) => llenos(b) - llenos(a) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];
    setConservarId(mejor?.id || seleccionUnir[0]);
    setModalUnir(true);
  };

  // Referencias a reapuntar: [colección, campo id, campo nombre (opcional)].
  // ✅ NUEVO — RESOLVER NOMBRES en la pestaña Referencias (origen/destino/
  //   remolque llegan como IDs en operaciones viejas): se cargan los
  //   catálogos una sola vez y se muestran los NOMBRES.
  const [nombresRef, setNombresRef] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (nombresRef !== null) return;
    (async () => {
      try {
        const mapa: Record<string, string> = {};
        for (const col of ['direcciones', 'catalogo_direcciones', 'remolques', 'unidades_proveedor']) {
          try {
            const snap = await getDocs(query(collection(db, col), limit(2000)));
            snap.docs.forEach((d) => {
              const x: any = d.data();
              mapa[d.id] = String(x.nombre || x.direccion || x.alias || x.numeroRemolque || x.placa || '').trim() || d.id;
            });
          } catch { /* colección inexistente: seguir */ }
        }
        setNombresRef(mapa);
      } catch { setNombresRef({}); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const nombreDe = (v: any): string => {
    const s = String(v || '').trim();
    if (!s) return '—';
    // Si parece un ID (hex corto sin espacios) y está en el mapa, se traduce.
    return (nombresRef && nombresRef[s]) ? nombresRef[s] : s;
  };

  const REFERENCIAS_EMPRESA: [string, string, string?][] = [
    ['operaciones', 'clientePaga', 'clientePagaNombre'],
    ['operaciones', 'clienteMercancia', 'clienteMercanciaNombre'],
    ['operaciones', 'provServicios', 'provServiciosNombre'],
    ['facturas_clientes', 'clienteId', 'clienteNombre'],
    ['facturas_proveedores', 'proveedorId', 'proveedorNombre'],
    ['convenios_clientes', 'clienteId', 'clienteNombre'],
    ['convenios_proveedores', 'proveedorId', 'proveedorNombre'],
    ['unidades_proveedor', 'proveedorId', 'proveedorNombre'],
    ['referencias_diesel', 'proveedorId', 'proveedorNombre'],
  ];

  const ejecutarUnion = async () => {
    if (uniendo || !conservarId || seleccionUnir.length < 2) return;
    const kept: any = empresas.find((e: any) => e.id === conservarId);
    const duplicados = seleccionUnir.filter((id) => id !== conservarId);
    if (!kept || duplicados.length === 0) return;

    setUniendo(true);
    try {
      let totalReapuntados = 0;
      const nombreKept = String(kept.nombre || '');

      for (const dupId of duplicados) {
        // 1) Reapuntar referencias por colección/campo.
        for (const [col, campo, campoNombre] of REFERENCIAS_EMPRESA) {
          const snap = await getDocs(query(collection(db, col), where(campo, '==', dupId)));
          for (let i = 0; i < snap.docs.length; i += 400) {
            const lote = snap.docs.slice(i, i + 400);
            const batch = writeBatch(db);
            lote.forEach((d) => {
              const cambios: any = { [campo]: conservarId };
              if (campoNombre && nombreKept) cambios[campoNombre] = nombreKept;
              batch.update(d.ref, cambios);
            });
            await batch.commit();
            totalReapuntados += lote.length;
          }
        }
        // 1b) ✅ FIX FANTASMAS — REAPUNTE POR NOMBRE: las facturas importadas
        //   (AppSheet) y los PAGOS guardan el nombre como texto y su id no
        //   corresponde a la empresa, por lo que el reapunte por id no los
        //   alcanzaba y el duplicado "borrado" seguía apareciendo en Pagos.
        //   Aquí se corrigen por el NOMBRE exacto del duplicado.
        const dupReg: any = empresas.find((e: any) => e.id === dupId);
        const nombresDup = Array.from(new Set([
          String(dupReg?.nombre || ''),
          String(dupReg?.nombre || '').trim(),
          String(dupReg?.nombreCorto || ''),
        ].filter((n) => n && n !== nombreKept)));
        const REFS_POR_NOMBRE: [string, string, Record<string, string>][] = [
          ['facturas_clientes', 'clienteNombre', { clienteId: conservarId, clienteNombre: nombreKept }],
          ['facturas_proveedores', 'proveedorNombre', { proveedorId: conservarId, proveedorNombre: nombreKept }],
          ['pagos', 'entidadNombre', { entidadNombre: nombreKept }],
        ];
        for (const nombreDup of nombresDup) {
          for (const [col, campoN, cambiosN] of REFS_POR_NOMBRE) {
            const snapN = await getDocs(query(collection(db, col), where(campoN, '==', nombreDup)));
            for (let i = 0; i < snapN.docs.length; i += 400) {
              const lote = snapN.docs.slice(i, i + 400);
              const batch = writeBatch(db);
              lote.forEach((d) => batch.update(d.ref, cambiosN));
              await batch.commit();
              totalReapuntados += lote.length;
            }
          }
        }

        // 2) Documentos ligados a la empresa duplicada.
        const snapDocs = await getDocs(query(
          collection(db, 'documentos'),
          where('coleccionOrigen', '==', 'empresas'),
          where('registroId', '==', dupId)
        ));
        for (let i = 0; i < snapDocs.docs.length; i += 400) {
          const lote = snapDocs.docs.slice(i, i + 400);
          const batch = writeBatch(db);
          lote.forEach((d) => batch.update(d.ref, { registroId: conservarId, registroNombre: nombreKept }));
          await batch.commit();
          totalReapuntados += lote.length;
        }
        // 3) Eliminar el duplicado.
        await deleteDoc(doc(db, 'empresas', dupId));
      }

      await registrarLog('Empresas', 'Edición', `Unió ${duplicados.length + 1} registros duplicados en "${nombreKept}" (${totalReapuntados} referencias reapuntadas).`);
      alert(`Unión completada. ✅\n\nSe conservó "${nombreKept}", se eliminaron ${duplicados.length} duplicado(s) y se reapuntaron ${totalReapuntados} referencia(s) en los demás módulos.\n\nNota: si otros módulos están abiertos en otra pestaña del navegador, recárgalos para ver el cambio.`);
      setSeleccionUnir([]);
      setModalUnir(false);
    } catch (e: any) {
      console.error('Error al unir empresas:', e);
      alert('La unión no se completó del todo.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido') + '\n\nVuelve a intentar: los registros ya reapuntados no se duplican.');
    }
    setUniendo(false);
  };

  // ✅ V00147: PROPAGAR la moneda de la empresa a TODAS partes
  //   (convenios → operaciones → facturación/pagos), en cascada y de un clic.
  const [propagandoMoneda, setPropagandoMoneda] = useState('');
  const propagarMoneda = async (emp: any) => {
    if (propagandoMoneda) return;
    if (!window.confirm(
      `Se aplicará la moneda ACTUAL de "${emp.nombre}" (tabla Empresas) en cascada:\n\n` +
      '1) Convenios de clientes y proveedores de esta empresa\n' +
      '2) Operaciones: Facturado En (cliente si es Cliente-Paga, proveedor si es Transporte)\n' +
      '3) Facturación de Clientes y Proveedores (las mismas facturas que usa Pagos)\n\n' +
      'Solo se escriben los registros donde la moneda sea distinta; montos y tarifas no se tocan.\n\n¿Continuar?'
    )) return;
    setPropagandoMoneda(String(emp.id));
    try {
      const r = await propagarMonedaEmpresa(String(emp.id));
      notificarOperacionGuardada(String(emp.id), { moneda: r.monedaNombre }, 'propagar-moneda'); // invalida cachés de Facturación/Pagos
      alert(
        `Moneda "${r.monedaNombre}"${r.canon ? ` (${r.canon})` : ''} aplicada en todas partes. ✅\n\n` +
        `· Convenios de clientes: ${r.conveniosClientes}\n` +
        `· Convenios de proveedores: ${r.conveniosProveedores}\n` +
        `· Operaciones (Facturado En · cliente): ${r.opsCliente}\n` +
        `· Operaciones (Facturado En · proveedor): ${r.opsProveedor}\n` +
        `· Facturas de clientes: ${r.facturasClientes}\n` +
        `· Facturas de proveedores: ${r.facturasProveedores}\n\n` +
        'Nota: los totales de facturas ya emitidas no se recalculan solos; si alguna debe rehacerse con la nueva moneda, usa "Recalcular montos" en su ficha (Pagos). Las monedas de los DETALLES de convenio (tarifas por concepto) son independientes y se editan en el convenio.'
      );
      await registrarLog('Empresas', 'Edición', `Propagó la moneda "${r.monedaNombre}" de ${emp.nombre} a convenios (${r.conveniosClientes + r.conveniosProveedores}), operaciones (${r.opsCliente + r.opsProveedor}) y facturas (${r.facturasClientes + r.facturasProveedores}).`);
    } catch (e: any) {
      alert(`No se pudo propagar la moneda:\n\n${e?.message || e}`);
    } finally { setPropagandoMoneda(''); }
  };

  const eliminarEmpresa = async (id: string) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente esta empresa?')) {
      try {
        await eliminarRegistro('empresas', id);
        await registrarLog('Empresas', 'Eliminación', `Eliminó permanentemente una empresa.`);
        setEmpresaViendo(null); 
      } catch (error) {
        alert('Hubo un error al eliminar. Revisa tu conexión a internet.');
      }
    }
  };

  const abrirModalBaja = (empresa: any) => {
    setEmpresaParaBaja(empresa);
    setFechaBaja(hoyLocalISO());
    setObservacionesBaja('');
    setModalBajaAbierto(true);
  };

  const confirmarBaja = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoBaja(true);
    try {
      await actualizarRegistro('empresas', empresaParaBaja.id, {
        status: 'Baja',
        fechaBaja: fechaBaja,
        observacionesBaja: observacionesBaja
      });
      await registrarLog('Empresas', 'Edición', `Dio de baja a la empresa: ${empresaParaBaja.nombre}`);
      
      if (empresaViendo && empresaViendo.id === empresaParaBaja.id) {
        setEmpresaViendo({ ...empresaViendo, status: 'Baja', fechaBaja, observacionesBaja });
      }
      setModalBajaAbierto(false);
    } catch (error) {
      alert("Error al dar de baja. Revisa tu conexión.");
    } finally {
      setGuardandoBaja(false);
    }
  };

  const renderArrayValues = (values: any) => {
    if (!values) return '-';
    if (Array.isArray(values)) {
      if (values.length === 0) return '-';
      return values.join(', ');
    }
    return values; 
  };

  const mostrarDato = (dato: any) => (dato && dato !== '' ? dato : '-');

  const getLabel = (idOrRaw: string, dictName: string) => {
    if (!idOrRaw) return '-';
    const dict = diccionarios[dictName];
    const idLimpio = String(idOrRaw).trim();
    if (dict && dict[idLimpio]) return dict[idLimpio];
    return idLimpio; 
  };

  const getLabelExt = (labelField: string, idField: string, dictName: string) => {
    if (labelField && labelField !== '-') return labelField;
    if (!idField) return '-';
    const dict = diccionarios[dictName];
    const idLimpio = String(idField).trim();
    if (dict && dict[idLimpio]) return dict[idLimpio];
    return idLimpio;
  };

  // ✅ FUNCIÓN REFORZADA PARA BUSCAR NOMBRES DE ARRAYS
  const getArrayLabels = (idsArray: any, dictName: string) => {
    if (!idsArray) return [];
    const dict = diccionarios[dictName];
    
    const processItem = (item: any) => {
      if (!item) return '';
      // Si el registro ya trae un objeto con el nombre (común en multi-selects viejos)
      if (typeof item === 'object') {
        return item.nombre || item.tipo || dict?.[item.id] || item.id;
      }
      // Si es un simple String (ID)
      const idStr = String(item).trim();
      if (dict && dict[idStr]) return dict[idStr];
      return idStr;
    };

    if (Array.isArray(idsArray)) {
      return idsArray.map(processItem).filter(Boolean);
    }
    if (typeof idsArray === 'string') {
      return [processItem(idsArray)];
    }
    return [];
  };

  const obtenerColorInactividad = (fechaStr: string) => {
    if (!fechaStr) return 'transparent'; 
    const fechaUltimo = new Date(fechaStr + 'T00:00:00');
    const hoy = new Date();
    
    const diffTime = hoy.getTime() - fechaUltimo.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 45) return '#10b981'; 
    if (diffDays >= 46 && diffDays <= 90) return '#f59e0b'; 
    return '#ef4444'; 
  };

  const registrosListos = useMemo(() => {
    return empresas.map(emp => {
      let clienteRelName = emp.clienteRelacionadoNombre;
      if (!clienteRelName && emp.clienteRelacionadoId) {
        const match = empresas.find(e => e.id === emp.clienteRelacionadoId);
        clienteRelName = match ? match.nombre : emp.clienteRelacionadoId;
      }
      
      const fechaDinamicaUso = lastUsedMap[emp.id] || emp.fechaUltimoServicio || '';

      return {
        ...emp,
        _fechaDinamicaUso: fechaDinamicaUso,
        _regimenLabel: getLabelExt(emp.regimenFiscalLabel, emp.regimenFiscalId || emp.regimenFiscal, 'regimenes'),
        _monedaLabel: getLabel(emp.moneda, 'monedas'),
        _facturaLabel: getLabel(emp.tipoFactura, 'facturas'),
        _direccionLabel: getLabelExt(emp.direccionLabel, emp.direccionId || emp.direccion, 'direcciones'),
        _clienteRelLabel: clienteRelName || '-',
        _tiposEmpresaArray: getArrayLabels(emp.tiposEmpresa, 'tiposEmpresa'),
        _tiposServicioArray: getArrayLabels(emp.tiposServicio, 'tiposServicio')
      };
    });
  }, [empresas, diccionarios, lastUsedMap]);

  // ✅ NUEVO (V00117): apartado de empresas obligadas a tener moneda/factura
  //   que aún no la tienen (Cliente Paga y Proveedor Transporte).
  const [verSinMoneda, setVerSinMoneda] = useState(false);
  const empresasSinMoneda = useMemo(
    () => registrosListos.filter((e: any) => requiereMonedaFactura(e) && (!e.moneda || !e.tipoFactura)),
    [registrosListos]
  );

  const registrosFiltrados = useMemo(() => {
    if (verSinMoneda) {
      const base = empresasSinMoneda;
      if (!busqueda.trim()) return base;
      const term = busqueda.toLowerCase();
      return base.filter((emp: any) => String(emp.nombre || '').toLowerCase().includes(term) || String(emp.numCliente || '').toLowerCase().includes(term));
    }
    return registrosListos.filter(emp => {
      let pasaFiltro = true;
      if (filtroActivo === 'Empresa Inactiva') pasaFiltro = emp.status === 'Inactiva';
      else if (filtroActivo === 'Baja') pasaFiltro = emp.status === 'Baja';
      else if (filtroActivo !== 'Todo') {
        pasaFiltro = emp._tiposEmpresaArray.includes(filtroActivo) || emp._tiposServicioArray.includes(filtroActivo);
      }
      if (!pasaFiltro) return false;

      if (!busqueda.trim()) return true;
      const term = busqueda.toLowerCase();
      return (
        String(emp.nombre || '').toLowerCase().includes(term) ||
        String(emp.numCliente || '').toLowerCase().includes(term) ||
        String(emp.nombreCorto || '').toLowerCase().includes(term) ||
        String(emp.rfcTaxId || '').toLowerCase().includes(term) ||
        String(emp._clienteRelLabel || '').toLowerCase().includes(term)
      );
    });
  }, [registrosListos, filtroActivo, busqueda, verSinMoneda, empresasSinMoneda]);

  // ✅ NUEVO — ORDEN POR COLUMNA (clic en el encabezado: asc/desc), mismo
  //   patrón que Operaciones Activas.
  const [ordenEmp, setOrdenEmp] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  const clickOrdenEmp = (col: string) => setOrdenEmp((prev) => prev && prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 });
  const registrosOrdenados = useMemo(() => {
    if (!ordenEmp) return registrosFiltrados;
    const { col, dir } = ordenEmp;
    const valor = (e: any): string | number => {
      const v = e?.[col];
      if (v === undefined || v === null) return '';
      const n = Number(String(v).replace(/[$,\s]/g, ''));
      if (String(v).trim() !== '' && !isNaN(n) && /^[\d.,$\s-]+$/.test(String(v))) return n;
      return String(v).toLowerCase();
    };
    return [...registrosFiltrados].sort((a, b) => {
      const va = valor(a), vb = valor(b);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }, [registrosFiltrados, ordenEmp]);

  // ✅ NUEVO (V00117): la tabla se separa en ACTIVAS (verde) e INACTIVAS/BAJA
  //   (rojo): primero todas las activas, después las inactivas, con un
  //   renglón separador entre grupos.
  const registrosAgrupados = useMemo(() => {
    const activas = registrosOrdenados.filter((e: any) => esEmpresaActiva(e));
    const inactivas = registrosOrdenados.filter((e: any) => !esEmpresaActiva(e));
    return [...activas, ...inactivas];
  }, [registrosOrdenados]);

  const totalPaginas = Math.ceil(registrosAgrupados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosAgrupados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const handleToggleColumnaExcel = (key: string) => {
    setExcelColumnasSeleccionadas(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const seleccionarTodasColumnas = () => setExcelColumnasSeleccionadas(opcionesColumnasExcel.map(c => c.key));
  const deseleccionarTodasColumnas = () => setExcelColumnasSeleccionadas([]);

  // Drag & Drop de columnas
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

  // ✅ RENDERIZADOR CENTRALIZADO DE CELDAS PARA EMPRESAS
  const renderCellContent = (emp: any, colId: string) => {
    const colorSemaforo = obtenerColorInactividad(emp._fechaDinamicaUso);
    switch (colId) {
      case 'numCliente':
        return (
          <div className="ed-x1">
            {colorSemaforo !== 'transparent' && (
              <span 
                title={`Último uso en operaciones: ${emp._fechaDinamicaUso}`} 
                style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: colorSemaforo, display: 'inline-block', flexShrink: 0, boxShadow: `0 0 5px ${colorSemaforo}` }}
              />
            )}
            <span style={{ textDecoration: emp.status === 'Baja' ? 'line-through' : 'none', color: esEmpresaActiva(emp) ? '#3fb950' : '#ef4444', fontFamily: 'monospace' }}>
              {emp.numCliente}
            </span>
          </div>
        );
      case 'nombre':
        return (
          <span style={{ fontWeight: '500', color: esEmpresaActiva(emp) ? '#3fb950' : '#ef4444' }}>
            {emp.nombre} {emp.status === 'Baja' && <span className="ed-x2">BAJA</span>}
          </span>
        );
      case 'nombreCorto': return <span className="ed-x3">{mostrarDato(emp.nombreCorto)}</span>;
      case 'tiposEmpresa': return <span className="ed-x4">{renderArrayValues(emp._tiposEmpresaArray)}</span>;
      case 'servicios': return <span className="ed-x4">{renderArrayValues(emp._tiposServicioArray)}</span>;
      case 'rfcTaxId': return <span className="ed-x5">{mostrarDato(emp.rfcTaxId)}</span>;
      // ✅ NUEVO (V00117): moneda resuelta desde el catálogo; si es obligatoria
      //   y falta (o falta el tipo de factura), se marca en rojo.
      case 'moneda': {
        const faltante = requiereMonedaFactura(emp) && (!emp.moneda || !emp.tipoFactura);
        if (faltante) {
          return <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', border: '1px solid #ef4444', borderRadius: '4px', padding: '2px 6px', whiteSpace: 'nowrap' }} title="Cliente (Paga) y Proveedor (Transporte) deben tener moneda y tipo de factura">{!emp.moneda ? 'SIN MONEDA' : 'SIN TIPO FACT.'}</span>;
        }
        return <span className="ed-x3" title={emp._facturaLabel !== '-' ? `Tipo de factura: ${emp._facturaLabel}` : undefined}>{mostrarDato(emp._monedaLabel)}</span>;
      }
      case 'fechaService':
      case 'fechaServicio':
        return <span className="ed-x3">{mostrarDato(emp._fechaDinamicaUso)}</span>;
      default: return '-';
    }
  };

  const ejecutarExportacionExcel = () => {
    if (excelColumnasSeleccionadas.length === 0) return alert("Selecciona al menos una columna para exportar.");

    let datosAExportar = [...registrosListos];
    
    if (excelFiltroTipo === 'Empresa Inactiva') {
      datosAExportar = datosAExportar.filter(e => e.status === 'Inactiva');
    } else if (excelFiltroTipo === 'Baja') {
      datosAExportar = datosAExportar.filter(e => e.status === 'Baja');
    } else if (excelFiltroTipo !== 'Todo') {
      datosAExportar = datosAExportar.filter(e => e._tiposEmpresaArray.includes(excelFiltroTipo) || e._tiposServicioArray.includes(excelFiltroTipo));
    }

    if (datosAExportar.length === 0) {
      return alert("No hay empresas que coincidan con este filtro para exportar.");
    }

    const datosExcel = datosAExportar.map(emp => {
      const rowData: any = {};
      
      if (excelColumnasSeleccionadas.includes('numCliente')) rowData['# de Cliente'] = emp.numCliente || '';
      if (excelColumnasSeleccionadas.includes('nombre')) rowData['Razón Social'] = emp.nombre || '';
      if (excelColumnasSeleccionadas.includes('nombreCorto')) rowData['Nombre Corto'] = emp.nombreCorto || '';
      if (excelColumnasSeleccionadas.includes('status')) rowData['Status'] = emp.status || '';
      if (excelColumnasSeleccionadas.includes('tiposEmpresa')) rowData['Tipo(s) de Empresa'] = renderArrayValues(emp._tiposEmpresaArray);
      if (excelColumnasSeleccionadas.includes('servicios')) rowData['Servicios Ofrecidos'] = renderArrayValues(emp._tiposServicioArray);
      if (excelColumnasSeleccionadas.includes('clienteRelacionado')) rowData['Cliente Relacionado'] = emp._clienteRelLabel !== '-' ? emp._clienteRelLabel : '';
      if (excelColumnasSeleccionadas.includes('rfcTaxId')) rowData['RFC/Tax ID'] = emp.rfcTaxId || '';
      if (excelColumnasSeleccionadas.includes('fechaUltimoServicio')) rowData['Último Servicio'] = emp._fechaDinamicaUso || '';
      if (excelColumnasSeleccionadas.includes('regimenFiscal')) rowData['Régimen Fiscal'] = emp._regimenLabel !== '-' ? emp._regimenLabel : '';
      if (excelColumnasSeleccionadas.includes('moneda')) rowData['Moneda'] = emp._monedaLabel !== '-' ? emp._monedaLabel : '';
      if (excelColumnasSeleccionadas.includes('tipoFactura')) rowData['Tipo de Factura'] = emp._facturaLabel !== '-' ? emp._facturaLabel : '';
      if (excelColumnasSeleccionadas.includes('condicionPago')) rowData['Condición de Pago'] = emp.condicionPago || '';
      if (excelColumnasSeleccionadas.includes('diasCredito')) rowData['Días de Crédito'] = emp.diasCredito || 0;
      if (excelColumnasSeleccionadas.includes('limiteCredito')) rowData['Límite de Crédito'] = emp.limiteCredito || 0;
      if (excelColumnasSeleccionadas.includes('direccion')) rowData['Dirección'] = emp._direccionLabel !== '-' ? emp._direccionLabel : '';
      if (excelColumnasSeleccionadas.includes('maps')) rowData['Maps'] = emp.maps || '';
      if (excelColumnasSeleccionadas.includes('telefono')) rowData['Teléfono'] = emp.telefono || '';
      if (excelColumnasSeleccionadas.includes('correo')) rowData['Correo'] = emp.correo || '';
      if (excelColumnasSeleccionadas.includes('fechaBaja')) rowData['Fecha de Baja'] = emp.fechaBaja || '';
      if (excelColumnasSeleccionadas.includes('observacionesBaja')) rowData['Observaciones de Baja'] = emp.observacionesBaja || '';

      return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const columnWidths = Object.keys(datosExcel[0]).map(k => ({ wch: Math.max(k.length, 20) }));
    worksheet['!cols'] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Directorio_Empresas');
    XLSX.writeFile(workbook, `Empresas_${excelFiltroTipo.replace(/ /g, '_')}_${hoyLocalISO()}.xlsx`);
    
    setModalExcelAbierto(false);
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 20px', background: 'none', border: 'none',
    borderBottom: isActive ? '2px solid #D84315' : '2px solid transparent',
    color: isActive ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal', fontSize: '0.9rem',
    transition: 'all 0.2s ease', outline: 'none'
  });

  return (
    <div className="module-container ed-x6">
      
      <style>{`
        .detail-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } }
        .dot { height: 10px; width: 10px; borderRadius: '50%'; display: 'inline-block'; }
        .dot-green { backgroundColor: #10b981; }
        .dot-red { backgroundColor: #ef4444; }
        .dot-gray { backgroundColor: #8b949e; }
      `}</style>

      {estadoFormulario !== 'cerrado' && (
        <FormularioEmpresa 
          estado={estadoFormulario} initialData={empresaEditando} registros={empresas}
          onClose={() => { setEstadoFormulario('cerrado'); setEmpresaEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      <div className="ed-x7">
        
        <h1 className="module-title ed-x8">
          Empresas
        </h1>

        <div className="ed-x9">
          
          <div className="ed-x10">
            <button onClick={() => setDrawerFiltrosAbierto(true)} title="Mostrar filtros"
              style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${(busqueda || filtroActivo !== 'Todo') ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              Filtros
              {(busqueda || filtroActivo !== 'Todo') && <span className="ed-x11">{[busqueda, filtroActivo !== 'Todo' ? filtroActivo : ''].filter(Boolean).length}</span>}
            </button>
            {/* ✅ NUEVO: detector de empresas duplicadas (mismo nombre o RFC) */}
            <button className="ed-btn-duplicadas" onClick={analizarDuplicadas} title="Detectar empresas con el mismo nombre o RFC para depurar">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
              Duplicadas
            </button>
              {/* ✅ NUEVO (V00117): apartado de empresas sin moneda/factura obligatoria */}
              <button className="btn btn-outline" onClick={() => { setVerSinMoneda(v => !v); setPaginaActual(1); }}
                style={{ color: empresasSinMoneda.length > 0 ? '#ef4444' : undefined, borderColor: verSinMoneda ? '#ef4444' : undefined, fontWeight: verSinMoneda ? 700 : 400 }}
                title="Cliente (Paga) y Proveedor (Transporte) deben tener moneda y tipo de factura. Este apartado muestra las que aún no los tienen.">
                {verSinMoneda ? '✕ Ver todas' : `Sin moneda (${empresasSinMoneda.length})`}
              </button>
              {/* ✅ NUEVO (V00117): recarga los catálogos (moneda, tipo de factura, etc.) */}
              <button className="btn btn-outline" title="Recargar catálogos: vuelve a leer moneda, tipo de factura, régimen y tipos desde Firebase"
                onClick={() => {
                  try {
                    almacenSesion.removeItem('roelca_empresas_dict_v2');
                    Object.keys(localStorage).filter(k => k.startsWith('cat_v2__') || k.startsWith('cat_v1__')).forEach(k => localStorage.removeItem(k));
                  } catch { /* sin almacenamiento */ }
                  window.location.reload();
                }}>
                ↻ Recargar catálogos
              </button>
            {filtroActivo !== 'Todo' && (
              <span className="ed-x12">
                {filtroActivo}
                <button className="ed-x13" onClick={() => setFiltroActivo('Todo')}>✕</button>
              </span>
            )}
            {busqueda && (
              <span className="ed-x14">
                "{busqueda}"
                <button className="ed-x15" onClick={() => setBusqueda('')}>✕</button>
              </span>
            )}
            <span className="ed-x16">
              {busquedaHecha ? `${registrosFiltrados.length} empresas` : 'Presiona Filtros y Buscar para ver las empresas.'}
            </span>
          </div>

          <div className="ed-x17">
            <button 
              className="btn btn-outline ed-x18" 
              title="Configurar Columnas"
              onClick={() => setModalColumnas(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>
            <button 
              className="btn btn-outline ed-x18" 
              title="Exportar a Excel"
              onClick={() => setModalExcelAbierto(true)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            {/* ✅ NUEVO: unir empresas duplicadas (aparece con 2+ seleccionadas) */}
            {seleccionUnir.length >= 2 && (
              <button
                className="btn ed-x19"
                title={`Unir los ${seleccionUnir.length} registros seleccionados en uno solo`}
                onClick={abrirModalUnir}
                style={{ backgroundColor: '#8957e5', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6l2 2 2-4"></path></svg>
                Unir ({seleccionUnir.length})
              </button>
            )}
            <button 
              className="btn btn-primary ed-x19" 
              title="Agregar Empresa"
              onClick={handleNuevo}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body ed-x20">
          <div className="table-container ed-x21">
            <table className="data-table ed-x22">
              <thead className="ed-x23">
                <tr>
                  {/* ✅ NUEVO: selección para UNIR duplicados */}
                  <th className="ed-x24" style={{ width: '36px', textAlign: 'center' }} title="Seleccionar para unir duplicados"></th>
                  <th className="ed-x24">Acciones</th>
                  {columnasTabla.filter(c => c.visible).map(col => (
                    <th className="ed-x25" key={`th_${col.id}`} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                      title="Clic para ordenar" onClick={() => clickOrdenEmp(col.id)}>
                      {col.label}{ordenEmp?.col === col.id ? (ordenEmp.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHecha ? (
                  <tr><td className="ed-x26" colSpan={columnasTabla.length + 2}>
                    <div className="ed-x27">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="ed-x28">Define tus filtros y presiona <b className="ed-x29">Buscar</b> para ver las empresas.</span>
                      <button className="ed-x30" onClick={() => setDrawerFiltrosAbierto(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td className="ed-x31" colSpan={columnasTabla.length + 2}>
                      {busqueda || filtroActivo !== 'Todo' ? 'No se encontraron empresas con estos filtros.' : 'Aún no hay empresas registradas.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((emp, idxFila) => (<React.Fragment key={emp.id}>
                    {/* ✅ NUEVO (V00117): encabezados de grupo Activas / Inactivas */}
                    {(idxFila === 0 && esEmpresaActiva(emp)) && (
                      <tr><td colSpan={columnasTabla.length + 2} style={{ padding: '6px 12px', color: '#3fb950', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '1px', background: 'rgba(63,185,80,0.08)', borderBottom: '1px solid #21262d' }}>● EMPRESAS ACTIVAS</td></tr>
                    )}
                    {(!esEmpresaActiva(emp) && (idxFila === 0 || esEmpresaActiva(registrosEnPantalla[idxFila - 1]))) && (
                      <tr><td colSpan={columnasTabla.length + 2} style={{ padding: '6px 12px', color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', letterSpacing: '1px', background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid #21262d' }}>● EMPRESAS INACTIVAS / BAJA</td></tr>
                    )}
                    <tr 
                      
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(emp.id)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => verDetailDirecto(emp)}
                    >
                      {/* ✅ NUEVO: checkbox para unir duplicados */}
                      <td className="ed-x32" style={{ textAlign: 'center' }} onClick={(e: any) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={seleccionUnir.includes(emp.id)}
                          onChange={() => toggleSeleccionUnir(emp.id)}
                          style={{ cursor: 'pointer' }}
                          title="Seleccionar para unir duplicados"
                        />
                      </td>
                      <td className="ed-x32" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell ed-x33">
                          
                          {/* ✅ V00147: moneda de la empresa → todas partes */}
                          <button
                            className="btn-small ed-btn-moneda"
                            title="Actualizar la moneda de esta empresa en TODAS partes: convenios, operaciones (Facturado En) y facturación/pagos"
                            disabled={propagandoMoneda === String(emp.id)}
                            onClick={(e) => { e.stopPropagation(); propagarMoneda(emp); }}
                          >{propagandoMoneda === String(emp.id) ? '⏳' : '💱'}</button>
                          <button 
                            className="btn-small btn-edit ed-x34" 
                            title="Editar Empresa"
                            onClick={(e) => { e.stopPropagation(); editarEmpresa(emp); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          
                          {emp.status !== 'Baja' && (
                            <button 
                              className="btn-small btn-warning ed-x35" 
                              title="Dar de Baja"
                              onClick={(e) => { e.stopPropagation(); abrirModalBaja(emp); }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                            </button>
                          )}

                          {/* ✅ NUEVO: subir documento directo desde la fila (sin abrir la ficha) */}
                          <button
                            className="btn-small ed-x34"
                            title="Subir documento"
                            style={{ color: '#fb923c' }}
                            onClick={(e) => { e.stopPropagation(); setEmpresaDocs(emp); setMostrarSubirDoc(true); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(251, 146, 60, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                          </button>
                          <button
                            className="btn-small ed-btn-carga-masiva"
                            title="Carga masiva: sube de golpe la carpeta completa de documentos de esta empresa"
                            onClick={(e) => { e.stopPropagation(); setEmpresaDocs(emp); setMostrarCargaMasiva(true); }}
                          >📁</button>

                          <button 
                            className="btn-small btn-danger ed-x36" 
                            title="Eliminar"
                            onClick={(e) => { e.stopPropagation(); eliminarEmpresa(emp.id); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>

                        </div>
                      </td>
                      {columnasTabla.filter(c => c.visible).map(col => (
                        <td className="ed-x37" key={`cell_${emp.id}_${col.id}`}>
                          {renderCellContent(emp, col.id)}
                        </td>
                      ))}
                    </tr>
                  </React.Fragment>))
                )}
              </tbody>
            </table>
          </div>

          {busquedaHecha && registrosFiltrados.length > 0 && (
            <div className="ed-x38">
              <div className="ed-x39">
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div className="ed-x40">
                <button title="Anterior" onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <span className="ed-x41">{paginaActual} / {totalPaginas || 1}</span>
                <button title="Siguiente" onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MODAL CONFIGURACIÓN COLUMNAS INTERACTIVAS (DRAG & DROP) */}
      {modalColumnas && (
        <div className="modal-overlay ed-x42">
          <div className="ed-x43">
            <div className="ed-x44">
              <h3 className="ed-x45">Configurar Columnas de la Tabla</h3>
              <button className="ed-x46" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="ed-x47">Arrastra los elementos para reorganizar el orden de la tabla. Desmarca las casillas para ocultar columnas.</p>
            
            <ul className="ed-x48">
              {columnasTabla.map((col, idx) => (
                <li 
                  key={col.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, idx)}
                  onDragEnter={() => handleDragEnter(idx)}
                  onDragEnd={() => setDraggedColIndex(null)}
                  onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="ed-x49" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="ed-x50">
              <button className="ed-x51" onClick={() => setModalColumnas(false)}>Aplicar Cambios</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL CONFIGURACIÓN REPORTE EXCEL */}
      {modalExcelAbierto && (
        <div className="modal-overlay ed-x52">
          <div className="ed-x53">
            <div className="ed-x54">
              <h2 className="ed-x55">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#238636" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Generar Reporte Excel
              </h2>
              <button className="ed-x46" onClick={() => setModalExcelAbierto(false)}>✕</button>
            </div>
            <div className="ed-x56">
              <div className="ed-x57">
                <label className="ed-x58">1. Selecciona el Tipo de Cliente/Empresa a exportar:</label>
                <select className="ed-x59" value={excelFiltroTipo} onChange={(e) => setExcelFiltroTipo(e.target.value)}>
                  {opcionesFiltro.map(opcion => (
                    <option key={`xls_${opcion}`} value={opcion}>{opcion === 'Todo' ? 'Todos los registros' : opcion}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="ed-x60">
                  <label className="ed-x61">2. Selecciona las columnas a incluir:</label>
                  <div className="ed-x40">
                    <button className="ed-x62" onClick={seleccionarTodasColumnas}>Marcar todas</button>
                    <button className="ed-x63" onClick={deseleccionarTodasColumnas}>Desmarcar todas</button>
                  </div>
                </div>
                <div className="ed-x64">
                  {opcionesColumnasExcel.map(col => {
                    const isChecked = excelColumnasSeleccionadas.includes(col.key);
                    return (
                      <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isChecked ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input className="ed-x49" type="checkbox" checked={isChecked} onChange={() => handleToggleColumnaExcel(col.key)} />
                        {col.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="ed-x65">
              <button className="ed-x66" onClick={() => setModalExcelAbierto(false)}>Cancelar</button>
              <button className="ed-x67" onClick={ejecutarExportacionExcel}>Generar y Descargar Excel</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALLES DE EMPRESA */}
      {empresaViendo && (
        <div className="modal-overlay ed-x68">
          <div className="form-card detail-card ed-x69">
            
            <div className="form-header ed-x70">
              <div>
                <h2 className="ed-x71">Detalle de Empresa <span className="ed-x29">{empresaViendo.numCliente}</span></h2>
                {empresaViendo.status === 'Baja' && (
                  <span className="ed-x72">
                    EMPRESA DADA DE BAJA EL {empresaViendo.fechaBaja}
                  </span>
                )}
              </div>
              <div className="ed-x73">
                <button className="ed-x74"
                  onClick={() => setMostrarSubirDoc(true)}
                  title="Subir documentos de la empresa"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Subir Documentos
                </button>
                <button className="ed-x46" onClick={() => setEmpresaViendo(null)}>✕</button>
              </div>
            </div>
            
            <div className="ed-x75">
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>General</button>
              <button type="button" onClick={() => setActiveTabDetalle('fiscal')} style={tabStyle(activeTabDetalle === 'fiscal')}>Comercial / Fiscal</button>
              <button type="button" onClick={() => setActiveTabDetalle('contacto')} style={tabStyle(activeTabDetalle === 'contacto')}>Contacto</button>
              <button type="button" onClick={() => setActiveTabDetalle('uso')} style={tabStyle(activeTabDetalle === 'uso')}>Historial de Uso</button>
              <button type="button" onClick={() => setActiveTabDetalle('documentos')} style={tabStyle(activeTabDetalle === 'documentos')}>Documentos</button>
              <button type="button" onClick={() => setActiveTabDetalle('referencias')} style={tabStyle(activeTabDetalle === 'referencias')}>Referencias</button>
            </div>

            <div className="detail-content ed-x76">
              
              {activeTabDetalle === 'general' && (
                <div className="detail-grid ed-x77">
                  <div className="detail-item"><span className="detail-label ed-x78">Razón Social</span><span className="detail-value ed-x79">{mostrarDato(empresaViendo.nombre)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Nombre Corto</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo.nombreCorto)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Status</span><span className="detail-value ed-x80"><span className={`dot ${empresaViendo.status === 'Activa' ? 'dot-green' : empresaViendo.status === 'Baja' ? 'dot-red' : 'dot-gray'}`}></span>{mostrarDato(empresaViendo.status)}</span></div>
                  
                  <div className="detail-item ed-x81"><span className="detail-label ed-x78">Tipo(s) de Empresa</span><span className="detail-value ed-x3">{renderArrayValues(empresaViendo._tiposEmpresaArray)}</span></div>
                  <div className="detail-item ed-x81"><span className="detail-label ed-x78">Servicios Ofrecidos</span><span className="detail-value ed-x3">{renderArrayValues(empresaViendo._tiposServicioArray)}</span></div>
                  
                  <div className="detail-item"><span className="detail-label ed-x78">RFC / Tax ID</span><span className="detail-value font-mono ed-x3">{mostrarDato(empresaViendo.rfcTaxId)}</span></div>
                  <div className="detail-item ed-x82"><span className="detail-label ed-x78">Fecha del último servicio</span><span className="detail-value ed-x3">
                    {obtenerColorInactividad(empresaViendo._fechaDinamicaUso) !== 'transparent' && (
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: obtenerColorInactividad(empresaViendo._fechaDinamicaUso), display: 'inline-block', marginRight: '6px', boxShadow: `0 0 5px ${obtenerColorInactividad(empresaViendo._fechaDinamicaUso)}` }}></span>
                    )}
                    {mostrarDato(empresaViendo._fechaDinamicaUso)}
                  </span></div>
                  
                  {Array.isArray(empresaViendo.tiposEmpresa) && empresaViendo.tiposEmpresa.includes('Cliente (Mercancía)') && (
                    <div className="detail-item ed-x81"><span className="detail-label ed-x78">Cliente Paga (Relacionado)</span><span className="detail-value ed-x83">{mostrarDato(empresaViendo._clienteRelLabel)}</span></div>
                  )}

                  {empresaViendo.status === 'Baja' && (
                    <div className="ed-x84">
                      <div className="detail-item ed-x85"><span className="detail-label ed-x86">Fecha de Baja</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo.fechaBaja)}</span></div>
                      <div className="detail-item"><span className="detail-label ed-x86">Observaciones de Baja</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo.observacionesBaja)}</span></div>
                    </div>
                  )}
                </div>
              )}

              {activeTabDetalle === 'fiscal' && (
                <div className="detail-grid ed-x77">
                  <div className="detail-item ed-x81"><span className="detail-label ed-x78">Régimen Fiscal</span><span className="detail-value ed-x87">{mostrarDato(empresaViendo._regimenLabel)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Moneda</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo._monedaLabel)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Tipo de Factura</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo._facturaLabel)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Condición de Pago</span><span className="detail-value ed-x88">{mostrarDato(empresaViendo.condicionPago)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Días de Crédito</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo.diasCredito)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Límite de Crédito</span><span className="detail-value ed-x3">{empresaViendo.limiteCredito ? `$${empresaViendo.limiteCredito}` : '-'}</span></div>
                </div>
              )}

              {activeTabDetalle === 'contacto' && (
                <div className="detail-grid ed-x89">
                  <div className="detail-item ed-x82"><span className="detail-label ed-x78">Dirección de Facturación</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo._direccionLabel)}</span></div>
                  {/* Desglose de la dirección (campos del catálogo de direcciones). */}
                  {(() => {
                    // ✅ Por id y, si el id quedó desactualizado, por coincidencia
                    //   del texto de la dirección completa.
                    const dirSel = direccionesDocs[String(empresaViendo.direccionId || '')]
                      || Object.values(direccionesDocs).find((d: any) => String(d.direccionCompleta || '').trim().toLowerCase() === String(empresaViendo._direccionLabel || '').trim().toLowerCase() && String(d.direccionCompleta || '').trim() !== '');
                    if (!dirSel) return null;
                    const v = (x: any) => String(x ?? '').trim() || '—';
                    const itemDir = (etiqueta: string, valor: any) => (
                      <div className="detail-item">
                        <span className="detail-label ed-x90">{etiqueta}</span>
                        <span className="detail-value ed-x3">{v(valor)}</span>
                      </div>
                    );
                    return (
                      <div className="ed-x91">
                        {itemDir('País', dirSel.paisNombre)}
                        {itemDir('Estado', dirSel.estadoNombre)}
                        {itemDir('Municipio', dirSel.municipioNombre)}
                        {itemDir('Colonia', dirSel.coloniaNombre)}
                        {itemDir('Calle', dirSel.calleNombre)}
                        {itemDir('# Exterior', dirSel.numExterior)}
                        {itemDir('# Interior', dirSel.numInterior)}
                        {itemDir('Código Postal', dirSel.cpNombre)}
                      </div>
                    );
                  })()}
                  <div className="detail-item ed-x82"><span className="detail-label ed-x78">Link de Maps</span>
                    {empresaViendo.maps ? <a className="ed-x92" href={empresaViendo.maps} target="_blank" rel="noopener noreferrer">Ver en Google Maps ↗</a> : <span className="ed-x3">-</span>}
                  </div>
                  <div className="detail-item"><span className="detail-label ed-x78">Teléfono</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo.telefono)}</span></div>
                  <div className="detail-item"><span className="detail-label ed-x78">Correo Electrónico</span><span className="detail-value ed-x3">{mostrarDato(empresaViendo.correo)}</span></div>
                </div>
              )}

              {/* TABLA HISTORIAL DE USO */}
              {activeTabDetalle === 'uso' && (
                <div className="ed-x93">
                  {cargandoUso ? (
                    <div className="ed-x94">Cargando historial detallado...</div>
                  ) : operacionesUso.length === 0 ? (
                    <div className="ed-x95">
                      Esta empresa aún no ha sido utilizada en ninguna operación bajo los roles verificados.
                    </div>
                  ) : (
                    <>
                      <p className="ed-x96">
                        Mostrando las operaciones donde esta empresa coincidió como: Cliente Paga, Cliente Mercancía, Prov. Servicios, Prov. Unidad, Destino u Origen.
                      </p>
                      <table className="ed-x97">
                        <thead className="ed-x98">
                          <tr>
                            <th className="ed-x99">REF. OPERACIÓN</th>
                            <th className="ed-x99">FECHA</th>
                            <th className="ed-x99">ROLES EN LA OP.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {operacionesUso.map(op => (
                            <tr className="ed-x100" key={op.id}>
                              <td className="ed-x101">{op.ref || op.id.substring(0,6)}</td>
                              <td className="ed-x102">{op.fechaServicio || op.createdAt}</td>
                              <td className="ed-x102">
                                <div className="ed-x103">
                                  {op.rolesUso.map((rol: string, idx: number) => (
                                    <span className="ed-x104" key={idx}>
                                      {rol}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {activeTabDetalle === 'documentos' && (
                <DocumentosLista coleccionOrigen="empresas" registroId={empresaViendo.id ?? ''} />
              )}

              {/* ✅ NUEVO: todas las referencias (operaciones) de este cliente */}
              {activeTabDetalle === 'referencias' && (
                <div className="ed-refs">
                  {cargandoRefs ? (
                    <p className="ed-refs-vacio">Cargando referencias…</p>
                  ) : !refsCliente || refsCliente.length === 0 ? (
                    <p className="ed-refs-vacio">Este cliente no tiene operaciones registradas (como "Cliente que Paga").</p>
                  ) : (() => {
                    const b = busquedaRefs.trim().toLowerCase();
                    const visibles = !b ? refsCliente : refsCliente.filter(op =>
                      String(op.ref || '').toLowerCase().includes(b) ||
                      String(op.statusNombre || '').toLowerCase().includes(b) ||
                      String(op.tipoOperacionNombre || '').toLowerCase().includes(b) ||
                      String(op.origen || '').toLowerCase().includes(b) ||
                      String(op.destino || '').toLowerCase().includes(b)
                    );
                    return (
                      <>
                        <div className="ed-refs-encabezado">
                          <span className="ed-refs-conteo"><b>{visibles.length}</b>{b ? ` de ${refsCliente.length}` : ''} referencia(s)</span>
                          <input
                            type="text"
                            className="ed-refs-buscador"
                            placeholder="Buscar por referencia, status, tipo, origen o destino..."
                            value={busquedaRefs}
                            onChange={(e) => setBusquedaRefs(e.target.value)}
                          />
                        </div>
                        <div className="ed-refs-marco">
                          <table className="ed-refs-tabla">
                            <thead>
                              <tr><th>REFERENCIA</th><th>FECHA SERVICIO</th><th>TIPO</th><th>STATUS</th><th>ORIGEN</th><th>DESTINO</th><th>REMOLQUE</th></tr>
                            </thead>
                            <tbody>
                              {visibles.map(op => (
                                <tr key={op.id}>
                                  <td className="ed-refs-ref" style={{ cursor: 'pointer', textDecoration: 'underline' }}
                                    title="Copiar la referencia para buscarla en Operaciones"
                                    onClick={() => { navigator.clipboard?.writeText(String(op.ref || op.id)).catch(() => {}); }}>
                                    {op.ref || op.id}
                                  </td>
                                  <td>{op.fechaServicio || '—'}</td>
                                  <td>{op.tipoOperacionNombre || '—'}</td>
                                  <td>{op.statusNombre || '—'}</td>
                                  <td>{nombreDe(op.origenNombre || op.origen)}</td>
                                  <td>{nombreDe(op.destinoNombre || op.destino)}</td>
                                  <td>{nombreDe(op.remolqueNombre || op.numeroRemolque)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}
                </div>
              )}

            </div>
            
            <div className="ed-x105">
              <button onClick={() => setEmpresaViendo(null)} className="btn btn-outline">Cerrar Detalles</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE BAJA DE EMPRESA */}
      {modalBajaAbierto && (
        <div className="modal-overlay ed-x106">
          <div className="form-card modal-content ed-x107">
            <h3 className="ed-x108">Dar de baja Empresa</h3>
            <p className="ed-x109">Vas a dar de baja a: <strong>{empresaParaBaja?.nombre}</strong></p>
            <form onSubmit={confirmarBaja}>
              <div className="form-group ed-x110">
                <label className="ed-x111">Fecha de Baja *</label>
                <input 
                  type="date" 
                  className="form-control ed-x112" 
                  value={fechaBaja} 
                  onChange={(e) => setFechaBaja(e.target.value)} 
                  required
                />
              </div>
              <div className="form-group ed-x57">
                <label className="ed-x111">Observaciones (Opcional)</label>
                <textarea 
                  className="form-control ed-x112" 
                  rows={3} 
                  value={observacionesBaja} 
                  onChange={(e) => setObservacionesBaja(e.target.value)} 
                  placeholder="Motivo de la baja..."
                />
              </div>
              <div className="form-actions ed-x113">
                <button type="button" className="btn btn-outline ed-x114" onClick={() => setModalBajaAbierto(false)} disabled={guardandoBaja}>Cancelar</button>
                <button type="submit" className="btn btn-danger ed-x115" disabled={guardandoBaja}>
                  {guardandoBaja ? 'Guardando...' : 'Confirmar Baja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ✅ NUEVO — MODAL UNIR EMPRESAS DUPLICADAS */}
      {modalUnir && (
        <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={() => !uniendo && setModalUnir(false)}>
          <div style={{ width: 'min(560px, 94vw)', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '12px', padding: '20px', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 6px 0', color: '#f0f6fc', fontSize: '1.05rem' }}>Unir registros duplicados</h3>
            <p style={{ margin: '0 0 14px 0', color: '#8b949e', fontSize: '0.85rem', lineHeight: 1.5 }}>
              Elige cuál registro se <b style={{ color: '#3fb950' }}>CONSERVA</b>. Los demás se eliminarán y TODAS sus
              referencias (operaciones, facturación, convenios, unidades de proveedor, diesel y documentos)
              se reapuntarán al conservado — la unión aplica en toda la app.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {seleccionUnir.map((id) => {
                const emp: any = empresas.find((e: any) => e.id === id);
                if (!emp) return null;
                const esConservado = conservarId === id;
                return (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '8px', cursor: 'pointer', border: esConservado ? '1px solid #3fb950' : '1px solid #30363d', backgroundColor: esConservado ? 'rgba(63,185,80,0.08)' : '#0d1117' }}>
                    <input type="radio" name="conservar" checked={esConservado} onChange={() => setConservarId(id)} />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', color: '#f0f6fc', fontWeight: 600 }}>{emp.nombre || '(sin nombre)'}</span>
                      <span style={{ display: 'block', color: '#8b949e', fontSize: '0.72rem' }}>
                        {emp.tipo || ''}{emp.rfc ? ` · RFC ${emp.rfc}` : ''}{emp.createdAt ? ` · creado ${String(emp.createdAt).slice(0, 10)}` : ''}
                      </span>
                    </span>
                    <span style={{ color: esConservado ? '#3fb950' : '#f85149', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>
                      {esConservado ? 'SE CONSERVA' : 'SE ELIMINA'}
                    </span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '18px', borderTop: '1px solid #30363d', paddingTop: '14px' }}>
              <button type="button" className="btn btn-outline" onClick={() => setModalUnir(false)} disabled={uniendo}
                style={{ padding: '10px 18px' }}>Cancelar</button>
              <button type="button" onClick={ejecutarUnion} disabled={uniendo}
                style={{ padding: '10px 22px', borderRadius: '6px', border: 'none', backgroundColor: uniendo ? '#21262d' : '#8957e5', color: uniendo ? '#6e7681' : '#fff', fontWeight: 'bold', cursor: uniendo ? 'wait' : 'pointer' }}>
                {uniendo ? 'Uniendo… (no cierres la ventana)' : `Unir ${seleccionUnir.length} registros`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL SUBIR DOCUMENTOS (ligado a la empresa) */}
      {/* ✅ NUEVO: funciona desde la ficha O directo desde la fila de la tabla */}
      {(empresaDocs || empresaViendo) && (() => {
        const objetivo = empresaDocs || empresaViendo;
        return (
          <>
          {/* ✅ V00156: carga masiva por carpetas */}
          <CargaMasivaDocumentosModal
            isOpen={mostrarCargaMasiva}
            onClose={() => { setMostrarCargaMasiva(false); setEmpresaDocs(null); }}
            coleccionOrigen="empresas"
            registroId={objetivo.id ?? ''}
            registroNombre={objetivo.nombre || ''}
          />
          <DocumentoUploadModal
            isOpen={mostrarSubirDoc}
            onClose={() => { setMostrarSubirDoc(false); setEmpresaDocs(null); }}
            coleccionOrigen="empresas"
            registroId={objetivo.id ?? ''}
            registroNombre={objetivo.nombre || ''}
            tiposDocumento={TIPOS_DOCUMENTO_EMPRESA}
          />
          </>
        );
      })()}

      {/* NUEVO: panel lateral DERECHO de filtros (Empresas) */}
      {drawerFiltrosAbierto && (
        <div className="ed-x116" onClick={() => setDrawerFiltrosAbierto(false)}>
          <div className="ed-x117" onClick={(e) => e.stopPropagation()}>
            <div className="ed-x118">
              <h3 className="ed-x119">Filtros · Empresas</h3>
              <button className="ed-x46" onClick={() => setDrawerFiltrosAbierto(false)}>✕</button>
            </div>

            <div className="ed-x120">
              <label className="ed-x121">BÚSQUEDA</label>
              <div className="ed-x122">
                <svg className="ed-x123" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="ed-x124" type="text" placeholder="Razón social, RFC, alias o # cliente..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
                {busqueda && (
                  <button className="ed-x125" onClick={() => setBusqueda('')} title="Limpiar">✕</button>
                )}
              </div>
            </div>

            <div className="ed-x120">
              <label className="ed-x126">TIPO / STATUS</label>
              <select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: `1px solid ${filtroActivo !== 'Todo' ? '#a371f7' : '#30363d'}`, borderRadius: '6px', color: filtroActivo !== 'Todo' ? '#a371f7' : '#c9d1d9', cursor: 'pointer', fontWeight: filtroActivo !== 'Todo' ? 'bold' : 'normal', boxSizing: 'border-box' }}>
                {opcionesFiltro.map(opcion => (
                  <option key={opcion} value={opcion}>{opcion === 'Todo' ? 'Todos' : opcion}</option>
                ))}
              </select>
            </div>

            <div className="ed-x127">
              Todos los campos son <b className="ed-x128">opcionales</b>. Presiona <b className="ed-x29">Buscar</b> para ver todas las empresas.
            </div>

            <div className="ed-x129">
              <button className="ed-x130" onClick={() => { setBusqueda(''); setFiltroActivo('Todo'); setBusquedaHecha(false); }}>Limpiar</button>
              <button className="ed-x131" onClick={() => { setBusquedaHecha(true); setDrawerFiltrosAbierto(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL: EMPRESAS DUPLICADAS + uso dentro de la app */}
      {modalDuplicadas && (
        <div className="modal-overlay ed-dup-overlay" onClick={() => setModalDuplicadas(false)}>
          <div className="ed-dup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ed-dup-encabezado">
              <h2>Empresas Duplicadas</h2>
              <button className="ed-x46" onClick={() => setModalDuplicadas(false)}>✕</button>
            </div>

            <div className="ed-dup-cuerpo">
              {cargandoDuplicadas ? (
                <p className="ed-refs-vacio">Analizando las empresas…</p>
              ) : !gruposDuplicadas || gruposDuplicadas.length === 0 ? (
                <p className="ed-refs-vacio">No se encontraron empresas duplicadas (mismo nombre o mismo RFC). 🎉</p>
              ) : (
                <>
                  <p className="ed-dup-nota">
                    {gruposDuplicadas.length} grupo(s) detectado(s). Presiona <b>Ver uso</b> en cada registro para saber
                    dónde se utiliza dentro de la app; conserva el más usado y elimina el otro desde la tabla principal.
                  </p>
                  {gruposDuplicadas.map((g) => (
                    <div className="ed-dup-grupo" key={`${g.criterio}-${g.clave}-${g.miembros[0]?.id || ''}`}>
                      <div className="ed-dup-grupo-titulo">
                        <span className="ed-dup-nombre">{String(g.clave || g.miembros[0]?.nombre || '(sin nombre)')}</span>
                        <span className={`ed-dup-criterio ${g.criterio === 'RFC' ? 'rfc' : ''} ${g.criterio === 'similar' ? 'similar' : ''}`}>
                          {g.miembros.length} registros · {g.criterio === 'similar' ? 'nombres SIMILARES' : `mismo ${g.criterio}`}
                        </span>
                      </div>
                      {g.miembros.map((m, idx) => (
                        <div className="ed-dup-miembro" key={`${m.id || 'sin-id'}-${idx}`}>
                          <div className="ed-dup-miembro-fila">
                            <span className="ed-x29">{m.numCliente || '—'}</span>
                            <span className="ed-dup-miembro-nombre">{String(m.nombre || '(sin nombre)')}</span>
                            <span className="ed-dup-miembro-dato">{m.rfcTaxId || 'Sin RFC'}</span>
                            {m.status === 'Baja' && <span className="ed-x2">BAJA</span>}
                            <button className="ed-dup-ver-uso" onClick={() => analizarUsoEmpresa(m.id)} disabled={usoPorEmpresa[m.id] === 'cargando'}>
                              {usoPorEmpresa[m.id] === 'cargando' ? 'Analizando…' : usoPorEmpresa[m.id] ? 'Actualizar' : 'Ver uso'}
                            </button>
                          </div>
                          {Array.isArray(usoPorEmpresa[m.id]) && (
                            <div className="ed-dup-uso">
                              {(usoPorEmpresa[m.id] as { etiqueta: string; cuantos: number; refs?: string[] }[]).every(u => u.cuantos === 0) ? (
                                <span className="ed-dup-sin-uso">Sin uso detectado en la app — candidata segura a eliminarse.</span>
                              ) : (
                                (usoPorEmpresa[m.id] as { etiqueta: string; cuantos: number; refs?: string[] }[])
                                  .filter(u => u.cuantos > 0)
                                  .map(u => (
                                    <div className="ed-dup-uso-fila" key={u.etiqueta}>
                                      <span className="ed-dup-uso-etiqueta">{u.etiqueta}</span>
                                      <span className="ed-dup-uso-conteo">{u.cuantos}{u.cuantos >= 300 ? '+' : ''}</span>
                                      {u.refs && u.refs.length > 0 && (
                                        <div className="ed-dup-uso-refs">
                                          {u.refs.map(r => <span className="ed-refs-ref" key={r}>{r}</span>)}
                                          {u.cuantos > u.refs.length && <span className="ed-dup-mas">+{u.cuantos - u.refs.length} más</span>}
                                        </div>
                                      )}
                                    </div>
                                  ))
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmpresasDashboard;
// src/features/catalogos/components/CatalogosDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro, eliminarRegistro } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger'; // ✅ Importación del logger

import { listaCatalogos } from '../config/catalogSchemas';
import type { CatalogSchema, CatalogField } from '../config/catalogSchemas';
import { SelectBuscable } from './SelectBuscable';
import './CatalogosDashboard.css';

// ✅ Helper compartido: resuelve la etiqueta a mostrar de una opción dinámica
//    (misma cadena de respaldos que usaban los <select> nativos)
const etiquetaDeOpcion = (opt: any, labelField: string, valueField: string): string =>
  String(opt[labelField] || opt.nombreCorto || opt.razonSocial || opt.nombre || opt.moneda || opt.descripcion || opt.tipo || opt[valueField] || opt.id);

// 🔥 CACHÉ GLOBAL DE MÓDULO PARA ELIMINAR LECTURAS EXCESIVAS EN FIREBASE 🔥
const CACHE_OPCIONES_DINAMICAS: Record<string, any[]> = {};
const CACHE_NOMBRES_COLECCIONES: Record<string, string> = {};

// =========================================
// COMPONENTE PRINCIPAL
// =========================================
const CatalogosDashboard = () => {
  const [catalogoSeleccionado, setCatalogoSeleccionado] = useState<CatalogSchema | null>(null);
  const [registrosGlobales, setRegistrosGlobales] = useState<any[]>([]);
  
  const [modalEstado, setModalEstado] = useState<'cerrado' | 'formulario' | 'config_obligatorios'>('cerrado');
  const [registroActual, setRegistroActual] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  
  const [camposRequeridos, setCamposRequeridos] = useState<Record<string, string[]>>({});
  const [opcionesDinamicas, setOpcionesDinamicas] = useState<Record<string, any[]>>({});
  const [busqueda, setBusqueda] = useState('');
  const [filtroFijo, setFiltroFijo] = useState<string>('');

  const [viendoDetalles, setViendoDetalles] = useState<boolean>(false);
  
  // 🔥 ESTADO CENTRALIZADO PARA SUB-COLECCIONES (0 LECTURAS AL HACER CLIC)
  const [subDocsSnapshot, setSubDocsSnapshot] = useState<Record<string, any[]>>({});

  const [subModalEstado, setSubModalEstado] = useState<'cerrado' | 'abierto'>('cerrado');
  const [subColeccionActual, setSubColeccionActual] = useState<any | null>(null);
  const [subRegistroActual, setSubRegistroActual] = useState<any | null>(null);
  const [subFormData, setSubFormData] = useState<any>({});

  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  useEffect(() => {
    const savedConfig = localStorage.getItem('config_campos_obligatorios');
    if (savedConfig) {
      try { setCamposRequeridos(JSON.parse(savedConfig)); } catch (e) {}
    }
  }, []);

  const handleToggleRequerido = (fieldName: string) => {
    if (!catalogoSeleccionado) return;
    const catId = catalogoSeleccionado.id;
    const currentReq = camposRequeridos[catId] || [];
    const newReq = currentReq.includes(fieldName) ? currentReq.filter(f => f !== fieldName) : [...currentReq, fieldName];
    const newConfig = { ...camposRequeridos, [catId]: newReq };
    setCamposRequeridos(newConfig);
    localStorage.setItem('config_campos_obligatorios', JSON.stringify(newConfig));
  };

  const isCurrencyField = (fieldName: string) => /monto|importe|sueldo|total|precio|cargos|iva|isr|dolares|pesos|costo|pago|tarifa/i.test(fieldName);

  const formatoMoneda = (monto: any) => {
    if (monto === undefined || monto === null || monto === '') return '-';
    const num = Number(monto);
    if (isNaN(num)) return monto;
    return `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getDisplayValue = (reg: any, f: CatalogField | { name: string, label?: string, dynamicOptions?: any, options?: string[], type?: string }) => {
    let valor = reg[f.name];
    if (valor === undefined || valor === null || valor === '') return '-';
    if (typeof valor === 'object' && valor.id) valor = valor.id; 
    else if (Array.isArray(valor)) valor = valor[0] || '';

    if ('options' in f && f.options?.includes('Sí') && f.options?.includes('No')) {
      if (valor === '1' || valor === 1 || valor === true || String(valor).toLowerCase() === 'sí') return 'Sí';
      if (valor === '0' || valor === 0 || valor === false || String(valor).toLowerCase() === 'no') return 'No';
    }

    if ('dynamicOptions' in f && f.dynamicOptions && opcionesDinamicas[f.dynamicOptions.collection]) {
      const dOpt = f.dynamicOptions;
      const valueField = dOpt.valueField || 'id';
      const labelField = dOpt.labelField || 'nombre';
      const encontrado = opcionesDinamicas[dOpt.collection].find((opt: any) => {
        const val1 = String(opt[valueField]).trim().toLowerCase();
        const val2 = String(valor).trim().toLowerCase();
        const fallbackId = String(opt.id).trim().toLowerCase();
        return val1 === val2 || fallbackId === val2;
      });
      if (encontrado) {
        return encontrado[labelField] || encontrado.nombreCorto || encontrado.razonSocial || encontrado.nombre || encontrado.moneda || encontrado.descripcion || encontrado.tipo || valor;
      }
      return valor;
    }

    if ((isCurrencyField(f.name) || f.type === 'currency') && valor !== undefined && valor !== null && valor !== '') return formatoMoneda(valor);
    return String(valor);
  };

  const getDetailTitle = (det: any) => {
    if (det.collection === 'gastos_mtto') return 'Asignar Gastos';
    if (det.collection === 'combustible') return 'Asignar Combustible';
    return det.titulo || det.name || det.collection;
  };

  // ✅ CARGA PRINCIPAL OPTIMIZADA CON CACHÉ (Reduce las lecturas)
  useEffect(() => {
    if (!catalogoSeleccionado) return;
    setViendoDetalles(false);
    setRegistroActual(null);
    setSubDocsSnapshot({});

    const unsubscribe = onSnapshot(collection(db, `catalogo_${catalogoSeleccionado.id}`), (snapshot) => {
      setRegistrosGlobales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const cargarOpcionesDinamicas = async () => {
      const nuevasOpciones: Record<string, any[]> = { ...CACHE_OPCIONES_DINAMICAS };
      const collectionsToFetch = new Set<string>();

      catalogoSeleccionado.fields.forEach((field: CatalogField) => { 
        if (field.dynamicOptions && !CACHE_OPCIONES_DINAMICAS[field.dynamicOptions.collection]) collectionsToFetch.add(field.dynamicOptions.collection); 
      });

      if (catalogoSeleccionado.details) {
        catalogoSeleccionado.details.forEach((det: any) => {
          if (det.fields) det.fields.forEach((f: any) => { 
            if (f.dynamicOptions && !CACHE_OPCIONES_DINAMICAS[f.dynamicOptions.collection]) collectionsToFetch.add(f.dynamicOptions.collection); 
          });
        });
      }

      for (const col of Array.from(collectionsToFetch)) {
        try {
          let querySnapshot = await getDocs(collection(db, col));
          if (querySnapshot.empty && !col.startsWith('catalogo_')) {
            const fallbackSnapshot = await getDocs(collection(db, `catalogo_${col}`));
            if (!fallbackSnapshot.empty) querySnapshot = fallbackSnapshot;
          }
          const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          CACHE_OPCIONES_DINAMICAS[col] = data; // Guardar en caché global
          nuevasOpciones[col] = data;
        } catch (error) {}
      }
      setOpcionesDinamicas(nuevasOpciones);
    };

    cargarOpcionesDinamicas();
    setBusqueda(''); 
    setFiltroFijo('');
    setPaginaActual(1);

    return () => unsubscribe();
  }, [catalogoSeleccionado]);

  // 🔥 DESCARGA Y MANTENIMIENTO DE SUB-COLECCIONES (Sincronizado 1 sola vez)
  useEffect(() => {
    if (!catalogoSeleccionado?.details) return;

    let isMounted = true;
    const currentUnsubs: (() => void)[] = [];

    const loadSubCollections = async () => {
      for (const detail of catalogoSeleccionado.details!) {
        let realCollection = detail.collection;
        
        // Uso de caché para no hacer reads extra validando el nombre de la colección
        if (CACHE_NOMBRES_COLECCIONES[detail.collection]) {
          realCollection = CACHE_NOMBRES_COLECCIONES[detail.collection];
        } else {
          try {
            const snap = await getDocs(collection(db, realCollection));
            if (snap.empty && !realCollection.startsWith('catalogo_')) {
              const fbSnap = await getDocs(collection(db, `catalogo_${realCollection}`));
              if (!fbSnap.empty) realCollection = `catalogo_${realCollection}`;
            }
            CACHE_NOMBRES_COLECCIONES[detail.collection] = realCollection;
          } catch (e) {}
        }
        
        if (!isMounted) return;

        const unsub = onSnapshot(collection(db, realCollection), (snapshot) => {
          setSubDocsSnapshot(prev => ({
            ...prev,
            [detail.collection]: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          }));
        });
        currentUnsubs.push(unsub);
      }
    };

    loadSubCollections();

    return () => {
      isMounted = false;
      currentUnsubs.forEach(unsub => unsub());
    };
  }, [catalogoSeleccionado]);

  // 🔥 SOLUCIÓN AL BUG DE DUPLICADOS: Conteo exacto por documento único
  const conteoDetallesGlobal = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!catalogoSeleccionado?.details || registrosGlobales.length === 0) return counts;
    
    // Convertimos IDs de padres a un Set rápido
    const parentIds = new Set(registrosGlobales.map(r => String(r.id).trim().toLowerCase()));

    // Inicializar todo a 0
    registrosGlobales.forEach(reg => { counts[String(reg.id).trim().toLowerCase()] = 0; });

    catalogoSeleccionado.details.forEach(det => {
      const docs = subDocsSnapshot[det.collection] || [];
      
      docs.forEach(doc => {
        // Escáner profundo del documento
        for (const val of Object.values(doc)) {
          if (!val) continue;
          const strVal = typeof val === 'object' && (val as any).id ? String((val as any).id).trim().toLowerCase() : String(val).trim().toLowerCase();
          
          if (parentIds.has(strVal)) {
            counts[strVal] += 1;
            break; // 🔴 EL BREAK ES VITAL: Si el doc tiene 2 campos con el ID, solo lo cuenta 1 vez
          }
        }
      });
    });
    return counts;
  }, [subDocsSnapshot, registrosGlobales, catalogoSeleccionado]);


  useEffect(() => { setPaginaActual(1); }, [busqueda, filtroFijo]);

  // ✅ LOGICA DE GUARDADO PRINCIPAL CON LOG
  const guardarRegistro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!catalogoSeleccionado) return;

    const camposObligatoriosActuales = camposRequeridos[catalogoSeleccionado.id] || [];
    const camposFaltantes = camposObligatoriosActuales.filter(fieldName => {
      const valor = formData[fieldName];
      return valor === undefined || valor === null || valor === '';
    });

    if (camposFaltantes.length > 0) {
      const nombresFaltantes = catalogoSeleccionado.fields.filter(f => camposFaltantes.includes(f.name)).map(f => f.label);
      alert(`Por favor, llena los siguientes campos obligatorios antes de guardar:\n\n- ${nombresFaltantes.join('\n- ')}`);
      return;
    }

    try {
      const col = `catalogo_${catalogoSeleccionado.id}`;
      
      if (registroActual) {
        await actualizarRegistro(col, registroActual.id, formData);
        await registrarLog('Catálogos', 'Edición', `Editó un registro en el catálogo de ${catalogoSeleccionado.titulo}`);
      } else {
        await agregarRegistro(col, formData);
        await registrarLog('Catálogos', 'Creación', `Agregó un nuevo registro al catálogo de ${catalogoSeleccionado.titulo}`);
      }

      setModalEstado('cerrado');
      setRegistroActual(null); 
    } catch (error) { alert('Error en Firebase al guardar.'); }
  };

  // ✅ FUNCIÓN DE ELIMINACIÓN PRINCIPAL CON LOG
  const eliminarRegistroPrincipal = async (id: string) => {
    if (!catalogoSeleccionado) return;
    if (window.confirm('¿Desea eliminar permanentemente este registro?')) {
      try {
        await eliminarRegistro(`catalogo_${catalogoSeleccionado.id}`, id);
        await registrarLog('Catálogos', 'Eliminación', `Eliminó un registro del catálogo de ${catalogoSeleccionado.titulo}`);
      } catch (error) {
        alert("Hubo un error al intentar eliminar el registro.");
      }
    }
  };

  const handleAgregarEditarSubdetalle = (coleccion: string, data?: any) => {
    const detailConfig = catalogoSeleccionado?.details?.find(d => d.collection === coleccion);
    if (!detailConfig) return;

    setSubColeccionActual(detailConfig);
    setSubRegistroActual(data || null);

    setSubFormData(data || { 
      [detailConfig.foreignKey]: registroActual.id,
      'ID_SERVICES': registroActual.id,
      'tipo_servicio_id': registroActual.id,
      'tarifa_referencia_id': registroActual.id
    });
    setSubModalEstado('abierto');
  };

  // ✅ LOGICA DE GUARDADO DE SUB-REGISTRO CON LOG
  const guardarSubRegistro = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const realCol = CACHE_NOMBRES_COLECCIONES[subColeccionActual.collection] || subColeccionActual.collection;
      const tituloSub = getDetailTitle(subColeccionActual);

      if (subRegistroActual) {
        await actualizarRegistro(realCol, subRegistroActual.id, subFormData);
        await registrarLog('Catálogos', 'Edición', `Editó un detalle (${tituloSub}) en el catálogo de ${catalogoSeleccionado?.titulo}`);
      } else {
        await agregarRegistro(realCol, subFormData);
        await registrarLog('Catálogos', 'Creación', `Agregó un detalle (${tituloSub}) al catálogo de ${catalogoSeleccionado?.titulo}`);
      }
      setSubModalEstado('cerrado');
      setSubRegistroActual(null);
      setSubColeccionActual(null);
      setSubFormData({});
    } catch (error) { alert('Error al guardar el sub-registro en Firebase.'); }
  };

  // ✅ FUNCIÓN DE ELIMINACIÓN DE SUB-REGISTRO CON LOG
  const handleEliminarSubdetalle = async (coleccion: string, id: string) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar este registro permanentemente?')) {
      try { 
        const realCol = CACHE_NOMBRES_COLECCIONES[coleccion] || coleccion;
        await eliminarRegistro(realCol, id); 
        await registrarLog('Catálogos', 'Eliminación', `Eliminó un detalle vinculado al catálogo de ${catalogoSeleccionado?.titulo}`);
      } catch (error) { alert("Hubo un error al eliminar el registro."); }
    }
  };

  const opcionesDeFiltroDropdown = useMemo(() => {
    if (!catalogoSeleccionado) return [];
    const opcionesGeneradas: { label: string, value: string, field: string }[] = [];

    catalogoSeleccionado.fields.forEach((f: CatalogField) => {
      if (f.dynamicOptions && opcionesDinamicas[f.dynamicOptions.collection]) {
        const dOpt = f.dynamicOptions;
        const valueField = dOpt.valueField || 'id';
        const labelField = dOpt.labelField || 'nombre';
        opcionesDinamicas[dOpt.collection].forEach(opt => {
          const labelAMostrar = opt[labelField] || opt.nombreCorto || opt.razonSocial || opt.nombre || opt.moneda || opt.descripcion || opt.tipo || opt[valueField];
          opcionesGeneradas.push({ label: `${f.label}: ${labelAMostrar}`, value: String(opt[valueField] || opt.id), field: f.name });
        });
      } else if (f.options) {
        f.options.forEach(opt => {
          opcionesGeneradas.push({ label: `${f.label}: ${opt}`, value: String(opt), field: f.name });
        });
      }
    });
    return opcionesGeneradas;
  }, [catalogoSeleccionado, opcionesDinamicas]);

  const registrosFiltrados = useMemo(() => {
    if (!catalogoSeleccionado) return [];
    let resultado = [...registrosGlobales];

    resultado.sort((a, b) => {
      const timeA = a.createdAt || a.fechaCreacion;
      const timeB = b.createdAt || b.fechaCreacion;
      if (timeA && timeB && timeA !== timeB) return timeA > timeB ? 1 : -1;

      if (catalogoSeleccionado.fields.length > 0) {
        const campoPrincipal = catalogoSeleccionado.fields.find(f => f.name.toLowerCase() === 'nombre') || catalogoSeleccionado.fields[0];
        const valA = a[campoPrincipal.name];
        const valB = b[campoPrincipal.name];

        if (typeof valA === 'number' && typeof valB === 'number') return valA - valB;
        return String(valA || '').localeCompare(String(valB || ''), undefined, { numeric: true, sensitivity: 'base' });
      }
      return 0;
    });

    if (filtroFijo) {
      const [campo, valor] = filtroFijo.split('|||');
      resultado = resultado.filter(reg => String(reg[campo]) === valor);
    }

    if (busqueda.trim()) {
      const termino = busqueda.toLowerCase();
      resultado = resultado.filter(reg => {
        return Object.entries(reg).some(([key, value]) => {
          if (key === 'id') return false; 
          let cleanValue = value;
          if (cleanValue && typeof cleanValue === 'object' && (cleanValue as any).id) cleanValue = (cleanValue as any).id;

          const fieldConfig = catalogoSeleccionado.fields.find((f: CatalogField) => f.name === key);
          if (fieldConfig?.dynamicOptions && opcionesDinamicas[fieldConfig.dynamicOptions.collection]) {
            const dOpt = fieldConfig.dynamicOptions;
            const valueField = dOpt.valueField || 'id';
            const labelField = dOpt.labelField || 'nombre';

            const optEncontrada = opcionesDinamicas[dOpt.collection].find((opt: any) => 
              String(opt[valueField]).toLowerCase() === String(cleanValue).toLowerCase() || 
              String(opt.id).toLowerCase() === String(cleanValue).toLowerCase()
            );
            
            const labelAsociado = optEncontrada ? (optEncontrada[labelField] || optEncontrada.nombreCorto || optEncontrada.razonSocial || optEncontrada.nombre || optEncontrada.moneda || optEncontrada.descripcion || optEncontrada.tipo || '') : '';
            return String(labelAsociado || '').toLowerCase().includes(termino);
          }
          return String(cleanValue).toLowerCase().includes(termino);
        });
      });
    }

    return resultado;
  }, [registrosGlobales, busqueda, filtroFijo, catalogoSeleccionado, opcionesDinamicas]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  if (!catalogoSeleccionado) return (
    <div className="module-container cd-x1">
      <h1 className="module-title cd-x2">
        Administración de Catálogos
      </h1>
      <div className="catalog-grid">
        {listaCatalogos.map((cat: CatalogSchema) => (
          <div key={cat.id} className="catalog-card" onClick={() => setCatalogoSeleccionado(cat)}>
            <div className="catalog-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">{cat.icono}</svg></div>
            <div className="catalog-title">{cat.titulo}</div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="module-container cd-x3">
      <style>{`
        .detail-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 768px) { .detail-grid-3 { grid-template-columns: 1fr; } }
        .sub-table th, .sub-table td { padding: 12px 16px; }
        .form-input-elegante { width: 100%; padding: 10px; background-color: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; box-sizing: border-box; transition: border-color 0.2s; }
        .form-input-elegante:focus { outline: none; border-color: #58a6ff; }
      `}</style>

      <div className="cd-x4">
        <div className="cd-x5">
          <button className="cd-x6" onClick={() => setCatalogoSeleccionado(null)}>
            ← Volver a Catálogos
          </button>
          <h1 className="module-title cd-x7">{catalogoSeleccionado.titulo}</h1>
        </div>

        <div className="cd-x8">
          <div className="cd-x9">
            <SelectBuscable
              opciones={opcionesDeFiltroDropdown.map((opt) => ({ value: `${opt.field}|||${opt.value}`, label: opt.label }))}
              value={filtroFijo}
              onChange={setFiltroFijo}
              placeholder="Filtro: Todas las colecciones"
            />
          </div>
          <div className="cd-x10">
            <div className="cd-x11">
              <svg className="cd-x12" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input className="cd-x13" type="text" placeholder={`Buscar en ${catalogoSeleccionado.titulo.toLowerCase()}...`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
            </div>
          </div>
          <div className="cd-x14">
            <button className="btn btn-outline cd-x15" title="Configurar Obligatorios" onClick={() => setModalEstado('config_obligatorios')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button className="btn btn-primary cd-x16" title="Agregar Registro" onClick={() => { setRegistroActual(null); setFormData({}); setModalEstado('formulario'); }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body cd-x17">
          <div className="table-container cd-x18">
            <table className="data-table cd-x19">
              <thead className="cd-x20">
                <tr>
                  <th className="cd-x21">Acciones</th>
                  
                  {catalogoSeleccionado.details && catalogoSeleccionado.details.length > 0 && (
                    <th className="cd-x22">
                      Sub-Registros
                    </th>
                  )}

                  {catalogoSeleccionado.fields.map((f: CatalogField) => (
                    <th className="cd-x23" key={f.name}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {registrosEnPantalla.length === 0 ? (
                  <tr><td className="cd-x24" colSpan={catalogoSeleccionado.fields.length + 2}>No hay registros.</td></tr>
                ) : (
                  registrosEnPantalla.map((reg: any) => (
                    <tr key={reg.id} onClick={() => { setRegistroActual(reg); setViendoDetalles(true); }} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(reg.id!)} onMouseLeave={() => setHoveredRowId(null)}>
                      <td className="cd-x25" onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell cd-x26">
                          <button 
                            className="btn-small btn-edit cd-x27" 
                            title="Editar Registro"
                            onClick={(e) => { e.stopPropagation(); setRegistroActual(reg); setFormData(reg); setModalEstado('formulario'); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          
                          {/* ✅ LLAMADA A LA FUNCIÓN REFACTORIZADA PARA ELIMINAR CON LOG */}
                          <button 
                            className="btn-small btn-danger cd-x28" 
                            title="Eliminar Registro"
                            onClick={async (e) => { e.stopPropagation(); await eliminarRegistroPrincipal(reg.id); }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      {catalogoSeleccionado.details && catalogoSeleccionado.details.length > 0 && (
                        <td className="cd-x29">
                          <span className="cd-x30">
                            {conteoDetallesGlobal[String(reg.id).toLowerCase()] || 0} vinculados
                          </span>
                        </td>
                      )}

                      {catalogoSeleccionado.fields.map((f: CatalogField) => (
                        <td className="cd-x31" key={f.name}>{getDisplayValue(reg, f)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {registrosFiltrados.length > 0 && (
            <div className="cd-x32">
              <div className="cd-x33">Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros</div>
              <div className="cd-x34">
                <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <span className="cd-x35">{paginaActual} / {totalPaginas || 1}</span>
                <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ✅ VISTA: MODAL DETALLES (RENDERIZADO INSTANTÁNEO 0 LECTURAS) */}
      {viendoDetalles && registroActual && (
        <div className="modal-overlay cd-x36">
          <div className="form-card detail-card cd-x37">
            <div className="form-header cd-x38">
              <h2 className="cd-x39">Detalles: <span className="cd-x40">{catalogoSeleccionado.titulo}</span></h2>
              <button className="cd-x41" onClick={() => { setViendoDetalles(false); setRegistroActual(null); }}>✕</button>
            </div>
            <div className="detail-content cd-x42">
              <div className="detail-grid-3 cd-x43">
                {catalogoSeleccionado.fields.map((f: CatalogField) => (
                  <div key={f.name}>
                    <span className="cd-x44">{f.label}</span>
                    <span className="cd-x45">{getDisplayValue(registroActual, f)}</span>
                  </div>
                ))}
              </div>
              {catalogoSeleccionado.details && catalogoSeleccionado.details.length > 0 && (
                <div className="cd-x46">
                  {catalogoSeleccionado.details.map((det: any) => {
                    const rawData = subDocsSnapshot[det.collection] || [];
                    const parentId = String(registroActual.id).trim().toLowerCase();
                    
                    // Filtrado en RAM instantáneo
                    const dataList = rawData.filter(docData => {
                      return Object.values(docData).some(val => {
                        if (!val) return false;
                        let strVal = typeof val === 'object' && (val as any).id ? String((val as any).id) : String(val);
                        return strVal.trim().toLowerCase() === parentId;
                      });
                    });

                    const totalRaw = rawData.length;
                    const tituloColeccion = getDetailTitle(det); 
                    const keysToRender = det.fields ? det.fields.filter((f: any) => f.name !== det.foreignKey) : Object.keys(dataList[0] || {}).filter(k => k !== 'id' && k !== det.foreignKey).map(k => ({ name: k, label: k }));
                    
                    return (
                      <div className="cd-x43" key={det.collection}>
                        <div className="cd-x47">
                          <h3 className="cd-x48">
                            <span>{tituloColeccion}</span>
                            <span className="cd-x49">{dataList.length} Filtrados (de {totalRaw} DB)</span>
                          </h3>
                          <button className="cd-x50" 
                            onClick={() => handleAgregarEditarSubdetalle(det.collection)} 
                            title="Agregar Detalle"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                          </button>
                        </div>
                        {dataList.length === 0 ? (
                          <div className="cd-x51">No se encontró el ID vinculado en esta tabla.</div>
                        ) : (
                          <div className="table-container cd-x52">
                            <table className="sub-table cd-x53">
                              <thead className="cd-x54">
                                <tr>
                                  {keysToRender.map((subF: any) => <th className="cd-x55" key={subF.name}>{subF.label || subF.name}</th>)}
                                  <th className="cd-x56">Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dataList.map((subItem: any) => (
                                  <tr className="cd-x57" key={subItem.id}>
                                    {keysToRender.map((subF: any) => <td className="cd-x58" key={subF.name}>{getDisplayValue(subItem, subF)}</td>)}
                                    <td className="cd-x59">
                                      <div className="cd-x26">
                                        <button className="cd-x60" 
                                          title="Editar Detalle"
                                          onClick={() => handleAgregarEditarSubdetalle(det.collection, subItem)}
                                          onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                                          onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                        </button>
                                        <button className="cd-x61" 
                                          title="Eliminar Detalle"
                                          onClick={() => handleEliminarSubdetalle(det.collection, subItem.id)}
                                          onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                                          onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="form-actions detail-actions cd-x62">
              <button className="cd-x63" onClick={() => { setViendoDetalles(false); setRegistroActual(null); }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {modalEstado === 'config_obligatorios' && catalogoSeleccionado && (
        <div className="modal-overlay cd-x36">
          <div className="cd-x64">
            <div className="cd-x65">
              <h2 className="cd-x39">Campos Obligatorios</h2>
              <button className="cd-x41" onClick={() => setModalEstado('cerrado')}>✕</button>
            </div>
            <div className="cd-x66">
              <div className="cd-x67">
                {catalogoSeleccionado.fields.map((f: CatalogField) => {
                  const isChecked = (camposRequeridos[catalogoSeleccionado.id] || []).includes(f.name);
                  return (
                    <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', color: isChecked ? '#f0f6fc' : '#c9d1d9', cursor: 'pointer', padding: '8px', borderRadius: '6px', backgroundColor: isChecked ? '#161b22' : 'transparent', border: '1px solid', borderColor: isChecked ? '#30363d' : 'transparent' }}>
                      <input className="cd-x68" type="checkbox" checked={isChecked} onChange={() => handleToggleRequerido(f.name)} />
                      <span className="cd-x69">{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="cd-x70">
              <button className="cd-x71" onClick={() => setModalEstado('cerrado')}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ FORMULARIO DE AGREGAR / EDITAR PRINCIPAL */}
      {modalEstado === 'formulario' && catalogoSeleccionado && (
        <div className="modal-overlay cd-x72">
          <div className="cd-x73">
            <div className="cd-x38">
              <h2 className="cd-x39">{registroActual ? 'Editar' : 'Agregar'} {catalogoSeleccionado.titulo}</h2>
              <button className="cd-x41" onClick={() => setModalEstado('cerrado')}>✕</button>
            </div>
            
            <form className="cd-x74" onSubmit={guardarRegistro}>
              <div className="cd-x75">
                {catalogoSeleccionado.fields.map((f: CatalogField) => {
                  const isReq = (camposRequeridos[catalogoSeleccionado.id] || []).includes(f.name);
                  return (
                    <div key={f.name}>
                      <label className="cd-x76">{f.label} {isReq && <span className="cd-x77">*</span>}</label>
                      {f.dynamicOptions && opcionesDinamicas[f.dynamicOptions.collection] ? (
                        <SelectBuscable
                          opciones={opcionesDinamicas[f.dynamicOptions.collection].map((opt: any) => {
                            const vField = f.dynamicOptions!.valueField || 'id';
                            const lField = f.dynamicOptions!.labelField || 'nombre';
                            return { value: String(opt[vField] || opt.id), label: etiquetaDeOpcion(opt, lField, vField) };
                          })}
                          value={formData[f.name] || ''}
                          onChange={(v) => setFormData({ ...formData, [f.name]: v })}
                          placeholder="Buscar y seleccionar..."
                        />
                      ) : f.options ? (
                        <SelectBuscable
                          opciones={f.options.map((opt: string) => ({ value: opt, label: opt }))}
                          value={formData[f.name] || ''}
                          onChange={(v) => setFormData({ ...formData, [f.name]: v })}
                          placeholder="Buscar y seleccionar..."
                        />
                      ) : (
                        <input className="form-input-elegante" type={f.type === 'number' || f.type === 'currency' ? 'number' : 'text'} step={f.type === 'currency' ? '0.01' : undefined} value={formData[f.name] || ''} onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })} placeholder={`Ingrese ${f.label.toLowerCase()}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="cd-x78">
                <button className="cd-x63" type="button" onClick={() => setModalEstado('cerrado')}>Cancelar</button>
                <button className="cd-x79" type="submit">Guardar Registro</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ✅ MODAL DE FORMULARIO PARA SUB-DETALLES */}
      {subModalEstado === 'abierto' && subColeccionActual && (
        <div className="modal-overlay cd-x80">
          <div className="cd-x73">
            <div className="cd-x38">
              <h2 className="cd-x39">{subRegistroActual ? 'Editar' : 'Agregar'} Detalles</h2>
              <button className="cd-x41" onClick={() => setSubModalEstado('cerrado')}>✕</button>
            </div>
            <form className="cd-x74" onSubmit={guardarSubRegistro}>
              <div className="cd-x75">
                {subColeccionActual.fields?.filter((f:any) => f.name !== subColeccionActual.foreignKey).map((f: any) => {
                  return (
                    <div key={f.name}>
                      <label className="cd-x76">{f.label || f.name}</label>
                      {f.dynamicOptions && opcionesDinamicas[f.dynamicOptions.collection] ? (
                        <SelectBuscable
                          opciones={opcionesDinamicas[f.dynamicOptions.collection].map((opt: any) => {
                            const vField = f.dynamicOptions!.valueField || 'id';
                            const lField = f.dynamicOptions!.labelField || 'nombre';
                            return { value: String(opt[vField] || opt.id), label: etiquetaDeOpcion(opt, lField, vField) };
                          })}
                          value={subFormData[f.name] || ''}
                          onChange={(v) => setSubFormData({ ...subFormData, [f.name]: v })}
                          placeholder="Buscar y seleccionar..."
                        />
                      ) : f.options ? (
                        <SelectBuscable
                          opciones={f.options.map((opt: string) => ({ value: opt, label: opt }))}
                          value={subFormData[f.name] || ''}
                          onChange={(v) => setSubFormData({ ...subFormData, [f.name]: v })}
                          placeholder="Buscar y seleccionar..."
                        />
                      ) : (
                        <input className="form-input-elegante" type={f.type === 'number' || f.type === 'currency' ? 'number' : 'text'} step={f.type === 'currency' ? '0.01' : undefined} value={subFormData[f.name] || ''} onChange={(e) => setSubFormData({ ...subFormData, [f.name]: e.target.value })} placeholder={`Ingrese ${f.label?.toLowerCase() || f.name.toLowerCase()}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="cd-x78">
                <button className="cd-x63" type="button" onClick={() => setSubModalEstado('cerrado')}>Cancelar</button>
                <button className="cd-x79" type="submit">Guardar Detalle</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogosDashboard;
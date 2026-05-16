// src/features/catalogos/components/CatalogosDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro, eliminarRegistro } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger'; // ✅ Importación del logger

import { listaCatalogos } from '../config/catalogSchemas';
import type { CatalogSchema, CatalogField } from '../config/catalogSchemas';

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
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
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
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      <style>{`
        .detail-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 768px) { .detail-grid-3 { grid-template-columns: 1fr; } }
        .sub-table th, .sub-table td { padding: 12px 16px; }
        .form-input-elegante { width: 100%; padding: 10px; background-color: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; box-sizing: border-box; transition: border-color 0.2s; }
        .form-input-elegante:focus { outline: none; border-color: #58a6ff; }
      `}</style>

      <div style={{ width: '100%', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
          <button onClick={() => setCatalogoSeleccionado(null)} style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', textAlign: 'left', padding: 0, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
            ← Volver a Catálogos
          </button>
          <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: 0, fontWeight: 'bold' }}>{catalogoSeleccionado.titulo}</h1>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          <div style={{ flex: '1 1 auto', maxWidth: '250px', minWidth: '150px' }}>
            <select className="form-control" value={filtroFijo} onChange={(e) => setFiltroFijo(e.target.value)} style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', padding: '10px', borderRadius: '6px' }}>
              <option value="">Filtro: Todas las colecciones</option>
              {opcionesDeFiltroDropdown.map((opt, i) => <option key={i} value={`${opt.field}|||${opt.value}`}>{opt.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input type="text" placeholder={`Buscar en ${catalogoSeleccionado.titulo.toLowerCase()}...`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }} />
            </div>
          </div>
          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '320px' }}>
            <button className="btn btn-outline" title="Configurar Obligatorios" onClick={() => setModalEstado('config_obligatorios')} style={{ backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
            </button>
            <button className="btn btn-primary" title="Agregar Registro" onClick={() => { setRegistroActual(null); setFormData({}); setModalEstado('formulario'); }} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            <table className="data-table" style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '120px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                  
                  {catalogoSeleccionado.details && catalogoSeleccionado.details.length > 0 && (
                    <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d', textAlign: 'center' }}>
                      Sub-Registros
                    </th>
                  )}

                  {catalogoSeleccionado.fields.map((f: CatalogField) => (
                    <th key={f.name} style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>{f.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {registrosEnPantalla.length === 0 ? (
                  <tr><td colSpan={catalogoSeleccionado.fields.length + 2} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay registros.</td></tr>
                ) : (
                  registrosEnPantalla.map((reg: any) => (
                    <tr key={reg.id} onClick={() => { setRegistroActual(reg); setViendoDetalles(true); }} style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === reg.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(reg.id!)} onMouseLeave={() => setHoveredRowId(null)}>
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-small btn-edit" 
                            title="Editar Registro"
                            onClick={(e) => { e.stopPropagation(); setRegistroActual(reg); setFormData(reg); setModalEstado('formulario'); }} 
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          
                          {/* ✅ LLAMADA A LA FUNCIÓN REFACTORIZADA PARA ELIMINAR CON LOG */}
                          <button 
                            className="btn-small btn-danger" 
                            title="Eliminar Registro"
                            onClick={async (e) => { e.stopPropagation(); await eliminarRegistroPrincipal(reg.id); }} 
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'} 
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>

                      {catalogoSeleccionado.details && catalogoSeleccionado.details.length > 0 && (
                        <td style={{ padding: '16px', textAlign: 'center', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                          <span style={{ backgroundColor: '#161b22', padding: '4px 10px', borderRadius: '12px', color: '#58a6ff', fontSize: '0.8rem', border: '1px solid #30363d' }}>
                            {conteoDetallesGlobal[String(reg.id).toLowerCase()] || 0} vinculados
                          </span>
                        </td>
                      )}

                      {catalogoSeleccionado.fields.map((f: CatalogField) => (
                        <td key={f.name} style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{getDisplayValue(reg, f)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {registrosFiltrados.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer' }}>Anterior</button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas || totalPaginas === 0} style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer' }}>Siguiente</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ✅ VISTA: MODAL DETALLES (RENDERIZADO INSTANTÁNEO 0 LECTURAS) */}
      {viendoDetalles && registroActual && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div className="form-card detail-card" style={{ maxWidth: '1000px', width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
            <div className="form-header" style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>Detalles: <span style={{ color: '#58a6ff' }}>{catalogoSeleccionado.titulo}</span></h2>
              <button onClick={() => { setViendoDetalles(false); setRegistroActual(null); }} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div className="detail-content" style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              <div className="detail-grid-3" style={{ marginBottom: '32px' }}>
                {catalogoSeleccionado.fields.map((f: CatalogField) => (
                  <div key={f.name}>
                    <span style={{ display: 'block', fontSize: '0.8rem', color: '#8b949e', fontWeight: 'bold', marginBottom: '4px', textTransform: 'uppercase' }}>{f.label}</span>
                    <span style={{ color: '#c9d1d9', fontWeight: '500', fontSize: '0.95rem' }}>{getDisplayValue(registroActual, f)}</span>
                  </div>
                ))}
              </div>
              {catalogoSeleccionado.details && catalogoSeleccionado.details.length > 0 && (
                <div style={{ marginTop: '32px' }}>
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
                      <div key={det.collection} style={{ marginBottom: '32px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '8px' }}>
                          <h3 style={{ color: '#D84315', fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <span>{tituloColeccion}</span>
                            <span style={{ backgroundColor: '#161b22', padding: '4px 10px', borderRadius: '12px', fontSize: '0.8rem', color: '#8b949e', border: '1px solid #30363d' }}>{dataList.length} Filtrados (de {totalRaw} DB)</span>
                          </h3>
                          <button 
                            onClick={() => handleAgregarEditarSubdetalle(det.collection)} 
                            title="Agregar Detalle"
                            style={{ backgroundColor: '#D84315', color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                          </button>
                        </div>
                        {dataList.length === 0 ? (
                          <div style={{ padding: '24px', backgroundColor: '#161b22', borderRadius: '8px', color: '#8b949e', textAlign: 'center', border: '1px dashed #30363d' }}>No se encontró el ID vinculado en esta tabla.</div>
                        ) : (
                          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', backgroundColor: '#161b22' }}>
                            <table className="sub-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                              <thead style={{ backgroundColor: '#1f2937' }}>
                                <tr>
                                  {keysToRender.map((subF: any) => <th key={subF.name} style={{ color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase' }}>{subF.label || subF.name}</th>)}
                                  <th style={{ color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase', textAlign: 'center', width: '100px' }}>Acciones</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dataList.map((subItem: any) => (
                                  <tr key={subItem.id} style={{ borderBottom: '1px solid #21262d' }}>
                                    {keysToRender.map((subF: any) => <td key={subF.name} style={{ color: '#c9d1d9' }}>{getDisplayValue(subItem, subF)}</td>)}
                                    <td style={{ textAlign: 'center' }}>
                                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                                        <button 
                                          title="Editar Detalle"
                                          onClick={() => handleAgregarEditarSubdetalle(det.collection, subItem)} 
                                          style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                                          onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'} 
                                          onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                        >
                                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                                        </button>
                                        <button 
                                          title="Eliminar Detalle"
                                          onClick={() => handleEliminarSubdetalle(det.collection, subItem.id)} 
                                          style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
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
            <div className="form-actions detail-actions" style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button onClick={() => { setViendoDetalles(false); setRegistroActual(null); }} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {modalEstado === 'config_obligatorios' && catalogoSeleccionado && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1500, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ maxWidth: '500px', width: '100%', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>Campos Obligatorios</h2>
              <button onClick={() => setModalEstado('cerrado')} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <div style={{ padding: '24px', flex: 1, overflowY: 'auto', maxHeight: '60vh' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {catalogoSeleccionado.fields.map((f: CatalogField) => {
                  const isChecked = (camposRequeridos[catalogoSeleccionado.id] || []).includes(f.name);
                  return (
                    <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', color: isChecked ? '#f0f6fc' : '#c9d1d9', cursor: 'pointer', padding: '8px', borderRadius: '6px', backgroundColor: isChecked ? '#161b22' : 'transparent', border: '1px solid', borderColor: isChecked ? '#30363d' : 'transparent' }}>
                      <input type="checkbox" checked={isChecked} onChange={() => handleToggleRequerido(f.name)} style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                      <span style={{ fontSize: '1rem' }}>{f.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setModalEstado('cerrado')} style={{ padding: '8px 24px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ FORMULARIO DE AGREGAR / EDITAR PRINCIPAL */}
      {modalEstado === 'formulario' && catalogoSeleccionado && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1600, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ maxWidth: '600px', width: '100%', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>{registroActual ? 'Editar' : 'Agregar'} {catalogoSeleccionado.titulo}</h2>
              <button onClick={() => setModalEstado('cerrado')} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <form onSubmit={guardarRegistro} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {catalogoSeleccionado.fields.map((f: CatalogField) => {
                  const isReq = (camposRequeridos[catalogoSeleccionado.id] || []).includes(f.name);
                  return (
                    <div key={f.name}>
                      <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{f.label} {isReq && <span style={{ color: '#ef4444' }}>*</span>}</label>
                      {f.dynamicOptions && opcionesDinamicas[f.dynamicOptions.collection] ? (
                        <select className="form-input-elegante" value={formData[f.name] || ''} onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}>
                          <option value="">Seleccione una opción...</option>
                          {opcionesDinamicas[f.dynamicOptions.collection].map((opt: any) => {
                            const vField = f.dynamicOptions!.valueField || 'id';
                            const lField = f.dynamicOptions!.labelField || 'nombre';
                            return <option key={opt.id} value={opt[vField] || opt.id}>{opt[lField] || opt.nombreCorto || opt.razonSocial || opt.nombre || opt.moneda || opt.descripcion || opt.tipo || opt[vField]}</option>;
                          })}
                        </select>
                      ) : f.options ? (
                        <select className="form-input-elegante" value={formData[f.name] || ''} onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })}>
                          <option value="">Seleccione una opción...</option>
                          {f.options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input className="form-input-elegante" type={f.type === 'number' || f.type === 'currency' ? 'number' : 'text'} step={f.type === 'currency' ? '0.01' : undefined} value={formData[f.name] || ''} onChange={(e) => setFormData({ ...formData, [f.name]: e.target.value })} placeholder={`Ingrese ${f.label.toLowerCase()}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#0d1117' }}>
                <button type="button" onClick={() => setModalEstado('cerrado')} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Guardar Registro</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ✅ MODAL DE FORMULARIO PARA SUB-DETALLES */}
      {subModalEstado === 'abierto' && subColeccionActual && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1700, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ maxWidth: '600px', width: '100%', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>{subRegistroActual ? 'Editar' : 'Agregar'} Detalles</h2>
              <button onClick={() => setSubModalEstado('cerrado')} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            <form onSubmit={guardarSubRegistro} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {subColeccionActual.fields?.filter((f:any) => f.name !== subColeccionActual.foreignKey).map((f: any) => {
                  return (
                    <div key={f.name}>
                      <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{f.label || f.name}</label>
                      {f.dynamicOptions && opcionesDinamicas[f.dynamicOptions.collection] ? (
                        <select className="form-input-elegante" value={subFormData[f.name] || ''} onChange={(e) => setSubFormData({ ...subFormData, [f.name]: e.target.value })}>
                          <option value="">Seleccione una opción...</option>
                          {opcionesDinamicas[f.dynamicOptions.collection].map((opt: any) => {
                            const vField = f.dynamicOptions!.valueField || 'id';
                            const lField = f.dynamicOptions!.labelField || 'nombre';
                            return <option key={opt.id} value={opt[vField] || opt.id}>{opt[lField] || opt.nombreCorto || opt.razonSocial || opt.nombre || opt.moneda || opt.descripcion || opt.tipo || opt[vField]}</option>;
                          })}
                        </select>
                      ) : f.options ? (
                        <select className="form-input-elegante" value={subFormData[f.name] || ''} onChange={(e) => setSubFormData({ ...subFormData, [f.name]: e.target.value })}>
                          <option value="">Seleccione una opción...</option>
                          {f.options.map((opt:string) => <option key={opt} value={opt}>{opt}</option>)}
                        </select>
                      ) : (
                        <input className="form-input-elegante" type={f.type === 'number' || f.type === 'currency' ? 'number' : 'text'} step={f.type === 'currency' ? '0.01' : undefined} value={subFormData[f.name] || ''} onChange={(e) => setSubFormData({ ...subFormData, [f.name]: e.target.value })} placeholder={`Ingrese ${f.label?.toLowerCase() || f.name.toLowerCase()}`} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px', backgroundColor: '#0d1117' }}>
                <button type="button" onClick={() => setSubModalEstado('cerrado')} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" style={{ padding: '8px 16px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Guardar Detalle</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CatalogosDashboard;
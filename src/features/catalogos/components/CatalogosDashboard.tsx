// src/features/catalogos/components/CatalogosDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs, writeBatch, doc, query, limit, where, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { db, auth, agregarRegistro, actualizarRegistro, eliminarRegistro } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger'; // ✅ Importación del logger

import { listaCatalogos, catalogosConfig } from '../config/catalogSchemas';
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

// ✅ NUEVO (V00106) — PAPELERA DE CATÁLOGOS: colección donde se guarda una
//    copia completa de cada registro ANTES de eliminarlo (borrado individual,
//    en lote, sub-registros y uniones). Desde ahí se puede RESTAURAR con su
//    ID original, por lo que las referencias que sigan vivas se reconectan.
const COL_PAPELERA = 'papelera_catalogos';

// ✅ NUEVO (V00106) — construye el documento que va a la papelera.
const payloadPapelera = (
  coleccion: string,
  catalogoId: string,
  catalogoTitulo: string,
  registro: any,
  motivo: string
) => {
  const { id, ...datos } = registro || {};
  return {
    coleccion,
    catalogoId,
    catalogoTitulo,
    registroId: String(id || ''),
    datos,
    motivo,
    eliminadoPor: auth.currentUser?.email || 'Sistema',
    eliminadoEn: new Date().toISOString(),
  };
};

// ✅ NUEVO (V00106) — REFERENCIAS EXTERNAS CONOCIDAS por catálogo para la
//    herramienta de UNIR: [colección, campo con el ID, campo de nombre a
//    refrescar (opcional), campo del registro conservado del que sale ese
//    nombre (opcional)]. Las referencias ENTRE catálogos no van aquí: se
//    detectan solas leyendo los dynamicOptions de catalogSchemas.
const REFS_EXTERNAS_CATALOGO: Record<string, Array<[string, string, string?, string?]>> = {
  tipo_operacion: [
    ['operaciones', 'tipoOperacion', 'tipoOperacionNombre', 'tipo_operacion'],
    ['operaciones', 'tipoOperacionId', 'tipoOperacionNombre', 'tipo_operacion'],
  ],
  status_servicio: [['operaciones', 'status', 'statusNombre', 'nombre']],
  embalaje: [['operaciones', 'embalaje']],
  paises: [['direcciones', 'paisId', 'paisNombre', 'nombre'], ['catalogo_direcciones', 'paisId', 'paisNombre', 'nombre']],
  estados: [['direcciones', 'estadoId', 'estadoNombre', 'estado'], ['catalogo_direcciones', 'estadoId', 'estadoNombre', 'estado']],
  municipios: [['direcciones', 'municipioId', 'municipioNombre', 'municipio'], ['catalogo_direcciones', 'municipioId', 'municipioNombre', 'municipio']],
  colonias: [['direcciones', 'coloniaId', 'coloniaNombre', 'colonia'], ['catalogo_direcciones', 'coloniaId', 'coloniaNombre', 'colonia']],
  codigo_postal: [['direcciones', 'cpId', 'cpNombre', 'codigo_postal'], ['catalogo_direcciones', 'cpId', 'cpNombre', 'codigo_postal']],
  calles: [['direcciones', 'calleId', 'calleNombre', 'calle'], ['catalogo_direcciones', 'calleId', 'calleNombre', 'calle']],
  tarifas_referencia: [
    ['convenios_clientes_detalles', 'tipoConvenioId'],
    ['convenios_proveedores_detalles', 'tipoConvenioId'],
  ],
};

// =========================================
// COMPONENTE PRINCIPAL
// =========================================
const CatalogosDashboard = () => {
  const [catalogoSeleccionado, setCatalogoSeleccionado] = useState<CatalogSchema | null>(null);
  const [registrosGlobales, setRegistrosGlobales] = useState<any[]>([]);
  // ✅ NUEVO — USO DE TARIFAS DE REFERENCIA: dónde se usa cada tarifa
  //   (detalles de convenios de clientes/proveedores vía tipoConvenioId, y
  //   operaciones vía op.convenio -> detalle -> tarifa).
  const [usoTarifas, setUsoTarifas] = useState<Record<string, { convC: any[]; convP: any[]; ops: string[] }> | null>(null);
  const [modalUsoTarifa, setModalUsoTarifa] = useState<any | null>(null);
  useEffect(() => {
    if (catalogoSeleccionado?.id !== 'tarifas_referencia') return;
    let activo = true;
    (async () => {
      try {
        const [detC, detP, masC, masP, opsSnap] = await Promise.all([
          getDocs(collection(db, 'convenios_clientes_detalles')),
          getDocs(collection(db, 'convenios_proveedores_detalles')),
          getDocs(collection(db, 'convenios_clientes')),
          getDocs(collection(db, 'convenios_proveedores')),
          getDocs(query(collection(db, 'operaciones'), limit(5000))),
        ]);
        const nomC: Record<string, string> = {}; masC.docs.forEach((d) => { const x: any = d.data(); nomC[d.id] = `${x.numeroConvenio || d.id.slice(0, 6)} · ${x.clienteNombre || ''}`; });
        const nomP: Record<string, string> = {}; masP.docs.forEach((d) => { const x: any = d.data(); nomP[d.id] = `${x.numeroConvenio || d.id.slice(0, 6)} · ${x.proveedorNombre || ''}`; });
        const detATarifa: Record<string, string> = {};
        const uso: Record<string, { convC: any[]; convP: any[]; ops: string[] }> = {};
        const asegura = (t: string) => { if (!uso[t]) uso[t] = { convC: [], convP: [], ops: [] }; return uso[t]; };
        detC.docs.forEach((d) => { const x: any = d.data(); const t = String(x.tipoConvenioId || ''); if (!t) return; detATarifa[d.id] = t; asegura(t).convC.push(nomC[String(x.convenioId)] || String(x.convenioId || '').slice(0, 8)); });
        detP.docs.forEach((d) => { const x: any = d.data(); const t = String(x.tipoConvenioId || ''); if (!t) return; detATarifa[d.id] = t; asegura(t).convP.push(nomP[String(x.convenioId)] || String(x.convenioId || '').slice(0, 8)); });
        opsSnap.docs.forEach((d) => { const x: any = d.data(); const t = detATarifa[String(x.convenio || '')]; if (!t) return; asegura(t).ops.push(String(x.ref || d.id.slice(0, 8))); });
        if (activo) setUsoTarifas(uso);
      } catch (e) { console.warn('No se pudo calcular el uso de tarifas:', e); }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogoSeleccionado?.id]);

  // ✅ NUEVO — USO DE TIPOS DE TARIFARIOS: cuántas Tarifas de Referencia
  //   usan cada tipo (tarifas_referencia.tipo_operacion -> id del tipo).
  const [usoTarifarios, setUsoTarifarios] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    if (catalogoSeleccionado?.id !== 'tipos_tarifarios') return;
    let activo = true;
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'catalogo_tarifas_referencia'));
        const c: Record<string, number> = {};
        snap.docs.forEach((d) => {
          const t = String((d.data() as any)?.tipo_operacion || '');
          if (t) c[t] = (c[t] || 0) + 1;
        });
        if (activo) setUsoTarifarios(c);
      } catch (e) { console.warn('No se pudo contar el uso de tarifarios:', e); }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogoSeleccionado?.id]);
  
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
  // ✅ NUEVO: selección múltiple para borrado en lote.
  const [seleccionadosIds, setSeleccionadosIds] = useState<string[]>([]);
  const [borrandoSeleccion, setBorrandoSeleccion] = useState(false);
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
      // ✅ NUEVO — al cambiar un catálogo se INVALIDAN los cachés locales
      //   (cat_v2__/cat_v1__) para que Operaciones y demás módulos muestren
      //   las opciones nuevas en su siguiente carga, sin datos viejos.
      try {
        if (!snapshot.metadata.fromCache) {
          Object.keys(localStorage)
            .filter((k) => k.startsWith('cat_v2__') || k.startsWith('cat_v1__'))
            .forEach((k) => localStorage.removeItem(k));
          localStorage.setItem('catalogos_invalidados_en', String(Date.now()));
        }
      } catch { /* almacenamiento no disponible */ }
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
  // ✅ NUEVO: al cambiar de catálogo, búsqueda o filtro se limpia la selección
  //   para no arrastrar ids de otro contexto.
  useEffect(() => { setSeleccionadosIds([]); }, [catalogoSeleccionado, busqueda, filtroFijo]);

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
        // ✅ NUEVO (V00109) — PROPAGACIÓN DE NOMBRES: los módulos (Operaciones,
        //   Direcciones, etc.) guardan una COPIA del nombre en cada documento
        //   para pintar tablas sin leer catálogos. Al editar aquí, esa copia
        //   quedaba vieja para siempre. Ahora, si cambió el valor fuente, se
        //   actualizan en lote todos los documentos que lo referencian.
        try {
          let propagados = 0;
          for (const [colRef, campoId, campoNombre, campoValorDe] of (REFS_EXTERNAS_CATALOGO[catalogoSeleccionado.id] || [])) {
            if (!campoNombre || !campoValorDe) continue;
            const nuevoValor = formData[campoValorDe];
            const valorAnterior = registroActual[campoValorDe];
            if (nuevoValor === undefined || String(nuevoValor) === String(valorAnterior ?? '')) continue;
            const snap = await getDocs(query(collection(db, colRef), where(campoId, '==', registroActual.id)));
            for (let i = 0; i < snap.docs.length; i += 400) {
              const lote = snap.docs.slice(i, i + 400);
              const batch = writeBatch(db);
              lote.forEach((d) => batch.update(d.ref, { [campoNombre]: nuevoValor }));
              await batch.commit();
              propagados += lote.length;
            }
          }
          if (propagados > 0) {
            await registrarLog('Catálogos', 'Edición', `Propagó el nuevo nombre a ${propagados} documento(s) relacionados (${catalogoSeleccionado.titulo})`);
          }
        } catch (ePropagar) {
          console.error('No se pudo propagar el nombre a los módulos relacionados:', ePropagar);
        }
      } else {
        // ✅ NUEVO: bloqueo de DUPLICADOS al crear. Si ya existe un registro
        //    con exactamente los mismos valores en todos los campos, se avisa
        //    y NO se crea otra copia.
        const claveNueva = claveDuplicado(formData);
        const yaExiste = claveNueva && registrosGlobales.some(reg => claveDuplicado(reg) === claveNueva);
        if (yaExiste) {
          alert('Ya existe un registro idéntico en este catálogo.\n\nNo se creó el duplicado. Si necesitas otro similar, cambia al menos un campo (por ejemplo el nombre).');
          return;
        }
        await agregarRegistro(col, formData);
        await registrarLog('Catálogos', 'Creación', `Agregó un nuevo registro al catálogo de ${catalogoSeleccionado.titulo}`);
      }

      setModalEstado('cerrado');
      setRegistroActual(null); 
    } catch (error) { alert('Error en Firebase al guardar.'); }
  };

  // ✅ FUNCIÓN DE ELIMINACIÓN PRINCIPAL CON LOG
  //    MEJORADO: si Firestore rechaza el borrado (permisos, cuota, etc.) ahora
  //    se muestra la CAUSA real en lugar de un mensaje genérico.
  const eliminarRegistroPrincipal = async (id: string) => {
    if (!catalogoSeleccionado) return;
    if (window.confirm('¿Desea eliminar este registro?\n\nSe enviará a la Papelera de catálogos, desde donde podrás restaurarlo.')) {
      try {
        // ✅ NUEVO (V00106): copia a la PAPELERA antes de borrar. Si la copia
        //    falla, NO se borra (así nunca se pierde un registro sin respaldo).
        const reg = registrosGlobales.find((r: any) => r.id === id);
        if (reg) {
          await agregarRegistro(COL_PAPELERA, payloadPapelera(
            `catalogo_${catalogoSeleccionado.id}`, catalogoSeleccionado.id,
            catalogoSeleccionado.titulo, reg, 'Eliminación individual'
          ));
        }
        await eliminarRegistro(`catalogo_${catalogoSeleccionado.id}`, id);
        await registrarLog('Catálogos', 'Eliminación', `Eliminó un registro del catálogo de ${catalogoSeleccionado.titulo} (enviado a la papelera)`);
      } catch (error: any) {
        console.error('Error al eliminar registro de catálogo:', error);
        alert(
          'Hubo un error al intentar eliminar el registro.\n\n' +
          'Detalle técnico: ' + (error?.message || error?.code || 'desconocido') +
          '\n\nSi dice "permission-denied", tu usuario no tiene permiso de borrar en Firestore.' +
          '\nSi dice "resource-exhausted", se agotó la cuota diaria de Firebase.'
        );
      }
    }
  };

  // ✅ NUEVO: clave normalizada de un registro para detectar DUPLICADOS.
  //    Se construye con los valores de TODOS los campos del esquema del
  //    catálogo (sin acentos, minúsculas, espacios simples). Dos registros con
  //    la misma clave son idénticos a ojos del usuario.
  const claveDuplicado = (reg: any): string => {
    if (!catalogoSeleccionado) return '';
    const norm = (v: any): string => {
      if (Array.isArray(v)) return v.map(x => norm(x)).sort().join(',');
      if (v && typeof v === 'object' && (v as any).id) v = (v as any).id;
      return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
    };
    return catalogoSeleccionado.fields.map((f: CatalogField) => norm(reg[f.name])).join('|||');
  };

  // ═══════════ ✅ NUEVO (V00106) — UNIR REGISTROS DE CATÁLOGO ═══════════
  //   Reemplaza al antiguo "limpiar duplicados". Se seleccionan 2+ registros
  //   con los checkboxes y "Unir" conserva UNO, REAPUNTANDO hacia él todas
  //   las referencias detectadas:
  //     a) Sub-registros del propio catálogo (escaneo profundo en RAM).
  //     b) OTROS catálogos que lo referencian vía dynamicOptions (se detecta
  //        solo leyendo catalogSchemas: direcciones en cadena, bancos→moneda,
  //        status→tipo de operación, tarifas→tarifarios/remolque/aduana, etc).
  //     c) Referencias externas conocidas (operaciones, direcciones y
  //        detalles de convenios) según REFS_EXTERNAS_CATALOGO.
  //   Los registros absorbidos van a la PAPELERA antes de borrarse.
  const [modalUnir, setModalUnir] = useState(false);
  const [conservarId, setConservarId] = useState('');
  const [uniendo, setUniendo] = useState(false);

  const camposLlenos = (reg: any): number =>
    Object.entries(reg || {}).filter(([k, v]) => k !== 'id' && v !== undefined && v !== null && v !== '').length;

  const abrirModalUnir = () => {
    if (seleccionadosIds.length < 2) return;
    // Por defecto se conserva el registro con MÁS campos llenos (empate: el más antiguo).
    const regs = seleccionadosIds.map((id) => registrosGlobales.find((r: any) => r.id === id)).filter(Boolean);
    const mejor = [...regs].sort((a: any, b: any) =>
      camposLlenos(b) - camposLlenos(a) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')))[0];
    setConservarId(mejor?.id || seleccionadosIds[0]);
    setModalUnir(true);
  };

  // Resumen corto de un registro para mostrarlo en modales y en la papelera.
  const resumenRegistro = (reg: any): string => {
    if (!catalogoSeleccionado || !reg) return String(reg?.id || '');
    return catalogoSeleccionado.fields
      .map((f: CatalogField) => getDisplayValue(reg, f))
      .filter((v: string) => v && v !== '-')
      .slice(0, 3)
      .join(' · ') || String(reg.id || '');
  };

  const ejecutarUnionCatalogo = async () => {
    if (!catalogoSeleccionado || uniendo || !conservarId || seleccionadosIds.length < 2) return;
    const kept: any = registrosGlobales.find((r: any) => r.id === conservarId);
    const duplicados = seleccionadosIds.filter((id) => id !== conservarId);
    if (!kept || duplicados.length === 0) return;

    setUniendo(true);
    try {
      const colEste = `catalogo_${catalogoSeleccionado.id}`;
      let totalReapuntados = 0;

      // Helper: actualiza en lotes de 400 una lista de [ref, cambios].
      const commitLotes = async (cambiosDocs: Array<{ ref: any; cambios: any }>) => {
        for (let i = 0; i < cambiosDocs.length; i += 400) {
          const lote = cambiosDocs.slice(i, i + 400);
          const batch = writeBatch(db);
          lote.forEach(({ ref, cambios }) => batch.update(ref, cambios));
          await batch.commit();
          totalReapuntados += lote.length;
        }
      };

      for (const dupId of duplicados) {
        const dupReg: any = registrosGlobales.find((r: any) => r.id === dupId);

        // a) Sub-registros del propio catálogo: escaneo profundo del snapshot
        //    en RAM (misma filosofía que el conteo de vinculados). Cualquier
        //    campo cuyo valor sea el ID duplicado se reapunta al conservado.
        for (const det of (catalogoSeleccionado.details || [])) {
          const realCol = CACHE_NOMBRES_COLECCIONES[det.collection] || det.collection;
          const docsDet = subDocsSnapshot[det.collection] || [];
          const pendientes: Array<{ ref: any; cambios: any }> = [];
          docsDet.forEach((d: any) => {
            const cambios: any = {};
            Object.entries(d).forEach(([k, v]) => {
              if (k === 'id') return;
              const val = (v && typeof v === 'object' && (v as any).id) ? String((v as any).id) : String(v ?? '');
              if (val === dupId) cambios[k] = conservarId;
            });
            if (Object.keys(cambios).length > 0) pendientes.push({ ref: doc(db, realCol, d.id), cambios });
          });
          await commitLotes(pendientes);
        }

        // b) Otros catálogos que referencian a ESTE vía dynamicOptions
        //    (campos principales y campos de sus sub-registros).
        for (const cfg of Object.values(catalogosConfig)) {
          const camposRef = cfg.fields.filter((f: CatalogField) => f.dynamicOptions?.collection === colEste);
          for (const f of camposRef) {
            const snap = await getDocs(query(collection(db, `catalogo_${cfg.id}`), where(f.name, '==', dupId)));
            await commitLotes(snap.docs.map((d) => ({ ref: d.ref, cambios: { [f.name]: conservarId } })));
          }
          for (const det of (cfg.details || [])) {
            const detCampos = det.fields.filter((f: CatalogField) => f.dynamicOptions?.collection === colEste);
            for (const f of detCampos) {
              // El nombre real puede llevar o no el prefijo `catalogo_`: se prueban ambos.
              for (const colDet of [det.collection, `catalogo_${det.collection}`]) {
                const snap = await getDocs(query(collection(db, colDet), where(f.name, '==', dupId)));
                await commitLotes(snap.docs.map((d) => ({ ref: d.ref, cambios: { [f.name]: conservarId } })));
              }
            }
          }
        }

        // c) Referencias externas conocidas (operaciones, direcciones, convenios).
        for (const [col, campoId, campoNombre, campoValorDe] of (REFS_EXTERNAS_CATALOGO[catalogoSeleccionado.id] || [])) {
          const snap = await getDocs(query(collection(db, col), where(campoId, '==', dupId)));
          const cambios: any = { [campoId]: conservarId };
          if (campoNombre && campoValorDe && kept[campoValorDe] !== undefined) cambios[campoNombre] = kept[campoValorDe];
          await commitLotes(snap.docs.map((d) => ({ ref: d.ref, cambios })));
        }

        // d) El duplicado va a la PAPELERA y después se elimina.
        if (dupReg) {
          await agregarRegistro(COL_PAPELERA, payloadPapelera(
            colEste, catalogoSeleccionado.id, catalogoSeleccionado.titulo, dupReg,
            `Unión de duplicados (se conservó "${resumenRegistro(kept)}")`
          ));
        }
        await deleteDoc(doc(db, colEste, dupId));
      }

      await registrarLog('Catálogos', 'Edición',
        `Unió ${duplicados.length + 1} registros de ${catalogoSeleccionado.titulo} en "${resumenRegistro(kept)}" (${totalReapuntados} referencias reapuntadas).`);
      alert(
        `Unión completada. ✅\n\nSe conservó "${resumenRegistro(kept)}", se enviaron ${duplicados.length} registro(s) a la papelera ` +
        `y se reapuntaron ${totalReapuntados} referencia(s) en sub-registros, catálogos relacionados y módulos externos.\n\n` +
        `Nota: si otras pestañas del navegador tienen módulos abiertos, recárgalas para ver el cambio.`
      );
      setSeleccionadosIds([]);
      setModalUnir(false);
    } catch (e: any) {
      console.error('Error al unir registros de catálogo:', e);
      alert('La unión no se completó del todo.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido') + '\n\nVuelve a intentar: las referencias ya reapuntadas no se duplican.');
    }
    setUniendo(false);
  };

  // ═══════════ ✅ NUEVO (V00106) — PAPELERA DE CATÁLOGOS (RESTAURACIÓN) ═══════════
  //   Todo registro eliminado desde este módulo (individual, en lote, sub-
  //   registros y uniones) queda guardado en `papelera_catalogos` con su ID
  //   original. Desde aquí se puede RESTAURAR (recupera el mismo ID, así las
  //   referencias que sigan vivas se reconectan) o borrar definitivamente.
  //   ⚠ Solo contiene lo eliminado a partir de V00106: lo borrado con
  //   versiones anteriores ya no existe en Firebase y no se puede recuperar.
  const [papeleraAbierta, setPapeleraAbierta] = useState(false);
  const [papeleraItems, setPapeleraItems] = useState<any[] | null>(null);
  const [papeleraFiltroCat, setPapeleraFiltroCat] = useState('');
  const [papeleraBusqueda, setPapeleraBusqueda] = useState('');
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null);
  const [vaciandoPapelera, setVaciandoPapelera] = useState(false);

  const cargarPapelera = async () => {
    try {
      const snap = await getDocs(collection(db, COL_PAPELERA));
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
      items.sort((a, b) => String(b.eliminadoEn || '').localeCompare(String(a.eliminadoEn || '')));
      setPapeleraItems(items);
    } catch (e: any) {
      console.error('Error cargando la papelera:', e);
      setPapeleraItems([]);
      alert('No se pudo cargar la papelera.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido'));
    }
  };

  const abrirPapelera = (filtroCatId?: string) => {
    setPapeleraFiltroCat(filtroCatId || '');
    setPapeleraBusqueda('');
    setPapeleraItems(null);
    setPapeleraAbierta(true);
    cargarPapelera();
  };

  const resumenPapelera = (item: any): string => {
    const vals = Object.values(item?.datos || {})
      .map((v: any) => (v && typeof v === 'object' && v.id) ? String(v.id) : String(v ?? ''))
      .filter((v: string) => v && v.length < 80);
    return vals.slice(0, 3).join(' · ') || item?.registroId || '—';
  };

  const restaurarDePapelera = async (item: any) => {
    if (restaurandoId) return;
    setRestaurandoId(item.id);
    try {
      const destino = doc(db, item.coleccion, item.registroId);
      const existente = await getDoc(destino);
      if (existente.exists()) {
        const sobre = window.confirm(
          `Ya existe un registro con ese mismo ID en "${item.catalogoTitulo || item.coleccion}".\n\n` +
          `¿Deseas SOBRESCRIBIRLO con la copia de la papelera?`
        );
        if (!sobre) { setRestaurandoId(null); return; }
      }
      // setDoc con el ID ORIGINAL: las referencias que sigan vivas se reconectan.
      await setDoc(destino, item.datos || {});
      await deleteDoc(doc(db, COL_PAPELERA, item.id));
      setPapeleraItems((prev) => (prev || []).filter((x) => x.id !== item.id));
      await registrarLog('Catálogos', 'Restauración', `Restauró un registro de la papelera al catálogo de ${item.catalogoTitulo || item.coleccion}`);
      alert(`Registro restaurado en "${item.catalogoTitulo || item.coleccion}" con su ID original. ✅`);
    } catch (e: any) {
      console.error('Error restaurando de la papelera:', e);
      alert('No se pudo restaurar el registro.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido'));
    }
    setRestaurandoId(null);
  };

  const eliminarDefinitivo = async (item: any) => {
    if (!window.confirm('¿Eliminar DEFINITIVAMENTE esta copia de la papelera?\n\nDespués de esto ya no se podrá restaurar.')) return;
    try {
      await deleteDoc(doc(db, COL_PAPELERA, item.id));
      setPapeleraItems((prev) => (prev || []).filter((x) => x.id !== item.id));
      await registrarLog('Catálogos', 'Eliminación', `Eliminó definitivamente un registro de la papelera (${item.catalogoTitulo || item.coleccion})`);
    } catch (e: any) {
      alert('No se pudo eliminar de la papelera.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido'));
    }
  };

  const papeleraFiltrada = useMemo(() => {
    let items = papeleraItems || [];
    if (papeleraFiltroCat) items = items.filter((x) => x.catalogoId === papeleraFiltroCat);
    if (papeleraBusqueda.trim()) {
      const t = papeleraBusqueda.toLowerCase();
      items = items.filter((x) =>
        `${x.catalogoTitulo || ''} ${x.eliminadoPor || ''} ${x.motivo || ''} ${resumenPapelera(x)}`.toLowerCase().includes(t)
      );
    }
    return items;
  }, [papeleraItems, papeleraFiltroCat, papeleraBusqueda]);

  const vaciarPapelera = async () => {
    if (vaciandoPapelera || papeleraFiltrada.length === 0) return;
    const confirmado = window.confirm(
      `¿Eliminar DEFINITIVAMENTE los ${papeleraFiltrada.length} registro(s) visibles de la papelera` +
      `${papeleraFiltroCat ? ' (solo el catálogo filtrado)' : ''}?\n\nEsta acción no se puede deshacer.`
    );
    if (!confirmado) return;
    setVaciandoPapelera(true);
    try {
      const ids = papeleraFiltrada.map((x) => x.id);
      for (let i = 0; i < ids.length; i += 400) {
        const lote = ids.slice(i, i + 400);
        const batch = writeBatch(db);
        lote.forEach((id) => batch.delete(doc(db, COL_PAPELERA, id)));
        await batch.commit();
      }
      setPapeleraItems((prev) => (prev || []).filter((x) => !ids.includes(x.id)));
      await registrarLog('Catálogos', 'Eliminación', `Vació ${ids.length} registro(s) de la papelera de catálogos`);
    } catch (e: any) {
      alert('No se pudo vaciar la papelera por completo.\n\nDetalle técnico: ' + (e?.message || e?.code || 'desconocido'));
    }
    setVaciandoPapelera(false);
  };

  // ✅ NUEVO: helpers de selección múltiple.
  const toggleSeleccion = (id: string) => {
    setSeleccionadosIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  // ✅ NUEVO: elimina en lote TODOS los registros seleccionados (lotes de 400).
  const eliminarSeleccionados = async () => {
    if (!catalogoSeleccionado || seleccionadosIds.length === 0 || borrandoSeleccion) return;
    const confirmado = window.confirm(
      `¿Eliminar los ${seleccionadosIds.length} registro(s) seleccionados de "${catalogoSeleccionado.titulo}"?\n\nSe enviarán a la Papelera de catálogos, desde donde podrás restaurarlos.`
    );
    if (!confirmado) return;

    setBorrandoSeleccion(true);
    try {
      const col = `catalogo_${catalogoSeleccionado.id}`;
      // ✅ NUEVO (V00106): en el MISMO batch se copia cada registro a la
      //    papelera y se borra el original (2 operaciones por registro, por
      //    eso el lote baja a 200 para respetar el límite de 500 de Firestore).
      for (let i = 0; i < seleccionadosIds.length; i += 200) {
        const lote = seleccionadosIds.slice(i, i + 200);
        const batch = writeBatch(db);
        lote.forEach((id) => {
          const reg = registrosGlobales.find((r: any) => r.id === id);
          if (reg) {
            batch.set(doc(collection(db, COL_PAPELERA)), payloadPapelera(
              col, catalogoSeleccionado.id, catalogoSeleccionado.titulo, reg, 'Eliminación en lote'
            ));
          }
          batch.delete(doc(db, col, id));
        });
        await batch.commit();
      }
      await registrarLog('Catálogos', 'Eliminación', `Eliminó ${seleccionadosIds.length} registros seleccionados del catálogo de ${catalogoSeleccionado.titulo} (enviados a la papelera)`);
      setSeleccionadosIds([]);
    } catch (error: any) {
      console.error('Error en borrado en lote:', error);
      alert('No se pudieron eliminar todos los registros seleccionados.\n\nDetalle técnico: ' + (error?.message || error?.code || 'desconocido'));
    }
    setBorrandoSeleccion(false);
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
    if (window.confirm('¿Deseas eliminar este registro?\n\nSe enviará a la Papelera de catálogos, desde donde podrás restaurarlo.')) {
      try { 
        const realCol = CACHE_NOMBRES_COLECCIONES[coleccion] || coleccion;
        // ✅ NUEVO (V00106): copia del sub-registro a la papelera antes de borrar.
        const subReg = (subDocsSnapshot[coleccion] || []).find((d: any) => d.id === id);
        if (subReg && catalogoSeleccionado) {
          await agregarRegistro(COL_PAPELERA, payloadPapelera(
            realCol, catalogoSeleccionado.id, `${catalogoSeleccionado.titulo} (sub-registro)`, subReg, 'Eliminación de sub-registro'
          ));
        }
        await eliminarRegistro(realCol, id); 
        await registrarLog('Catálogos', 'Eliminación', `Eliminó un detalle vinculado al catálogo de ${catalogoSeleccionado?.titulo} (enviado a la papelera)`);
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
  // ✅ NUEVO — ORDEN POR COLUMNA (clic en el encabezado: asc/desc).
  const [ordenCat, setOrdenCat] = useState<{ col: string; dir: 1 | -1 } | null>(null);
  useEffect(() => { setOrdenCat(null); }, [catalogoSeleccionado?.id]);
  const clickOrdenCat = (col: string) => setOrdenCat((prev) => prev && prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 });
  const registrosOrdenadosCat = useMemo(() => {
    if (!ordenCat) return registrosFiltrados;
    const { col, dir } = ordenCat;
    const valor = (r: any): string | number => {
      if (col === '__uso') {
        const u = usoTarifas?.[r.id];
        return (u?.ops.length || 0) + (u?.convC.length || 0) + (u?.convP.length || 0);
      }
      if (col === '__usoTipo') return usoTarifarios?.[r.id] || 0;
      const v = r?.[col];
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrosFiltrados, ordenCat, usoTarifas, usoTarifarios]);

  const registrosEnPantalla = registrosOrdenadosCat.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  // ✅ NUEVO (V00106) — MODAL DE LA PAPELERA (restauración de eliminados).
  //    Se define aquí (antes del return temprano) para poder mostrarlo tanto
  //    desde la lista de catálogos como desde dentro de un catálogo.
  const modalPapeleraJSX = papeleraAbierta ? (
    <div className="modal-overlay" style={{ zIndex: 2100 }} onClick={() => !restaurandoId && !vaciandoPapelera && setPapeleraAbierta(false)}>
      <div className="form-card" style={{ maxWidth: '900px', width: '95%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <div className="form-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><polyline points="9 14 12 11 15 14"></polyline><line x1="12" y1="11" x2="12" y2="18"></line></svg>
            Papelera de Catálogos
          </h2>
          <button style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => setPapeleraAbierta(false)}>✕</button>
        </div>

        <div style={{ display: 'flex', gap: '10px', padding: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="form-input-elegante" style={{ width: 'auto', minWidth: '220px' }} value={papeleraFiltroCat} onChange={(e) => setPapeleraFiltroCat(e.target.value)}>
            <option value="">Todos los catálogos</option>
            {listaCatalogos.map((cat: CatalogSchema) => (
              <option key={cat.id} value={cat.id}>{cat.titulo}</option>
            ))}
          </select>
          <input className="form-input-elegante" style={{ flex: 1, minWidth: '180px' }} type="text" placeholder="Buscar en la papelera..." value={papeleraBusqueda} onChange={(e) => setPapeleraBusqueda(e.target.value)} />
          <button
            className="btn"
            onClick={vaciarPapelera}
            disabled={vaciandoPapelera || papeleraFiltrada.length === 0}
            style={{ backgroundColor: '#da3633', color: '#fff', border: 'none', fontWeight: 600, opacity: (vaciandoPapelera || papeleraFiltrada.length === 0) ? 0.5 : 1, cursor: vaciandoPapelera ? 'wait' : 'pointer' }}
            title="Elimina definitivamente todo lo visible (respeta el filtro)"
          >
            {vaciandoPapelera ? 'Vaciando…' : `Vaciar (${papeleraFiltrada.length})`}
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {papeleraItems === null ? (
            <div style={{ color: '#8b949e', padding: '30px', textAlign: 'center' }}>Cargando papelera…</div>
          ) : papeleraFiltrada.length === 0 ? (
            <div style={{ color: '#8b949e', padding: '30px', textAlign: 'center', lineHeight: 1.6 }}>
              La papelera está vacía{papeleraFiltroCat ? ' para este catálogo' : ''}.<br />
              <span style={{ fontSize: '0.82rem' }}>
                Aquí aparecerá todo lo que elimines en Catálogos a partir de la versión V00106.
                Lo eliminado con versiones anteriores ya no existe en Firebase y no se puede recuperar.
              </span>
            </div>
          ) : (
            <table className="data-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ whiteSpace: 'nowrap' }}>Eliminado</th>
                  <th>Catálogo</th>
                  <th>Registro</th>
                  <th>Motivo</th>
                  <th>Por</th>
                  <th style={{ textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {papeleraFiltrada.map((item: any) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #21262d' }}>
                    <td style={{ whiteSpace: 'nowrap', color: '#8b949e', fontSize: '0.82rem' }}>
                      {item.eliminadoEn ? new Date(item.eliminadoEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td>{item.catalogoTitulo || item.coleccion}</td>
                    <td style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={resumenPapelera(item)}>
                      {resumenPapelera(item)}
                    </td>
                    <td style={{ color: '#8b949e', fontSize: '0.82rem', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.motivo || ''}>
                      {item.motivo || '—'}
                    </td>
                    <td style={{ color: '#8b949e', fontSize: '0.82rem' }}>{item.eliminadoPor || '—'}</td>
                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-outline"
                        onClick={() => restaurarDePapelera(item)}
                        disabled={restaurandoId !== null}
                        style={{ color: '#3fb950', borderColor: '#3fb950', marginRight: '6px', fontSize: '0.8rem', cursor: restaurandoId ? 'wait' : 'pointer' }}
                        title="Restaurar con su ID original (las referencias vivas se reconectan)"
                      >
                        {restaurandoId === item.id ? 'Restaurando…' : 'Restaurar'}
                      </button>
                      <button
                        className="btn-small btn-danger"
                        onClick={() => eliminarDefinitivo(item)}
                        title="Eliminar definitivamente de la papelera"
                        style={{ fontSize: '0.8rem' }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  ) : null;

  if (!catalogoSeleccionado) return (
    <div className="module-container cd-x1">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
        <h1 className="module-title cd-x2">
          Administración de Catálogos
        </h1>
        {/* ✅ NUEVO (V00106): acceso a la papelera para restaurar eliminados */}
        <button
          className="btn btn-outline"
          onClick={() => abrirPapelera()}
          title="Ver y restaurar registros eliminados de todos los catálogos"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><polyline points="9 14 12 11 15 14"></polyline><line x1="12" y1="11" x2="12" y2="18"></line></svg>
          Papelera
        </button>
      </div>
      <div className="catalog-grid">
        {listaCatalogos.map((cat: CatalogSchema) => (
          <div key={cat.id} className="catalog-card" onClick={() => setCatalogoSeleccionado(cat)}>
            <div className="catalog-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">{cat.icono}</svg></div>
            <div className="catalog-title">{cat.titulo}</div>
          </div>
        ))}
      </div>
      {modalPapeleraJSX}
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
            {/* ✅ NUEVO: borrado en lote de los registros seleccionados */}
            {seleccionadosIds.length > 0 && (
              <button
                className="btn cd-x15"
                title={`Eliminar los ${seleccionadosIds.length} registros seleccionados`}
                onClick={eliminarSeleccionados}
                disabled={borrandoSeleccion}
                style={{ backgroundColor: borrandoSeleccion ? '#21262d' : '#da3633', color: '#fff', border: 'none', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, cursor: borrandoSeleccion ? 'wait' : 'pointer' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                {borrandoSeleccion ? 'Eliminando…' : `Eliminar (${seleccionadosIds.length})`}
              </button>
            )}
            {/* ✅ MODIFICADO (V00106): el antiguo botón de "limpiar duplicados"
                ahora es UNIR — selecciona 2+ registros con los checkboxes y
                los fusiona en uno solo reapuntando todas las referencias. */}
            <button
              className="btn btn-outline cd-x15"
              title={seleccionadosIds.length < 2
                ? 'Unir registros: selecciona 2 o más con los checkboxes para fusionarlos en uno'
                : `Unir los ${seleccionadosIds.length} registros seleccionados en uno solo (reapunta referencias)`}
              onClick={abrirModalUnir}
              disabled={seleccionadosIds.length < 2 || uniendo}
              style={{
                opacity: (seleccionadosIds.length < 2 || uniendo) ? 0.55 : 1,
                cursor: uniendo ? 'wait' : (seleccionadosIds.length < 2 ? 'not-allowed' : 'pointer'),
                display: 'flex', alignItems: 'center', gap: '6px',
                color: seleccionadosIds.length >= 2 ? '#3fb950' : undefined,
                borderColor: seleccionadosIds.length >= 2 ? '#3fb950' : undefined,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M6 21V9a9 9 0 0 0 9 9"></path></svg>
              {seleccionadosIds.length >= 2 ? `Unir (${seleccionadosIds.length})` : 'Unir'}
            </button>
            {/* ✅ NUEVO (V00106): papelera filtrada al catálogo actual */}
            <button
              className="btn btn-outline cd-x15"
              title="Papelera: restaurar registros eliminados de este catálogo"
              onClick={() => abrirPapelera(catalogoSeleccionado.id)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><polyline points="9 14 12 11 15 14"></polyline><line x1="12" y1="11" x2="12" y2="18"></line></svg>
            </button>
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
            {catalogoSeleccionado.id === 'tarifas_referencia' && (
            <div style={{ margin: '0 0 10px 0', color: '#8b949e', fontSize: '0.82rem' }}>
              {/* ✅ NUEVO — TOTAL EN VIVO: suma de operaciones que usan alguna tarifa
                  (se actualiza al abrir; sube al usarse y baja al eliminarse). */}
              Total de operaciones usando tarifas:{' '}
              <b style={{ color: '#3fb950', fontSize: '0.95rem' }}>
                {usoTarifas === null ? '…' : Object.values(usoTarifas).reduce((s, u) => s + u.ops.length, 0)}
              </b>
              {usoTarifas !== null && (
                <span> · en {Object.values(usoTarifas).filter((u) => u.ops.length > 0).length} tarifa(s) con uso</span>
              )}
            </div>
          )}
          <table className="data-table cd-x19">
              <thead className="cd-x20">
                <tr>
                  {/* ✅ NUEVO: selección múltiple (marca todas las de la página) */}
                  <th className="cd-x21" style={{ width: '36px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      title="Seleccionar todos los de esta página"
                      checked={registrosEnPantalla.length > 0 && registrosEnPantalla.every((r: any) => seleccionadosIds.includes(r.id))}
                      onChange={() => {
                        const idsPagina = registrosEnPantalla.map((r: any) => r.id);
                        const todas = idsPagina.length > 0 && idsPagina.every((id: string) => seleccionadosIds.includes(id));
                        setSeleccionadosIds((prev) => todas
                          ? prev.filter((id) => !idsPagina.includes(id))
                          : Array.from(new Set([...prev, ...idsPagina])));
                      }}
                      style={{ cursor: 'pointer' }}
                    />
                  </th>
                  <th className="cd-x21">Acciones</th>
                  
                  {catalogoSeleccionado.details && catalogoSeleccionado.details.length > 0 && (
                    <th className="cd-x22">
                      Sub-Registros
                    </th>
                  )}

                  {catalogoSeleccionado.fields.map((f: CatalogField) => (
                    <th className="cd-x23" key={f.name} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                      title="Clic para ordenar" onClick={() => clickOrdenCat(f.name)}>
                      {f.label}{ordenCat?.col === f.name ? (ordenCat.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  {/* ✅ NUEVO: uso del tipo de tarifario en Tarifas de Referencia */}
                  {catalogoSeleccionado.id === 'tipos_tarifarios' && (
                    <th className="cd-x23" style={{ cursor: 'pointer' }} title="Clic para ordenar" onClick={() => clickOrdenCat('__usoTipo')}>
                      TARIFAS QUE LO USAN{ordenCat?.col === '__usoTipo' ? (ordenCat.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  )}
                  {catalogoSeleccionado.id === 'tarifas_referencia' && (
                    <th className="cd-x23" style={{ cursor: 'pointer' }} title="Clic para ordenar por uso" onClick={() => clickOrdenCat('__uso')}>
                      USO (OPS · CONVENIOS){ordenCat?.col === '__uso' ? (ordenCat.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {registrosEnPantalla.length === 0 ? (
                  <tr><td className="cd-x24" colSpan={catalogoSeleccionado.fields.length + 3}>No hay registros.</td></tr>
                ) : (
                  registrosEnPantalla.map((reg: any) => (
                    <tr key={reg.id} onClick={() => { setRegistroActual(reg); setViendoDetalles(true); }} style={{ borderBottom: '1px solid #21262d', backgroundColor: seleccionadosIds.includes(reg.id) ? 'rgba(239, 68, 68, 0.08)' : (hoveredRowId === reg.id ? '#21262d' : '#0d1117'), transition: 'background-color 0.2s', cursor: 'pointer' }} onMouseEnter={() => setHoveredRowId(reg.id!)} onMouseLeave={() => setHoveredRowId(null)}>
                      {/* ✅ NUEVO: checkbox de selección múltiple */}
                      <td className="cd-x25" style={{ textAlign: 'center' }} onClick={(e: any) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={seleccionadosIds.includes(reg.id)}
                          onChange={() => toggleSeleccion(reg.id)}
                          style={{ cursor: 'pointer' }}
                        />
                      </td>
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
                          
                          {/* LLAMADA A LA FUNCIÓN REFACTORIZADA PARA ELIMINAR CON LOG */}
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
                      {/* ✅ NUEVO: cuántas Tarifas de Referencia usan este tipo */}
                      {catalogoSeleccionado.id === 'tipos_tarifarios' && (
                        <td className="cd-x31" style={{ fontWeight: 700, color: (usoTarifarios?.[reg.id] || 0) > 0 ? '#3fb950' : '#6e7681' }}>
                          {usoTarifarios === null ? '…' : (usoTarifarios[reg.id] || 0)}
                        </td>
                      )}
                      {catalogoSeleccionado.id === 'tarifas_referencia' && (() => {
                        const u = usoTarifas?.[reg.id];
                        const total = (u?.ops.length || 0) + (u?.convC.length || 0) + (u?.convP.length || 0);
                        return (
                          <td className="cd-x31" onClick={(e) => { e.stopPropagation(); if (u && total > 0) setModalUsoTarifa({ reg, u }); }}
                            style={{ fontWeight: 700, color: total > 0 ? '#3fb950' : '#6e7681', cursor: total > 0 ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
                            title={total > 0 ? 'Clic para ver DÓNDE se usa' : 'Sin uso registrado'}>
                            {usoTarifas === null ? '…' : `Ops ${u?.ops.length || 0} · ConvC ${u?.convC.length || 0} · ConvP ${u?.convP.length || 0}`}
                          </td>
                        );
                      })()}
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

      {/* VISTA: MODAL DETALLES (RENDERIZADO INSTANTÁNEO 0 LECTURAS) */}
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

      {/* FORMULARIO DE AGREGAR / EDITAR PRINCIPAL */}
      {modalEstado === 'formulario' && catalogoSeleccionado && (
        <div className="modal-overlay cd-x72">
          <div className="cd-x73" style={(catalogoSeleccionado.formColumns || 1) >= 3 ? { maxWidth: '1000px', width: '95%' } : undefined}>
            <div className="cd-x38">
              <h2 className="cd-x39">{registroActual ? 'Editar' : 'Agregar'} {catalogoSeleccionado.titulo}</h2>
              <button className="cd-x41" onClick={() => setModalEstado('cerrado')}>✕</button>
            </div>
            
            <form className="cd-x74" onSubmit={guardarRegistro}>
              <div className={`cd-x75${(catalogoSeleccionado.formColumns || 1) >= 3 ? ' cd-x75-3col' : ''}`}>
                {catalogoSeleccionado.fields.map((f: CatalogField) => {
                  const isReq = (camposRequeridos[catalogoSeleccionado.id] || []).includes(f.name);
                  return (
                    <div key={f.name}>
                      <label className="cd-x76">{f.label} {isReq && <span className="cd-x77">*</span>}</label>
                      {/* ✅ MODIFICADO (V00110): opciones dinámicas solo si el catálogo trae registros; si está vacío y hay `options` fijas, se usan de respaldo (caso C/V). */}
                      {f.dynamicOptions && (opcionesDinamicas[f.dynamicOptions.collection]?.length ?? 0) > 0 ? (
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

      {/* MODAL DE FORMULARIO PARA SUB-DETALLES */}
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
                      {/* ✅ MODIFICADO (V00110): opciones dinámicas solo si el catálogo trae registros; si está vacío y hay `options` fijas, se usan de respaldo (caso C/V). */}
                      {f.dynamicOptions && (opcionesDinamicas[f.dynamicOptions.collection]?.length ?? 0) > 0 ? (
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

      {/* ✅ NUEVO — MODAL: DÓNDE SE USA LA TARIFA */}
      {modalUsoTarifa && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 2600, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setModalUsoTarifa(null)}>
          <div style={{ width: 'min(640px, 94vw)', maxHeight: '82vh', overflowY: 'auto', background: '#161b22', border: '1px solid #30363d', borderRadius: '12px', padding: '18px' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 4px 0', color: '#f0f6fc', fontSize: '1rem' }}>Dónde se usa: {modalUsoTarifa.reg.descripcion || modalUsoTarifa.reg.id}</h3>
            <p style={{ margin: '0 0 12px 0', color: '#8b949e', fontSize: '0.78rem' }}>
              {modalUsoTarifa.u.ops.length} operación(es) · {modalUsoTarifa.u.convC.length} convenio(s) de clientes · {modalUsoTarifa.u.convP.length} convenio(s) de proveedores
            </p>
            {modalUsoTarifa.u.convC.length > 0 && (<>
              <div style={{ color: '#58a6ff', fontWeight: 700, fontSize: '0.8rem', margin: '10px 0 4px 0' }}>CONVENIOS DE CLIENTES</div>
              {Array.from(new Set(modalUsoTarifa.u.convC)).map((c: any) => <div key={c} style={{ color: '#c9d1d9', fontSize: '0.8rem', padding: '2px 0' }}>{c}</div>)}
            </>)}
            {modalUsoTarifa.u.convP.length > 0 && (<>
              <div style={{ color: '#d29922', fontWeight: 700, fontSize: '0.8rem', margin: '10px 0 4px 0' }}>CONVENIOS DE PROVEEDORES</div>
              {Array.from(new Set(modalUsoTarifa.u.convP)).map((c: any) => <div key={c} style={{ color: '#c9d1d9', fontSize: '0.8rem', padding: '2px 0' }}>{c}</div>)}
            </>)}
            {modalUsoTarifa.u.ops.length > 0 && (<>
              <div style={{ color: '#3fb950', fontWeight: 700, fontSize: '0.8rem', margin: '10px 0 4px 0' }}>OPERACIONES ({modalUsoTarifa.u.ops.length})</div>
              <div style={{ color: '#c9d1d9', fontSize: '0.78rem', fontFamily: 'monospace', lineHeight: 1.7 }}>
                {modalUsoTarifa.u.ops.slice(0, 120).join(' · ')}{modalUsoTarifa.u.ops.length > 120 ? ` … (+${modalUsoTarifa.u.ops.length - 120} más)` : ''}
              </div>
            </>)}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '14px' }}>
              <button type="button" className="btn btn-outline" style={{ padding: '8px 16px' }} onClick={() => setModalUsoTarifa(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO (V00106) — MODAL: UNIR REGISTROS SELECCIONADOS */}
      {modalUnir && (
        <div className="modal-overlay" style={{ zIndex: 2200 }} onClick={() => !uniendo && setModalUnir(false)}>
          <div className="form-card" style={{ maxWidth: '680px', width: '95%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
            <div className="form-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0 }}>Unir registros de {catalogoSeleccionado.titulo}</h2>
              <button style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }} onClick={() => !uniendo && setModalUnir(false)}>✕</button>
            </div>

            <p style={{ color: '#8b949e', fontSize: '0.83rem', lineHeight: 1.6, margin: '10px 0' }}>
              Elige el registro que se va a <b style={{ color: '#3fb950' }}>CONSERVAR</b>. Los demás se
              fusionarán en él: todas sus referencias (sub-registros, otros catálogos que los usan y
              módulos como Operaciones, Direcciones y Convenios) se reapuntarán al conservado, y los
              registros absorbidos se enviarán a la <b>Papelera</b> por si necesitas revisarlos después.
            </p>

            <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {seleccionadosIds.map((id) => {
                const reg: any = registrosGlobales.find((r: any) => r.id === id);
                if (!reg) return null;
                const esConservado = conservarId === id;
                const vinculados = conteoDetallesGlobal[String(id).toLowerCase()] || 0;
                return (
                  <label
                    key={id}
                    style={{
                      display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px',
                      border: `1px solid ${esConservado ? '#3fb950' : '#30363d'}`,
                      background: esConservado ? 'rgba(63, 185, 80, 0.08)' : '#0d1117',
                      borderRadius: '8px', cursor: uniendo ? 'wait' : 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="conservar-registro"
                      checked={esConservado}
                      onChange={() => setConservarId(id)}
                      disabled={uniendo}
                      style={{ marginTop: '3px', cursor: 'pointer' }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: esConservado ? '#3fb950' : '#c9d1d9', fontWeight: 600, fontSize: '0.88rem' }}>
                        {resumenRegistro(reg)}{esConservado ? '  ← SE CONSERVA' : ''}
                      </div>
                      <div style={{ color: '#8b949e', fontSize: '0.76rem', marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px 14px' }}>
                        {catalogoSeleccionado.fields.slice(0, 5).map((f: CatalogField) => (
                          <span key={f.name}>{f.label}: <b style={{ color: '#c9d1d9', fontWeight: 500 }}>{getDisplayValue(reg, f)}</b></span>
                        ))}
                        {(catalogoSeleccionado.details?.length || 0) > 0 && (
                          <span>Sub-registros: <b style={{ color: vinculados > 0 ? '#d29922' : '#c9d1d9', fontWeight: 600 }}>{vinculados}</b></span>
                        )}
                        <span style={{ fontFamily: 'monospace', color: '#6e7681' }}>ID: {String(id).slice(0, 10)}</span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' }}>
              <button type="button" className="btn btn-outline" style={{ padding: '8px 16px' }} disabled={uniendo} onClick={() => setModalUnir(false)}>Cancelar</button>
              <button
                type="button"
                className="btn"
                onClick={ejecutarUnionCatalogo}
                disabled={uniendo || !conservarId}
                style={{ padding: '8px 16px', backgroundColor: '#238636', color: '#fff', border: 'none', fontWeight: 600, cursor: uniendo ? 'wait' : 'pointer', opacity: uniendo ? 0.7 : 1 }}
              >
                {uniendo ? 'Uniendo… no cierres la ventana' : `Unir ${seleccionadosIds.length} registros`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ NUEVO (V00106) — MODAL PAPELERA (también accesible desde la lista) */}
      {modalPapeleraJSX}
    </div>
  );
};

export default CatalogosDashboard;
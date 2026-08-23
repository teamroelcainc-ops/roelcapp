// src/features/conveniosProveedores/components/FormularioConvenioProveedor.tsx
import React, { useState, useEffect, useRef } from 'react';
import { collection, getDocs, getDoc, doc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import type { ConvenioProveedorRecord, ConvenioProveedorDetalleRecord } from '../../../types/convenioProveedor';
import './FormularioConvenioProveedor.css';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { limpiarCacheMemoria } from '../../../utils/cacheMemoria';

// =========================================
// SUB-COMPONENTE: SELECTOR CON BUSCADOR
// =========================================
const SearchableSelect: React.FC<{
  options: { id: string, label: string }[];
  value: string;
  onChange: (id: string, label: string) => void;
  placeholder?: string;
  required?: boolean;
}> = ({ options, value, onChange, placeholder = "Buscar...", required = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const selectedLabel = options.find(o => o.id === value)?.label || '';

  useEffect(() => { setSearchTerm(selectedLabel); }, [value, selectedLabel]);

  const filteredOptions = options.filter(opt => opt.label.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className="fcp-x1">
      <input
        type="text"
        placeholder={placeholder}
        value={isOpen ? searchTerm : selectedLabel}
        onChange={(e) => { setSearchTerm(e.target.value); setIsOpen(true); }}
        onFocus={() => { setSearchTerm(''); setIsOpen(true); }}
        onBlur={() => { 
          // CORRECCIÓN 2: Eliminado el setTimeout problemático
          setIsOpen(false); 
          setSearchTerm(selectedLabel); 
        }}
        required={required && !value} 
        className={`form-control fcp-ss-input${isOpen ? ' abierto' : ''}`}
      />
      {isOpen && (
        <ul className="fcp-x2">
          {filteredOptions.length > 0 ? (
            filteredOptions.map(opt => (
              <li className="fcp-x3" 
                key={opt.id} 
                // CORRECCIÓN 2: onMouseDown evita que se dispare el onBlur del input antes de seleccionar
                onMouseDown={(e) => { 
                  e.preventDefault(); 
                  onChange(opt.id, opt.label); 
                  setSearchTerm(opt.label); 
                  setIsOpen(false); 
                }}
>
                {opt.label}
              </li>
            ))
          ) : (
            <li className="fcp-x4">No hay coincidencias</li>
          )}
        </ul>
      )}
    </div>
  );
};

// =========================================
// COMPONENTE PRINCIPAL
// =========================================
interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: ConvenioProveedorRecord | null;
  registrosExistentes: ConvenioProveedorRecord[]; 
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioConvenioProveedor = ({ estado, initialData, registrosExistentes, onClose, onMinimize, onRestore }: FormProps) => {
  const todayISO = hoyLocalISO();

  const [formData, setFormData] = useState<ConvenioProveedorRecord>({
    numeroConvenio: '',
    proveedorId: '',
    proveedorNombre: '',
    monedaId: '',
    monedaNombre: '',
    credito: 0,
    fechaConvenio: todayISO,
    fechaVencimiento: `${new Date().getFullYear()}-12-31` // ✅ por defecto 31 de diciembre (editable)
  });

  const [detalles, setDetalles] = useState<(ConvenioProveedorDetalleRecord & { _isNew?: boolean })[]>([]);
  const [detallesEliminados, setDetallesEliminados] = useState<string[]>([]); 
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [monedas, setMonedas] = useState<any[]>([]);

  // ✅ CORREGIDO (V00118) — RESOLUCIÓN ROBUSTA DE LA MONEDA DE LA EMPRESA:
  //   la empresa puede tener la moneda guardada como ID del catálogo o como
  //   TEXTO legado ("Pesos"); además el catálogo puede no haber cargado aún
  //   al elegir la empresa. Esta función cubre los tres casos, leyendo el
  //   catálogo directo de Firebase si hace falta.
  const resolverMonedaDeEmpresa = async (e: any): Promise<{ monId: string; monNom: string }> => {
    const crudo = String(e?.monedaId || e?.moneda || '').trim();
    let lista = monedas;
    if (lista.length === 0) {
      try {
        const snapM = await getDocs(collection(db, 'catalogo_moneda'));
        lista = snapM.docs.map((d) => ({ id: d.id, ...d.data() }));
        setMonedas(lista);
      } catch { /* sin conexión: se intenta con lo que haya */ }
    }
    if (!crudo) {
      const nom = String(e?.monedaNombre || '').trim();
      if (nom) {
        const m = lista.find((x: any) => String(x.moneda || '').toLowerCase() === nom.toLowerCase());
        if (m) return { monId: m.id, monNom: String(m.moneda || nom) };
      }
      return { monId: '', monNom: '' };
    }
    const porId = lista.find((x: any) => x.id === crudo);
    if (porId) return { monId: porId.id, monNom: String(porId.moneda || '') };
    // Texto legado: buscar por nombre de moneda
    const porNombre = lista.find((x: any) => String(x.moneda || '').toLowerCase() === crudo.toLowerCase());
    if (porNombre) return { monId: porNombre.id, monNom: String(porNombre.moneda || crudo) };
    return { monId: '', monNom: crudo };
  };

  // ✅ NUEVO (V00118): autocuración — si ya hay proveedor elegido pero la
  //   moneda del convenio quedó vacía o no coincide con el catálogo (caso de
  //   la captura: empresa con moneda en texto legado), se vuelve a jalar de la
  //   empresa automáticamente.
  useEffect(() => {
    const idEnt = String(formData.proveedorId || '');
    if (!idEnt) return;
    const coincide = formData.monedaId && monedas.some((x: any) => x.id === formData.monedaId);
    if (coincide) return;
    let activo = true;
    (async () => {
      try {
        const snapE = await getDoc(doc(db, 'empresas', idEnt));
        if (!snapE.exists() || !activo) return;
        const { monId, monNom } = await resolverMonedaDeEmpresa(snapE.data());
        if (activo && monId) setFormData((prev: any) => ({ ...prev, monedaId: monId, monedaNombre: monNom }));
      } catch { /* sin conexión */ }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.proveedorId, monedas]);
  const [tarifarios, setTarifarios] = useState<any[]>([]);
  const [tarifasSugeridasActuales, setTarifasSugeridasActuales] = useState<number[]>([]); 
  const [cargando, setCargando] = useState(false);
  const [mostrandoDetalleForm, setMostrandoDetalleForm] = useState(false);
  
  interface DetalleDraft {
    tipoConvenioId: string;
    tipoConvenioNombre: string;
    tarifaSugeridaSeleccionada: string;
    tarifa: number;
    moneda?: string;
    _editandoId?: string;
  }
  const DRAFT_VACIO: DetalleDraft = { tipoConvenioId: '', tipoConvenioNombre: '', tarifaSugeridaSeleccionada: '', tarifa: 0 };
  const [detalleDraft, setDetalleDraft] = useState<DetalleDraft>(DRAFT_VACIO);
  const opcionesMoneda: string[] = monedas.length > 0 ? monedas.map((m: any) => String(m.moneda || '')).filter(Boolean) : ['Pesos', 'Dólares'];
  // ✅ V00126: normaliza la moneda guardada a la opción exacta del catálogo
  //   ("dolares"/"USD" → "Dólares"); si no coincide con ninguna, la conserva
  //   como opción extra para que el <select> NUNCA muestre otra por defecto.
  const normalizarMoneda = (v: string | undefined): string => {
    const raw = String(v || '').trim();
    if (!raw) return '';
    const exacta = opcionesMoneda.find(m => m === raw); if (exacta) return exacta;
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const r = norm(raw);
    const porNombre = opcionesMoneda.find(m => norm(m) === r); if (porNombre) return porNombre;
    if (r.includes('usd') || r.includes('dolar')) { const d = opcionesMoneda.find(m => norm(m).includes('dolar') || norm(m).includes('usd')); if (d) return d; }
    if (r.includes('mxn') || r.includes('peso')) { const pz = opcionesMoneda.find(m => norm(m).includes('peso') || norm(m).includes('mxn')); if (pz) return pz; }
    return raw;
  };
  const opcionesMonedaCon = (v: string) => (v && !opcionesMoneda.includes(v)) ? [...opcionesMoneda, v] : opcionesMoneda;
  const cerrarDetalleModal = () => { setDetalleDraft(DRAFT_VACIO); setTarifasSugeridasActuales([]); setMostrandoDetalleForm(false); };
  const abrirNuevoDetalle = () => { setDetalleDraft({ ...DRAFT_VACIO, moneda: formData.monedaNombre || 'Pesos' }); setTarifasSugeridasActuales([]); setMostrandoDetalleForm(true); };
  const nombreTarifario = (t: any) => t ? (t.tipo_operacionNombre || t.tipo_operacion || t.descripcion || 'Desconocido') : '';
  const sugerenciasDe = (t: any): number[] => {
    const out: number[] = [];
    if (t) [t.tarifa_proveedor_1, t.tarifa_proveedor_2, t.tarifa_proveedor_3].forEach(v => { if (Number(v) > 0) out.push(Number(v)); });
    return out;
  };

  // 1. CARGA DE CATÁLOGOS
  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const empSnapshot = await getDocs(collection(db, 'empresas'));
        const todasEmpresas = empSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // CORRECCIÓN 1: Selección estricta de proveedores con status Activa y tipo ca21ab07
        setProveedores(todasEmpresas.filter((emp: any) => {
          const isActiva = emp.status === 'Activa';
          const hasTipo = Array.isArray(emp.tiposEmpresa) 
            ? emp.tiposEmpresa.includes('ca21ab07') 
            : emp.tiposEmpresa === 'ca21ab07';
          return isActiva && hasTipo;
        }));

        const monSnapshot = await getDocs(collection(db, 'catalogo_moneda'));
        setMonedas(monSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));

        const tarifarioSnapshot = await getDocs(collection(db, 'catalogo_tarifas_referencia'));
        setTarifarios(tarifarioSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) { console.error("Error catálogos:", error); }
    };
    cargarCatalogos();
  }, []);

  // 2. CARGA DE DATOS Y JOIN DE NOMBRES
  // ✅ CORREGIDO (V00126): los detalles se cargan UNA sola vez por convenio.
  //   Antes este efecto dependía de `registrosExistentes` (alimentado por un
  //   onSnapshot del dashboard) y de la identidad del objeto `initialData`, por
  //   lo que cualquier refresco de Firestore volvía a leer los detalles de la BD
  //   y PISABA las ediciones locales (la moneda "se revertía" tras Actualizar).
  const convenioCargadoRef = useRef<string | null>(null);
  useEffect(() => {
    const idConv = initialData?.id || '';
    if (idConv && tarifarios.length > 0) {
      if (convenioCargadoRef.current === idConv) return; // ya cargado: no pisar ediciones locales
      convenioCargadoRef.current = idConv;
      setFormData(initialData!);
      setDetallesEliminados([]);

      const cargarDetalles = async () => {
        try {
          const q = query(collection(db, 'convenios_proveedores_detalles'), where('convenioId', '==', idConv));
          const snap = await getDocs(q);

          const detallesBD = snap.docs.map(docSnap => {
            const data = docSnap.data();
            const idReal = data.tipoConvenioId || data.tarifaId || data.tipo_convenio || '';
            const refMaster = tarifarios.find(t => String(t.id).trim() === String(idReal).trim());

            let nombreAsignado = data.tipoConvenioNombre;
            if (!nombreAsignado || String(nombreAsignado).trim() === '' || String(nombreAsignado).includes('no identificado')) {
              nombreAsignado = refMaster ? (refMaster.tipo_operacionNombre || refMaster.tipo_operacion || refMaster.descripcion || 'Sin nombre en catálogo') : 'Concepto no identificado';
            }

            return {
              id: docSnap.id,
              convenioId: data.convenioId,
              tipoConvenioId: idReal,
              tipoConvenioNombre: nombreAsignado,
              tarifa: data.tarifa || 0,
              moneda: data.moneda || '' // ✅ CORREGIDO (V00124): la moneda guardada del detalle ya NO se pierde al recargar
            } as ConvenioProveedorDetalleRecord;
          });

          setDetalles(detallesBD);
        } catch (error) { console.error("Error detalles:", error); }
      };
      cargarDetalles();
    } else if (!initialData) {
      if (convenioCargadoRef.current === '__nuevo__') return;
      convenioCargadoRef.current = '__nuevo__';
      setFormData(prev => ({ ...prev, numeroConvenio: generarSiguienteConvenio() }));
      setDetalles([]);
      setDetallesEliminados([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData?.id, tarifarios]);

  const generarSiguienteConvenio = () => {
    if (registrosExistentes.length === 0) return 'CPRV-001';
    const numeros = registrosExistentes.map(reg => parseInt(reg.numeroConvenio.replace('CPRV-', ''), 10) || 0);
    return `CPRV-${String(Math.max(...numeros) + 1).padStart(3, '0')}`;
  };

  // ✅ V00126: recibe el id directo (lo llama el SearchableSelect del modal) y
  //   CONSERVA la moneda elegida y el modo edición (_editandoId).
  const handleTipoConvenioChange = (id: string) => {
    const tarifario = tarifarios.find(t => t.id === id);
    const sugerencias = sugerenciasDe(tarifario);
    setTarifasSugeridasActuales(sugerencias);
    setDetalleDraft(prev => ({
      ...prev,
      tipoConvenioId: id,
      tipoConvenioNombre: nombreTarifario(tarifario), 
      tarifaSugeridaSeleccionada: sugerencias.length > 0 ? String(sugerencias[0]) : '', 
      tarifa: sugerencias.length > 0 ? sugerencias[0] : 0
    }));
  };

  const handleAgregarDetalle = () => {
    if (!detalleDraft.tipoConvenioId || detalleDraft.tarifa <= 0) return alert("Complete los datos del detalle (Concepto y Tarifa Final).");
    
    // ✅ NUEVO (V00120): moneda del concepto (por defecto la del convenio) y
    //   modo EDICIÓN (si _editandoId existe, se reemplaza en sitio).
    const monedaDet = detalleDraft.moneda || formData.monedaNombre || 'Pesos';
    if (detalleDraft._editandoId) {
      const idEd = detalleDraft._editandoId;
      setDetalles(prev => prev.map(d => d.id === idEd
        ? { ...d, tipoConvenioId: detalleDraft.tipoConvenioId, tipoConvenioNombre: detalleDraft.tipoConvenioNombre, tarifa: detalleDraft.tarifa, moneda: monedaDet, _editado: !d._isNew ? true : d._editado }
        : d));
      cerrarDetalleModal();
      return;
    }

    const nuevoDetalle = {
      id: `local_${Date.now()}`, 
      tipoConvenioId: detalleDraft.tipoConvenioId,
      tipoConvenioNombre: detalleDraft.tipoConvenioNombre, 
      tarifa: detalleDraft.tarifa,
      moneda: monedaDet, // ✅ NUEVO (V00120)
      _isNew: true 
    };
    
    setDetalles(prev => [...prev, nuevoDetalle]);
    cerrarDetalleModal();
  };

  const handleEliminarDetalle = (id: string, isNew?: boolean) => {
    setDetalles(prev => prev.filter(d => d.id !== id));
    if (!isNew) setDetallesEliminados(prev => [...prev, id]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.proveedorId) return alert("Seleccione un proveedor.");

    // ✅ NUEVO (V00119) — SIN DUPLICADOS: cada proveedor puede tener UN solo
    //   convenio. Antes de guardar se verifica en Firebase.
    try {
      const dupSnap = await getDocs(query(collection(db, 'convenios_proveedores'), where('proveedorId', '==', formData.proveedorId)));
      const otro = dupSnap.docs.find((d) => d.id !== (initialData?.id || ''));
      if (otro) {
        const x: any = otro.data();
        alert(`Este proveedor YA tiene un convenio registrado (${x.numeroConvenio || otro.id}).\n\nNo se permiten convenios duplicados por proveedor: edita el convenio existente o elímalo primero.`);
        return;
      }
    } catch (eDup) { console.warn('No se pudo verificar duplicados:', eDup); }
    setCargando(true);
    try {
      const batch = writeBatch(db);
      
      // CORRECCIÓN 3: Extracción explícita para asegurar la integridad de la relación convenioId
      let masterId = initialData?.id || (formData as any).id;
      const docRefMaestro = masterId ? doc(db, 'convenios_proveedores', masterId) : doc(collection(db, 'convenios_proveedores'));
      
      if (!masterId) {
        masterId = docRefMaestro.id;
        const { id, ...dataToSave } = formData as any;
        batch.set(docRefMaestro, { ...dataToSave, numeroConvenio: generarSiguienteConvenio() });
      } else {
        const { id, ...dataToSave } = formData as any;
        batch.update(docRefMaestro, { ...dataToSave });
      }

      detalles.forEach(det => {
        if (det._isNew) {
          const detRef = doc(collection(db, 'convenios_proveedores_detalles'));
          batch.set(detRef, { 
            convenioId: masterId, // Forzado relacional fuerte
            tipoConvenioId: det.tipoConvenioId, 
            tipoConvenioNombre: det.tipoConvenioNombre, 
            tarifa: Number(det.tarifa),
            moneda: normalizarMoneda(det.moneda) || normalizarMoneda(formData.monedaNombre) || '' // ✅ NUEVO (V00120) · V00126 normalizada
          });
        } else {
          const detRef = doc(db, 'convenios_proveedores_detalles', det.id!);
          batch.update(detRef, { 
            tarifa: Number(det.tarifa),
            tipoConvenioId: det.tipoConvenioId,
            tipoConvenioNombre: det.tipoConvenioNombre,
            moneda: normalizarMoneda(det.moneda) || normalizarMoneda(formData.monedaNombre) || '', // ✅ NUEVO (V00120) 
            convenioId: masterId // Garantizado en actualizaciones
          });
        }
      });

      detallesEliminados.forEach(delId => batch.delete(doc(db, 'convenios_proveedores_detalles', delId)));
      await batch.commit();
      // ✅ V00126: invalida la caché del módulo "Detalles del Convenio" para que refleje la moneda/tarifa recién guardadas
      limpiarCacheMemoria('detalles_convenio__proveedores');
      onClose();
    } catch (error) { 
      console.error(error);
      alert('Error al guardar convenio transaccional.'); 
    } finally { setCargando(false); }
  };

  return (
    <>
      {/* ✅ NUEVO (V00126): captura/edición del concepto en MODAL (antes era un panel incrustado) */}
      {mostrandoDetalleForm && (
        <div className="modal-overlay fcp-det-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrarDetalleModal(); }}>
          <div className="form-card fcp-det-card">
            <div className="form-header fcp-det-header">
              <h3 className="fcp-det-titulo">{detalleDraft._editandoId ? '✎ Editar Concepto' : '+ Nuevo Concepto'}</h3>
              <button type="button" className="close-x fcp-det-cerrar" onClick={cerrarDetalleModal}>✕</button>
            </div>
            <div className="fcp-det-cuerpo">
              <div className="form-grid fcp-x12">
                <div className="form-group fcp-det-tipo">
                  <label className="form-label">Concepto (Tipo de Operación) *</label>
                  <SearchableSelect
                    options={tarifarios.map(t => ({ id: t.id, label: nombreTarifario(t) || 'Sin nombre' }))}
                    value={detalleDraft.tipoConvenioId}
                    onChange={(id) => handleTipoConvenioChange(id)}
                    placeholder="Buscar concepto..."
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Tarifa Sugerida</label>
                  <select className="form-control" value={detalleDraft.tarifaSugeridaSeleccionada} onChange={(e) => setDetalleDraft(prev => ({ ...prev, tarifaSugeridaSeleccionada: e.target.value, tarifa: parseFloat(e.target.value) || 0 }))}>
                    <option value="">{tarifasSugeridasActuales.length > 0 ? 'Ver...' : 'Sin sugeridas'}</option>
                    {tarifasSugeridasActuales.map((tar, i) => <option key={i} value={tar}>${tar}</option>)}
                  </select>
                </div>
                <div className="form-group"><label className="form-label">Tarifa Final *</label><input type="number" step="0.01" className="form-control" value={detalleDraft.tarifa} onChange={(e) => setDetalleDraft(prev => ({ ...prev, tarifa: parseFloat(e.target.value) || 0 }))} /></div>
                {/* ✅ NUEVO (V00120): moneda del concepto, editable */}
                <div className="form-group">
                  <label className="form-label">Moneda</label>
                  <select className="form-control" value={normalizarMoneda(detalleDraft.moneda) || normalizarMoneda(formData.monedaNombre) || opcionesMoneda[0] || 'Pesos'} onChange={(e) => setDetalleDraft(prev => ({ ...prev, moneda: e.target.value }))}>
                    {/* ✅ V00123: opciones desde el catálogo de Monedas */}{opcionesMoneda.map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div className="fcp-det-acciones">
                <button type="button" className="btn btn-outline" onClick={cerrarDetalleModal}>Cancelar</button>
                <button type="button" className="btn btn-primary fcp-x13" onClick={handleAgregarDetalle}>{detalleDraft._editandoId ? 'Actualizar' : 'Guardar Concepto'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card fcp-x5">
        <div className="form-header">
          <h2>{initialData ? `Editar Convenio` : 'Nuevo Convenio de Proveedor'}</h2>
          <div className="header-actions">
            {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div className={`fcp-cuerpo${estado === 'minimizado' ? ' oculto' : ''}`}>
          <form onSubmit={handleSubmit}>
            <div className="form-grid fcp-x6">
              <div className="form-group">
                <label className="form-label orange"># de Convenio</label>
                <input type="text" className="form-control fcp-x7" value={formData.numeroConvenio} disabled />
              </div>
              <div className="form-group">
                <label className="form-label">Proveedor *</label>
                <SearchableSelect 
                  options={proveedores.map(p => ({ id: p.id, label: p.nombre || p.empresa || 'S/N' }))} 
                  value={formData.proveedorId} 
                  onChange={async (id, label) => {
                      // ✅ NUEVO: Moneda y Crédito se JALAN de la empresa (no editables aquí).
                      let monId = '', monNom = '', cred = 0;
                      try {
                        const snapE = await getDoc(doc(db, 'empresas', id));
                        if (snapE.exists()) {
                          const e: any = snapE.data();
                          cred = Number(e.diasCredito || e.credito || 0) || 0;
                          // ✅ CORREGIDO (V00118): resolución robusta (id, texto legado o catálogo sin cargar)
                          const r = await resolverMonedaDeEmpresa(e);
                          monId = r.monId; monNom = r.monNom;
                        }
                      } catch (eE) { console.warn('No se pudo leer la empresa:', eE); }
                      setFormData(prev => ({ ...prev, proveedorId: id, proveedorNombre: label, monedaId: monId || prev.monedaId, monedaNombre: monNom || prev.monedaNombre, credito: cred }));
                    }} 
                  required 
                />
              </div>
              <div className="form-group"><label className="form-label">Fecha Convenio</label><input type="date" className="form-control" value={formData.fechaConvenio} onChange={(e) => setFormData({...formData, fechaConvenio: e.target.value})} required /></div>
              <div className="form-group"><label className="form-label">Fecha Vencimiento</label><input type="date" className="form-control" value={formData.fechaVencimiento} onChange={(e) => setFormData({...formData, fechaVencimiento: e.target.value})} required /></div>
              {/* ✅ MODIFICADO (V00119): el campo Moneda se eliminó del formulario; la moneda se hereda automáticamente de la empresa (monedaId/monedaNombre se guardan igual). */}
              <div className="form-group"><label className="form-label">Crédito (Días)</label><input type="number" className="form-control fcp-solo-lectura" readOnly title="Se toma automáticamente de la empresa (Días de Crédito)" value={formData.credito} onChange={(e) => setFormData({...formData, credito: parseInt(e.target.value) || 0})} required /></div>
            </div>

            <div className="fcp-x8">
              <div className="fcp-x9">
                <h3 className="fcp-x10">Lista de Tarifas</h3>
                <button type="button" className="btn btn-outline" onClick={abrirNuevoDetalle}>+ Agregar Concepto</button>
              </div>

              <div className="table-container fcp-x14">
                <table className="data-table fcp-x15">
                  <thead className="fcp-x16">
                    <tr>
                      <th className="fcp-x17">#</th>
                      <th className="fcp-x18">CONCEPTO</th>
                      <th className="fcp-x19">TARIFA</th>
                      <th className="fcp-x19">MONEDA</th>
                      <th className="fcp-x20">ACCIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalles.length === 0 ? (
                      <tr><td className="fcp-x21" colSpan={5}>No hay conceptos agregados a este convenio.</td></tr>
                    ) : (
                      detalles.map((det, index) => (
                        <tr className="fcp-x22" key={det.id}>
                          <td className="fcp-x23">{index + 1}</td>
                          <td className="fcp-x24 fcp-celda-nombre" title={det.tipoConvenioNombre}>{det.tipoConvenioNombre}</td>
                          <td className="fcp-x25">{/* ✅ NUEVO (V00121): edición en línea (varios de golpe); se guarda todo con "Guardar Convenio" */}<input type="number" step="0.01" className="form-control fcp-input-tarifa" value={det.tarifa} onClick={(e) => e.stopPropagation()} onChange={(e) => { const v = parseFloat(e.target.value) || 0; setDetalles(prev => prev.map(d => d.id === det.id ? { ...d, tarifa: v } : d)); }} /></td>
                          <td className="fcp-x25">{(() => { const val = normalizarMoneda(det.moneda) || normalizarMoneda(formData.monedaNombre) || opcionesMoneda[0] || 'Pesos'; return (<select className="form-control fcp-select-moneda" value={val} onClick={(e) => e.stopPropagation()} onChange={(e) => { const v = e.target.value; setDetalles(prev => prev.map(d => d.id === det.id ? { ...d, moneda: v, _editado: !d._isNew ? true : d._editado } : d)); }}>{/* ✅ V00123: opciones desde el catálogo de Monedas · V00126: valor normalizado */}{opcionesMonedaCon(val).map((m: string) => <option key={m} value={m}>{m}</option>)}</select>); })()}</td>
                          <td className="fcp-x26">
                            {/* ✅ NUEVO (V00120): editar concepto */}
                            <button type="button" className="fcp-btn-editar" title="Editar este concepto" onClick={() => { const t = tarifarios.find(x => x.id === det.tipoConvenioId); setTarifasSugeridasActuales(sugerenciasDe(t)); setDetalleDraft({ tipoConvenioId: det.tipoConvenioId, tipoConvenioNombre: det.tipoConvenioNombre, tarifaSugeridaSeleccionada: '', tarifa: Number(det.tarifa) || 0, moneda: det.moneda || formData.monedaNombre || 'Pesos', _editandoId: det.id }); setMostrandoDetalleForm(true); }}>✎</button>
                            <button className="fcp-x27" type="button" onClick={() => handleEliminarDetalle(det.id!, det._isNew)}>✕ Quitar</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="form-actions fcp-x28">
              <button type="button" onClick={onClose} className="btn btn-outline fcp-x29">Cancelar</button>
              <button type="submit" className="btn btn-primary fcp-x30" disabled={cargando}>
                {cargando ? 'Guardando Convenio...' : 'Guardar Convenio Maestro'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
    </>
  );
};

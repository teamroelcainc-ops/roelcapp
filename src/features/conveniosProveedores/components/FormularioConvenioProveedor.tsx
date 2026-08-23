// src/features/conveniosProveedores/components/FormularioConvenioProveedor.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, getDoc, doc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import type { ConvenioProveedorRecord, ConvenioProveedorDetalleRecord } from '../../../types/convenioProveedor';
import './FormularioConvenioProveedor.css';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';

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
        className="form-control"
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
        style={{ cursor: 'text', border: isOpen ? '1px solid #3b82f6' : '', backgroundColor: '#0d1117', color: '#c9d1d9' }}
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
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
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
  
  const [detalleDraft, setDetalleDraft] = useState({
    tipoConvenioId: '',
    tipoConvenioNombre: '',
    tarifaSugeridaSeleccionada: '',
    tarifa: 0
  });

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
  useEffect(() => {
    if (initialData && initialData.id && tarifarios.length > 0) {
      setFormData(initialData);
      
      const cargarDetalles = async () => {
        try {
          const q = query(collection(db, 'convenios_proveedores_detalles'), where('convenioId', '==', initialData.id));
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
      setFormData(prev => ({ ...prev, numeroConvenio: generarSiguienteConvenio() }));
      setDetalles([]);
    }
  }, [initialData, registrosExistentes, tarifarios]);

  const generarSiguienteConvenio = () => {
    if (registrosExistentes.length === 0) return 'CPRV-001';
    const numeros = registrosExistentes.map(reg => parseInt(reg.numeroConvenio.replace('CPRV-', ''), 10) || 0);
    return `CPRV-${String(Math.max(...numeros) + 1).padStart(3, '0')}`;
  };

  const handleTipoConvenioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const tarifario = tarifarios.find(t => t.id === id);
    const nombreTarifario = tarifario ? (tarifario.tipo_operacionNombre || tarifario.tipo_operacion || tarifario.descripcion || 'Desconocido') : '';

    let sugerencias: number[] = [];
    if (tarifario) {
      [tarifario.tarifa_proveedor_1, tarifario.tarifa_proveedor_2, tarifario.tarifa_proveedor_3].forEach(t => {
        if (Number(t) > 0) sugerencias.push(Number(t));
      });
    }
    
    setTarifasSugeridasActuales(sugerencias);
    setDetalleDraft({
      tipoConvenioId: id,
      tipoConvenioNombre: nombreTarifario, 
      tarifaSugeridaSeleccionada: sugerencias.length > 0 ? String(sugerencias[0]) : '', 
      tarifa: sugerencias.length > 0 ? sugerencias[0] : 0
    });
  };

  const handleAgregarDetalle = () => {
    if (!detalleDraft.tipoConvenioId || detalleDraft.tarifa <= 0) return alert("Complete los datos del detalle (Concepto y Tarifa Final).");
    
    // ✅ NUEVO (V00120): moneda del concepto (por defecto la del convenio) y
    //   modo EDICIÓN (si _editandoId existe, se reemplaza en sitio).
    const monedaDet = (detalleDraft as any).moneda || formData.monedaNombre || 'Pesos';
    if ((detalleDraft as any)._editandoId) {
      setDetalles(prev => prev.map(d => d.id === (detalleDraft as any)._editandoId
        ? { ...d, tipoConvenioId: detalleDraft.tipoConvenioId, tipoConvenioNombre: detalleDraft.tipoConvenioNombre, tarifa: detalleDraft.tarifa, moneda: monedaDet, _editado: !d._isNew ? true : d._editado }
        : d));
      setDetalleDraft({ tipoConvenioId: '', tipoConvenioNombre: '', tarifaSugeridaSeleccionada: '', tarifa: 0 });
      setMostrandoDetalleForm(false);
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
    
    setDetalles([...detalles, nuevoDetalle]);
    setDetalleDraft({ tipoConvenioId: '', tipoConvenioNombre: '', tarifaSugeridaSeleccionada: '', tarifa: 0 });
    setMostrandoDetalleForm(false);
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
            moneda: det.moneda || formData.monedaNombre || '' // ✅ NUEVO (V00120)
          });
        } else {
          const detRef = doc(db, 'convenios_proveedores_detalles', det.id!);
          batch.update(detRef, { 
            tarifa: Number(det.tarifa),
            tipoConvenioId: det.tipoConvenioId,
            tipoConvenioNombre: det.tipoConvenioNombre,
            moneda: det.moneda || formData.monedaNombre || '', // ✅ NUEVO (V00120) 
            convenioId: masterId // Garantizado en actualizaciones
          });
        }
      });

      detallesEliminados.forEach(delId => batch.delete(doc(db, 'convenios_proveedores_detalles', delId)));
      await batch.commit();
      onClose();
    } catch (error) { 
      console.error(error);
      alert('Error al guardar convenio transaccional.'); 
    } finally { setCargando(false); }
  };

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card fcp-x5">
        <div className="form-header">
          <h2>{initialData ? `Editar Convenio` : 'Nuevo Convenio de Proveedor'}</h2>
          <div className="header-actions">
            {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '24px', maxHeight: '75vh', overflowY: 'auto' }}>
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
              <div className="form-group"><label className="form-label">Crédito (Días)</label><input type="number" className="form-control" readOnly title="Se toma automáticamente de la empresa (Días de Crédito)" style={{ opacity: 0.85, cursor: 'not-allowed' }} value={formData.credito} onChange={(e) => setFormData({...formData, credito: parseInt(e.target.value) || 0})} required /></div>
            </div>

            <div className="fcp-x8">
              <div className="fcp-x9">
                <h3 className="fcp-x10">Lista de Tarifas</h3>
                <button type="button" className="btn btn-outline" onClick={() => setMostrandoDetalleForm(!mostrandoDetalleForm)}>{mostrandoDetalleForm ? 'Cancelar' : '+ Agregar Concepto'}</button>
              </div>

              {mostrandoDetalleForm && (
                <div className="fcp-x11">
                  <div className="form-grid fcp-x12">
                    <div className="form-group">
                      <label className="form-label">Concepto (Tipo de Operación)</label>
                      <select className="form-control" value={detalleDraft.tipoConvenioId} onChange={handleTipoConvenioChange}>
                        <option value="">Seleccione un concepto...</option>
                        {tarifarios.map(t => <option key={t.id} value={t.id}>{t.tipo_operacionNombre || t.tipo_operacion || t.descripcion}</option>)}
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Tarifa Sugerida</label>
                      <select className="form-control" value={detalleDraft.tarifaSugeridaSeleccionada} onChange={(e) => setDetalleDraft({...detalleDraft, tarifaSugeridaSeleccionada: e.target.value, tarifa: parseFloat(e.target.value) || 0})}>
                        <option value="">Ver...</option>
                        {tarifasSugeridasActuales.map((tar, i) => <option key={i} value={tar}>${tar}</option>)}
                      </select>
                    </div>
                    <div className="form-group"><label className="form-label">Tarifa Final *</label><input type="number" step="0.01" className="form-control" value={detalleDraft.tarifa} onChange={(e) => setDetalleDraft({...detalleDraft, tarifa: parseFloat(e.target.value) || 0})} /></div>
                    {/* ✅ NUEVO (V00120): moneda del concepto, editable */}
                    <div className="form-group">
                      <label className="form-label">Moneda</label>
                      <select className="form-control" value={(detalleDraft as any).moneda || formData.monedaNombre || 'Pesos'} onChange={(e) => setDetalleDraft({ ...detalleDraft, moneda: e.target.value } as any)}>
                        {/* ✅ V00123: opciones desde el catálogo de Monedas */}{(monedas.length > 0 ? monedas.map((m: any) => String(m.moneda || '')).filter(Boolean) : ['Pesos', 'Dólares']).map((m: string) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-primary fcp-x13" onClick={handleAgregarDetalle}>{(detalleDraft as any)._editandoId ? 'Actualizar' : 'Guardar Concepto'}</button>
                  </div>
                </div>
              )}

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
                        <tr className="fcp-x22" key={det.id} onMouseEnter={(e:any) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e:any) => e.currentTarget.style.backgroundColor = '#0d1117'}>
                          <td className="fcp-x23">{index + 1}</td>
                          <td className="fcp-x24">{det.tipoConvenioNombre}</td>
                          <td className="fcp-x25">{/* ✅ NUEVO (V00121): edición en línea (varios de golpe); se guarda todo con "Guardar Convenio" */}<input type="number" step="0.01" className="form-control" style={{ width: '110px', padding: '4px 8px' }} value={det.tarifa} onClick={(e) => e.stopPropagation()} onChange={(e) => { const v = parseFloat(e.target.value) || 0; setDetalles(prev => prev.map(d => d.id === det.id ? { ...d, tarifa: v } : d)); }} /></td>
                          <td><select className="form-control" style={{ width: '100px', padding: '4px 6px' }} value={det.moneda || formData.monedaNombre || 'Pesos'} onClick={(e) => e.stopPropagation()} onChange={(e) => { const v = e.target.value; setDetalles(prev => prev.map(d => d.id === det.id ? { ...d, moneda: v } : d)); }}>{/* ✅ V00123: opciones desde el catálogo de Monedas */}{(monedas.length > 0 ? monedas.map((m: any) => String(m.moneda || '')).filter(Boolean) : ['Pesos', 'Dólares']).map((m: string) => <option key={m} value={m}>{m}</option>)}</select></td>
                          <td className="fcp-x26">
                            {/* ✅ NUEVO (V00120): editar concepto */}
                            <button type="button" title="Editar este concepto" style={{ background: 'none', border: '1px solid #58a6ff', color: '#58a6ff', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', marginRight: '6px' }} onClick={() => { setDetalleDraft({ tipoConvenioId: det.tipoConvenioId, tipoConvenioNombre: det.tipoConvenioNombre, tarifaSugeridaSeleccionada: '', tarifa: Number(det.tarifa) || 0, moneda: det.moneda || formData.monedaNombre || 'Pesos', _editandoId: det.id } as any); setMostrandoDetalleForm(true); }}>✎</button>
                            <button className="fcp-x27" 
                              type="button" 
                              onClick={() => handleEliminarDetalle(det.id!, det._isNew)}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                              ✕ Quitar
                            </button>
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
  );
};
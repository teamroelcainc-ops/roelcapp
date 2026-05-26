// src/features/conveniosProveedores/components/FormularioConvenioProveedor.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import type { ConvenioProveedorRecord, ConvenioProveedorDetalleRecord } from '../../../types/convenioProveedor';

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
    <div style={{ position: 'relative', width: '100%' }}>
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
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto',
          backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', marginTop: '4px', zIndex: 1000, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)', padding: 0, listStyle: 'none'
        }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map(opt => (
              <li 
                key={opt.id} 
                // CORRECCIÓN 2: onMouseDown evita que se dispare el onBlur del input antes de seleccionar
                onMouseDown={(e) => { 
                  e.preventDefault(); 
                  onChange(opt.id, opt.label); 
                  setSearchTerm(opt.label); 
                  setIsOpen(false); 
                }}
                style={{ padding: '8px 12px', cursor: 'pointer', color: '#c9d1d9', borderBottom: '1px solid #21262d', fontSize: '0.85rem' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
                {opt.label}
              </li>
            ))
          ) : (
            <li style={{ padding: '8px 12px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>No hay coincidencias</li>
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
  const todayISO = new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState<ConvenioProveedorRecord>({
    numeroConvenio: '',
    proveedorId: '',
    proveedorNombre: '',
    monedaId: '',
    monedaNombre: '',
    credito: 0,
    fechaConvenio: todayISO,
    fechaVencimiento: todayISO
  });

  const [detalles, setDetalles] = useState<(ConvenioProveedorDetalleRecord & { _isNew?: boolean })[]>([]);
  const [detallesEliminados, setDetallesEliminados] = useState<string[]>([]); 
  const [proveedores, setProveedores] = useState<any[]>([]);
  const [monedas, setMonedas] = useState<any[]>([]);
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
              tarifa: data.tarifa || 0
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
    
    const nuevoDetalle = {
      id: `local_${Date.now()}`, 
      tipoConvenioId: detalleDraft.tipoConvenioId,
      tipoConvenioNombre: detalleDraft.tipoConvenioNombre, 
      tarifa: detalleDraft.tarifa,
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
            tarifa: Number(det.tarifa)
          });
        } else {
          const detRef = doc(db, 'convenios_proveedores_detalles', det.id!);
          batch.update(detRef, { 
            tarifa: Number(det.tarifa), 
            tipoConvenioId: det.tipoConvenioId, 
            tipoConvenioNombre: det.tipoConvenioNombre,
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
      <div className="form-card" style={{ maxWidth: '850px' }}>
        <div className="form-header">
          <h2>{initialData ? `Editar Convenio` : 'Nuevo Convenio de Proveedor'}</h2>
          <div className="header-actions">
            {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '24px', maxHeight: '75vh', overflowY: 'auto' }}>
          <form onSubmit={handleSubmit}>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div className="form-group">
                <label className="form-label orange"># de Convenio</label>
                <input type="text" className="form-control" value={formData.numeroConvenio} disabled style={{ backgroundColor: '#21262d' }} />
              </div>
              <div className="form-group">
                <label className="form-label">Proveedor *</label>
                <SearchableSelect 
                  options={proveedores.map(p => ({ id: p.id, label: p.nombre || p.empresa || 'S/N' }))} 
                  value={formData.proveedorId} 
                  onChange={(id, label) => setFormData(prev => ({ ...prev, proveedorId: id, proveedorNombre: label }))} 
                  required 
                />
              </div>
              <div className="form-group"><label className="form-label">Fecha Convenio</label><input type="date" className="form-control" value={formData.fechaConvenio} onChange={(e) => setFormData({...formData, fechaConvenio: e.target.value})} required /></div>
              <div className="form-group"><label className="form-label">Fecha Vencimiento</label><input type="date" className="form-control" value={formData.fechaVencimiento} onChange={(e) => setFormData({...formData, fechaVencimiento: e.target.value})} required /></div>
              <div className="form-group">
                <label className="form-label">Moneda</label>
                <select className="form-control" value={formData.monedaId} onChange={(e) => {
                  const m = monedas.find(x => x.id === e.target.value);
                  setFormData({...formData, monedaId: e.target.value, monedaNombre: m?.moneda || ''});
                }} required>
                  <option value="">Seleccione...</option>
                  {monedas.map(mon => <option key={mon.id} value={mon.id}>{mon.moneda}</option>)}
                </select>
              </div>
              <div className="form-group"><label className="form-label">Crédito (Días)</label><input type="number" className="form-control" value={formData.credito} onChange={(e) => setFormData({...formData, credito: parseInt(e.target.value) || 0})} required /></div>
            </div>

            <div style={{ marginTop: '32px', border: '1px solid #30363d', borderRadius: '8px', padding: '24px', backgroundColor: '#0d1117' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '1rem', color: '#f0f6fc', margin: 0 }}>Lista de Tarifas</h3>
                <button type="button" className="btn btn-outline" onClick={() => setMostrandoDetalleForm(!mostrandoDetalleForm)}>{mostrandoDetalleForm ? 'Cancelar' : '+ Agregar Concepto'}</button>
              </div>

              {mostrandoDetalleForm && (
                <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', marginBottom: '24px', border: '1px solid #30363d' }}>
                  <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', gap: '16px', alignItems: 'end' }}>
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
                    <button type="button" className="btn btn-primary" style={{ height: '38px', backgroundColor: '#D84315' }} onClick={handleAgregarDetalle}>Guardar Concepto</button>
                  </div>
                </div>
              )}

              <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflow: 'hidden' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ backgroundColor: '#1f2937', color: '#8b949e' }}>
                    <tr>
                      <th style={{ padding: '12px', textAlign: 'center', width: '50px' }}>#</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>CONCEPTO</th>
                      <th style={{ padding: '12px', textAlign: 'right', width: '150px' }}>TARIFA</th>
                      <th style={{ padding: '12px', textAlign: 'center', width: '100px' }}>ACCIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalles.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: '#8b949e' }}>No hay conceptos agregados a este convenio.</td></tr>
                    ) : (
                      detalles.map((det, index) => (
                        <tr key={det.id} style={{ borderTop: '1px solid #30363d', backgroundColor: '#0d1117' }} onMouseEnter={(e:any) => e.currentTarget.style.backgroundColor = '#161b22'} onMouseLeave={(e:any) => e.currentTarget.style.backgroundColor = '#0d1117'}>
                          <td style={{ padding: '12px', textAlign: 'center', color: '#8b949e' }}>{index + 1}</td>
                          <td style={{ padding: '12px', color: '#c9d1d9', fontWeight: '500' }}>{det.tipoConvenioNombre}</td>
                          <td style={{ padding: '12px', color: '#3fb950', fontWeight: 'bold', textAlign: 'right' }}>${` ${Number(det.tarifa).toFixed(2)}`}</td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button 
                              type="button" 
                              onClick={() => handleEliminarDetalle(det.id!, det._isNew)} 
                              style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', cursor: 'pointer', padding: '4px 12px', fontSize: '0.8rem', transition: 'all 0.2s' }}
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

            <div className="form-actions" style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', gap: '16px', padding: '24px', backgroundColor: '#161b22', borderRadius: '8px', borderTop: '1px solid #30363d' }}>
              <button type="button" onClick={onClose} className="btn btn-outline" style={{ padding: '10px 24px', borderRadius: '6px' }}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargando} style={{ backgroundColor: '#238636', padding: '10px 24px', borderRadius: '6px', border: 'none', fontWeight: 'bold' }}>
                {cargando ? 'Guardando Convenio...' : 'Guardar Convenio Maestro'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
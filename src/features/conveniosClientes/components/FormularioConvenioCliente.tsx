// src/features/conveniosClientes/components/FormularioConvenioCliente.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import type { ConvenioClienteRecord, ConvenioDetalleRecord } from '../../../types/convenioCliente';

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

  useEffect(() => {
    setSearchTerm(selectedLabel);
  }, [value, selectedLabel]);

  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input
        type="text"
        className="form-control"
        placeholder={placeholder}
        value={isOpen ? searchTerm : selectedLabel}
        onChange={(e) => {
          setSearchTerm(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => {
          setSearchTerm(''); 
          setIsOpen(true);
        }}
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
          backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', marginTop: '4px', padding: '0', listStyle: 'none', zIndex: 1000, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
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
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {opt.label}
              </li>
            ))
          ) : (
            <li style={{ padding: '8px 12px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>No se encontraron coincidencias</li>
          )}
        </ul>
      )}
    </div>
  );
};

// =========================================
// SUB-COMPONENTE: MODAL DE CONFIGURACIÓN
// =========================================
const FieldConfigModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  fields: { name: string; label: string }[];
  requiredFields: string[];
  toggleRequired: (f: string) => void;
}> = ({ isOpen, onClose, fields, requiredFields, toggleRequired }) => {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 2000 }}>
      <div className="form-card" style={{ maxWidth: '400px', borderRadius: '16px', border: '1px solid #444', backgroundColor: '#0d1117' }}>
        <div className="form-header" style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', marginBottom: '0' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.1rem', margin: 0, color: '#f0f6fc' }}>⚙️ Campos Obligatorios</h3>
          <button className="close-x" onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>
        <div style={{ padding: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {fields.map(f => (
              <label key={f.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', fontSize: '0.95rem', color: '#c9d1d9' }}>
                <input 
                  type="checkbox" 
                  checked={requiredFields.includes(f.name)} 
                  onChange={() => toggleRequired(f.name)} 
                  style={{ width: '18px', height: '18px', accentColor: '#D84315' }}
                />
                {f.label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: '30px' }}>
            <button type="button" className="btn-primary" onClick={onClose} style={{ width: '100%', padding: '10px' }}>Listo</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// =========================================
// COMPONENTE PRINCIPAL
// =========================================
interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: ConvenioClienteRecord | null;
  registrosExistentes: ConvenioClienteRecord[]; 
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioConvenioCliente = ({ estado, initialData, registrosExistentes, onClose, onMinimize, onRestore }: FormProps) => {
  const todayISO = new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState<ConvenioClienteRecord>({
    numeroConvenio: '',
    clienteId: '',
    clienteNombre: '',
    monedaId: '',
    monedaNombre: '',
    credito: 0,
    fechaConvenio: todayISO,
    fechaVencimiento: todayISO
  });

  const [detalles, setDetalles] = useState<(ConvenioDetalleRecord & { _isNew?: boolean })[]>([]);
  const [detallesEliminados, setDetallesEliminados] = useState<string[]>([]); 
  const [clientes, setClientes] = useState<any[]>([]);
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

  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  
  const configuracionCampos = [
    { name: 'clienteId', label: 'Cliente' },
    { name: 'fechaConvenio', label: 'Fecha del Convenio' },
    { name: 'fechaVencimiento', label: 'Fecha de Vencimiento' },
    { name: 'monedaId', label: 'Moneda' },
    { name: 'credito', label: 'Crédito (Días)' }
  ];

  // 1. LÓGICA DE CAMPOS OBLIGATORIOS
  useEffect(() => {
    const savedConfig = localStorage.getItem('formConfig_convenioCliente');
    if (savedConfig) setRequiredFields(JSON.parse(savedConfig));
    else setRequiredFields(['clienteId', 'fechaConvenio', 'fechaVencimiento', 'monedaId', 'credito']);
  }, []);

  const toggleRequired = (fieldName: string) => {
    const newRequired = requiredFields.includes(fieldName) ? requiredFields.filter(f => f !== fieldName) : [...requiredFields, fieldName];
    setRequiredFields(newRequired);
    localStorage.setItem('formConfig_convenioCliente', JSON.stringify(newRequired));
  };

  const isRequired = (fieldName: string) => requiredFields.includes(fieldName);

  // 2. CARGA DE CATÁLOGOS INICIALES
  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const empSnapshot = await getDocs(collection(db, 'empresas'));
        const todasEmpresas = empSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // CORRECCIÓN 1: Selección directa por status y 7eec9cbb
        setClientes(todasEmpresas.filter((emp: any) => {
          const isActiva = emp.status === 'Activa';
          const hasTipo = Array.isArray(emp.tiposEmpresa) 
            ? emp.tiposEmpresa.includes('7eec9cbb') 
            : emp.tiposEmpresa === '7eec9cbb';
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

  // 3. CARGA DE DATOS Y CRUCE DE NOMBRES (JOIN)
  useEffect(() => {
    if (initialData && initialData.id && tarifarios.length > 0) {
      setFormData(initialData);
      
      const cargarDetalles = async () => {
        try {
          const q = query(collection(db, 'convenios_clientes_detalles'), where('convenioId', '==', initialData.id));
          const snap = await getDocs(q);
          
          const detallesBD = snap.docs.map(docSnap => {
            const data = docSnap.data();
            const refMaster = tarifarios.find(t => t.id === data.tipoConvenioId);
            return {
              id: docSnap.id,
              convenioId: data.convenioId,
              tipoConvenioId: data.tipoConvenioId,
              tipoConvenioNombre: data.tipoConvenioNombre || (refMaster ? refMaster.descripcion : 'No identificado'),
              tarifa: data.tarifa || 0
            } as ConvenioDetalleRecord;
          });
          
          setDetalles(detallesBD);
        } catch (error) { console.error("Error cargando detalles:", error); }
      };
      cargarDetalles();
    } else if (!initialData) {
      setFormData(prev => ({ ...prev, numeroConvenio: generarSiguienteConvenio() }));
      setDetalles([]);
    }
  }, [initialData, registrosExistentes, tarifarios]); 

  const generarSiguienteConvenio = () => {
    if (registrosExistentes.length === 0) return 'CONV-001';
    const numeros = registrosExistentes.map(reg => parseInt(reg.numeroConvenio.replace('CONV-', ''), 10) || 0);
    return `CONV-${String(Math.max(...numeros) + 1).padStart(3, '0')}`;
  };

  const handleTipoConvenioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    const tarifario = tarifarios.find(t => t.id === id);
    const nombreTarifario = tarifario ? (tarifario.descripcion || 'Desconocido') : '';
    
    let sugerencias: number[] = [];
    if (tarifario) {
      [tarifario.tarifa_cliente_1, tarifario.tarifa_cliente_2, tarifario.tarifa_cliente_3].forEach(t => {
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
    if (!detalleDraft.tipoConvenioId || detalleDraft.tarifa <= 0) {
      alert("Seleccione un tipo de convenio y tarifa > 0.");
      return;
    }

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

  const handleEliminarDetalle = (detalleId: string, isNew?: boolean) => {
    setDetalles(prev => prev.filter(d => d.id !== detalleId));
    if (!isNew) setDetallesEliminados(prev => [...prev, detalleId]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRequired('clienteId') && !formData.clienteId) return alert("Seleccione un cliente.");
    
    setCargando(true);
    try {
      const batch = writeBatch(db);
      
      // CORRECCIÓN 3: Aseguramos la existencia de la llave primaria para los detalles
      let masterId = initialData?.id || (formData as any).id;
      const docRefMaestro = masterId ? doc(db, 'convenios_clientes', masterId) : doc(collection(db, 'convenios_clientes'));
      
      if (!masterId) {
        masterId = docRefMaestro.id;
        const { id, ...dataToSave } = formData as any; // Evita inyectar id undefined al crear
        batch.set(docRefMaestro, { ...dataToSave, numeroConvenio: generarSiguienteConvenio() });
      } else {
        const { id, ...dataToSave } = formData as any;
        batch.update(docRefMaestro, { ...dataToSave });
      }

      detalles.forEach(det => {
        if (det._isNew) {
          const detRef = doc(collection(db, 'convenios_clientes_detalles'));
          batch.set(detRef, {
            convenioId: masterId, // Relación fuerte a llave primaria
            tipoConvenioId: det.tipoConvenioId,
            tipoConvenioNombre: det.tipoConvenioNombre,
            tarifa: Number(det.tarifa)
          });
        } else {
          const detRef = doc(db, 'convenios_clientes_detalles', det.id!);
          batch.update(detRef, { 
            tarifa: Number(det.tarifa),
            convenioId: masterId // Garantizamos que la relación se mantenga en DB
          });
        }
      });

      detallesEliminados.forEach(delId => batch.delete(doc(db, 'convenios_clientes_detalles', delId)));

      await batch.commit();
      onClose();
    } catch (error) {
      console.error("Error batch:", error);
      alert('Error al guardar. Revisa tu conexión.');
    } finally { setCargando(false); }
  };

  return (
    <>
      <FieldConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} fields={configuracionCampos} requiredFields={requiredFields} toggleRequired={toggleRequired} />

      <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
        <div className="form-card" style={{ maxWidth: '850px' }}>
          <div className="form-header">
            <h2>{initialData ? `Editar Convenio` : 'Nuevo Convenio de Cliente'}</h2>
            <div className="header-actions">
              <button type="button" onClick={() => setIsConfigOpen(true)} className="btn-window" style={{ background: 'none' }}>⚙️</button>
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
                  <label className="form-label">Cliente *</label>
                  <SearchableSelect 
                    options={clientes.map(cli => ({ id: cli.id, label: cli.nombre || cli.empresa || 'S/N' }))} 
                    value={formData.clienteId} 
                    onChange={(id, label) => setFormData(prev => ({ ...prev, clienteId: id, clienteNombre: label }))} 
                    required={isRequired('clienteId')} 
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha del Convenio *</label>
                  <input type="date" className="form-control" value={formData.fechaConvenio} onChange={(e) => setFormData({...formData, fechaConvenio: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Fecha de Vencimiento *</label>
                  <input type="date" className="form-control" value={formData.fechaVencimiento} onChange={(e) => setFormData({...formData, fechaVencimiento: e.target.value})} required />
                </div>
                <div className="form-group">
                  <label className="form-label">Moneda *</label>
                  <select className="form-control" value={formData.monedaId} onChange={(e) => {
                    const m = monedas.find(x => x.id === e.target.value);
                    setFormData({...formData, monedaId: e.target.value, monedaNombre: m?.moneda || ''});
                  }} required>
                    <option value="">Seleccione...</option>
                    {monedas.map(mon => <option key={mon.id} value={mon.id}>{mon.moneda}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Crédito (Días) *</label>
                  <input type="number" className="form-control" value={formData.credito} onChange={(e) => setFormData({...formData, credito: parseInt(e.target.value) || 0})} required />
                </div>
              </div>

              {/* TABLA DE DETALLES */}
              <div style={{ marginTop: '32px', border: '1px solid #30363d', borderRadius: '8px', padding: '24px', backgroundColor: '#0d1117' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 style={{ fontSize: '1rem', color: '#f0f6fc', margin: 0 }}>Lista de Detalles</h3>
                  <button type="button" className="btn btn-outline" onClick={() => setMostrandoDetalleForm(!mostrandoDetalleForm)}>
                    {mostrandoDetalleForm ? 'Cancelar' : '+ Agregar Detalle'}
                  </button>
                </div>

                {mostrandoDetalleForm && (
                  <div style={{ backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', marginBottom: '24px' }}>
                    <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto', gap: '16px', alignItems: 'end' }}>
                      <div className="form-group">
                        <label className="form-label">Tipo de Convenio (Referencia)</label>
                        <select className="form-control" value={detalleDraft.tipoConvenioId} onChange={handleTipoConvenioChange}>
                          <option value="">Seleccione...</option>
                          {tarifarios.map(t => <option key={t.id} value={t.id}>{t.descripcion}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Sugerida</label>
                        <select className="form-control" value={detalleDraft.tarifaSugeridaSeleccionada} onChange={(e) => setDetalleDraft({...detalleDraft, tarifaSugeridaSeleccionada: e.target.value, tarifa: parseFloat(e.target.value) || 0})}>
                          <option value="">Ver...</option>
                          {tarifasSugeridasActuales.map((tar, i) => <option key={i} value={tar}>${tar}</option>)}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Tarifa Final *</label>
                        <input type="number" step="0.01" className="form-control" value={detalleDraft.tarifa} onChange={(e) => setDetalleDraft({...detalleDraft, tarifa: parseFloat(e.target.value) || 0})} />
                      </div>
                      <button type="button" className="btn btn-primary" style={{ height: '38px' }} onClick={handleAgregarDetalle}>Guardar</button>
                    </div>
                  </div>
                )}

                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ backgroundColor: '#161b22', color: '#8b949e' }}>
                    <tr>
                      <th style={{ padding: '12px' }}>#</th>
                      <th style={{ padding: '12px' }}>TIPO DE CONVENIO</th>
                      <th style={{ padding: '12px' }}>TARIFA</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>ACCIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalles.length === 0 ? (
                      <tr><td colSpan={4} style={{ textAlign: 'center', padding: '24px', color: '#8b949e' }}>No hay detalles agregados.</td></tr>
                    ) : (
                      detalles.map((det, index) => (
                        <tr key={det.id} style={{ borderTop: '1px solid #30363d' }}>
                          <td style={{ padding: '12px', color: '#8b949e' }}>{index + 1}</td>
                          <td style={{ padding: '12px', color: '#c9d1d9' }}>{det.tipoConvenioNombre}</td>
                          <td style={{ padding: '12px', color: '#f0f6fc', fontWeight: 'bold' }}>${Number(det.tarifa).toFixed(2)}</td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button type="button" onClick={() => handleEliminarDetalle(det.id!, det._isNew)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="form-actions" style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', gap: '16px' }}>
                <button type="button" onClick={onClose} className="btn btn-outline">Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={cargando}>{cargando ? 'Guardando...' : 'Guardar Convenio Maestro'}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </>
  );
};
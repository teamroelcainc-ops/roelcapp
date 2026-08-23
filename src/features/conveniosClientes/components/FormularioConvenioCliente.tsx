// src/features/conveniosClientes/components/FormularioConvenioCliente.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, getDoc, doc, writeBatch, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase'; 
import type { ConvenioClienteRecord, ConvenioDetalleRecord } from '../../../types/convenioCliente';
import './FormularioConvenioCliente.css';
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

  useEffect(() => {
    setSearchTerm(selectedLabel);
  }, [value, selectedLabel]);

  const filteredOptions = options.filter(opt => 
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fcc-x1">
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
        <ul className="fcc-x2">
          {filteredOptions.length > 0 ? (
            filteredOptions.map(opt => (
              <li className="fcc-x3"
                key={opt.id}
                // CORRECCIÓN 2: onMouseDown evita que se dispare el onBlur del input antes de seleccionar
                onMouseDown={(e) => { 
                  e.preventDefault(); 
                  onChange(opt.id, opt.label); 
                  setSearchTerm(opt.label); 
                  setIsOpen(false); 
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                {opt.label}
              </li>
            ))
          ) : (
            <li className="fcc-x4">No se encontraron coincidencias</li>
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
    <div className="modal-overlay fcc-x5">
      <div className="form-card fcc-x6">
        <div className="form-header fcc-x7">
          <h3 className="fcc-x8">⚙️ Campos Obligatorios</h3>
          <button className="close-x fcc-x9" onClick={onClose}>✕</button>
        </div>
        <div className="fcc-x10">
          <div className="fcc-x11">
            {fields.map(f => (
              <label className="fcc-x12" key={f.name}>
                <input className="fcc-x13" 
                  type="checkbox" 
                  checked={requiredFields.includes(f.name)} 
                  onChange={() => toggleRequired(f.name)}
                />
                {f.label}
              </label>
            ))}
          </div>
          <div className="fcc-x14">
            <button type="button" className="btn-primary fcc-x15" onClick={onClose}>Listo</button>
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
  const todayISO = hoyLocalISO();

  const [formData, setFormData] = useState<ConvenioClienteRecord>({
    numeroConvenio: '',
    clienteId: '',
    clienteNombre: '',
    monedaId: '',
    monedaNombre: '',
    credito: 0,
    fechaConvenio: todayISO,
    fechaVencimiento: `${new Date().getFullYear()}-12-31` // ✅ por defecto 31 de diciembre (editable)
  });

  const [detalles, setDetalles] = useState<(ConvenioDetalleRecord & { _isNew?: boolean })[]>([]);
  const [detallesEliminados, setDetallesEliminados] = useState<string[]>([]); 
  const [clientes, setClientes] = useState<any[]>([]);
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

  // ✅ NUEVO (V00118): autocuración — si ya hay cliente elegido pero la
  //   moneda del convenio quedó vacía o no coincide con el catálogo (caso de
  //   la captura: empresa con moneda en texto legado), se vuelve a jalar de la
  //   empresa automáticamente.
  useEffect(() => {
    const idEnt = String(formData.clienteId || '');
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
  }, [formData.clienteId, monedas]);
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

  // ✅ Ahora recibe el id directo (lo llama el SearchableSelect del detalle).
  const handleTipoConvenioChange = (id: string) => {
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
        <div className="form-card fcc-x16">
          <div className="form-header">
            <h2>{initialData ? `Editar Convenio` : 'Nuevo Convenio de Cliente'}</h2>
            <div className="header-actions">
              <button type="button" onClick={() => setIsConfigOpen(true)} className="btn-window fcc-x17">⚙️</button>
              {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
              <button type="button" onClick={onClose} className="btn-window close">✕</button>
            </div>
          </div>

          <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '24px', maxHeight: '75vh', overflowY: 'auto' }}>
            <form onSubmit={handleSubmit}>
              <div className="form-grid fcc-x18">
                <div className="form-group">
                  <label className="form-label orange"># de Convenio</label>
                  <input type="text" className="form-control fcc-x19" value={formData.numeroConvenio} disabled />
                </div>
                <div className="form-group">
                  <label className="form-label">Cliente *</label>
                  <SearchableSelect 
                    options={clientes.map(cli => ({ id: cli.id, label: cli.nombre || cli.empresa || 'S/N' }))} 
                    value={formData.clienteId} 
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
                      setFormData(prev => ({ ...prev, clienteId: id, clienteNombre: label, monedaId: monId || prev.monedaId, monedaNombre: monNom || prev.monedaNombre, credito: cred }));
                    }} 
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
                  <select className="form-control" disabled title="Se toma automáticamente de la empresa" style={{ opacity: 0.85, cursor: 'not-allowed' }} value={formData.monedaId} onChange={(e) => {
                    const m = monedas.find(x => x.id === e.target.value);
                    setFormData({...formData, monedaId: e.target.value, monedaNombre: m?.moneda || ''});
                  }} required>
                    <option value="">Seleccione...</option>
                    {monedas.map(mon => <option key={mon.id} value={mon.id}>{mon.moneda}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Crédito (Días) *</label>
                  <input type="number" className="form-control" readOnly title="Se toma automáticamente de la empresa (Días de Crédito)" style={{ opacity: 0.85, cursor: 'not-allowed' }} value={formData.credito} onChange={(e) => setFormData({...formData, credito: parseInt(e.target.value) || 0})} required />
                </div>
              </div>

              {/* TABLA DE DETALLES */}
              <div className="fcc-x20">
                <div className="fcc-x21">
                  <h3 className="fcc-x22">Lista de Detalles</h3>
                  <button type="button" className="btn btn-outline" onClick={() => setMostrandoDetalleForm(!mostrandoDetalleForm)}>
                    {mostrandoDetalleForm ? 'Cancelar' : '+ Agregar Detalle'}
                  </button>
                </div>

                {mostrandoDetalleForm && (
                  <div className="fcc-x23">
                    <div className="form-grid fcc-x24">
                      <div className="form-group">
                        <label className="form-label">Tipo de Convenio (Referencia)</label>
                        {/* Buscador en lugar de lista desplegable */}
                        <SearchableSelect
                          options={tarifarios.map(t => ({ id: t.id, label: t.descripcion || 'Sin descripción' }))}
                          value={detalleDraft.tipoConvenioId}
                          onChange={(id) => handleTipoConvenioChange(id)}
                          placeholder="Buscar tipo de convenio..."
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Sugerida</label>
                        {/* Buscador en lugar de lista desplegable */}
                        <SearchableSelect
                          options={tarifasSugeridasActuales.map(tar => ({ id: String(tar), label: `$${tar}` }))}
                          value={detalleDraft.tarifaSugeridaSeleccionada}
                          onChange={(id) => setDetalleDraft({ ...detalleDraft, tarifaSugeridaSeleccionada: id, tarifa: parseFloat(id) || 0 })}
                          placeholder={tarifasSugeridasActuales.length > 0 ? 'Ver sugeridas...' : 'Sin sugeridas'}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Tarifa Final *</label>
                        <input type="number" step="0.01" className="form-control" value={detalleDraft.tarifa} onChange={(e) => setDetalleDraft({...detalleDraft, tarifa: parseFloat(e.target.value) || 0})} />
                      </div>
                      <button type="button" className="btn btn-primary fcc-x25" onClick={handleAgregarDetalle}>Guardar</button>
                    </div>
                  </div>
                )}

                <table className="data-table fcc-x26">
                  <thead className="fcc-x27">
                    <tr>
                      <th className="fcc-x28">#</th>
                      <th className="fcc-x28">TIPO DE CONVENIO</th>
                      <th className="fcc-x28">TARIFA</th>
                      <th className="fcc-x29">ACCIÓN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalles.length === 0 ? (
                      <tr><td className="fcc-x30" colSpan={4}>No hay detalles agregados.</td></tr>
                    ) : (
                      detalles.map((det, index) => (
                        <tr className="fcc-x31" key={det.id}>
                          <td className="fcc-x32">{index + 1}</td>
                          <td className="fcc-x33">{det.tipoConvenioNombre}</td>
                          <td className="fcc-x34">${Number(det.tarifa).toFixed(2)}</td>
                          <td className="fcc-x29">
                            <button className="fcc-x35" type="button" onClick={() => handleEliminarDetalle(det.id!, det._isNew)}>✕</button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="form-actions fcc-x36">
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
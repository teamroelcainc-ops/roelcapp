// src/features/empleados/components/EmployeeForm.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { guardarEmpleadoConTransaccion } from '../../../services/employeeService';
import { FormularioDireccion } from '../../direcciones/components/FormularioDireccion';
import type { Employee } from '../../../types/empleado';

// =========================================
// SUB-COMPONENTE: SELECTOR CON BUSCADOR
// =========================================
const SearchableSelect: React.FC<{ options: { id: string, label: string }[]; value: string; onChange: (id: string, label: string) => void; placeholder?: string; required?: boolean; }> = ({ options, value, onChange, placeholder = "Buscar...", required }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const selectedLabel = options.find(o => o.id === value)?.label || '';

  useEffect(() => { setSearchTerm(selectedLabel); }, [value, selectedLabel]);
  const filteredOptions = options.filter(opt => opt.label.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <input type="text" className="form-control" placeholder={placeholder} value={isOpen ? searchTerm : selectedLabel} onChange={(e) => { setSearchTerm(e.target.value); setIsOpen(true); }} onFocus={() => { setSearchTerm(''); setIsOpen(true); }} onBlur={() => { setTimeout(() => setIsOpen(false), 200); setSearchTerm(selectedLabel); }} required={required && !value} style={{ backgroundColor: '#010409', border: isOpen ? '1px solid #3b82f6' : '1px solid #30363d', color: '#c9d1d9', width: '100%' }} />
      {isOpen && (
        <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', marginTop: '4px', padding: 0, listStyle: 'none', zIndex: 1000 }}>
          {filteredOptions.length > 0 ? filteredOptions.map(opt => (
            <li key={opt.id} onClick={() => { onChange(opt.id, opt.label); setSearchTerm(opt.label); setIsOpen(false); }} style={{ padding: '8px 12px', cursor: 'pointer', color: '#c9d1d9', borderBottom: '1px solid #21262d', fontSize: '0.85rem' }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>{opt.label}</li>
          )) : <li style={{ padding: '8px 12px', color: '#8b949e', fontSize: '0.85rem', textAlign: 'center' }}>Sin resultados</li>}
        </ul>
      )}
    </div>
  );
};

// =========================================
// SUB-COMPONENTE: MULTI-SELECT (Para Operaciones)
// =========================================
const MultiSelect: React.FC<{ options: { id: string, label: string }[]; selectedIds: string[]; onChange: (ids: string[]) => void; }> = ({ options, selectedIds, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter(selId => selId !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div onClick={() => setIsOpen(!isOpen)} style={{ padding: '8px 12px', backgroundColor: '#010409', border: isOpen ? '1px solid #3b82f6' : '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer', minHeight: '38px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
        {selectedIds.length === 0 ? <span style={{ color: '#8b949e' }}>Seleccione operaciones...</span> : selectedIds.map(id => {
          const opt = options.find(o => o.id === id);
          return opt ? <span key={id} style={{ backgroundColor: '#21262d', border: '1px solid #30363d', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem' }}>{opt.label} ✕</span> : null;
        })}
      </div>
      {isOpen && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', marginTop: '4px', zIndex: 1000, padding: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {options.map(opt => (
            <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c9d1d9', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={selectedIds.includes(opt.id)} onChange={() => toggleSelect(opt.id)} style={{ accentColor: '#D84315' }} /> {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
};

// =========================================
// COMPONENTE PRINCIPAL (EmployeeForm)
// =========================================
interface Props {
  estado: 'abierto' | 'minimizado';
  initialData?: Employee | null;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

type TabKey = 'personales' | 'empresa' | 'operador' | 'herramientas';

export const EmployeeForm: React.FC<Props> = ({ estado, initialData, onClose, onMinimize, onRestore }) => {
  const todayISO = new Date().toISOString().split('T')[0];
  const estadoInicial: Employee = {
    employeeId: 'Se generará al guardar', activo: true, foto: '', firstName: '', lastNamePaternal: '', lastNameMaternal: '', alias: '', rfc: '', birthDate: '', mapsLink: '', addressId: '', addressLabel: '', personalPhone: '', personalEmail: '', emergencyContactName: '', emergencyContactPhone: '', cargoId: '', cargoNombre: '', departamentoId: '', departamentoNombre: '', operacionesIds: [], empresaId: '', empresaNombre: '', fechaIngreso: todayISO, fechaAltaIMSS: '', salarioDiario: 0, descuentoIMSS: 0, descuentoInfonavit: 0, gastosAsignados: 0, telefonoAsignado: ''
  };

  const [formData, setFormData] = useState<Employee>(estadoInicial);
  const [cargando, setCargando] = useState(false);
  const [modalDireccionAbierto, setModalDireccionAbierto] = useState(false);
  
  // ✅ ESTADO PARA LAS PESTAÑAS
  const [pestañaActiva, setPestañaActiva] = useState<TabKey>('personales');

  // Estados para Catálogos Relacionales
  const [direccionesDB, setDireccionesDB] = useState<{id: string, label: string}[]>([]);
  const [cargosDB, setCargosDB] = useState<{id: string, label: string}[]>([]);
  const [departamentosDB, setDepartamentosDB] = useState<{id: string, label: string}[]>([]);
  const [operacionesDB, setOperacionesDB] = useState<{id: string, label: string}[]>([]);
  const [empresasDB, setEmpresasDB] = useState<{id: string, label: string}[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'direcciones'), (snapshot) => {
      setDireccionesDB(snapshot.docs.map(doc => ({ id: doc.id, label: doc.data().direccionCompleta || 'Sin formato' })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const [cargosSnap, deptosSnap, opSnap, empSnap] = await Promise.all([
          getDocs(collection(db, 'catalogo_cargos')),
          getDocs(collection(db, 'catalogo_departamentos')),
          getDocs(collection(db, 'catalogo_tipo_operacion')),
          getDocs(collection(db, 'empresas'))
        ]);
        setCargosDB(cargosSnap.docs.map(d => ({ id: d.id, label: d.data().nombre || d.data().cargo || d.id })));
        setDepartamentosDB(deptosSnap.docs.map(d => ({ id: d.id, label: d.data().nombre || d.data().departamento || d.id })));
        setOperacionesDB(opSnap.docs.map(d => ({ id: d.id, label: d.data().tipo_operacion || d.id })));
        setEmpresasDB(empSnap.docs.map(d => ({ id: d.id, label: d.data().nombre || d.data().razonSocial || d.id })));
      } catch (e) { console.error("Error catálogos:", e); }
    };
    cargarCatalogos();
  }, []);

  useEffect(() => { if (initialData) setFormData(initialData); }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({ 
      ...prev, 
      [name]: type === 'number' ? (parseFloat(value) || 0) : (name === 'rfc' ? value.toUpperCase() : value) 
    }));
  };

  const abrirGoogleMaps = () => {
    if (!formData.addressLabel) { alert("Seleccione una dirección primero."); return; }
    const query = encodeURIComponent(formData.addressLabel);
    const url = `https://www.google.com/maps/search/?api=1&query=[DIRECCION_URL_ENCODED]?q=$${query}`;
    window.open(url, '_blank');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.addressId) return alert("La dirección es obligatoria.");
    setCargando(true);
    try {
      await guardarEmpleadoConTransaccion(formData); 
      alert('Operación exitosa.');
      onClose();
    } catch (error) {
      alert('Error al guardar empleado.');
    } finally { setCargando(false); }
  };

  const gridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' };

  // Definición de las pestañas
  const tabs: { id: TabKey, label: string }[] = [
    { id: 'personales', label: 'Datos Personales' },
    { id: 'empresa', label: 'Alta Empresa' },
    { id: 'operador', label: 'Operador' },
    { id: 'herramientas', label: 'Herramientas' }
  ];

  return (
    <>
      <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`} style={{ backdropFilter: 'blur(4px)', zIndex: 1000 }}>
        <div className="form-card" style={{ maxWidth: '1000px', width: '100%', borderRadius: '12px', border: '1px solid #30363d', backgroundColor: '#0d1117', display: 'flex', flexDirection: 'column', maxHeight: '95vh' }}>
          
          <div className="form-header" style={{ padding: '20px 24px', borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '500', margin: 0, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '12px' }}>
              {estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Empleado` : 'Alta de Empleado')}
              <span style={{ fontSize: '0.8rem', padding: '2px 8px', borderRadius: '12px', backgroundColor: formData.activo ? '#238636' : '#da3633', color: '#fff' }}>
                {formData.activo ? 'Activo' : 'Baja'}
              </span>
            </h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
              <button type="button" onClick={onClose} className="btn-window close" style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
          </div>

          {/* ✅ PESTAÑAS (TABS) */}
          <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px', overflowX: 'auto', flexShrink: 0 }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={(e) => { e.preventDefault(); setPestañaActiva(tab.id); }}
                style={{
                  padding: '12px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: pestañaActiva === tab.id ? '2px solid #D84315' : '2px solid transparent',
                  color: pestañaActiva === tab.id ? '#f0f6fc' : '#8b949e',
                  cursor: 'pointer',
                  fontWeight: pestañaActiva === tab.id ? '600' : 'normal',
                  fontSize: '0.9rem',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.2s'
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '24px', overflowY: 'auto', flex: 1 }}>
            <form id="employeeForm" onSubmit={handleSubmit}>
              
              {/* ✅ PESTAÑA 1: DATOS PERSONALES */}
              {pestañaActiva === 'personales' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={gridStyle}>
                    <div className="form-group">
                      <label className="form-label orange"># de Empleado</label>
                      <input type="text" className="form-control" value={formData.employeeId} disabled style={{ backgroundColor: '#010409', color: '#8b949e', fontWeight: 'bold' }} />
                    </div>
                    <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '24px' }}>
                      <label style={{ color: '#c9d1d9', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={formData.activo} onChange={e => setFormData({...formData, activo: e.target.checked})} style={{ width: '18px', height: '18px', accentColor: '#D84315' }} />
                        Empleado Activo
                      </label>
                    </div>
                    <div className="form-group"><label className="form-label">Nombres *</label><input type="text" name="firstName" className="form-control" value={formData.firstName} onChange={handleChange} required /></div>
                    <div className="form-group"><label className="form-label">Apellido Paterno *</label><input type="text" name="lastNamePaternal" className="form-control" value={formData.lastNamePaternal} onChange={handleChange} required /></div>
                    <div className="form-group"><label className="form-label">Apellido Materno</label><input type="text" name="lastNameMaternal" className="form-control" value={formData.lastNameMaternal} onChange={handleChange} /></div>
                    <div className="form-group"><label className="form-label">Nombre Corto / Alías</label><input type="text" name="alias" className="form-control" value={formData.alias} onChange={handleChange} /></div>
                    <div className="form-group"><label className="form-label">RFC *</label><input type="text" name="rfc" className="form-control" value={formData.rfc} onChange={handleChange} required placeholder="ABCD123456XYZ" pattern="^([A-ZÑ&]{3,4})\d{6}([A-Z0-9]{3})$" /></div>
                    <div className="form-group"><label className="form-label">Fecha de Nacimiento *</label><input type="date" name="birthDate" className="form-control" value={formData.birthDate} onChange={handleChange} required /></div>
                    <div className="form-group"><label className="form-label">Teléfono Personal *</label><input type="tel" name="personalPhone" className="form-control" value={formData.personalPhone} onChange={handleChange} required /></div>
                    <div className="form-group"><label className="form-label">Correo Personal</label><input type="email" name="personalEmail" className="form-control" value={formData.personalEmail} onChange={handleChange} /></div>
                    
                    {/* Direcciones y Maps */}
                    <div className="form-group" style={{ gridColumn: '1 / -1', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
                      <label className="form-label" style={{ color: '#58a6ff' }}>Dirección *</label>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 300px' }}>
                          <SearchableSelect options={direccionesDB} value={formData.addressId} onChange={(id, label) => setFormData(prev => ({ ...prev, addressId: id, addressLabel: label }))} required />
                        </div>
                        <button type="button" className="btn btn-outline" onClick={() => setModalDireccionAbierto(true)}>+ Nueva</button>
                        <button type="button" className="btn btn-primary" onClick={abrirGoogleMaps} style={{ backgroundColor: '#2ea043', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                          Maps
                        </button>
                      </div>
                    </div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Enlace Google Maps</label><input type="url" name="mapsLink" className="form-control" value={formData.mapsLink} onChange={handleChange} placeholder="https://maps.google.com/..." /></div>
                    
                    {/* Emergencia */}
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}><hr style={{ borderColor: '#30363d' }} /></div>
                    <div className="form-group"><label className="form-label" style={{ color: '#ff7b72' }}>Contacto de Emergencia</label><input type="text" name="emergencyContactName" className="form-control" value={formData.emergencyContactName} onChange={handleChange} /></div>
                    <div className="form-group"><label className="form-label" style={{ color: '#ff7b72' }}>Teléfono Emergencia</label><input type="tel" name="emergencyContactPhone" className="form-control" value={formData.emergencyContactPhone} onChange={handleChange} /></div>
                  </div>
                </div>
              )}

              {/* ✅ PESTAÑA 2: ALTA DE LA EMPRESA */}
              {pestañaActiva === 'empresa' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={gridStyle}>
                    <div className="form-group">
                      <label className="form-label">Empresa</label>
                      <SearchableSelect options={empresasDB} value={formData.empresaId} onChange={(id, label) => setFormData(prev => ({ ...prev, empresaId: id, empresaNombre: label }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Cargo</label>
                      <SearchableSelect options={cargosDB} value={formData.cargoId} onChange={(id, label) => setFormData(prev => ({ ...prev, cargoId: id, cargoNombre: label }))} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Departamento</label>
                      <SearchableSelect options={departamentosDB} value={formData.departamentoId} onChange={(id, label) => setFormData(prev => ({ ...prev, departamentoId: id, departamentoNombre: label }))} />
                    </div>
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label className="form-label">Operaciones Autorizadas (Selección Múltiple)</label>
                      <MultiSelect options={operacionesDB} selectedIds={formData.operacionesIds} onChange={(ids) => setFormData(prev => ({ ...prev, operacionesIds: ids }))} />
                    </div>
                    <div className="form-group"><label className="form-label">Fecha de Ingreso *</label><input type="date" name="fechaIngreso" className="form-control" value={formData.fechaIngreso} onChange={handleChange} required /></div>
                    <div className="form-group"><label className="form-label">Fecha Alta IMSS</label><input type="date" name="fechaAltaIMSS" className="form-control" value={formData.fechaAltaIMSS} onChange={handleChange} /></div>
                    
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}><hr style={{ borderColor: '#30363d' }} /></div>
                    <div className="form-group"><label className="form-label">Salario Diario Integrado ($)</label><input type="number" name="salarioDiario" className="form-control" value={formData.salarioDiario} onChange={handleChange} /></div>
                    <div className="form-group"><label className="form-label">Descuento IMSS ($)</label><input type="number" name="descuentoIMSS" className="form-control" value={formData.descuentoIMSS} onChange={handleChange} /></div>
                    <div className="form-group"><label className="form-label">Descuento INFONAVIT ($)</label><input type="number" name="descuentoInfonavit" className="form-control" value={formData.descuentoInfonavit} onChange={handleChange} /></div>
                  </div>
                </div>
              )}

              {/* ✅ PESTAÑA 3: OPERADOR */}
              {pestañaActiva === 'operador' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={gridStyle}>
                    <div className="form-group">
                      <label className="form-label">Gastos Asignados ($)</label>
                      <input type="number" name="gastosAsignados" className="form-control" value={formData.gastosAsignados} onChange={handleChange} />
                    </div>
                  </div>
                </div>
              )}

              {/* ✅ PESTAÑA 4: HERRAMIENTAS */}
              {pestañaActiva === 'herramientas' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div style={gridStyle}>
                    <div className="form-group">
                      <label className="form-label">Teléfono Asignado (Flota)</label>
                      <input type="tel" name="telefonoAsignado" className="form-control" value={formData.telefonoAsignado} onChange={handleChange} />
                    </div>
                  </div>
                </div>
              )}

            </form>
          </div>

          {/* BOTONES DE ACCIÓN FIJOS AL FINAL */}
          <div className="form-actions" style={{ display: estado === 'minimizado' ? 'none' : 'flex', gap: '16px', justifyContent: 'flex-end', borderTop: '1px solid #30363d', padding: '16px 24px', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
            <button type="button" onClick={onClose} className="btn btn-outline" style={{ padding: '10px 24px', borderRadius: '6px' }}>Cancelar</button>
            <button type="submit" form="employeeForm" disabled={cargando} className="btn btn-primary" style={{ backgroundColor: '#D84315', padding: '10px 24px', borderRadius: '6px', border: 'none', fontWeight: 'bold' }}>
              {cargando ? 'Guardando...' : 'Guardar Empleado'}
            </button>
          </div>

        </div>
      </div>

      {modalDireccionAbierto && (
        <div style={{ zIndex: 2000, position: 'relative' }}>
          <FormularioDireccion estado="abierto" onClose={() => setModalDireccionAbierto(false)} />
        </div>
      )}
    </>
  );
};
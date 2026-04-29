// src/features/empleados/components/EmployeeForm.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { guardarEmpleadoConTransaccion } from '../../../services/employeeService';
import { FormularioDireccion } from '../../direcciones/components/FormularioDireccion';
import type { Employee } from '../../../types/empleado';

// Roles disponibles en la empresa
const ROLES_DISPONIBLES = ['Administrador', 'Recursos Humanos', 'Operaciones', 'Contabilidad', 'Gerencia'];

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
// SUB-COMPONENTE: MULTI-SELECT
// =========================================
const MultiSelect: React.FC<{ options: { id: string, label: string }[]; selectedIds: string[]; onChange: (ids: string[]) => void; required?: boolean; }> = ({ options, selectedIds, onChange, required }) => {
  const [isOpen, setIsOpen] = useState(false);
  const toggleSelect = (id: string) => {
    if (selectedIds.includes(id)) onChange(selectedIds.filter(selId => selId !== id));
    else onChange([...selectedIds, id]);
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {required && <input type="text" style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} value={selectedIds.length > 0 ? 'valid' : ''} required readOnly />}
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
// SUB-COMPONENTE: MODAL DE CONFIGURACIÓN
// =========================================
const FieldConfigModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  fields: { name: string; label: string }[];
  requiredFields: string[];
  toggleRequired: (f: string) => void;
  fieldRoles: Record<string, string[]>;
  toggleRole: (f: string, role: string) => void;
}> = ({ isOpen, onClose, fields, requiredFields, toggleRequired, fieldRoles, toggleRole }) => {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 2000 }}>
      <div className="form-card" style={{ maxWidth: '1100px', width: '95%', borderRadius: '16px', border: '1px solid #444', backgroundColor: '#0d1117', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        <div className="form-header" style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', marginBottom: '0', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '1.25rem', margin: 0, color: '#f0f6fc' }}>⚙️ Configuración de Campos y Accesos</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>
        
        <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
          <p style={{ color: '#8b949e', marginBottom: '24px', fontSize: '0.9rem' }}>Define qué campos son obligatorios y qué roles de usuario tienen permiso para verlos.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
            {fields.map(f => {
              const rolesPermitidos = fieldRoles[f.name] || ROLES_DISPONIBLES;
              return (
              <div key={f.name} style={{ backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
                <h4 style={{ margin: '0 0 12px 0', color: '#58a6ff', fontSize: '0.95rem' }}>{f.label}</h4>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', cursor: 'pointer', color: '#c9d1d9', fontSize: '0.9rem', fontWeight: 'bold' }}>
                  <input type="checkbox" checked={requiredFields.includes(f.name)} onChange={() => toggleRequired(f.name)} style={{ width: '16px', height: '16px', accentColor: '#D84315' }} /> 
                  Hacer Obligatorio
                </label>
                <div style={{ fontSize: '0.75rem', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px', borderTop: '1px solid #30363d', paddingTop: '12px' }}>Roles que pueden ver este campo:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  {ROLES_DISPONIBLES.map(rol => {
                    const hasAccess = rolesPermitidos.includes(rol);
                    return (
                      <label key={rol} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', color: hasAccess ? '#c9d1d9' : '#8b949e', cursor: 'pointer', opacity: hasAccess ? 1 : 0.5 }}>
                        <input type="checkbox" checked={hasAccess} onChange={() => toggleRole(f.name, rol)} style={{ accentColor: '#D84315' }} /> 
                        {rol}
                      </label>
                    );
                  })}
                </div>
              </div>
            )})}
          </div>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn-primary" onClick={onClose} style={{ padding: '10px 32px', backgroundColor: '#D84315', border: 'none', borderRadius: '6px', color: '#fff', fontWeight: 'bold', cursor: 'pointer' }}>Guardar Cambios</button>
        </div>
      </div>
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
  
  const estadoInicial: Employee & { fechaBaja?: string, observacionBaja?: string, observacionesEmpresa?: string } = {
    employeeId: 'Generando...', 
    activo: true, foto: '', firstName: '', lastNamePaternal: '', lastNameMaternal: '', alias: '', rfc: '', birthDate: '', mapsLink: '', addressId: '', addressLabel: '', personalPhone: '', personalEmail: '', emergencyContactName: '', emergencyContactPhone: '', cargoId: '', cargoNombre: '', departamentoId: '', departamentoNombre: '', operacionesIds: [], empresaId: '', empresaNombre: '', fechaIngreso: todayISO, fechaAltaIMSS: '', salarioDiario: 0, descuentoIMSS: 0, descuentoInfonavit: 0, gastosAsignados: 0, telefonoAsignado: '', fechaBaja: '', observacionBaja: '', observacionesEmpresa: ''
  };

  const [formData, setFormData] = useState<any>(estadoInicial);
  const [cargando, setCargando] = useState(false);
  const [modalDireccionAbierto, setModalDireccionAbierto] = useState(false);
  
  const [pestañaActiva, setPestañaActiva] = useState<TabKey>('personales');
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  
  const [requiredFields, setRequiredFields] = useState<string[]>([]);
  const [fieldRoles, setFieldRoles] = useState<Record<string, string[]>>({});
  const currentUserRole = 'Administrador'; 

  const [direccionesDB, setDireccionesDB] = useState<{id: string, label: string}[]>([]);
  const [cargosDB, setCargosDB] = useState<{id: string, label: string}[]>([]);
  const [departamentosDB, setDepartamentosDB] = useState<{id: string, label: string}[]>([]);
  const [operacionesDB, setOperacionesDB] = useState<{id: string, label: string}[]>([]);
  const [empresasDB, setEmpresasDB] = useState<{id: string, label: string}[]>([]);

  const configuracionCampos = [
    { name: 'activo', label: 'Estado (Activo/Baja)' },
    { name: 'fechaBaja', label: 'Fecha de Baja' },
    { name: 'observacionBaja', label: 'Motivo de Baja' },
    { name: 'firstName', label: 'Nombres' },
    { name: 'lastNamePaternal', label: 'Apellido Paterno' },
    { name: 'lastNameMaternal', label: 'Apellido Materno' },
    { name: 'alias', label: 'Nombre Corto / Alías' },
    { name: 'rfc', label: 'RFC' },
    { name: 'birthDate', label: 'Fecha de Nacimiento' },
    { name: 'personalPhone', label: 'Teléfono Personal' },
    { name: 'personalEmail', label: 'Correo Personal' },
    { name: 'addressId', label: 'Dirección Exacta' },
    { name: 'mapsLink', label: 'Enlace Google Maps' },
    { name: 'emergencyContactName', label: 'Contacto de Emergencia' },
    { name: 'emergencyContactPhone', label: 'Teléfono de Emergencia' },
    { name: 'empresaId', label: 'Empresa de Alta' },
    { name: 'cargoId', label: 'Cargo' },
    { name: 'departamentoId', label: 'Departamento' },
    { name: 'operacionesIds', label: 'Operaciones Autorizadas' },
    { name: 'fechaIngreso', label: 'Fecha de Ingreso' },
    { name: 'fechaAltaIMSS', label: 'Fecha Alta IMSS' },
    { name: 'salarioDiario', label: 'Salario Diario Integrado' },
    { name: 'descuentoIMSS', label: 'Descuento IMSS' },
    { name: 'descuentoInfonavit', label: 'Descuento INFONAVIT' },
    { name: 'observacionesEmpresa', label: 'Observaciones (Empresa)' },
    { name: 'gastosAsignados', label: 'Gastos Asignados (Op)' },
    { name: 'telefonoAsignado', label: 'Teléfono Asignado (Flota)' }
  ];

  useEffect(() => {
    const savedReq = localStorage.getItem('formConfig_empleados_req');
    const savedRoles = localStorage.getItem('formConfig_empleados_roles');
    if (savedReq) setRequiredFields(JSON.parse(savedReq));
    else setRequiredFields(['firstName', 'lastNamePaternal', 'rfc', 'birthDate', 'personalPhone', 'addressId', 'empresaId', 'cargoId']);
    if (savedRoles) setFieldRoles(JSON.parse(savedRoles));
  }, []);

  const toggleRequired = (fieldName: string) => {
    const newReq = requiredFields.includes(fieldName) ? requiredFields.filter(f => f !== fieldName) : [...requiredFields, fieldName];
    setRequiredFields(newReq);
    localStorage.setItem('formConfig_empleados_req', JSON.stringify(newReq));
  };

  const toggleRole = (fieldName: string, role: string) => {
    setFieldRoles(prev => {
      const currentAccess = prev[fieldName] || [...ROLES_DISPONIBLES];
      let newAccess = currentAccess.includes(role) ? currentAccess.filter(r => r !== role) : [...currentAccess, role];
      const updated = { ...prev, [fieldName]: newAccess };
      localStorage.setItem('formConfig_empleados_roles', JSON.stringify(updated));
      return updated;
    });
  };

  const isReq = (fieldName: string) => requiredFields.includes(fieldName);
  const isVis = (fieldName: string) => {
    const rolesAutorizados = fieldRoles[fieldName];
    if (!rolesAutorizados || rolesAutorizados.length === 0) return true; 
    return rolesAutorizados.includes(currentUserRole);
  };

  useEffect(() => {
    const generarConsecutivo = async () => {
      if (initialData) return;
      try {
        const q = query(collection(db, 'empleados'), orderBy('employeeId', 'desc'), limit(1));
        const snap = await getDocs(q);
        
        let nuevoNumero = 1;
        if (!snap.empty) {
          const ultimoId = snap.docs[0].data().employeeId || '';
          const match = ultimoId.match(/Col-(\d+)/);
          if (match && match[1]) {
            nuevoNumero = parseInt(match[1], 10) + 1;
          }
        }
        
        const nuevoCodigo = `Col-${String(nuevoNumero).padStart(3, '0')}`;
        setFormData((prev: any) => ({ ...prev, employeeId: nuevoCodigo }));
      } catch (error) {
        console.error("Error generando consecutivo:", error);
        setFormData((prev: any) => ({ ...prev, employeeId: 'Col-001' }));
      }
    };
    
    generarConsecutivo();
  }, [initialData]);

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
          getDocs(collection(db, 'catalogo_tipo_cargo')),
          getDocs(collection(db, 'catalogo_departamentos')),
          getDocs(collection(db, 'catalogo_tipo_operacion')),
          getDocs(collection(db, 'empresas'))
        ]);

        // Cargo sí muestra su nombre_puesto (como lo solicitaste en la imagen de Firebase anterior)
        setCargosDB(cargosSnap.docs.map(d => ({ 
          id: d.id, 
          label: d.data().nombre_puesto || d.data().nombre || d.id 
        })));
        
        // ✅ CORRECCIÓN: Departamento vuelve a mostrar el nombre
        setDepartamentosDB(deptosSnap.docs.map(d => ({ 
          id: d.id, 
          label: d.data().nombre || d.data().departamento || d.id 
        })));
        
        setOperacionesDB(opSnap.docs.map(d => ({ id: d.id, label: d.data().tipo_operacion || d.id })));
        
        // ✅ CORRECCIÓN: Empresa vuelve a mostrar la Razón Social / Nombre
        const empresasFiltradas = empSnap.docs
          .filter(doc => {
            const tipos = doc.data().tiposEmpresa;
            if (Array.isArray(tipos)) return tipos.includes('f21b15a4');
            if (typeof tipos === 'string') return tipos.includes('f21b15a4');
            return false;
          })
          .map(d => ({ 
            id: d.id, 
            label: d.data().nombre || d.data().razonSocial || d.id 
          }));
          
        setEmpresasDB(empresasFiltradas);

      } catch (e) { console.error("Error catálogos:", e); }
    };
    cargarCatalogos();
  }, []);

  useEffect(() => { 
    if (initialData) {
      setFormData({
        ...initialData,
        observacionesEmpresa: (initialData as any).observacionesEmpresa || ''
      });
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    setFormData((prev: any) => ({ 
      ...prev, 
      [name]: type === 'number' ? (parseFloat(value) || 0) : (name === 'rfc' ? value.toUpperCase() : value) 
    }));
  };

  const abrirGoogleMaps = () => {
    if (!formData.addressLabel) { alert("Seleccione una dirección primero."); return; }
    const query = encodeURIComponent(formData.addressLabel);
    window.open(`https://www.google.com/maps/search/?api=1&query=[DIRECCION_URL_ENCODED]?q=$$${query}`, '_blank');
  };

  const handleDarDeBaja = () => {
    setFormData((prev: any) => ({ ...prev, activo: false, fechaBaja: todayISO }));
  };

  const handleReactivar = () => {
    setFormData((prev: any) => ({ ...prev, activo: true, fechaBaja: '', observacionBaja: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.employeeId || formData.employeeId.trim() === '' || formData.employeeId === 'Generando...') {
      return alert('⛔ El Número de Empleado (Ej. Col-001) es estrictamente necesario.');
    }

    if (!formData.activo && (!formData.fechaBaja || !formData.observacionBaja)) {
      return alert('⛔ Para dar de baja a un empleado debe ingresar obligatoriamente la Fecha de Baja y el Motivo.');
    }

    for (const campo of configuracionCampos) {
      if (isVis(campo.name) && isReq(campo.name)) {
        const valor = (formData as any)[campo.name];
        if (!valor || (Array.isArray(valor) && valor.length === 0)) {
          return alert(`⛔ El campo "${campo.label}" es obligatorio.`);
        }
      }
    }
    
    setCargando(true);
    try {
      await guardarEmpleadoConTransaccion(formData); 
      alert('Operación exitosa.');
      onClose();
    } catch (error) {
      alert('Error al guardar empleado.');
    } finally { setCargando(false); }
  };

  const tabs: { id: TabKey, label: string }[] = [
    { id: 'personales', label: 'Datos Personales' },
    { id: 'empresa', label: 'Alta Empresa' },
    { id: 'operador', label: 'Operador' },
    { id: 'herramientas', label: 'Herramientas' }
  ];

  return (
    <>
      <style>{`
        .strict-3-col-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 768px) { .strict-3-col-grid { grid-template-columns: 1fr; } }
      `}</style>

      <FieldConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} fields={configuracionCampos} requiredFields={requiredFields} toggleRequired={toggleRequired} fieldRoles={fieldRoles} toggleRole={toggleRole} />

      <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`} style={{ backdropFilter: 'blur(4px)', zIndex: 1000 }}>
        <div className="form-card" style={{ maxWidth: '1100px', width: '100%', borderRadius: '12px', border: '1px solid #30363d', backgroundColor: '#0d1117', display: 'flex', flexDirection: 'column', maxHeight: '95vh' }}>
          
          <div className="form-header" style={{ padding: '20px 24px', borderBottom: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '500', margin: 0, color: '#f0f6fc', display: 'flex', alignItems: 'center', gap: '12px' }}>
              {estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Empleado` : 'Alta de Empleado')}
              <span style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: '12px', backgroundColor: formData.activo ? 'rgba(35, 134, 54, 0.2)' : 'rgba(218, 54, 51, 0.2)', color: formData.activo ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>
                {formData.activo ? '🟢 Activo' : '🔴 Baja'}
              </span>
            </h2>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button type="button" onClick={() => setIsConfigOpen(true)} className="btn-window" style={{ background: 'none', fontSize: '1.2rem', cursor: 'pointer' }} title="Configurar campos y accesos">⚙️</button>
              {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
              <button type="button" onClick={onClose} className="btn-window close" style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
          </div>

          <div style={{ display: 'flex', borderBottom: '1px solid #30363d', padding: '0 24px', overflowX: 'auto', flexShrink: 0 }}>
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={(e) => { e.preventDefault(); setPestañaActiva(tab.id); }}
                style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontWeight: pestañaActiva === tab.id ? '600' : 'normal', fontSize: '0.9rem', whiteSpace: 'nowrap', transition: 'all 0.2s' }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '24px', overflowY: 'auto', flex: 1 }}>
            <form id="employeeForm" onSubmit={handleSubmit}>
              
              {/* ✅ PESTAÑA 1 */}
              {pestañaActiva === 'personales' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  
                  {isVis('activo') && (
                    <div style={{ gridColumn: '1 / -1', backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', border: formData.activo ? '1px solid #30363d' : '1px solid #f85149', marginBottom: '24px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontSize: '0.85rem', color: '#8b949e', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>Gestión de Estado</span>
                          {formData.activo ? (
                            <span style={{ color: '#3fb950', fontWeight: 'bold', fontSize: '1rem' }}>Empleado habilitado en el sistema</span>
                          ) : (
                            <span style={{ color: '#f85149', fontWeight: 'bold', fontSize: '1rem' }}>Empleado dado de baja</span>
                          )}
                        </div>
                        <div>
                          {formData.activo ? (
                            <button type="button" onClick={handleDarDeBaja} style={{ backgroundColor: 'transparent', border: '1px solid #f85149', color: '#f85149', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Dar de Baja</button>
                          ) : (
                            <button type="button" onClick={handleReactivar} style={{ backgroundColor: '#2ea043', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>Reactivar Empleado</button>
                          )}
                        </div>
                      </div>
                      
                      {!formData.activo && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginTop: '20px', paddingTop: '20px', borderTop: '1px solid #30363d' }}>
                          <div className="form-group">
                            <label className="form-label" style={{ color: '#f85149' }}>Fecha de Baja *</label>
                            <input type="date" name="fechaBaja" className="form-control" value={formData.fechaBaja || ''} onChange={handleChange} required />
                          </div>
                          <div className="form-group">
                            <label className="form-label" style={{ color: '#f85149' }}>Observación / Motivo de Baja *</label>
                            <input type="text" name="observacionBaja" className="form-control" value={formData.observacionBaja || ''} onChange={handleChange} required placeholder="Explique el motivo..." />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="strict-3-col-grid">
                    
                    <div className="form-group">
                      <label className="form-label orange"># de Empleado (Editable)</label>
                      <input 
                        type="text" 
                        name="employeeId"
                        className="form-control" 
                        value={formData.employeeId} 
                        onChange={handleChange}
                        required
                        style={{ backgroundColor: '#010409', color: '#58a6ff', fontWeight: 'bold', border: '1px solid #3b82f6' }} 
                      />
                    </div>

                    {isVis('firstName') && <div className="form-group"><label className="form-label">Nombres {isReq('firstName') && '*'}</label><input type="text" name="firstName" className="form-control" value={formData.firstName} onChange={handleChange} required={isReq('firstName')} /></div>}
                    {isVis('lastNamePaternal') && <div className="form-group"><label className="form-label">Apellido Paterno {isReq('lastNamePaternal') && '*'}</label><input type="text" name="lastNamePaternal" className="form-control" value={formData.lastNamePaternal} onChange={handleChange} required={isReq('lastNamePaternal')} /></div>}
                    {isVis('lastNameMaternal') && <div className="form-group"><label className="form-label">Apellido Materno {isReq('lastNameMaternal') && '*'}</label><input type="text" name="lastNameMaternal" className="form-control" value={formData.lastNameMaternal} onChange={handleChange} required={isReq('lastNameMaternal')} /></div>}
                    {isVis('alias') && <div className="form-group"><label className="form-label">Nombre Corto / Alías {isReq('alias') && '*'}</label><input type="text" name="alias" className="form-control" value={formData.alias} onChange={handleChange} required={isReq('alias')} /></div>}
                    {isVis('rfc') && <div className="form-group"><label className="form-label">RFC {isReq('rfc') && '*'}</label><input type="text" name="rfc" className="form-control" value={formData.rfc} onChange={handleChange} required={isReq('rfc')} placeholder="ABCD123456XYZ" pattern="^([A-ZÑ&]{3,4})\d{6}([A-Z0-9]{3})$" /></div>}
                    {isVis('birthDate') && <div className="form-group"><label className="form-label">Fecha de Nacimiento {isReq('birthDate') && '*'}</label><input type="date" name="birthDate" className="form-control" value={formData.birthDate} onChange={handleChange} required={isReq('birthDate')} /></div>}
                    {isVis('personalPhone') && <div className="form-group"><label className="form-label">Teléfono Personal {isReq('personalPhone') && '*'}</label><input type="tel" name="personalPhone" className="form-control" value={formData.personalPhone} onChange={handleChange} required={isReq('personalPhone')} /></div>}
                    {isVis('personalEmail') && <div className="form-group"><label className="form-label">Correo Personal {isReq('personalEmail') && '*'}</label><input type="email" name="personalEmail" className="form-control" value={formData.personalEmail} onChange={handleChange} required={isReq('personalEmail')} /></div>}
                    
                    {isVis('addressId') && (
                    <div className="form-group" style={{ gridColumn: '1 / -1', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
                      <label className="form-label" style={{ color: '#58a6ff' }}>Dirección Exacta {isReq('addressId') && '*'}</label>
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 300px' }}>
                          <SearchableSelect options={direccionesDB} value={formData.addressId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, addressId: id, addressLabel: label }))} required={isReq('addressId')} />
                        </div>
                        <button type="button" className="btn btn-outline" onClick={() => setModalDireccionAbierto(true)}>+ Nueva</button>
                        <button type="button" className="btn btn-primary" onClick={abrirGoogleMaps} style={{ backgroundColor: '#2ea043', color: 'white', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                          Maps
                        </button>
                      </div>
                    </div>
                    )}
                    {isVis('mapsLink') && <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Enlace Google Maps {isReq('mapsLink') && '*'}</label><input type="url" name="mapsLink" className="form-control" value={formData.mapsLink} onChange={handleChange} placeholder="https://maps.google.com/..." required={isReq('mapsLink')} /></div>}
                    
                    {isVis('emergencyContactName') && <><div className="form-group" style={{ gridColumn: '1 / -1' }}><hr style={{ borderColor: '#30363d' }} /></div><div className="form-group"><label className="form-label" style={{ color: '#ff7b72' }}>Contacto de Emergencia {isReq('emergencyContactName') && '*'}</label><input type="text" name="emergencyContactName" className="form-control" value={formData.emergencyContactName} onChange={handleChange} required={isReq('emergencyContactName')} /></div></>}
                    {isVis('emergencyContactPhone') && <div className="form-group"><label className="form-label" style={{ color: '#ff7b72' }}>Teléfono Emergencia {isReq('emergencyContactPhone') && '*'}</label><input type="tel" name="emergencyContactPhone" className="form-control" value={formData.emergencyContactPhone} onChange={handleChange} required={isReq('emergencyContactPhone')} /></div>}
                  </div>
                </div>
              )}

              {/* ✅ PESTAÑA 2: ALTA DE LA EMPRESA */}
              {pestañaActiva === 'empresa' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div className="strict-3-col-grid">
                    {isVis('empresaId') && <div className="form-group"><label className="form-label">Empresa {isReq('empresaId') && '*'}</label><SearchableSelect options={empresasDB} value={formData.empresaId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, empresaId: id, empresaNombre: label }))} required={isReq('empresaId')} /></div>}
                    {isVis('cargoId') && <div className="form-group"><label className="form-label">Cargo {isReq('cargoId') && '*'}</label><SearchableSelect options={cargosDB} value={formData.cargoId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, cargoId: id, cargoNombre: label }))} required={isReq('cargoId')} /></div>}
                    {isVis('departamentoId') && <div className="form-group"><label className="form-label">Departamento {isReq('departamentoId') && '*'}</label><SearchableSelect options={departamentosDB} value={formData.departamentoId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, departamentoId: id, departamentoNombre: label }))} required={isReq('departamentoId')} /></div>}
                    
                    {isVis('operacionesIds') && (
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label className="form-label">Operaciones Autorizadas {isReq('operacionesIds') && '*'}</label>
                      <MultiSelect options={operacionesDB} selectedIds={formData.operacionesIds} onChange={(ids) => setFormData((prev:any) => ({ ...prev, operacionesIds: ids }))} required={isReq('operacionesIds')} />
                    </div>
                    )}
                    
                    {isVis('fechaIngreso') && <div className="form-group"><label className="form-label">Fecha de Ingreso {isReq('fechaIngreso') && '*'}</label><input type="date" name="fechaIngreso" className="form-control" value={formData.fechaIngreso} onChange={handleChange} required={isReq('fechaIngreso')} /></div>}
                    {isVis('fechaAltaIMSS') && <div className="form-group"><label className="form-label">Fecha Alta IMSS {isReq('fechaAltaIMSS') && '*'}</label><input type="date" name="fechaAltaIMSS" className="form-control" value={formData.fechaAltaIMSS} onChange={handleChange} required={isReq('fechaAltaIMSS')} /></div>}
                    
                    {isVis('salarioDiario') && <><div className="form-group" style={{ gridColumn: '1 / -1' }}><hr style={{ borderColor: '#30363d' }} /></div><div className="form-group"><label className="form-label">Salario Diario Integrado ($) {isReq('salarioDiario') && '*'}</label><input type="number" name="salarioDiario" className="form-control" value={formData.salarioDiario} onChange={handleChange} required={isReq('salarioDiario')} /></div></>}
                    {isVis('descuentoIMSS') && <div className="form-group"><label className="form-label">Descuento IMSS ($) {isReq('descuentoIMSS') && '*'}</label><input type="number" name="descuentoIMSS" className="form-control" value={formData.descuentoIMSS} onChange={handleChange} required={isReq('descuentoIMSS')} /></div>}
                    {isVis('descuentoInfonavit') && <div className="form-group"><label className="form-label">Descuento INFONAVIT ($) {isReq('descuentoInfonavit') && '*'}</label><input type="number" name="descuentoInfonavit" className="form-control" value={formData.descuentoInfonavit} onChange={handleChange} required={isReq('descuentoInfonavit')} /></div>}
                    
                    {isVis('observacionesEmpresa') && (
                      <div className="form-group" style={{ gridColumn: '1 / -1', marginTop: '16px' }}>
                        <label className="form-label text-gray-400">Observaciones {isReq('observacionesEmpresa') && '*'}</label>
                        <textarea 
                          name="observacionesEmpresa" 
                          className="form-control" 
                          value={formData.observacionesEmpresa} 
                          onChange={handleChange} 
                          required={isReq('observacionesEmpresa')}
                          placeholder="Añade notas o comentarios relevantes sobre el alta de este empleado..."
                          style={{ minHeight: '80px', resize: 'vertical', width: '100%', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px' }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ✅ PESTAÑA 3: OPERADOR */}
              {pestañaActiva === 'operador' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div className="strict-3-col-grid">
                    {isVis('gastosAsignados') ? (
                    <div className="form-group">
                      <label className="form-label">Gastos Asignados ($) {isReq('gastosAsignados') && '*'}</label>
                      <input type="number" name="gastosAsignados" className="form-control" value={formData.gastosAsignados} onChange={handleChange} required={isReq('gastosAsignados')} />
                    </div>
                    ) : <div style={{ color: '#8b949e', gridColumn: '1 / -1' }}>No tienes permiso para ver esta información.</div>}
                  </div>
                </div>
              )}

              {/* ✅ PESTAÑA 4: HERRAMIENTAS */}
              {pestañaActiva === 'herramientas' && (
                <div style={{ animation: 'fadeIn 0.2s ease' }}>
                  <div className="strict-3-col-grid">
                    {isVis('telefonoAsignado') ? (
                    <div className="form-group">
                      <label className="form-label">Teléfono Asignado (Flota) {isReq('telefonoAsignado') && '*'}</label>
                      <input type="tel" name="telefonoAsignado" className="form-control" value={formData.telefonoAsignado} onChange={handleChange} required={isReq('telefonoAsignado')} />
                    </div>
                    ) : <div style={{ color: '#8b949e', gridColumn: '1 / -1' }}>No tienes permiso para ver esta información.</div>}
                  </div>
                </div>
              )}

            </form>
          </div>

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
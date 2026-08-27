// src/features/empleados/components/EmployeeForm.tsx
import React, { useState, useEffect } from 'react';
import { ModalAccesoCampo } from '../../autorizaciones/ModalAccesoCampo';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos';
import { collection, onSnapshot, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal';
import { guardarEmpleadoConTransaccion } from '../../../services/employeeService';
import { FormularioDireccion } from '../../direcciones/components/FormularioDireccion';
import type { Employee } from '../../../types/empleado';
import './EmployeeForm.css';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';

// Roles disponibles en la empresa
const ROLES_DISPONIBLES = ['Administrador', 'Recursos Humanos', 'Operaciones', 'Contabilidad', 'Gerencia'];

// Tipos de documento que se manejan para EMPLEADOS (edítalos a tu gusto)
export const TIPOS_DOCUMENTO_EMPLEADO = [
  '1. Acta de Nacimiento',
  '2. CURP',
  '3. RFC (Constancia de Situación Fiscal)',
  '4. Identificación Oficial (INE)',
  '5. Comprobante de Domicilio',
  '6. Comprobante de Estudios',
  '7. Número de Seguro Social (NSS)',
  '8. Estado de Cuenta Bancario',
  '9. Licencia de Conducir',
  '10. Examen Médico',
  '11. Carta de Recomendación',
  '12. Carta de No Antecedentes Penales',
  '13. Currículum Vitae',
  '14. Solicitud de Empleo',
  '15. Aviso de Retención INFONAVIT',
  '16. Contrato Laboral',
  '17. Convenio de Confidencialidad',
  '18. Reglamento Interno (Firmado)',
  '19. Constancia de Capacitación',
  '20. Otro',
];

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
    <div className="ef-x1">
      <input type="text" className="form-control" placeholder={placeholder} value={isOpen ? searchTerm : selectedLabel} onChange={(e) => { setSearchTerm(e.target.value); setIsOpen(true); }} onFocus={() => { setSearchTerm(''); setIsOpen(true); }} onBlur={() => { setTimeout(() => setIsOpen(false), 200); setSearchTerm(selectedLabel); }} required={required && !value} style={{ backgroundColor: '#010409', border: isOpen ? '1px solid #3b82f6' : '1px solid #30363d', color: '#c9d1d9', width: '100%' }} />
      {isOpen && (
        <ul className="ef-x2">
          {filteredOptions.length > 0 ? filteredOptions.map(opt => (
            <li className="ef-x3" key={opt.id} onClick={() => { onChange(opt.id, opt.label); setSearchTerm(opt.label); setIsOpen(false); }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>{opt.label}</li>
          )) : <li className="ef-x4">Sin resultados</li>}
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
    <div className="ef-x1">
      {required && <input className="ef-x5" type="text" value={selectedIds.length > 0 ? 'valid' : ''} required readOnly />}
      <div onClick={() => setIsOpen(!isOpen)} style={{ padding: '8px 12px', backgroundColor: '#010409', border: isOpen ? '1px solid #3b82f6' : '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', cursor: 'pointer', minHeight: '38px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
        {selectedIds.length === 0 ? <span className="ef-x6">Seleccione operaciones...</span> : selectedIds.map(id => {
          const opt = options.find(o => o.id === id);
          return opt ? <span className="ef-x7" key={id}>{opt.label} ✕</span> : null;
        })}
      </div>
      {isOpen && (
        <div className="ef-x8">
          {options.map(opt => (
            <label className="ef-x9" key={opt.id}>
              <input className="ef-x10" type="checkbox" checked={selectedIds.includes(opt.id)} onChange={() => toggleSelect(opt.id)} /> {opt.label}
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
    <div className="modal-overlay ef-x11">
      <div className="form-card ef-x12">
        <div className="form-header ef-x13">
          <h3 className="ef-x14">⚙️ Configuración de Campos y Accesos</h3>
          <button className="ef-x15" type="button" onClick={onClose}>✕</button>
        </div>
        
        <div className="ef-x16">
          <p className="ef-x17">Define qué campos son obligatorios y qué roles de usuario tienen permiso para verlos.</p>
          <div className="ef-x18">
            {fields.map(f => {
              const rolesPermitidos = fieldRoles[f.name] || ROLES_DISPONIBLES;
              return (
              <div className="ef-x19" key={f.name}>
                <h4 className="ef-x20">{f.label}</h4>
                <label className="ef-x21">
                  <input className="ef-x22" type="checkbox" checked={requiredFields.includes(f.name)} onChange={() => toggleRequired(f.name)} /> 
                  Hacer Obligatorio
                </label>
                <div className="ef-x23">Roles que pueden ver este campo:</div>
                <div className="ef-x24">
                  {ROLES_DISPONIBLES.map(rol => {
                    const hasAccess = rolesPermitidos.includes(rol);
                    return (
                      <label key={rol} style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', color: hasAccess ? '#c9d1d9' : '#8b949e', cursor: 'pointer', opacity: hasAccess ? 1 : 0.5 }}>
                        <input className="ef-x10" type="checkbox" checked={hasAccess} onChange={() => toggleRole(f.name, rol)} /> 
                        {rol}
                      </label>
                    );
                  })}
                </div>
              </div>
            )})}
          </div>
        </div>
        <div className="ef-x25">
          <button type="button" className="btn-primary ef-x26" onClick={onClose}>Guardar Cambios</button>
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
  const todayISO = hoyLocalISO();
  
  const estadoInicial: Employee & { fechaBaja?: string, observacionBaja?: string, observacionesEmpresa?: string } = {
    employeeId: 'Generando...', 
    activo: true, foto: '', firstName: '', lastNamePaternal: '', lastNameMaternal: '', alias: '', rfc: '', birthDate: '', mapsLink: '', addressId: '', addressLabel: '', personalPhone: '', personalEmail: '', emergencyContactName: '', emergencyContactPhone: '', cargoId: '', cargoNombre: '', departamentoId: '', departamentoNombre: '', operacionesIds: [], empresaId: '', empresaNombre: '', fechaIngreso: todayISO, fechaAltaIMSS: '', salarioDiario: 0, descuentoIMSS: 0, descuentoInfonavit: 0, gastosAsignados: 0, telefonoAsignado: '', fechaBaja: '', observacionBaja: '', observacionesEmpresa: ''
  };

  const [formData, setFormData] = useState<any>(estadoInicial);
  const [cargando, setCargando] = useState(false);
  const [modalDireccionAbierto, setModalDireccionAbierto] = useState(false);
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false);
  
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

  // ✅ V00140: este formulario respeta Autorizaciones (campos bloqueados + acciones)
  const aut = useAutorizacionesCampos('colaboradores');
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (aut.campoBloqueado((e.target as any).name)) { aut.abrirSolicitudAcceso((e.target as any).name); return; }
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
    // ✅ V00140: reglas de acción (crear/editar) de Autorizaciones
    if (!aut.verificarAccion(initialData?.id ? 'editar' : 'crear', Object.keys(formData || {}))) return;
    e.preventDefault();
    
    if (!formData.employeeId || formData.employeeId.trim() === '' || formData.employeeId === 'Generando...') {
      return alert('El Número de Empleado (Ej. Col-001) es estrictamente necesario.');
    }

    if (!formData.activo && (!formData.fechaBaja || !formData.observacionBaja)) {
      return alert('Para dar de baja a un empleado debe ingresar obligatoriamente la Fecha de Baja y el Motivo.');
    }

    for (const campo of configuracionCampos) {
      if (isVis(campo.name) && isReq(campo.name)) {
        const valor = (formData as any)[campo.name];
        if (!valor || (Array.isArray(valor) && valor.length === 0)) {
          return alert(`El campo "${campo.label}" es obligatorio.`);
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
      {/* ✅ V00141: modal de acceso a campo bloqueado */}
      <ModalAccesoCampo aut={aut} />
      <style>{`
        .strict-3-col-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
        @media (max-width: 768px) { .strict-3-col-grid { grid-template-columns: 1fr; } }
      `}</style>

      <FieldConfigModal isOpen={isConfigOpen} onClose={() => setIsConfigOpen(false)} fields={configuracionCampos} requiredFields={requiredFields} toggleRequired={toggleRequired} fieldRoles={fieldRoles} toggleRole={toggleRole} />

      <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`} style={{ backdropFilter: 'blur(4px)', zIndex: 1000 }}>
        <div className="form-card ef-x27">
          
          <div className="form-header ef-x28">
            <h2 className="ef-x29">
              {estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Empleado` : 'Alta de Empleado')}
              <span style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: '12px', backgroundColor: formData.activo ? 'rgba(35, 134, 54, 0.2)' : 'rgba(218, 54, 51, 0.2)', color: formData.activo ? '#3fb950' : '#f85149', fontWeight: 'bold' }}>
                {formData.activo ? '🟢 Activo' : 'Baja'}
              </span>
            </h2>
            <div className="ef-x30">
              <button
                type="button"
                onClick={() => { if (!initialData) { alert('Guarda el empleado primero para poder subir documentos.'); return; } setMostrarSubirDoc(true); }}
                title={initialData ? 'Subir documentos del empleado' : 'Guarda el empleado primero para subir documentos'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 14px', borderRadius: '6px', border: 'none', backgroundColor: initialData ? '#D84315' : '#21262d', color: initialData ? '#fff' : '#6e7681', cursor: initialData ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '0.82rem' }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                Subir Documentos
              </button>
              <button type="button" onClick={() => setIsConfigOpen(true)} className="btn-window ef-x31" title="Configurar campos y accesos">⚙️</button>
              {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
              <button type="button" onClick={onClose} className="btn-window close ef-x15">✕</button>
            </div>
          </div>

          <div className="ef-x32">
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
              
              {/* PESTAÑA 1 */}
              {pestañaActiva === 'personales' && (
                <div className="ef-x33">
                  
                  {isVis('activo') && (
                    <div style={{ gridColumn: '1 / -1', backgroundColor: '#161b22', padding: '20px', borderRadius: '8px', border: formData.activo ? '1px solid #30363d' : '1px solid #f85149', marginBottom: '24px' }}>
                      <div className="ef-x34">
                        <div>
                          <span className="ef-x35">Gestión de Estado</span>
                          {formData.activo ? (
                            <span className="ef-x36">Empleado habilitado en el sistema</span>
                          ) : (
                            <span className="ef-x37">Empleado dado de baja</span>
                          )}
                        </div>
                        <div>
                          {formData.activo ? (
                            <button className="ef-x38" type="button" onClick={handleDarDeBaja}>Dar de Baja</button>
                          ) : (
                            <button className="ef-x39" type="button" onClick={handleReactivar}>Reactivar Empleado</button>
                          )}
                        </div>
                      </div>
                      
                      {!formData.activo && (
                        <div className="ef-x40">
                          <div className="form-group">
                            <label className="form-label ef-x41">Fecha de Baja *</label>
                            <input type="date" name="fechaBaja" className="form-control" value={formData.fechaBaja || ''} onChange={handleChange} required />
                          </div>
                          <div className="form-group">
                            <label className="form-label ef-x41">Observación / Motivo de Baja *</label>
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
                        className="form-control ef-x42" 
                        value={formData.employeeId} 
                        onChange={handleChange}
                        required 
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
                    <div className="form-group ef-x43">
                      <label className="form-label ef-x44">Dirección Exacta {isReq('addressId') && '*'}</label>
                      <div className="ef-x45">
                        <div className="ef-x46">
                          <SearchableSelect options={direccionesDB} value={formData.addressId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, addressId: id, addressLabel: label }))} required={isReq('addressId')} />
                        </div>
                        <button type="button" className="btn btn-outline" onClick={() => setModalDireccionAbierto(true)}>+ Nueva</button>
                        <button type="button" className="btn btn-primary ef-x47" onClick={abrirGoogleMaps}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                          Maps
                        </button>
                      </div>
                    </div>
                    )}
                    {isVis('mapsLink') && <div className="form-group ef-x48"><label className="form-label">Enlace Google Maps {isReq('mapsLink') && '*'}</label><input type="url" name="mapsLink" className="form-control" value={formData.mapsLink} onChange={handleChange} placeholder="https://maps.google.com/..." required={isReq('mapsLink')} /></div>}
                    
                    {isVis('emergencyContactName') && <><div className="form-group ef-x48"><hr className="ef-x49" /></div><div className="form-group"><label className="form-label ef-x50">Contacto de Emergencia {isReq('emergencyContactName') && '*'}</label><input type="text" name="emergencyContactName" className="form-control" value={formData.emergencyContactName} onChange={handleChange} required={isReq('emergencyContactName')} /></div></>}
                    {isVis('emergencyContactPhone') && <div className="form-group"><label className="form-label ef-x50">Teléfono Emergencia {isReq('emergencyContactPhone') && '*'}</label><input type="tel" name="emergencyContactPhone" className="form-control" value={formData.emergencyContactPhone} onChange={handleChange} required={isReq('emergencyContactPhone')} /></div>}
                  </div>
                </div>
              )}

              {/* PESTAÑA 2: ALTA DE LA EMPRESA */}
              {pestañaActiva === 'empresa' && (
                <div className="ef-x33">
                  <div className="strict-3-col-grid">
                    {isVis('empresaId') && <div className="form-group"><label className="form-label">Empresa {isReq('empresaId') && '*'}</label><SearchableSelect options={empresasDB} value={formData.empresaId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, empresaId: id, empresaNombre: label }))} required={isReq('empresaId')} /></div>}
                    {isVis('cargoId') && <div className="form-group"><label className="form-label">Cargo {isReq('cargoId') && '*'}</label><SearchableSelect options={cargosDB} value={formData.cargoId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, cargoId: id, cargoNombre: label }))} required={isReq('cargoId')} /></div>}
                    {isVis('departamentoId') && <div className="form-group"><label className="form-label">Departamento {isReq('departamentoId') && '*'}</label><SearchableSelect options={departamentosDB} value={formData.departamentoId} onChange={(id, label) => setFormData((prev:any) => ({ ...prev, departamentoId: id, departamentoNombre: label }))} required={isReq('departamentoId')} /></div>}
                    
                    {isVis('operacionesIds') && (
                    <div className="form-group ef-x48">
                      <label className="form-label">Operaciones Autorizadas {isReq('operacionesIds') && '*'}</label>
                      <MultiSelect options={operacionesDB} selectedIds={formData.operacionesIds} onChange={(ids) => setFormData((prev:any) => ({ ...prev, operacionesIds: ids }))} required={isReq('operacionesIds')} />
                    </div>
                    )}
                    
                    {isVis('fechaIngreso') && <div className="form-group"><label className="form-label">Fecha de Ingreso {isReq('fechaIngreso') && '*'}</label><input type="date" name="fechaIngreso" className="form-control" value={formData.fechaIngreso} onChange={handleChange} required={isReq('fechaIngreso')} /></div>}
                    {isVis('fechaAltaIMSS') && <div className="form-group"><label className="form-label">Fecha Alta IMSS {isReq('fechaAltaIMSS') && '*'}</label><input type="date" name="fechaAltaIMSS" className="form-control" value={formData.fechaAltaIMSS} onChange={handleChange} required={isReq('fechaAltaIMSS')} /></div>}
                    
                    {isVis('salarioDiario') && <><div className="form-group ef-x48"><hr className="ef-x49" /></div><div className="form-group"><label className="form-label">Salario Diario Integrado ($) {isReq('salarioDiario') && '*'}</label><input type="number" name="salarioDiario" className="form-control" value={formData.salarioDiario} onChange={handleChange} required={isReq('salarioDiario')} /></div></>}
                    {isVis('descuentoIMSS') && <div className="form-group"><label className="form-label">Descuento IMSS ($) {isReq('descuentoIMSS') && '*'}</label><input type="number" name="descuentoIMSS" className="form-control" value={formData.descuentoIMSS} onChange={handleChange} required={isReq('descuentoIMSS')} /></div>}
                    {isVis('descuentoInfonavit') && <div className="form-group"><label className="form-label">Descuento INFONAVIT ($) {isReq('descuentoInfonavit') && '*'}</label><input type="number" name="descuentoInfonavit" className="form-control" value={formData.descuentoInfonavit} onChange={handleChange} required={isReq('descuentoInfonavit')} /></div>}
                    
                    {isVis('observacionesEmpresa') && (
                      <div className="form-group ef-x51">
                        <label className="form-label text-gray-400">Observaciones {isReq('observacionesEmpresa') && '*'}</label>
                        <textarea 
                          name="observacionesEmpresa" 
                          className="form-control ef-x52" 
                          value={formData.observacionesEmpresa} 
                          onChange={handleChange} 
                          required={isReq('observacionesEmpresa')}
                          placeholder="Añade notas o comentarios relevantes sobre el alta de este empleado..."
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* PESTAÑA 3: OPERADOR */}
              {pestañaActiva === 'operador' && (
                <div className="ef-x33">
                  <div className="strict-3-col-grid">
                    {isVis('gastosAsignados') ? (
                    <div className="form-group">
                      <label className="form-label">Gastos Asignados ($) {isReq('gastosAsignados') && '*'}</label>
                      <input type="number" name="gastosAsignados" className="form-control" value={formData.gastosAsignados} onChange={handleChange} required={isReq('gastosAsignados')} />
                    </div>
                    ) : <div className="ef-x53">No tienes permiso para ver esta información.</div>}
                  </div>
                </div>
              )}

              {/* PESTAÑA 4: HERRAMIENTAS */}
              {pestañaActiva === 'herramientas' && (
                <div className="ef-x33">
                  <div className="strict-3-col-grid">
                    {isVis('telefonoAsignado') ? (
                    <div className="form-group">
                      <label className="form-label">Teléfono Asignado (Flota) {isReq('telefonoAsignado') && '*'}</label>
                      <input type="tel" name="telefonoAsignado" className="form-control" value={formData.telefonoAsignado} onChange={handleChange} required={isReq('telefonoAsignado')} />
                    </div>
                    ) : <div className="ef-x53">No tienes permiso para ver esta información.</div>}
                  </div>
                </div>
              )}

            </form>
          </div>

          <div className="form-actions" style={{ display: estado === 'minimizado' ? 'none' : 'flex', gap: '16px', justifyContent: 'flex-end', borderTop: '1px solid #30363d', padding: '16px 24px', backgroundColor: '#161b22', borderBottomLeftRadius: '12px', borderBottomRightRadius: '12px', flexShrink: 0 }}>
            <button type="button" onClick={onClose} className="btn btn-outline ef-x54">Cancelar</button>
            <button type="submit" form="employeeForm" disabled={cargando} className="btn btn-primary ef-x55">
              {cargando ? 'Guardando...' : 'Guardar Empleado'}
            </button>
          </div>

        </div>
      </div>

      {modalDireccionAbierto && (
        <div className="ef-x56">
          <FormularioDireccion estado="abierto" onClose={() => setModalDireccionAbierto(false)} />
        </div>
      )}

      <DocumentoUploadModal
        isOpen={mostrarSubirDoc}
        onClose={() => setMostrarSubirDoc(false)}
        coleccionOrigen="empleados"
        registroId={(initialData as any)?.id || formData.employeeId || ''}
        registroNombre={`${formData.firstName || ''} ${formData.lastNamePaternal || ''} ${formData.lastNameMaternal || ''}`.replace(/\s+/g, ' ').trim()}
        tiposDocumento={TIPOS_DOCUMENTO_EMPLEADO}
      />
    </>
  );
};
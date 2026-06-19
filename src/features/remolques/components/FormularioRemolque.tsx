// src/features/remolques/components/FormularioRemolque.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import type { RemolqueRecord } from '../../../types/remolque'; // ✅ RUTA CORREGIDA

// ──────────────────────────────────────────────────────────────────────
// ✅ NUEVO (config de campos obligatorios, COMPARTIDA por todos los usuarios)
// Se guarda en Firestore: config_campos_obligatorios/remolques
// ──────────────────────────────────────────────────────────────────────
const FORM_ID = 'remolques';
const CAMPOS_CONFIGURABLES: { key: string; label: string }[] = [
  { key: 'nombre', label: 'Nombre del Remolque' },
  { key: 'propietarioId', label: 'Propietario' },
  { key: 'tipoId', label: 'Tipo de Remolque' },
  { key: 'placas', label: 'Placas' },
  { key: 'serie', label: 'Número de Serie' },
  { key: 'marca', label: 'Marca' },
  { key: 'anio', label: 'Año' },
  { key: 'paisId', label: 'País' },
  { key: 'estadoId', label: 'Estado / Entidad' },
];
const OBLIGATORIOS_DEFAULT: Record<string, boolean> = {
  nombre: true, propietarioId: true, tipoId: true, placas: true, serie: true,
  marca: false, anio: true, paisId: true, estadoId: true,
};

const esVacioValor = (v: any): boolean => {
  if (v === undefined || v === null) return true;
  return String(v).trim() === '';
};

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
          setTimeout(() => setIsOpen(false), 200);
          setSearchTerm(selectedLabel); 
        }}
        required={required && !value} 
        style={{ cursor: 'text', border: isOpen ? '1px solid #3b82f6' : '', backgroundColor: '#010409', color: '#c9d1d9' }}
      />
      
      {isOpen && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, maxHeight: '200px', overflowY: 'auto',
          backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '4px', marginTop: '4px',
          padding: '0', listStyle: 'none', zIndex: 1000, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.5)'
        }}>
          {filteredOptions.length > 0 ? (
            filteredOptions.map(opt => (
              <li
                key={opt.id}
                onClick={() => { onChange(opt.id, opt.label); setSearchTerm(opt.label); setIsOpen(false); }}
                style={{ padding: '8px 12px', cursor: 'pointer', color: '#c9d1d9', borderBottom: '1px solid #21262d', fontSize: '0.85rem' }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#21262d'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
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
  initialData?: RemolqueRecord | null;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioRemolque = ({ estado, initialData, onClose, onMinimize, onRestore }: FormProps) => {
  const [formData, setFormData] = useState<RemolqueRecord>({
    nombre: '',
    tipoId: '',
    tipoNombre: '',
    placas: '',
    estadoId: '',
    estadoNombre: '',
    serie: '',
    marca: '',
    anio: new Date().getFullYear(),
    propietarioId: '',
    propietarioNombre: '',
    paisId: '',
    paisNombre: ''
  });

  const [cargando, setCargando] = useState(false);

  // Estados para los catálogos
  const [tiposRemolque, setTiposRemolque] = useState<{id: string, label: string}[]>([]);
  const [estadosCatalogo, setEstadosCatalogo] = useState<{id: string, label: string}[]>([]);
  const [paisesCatalogo, setPaisesCatalogo] = useState<{id: string, label: string}[]>([]);
  const [empresasPropietarias, setEmpresasPropietarias] = useState<{id: string, label: string}[]>([]);

  // ✅ NUEVO: configuración de campos obligatorios (compartida)
  const [obligatorios, setObligatorios] = useState<Record<string, boolean>>(OBLIGATORIOS_DEFAULT);
  const [modalConfig, setModalConfig] = useState(false);
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  const esOblig = (campo: string) => !!obligatorios[campo];

  // Carga la config compartida al montar (1 lectura)
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'config_campos_obligatorios', FORM_ID));
        if (activo && snap.exists() && snap.data().obligatorios) {
          setObligatorios({ ...OBLIGATORIOS_DEFAULT, ...(snap.data().obligatorios as Record<string, boolean>) });
        }
      } catch (e) {
        console.error('Error cargando configuración de campos obligatorios:', e);
      }
    })();
    return () => { activo = false; };
  }, []);

  const guardarConfigObligatorios = async () => {
    setGuardandoConfig(true);
    try {
      await setDoc(
        doc(db, 'config_campos_obligatorios', FORM_ID),
        { obligatorios, updatedAt: new Date().toISOString() },
        { merge: true }
      );
      setModalConfig(false);
    } catch (e) {
      console.error('Error guardando configuración:', e);
      alert('No se pudo guardar la configuración. Revisa tu conexión.');
    } finally {
      setGuardandoConfig(false);
    }
  };

  // Cargar todos los catálogos al montar el componente
  useEffect(() => {
    const cargarCatalogos = async () => {
      // 1. Catálogo de Tipos de Remolque
      try {
        const snapTipos = await getDocs(collection(db, 'catalogo_tipo_remolque'));
        setTiposRemolque(snapTipos.docs.map(doc => ({ id: doc.id, label: doc.data().nombre || doc.data().descripcion || `Tipo (${doc.id.substring(0,4)})` })));
      } catch (error) { console.error("Error al cargar tipos de remolque", error); }

      // 2. Catálogo de Estados
      try {
        const snapEstados = await getDocs(collection(db, 'catalogo_estados'));
        setEstadosCatalogo(snapEstados.docs.map(doc => ({ id: doc.id, label: doc.data().estado || doc.data().nombre || `Estado (${doc.id.substring(0,4)})` })));
      } catch (error) { console.error("Error al cargar estados", error); }

      // 3. Catálogo de Países
      try {
        const snapPaises = await getDocs(collection(db, 'catalogo_paises'));
        setPaisesCatalogo(snapPaises.docs.map(doc => ({ id: doc.id, label: doc.data().nombre || doc.data().pais || `País (${doc.id.substring(0,4)})` })));
      } catch (error) { console.error("Error al cargar países", error); }

      // 4. Catálogo de Empresas Propietarias (Escáner Universal filtrando por 5d92b3a2)
      try {
        let todasLasEmpresas: any[] = [];
        const coleccionesPosibles = ['empresa', 'empresas', 'catalogo_empresas'];
        
        for (const nombreCol of coleccionesPosibles) {
          try {
            const snap = await getDocs(collection(db, nombreCol));
            if (!snap.empty) {
              const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              todasLasEmpresas = [...todasLasEmpresas, ...docs];
            }
          } catch (e) { /* Ignorar si no existe */ }
        }

        const empresasUnicas = Array.from(new Map(todasLasEmpresas.map(item => [item.id, item])).values());
        const ID_PROPIETARIO = '5d92b3a2';
        
        const filtradas = empresasUnicas.filter((emp: any) => {
          if (Array.isArray(emp.tiposEmpresa)) return emp.tiposEmpresa.includes(ID_PROPIETARIO);
          const stringData = JSON.stringify(emp).toLowerCase();
          return stringData.includes(ID_PROPIETARIO.toLowerCase());
        });

        setEmpresasPropietarias(filtradas.map(emp => ({ 
          id: emp.id, 
          label: emp.nombre || emp.empresa || emp.razonSocial || `Empresa (${emp.id.substring(0,4)})` 
        })));
      } catch (error) { console.error("Error al cargar propietarios", error); }
    };

    cargarCatalogos();
  }, []);

  // Setear datos si es edición
  useEffect(() => {
    if (initialData) setFormData(initialData);
  }, [initialData]);

  // Manejadores de Inputs
  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev: RemolqueRecord) => ({ ...prev, [name]: value }));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev: RemolqueRecord) => ({ ...prev, [name]: parseInt(value, 10) || 0 }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // ✅ Validación según la configuración compartida de campos obligatorios
    const faltantes = CAMPOS_CONFIGURABLES.filter(c => esOblig(c.key) && esVacioValor((formData as any)[c.key]));
    if (faltantes.length > 0) {
      alert('Faltan campos obligatorios:\n\n• ' + faltantes.map(c => c.label).join('\n• '));
      return;
    }

    setCargando(true);
    try {
      if (initialData && initialData.id) {
        await actualizarRegistro('remolques', initialData.id, formData);
      } else {
        await agregarRegistro('remolques', formData);
      }
      onClose();
    } catch (error) {
      console.error("Error al guardar:", error);
      alert('Error al guardar el remolque. Revisa tu conexión.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card" style={{ maxWidth: '850px', backgroundColor: '#0d1117', border: '1px solid #30363d' }}>
        <div className="form-header" style={{ borderBottom: '1px solid #30363d' }}>
          <h2>{estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Remolque: ${formData.nombre}` : 'Nuevo Remolque')}</h2>
          <div className="header-actions">
            {/* ✅ NUEVO: botón de configuración de campos obligatorios */}
            <button type="button" onClick={() => setModalConfig(true)} className="btn-window" title="Configurar campos obligatorios" style={{ fontSize: '0.95rem' }}>⚙</button>
            {estado === 'abierto' ? (
              <button type="button" onClick={onMinimize} className="btn-window">🗕</button>
            ) : (
              <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>
            )}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '24px', maxHeight: '75vh', overflowY: 'auto' }}>
          <form onSubmit={handleSubmit}>
            
            {/* Grid Responsivo Avanzado (Auto-Fit) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
              
              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label className="form-label">Nombre del Remolque (Identificador) {esOblig('nombre') ? '*' : ''}</label>
                <input type="text" name="nombre" className="form-control" value={formData.nombre} onChange={handleTextChange} required={esOblig('nombre')} style={{ backgroundColor: '#010409', color: '#f0f6fc', fontWeight: 'bold', fontSize: '1.1rem' }} placeholder="Ej. R-105" />
              </div>

              <div className="form-group">
                <label className="form-label">Propietario {esOblig('propietarioId') ? '*' : ''}</label>
                <SearchableSelect 
                  options={empresasPropietarias}
                  value={formData.propietarioId}
                  onChange={(id, label) => setFormData((prev: RemolqueRecord) => ({ ...prev, propietarioId: id, propietarioNombre: label }))}
                  placeholder="Buscar Propietario..."
                  required={esOblig('propietarioId')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tipo de Remolque {esOblig('tipoId') ? '*' : ''}</label>
                <SearchableSelect 
                  options={tiposRemolque}
                  value={formData.tipoId}
                  onChange={(id, label) => setFormData((prev: RemolqueRecord) => ({ ...prev, tipoId: id, tipoNombre: label }))}
                  placeholder="Buscar Tipo..."
                  required={esOblig('tipoId')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Placas {esOblig('placas') ? '*' : ''}</label>
                <input type="text" name="placas" className="form-control" value={formData.placas} onChange={handleTextChange} required={esOblig('placas')} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Número de Serie {esOblig('serie') ? '*' : ''}</label>
                <input type="text" name="serie" className="form-control" value={formData.serie} onChange={handleTextChange} required={esOblig('serie')} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Marca {esOblig('marca') ? '*' : ''}</label>
                <input type="text" name="marca" className="form-control" value={formData.marca} onChange={handleTextChange} required={esOblig('marca')} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Año {esOblig('anio') ? '*' : ''}</label>
                <input type="number" name="anio" className="form-control" value={formData.anio} onChange={handleNumberChange} required={esOblig('anio')} min="1950" max="2100" style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">País {esOblig('paisId') ? '*' : ''}</label>
                <SearchableSelect 
                  options={paisesCatalogo}
                  value={formData.paisId}
                  onChange={(id, label) => setFormData((prev: RemolqueRecord) => ({ ...prev, paisId: id, paisNombre: label }))}
                  placeholder="Buscar País..."
                  required={esOblig('paisId')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Estado / Entidad {esOblig('estadoId') ? '*' : ''}</label>
                <SearchableSelect 
                  options={estadosCatalogo}
                  value={formData.estadoId}
                  onChange={(id, label) => setFormData((prev: RemolqueRecord) => ({ ...prev, estadoId: id, estadoNombre: label }))}
                  placeholder="Buscar Estado..."
                  required={esOblig('estadoId')}
                />
              </div>

            </div>

            <div className="form-actions" style={{ marginTop: '32px', borderTop: '1px solid #30363d', paddingTop: '20px' }}>
              <button type="button" onClick={onClose} className="btn btn-outline" style={{ backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d' }}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargando} style={{ backgroundColor: '#D84315', border: 'none' }}>
                {cargando ? 'Guardando...' : (initialData ? 'Guardar Cambios' : 'Registrar Remolque')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ✅ NUEVO: Modal de configuración de campos obligatorios (compartido) */}
      {modalConfig && (
        <div className="modal-overlay" style={{ zIndex: 3000, position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="form-card" style={{ maxWidth: '520px', width: '95%', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Campos obligatorios</h3>
              <button type="button" onClick={() => setModalConfig(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.82rem', marginTop: 0, marginBottom: '16px' }}>
              Marca qué campos serán obligatorios al guardar. Esta configuración se guarda y aplica para <b>todos los usuarios</b>.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
              {CAMPOS_CONFIGURABLES.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={esOblig(c.key)}
                    onChange={() => setObligatorios(prev => ({ ...prev, [c.key]: !prev[c.key] }))}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ color: esOblig(c.key) ? '#f0f6fc' : '#8b949e', fontWeight: esOblig(c.key) ? 600 : 400, fontSize: '0.85rem' }}>{c.label}</span>
                </label>
              ))}
            </div>
            <div className="form-actions" style={{ marginTop: '22px', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setModalConfig(false)} className="btn btn-outline" disabled={guardandoConfig}>Cancelar</button>
              <button type="button" onClick={guardarConfigObligatorios} className="btn btn-primary" disabled={guardandoConfig} style={{ backgroundColor: '#D84315', border: 'none' }}>
                {guardandoConfig ? 'Guardando...' : 'Guardar configuración'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
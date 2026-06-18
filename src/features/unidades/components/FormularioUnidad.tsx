// src/features/unidades/components/FormularioUnidad.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import type { UnidadRecord } from '../../../types/unidad'; // ✅ RUTA CORREGIDA
import { DocumentoUploadModal } from '../../documentos/DocumentoUploadModal'; // ✅ Modal reutilizable de documentos

// ✅ Tipos de documento sugeridos para Unidades Propias.
// Puedes editarlos libremente o, más adelante, leerlos del catálogo "Tipo de Archivo" (módulo Unidad).
export const TIPOS_DOCUMENTO_UNIDAD = [
  '1. Tarjeta de Circulación',
  '2. Factura de la Unidad',
  '3. Póliza de Seguro',
  '4. Permiso SCT (Federal)',
  '5. Verificación Físico-Mecánica',
  '6. Constancia de Peso y Dimensiones',
  '7. Calcomanía / Engomado',
  '8. Alta / Baja de Placas',
  '9. Contrato de Arrendamiento',
  '10. Pedimento de Importación',
  '11. TAG / AVI',
  '12. Expedición HAZMAT',
  '13. Otro',
];

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
  initialData?: UnidadRecord | null;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioUnidad = ({ estado, initialData, onClose, onMinimize, onRestore }: FormProps) => {
  const [formData, setFormData] = useState<UnidadRecord>({
    activo: true,
    propietarioUnidad: '',
    tipoUnidadId: '',
    tipoUnidadNombre: '',
    unidad: '',
    color: '',
    placas: '',
    serie: '',
    marca: '',
    modelo: '',
    clase: '',
    combustible: '',
    pesoVehicular: 0,
    ejes: 0,
    llantas: 0,
    toneladas: 0,
    alto: 0,
    ancho: 0,
    largo: 0,
    ejeDireccional: 0,
    ejeMotriz: 0,
    tagAvc: '',
    expedicionHazmat: '',
    tanqueUno: 0,
    tanqueDos: 0,
    porcentajeRecarga: 0
  });

  const [tiposUnidad, setTiposUnidad] = useState<{id: string, label: string}[]>([]);
  const [cargando, setCargando] = useState(false);
  const [mostrarSubirDoc, setMostrarSubirDoc] = useState(false); // ✅ Modal de documentos

  useEffect(() => {
    const cargarCatalogos = async () => {
      try {
        const snap = await getDocs(collection(db, 'catalogo_tipo_remolque'));
        const tipos = snap.docs.map(doc => ({
          id: doc.id,
          label: doc.data().nombre || `Desconocido (${doc.id.substring(0,4)})`
        }));
        setTiposUnidad(tipos);
      } catch (error) {
        console.error("Error cargando catálogo tipo_remolque:", error);
      }
    };
    cargarCatalogos();
  }, []);

  useEffect(() => {
    if (initialData) setFormData(initialData);
  }, [initialData]);

  // ✅ CORRECCIÓN DE TYPESCRIPT: (prev: UnidadRecord)
  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: UnidadRecord) => ({ ...prev, [name]: value }));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev: UnidadRecord) => ({ ...prev, [name]: parseFloat(value) || 0 }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData((prev: UnidadRecord) => ({ ...prev, [name]: checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.tipoUnidadId) {
      alert("Debes seleccionar un Tipo de Unidad.");
      return;
    }

    setCargando(true);
    try {
      if (initialData && initialData.id) {
        await actualizarRegistro('unidades', initialData.id, formData);
      } else {
        await agregarRegistro('unidades', formData);
      }
      onClose();
    } catch (error) {
      console.error("Error al guardar:", error);
      alert('Error al guardar. Revisa tu conexión.');
    } finally {
      setCargando(false);
    }
  };

  // ✅ id del registro para ligar documentos (solo existe cuando la unidad ya fue guardada)
  const unidadId = (initialData as any)?.id || '';
  const unidadNombre = formData.unidad || formData.placas || formData.serie || 'Unidad';

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card" style={{ maxWidth: '1000px', backgroundColor: '#0d1117', border: '1px solid #30363d' }}>
        <div className="form-header" style={{ borderBottom: '1px solid #30363d' }}>
          <h2>{estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Unidad: ${formData.unidad}` : 'Nueva Unidad Propia')}</h2>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* ✅ Botón Subir Documentos (solo visible con el formulario abierto) */}
            {estado === 'abierto' && (
              <button
                type="button"
                onClick={() => {
                  if (!unidadId) { alert('Guarda la unidad primero para poder adjuntarle documentos.'); return; }
                  setMostrarSubirDoc(true);
                }}
                title={unidadId ? 'Subir documentos de esta unidad' : 'Guarda la unidad primero'}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  backgroundColor: unidadId ? 'rgba(216, 67, 21, 0.15)' : '#21262d',
                  border: `1px solid ${unidadId ? '#D84315' : '#30363d'}`,
                  color: unidadId ? '#fb923c' : '#6e7681',
                  padding: '6px 12px', borderRadius: '6px',
                  cursor: unidadId ? 'pointer' : 'not-allowed', fontWeight: 600, fontSize: '0.82rem'
                }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                Subir Documentos
              </button>
            )}
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
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f0f6fc', fontWeight: 'bold', cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  name="activo" 
                  checked={formData.activo} 
                  onChange={handleCheckboxChange} 
                  style={{ width: '20px', height: '20px', accentColor: '#3fb950' }}
                />
                Unidad Activa / Disponible
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
              
              <div className="form-group">
                <label className="form-label">Tipo de Unidad (Remolque) *</label>
                {/* ✅ CORRECCIÓN DE TYPESCRIPT: (prev: UnidadRecord) */}
                <SearchableSelect 
                  options={tiposUnidad}
                  value={formData.tipoUnidadId}
                  onChange={(id, label) => setFormData((prev: UnidadRecord) => ({ ...prev, tipoUnidadId: id, tipoUnidadNombre: label }))}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">ID Propietario</label>
                <input type="text" name="propietarioUnidad" className="form-control" value={formData.propietarioUnidad} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Nombre de Unidad (Ej. R001) *</label>
                <input type="text" name="unidad" className="form-control" value={formData.unidad} onChange={handleTextChange} required style={{ backgroundColor: '#010409', color: '#c9d1d9', fontWeight: 'bold' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Placas *</label>
                <input type="text" name="placas" className="form-control" value={formData.placas} onChange={handleTextChange} required style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Número de Serie *</label>
                <input type="text" name="serie" className="form-control" value={formData.serie} onChange={handleTextChange} required style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Marca</label>
                <input type="text" name="marca" className="form-control" value={formData.marca} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Modelo (Año)</label>
                <input type="text" name="modelo" className="form-control" value={formData.modelo} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Color</label>
                <input type="text" name="color" className="form-control" value={formData.color} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Clase</label>
                <input type="text" name="clase" className="form-control" value={formData.clase} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Combustible</label>
                <select name="combustible" className="form-control" value={formData.combustible} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}>
                  <option value="">Seleccionar...</option>
                  <option value="Gasolina">Gasolina</option>
                  <option value="Diesel">Diesel</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Peso Vehicular (Kg)</label>
                <input type="number" name="pesoVehicular" className="form-control" value={formData.pesoVehicular} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Toneladas</label>
                <input type="number" name="toneladas" className="form-control" value={formData.toneladas} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">No. de Ejes</label>
                <input type="number" name="ejes" className="form-control" value={formData.ejes} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">No. de Llantas</label>
                <input type="number" name="llantas" className="form-control" value={formData.llantas} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Alto (m)</label>
                <input type="number" step="0.01" name="alto" className="form-control" value={formData.alto} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Ancho (m)</label>
                <input type="number" step="0.01" name="ancho" className="form-control" value={formData.ancho} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Largo (m)</label>
                <input type="number" step="0.01" name="largo" className="form-control" value={formData.largo} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Eje Direccional</label>
                <input type="number" name="ejeDireccional" className="form-control" value={formData.ejeDireccional} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Eje Motriz</label>
                <input type="number" name="ejeMotriz" className="form-control" value={formData.ejeMotriz} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">TAG AVC</label>
                <input type="text" name="tagAvc" className="form-control" value={formData.tagAvc} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Expedición HAZMAT</label>
                <input type="date" name="expedicionHazmat" className="form-control" value={formData.expedicionHazmat} onChange={handleTextChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Tanque 1 (Lts)</label>
                <input type="number" step="0.01" name="tanqueUno" className="form-control" value={formData.tanqueUno} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Tanque 2 (Lts)</label>
                <input type="number" step="0.01" name="tanqueDos" className="form-control" value={formData.tanqueDos} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

              <div className="form-group">
                <label className="form-label">Porcentaje Recarga (%)</label>
                <input type="number" step="0.01" name="porcentajeRecarga" className="form-control" value={formData.porcentajeRecarga} onChange={handleNumberChange} style={{ backgroundColor: '#010409', color: '#c9d1d9' }}/>
              </div>

            </div>

            <div className="form-actions" style={{ marginTop: '32px', borderTop: '1px solid #30363d', paddingTop: '20px' }}>
              <button type="button" onClick={onClose} className="btn btn-outline" style={{ backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d' }}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargando} style={{ backgroundColor: '#D84315', border: 'none' }}>
                {cargando ? 'Guardando...' : (initialData ? 'Guardar Cambios' : 'Registrar Unidad')}
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ✅ Modal reutilizable para subir documentos ligados a esta unidad */}
      <DocumentoUploadModal
        isOpen={mostrarSubirDoc}
        onClose={() => setMostrarSubirDoc(false)}
        coleccionOrigen="unidades"
        registroId={unidadId}
        registroNombre={unidadNombre}
        tiposDocumento={TIPOS_DOCUMENTO_UNIDAD}
      />
    </div>
  );
};
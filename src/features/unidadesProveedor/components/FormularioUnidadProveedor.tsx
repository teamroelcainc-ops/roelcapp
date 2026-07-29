// src/features/unidadesProveedor/components/FormularioUnidadProveedor.tsx
import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import type { UnidadProveedorRecord } from '../../../types/unidadProveedor';
import './FormularioUnidadProveedor.css';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: UnidadProveedorRecord | null;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioUnidadProveedor = ({ estado, initialData, onClose, onMinimize, onRestore }: FormProps) => {
  const [formData, setFormData] = useState<UnidadProveedorRecord>({
    proveedorId: '',
    proveedorNombre: '',
    numeroUnidad: '',
    numeroSerie: '',
    placas: '',
    pais: '',
    estadoUbicacion: ''
  });

  const [empresasProveedoras, setEmpresasProveedoras] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  // Obtener y filtrar empresas inteligentemente
  useEffect(() => {
    const obtenerProveedores = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'empresas'));
        const todasLasEmpresas = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // El ID explícito que solicitaste
        const ID_PROVEEDOR = 'ca21ab07';

        const filtradas = todasLasEmpresas.filter((emp: any) => {
          // Si tiene el formato nuevo de Array
          if (Array.isArray(emp.tiposEmpresa)) {
            return emp.tiposEmpresa.some((valor: string) => 
              valor === ID_PROVEEDOR || valor.toLowerCase().includes('proveedor (transporte)')
            );
          }
          // Respaldo agresivo por si el valor viene como un String viejo
          const stringData = JSON.stringify(emp).toLowerCase();
          return stringData.includes(ID_PROVEEDOR.toLowerCase()) || stringData.includes('proveedor (transporte)');
        });
        
        setEmpresasProveedoras(filtradas);
      } catch (error) {
        console.error("Error al obtener proveedores:", error);
      }
    };
    obtenerProveedores();
  }, []);

  // Cargar datos iniciales si se está editando
  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleProveedorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idSeleccionado = e.target.value;
    const empresaEncontrada = empresasProveedoras.find(emp => emp.id === idSeleccionado);
    
    setFormData(prev => ({
      ...prev,
      proveedorId: idSeleccionado,
      proveedorNombre: empresaEncontrada ? empresaEncontrada.nombre || empresaEncontrada.empresa : '' 
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      if (initialData && initialData.id) {
        await actualizarRegistro('unidades_proveedor', initialData.id, formData);
      } else {
        await agregarRegistro('unidades_proveedor', formData);
      }
      onClose();
    } catch (error) {
      console.error("Error al guardar en Firebase:", error);
      alert('Error al guardar. Revisa tu conexión a internet.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card fup-x1">
        <div className="form-header">
          <h2>{estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Unidad` : 'Nueva Unidad de Proveedor')}</h2>
          <div className="header-actions">
            {estado === 'abierto' ? (
              <button type="button" onClick={onMinimize} className="btn-window">🗕</button>
            ) : (
              <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>
            )}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '10px 0' }}>
          <form onSubmit={handleSubmit}>
            <div className="form-grid fup-x2">
              
              <div className="form-group fup-x3">
                <label className="form-label">Proveedor (Transporte) *</label>
                <select 
                  className="form-control" 
                  value={formData.proveedorId} 
                  onChange={handleProveedorChange} 
                  required
                >
                  <option value="">Seleccione un proveedor...</option>
                  {empresasProveedoras.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.nombre || emp.empresa || `Proveedor ID: ${emp.id}`}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label"># De Unidad *</label>
                <input type="text" name="numeroUnidad" className="form-control" value={formData.numeroUnidad} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">Serie *</label>
                <input type="text" name="numeroSerie" className="form-control" value={formData.numeroSerie} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">Placas *</label>
                <input type="text" name="placas" className="form-control" value={formData.placas} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">País *</label>
                <input type="text" name="pais" className="form-control" value={formData.pais} onChange={handleChange} required />
              </div>

              <div className="form-group fup-x3">
                <label className="form-label">Estado *</label>
                <input type="text" name="estadoUbicacion" className="form-control" value={formData.estadoUbicacion} onChange={handleChange} required />
              </div>

            </div>

            <div className="form-actions fup-x4">
              <button type="button" onClick={onClose} className="btn btn-outline">Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargando}>
                {cargando ? 'Guardando...' : (initialData ? 'Guardar Cambios' : 'Guardar')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};


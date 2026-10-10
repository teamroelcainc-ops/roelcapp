// src/features/unidadesProveedor/components/FormularioUnidadProveedor.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { ModalAccesoCampo } from '../../autorizaciones/ModalAccesoCampo';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos';
import { camposModificadosDe } from '../../autorizaciones/autorizaciones';
import { agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import { useCatalogo } from '../../../shared/data/catalogos';
import { TIPO_EMPRESA } from '../../../shared/dominio/constantes';
import type { UnidadProveedorRecord } from '../../../types/unidadProveedor';
import './FormularioUnidadProveedor.css';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';

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

  const [cargando, setCargando] = useState(false);

  // Obtener y filtrar empresas inteligentemente
  // ✅ V00439 (Fase 3.x): `empresas` del listener compartido de catálogos (antes getDocs propio).
  const { datos: empresasCat } = useCatalogo('empresas');
  const empresasProveedoras = useMemo(() => {
    // El ID explícito que solicitaste (TIPO_EMPRESA.proveedorUnidad = ca21ab07)
    const ID_PROVEEDOR: string = TIPO_EMPRESA.proveedorUnidad;
    return empresasCat.filter((emp) => {
      // Si tiene el formato nuevo de Array
      if (Array.isArray(emp.tiposEmpresa)) {
        return emp.tiposEmpresa.some((valor: unknown) =>
          valor === ID_PROVEEDOR || String(valor).toLowerCase().includes('proveedor (transporte)')
        );
      }
      // Respaldo agresivo por si el valor viene como un String viejo
      const stringData = JSON.stringify(emp).toLowerCase();
      return stringData.includes(ID_PROVEEDOR.toLowerCase()) || stringData.includes('proveedor (transporte)');
    });
  }, [empresasCat]);

  // Cargar datos iniciales si se está editando
  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  // ✅ V00142: este formulario respeta Autorizaciones
  const aut = useAutorizacionesCampos('unidadesProveedor');
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (aut.campoBloqueado((e.target as any).name)) { aut.abrirSolicitudAcceso((e.target as any).name); return; }
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleProveedorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idSeleccionado = e.target.value;
    const empresaEncontrada = empresasProveedoras.find(emp => emp.id === idSeleccionado);
    
    setFormData(prev => ({
      ...prev,
      proveedorId: idSeleccionado,
      proveedorNombre: empresaEncontrada ? (empresaEncontrada.nombre || empresaEncontrada.empresa) as string : '' 
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    // ✅ V00142: reglas de Autorizaciones
    if (!aut.verificarAccion(initialData?.id ? 'editar' : 'crear', camposModificadosDe((formData || {}) as unknown as Record<string, unknown>, (initialData || {}) as unknown as Record<string, unknown>), (initialData || {}) as unknown as Record<string, unknown>) /* ✅ V00382: solo lo que REALMENTE cambió */) return;
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
      <ModalAccesoCampo aut={aut} />
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
          <FormularioConfigurable modulo="unidadesProveedor">{/* ✅ V00385 */}
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
                    <option key={emp.id} value={emp.id}>{String(emp.nombre || emp.empresa || `Proveedor ID: ${emp.id}`)}</option>
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
          </FormularioConfigurable>
        </div>
      </div>
    </div>
  );
};


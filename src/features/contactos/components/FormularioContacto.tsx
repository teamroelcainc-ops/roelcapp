import React, { useState, useEffect, useMemo } from 'react';
import { ModalAccesoCampo } from '../../autorizaciones/ModalAccesoCampo';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos';
import { camposModificadosDe } from '../../autorizaciones/autorizaciones';
import { agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import { idReal, useCatalogo } from '../../../shared/data/catalogos';
import './FormularioContacto.css';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';

interface Props {
  estado: 'cerrado' | 'abierto' | 'minimizado';
  initialData: any | null;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioContacto: React.FC<Props> = ({ estado, initialData, onClose, onMinimize, onRestore }) => {
  const [formData, setFormData] = useState({
    id_cliente: '',
    persona_encargada: '',
    puesto: '',
    telefono: '',
    correo: ''
  });

  // ✅ V00439 (Fase 3.x): empresas del listener compartido de catálogos (antes onSnapshot propio).
  const { datos: empresasCat } = useCatalogo('empresas');
  const empresas = useMemo(
    () => empresasCat.map(d => ({ id: idReal(d), nombre: String(d.nombre || 'Sin nombre') })),
    [empresasCat],
  );
  const [busquedaEmpresa, setBusquedaEmpresa] = useState('');
  const [mostrarDropdown, setMostrarDropdown] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Cargar datos si es edición
  useEffect(() => {
    if (initialData) {
      setFormData({
        id_cliente: initialData.id_cliente || '',
        persona_encargada: initialData.persona_encargada || '',
        puesto: initialData.puesto || '',
        telefono: initialData.telefono || '',
        correo: initialData.correo || ''
      });
      // Buscar el nombre de la empresa para el input del buscador
      if (initialData.id_cliente && empresas.length > 0) {
        const emp = empresas.find(e => e.id === initialData.id_cliente);
        if (emp) setBusquedaEmpresa(emp.nombre);
      }
    } else {
      setFormData({ id_cliente: '', persona_encargada: '', puesto: '', telefono: '', correo: '' });
      setBusquedaEmpresa('');
    }
  }, [initialData, empresas]);

  // Filtrar empresas en el buscador
  const empresasFiltradas = useMemo(() => {
    if (!busquedaEmpresa) return empresas;
    return empresas.filter(emp => emp.nombre.toLowerCase().includes(busquedaEmpresa.toLowerCase()));
  }, [busquedaEmpresa, empresas]);

  const seleccionarEmpresa = (emp: any) => {
    setFormData({ ...formData, id_cliente: emp.id });
    setBusquedaEmpresa(emp.nombre);
    setMostrarDropdown(false);
  };

  // ✅ V00142: este formulario respeta Autorizaciones
  const aut = useAutorizacionesCampos('contactos');
  const handleSubmit = async (e: React.FormEvent) => {
    // ✅ V00142: reglas de Autorizaciones
    if (!aut.verificarAccion(initialData?.id ? 'editar' : 'crear', camposModificadosDe((formData || {}) as unknown as Record<string, unknown>, (initialData || {}) as unknown as Record<string, unknown>), (initialData || {}) as unknown as Record<string, unknown>) /* ✅ V00382: solo lo que REALMENTE cambió */) return;
    e.preventDefault();
    if (!formData.id_cliente) return alert("Por favor, selecciona una empresa válida del buscador.");
    
    setGuardando(true);
    try {
      if (initialData?.id) {
        await actualizarRegistro('contactos', initialData.id, formData);
      } else {
        await agregarRegistro('contactos', formData);
      }
      onClose();
    } catch (error) {
      alert("Error al guardar el contacto.");
    } finally {
      setGuardando(false);
    }
  };

  if (estado === 'cerrado') return null;

  if (estado === 'minimizado') {
    return (
      <div className="fct-x1">
      <ModalAccesoCampo aut={aut} />
        <span className="fct-x2">{initialData ? 'Editando Contacto' : 'Nuevo Contacto'}</span>
        <div className="fct-x3">
          <button className="fct-x4" onClick={onRestore}>🗖 Restaurar</button>
          <button className="fct-x5" onClick={onClose}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay fct-x6">
      <div className="fct-x7">
        
        <div className="fct-x8">
          <h2 className="fct-x9">{initialData ? 'Editar Contacto' : 'Agregar Contacto'}</h2>
          <div className="fct-x10">
            <button className="fct-x11" onClick={onMinimize}>—</button>
            <button className="fct-x11" onClick={onClose}>✕</button>
          </div>
        </div>

        <FormularioConfigurable modulo="contactos">{/* ✅ V00385 */}
        <form className="fct-x12" onSubmit={handleSubmit}>
          <div className="fct-x13">
            
            {/* BUSCADOR DE EMPRESAS */}
            <div className="fct-x14">
              <label className="fct-x15">Empresa / Cliente *</label>
              <input className="fct-x16" 
                type="text"
                placeholder="Buscar empresa..."
                value={busquedaEmpresa}
                onChange={(e) => {
                  setBusquedaEmpresa(e.target.value);
                  setMostrarDropdown(true);
                  setFormData({ ...formData, id_cliente: '' }); // Resetear ID si el usuario escribe algo nuevo
                }}
                onFocus={() => setMostrarDropdown(true)}
                required
              />
              {mostrarDropdown && empresasFiltradas.length > 0 && (
                <ul className="fct-x17">
                  {empresasFiltradas.map(emp => (
                    <li className="fct-x18" 
                      key={emp.id} 
                      onClick={() => seleccionarEmpresa(emp)}
                      onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'}
                      onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      {emp.nombre}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <label className="fct-x15">Persona Encargada *</label>
              <input className="fct-x16" type="text" value={formData.persona_encargada} onChange={(e) => setFormData({ ...formData, persona_encargada: e.target.value })} required />
            </div>

            <div>
              <label className="fct-x15">Puesto *</label>
              <input className="fct-x16" type="text" value={formData.puesto} onChange={(e) => setFormData({ ...formData, puesto: e.target.value })} required />
            </div>

            <div className="fct-x19">
              <div>
                <label className="fct-x15">Teléfono</label>
                <input className="fct-x16" type="tel" value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} />
              </div>
              <div>
                <label className="fct-x15">Correo Electrónico</label>
                <input className="fct-x16" type="email" value={formData.correo} onChange={(e) => setFormData({ ...formData, correo: e.target.value })} />
              </div>
            </div>

          </div>

          <div className="fct-x20">
            <button className="fct-x21" type="button" onClick={onClose}>Cancelar</button>
            <button className="fct-x22" type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar Contacto'}</button>
          </div>
        </form>
        </FormularioConfigurable>

      </div>
    </div>
  );
};
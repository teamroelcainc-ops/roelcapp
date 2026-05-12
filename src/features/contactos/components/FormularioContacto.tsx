import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';

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

  const [empresas, setEmpresas] = useState<any[]>([]);
  const [busquedaEmpresa, setBusquedaEmpresa] = useState('');
  const [mostrarDropdown, setMostrarDropdown] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Cargar empresas para el buscador
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'empresas'), (snapshot) => {
      setEmpresas(snapshot.docs.map(doc => ({ id: doc.id, nombre: doc.data().nombre || 'Sin nombre' })));
    });
    return () => unsub();
  }, []);

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

  const handleSubmit = async (e: React.FormEvent) => {
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
      <div style={{ position: 'fixed', bottom: 20, right: 20, backgroundColor: '#161b22', border: '1px solid #30363d', padding: '12px 20px', borderRadius: '8px', zIndex: 9999, display: 'flex', alignItems: 'center', gap: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
        <span style={{ color: '#f0f6fc', fontWeight: 'bold' }}>{initialData ? 'Editando Contacto' : 'Nuevo Contacto'}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onRestore} style={{ background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer' }}>🗖 Restaurar</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>✕</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1600, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
      <div style={{ maxWidth: '600px', width: '100%', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
        
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>{initialData ? 'Editar Contacto' : 'Agregar Contacto'}</h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={onMinimize} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>—</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            
            {/* BUSCADOR DE EMPRESAS */}
            <div style={{ position: 'relative' }}>
              <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Empresa / Cliente *</label>
              <input 
                type="text"
                placeholder="Buscar empresa..."
                value={busquedaEmpresa}
                onChange={(e) => {
                  setBusquedaEmpresa(e.target.value);
                  setMostrarDropdown(true);
                  setFormData({ ...formData, id_cliente: '' }); // Resetear ID si el usuario escribe algo nuevo
                }}
                onFocus={() => setMostrarDropdown(true)}
                style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }}
                required
              />
              {mostrarDropdown && empresasFiltradas.length > 0 && (
                <ul style={{ position: 'absolute', top: '100%', left: 0, right: 0, backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', maxHeight: '200px', overflowY: 'auto', listStyle: 'none', padding: 0, margin: '4px 0 0 0', zIndex: 10 }}>
                  {empresasFiltradas.map(emp => (
                    <li 
                      key={emp.id} 
                      onClick={() => seleccionarEmpresa(emp)}
                      style={{ padding: '10px', cursor: 'pointer', color: '#c9d1d9', borderBottom: '1px solid #30363d' }}
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
              <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Persona Encargada *</label>
              <input type="text" value={formData.persona_encargada} onChange={(e) => setFormData({ ...formData, persona_encargada: e.target.value })} required style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
            </div>

            <div>
              <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Puesto *</label>
              <input type="text" value={formData.puesto} onChange={(e) => setFormData({ ...formData, puesto: e.target.value })} required style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Teléfono</label>
                <input type="tel" value={formData.telefono} onChange={(e) => setFormData({ ...formData, telefono: e.target.value })} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Correo Electrónico</label>
                <input type="email" value={formData.correo} onChange={(e) => setFormData({ ...formData, correo: e.target.value })} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
              </div>
            </div>

          </div>

          <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" onClick={onClose} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
            <button type="submit" disabled={guardando} style={{ padding: '8px 16px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>{guardando ? 'Guardando...' : 'Guardar Contacto'}</button>
          </div>
        </form>

      </div>
    </div>
  );
};
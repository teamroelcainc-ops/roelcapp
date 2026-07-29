import React, { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import './FormularioProveedorUnidad.css';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: any;
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioProveedorUnidad = ({ estado, initialData, onClose, onMinimize, onRestore }: FormProps) => {
  const [formData, setFormData] = useState({
    proveedorId: '',
    proveedorNombre: '',
    nombre: '',
    apellido: '',
    fechaNacimiento: '',
    paisNacimiento: '',
    sexo: 'Masculino',
    numeroVisa: '',
    numeroLicencia: '',
    paisExpedicion: '',
    estadoExpedicion: ''
  });

  const [empresasProveedoras, setEmpresasProveedoras] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  // --- FILTRADO ESTRICTO POR ID: ca21ab07 ---
  useEffect(() => {
    const obtenerProveedoresFiltrados = async () => {
      try {
        let todasLasEmpresas: any[] = [];
        const coleccionesPosibles = ['empresa', 'empresas', 'catalogo_empresas'];

        // 1. Buscamos en las colecciones disponibles
        for (const nombreColeccion of coleccionesPosibles) {
          try {
            const snap = await getDocs(collection(db, nombreColeccion));
            if (!snap.empty) {
              const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
              todasLasEmpresas = [...todasLasEmpresas, ...docs];
            }
          } catch (e) {
            // Ignorar si la colección no existe
          }
        }

        // 2. Eliminar duplicados por ID
        const empresasUnicas = Array.from(new Map(todasLasEmpresas.map(item => [item.id, item])).values());

        // 3. APLICAR FILTRO ESTRICTO ca21ab07
        const ID_REQUERIDO = 'ca21ab07';
        const filtradas = empresasUnicas.filter((emp: any) => {
          // Caso A: El ID está en el arreglo de tiposEmpresa
          if (Array.isArray(emp.tiposEmpresa)) {
            return emp.tiposEmpresa.includes(ID_REQUERIDO);
          }
          // Caso B: El ID coincide con el campo tipo_empresa o categoria
          if (emp.tipo_empresa === ID_REQUERIDO || emp.categoria === ID_REQUERIDO) {
            return true;
          }
          // Caso C: Verificación de seguridad en todo el objeto (por si está en otro campo)
          const dataString = JSON.stringify(emp).toLowerCase();
          return dataString.includes(ID_REQUERIDO.toLowerCase());
        });

        // 4. Ordenar alfabéticamente
        filtradas.sort((a: any, b: any) => {
          const nombreA = a.nombre || a.empresa || '';
          const nombreB = b.nombre || b.empresa || '';
          return nombreA.localeCompare(nombreB);
        });

        setEmpresasProveedoras(filtradas);
      } catch (error) {
        console.error("Error al obtener proveedores:", error);
      }
    };

    obtenerProveedoresFiltrados();
  }, []);

  useEffect(() => {
    if (initialData) {
      setFormData(initialData);
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleProveedorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const idSeleccionado = e.target.value;
    const empresaEncontrada = empresasProveedoras.find(emp => emp.id === idSeleccionado);
    
    const nombreVisual = empresaEncontrada 
      ? (empresaEncontrada.nombre || empresaEncontrada.empresa || `Proveedor (${idSeleccionado.substring(0,4)})`) 
      : '';

    setFormData(prev => ({
      ...prev,
      proveedorId: idSeleccionado,
      proveedorNombre: nombreVisual 
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.proveedorId) {
      alert("Por favor selecciona un proveedor válido.");
      return;
    }

    setCargando(true);
    try {
      if (initialData && initialData.id) {
        await actualizarRegistro('proveedores_unidad', initialData.id, formData);
      } else {
        await agregarRegistro('proveedores_unidad', formData);
      }
      onClose();
    } catch (error) {
      console.error("Error al guardar:", error);
      alert('Error al guardar. Revisa tu conexión.');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card fpu-x1">
        <div className="form-header">
          <h2>{estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Proveedor` : 'Nuevo Proveedor de Unidad')}</h2>
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
            <div className="form-grid fpu-x2">
              
              <div className="form-group fpu-x3">
                <label className="form-label">Proveedor (Transportista Autorizado) *</label>
                <select 
                  className="form-control" 
                  value={formData.proveedorId} 
                  onChange={handleProveedorChange} 
                  required
                >
                  <option value="">Seleccione el proveedor...</option>
                  {empresasProveedoras.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nombre || emp.empresa}
                    </option>
                  ))}
                </select>
                {empresasProveedoras.length === 0 && (
                  <small className="fpu-x4">
                    No se encontraron empresas con el ID ca21ab07.
                  </small>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Nombre del Chofer *</label>
                <input type="text" name="nombre" className="form-control" value={formData.nombre} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">Apellido del Chofer *</label>
                <input type="text" name="apellido" className="form-control" value={formData.apellido} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">Fecha de Nacimiento *</label>
                <input type="date" name="fechaNacimiento" className="form-control" value={formData.fechaNacimiento} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">Sexo *</label>
                <select name="sexo" className="form-control" value={formData.sexo} onChange={handleChange} required>
                  <option value="Masculino">Masculino</option>
                  <option value="Femenino">Femenino</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">No. Licencia Federal *</label>
                <input type="text" name="numeroLicencia" className="form-control" value={formData.numeroLicencia} onChange={handleChange} required />
              </div>

              <div className="form-group">
                <label className="form-label">Número de Visa</label>
                <input type="text" name="numeroVisa" className="form-control" value={formData.numeroVisa} onChange={handleChange} />
              </div>

            </div>

            <div className="form-actions fpu-x5">
              <button type="button" onClick={onClose} className="btn btn-outline">Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargando || empresasProveedoras.length === 0}>
                {cargando ? 'Guardando...' : (initialData ? 'Guardar Cambios' : 'Guardar')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
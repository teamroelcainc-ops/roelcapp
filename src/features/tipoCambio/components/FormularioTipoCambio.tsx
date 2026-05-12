// src/features/tipoCambio/components/FormularioTipoCambio.tsx
import React, { useState, useEffect } from 'react';
import { agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: any;
  registros: any[];
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

export const FormularioTipoCambio = ({ estado, initialData, registros, onClose, onMinimize, onRestore }: FormProps) => {
  const [formData, setFormData] = useState({
    dia: '', 
    fecha: new Date().toISOString().split('T')[0], 
    tcDof: '', 
    tendencia: 'Sin cambio', 
    tipoTendencia: 'igual'
  });

  const [cargandoApi, setCargandoApi] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // ✅ FUNCIÓN ACTUALIZADA: Ahora recibe una fecha y consulta ese día específico
  const obtenerTipoCambioBanxico = async (fechaConsulta?: string) => {
    const token = import.meta.env.VITE_BANXICO_TOKEN;
    if (!token) {
      alert('⚠️ No se encontró el token de Banxico. Revisa tu archivo .env');
      return;
    }

    // Si no se le pasa una fecha por parámetro, usa la del formulario actual
    const fechaABuscar = fechaConsulta || formData.fecha;

    if (!fechaABuscar) return;

    setCargandoApi(true);
    try {
      // Usamos el endpoint con rango de fechas: /datos/{fechaInicial}/{fechaFinal}
      const url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/SF43718/datos/${fechaABuscar}/${fechaABuscar}?token=${token}`;
      const response = await fetch(url);
      
      if (!response.ok) throw new Error('Error en la respuesta de Banxico');

      const data = await response.json();
      
      if (data.bmx && data.bmx.series && data.bmx.series[0].datos && data.bmx.series[0].datos.length > 0) {
        const valorActual = data.bmx.series[0].datos[0].dato;
        setFormData(prev => ({ ...prev, tcDof: valorActual, fecha: fechaABuscar }));
      } else {
        alert(`Banxico no tiene un tipo de cambio registrado para la fecha ${fechaABuscar}. Es probable que sea fin de semana o día festivo.`);
        setFormData(prev => ({ ...prev, tcDof: '', fecha: fechaABuscar }));
      }
    } catch (error) {
      console.error("Error obteniendo datos de Banxico:", error);
      alert('Error de conexión con Banxico. Puede que el servicio esté temporalmente caído o la fecha sea inválida.');
    } finally {
      setCargandoApi(false);
    }
  };

  // ✅ AL CAMBIAR LA FECHA MANUALMENTE DISPARAMOS LA BÚSQUEDA AUTOMÁTICA
  const handleFechaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nuevaFecha = e.target.value;
    setFormData(prev => ({ ...prev, fecha: nuevaFecha }));
    obtenerTipoCambioBanxico(nuevaFecha);
  };

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({ ...prev, ...initialData }));
    } else {
      obtenerTipoCambioBanxico(formData.fecha);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  useEffect(() => {
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    let nuevoDia = '';
    if (formData.fecha) {
      const fechaObj = new Date(formData.fecha + 'T12:00:00'); 
      nuevoDia = diasSemana[fechaObj.getDay()];
    }

    let nuevaTipoTendencia = 'igual';
    let nuevaTendenciaDesc = 'Sin cambio';
    const tcActual = parseFloat(formData.tcDof);

    if (!isNaN(tcActual) && formData.fecha) {
      const registroAnterior = registros.find(r => r.fecha < formData.fecha && r.id !== initialData?.id);

      if (registroAnterior && registroAnterior.tcDof) {
        const tcAnterior = parseFloat(registroAnterior.tcDof);
        const diferencia = tcActual - tcAnterior;

        if (diferencia > 0) {
          nuevaTipoTendencia = 'subio';
          nuevaTendenciaDesc = `Subió ${diferencia.toFixed(4)} centavos`;
        } else if (diferencia < 0) {
          nuevaTipoTendencia = 'bajo';
          nuevaTendenciaDesc = `Bajó ${Math.abs(diferencia).toFixed(4)} centavos`;
        }
      } else {
        nuevaTendenciaDesc = 'Sin cambio (Primer registro)';
      }
    }

    if (nuevoDia !== formData.dia || nuevaTipoTendencia !== formData.tipoTendencia || nuevaTendenciaDesc !== formData.tendencia) {
      setFormData(prev => ({
        ...prev, dia: nuevoDia, tipoTendencia: nuevaTipoTendencia, tendencia: nuevaTendenciaDesc
      }));
    }
  }, [formData.fecha, formData.tcDof, registros, initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (initialData && initialData.id) {
        // 1. MODO EDICIÓN
        await actualizarRegistro('tipo_cambio', initialData.id, formData);
        await registrarLog('Tipo de Cambio', 'Edición', `Actualizó el T.C. del día ${formData.fecha} a ${formData.tcDof}`);
      } else {
        // 2. MODO CREACIÓN
        await agregarRegistro('tipo_cambio', formData);
        await registrarLog('Tipo de Cambio', 'Creación', `Agregó el T.C. del día ${formData.fecha} (${formData.tcDof})`);
      }
      onClose();
    } catch (error) {
      console.error("Error al guardar en Firebase:", error);
      alert('Error al guardar. Revisa tu conexión a internet.');
    }
  };

  return (
    <div className={`modal-overlay ${estado === 'minimizado' ? 'minimized' : ''}`}>
      <div className="form-card" style={{ maxWidth: '500px' }}>
        <div className="form-header">
          <h2>{estado === 'minimizado' ? 'Editando...' : (initialData ? `Editar Tipo de Cambio` : 'Nuevo Tipo de Cambio')}</h2>
          <div className="header-actions">
            {estado === 'abierto' ? <button type="button" onClick={onMinimize} className="btn-window">🗕</button> : <button type="button" onClick={onRestore} className="btn-window restore">🗖</button>}
            <button type="button" onClick={onClose} className="btn-window close">✕</button>
          </div>
        </div>

        <div style={{ display: estado === 'minimizado' ? 'none' : 'block', padding: '20px' }}>
          <form onSubmit={handleSubmit}>
            <div className="form-grid" style={{ gridTemplateColumns: '1fr' }}>
              
              <div className="form-group">
                <label className="form-label orange">Día de la semana (Automático)</label>
                <input type="text" className="form-control" value={formData.dia} disabled style={{ backgroundColor: '#21262d', color: '#8b949e', cursor: 'not-allowed' }} />
              </div>

              <div className="form-group">
                <label className="form-label">Fecha *</label>
                <input 
                  type="date" 
                  name="fecha" 
                  className="form-control" 
                  value={formData.fecha} 
                  onChange={handleFechaChange} // ✅ ASIGNADO EL NUEVO EVENTO AQUÍ
                  required 
                />
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>T.C. DOF *</label>
                  <button 
                    type="button" 
                    onClick={() => obtenerTipoCambioBanxico()} // Llama a la función usando la fecha del form
                    disabled={cargandoApi} 
                    style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}
                  >
                    {cargandoApi ? 'Consultando...' : '🔄 Obtener de Banxico'}
                  </button>
                </div>
                <input 
                  type="number" 
                  step="0.0001" 
                  name="tcDof" 
                  className="form-control" 
                  placeholder={cargandoApi ? "Obteniendo datos..." : "Ej: 17.7962"} 
                  value={formData.tcDof} 
                  onChange={handleChange} 
                  required 
                />
              </div>

              <div className="form-group">
                <label className="form-label">Tipo de Tendencia (Fórmula)</label>
                <select className="form-control" value={formData.tipoTendencia} disabled style={{ backgroundColor: '#21262d', color: '#8b949e', cursor: 'not-allowed' }}>
                  <option value="subio">Subió</option>
                  <option value="bajo">Bajó</option>
                  <option value="igual">Sin cambio</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Descripción Tendencia (Fórmula)</label>
                <input type="text" className="form-control" value={formData.tendencia} disabled style={{ backgroundColor: '#21262d', color: '#8b949e', cursor: 'not-allowed' }} />
              </div>

            </div>

            <div className="form-actions" style={{ marginTop: '24px' }}>
              <button type="button" onClick={onClose} className="btn btn-outline">Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={cargandoApi}>{initialData ? 'Guardar Cambios' : 'Guardar'}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
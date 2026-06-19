// src/features/tipoCambio/components/FormularioTipoCambio.tsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';

interface FormProps {
  estado: 'abierto' | 'minimizado';
  initialData?: any;
  registros: any[];
  onClose: () => void;
  onMinimize: () => void;
  onRestore: () => void;
}

// ──────────────────────────────────────────────────────────────────────
// ✅ NUEVO (config de campos obligatorios, COMPARTIDA por todos los usuarios)
// Se guarda en Firestore: config_campos_obligatorios/tipo_cambio
// ──────────────────────────────────────────────────────────────────────
const FORM_ID = 'tipo_cambio';
const CAMPOS_CONFIGURABLES: { key: string; label: string }[] = [
  { key: 'fecha', label: 'Fecha' },
  { key: 'tcDof', label: 'T.C. DOF' },
];
const OBLIGATORIOS_DEFAULT: Record<string, boolean> = { fecha: true, tcDof: true };

const esVacioValor = (v: any): boolean => {
  if (v === undefined || v === null) return true;
  return String(v).trim() === '';
};

export const FormularioTipoCambio = ({ estado, initialData, registros, onClose, onMinimize, onRestore }: FormProps) => {
  const [formData, setFormData] = useState({
    dia: '', 
    fecha: new Date().toISOString().split('T')[0], 
    tcDof: '', 
    tendencia: 'Sin cambio', 
    tipoTendencia: 'igual'
  });

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  useEffect(() => {
    if (initialData) {
      setFormData(prev => ({ ...prev, ...initialData }));
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

    // ✅ Validación según la configuración compartida de campos obligatorios
    const faltantes = CAMPOS_CONFIGURABLES.filter(c => esOblig(c.key) && esVacioValor((formData as any)[c.key]));
    if (faltantes.length > 0) {
      alert('Faltan campos obligatorios:\n\n• ' + faltantes.map(c => c.label).join('\n• '));
      return;
    }

    try {
      if (initialData && initialData.id) {
        await actualizarRegistro('tipo_cambio', initialData.id, formData);
        await registrarLog('Tipo de Cambio', 'Edición', `Actualizó el T.C. del día ${formData.fecha} a ${formData.tcDof}`);
      } else {
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
            {/* ✅ NUEVO: botón de configuración de campos obligatorios */}
            <button
              type="button"
              onClick={() => setModalConfig(true)}
              className="btn-window"
              title="Configurar campos obligatorios"
              style={{ fontSize: '0.95rem' }}
            >
              ⚙
            </button>
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
                <label className="form-label">Fecha {esOblig('fecha') ? '*' : ''}</label>
                <input 
                  type="date" 
                  name="fecha" 
                  className="form-control" 
                  value={formData.fecha} 
                  onChange={handleChange}
                  required={esOblig('fecha')}
                />
              </div>

              <div className="form-group">
                <label className="form-label">T.C. DOF {esOblig('tcDof') ? '*' : ''}</label>
                <input 
                  type="number" 
                  step="0.0001" 
                  name="tcDof" 
                  className="form-control" 
                  placeholder="Ej: 17.7962" 
                  value={formData.tcDof} 
                  onChange={handleChange} 
                  required={esOblig('tcDof')}
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
              <button type="submit" className="btn btn-primary">{initialData ? 'Guardar Cambios' : 'Guardar'}</button>
            </div>
          </form>
        </div>
      </div>

      {/* ✅ NUEVO: Modal de configuración de campos obligatorios (compartido) */}
      {modalConfig && (
        <div className="modal-overlay" style={{ zIndex: 3000, position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}>
          <div className="form-card" style={{ maxWidth: '460px', width: '95%', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #30363d', paddingBottom: '12px', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: '#f0f6fc' }}>Campos obligatorios</h3>
              <button type="button" onClick={() => setModalConfig(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.1rem' }}>✕</button>
            </div>
            <p style={{ color: '#8b949e', fontSize: '0.82rem', marginTop: 0, marginBottom: '16px' }}>
              Marca qué campos serán obligatorios al guardar. Esta configuración se guarda y aplica para <b>todos los usuarios</b>.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {CAMPOS_CONFIGURABLES.map(c => (
                <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={esOblig(c.key)}
                    onChange={() => setObligatorios(prev => ({ ...prev, [c.key]: !prev[c.key] }))}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                  <span style={{ color: esOblig(c.key) ? '#f0f6fc' : '#8b949e', fontWeight: esOblig(c.key) ? 600 : 400 }}>{c.label}</span>
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
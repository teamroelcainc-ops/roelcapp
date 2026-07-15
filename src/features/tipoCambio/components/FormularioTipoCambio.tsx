// src/features/tipoCambio/components/FormularioTipoCambio.tsx
import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, agregarRegistro, actualizarRegistro } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
// ✅ AUTORIZACIONES: interceptar guardado cuando la acción/campo lo requiere.
import { cargarConfigModulo, evaluarAutorizacion, camposModificadosDe, crearSolicitudAutorizacion, obtenerUsuarioAut } from '../../autorizaciones/autorizaciones';

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

// ✅ Fecha de HOY en horario LOCAL (no UTC, para no brincar de día por la noche).
const hoyLocalISO = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ✅ Helpers de calendario (para propagar el T.C. a días inhábiles).
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const sumarDias = (fechaISO: string, n: number): string => {
  const d = new Date(fechaISO + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const nombreDiaDe = (fechaISO: string): string => DIAS_SEMANA[new Date(fechaISO + 'T12:00:00').getDay()];
const esFinDeSemana = (fechaISO: string): boolean => {
  const dow = new Date(fechaISO + 'T12:00:00').getDay();
  return dow === 0 || dow === 6;
};

export const FormularioTipoCambio = ({ estado, initialData, registros, onClose, onMinimize, onRestore }: FormProps) => {
  const [formData, setFormData] = useState({
    dia: '', 
    fecha: hoyLocalISO(), 
    tcDof: '', 
    tendencia: 'Sin cambio', 
    tipoTendencia: 'igual'
  });
  const [guardando, setGuardando] = useState(false);

  // ✅ NUEVO: configuración de campos obligatorios (compartida)
  const [obligatorios, setObligatorios] = useState<Record<string, boolean>>(OBLIGATORIOS_DEFAULT);
  const [modalConfig, setModalConfig] = useState(false);
  const [guardandoConfig, setGuardandoConfig] = useState(false);

  const esOblig = (campo: string) => !!obligatorios[campo];

  // ✅ DÍAS FESTIVOS (compartidos): se administran desde el dashboard
  //   (botón "Días Festivos") y se guardan en config_dias_festivos/general.
  const [festivos, setFestivos] = useState<string[]>([]);
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'config_dias_festivos', 'general'));
        if (activo && snap.exists()) {
          const lista = (snap.data() as any).festivos || [];
          setFestivos(lista.map((f: any) => String(f.fecha || f)).filter(Boolean));
        }
      } catch (e) { console.error('Error cargando días festivos:', e); }
    })();
    return () => { activo = false; };
  }, []);
  const esFestivo = (fechaISO: string) => festivos.includes(fechaISO);

  const esEdicion = !!(initialData && initialData.id);
  const hoy = hoyLocalISO();

  // ✅ REGLA: la fecha NO puede repetirse. Se valida contra todos los registros
  //   cargados (excluyendo el propio registro cuando se edita).
  const fechaDuplicada = registros.some(
    r => String(r.fecha) === String(formData.fecha) && r.id !== initialData?.id
  );

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
    if (guardando) return;

    // ✅ Validación según la configuración compartida de campos obligatorios
    const faltantes = CAMPOS_CONFIGURABLES.filter(c => esOblig(c.key) && esVacioValor((formData as any)[c.key]));
    if (faltantes.length > 0) {
      alert('Faltan campos obligatorios:\n\n• ' + faltantes.map(c => c.label).join('\n• '));
      return;
    }

    // ✅ REGLA: se puede registrar HOY o completar días PASADOS faltantes
    //   (para no dejar días en blanco). Lo único prohibido es el FUTURO,
    //   porque el tipo de cambio aún no se conoce.
    if (!esEdicion && formData.fecha > hoy) {
      alert(`No se puede registrar un tipo de cambio de una fecha FUTURA.\n\nPuedes registrar el de hoy (${hoy}) o completar días pasados que falten.`);
      setFormData(prev => ({ ...prev, fecha: hoy }));
      return;
    }

    // ✅ REGLA: la fecha no puede estar repetida (validación en memoria).
    if (fechaDuplicada) {
      alert(`Ya existe un registro del tipo de cambio para la fecha ${formData.fecha}.\n\nNo se puede agregar de nuevo. Si necesitas corregir el valor, edita el registro existente.`);
      return;
    }

    setGuardando(true);
    try {
      // ── ✅ AUTORIZACIONES: si la acción o algún campo modificado está
      //    controlado (y el usuario no es Admin), NO se guarda: se crea una
      //    solicitud pendiente que el Admin aprueba desde "Autorizaciones". ──
      const accionAut: 'crear' | 'editar' = esEdicion ? 'editar' : 'crear';
      const camposCambiadosAut = esEdicion ? camposModificadosDe(formData as any, initialData || {}) : [];
      const usuarioA = await obtenerUsuarioAut();
      const configA = await cargarConfigModulo('tipoCambio');
      const evalAut = evaluarAutorizacion(configA, accionAut, usuarioA, camposCambiadosAut, { fecha: 'Fecha', tcDof: 'T.C. DOF' });
      if (evalAut.requiere) {
        const datosAnterioresAut: Record<string, any> = {};
        camposCambiadosAut.forEach(k => { datosAnterioresAut[k] = (initialData as any)?.[k] ?? ''; });
        await crearSolicitudAutorizacion({
          modulo: 'tipoCambio',
          moduloLabel: 'Tipo de Cambio',
          accion: accionAut,
          coleccion: 'tipo_cambio',
          docId: esEdicion ? String(initialData.id) : '',
          referencia: `T.C. ${formData.fecha}`,
          camposAfectados: camposCambiadosAut,
          datosPropuestos: formData as any,
          datosAnteriores: datosAnterioresAut,
          motivosControl: evalAut.motivos,
          solicitanteUid: usuarioA.uid,
          solicitanteNombre: usuarioA.nombre,
          solicitanteRoles: usuarioA.roles,
          estrategiaCrear: 'directa',
        });
        alert(`🔒 Este cambio requiere autorización del administrador.\n\n${evalAut.motivos.join('\n')}\n\nSe envió la solicitud. Los cambios NO se guardaron todavía; se aplicarán cuando el Admin los apruebe.`);
        onClose();
        return;
      }

      // ✅ Candado final contra duplicados: verificación directa en Firestore
      //   por si otro usuario registró la misma fecha hace un instante.
      const dupSnap = await getDocs(query(collection(db, 'tipo_cambio'), where('fecha', '==', formData.fecha)));
      const hayDuplicadoRemoto = dupSnap.docs.some(d => d.id !== initialData?.id);
      if (hayDuplicadoRemoto) {
        alert(`Ya existe un registro del tipo de cambio para la fecha ${formData.fecha} (registrado por otro usuario).\n\nNo se guardará un duplicado.`);
        return;
      }

      if (esEdicion) {
        await actualizarRegistro('tipo_cambio', initialData.id, formData);
        await registrarLog('Tipo de Cambio', 'Edición', `Actualizó el T.C. del día ${formData.fecha} a ${formData.tcDof}`);
      } else {
        await agregarRegistro('tipo_cambio', formData);
        await registrarLog('Tipo de Cambio', 'Creación', `Agregó el T.C. del día ${formData.fecha} (${formData.tcDof})`);

        // ── ✅ PROPAGACIÓN A DÍAS INHÁBILES ──
        //   Los días siguientes que sean sábado, domingo o festivo toman el
        //   MISMO tipo de cambio (el DOF no publica en días inhábiles):
        //   · Viernes → crea sábado y domingo automáticamente.
        //   · Día anterior a un festivo → crea el festivo (encadena si hay
        //     festivo + fin de semana seguidos, p. ej. viernes festivo).
        const creados: string[] = [];
        try {
          let f = sumarDias(formData.fecha, 1);
          let seguridad = 0;
          while ((esFinDeSemana(f) || esFestivo(f)) && seguridad < 14) {
            seguridad++;
            const existeLocal = registros.some(r => String(r.fecha) === f);
            let existeRemoto = false;
            if (!existeLocal) {
              const snapDia = await getDocs(query(collection(db, 'tipo_cambio'), where('fecha', '==', f)));
              existeRemoto = !snapDia.empty;
            }
            if (!existeLocal && !existeRemoto) {
              const motivo = esFestivo(f) ? 'día festivo' : 'fin de semana';
              await agregarRegistro('tipo_cambio', {
                dia: nombreDiaDe(f),
                fecha: f,
                tcDof: formData.tcDof,
                tendencia: `Sin cambio (${motivo}: mismo T.C. del día anterior)`,
                tipoTendencia: 'igual',
              });
              await registrarLog('Tipo de Cambio', 'Creación', `Auto-generó el T.C. del ${nombreDiaDe(f)} ${f} (${motivo}) con el valor ${formData.tcDof}`);
              creados.push(`${nombreDiaDe(f)} ${f}`);
            }
            f = sumarDias(f, 1);
          }
        } catch (ePropaga) {
          console.error('Error propagando T.C. a días inhábiles:', ePropaga);
        }
        if (creados.length > 0) {
          alert(`T.C. guardado. Se agregó automáticamente el mismo valor para:\n\n• ${creados.join('\n• ')}`);
        }
      }
      onClose();
    } catch (error) {
      console.error("Error al guardar en Firebase:", error);
      alert('Error al guardar. Revisa tu conexión a internet.');
    } finally {
      setGuardando(false);
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
                {/* ✅ Al AGREGAR: solo se permite la fecha de HOY (min = max = hoy).
                    Al EDITAR: la fecha queda bloqueada; solo se corrige el valor. */}
                <input 
                  type="date" 
                  name="fecha" 
                  className="form-control" 
                  value={formData.fecha} 
                  onChange={handleChange}
                  required={esOblig('fecha')}
                  max={esEdicion ? undefined : hoy}
                  disabled={esEdicion}
                  title={esEdicion ? 'La fecha no se puede modificar al editar' : 'Puedes registrar hoy o completar días pasados faltantes (futuro no)'}
                  style={esEdicion ? { backgroundColor: '#21262d', color: '#8b949e', cursor: 'not-allowed' } : undefined}
                />
                {!esEdicion && (
                  <small style={{ color: '#8b949e' }}>Puedes registrar el de hoy o completar días pasados faltantes. No se permiten fechas futuras. Los sábados, domingos y festivos siguientes se agregan solos con el mismo valor.</small>
                )}
                {fechaDuplicada && (
                  <small style={{ color: '#f85149', fontWeight: 600, display: 'block', marginTop: '4px' }}>
                    ⚠ Ya existe un registro para esta fecha. No se puede guardar duplicado.
                  </small>
                )}
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
              <button type="submit" className="btn btn-primary" disabled={guardando || fechaDuplicada} style={{ opacity: (guardando || fechaDuplicada) ? 0.6 : 1, cursor: (guardando || fechaDuplicada) ? 'not-allowed' : 'pointer' }}>
                {guardando ? 'Guardando...' : (initialData ? 'Guardar Cambios' : 'Guardar')}
              </button>
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
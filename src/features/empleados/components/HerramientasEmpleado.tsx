// src/features/empleados/components/HerramientasEmpleado.tsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom'; // ✅ IMPORTACIÓN CLAVE PARA ARREGLAR EL MODAL
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, query, where } from 'firebase/firestore';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { db } from '../../../config/firebase';

interface Props {
  empleadoId: string;
}

export const HerramientasEmpleado: React.FC<Props> = ({ empleadoId }) => {
  const [herramientas, setHerramientas] = useState<any[]>([]);
  const [dispositivos, setDispositivos] = useState<any[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [progresoUpload, setProgresoUpload] = useState(0);

  const [formData, setFormData] = useState({
    FECHA_ENTREGA: '',
    DISPOSITIVO: '',
    VALOR: '',
    OBSERVACIONES: '',
    NuevoUsado: 'Nuevo',
    DOCUMENTO: ''
  });
  
  const [archivoSeleccionado, setArchivoSeleccionado] = useState<File | null>(null);

  useEffect(() => {
    if (!empleadoId) return;

    const unsubDispositivos = onSnapshot(collection(db, 'catalogo_dispositivos'), (snapshot) => {
      setDispositivos(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const q = query(collection(db, 'empleados_herramientas'), where('ID_EMPLEADOS', '==', empleadoId));
    const unsubHerramientas = onSnapshot(q, (snapshot) => {
      setHerramientas(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubDispositivos();
      unsubHerramientas();
    };
  }, [empleadoId]);

  const abrirModalNuevo = () => {
    setFormData({ FECHA_ENTREGA: '', DISPOSITIVO: '', VALOR: '', OBSERVACIONES: '', NuevoUsado: 'Nuevo', DOCUMENTO: '' });
    setArchivoSeleccionado(null);
    setProgresoUpload(0);
    setEditandoId(null);
    setModalAbierto(true);
  };

  const abrirModalEditar = (herramienta: any) => {
    setFormData({
      FECHA_ENTREGA: herramienta.FECHA_ENTREGA || '',
      DISPOSITIVO: herramienta.DISPOSITIVO || '',
      VALOR: herramienta.VALOR || '',
      OBSERVACIONES: herramienta.OBSERVACIONES || '',
      NuevoUsado: herramienta.NuevoUsado || 'Nuevo',
      DOCUMENTO: herramienta.DOCUMENTO || ''
    });
    setArchivoSeleccionado(null);
    setProgresoUpload(0);
    setEditandoId(herramienta.id);
    setModalAbierto(true);
  };

  const eliminarHerramienta = async (id: string) => {
    if (window.confirm('¿Estás seguro de eliminar esta herramienta asignada?')) {
      await deleteDoc(doc(db, 'empleados_herramientas', id));
    }
  };

  const manejarEnvio = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);

    try {
      let urlDocumento = formData.DOCUMENTO;

      if (archivoSeleccionado) {
        const storage = getStorage();
        const archivoRef = ref(storage, `herramientas_empleados/${empleadoId}_${Date.now()}_${archivoSeleccionado.name}`);
        const uploadTask = uploadBytesResumable(archivoRef, archivoSeleccionado);

        urlDocumento = await new Promise((resolve, reject) => {
          uploadTask.on('state_changed', 
            (snapshot) => {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              setProgresoUpload(progress);
            }, 
            (error) => reject(error), 
            async () => {
              const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(downloadURL);
            }
          );
        });
      }

      const datosFinales = {
        ...formData,
        ID_EMPLEADOS: empleadoId,
        VALOR: Number(formData.VALOR),
        DOCUMENTO: urlDocumento
      };

      if (editandoId) {
        await updateDoc(doc(db, 'empleados_herramientas', editandoId), datosFinales);
      } else {
        await addDoc(collection(db, 'empleados_herramientas'), datosFinales);
      }

      setModalAbierto(false);
    } catch (error) {
      console.error("Error al guardar:", error);
      alert('Error al guardar la herramienta. Revisa tu conexión.');
    } finally {
      setGuardando(false);
    }
  };

  const formatearFecha = (fechaString: string) => {
    if (!fechaString) return '-';
    return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const getNombreDispositivo = (id: string) => {
    const disp = dispositivos.find(d => d.id === id);
    return disp ? disp.dispositivo : 'Desconocido';
  };

  return (
    <div style={{ marginTop: '32px', animation: 'fadeIn 0.3s ease' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', borderBottom: '1px solid #30363d', paddingBottom: '8px' }}>
        <h3 style={{ color: '#D84315', fontSize: '1.1rem', margin: 0, display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span>Equipos y Herramientas Asignadas</span>
          <span style={{ backgroundColor: '#161b22', padding: '2px 8px', borderRadius: '12px', fontSize: '0.8rem', color: '#8b949e', border: '1px solid #30363d' }}>
            {herramientas.length} Registros
          </span>
        </h3>
        <button 
          onClick={abrirModalNuevo}
          style={{ backgroundColor: '#D84315', color: '#ffffff', border: 'none', padding: '6px 12px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}
        >
          + Asignar Herramienta
        </button>
      </div>

      {herramientas.length === 0 ? (
        <div style={{ padding: '24px', backgroundColor: '#161b22', borderRadius: '8px', color: '#8b949e', textAlign: 'center', border: '1px dashed #30363d' }}>
          No hay herramientas asignadas a este empleado.
        </div>
      ) : (
        <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', backgroundColor: '#161b22' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead style={{ backgroundColor: '#1f2937' }}>
              <tr>
                <th style={{ padding: '12px', color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase' }}>Fecha</th>
                <th style={{ padding: '12px', color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase' }}>Dispositivo</th>
                <th style={{ padding: '12px', color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase' }}>Condición</th>
                <th style={{ padding: '12px', color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase' }}>Valor</th>
                <th style={{ padding: '12px', color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase' }}>Documento</th>
                <th style={{ padding: '12px', color: '#8b949e', fontWeight: '600', borderBottom: '1px solid #30363d', textTransform: 'uppercase', textAlign: 'center' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {herramientas.map((h: any) => (
                <tr key={h.id} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={{ padding: '12px', color: '#c9d1d9' }}>{formatearFecha(h.FECHA_ENTREGA)}</td>
                  <td style={{ padding: '12px', color: '#f0f6fc', fontWeight: 'bold' }}>{getNombreDispositivo(h.DISPOSITIVO)}</td>
                  <td style={{ padding: '12px', color: '#c9d1d9' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: h.NuevoUsado === 'Nuevo' ? 'rgba(35, 134, 54, 0.1)' : 'rgba(216, 67, 21, 0.1)', color: h.NuevoUsado === 'Nuevo' ? '#3fb950' : '#D84315', border: `1px solid ${h.NuevoUsado === 'Nuevo' ? '#2ea043' : '#D84315'}` }}>
                      {h.NuevoUsado}
                    </span>
                  </td>
                  <td style={{ padding: '12px', color: '#c9d1d9' }}>${Number(h.VALOR || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</td>
                  <td style={{ padding: '12px', color: '#58a6ff' }}>
                    {h.DOCUMENTO ? <a href={h.DOCUMENTO} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>Ver Archivo ↗</a> : <span style={{ color: '#8b949e' }}>Sin adjunto</span>}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                      <button onClick={() => abrirModalEditar(h)} style={{ background: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer' }}>Editar</button>
                      <button onClick={() => eliminarHerramienta(h.id)} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer' }}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ✅ SOLUCIÓN: ENVOLVEMOS EL MODAL EN CREATEPORTAL PARA SACARLO DEL PADRE */}
      {modalAbierto && document.body && createPortal(
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ maxWidth: '500px', width: '100%', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', display: 'flex', flexDirection: 'column', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', maxHeight: '90vh' }}>
            
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem' }}>{editandoId ? 'Editar Herramienta' : 'Asignar Herramienta'}</h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <form onSubmit={manejarEnvio} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto' }}>
                
                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Fecha de Entrega *</label>
                  <input type="date" value={formData.FECHA_ENTREGA} onChange={(e) => setFormData({ ...formData, FECHA_ENTREGA: e.target.value })} required style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
                </div>

                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Dispositivo *</label>
                  <select value={formData.DISPOSITIVO} onChange={(e) => setFormData({ ...formData, DISPOSITIVO: e.target.value })} required style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }}>
                    <option value="">Seleccione un dispositivo...</option>
                    {dispositivos.map(d => (
                      <option key={d.id} value={d.id}>{d.dispositivo}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Condición *</label>
                    <select value={formData.NuevoUsado} onChange={(e) => setFormData({ ...formData, NuevoUsado: e.target.value })} required style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }}>
                      <option value="Nuevo">Nuevo</option>
                      <option value="Usado">Usado</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Valor ($) *</label>
                    <input type="number" step="0.01" value={formData.VALOR} onChange={(e) => setFormData({ ...formData, VALOR: e.target.value })} required style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box' }} />
                  </div>
                </div>

                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Observaciones</label>
                  <textarea rows={3} value={formData.OBSERVACIONES} onChange={(e) => setFormData({ ...formData, OBSERVACIONES: e.target.value })} style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', boxSizing: 'border-box', resize: 'vertical' }} />
                </div>

                <div>
                  <label style={{ color: '#8b949e', fontSize: '0.9rem', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>Documento (Opcional)</label>
                  <input type="file" onChange={(e) => setArchivoSeleccionado(e.target.files ? e.target.files[0] : null)} style={{ width: '100%', padding: '8px', color: '#c9d1d9' }} />
                  {progresoUpload > 0 && progresoUpload < 100 && (
                    <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#58a6ff' }}>Subiendo documento: {Math.round(progresoUpload)}%</div>
                  )}
                  {formData.DOCUMENTO && !archivoSeleccionado && (
                    <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#8b949e' }}>Ya existe un documento cargado. Subir uno nuevo lo reemplazará.</div>
                  )}
                </div>

              </div>

              <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={guardando} style={{ padding: '8px 16px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                  {guardando ? 'Guardando...' : 'Guardar Herramienta'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

    </div>
  );
};
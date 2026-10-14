// src/features/empleados/components/HerramientasEmpleado.tsx
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom'; // ✅ IMPORTACIÓN CLAVE PARA ARREGLAR EL MODAL
import { collection, onSnapshot, addDoc, updateDoc, doc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import AdjuntosArchivos from '../../../shared/components/AdjuntosArchivos'; // ✅ V00451
import { archivosDeDocumento, cambioAdjuntos, camposDeArchivos, desdeGuardados, hayNuevos } from '../../../shared/archivos/adjuntos';
import type { Adjunto, ArchivoGuardado } from '../../../shared/archivos/adjuntos';
import { subirAdjuntos } from '../../../shared/archivos/subirAdjuntos';
import './HerramientasEmpleado.css';

// ✅ V00451: documentos de la herramienta (hasta 10) en DOCUMENTOS; DOCUMENTO = la URL del primero
//   (los registros viejos solo tienen DOCUMENTO).
const LEGADO_DOCUMENTO = { url: 'DOCUMENTO' };
const documentosDe = (h: unknown): ArchivoGuardado[] =>
  archivosDeDocumento(h as Record<string, unknown> | null | undefined, 'DOCUMENTOS', LEGADO_DOCUMENTO);

interface Props {
  empleadoId: string;
}

export const HerramientasEmpleado: React.FC<Props> = ({ empleadoId }) => {
  const [herramientas, setHerramientas] = useState<any[]>([]);
  const [dispositivos, setDispositivos] = useState<any[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const [formData, setFormData] = useState({
    FECHA_ENTREGA: '',
    DISPOSITIVO: '',
    VALOR: '',
    OBSERVACIONES: '',
    NuevoUsado: 'Nuevo',
  });

  // ✅ V00451: documentos (los guardados + los elegidos; se suben al guardar).
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([]);
  const [documentosAntes, setDocumentosAntes] = useState<ArchivoGuardado[]>([]);

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
    setFormData({ FECHA_ENTREGA: '', DISPOSITIVO: '', VALOR: '', OBSERVACIONES: '', NuevoUsado: 'Nuevo' });
    setAdjuntos([]);
    setDocumentosAntes([]);
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
    });
    const antes = documentosDe(herramienta);
    setAdjuntos(desdeGuardados(antes));
    setDocumentosAntes(antes);
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
      // ✅ V00451: los documentos nuevos se suben a herramientas_empleados/<empleado>; se guarda la
      //   lista (DOCUMENTOS) y la URL del primero en DOCUMENTO. Al editar sin cambios no se tocan.
      const cambio = cambioAdjuntos(adjuntos, documentosAntes);
      const documentos = !editandoId || cambio
        ? camposDeArchivos(cambio ? await subirAdjuntos(adjuntos, `herramientas_empleados/${empleadoId}`) : [], 'DOCUMENTOS', LEGADO_DOCUMENTO)
        : {};

      const datosFinales = {
        ...formData,
        ID_EMPLEADOS: empleadoId,
        VALOR: Number(formData.VALOR),
        ...documentos,
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
    <div className="he-x1">
      
      <div className="he-x2">
        <h3 className="he-x3">
          <span>Equipos y Herramientas Asignadas</span>
          <span className="he-x4">
            {herramientas.length} Registros
          </span>
        </h3>
        <button className="he-x5" 
          onClick={abrirModalNuevo}
        >
          + Asignar Herramienta
        </button>
      </div>

      {herramientas.length === 0 ? (
        <div className="he-x6">
          No hay herramientas asignadas a este empleado.
        </div>
      ) : (
        <div className="table-container he-x7">
          <table className="he-x8">
            <thead className="he-x9">
              <tr>
                <th className="he-x10">Fecha</th>
                <th className="he-x10">Dispositivo</th>
                <th className="he-x10">Condición</th>
                <th className="he-x10">Valor</th>
                <th className="he-x10">Documento</th>
                <th className="he-x11">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {herramientas.map((h: any) => (
                <tr className="he-x12" key={h.id}>
                  <td className="he-x13">{formatearFecha(h.FECHA_ENTREGA)}</td>
                  <td className="he-x14">{getNombreDispositivo(h.DISPOSITIVO)}</td>
                  <td className="he-x13">
                    <span style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', backgroundColor: h.NuevoUsado === 'Nuevo' ? 'rgba(35, 134, 54, 0.1)' : 'rgba(216, 67, 21, 0.1)', color: h.NuevoUsado === 'Nuevo' ? '#3fb950' : '#D84315', border: `1px solid ${h.NuevoUsado === 'Nuevo' ? '#2ea043' : '#D84315'}` }}>
                      {h.NuevoUsado}
                    </span>
                  </td>
                  <td className="he-x13">${Number(h.VALOR || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="he-x15">
                    {/* ✅ V00451: todos los documentos de la herramienta */}
                    {documentosDe(h).length > 0 ? (
                      <ul className="he-documentos">
                        {documentosDe(h).map((a) => (
                          <li key={a.url}><a className="he-x16" href={a.url} target="_blank" rel="noopener noreferrer">{a.nombre} ↗</a></li>
                        ))}
                      </ul>
                    ) : <span className="he-x17">Sin adjunto</span>}
                  </td>
                  <td className="he-x18">
                    <div className="he-x19">
                      <button className="he-x20" onClick={() => abrirModalEditar(h)}>Editar</button>
                      <button className="he-x21" onClick={() => eliminarHerramienta(h.id)}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* SOLUCIÓN: ENVOLVEMOS EL MODAL EN CREATEPORTAL PARA SACARLO DEL PADRE */}
      {modalAbierto && document.body && createPortal(
        <div className="modal-overlay he-x22">
          <div className="he-x23">
            
            <div className="he-x24">
              <h2 className="he-x25">{editandoId ? 'Editar Herramienta' : 'Asignar Herramienta'}</h2>
              <button className="he-x26" onClick={() => setModalAbierto(false)}>✕</button>
            </div>

            <form className="he-x27" onSubmit={manejarEnvio}>
              <div className="he-x28">
                
                <div>
                  <label className="he-x29">Fecha de Entrega *</label>
                  <input className="he-x30" type="date" value={formData.FECHA_ENTREGA} onChange={(e) => setFormData({ ...formData, FECHA_ENTREGA: e.target.value })} required />
                </div>

                <div>
                  <label className="he-x29">Dispositivo *</label>
                  <select className="he-x30" value={formData.DISPOSITIVO} onChange={(e) => setFormData({ ...formData, DISPOSITIVO: e.target.value })} required>
                    <option value="">Seleccione un dispositivo...</option>
                    {dispositivos.map(d => (
                      <option key={d.id} value={d.id}>{d.dispositivo}</option>
                    ))}
                  </select>
                </div>

                <div className="he-x31">
                  <div>
                    <label className="he-x29">Condición *</label>
                    <select className="he-x30" value={formData.NuevoUsado} onChange={(e) => setFormData({ ...formData, NuevoUsado: e.target.value })} required>
                      <option value="Nuevo">Nuevo</option>
                      <option value="Usado">Usado</option>
                    </select>
                  </div>
                  <div>
                    <label className="he-x29">Valor ($) *</label>
                    <input className="he-x30" type="number" step="0.01" value={formData.VALOR} onChange={(e) => setFormData({ ...formData, VALOR: e.target.value })} required />
                  </div>
                </div>

                <div>
                  <label className="he-x29">Observaciones</label>
                  <textarea className="he-x32" rows={3} value={formData.OBSERVACIONES} onChange={(e) => setFormData({ ...formData, OBSERVACIONES: e.target.value })} />
                </div>

                {/* ✅ V00451: hasta 10 documentos con vista previa y Reemplazar */}
                <div>
                  <AdjuntosArchivos etiqueta="Documentos (opcional)" tipos="cualquiera" adjuntos={adjuntos} onCambiar={setAdjuntos} deshabilitado={guardando} />
                  {guardando && hayNuevos(adjuntos) && <div className="he-x34">Subiendo documentos…</div>}
                </div>

              </div>

              <div className="he-x36">
                <button className="he-x37" type="button" onClick={() => setModalAbierto(false)}>Cancelar</button>
                <button className="he-x38" type="submit" disabled={guardando}>
                  {guardando ? (hayNuevos(adjuntos) ? 'Subiendo…' : 'Guardando...') : 'Guardar Herramienta'}
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
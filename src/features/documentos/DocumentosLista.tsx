// src/features/documentos/DocumentosLista.tsx
//
// Lista (y permite ver/descargar/eliminar) los documentos cargados para un
// registro, leyendo de la colección unificada "documentos" filtrando por el
// registro de origen { coleccionOrigen, registroId }.
//
// Es REUTILIZABLE: sirve igual para empresas, empleados, etc.
//
// Uso:
//   <DocumentosLista coleccionOrigen="empresas"  registroId={empresa.id} />
//   <DocumentosLista coleccionOrigen="empleados" registroId={empleado.id} />

import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, deleteDoc, doc } from 'firebase/firestore';
import { ref as storageRef, deleteObject } from 'firebase/storage';
import { db, storage } from '../../config/firebase';

interface DocumentosListaProps {
  coleccionOrigen: string;    // 'empresas' | 'empleados' | ...
  registroId: string;         // id del registro de origen
  permitirEliminar?: boolean; // por defecto true
}

const formatearFecha = (iso?: string) => {
  if (!iso) return '-';
  const base = iso.length > 10 ? iso : iso + 'T00:00:00';
  const d = new Date(base);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

// Estado de vencimiento: { color, texto } o null si no vence
const estadoVencimiento = (vence?: boolean, fechaVencimiento?: string) => {
  if (!vence || !fechaVencimiento) return null;
  const hoy = new Date();
  const venc = new Date(fechaVencimiento + 'T00:00:00');
  if (isNaN(venc.getTime())) return null;
  const dias = Math.floor((venc.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
  if (dias < 0) return { color: '#ef4444', texto: `Vencido hace ${Math.abs(dias)} día(s)` };
  if (dias <= 30) return { color: '#f59e0b', texto: `Vence en ${dias} día(s)` };
  return { color: '#3fb950', texto: `Vigente (vence ${formatearFecha(fechaVencimiento)})` };
};

export const DocumentosLista: React.FC<DocumentosListaProps> = ({ coleccionOrigen, registroId, permitirEliminar = true }) => {
  const [docs, setDocs] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!registroId) { setDocs([]); setCargando(false); return; }
    setCargando(true);
    setError('');
    // Filtramos solo por registroId (1 igualdad => NO requiere índice compuesto)
    // y depuramos por coleccionOrigen del lado del cliente.
    const q = query(collection(db, 'documentos'), where('registroId', '==', registroId));
    const unsub = onSnapshot(
      q,
      (snap) => {
        let lista = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        if (coleccionOrigen) lista = lista.filter(x => x.coleccionOrigen === coleccionOrigen);
        lista.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
        setDocs(lista);
        setCargando(false);
      },
      (err) => {
        console.error('Error cargando documentos:', err);
        setError('No se pudieron cargar los documentos.');
        setCargando(false);
      }
    );
    return () => unsub();
  }, [coleccionOrigen, registroId]);

  const eliminarDocumento = async (d: any) => {
    if (!window.confirm(`¿Eliminar el documento "${d.nombreArchivo || d.tipoDocumento}"?\nEsta acción no se puede deshacer.`)) return;
    try {
      if (d.path) {
        try { await deleteObject(storageRef(storage, d.path)); }
        catch (e) { console.warn('No se pudo borrar el archivo de Storage (se borrará el registro de todos modos):', e); }
      }
      await deleteDoc(doc(db, 'documentos', d.id));
    } catch (e: any) {
      console.error('Error eliminando documento:', e);
      alert('No se pudo eliminar el documento.\n\nDetalle: ' + (e?.message || e));
    }
  };

  if (cargando) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e' }}>Cargando documentos...</div>;
  }

  if (error) {
    return <div style={{ padding: '24px', textAlign: 'center', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.05)', borderRadius: '8px', border: '1px solid rgba(239,68,68,0.3)' }}>{error}</div>;
  }

  if (docs.length === 0) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#8b949e', backgroundColor: '#161b22', borderRadius: '8px', border: '1px solid #30363d' }}>
        Aún no se han cargado documentos para este registro.
      </div>
    );
  }

  return (
    <div style={{ animation: 'fadeIn 0.3s ease', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ color: '#8b949e', fontSize: '0.85rem', margin: '0 0 4px 0' }}>
        {docs.length} documento(s) cargado(s).
      </p>

      {docs.map(d => {
        const venc = estadoVencimiento(d.vence, d.fechaVencimiento);
        return (
          <div key={d.id} style={{ backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '14px 16px', display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            {/* Icono */}
            <div style={{ flexShrink: 0, marginTop: '2px' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            </div>

            {/* Datos */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: '#f0f6fc', fontWeight: 600, fontSize: '0.92rem' }}>{d.tipoDocumento || 'Documento'}</div>
              <div style={{ color: '#8b949e', fontSize: '0.8rem', wordBreak: 'break-all', marginTop: '2px' }}>{d.nombreArchivo || '-'}</div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginTop: '8px', fontSize: '0.78rem', color: '#8b949e' }}>
                <span>Subido: {formatearFecha(d.createdAt)}</span>
                {d.vence && <span>Expedición: {formatearFecha(d.fechaExpedicion)}</span>}
              </div>

              {venc && (
                <span style={{ display: 'inline-block', marginTop: '8px', fontSize: '0.75rem', fontWeight: 600, color: venc.color, backgroundColor: `${venc.color}1a`, border: `1px solid ${venc.color}55`, borderRadius: '12px', padding: '3px 10px' }}>
                  {venc.texto}
                </span>
              )}

              {d.observaciones && (
                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#c9d1d9', fontStyle: 'italic' }}>“{d.observaciones}”</div>
              )}
            </div>

            {/* Acciones */}
            <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
              {d.url && (
                <a
                  href={d.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', backgroundColor: '#D84315', color: '#fff', textDecoration: 'none', fontSize: '0.8rem', fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Ver / Descargar
                </a>
              )}
              {permitirEliminar && (
                <button
                  type="button"
                  onClick={() => eliminarDocumento(d)}
                  title="Eliminar documento"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  Eliminar
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
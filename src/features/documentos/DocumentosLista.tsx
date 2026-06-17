// src/features/documentos/DocumentosLista.tsx
//
// Lista REUTILIZABLE de documentos de un registro (empleado, cliente, etc.).
// Consulta la colección unificada "documentos" filtrando por { coleccionOrigen, registroId }.
//
// Uso:
//   <DocumentosLista coleccionOrigen="empleados" registroId={emp.id} />
//   <DocumentosLista coleccionOrigen="clientes"  registroId={cli.id} />

import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../config/firebase';

interface DocumentosListaProps {
  coleccionOrigen: string;
  registroId: string;
}

const formatearFecha = (iso: string) => {
  if (!iso) return '-';
  const f = new Date(iso);
  if (isNaN(f.getTime())) return '-';
  return f.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const DocumentosLista: React.FC<DocumentosListaProps> = ({ coleccionOrigen, registroId }) => {
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!registroId) { setDocumentos([]); setCargando(false); return; }
    setCargando(true);
    setError(null);

    const q = query(
      collection(db, 'documentos'),
      where('coleccionOrigen', '==', coleccionOrigen),
      where('registroId', '==', registroId)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr = snap.docs.map(d => ({ id: d.id, ...d.data() } as any));
        // Orden por fecha (más reciente primero), del lado del cliente
        arr.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        setDocumentos(arr);
        setCargando(false);
      },
      (err) => {
        console.error('Error consultando documentos:', err);
        setError('No se pudieron cargar los documentos. Si es la primera vez, Firestore puede pedir crear un índice (revisa la consola del navegador).');
        setCargando(false);
      }
    );

    return () => unsub();
  }, [coleccionOrigen, registroId]);

  const estaVencido = (doc: any) => doc.vence && doc.fechaVencimiento && new Date(doc.fechaVencimiento + 'T00:00:00') < new Date();

  if (cargando) {
    return <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px' }}>Cargando documentos...</div>;
  }

  if (error) {
    return <div style={{ textAlign: 'center', color: '#f85149', padding: '24px', fontSize: '0.9rem' }}>{error}</div>;
  }

  if (documentos.length === 0) {
    return (
      <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px' }}>
        Este registro aún no tiene documentos. Usa el botón <strong style={{ color: '#D84315' }}>Subir Documentos</strong> para agregar uno.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ color: '#8b949e', fontSize: '0.8rem' }}>{documentos.length} documento(s)</div>
      {documentos.map((doc) => {
        const vencido = estaVencido(doc);
        return (
          <div key={doc.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#f0f6fc', fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.tipoDocumento || doc.nombreArchivo}</div>
                <div style={{ color: '#8b949e', fontSize: '0.78rem', display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '2px' }}>
                  <span>Subido: {formatearFecha(doc.createdAt)}</span>
                  {doc.vence && (
                    <span style={{ color: vencido ? '#f85149' : '#3fb950' }}>
                      {vencido ? 'Vencido' : 'Vence'}: {formatearFecha(doc.fechaVencimiento)}
                    </span>
                  )}
                  {doc.observaciones ? <span style={{ fontStyle: 'italic' }}>“{doc.observaciones}”</span> : null}
                </div>
              </div>
            </div>
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '7px 12px', borderRadius: '6px', border: '1px solid #30363d', backgroundColor: '#21262d', color: '#c9d1d9', textDecoration: 'none', fontSize: '0.8rem', fontWeight: 600 }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              Ver
            </a>
          </div>
        );
      })}
    </div>
  );
};
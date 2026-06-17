// src/features/documentos/DocumentoUploadModal.tsx
//
// Modal REUTILIZABLE para subir documentos desde cualquier módulo
// (empleados, clientes, proveedores, unidades, etc.).
//
// • Sube el archivo a Firebase Storage en:
//     <coleccionOrigen>/<nombre del registro>/<nombre del documento>/<archivo>
// • Registra la metadata en la colección UNIFICADA "documentos", LIGADA al
//   registro de origen mediante { coleccionOrigen, registroId }.
//
// De esta forma el documento siempre queda conectado con el registro desde el
// que se cargó (empleado, cliente, etc.). Para listar los documentos de un
// registro basta con:
//   where('coleccionOrigen','==','empleados') + where('registroId','==', <id>)
//
// Ejemplos de uso:
//   <DocumentoUploadModal coleccionOrigen="empleados" registroId={emp.id} registroNombre="Juan Pérez" ... />
//   <DocumentoUploadModal coleccionOrigen="clientes"  registroId={cli.id} registroNombre="ACME SA de CV" ... />

import React, { useState } from 'react';
import { collection, addDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../config/firebase';

// Catálogo por defecto (genérico). Cada módulo puede pasar su propia lista por props.
const TIPOS_DOCUMENTO_DEFAULT = [
  '1. Identificación Oficial',
  '2. Comprobante de Domicilio',
  '3. RFC (Constancia de Situación Fiscal)',
  '4. Contrato',
  '5. Otro',
];

// Quita caracteres no válidos para rutas de Storage
const sanitizarRuta = (s: string) =>
  String(s || '').trim().replace(/[\/\\:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();
// Subcarpeta = nombre del documento sin el prefijo numérico ("16. " -> "Contrato Laboral")
const nombreSubcarpetaDoc = (label: string) => sanitizarRuta(String(label).replace(/^\d+\.\s*/, ''));

interface DocumentoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  coleccionOrigen: string;     // colección desde la que se sube: 'empleados', 'clientes', ...
  registroId: string;          // id del registro de origen (para ligar el documento)
  registroNombre: string;      // nombre legible del registro (se usa como carpeta)
  tiposDocumento?: string[];   // catálogo de tipos; si no se pasa, usa el default
  onUploaded?: () => void;
}

export const DocumentoUploadModal: React.FC<DocumentoUploadModalProps> = ({
  isOpen, onClose, coleccionOrigen, registroId, registroNombre, tiposDocumento, onUploaded,
}) => {
  const tipos = (tiposDocumento && tiposDocumento.length > 0) ? tiposDocumento : TIPOS_DOCUMENTO_DEFAULT;
  const [tipoDoc, setTipoDoc] = useState(tipos[0]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [vence, setVence] = useState(false);
  const [fechaExpedicion, setFechaExpedicion] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  if (!isOpen) return null;

  const carpeta = sanitizarRuta(registroNombre) || sanitizarRuta(registroId) || 'sin_nombre';
  const subcarpeta = nombreSubcarpetaDoc(tipoDoc);

  const labelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.9rem' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '8px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' };
  const filaStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: '16px' };
  const segBtn = (activo: boolean, colorActivo: string): React.CSSProperties => ({
    padding: '10px 30px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
    backgroundColor: activo ? colorActivo : 'transparent',
    color: activo ? '#fff' : '#8b949e', transition: 'all 0.15s ease',
  });

  const handleSubir = async () => {
    if (!archivo) { alert('Selecciona un archivo.'); return; }
    if (!registroId) { alert('No se puede ligar el documento: falta el identificador del registro de origen.'); return; }
    if (vence && (!fechaExpedicion || !fechaVencimiento)) {
      alert('Como el documento vence, debes indicar la fecha de expedición y la de vencimiento.');
      return;
    }
    setSubiendo(true);
    try {
      const ruta = `${sanitizarRuta(coleccionOrigen)}/${carpeta}/${subcarpeta}/${Date.now()}_${sanitizarRuta(archivo.name)}`;
      const r = storageRef(storage, ruta);
      await uploadBytes(r, archivo);
      const url = await getDownloadURL(r);

      // Colección UNIFICADA "documentos" + liga al registro de origen
      await addDoc(collection(db, 'documentos'), {
        coleccionOrigen,
        registroId,
        registroNombre: registroNombre || '',
        tipoDocumento: tipoDoc,
        carpeta,
        subcarpeta,
        nombreArchivo: archivo.name,
        path: ruta,
        url,
        vence,
        fechaExpedicion: vence ? fechaExpedicion : '',
        fechaVencimiento: vence ? fechaVencimiento : '',
        observaciones: observaciones || '',
        createdAt: new Date().toISOString(),
      });

      alert('Documento subido correctamente.');
      setArchivo(null);
      setObservaciones('');
      setVence(false);
      setFechaExpedicion('');
      setFechaVencimiento('');
      onUploaded?.();
      onClose();
    } catch (e: any) {
      console.error('Error subiendo documento:', e);
      alert('No se pudo subir el documento.\n\nVerifica que Firebase Storage esté habilitado y que las reglas permitan la escritura.\n\nDetalle: ' + (e?.message || e));
    }
    setSubiendo(false);
  };

  return (
    <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 2100 }}>
      <div className="form-card" style={{ maxWidth: '720px', width: '95%', borderRadius: '14px', border: '1px solid #30363d', backgroundColor: '#0d1117', display: 'flex', flexDirection: 'column', maxHeight: '92vh' }}>
        <div className="form-header" style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <h3 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.15rem' }}>Subir Documento{registroNombre ? ` — ${registroNombre}` : ''}</h3>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
        </div>

        <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ fontSize: '0.75rem', color: '#6e7681', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', padding: '10px 12px' }}>
            Se guardará en: <span style={{ color: '#8b949e' }}>{sanitizarRuta(coleccionOrigen)} / {carpeta} / {subcarpeta} /</span>
            <span style={{ color: '#6e7681' }}> · ligado a {coleccionOrigen} ({registroId || '—'})</span>
          </div>

          <div style={filaStyle}>
            <label style={labelStyle}>Tipo de archivo</label>
            <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} style={inputStyle}>
              {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div style={filaStyle}>
            <label style={labelStyle}>Archivo</label>
            <label
              onDragOver={(e) => { e.preventDefault(); if (!arrastrando) setArrastrando(true); }}
              onDragLeave={(e) => { e.preventDefault(); setArrastrando(false); }}
              onDrop={(e) => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer?.files?.[0]; if (f) setArchivo(f); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', minHeight: '90px', padding: '16px', borderRadius: '8px', cursor: 'pointer', backgroundColor: arrastrando ? 'rgba(216,67,21,0.1)' : '#010409', border: arrastrando ? '1px dashed #D84315' : (archivo ? '1px solid rgba(63,185,80,0.5)' : '1px solid #30363d') }}
            >
              {archivo ? (
                <span style={{ color: '#3fb950', fontWeight: 600, fontSize: '0.85rem', textAlign: 'center', wordBreak: 'break-all' }}>✓ {archivo.name}</span>
              ) : (
                <>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span style={{ color: '#8b949e', fontSize: '0.82rem' }}>Haz clic o arrastra un archivo aquí</span>
                </>
              )}
              <input type="file" accept=".pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] || null)} style={{ display: 'none' }} />
            </label>
          </div>

          <div style={filaStyle}>
            <label style={labelStyle}>¿Vence?</label>
            <div style={{ display: 'inline-flex', border: '1px solid #30363d', borderRadius: '8px', overflow: 'hidden', width: 'fit-content' }}>
              <button type="button" onClick={() => setVence(false)} style={segBtn(!vence, '#30363d')}>No</button>
              <button type="button" onClick={() => setVence(true)} style={segBtn(vence, '#D84315')}>Si</button>
            </div>
          </div>

          {vence && (
            <>
              <div style={filaStyle}>
                <label style={labelStyle}>Fecha de expedición</label>
                <input type="date" value={fechaExpedicion} onChange={(e) => setFechaExpedicion(e.target.value)} style={inputStyle} />
              </div>
              <div style={filaStyle}>
                <label style={labelStyle}>Fecha de vencimiento</label>
                <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} style={inputStyle} />
              </div>
            </>
          )}

          <div style={{ ...filaStyle, alignItems: 'flex-start' }}>
            <label style={{ ...labelStyle, paddingTop: '8px' }}>Observaciones</label>
            <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Notas opcionales sobre el documento..." />
          </div>
        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px', flexShrink: 0 }}>
          <button type="button" onClick={onClose} disabled={subiendo} className="btn btn-outline" style={{ padding: '10px 20px', borderRadius: '6px' }}>Cancelar</button>
          <button type="button" onClick={handleSubir} disabled={subiendo} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: subiendo ? '#21262d' : '#D84315', color: subiendo ? '#6e7681' : '#fff', fontWeight: 'bold', cursor: subiendo ? 'not-allowed' : 'pointer' }}>
            {subiendo ? 'Subiendo...' : 'Subir Documento'}
          </button>
        </div>
      </div>
    </div>
  );
};
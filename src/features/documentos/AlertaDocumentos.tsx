// src/features/documentos/AlertaDocumentos.tsx
// ---------------------------------------------------------------------------
// ✅ V00135: ALERTA DE DOCUMENTOS al seleccionar cliente / proveedor / unidad /
//   operador en una operación. Revisa la colección `documentos` del registro:
//   · 🔴 "Sin documentos"  → el registro no tiene ningún documento adjunto.
//   · 🔴 "N vencido(s)"    → documentos con fecha de vencimiento pasada.
//   · 🟠 "N por vencer"    → vencen en 30 días o menos.
//   Al presionar la alerta se abre un modal con el detalle (documento, fecha y
//   estado) y un botón para SUBIR / ACTUALIZAR el documento ahí mismo
//   (DocumentoUploadModal). Al subir, se re-verifica en vivo (onSnapshot).
// ---------------------------------------------------------------------------
import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { DocumentoUploadModal } from './DocumentoUploadModal';
import './AlertaDocumentos.css';

interface DocInfo {
  id: string;
  nombre: string;
  modulo?: string;
  vence?: boolean;
  fechaVencimiento?: string;
  dias: number | null; // días para vencer (negativo = vencido); null = no vence
}

interface Props {
  /** Colección de origen del registro: 'empresas' | 'empleados' | 'unidades' | … */
  coleccionOrigen: string;
  registroId: string;
  registroNombre: string;
  /** Etiqueta corta para los textos: 'Cliente', 'Proveedor', 'Unidad', 'Operador'. */
  etiqueta: string;
}

const fmtFecha = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return d && m && y ? `${d}/${m}/${y}` : iso;
};

export const AlertaDocumentos: React.FC<Props> = ({ coleccionOrigen, registroId, registroNombre, etiqueta }) => {
  const [docs, setDocs] = useState<DocInfo[] | null>(null); // null = cargando
  const [abierto, setAbierto] = useState(false);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    setDocs(null); setAbierto(false);
    if (!registroId) { setDocs([]); return; }
    const q = query(collection(db, 'documentos'), where('registroId', '==', registroId));
    const unsub = onSnapshot(q, (snap) => {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const lista: DocInfo[] = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((x: any) => !coleccionOrigen || String(x.coleccionOrigen || '') === coleccionOrigen)
        .map((x: any) => {
          let dias: number | null = null;
          if (x.vence && x.fechaVencimiento) {
            const v = new Date(String(x.fechaVencimiento) + 'T00:00:00');
            if (!isNaN(v.getTime())) dias = Math.floor((v.getTime() - hoy.getTime()) / 86400000);
          }
          return { id: x.id, nombre: String(x.nombre || x.tipoDocumento || x.archivoNombre || 'Documento'), modulo: x.modulo, vence: x.vence, fechaVencimiento: x.fechaVencimiento, dias };
        });
      setDocs(lista);
    }, () => setDocs([]));
    return () => unsub();
  }, [registroId, coleccionOrigen]);

  const resumen = useMemo(() => {
    if (!docs) return null;
    const vencidos = docs.filter((d) => d.dias !== null && d.dias < 0);
    const porVencer = docs.filter((d) => d.dias !== null && d.dias >= 0 && d.dias <= 30);
    return { total: docs.length, vencidos, porVencer };
  }, [docs]);

  if (!registroId || !resumen) return null;

  const sinDocs = resumen.total === 0;
  const hayVencidos = resumen.vencidos.length > 0;
  const hayPorVencer = resumen.porVencer.length > 0;
  if (!sinDocs && !hayVencidos && !hayPorVencer) return null; // todo en orden → sin ruido

  const nivel = (sinDocs || hayVencidos) ? 'rojo' : 'ambar';
  const textoBoton = sinDocs
    ? `⚠ ${etiqueta} sin documentos`
    : hayVencidos
      ? `⚠ ${resumen.vencidos.length} documento(s) vencido(s)${hayPorVencer ? ` · ${resumen.porVencer.length} por vencer` : ''}`
      : `⏳ ${resumen.porVencer.length} documento(s) por vencer`;

  return (
    <>
      <button type="button" className={`adoc-alerta adoc-${nivel}`} onClick={() => setAbierto(true)} title={`Ver el estado de los documentos de ${registroNombre || etiqueta}`}>
        {textoBoton}
      </button>

      {abierto && (
        <div className="modal-overlay adoc-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setAbierto(false); }}>
          <div className="adoc-card">
            <div className="adoc-header">
              <h3 className="adoc-titulo">📄 Documentos · {etiqueta}: <span className="adoc-nombre">{registroNombre || registroId}</span></h3>
              <button type="button" className="adoc-cerrar" onClick={() => setAbierto(false)}>✕</button>
            </div>
            <div className="adoc-cuerpo">
              {sinDocs ? (
                <div className="adoc-vacio">
                  <p className="adoc-vacio-txt">Este {etiqueta.toLowerCase()} <b>no tiene documentos adjuntos</b>.</p>
                  <p className="adoc-vacio-sub">Sube su documentación para tener el expediente completo.</p>
                </div>
              ) : (
                <>
                  {hayVencidos && (
                    <>
                      <h4 className="adoc-sub adoc-sub-rojo">Vencidos ({resumen.vencidos.length})</h4>
                      <table className="adoc-tabla">
                        <tbody>
                          {resumen.vencidos.map((d) => (
                            <tr key={d.id}>
                              <td className="adoc-doc">{d.nombre}{d.modulo ? <span className="adoc-mod"> · {d.modulo}</span> : null}</td>
                              <td className="adoc-fecha">{fmtFecha(d.fechaVencimiento)}</td>
                              <td className="adoc-estado adoc-txt-rojo">Vencido hace {Math.abs(d.dias!)} día(s)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                  {hayPorVencer && (
                    <>
                      <h4 className="adoc-sub adoc-sub-ambar">Por vencer en 30 días ({resumen.porVencer.length})</h4>
                      <table className="adoc-tabla">
                        <tbody>
                          {resumen.porVencer.map((d) => (
                            <tr key={d.id}>
                              <td className="adoc-doc">{d.nombre}{d.modulo ? <span className="adoc-mod"> · {d.modulo}</span> : null}</td>
                              <td className="adoc-fecha">{fmtFecha(d.fechaVencimiento)}</td>
                              <td className="adoc-estado adoc-txt-ambar">Vence en {d.dias} día(s)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </>
              )}
              <div className="adoc-acciones">
                <button type="button" className="btn btn-outline" onClick={() => setAbierto(false)}>Cerrar</button>
                <button type="button" className="btn btn-primary" onClick={() => setSubiendo(true)}>
                  {sinDocs ? '⬆ Subir documentos' : '⬆ Actualizar documentos'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DocumentoUploadModal
        isOpen={subiendo}
        onClose={() => setSubiendo(false)}
        coleccionOrigen={coleccionOrigen}
        registroId={registroId}
        registroNombre={registroNombre || registroId}
      />
    </>
  );
};

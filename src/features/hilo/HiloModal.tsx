// src/features/hilo/HiloModal.tsx
// ✅ V00126: VERIFICADOR DEL HILO Operaciones → Facturación → Pagos.
//   Lee en vivo la(s) factura(s) de un pago, sus operaciones y comprueba que
//   cada eslabón apunte al siguiente: la operación apunta a la factura, la
//   factura lista a la operación, el pago aparece aplicado en la factura y los
//   montos cuadran. Marca ✓ / ⚠ en cada eslabón.
import React, { useEffect, useState } from 'react';
import { collection, doc, documentId, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../config/firebase';
import './HiloModal.css';

export type TipoHilo = 'cliente' | 'proveedor';

interface OpHilo { id: string; ref: string; fechaServicio: string; status: string; facturaLigada: string; ok: boolean; existe: boolean; }
interface FacHilo { id: string; invoice: string; existe: boolean; total: number; pagado: number; saldo: number; moneda: string; opsIds: string[]; ops: OpHilo[]; pagoAplicado: boolean; aplicadoEnPago: number; okOps: boolean; }

interface Props {
  tipo: TipoHilo;
  pago?: { id: string; numeroPago: string; monto: number; moneda: string; facturas: Array<{ facturaId: string; invoice: string; aplicado: number }> } | null;
  /** Alternativa: revisar el hilo a partir de una factura (sin pago). */
  facturaId?: string;
  onClose: () => void;
  onEditarOperacion?: (opId: string) => void;
}

const fmt = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;

export const HiloModal: React.FC<Props> = ({ tipo, pago, facturaId, onClose, onEditarOperacion }) => {
  const [facs, setFacs] = useState<FacHilo[] | null>(null);
  const [error, setError] = useState('');
  const colFact = tipo === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
  const campoFacEnOp = tipo === 'cliente' ? 'facturaClienteId' : 'facturaProveedorId';

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const objetivos: Array<{ facturaId: string; invoice: string; aplicado: number }> = pago
          ? (pago.facturas || []).map(f => ({ facturaId: String(f.facturaId), invoice: String(f.invoice || ''), aplicado: Number(f.aplicado) || 0 }))
          : facturaId ? [{ facturaId, invoice: '', aplicado: 0 }] : [];
        const resultado: FacHilo[] = [];
        for (const f of objetivos) {
          const snap = await getDoc(doc(db, colFact, f.facturaId));
          const raw: any = snap.exists() ? snap.data() : null;
          const opsIds: string[] = raw && Array.isArray(raw.operacionesIds) ? raw.operacionesIds.map(String) : [];
          const ops: OpHilo[] = [];
          for (let i = 0; i < opsIds.length; i += 10) {
            const lote = opsIds.slice(i, i + 10);
            const sOps = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', lote)));
            const vistos = new Set<string>();
            sOps.docs.forEach(d => {
              const o: any = d.data(); vistos.add(d.id);
              const ligada = String(o[campoFacEnOp] || '');
              ops.push({ id: d.id, ref: String(o.ref || o.numReferencia || d.id.slice(0, 6)), fechaServicio: String(o.fechaServicio || '').slice(0, 10), status: String(o.statusNombre || o.status || ''), facturaLigada: ligada, ok: ligada === f.facturaId, existe: true });
            });
            lote.filter(id => !vistos.has(id)).forEach(id => ops.push({ id, ref: id.slice(0, 6), fechaServicio: '', status: '', facturaLigada: '', ok: false, existe: false }));
          }
          const pagosIds: string[] = raw && Array.isArray(raw.pagosIds) ? raw.pagosIds.map(String) : [];
          const pagoAplicado = !pago ? true : (pagosIds.includes(pago.id) && (Number(raw?.montoPagado) || 0) >= f.aplicado - 0.009);
          const total = Number(raw?.subtotalMonedaFactura) || Number(raw?.total) || Number(raw?.subtotalFactura) || 0;
          const pagado = Number(raw?.montoPagado) || 0;
          resultado.push({ id: f.facturaId, invoice: String(raw?.invoice || f.invoice || f.facturaId), existe: !!raw, total, pagado, saldo: Math.max(0, total - pagado), moneda: String(raw?.monedaFacturacion || raw?.moneda || ''), opsIds, ops, pagoAplicado, aplicadoEnPago: f.aplicado, okOps: ops.length > 0 && ops.every(o => o.ok) });
        }
        if (activo) setFacs(resultado);
      } catch (e: any) { if (activo) setError(e?.message || String(e)); }
    })();
    return () => { activo = false; };
  }, [pago?.id, facturaId, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  const todoOk = !!facs && facs.length > 0 && facs.every(f => f.existe && f.okOps && f.pagoAplicado);

  return (
    <div className="modal-overlay hm-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="form-card hm-card">
        <div className="form-header hm-header">
          <h3 className="hm-titulo">🔗 Hilo Operaciones → Facturación → Pagos{pago ? ` · Pago ${pago.numeroPago}` : ''}</h3>
          <button type="button" className="close-x hm-cerrar" onClick={onClose}>✕</button>
        </div>
        <div className="hm-cuerpo">
          {error && <div className="hm-alerta">⚠ {error}</div>}
          {!facs && !error && <p className="hm-cargando">⏳ Verificando eslabones…</p>}
          {facs && (
            <>
              <div className={`hm-resumen ${todoOk ? 'ok' : 'alerta'}`}>
                {todoOk ? '✓ El hilo está completo: cada operación apunta a su factura y el pago está aplicado en la factura.' : '⚠ Hay eslabones rotos o incompletos. Revisa los marcados.'}
              </div>
              {facs.length === 0 && <p className="hm-cargando">Este pago no tiene facturas ligadas.</p>}
              {facs.map(f => (
                <div className="hm-factura" key={f.id}>
                  <div className={`hm-eslabon ${f.existe ? 'ok' : 'alerta'}`}>
                    <span className="hm-icono">{f.existe ? '✓' : '⚠'}</span>
                    <b>Factura {f.invoice}</b>
                    {f.existe ? <span className="hm-meta">Total {fmt(f.total)} {f.moneda} · Pagado {fmt(f.pagado)} · Saldo {fmt(f.saldo)}</span> : <span className="hm-meta">No existe en la base de datos</span>}
                  </div>
                  {pago && (
                    <div className={`hm-eslabon hm-sub ${f.pagoAplicado ? 'ok' : 'alerta'}`}>
                      <span className="hm-icono">{f.pagoAplicado ? '✓' : '⚠'}</span>
                      <span>Pago {pago.numeroPago} aplicado a esta factura: {fmt(f.aplicadoEnPago)} {pago.moneda}</span>
                      {!f.pagoAplicado && <span className="hm-meta">La factura no registra este pago (montoPagado menor a lo aplicado)</span>}
                    </div>
                  )}
                  <div className={`hm-eslabon hm-sub ${f.okOps ? 'ok' : 'alerta'}`}>
                    <span className="hm-icono">{f.okOps ? '✓' : '⚠'}</span>
                    <span>{f.ops.length} operación(es) ligadas a la factura</span>
                  </div>
                  {f.ops.length > 0 && (
                    <table className="data-table hm-tabla">
                      <thead><tr><th></th><th>Ref.</th><th>Fecha</th><th>Status</th><th>Apunta a la factura</th><th></th></tr></thead>
                      <tbody>
                        {f.ops.map(o => (
                          <tr key={o.id} className={o.ok ? '' : 'hm-fila-alerta'}>
                            <td>{o.ok ? '✓' : '⚠'}</td>
                            <td className="hm-mono">{o.ref}</td>
                            <td>{o.fechaServicio || '—'}</td>
                            <td>{o.status || '—'}</td>
                            <td>{!o.existe ? 'La operación no existe' : o.ok ? 'Sí' : (o.facturaLigada ? `No: apunta a ${o.facturaLigada.slice(0, 8)}…` : 'No: sin factura ligada')}</td>
                            <td>{onEditarOperacion && o.existe && <button type="button" className="btn btn-outline hm-btn" onClick={() => onEditarOperacion(o.id)}>✎ Operación</button>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// src/features/facturacion/components/FilaCfdi.tsx
// ---------------------------------------------------------------------------
// ✅ V00513 — Una factura leída de su XML en "Subir XML": encabezado (folio, cliente,
// fecha, importe, estado) y el detalle de cada concepto contra la app.
// ---------------------------------------------------------------------------
import type { EstadoCotejo, ResultadoCotejo } from '../services/cotejoCfdi';
import Importe from './Importe';

const ESTADOS: Record<EstadoCotejo, { icono: string; texto: string }> = {
  listo: { icono: '✅', texto: 'Cuadra: lista para registrar' },
  diferencias: { icono: '⚠️', texto: 'No cuadra' },
  bloqueada: { icono: '🚫', texto: 'No se puede registrar' },
  sin_operacion: { icono: '❌', texto: 'Sin operación en la app' },
  registrada: { icono: '✔', texto: 'Registrada en la app' },
};

interface Props {
  resultado: ResultadoCotejo;
  nombreArchivo: string;
  /** ✅ V00513: PDF que se juntó con este XML ('' = no se subió). */
  nombrePdf: string;
  nombreCliente: string;
  /** Otro XML de esta misma carga ya trae ese UUID. */
  repetidoEnCarga: boolean;
  onRegistrar: () => void;
}

export default function FilaCfdi({ resultado, nombreArchivo, nombrePdf, nombreCliente, repetidoEnCarga, onRegistrar }: Props) {
  const { cfdi, estado, renglones, problemas, notas } = resultado;
  const e = repetidoEnCarga ? { icono: '🚫', texto: 'XML repetido en esta carga' } : ESTADOS[estado];
  const puedeRegistrar = estado === 'listo' && !repetidoEnCarga;
  return (
    <li className={`sxm-fila sxm-fila--${repetidoEnCarga ? 'bloqueada' : estado}`}>
      <details open={!puedeRegistrar && estado !== 'registrada' && !repetidoEnCarga}>
        <summary className="sxm-resumen">
          <span className="sxm-folio">{cfdi.folio}</span>
          <span className="sxm-cliente" title={`${cfdi.receptorNombre} · ${cfdi.receptorRfc}`}>{nombreCliente || cfdi.receptorNombre}</span>
          <span className="sxm-fecha">{cfdi.fecha}</span>
          <Importe className="sxm-importe" monto={cfdi.subtotal} moneda={cfdi.moneda} conNombre />
          <span className={`sxm-pdf${nombrePdf ? '' : ' sxm-pdf--falta'}`} title={nombrePdf || 'Sube también el PDF de esta factura'}>{nombrePdf ? '📄 PDF' : '⚠ Sin PDF'}</span>
          <span className="sxm-estado">{e.icono} {e.texto}</span>
        </summary>
        <div className="sxm-detalle">
          <p className="sxm-archivo">{nombrePdf ? `${nombrePdf} + ` : 'Sin PDF · '}{nombreArchivo} · UUID {cfdi.uuid || '—'}{cfdi.tipoCambio ? ` · TC ${cfdi.tipoCambio}` : ''}</p>
          <table className="sxm-tabla">
            <thead>
              <tr><th>Referencia</th><th>Concepto</th><th className="sxm-num">XML</th><th className="sxm-num">App</th><th>Revisión</th></tr>
            </thead>
            <tbody>
              {renglones.map((r, i) => (
                // Los conceptos no tienen id propio y no se reordenan: el índice es estable.
                <tr key={`${r.refs.join(',')}-${i}`} className={r.problema ? 'sxm-renglon--mal' : ''}>
                  <td className="sxm-ref">{r.refs.join(', ') || '—'}</td>
                  <td className="sxm-concepto" title={r.descripcion}>{r.descripcion.replace(/\s+/g, ' ').slice(0, 48)}</td>
                  <td className="sxm-num"><Importe monto={r.importeXml} moneda={cfdi.moneda} /></td>
                  <td className="sxm-num">{r.importeApp === null ? '—' : <Importe monto={r.importeApp} moneda={cfdi.moneda} />}</td>
                  <td>{r.problema || '✅'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {problemas.length > 0 && (
            <ul className="sxm-problemas">{problemas.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
          {notas.length > 0 && (
            <ul className="sxm-notas">{notas.map((n) => <li key={n}>{n}</li>)}</ul>
          )}
        </div>
      </details>
      {puedeRegistrar && (
        <button type="button" className="sxm-registrar" onClick={onRegistrar}>Registrar factura</button>
      )}
    </li>
  );
}

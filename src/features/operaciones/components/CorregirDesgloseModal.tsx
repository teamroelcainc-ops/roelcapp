// src/features/operaciones/components/CorregirDesgloseModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00532 — "Corregir desglose" (Operaciones). Pedido de Roelca (TR-221026-023, Facturado en
// Pesos): "el subtotal dice 2237,1, pero el total dice 120 y en dólares dice 120, pero debería
// decir en pesos 2237,10". Esta ventana:
//   1) revisa TODAS las operaciones sin escribir nada y lista las que tienen Total, Dólares y Pesos
//      en otra moneda que su "Facturado en" (con la Conversión correcta);
//   2) con prueba, respaldo y APLICAR, les pone esos tres campos como los calcula el formulario.
// La Conversión, la Utilidad y las facturas no cambian. Regla en services/corregirDesglose.ts.
// ---------------------------------------------------------------------------
import { useEffect, useEffectEvent, useState } from 'react';
import { createPortal } from 'react-dom';
import CargandoDatos from '../../../shared/components/CargandoDatos';
import Importe, { NombreMoneda } from '../../facturacion/components/Importe';
import type { CambioDesglose, RevisionDesglose } from '../services/corregirDesglose';
import { revisarDesgloseTodas } from '../services/corregirDesgloseDatos';
import type { RevisionDesgloseTodas } from '../services/corregirDesgloseDatos';
import CorregirDesglosePasos from './CorregirDesglosePasos';
import './CorregirDesgloseModal.css';

interface Props {
  onCerrar: () => void;
}

type Fase =
  | { tipo: 'revisando'; leidas: number; total: number }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; datos: RevisionDesgloseTodas };

const MAX_FILAS = 200;
const n = (x: number): string => x.toLocaleString('es-MX');
const LADO = { cliente: 'Cliente', proveedor: 'Proveedor' } as const;

/** "antes → después" de un importe (el de antes tachado si cambia). */
function Par({ antes, despues, moneda }: { antes: number; despues: number; moneda: string }) {
  if (Math.abs(antes - despues) < 0.005) return <Importe monto={despues} moneda={moneda} />;
  return <><Importe monto={antes} moneda={moneda} className="cdg-antes" /> → <Importe monto={despues} moneda={moneda} /></>;
}

function Fila({ r, c, primera }: { r: RevisionDesglose; c: CambioDesglose; primera: boolean }) {
  return (
    <tr>
      <td className="cdg-ref">{primera ? r.ref : ''}</td>
      <td>{LADO[c.lado]}</td>
      <td className="cdg-empresa">{c.empresa || '—'}</td>
      <td><NombreMoneda moneda={c.facturadoEn} /></td>
      <td className="cdg-num"><Par antes={c.antes.total} despues={c.despues.total} moneda={c.facturadoEn} /></td>
      <td className="cdg-num"><Par antes={c.antes.dol} despues={c.despues.dol} moneda="USD" /></td>
      <td className="cdg-num"><Par antes={c.antes.pes} despues={c.despues.pes} moneda="MXN" /></td>
      <td className="cdg-num"><Importe monto={c.conv} moneda="MXN" /></td>
      <td className="cdg-factura">{c.facturada ? (c.factura || 'Sí') : '—'}</td>
    </tr>
  );
}

export default function CorregirDesgloseModal({ onCerrar }: Props) {
  const [fase, setFase] = useState<Fase>({ tipo: 'revisando', leidas: 0, total: 0 });
  const [trabajando, setTrabajando] = useState(false);

  // Revisión al abrir: solo lecturas (una por operación).
  const revisar = useEffectEvent(async (sigue: () => boolean) => {
    try {
      const datos = await revisarDesgloseTodas((leidas, total) => { if (sigue()) setFase({ tipo: 'revisando', leidas, total }); }, sigue);
      if (sigue()) setFase({ tipo: 'listo', datos });
    } catch (e) {
      console.error('No se pudieron revisar las operaciones (Corregir desglose):', e);
      if (sigue()) setFase({ tipo: 'error', mensaje: 'No se pudieron leer las operaciones. Revisa la conexión e intenta de nuevo.' });
    }
  });
  useEffect(() => {
    let vivo = true;
    void revisar(() => vivo);
    return () => { vivo = false; };
  }, []);

  const cambios = fase.tipo === 'listo' ? fase.datos.revisiones.flatMap((r) => r.cambios) : [];
  const facturadas = cambios.filter((c) => c.facturada).length;

  return createPortal(
    <div className="modal-overlay cdg-fondo" role="dialog" aria-modal="true" aria-labelledby="cdg-titulo">
      <div className="cdg-ventana">
        <header className="cdg-cabecera">
          <div>
            <h2 id="cdg-titulo" className="cdg-titulo">Corregir desglose</h2>
            <p className="cdg-sub">
              Pone Total, Dólares y Pesos en la moneda de su Facturado en, como los calcula el formulario
              (por ejemplo: $120 Dólares facturado en Pesos → Total y Pesos $2,237.10, Dólares $0).
              Solo toca las que ya tienen bien la Conversión: la Conversión, la Utilidad y las facturas no cambian.
            </p>
          </div>
          <button type="button" className="cdg-cerrar" onClick={onCerrar} disabled={trabajando} aria-label="Cerrar">✕</button>
        </header>

        <div className="cdg-cuerpo">
          {fase.tipo === 'revisando' && (
            <>
              <CargandoDatos texto={fase.total > 0 ? `Revisando operaciones: ${n(fase.leidas)} de ${n(fase.total)} leídas…` : 'Contando las operaciones…'} />
              {fase.total > 0 && <progress className="cdg-progreso" value={fase.leidas} max={fase.total} />}
              <p className="cdg-nota">Solo lee (una lectura por operación); no cambia nada hasta que lo autorices.</p>
            </>
          )}

          {fase.tipo === 'error' && <p className="cdg-error" role="alert">{fase.mensaje}</p>}

          {fase.tipo === 'listo' && (
            <>
              <ul className="cdg-cifras">
                <li className="cdg-cifra cdg-cifra--corregir"><b>{n(fase.datos.revisiones.length)}</b> se corrigen</li>
                {facturadas > 0 && <li className="cdg-cifra"><b>{n(facturadas)}</b> ya facturadas (su factura no cambia)</li>}
                {fase.datos.otraConversion.length > 0 && <li className="cdg-cifra cdg-cifra--revisar"><b>{n(fase.datos.otraConversion.length)}</b> con otra Conversión (no se tocan)</li>}
                <li className="cdg-cifra cdg-cifra--leidas">{n(fase.datos.leidas)} operaciones revisadas</li>
              </ul>

              {cambios.length > 0 ? (
                <div className="cdg-tabla-caja">
                  <table className="cdg-tabla">
                    <thead>
                      <tr>
                        <th>Referencia</th><th>Lado</th><th>Empresa</th><th>Facturado en</th>
                        <th className="cdg-num">Total</th><th className="cdg-num">Dólares</th><th className="cdg-num">Pesos</th>
                        <th className="cdg-num">Conversión MXN</th><th>Factura</th>
                      </tr>
                    </thead>
                    <tbody>
                      {fase.datos.revisiones.slice(0, MAX_FILAS).flatMap((r) => r.cambios.map((c, i) => (
                        <Fila key={`${r.id}-${c.lado}`} r={r} c={c} primera={i === 0} />
                      )))}
                    </tbody>
                  </table>
                  {fase.datos.revisiones.length > MAX_FILAS && (
                    <p className="cdg-nota">Se muestran {MAX_FILAS} de {n(fase.datos.revisiones.length)}; la prueba (Excel) las trae todas.</p>
                  )}
                </div>
              ) : (
                <p className="cdg-nota">No hay operaciones con el desglose en otra moneda.</p>
              )}

              {fase.datos.otraConversion.length > 0 && (
                <details className="cdg-grupo">
                  <summary>Con otra Conversión: no se tocan, revisarlas en el formulario ({n(fase.datos.otraConversion.length)})</summary>
                  <p className="cdg-nota">Su Conversión guardada no es la que da su convenio, cargos, tipo de cambio y monedas: es otro problema y no se corrige aquí.</p>
                  <p className="cdg-refs">
                    {fase.datos.otraConversion.slice(0, MAX_FILAS).map((o) => `${o.ref}${o.lados.length === 1 ? ` (${LADO[o.lados[0]]})` : ''}`).join(', ')}
                    {fase.datos.otraConversion.length > MAX_FILAS ? ` y ${n(fase.datos.otraConversion.length - MAX_FILAS)} más` : ''}
                  </p>
                </details>
              )}

              {cambios.length > 0 && <CorregirDesglosePasos revisiones={fase.datos.revisiones} onTrabajando={setTrabajando} />}
            </>
          )}
        </div>

        <footer className="cdg-pie">
          <button type="button" className="cdg-btn" onClick={onCerrar} disabled={trabajando}>Cerrar</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

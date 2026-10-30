// src/features/facturacion/components/DatosSitModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00513 — DATOS PARA EL SIT (Facturación de Clientes). Con las operaciones
// seleccionadas muestra, por operación, la descripción y el importe listos para
// copiar al SIT, y el subtotal. Solo lectura: no escribe nada.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { DatosSit } from '../services/datosParaSit';
import { textoDescripcion, textoImporte } from '../services/datosParaSit';
import Importe from './Importe';
import './DatosSitModal.css';

interface Props {
  cliente: string;
  datos: DatosSit;
  onCerrar: () => void;
}

export default function DatosSitModal({ cliente, datos, onCerrar }: Props) {
  // Qué se copió al último ("<id>:desc" / "<id>:imp" / "todo"), para marcar el botón.
  const [copiado, setCopiado] = useState('');
  const { moneda, conceptos, subtotal } = datos;

  const copiar = async (texto: string, clave: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(clave);
    } catch (e) {
      console.error(e);
      alert('No se pudo copiar. Selecciona el texto y cópialo a mano.');
    }
  };
  const todo = conceptos.map((c) => `${textoDescripcion(c)}\nImporte: ${textoImporte(c.importe)}`).join('\n\n');
  const etiqueta = (clave: string, texto: string): string => (copiado === clave ? '✔ Copiado' : texto);

  return createPortal(
    <div className="modal-overlay dsm-fondo" role="dialog" aria-modal="true" aria-labelledby="dsm-titulo">
      <div className="dsm-ventana">
        <header className="dsm-cabecera">
          <div>
            <h2 id="dsm-titulo" className="dsm-titulo">Datos para la Factura</h2>
            <p className="dsm-sub">
              {cliente} · {conceptos.length} {conceptos.length === 1 ? 'concepto' : 'conceptos'} en {moneda === 'USD' ? 'Dólares' : 'Pesos'}.
              Un concepto por referencia: copia la leyenda y el importe tal cual, al SIT o a QuickBooks. Cada importe es el <b>total de la operación</b> (con sus cargos adicionales), sin IVA: el IVA y las retenciones los calcula el SIT.{/* ✅ V00527 */}
            </p>
          </div>
          <button type="button" className="dsm-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </header>
        <ol className="dsm-lista">
          {conceptos.map((c) => (
            <li key={c.id} className="dsm-concepto">
              {c.convenio && <p className="dsm-convenio">Servicio: {c.convenio}</p>}
              <pre className="dsm-descripcion">{textoDescripcion(c)}</pre>
              <div className="dsm-acciones">
                <Importe className="dsm-importe" monto={c.importe} moneda={moneda} />
                <button type="button" className="dsm-btn" onClick={() => { void copiar(textoDescripcion(c), `${c.id}:desc`); }}>{etiqueta(`${c.id}:desc`, 'Copiar descripción')}</button>
                <button type="button" className="dsm-btn" onClick={() => { void copiar(textoImporte(c.importe), `${c.id}:imp`); }}>{etiqueta(`${c.id}:imp`, 'Copiar importe')}</button>
              </div>
            </li>
          ))}
        </ol>
        <footer className="dsm-pie">
          <span className="dsm-total">Total sin IVA <Importe monto={subtotal} moneda={moneda} conNombre /></span>{/* ✅ V00527: el total de las operaciones (antes decía Subtotal) */}
          <button type="button" className="dsm-btn" onClick={() => { void copiar(todo, 'todo'); }}>{etiqueta('todo', 'Copiar todo')}</button>
          <button type="button" className="dsm-btn dsm-btn--cerrar" onClick={onCerrar}>Cerrar</button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

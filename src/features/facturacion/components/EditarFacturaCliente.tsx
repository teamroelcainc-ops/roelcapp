// src/features/facturacion/components/EditarFacturaCliente.tsx
// ---------------------------------------------------------------------------
// ✅ V00540 — "Editar factura" de clientes como formulario propio (antes vivía dentro de
//   FacturacionClientesDashboard). Se abre desde Facturación (Historial, Ficha, Auditoría) y, encima de la
//   Revisión de datos, desde su botón Solucionar (EditarFacturaClienteEmbebida). Mismo formulario y mismo
//   guardado (hooks/useEdicionFacturaCliente.ts). ✎ Editar de una operación lo abre quien muestra este
//   formulario (`onEditarOperacion`); mientras está abierto, este va detrás (`detras`).
// ---------------------------------------------------------------------------
import { useState } from 'react';
import type { CSSProperties } from 'react';
import AdjuntosArchivos from '../../../shared/components/AdjuntosArchivos';
import { SelectBuscable } from '../../catalogos/components/SelectBuscable';
import { useEdicionFacturaCliente } from '../hooks/useEdicionFacturaCliente';
import { colorStatusFactura, STATUS_FACTURA_OPCIONES } from '../selectores';
import { MAX_DOCS_FACTURA } from '../services/documentosFactura';
import type { EscritoEdicionFactura, FilaFactura } from '../services/edicionFacturaCliente';
import { estaCancelada } from '../services/reglasFactura';
import AvisoMonedaFactura from './AvisoMonedaFactura';
import CamposCancelacion from './CamposCancelacion';
import { NombreMoneda } from './Importe';
import OperacionesFacturaEdicion from './OperacionesFacturaEdicion';
import SubtotalFacturaEdicion from './SubtotalFacturaEdicion';
import './EditarFacturaCliente.css';

interface EditarFacturaClienteProps {
  /** La fila del Historial (un folio) como se abrió: no cambia mientras se edita (quien abre pone `key` con su id). */
  factura: FilaFactura;
  /** Las facturas de clientes en vivo: folios para la cancelación y los documentos del folio. */
  facturas: readonly FilaFactura[];
  onCerrar: () => void;
  /** ✎ Editar de una de sus operaciones. */
  onEditarOperacion: (opId: string) => void;
  /** El formulario de una operación está abierto encima: este va detrás. */
  detras?: boolean;
  /** Lo que se acaba de escribir (para la lista y la ficha de quien lo abrió). */
  onEscrito?: (escrito: EscritoEdicionFactura) => void;
}

const EditarFacturaCliente = ({ factura: facturaAlAbrir, facturas, onCerrar, onEditarOperacion, detras = false, onEscrito }: EditarFacturaClienteProps) => {
  const [factura] = useState(facturaAlAbrir);
  const e = useEdicionFacturaCliente({ factura, facturas, onCerrar, onEscrito });
  const { campos, cambiar, plan } = e;
  const opcionesCliente = e.empresas
    .slice()
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }))
    .map((emp) => ({ value: emp.id, label: String(emp.nombre || emp.id) }));
  const colorStatus = { '--efc-color-status': colorStatusFactura(campos.status) } as CSSProperties;
  const guardarCambios = () => { void e.guardar(); };

  return (
    <div className={`modal-overlay efc-fondo${detras ? ' efc-detras' : ''}`} role="dialog" aria-modal="true" aria-labelledby="efc-titulo">
      <div className="efc-ventana">
        <div className="efc-cabecera">
          <h2 id="efc-titulo" className="efc-titulo">Editar Factura</h2>
          <button type="button" className="efc-cerrar" onClick={onCerrar} aria-label="Cerrar">✕</button>
        </div>

        {/* El cliente sale de las operaciones (V00519): solo se elige si la factura todavía no tiene. */}
        <div className="efc-cliente">
          <span className="efc-etiqueta-cliente">Cliente de la factura</span>
          {factura.clienteId ? (
            <>
              <span className="efc-fija" title="Para cambiarlo, cámbialo en cada operación de la factura">{e.nombreCliente}</span>
              <small className="efc-nota">Para cambiar el cliente, cámbialo primero en cada operación de la factura.</small>
            </>
          ) : (
            <SelectBuscable opciones={opcionesCliente} value={campos.clienteId} onChange={e.elegirCliente} placeholder="Buscar cliente..." />
          )}
          {e.documentosAgrupados > 1 && (
            <span> · <b className="efc-agrupados">{e.documentosAgrupados} documentos agrupados</b> (el total y los archivos se guardan en el primero)</span>
          )}
        </div>

        <div className="efc-campos">
          <div className="efc-ancho">
            <label className="efc-etiqueta" htmlFor="efc-status">STATUS DE LA FACTURA</label>
            <select id="efc-status" className="efc-status" style={colorStatus} value={campos.status} onChange={(ev) => cambiar('status', ev.target.value)}>
              {STATUS_FACTURA_OPCIONES.map((s) => <option key={s} value={s}>{s}</option>)}
              {!STATUS_FACTURA_OPCIONES.includes(campos.status) && campos.status && <option value={campos.status}>{campos.status}</option>}
            </select>
          </div>
          {estaCancelada(campos.status) && (
            <div className="efc-ancho">{/* ✅ V00481: cancelar pide nota y la factura que la reemplaza */}
              <CamposCancelacion idBase="efc-canc" valor={campos.cancelacion} onCambiar={(v) => cambiar('cancelacion', v)}
                sugerencias={e.sugerenciasReemplazo} deshabilitado={e.guardando} />
            </div>
          )}
          <div className="efc-ancho">
            <label className="efc-etiqueta" htmlFor="efc-invoice">NÚMERO DE INVOICE</label>
            <input id="efc-invoice" className="efc-invoice" type="text" value={campos.invoice} onChange={(ev) => cambiar('invoice', ev.target.value)} placeholder="Ej. INV-2026-001" />
          </div>
          <div className="efc-ancho">
            {/* ✅ V00451: varios documentos (hasta 10), con vista previa; se guardan al guardar. V00530: también XML */}
            <span className="efc-etiqueta">DOCUMENTO DE LA FACTURA</span>
            <AdjuntosArchivos etiqueta="Archivos" tipos="factura" adjuntos={campos.adjuntos} onCambiar={(v) => cambiar('adjuntos', v)} max={MAX_DOCS_FACTURA} deshabilitado={e.guardando} />
          </div>
          <div>
            <label className="efc-etiqueta" htmlFor="efc-fecha">FECHA DE FACTURACIÓN</label>
            <input id="efc-fecha" className="efc-entrada efc-fecha" type="date" value={campos.fecha} onChange={(ev) => cambiar('fecha', ev.target.value)} />
          </div>
          <div>
            {/* ✅ V00481: SIEMPRE la del cliente en Empresas; no se elige ni se quita */}
            <span className="efc-etiqueta">MONEDA</span>
            <span className="efc-fija" title="Es la moneda del cliente en Empresas"><NombreMoneda moneda={e.monedaCliente} respaldo="Sin moneda en Empresas" /></span>
          </div>
          <div className="efc-ancho efc-aviso">
            <AvisoMonedaFactura texto={e.avisoMoneda.texto} error={e.avisoMoneda.error} />
          </div>
          <div>
            {/* ✅ V00533: el subtotal (sin IVA) se escribe aquí y avisa si coincide con el subtotal del documento */}
            <label className="efc-etiqueta" htmlFor="efc-subtotal">SUBTOTAL FACTURADO (sin IVA)</label>
            <SubtotalFacturaEdicion id="efc-subtotal" valor={campos.total} onCambiar={(v) => cambiar('total', v)} moneda={e.monedaCliente} adjuntos={campos.adjuntos}
              sumaOps={e.sumaOps} bloqueo={e.bloqueoSubtotal} deshabilitado={e.guardando} />
          </div>
          <div>
            <label className="efc-etiqueta" htmlFor="efc-ccp">FACTURA CCP (Opcional)</label>
            <input id="efc-ccp" className="efc-entrada" type="text" value={campos.ccp} onChange={(ev) => cambiar('ccp', ev.target.value)} placeholder="Referencia CCP..." />
          </div>
        </div>

        {/* ✅ V00520: sus operaciones, con ✎ Editar (el formulario de la operación) y si alguna cambió de costo */}
        <OperacionesFacturaEdicion datos={e.ops} moneda={e.monedaOps || e.monedaVista || ''} desfasadas={plan.desfasadas} plan={plan.sincronizar} impedimento={plan.impedimento}
          sinImportes={plan.sinImportes} monedaHoy={e.monedaVista} completar={plan.resumenCompletar} onEditar={onEditarOperacion} />

        <div className="efc-pie">
          <button type="button" className="efc-cancelar" onClick={onCerrar} disabled={e.guardando}>Cancelar</button>
          {/* ✅ V00520: Actualizar (solo con cambios); nada se guarda hasta presionarlo */}
          <button type="button" className="efc-actualizar" onClick={guardarCambios} disabled={e.guardando || !e.hayCambios}
            title={e.hayCambios ? 'Guardar los cambios de la factura' : 'Sin cambios'}>{e.guardando ? 'Actualizando…' : 'Actualizar'}</button>
        </div>
      </div>
    </div>
  );
};

export default EditarFacturaCliente;

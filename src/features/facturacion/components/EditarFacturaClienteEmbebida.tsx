// src/features/facturacion/components/EditarFacturaClienteEmbebida.tsx
// ---------------------------------------------------------------------------
// ✅ V00540 — Abre "Editar factura" de clientes desde otro módulo (hoy: Solucionar de la Revisión de datos),
//   sin ir a Facturación. Toma la fila del folio (grupoDeFactura, como el Historial) de la lista en vivo de
//   facturas de clientes: es el MISMO listener que usan Facturación, Pagos y la Revisión (no lee de más).
//   Como EditorOperacionEmbebido para las operaciones.
// ---------------------------------------------------------------------------
import CargandoDatos from '../../../shared/components/CargandoDatos';
import type { DocVivo } from '../../../shared/data/coleccionesVivas';
import { useFacturasEnVivo } from '../hooks/useFacturasEnVivo';
import type { EscritoEdicionFactura, FilaFactura } from '../services/edicionFacturaCliente';
import { grupoDeFactura } from '../services/gruposFactura';
import { normalizarFacturaDe } from '../services/normalizarFactura';
import EditarFacturaCliente from './EditarFacturaCliente';
import './EditarFacturaClienteEmbebida.css';

/** Estable (fuera del componente): useFacturasEnVivo la aplica a cada versión del listener. */
const normalizarFacturaCliente = (raw: DocVivo): FilaFactura => normalizarFacturaDe(raw, 'cliente');

interface AvisoEmbebidaProps {
  texto: string;
  onCerrar?: () => void;
}

const AvisoEmbebida = ({ texto, onCerrar }: AvisoEmbebidaProps) => (
  <div className="modal-overlay efe-fondo" role="dialog" aria-modal="true" aria-label="Editar factura">
    <div className="efe-tarjeta">
      {onCerrar ? <p className="efe-error">{texto}</p> : <CargandoDatos compacto texto={texto} />}
      {onCerrar && <button type="button" className="efe-cerrar" onClick={onCerrar}>Cerrar</button>}
    </div>
  </div>
);

interface EditarFacturaClienteEmbebidaProps {
  /** Id de la factura como la lista de Facturación (el mismo que abre su ficha). */
  facturaId: string;
  onCerrar: () => void;
  /** ✎ Editar de una de sus operaciones (su formulario lo abre quien muestra este). */
  onEditarOperacion: (opId: string) => void;
  detras?: boolean;
  onEscrito?: (escrito: EscritoEdicionFactura) => void;
}

const EditarFacturaClienteEmbebida = ({ facturaId, onCerrar, onEditarOperacion, detras = false, onEscrito }: EditarFacturaClienteEmbebidaProps) => {
  const vivas = useFacturasEnVivo('cliente', normalizarFacturaCliente);
  if (vivas.error) return <AvisoEmbebida texto={`No se pudieron leer las facturas (${vivas.error}).`} onCerrar={onCerrar} />;
  if (vivas.cargando) return <AvisoEmbebida texto="Leyendo la factura…" />;
  const grupo = grupoDeFactura(vivas.facturas, facturaId, 'clienteId');
  if (!grupo) return <AvisoEmbebida texto="La factura ya no existe (pudo eliminarse)." onCerrar={onCerrar} />;
  return (
    <EditarFacturaCliente key={facturaId} factura={grupo} facturas={vivas.facturas} onCerrar={onCerrar}
      onEditarOperacion={onEditarOperacion} detras={detras} onEscrito={onEscrito} />
  );
};

export default EditarFacturaClienteEmbebida;

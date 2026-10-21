// src/features/puentes/services/crucePuente.ts
// ---------------------------------------------------------------------------
// ✅ V00470 — CRUCE DE PUENTE desde la web:
//   · cobroPuenteDelPaso → lo que cobra el puente al pasar la operación a un estatus, con la
//     regla compartida (cobroAlCambiarStatus, la misma del servidor) y los catálogos confirmados.
//     No escribe nada: Operaciones Activas y el formulario lo guardan con la bandera
//     cobroPuenteEnServidor apagada; encendida, lo guarda el servidor con la misma regla.
//   · avisarCrucePuente → la ventana "Esta unidad cruzó el puente…" al marcar el Verde o el
//     estatus con 🌉 de Reglas de Estatus.
// ---------------------------------------------------------------------------
import { cargarCtxCobroPuente } from '../../../utils/puenteColombia';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { aplicaPeaje, cobroAlCambiarStatus, disparoCobroPuente, puenteYaCobrado } from '../../../shared/dominio/cobroPuente';
import type { EventoStatusPuente } from '../../../shared/dominio/cobroPuente';
import { fechaServicioDeOperacion } from '../../../shared/dominio/fechas';
import { monedaCanonica } from '../../../shared/dominio/moneda';
import { mostrarVentana } from '../../../shared/data/avisos';
import { statusDescuentaPuente } from '../../operaciones/config/statusRules';

type Datos = Record<string, unknown>;

/**
 * Campos del cobro del puente (saldoPuente…, y en Colombia saldoPuentePiso…) que le tocan a `op`
 * al pasar a ese estatus; {} si no aplica, el estatus no cobra o ya se cobró.
 * `fechaEvento` = la fecha y hora capturada del movimiento (vacía → hoy en hora local).
 */
export const cobroPuenteDelPaso = async (op: Datos, statusId: string, statusNombre: string, fechaEvento = ''): Promise<Datos> => {
  if (puenteYaCobrado(op) || !aplicaPeaje(op)) return {};
  const ev: EventoStatusPuente = {
    statusId, statusNombre, fechaEvento,
    // ✅ V00377: la REGLA DE ESTATUS del flujo ("🌉 aquí se descuenta el puente") manda.
    flagFlujo: await statusDescuentaPuente(op, statusNombre),
    hoy: hoyLocalISO(),
    fechaServicioISO: fechaServicioDeOperacion(op),
  };
  if (!disparoCobroPuente(ev)) return {};
  return cobroAlCambiarStatus(await cargarCtxCobroPuente(), op, ev);
};

/** "$144.00 MXN" (la moneda como la guarda el cobro: "Dólares"/"Pesos", código o id). */
export const textoMontoPuente = (monto: unknown, moneda: unknown): string => {
  const m = monedaCanonica(moneda);
  return `$${(Number(monto) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${m ? ` ${m}` : ''}`;
};

/** Textos de la ventana del cruce (puro: para probarlo). null si el cobro no trae caseta. */
export const textosCrucePuente = (op: Datos, cobro: Datos): { titulo: string; parrafos: string[] } | null => {
  if (!(Number(cobro.saldoPuente) > 0)) return null;
  const conPiso = Number(cobro.saldoPuentePiso) > 0;
  const puentes = [String(cobro.saldoPuentePuente || '').trim() || 'del convenio', conPiso ? String(cobro.saldoPuentePisoPuente || '').trim() : ''].filter(Boolean);
  const montos = [textoMontoPuente(cobro.saldoPuente, cobro.saldoPuenteMoneda), conPiso ? textoMontoPuente(cobro.saldoPuentePiso, cobro.saldoPuentePisoMoneda) : ''].filter(Boolean);
  const unidad = String(op.unidadNombre || '').trim();
  const ref = String(op.ref || '').trim();
  const quien = [unidad, ref].filter(Boolean).join(' · ');
  return {
    titulo: '🌉 Cruce de puente',
    parrafos: [
      `Esta unidad${quien ? ` (${quien})` : ''} cruzó el puente ${puentes.join(' y ')}.`,
      `Se envió el cobro a Operaciones sin asignar por el monto de ${montos.join(' + ')}.`,
    ],
  };
};

/** Abre la ventana del cruce si el cobro trae caseta. */
export const avisarCrucePuente = (op: Datos, cobro: Datos): void => {
  const t = textosCrucePuente(op, cobro);
  if (t) mostrarVentana(t);
};

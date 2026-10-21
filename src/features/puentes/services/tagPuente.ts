// src/features/puentes/services/tagPuente.ts
// ---------------------------------------------------------------------------
// ✅ V00465 — TAG DE LA UNIDAD según el puente de la operación. Cada unidad propia
// trae un TAG por puente (V00457): TAG AVI, TAG Puente 3 y TAG Puente Colombia. La
// ficha de la operación y la tarjeta Caseta/Puente del formulario muestran el que
// corresponde al puente de ESA operación. Lógica pura (sin Firebase ni React).
// ---------------------------------------------------------------------------
import { aplicaPeaje, normPuente } from '../../../shared/dominio/cobroPuente';

type Datos = Record<string, unknown>;

/** Grupo del puente, el mismo del Acumulado: AVI, Puente III (PT3) o Colombia (PTC). */
export type GrupoTag = 'AVI' | 'PT3' | 'PTC';

const CAMPO_TAG: Record<GrupoTag, 'tagAvi' | 'tagPuente3' | 'tagPuenteColombia'> = { AVI: 'tagAvi', PT3: 'tagPuente3', PTC: 'tagPuenteColombia' };
const ETIQUETA_TAG: Record<GrupoTag, string> = { AVI: 'TAG AVI', PT3: 'TAG Puente 3', PTC: 'TAG Puente Colombia' };

/**
 * Grupo por el nombre del puente (misma regla que grupoDeNombresPuente del Acumulado:
 * Colombia → PTC, AVI → AVI, cualquier otro puente → PT3). Sin nombre → ''.
 */
export const grupoTagDeNombres = (...nombres: unknown[]): GrupoTag | '' => {
  const n = normPuente(nombres.map((x) => String(x ?? '')).join(' '));
  if (!n) return '';
  return n.includes('colombia') ? 'PTC' : n.includes('avi') ? 'AVI' : 'PT3';
};

/**
 * Puente de la operación para elegir el TAG: 1) el que ya se cobró (saldoPuentePuente);
 * 2) el elegido en el formulario (puenteNombre); 3) el del tráfico (importación → AVI,
 * exportación → Puente III). '' si la operación no paga puente (Fletes, Movimientos,
 * Logística con proveedor externo) o aún no hay con qué saberlo.
 */
export const grupoTagDeOperacion = (op: Datos): GrupoTag | '' => {
  const cobrado = Number(op.saldoPuente) > 0;
  if (cobrado) {
    const g = grupoTagDeNombres(op.saldoPuentePuente, Number(op.saldoPuentePiso) > 0 ? op.saldoPuentePisoPuente : '');
    if (g) return g;
  } else if (!aplicaPeaje(op)) return '';
  return grupoTagDeNombres(op.puenteNombre) || grupoTagDeTrafico(op.trafico);
};

/** Por tráfico: importación → AVI, exportación → Puente III ('' sin tráfico). */
export const grupoTagDeTrafico = (trafico: unknown): GrupoTag | '' => {
  const traf = normPuente(trafico);
  return traf.includes('impo') ? 'AVI' : traf.includes('expo') ? 'PT3' : '';
};

export interface TagDeUnidad {
  grupo: GrupoTag;
  /** "TAG AVI", "TAG Puente 3" o "TAG Puente Colombia". */
  etiqueta: string;
  /** El número capturado en Unidades Propias ('' si no lo tiene). */
  tag: string;
}

/** El TAG de la unidad para ese puente (null si no hay puente). */
export const tagDeUnidad = (unidad: Datos | null | undefined, grupo: GrupoTag | ''): TagDeUnidad | null =>
  grupo ? { grupo, etiqueta: ETIQUETA_TAG[grupo], tag: String(unidad?.[CAMPO_TAG[grupo]] ?? '').trim() } : null;

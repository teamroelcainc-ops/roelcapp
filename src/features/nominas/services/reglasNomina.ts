// src/features/nominas/services/reglasNomina.ts
// ---------------------------------------------------------------------------
// ✅ Fase 1.8b — Reglas PURAS de Referencias de Nómina (sin Firebase ni React):
//   folio NOMINA-DDMMAAAA-###, vínculo operación ↔ nómina y huella de los
//   saldos de Deducciones. Las usa la transacción de guardado
//   (nominasService.ts): al no tener efectos, si Firestore reintenta la
//   transacción el resultado es el mismo.
// ---------------------------------------------------------------------------
import { aFechaISO } from '../../../shared/dominio/fechas';

/**
 * Documento de `referencias_nomina`. Sin tipo canónico todavía: el esquema
 * viene de AppSheet y cada campo puede faltar o traer otro formato, por eso
 * todo lo que no es el id es `unknown` y se reduce donde se usa.
 */
export interface DocNomina {
  id: string;
  [campo: string]: unknown;
}

/**
 * Firestore admite 500 escrituras por transacción. Guardar una nómina escribe
 * la nómina, el contador del folio, el registro de Deducciones y una por cada
 * operación vinculada o liberada: se deja margen.
 */
export const MAX_OPS_POR_GUARDADO = 450;

/** Nóminas por página del historial (ventana en vivo y cada "Cargar más"). */
export const TAM_PAGINA_NOMINAS = 400;

/** Error de validación al guardar una nómina: su `message` se muestra tal cual al usuario. */
export class ErrorNomina extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorNomina';
  }
}

const texto = (v: unknown): string => (v === null || v === undefined || v === false ? '' : String(v).trim());

const PREFIJO = 'NOMINA-';

/**
 * "AAAA-MM-DD" → "NOMINA-DDMMAAAA-": el MISMO formato que el módulo usa desde
 * siempre (consecutivo por día). Devuelve '' si la fecha no es válida.
 */
export function prefijoFolioNomina(fechaPago: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaPago || '').trim());
  return m ? `${PREFIJO}${m[3]}${m[2]}${m[1]}-` : '';
}

/** Folio completo: prefijo del día + número con 3 dígitos (NOMINA-10102026-007). */
export const formatearFolioNomina = (prefijo: string, numero: number): string =>
  `${prefijo}${String(numero).padStart(3, '0')}`;

/** Número de un folio del prefijo dado ("NOMINA-10102026-007" → 7); 0 si no corresponde. */
export function numeroDeFolio(folio: unknown, prefijo: string): number {
  const s = texto(folio);
  if (!prefijo || !s.startsWith(prefijo)) return 0;
  const partes = s.split('-');
  if (partes.length !== 3) return 0;
  const n = parseInt(partes[2], 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Id del contador del día en `contadores` ("NOMINA-10102026-" →
 * "referencias_nomina_10102026"). El folio se reinicia cada día, así que hay
 * un contador por fecha de pago (campo `ultimo`), igual que los consecutivos
 * por día de operaciones y MTTO.
 */
export const idContadorFolioNomina = (prefijo: string): string =>
  `referencias_nomina_${prefijo.slice(PREFIJO.length, -1)}`;

/** A qué nómina apunta una operación según los campos que este módulo le escribe al pagarla. */
export type VinculoNomina =
  | { tipo: 'libre' }
  | { tipo: 'propia'; exacto: boolean }
  | { tipo: 'otra'; folio: string };

/**
 * Fuente de verdad de "¿esta operación ya está en una nómina?": los campos
 * `referenciaNominaId` / `referenciaNominaConsecutivo` de la PROPIA operación
 * (los mismos que usa Servicios Completados). `propia` = ya apunta a la nómina
 * que se guarda; `exacto` = id y folio coinciden y no hace falta reescribirla.
 */
export function vinculoNominaDeOp(op: Record<string, unknown>, nominaId: string, folio: string): VinculoNomina {
  const refId = texto(op.referenciaNominaId);
  const refFolio = texto(op.referenciaNominaConsecutivo);
  if (refId) {
    if (refId === nominaId) return { tipo: 'propia', exacto: refFolio === folio };
    return { tipo: 'otra', folio: refFolio || `id ${refId}` };
  }
  if (refFolio) {
    if (refFolio === folio) return { tipo: 'propia', exacto: false };
    return { tipo: 'otra', folio: refFolio };
  }
  return { tipo: 'libre' };
}

export interface ConflictoNomina {
  ref: string;
  folio: string;
}

/** Mensaje (en español, para el usuario) con las operaciones que ya están en otra nómina. */
export function mensajeConflictosNomina(conflictos: readonly ConflictoNomina[]): string {
  const MAX_LINEAS = 15;
  const lineas = conflictos.slice(0, MAX_LINEAS).map(c => `• ${c.ref} → ${c.folio}`);
  const resto = conflictos.length > MAX_LINEAS ? `\n…y ${conflictos.length - MAX_LINEAS} más.` : '';
  const sujeto = conflictos.length === 1
    ? 'esta operación ya está'
    : `estas ${conflictos.length} operaciones ya están`;
  const accion = conflictos.length === 1 ? 'Quítala' : 'Quítalas';
  return `No se guardó la nómina: ${sujeto} en otra nómina:\n${lineas.join('\n')}${resto}\n\n`
    + `${accion} de la selección (o pulsa "↻ Actualizar") y vuelve a intentar.`;
}

// Campos de `deducciones` de los que depende el saldo de préstamo/ahorro que
// calcula el formulario, más los que el guardado reescribe.
const CAMPOS_SALDO = [
  'saldoPrestamo', 'prestamo', 'prestamoAcumulado', 'prestamoInicial',
  'abonoInicial', 'ahorroInicial', 'ahorroAcumulado',
] as const;

/**
 * Huella de los saldos de un registro de `deducciones`. Si la huella leída
 * dentro de la transacción no es la que vio el usuario, alguien más cambió
 * los saldos mientras capturaba y el guardado se detiene.
 */
export function huellaSaldos(deduccion: unknown): string {
  const d = deduccion !== null && typeof deduccion === 'object' ? (deduccion as Record<string, unknown>) : {};
  return JSON.stringify(CAMPOS_SALDO.map(c => d[c] ?? null));
}

// PENDIENTE Fase 4: quitar cuando migrarEsquemaV2 rellene fechaPago
/**
 * ¿La nómina trae `fechaPago` como texto AAAA-MM-DD? Las que no (sin el
 * campo, Timestamp o d/m/aaaa de la migración) no aparecen en la consulta
 * ordenada por fechaPago y se completan con el listener heredado.
 */
export const tieneFechaPagoCanonica = (n: DocNomina): boolean =>
  typeof n.fechaPago === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(n.fechaPago);

/**
 * Orden del historial en pantalla, el MISMO criterio que usaba el módulo
 * (createdAt o, si falta, fechaPago; más reciente primero), tolerante a
 * Timestamp y d/m/aaaa con aFechaISO. Las fechas ilegibles quedan al final.
 */
export function ordenarNominasRecientes(lista: readonly DocNomina[]): DocNomina[] {
  return lista
    .map(n => ({ n, f: aFechaISO(n.createdAt || n.fechaPago) ?? '' }))
    .sort((a, b) => (a.f === b.f ? 0 : a.f < b.f ? 1 : -1))
    .map(x => x.n);
}

/** Une listas de nóminas sin repetir id (gana la primera aparición). */
export function unirNominasPorId(...listas: ReadonlyArray<readonly DocNomina[] | null | undefined>): DocNomina[] {
  const vistos = new Set<string>();
  const res: DocNomina[] = [];
  for (const lista of listas) {
    for (const n of lista ?? []) {
      if (vistos.has(n.id)) continue;
      vistos.add(n.id);
      res.push(n);
    }
  }
  return res;
}

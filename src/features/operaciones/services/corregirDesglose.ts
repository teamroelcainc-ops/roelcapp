// src/features/operaciones/services/corregirDesglose.ts
// ---------------------------------------------------------------------------
// ✅ V00532 — CORREGIR DESGLOSE (lógica pura; lecturas y escrituras en corregirDesgloseDatos.ts).
// Caso TR-221026-023: convenio de $120 Dólares, Facturado en Pesos, TC 18.6425. El Subtotal se ve
// en pesos (2,237.10) y la Conversión dice 2,237.10, pero Total = 120, Dólares = 120 y Pesos = 0:
// el desglose quedó como si se facturara en dólares. Pasaba con las operaciones a las que se les
// cambió "Facturado en" sin recalcular (la propagación de moneda de antes de la V00490) y que
// después quedaron congeladas al facturarse (V00494).
// Regla: si la CONVERSIÓN guardada (pesos) ya es la que da la regla única (conversionOperacion),
// el dinero está bien y solo se ponen Total (subtotal), Dólares y Pesos en la moneda de su
// "Facturado en". La Conversión, la Utilidad y lo que Facturación toma de la operación
// (montoOperacion, calculado con el monto del convenio, cargos, TC y monedas) NO cambian.
// Si la conversión guardada es otra, no se toca (es otro problema: se cuenta para revisarlo a mano).
// ---------------------------------------------------------------------------
import { conversionOperacion, monedaFacturaOperacion } from '../../../shared/dominio/dinero';
import type { Lado } from '../../../shared/dominio/dinero';
import type { Moneda } from '../../../shared/dominio/moneda';
import { facturadaCliente, facturadaProveedor } from '../../../shared/dominio/operacionCanonica';
import type { CeldaExcel } from './excelOperaciones';
import { CAMPOS_LADO } from './corregirMonedaConvenio';

type Datos = Record<string, unknown>;
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;
const difiere = (a: number, b: number): boolean => Math.abs(a - b) >= 0.005;

/** Total, Dólares y Pesos de un lado. */
export interface Desglose { total: number; dol: number; pes: number }

export interface CambioDesglose {
  lado: Lado;
  facturadoEn: Moneda;
  antes: Desglose;
  despues: Desglose;
  /** La Conversión (pesos): la misma antes y después. */
  conv: number;
  /** Ya está en una factura de ese lado (su factura no cambia: Facturación calcula con el monto del convenio). */
  facturada: boolean;
  factura: string;
  /** Cliente (paga) o proveedor de transporte. */
  empresa: string;
}

export interface RevisionDesglose {
  id: string;
  ref: string;
  cambios: CambioDesglose[];
  /** Campos que se escriben. */
  datos: Datos;
}

type ResultadoLado = { cambio: CambioDesglose; propios: Datos } | 'otraConversion' | null;

/** Un lado: el desglose que le toca, 'otraConversion' (no se toca) o null (está bien / sin monto / sin datos). */
export const revisarDesgloseLado = (op: Datos, lado: Lado): ResultadoLado => {
  const c = CAMPOS_LADO[lado];
  if (num(op[c.monto]) + num(op[c.cargos]) <= 0) return null;
  const facturadoEn = monedaFacturaOperacion(op, lado);
  if (!facturadoEn) return null;
  const m = conversionOperacion(op, lado);
  if (!(m.tc > 0) || !(m.conv > 0)) return null;
  if (Math.abs(num(op[c.conv]) - m.conv) >= 0.01) return 'otraConversion';
  const antes: Desglose = { total: num(op[c.subtotal]), dol: num(op[c.dol]), pes: num(op[c.pes]) };
  const despues: Desglose = { total: m.total, dol: m.dol, pes: m.pes };
  const propios: Datos = {};
  if (difiere(antes.total, despues.total)) propios[c.subtotal] = despues.total;
  if (difiere(antes.dol, despues.dol)) propios[c.dol] = despues.dol;
  if (difiere(antes.pes, despues.pes)) propios[c.pes] = despues.pes;
  if (Object.keys(propios).length === 0) return null;
  const facturada = lado === 'cliente' ? facturadaCliente(op) : facturadaProveedor(op);
  return {
    propios,
    cambio: {
      lado, facturadoEn, antes, despues, conv: m.conv, facturada,
      factura: texto(lado === 'cliente' ? op.facturaClienteInvoice : op.facturaProveedorFolio),
      empresa: texto(lado === 'cliente' ? op.clientePagaNombre : op.proveedorUnidadNombre),
    },
  };
};

export interface RevisionOperacionDesglose {
  ref: string;
  revision: RevisionDesglose | null;
  /** Lados con una Conversión guardada distinta de la regla (no se tocan). */
  otraConversion: Lado[];
}

const LADOS: readonly Lado[] = ['cliente', 'proveedor'];

/** Una operación: qué se corrige de cada lado y qué lados tienen otra conversión. */
export const revisarDesglose = (id: string, op: Datos): RevisionOperacionDesglose => {
  const cambios: CambioDesglose[] = [];
  const otraConversion: Lado[] = [];
  const datos: Datos = {};
  LADOS.forEach((lado) => {
    const r = revisarDesgloseLado(op, lado);
    if (r === 'otraConversion') { otraConversion.push(lado); return; }
    if (!r) return;
    Object.assign(datos, r.propios);
    cambios.push(r.cambio);
  });
  const ref = texto(op.ref) || texto(op.numReferencia) || texto(op.referencia) || id;
  return { ref, revision: cambios.length > 0 ? { id, ref, cambios, datos } : null, otraConversion };
};

/** Lo mismo que la prueba (para aplicar solo si nada cambió desde entonces). */
export const mismoCambio = (a: Desglose, b: Desglose): boolean => !difiere(a.total, b.total) && !difiere(a.dol, b.dol) && !difiere(a.pes, b.pes);

/** Por qué ya no se escribe lo de la prueba al aplicar ('' = da exactamente lo mismo y se escribe). */
export const motivoAlAplicar = (actual: Datos | null, plan: RevisionDesglose): string => {
  if (!actual) return 'La operación ya no existe';
  const { revision: r, otraConversion } = revisarDesglose(plan.id, actual);
  if (!r && otraConversion.length === 0) return 'Ya está bien (alguien la corrigió desde la prueba)';
  if (!r) return 'Cambió desde la prueba: vuelve a revisar';
  const igual = r.cambios.length === plan.cambios.length
    && plan.cambios.every((c) => r.cambios.some((x) => x.lado === c.lado && mismoCambio(x.antes, c.antes) && mismoCambio(x.despues, c.despues)));
  return igual ? '' : 'Cambió desde la prueba: vuelve a revisar';
};

const nombreMoneda = (m: Moneda): string => (m === 'USD' ? 'Dólares' : 'Pesos');

/** PRUEBA: una fila por lado que cambia (lo de antes y lo de después). */
export const filasPruebaDesglose = (revisiones: readonly RevisionDesglose[]): Record<string, CeldaExcel>[] =>
  revisiones.flatMap((r) => r.cambios.map((c) => ({
    Referencia: r.ref, Lado: c.lado === 'cliente' ? 'Cliente' : 'Proveedor', Empresa: c.empresa, 'Facturado en': nombreMoneda(c.facturadoEn),
    'Total antes': c.antes.total, 'Total después': c.despues.total,
    'Dólares antes': c.antes.dol, 'Dólares después': c.despues.dol,
    'Pesos antes': c.antes.pes, 'Pesos después': c.despues.pes,
    'Conversión MXN (no cambia)': c.conv,
    Facturada: c.facturada ? `Sí${c.factura ? ` (${c.factura})` : ''}` : 'No',
  })));

/** RESPALDO: los campos como estaban; para deshacer, volver a escribirlos en cada operación. */
export const respaldoDesglose = (revisiones: readonly RevisionDesglose[], cuando: string, quien: string): Datos => ({
  tipo: 'respaldo-corregir-desglose', generado: cuando, por: quien,
  nota: 'Para deshacer: en cada operación, volver a escribir los campos de "antes". La Conversión, la Utilidad y las facturas no cambiaron.',
  operaciones: revisiones.map((r) => ({
    id: r.id, ref: r.ref,
    antes: Object.fromEntries(r.cambios.flatMap((c) => {
      const k = CAMPOS_LADO[c.lado];
      return [[k.subtotal, c.antes.total], [k.dol, c.antes.dol], [k.pes, c.antes.pes]];
    })),
    despues: r.datos,
  })),
});

// src/features/operaciones/services/validacionExcel.ts
// ---------------------------------------------------------------------------
// ✅ V00503 — VALIDACIÓN de cada operación en el Excel de operaciones (lógica pura): la primera
// columna dice "ok" o "error" (para filtrar) y la segunda el motivo. Revisa el lado del CLIENTE
// (lo que se cobra), con las tres revisiones que pidió Omaf:
//   · Faltan datos: cliente que paga, moneda de esa empresa en Empresas, convenio, monto, moneda del
//     convenio, moneda de cobro y el tipo de cambio cuando la regla lo usa.
//   · Moneda distinta a la empresa: "Moneda Cobro" no es la moneda de la empresa en Empresas.
//   · Montos que no cuadran: Dólares, Pesos y Conversión guardados contra la regla única
//     (shared/dominio/dinero.ts), con la moneda de la empresa (si no se sabe, la de cobro):
//       convenio USD + cobro USD → Dólares = monto;       Conversión = monto × TC
//       convenio USD + cobro MXN → Pesos = monto × TC;    Conversión = lo mismo
//       convenio MXN + cobro MXN → Pesos = monto;         Conversión = lo mismo
//       convenio MXN + cobro USD → Dólares = monto ÷ TC;  Conversión = Dólares × TC
//     (monto = convenio + cargos adicionales; TC = el aprobado o, si no hay, el del día). El Subtotal
//     no se revisa: no todas las pantallas lo guardan igual y Facturación no lo usa.
// Las canceladas no se cobran: salen "ok" con el motivo, sin revisar.
// ---------------------------------------------------------------------------
import { conversionOperacion, monedaConvenioDe, monedaFacturaOperacion } from '../../../shared/dominio/dinero';
import { idMoneda, nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { FUENTES_CANONICAS, estadoGrupoDe } from '../../../shared/dominio/operacionCanonica';

type Datos = Record<string, unknown>;

export type EstadoValidacion = 'ok' | 'error';
export interface ValidacionOperacion { estado: EstadoValidacion; motivos: string[] }

/** Diferencia que se acepta por redondeo (un centavo). */
const TOLERANCIA = 0.01;
export const MOTIVO_CANCELADA = 'Cancelada: no se revisa';

const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;
/** Los mismos campos que lee el servidor para el cliente que paga y el convenio (camposCanonicos). */
const CAMPOS_CLIENTE = FUENTES_CANONICAS.clientePagaId;
const CAMPOS_CONVENIO = FUENTES_CANONICAS.convenioClienteId;
const primero = (op: Datos, campos: readonly string[]): string => campos.map((c) => texto(op[c])).find(Boolean) ?? '';
const fmt = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Empresa que paga y su moneda en Empresas: el primer id que esté en Empresas o, si ninguno, el
 * primero que traiga (id vacío = la operación no tiene cliente que paga).
 */
export const empresaClienteDe = (op: Datos, monedaEmpresa: ReadonlyMap<string, Moneda>): { id: string; moneda: Moneda | null } => {
  const ids = CAMPOS_CLIENTE.map((c) => texto(op[c])).filter(Boolean);
  const conMoneda = ids.find((id) => monedaEmpresa.has(id));
  return conMoneda ? { id: conMoneda, moneda: monedaEmpresa.get(conMoneda) ?? null } : { id: ids[0] ?? '', moneda: null };
};

/** Texto de la columna "Moneda Empresa": Dólares / Pesos, "Sin moneda" si la empresa no la tiene, "-" sin cliente. */
export const textoMonedaEmpresa = (op: Datos, monedaEmpresa: ReadonlyMap<string, Moneda>): string => {
  const e = empresaClienteDe(op, monedaEmpresa);
  if (!e.id) return '-';
  return e.moneda ? nombreMoneda(e.moneda) : 'Sin moneda';
};

export const validarOperacionExcel = (op: Datos, monedaEmpresa: ReadonlyMap<string, Moneda>): ValidacionOperacion => {
  if (estadoGrupoDe(op) === 'cancelada') return { estado: 'ok', motivos: [MOTIVO_CANCELADA] };

  const faltan: string[] = [];
  const empresa = empresaClienteDe(op, monedaEmpresa);
  if (!empresa.id) faltan.push('cliente que paga');
  else if (!empresa.moneda) faltan.push('moneda de la empresa en Empresas');
  if (!primero(op, CAMPOS_CONVENIO)) faltan.push('convenio');
  const conMonto = num(op.montoConvenioCliente) + num(op.cargosAdicionales) > 0;
  if (!conMonto) faltan.push('monto del convenio');
  const convenio = monedaConvenioDe(op, 'cliente').moneda;
  if (conMonto && !convenio) faltan.push('moneda del convenio');
  const cobro = monedaFacturaOperacion(op, 'cliente');
  if (!cobro) faltan.push('moneda de cobro');
  // La regla se aplica con la moneda en que factura la empresa (la que debe tener la operación).
  const factura = empresa.moneda ?? cobro;
  const tc = Number(op.tipoCambioAprobado) || Number(op.tipoCambioDia) || 0;
  const usaTC = factura === 'USD' || (!!convenio && !!factura && convenio !== factura);
  const sinTC = conMonto && usaTC && !(tc > 0);
  if (sinTC) faltan.push('tipo de cambio');

  const motivos: string[] = [];
  if (faltan.length > 0) motivos.push(`Faltan datos: ${faltan.join(', ')}`);
  if (cobro && empresa.moneda && cobro !== empresa.moneda) {
    motivos.push(`Moneda distinta a la empresa: cobro en ${nombreMoneda(cobro)}, la empresa factura en ${nombreMoneda(empresa.moneda)}`);
  }
  if (conMonto && convenio && factura && !sinTC) {
    const debe = conversionOperacion(
      { ...op, monedaConvenioCliente: idMoneda(convenio), facturadoEnCobrar: idMoneda(factura), monedaCobroNombre: nombreMoneda(factura) },
      'cliente',
    );
    const revisar: [string, unknown, number][] = [
      ['Dólares', op.dolaresCliente, debe.dol],
      ['Pesos', op.pesosCliente, debe.pes],
      ['Conversión', op.conversionCliente, debe.conv],
    ];
    const malos = revisar.filter(([, guardado, esperado]) => Math.abs(num(guardado) - esperado) > TOLERANCIA + 1e-9);
    if (malos.length > 0) {
      motivos.push(`Montos que no cuadran (convenio en ${nombreMoneda(convenio)}, cobro en ${nombreMoneda(factura)}): ${
        malos.map(([campo, guardado, esperado]) => `${campo} ${fmt(num(guardado))}, debe ser ${fmt(esperado)}`).join('; ')}`);
    }
  }
  return { estado: motivos.length > 0 ? 'error' : 'ok', motivos };
};

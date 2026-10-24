// src/features/pagos/services/plantillaFacturas.ts
// ---------------------------------------------------------------------------
// ✅ V00484 — PLANTILLA DE FACTURAS A PAGAR (lógica pura; el Excel se lee en plantillaFacturasExcel.ts).
// El usuario llena un Excel con el número de factura y, opcional, su monto. Al cargarlo en Registrar
// pago o Editar pago se marcan las Transacciones pendientes que coinciden. El monto SOLO CONFIRMA
// (pedido de Omaf): si viene y no es igual al saldo abierto, la factura no se marca y se avisa.
// Cada renglón que no se marca dice por qué.
// ---------------------------------------------------------------------------

export const HOJA_PLANTILLA = 'Facturas';
export const ENCABEZADOS_PLANTILLA = ['Factura', 'Monto (opcional)'] as const;

export interface FilaPlantilla {
  /** Renglón del Excel (1 = el primero), para decir dónde está cada aviso. */
  fila: number;
  factura: string;
  /** null = sin monto. NaN = escribió algo que no es número. */
  monto: number | null;
  montoTexto: string;
}

/** Factura que se puede marcar (con saldo abierto, de la empresa del pago). */
export interface FacturaParaCruce {
  id: string;
  invoice: string;
  saldo: number;
}

/** Cualquier factura conocida, para explicar por qué un renglón no se marcó. */
export interface FacturaConocida {
  invoice: string;
  saldo: number;
  entidad: string;
  /** ¿Es de la empresa del pago? */
  propia: boolean;
}

export interface AvisoPlantilla {
  fila: number;
  factura: string;
  motivo: string;
}

export interface ResultadoPlantilla {
  /** Facturas a marcar (sin repetidas). */
  marcar: FacturaParaCruce[];
  avisos: AvisoPlantilla[];
  /** Renglones con algo escrito. */
  renglones: number;
}

const sinAcentos = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Clave para comparar números de factura: sin espacios ni acentos, en mayúsculas, sin "Factura"/"#"
 * al inicio; si es solo número, sin ceros a la izquierda ni ".0" (Excel guarda 39352 como número).
 */
export const claveFactura = (v: unknown): string => {
  let t = sinAcentos(v).toUpperCase().replace(/\s+/g, '');
  t = t.replace(/^FACTURA/, '').replace(/^(#|NO\.|N°|Nº)/, '');
  if (/^\d+(\.0+)?$/.test(t)) t = t.split('.')[0].replace(/^0+(?=\d)/, '');
  return t;
};

const r2 = (n: number): number => Math.round(n * 100) / 100;
const dinero = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Monto escrito en la plantilla: número de Excel o texto como "$1,234.50 USD". */
export const leerMonto = (v: unknown): { monto: number | null; texto: string } => {
  if (typeof v === 'number') return Number.isFinite(v) ? { monto: r2(v), texto: String(v) } : { monto: Number.NaN, texto: String(v) };
  const texto = String(v ?? '').trim();
  if (!texto) return { monto: null, texto: '' };
  const limpio = texto.replace(/usd|mxn|dlls?|pesos?|d[oó]lares?/gi, '').replace(/[$,\s]/g, '');
  const n = Number(limpio);
  return limpio && Number.isFinite(n) ? { monto: r2(n), texto } : { monto: Number.NaN, texto };
};

const esEncabezadoFactura = (v: unknown): boolean => sinAcentos(v).trim().toLowerCase().startsWith('factura') || sinAcentos(v).trim().toLowerCase() === 'invoice';
const esEncabezadoMonto = (v: unknown): boolean => sinAcentos(v).trim().toLowerCase().startsWith('monto');

/**
 * Renglones de la hoja (matriz de celdas, como sheet_to_json con header: 1). Busca el encabezado
 * "Factura" (y "Monto") en los primeros 10 renglones; si no hay, columna A = factura y B = monto.
 */
export const leerFilasPlantilla = (matriz: readonly unknown[][]): FilaPlantilla[] => {
  let inicio = 0;
  let colFactura = 0;
  let colMonto = 1;
  for (let i = 0; i < Math.min(10, matriz.length); i++) {
    const celdas = Array.isArray(matriz[i]) ? matriz[i] : [];
    const cf = celdas.findIndex(esEncabezadoFactura);
    if (cf >= 0) {
      colFactura = cf;
      const cm = celdas.findIndex(esEncabezadoMonto);
      colMonto = cm >= 0 ? cm : -1;
      inicio = i + 1;
      break;
    }
  }
  const filas: FilaPlantilla[] = [];
  for (let i = inicio; i < matriz.length; i++) {
    const celdas = Array.isArray(matriz[i]) ? matriz[i] : [];
    const factura = String(celdas[colFactura] ?? '').trim();
    const { monto, texto } = colMonto >= 0 ? leerMonto(celdas[colMonto]) : { monto: null, texto: '' };
    if (!factura && monto === null) continue;
    filas.push({ fila: i + 1, factura, monto, montoTexto: texto });
  }
  return filas;
};

/**
 * Cruza los renglones con las facturas pendientes de la empresa del pago.
 *  · Sin monto: se marca la factura (con su saldo abierto).
 *  · Con monto: se marca solo si es igual al saldo abierto (±1 centavo); si no, aviso.
 * `conocidas` (opcional) explica los renglones que no están entre las pendientes: pagada, de otra
 * empresa o ya en este pago (`enEstePago`, números de factura del pago que se edita).
 */
export const cruzarPlantilla = (
  filas: readonly FilaPlantilla[],
  pendientes: readonly FacturaParaCruce[],
  opciones: { entidad: string; conocidas?: readonly FacturaConocida[]; enEstePago?: readonly string[] },
): ResultadoPlantilla => {
  const porClave = new Map<string, FacturaParaCruce[]>();
  pendientes.forEach((f) => {
    if (f.saldo <= 0.009) return;
    const k = claveFactura(f.invoice);
    porClave.set(k, [...(porClave.get(k) ?? []), f]);
  });
  const enPago = new Set((opciones.enEstePago ?? []).map(claveFactura));
  const vistas = new Map<string, number>();
  const marcar = new Map<string, FacturaParaCruce>();
  const avisos: AvisoPlantilla[] = [];
  const avisa = (f: FilaPlantilla, motivo: string) => avisos.push({ fila: f.fila, factura: f.factura, motivo });

  filas.forEach((f) => {
    const clave = claveFactura(f.factura);
    if (!clave) { avisa(f, 'Falta el número de factura.'); return; }
    const previa = vistas.get(clave);
    if (previa !== undefined) { avisa(f, `Repetida en el archivo (ya está en el renglón ${previa}).`); return; }
    vistas.set(clave, f.fila);
    if (f.monto !== null && Number.isNaN(f.monto)) { avisa(f, `El monto "${f.montoTexto}" no es un número.`); return; }
    const abiertas = porClave.get(clave) ?? [];
    if (abiertas.length === 0) {
      if (enPago.has(clave)) { avisa(f, 'Ya está en este pago.'); return; }
      const conocidas = (opciones.conocidas ?? []).filter((c) => claveFactura(c.invoice) === clave);
      const deOtra = conocidas.find((c) => !c.propia && c.saldo > 0.009);
      if (conocidas.some((c) => c.propia && c.saldo <= 0.009)) avisa(f, 'Ya está pagada.');
      else if (deOtra) avisa(f, `Es de otra empresa: ${deOtra.entidad}.`);
      else avisa(f, `No está entre las facturas con saldo de ${opciones.entidad}.`);
      return;
    }
    const elegidas = f.monto === null ? abiertas : abiertas.filter((a) => Math.abs(r2(a.saldo) - (f.monto ?? 0)) < 0.011);
    if (elegidas.length === 0) {
      const saldos = abiertas.map((a) => dinero(a.saldo)).join(' / ');
      avisa(f, `El monto ${dinero(f.monto ?? 0)} no coincide con el saldo abierto (${saldos}).`);
      return;
    }
    elegidas.forEach((a) => marcar.set(a.id, a));
  });
  return { marcar: [...marcar.values()], avisos, renglones: filas.length };
};

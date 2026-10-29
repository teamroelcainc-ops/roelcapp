// src/features/operaciones/services/revisionDatos.ts
// ---------------------------------------------------------------------------
// ✅ V00505 — REVISIÓN DE DATOS (lógica pura, solo lectura). Lista los errores del reporte
// "Errores encontrados en Operaciones y Facturación" (27-oct) con los datos de la app, lado CLIENTE:
//   F4 operaciones en dos o más facturas no canceladas (por folio: invoice + cliente)
//   F1 operaciones en la lista de una factura no cancelada, sin Invoice ni marca de facturada
//   D2 referencias repetidas
//   F3 Invoice de la operación que no existe en Facturas
//   D1 / D4 / D5 la MISMA regla del Excel de operaciones (validacionExcel.ts, V00503)
//   F2 total de la factura distinto a la suma de sus operaciones en la moneda de la factura
//      (F2c: diferencias de centavos, menos de $1)
//   D6 canceladas con monto · F5 terminadas sin facturar · D3 sin status
// Una operación entra en una factura por su id, su id de AppSheet o su referencia (solo si la
// referencia es de UNA operación: una repetida no se puede saber a cuál se refiere).
// Nada aquí lee ni escribe Firestore: lo que se lee está en revisionDatosLectura.ts.
// ---------------------------------------------------------------------------
import { STATUS_FINALES } from '../../../shared/dominio/constantes';
import { conversionOperacion, monedaDeFactura, refDeOperacion, totalNativoFactura, totalNativoFacturaLegado } from '../../../shared/dominio/dinero';
import { aFechaISO, fechaServicioDeOperacion } from '../../../shared/dominio/fechas';
import { idMoneda, nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { sumarMontos } from '../../../shared/dominio/numeros';
import { estadoGrupoDe, esGrupoTerminado, facturadaCliente } from '../../../shared/dominio/operacionCanonica';
import { claveGrupoFactura } from '../../facturacion/services/gruposFactura';
import { estaCancelada } from '../../facturacion/services/reglasFactura';
import { valorExcelOperacion } from './excelOperaciones';
import { validarOperacionExcel } from './validacionExcel';

type Datos = Record<string, unknown>;

/** Operación con su id REAL de documento (`idDoc`); `id` es el guardado (AppSheet) si lo trae. */
export type OpRevision = Datos & { idDoc: string };
/** Factura ya normalizada (normalizarFacturaDe) con su id de la lista (`id`, el que abre Facturación). */
export type FacturaRevision = Datos & { id: string; /** ✅ V00510: id REAL del documento (si no, `id`). */ idDoc?: string };

/**
 * ✅ V00510 — Una operación de F1 con la factura que la lista (para "Marcar facturadas").
 * `facturas` > 1 = la listan varias facturas activas: no se marca sola.
 */
export interface MarcaF1 {
  opId: string;
  /** id de AppSheet guardado en la operación ('' si no trae). */
  opAppId: string;
  ref: string;
  cliente: string;
  status: string;
  grupo: ReturnType<typeof estadoGrupoDe>;
  facturaId: string;
  invoice: string;
  statusFactura: string;
  fechaFactura: string;
  facturas: number;
}

/** ✅ V00517: una operación de D3 con lo que tiene guardado (para "Corregir status"). */
export interface StatusD3 {
  opId: string;
  ref: string;
  cliente: string;
  fecha: string;
  /** Lo guardado en `status` (un id o un nombre) y en `statusNombre`. */
  status: string;
  statusNombre: string;
}

/**
 * ✅ V00518: grupos en los que una fila se puede CONFIRMAR como correcta (✓): sale de la revisión.
 * Se guarda en la operación (`revisionOk.<grupo>`) con el detalle confirmado: si el detalle cambia
 * (otro monto), vuelve a aparecer.
 */
export interface ConfirmacionRevision { en: string; por: string; detalle: string }

export type CodigoRevision = 'F4' | 'F1' | 'D2' | 'F3' | 'D1' | 'D4' | 'D5' | 'F2' | 'F2c' | 'D6' | 'F5' | 'D3';
export type Prioridad = 'Alta' | 'Media' | 'Baja';

export interface GrupoRevision {
  codigo: CodigoRevision;
  titulo: string;
  prioridad: Prioridad;
  /** Dónde se corrige. */
  correccion: string;
}

/** En el orden en que se atienden. */
export const GRUPOS_REVISION: readonly GrupoRevision[] = [
  { codigo: 'F4', titulo: 'Operaciones en dos o más facturas', prioridad: 'Alta', correccion: 'Cancelar el duplicado y avisar al cliente (paso 2: eliges cuál).' },
  { codigo: 'F1', titulo: 'En una factura, sin Invoice ni marca de facturada', prioridad: 'Alta', correccion: 'Marcarlas como facturadas con la factura que las lista (abajo: prueba, respaldo y autorización).' },
  { codigo: 'D2', titulo: 'Referencia repetida', prioridad: 'Alta', correccion: 'Renumerar una de cada par (paso 2: eliges cuál).' },
  { codigo: 'F3', titulo: 'Invoice que no existe en Facturas', prioridad: 'Media', correccion: 'Corregir el Invoice (paso 2).' },
  { codigo: 'D1', titulo: 'Moneda de cobro distinta a la de la empresa', prioridad: 'Media', correccion: 'No facturadas: Corregir monedas. Facturadas: a mano, una por una.' },
  { codigo: 'D4', titulo: 'Montos que no cuadran con la regla', prioridad: 'Media', correccion: 'No facturadas: Corregir monedas. Facturadas: a mano, una por una.' },
  { codigo: 'D5', titulo: 'Faltan datos para el ingreso', prioridad: 'Media', correccion: 'Completar en el formulario de la operación.' },
  { codigo: 'F2', titulo: 'Factura distinta a la suma de sus operaciones', prioridad: 'Media', correccion: 'Si está mal la operación, corregirla; si es la factura, Editar factura.' },
  { codigo: 'F2c', titulo: 'Factura distinta por centavos (menos de $1)', prioridad: 'Baja', correccion: 'Redondeo: Editar factura si se quiere exacto.' },
  { codigo: 'D6', titulo: 'Canceladas que conservan su monto', prioridad: 'Baja', correccion: 'Solo revisar: los ingresos no deben sumarlas. Si de verdad se canceló y no se cobra, confírmala con ✓ Está bien y sale de la lista; si se cobra, cámbiala a Falso.' }, // ✅ V00518
  { codigo: 'F5', titulo: 'Terminadas sin facturar', prioridad: 'Baja', correccion: 'Facturar o cancelar.' },
  { codigo: 'D3', titulo: 'Sin status', prioridad: 'Baja', correccion: 'Las que tienen el status con otro nombre se corrigen con Corregir status (abajo); las demás, en el formulario.' }, // ✅ V00517
];

export interface DestinoRevision { modulo: string; id: string }
export interface EnlaceRevision { texto: string; destino: DestinoRevision }

export interface FilaRevision {
  codigo: CodigoRevision;
  /** Única en todo el resultado. */
  clave: string;
  /** Referencia de la operación o Invoice de la factura. */
  ref: string;
  cliente: string;
  fecha: string;
  status: string;
  /** Invoice que trae la operación (o el de la factura). */
  invoice: string;
  detalle: string;
  destino: DestinoRevision;
  /** Otros registros relacionados (las facturas de una operación, la otra operación con la misma referencia…). */
  enlaces: EnlaceRevision[];
}

export interface EntradaRevision {
  operaciones: readonly OpRevision[];
  facturas: readonly FacturaRevision[];
  /** Moneda de cada empresa en Empresas (monedasEmpresas.ts). */
  monedaEmpresa: ReadonlyMap<string, Moneda>;
  /** true = total de factura con la regla única (bandera dineroPorServidor), como el Historial. */
  reglaUnica: boolean;
}

export interface ResultadoRevision {
  filas: FilaRevision[];
  conteo: Record<CodigoRevision, number>;
  /** Para D2: cuántas referencias distintas están repetidas. */
  referenciasRepetidas: number;
  operaciones: number;
  facturas: number;
  /** Elementos de las listas de facturas que no se pudieron ligar a una operación (no existe o referencia repetida). */
  sinLigar: number;
  /** ✅ V00510: las operaciones de F1 con su factura. */
  marcasF1: MarcaF1[];
  /** ✅ V00517: las operaciones de D3 con su status guardado. */
  statusD3: StatusD3[];
  /** ✅ V00518: cuántas se confirmaron como correctas (✓) y por eso no se muestran, por grupo. */
  confirmadas: Partial<Record<CodigoRevision, number>>;
}

// ── Utilidades ────────────────────────────────────────────────────────────
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const num = (v: unknown): number => Number(v ?? 0) || 0;
const normRef = (v: unknown): string => txt(v).toUpperCase();
const normInvoice = (v: unknown): string => txt(v).toLowerCase();
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const fmt = (n: number): string => `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** ✅ V00518: grupos con ✓ (confirmar como correcta). */
export const GRUPOS_CONFIRMABLES: readonly CodigoRevision[] = ['D6'];

/** La confirmación (✓) guardada en la operación para ese grupo, o null. */
export const confirmacionDe = (op: Datos, codigo: CodigoRevision): ConfirmacionRevision | null => {
  const r = op.revisionOk;
  const c = r && typeof r === 'object' ? (r as Datos)[codigo] : null;
  if (!c || typeof c !== 'object') return null;
  const d = c as Datos;
  return { en: txt(d.en), por: txt(d.por), detalle: txt(d.detalle) };
};

/** ✅ V00518: el detalle de D6 de una operación ('' si no es cancelada con monto). Lo usa también la confirmación al escribir. */
export const detalleD6 = (op: Datos): string => {
  if (estadoGrupoDe({ status: op.status, statusNombre: op.statusNombre }) !== 'cancelada') return '';
  const montos: [string, number][] = [
    ['Convenio', num(op.montoConvenioCliente)], ['Cargos', num(op.cargosAdicionales)],
    ['Dólares', num(op.dolaresCliente)], ['Pesos', num(op.pesosCliente)], ['Conversión', num(op.conversionCliente)],
  ];
  const conMonto = montos.filter(([, n]) => n !== 0);
  return conMonto.length ? `Cancelada con ${conMonto.map(([c, n]) => `${c} ${fmt(n)}`).join(', ')}` : '';
};

const MODULO_POR_ESTADO = { activa: 'operaciones', completada: 'serviciosCompletados', falso: 'serviciosCompletados', cancelada: 'serviciosCancelados' } as const;
const grupoDe = (op: Datos) => estadoGrupoDe({ status: op.status, statusNombre: op.statusNombre });
const destinoOp = (op: OpRevision): DestinoRevision => ({ modulo: MODULO_POR_ESTADO[grupoDe(op)], id: op.idDoc });
const destinoFactura = (f: FacturaRevision): DestinoRevision => ({ modulo: 'facturacionClientes', id: f.id });
const refOp = (op: OpRevision): string => refDeOperacion(op, op.idDoc);
const invoiceDe = (f: Datos): string => txt(f.invoice) || txt(f.id);
const statusFactura = (f: Datos): string => txt(f.statusFactura) || 'Facturado';
const facturaActiva = (f: Datos): boolean => !estaCancelada(statusFactura(f));

const filaOp = (codigo: CodigoRevision, op: OpRevision, detalle: string, enlaces: EnlaceRevision[] = []): FilaRevision => ({
  codigo,
  clave: `${codigo}:${op.idDoc}`,
  ref: refOp(op),
  cliente: String(valorExcelOperacion(op, 'cliente')),
  fecha: fechaServicioDeOperacion(op),
  status: String(valorExcelOperacion(op, 'status')),
  invoice: txt(op.facturaClienteInvoice),
  detalle,
  destino: destinoOp(op),
  enlaces,
});

// ── Índice de operaciones y ligas factura → operaciones ─────────────────────
interface Indice {
  porId: Map<string, OpRevision>;
  porRef: Map<string, OpRevision[]>;
}

const indexar = (ops: readonly OpRevision[]): Indice => {
  const porId = new Map<string, OpRevision>();
  const porRef = new Map<string, OpRevision[]>();
  ops.forEach((op) => { porId.set(op.idDoc, op); });
  ops.forEach((op) => { const app = txt(op.id); if (app && !porId.has(app)) porId.set(app, op); });
  ops.forEach((op) => {
    const r = normRef(refOp(op));
    if (!r) return;
    const l = porRef.get(r);
    if (l) l.push(op); else porRef.set(r, [op]);
  });
  return { porId, porRef };
};

/**
 * Operaciones de la lista de una factura y cuántos renglones no se ligaron. Cada renglón es una
 * operación: su id y su referencia (operacionesGuardadas), más los ids o referencias sueltos que no
 * estén en un renglón. El renglón liga si ALGUNA de sus fichas liga (id, id de AppSheet o referencia
 * de una sola operación).
 */
const operacionesDeFactura = (f: Datos, ind: Indice): { ops: OpRevision[]; sinLigar: number } => {
  const renglones: string[][] = lista(f.operacionesGuardadas)
    .map((r) => (r && typeof r === 'object' ? [txt((r as Datos).id), txt((r as Datos).ref)].filter(Boolean) : []))
    .filter((r) => r.length > 0);
  const enRenglon = new Set(renglones.flat());
  [...lista(f.operacionesIds), ...lista(f.operaciones)].map(txt).filter(Boolean).forEach((ficha) => {
    if (!enRenglon.has(ficha)) { enRenglon.add(ficha); renglones.push([ficha]); }
  });
  const ligar = (ficha: string): OpRevision | null => {
    const porId = ind.porId.get(ficha);
    if (porId) return porId;
    const porRef = ind.porRef.get(normRef(ficha)) ?? [];
    return porRef.length === 1 ? porRef[0] : null;
  };
  const encontradas = new Map<string, OpRevision>();
  let sinLigar = 0;
  renglones.forEach((fichas) => {
    const op = fichas.map(ligar).find((x): x is OpRevision => x !== null);
    if (op) encontradas.set(op.idDoc, op); else sinLigar++;
  });
  return { ops: Array.from(encontradas.values()), sinLigar };
};

const textoFactura = (f: Datos): string => `${invoiceDe(f)} (${statusFactura(f)}${txt(f.fecha) ? `, ${txt(f.fecha)}` : ''})`;

// ── Revisión ──────────────────────────────────────────────────────────────
export const revisarDatos = (e: EntradaRevision): ResultadoRevision => {
  const { operaciones, facturas, monedaEmpresa, reglaUnica } = e;
  const filas: FilaRevision[] = [];
  const ind = indexar(operaciones);

  // Facturas de cada operación (solo las no canceladas), por folio.
  const facturasDeOp = new Map<string, FacturaRevision[]>();
  const ligas = new Map<FacturaRevision, { ops: OpRevision[]; sinLigar: number }>();
  let sinLigar = 0;
  facturas.forEach((f) => {
    const liga = operacionesDeFactura(f, ind);
    ligas.set(f, liga);
    const { ops, sinLigar: n } = liga;
    if (!facturaActiva(f)) return;
    sinLigar += n;
    ops.forEach((op) => {
      const l = facturasDeOp.get(op.idDoc);
      if (l) l.push(f); else facturasDeOp.set(op.idDoc, [f]);
    });
  });
  const enlacesFacturas = (fs: readonly FacturaRevision[]): EnlaceRevision[] =>
    fs.map((f) => ({ texto: `Factura ${invoiceDe(f)}`, destino: destinoFactura(f) }));

  // F4 · en dos o más folios no cancelados
  facturasDeOp.forEach((fs, idDoc) => {
    const folios = new Map<string, FacturaRevision>();
    fs.forEach((f) => { const k = claveGrupoFactura(f, 'clienteId'); if (!folios.has(k)) folios.set(k, f); });
    if (folios.size < 2) return;
    const op = ind.porId.get(idDoc);
    if (!op) return;
    const distintas = Array.from(folios.values());
    filas.push(filaOp('F4', op, `En ${distintas.length} facturas: ${distintas.map(textoFactura).join('; ')}`, enlacesFacturas(distintas)));
  });

  // F1 · en una factura, sin Invoice ni marca
  const marcasF1: MarcaF1[] = [];
  operaciones.forEach((op) => {
    const fs = facturasDeOp.get(op.idDoc);
    if (!fs || facturadaCliente(op)) return;
    filas.push(filaOp('F1', op, `Está en ${fs.map(textoFactura).join('; ')}, pero la operación no tiene Invoice ni la marca de facturada`, enlacesFacturas(fs)));
    const f = fs[0];
    marcasF1.push({
      opId: op.idDoc, opAppId: txt(op.id) !== op.idDoc ? txt(op.id) : '', ref: refOp(op),
      cliente: String(valorExcelOperacion(op, 'cliente')), status: String(valorExcelOperacion(op, 'status')), grupo: grupoDe(op),
      facturaId: txt(f.idDoc) || f.id, invoice: txt(f.invoice), statusFactura: statusFactura(f), fechaFactura: txt(f.fecha), facturas: fs.length,
    });
  });

  // D2 · referencias repetidas
  let referenciasRepetidas = 0;
  ind.porRef.forEach((ops) => {
    if (ops.length < 2) return;
    referenciasRepetidas++;
    ops.forEach((op) => {
      const otras = ops.filter((o) => o !== op);
      const desc = otras.map((o) => `${fechaServicioDeOperacion(o) || 'sin fecha'}, ${String(valorExcelOperacion(o, 'cliente'))}${txt(o.facturaClienteInvoice) ? `, Invoice ${txt(o.facturaClienteInvoice)}` : ''}`);
      filas.push(filaOp('D2', op, `Misma referencia que ${otras.length === 1 ? 'otra operación' : `${otras.length} operaciones`}: ${desc.join('; ')}`,
        otras.map((o) => ({ texto: `La otra (${fechaServicioDeOperacion(o) || 'sin fecha'})`, destino: destinoOp(o) }))));
    });
  });

  // F3 · Invoice que no existe en Facturas (cualquier status)
  const invoices = new Set(facturas.map((f) => normInvoice(invoiceDe(f))));
  operaciones.forEach((op) => {
    const inv = txt(op.facturaClienteInvoice);
    if (!inv || invoices.has(normInvoice(inv))) return;
    const fs = facturasDeOp.get(op.idDoc) ?? [];
    const sugerido = fs.length === 1 ? ` · Invoice sugerido: ${invoiceDe(fs[0])} (la factura que la lista)` : '';
    filas.push(filaOp('F3', op, `El Invoice "${inv}" no existe en Facturas${sugerido}`, enlacesFacturas(fs)));
  });

  // D1 · D4 · D5 · la regla del Excel de operaciones (las canceladas no se revisan)
  operaciones.forEach((op) => {
    const v = validarOperacionExcel(op, monedaEmpresa);
    if (v.estado === 'ok') return;
    v.motivos.forEach((m) => {
      const codigo: CodigoRevision | null = m.startsWith('Faltan datos') ? 'D5' : m.startsWith('Moneda distinta') ? 'D1' : m.startsWith('Montos que no cuadran') ? 'D4' : null;
      if (!codigo) return;
      const facturada = facturadaCliente(op) ? ' · Ya facturada: se corrige a mano' : '';
      filas.push(filaOp(codigo, op, `${m}${codigo === 'D5' ? '' : facturada}`));
    });
  });

  // F2 · factura contra la suma de sus operaciones, en la moneda de la factura
  facturas.forEach((f, i) => {
    if (!facturaActiva(f)) return;
    const { ops, sinLigar: faltan } = ligas.get(f) ?? { ops: [], sinLigar: 0 };
    const moneda = monedaDeFactura(f) ?? monedaEmpresa.get(txt(f.clienteId)) ?? null;
    const total = reglaUnica ? totalNativoFactura(f) : totalNativoFacturaLegado(f);
    const base = { ref: invoiceDe(f), cliente: txt(f.clienteNombre) || '-', fecha: txt(f.fecha), status: statusFactura(f), invoice: invoiceDe(f), destino: destinoFactura(f) };
    if (!moneda) {
      filas.push({ ...base, codigo: 'F2', clave: `F2:${f.id}:${i}`, detalle: 'La factura no tiene moneda (ni su cliente en Empresas): no se puede comparar', enlaces: [] });
      return;
    }
    const valores = ops.map((op) => conversionOperacion({ ...op, facturadoEnCobrar: idMoneda(moneda), monedaCobroNombre: nombreMoneda(moneda) }, 'cliente').total);
    const suma = sumarMontos(valores);
    const diferencia = Math.round((total - suma) * 100) / 100;
    if (Math.abs(diferencia) < 0.01) return;
    const enCero = valores.filter((v) => v === 0).length;
    const extras = [
      ops.length === 0 ? 'no lista operaciones que se encuentren' : `${ops.length} operación${ops.length === 1 ? '' : 'es'}`,
      ...(faltan > 0 ? [`${faltan} que no se encontraron`] : []),
      ...(enCero > 0 ? [`${enCero} con ingreso en 0`] : []),
    ];
    const codigo: CodigoRevision = Math.abs(diferencia) < 1 ? 'F2c' : 'F2';
    filas.push({
      ...base, codigo, clave: `${codigo}:${f.id}:${i}`,
      detalle: `Factura ${fmt(total)} ${moneda} · operaciones ${fmt(suma)} ${moneda} · diferencia ${fmt(diferencia)} (${extras.join(', ')})`,
      enlaces: ops.slice(0, 6).map((op) => ({ texto: refOp(op), destino: destinoOp(op) })),
    });
  });

  // D6 · canceladas con monto. ✅ V00518: las confirmadas (✓) con ESE mismo detalle no se muestran.
  const confirmadas: Partial<Record<CodigoRevision, number>> = {};
  operaciones.forEach((op) => {
    const detalle = detalleD6(op);
    if (!detalle) return;
    if (confirmacionDe(op, 'D6')?.detalle === detalle) { confirmadas.D6 = (confirmadas.D6 ?? 0) + 1; return; }
    filas.push(filaOp('D6', op, detalle));
  });

  // F5 · terminadas sin facturar (ni marca ni factura no cancelada que las liste)
  operaciones.forEach((op) => {
    if (!esGrupoTerminado(grupoDe(op)) || facturadaCliente(op) || facturasDeOp.has(op.idDoc)) return;
    filas.push(filaOp('F5', op, 'Terminada, sin Invoice y en ninguna factura'));
  });

  // D3 · sin status (los ids fijos de Completado y Cancelado cuentan como status aunque no traigan nombre)
  const statusD3: StatusD3[] = [];
  operaciones.forEach((op) => {
    if (valorExcelOperacion(op, 'status') !== '-' || STATUS_FINALES.includes(txt(op.status))) return;
    const fila = filaOp('D3', op, txt(op.status) ? `El status "${txt(op.status)}" no está en el catálogo` : 'La operación no tiene status');
    filas.push(fila);
    statusD3.push({ opId: op.idDoc, ref: fila.ref, cliente: fila.cliente, fecha: fila.fecha, status: txt(op.status), statusNombre: txt(op.statusNombre) }); // ✅ V00517
  });

  // Orden: por grupo (el de GRUPOS_REVISION), luego fecha (recientes primero) y referencia.
  const orden = new Map(GRUPOS_REVISION.map((g, i) => [g.codigo, i]));
  filas.sort((a, b) => (orden.get(a.codigo) ?? 0) - (orden.get(b.codigo) ?? 0) || b.fecha.localeCompare(a.fecha) || a.ref.localeCompare(b.ref));
  const conteo = Object.fromEntries(GRUPOS_REVISION.map((g) => [g.codigo, 0])) as Record<CodigoRevision, number>;
  filas.forEach((f) => { conteo[f.codigo]++; });
  return { filas, conteo, referenciasRepetidas, operaciones: operaciones.length, facturas: facturas.length, sinLigar, marcasF1, statusD3, confirmadas };
};

// ── ✅ V00512 — Rango de fechas (filtra lo que se ve; la revisión siempre se hace con todo) ──
export interface VistaRevision {
  filas: FilaRevision[];
  conteo: Record<CodigoRevision, number>;
  /** Las de F1 que entran en el rango (para "Marcar facturadas"). */
  marcasF1: MarcaF1[];
  /** ✅ V00517: las de D3 que entran en el rango (para "Corregir status"). */
  statusD3: StatusD3[];
  /** Con rango: cuántas filas no tienen fecha y por eso no se muestran. */
  sinFecha: number;
}

/**
 * Las filas cuya fecha (servicio de la operación; fecha de la factura en F2) cae entre `desde` y
 * `hasta` (AAAA-MM-DD, ambos incluidos; vacío = sin límite). Solo filtra: las comparaciones entre
 * facturas y operaciones se hicieron con TODO, así un rango no inventa errores en sus orillas.
 */
export const filtrarPorFechas = (r: ResultadoRevision, desde: string, hasta: string): VistaRevision => {
  const conRango = !!(desde || hasta);
  let sinFecha = 0;
  const filas = !conRango ? r.filas : r.filas.filter((f) => {
    const fecha = aFechaISO(f.fecha);
    if (!fecha) { sinFecha++; return false; }
    return (!desde || fecha >= desde) && (!hasta || fecha <= hasta);
  });
  const conteo = Object.fromEntries(GRUPOS_REVISION.map((g) => [g.codigo, 0])) as Record<CodigoRevision, number>;
  filas.forEach((f) => { conteo[f.codigo]++; });
  const enF1 = new Set(filas.filter((f) => f.codigo === 'F1').map((f) => f.destino.id));
  const marcasF1 = conRango ? r.marcasF1.filter((m) => enF1.has(m.opId)) : r.marcasF1;
  const enD3 = new Set(filas.filter((f) => f.codigo === 'D3').map((f) => f.destino.id));
  const statusD3 = conRango ? r.statusD3.filter((d) => enD3.has(d.opId)) : r.statusD3;
  return { filas, conteo, marcasF1, statusD3, sinFecha };
};

/** Filas del Excel (todas, con el grupo y dónde se corrige). */
export const filasExcelRevision = (r: Pick<ResultadoRevision, 'filas'>): Record<string, string>[] => {
  const grupo = new Map(GRUPOS_REVISION.map((g) => [g.codigo, g]));
  return r.filas.map((f) => {
    const g = grupo.get(f.codigo);
    return {
      Grupo: f.codigo,
      Error: g?.titulo ?? '',
      Prioridad: g?.prioridad ?? '',
      'Referencia / Invoice': f.ref,
      Cliente: f.cliente,
      Fecha: f.fecha,
      Status: f.status,
      Invoice: f.invoice,
      Detalle: f.detalle,
      'Dónde se corrige': g?.correccion ?? '',
    };
  });
};

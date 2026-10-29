// src/features/facturacion/services/cotejoCfdi.ts
// ---------------------------------------------------------------------------
// ✅ V00513 — COTEJO DE UN XML (CFDI) CONTRA LAS OPERACIONES DE LA APP. Puro.
// Por cada referencia del XML busca su operación y revisa que:
//   · la operación exista, no esté ya facturada ni en Revisión (Ref Cliente duplicada);
//   · todas sean del mismo cliente, y ese cliente sea el del XML (RFC / Tax ID / nombre);
//   · la moneda del XML sea la del cliente en Empresas;
//   · el importe de cada concepto sea, AL CENTAVO, lo que la app cobraría por la operación;
//   · el folio no exista ya en la app.
// El resultado dice si la factura está lista para registrarse o qué hay que corregir
// antes (en la operación o en el SIT). La escritura la hace el flujo de siempre
// (Generar Factura), no este archivo.
// ---------------------------------------------------------------------------
import { montoOperacion, totalNativoDeOperaciones } from '../../../shared/dominio/dinero';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import type { Cfdi } from './leerCfdi';
import { normalizarRef } from './leerCfdi';

/** Lo que el cotejo necesita de una operación (lo arma `opParaCotejo` con la lista del tablero). */
export interface OpCotejo {
  /** id con el que la lista y la factura guardan la operación. */
  id: string;
  /** Referencia normalizada (TR-271026-026). */
  ref: string;
  clienteId: string;
  /** Folio de la factura que ya la tiene ('' = pendiente). */
  facturaFolio: string;
  /** Ref Cliente duplicada: está en la pestaña Revisión y no se puede facturar. */
  enRevision: boolean;
  importeUSD: number;
  importeMXN: number;
  tipoCambio: number;
}

export interface ClienteCotejo {
  nombre: string;
  rfc: string;
  moneda: 'USD' | 'MXN' | '';
}

export interface FolioExistente {
  folio: string;
  clienteNombre: string;
}

/** 'registrada' = el folio ya está en la app con estas mismas operaciones (p. ej. recién registrada). */
export type EstadoCotejo = 'listo' | 'diferencias' | 'bloqueada' | 'sin_operacion' | 'registrada';

export interface RenglonCotejo {
  refs: string[];
  descripcion: string;
  importeXml: number;
  /** Lo que la app cobraría por esas operaciones en la moneda del XML (null si falta alguna). */
  importeApp: number | null;
  /** Explicación corta si el renglón no cuadra ('' = cuadra). */
  problema: string;
}

export interface ResultadoCotejo {
  estado: EstadoCotejo;
  cfdi: Cfdi;
  clienteId: string;
  /** ids (de la lista) de las operaciones que se facturarían. */
  opsIds: string[];
  renglones: RenglonCotejo[];
  /** Lo que impide registrar la factura tal como está. */
  problemas: string[];
  /** Avisos que no impiden registrarla. */
  notas: string[];
}

export const RFC_GENERICOS = new Set(['XEXX010101000', 'XAXX010101000']);

const texto = (v: unknown): string => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());

/** "C.H. Robinson Worldwide, INC." y "C.H. ROBINSON WORLDWIDE,INC." → la misma clave. */
export const claveNombre = (nombre: string): string =>
  nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const soloAlfanumerico = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const mismoNombre = (a: string, b: string): boolean => {
  const x = claveNombre(a);
  const y = claveNombre(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [corto, largo] = x.length <= y.length ? [x, y] : [y, x];
  return corto.length >= 6 && largo.startsWith(corto); // "TEMM TRUCK" ~ "TEMM TRUCK SA DE CV"
};

/** ¿El receptor del XML es este cliente? Devuelve el problema o ''. */
export const problemaCliente = (cfdi: Cfdi, cliente: ClienteCotejo): string => {
  const rfcApp = soloAlfanumerico(cliente.rfc);
  const rfcXml = soloAlfanumerico(cfdi.receptorRfc);
  const descripcionXml = `${cfdi.receptorNombre} (${cfdi.receptorRfc}${cfdi.receptorTaxId ? ` / Tax ID ${cfdi.receptorTaxId}` : ''})`;
  const descripcionApp = `${cliente.nombre}${cliente.rfc ? ` (${cliente.rfc})` : ''}`;
  if (rfcXml && !RFC_GENERICOS.has(rfcXml) && rfcApp && !RFC_GENERICOS.has(rfcApp)) {
    return rfcXml === rfcApp ? '' : `El XML es para ${descripcionXml} y las operaciones son de ${descripcionApp}.`;
  }
  // Extranjero (RFC genérico): por Tax ID si la app lo tiene, si no por nombre.
  const taxId = soloAlfanumerico(cfdi.receptorTaxId);
  if (taxId && rfcApp && !RFC_GENERICOS.has(rfcApp) && (rfcApp === taxId || rfcApp.includes(taxId))) return '';
  if (mismoNombre(cfdi.receptorNombre, cliente.nombre)) return '';
  return `El XML es para ${descripcionXml} y las operaciones son de ${descripcionApp}.`;
};

/** Importe de una operación en una moneda, con la MISMA regla con que Generar Factura guarda el total. */
export const importeEn = (moneda: 'USD' | 'MXN', op: unknown): number => { // ✅ V00514: también lo usa documentoFactura.ts
  const m = montoOperacion(op, 'cliente');
  return totalNativoDeOperaciones(moneda, [{ monto: m.conv, dol: m.dol, pes: m.pes, subtotalBase: m.subtotal }]);
};

/** Arma lo que el cotejo necesita de una operación de la lista de Facturación de Clientes. */
export const opParaCotejo = (op: Record<string, unknown>, facturaFolio: string, enRevision: boolean): OpCotejo => ({
  id: texto(op.id),
  ref: normalizarRef(texto(op.numReferencia) || texto(op.referencia) || texto(op.ref)),
  clienteId: texto(op.clientePaga) || texto(op.clienteId),
  facturaFolio,
  enRevision,
  importeUSD: importeEn('USD', op),
  importeMXN: importeEn('MXN', op),
  tipoCambio: montoOperacion(op, 'cliente').tc,
});

const dinero = (n: number): string => n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const cotejarCfdi = (
  cfdi: Cfdi,
  ops: readonly OpCotejo[],
  clientes: ReadonlyMap<string, ClienteCotejo>,
  foliosExistentes: readonly FolioExistente[],
): ResultadoCotejo => {
  const problemas: string[] = [];
  const notas: string[] = [];
  const bloqueos: string[] = [];
  const porRef = new Map<string, OpCotejo>();
  ops.forEach((o) => { if (o.ref && !porRef.has(o.ref)) porRef.set(o.ref, o); });

  if (cfdi.tipo && cfdi.tipo !== 'I') bloqueos.push(`Es un comprobante tipo "${cfdi.tipo}"; aquí solo se registran facturas de ingreso (tipo I).`);
  if (!cfdi.moneda) bloqueos.push('El XML no trae moneda MXN o USD.');
  const repetida = foliosExistentes.find((f) => f.folio.trim().toUpperCase() === cfdi.folio.toUpperCase());
  if (repetida) bloqueos.push(`La factura ${cfdi.folio} ya está registrada en la app${repetida.clienteNombre ? ` (${repetida.clienteNombre})` : ''}.`);

  const usadas = new Map<string, OpCotejo>();
  const renglones: RenglonCotejo[] = cfdi.conceptos.map((c) => {
    if (c.refs.length === 0) {
      problemas.push(`Un concepto no trae número de referencia: "${c.descripcion.replace(/\s+/g, ' ').slice(0, 60)}".`);
      return { refs: [], descripcion: c.descripcion, importeXml: c.importe, importeApp: null, problema: 'Sin referencia' };
    }
    const encontradas: OpCotejo[] = [];
    const faltan: string[] = [];
    c.refs.forEach((ref) => {
      const op = porRef.get(ref);
      if (!op) { faltan.push(ref); return; }
      encontradas.push(op);
      if (usadas.has(ref)) return;
      usadas.set(ref, op);
      if (op.facturaFolio) bloqueos.push(`${ref} ya está en la factura ${op.facturaFolio}.`);
      else if (op.enRevision) bloqueos.push(`${ref} tiene la Ref Cliente duplicada (pestaña Revisión); revísala antes de facturar.`);
    });
    if (faltan.length > 0) {
      problemas.push(`${faltan.join(', ')} no aparece en las operaciones por facturar.`);
      return { refs: c.refs, descripcion: c.descripcion, importeXml: c.importe, importeApp: null, problema: 'No se encontró la operación' };
    }
    if (!cfdi.moneda) return { refs: c.refs, descripcion: c.descripcion, importeXml: c.importe, importeApp: null, problema: '' };
    const importeApp = r2(encontradas.reduce((s, o) => s + (cfdi.moneda === 'USD' ? o.importeUSD : o.importeMXN), 0));
    if (aCentavos(importeApp) === aCentavos(c.importe)) return { refs: c.refs, descripcion: c.descripcion, importeXml: c.importe, importeApp, problema: '' };
    const dif = r2(c.importe - importeApp);
    let pista = '';
    const tcOp = encontradas[0]?.tipoCambio ?? 0;
    if (cfdi.moneda === 'MXN' && c.tcDescripcion > 0 && tcOp > 0 && Math.abs(c.tcDescripcion - tcOp) > 0.00005) {
      pista = ` El XML usa TC ${c.tcDescripcion} y la operación ${tcOp}.`;
    }
    problemas.push(`${c.refs.join(', ')}: el XML cobra ${dinero(c.importe)} ${cfdi.moneda} y la app ${dinero(importeApp)} (diferencia ${dif > 0 ? '+' : ''}${dinero(dif)}).${pista}`);
    return { refs: c.refs, descripcion: c.descripcion, importeXml: c.importe, importeApp, problema: `Diferencia ${dif > 0 ? '+' : ''}${dinero(dif)}${pista ? ' (TC distinto)' : ''}` };
  });

  const opsUsadas = [...usadas.values()];
  const clientesIds = [...new Set(opsUsadas.map((o) => o.clienteId).filter(Boolean))];
  let clienteId = '';
  if (clientesIds.length > 1) {
    problemas.push(`Las referencias son de clientes distintos: ${clientesIds.map((id) => clientes.get(id)?.nombre || id).join(', ')}.`);
  } else if (clientesIds.length === 1) {
    clienteId = clientesIds[0];
    const cliente = clientes.get(clienteId);
    if (!cliente) {
      problemas.push('El cliente de las operaciones no está en Empresas.');
    } else {
      const p = problemaCliente(cfdi, cliente);
      if (p) problemas.push(p);
      if (!cliente.rfc) notas.push(`${cliente.nombre} no tiene RFC / Tax ID en Empresas; se comparó por nombre.`);
      if (!cliente.moneda) bloqueos.push(`${cliente.nombre} no tiene moneda de facturación en Empresas.`);
      else if (cfdi.moneda && cliente.moneda !== cfdi.moneda) problemas.push(`El XML está en ${cfdi.moneda} y ${cliente.nombre} se factura en ${cliente.moneda}.`);
    }
  } else if (opsUsadas.length > 0) {
    problemas.push('Las operaciones no tienen cliente que paga.');
  }

  const sumaConceptos = r2(cfdi.conceptos.reduce((s, c) => s + c.importe, 0));
  if (aCentavos(sumaConceptos) !== aCentavos(cfdi.subtotal)) notas.push(`La suma de los conceptos (${dinero(sumaConceptos)}) no es el subtotal del XML (${dinero(cfdi.subtotal)}).`);

  const yaRegistrada = !!repetida && opsUsadas.length > 0 && cfdi.conceptos.every((c) => c.refs.length > 0)
    && opsUsadas.every((o) => o.facturaFolio.trim().toUpperCase() === cfdi.folio.toUpperCase());
  if (yaRegistrada) {
    return { estado: 'registrada', cfdi, clienteId, opsIds: opsUsadas.map((o) => o.id), renglones, problemas: [], notas: [] };
  }
  const estado: EstadoCotejo = bloqueos.length > 0 ? 'bloqueada'
    : opsUsadas.length === 0 ? 'sin_operacion'
      : problemas.length > 0 ? 'diferencias' : 'listo';
  return { estado, cfdi, clienteId, opsIds: opsUsadas.map((o) => o.id), renglones, problemas: [...bloqueos, ...problemas], notas };
};

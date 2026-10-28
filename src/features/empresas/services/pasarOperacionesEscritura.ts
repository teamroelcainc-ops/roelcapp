// src/features/empresas/services/pasarOperacionesEscritura.ts
// ---------------------------------------------------------------------------
// ✅ V00508 — LECTURAS y ESCRITURAS de "Pasar a otra empresa" (la regla está en pasarOperaciones.ts).
//   · Lecturas (solo si se pasan facturas): las facturas del lado que cambia de la empresa origen y
//     de la destino (folios repetidos), y los pagos de la origen. Consultas por empresa (`in` con sus
//     dos ids), no colecciones completas.
//   · Escrituras en TRANSACCIÓN, que vuelve a leer cada documento: si una operación ya no tiene a la
//     empresa origen en ese papel (o se facturó mientras tanto), no se toca y se dice por qué. Una
//     factura se pasa junto con sus operaciones y sus pagos en la MISMA transacción (todo o nada).
//   · Una entrada en la bitácora (registrarLog) con las referencias, facturas y pagos que pasaron.
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, query, runTransaction, where } from 'firebase/firestore';
import type { DocumentReference, DocumentSnapshot, Transaction } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import {
  cambiosDeFactura, cambiosDeOperacion, cambiosDePago, etiquetaPapel, facturaEsDe, facturaPaseDe, facturadaEn, folio, pagaA,
  pagoEsDe, pagoPaseDe, papelesDeEmpresa, PAPELES_EMPRESA,
} from './pasarOperaciones';
import type { FacturaPase, Lado, ModoFacturadas, Omitida, OpPase, PagoPase, Papel, PlanPase } from './pasarOperaciones';

type Datos = Record<string, unknown>;

const FACTURAS: Record<Lado, { coleccion: string; campo: string }> = {
  cliente: { coleccion: 'facturas_clientes', campo: 'clienteId' },
  proveedor: { coleccion: 'facturas_proveedores', campo: 'proveedorId' },
};
const CAMPOS_PAGO = ['entidadId', 'clienteId', 'proveedorId', 'empresaId'] as const;
/** Operaciones por transacción cuando no llevan factura (cada una es una lectura y una escritura). */
const TANDA = 100;

const porCampo = async (coleccion: string, campo: string, ids: readonly string[]): Promise<(Datos & { id: string })[]> => {
  if (ids.length === 0) return [];
  const snap = await getDocs(query(collection(db, coleccion), where(campo, 'in', ids.slice(0, 30))));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
};

export interface DatosDePase { facturas: FacturaPase[]; pagos: PagoPase[]; foliosDestino: Record<Lado, Set<string>> }

/** Facturas y pagos para pasar operaciones "con su factura". */
export const leerDatosDePase = async (idsOrigen: readonly string[], idsDestino: readonly string[], lados: readonly Lado[]): Promise<DatosDePase> => {
  const foliosDestino: Record<Lado, Set<string>> = { cliente: new Set(), proveedor: new Set() };
  const facturas: FacturaPase[] = [];
  await Promise.all(lados.map(async (l) => {
    const [deOrigen, deDestino] = await Promise.all([
      porCampo(FACTURAS[l].coleccion, FACTURAS[l].campo, idsOrigen),
      porCampo(FACTURAS[l].coleccion, FACTURAS[l].campo, idsDestino),
    ]);
    deOrigen.forEach((d) => facturas.push(facturaPaseDe(d, l)));
    deDestino.forEach((d) => { const f = folio(facturaPaseDe(d, l).invoice); if (f) foliosDestino[l].add(f); });
  }));
  const pagosPorId = new Map<string, Datos & { id: string }>();
  (await Promise.all(CAMPOS_PAGO.map((c) => porCampo('pagos', c, idsOrigen)))).flat().forEach((p) => pagosPorId.set(p.id, p));
  return { facturas, pagos: Array.from(pagosPorId.values()).map(pagoPaseDe), foliosDestino };
};

// ── Ejecución ─────────────────────────────────────────────────────────────
export interface PaseSolicitado {
  plan: PlanPase;
  modo: ModoFacturadas | null;
  papeles: readonly Papel[];
  idsOrigen: readonly string[];
  origenNombre: string;
  idDestino: string;
  destino: Datos;
  destinoNombre: string;
}

export interface ResultadoPase { pasadas: string[]; omitidas: Omitida[]; facturas: string[]; pagos: number }

interface Grupo { ops: OpPase[]; facturas: FacturaPase[]; pagos: PagoPase[] }

/** Facturas unidas por un pago o por una operación (con sus dos lados facturados) van en el mismo grupo. */
const gruposConFactura = (plan: PlanPase): Grupo[] => {
  const padre = new Map(plan.facturas.map((f) => [f.id, f.id]));
  const raiz = (x: string): string => { let r = x; while (padre.get(r) !== r) r = padre.get(r) ?? r; return r; };
  const unir = (ids: string[]) => ids.slice(1).forEach((x) => { if (padre.has(x) && padre.has(ids[0])) padre.set(raiz(x), raiz(ids[0])); });
  plan.pagos.forEach((p) => unir(plan.facturas.filter((f) => pagaA(p, f)).map((f) => f.id)));
  plan.operaciones.forEach((o) => unir(o.facturas));
  const grupos = new Map<string, Grupo>();
  const de = (fid: string): Grupo => { const r = raiz(fid); const g = grupos.get(r) ?? { ops: [], facturas: [], pagos: [] }; grupos.set(r, g); return g; };
  plan.facturas.forEach((f) => de(f.id).facturas.push(f));
  plan.operaciones.filter((o) => o.facturas.length > 0).forEach((o) => de(o.facturas[0]).ops.push(o));
  plan.pagos.forEach((p) => { const f = plan.facturas.find((x) => pagaA(p, x)); if (f) de(f.id).pagos.push(p); });
  return Array.from(grupos.values());
};

const ladosDe = (papeles: readonly Papel[]): Lado[] =>
  Array.from(new Set(papeles.map((p) => PAPELES_EMPRESA.find((x) => x.campo === p)?.lado).filter((l): l is Lado => !!l)));

/** Motivo por el que una operación ya no se puede pasar ('' = se puede). */
const motivoAlEscribir = (snap: DocumentSnapshot, o: OpPase, s: PaseSolicitado): string => {
  if (!snap.exists()) return 'La operación ya no existe';
  const datos = snap.data() as Datos;
  const tiene = papelesDeEmpresa(datos, s.idsOrigen);
  if (o.papeles.some((p) => !tiene.includes(p))) return 'Cambió mientras tanto: la empresa ya no está en ese papel';
  if (o.facturas.length === 0 && s.modo !== 'sinFactura' && ladosDe(o.papeles).some((l) => facturadaEn(datos, l))) return 'Se facturó mientras tanto';
  return '';
};

const leer = (tx: Transaction, refs: DocumentReference[]): Promise<DocumentSnapshot[]> => Promise.all(refs.map((r) => tx.get(r)));

/** Una tanda de operaciones sin factura: se pasan las que siguen igual; las demás se omiten. */
const pasarTanda = (ops: OpPase[], s: PaseSolicitado): Promise<{ pasadas: string[]; omitidas: Omitida[] }> =>
  runTransaction(db, async (tx) => {
    const refs = ops.map((o) => doc(db, 'operaciones', o.id));
    const snaps = await leer(tx, refs);
    const pasadas: string[] = [];
    const omitidas: Omitida[] = [];
    ops.forEach((o, i) => {
      const motivo = motivoAlEscribir(snaps[i], o, s);
      if (motivo) { omitidas.push({ id: o.id, ref: o.ref, motivo }); return; }
      tx.update(refs[i], cambiosDeOperacion(snaps[i].data() as Datos, o.papeles, s.idsOrigen, s.idDestino, s.destino));
      pasadas.push(o.ref);
    });
    return { pasadas, omitidas };
  });

/** Un grupo con factura: todo o nada. */
const pasarGrupo = (g: Grupo, s: PaseSolicitado): Promise<string> =>
  runTransaction(db, async (tx) => {
    const refsOps = g.ops.map((o) => doc(db, 'operaciones', o.id));
    const refsFac = g.facturas.map((f) => doc(db, FACTURAS[f.lado].coleccion, f.id));
    const refsPag = g.pagos.map((p) => doc(db, 'pagos', p.id));
    const [sOps, sFac, sPag] = await Promise.all([leer(tx, refsOps), leer(tx, refsFac), leer(tx, refsPag)]);
    const motivo = g.ops.map((o, i) => motivoAlEscribir(sOps[i], o, s)).find(Boolean)
      || (g.facturas.some((f, i) => !sFac[i].exists() || !facturaEsDe(sFac[i].data() as Datos, f.lado, s.idsOrigen)) ? 'Su factura cambió mientras tanto' : '')
      || (g.pagos.some((_p, i) => !sPag[i].exists() || !pagoEsDe(sPag[i].data() as Datos, s.idsOrigen)) ? 'Un pago de su factura cambió mientras tanto' : '');
    if (motivo) return motivo;
    g.ops.forEach((o, i) => tx.update(refsOps[i], cambiosDeOperacion(sOps[i].data() as Datos, o.papeles, s.idsOrigen, s.idDestino, s.destino)));
    g.facturas.forEach((f, i) => tx.update(refsFac[i], cambiosDeFactura(sFac[i].data() as Datos, f.lado, s.idDestino, s.destino)));
    g.pagos.forEach((_p, i) => tx.update(refsPag[i], cambiosDePago(sPag[i].data() as Datos, s.idsOrigen, s.idDestino, s.destino)));
    return '';
  });

const MODO_TEXTO: Record<ModoFacturadas, string> = {
  dejar: 'las facturadas no se pasaron',
  sinFactura: 'las facturadas se pasaron sin su factura',
  conFactura: 'las facturadas se pasaron con su factura y sus pagos',
};

/** Pasa lo que dice el plan. `alAvanzar(hechas, total)` cuenta operaciones. */
export const ejecutarPase = async (s: PaseSolicitado, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoPase> => {
  const total = s.plan.operaciones.length;
  const r: ResultadoPase = { pasadas: [], omitidas: [...s.plan.omitidas], facturas: [], pagos: 0 };
  let hechas = 0;
  alAvanzar(0, total);
  for (const g of gruposConFactura(s.plan)) {
    const motivo = await pasarGrupo(g, s);
    if (motivo) g.ops.forEach((o) => r.omitidas.push({ id: o.id, ref: o.ref, motivo }));
    else { r.pasadas.push(...g.ops.map((o) => o.ref)); r.facturas.push(...g.facturas.map((f) => f.invoice || f.id)); r.pagos += g.pagos.length; }
    hechas += g.ops.length;
    alAvanzar(hechas, total);
  }
  const sueltas = s.plan.operaciones.filter((o) => o.facturas.length === 0);
  for (let i = 0; i < sueltas.length; i += TANDA) {
    const t = await pasarTanda(sueltas.slice(i, i + TANDA), s);
    r.pasadas.push(...t.pasadas);
    r.omitidas.push(...t.omitidas);
    hechas += Math.min(TANDA, sueltas.length - i);
    alAvanzar(hechas, total);
  }
  if (r.pasadas.length > 0) {
    const papeles = s.papeles.map(etiquetaPapel).join(' y ');
    const extra = [
      r.facturas.length > 0 ? `facturas: ${r.facturas.join(', ')}` : '',
      r.pagos > 0 ? `${r.pagos} pago(s)` : '',
      s.plan.facturadas > 0 && s.modo ? MODO_TEXTO[s.modo] : '',
    ].filter(Boolean).join(' · ');
    // registrarLog no lanza (si falla lo dice en consola): lo escrito ya quedó.
    await registrarLog('Empresas', 'Edición',
      `Pasó ${r.pasadas.length} operación(es) de "${s.origenNombre}" a "${s.destinoNombre}" como ${papeles}: ${r.pasadas.join(', ')}${extra ? ` · ${extra}` : ''}.`);
  }
  return r;
};

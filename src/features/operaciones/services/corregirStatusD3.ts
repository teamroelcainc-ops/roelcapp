// src/features/operaciones/services/corregirStatusD3.ts
// ---------------------------------------------------------------------------
// ✅ V00517 — CORRECCIÓN D3 de la Revisión de datos: "Corregir status". Operaciones cuyo status
// guardado no se encuentra en el catálogo (catalogo_status_servicio) porque tienen el NOMBRE escrito
// con otra forma (espacios, acentos, mayúsculas) o un nombre viejo del status ("3. Documentado"
// cuando en el catálogo ya se llama "3. Documentado (Asignado)"). A cada una se le escribe el status
// del catálogo como lo escriben los botones de status de Operaciones:
//   status (id del catálogo) · statusNombre (su nombre) · statusCorregidoPorRevision (fecha y hora)
// Cómo se busca su status en el catálogo (primero con `status`, luego con `statusNombre`):
//   1) mismo nombre (sin importar espacios, acentos ni mayúsculas);
//   2) nombre anterior: el del catálogo es el mismo con algo más al final ("… (Asignado)");
//   3) mismo número: un solo status del catálogo empieza con ese número ("3.").
// Si no hay uno solo (ninguno o varios), no se toca: se corrige a mano.
// Mismas reglas de escritura masiva que F1: PRUEBA → RESPALDO → "APLICAR". Al aplicar, cada tanda va
// en TRANSACCIÓN, relee la operación y el status del catálogo: si la operación cambió de status
// desde la revisión, o ya no existe, no se toca.
// ---------------------------------------------------------------------------
import { doc, runTransaction } from 'firebase/firestore';
import type { DocumentReference, DocumentSnapshot } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { normalizarNombreFlujo } from '../../../shared/dominio/flujos';
import { registrarLog } from '../../../utils/logger';
import type { CeldaExcel } from './excelOperaciones';
import type { StatusD3 } from './revisionDatos';

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
const TANDA = 100;

/** Un status del catálogo: `id` es el valor que se guarda en la operación; `docId`, su documento. */
export interface StatusCatalogo { id: string; docId: string; nombre: string }

export type ReglaStatus = 'mismo nombre' | 'nombre anterior' | 'mismo número';

export interface CambioD3 {
  op: StatusD3;
  /** Con qué valor guardado se encontró (el de `status` o el de `statusNombre`). */
  desde: string;
  regla: ReglaStatus;
  destino: StatusCatalogo;
}
export interface OmitidaD3 { op: StatusD3; motivo: string }
export interface PlanD3 { corregir: CambioD3[]; omitidas: OmitidaD3[] }

export const MOTIVO_SIN_STATUS = 'No tiene status: capturarlo en el formulario';

/** De los documentos del catálogo (con su id y nombre), los que se pueden asignar. */
export const statusDelCatalogo = (catalogo: readonly { id: string; _docId?: string; nombre?: unknown }[]): StatusCatalogo[] =>
  catalogo.flatMap((s) => {
    const nombre = txt(s.nombre);
    const id = txt(s.id);
    return nombre && id ? [{ id, docId: txt(s._docId) || id, nombre }] : [];
  });

/** "3. Documentado" → "3"; "4.1 Salida" → "4.1"; sin número → ''. */
export const numeroDeStatus = (nombre: string): string => /^\s*(\d+(?:\.\d+)*)\.?(?:\s|$)/.exec(nombre)?.[1] ?? '';

type Busqueda = { tipo: 'una'; regla: ReglaStatus; destino: StatusCatalogo } | { tipo: 'varias'; nombres: string[] } | { tipo: 'ninguna' };

const unico = (regla: ReglaStatus, encontrados: StatusCatalogo[]): Busqueda | null => {
  if (encontrados.length === 1) return { tipo: 'una', regla, destino: encontrados[0] };
  if (encontrados.length > 1) return { tipo: 'varias', nombres: encontrados.map((s) => s.nombre) };
  return null;
};

/** Busca en el catálogo el status que corresponde a un valor guardado (reglas 1 → 3). */
export const buscarStatus = (valor: string, catalogo: readonly StatusCatalogo[]): Busqueda => {
  const v = normalizarNombreFlujo(valor);
  if (!v) return { tipo: 'ninguna' };
  const exacto = unico('mismo nombre', catalogo.filter((s) => normalizarNombreFlujo(s.nombre) === v));
  if (exacto) return exacto;
  const anterior = unico('nombre anterior', catalogo.filter((s) => {
    const n = normalizarNombreFlujo(s.nombre);
    return n.startsWith(`${v} `) || n.startsWith(`${v}(`);
  }));
  if (anterior) return anterior;
  const numero = numeroDeStatus(v);
  if (numero) {
    const r = unico('mismo número', catalogo.filter((s) => numeroDeStatus(s.nombre) === numero));
    if (r) return r;
  }
  return { tipo: 'ninguna' };
};

/** Qué se corrige y qué no (y por qué). */
export const planCorregirStatusD3 = (ops: readonly StatusD3[], catalogo: readonly StatusCatalogo[]): PlanD3 => {
  const corregir: CambioD3[] = [];
  const omitidas: OmitidaD3[] = [];
  ops.forEach((op) => {
    const valores = Array.from(new Set([op.status, op.statusNombre].filter((x) => x && x !== '-')));
    if (valores.length === 0) { omitidas.push({ op, motivo: MOTIVO_SIN_STATUS }); return; }
    let varias: string[] | null = null;
    for (const desde of valores) {
      const b = buscarStatus(desde, catalogo);
      if (b.tipo === 'una') { corregir.push({ op, desde, regla: b.regla, destino: b.destino }); return; }
      if (b.tipo === 'varias' && !varias) varias = b.nombres;
    }
    omitidas.push({
      op,
      motivo: varias
        ? `Se parece a varios status del catálogo (${varias.join(' o ')}): corregirla a mano`
        : 'No se parece a ningún status del catálogo: corregirla a mano',
    });
  });
  return { corregir, omitidas };
};

/** Campos que se escriben en la operación (los mismos que los botones de status, más la marca). */
export const camposStatus = (destino: StatusCatalogo, cuando: string): Datos => ({
  status: destino.id, statusNombre: destino.nombre, statusCorregidoPorRevision: cuando,
});

/** Excel de PRUEBA: una fila por operación, con lo que se haría. */
export const filasPruebaD3 = (plan: PlanD3): Record<string, CeldaExcel>[] => [
  ...plan.corregir.map((c) => ({
    'Acción': 'Se corrige', Referencia: c.op.ref, Cliente: c.op.cliente, Fecha: c.op.fecha,
    'status guardado': c.op.status, 'statusNombre guardado': c.op.statusNombre,
    'Status del catálogo': c.destino.nombre, 'Id del catálogo': c.destino.id, 'Cómo se encontró': `${c.regla} ("${c.desde}")`, Motivo: '',
  })),
  ...plan.omitidas.map((o) => ({
    'Acción': 'No se corrige', Referencia: o.op.ref, Cliente: o.op.cliente, Fecha: o.op.fecha,
    'status guardado': o.op.status, 'statusNombre guardado': o.op.statusNombre,
    'Status del catálogo': '', 'Id del catálogo': '', 'Cómo se encontró': '', Motivo: o.motivo,
  })),
];

/** RESPALDO: lo que cada operación tenía antes. */
export const respaldoD3 = (plan: PlanD3, cuando: string, quien: string): Datos => ({
  tipo: 'respaldo-corregir-status-D3', generado: cuando, por: quien,
  nota: 'Para deshacer: en cada operación, status y statusNombre con los valores de "antes" y quitar statusCorregidoPorRevision.',
  operaciones: plan.corregir.map((c) => ({
    id: c.op.opId, ref: c.op.ref, cliente: c.op.cliente,
    antes: { status: c.op.status, statusNombre: c.op.statusNombre },
    despues: { status: c.destino.id, statusNombre: c.destino.nombre },
  })),
});

/** Motivo por el que ya no se corrige al escribir ('' = se corrige). */
export const motivoAlCorregir = (op: Datos | null, statusCat: Datos | null, c: CambioD3): string => {
  if (!op) return 'La operación ya no existe';
  if (txt(op.status) !== c.op.status || txt(op.statusNombre) !== c.op.statusNombre) return 'Cambió de status desde la revisión (se dejó como está)';
  if (!statusCat) return 'Ese status ya no está en el catálogo';
  return '';
};

export interface ResultadoD3 {
  corregidas: number;
  /** Las que sí se corrigieron, con lo que se les escribió (para quitarlas de la revisión sin volver a leer). */
  cambios: Map<string, Datos>;
  omitidas: OmitidaD3[];
  error: string;
}

/** Aplica el plan en tandas (transacción por tanda). `alAvanzar(hechas, total)`. */
export const aplicarStatusD3 = async (plan: PlanD3, cuando: string, alAvanzar: (hechas: number, total: number) => void): Promise<ResultadoD3> => {
  const total = plan.corregir.length;
  const omitidas: OmitidaD3[] = [];
  const cambios = new Map<string, Datos>();
  let error = '';
  alAvanzar(0, total);
  for (let i = 0; i < total && !error; i += TANDA) {
    const tanda = plan.corregir.slice(i, i + TANDA);
    const r = await runTransaction(db, async (tx) => {
      const refsOps = tanda.map((c) => doc(db, 'operaciones', c.op.opId));
      const idsCat = Array.from(new Set(tanda.map((c) => c.destino.docId)));
      const refsCat = new Map<string, DocumentReference>(idsCat.map((id) => [id, doc(db, 'catalogo_status_servicio', id)]));
      const [sOps, sCat] = await Promise.all([
        Promise.all(refsOps.map((ref) => tx.get(ref))),
        Promise.all(idsCat.map((id) => tx.get(refsCat.get(id) as DocumentReference))),
      ]);
      const catPorId = new Map<string, DocumentSnapshot>(idsCat.map((id, k) => [id, sCat[k]]));
      const fuera: OmitidaD3[] = [];
      const hechos: [string, Datos][] = [];
      tanda.forEach((c, k) => {
        const so = sOps[k];
        const sc = catPorId.get(c.destino.docId);
        const datosCat = sc?.exists() ? (sc.data() as Datos) : null;
        const motivo = motivoAlCorregir(so.exists() ? (so.data() as Datos) : null, datosCat, c);
        if (motivo) { fuera.push({ op: c.op, motivo }); return; }
        // El nombre ACTUAL del catálogo (por si cambió desde la prueba).
        const campos = camposStatus({ ...c.destino, nombre: txt(datosCat?.nombre) || c.destino.nombre }, cuando);
        tx.update(refsOps[k], campos);
        hechos.push([c.op.opId, campos]);
      });
      return { fuera, hechos };
    }).catch((e: unknown) => {
      console.error('[D3] No se pudo escribir una tanda de operaciones:', e);
      error = String((e as { message?: string })?.message || e);
      return null;
    });
    if (!r) break;
    r.hechos.forEach(([id, campos]) => cambios.set(id, campos));
    omitidas.push(...r.fuera);
    alAvanzar(Math.min(i + TANDA, total), total);
  }
  if (cambios.size > 0) {
    await registrarLog('Operaciones', 'Edición',
      `Revisión de datos (D3): corrigió el status de ${cambios.size} operación(es) con el status del catálogo (statusCorregidoPorRevision = ${cuando}). ${plan.omitidas.length + omitidas.length} no se corrigieron (${plan.omitidas.length} para revisar a mano, ${omitidas.length} cambiaron desde la revisión).${error ? ` Se detuvo por un error: ${error}` : ''}`);
  }
  return { corregidas: cambios.size, cambios, omitidas, error };
};

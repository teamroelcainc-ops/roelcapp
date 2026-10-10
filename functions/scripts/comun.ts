/**
 * ✅ V00441 — Utilidades comunes de los scripts de servidor (migración y
 * reconciliación): argumentos, recorrido paginado, escritor con precondición y
 * reportes CSV. Los scripts corren en la máquina de Omaf con credenciales de
 * Google (nunca se suben llaves al repo) o contra el emulador.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldPath, getFirestore } from 'firebase-admin/firestore';
import type { BulkWriter, DocumentData, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

export type Datos = Record<string, unknown>;
export const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
export const mostrar = (v: unknown): string => (typeof v === 'object' && v !== null ? JSON.stringify(v) : txt(v));

export interface Argumentos {
  aplicar: boolean;
  solo: string | undefined;
  limite: number;
  proyecto: string;
  enEmulador: boolean;
  tiene: (bandera: string) => boolean;
}

/** Lee y valida los argumentos comunes (`--aplicar`, `--solo`, `--limite`, `--proyecto`, `--confirmo-respaldo`). */
export const leerArgumentos = (validasSolo: readonly string[], puntoParada: string): Argumentos => {
  const args = process.argv.slice(2);
  const opcion = (nombre: string): string | undefined => {
    const i = args.indexOf(nombre);
    if (i < 0) return undefined;
    const v = args[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`Falta el valor de ${nombre}`);
    return v;
  };
  const solo = opcion('--solo');
  const limite = opcion('--limite') === undefined ? Infinity : Number(opcion('--limite'));
  const aplicar = args.includes('--aplicar');
  const enEmulador = !!process.env.FIRESTORE_EMULATOR_HOST;
  if (solo !== undefined && !validasSolo.includes(solo)) throw new Error(`--solo debe ser una de: ${validasSolo.join(', ')}`);
  if (!(limite > 0)) throw new Error('--limite debe ser un número mayor que 0');
  if (aplicar && !enEmulador && !args.includes('--confirmo-respaldo')) {
    throw new Error(`Para escribir en PRODUCCIÓN agrega --confirmo-respaldo (punto de parada ${puntoParada}: simulación revisada y export de respaldo hecho).`);
  }
  return { aplicar, solo, limite, proyecto: opcion('--proyecto') ?? process.env.GCLOUD_PROJECT ?? 'roelcaapp', enEmulador, tiene: (b) => args.includes(b) };
};

export const firestoreDe = (a: Argumentos): Firestore => {
  if (getApps().length === 0) initializeApp({ projectId: a.proyecto });
  return getFirestore();
};

export const destinoDe = (a: Argumentos): string =>
  (a.enEmulador ? `EMULADOR ${process.env.FIRESTORE_EMULATOR_HOST}` : `PRODUCCIÓN (${a.proyecto})`);

/** Reporte: varias tablas CSV + un resumen de conteos. */
export class Reporte {
  private readonly tablas = new Map<string, unknown[][]>();
  readonly resumen: Record<string, Record<string, number>> = {};

  constructor(private readonly prefijo: string) {}

  tabla(nombre: string, encabezado: readonly string[]): unknown[][] {
    let t = this.tablas.get(nombre);
    if (!t) { t = [[...encabezado]]; this.tablas.set(nombre, t); }
    return t;
  }

  contar(grupo: string, clave: string, n = 1): void {
    this.resumen[grupo] ??= {};
    this.resumen[grupo][clave] = (this.resumen[grupo][clave] ?? 0) + n;
  }

  /** Escribe los archivos y devuelve la carpeta. Las tablas sin filas no se escriben (salvo `siempre`). */
  escribir(extra: Datos, siempre: readonly string[]): string {
    const sello = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = resolve(process.env.REPORTES_MIGRACION ?? resolve(process.cwd(), 'reportes'), `${this.prefijo}-${sello}`);
    mkdirSync(dir, { recursive: true });
    const csv = (filas: readonly (readonly unknown[])[]): string =>
      filas.map((f) => f.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';
    writeFileSync(join(dir, 'resumen.json'), JSON.stringify({ ...extra, resumen: this.resumen }, null, 2));
    this.tablas.forEach((filas, nombre) => { if (filas.length > 1 || siempre.includes(nombre)) writeFileSync(join(dir, `${nombre}.csv`), csv(filas)); });
    siempre.forEach((nombre) => { if (!this.tablas.has(nombre)) writeFileSync(join(dir, `${nombre}.csv`), ''); });
    return dir;
  }
}

/** BulkWriter que anota en el reporte solo el error FINAL de cada documento (null en simulación). */
export const escritorDe = (db: Firestore, a: Argumentos, reporte: Reporte): BulkWriter | null => {
  if (!a.aplicar) return null;
  const escritor = db.bulkWriter();
  const errores = reporte.tabla('errores', ['coleccion', 'docId', 'error']);
  escritor.onWriteError((err) => {
    // Precondición fallida (9) = el documento cambió mientras corría: no se
    // reintenta (la siguiente corrida lo recoge).
    const reintentar = err.code !== 9 && err.failedAttempts < 5;
    if (!reintentar) errores.push([err.documentRef.parent.id, err.documentRef.id, err.message]);
    return reintentar;
  });
  return escritor;
};

/** Recorre una colección paginando por documentId (500 por página) hasta `limite`. */
export const recorrer = async (
  db: Firestore, col: string, limite: number, cadaDoc: (d: QueryDocumentSnapshot<DocumentData>) => Promise<void> | void,
): Promise<number> => {
  const PAGINA = 500;
  let ultimo: QueryDocumentSnapshot<DocumentData> | null = null;
  let n = 0;
  for (;;) {
    let q = db.collection(col).orderBy(FieldPath.documentId()).limit(PAGINA);
    if (ultimo) q = q.startAfter(ultimo);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      if (n >= limite) return n;
      await cadaDoc(d);
      n += 1;
    }
    ultimo = snap.docs[snap.docs.length - 1];
    process.stdout.write(`\r[${col}] ${n} documentos revisados…`);
    if (snap.size < PAGINA) break;
  }
  process.stdout.write('\n');
  return n;
};

/**
 * ✅ V00440 (Fase 4.3) — MIGRACIÓN AL ESQUEMA CANÓNICO v2.
 * ------------------------------------------------------------------------------
 * Escribe los campos canónicos JUNTO a los legados (no borra nada):
 *   · operaciones: fechaServicioISO, *Id, estadoGrupo, empresasIds, porFacturar*,
 *     *Centavos, monedas, esPrueba, esquemaVersion (+ Carga/Vacía, Aduana y
 *     Expo/Impo derivados del convenio, igual que el trigger operacionEscrita).
 *   · pagos: empresaId (de entidadId / clienteId / proveedorId). El `tipo` no se
 *     inventa: los pagos sin tipo se reportan.
 *   · referencias_nomina: fechaPagoISO (AAAA-MM-DD, junto a fechaPago, que no se
 *     toca) y operadorId desde el nombre.
 *   · referencias_diesel: unidadId y operadorId desde el nombre.
 *
 * Idempotente (solo escribe lo que difiere; se puede correr varias veces),
 * paginada por documentId, con BulkWriter y precondición lastUpdateTime (si un
 * documento cambia mientras corre, no se pisa: se reporta y se recoge en la
 * siguiente corrida).
 *
 * ⛔ PUNTO DE PARADA P2: en producción se corre primero SIN --aplicar, se revisan
 *    los reportes y se confirma el export de respaldo (PLAN-REFACTOR.md).
 *
 * Uso (desde functions/, con credenciales: `gcloud auth application-default login`
 * o GOOGLE_APPLICATION_CREDENTIALS=<llave de cuenta de servicio, fuera del repo>):
 *   npm run migrar:v2                                       → simulación (no escribe), reportes
 *   npm run migrar:v2 -- --aplicar --confirmo-respaldo      → escribe en producción
 *   npm run migrar:v2 -- --solo operaciones                 → una colección (operaciones|pagos|nominas|diesel)
 *   npm run migrar:v2 -- --limite 200                       → solo los primeros N documentos (prueba)
 *   Emulador: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run migrar:v2 -- --aplicar
 *
 * Carga/Vacía, Aduana y Expo/Impo se derivan del convenio igual que el trigger
 * operacionEscrita (que lo haría de todos modos en cuanto la migración escribe).
 * Conviene encender `canonicosEnServidor` ANTES de migrar: así lo que se edite
 * durante y después de la migración queda al día; el trigger no deshace lo que
 * la migración resolvió (ver functions/src/canonico.ts).
 *
 * Reportes en functions/reportes/migracion-v2-<fecha-hora>/ (fuera de git):
 *   resumen.json · cambios.csv (qué campos cambian) · pendientes.csv (nombres que
 *   no se resolvieron a ID, homónimos, fechas inválidas) · avisos.csv (IDs que no
 *   existen o que son llaves de AppSheet) · paridad.csv (operaciones que las
 *   consultas nuevas clasificarían distinto que los filtros actuales) · errores.csv.
 * ------------------------------------------------------------------------------
 */
import type { DocumentData, Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { COL, STATUS_CANCELADO, STATUS_COMPLETADOS, STATUS_FINALES } from '../src/dominio/constantes.js';
import { aFechaServicioISO } from '../src/dominio/fechas.js';
import {
  camposCanonicos, crearIndice, derivarDesdeConvenio, diferenciasCanonicas, esOperacionPrueba, facturadaCliente,
} from '../src/dominio/operacionCanonica.js';
import type { Aviso, CatalogoNombres, ContextoCanonico, IndiceIds, Pendiente } from '../src/dominio/operacionCanonica.js';
import { normalizarTexto } from '../src/dominio/texto.js';
import { destinoDe, escritorDe, firestoreDe, leerArgumentos, mostrar, recorrer as recorrerCon, Reporte, txt } from './comun.js';
import type { Datos } from './comun.js';

// ── Argumentos y reportes ─────────────────────────────────────────────────
const ARGS = leerArgumentos(['operaciones', 'pagos', 'nominas', 'diesel'], 'P2');
const APLICAR = ARGS.aplicar;
const SOLO = ARGS.solo;
const reporte = new Reporte('migracion-v2');
const filasCambios = reporte.tabla('cambios', ['coleccion', 'docId', 'ref', 'campo', 'antes', 'despues']);
const filasPendientes = reporte.tabla('pendientes', ['coleccion', 'docId', 'ref', 'campo', 'valor', 'motivo']);
const filasAvisos = reporte.tabla('avisos', ['coleccion', 'docId', 'ref', 'campo', 'valor', 'motivo', 'detalle']);
const filasParidad = reporte.tabla('paridad', ['docId', 'ref', 'vista', 'filtroActual', 'consultaNueva', 'status', 'statusNombre']);
const contar = (col: string, clave: string, n = 1): void => reporte.contar(col, clave, n);
const recorrer = (db: Firestore, col: string, cadaDoc: (d: QueryDocumentSnapshot<DocumentData>) => Promise<void> | void) =>
  recorrerCon(db, col, ARGS.limite, cadaDoc);

// ── Contexto: índices de las colecciones maestras ────────────────────────
const nombreEmpleado = (e: Datos): string[] => {
  const p = [e.firstName, e.lastNamePaternal, e.lastNameMaternal].map(txt).filter(Boolean);
  return [p.join(' '), [txt(e.firstName), txt(e.lastNamePaternal)].filter(Boolean).join(' '), txt(e.nombre), txt(e.alias)];
};

/** Índice de una colección maestra (con la llave `id` de AppSheet guardada dentro, si la hay). */
const indiceDe = async (db: Firestore, col: string, nombres: (x: Datos) => unknown[]): Promise<IndiceIds> => {
  const snap = await db.collection(col).get();
  return crearIndice(snap.docs.map((d) => ({ id: d.id, nombres: nombres(d.data()), alias: d.data().id })));
};

const catalogoNombresDe = async (db: Firestore, col: string, campos: string[]): Promise<CatalogoNombres & { indice: IndiceIds; nombrePorId: Map<string, string> }> => {
  const snap = await db.collection(col).get();
  const porId = new Map<string, string>();
  const porNorm = new Map<string, string>();
  const docs: { id: string; nombres: string[] }[] = [];
  snap.docs.forEach((d) => {
    const x = d.data();
    const nombre = campos.map((c) => txt(x[c])).find(Boolean) ?? '';
    docs.push({ id: d.id, nombres: nombre ? [nombre] : [] });
    if (!nombre) return;
    porId.set(d.id, nombre);
    porNorm.set(normalizarTexto(nombre), nombre);
  });
  return { porId, porNorm, indice: crearIndice(docs), nombrePorId: porId };
};

// ── Migración ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const db = firestoreDe(ARGS);
  const escritor = escritorDe(db, ARGS, reporte);
  const destino = destinoDe(ARGS);
  console.log(`\nMigración esquema v2 → ${destino} · ${APLICAR ? '⚠ APLICANDO CAMBIOS' : 'simulación (no escribe)'}${SOLO ? ` · solo ${SOLO}` : ''}`);
  try {
    await migrar(db, escritor);
  } finally {
    // Los reportes se escriben aunque la corrida falle a la mitad.
    if (escritor) await escritor.close().catch(() => {});
    const dir = reporte.escribir({ destino, aplicado: APLICAR, solo: SOLO ?? 'todas', limite: Number.isFinite(ARGS.limite) ? ARGS.limite : null }, ['cambios', 'pendientes', 'avisos', 'paridad']);
    console.log(JSON.stringify(reporte.resumen, null, 2));
    console.log(`\nReportes en ${dir}`);
    if (!APLICAR) console.log('Simulación: no se escribió nada. Revisa los reportes y corre con --aplicar (punto de parada P2).');
  }
}

async function migrar(db: Firestore, escritor: ReturnType<Firestore['bulkWriter']> | null): Promise<void> {
  console.log('Cargando colecciones maestras…');

  const [empresas, empleados, unidades, status, convCli, convProv, cv, adu] = await Promise.all([
    indiceDe(db, COL.empresas, (x) => [x.nombre, x.razonSocial, x.nombreCorto]),
    indiceDe(db, COL.empleados, nombreEmpleado),
    indiceDe(db, 'unidades', (x) => [x.unidad, x.nombre, x.numeroEconomico, x.numeroUnidad]),
    catalogoNombresDe(db, COL.statusServicio, ['nombre', 'descripcion']),
    indiceDe(db, COL.conveniosClientesDetalles, () => []),
    indiceDe(db, COL.conveniosProveedoresDetalles, () => []),
    catalogoNombresDe(db, 'catalogo_carga_vacia', ['nombre', 'estado_carga']),
    catalogoNombresDe(db, 'catalogo_aduanas', ['aduana', 'nombre']),
  ]);
  const ctx: ContextoCanonico = {
    empresas, empleados, unidades, status: status.indice, conveniosCliente: convCli, conveniosProveedor: convProv,
    cargas: cv.indice, aduanas: adu.indice, nombreStatus: (id) => status.nombrePorId.get(id), incluirPropio: true,
  };

  const escribir = (d: QueryDocumentSnapshot<DocumentData>, cambios: Datos, ref: string): void => {
    const col = d.ref.parent.id;
    const llaves = Object.keys(cambios);
    if (llaves.length === 0) { contar(col, 'sinCambios'); return; }
    contar(col, 'conCambios');
    const x = d.data();
    for (const k of llaves) { filasCambios.push([col, d.id, ref, k, mostrar(x[k]), mostrar(cambios[k])]); contar(col, `campo:${k}`); }
    // El error ya lo anota onWriteError; sin este catch, Node cerraría el proceso.
    if (escritor) escritor.update(d.ref, cambios, { lastUpdateTime: d.updateTime }).catch(() => {});
  };
  const anotarPendientes = (col: string, d: QueryDocumentSnapshot<DocumentData>, ref: string, pendientes: readonly Pendiente[]): void => {
    for (const p of pendientes) { filasPendientes.push([col, d.id, ref, p.campo, p.valor, p.motivo]); contar(col, `pendiente:${p.campo}:${p.motivo}`); }
  };
  const anotarAvisos = (col: string, d: QueryDocumentSnapshot<DocumentData>, ref: string, avisos: readonly Aviso[]): void => {
    for (const a of avisos) { filasAvisos.push([col, d.id, ref, a.campo, a.valor, a.motivo, a.detalle ?? '']); contar(col, `aviso:${a.campo}:${a.motivo}`); }
  };

  // 1) Operaciones
  if (!SOLO || SOLO === 'operaciones') {
    // Operaciones que ya están dentro de una factura (para detectar "facturada sin vínculo").
    const enFacturaCliente = new Set<string>();
    const facs = await db.collection(COL.facturasClientes).select('operacionesIds').get();
    facs.docs.forEach((f) => { const ids = f.get('operacionesIds'); if (Array.isArray(ids)) ids.forEach((i) => enFacturaCliente.add(String(i))); });
    // ✅ V00448: lo mismo para Facturación Proveedores (fila de paridad propia).
    const enFacturaProveedor = new Set<string>();
    const facsProv = await db.collection(COL.facturasProveedores).select('operacionesIds').get();
    facsProv.docs.forEach((f) => { const ids = f.get('operacionesIds'); if (Array.isArray(ids)) ids.forEach((i) => enFacturaProveedor.add(String(i))); });

    const nombreFinal = (n: unknown): boolean => { const t = normalizarTexto(n); return t.includes('cancel') || t.includes('falso') || t.includes('complet'); };
    const n = await recorrer(db, COL.operaciones, (d) => {
      const x = d.data();
      const ref = txt(x.ref) || d.id;
      const derivados = derivarDesdeConvenio(x, cv, adu);
      const completo = { ...x, ...derivados };
      const r = camposCanonicos(completo, ctx);
      anotarPendientes(COL.operaciones, d, ref, r.pendientes);
      anotarAvisos(COL.operaciones, d, ref, r.avisos);
      escribir(d, { ...derivados, ...diferenciasCanonicas(x, r.campos) }, ref);

      // Paridad: filtros que usan hoy las pantallas vs. las consultas canónicas (Fase 7).
      const st = txt(x.status);
      const nomCat = status.nombrePorId.get(st);
      const g = r.campos.estadoGrupo;
      const activaHoy = !STATUS_FINALES.includes(st) && !nombreFinal(x.statusNombre) && !nombreFinal(nomCat);
      const completadosHoy = STATUS_COMPLETADOS.includes(st);
      const canceladosHoy = st === STATUS_CANCELADO;
      const facturableHoy = (STATUS_COMPLETADOS.includes(st) || /falso/i.test(normalizarTexto(nomCat))) && !esOperacionPrueba(x)
        && !(txt(x.facturaClienteId) || x.facturado === true) && !enFacturaCliente.has(d.id);
      // Regla de FacturacionProveedoresDashboard (texto en minúsculas, sin quitar acentos).
      const tipoOp = String(x.tipoOperacionNombre || x.tipoOperacionId || '').toLowerCase();
      const externoHoy = tipoOp.includes('flete')
        || ((tipoOp.includes('logistica') || tipoOp.includes('logística')) && !String(x.proveedorUnidadNombre || x.proveedorUnidad || '').toLowerCase().includes('roelca'));
      const facturableProvHoy = (STATUS_COMPLETADOS.includes(st) || /falso/i.test(normalizarTexto(nomCat))) && !esOperacionPrueba(x) && externoHoy
        && !(txt(x.facturaProveedorId) || x.facturadoProveedor) && !enFacturaProveedor.has(d.id);
      const vistas: [string, boolean, boolean][] = [
        ['Operaciones activas', activaHoy, g === 'activa'],
        ['Servicios completados', completadosHoy, g === 'completada' || g === 'falso'],
        ['Servicios cancelados', canceladosHoy, g === 'cancelada'],
        ['Facturación clientes (pendientes)', facturableHoy, r.campos.porFacturarCliente === true],
        ['Facturación proveedores (pendientes)', facturableProvHoy, r.campos.porFacturarProveedor === true],
      ];
      for (const [vista, hoy, nueva] of vistas) {
        if (hoy !== nueva) { filasParidad.push([d.id, ref, vista, hoy, nueva, st, txt(x.statusNombre)]); contar('paridad', vista); }
      }
      if (enFacturaCliente.has(d.id) && !facturadaCliente(x)) contar('paridad', 'En una factura sin facturaClienteId');
    });
    contar(COL.operaciones, 'revisados', n);
  }

  // 2) Pagos: empresaId canónico (el tipo no se inventa: sin tipo se reporta).
  if (!SOLO || SOLO === 'pagos') {
    const n = await recorrer(db, COL.pagos, (d) => {
      const x = d.data();
      const ref = txt(x.numeroPago) || d.id;
      const tipo = txt(x.tipo);
      // Mismo orden que PagosDashboard (entidadId de los pagos nuevos; clienteId/proveedorId de los viejos).
      const empresa = tipo === 'proveedor'
        ? txt(x.entidadId) || txt(x.proveedorId) || txt(x.clienteId)
        : txt(x.entidadId) || txt(x.clienteId) || txt(x.proveedorId);
      const cambios: Datos = {};
      if (empresa && txt(x.empresaId) !== empresa) cambios.empresaId = empresa;
      if (!empresa) anotarPendientes(COL.pagos, d, ref, [{ campo: 'empresaId', valor: txt(x.entidadNombre), motivo: 'sinCoincidencia' }]);
      else if (!empresas.ids.has(empresa)) anotarAvisos(COL.pagos, d, ref, [{ campo: 'empresaId', valor: empresa, motivo: empresas.alias?.has(empresa) ? 'aliasAppSheet' : 'idInexistente', detalle: empresas.alias?.get(empresa) }]);
      if (!tipo) anotarPendientes(COL.pagos, d, ref, [{ campo: 'tipo', valor: txt(x.clienteId) ? 'cliente?' : txt(x.proveedorId) ? 'proveedor?' : '', motivo: 'sinCoincidencia' }]);
      escribir(d, cambios, ref);
    });
    contar(COL.pagos, 'revisados', n);
  }

  // 3) Nóminas: fechaPagoISO (junto a fechaPago, que NO se toca) y operadorId.
  //    Sin fecha de pago legible se usa la fecha fin del periodo o la de creación,
  //    solo en el campo canónico (para ordenar y paginar), y se avisa.
  if (!SOLO || SOLO === 'nominas') {
    const n = await recorrer(db, COL.referenciasNomina, (d) => {
      const x = d.data();
      const ref = txt(x.consecutivo || x.folio) || d.id;
      const cambios: Datos = {};
      const deFin = aFechaServicioISO(x.fechaFin);
      const iso = aFechaServicioISO(x.fechaPago) ?? deFin ?? aFechaServicioISO(x.createdAt);
      if (iso && txt(x.fechaPagoISO) !== iso) cambios.fechaPagoISO = iso;
      if (!aFechaServicioISO(x.fechaPago)) {
        const motivo = txt(x.fechaPago) ? 'fechaInvalida' : 'fechaFaltante';
        if (iso) anotarAvisos(COL.referenciasNomina, d, ref, [{ campo: 'fechaPagoISO', valor: txt(x.fechaPago), motivo: 'fechaRespaldo', detalle: `${motivo}: se usó ${deFin ? 'fechaFin' : 'createdAt'} (${iso})` }]);
        else anotarPendientes(COL.referenciasNomina, d, ref, [{ campo: 'fechaPagoISO', valor: txt(x.fechaPago), motivo }]);
      }
      if (!txt(x.operadorId) && txt(x.operadorNombre)) {
        const id = empleados.porNombre.get(normalizarTexto(x.operadorNombre));
        if (typeof id === 'string') cambios.operadorId = id;
        else anotarPendientes(COL.referenciasNomina, d, ref, [{ campo: 'operadorId', valor: txt(x.operadorNombre), motivo: id === null ? 'ambiguo' : 'sinCoincidencia' }]);
      }
      escribir(d, cambios, ref);
    });
    contar(COL.referenciasNomina, 'revisados', n);
  }

  // 4) Diésel: unidadId y operadorId desde el nombre.
  if (!SOLO || SOLO === 'diesel') {
    const n = await recorrer(db, COL.referenciasDiesel, (d) => {
      const x = d.data();
      const ref = txt(x.consecutivo) || d.id;
      const cambios: Datos = {};
      const porNombre = (indice: IndiceIds, campoId: string, campoNombre: string): void => {
        if (txt(x[campoId]) || !txt(x[campoNombre]) || txt(x[campoNombre]) === 'Varios') return;
        const id = indice.porNombre.get(normalizarTexto(x[campoNombre]));
        if (typeof id === 'string') cambios[campoId] = id;
        else anotarPendientes(COL.referenciasDiesel, d, ref, [{ campo: campoId, valor: txt(x[campoNombre]), motivo: id === null ? 'ambiguo' : 'sinCoincidencia' }]);
      };
      porNombre(unidades, 'unidadId', 'unidadNombre');
      porNombre(empleados, 'operadorId', 'operadorNombre');
      escribir(d, cambios, ref);
    });
    contar(COL.referenciasDiesel, 'revisados', n);
  }

}

/** Promesa de la corrida (las pruebas la esperan). */
export const corrida = main().catch((e: unknown) => {
  console.error('La migración falló:', e);
  process.exitCode = 1;
});

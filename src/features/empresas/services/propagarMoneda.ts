// src/features/empresas/services/propagarMoneda.ts
// ---------------------------------------------------------------------------
// ✅ V00147: PROPAGAR LA MONEDA DE UNA EMPRESA A TODAS PARTES.
//   Fuente de la verdad: la colección `empresas`. Al ejecutarse, la moneda
//   actual de la empresa se aplica en cascada:
//   1) Convenios (clientes y proveedores) de esa empresa → monedaId/monedaNombre.
//   2) Operaciones: si la empresa es Cliente (Paga) → facturadoEnCobrar;
//      si es Proveedor de Transporte → facturadoEnUnidad.
//   3) Facturación: facturas_clientes / facturas_proveedores de la empresa →
//      moneda canónica (USD/MXN) + nombre + id — Pagos lee estas mismas facturas.
//   Solo escribe donde hay diferencia (batches de 400) y regresa el reporte.
// ✅ V00490: las operaciones ya no se escriben en lote con solo "Facturado en": cada una se corrige en
//   transacción con la misma regla que Operaciones → Corregir monedas (Facturado en + la copia de su
//   nombre + Subtotal, Dólares, Pesos y Conversión recalculados; el precio del convenio se queda en su
//   moneda). Antes cambiaba el ID y dejaba los montos y el nombre copiado de antes: la operación quedaba
//   con "Facturado en" en dos monedas. Las que no tienen de dónde saber la moneda del convenio no se
//   tocan y se cuentan en opsSinTocar.
// ---------------------------------------------------------------------------
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { idReal, obtenerCatalogo } from '../../../shared/data/catalogos';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import type { Lado } from '../../../shared/dominio/dinero';
import { monedaCanonica, nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { revisarOperacion } from '../../operaciones/services/corregirMonedaConvenio';
import type { CatalogoConvenios } from '../../operaciones/services/corregirMonedaConvenio';
import { corregirOperacion, leerConvenios } from '../../operaciones/services/corregirMonedaConvenioDatos';

export interface ReporteMoneda {
  monedaNombre: string;
  canon: 'USD' | 'MXN' | '';
  conveniosClientes: number;
  conveniosProveedores: number;
  opsCliente: number;
  opsProveedor: number;
  /** ✅ V00490: operaciones de la empresa con otra moneda que no se tocaron (sin moneda del convenio conocida o con error). */
  opsSinTocar: number;
  facturasClientes: number;
  facturasProveedores: number;
  /** ✅ V00490: pagos de la empresa con otra moneda (solo la etiqueta; el monto no se toca). */
  pagos: number;
}

export const propagarMonedaEmpresa = async (empresaId: string): Promise<ReporteMoneda> => {
  // 1) Moneda actual de la empresa (fuente de la verdad) + catálogo.
  // ✅ V00439 (Fase 3.x): el catálogo de monedas sale del listener compartido.
  const [snapE, catMonedas] = await Promise.all([
    getDoc(doc(db, 'empresas', empresaId)),
    obtenerCatalogo('catalogo_moneda'),
  ]);
  if (!snapE.exists()) throw new Error('No se encontró la empresa.');
  const emp: any = snapE.data();
  const monedas = catMonedas.map((d) => ({ id: idReal(d), moneda: String(d.moneda || '') }));

  const crudo = String(emp.monedaId || emp.moneda || emp.monedaNombre || '').trim();
  let monId = '';
  let monNom = '';
  const porId = monedas.find((m) => m.id === crudo);
  if (porId) { monId = porId.id; monNom = porId.moneda; }
  else {
    const up = crudo.toUpperCase();
    const porNombre = monedas.find((m) => m.moneda.toUpperCase() === up || (up && (m.moneda.toUpperCase().includes(up) || up.includes(m.moneda.toUpperCase()))));
    if (porNombre) { monId = porNombre.id; monNom = porNombre.moneda; }
    else if (monedaCanonica(crudo) === 'USD') { monId = ID_USD; monNom = 'Dólares'; }
    else if (monedaCanonica(crudo) === 'MXN') { monId = ID_MXN; monNom = 'Pesos'; }
  }
  if (!monId) throw new Error('La empresa no tiene moneda registrada en la tabla Empresas (o no coincide con el catálogo de Monedas).');
  // ✅ V00439 (Fase 3.x): moneda canónica con el helper compartido (antes una copia local).
  // ✅ V00490: también por el ID del catálogo (si el nombre del catálogo viene vacío no se perdía solo la
  //   moneda canónica: se saltaban las operaciones y las facturas quedaban con el nombre vacío).
  const canon: 'USD' | 'MXN' | '' = monedaCanonica(monNom) ?? monedaCanonica(monId) ?? '';
  if (!monNom && canon) monNom = nombreMoneda(canon);

  const rep: ReporteMoneda = { monedaNombre: monNom, canon, conveniosClientes: 0, conveniosProveedores: 0, opsCliente: 0, opsProveedor: 0, opsSinTocar: 0, facturasClientes: 0, facturasProveedores: 0, pagos: 0 };

  let batch = writeBatch(db);
  let enBatch = 0;
  const flush = async () => { if (enBatch > 0) { await batch.commit(); batch = writeBatch(db); enBatch = 0; } };
  const marcar = (ref: any, cambios: Record<string, any>) => { batch.set(ref, cambios, { merge: true }); enBatch++; };

  // 2) Convenios maestros de la empresa.
  const pasos: Array<{ col: string; campo: string; cambios: Record<string, any>; distinto: (x: any) => boolean; cuenta: keyof ReporteMoneda }> = [
    { col: 'convenios_clientes', campo: 'clienteId', cambios: { monedaId: monId, monedaNombre: monNom }, distinto: (x) => String(x.monedaId || '') !== monId || String(x.monedaNombre || '') !== monNom, cuenta: 'conveniosClientes' },
    { col: 'convenios_proveedores', campo: 'proveedorId', cambios: { monedaId: monId, monedaNombre: monNom }, distinto: (x) => String(x.monedaId || '') !== monId || String(x.monedaNombre || '') !== monNom, cuenta: 'conveniosProveedores' },
    // 3) Operaciones: abajo, una por una en transacción (✅ V00490).
    // 4) Facturación (las mismas facturas que consume Pagos).
    { col: 'facturas_clientes', campo: 'clienteId', cambios: { monedaFacturacion: monNom, monedaId: monId, ...(canon ? { moneda: canon } : {}) }, distinto: (x) => String(x.monedaId || '') !== monId || (canon ? String(x.moneda || '') !== canon : false), cuenta: 'facturasClientes' },
    { col: 'facturas_proveedores', campo: 'proveedorId', cambios: { monedaProveedor: monNom, monedaId: monId, ...(canon ? { moneda: canon } : {}) }, distinto: (x) => String(x.monedaId || '') !== monId || (canon ? String(x.moneda || '') !== canon : false), cuenta: 'facturasProveedores' },
    // 5) ✅ V00490: Pagos (cliente o proveedor): la moneda del pago es la de la empresa (sus facturas ya lo son).
    ...(canon ? [{ col: 'pagos', campo: 'entidadId', cambios: { moneda: canon }, distinto: (x: Record<string, unknown>) => monedaCanonica(x.moneda) !== canon, cuenta: 'pagos' as const }] : []),
  ];

  for (const p of pasos) {
    const snap = await getDocs(query(collection(db, p.col), where(p.campo, '==', empresaId)));
    for (const d of snap.docs) {
      if (!p.distinto(d.data())) continue;
      marcar(d.ref, p.cambios);
      (rep[p.cuenta] as number)++;
      if (enBatch >= 400) await flush();
    }
  }
  await flush();
  if (canon) await corregirOperacionesDeEmpresa(empresaId, canon, rep);
  return rep;
};

const HILOS = 4;

/**
 * ✅ V00490: operaciones donde la empresa es Cliente (Paga) o Proveedor de Transporte → ese lado con
 * la moneda de la empresa (revisarOperacion + corregirOperacion, solo ese lado). La moneda de esta
 * empresa es la que se acaba de leer (el catálogo puede no traer aún un cambio recién guardado).
 */
const corregirOperacionesDeEmpresa = async (empresaId: string, moneda: Moneda, rep: ReporteMoneda): Promise<void> => {
  const base = await leerConvenios();
  const soloEsta = new Map<string, Moneda>([[empresaId, moneda]]);
  const cat: CatalogoConvenios = { cliente: { ...base.cliente, monedaEmpresa: soloEsta }, proveedor: { ...base.proveedor, monedaEmpresa: soloEsta } };
  const ladoCampo: Array<[Lado, string, 'opsCliente' | 'opsProveedor']> = [['cliente', 'clientePaga', 'opsCliente'], ['proveedor', 'proveedorUnidad', 'opsProveedor']];
  for (const [lado, campo, cuenta] of ladoCampo) {
    const snap = await getDocs(query(collection(db, 'operaciones'), where(campo, '==', empresaId)));
    const pendientes: string[] = [];
    snap.docs.forEach((d) => {
      const r = revisarOperacion(d.id, d.data(), cat, [lado]);
      if (r?.estado === 'corregir') pendientes.push(d.id);
      else if (r) rep.opsSinTocar += 1;
    });
    let siguiente = 0;
    const trabajar = async () => {
      while (siguiente < pendientes.length) {
        const id = pendientes[siguiente++];
        try {
          const res = await corregirOperacion(id, cat, [lado]);
          if (res.tipo === 'corregida') rep[cuenta] += 1;
        } catch (e) {
          console.error(`No se pudo corregir la moneda de la operación ${id}:`, e);
          rep.opsSinTocar += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: HILOS }, trabajar));
  }
};

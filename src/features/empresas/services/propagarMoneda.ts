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
// ---------------------------------------------------------------------------
import { collection, doc, getDoc, getDocs, query, where, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { idReal, obtenerCatalogo } from '../../../shared/data/catalogos';
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';
import { monedaCanonica } from '../../../shared/dominio/moneda';

export interface ReporteMoneda {
  monedaNombre: string;
  canon: 'USD' | 'MXN' | '';
  conveniosClientes: number;
  conveniosProveedores: number;
  opsCliente: number;
  opsProveedor: number;
  facturasClientes: number;
  facturasProveedores: number;
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
  const canon: 'USD' | 'MXN' | '' = monedaCanonica(monNom) ?? '';

  const rep: ReporteMoneda = { monedaNombre: monNom, canon, conveniosClientes: 0, conveniosProveedores: 0, opsCliente: 0, opsProveedor: 0, facturasClientes: 0, facturasProveedores: 0 };

  let batch = writeBatch(db);
  let enBatch = 0;
  const flush = async () => { if (enBatch > 0) { await batch.commit(); batch = writeBatch(db); enBatch = 0; } };
  const marcar = (ref: any, cambios: Record<string, any>) => { batch.set(ref, cambios, { merge: true }); enBatch++; };

  // 2) Convenios maestros de la empresa.
  const pasos: Array<{ col: string; campo: string; cambios: Record<string, any>; distinto: (x: any) => boolean; cuenta: keyof ReporteMoneda }> = [
    { col: 'convenios_clientes', campo: 'clienteId', cambios: { monedaId: monId, monedaNombre: monNom }, distinto: (x) => String(x.monedaId || '') !== monId || String(x.monedaNombre || '') !== monNom, cuenta: 'conveniosClientes' },
    { col: 'convenios_proveedores', campo: 'proveedorId', cambios: { monedaId: monId, monedaNombre: monNom }, distinto: (x) => String(x.monedaId || '') !== monId || String(x.monedaNombre || '') !== monNom, cuenta: 'conveniosProveedores' },
    // 3) Operaciones: lado cliente y lado proveedor.
    { col: 'operaciones', campo: 'clientePaga', cambios: { facturadoEnCobrar: monId }, distinto: (x) => String(x.facturadoEnCobrar || '') !== monId, cuenta: 'opsCliente' },
    { col: 'operaciones', campo: 'proveedorUnidad', cambios: { facturadoEnUnidad: monId }, distinto: (x) => String(x.facturadoEnUnidad || '') !== monId, cuenta: 'opsProveedor' },
    // 4) Facturación (las mismas facturas que consume Pagos).
    { col: 'facturas_clientes', campo: 'clienteId', cambios: { monedaFacturacion: monNom, monedaId: monId, ...(canon ? { moneda: canon } : {}) }, distinto: (x) => String(x.monedaId || '') !== monId || (canon ? String(x.moneda || '') !== canon : false), cuenta: 'facturasClientes' },
    { col: 'facturas_proveedores', campo: 'proveedorId', cambios: { monedaProveedor: monNom, monedaId: monId, ...(canon ? { moneda: canon } : {}) }, distinto: (x) => String(x.monedaId || '') !== monId || (canon ? String(x.moneda || '') !== canon : false), cuenta: 'facturasProveedores' },
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
  return rep;
};

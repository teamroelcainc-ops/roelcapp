// ✅ V00342: SINCRONIZAR LA RAZÓN SOCIAL en toda la cadena.
//   Recorre las empresas y escribe su nombre (razón social) DESNORMALIZADO en
//   operaciones, facturación y pagos, para que todos los registros muestren el
//   nombre actual y no el ID ni un nombre viejo.
import { collection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../../../config/firebase';

export const sincronizarRazonSocial = async (): Promise<string> => {
  const empSnap = await getDocs(collection(db, 'empresas'));
  const nombreDe = new Map<string, string>();
  empSnap.docs.forEach((d) => {
    const x = d.data() as Record<string, unknown>;
    const nom = String(x.razonSocial || x.nombre || '').trim();
    if (nom) nombreDe.set(d.id, nom);
  });

  let pendientes: { col: string; id: string; data: Record<string, string> }[] = [];
  const revisar = (col: string, id: string, data: Record<string, unknown>, pares: [string, string][]) => {
    const cambios: Record<string, string> = {};
    pares.forEach(([campoId, campoNombre]) => {
      const eid = String(data[campoId] || '');
      if (!eid) return;
      const nom = nombreDe.get(eid);
      if (nom && String(data[campoNombre] || '') !== nom) cambios[campoNombre] = nom;
    });
    if (Object.keys(cambios).length > 0) pendientes.push({ col, id, data: cambios });
  };

  const ops = await getDocs(collection(db, 'operaciones'));
  ops.docs.forEach((d) => revisar('operaciones', d.id, d.data() as Record<string, unknown>, [
    ['clientePaga', 'clientePagaNombre'],
    ['clientePaga', 'clienteNombre'], // ✅ V00343: el campo que pintan Completados/Cancelados
    ['clienteMercancia', 'clienteMercanciaNombre'],
    ['proveedorUnidad', 'proveedorUnidadNombre'],
  ]));
  const fc = await getDocs(collection(db, 'facturas_clientes'));
  fc.docs.forEach((d) => revisar('facturas_clientes', d.id, d.data() as Record<string, unknown>, [
    ['clienteId', 'clienteNombre'],
  ]));
  const fp = await getDocs(collection(db, 'facturas_proveedores'));
  fp.docs.forEach((d) => revisar('facturas_proveedores', d.id, d.data() as Record<string, unknown>, [
    ['proveedorId', 'proveedorNombre'],
  ]));
  const pg = await getDocs(collection(db, 'pagos'));
  pg.docs.forEach((d) => revisar('pagos', d.id, d.data() as Record<string, unknown>, [
    ['clienteId', 'clienteNombre'],
    ['proveedorId', 'proveedorNombre'],
    ['entidadId', 'entidadNombre'],
  ]));

  const total = pendientes.length;
  while (pendientes.length > 0) {
    const lote = pendientes.slice(0, 450);
    pendientes = pendientes.slice(450);
    const batch = writeBatch(db);
    lote.forEach((p) => batch.update(doc(db, p.col, p.id), p.data));
    await batch.commit();
  }
  return `Razón social sincronizada: ${total} registro(s) actualizados (operaciones, facturación y pagos) de ${nombreDe.size} empresas.`;
};

// ✅ V00346: quitar el prefijo "CONV-" de TODOS los convenios ya registrados.
//   Recorre los consecutivos de los detalles (clientes y proveedores), el
//   número de los convenios maestros y los nombres desnormalizados guardados
//   en las operaciones, y les quita el prefijo — los números se conservan.
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../../config/firebase';

const limpiar = (v: unknown): string => String(v ?? '').replace(/^\s*CONV[-\s]+/i, '').trimStart();
const tienePrefijo = (v: unknown): boolean => /^\s*CONV[-\s]+/i.test(String(v ?? ''));

export const quitarPrefijoConv = async (): Promise<string> => {
  let pendientes: { col: string; id: string; data: Record<string, string> }[] = [];

  const revisar = (col: string, id: string, data: Record<string, unknown>, campos: string[]) => {
    const cambios: Record<string, string> = {};
    campos.forEach((campo) => { if (tienePrefijo(data[campo])) cambios[campo] = limpiar(data[campo]); });
    if (Object.keys(cambios).length > 0) pendientes.push({ col, id, data: cambios });
  };

  const [detCli, detProv, cli, prov, ops] = await Promise.all([
    getDocs(collection(db, 'convenios_clientes_detalles')),
    getDocs(collection(db, 'convenios_proveedores_detalles')),
    getDocs(collection(db, 'convenios_clientes')),
    getDocs(collection(db, 'convenios_proveedores')),
    getDocs(collection(db, 'operaciones')),
  ]);
  detCli.docs.forEach((d) => revisar('convenios_clientes_detalles', d.id, d.data() as Record<string, unknown>, ['consecutivo']));
  detProv.docs.forEach((d) => revisar('convenios_proveedores_detalles', d.id, d.data() as Record<string, unknown>, ['consecutivo']));
  cli.docs.forEach((d) => revisar('convenios_clientes', d.id, d.data() as Record<string, unknown>, ['numeroConvenio']));
  prov.docs.forEach((d) => revisar('convenios_proveedores', d.id, d.data() as Record<string, unknown>, ['numeroConvenio']));
  ops.docs.forEach((d) => revisar('operaciones', d.id, d.data() as Record<string, unknown>, ['convenioNombre', 'convenioProveedorNombre', 'tipoConvenioNombre']));

  const total = pendientes.length;
  while (pendientes.length > 0) {
    const lote = pendientes.slice(0, 450);
    pendientes = pendientes.slice(450);
    const batch = writeBatch(db);
    lote.forEach((p) => batch.update(doc(db, p.col, p.id), p.data));
    await batch.commit();
  }
  return `Prefijo CONV- eliminado en ${total} registro(s): detalles de convenios (clientes y proveedores), convenios maestros y operaciones. Los números se conservaron.`;
};

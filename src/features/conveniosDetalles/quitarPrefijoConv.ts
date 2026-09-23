// ✅ V00346: quitar el prefijo "CONV-" de TODOS los convenios ya registrados.
//   Recorre los consecutivos de los detalles (clientes y proveedores), el
//   número de los convenios maestros y los nombres desnormalizados guardados
//   en las operaciones, y les quita el prefijo — los números se conservan.
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from '../../config/firebase';

const limpiar = (v: unknown): string => String(v ?? '').replace(/^\s*CONV[-\s]+/i, '').trimStart();
const tienePrefijo = (v: unknown): boolean => /^\s*CONV[-\s]+/i.test(String(v ?? ''));

// ✅ V00347: en los NOMBRES (descripciones) tampoco debe quedar prefijo alguno —
//   ni CONV-/TARI-/TARP- ni el número consecutivo suelto ("285 - Cruce…").
//   Se aplica repetidamente por si vienen encadenados ("CONV-285 - 285 - …").
const RE_PREFIJO_NOMBRE = /^\s*(?:(?:CONV|TARI|TARP)[-\s]*)?\d{1,5}\s*-\s*/i;
const limpiarNombre = (v: unknown): string => {
  let t = String(v ?? '');
  let previo = '';
  while (t !== previo && RE_PREFIJO_NOMBRE.test(t)) { previo = t; t = t.replace(RE_PREFIJO_NOMBRE, ''); }
  t = t.replace(/^\s*(?:CONV|TARI|TARP)[-\s]+/i, '').trimStart();
  return t;
};
const nombreConPrefijo = (v: unknown): boolean => {
  const t = String(v ?? '');
  if (!t.trim()) return false;
  const limpio = limpiarNombre(t);
  return limpio !== t && limpio.trim().length > 0; // nunca vaciar un nombre
};

export const quitarPrefijoConv = async (): Promise<string> => {
  let pendientes: { col: string; id: string; data: Record<string, string> }[] = [];

  const revisar = (col: string, id: string, data: Record<string, unknown>, campos: string[]) => {
    const cambios: Record<string, string> = {};
    campos.forEach((campo) => { if (tienePrefijo(data[campo])) cambios[campo] = limpiar(data[campo]); });
    if (Object.keys(cambios).length > 0) pendientes.push({ col, id, data: cambios });
  };
  // ✅ V00347: para campos de NOMBRE — quita también el número inicial "### - ".
  const revisarNombres = (col: string, id: string, data: Record<string, unknown>, campos: string[]) => {
    const cambios: Record<string, string> = {};
    campos.forEach((campo) => { if (nombreConPrefijo(data[campo])) cambios[campo] = limpiarNombre(data[campo]); });
    if (Object.keys(cambios).length > 0) pendientes.push({ col, id, data: cambios });
  };

  const [detCli, detProv, cli, prov, ops] = await Promise.all([
    getDocs(collection(db, 'convenios_clientes_detalles')),
    getDocs(collection(db, 'convenios_proveedores_detalles')),
    getDocs(collection(db, 'convenios_clientes')),
    getDocs(collection(db, 'convenios_proveedores')),
    getDocs(collection(db, 'operaciones')),
  ]);
  detCli.docs.forEach((d) => { revisar('convenios_clientes_detalles', d.id, d.data() as Record<string, unknown>, ['consecutivo']); revisarNombres('convenios_clientes_detalles', d.id, d.data() as Record<string, unknown>, ['descripcionConvenio', 'tipoConvenioNombre']); });
  detProv.docs.forEach((d) => { revisar('convenios_proveedores_detalles', d.id, d.data() as Record<string, unknown>, ['consecutivo']); revisarNombres('convenios_proveedores_detalles', d.id, d.data() as Record<string, unknown>, ['descripcionConvenio', 'tipoConvenioNombre']); });
  cli.docs.forEach((d) => revisar('convenios_clientes', d.id, d.data() as Record<string, unknown>, ['numeroConvenio']));
  prov.docs.forEach((d) => revisar('convenios_proveedores', d.id, d.data() as Record<string, unknown>, ['numeroConvenio']));
  // ✅ V00347: en operaciones los tres campos son NOMBRES — sin CONV- ni "### -".
  ops.docs.forEach((d) => revisarNombres('operaciones', d.id, d.data() as Record<string, unknown>, ['convenioNombre', 'convenioProveedorNombre', 'tipoConvenioNombre']));

  // ✅ V00347: fusionar cambios del mismo documento (consecutivo + nombres).
  const porDoc = new Map<string, { col: string; id: string; data: Record<string, string> }>();
  pendientes.forEach((p) => {
    const k = `${p.col}__${p.id}`;
    const prev = porDoc.get(k);
    if (prev) Object.assign(prev.data, p.data); else porDoc.set(k, p);
  });
  pendientes = Array.from(porDoc.values());
  const total = pendientes.length;
  while (pendientes.length > 0) {
    const lote = pendientes.slice(0, 450);
    pendientes = pendientes.slice(450);
    const batch = writeBatch(db);
    lote.forEach((p) => batch.update(doc(db, p.col, p.id), p.data));
    await batch.commit();
  }
  return `Prefijos eliminados en ${total} registro(s): consecutivos sin CONV- y nombres sin número inicial (detalles de convenios, convenios maestros y operaciones).`;
};

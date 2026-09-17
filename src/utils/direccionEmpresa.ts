// src/utils/direccionEmpresa.ts
// ✅ V00281: DIRECCIÓN DE UNA EMPRESA PARA DOCUMENTOS — resuelta por la
//   RELACIÓN real (empresa.direccionId → catálogo `direcciones`), con
//   respaldo por texto y un mensaje claro cuando no hay nada cargado
//   (antes los documentos imprimían "undefined").
type Registro = Record<string, unknown>;

const t = (x: unknown): string => String(x ?? '').trim();

/** Dirección de facturación de la empresa en UNA línea, para documentos.
 *  Nunca devuelve "undefined": si no hay nada, "Sin dirección cargada". */
export const direccionCompletaDeEmpresa = (
  emp: Registro | null | undefined,
  listaDirecciones?: Registro[] | null,
): string => {
  if (!emp) return 'Sin dirección cargada';
  const lista = Array.isArray(listaDirecciones) ? listaDirecciones : [];
  // 1) La relación: direccionId → catálogo de direcciones.
  const porId = lista.find((d) => t(d.id) && t(d.id) === t(emp.direccionId));
  if (porId && t(porId.direccionCompleta)) return t(porId.direccionCompleta);
  // 2) Respaldo por texto guardado en la empresa.
  const texto = t(emp.direccion) || t(emp.direccionLabel) || t(emp.direccionCompleta);
  if (texto) return texto;
  // 3) Cualquier dirección ligada por tipo (V00268), como último recurso.
  const porTipo = Array.isArray(emp.direccionesPorTipo) ? (emp.direccionesPorTipo as Registro[]) : [];
  for (const dt of porTipo) {
    const d = lista.find((x) => t(x.id) && t(x.id) === t(dt?.direccionId));
    if (d && t(d.direccionCompleta)) return t(d.direccionCompleta);
    if (t(dt?.direccionNombre)) return t(dt.direccionNombre);
  }
  return 'Sin dirección cargada';
};

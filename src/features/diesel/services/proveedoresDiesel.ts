// src/features/diesel/services/proveedoresDiesel.ts
// ✅ V00457: proveedores de diesel (catálogo empresas) en un solo lugar. Los usan
//   Referencias del Diesel y el formulario "Agregar saldo de diesel", que ahora también
//   se abre desde la tarjeta Saldo Diesel de Operaciones Activas. Lógica pura.
import { TIPO_EMPRESA } from '../../../shared/dominio/constantes';

type Datos = Record<string, unknown>;

/** Tipo de servicio "Diesel" (campo tiposServicio de la empresa). */
export const TIPO_SERVICIO_DIESEL = '189a4573';

/**
 * ¿El campo contiene el ID? Acepta los formatos heredados: arreglo, texto
 * separado por comas o espacios, u objeto (por valor o por llave).
 */
export const incluyeId = (valor: unknown, id: string): boolean => {
  if (!valor) return false;
  if (Array.isArray(valor)) return valor.map(String).includes(id);
  if (typeof valor === 'string') return valor.split(/[,\s]+/).map((s) => s.trim()).includes(id);
  if (typeof valor === 'object') return Object.values(valor).map(String).includes(id) || Object.keys(valor).includes(id);
  return false;
};

/** Empresas que son proveedor de servicios Y dan servicio de diesel, en orden alfabético. */
export const proveedoresDeDiesel = <T extends Datos>(empresas: readonly T[]): T[] =>
  empresas
    .filter((p) => incluyeId(p.tiposEmpresa, TIPO_EMPRESA.proveedorServicios) && incluyeId(p.tiposServicio, TIPO_SERVICIO_DIESEL))
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));

/** Nombre del proveedor por ID (o por nombre); si no está en el catálogo, el valor tal cual. */
export const nombreProveedorDiesel = (empresas: readonly Datos[], idONombre: string): string => {
  if (!idONombre) return '-';
  const p = empresas.find((x) => x.id === idONombre || x.nombre === idONombre);
  return p ? String(p.nombre ?? idONombre) : idONombre;
};

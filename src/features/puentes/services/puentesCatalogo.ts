// src/features/puentes/services/puentesCatalogo.ts
// ✅ V00455: puentes del catálogo Tipos de Gastos (categoría "Puente") — una sola
//   regla para Referencias de Puentes y las tarjetas de Operaciones Activas
//   (nombre, moneda, orden y el puente que viene elegido al "Actualizar saldo").
//   Lógica pura: sin Firebase ni React.
import { ID_MXN, ID_USD } from '../../../shared/dominio/constantes';

type Datos = Record<string, unknown>;

const norm = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Nombre de un puente del catálogo (los registros viejos usan otros campos). */
export const nombrePuenteCatalogo = (c: Datos | null | undefined): string =>
  String(c?.nombre ?? c?.concepto ?? c?.tipo_gasto ?? c?.tipoGasto ?? c?.descripcion ?? c?.nombre_gasto ?? c?.id ?? '-');

/** ¿El tipo de gasto es un puente? (categoria_gasto contiene "puente"). */
export const esPuenteCatalogo = (c: Datos): boolean =>
  String(c.categoria_gasto ?? c.categoriaGasto ?? c.categoria ?? '').toLowerCase().includes('puente');

/** Moneda como la guarda el saldo del puente: "Dólares" / "Pesos" (otro valor, tal cual). */
export const monedaDePuente = (m: unknown): string => (String(m || '') === ID_USD ? 'Dólares' : String(m || '') === ID_MXN ? 'Pesos' : String(m || ''));

/** Puentes del catálogo, por nombre (mismo orden que el formulario de Referencias de Puentes). */
export const puentesDelCatalogo = <T extends Datos>(tipos: readonly T[]): T[] =>
  tipos.filter(esPuenteCatalogo).sort((a, b) => nombrePuenteCatalogo(a).localeCompare(nombrePuenteCatalogo(b), 'es', { sensitivity: 'base' }));

/** Tarjetas de puente de Operaciones Activas. */
export type TarjetaPuente = 'avi' | 'p3' | 'colombia';

// La caseta que viene elegida al presionar "Actualizar saldo" en cada tarjeta.
const CASETA_DE_TARJETA: Record<TarjetaPuente, string[]> = {
  avi: ['caseta avi'],
  p3: ['caseta puente iii', 'caseta puente 3'],
  colombia: ['caseta mx colombia'],
};

/** Id del puente que viene elegido para la tarjeta ('' si el catálogo no lo tiene). */
export const puentePredeterminado = (puentes: readonly Datos[], tarjeta: TarjetaPuente | undefined, idDe: (c: Datos) => string): string => {
  if (!tarjeta) return '';
  const nombres = CASETA_DE_TARJETA[tarjeta];
  for (const n of nombres) {
    const p = puentes.find((x) => norm(nombrePuenteCatalogo(x)) === n);
    if (p) return idDe(p);
  }
  return '';
};

/**
 * ✅ V00457: la caseta de los OTROS CRUCES (Referencias de Puentes): la misma que viene
 * elegida en la tarjeta AVI ("Caseta AVI"). Si el catálogo la nombra distinto, la caseta
 * AVI de nombre más corto sin contar lo que va entre paréntesis ("Caseta AVI (USD)" antes
 * que "Caseta AVI Auto" o "Caseta AVI Nissan…").
 */
export const casetaAviOtrosCruces = <T extends Datos>(puentes: readonly T[]): T | null => {
  const id = puentePredeterminado(puentes, 'avi', (p) => String(p.id));
  const exacta = id ? puentes.find((p) => String(p.id) === id) : undefined;
  if (exacta) return exacta;
  const base = (p: Datos) => norm(nombrePuenteCatalogo(p)).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const candidatas = puentes.filter((p) => base(p).includes('caseta') && /\bavi\b/.test(base(p)));
  return [...candidatas].sort((a, b) => base(a).length - base(b).length)[0] ?? null;
};

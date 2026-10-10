// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/moneda.ts — ✅ V00436: UNA sola forma de reconocer la moneda.
// Antes había 6 versiones de `esUSD` (por ID, por 'USD', por 'DOLAR', por
// 'Dólares'…) y una de ellas (Facturación Proveedores) fallaba con el nombre
// del catálogo. Esta acepta el ID del catálogo o cualquier texto conocido.
import { ID_MXN, ID_USD } from './constantes.js';
import { normalizarTexto } from './texto.js';

export type Moneda = 'USD' | 'MXN';

/**
 * Moneda canónica a partir del ID de catalogo_moneda, el código ('USD'/'MXN')
 * o el nombre ('Dólares', 'Pesos', 'DLS', 'M.N.'…). `null` si no se reconoce.
 */
export const monedaCanonica = (v: unknown): Moneda | null => {
  const crudo = String(v ?? '').trim();
  if (!crudo) return null;
  if (crudo === ID_USD) return 'USD';
  if (crudo === ID_MXN) return 'MXN';
  const t = normalizarTexto(crudo).replace(/\./g, '');
  if (!t || t === 'n/a') return null;
  if (t === 'usd' || t === 'us$' || t === 'dls' || t === 'dll' || t === 'dlls' || t.startsWith('dolar') || t.includes('usd')) return 'USD';
  if (t === 'mxn' || t === 'mn' || t === 'mxp' || t.startsWith('peso') || t.includes('mxn')) return 'MXN';
  return null;
};

export const esUSD = (v: unknown): boolean => monedaCanonica(v) === 'USD';
export const esMXN = (v: unknown): boolean => monedaCanonica(v) === 'MXN';

/** ID del catálogo para una moneda canónica. */
export const idMoneda = (m: Moneda): string => (m === 'USD' ? ID_USD : ID_MXN);

/** Nombre corto para mostrar ('Dólares' / 'Pesos'), igual que el catálogo. */
export const nombreMoneda = (m: Moneda | null): string => (m === 'USD' ? 'Dólares' : m === 'MXN' ? 'Pesos' : '');

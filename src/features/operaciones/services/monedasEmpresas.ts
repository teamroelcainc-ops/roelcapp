// src/features/operaciones/services/monedasEmpresas.ts
// ---------------------------------------------------------------------------
// ✅ V00503 — MONEDA DE CADA EMPRESA en Empresas, por id (antes privada en corregirMonedaConvenioDatos.ts;
// ahora también la usa la validación del Excel de operaciones). Misma lectura que Facturación
// (monedaDeEmpresa: `moneda`, `monedaId`, `monedaNombre`, `monedaRef` y el campo de su lado).
// ---------------------------------------------------------------------------
import { idReal, obtenerCatalogo } from '../../../shared/data/catalogos';
import type { DocCatalogo } from '../../../shared/data/catalogos';
import type { Moneda } from '../../../shared/dominio/moneda';
import { monedaDeEmpresa } from '../../facturacion/services/reglasFactura';

type Datos = Record<string, unknown>;

/** Campo de la moneda en Empresas según el lado: lo que factura el cliente / lo que cobra el proveedor. */
export const CAMPO_MONEDA_EMPRESA = { cliente: 'monedaFacturacion', proveedor: 'monedaProveedor' } as const;

/** Nombre de cada moneda del catálogo por su id (para las empresas que guardan un id del catálogo). */
export const nombreDeMonedaId = (monedas: readonly DocCatalogo[]): ((id: string) => unknown) => {
  const nombres = new Map(monedas.map((m) => [idReal(m), String(m.moneda ?? '')]));
  return (id: string): unknown => nombres.get(id) ?? '';
};

/** ✅ V00490: moneda de cada empresa, por su id (el `_docId` y el `id` guardado). */
export const indexarMonedasEmpresas = (empresas: readonly Datos[], nombreDeId: (id: string) => unknown, campoLado: string): Map<string, Moneda> => {
  const mapa = new Map<string, Moneda>();
  empresas.forEach((e) => {
    const m = monedaDeEmpresa(e, campoLado, nombreDeId);
    if (!m) return;
    [e._docId, e.id].map((v) => String(v ?? '').trim()).filter(Boolean).forEach((id) => { if (!mapa.has(id)) mapa.set(id, m); });
  });
  return mapa;
};

/**
 * Moneda de las empresas de un lado, de los catálogos abiertos (no espera al servidor: es para
 * MOSTRAR y revisar). Si Empresas no se puede leer, rechaza: un Excel que dijera "sin moneda" en
 * todas sería falso.
 */
export const leerMonedasEmpresas = async (lado: keyof typeof CAMPO_MONEDA_EMPRESA): Promise<Map<string, Moneda>> => {
  const [empresas, monedas] = await Promise.all([
    obtenerCatalogo('empresas'),
    obtenerCatalogo('catalogo_moneda').catch((): DocCatalogo[] => []), // solo para empresas con un id raro del catálogo
  ]);
  return indexarMonedasEmpresas(empresas, nombreDeMonedaId(monedas), CAMPO_MONEDA_EMPRESA[lado]);
};

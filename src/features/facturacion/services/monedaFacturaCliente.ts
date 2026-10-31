// src/features/facturacion/services/monedaFacturaCliente.ts
// ---------------------------------------------------------------------------
// ✅ V00540 — La moneda de una factura de cliente y la de su cliente en Empresas. Antes estas reglas solo
//   vivían dentro de FacturacionClientesDashboard; ahora también las usa Editar factura cuando se abre
//   desde otro módulo (Revisión de datos). Son las MISMAS reglas, sin cambios: el tablero las llama de aquí.
//   `mapa` es id → nombre de los catálogos (construirMapaCatalogos): resuelve una moneda guardada como id.
// ---------------------------------------------------------------------------
import { monedaCanonica, nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { normalizarTexto } from '../../../shared/dominio/texto';
import { monedaDeEmpresa } from './reglasFactura';
import type { EmpresaFacturacion } from './mapaCatalogos';

type MapaNombres = Readonly<Record<string, string>>;
type Empresas = readonly EmpresaFacturacion[];

/**
 * ✅ V00262: "Dólares" / "Pesos" (solo existen esas dos). Vacía o N/A → ''. Un id del catálogo se
 * resuelve por su nombre; lo que no se reconoce se devuelve tal cual.
 */
export const nombreMonedaCanonico = (valor: unknown, mapa: MapaNombres): string => {
  const s = String(valor || '').trim();
  if (!s) return '';
  const comun = monedaCanonica(s);
  if (comun) return nombreMoneda(comun);
  if (normalizarTexto(s) === 'n/a') return '';
  const nombre = mapa[s];
  if (nombre && String(nombre) !== s) return nombreMonedaCanonico(nombre, mapa);
  return s;
};

/** La moneda del cliente en Empresas como nombre ("Dólares" / "Pesos"), '' si no tiene (respaldo de facturas sin moneda). */
export const monedaDeClienteNombre = (clienteId: unknown, empresas: Empresas, mapa: MapaNombres): string => {
  if (!clienteId) return '';
  const empresa = empresas.find((e) => e.id === clienteId);
  return nombreMonedaCanonico(empresa?.monedaRef || empresa?.moneda || empresa?.monedaFacturacion, mapa);
};

/**
 * ✅ V00265: la moneda EN QUE SE EMITIÓ la factura (monedaFacturacion, o el campo viejo `moneda` de las
 * importadas); la del cliente en Empresas solo si la factura no trae. 'N/A' si no hay ninguna.
 */
export const monedaFacturaMostrar = (factura: unknown, empresas: Empresas, mapa: MapaNombres): string => {
  const f = (factura && typeof factura === 'object' ? factura : {}) as Record<string, unknown>;
  const emitida = nombreMonedaCanonico(f.monedaFacturacion, mapa) || nombreMonedaCanonico(f.moneda, mapa);
  if (emitida) return emitida;
  return monedaDeClienteNombre(f.clienteId, empresas, mapa) || 'N/A';
};

/** ✅ V00485: el CÓDIGO (USD / MXN) de esa moneda (null si no se reconoce). */
export const codigoMonedaFactura = (factura: unknown, empresas: Empresas, mapa: MapaNombres): Moneda | null =>
  monedaCanonica(monedaFacturaMostrar(factura, empresas, mapa));

/** ✅ V00481: la moneda de una factura nueva o editada es SIEMPRE la del cliente en Empresas (null si no tiene). */
export const monedaFacturacionCliente = (clienteId: unknown, empresas: Empresas, mapa: MapaNombres): Moneda | null =>
  monedaDeEmpresa(empresas.find((e) => e.id === clienteId), 'monedaFacturacion', (id) => mapa[id]);

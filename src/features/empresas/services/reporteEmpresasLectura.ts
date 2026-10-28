// src/features/empresas/services/reporteEmpresasLectura.ts
// ---------------------------------------------------------------------------
// ✅ V00507 — LECTURAS del Reporte de empresas (la regla está en reporteEmpresas.ts). Solo lee y solo
// cuando el usuario presiona "Descargar Excel":
//   · Operaciones: con rango, las del rango (leerOperacionesDelRango, la misma del Excel de
//     Operaciones: sirve con fechas de AppSheet); sin rango, TODAS (recorrerOperaciones, como la
//     Revisión de datos). Es la excepción documentada de "leer toda la colección": la lanza el
//     usuario a mano y avisa el avance.
//   · Empresas, Tipo de Empresa, Direcciones, Status y Tráfico de los catálogos abiertos (si ya están
//     abiertos no cuestan lecturas). Si alguno falla, rechaza: un reporte a medias diría números falsos.
// ---------------------------------------------------------------------------
import { obtenerCatalogo } from '../../../shared/data/catalogos';
import { idReal } from '../../../shared/data/coleccionesVivas';
import { contarOperaciones, recorrerOperaciones } from '../../../shared/data/consultas';
import { esOperacionPrueba } from '../../../shared/dominio/operacionCanonica';
import { fechaOperacionExcel, leerOperacionesDelRango } from '../../operaciones/services/operacionesDelRangoExcel';
import type { AvanceExcel } from '../../operaciones/services/operacionesDelRangoExcel';
import { armarReporteEmpresas } from './reporteEmpresas';
import type { ReporteEmpresas } from './reporteEmpresas';

type Datos = Record<string, unknown>;

/** Rango de fechas de servicio (AAAA-MM-DD); vacío = sin límite de ese lado. */
export interface RangoReporte { desde: string; hasta: string }

const conRango = (r: RangoReporte): boolean => !!(r.desde || r.hasta);

/** TODAS las operaciones (sin las de prueba), con su fecha normalizada en `_fechaISO`. */
const leerTodas = async (alAvanzar: (a: AvanceExcel) => void): Promise<Datos[]> => {
  const total = await contarOperaciones().catch(() => null); // solo para el aviso de avance
  const ops: Datos[] = [];
  await recorrerOperaciones(
    (docs) => docs.forEach((d) => { if (!esOperacionPrueba(d)) ops.push({ ...d, id: idReal(d), _fechaISO: fechaOperacionExcel(d) }); }),
    (leidas) => alAvanzar({ leidas, total, enRango: null }),
  );
  return ops;
};

export const leerReporteEmpresas = async (rango: RangoReporte, alAvanzar: (a: AvanceExcel) => void): Promise<ReporteEmpresas> => {
  const [operaciones, empresas, tiposEmpresa, direcciones, status, trafico] = await Promise.all([
    conRango(rango)
      ? leerOperacionesDelRango(rango.desde || '0000-01-01', rango.hasta || '9999-12-31', alAvanzar)
      : leerTodas(alAvanzar),
    obtenerCatalogo('empresas'),
    obtenerCatalogo('catalogo_tipo_empresa'),
    obtenerCatalogo('direcciones'),
    obtenerCatalogo('catalogo_status_servicio'),
    obtenerCatalogo('catalogo_trafico'),
  ]);
  return armarReporteEmpresas({ empresas, operaciones, tiposEmpresa, direcciones, status, trafico });
};

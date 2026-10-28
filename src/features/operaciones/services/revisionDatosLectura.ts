// src/features/operaciones/services/revisionDatosLectura.ts
// ---------------------------------------------------------------------------
// ✅ V00505 — LECTURAS de la Revisión de datos (la regla está en revisionDatos.ts). Solo lee y
// solo cuando el usuario presiona "Revisar":
//   · TODAS las operaciones (recorrerOperaciones, como el Excel de la V00500: la herramienta no
//     puede depender del formato de la fecha). Es la excepción documentada de "leer toda la
//     colección": la lanza el usuario a mano y avisa el avance.
//   · Las facturas de clientes del listener compartido (pagos:facturas_clientes): si Facturación o
//     Pagos ya lo tienen abierto, no cuesta lecturas nuevas.
//   · Empresas (moneda de cada cliente) y el catálogo de status, de los catálogos abiertos.
// El último resultado se queda en memoria durante la sesión (no en el navegador): al abrir un
// registro se cierra la ventana y al volver a abrirla sigue ahí.
// ---------------------------------------------------------------------------
import { obtenerCatalogo } from '../../../shared/data/catalogos';
import { idReal, obtenerVivo } from '../../../shared/data/coleccionesVivas';
import { contarOperaciones, recorrerOperaciones } from '../../../shared/data/consultas';
import { obtenerFlags } from '../../../shared/data/flags';
import { esOperacionPrueba } from '../../../shared/dominio/operacionCanonica';
import { normalizarFacturaDe } from '../../facturacion/services/normalizarFactura';
import { consultaFacturasPagables } from '../../pagos/hooks/useFacturasPagables';
import { conNombreDeStatus } from './excelOperaciones';
import { leerMonedasEmpresas } from './monedasEmpresas';
import { revisarDatos } from './revisionDatos';
import type { FacturaRevision, OpRevision, ResultadoRevision } from './revisionDatos';

export interface AvanceRevisionDatos { leidas: number; total: number }

export interface RevisionGuardada { resultado: ResultadoRevision; en: Date }

let ultima: RevisionGuardada | null = null;
/** La última revisión de esta sesión (null si no se ha hecho). */
export const ultimaRevisionDatos = (): RevisionGuardada | null => ultima;

/** Lee todo lo necesario y arma la revisión. Rechaza si algo no se pudo leer (no se muestra a medias). */
export const leerYRevisarDatos = async (alAvanzar: (a: AvanceRevisionDatos) => void): Promise<RevisionGuardada> => {
  const total = await contarOperaciones();
  alAvanzar({ leidas: 0, total });
  const operaciones: OpRevision[] = [];
  const { clave, crear } = consultaFacturasPagables('cliente', false);
  const [, crudas, monedaEmpresa, status, flags] = await Promise.all([
    recorrerOperaciones((docs) => {
      docs.forEach((d) => { if (!esOperacionPrueba(d)) operaciones.push({ ...d, idDoc: idReal(d) }); });
    }, (leidas) => alAvanzar({ leidas, total })),
    obtenerVivo(clave, crear, 120000, { fresco: true }),
    leerMonedasEmpresas('cliente'),
    obtenerCatalogo('catalogo_status_servicio'),
    obtenerFlags(),
  ]);
  // ✅ V00510: también el id REAL del documento (para marcar las operaciones de F1 con su factura).
  const facturas: FacturaRevision[] = crudas.map((f) => ({ ...normalizarFacturaDe(f, 'cliente'), id: String(f.id), idDoc: idReal(f) }));
  const resultado = revisarDatos({
    operaciones: conNombreDeStatus(operaciones, status),
    facturas,
    monedaEmpresa,
    reglaUnica: flags.dineroPorServidor,
  });
  ultima = { resultado, en: new Date() };
  return ultima;
};

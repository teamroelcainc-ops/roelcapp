// src/features/facturacion/components/FacturacionClientesDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// CAMBIOS EN ESTA VERSIÓN
// ═══════════════════════════════════════════════════════════════════════
// D) VER TODO POR DEFECTO + SEPARAR PENDIENTES/FACTURADAS + FILTRO STATUS.
// E) EXPORTACIÓN A EXCEL PROFESIONAL (ExcelJS: estilos, colores, logo).
// F) REMISIÓN EN PDF DESDE REACT (emisor por moneda: USD→Camila, MXN→Rolando)
//    con el encabezado guardado en config_columnas/facturacion_remision_emisores
//    (✅ V00482: se quitó el botón "⚙ Encabezado Remisión"; el encabezado guardado se sigue usando).
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, useEffectEvent } from 'react';
import { AuditoriaCadenaCliente } from './AuditoriaCadenaCliente'; // ✅ V00318
import { useBusquedaGlobal } from '../../../utils/busquedaGlobal'; // ✅ V00263
import { useModuloEscuchando } from '../../../utils/moduloVivoContexto'; // ✅ V00438 (Fase 2.7)
import { EditorOperacionEmbebido } from '../../operaciones/components/EditorOperacionEmbebido';
import { HiloModal } from '../../hilo/HiloModal';
import { datosAAplicar, notificarOperacionGuardada, suscribirOperacionGuardada } from '../../../utils/operacionesBus';
import { avisoYaFacturadas, facturaExistenteFresca, operacionesYaFacturadas, planLiberarAlEliminar } from '../services/facturarSeguro'; // ✅ V00451 · V00494
import type { DecisionLiberar } from '../services/facturarSeguro';
import {
  collection,
  query,
  writeBatch,
  doc,
  where,
  getDocs,
  getDoc,
  setDoc,
  documentId,
  onSnapshot,
} from 'firebase/firestore';
import { SelectBuscable } from '../../catalogos/components/SelectBuscable';
import { db } from '../../../config/firebase';
import { exportarExcelProfesional } from './exportarExcelProfesional';
import { generarRemisionPDF } from './generarRemisionPDF';
import type { EmisorRemision, RemisionData } from './generarRemisionPDF';
import './FacturacionClientesDashboard.css';
import TarjetaDocumentoFactura, { PildoraDocsFactura } from './TarjetaDocumentoFactura';
import DocumentosFacturaModal from './DocumentosFacturaModal'; // ✅ V00451
import AdjuntosArchivos from '../../../shared/components/AdjuntosArchivos'; // ✅ V00451
import { desdeGuardados } from '../../../shared/archivos/adjuntos';
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import {
  MAX_DOCS_FACTURA, aplicarEscriturasDocs, camposDocsDeGrupo, camposDocsFactura, detalleError, docsDeFactura, idsDeFila,
} from '../services/documentosFactura'; // ✅ V00451: varios documentos por factura
import type { EscrituraDocs } from '../services/documentosFactura';
import { agregarDocsFactura, guardarDocsFactura, rescatarDocsDeBorradas } from '../services/guardarDocsFactura';
import CargandoDatos from '../../../shared/components/CargandoDatos'; // ✅ V00449
import RevisionRefCliente from '../../operaciones/components/RevisionRefCliente'; // ✅ V00450
import { idDeLista, useRefClienteDuplicados } from '../../operaciones/hooks/useRefClienteDuplicados'; // ✅ V00450
import { claveRefCliente } from '../../operaciones/services/refClienteDuplicado'; // ✅ V00450
import type { OpRefResumen } from '../../operaciones/services/refClienteDuplicado';
import { olvidarRefsConsultadas } from '../../operaciones/services/refClienteDuplicadoServidor'; // ✅ V00450
import { pestanaAtendida, usePestanaPedida } from '../../../shared/data/avisos'; // ✅ V00450
import { registrarLog } from '../../../utils/logger'; // ✅ V00262
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';
import { esUSD as esMonedaUSD, monedaCanonica as monedaCanonicaComun, nombreMoneda } from '../../../shared/dominio/moneda';
import { ID_MXN, ID_USD, STATUS_COMPLETADOS, TIPO_EMPRESA } from '../../../shared/dominio/constantes'; // ✅ V00439 (Fase 3.x)
import { useCatalogo, useCatalogos } from '../../../shared/data/catalogos'; // ✅ V00439 (Fase 3.x)
import { CATALOGOS_NOMBRES_FACTURACION, construirMapaCatalogos } from '../services/mapaCatalogos';
import { useMapaEstable } from '../../../shared/hooks/useMapaEstable'; // ✅ V00447
import type { EmpresaFacturacion } from '../services/mapaCatalogos';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import {
  MAX_ESCRITURAS_LOTE,
  avisoFacturaConPagos,
  avisoLoteGrande,
  avisoTotalBajoPagado,
  montoPagadoDe,
  tienePagosAplicados,
  totalNativoDeOperaciones,
  totalNativoFactura,
  totalNativoFacturaLegado,
  totalesTrasCambioDeOps,
  totalDeFilaFactura, // ✅ V00451
} from '../services/totalesFactura'; // ✅ Fase 1.8
import { normalizarFacturaDe } from '../services/normalizarFactura'; // ✅ V00493
import { avisoFacturasTruncadas, descargarTodasLasFacturas } from '../services/descargarFacturas'; // ✅ V00494
import { avisar } from '../../../shared/data/avisos';
import { aplicarFacturas, aplicarOperaciones, llamarDinero, mensajeDinero } from '../services/dineroServidor'; // ✅ V00441
import { useFlags, useFlagsCargadas } from '../../../shared/data/flags';
import {
  aplicarConfigColumnasGuardada, colorStatusFactura, DOC_REMISION_EMISORES, fechaOrdenKey, LIMITE_OPS_TODAS,
  fechaFacturaISO, moverIdAlInicio, pareceReferencia, refNaturalKey, STATUS_FACTURA_OPCIONES, textoFacturadoEn, valorGenericoOp,
} from '../selectores'; // ✅ V00444 (Fase 8.1): una sola copia (antes idéntica en Clientes y Proveedores)
import { useOperacionesFacturables } from '../hooks/useOperacionesFacturables'; // ✅ V00444 (Fase 8.1)
import { conversionOperacion, monedaDeFactura, monedaFacturaOperacion, montoOperacion } from '../../../shared/dominio/dinero';
import type { Moneda } from '../../../shared/dominio/moneda';
import Importe, { NombreMoneda } from './Importe'; // ✅ V00481: Pesos en verde, Dólares en azul
import AvisoMonedaFactura from './AvisoMonedaFactura';
import CamposCancelacion from './CamposCancelacion';
import ModalCancelarFactura from './ModalCancelarFactura';
import CancelacionFicha from './CancelacionFicha';
import AccionesHistorial from './AccionesHistorial'; // ✅ V00482
import CorregirFacturasModal from './CorregirFacturasModal';
import PagosDeFactura from './PagosDeFactura'; // ✅ V00483
import { indexarPagos, numerosPorFactura, pagosDeFacturas } from '../services/pagosDeFactura';
import type { PagoDeFactura } from '../services/pagosDeFactura';
import { abrirPagoEnPagos } from '../../pagos/services/pagoPedido';
import { puedeClave } from '../../../utils/permisos';
import {
  AVISO_AGREGAR_FACTURADA, AVISO_REMISION_FACTURADA, CANCELACION_VACIA, STATUS_AL_CREAR, avisoMonedaDistinta, avisoSinMoneda,
  cancelacionDe, estaCancelada, importesDeRenglones, monedaDeEmpresa, puedeAgregarOperaciones, puedeGenerarRemision, sumaEnTotales,
  totalSugeridoEn, validarCancelacion,
} from '../services/reglasFactura';
import type { DatosCancelacion } from '../services/reglasFactura';
import { escribirEnGrupo, escrituraCancelacion } from '../services/statusFacturaDatos';
import TagPuenteUnidad from '../../puentes/components/TagPuenteUnidad'; // ✅ V00465
import { grupoTagDeOperacion } from '../../puentes/services/tagPuente';

// ──────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────
// ✅ V00439 (Fase 3.x): IDs de moneda, status y tipo de empresa desde shared/dominio/constantes.


// ✅ (A) Documento(s) de configuración de columnas COMPARTIDA en Firestore.
// ⚠️ v2: se cambió la versión para RESETEAR la configuración guardada y que
//    apliquen las nuevas columnas por defecto (# Remolque + columnas AppSheet).
const CONFIG_COLUMNAS_COLLECTION = 'config_columnas';
// ⚠️ v3 (V00126): reset para aplicar el nuevo orden Subtotal → Costo Adicional → Total → TC … → Conversión (MXN)
const DOC_COLUMNAS_OPS = 'facturacion_clientes_ops_v3';
// ⚠️ V00126: reset para incluir la columna # Pago
const DOC_COLUMNAS_HISTORIAL = 'facturacion_clientes_historial_v3';

const LS_REMISION_EMISORES = 'cfg_remision_emisores_v1';

// Emisor por defecto para remisiones en PESOS (MXN) → Rolando.
const EMISOR_MXN_DEFAULT: EmisorRemision = {
  facturaNombre: 'ROLANDO ROBERTO MONTALVO CISNEROS',
  direccion: 'MAR DE LAS ANTILLAS 947, COL. LA PAZ',
  ciudadEstado: 'NUEVO LAREDO, TAMPS | (867) 196 4690',
  email: 'COBRANZA@ROELCA.COM',
};
// Emisor por defecto para remisiones en DÓLARES (USD) → Camila.
// ⚠️ Respaldo: manda el encabezado guardado en config_columnas (V00482: sin botón para editarlo).
const EMISOR_USD_DEFAULT: EmisorRemision = {
  facturaNombre: 'CAMILA (EDITAR NOMBRE REAL)',
  direccion: 'MAR DE LAS ANTILLAS 947, COL. LA PAZ',
  ciudadEstado: 'NUEVO LAREDO, TAMPS | (867) 196 4690',
  email: 'COBRANZA@ROELCA.COM',
};

// ✅ Persistencia local (respaldo instantáneo que sobrevive al refresco).
const LS_COLS_OPS = 'cfgcols_facturacion_ops_v2';
const LS_COLS_HIST = 'cfgcols_facturacion_hist_v2';

// ✅ V00439 (Fase 3.x): el mapa id→nombre ya no se arma desde las copias de
//   catálogos en localStorage (cat_v1__/cat_v2__/roelca_catalogos_v2): sale de
//   los catálogos en vivo (ver services/mapaCatalogos.ts).

const moverStatusAlInicio = (cols: any[]): any[] => moverIdAlInicio(cols, 'statusFactura');

const COLUMNAS_FACTURA_BASE = [
  { id: 'statusFactura', label: 'Status',       visible: true },
  { id: 'invoice',     label: 'Invoice',      visible: true },
  { id: 'numeroPago',  label: '# Pago',       visible: true }, // ✅ V00126: número(s) de pago aplicados a la factura
  { id: 'fecha',       label: 'Fecha',        visible: true },
  { id: 'remolque',    label: '# Remolque',   visible: true },
  { id: 'cliente',     label: 'Cliente',      visible: true },
  { id: 'refCliente',  label: 'Ref Cliente',  visible: true }, // ✅ NUEVO: viene de las operaciones
  { id: 'moneda',      label: 'Moneda',       visible: true },
  { id: 'facturaCcp',  label: 'Factura CCP',  visible: true },
  { id: 'cantOps',     label: 'Cant. Ops',    visible: true },
  { id: 'referencias', label: 'Referencias',  visible: true },
  { id: 'total',       label: 'Total',        visible: true },
  { id: 'createdAt',   label: 'Registrada',   visible: false },
];

// ✅ V00438 (Fase 2.8): claves de la copia vieja de operaciones/facturas en
//   localStorage (almacenSesion). Ya no se escriben; se borran una vez al montar.
const CLAVES_CACHE_LEGADO = ['roelca_ops_completadas_v2', 'roelca_facturas_clientes_v1'];

// ✅ V00493: la forma de la factura vive en services/normalizarFactura.ts (la misma que usa Estadísticas).
//   Devuelve `any` como antes: el tablero aún trata sus facturas sin tipo (no se amplía aquí).
const normalizarFactura = (raw: Record<string, unknown>): any => normalizarFacturaDe(raw, 'cliente');

const COLUMNAS_OPS_BASE: any[] = [
  { id: 'factura',       label: '# Factura',       visible: true,  orden: true,  grupo: 'General' },
  { id: 'ref',           label: 'Ref. Operación',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true,  orden: true,  grupo: 'General' },
  // ✅ # Remolque entre Fecha y Cliente. Si nombre y placa son el MISMO número
  //    se muestra uno solo; si son diferentes se muestran ambos con "≠".
  { id: 'remolque',      label: '# Remolque',      visible: true,  orden: true,  grupo: 'General', tipo: 'texto', sourceField: ['remolqueNombre', 'remolquePlaca', 'numeroRemolque'] },
  { id: 'cliente',       label: 'Cliente',         visible: true,  orden: true,  grupo: 'General' },
  { id: 'cartaPorte',    label: 'Carta Porte',     visible: true,  orden: false, grupo: 'General' },
  { id: 'destino',       label: 'Destino',         visible: true,  orden: true,  grupo: 'General' },
  // ✅ Columnas de facturación según AppSheet (misma lógica de monedas:
  //    USD → Dólares, MXN → Pesos, Conversión = total en MXN con el TC).
  // ✅ V00126: orden fijo de facturación → Facturado en · Subtotal (convenio en
  //    moneda de factura) · Costo Adicional · Total · Tipo de Cambio · … ·
  //    Conversión (MXN) SIEMPRE al final. Montos sin redondeo.
  { id: 'moneda',        label: 'Facturado en',    visible: true,  orden: false, grupo: 'Por Cobrar' },
  { id: 'subtotal',      label: 'Subtotal',        visible: true,  orden: true,  grupo: 'Por Cobrar' },
  { id: 'cargosAdicionales',     label: 'Costo Adicional',    visible: true,  orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'cargosAdicionales' },
  { id: 'total',         label: 'Total',           visible: true,  orden: true,  grupo: 'Por Cobrar' },
  { id: 'tipoCambioAprobado',    label: 'Tipo de Cambio',     visible: true,  orden: true,  grupo: 'Por Cobrar', tipo: 'numero', sourceField: 'tipoCambioAprobado' },
  { id: 'montoConvenioCliente',  label: 'Convenio (original)', visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'montoConvenioCliente' },
  { id: 'dolares',       label: 'Dólares',         visible: false, orden: false, grupo: 'Por Cobrar' },
  { id: 'pesos',         label: 'Pesos',           visible: false, orden: false, grupo: 'Por Cobrar' },
  { id: 'observacionesCobrar',   label: 'Observaciones (Costos)', visible: true, orden: false, grupo: 'Por Cobrar', tipo: 'texto', sourceField: 'observacionesCobrar' },
  { id: 'conv',          label: 'Conversión (MXN)', visible: true,  orden: true,  grupo: 'Por Cobrar' },
  { id: 'tipoOperacion',  label: 'Tipo de Operación', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['tipoOperacionNombre', 'tipoOperacionId'] },
  { id: 'status',         label: 'Status',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['statusNombre', 'status'] },
  { id: 'fechaCita',      label: 'Fecha Cita',        visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'fechaCita' },
  { id: 'convenio',       label: 'Convenio (Tarifa)', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['convenioNombre', 'convenio'] },
  { id: 'refCliente',     label: 'Ref Cliente',       visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: 'refCliente' },
  { id: 'origen',         label: 'Origen',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['origenNombre', 'origen'] },
  { id: 'observacionesEjecutivo', label: 'Obs. Ejecutivo',    visible: false, orden: false, grupo: 'General', tipo: 'texto',     sourceField: 'observacionesEjecutivo' },
  { id: 'createdAt',      label: 'Fecha de Creación', visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'createdAt' },
  { id: 'clienteMercancia',     label: 'Cliente (Mercancía)',  visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: ['clienteMercanciaNombre', 'clienteMercancia'] },
  { id: 'descripcionMercancia', label: 'Descripción Mercancía', visible: false, orden: false, grupo: 'Pedimento', tipo: 'texto',  sourceField: 'descripcionMercancia' },
  { id: 'cantidad',             label: 'Cantidad',              visible: false, orden: true,  grupo: 'Pedimento', tipo: 'numero', sourceField: 'cantidad' },
  { id: 'embalaje',             label: 'Embalaje',              visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: ['embalajeNombre', 'embalaje'] },
  { id: 'pesoKg',               label: 'Peso (Kg)',             visible: false, orden: true,  grupo: 'Pedimento', tipo: 'numero', sourceField: 'pesoKg' },
  { id: 'numDoda',              label: '# DODA',                visible: false, orden: true,  grupo: 'Pedimento', tipo: 'texto',  sourceField: 'numDoda' },
  { id: 'fechaEmisionDoda',     label: 'Fecha Emisión DODA',    visible: false, orden: true,  grupo: 'Pedimento', tipo: 'fecha',  sourceField: 'fechaEmisionDoda' },
  { id: 'numeroEntrys',    label: "# Entry's",          visible: false, orden: false, grupo: 'Manifiestos', tipo: 'texto',  sourceField: 'numeroEntrys' },
  { id: 'cantEntrys',      label: "Cant. Entry's",      visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'numero', sourceField: 'cantEntrys' },
  { id: 'numManifiesto',   label: '# Manifiesto',       visible: false, orden: false, grupo: 'Manifiestos', tipo: 'texto',  sourceField: 'numManifiesto' },
  { id: 'provServicios',   label: 'Prov. Servicios',    visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'texto',  sourceField: ['provServiciosNombre', 'provServicios'] },
  { id: 'montoManifiesto', label: 'Costo Manifiesto',   visible: false, orden: true,  grupo: 'Manifiestos', tipo: 'monto',  sourceField: 'montoManifiesto' },
  { id: 'proveedorUnidad',       label: 'Proveedor Transporte', visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['proveedorUnidadNombre', 'proveedorUnidad'] },
  { id: 'monedaUnidad',          label: 'Moneda Prov.',         visible: false, orden: false, grupo: 'Unidad', tipo: 'texto', sourceField: ['monedaUnidadNombre', 'facturadoEnUnidad'] },
  { id: 'convenioProveedor',     label: 'Convenio Proveedor',   visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['convenioProveedorNombre', 'convenioProveedor'] },
  { id: 'monedaConvenioProv',    label: 'Moneda Convenio Prov.', visible: false, orden: false, grupo: 'Unidad', tipo: 'moneda', sourceField: 'monedaConvenioProv' },
  { id: 'totalAPagarProv',       label: 'Monto a Pagar (Prov)', visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'totalAPagarProv' },
  { id: 'cargosAdicionalesProv', label: 'Cargos Adic. (Prov)',  visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'cargosAdicionalesProv' },
  { id: 'subtotalProv',          label: 'Subtotal Prov.',       visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'subtotalProv' },
  { id: 'dolaresProv',           label: 'Dólares Prov.',        visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'dolaresProv' },
  { id: 'pesosProv',             label: 'Pesos Prov.',          visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'pesosProv' },
  { id: 'conversionProv',        label: 'Conversión Prov.',     visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'conversionProv' },
  { id: 'unidad',                label: 'Unidad Asignada',      visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['unidadNombre', 'unidad'] },
  { id: 'operador',              label: 'Operador',             visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: ['operadorNombre', 'operador'] },
  { id: 'sueldoOperador',        label: 'Sueldo Operador',      visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'sueldoOperador' },
  { id: 'sueldoExtra',           label: 'Sueldo Extra',         visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'sueldoExtra' },
  { id: 'sueldoTotal',           label: 'Sueldo Total',         visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'sueldoTotal' },
  { id: 'combustible',           label: 'Combustible',          visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'combustible' },
  { id: 'combustibleExtra',      label: 'Combustible Extra',    visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'combustibleExtra' },
  { id: 'combustibleTotal',      label: 'Total Combustible',    visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'combustibleTotal' },
  { id: 'totalGastos',           label: 'Total Gastos',         visible: false, orden: true,  grupo: 'Unidad', tipo: 'monto', sourceField: 'totalGastos' },
  { id: 'unidadProveedor',       label: 'Unidad Externa',       visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: 'unidadProveedor' },
  { id: 'operadorProveedor',     label: 'Operador Externo',     visible: false, orden: true,  grupo: 'Unidad', tipo: 'texto', sourceField: 'operadorProveedor' },
  { id: 'observacionesUnidad',   label: 'Obs. Unidad/Prov.',    visible: false, orden: false, grupo: 'Unidad', tipo: 'texto', sourceField: 'observacionesUnidad' },
  { id: 'monedaConvenioCliente', label: 'Moneda Convenio Cliente', visible: false, orden: false, grupo: 'Por Cobrar', tipo: 'moneda', sourceField: 'monedaConvenioCliente' },
  { id: 'subtotalCliente',       label: 'Subtotal Cliente',        visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'subtotalCliente' },
  { id: 'dolaresCliente',        label: 'Dólares Cliente',         visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'dolaresCliente' },
  { id: 'pesosCliente',          label: 'Pesos Cliente',           visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'pesosCliente' },
  { id: 'conversionCliente',     label: 'Conversión Cliente',      visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'conversionCliente' },
  { id: 'utilidadEstimada',      label: 'Utilidad Estimada',       visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'utilidadEstimada' },
];

// ✅ V00441 (Fase 5.1): la regla de monedas vive en src/shared/dominio/dinero.ts
//   (la misma que usa el servidor). Antes estaba copiada aquí, en Proveedores,
//   en relacional.ts y en Pagos.
const calcularConversionCliente = (op: any) => conversionOperacion(op, 'cliente');


// ✅ FIX MONEDA — TOTAL NATIVO DE LA FACTURA (USD -> dólares, MXN -> pesos):
//   ✅ Fase 1.8: vive en ../services/totalesFactura (una sola regla para
//   Clientes y Proveedores, y la misma que recalcula subtotalMonedaFactura).

const obtenerMontoOperacion = (op: any) => montoOperacion(op, 'cliente'); // ✅ V00441: dinero.ts


export const FacturacionClientesDashboard = () => {
  const flags = useFlags(); // ✅ V00441 (Fase 5): dinero por servidor
  // ✅ V00448: el total que se MUESTRA (tabla, tarjetas, Excel) usa la misma regla que Pagos
  //   mientras el dinero no lo lleve el servidor (como la V00434). La regla única cambiaba el
  //   total de facturas viejas sin moneda reconocible o con renglones sin `dol`.
  const totalFactura = useCallback(
    (f: unknown): number => (flags.dineroPorServidor ? totalNativoFactura(f) : totalNativoFacturaLegado(f)),
    [flags.dineroPorServidor],
  );
  // ✅ V00451: total de una fila del Historial (varios documentos con el mismo folio se agrupan):
  //   el mismo en la tabla, el Excel y el editor (services/totalesFactura.ts).
  const totalDeGrupo = useCallback((f: unknown): number => totalDeFilaFactura(f, totalFactura), [totalFactura]);
  const flagsCargadas = useFlagsCargadas(); // ✅ V00443
  // ✅ V00450: + 'revision' (Ref Cliente duplicada; salen de "Asignar Operaciones").
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial' | 'pagadas' | 'revision'>('operaciones');
  const [mostrarAuditoria, setMostrarAuditoria] = useState(false); // ✅ V00318
  // ✅ V00126: "Pagadas" reutiliza toda la vista de Historial filtrando facturas liquidadas
  const esHistorial = activeTab === 'historial' || activeTab === 'pagadas';
  // ✅ V00126: mapa facturaId → número(s) de pago (colección `pagos`, en vivo)
  // ✅ V00483: además de los números, el detalle de cada pago (para la ficha de la factura).
  const [pagosDetalle, setPagosDetalle] = useState<Map<string, PagoDeFactura[]>>(() => new Map());
  const pagosPorFactura = useMemo(() => numerosPorFactura(pagosDetalle), [pagosDetalle]);
  // ✅ V00438 (Fase 2.7): el listener de pagos se cierra mientras el módulo está
  //   oculto (MantenerVivo); al volver se re-suscribe sin limpiar lo ya pintado.
  const moduloVisible = useModuloEscuchando(); // ✅ V00446: sigue escuchando unos minutos oculto
  useEffect(() => {
    if (!moduloVisible) return;
    const q = query(collection(db, 'pagos'), where('tipo', '==', 'cliente'));
    const unsub = onSnapshot(q, (snap) => {
      setPagosDetalle(indexarPagos(snap.docs.map((d) => ({ ...d.data(), id: d.id })))); // ✅ V00483: id = el del documento
    }, (e) => console.warn('[Facturación] pagos:', e));
    return () => unsub();
  }, [moduloVisible]);
  const numerosPagoDe = (f: any): string[] => {
    const ids: string[] = Array.isArray(f?.__groupIds) && f.__groupIds.length ? f.__groupIds.map(String) : [String(f?.id || '')];
    const out: string[] = [];
    ids.forEach(id => (pagosPorFactura[id] || []).forEach(n => { if (!out.includes(n)) out.push(n); }));
    return out;
  };
  const facturaPagada = (f: any): boolean => {
    const docs: any[] = Array.isArray(f?.__groupDocs) && f.__groupDocs.length ? f.__groupDocs : [f];
    return docs.every((d: any) => String(d?.statusPago || '').toUpperCase() === 'PAGADA' || ((Number(d?.montoPagado) || 0) > 0.009 && (Number(d?.saldoPendiente) || 0) <= 0.009));
  };

  const [facturasGlobales, setFacturasGlobales] = useState<any[]>([]);
  // ✅ V00449: arranca en true porque la descarga de facturas empieza SIEMPRE al montar
  //   (cargarFacturasAlEntrar). Con false, el primer pintado mostraba "Aún no hay facturas
  //   registradas" y las tarjetas en $0 antes de que el efecto encendiera la bandera.
  const [cargandoFacturas, setCargandoFacturas] = useState(true);

  // ✅ V00439 (Fase 3.x): empresas y catálogos de nombres desde los listeners
  //   compartidos (antes: getDocs + copias en localStorage).
  const empresasList = useCatalogo('empresas').datos as EmpresaFacturacion[];
  const { datos: catalogosNombres } = useCatalogos(CATALOGOS_NOMBRES_FACTURACION);
  // Los status "Falso" (facturables) salen de este catálogo: las operaciones se
  // descargan cuando ya llegó (de la caché local o del servidor).
  const { listo: statusListos } = useCatalogo('catalogo_status_servicio');

  const [fechaDesdeOps, setFechaDesdeOps] = useState('');
  const [fechaHastaOps, setFechaHastaOps] = useState('');
  const [fechaDesdeHist, setFechaDesdeHist] = useState('');
  const [fechaHastaHist, setFechaHastaHist] = useState('');
  const [textoBuscarRemolqueOps, setTextoBuscarRemolqueOps] = useState('');
  const [vistaOps, setVistaOps] = useState<'pendientes' | 'facturadas' | 'todas'>('pendientes');
  // ✅ V00126: editar la operación completa desde Facturación (mismo formulario de Operaciones)
  const [opEditandoId, setOpEditandoId] = useState<string | null>(null);
  const [hiloFacturaId, setHiloFacturaId] = useState<string | null>(null);
  // ✅ V00126: pestañas por moneda de facturación
  const [monedaVistaOps, setMonedaVistaOps] = useState<'todas' | 'USD' | 'MXN'>('todas');
  const [filtroCliente, setFiltroCliente] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [ordenFac, setOrdenFac] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'desc' });

  const [textoBuscarCliente, setTextoBuscarCliente] = useState('');
  const [mostrarSugerenciasCliente, setMostrarSugerenciasCliente] = useState(false);

  const [textoBuscarFactura, setTextoBuscarFactura] = useState('');
  useBusquedaGlobal((t) => setTextoBuscarFactura(t), 'facturas (invoice, cliente, CCP, referencia, remolque)'); // ✅ V00263: buscador global del topbar
  // ✅ V00438 (Fase 2.4): las búsquedas filtran miles de filas; con el valor
  //   diferido el input responde al teclear y la tabla se actualiza después.
  const textoBuscarRemolqueOpsDiferido = useDeferredValue(textoBuscarRemolqueOps);
  const textoBuscarFacturaDiferido = useDeferredValue(textoBuscarFactura);
  const [filtroStatusFactura, setFiltroStatusFactura] = useState<string>('Todos');
  // ✅ NUEVO: tab para separar la facturación por moneda (Todas | Dólares | Pesos).
  const [filtroMonedaHist, setFiltroMonedaHist] = useState<'todas' | 'USD' | 'MXN'>('todas');
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  // ✅ NUEVO: las tablas arrancan VACÍAS; cada pestaña muestra datos hasta que
  //   se presiona "Buscar" en el panel lateral de filtros.
  const [busquedaOpsHecha, setBusquedaOpsHecha] = useState(false);
  const [busquedaHistHecha, setBusquedaHistHecha] = useState(false);
  const [filtroTipoOp, setFiltroTipoOp] = useState('');

  const [paginaActual, setPaginaActual] = useState(1);
  const [paginaOps, setPaginaOps] = useState(1);
  const registrosPorPagina = 50;

  const [modalAbierto, setModalAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [facturaViendo, setFacturaViendo] = useState<any | null>(null);
  // ✅ V00276: DOCUMENTO DE LA FACTURA (el PDF/imagen de la factura emitida), archivo en
  //   Storage `facturas_documentos/facturas_clientes/{id}/`. Se pide al facturar y se puede
  //   subir desde la fila, la ficha o el editor.
  // ✅ V00451: VARIOS documentos por factura (hasta 10): lista `docsFactura` + los campos de
  //   siempre (docFactura* = el primero, para el portal de clientes y Roelca Móvil). Facturar y
  //   Editar usan AdjuntosArchivos (vista previa en el mismo formulario); la píldora de la fila y
  //   la tarjeta de la Ficha abren "Documentos de la factura" (antes: subida inmediata de UNO).
  const [adjuntosFacturar, setAdjuntosFacturar] = useState<Adjunto[]>([]); // Generar Factura: se suben al confirmar
  const [adjuntosEdicion, setAdjuntosEdicion] = useState<Adjunto[]>([]); // Editar factura: se guardan al guardar
  const [docsFacturaDe, setDocsFacturaDe] = useState<Record<string, unknown> | null>(null); // fila con el modal abierto
  /** La tabla y la Ficha abierta reflejan los documentos guardados al instante. */
  const aplicarDocsLocal = (escrituras: EscrituraDocs[]): void => {
    const [primera] = escrituras;
    if (!primera) return;
    setFacturasGlobales(prev => aplicarEscriturasDocs(prev, escrituras));
    setFacturaViendo((prev: Record<string, unknown> | null) => (prev && idsDeFila(prev).includes(primera.id)) ? { ...prev, ...primera.campos } : prev);
  };
  /** Facturar: sube los documentos elegidos y los AGREGA a los de la factura (el folio pudo existir). Devuelve los campos para la fila. */
  const subirDocsAlFacturar = async (idFactura: string, folio: string): Promise<Record<string, unknown>> => {
    if (adjuntosFacturar.length === 0 || !idFactura) return {};
    try {
      return camposDocsFactura(await agregarDocsFactura('clientes', idFactura, adjuntosFacturar, folio));
    } catch (eDoc: unknown) {
      console.error(eDoc);
      alert(`La factura se guardó, pero los documentos no se pudieron subir.\n\nMotivo: ${detalleError(eDoc)}\n\nPuedes reintentar desde la fila ("Sin doc").`);
      return {};
    } finally {
      setAdjuntosFacturar([]);
    }
  };
  /** Editar factura: guarda los documentos DESPUÉS de la factura (la factura nunca depende de la subida). */
  const guardarDocsDeEdicion = async (fila: Record<string, unknown>): Promise<void> => {
    try {
      const escrituras = await guardarDocsFactura('clientes', fila, adjuntosEdicion);
      if (escrituras) aplicarDocsLocal(escrituras);
    } catch (eDoc: unknown) {
      console.error(eDoc);
      alert(`Los cambios de la factura SÍ se guardaron, pero los documentos no.\n\nMotivo: ${detalleError(eDoc)}`);
    }
  };

  const [guardandoCols, setGuardandoCols] = useState(false);

  const [modalColumnas, setModalColumnas] = useState(false);
  const [columnasFactura, setColumnasFactura] = useState(COLUMNAS_FACTURA_BASE.map(c => ({ ...c })));
  const [modalColumnasOps, setModalColumnasOps] = useState(false);
  const [columnasOps, setColumnasOps] = useState(COLUMNAS_OPS_BASE.map(c => ({ ...c })));
  const [draggedColOpsIndex, setDraggedColOpsIndex] = useState<number | null>(null);
  const [busquedaColOps, setBusquedaColOps] = useState('');
  const [draggedColIndex, setDraggedColIndex] = useState<number | null>(null);

  const [operacionDetalle, setOperacionDetalle] = useState<any | null>(null);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);
  const [pestañaDetalleActiva, setPestañaDetalleActiva] = useState<string>('general');

  const [invoiceForm, setInvoiceForm] = useState('');
  const [fechaForm, setFechaForm] = useState(hoyLocalISO());
  const [facturaCcpForm, setFacturaCcpForm] = useState('');
  const [statusFacturaForm, setStatusFacturaForm] = useState<string>('Facturado');

  const [modalCostoAdic, setModalCostoAdic] = useState(false);
  const [costoAdicOpId, setCostoAdicOpId] = useState('');
  const [costoAdicMonto, setCostoAdicMonto] = useState('');
  const [costoAdicConcepto, setCostoAdicConcepto] = useState('');
  const [guardandoCostoAdic, setGuardandoCostoAdic] = useState(false);

  const [opInfoMap, setOpInfoMap] = useState<Record<string, any>>({});
  const [corrigiendoFacturas, setCorrigiendoFacturas] = useState(false); // ✅ V00482: Corregir monedas y montos

  const [facturaEditando, setFacturaEditando] = useState<any | null>(null);
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [editInvoice, setEditInvoice] = useState('');
  const [editFecha, setEditFecha] = useState('');
  const [editCcp, setEditCcp] = useState('');
  const [editStatus, setEditStatus] = useState('Facturado');
  const [editTotal, setEditTotal] = useState('');
  const [editClienteId, setEditClienteId] = useState(''); // ✅ NUEVO: reasignar cliente
  type FacturaACancelar = { id?: unknown; invoice?: unknown; clienteId?: unknown; statusFactura?: unknown; __groupIds?: unknown };
  // ✅ V00481: la moneda ya no se elige (es la del cliente); cancelar pide nota y factura de reemplazo.
  const [editCancelacion, setEditCancelacion] = useState<DatosCancelacion>(CANCELACION_VACIA);
  const [cancelarDe, setCancelarDe] = useState<FacturaACancelar | null>(null);

  const [gestionOp, setGestionOp] = useState<any | null>(null);
  const [gestionInvoice, setGestionInvoice] = useState('');
  const [guardandoGestionOp, setGuardandoGestionOp] = useState(false);
  const [agregarRefFactura, setAgregarRefFactura] = useState<any | null>(null);
  const [busquedaRefPendiente, setBusquedaRefPendiente] = useState('');
  const [agregandoRef, setAgregandoRef] = useState(false);

  // ✅ (REMISIÓN) Encabezados (emisores) por moneda + preview editable.
  const [emisorMXN, setEmisorMXN] = useState<EmisorRemision>(EMISOR_MXN_DEFAULT);
  const [emisorUSD, setEmisorUSD] = useState<EmisorRemision>(EMISOR_USD_DEFAULT);
  const [remisionPreview, setRemisionPreview] = useState<any | null>(null);
  const [cargandoRemision, setCargandoRemision] = useState(false);

  // Formateadores
  // ✅ V00126: sin redondeo — se muestran hasta 6 decimales tal cual resultan del cálculo.
  const formatoMoneda = (monto: any) => {
    const num = parseFloat(monto || 0);
    return isNaN(num) ? '$ 0.00' : `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; // ✅ V00274: todos los montos a 2 decimales
  };
  const formatearFechaSpanish = (fechaString: any) => {
    if (!fechaString) return '-';
    const fmt = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    if (typeof fechaString === 'object') {
      try {
        if (typeof fechaString.toDate === 'function') { const d = fechaString.toDate(); return isNaN(d.getTime()) ? '-' : fmt(d); }
        if (typeof fechaString.seconds === 'number') { const d = new Date(fechaString.seconds * 1000); return isNaN(d.getTime()) ? '-' : fmt(d); }
      } catch { /* noop */ }
      return '-';
    }
    const s = String(fechaString).trim();
    if (!s) return '-';
    let y = '', mo = '', da = '';
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) { y = m[1]; mo = m[2]; da = m[3]; }
    if (!y) { m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
      if (m) { y = m[1]; mo = m[2]; da = m[3]; } }
    if (!y) { m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      if (m) { da = m[1]; mo = m[2]; y = m[3]; } }
    if (!y) { m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})(?!\d)/);
      if (m) { da = m[1]; mo = m[2]; y = '20' + m[3]; } }
    if (y && mo && da) {
      const d = new Date(`${y}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}T00:00:00`);
      if (!isNaN(d.getTime())) return fmt(d);
    }
    const d2 = new Date(s);
    if (!isNaN(d2.getTime())) return fmt(d2);
    return s;
  };
  const formatearFechaHora = (isoString: string | undefined | null) => {
    if (!isoString) return '-';
    try { return new Date(isoString).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch { return isoString; }
  };
  const mostrarDato = (dato: any) => (dato && dato !== '' ? dato : '-');
  const mostrarMoneda = (val: string | null | undefined) => {
    if (val === ID_USD) return 'USD';
    if (val === ID_MXN) return 'MXN';
    return val || '-';
  };
  const chipStatusFactura = (s: any) => {
    const texto = s || 'Facturado';
    const color = colorStatusFactura(texto);
    return (
      <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color, border: `1px solid ${color}`, backgroundColor: `${color}1a`, whiteSpace: 'nowrap' }}>
        {texto}
      </span>
    );
  };

  // ✅ V00439 (Fase 3.x): derivado de los catálogos en vivo (mismo contenido).
  // ✅ V00447: estable por CONTENIDO (useMapaEstable): un cambio de catálogo que no toca
  //   nombres ya no vuelve a ordenar y filtrar todas las operaciones y facturas.
  const mapaCatalogos = useMapaEstable(useMemo(
    () => construirMapaCatalogos(Object.values(catalogosNombres), empresasList),
    [catalogosNombres, empresasList],
  ));

  // ✅ V00438 (Fase 2.4): useCallback para que las claves de orden de operaciones
  //   (memo) dependan de algo estable.
  const resolverNombre = useCallback((val: any): any => {
    if (val === '' || val === null || val === undefined) return val;
    return mapaCatalogos[String(val)] || val;
  }, [mapaCatalogos]);

  const STATUS_FACTURABLES = useMemo(() => {
    const ids = new Set<string>(STATUS_COMPLETADOS);
    Object.entries(mapaCatalogos).forEach(([id, nombre]) => {
      const n = String(nombre || '');
      if (/\bfalso/i.test(n) || /falso\b/i.test(n)) ids.add(id);
    });
    return Array.from(ids);
  }, [mapaCatalogos]);

  const txt = (...cands: any[]): string => {
    for (const c of cands) {
      if (c !== undefined && c !== null && c !== '') {
        const r = resolverNombre(c);
        return (r === undefined || r === null || r === '') ? '-' : String(r);
      }
    }
    return '-';
  };

  useEffect(() => {
    const aplicarOps = (guardadas: any) => {
      let cols = aplicarConfigColumnasGuardada(COLUMNAS_OPS_BASE, guardadas);
      if (!cols.some((c: any) => c.id === 'factura')) {
        const base = COLUMNAS_OPS_BASE.find((c: any) => c.id === 'factura');
        if (base) cols = [{ ...base, visible: true }, ...cols];
      }
      cols = cols.map((c: any) => c.id === 'factura' ? { ...c, visible: true } : c);
      cols = moverIdAlInicio(cols, 'factura');
      return cols;
    };
    const aplicarHist = (guardadas: any) => {
      let cols = aplicarConfigColumnasGuardada(COLUMNAS_FACTURA_BASE, guardadas);
      const teniaStatus = Array.isArray(guardadas) && guardadas.some((g: any) => g?.id === 'statusFactura');
      if (!teniaStatus) cols = moverStatusAlInicio(cols);
      // ✅ Ref Cliente: si la configuración guardada no la conocía, se inserta
      //   JUNTO a Cliente (no al final) y visible.
      const teniaRefCli = Array.isArray(guardadas) && guardadas.some((g: any) => g?.id === 'refCliente');
      if (!teniaRefCli) {
        const idxRef = cols.findIndex((c: any) => c.id === 'refCliente');
        if (idxRef >= 0) {
          const [colRef] = cols.splice(idxRef, 1);
          colRef.visible = true;
          const idxCli = cols.findIndex((c: any) => c.id === 'cliente');
          cols.splice(idxCli >= 0 ? idxCli + 1 : cols.length, 0, colRef);
        }
      }
      return cols;
    };
    try {
      const lsOps = localStorage.getItem(LS_COLS_OPS);
      if (lsOps) setColumnasOps(aplicarOps(JSON.parse(lsOps)));
      const lsHist = localStorage.getItem(LS_COLS_HIST);
      if (lsHist) setColumnasFactura(aplicarHist(JSON.parse(lsHist)));
    } catch { /* noop */ }

    let activo = true;
    (async () => {
      try {
        const [snapOps, snapHist] = await Promise.all([
          getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_OPS)),
          getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_HISTORIAL)),
        ]);
        if (!activo) return;
        if (snapOps.exists()) {
          const guardadas = (snapOps.data() as any)?.columnas;
          setColumnasOps(aplicarOps(guardadas));
          try { localStorage.setItem(LS_COLS_OPS, JSON.stringify(guardadas || [])); } catch { /* noop */ }
        }
        if (snapHist.exists()) {
          const guardadas = (snapHist.data() as any)?.columnas;
          setColumnasFactura(aplicarHist(guardadas));
          try { localStorage.setItem(LS_COLS_HIST, JSON.stringify(guardadas || [])); } catch { /* noop */ }
        }
      } catch (e) {
        console.error('Error cargando configuración de columnas (compartida):', e);
      }
    })();
    return () => { activo = false; };
  }, []);

  // ✅ (REMISIÓN) Cargar encabezados (emisores) desde localStorage + Firestore.
  useEffect(() => {
    try {
      const ls = localStorage.getItem(LS_REMISION_EMISORES);
      if (ls) {
        const obj = JSON.parse(ls);
        if (obj?.mxn) setEmisorMXN({ ...EMISOR_MXN_DEFAULT, ...obj.mxn });
        if (obj?.usd) setEmisorUSD({ ...EMISOR_USD_DEFAULT, ...obj.usd });
      }
    } catch { /* noop */ }
    let activo = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_REMISION_EMISORES));
        if (!activo || !snap.exists()) return;
        const data = snap.data() as any;
        if (data?.mxn) setEmisorMXN({ ...EMISOR_MXN_DEFAULT, ...data.mxn });
        if (data?.usd) setEmisorUSD({ ...EMISOR_USD_DEFAULT, ...data.usd });
        try { localStorage.setItem(LS_REMISION_EMISORES, JSON.stringify({ mxn: data?.mxn, usd: data?.usd })); } catch { /* noop */ }
      } catch (e) { console.error('Error cargando encabezados de remisión:', e); }
    })();
    return () => { activo = false; };
  }, []);


  const guardarConfigColumnasOps = async () => {
    setGuardandoCols(true);
    try {
      const payload = columnasOps.map(c => ({ id: c.id, visible: !!c.visible }));
      try { localStorage.setItem(LS_COLS_OPS, JSON.stringify(payload)); } catch { /* noop */ }
      await setDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_OPS), { columnas: payload, updatedAt: new Date().toISOString() });
      setModalColumnasOps(false);
      setBusquedaColOps('');
    } catch (e) {
      console.error('Error guardando columnas (operaciones):', e);
      alert('No se pudo guardar la configuración de columnas para todos los usuarios.\nRevisa tus permisos de escritura en Firestore (colección config_columnas).');
    } finally {
      setGuardandoCols(false);
    }
  };

  const guardarConfigColumnasHistorial = async () => {
    setGuardandoCols(true);
    try {
      const payload = columnasFactura.map(c => ({ id: c.id, visible: !!c.visible }));
      try { localStorage.setItem(LS_COLS_HIST, JSON.stringify(payload)); } catch { /* noop */ }
      await setDoc(doc(db, CONFIG_COLUMNAS_COLLECTION, DOC_COLUMNAS_HISTORIAL), { columnas: payload, updatedAt: new Date().toISOString() });
      setModalColumnas(false);
    } catch (e) {
      console.error('Error guardando columnas (historial):', e);
      alert('No se pudo guardar la configuración de columnas para todos los usuarios.\nRevisa tus permisos de escritura en Firestore (colección config_columnas).');
    } finally {
      setGuardandoCols(false);
    }
  };

  // ✅ V00438 (Fase 2.8): operaciones y facturas ya NO se copian a localStorage
  //   (antes: JSON.stringify de hasta 20k ops + 12k facturas en cada cambio, dos
  //   veces). El módulo vive en MantenerVivo (los datos siguen en memoria al
  //   navegar) y la caché persistente de Firestore es la única en disco. Se
  //   borran una vez las copias viejas para devolver ese espacio.
  useEffect(() => {
    try { CLAVES_CACHE_LEGADO.forEach((k) => localStorage.removeItem(k)); } catch { /* sin localStorage */ }
  }, []);

  // Descarga TODAS las facturas desde Firestore (reutilizable por el botón Refrescar).
  // ✅ V00447: una sola descarga a la vez (antes la carga al entrar tenía su propia copia de
  //   este código y, si el efecto corría dos veces, bajaba todas las facturas dos veces).
  //   Un Refrescar pedido mientras baja otra descarga se repite al terminar (no se pierde).
  const facturasEnVueloRef = useRef(false);
  const repetirFacturasRef = useRef(false);
  const descargarFacturas = async (refrescar = true) => {
    if (facturasEnVueloRef.current) { if (refrescar) repetirFacturasRef.current = true; return; }
    facturasEnVueloRef.current = true;
    setCargandoFacturas(true);
    try {
      // ✅ V00494: TODAS (antes se cortaba en 12,000 por ID y cada día salía de la lista otra factura).
      const descarga = await descargarTodasLasFacturas('facturas_clientes');
      if (descarga.truncada) avisar({ tipo: 'alerta', titulo: 'Facturas de clientes incompletas', texto: avisoFacturasTruncadas(descarga.docs.length) });
      const todas: any[] = descarga.docs.map(normalizarFactura);
      todas.sort((a: any, b: any) => {
        const fa = String(a.fecha || '');
        const fb = String(b.fecha || '');
        if (!fa && !fb) return 0;
        if (!fa) return 1;
        if (!fb) return -1;
        return fb.localeCompare(fa);
      });
      setFacturasGlobales(todas);
    } catch (e: any) {
      console.error('[Facturación Historial] Error al recargar facturas:', e);
      alert(`No se pudieron cargar las facturas.\n\nDetalle: ${String(e?.message || e?.code || e || '')}`);
    }
    facturasEnVueloRef.current = false;
    setCargandoFacturas(false);
    if (repetirFacturasRef.current) { repetirFacturasRef.current = false; void descargarFacturas(); }
  };

  // Fuerza el refresco de la colección de facturas: vuelve a leer de Firestore.
  const recargarFacturas = () => {
    descargarFacturas();
  };

  const cargarFacturasAlEntrar = useEffectEvent(() => {
    if (facturasGlobales.length > 0) { setCargandoFacturas(false); return; } // ✅ V00449: la bandera arranca en true
    void descargarFacturas(false);
  });
  useEffect(() => cargarFacturasAlEntrar(), []);

  // ✅ V00444 (Fase 8.1): carga de las operaciones en useOperacionesFacturables (antes copiada aquí
  //   y en el otro lado). Con `consultasCanonicas` (Fase 7.3): pendientes primero, facturadas al
  //   abrir "Facturadas"/"Todas".
  const {
    operaciones: operacionesGlobales, setOperaciones: setOperacionesGlobales, cargando: cargandoOperaciones,
    topeAlcanzado: topeOpsAlcanzado, facturadasCargadas, descargar: descargarOpsCompletadas,
    descargaTerminada: opsDescargaTerminada,
  } = useOperacionesFacturables<any>('cliente', STATUS_FACTURABLES, vistaOps); // eslint-disable-line @typescript-eslint/no-explicit-any -- operaciones sin tipo canónico en el tablero (antes useState<any[]>).

  const cargarOperacionesAlEntrar = useEffectEvent(() => {
    if (activeTab !== 'operaciones' && activeTab !== 'revision') return; // ✅ V00450: Revisión usa la misma lista
    if (operacionesGlobales.length > 0) return;
    // ✅ V00439 (Fase 3.x): espera el catálogo de status (los "Falso" entran en el filtro).
    if (!statusListos) return;
    if (!flagsCargadas) return; // ✅ V00443: sin esto empezaría por la descarga vieja (hasta 20,000)
    descargarOpsCompletadas();
  });
  useEffect(() => cargarOperacionesAlEntrar(), [activeTab, operacionesGlobales.length, statusListos, flagsCargadas]);
  // ✅ V00449: la tabla y las tarjetas de operaciones muestran la animación mientras baja la
  //   lista Y antes de la primera descarga (espera el catálogo de status y las banderas, y el
  //   primer pintado antes del efecto): antes se veía "No hay operaciones pendientes…" y 0.
  const mostrarCargandoOps = cargandoOperaciones || (!opsDescargaTerminada && operacionesGlobales.length === 0);

  // ✅ V00126: cualquier guardado en la colección `operaciones` (formulario,
  //   cambio de status, etc.) se refleja aquí al instante sin recargar.
  useEffect(() => {
    return suscribirOperacionGuardada((aviso) => {
      const { id, data } = aviso;
      setOperacionesGlobales(prev => {
        const idx = prev.findIndex(o => String(o.id) === String(id));
        const facturable = STATUS_FACTURABLES.includes(String((data as any).status || '').trim());
        if (idx >= 0) {
          if (!facturable) return prev.filter((_, k) => k !== idx);
          // ✅ V00451: solo los campos que cambiaron, si el aviso los dice (no pisa datos más nuevos).
          const next = [...prev]; next[idx] = { ...prev[idx], ...datosAAplicar(aviso), id: String(id) }; return next;
        }
        if (!facturable) return prev;
        return [{ id: String(id), ...data }, ...prev];
      });
    });
  }, [STATUS_FACTURABLES]);

  const recargarOperaciones = () => {
    setSeleccionadas([]);
    descargarOpsCompletadas(true);
  };

  // Refresca AMBAS colecciones (operaciones + facturas) forzando lectura desde Firestore.
  const recargarTodo = () => {
    olvidarRefsConsultadas(); // ✅ V00450: también vuelve a buscar las Ref Cliente
    recargarOperaciones();
    recargarFacturas();
  };

  // ✅ V00438 (Fase 2.4): índice de empresas por id / nombre / nombreCorto (gana
  //   la primera de la lista, igual que el .find de antes). getNombreCliente se
  //   llamaba por cada comparación del sort y por cada factura al buscar.
  const empresaPorClave = useMemo(() => {
    const m = new Map<unknown, { nombre?: string; nombreCorto?: string }>();
    empresasList.forEach((e) => {
      [e?.id, e?.nombre, e?.nombreCorto].forEach((k) => {
        if (k !== undefined && k !== null && !m.has(k)) m.set(k, e);
      });
    });
    return m;
  }, [empresasList]);

  const getNombreCliente = useCallback((idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresaPorClave.get(idOrName);
    if (found) return found.nombre || found.nombreCorto || idOrName;
    const porCatalogo = mapaCatalogos[String(idOrName)];
    return porCatalogo || idOrName;
  }, [empresaPorClave, mapaCatalogos]);

  // ✅ V00439 (Fase 3.x): se quitó la lectura de "empresas sin resolver" (las
  //   creadas después de cargar la lista o con la caché vieja): el listener en
  //   vivo de `empresas` ya las trae.

  const clientesFiltradosBuscador = useMemo(() => {
    if (!empresasList.length) return [];
    const esClientePaga = (emp: any) => {
      const tipos = emp?.tiposEmpresa;
      if (Array.isArray(tipos)) return tipos.some((t: any) => String(t).trim() === TIPO_EMPRESA.clientePaga);
      if (typeof tipos === 'string') return tipos.includes(TIPO_EMPRESA.clientePaga);
      if (tipos && typeof tipos === 'object') return Object.values(tipos).some((v: any) => String(v).trim() === TIPO_EMPRESA.clientePaga);
      return false;
    };
    const clientes = empresasList
      .filter(esClientePaga)
      .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
    if (!textoBuscarCliente.trim()) return clientes.slice(0, 30);
    const q = textoBuscarCliente.toLowerCase().trim();
    return clientes.filter((c: any) =>
      String(c.nombre || '').toLowerCase().includes(q) ||
      String(c.rfc || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [empresasList, textoBuscarCliente]);

  const nombreClienteSeleccionado = useMemo(() => {
    if (!filtroCliente || !empresasList.length) return filtroCliente || '';
    const cli = empresasList.find(e => e.id === filtroCliente);
    return cli?.nombre || filtroCliente;
  }, [filtroCliente, empresasList]);

  const opIndex = useMemo(() => {
    const m = new Map<string, { invoice: string; facturaId: string; fecha: string; clienteId: string; moneda: string }>();
    facturasGlobales.forEach((f: any) => {
      const ids = Array.isArray(f.operacionesIds) ? f.operacionesIds : [];
      ids.forEach((id: any) => {
        const k = String(id || '');
        if (k && !m.has(k)) m.set(k, { invoice: f.invoice, facturaId: f.id, fecha: f.fecha, clienteId: f.clienteId, moneda: f.monedaFacturacion });
      });
    });
    return m;
  }, [facturasGlobales]);

  // ✅ V00262: MONEDA CANÓNICA — en el catálogo solo existen DOS monedas:
  //   "Dólares" y "Pesos". USD/DÓLARES/DOLARES → Dólares; MXN/PESOS → Pesos.
  // ✅ V00439 (Fase 3.x): reconoce USD/MXN con el helper compartido (acepta las
  //   mismas formas y algunas más: 'DLS', 'M.N.'…); lo no reconocido sigue igual.
  const monedaCanonica = (val: unknown): string => {
    const s = String(val || '').trim();
    if (!s) return '';
    const comun = monedaCanonicaComun(s);
    if (comun) return nombreMoneda(comun);
    if (s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === 'n/a') return '';
    const nombre = mapaCatalogos[s];
    if (nombre && String(nombre) !== s) return monedaCanonica(nombre);
    return s;
  };

  const monedaDeCliente = (clienteId: any): string => {
    if (!clienteId) return '';
    const empresa = empresasList.find(e => e.id === clienteId);
    const idMoneda = empresa?.monedaRef || empresa?.moneda || empresa?.monedaFacturacion;
    return monedaCanonica(idMoneda); // ✅ V00262: siempre canónica
  };

  const monedaFacturaMostrar = (f: any): string => {
    // ✅ V00265 (corrige el V00262): manda la moneda EN QUE SE EMITIÓ la
    //   factura (monedaFacturacion, o el campo viejo `moneda` de importadas),
    //   siempre canónica (Dólares/Pesos). La del cliente en Empresas queda de
    //   RESPALDO para facturas sin moneda. El V00262 priorizaba Empresas y
    //   eso MEZCLABA monedas: una factura emitida en Pesos de un cliente que
    //   hoy cotiza en Dólares se sumaba al total USD con su monto en pesos —
    //   por eso los totales se veían inflados.
    const emitida = monedaCanonica(f.monedaFacturacion) || monedaCanonica(f.moneda);
    if (emitida) return emitida;
    return monedaDeCliente(f.clienteId) || 'N/A';
  };
  // ✅ V00485: el CÓDIGO (USD / MXN) de esa moneda, para el filtro de moneda del Historial.
  //   monedaFacturaMostrar devuelve el NOMBRE ("Dólares" / "Pesos"); el filtro lo comparaba con
  //   'USD' / 'MXN' y nunca coincidía (los conteos salían en 0 y elegir una moneda vaciaba la lista).
  const codigoMonedaFactura = (f: unknown): Moneda | null => monedaCanonicaComun(monedaFacturaMostrar(f));

  // ✅ V00481: la moneda de una factura es SIEMPRE la del cliente en Empresas (null si no tiene).
  const monedaClienteDe = (clienteId: unknown): Moneda | null =>
    monedaDeEmpresa(empresasList.find((e) => e.id === clienteId), 'monedaFacturacion', (id) => mapaCatalogos[id]);
  const avisoMonedaDe = (f: { clienteId?: unknown } | null | undefined): string | null =>
    f ? avisoMonedaDistinta(monedaDeFactura(f), monedaClienteDe(f.clienteId), 'cliente') : null;
  // Folios del mismo cliente que se sugieren como la factura que reemplaza a una cancelada.
  const foliosDelCliente = (f: { clienteId?: unknown; invoice?: unknown } | null | undefined): string[] => {
    const propio = String(f?.invoice || '').trim();
    return Array.from(new Set(facturasGlobales
      .filter((x) => String(x.clienteId || '') === String(f?.clienteId || '') && !estaCancelada(x.statusFactura))
      .map((x) => String(x.invoice || '').trim())
      .filter((inv) => inv && inv !== propio))).slice(0, 200);
  };
  // Total que se precarga en Editar Factura: el de la factura; si su moneda no es la del cliente,
  //   la suma de sus operaciones en la moneda del cliente (Dólares (Cliente) o Conversión Final).
  const totalEditPara = (f: { operacionesGuardadas?: unknown }, clienteId: string): number => {
    const actual = r2(totalDeGrupo(f));
    const mon = monedaClienteDe(clienteId);
    if (!mon || mon === monedaDeFactura(f)) return actual;
    const sugerido = r2(totalSugeridoEn(mon, f.operacionesGuardadas));
    return sugerido > 0 ? sugerido : actual;
  };

  const esFacturada = (op: any) => opIndex.has(String(op.id)) || !!op.facturaClienteId || !!op.facturado;

  // ✅ V00450: REF CLIENTE DUPLICADA — las pendientes de facturar cuya Ref Cliente ya existe en
  //   otra operación (de cualquier cliente) salen de "Asignar Operaciones" y van a "Revisión"
  //   hasta que se corrija la Ref o se marque "No es duplicado".
  const candidataRevision = useCallback(
    (op: Record<string, unknown>) => !(opIndex.has(String(op.id)) || !!op.facturaClienteId || !!op.facturado),
    [opIndex],
  );
  const dupRef = useRefClienteDuplicados(operacionesGlobales, {
    modulo: 'facturacionClientes',
    activo: opsDescargaTerminada && !cargandoOperaciones && !cargandoFacturas, // con las facturas: "pendiente" depende de ellas
    candidata: candidataRevision,
  });
  const enRevisionRef = dupRef.enRevision;
  const opsEnRevision = useMemo(
    () => operacionesGlobales.filter((op) => enRevisionRef.has(idDeLista(op))),
    [operacionesGlobales, enRevisionRef],
  );
  // Una seleccionada que pasó a Revisión deja de estar seleccionada (no se puede facturar).
  const [revisionAnterior, setRevisionAnterior] = useState(enRevisionRef);
  if (revisionAnterior !== enRevisionRef) {
    setRevisionAnterior(enRevisionRef);
    const idsLista = new Set(opsEnRevision.map((op) => String(op.id)));
    if (seleccionadas.some((id) => idsLista.has(id))) setSeleccionadas(seleccionadas.filter((id) => !idsLista.has(id)));
  }
  const revisionPedida = usePestanaPedida('facturacionClientes');
  const abrirRevision = useEffectEvent(() => {
    pestanaAtendida('facturacionClientes');
    setActiveTab('revision');
  });
  useEffect(() => { if (revisionPedida) abrirRevision(); }, [revisionPedida]);
  // No se factura una operación en Revisión ni una cuya Ref todavía se está verificando
  //   (lista o facturas cargando, consulta en camino). Devuelve el aviso o ''.
  const bloqueoPorRevision = (ops: readonly Record<string, unknown>[]): string => {
    const enRev = ops.filter((op) => enRevisionRef.has(idDeLista(op)));
    if (enRev.length) return `Estas operaciones tienen una Ref Cliente duplicada y están en la pestaña Revisión; no se pueden facturar hasta revisarlas:\n${enRev.map((op) => `${String(op.ref ?? op.id)} (${String(op.refCliente ?? '')})`).join(', ')}`;
    const pendientes = ops.filter((op) => dupRef.pendienteDeVerificar(op));
    if (pendientes.length) return `Se está verificando la Ref Cliente de ${pendientes.map((op) => String(op.ref ?? op.id)).join(', ')}. Intenta de nuevo en unos segundos.`;
    return '';
  };
  const opsDeSeleccion = (): Record<string, unknown>[] =>
    seleccionadas.map((id) => operacionesGlobales.find((o) => String(o.id) === id)).filter((o): o is Record<string, unknown> => !!o);
  const alMarcarNoDuplicado = (clave: string, hechas: readonly OpRefResumen[]): void => {
    const ids = new Set(hechas.map((r) => r.id));
    const refs = new Set(hechas.map((r) => r.ref).filter(Boolean));
    setOperacionesGlobales((prev) => prev.map((o: Record<string, unknown>) => (
      claveRefCliente(o.refCliente) === clave && (ids.has(idDeLista(o)) || refs.has(String(o.ref ?? '')))
        ? { ...o, refClienteRevisado: clave } : o)));
  };
  const invoiceDeOp = (op: any): string => op.facturaClienteInvoice || opIndex.get(String(op.id))?.invoice || '';

  const clienteFacturaId = useMemo(() => {
    if (filtroCliente) return filtroCliente;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = op?.clientePaga || op?.clienteId;
      if (c) ids.add(String(c));
    });
    return ids.size === 1 ? [...ids][0] : '';
  }, [filtroCliente, seleccionadas, operacionesGlobales]);

  const seleccionMultiCliente = useMemo(() => {
    if (filtroCliente) return false;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = op?.clientePaga || op?.clienteId;
      if (c) ids.add(String(c));
    });
    return ids.size > 1;
  }, [filtroCliente, seleccionadas, operacionesGlobales]);

  const nombreClienteFactura = useMemo(() => {
    if (!clienteFacturaId) return '';
    const porCatalogo = getNombreCliente(clienteFacturaId);
    if (porCatalogo && porCatalogo !== clienteFacturaId) return porCatalogo;
    const op = operacionesGlobales.find(o => String(o.clientePaga || o.clienteId || '') === clienteFacturaId);
    return op?.clienteNombre || op?.nombreCliente || clienteFacturaId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteFacturaId, empresasList, operacionesGlobales]);

  // ✅ V00481: SIEMPRE la moneda del cliente en Empresas ('USD' / 'MXN'); sin ella no se factura
  //   (antes caía a la moneda de una operación o a lo que tuviera el campo).
  const monedaFacturacion = useMemo((): 'USD' | 'MXN' | '' => {
    if (!clienteFacturaId) return '';
    return monedaDeEmpresa(empresasList.find(e => e.id === clienteFacturaId), 'monedaFacturacion', (id) => mapaCatalogos[id]) ?? '';
  }, [clienteFacturaId, empresasList, mapaCatalogos]);

  const formatearValorGenericoOp = (val: any, tipo?: string): string => {
    if (val === '' || val === null || val === undefined) return '-';
    switch (tipo) {
      case 'monto':     return formatoMoneda(val);
      case 'numero':    return String(val);
      case 'fecha':     return formatearFechaSpanish(String(val));
      case 'fechaHora': return formatearFechaHora(String(val));
      case 'moneda':    return mostrarMoneda(String(val));
      default:          return String(resolverNombre(val));
    }
  };

  // ──────────────────────────────────────────────────────────────────
  // ✅ (# REMOLQUE) El valor del remolque CONCATENA el # de caja con la
  //    placa (p. ej. "PLT.51 187-WN7"). Solo interesa el # de CAJA, que es
  //    el PRIMER token. Si una factura tiene varias operaciones con cajas
  //    DIFERENTES, se muestran todas con un indicador "≠".
  // ──────────────────────────────────────────────────────────────────
  // ✅ V00438 (Fase 2.4): useCallback (dependencia de las claves de orden).
  const cajaDeTexto = useCallback((valor: any): string => {
    const r = resolverNombre(valor);
    const tokens = String(r ?? '')
      .split(/[\s,|]+/)
      .map(t => t.trim())
      .filter(t => t && t !== '-' && /[A-Za-z0-9]/.test(t));
    return tokens[0] || '';
  }, [resolverNombre]);

  // # de caja de una OPERACIÓN (primer campo con valor: nombre → placa → número).
  const remolqueOpTokens = useCallback((op: any): string[] => {
    const cands = [op?.remolqueNombre, op?.remolquePlaca, op?.numeroRemolque, op?.remolque];
    for (const c of cands) {
      if (c !== undefined && c !== null && c !== '') {
        const caja = cajaDeTexto(c);
        if (caja) return [caja];
      }
    }
    return [];
  }, [cajaDeTexto]);

  // ✅ Número de caja (# remolque) de una operación de la factura: usa el valor
  //    guardado en el resumen y, si falta (facturas viejas), cae al opInfoMap
  //    que se resuelve bajo demanda.
  const remolqueDeOp = (op: any): string => {
    const directo = String(op?.remolque || '').trim();
    if (directo && directo !== '-') return directo;
    const info = opInfoMap[String(op?.id || '')];
    const resuelto = String(info?.remolque || '').trim();
    return resuelto && resuelto !== '-' ? resuelto : '';
  };

  // # de caja de una FACTURA: una caja por operación, sin repetir.
  const remolquesFacturaTokens = (f: any): string[] => {
    const cajas: string[] = [];
    const vistos = new Set<string>();
    const agregar = (valor: any) => {
      const caja = cajaDeTexto(valor);
      if (!caja) return;
      const k = caja.toUpperCase();
      if (!vistos.has(k)) { vistos.add(k); cajas.push(caja); }
    };
    (Array.isArray(f?.operacionesGuardadas) ? f.operacionesGuardadas : []).forEach((op: any) => agregar(remolqueDeOp(op)));
    if (cajas.length === 0 && Array.isArray(f?.remolques)) f.remolques.forEach((r: any) => agregar(r));
    return cajas;
  };

  // Render compartido: 1 caja → una sola; varias (ops con cajas distintas) → todas + "≠".
  const renderRemolqueTokens = (tokens: string[]) => {
    if (tokens.length === 0) return <span className="fcd-x1">-</span>;
    if (tokens.length === 1) return <span className="fcd-x2">{tokens[0]}</span>;
    return (
      <span className="fcd-x3" title="Las operaciones de esta factura tienen números de caja diferentes">
        <span className="fcd-x2">{tokens.join(' / ')}</span>
        <span className="fcd-x4">≠</span>
      </span>
    );
  };
  // Texto plano para exportar a Excel.
  const remolqueTokensTexto = (tokens: string[]): string =>
    tokens.length === 0 ? '' : (tokens.length === 1 ? tokens[0] : `${tokens.join(' / ')} (≠)`);

  const valorOrdenOp = useCallback((op: any, campo: string): string | number => {
    switch (campo) {
      case 'factura': return String(op.facturaClienteInvoice || '').toLowerCase();
      case 'ref': return refNaturalKey(op);
      case 'fechaServicio': return fechaOrdenKey(op.fechaServicio || op.createdAt);
      case 'remolque': return remolqueOpTokens(op).join(' ').toLowerCase();
      case 'cliente': return getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId).toLowerCase();
      case 'destino': return String(op.destinoNombre || op.destino || '').toLowerCase();
      case 'subtotal': return obtenerMontoOperacion(op).subtotal;
      case 'total': return obtenerMontoOperacion(op).total;
      case 'conv': return obtenerMontoOperacion(op).conv;
      default: {
        const col = columnasOps.find(c => c.id === campo);
        const raw = valorGenericoOp(op, col);
        if (col?.tipo === 'monto' || col?.tipo === 'numero') return Number(raw) || 0;
        return String(resolverNombre(raw) || '').toLowerCase();
      }
    }
  }, [getNombreCliente, remolqueOpTokens, columnasOps, resolverNombre]);

  // ✅ V00438 (Fase 2.4): claves de orden calculadas UNA vez por (datos, columna),
  //   alineadas por índice con operacionesGlobales. Antes cada comparación del
  //   sort (hasta 20k ops) recalculaba fechas, montos y nombres, y se repetía en
  //   cada tecla del buscador.
  const clavesOrdenOps = useMemo(
    () => operacionesGlobales.map((op) => ({ clave: valorOrdenOp(op, ordenOps.campo), ref: refNaturalKey(op) })),
    [operacionesGlobales, ordenOps.campo, valorOrdenOp],
  );

  const dentroRangoFecha = (op: any) => {
    if (!fechaDesdeOps && !fechaHastaOps) return true;
    const f = String(op.fechaServicio || op.createdAt || '').slice(0, 10);
    if (!f) return false;
    if (fechaDesdeOps && f < fechaDesdeOps) return false;
    if (fechaHastaOps && f > fechaHastaOps) return false;
    return true;
  };

  const coincideClienteOp = (op: any) => !filtroCliente || String(op.clientePaga || op.clienteId || '') === filtroCliente;

  const tipoOpNombre = (op: any): string => txt(op.tipoOperacionNombre, op.tipoOperacionId);
  const tiposOperacionDisponibles = useMemo(() => {
    const set = new Set<string>();
    operacionesGlobales.forEach(op => {
      const t = tipoOpNombre(op);
      if (t && t !== '-') set.add(t);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, mapaCatalogos]);
  const coincideTipoOp = (op: any) => !filtroTipoOp || tipoOpNombre(op) === filtroTipoOp;

  // ✅ V00126: moneda en la que se factura la operación (USD / MXN / '')
  //   ✅ V00439 (Fase 3.x): helper compartido (ID del catálogo, código o nombre).
  //   ✅ V00489: la misma fuente que la regla de dinero (el ID; el nombre copiado solo si el ID no se reconoce).
  const monedaFacturacionOp = (op: any): 'USD' | 'MXN' | '' => monedaFacturaOperacion(op, 'cliente') ?? '';
  const resumenMonedaOps = useMemo(() => {
    const base = operacionesGlobales.filter(op => !enRevisionRef.has(idDeLista(op)) && dentroRangoFecha(op) && coincideClienteOp(op) && coincideTipoOp(op) && (vistaOps === 'todas' || (vistaOps === 'facturadas') === esFacturada(op))); // ✅ V00450: sin las de Revisión
    return { usd: base.filter(op => monedaFacturacionOp(op) === 'USD').length, mxn: base.filter(op => monedaFacturacionOp(op) === 'MXN').length, todas: base.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, fechaDesdeOps, fechaHastaOps, filtroCliente, filtroTipoOp, vistaOps, facturasGlobales, enRevisionRef]);

  const operacionesMostradas = useMemo(() => {
    const q = textoBuscarRemolqueOpsDiferido.trim().toLowerCase();
    const coincide = (op: any) => {
      if (!q) return true;
      const campos = [
        op.remolqueNombre, op.remolquePlaca, op.numeroRemolque, op.remolque,
        op.numReferencia, op.referencia, op.ref, invoiceDeOp(op), op.refCliente,
        op.clienteNombre, op.proveedorUnidadNombre, op.origenNombre, op.destinoNombre,
        op.observacionesEjecutivo,
      ];
      return campos.some(v => String(v ?? '').toLowerCase().includes(q));
    };
    const coincideMonedaVista = (op: any) => monedaVistaOps === 'todas' || monedaFacturacionOp(op) === monedaVistaOps;
    const coincideVista = (op: any) => {
      if (vistaOps === 'todas') return true;
      if (vistaOps === 'facturadas') return esFacturada(op);
      return !esFacturada(op);
    };
    // ✅ V00438 (Fase 2.4): se filtran ÍNDICES y se ordenan con las claves ya
    //   calculadas (mismo comparador y sort estable → mismo orden que antes).
    const indices: number[] = [];
    operacionesGlobales.forEach((op, i) => {
      if (enRevisionRef.has(idDeLista(op))) return; // ✅ V00450: Ref Cliente duplicada → pestaña Revisión
      if (dentroRangoFecha(op) && coincideClienteOp(op) && coincideTipoOp(op) && coincideVista(op) && coincideMonedaVista(op) && coincide(op)) indices.push(i);
    });
    const dir = ordenOps.dir === 'asc' ? 1 : -1;
    indices.sort((ia, ib) => {
      const a = clavesOrdenOps[ia];
      const b = clavesOrdenOps[ib];
      let cmp = (typeof a.clave === 'number' && typeof b.clave === 'number') ? (a.clave - b.clave) : String(a.clave).localeCompare(String(b.clave));
      cmp *= dir;
      if (cmp !== 0) return cmp;
      return a.ref.localeCompare(b.ref);
    });
    return indices.map((i) => operacionesGlobales[i]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, clavesOrdenOps, ordenOps.dir, fechaDesdeOps, fechaHastaOps, mapaCatalogos, vistaOps, monedaVistaOps, textoBuscarRemolqueOpsDiferido, facturasGlobales, filtroCliente, filtroTipoOp, enRevisionRef]);

  const resumenOps = useMemo(() => {
    const enRango = operacionesGlobales.filter(op => !enRevisionRef.has(idDeLista(op)) && dentroRangoFecha(op) && coincideClienteOp(op) && coincideTipoOp(op)); // ✅ V00450: sin las de Revisión
    const facturadas = enRango.filter(op => esFacturada(op)).length;
    const total = enRango.length;
    const porFacturar = total - facturadas;
    return { porFacturar, facturadas, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, fechaDesdeOps, fechaHastaOps, facturasGlobales, filtroCliente, filtroTipoOp, enRevisionRef]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const renderCeldaOps = (op: any, key: string, m: any) => {
    const tdBase: React.CSSProperties = { padding: '10px 12px', color: '#c9d1d9', whiteSpace: 'nowrap' }; // ✅ V00482: filas más bajas
    switch (key) {
      case 'factura': {
        const inv = invoiceDeOp(op);
        if (inv) return <td className="fcd-x5" key={key}><span className="fcd-x6">{inv}</span></td>;
        return <td className="fcd-x5" key={key}><span className="fcd-x7">Por facturar</span></td>;
      }
      case 'ref': return <td className="fcd-x8" key={key}>{op.numReferencia || op.referencia || op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'remolque': return <td key={key} style={tdBase}>{renderRemolqueTokens(remolqueOpTokens(op))}</td>;
      case 'cliente': return <td key={key} style={tdBase}>{getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId)}</td>;
      case 'cartaPorte': return <td key={key} style={tdBase}>{op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destinoNombre || op.destino || '-'}</td>;
      // ✅ V00481: Pesos en verde y Dólares en azul (antes al revés); subtotal y total en la moneda en que se factura.
      case 'moneda': return <td key={key} style={tdBase}><NombreMoneda moneda={monedaFacturaOperacion(op, 'cliente')} respaldo={textoFacturadoEn(op, 'cliente')} /></td>;
      case 'subtotal': return <td key={key} style={tdBase}><Importe monto={m.subtotal} moneda={monedaFacturacionOp(op)} /></td>;
      case 'total': return <td key={key} style={tdBase}><Importe monto={m.total} moneda={monedaFacturacionOp(op)} className="fcd-total-op" /></td>;
      case 'dolares': return <td key={key} style={tdBase}><Importe monto={m.dol} moneda="USD" /></td>;
      case 'pesos': return <td key={key} style={tdBase}><Importe monto={m.pes} moneda="MXN" /></td>;
      case 'conv': return <td className="fcd-x9" key={key}><Importe monto={m.conv} moneda="MXN" /></td>;
      default: {
        const col = columnasOps.find(c => c.id === key);
        const text = formatearValorGenericoOp(valorGenericoOp(op, col), col?.tipo);
        if (col?.tipo === 'monto') return <td key={key} style={{ ...tdBase, color: '#3fb950' }}>{text}</td>;
        if (col?.tipo === 'numero') return <td key={key} style={{ ...tdBase, textAlign: 'right' as const }}>{text}</td>;
        const long = (col?.tipo === 'texto') && typeof text === 'string' && text.length > 60;
        if (long) return <td key={key} style={{ ...tdBase, whiteSpace: 'normal', maxWidth: '320px' }}>{text}</td>;
        return <td key={key} style={tdBase}>{text}</td>;
      }
    }
  };

  const handleDragStartOps = (_e: React.DragEvent, index: number) => setDraggedColOpsIndex(index);
  const handleDragEnterOps = (index: number) => {
    if (draggedColOpsIndex === null || draggedColOpsIndex === index) return;
    const nuevas = [...columnasOps];
    const movida = nuevas.splice(draggedColOpsIndex, 1)[0];
    nuevas.splice(index, 0, movida);
    setDraggedColOpsIndex(index);
    setColumnasOps(nuevas);
  };
  const toggleColumnaVisibleOps = (index: number) => {
    const nuevas = [...columnasOps];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasOps(nuevas);
  };

  // ✅ (E) Exportación PROFESIONAL a Excel (ExcelJS con estilos + logo).
  const exportarExcelOps = async () => {
    if (operacionesMostradas.length === 0) return alert('No hay operaciones para exportar con los filtros actuales.');
    const cols = columnasOps.filter(c => c.visible);
    if (cols.length === 0) return alert('Selecciona al menos una columna para exportar.');

    const tipoExcel = (c: any): 'texto' | 'fecha' | 'fechaHora' | 'monto' | 'numero' => {
      if (['subtotal', 'dolares', 'pesos', 'conv'].includes(c.id)) return 'monto';
      if (c.id === 'fechaServicio') return 'fecha';
      if (c.tipo === 'monto') return 'monto';
      if (c.tipo === 'numero') return 'numero';
      if (c.tipo === 'fecha') return 'fecha';
      if (c.tipo === 'fechaHora') return 'fechaHora';
      return 'texto';
    };
    const columnas = cols.map(c => ({ key: c.id, label: c.label, tipo: tipoExcel(c) }));

    const valorRaw = (op: any, key: string, m: any): any => {
      switch (key) {
        case 'factura': { const inv = invoiceDeOp(op); return inv || (esFacturada(op) ? 'Facturada' : 'Por facturar'); }
        case 'ref': return op.numReferencia || op.referencia || op.ref || op.id;
        case 'fechaServicio': return op.fechaServicio || op.createdAt || '';
        case 'remolque': return remolqueTokensTexto(remolqueOpTokens(op));
        case 'cliente': return getNombreCliente(op.clientePaga || op.clientePagaId || op.clienteId);
        case 'cartaPorte': return op.cartaPorte || op.numeroCartaPorte || op.numDoda || '';
        case 'destino': return op.destinoNombre || op.destino || '';
        case 'moneda': return textoFacturadoEn(op, 'cliente'); // ✅ V00489
        case 'subtotal': return Number(m.subtotal) || 0;
        case 'total': return Number(m.total) || 0;
        case 'dolares': return Number(m.dol) || 0;
        case 'pesos': return Number(m.pes) || 0;
        case 'conv': return Number(m.conv) || 0;
        default: {
          const col = columnasOps.find(c => c.id === key);
          const raw = valorGenericoOp(op, col);
          if (col?.tipo === 'monto' || col?.tipo === 'numero') return Number(raw) || 0;
          if (col?.tipo === 'fecha' || col?.tipo === 'fechaHora') return raw || '';
          return String(resolverNombre(raw) ?? '');
        }
      }
    };

    const filas = operacionesMostradas.map(op => {
      const m = obtenerMontoOperacion(op);
      const fila: any = {};
      cols.forEach(c => { fila[c.id] = valorRaw(op, c.id, m); });
      return fila;
    });

    const cliTxt = filtroCliente ? (nombreClienteSeleccionado || 'Cliente') : 'Todos los clientes';
    const rangoTxt = (fechaDesdeOps || fechaHastaOps) ? `${fechaDesdeOps || 'inicio'} a ${fechaHastaOps || 'hoy'}` : 'Todas las fechas';
    const vistaTxt = vistaOps === 'facturadas' ? 'Facturadas' : vistaOps === 'todas' ? 'Todas' : 'Pendientes';
    const cliFile = cliTxt.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);

    try {
      await exportarExcelProfesional({
        nombreArchivo: `Facturacion_Operaciones_${vistaTxt}_${cliFile}_${hoyLocalISO()}.xlsx`,
        tituloReporte: 'Reporte de Facturación · Operaciones',
        subtitulo: `${vistaTxt}  ·  Cliente: ${cliTxt}  ·  ${rangoTxt}  ·  ${filas.length} operaciones`,
        nombreHoja: 'Operaciones',
        columnas,
        filas,
      });
    } catch (e) {
      console.error('Error exportando Excel de operaciones:', e);
      alert('No se pudo generar el Excel.');
    }
  };

  const toggleSeleccion = (id: string) => {
    const op = operacionesGlobales.find(o => o.id === id);
    if (op && esFacturada(op)) return;
    setSeleccionadas(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]);
  };

  const abrirModalCostoAdic = () => {
    setCostoAdicOpId(seleccionadas.length > 0 ? seleccionadas[0] : '');
    setCostoAdicMonto(''); setCostoAdicConcepto(''); setModalCostoAdic(true);
  };
  const abrirCostoAdicParaOp = (opId: string) => {
    setCostoAdicOpId(opId);
    setCostoAdicMonto(''); setCostoAdicConcepto(''); setModalCostoAdic(true);
  };

  const handleGuardarCostoAdic = async () => {
    const op = operacionesGlobales.find(o => o.id === costoAdicOpId);
    if (!op) return alert('Selecciona una operación.');
    const monto = Number(costoAdicMonto);
    if (!monto || isNaN(monto)) return alert('Captura un monto válido (puede ser negativo para un descuento).');
    setGuardandoCostoAdic(true);
    try {
      const nuevoCargos = (Number(op.cargosAdicionales) || 0) + monto;
      const { subtotal, dol, pes, conv } = calcularConversionCliente({ ...op, cargosAdicionales: nuevoCargos });
      const concepto = costoAdicConcepto.trim();
      const updates: any = {
        cargosAdicionales: nuevoCargos,
        subtotalCliente: subtotal,
        dolaresCliente: dol,
        pesosCliente: pes,
        conversionCliente: conv,
      };
      if (concepto) {
        const obsPrev = String(op.observacionesCobrar || '').trim();
        updates.observacionesCobrar = `${obsPrev ? obsPrev + ' | ' : ''}Costo adicional: ${concepto} (${monto >= 0 ? '+' : ''}${monto})`;
      }
      await setDoc(doc(db, 'operaciones', idRealOp(op.id)), updates, { merge: true }); // ✅ V00451: id real
      setOperacionesGlobales(prev => prev.map(o => o.id === op.id ? { ...o, ...updates } : o));
      setModalCostoAdic(false);
    } catch (e) {
      console.error('Error guardando costo adicional:', e);
      alert('No se pudo guardar el costo adicional.');
    } finally {
      setGuardandoCostoAdic(false);
    }
  };

  const resumenSeleccion = useMemo(() => {
    let subtotal = 0;
    const refs: string[] = [];
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      if (op) {
        subtotal += obtenerMontoOperacion(op).conv;
        refs.push(op.numReferencia || op.referencia || op.ref || op.id?.substring(0, 6));
      }
    });
    return { subtotal, refs };
  }, [seleccionadas, operacionesGlobales]);
  // ✅ V00481: lo que se va a facturar EN LA MONEDA DEL CLIENTE: Dólares → Dólares (Cliente);
  //   Pesos → Conversión Final (la misma regla del total de la factura).
  const totalSeleccionEnMoneda = useMemo(() => {
    const renglones = seleccionadas.map((id) => operacionesGlobales.find((o) => o.id === id)).filter(Boolean).map((op) => {
      const m = obtenerMontoOperacion(op);
      return { monto: m.conv, dol: m.dol, pes: m.pes, subtotalBase: m.subtotal };
    });
    return monedaFacturacion ? totalNativoDeOperaciones(monedaFacturacion, renglones) : 0; // la misma regla con que se guarda el total
  }, [seleccionadas, operacionesGlobales, monedaFacturacion]);

  // ✅ Fase 1.8: la factura FRESCA del servidor (facturasGlobales puede tener
  //   hasta 30 min), con la misma forma que la lista. null si ya no existe.
  const leerFacturaFresca = async (id: string) => {
    const snap = await getDoc(doc(db, 'facturas_clientes', String(id)));
    return snap.exists() ? normalizarFactura({ id: snap.id, ...snap.data() }) : null;
  };
  // ✅ V00451: id REAL del documento de una operación. La lista usa el campo `id` guardado si lo
  //   tiene (operaciones importadas): escribir con ese id fallaba ("Error al guardar la factura") o
  //   creaba un documento suelto, y la operación seguía "pendiente".
  const idRealOp = (id: unknown): string => {
    const op = operacionesGlobales.find((o) => String(o.id) === String(id));
    return op ? String(op._docId ?? op.id) : String(id);
  };

  // ✅ V00441 (Fase 5): campos de una factura editada (para fusionarlos en la ficha
  //   o el grupo abiertos sin pisar sus operaciones agrupadas).
  const camposEditadosFactura = (f: Record<string, unknown>) => {
    const claves = ['invoice', 'fecha', 'facturaCcp', 'statusFactura', 'monedaFacturacion', 'clienteId', 'clienteNombre',
      'subtotalFactura', 'subtotalMonedaFactura', 'saldoPendiente', 'statusPago', 'totalManualCentavos', 'updatedAt'];
    return Object.fromEntries(claves.filter((k) => k in f).map((k) => [k, f[k]]));
  };

  const handleGuardarFactura = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceForm.trim()) return alert('El # de Invoice es obligatorio.');
    // ✅ V00451: sin operaciones no se crea nada (antes, tras refrescar la lista, se podía crear una factura vacía).
    if (seleccionadas.length === 0) return alert('Selecciona al menos una operación para facturar.');
    if (seleccionMultiCliente || !clienteFacturaId) {
      return alert('Las operaciones seleccionadas deben ser de un mismo cliente. Selecciona un cliente en el filtro o elige operaciones de un solo cliente.');
    }
    // ✅ Fase 1.8: 1 escritura por operación + la factura; avisar antes de que falle el commit.
    if (seleccionadas.length + 1 > MAX_ESCRITURAS_LOTE) return alert(avisoLoteGrande(seleccionadas.length + 1));
    const bloqueo = bloqueoPorRevision(opsDeSeleccion()); // ✅ V00450
    if (bloqueo) return alert(bloqueo);
    // ✅ V00481: la moneda es la del cliente en Empresas y es obligatoria.
    if (monedaFacturacion !== 'USD' && monedaFacturacion !== 'MXN') return alert(avisoSinMoneda('cliente'));
    if (estaCancelada(statusFacturaForm)) return alert('Una factura nueva no se crea Cancelada: se cancela después desde su ficha.');
    // ✅ V00279: el documento NO es obligatorio para facturar — sin adjunto se
    //   factura directo y la fila queda con ⚠ como recordatorio visual.
    setGuardando(true);
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, factura el SERVIDOR (transacción).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('facturarOperaciones', {
          lado: 'cliente', empresaId: clienteFacturaId, empresaNombre: nombreClienteFactura || getNombreCliente(clienteFacturaId),
          invoice: invoiceForm.trim(), fecha: fechaForm, facturaCcp: facturaCcpForm.trim(), statusFactura: statusFacturaForm,
          moneda: monedaFacturacion === 'USD' || monedaFacturacion === 'MXN' ? monedaFacturacion : '', operacionesIds: seleccionadas,
        });
        const idFactura = String(r.facturaId || '');
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura));
        setOperacionesGlobales(prev => aplicarOperaciones(prev, r.operaciones));
        // ✅ V00451: documentos (varios); si el folio ya existía, se agregan a los suyos.
        const docsNuevos = await subirDocsAlFacturar(idFactura, invoiceForm.trim() || idFactura);
        if (Object.keys(docsNuevos).length > 0) setFacturasGlobales(prev => aplicarEscriturasDocs(prev, [{ id: idFactura, campos: docsNuevos }]));
        setModalAbierto(false);
        setSeleccionadas([]);
        setInvoiceForm('');
        setFacturaCcpForm('');
        setStatusFacturaForm('Facturado');
        setActiveTab('historial');
        return;
      }
      const batch = writeBatch(db);
      const nuevoId = doc(collection(db, 'facturas_clientes')).id;
      const operacionesResumenEstable = seleccionadas.map(id => {
        const op = operacionesGlobales.find(o => o.id === id);
        const montos = op ? obtenerMontoOperacion(op) : { subtotal: 0, conv: 0, dol: 0, pes: 0 };
        return {
          id,
          ref: op?.numReferencia || op?.referencia || op?.ref || id.substring(0, 6),
          monto: montos.conv,
          subtotalBase: montos.subtotal,
          dol: montos.dol,   // ✅ FIX MONEDA
          pes: montos.pes,   // ✅ FIX MONEDA
          convenioNombre: String((op?.convenioNombre || op?.convenioClienteNombre) || ''), // ✅ NUEVO: convenio revisable
          refCliente: String(op?.refCliente || ''), // ✅ NUEVO: Ref Cliente en el historial
          remolque: op ? txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque) : '',
        };
      });
      // ✅ FIX MONEDA: total en la moneda de la factura (no la conversión).
      // ✅ FIX: el total en la moneda de la factura depende de EN QUÉ se
      //   factura, no de la moneda del convenio: USD -> suma de dólares;
      //   MXN -> suma de la conversión (dólares × TC + pesos directos).
      const subtotalMonedaFactura = totalNativoFactura({
        monedaFacturacion,
        operacionesGuardadas: operacionesResumenEstable,
      });
      const remolquesFactura = Array.from(new Set(
        operacionesResumenEstable.map((o: any) => String(o.remolque || '')).filter(r => r && r !== '-')
      ));
      // Moneda para el esquema de facturación: ID + nombre legible.
      const monedaIdFactura = monedaFacturacion === 'MXN' ? ID_MXN : (monedaFacturacion === 'USD' ? ID_USD : '');
      const operacionesRefs = operacionesResumenEstable.map((o: any) => o.ref).filter(Boolean);

      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        statusFactura: statusFacturaForm,
        clienteId: clienteFacturaId,
        clienteNombre: nombreClienteFactura || getNombreCliente(clienteFacturaId),
        monedaFacturacion,
        monedaId: monedaIdFactura,                 // ← campo de la colección
        operacionesIds: seleccionadas,
        operaciones: operacionesRefs,              // ← campo de la colección (refs)
        operacionesGuardadas: operacionesResumenEstable,
        remolques: remolquesFactura,
        subtotalFactura: r2(resumenSeleccion.subtotal),
        subtotalMonedaFactura, // ✅ FIX MONEDA: lo que se cobra en la moneda de la factura
        createdAt: new Date().toISOString(),
      };
      const invKey = invoiceForm.trim().toLowerCase();
      const coincideInvoice = (f: { invoice?: unknown; clienteId?: unknown }) =>
        String(f.invoice || '').trim().toLowerCase() === invKey &&
        String(f.clienteId || '') === String(clienteFacturaId);
      const existenteCache = facturasGlobales.find(coincideInvoice);
      // ✅ Fase 1.8: se fusiona contra la factura FRESCA (sus operacionesIds /
      //   operacionesGuardadas actuales), no contra la copia en memoria.
      const fresca = existenteCache ? await leerFacturaFresca(existenteCache.id) : null;
      // ✅ V00451: si no está en la lista cargada se busca en el SERVIDOR (antes se creaba otra
      //   factura con el mismo folio y el documento quedaba escondido en esa segunda).
      const existente = fresca && coincideInvoice(fresca) ? fresca : await facturaExistenteFresca('cliente', invoiceForm, String(clienteFacturaId));
      // ✅ V00451: ninguna operación puede estar ya facturada según el SERVIDOR (otra persona u
      //   otra pestaña pudo facturarla después de que se cargó esta lista).
      const yaFacturadas = await operacionesYaFacturadas('cliente', opsDeSeleccion().map((op) => ({
        idLista: String(op.id), idReal: idDeLista(op), ref: String(op.ref ?? op.numReferencia ?? op.id ?? ''),
      })), existente ? String(existente.id) : undefined);
      if (yaFacturadas.length > 0) {
        alert(avisoYaFacturadas(yaFacturadas));
        setModalAbierto(false); // ✅ V00451: la selección ya no vale; se cierra antes de refrescar
        setSeleccionadas([]);
        recargarTodo();
        return;
      }
      let docId = nuevoId;
      let facturaResultante: any = data;
      if (existente) {
        docId = existente.id;
        const idsPrev: string[] = Array.isArray(existente.operacionesIds) ? existente.operacionesIds.map(String) : [];
        const idsUnion = Array.from(new Set([...idsPrev, ...seleccionadas]));
        const guardadasPrev: any[] = Array.isArray(existente.operacionesGuardadas) ? existente.operacionesGuardadas : [];
        const mapaGuardadas = new Map<string, any>();
        [...guardadasPrev, ...operacionesResumenEstable].forEach((o: any) => { if (o?.id) mapaGuardadas.set(String(o.id), o); });
        const guardadasUnion = Array.from(mapaGuardadas.values());
        const remolquesUnion = Array.from(new Set([
          ...(Array.isArray(existente.remolques) ? existente.remolques : []),
          ...remolquesFactura,
        ].map((r: any) => String(r || '')).filter(r => r && r !== '-')));
        const monedaMerge = existente.monedaFacturacion || monedaFacturacion;
        // ✅ Fase 1.8: subtotalMonedaFactura se recalcula con TODAS las operaciones
        //   de la factura (antes se quedaba con el total anterior al merge).
        const totales = totalesTrasCambioDeOps({ ...existente, monedaFacturacion: monedaMerge }, guardadasUnion);
        if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
        const merge = {
          invoice: existente.invoice || invoiceForm.trim(),
          facturaCcp: facturaCcpForm.trim() || existente.facturaCcp || '',
          statusFactura: statusFacturaForm || existente.statusFactura || 'Facturado',
          clienteId: clienteFacturaId,
          clienteNombre: existente.clienteNombre || data.clienteNombre,
          monedaFacturacion: monedaMerge,
          monedaId: existente.monedaId || monedaIdFactura,
          operacionesIds: idsUnion,
          operaciones: guardadasUnion.map((o: any) => o.ref).filter(Boolean),
          operacionesGuardadas: guardadasUnion,
          remolques: remolquesUnion,
          ...totales.campos, // subtotalFactura + subtotalMonedaFactura (+ saldo si ya tiene pagos)
          updatedAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_clientes', docId), merge, { merge: true });
        facturaResultante = { ...existente, ...merge };
      } else {
        batch.set(doc(db, 'facturas_clientes', docId), data);
      }
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', idRealOp(id)), { // ✅ V00451: id real
          facturaClienteId: docId,
          facturaClienteInvoice: invoiceForm.trim(),
          facturado: true,
        });
      });
      await batch.commit();
      // ✅ V00276: el documento adjuntado se sube ya con el id real de la factura.
      // ✅ V00390: los datos del documento se guardan también en la fila NUEVA del
      //   historial (antes la fila se agregaba DESPUÉS de subirlo y quedaba sin él).
      // ✅ V00451: varios documentos; si se fusionó con un folio existente, se AGREGAN a los suyos.
      const docSubido = await subirDocsAlFacturar(docId, invoiceForm.trim() || docId);
      setModalAbierto(false);
      const idsFacturadas = [...seleccionadas];
      const invoiceTrim = invoiceForm.trim();
      setSeleccionadas([]);
      setInvoiceForm('');
      setFacturaCcpForm('');
      setStatusFacturaForm('Facturado');
      setOperacionesGlobales(prev => prev.map(op =>
        idsFacturadas.includes(op.id) ? { ...op, facturaClienteId: docId, facturaClienteInvoice: invoiceTrim, facturado: true } : op
      ));
      avisarOpsFacturacion(idsFacturadas, { facturaClienteId: docId, facturaClienteInvoice: invoiceTrim, facturado: true }); // ✅ V00451
      setFacturasGlobales(prev => {
        if (existente) {
          // ✅ V00451: la existente pudo llegar del servidor sin estar en la lista.
          if (!prev.some(f => f.id === docId)) return [normalizarFactura({ ...facturaResultante, ...docSubido, id: docId }), ...prev];
          return prev.map(f => f.id === docId ? normalizarFactura({ ...facturaResultante, ...docSubido, id: docId }) : f);
        }
        // La copia en memoria que ya no existe (o cambió de invoice) se refresca.
        const resto = existenteCache && !fresca ? prev.filter(f => f.id !== existenteCache.id)
          : existenteCache && fresca ? prev.map(f => f.id === fresca.id ? fresca : f) : prev;
        return [normalizarFactura({ ...data, ...docSubido, id: docId }), ...resto];
      });
      setActiveTab('historial');
    } catch (error) {
      console.error(error);
      alert(mensajeDinero(error, 'Error al guardar la factura.'));
    } finally {
      setGuardando(false);
    }
  };

  // ✅ V00481: pasar a Cancelado abre la ventana que pide la nota y la factura que la reemplaza;
  //   con esos datos (cancelacion) se guarda. Al salir de Cancelado se borran.
  const handleCambiarStatusFactura = async (factura: any, nuevoStatus: string, cancelacion: DatosCancelacion | null = null) => {
    if (!factura?.id) return;
    if (estaCancelada(nuevoStatus) && !cancelacion && !estaCancelada(factura.statusFactura)) { setCancelarDe(factura); return; }
    const ids: string[] = Array.isArray(factura.__groupIds) && factura.__groupIds.length ? factura.__groupIds : [factura.id];
    const canc = escrituraCancelacion(factura, nuevoStatus, cancelacion);
    try {
      await escribirEnGrupo('facturas_clientes', ids, { statusFactura: nuevoStatus, ...canc.firestore });
      setFacturasGlobales(prev => prev.map(f => ids.includes(f.id) ? canc.local({ ...f, statusFactura: nuevoStatus }) : f));
      setFacturaViendo((prev: any) => (prev && (ids.includes(prev.id) || prev.id === factura.id)) ? canc.local({ ...prev, statusFactura: nuevoStatus }) : prev);
      void registrarLog('Facturación Clientes', 'Edición', cancelacion
        ? `Canceló la factura ${factura.invoice}: la reemplaza ${cancelacion.reemplazo.trim()}. Nota: ${cancelacion.nota.trim()}`
        : `Cambió el status de la factura ${factura.invoice} a ${nuevoStatus}.`);
    } catch (e) {
      console.error('Error actualizando status de factura:', e);
      if (cancelacion) throw new Error('No se pudo cancelar la factura. Revisa la conexión e intenta de nuevo.');
      alert('No se pudo actualizar el status de la factura.');
    }
  };

  const abrirEditarFactura = (e: React.MouseEvent, f: Parameters<typeof prepararEdicionFactura>[0]) => {
    e.stopPropagation();
    prepararEdicionFactura(f);
  };
  // ✅ V00491: desde la Auditoría de la cadena se abre ESTE formulario (antes tenía su editor propio).
  //   Si la factura está en la lista se usa esa (con su grupo de folios); si no, el documento que trae.
  const editarFacturaDesdeAuditoria = (raw: Record<string, unknown>) => {
    const id = String(raw.id ?? '');
    prepararEdicionFactura(facturasGlobales.find((f) => String(f.id) === id) ?? normalizarFactura({ ...raw, id }));
  };
  const prepararEdicionFactura = (f: any) => {
    setFacturaEditando(f);
    setEditInvoice(String(f.invoice || ''));
    setEditFecha(String(f.fecha || '').slice(0, 10));
    setEditCcp(String(f.facturaCcp || ''));
    setEditStatus(String(f.statusFactura || 'Facturado'));
    const cancelada = cancelacionDe(f); // ✅ V00481
    setEditCancelacion(cancelada ? { nota: cancelada.nota, reemplazo: cancelada.reemplazo } : CANCELACION_VACIA);
    // ✅ V00441: con la bandera, el total EN LA MONEDA de la factura (el que se ve en la
    //   tabla y el que guarda el servidor); antes se precargaba la conversión a pesos.
    // ✅ V00451: el total EN LA MONEDA de la factura también sin la bandera (antes se precargaba
    //   subtotalFactura = la conversión a pesos; guardar el editor solo para adjuntar el documento
    //   cambiaba el total de una factura en dólares y en Pagos quedaba saldo pendiente).
    // ✅ V00481: si la factura no está en la moneda del cliente, el total sugerido ya es el de esa moneda.
    setEditTotal(String(totalEditPara(f, String(f.clienteId || ''))));
    setEditClienteId(String(f.clienteId || '')); // ✅ NUEVO
    setAdjuntosEdicion(desdeGuardados(docsDeFactura(f))); // ✅ V00451: los documentos actuales (de todo el grupo)
  };

  const handleGuardarEdicionFactura = async () => {
    if (!facturaEditando) return;
    if (!editInvoice.trim()) return alert('El # de Invoice es obligatorio.');
    // ✅ V00481: la moneda es la del cliente (Empresas) y es obligatoria; cancelar pide nota y reemplazo.
    const monedaEdit = monedaClienteDe(editClienteId);
    if (!monedaEdit) return alert(editClienteId ? avisoSinMoneda('cliente') : 'Elige el cliente de la factura: la moneda es la del cliente en Empresas.');
    const cancelando = estaCancelada(editStatus);
    if (cancelando) { const falta = validarCancelacion(editCancelacion, editInvoice); if (falta) return alert(falta); }
    const canc = escrituraCancelacion(facturaEditando, editStatus, cancelando ? editCancelacion : null);
    setGuardandoEdit(true);
    try {
      const ids: string[] = Array.isArray(facturaEditando.__groupIds) && facturaEditando.__groupIds.length ? facturaEditando.__groupIds : [facturaEditando.id];
      const totalNum = Number(editTotal) || 0;
      // ✅ V00441 (Fase 5.5): con la bandera, el servidor guarda el total como MANUAL.
      if (flags.dineroPorServidor) {
        // ✅ V00481: los datos de la cancelación van ANTES (si el servidor falla quedan sin efecto: solo se
        //   muestran con status Cancelado); al salir de Cancelado se borran DESPUÉS.
        if (cancelando) await escribirEnGrupo('facturas_clientes', ids, canc.firestore);
        const r = await llamarDinero('editarFactura', {
          lado: 'cliente', origen: 'facturacion', facturaIds: ids, invoice: editInvoice.trim(), fecha: editFecha || '', facturaCcp: editCcp.trim(),
          statusFactura: editStatus, moneda: monedaEdit, total: totalNum, ...(editClienteId ? { empresaId: editClienteId } : {}),
        });
        if (!cancelando) await escribirEnGrupo('facturas_clientes', ids, canc.firestore);
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura).map((f) => (ids.includes(f.id) ? canc.local(f) : f)));
        const primera = r.facturas[ids[0]];
        if (primera) setFacturaViendo((prev: Record<string, unknown> | null) => (prev && ids.includes(String(prev.id))) ? canc.local({ ...prev, ...camposEditadosFactura(primera) }) : prev);
        if (!canc.vacia) void registrarLog('Facturación Clientes', 'Edición', cancelando ? `Canceló la factura ${editInvoice.trim()}: la reemplaza ${editCancelacion.reemplazo.trim()}. Nota: ${editCancelacion.nota.trim()}` : `La factura ${editInvoice.trim()} dejó de estar Cancelada (${editStatus}).`);
        await guardarDocsDeEdicion(facturaEditando); // ✅ V00451
        setFacturaEditando(null);
        return;
      }
      const baseUpdate: any = {
        invoice: editInvoice.trim(),
        fecha: editFecha || '',
        facturaCcp: editCcp.trim(),
        statusFactura: editStatus,
        monedaFacturacion: monedaEdit, // ✅ V00481: la del cliente
        updatedAt: new Date().toISOString(),
      };
      // ✅ NUEVO — REASIGNAR CLIENTE: corrige facturas que quedaron a nombre
      //   de otro cliente (el nombre corregido se refleja también en Pagos,
      //   que lee clienteId/clienteNombre de la factura).
      if (editClienteId) {
        const cli: any = empresasList.find((e: any) => e.id === editClienteId);
        if (cli) { baseUpdate.clienteId = editClienteId; baseUpdate.clienteNombre = String(cli.nombre || ''); }
      }
      // ✅ FIX IMPORTE EDITADO: el total capturado se escribe TAMBIÉN en
      //   subtotalMonedaFactura (el campo que la tabla, las tarjetas y Pagos
      //   leen primero) — antes solo se escribía subtotalFactura y por eso
      //   "seguía arrojando el que tenía". Además se recalcula el saldo
      //   pendiente respetando lo ya pagado.
      const pagadoActual = Number(facturaEditando.montoPagado) || 0;
      const saldoNuevo = Math.max(0, totalNum - pagadoActual);
      const extraPago: any = { saldoPendiente: saldoNuevo };
      if (pagadoActual > 0.009) extraPago.statusPago = saldoNuevo <= 0.009 ? 'PAGADA' : 'PARCIAL';
      // ✅ V00451: el total solo se escribe si se CAMBIÓ; y entonces queda marcado como capturado a
      //   mano (totalManualCentavos), para que el recálculo del servidor no lo regrese a la suma de
      //   los renglones y deje saldo pendiente en una factura ya pagada.
      const totalCambio = Math.abs(totalNum - r2(totalDeGrupo(facturaEditando))) > 0.009;

      const batch = writeBatch(db);
      ids.forEach((id, idx) => {
        batch.set(doc(db, 'facturas_clientes', id), {
          ...baseUpdate,
          ...canc.firestore, // ✅ V00481
          ...(totalCambio ? {
            subtotalFactura: idx === 0 ? totalNum : 0,
            subtotalMonedaFactura: idx === 0 ? totalNum : 0, // ✅ FIX: el campo que se muestra
            totalManualCentavos: idx === 0 ? aCentavos(totalNum) : 0,
            ...(idx === 0 ? extraPago : {}),
          } : {}),
        }, { merge: true });
      });
      await batch.commit();
      // ✅ V00279: el DOCUMENTO se sube DESPUÉS de guardar — el guardado de la
      //   factura nunca depende de la subida (recuerda: el documento en
      //   facturación NO es obligatorio; la ⚠ solo avisa). Si Storage rechaza
      //   la subida, se muestra el motivo exacto para diagnosticarlo.
      await guardarDocsDeEdicion(facturaEditando); // ✅ V00451: varios documentos (del grupo, en el primero)
      setFacturasGlobales(prev => prev.map(f => {
        if (!ids.includes(f.id)) return f;
        if (!totalCambio) return normalizarFactura(canc.local({ ...f, ...baseUpdate }));
        const esPrimero = f.id === ids[0];
        return normalizarFactura(canc.local({ ...f, ...baseUpdate, subtotalFactura: esPrimero ? totalNum : 0, subtotalMonedaFactura: esPrimero ? totalNum : 0, totalManualCentavos: esPrimero ? aCentavos(totalNum) : 0, ...(esPrimero ? extraPago : {}) }));
      }));
      setFacturaViendo((prev: any) => (prev && ids.includes(prev.id)) ? canc.local({ ...prev, ...baseUpdate, ...(totalCambio ? { subtotalFactura: totalNum, subtotalMonedaFactura: totalNum, ...extraPago } : {}) }) : prev);
      if (!canc.vacia) void registrarLog('Facturación Clientes', 'Edición', cancelando ? `Canceló la factura ${editInvoice.trim()}: la reemplaza ${editCancelacion.reemplazo.trim()}. Nota: ${editCancelacion.nota.trim()}` : `La factura ${editInvoice.trim()} dejó de estar Cancelada (${editStatus}).`);
      setFacturaEditando(null);
    } catch (e) {
      console.error('Error guardando edición de factura:', e);
      alert(mensajeDinero(e, 'No se pudo guardar la edición de la factura.'));
    } finally {
      setGuardandoEdit(false);
    }
  };

  const remolquesDeGuardadas = (guardadas: any[]): string[] =>
    Array.from(new Set((guardadas || []).map((o: any) => String(o?.remolque || '')).filter(r => r && r !== '-')));

  const buildResumenOp = (op: any) => {
    const m = obtenerMontoOperacion(op);
    return {
      id: String(op.id),
      ref: op.numReferencia || op.referencia || op.ref || String(op.id).substring(0, 6),
      monto: m.conv,
      subtotalBase: m.subtotal,
      dol: m.dol, // ✅ Fase 1.8: igual que al facturar, para que el total en dólares la cuente
      pes: m.pes,
      refCliente: String(op.refCliente || ''), // ✅ NUEVO
      remolque: txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque),
    };
  };

  // ✅ V00451: avisa a los demás módulos abiertos (Servicios Completados, Pagos…) que la operación
  //   cambió de factura. Se manda la operación COMPLETA (el bus de Facturación saca de su lista
  //   las que no traen un status facturable).
  const avisarOpsFacturacion = (ids: readonly string[], cambios: Record<string, unknown>) => {
    ids.forEach((id) => {
      const op = operacionesGlobales.find((o) => String(o.id) === String(id));
      if (op) notificarOperacionGuardada(String(id), { ...op, ...cambios }, 'facturacion-clientes', Object.keys(cambios));
    });
  };

  const aplicarCambiosFacturas = (cambios: any[]) => {
    setFacturasGlobales(prev => {
      let arr = [...prev];
      cambios.forEach((c: any) => {
        if (c.tipo === 'delete') arr = arr.filter(f => f.id !== c.id);
        else if (c.tipo === 'update') arr = arr.map(f => f.id === c.id ? normalizarFactura({ ...f, ...c.data }) : f);
        else if (c.tipo === 'create') arr = [normalizarFactura({ id: c.id, ...c.data }), ...arr];
      });
      return arr;
    });
  };

  const abrirGestionOp = (e: React.MouseEvent, op: any) => {
    e.stopPropagation();
    setGestionOp(op);
    setGestionInvoice(invoiceDeOp(op) || '');
  };

  // ✅ Fase 1.8: las facturas que HOY contienen la operación, leídas frescas
  //   (candidatas: las de la lista en memoria + la que marca la operación).
  const facturasFrescasConOp = async (opId: string, idFacturaOp?: unknown) => {
    const candidatas = new Set<string>(facturasGlobales.filter(f => (f.operacionesIds || []).map(String).includes(opId)).map(f => String(f.id)));
    if (idFacturaOp) candidatas.add(String(idFacturaOp));
    const frescas = await Promise.all(Array.from(candidatas).map(leerFacturaFresca));
    return frescas.filter(f => f && (f.operacionesIds || []).map(String).includes(opId));
  };

  const quitarOpDeFactura = async (op: any) => {
    const opId = String(op.id);
    const refTxt = op.numReferencia || op.referencia || op.ref || opId.substring(0, 6);
    if (!window.confirm(`¿Quitar la operación ${refTxt} de su factura? Volverá a "Pendientes" y se restará su monto de la factura.`)) return;
    setGuardandoGestionOp(true);
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, lo hace el servidor (transacción).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('quitarOperacionFactura', { lado: 'cliente', operacionId: opId, permitirBorrarFactura: true });
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura));
        setOperacionesGlobales(prev => aplicarOperaciones(prev, r.operaciones));
        setGestionOp(null);
        return;
      }
      const facturasConOp = await facturasFrescasConOp(opId, op.facturaClienteId); // ✅ Fase 1.8
      const batch = writeBatch(db);
      const cambios: any[] = [];
      for (const f of facturasConOp) {
        const ids = (f.operacionesIds || []).map(String).filter((id: string) => id !== opId);
        const guardadas = (f.operacionesGuardadas || []).filter((o: any) => String(o.id) !== opId);
        if (ids.length === 0) {
          // ✅ Fase 1.8 (c): quitar la última operación BORRA la factura.
          if (tienePagosAplicados(f)) return alert(`La operación ${refTxt} es la única de la factura ${f.invoice}, que se eliminaría.\n\n${avisoFacturaConPagos(formatoMoneda(montoPagadoDe(f)))}`);
          batch.delete(doc(db, 'facturas_clientes', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          // ✅ Fase 1.8 (d): subtotalMonedaFactura recalculado con las operaciones restantes.
          const totales = totalesTrasCambioDeOps(f, guardadas);
          if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), ...totales.campos, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_clientes', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }
      // ✅ V00451: los archivos de un documento que se borra pasan al otro documento del mismo folio.
      (await rescatarDocsDeBorradas('clientes', facturasConOp.filter((f: { id?: unknown }) => cambios.some((c) => c.tipo === 'delete' && c.id === f.id)), facturasGlobales, batch))
        .forEach((e) => cambios.push({ tipo: 'update', id: e.id, data: e.campos }));
      batch.update(doc(db, 'operaciones', idRealOp(opId)), { facturaClienteId: null, facturaClienteInvoice: null, facturado: false });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaClienteId: null, facturaClienteInvoice: null, facturado: false } : o));
      avisarOpsFacturacion([opId], { facturaClienteId: null, facturaClienteInvoice: null, facturado: false }); // ✅ V00451
      setGestionOp(null);
    } catch (e) {
      console.error('Error quitando operación de la factura:', e);
      alert(mensajeDinero(e, 'No se pudo quitar la operación de la factura.'));
    } finally {
      setGuardandoGestionOp(false);
    }
  };

  const editarInvoiceDeOp = async (op: any, nuevoInvoiceRaw: string) => {
    const nuevoInvoice = String(nuevoInvoiceRaw || '').trim();
    if (!nuevoInvoice) return alert('Captura un número de factura.');
    const opId = String(op.id);
    const clienteId = String(op.clientePaga || op.clienteId || '');
    setGuardandoGestionOp(true);
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, lo hace el servidor (transacción).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('moverOperacionFactura', { lado: 'cliente', operacionId: opId, nuevoInvoice });
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura));
        setOperacionesGlobales(prev => aplicarOperaciones(prev, r.operaciones));
        setGestionOp(null);
        return;
      }
      const facturasConOp = await facturasFrescasConOp(opId, op.facturaClienteId); // ✅ Fase 1.8
      // ✅ V00448: si ya está en una factura con ese folio, no hay nada que mover (antes la
      // sacaba y creaba otra factura con el mismo folio).
      const yaEsDelFolio = (f: { invoice?: unknown; clienteId?: unknown }) =>
        String(f.invoice || '').trim().toLowerCase() === nuevoInvoice.toLowerCase() && String(f.clienteId || '') === clienteId;
      if (facturasConOp.length > 0 && facturasConOp.every(yaEsDelFolio)) { setGestionOp(null); return; }
      const batch = writeBatch(db);
      const cambios: any[] = [];

      let resumenOrigen: any = null;
      let metaCarry: any = null;
      for (const f of facturasConOp) {
        if (!metaCarry) metaCarry = { statusFactura: f.statusFactura, monedaFacturacion: f.monedaFacturacion, facturaCcp: f.facturaCcp, fecha: f.fecha, clienteNombre: f.clienteNombre };
        const g = (f.operacionesGuardadas || []).find((o: any) => String(o.id) === opId);
        if (g && !resumenOrigen) resumenOrigen = g;
      }
      if (!resumenOrigen) resumenOrigen = buildResumenOp(op);
      const montoOp = Number(resumenOrigen.monto) || 0;

      for (const f of facturasConOp) {
        const ids = (f.operacionesIds || []).map(String).filter((id: string) => id !== opId);
        const guardadas = (f.operacionesGuardadas || []).filter((o: any) => String(o.id) !== opId);
        if (ids.length === 0) {
          // ✅ Fase 1.8 (c): mover la última operación BORRA la factura de origen.
          if (tienePagosAplicados(f)) return alert(`La operación es la única de la factura ${f.invoice}, que se eliminaría.\n\n${avisoFacturaConPagos(formatoMoneda(montoPagadoDe(f)))}`);
          batch.delete(doc(db, 'facturas_clientes', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          const totales = totalesTrasCambioDeOps(f, guardadas); // ✅ Fase 1.8 (d)
          if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), ...totales.campos, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_clientes', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }

      // ✅ V00451: los archivos de un documento de origen que se borra pasan al otro documento de su folio.
      (await rescatarDocsDeBorradas('clientes', facturasConOp.filter((f: { id?: unknown }) => cambios.some((c) => c.tipo === 'delete' && c.id === f.id)), facturasGlobales, batch))
        .forEach((e) => cambios.push({ tipo: 'update', id: e.id, data: e.campos }));
      const esDestino = (f: { id?: unknown; invoice?: unknown; clienteId?: unknown }) =>
        String(f.invoice || '').trim().toLowerCase() === nuevoInvoice.toLowerCase() &&
        String(f.clienteId || '') === clienteId &&
        !facturasConOp.some(fc => fc.id === f.id);
      // ✅ Fase 1.8: la factura destino se fusiona FRESCA, no desde la lista en memoria.
      const targetCache = facturasGlobales.find(esDestino);
      const targetFresca = targetCache ? await leerFacturaFresca(targetCache.id) : null;
      // ✅ V00451: si el folio destino no está en la lista cargada se busca en el SERVIDOR (antes se
      //   creaba otro documento con el mismo folio).
      const targetServidor = targetFresca && esDestino(targetFresca) ? null : await facturaExistenteFresca('cliente', nuevoInvoice, clienteId);
      const target = targetFresca && esDestino(targetFresca) ? targetFresca
        : targetServidor && esDestino(targetServidor) ? (targetServidor as typeof targetFresca) : null;
      let targetId: string;
      if (target) {
        const ids = Array.from(new Set([...(target.operacionesIds || []).map(String), opId]));
        const mapG = new Map<string, any>();
        [...(target.operacionesGuardadas || []), resumenOrigen].forEach((o: any) => { if (o?.id) mapG.set(String(o.id), o); });
        const guardadas = Array.from(mapG.values());
        targetId = target.id;
        const totales = totalesTrasCambioDeOps(target, guardadas); // ✅ Fase 1.8 (d)
        if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
        const data = { invoice: target.invoice || nuevoInvoice, operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), ...totales.campos, updatedAt: new Date().toISOString() };
        batch.set(doc(db, 'facturas_clientes', targetId), data, { merge: true });
        cambios.push({ tipo: 'update', id: targetId, data });
      } else {
        targetId = doc(collection(db, 'facturas_clientes')).id;
        const data: any = {
          invoice: nuevoInvoice,
          fecha: metaCarry?.fecha || '',
          facturaCcp: metaCarry?.facturaCcp || '',
          statusFactura: metaCarry?.statusFactura || 'Facturado',
          clienteId,
          clienteNombre: metaCarry?.clienteNombre || getNombreCliente(clienteId),
          monedaFacturacion: metaCarry?.monedaFacturacion || 'N/A',
          operacionesIds: [opId],
          operacionesGuardadas: [resumenOrigen],
          remolques: remolquesDeGuardadas([resumenOrigen]),
          subtotalFactura: r2(montoOp),
          subtotalMonedaFactura: totalNativoDeOperaciones(metaCarry?.monedaFacturacion, [resumenOrigen]), // ✅ Fase 1.8 (d)
          createdAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_clientes', targetId), data);
        cambios.push({ tipo: 'create', id: targetId, data });
      }

      batch.update(doc(db, 'operaciones', idRealOp(opId)), { facturaClienteId: targetId, facturaClienteInvoice: nuevoInvoice, facturado: true });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaClienteId: targetId, facturaClienteInvoice: nuevoInvoice, facturado: true } : o));
      avisarOpsFacturacion([opId], { facturaClienteId: targetId, facturaClienteInvoice: nuevoInvoice, facturado: true }); // ✅ V00451
      setGestionOp(null);
    } catch (e) {
      console.error('Error editando # de factura de la operación:', e);
      alert(mensajeDinero(e, 'No se pudo cambiar el número de factura de la operación.'));
    } finally {
      setGuardandoGestionOp(false);
    }
  };

  const agregarOpAFactura = async (facturaGrupo: any, op: any) => {
    if (!puedeAgregarOperaciones(facturaGrupo?.statusFactura)) { alert(AVISO_AGREGAR_FACTURADA); return; } // ✅ V00481
    const bloqueo = bloqueoPorRevision([op]); // ✅ V00450
    if (bloqueo) { alert(bloqueo); return; }
    const opId = String(op.id);
    const rawId = (Array.isArray(facturaGrupo.__groupIds) && facturaGrupo.__groupIds.length) ? facturaGrupo.__groupIds[0] : facturaGrupo.id;
    const resumen = buildResumenOp(op);
    const monto = Number(resumen.monto) || 0;
    setAgregandoRef(true);
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, lo hace el servidor (transacción).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('agregarOperacionFactura', { lado: 'cliente', facturaId: rawId, operacionId: opId });
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura));
        setOperacionesGlobales(prev => aplicarOperaciones(prev, r.operaciones));
        const nueva = r.facturas[rawId];
        if (nueva) {
          type Fila = Record<string, unknown>;
          const filas = (v: unknown): Fila[] => (Array.isArray(v) ? v.filter((x): x is Fila => !!x && typeof x === 'object') : []);
          const renglon: Fila = filas(nueva.operacionesGuardadas).find((o) => String(o.id) === opId) || resumen;
          const aplicarEnGrupoSrv = <G extends Fila | null>(g: G): G => {
            if (!g) return g;
            const mismoGrupo = (Array.isArray(g.__groupIds) ? g.__groupIds : [g.id]).includes(rawId) || g.id === facturaGrupo.id;
            if (!mismoGrupo) return g;
            const mapG2 = new Map<string, Fila>();
            [...filas(g.operacionesGuardadas), renglon].forEach((o) => { if (o.id) mapG2.set(String(o.id), o); });
            const guardadas2 = Array.from(mapG2.values());
            const idsPrevios = Array.isArray(g.operacionesIds) ? g.operacionesIds.map(String) : [];
            return { ...g, ...camposEditadosFactura(nueva), operacionesIds: Array.from(new Set([...idsPrevios, opId])), operacionesGuardadas: guardadas2, remolques: remolquesDeGuardadas(guardadas2), subtotalFactura: r2(Number(g.subtotalFactura || 0) + (Number(renglon.monto) || 0)) };
          };
          setAgregarRefFactura((prev: Record<string, unknown> | null) => aplicarEnGrupoSrv(prev));
          setFacturaViendo((prev: Record<string, unknown> | null) => aplicarEnGrupoSrv(prev));
        }
        return;
      }
      // ✅ Fase 1.8: se fusiona contra la factura FRESCA, no contra la lista en memoria.
      const rawDoc = await leerFacturaFresca(rawId);
      if (!rawDoc) return alert('Esta factura ya no existe (alguien más la eliminó). Recarga el historial.');
      // ✅ V00451: la operación no puede estar ya en otra factura según el SERVIDOR.
      const yaEnOtra = await operacionesYaFacturadas('cliente', [{ idLista: opId, idReal: idRealOp(opId), ref: String(op.ref ?? op.numReferencia ?? opId) }], rawId);
      if (yaEnOtra.length > 0) { alert(avisoYaFacturadas(yaEnOtra)); recargarTodo(); return; }
      const ids = Array.from(new Set([...(rawDoc.operacionesIds || []).map(String), opId]));
      const mapG = new Map<string, any>();
      [...(rawDoc.operacionesGuardadas || []), resumen].forEach((o: any) => { if (o?.id) mapG.set(String(o.id), o); });
      const guardadas = Array.from(mapG.values());
      // ✅ Fase 1.8 (d): subtotalMonedaFactura recalculado con la operación nueva.
      const totales = totalesTrasCambioDeOps(rawDoc, guardadas);
      if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
      const data = {
        operacionesIds: ids,
        operacionesGuardadas: guardadas,
        remolques: remolquesDeGuardadas(guardadas),
        ...totales.campos,
        updatedAt: new Date().toISOString(),
      };
      const batch = writeBatch(db);
      batch.set(doc(db, 'facturas_clientes', rawId), data, { merge: true });
      batch.update(doc(db, 'operaciones', idRealOp(opId)), { facturaClienteId: rawId, facturaClienteInvoice: rawDoc.invoice || facturaGrupo.invoice, facturado: true });
      await batch.commit();
      setFacturasGlobales(prev => prev.map(f => f.id === rawId ? normalizarFactura({ ...f, ...data }) : f));
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaClienteId: rawId, facturaClienteInvoice: rawDoc.invoice || facturaGrupo.invoice, facturado: true } : o));
      avisarOpsFacturacion([opId], { facturaClienteId: rawId, facturaClienteInvoice: rawDoc.invoice || facturaGrupo.invoice, facturado: true }); // ✅ V00451
      const aplicarEnGrupo = (g: any) => {
        if (!g) return g;
        const mismoGrupo = (Array.isArray(g.__groupIds) ? g.__groupIds : [g.id]).includes(rawId) || g.id === facturaGrupo.id;
        if (!mismoGrupo) return g;
        const mapG2 = new Map<string, any>();
        [...(g.operacionesGuardadas || []), resumen].forEach((o: any) => { if (o?.id) mapG2.set(String(o.id), o); });
        const guardadas2 = Array.from(mapG2.values());
        // ✅ Fase 1.8: total/saldo nuevos del documento (el grupo toma los del primero); el subtotal del grupo se suma.
        return { ...g, ...totales.campos, operacionesIds: Array.from(new Set([...(g.operacionesIds || []).map(String), opId])), operacionesGuardadas: guardadas2, remolques: remolquesDeGuardadas(guardadas2), subtotalFactura: r2(Number(g.subtotalFactura || 0) + monto) };
      };
      setAgregarRefFactura((prev: any) => aplicarEnGrupo(prev));
      setFacturaViendo((prev: any) => aplicarEnGrupo(prev));
    } catch (e) {
      console.error('Error agregando operación a la factura:', e);
      alert(mensajeDinero(e, 'No se pudo agregar la operación a la factura.'));
    } finally {
      setAgregandoRef(false);
    }
  };

  const candidatosPendientes = useMemo(() => {
    if (!agregarRefFactura) return [];
    const clienteId = String(agregarRefFactura.clienteId || '');
    const q = busquedaRefPendiente.trim().toLowerCase();
    const lista = operacionesGlobales.filter(op => {
      if (esFacturada(op)) return false;
      if (enRevisionRef.has(idDeLista(op))) return false; // ✅ V00450: Ref Cliente duplicada sin revisar
      if (clienteId && String(op.clientePaga || op.clienteId || '') !== clienteId) return false;
      if (!q) return true;
      const campos = [op.numReferencia, op.referencia, op.ref, op.remolqueNombre, op.remolquePlaca, op.numeroRemolque];
      return campos.some(v => String(v ?? '').toLowerCase().includes(q));
    });
    return lista.slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agregarRefFactura, operacionesGlobales, busquedaRefPendiente, facturasGlobales, enRevisionRef]);

  const handleEliminarFactura = async (e: React.MouseEvent, facData: any) => {
    e.stopPropagation();
    const ids: string[] = Array.isArray(facData.__groupIds) && facData.__groupIds.length ? facData.__groupIds : [facData.id];
    const aviso = ids.length > 1
      ? `¿Eliminar las ${ids.length} facturas con el número ${facData.invoice}? Las operaciones asociadas quedarán liberadas nuevamente.`
      : `¿Estás seguro de eliminar la factura ${facData.invoice}? Las operaciones asociadas quedarán liberadas nuevamente.`;
    if (window.confirm(aviso)) {
      try {
        // ✅ V00441 (Fase 5.4): con la bandera, lo hace el servidor (transacción).
        if (flags.dineroPorServidor) {
          const r = await llamarDinero('eliminarFactura', { lado: 'cliente', facturaIds: ids });
          setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura));
          setOperacionesGlobales(prev => aplicarOperaciones(prev, r.operaciones));
          return;
        }
        // ✅ Fase 1.8 (c): se releen FRESCAS. Una factura con pagos aplicados no se
        //   borra: dejaba entradas huérfanas en pagos.facturas[].
        const frescas = await Promise.all(ids.map(leerFacturaFresca));
        const conPagos = frescas.find(f => f && tienePagosAplicados(f));
        if (conPagos) {
          const quien = ids.length > 1 ? `La factura ${conPagos.invoice} (del grupo) no se puede eliminar.\n\n` : '';
          return alert(quien + avisoFacturaConPagos(formatoMoneda(montoPagadoDe(conPagos))));
        }
        // Las operaciones salen de la versión fresca de cada factura.
        const idsDeFacturas: string[] = Array.from(new Set(frescas.flatMap(f => (f ? (f.operacionesIds || []).map(String) : []))));
        // ✅ V00494: solo se libera la que apunta a esta factura (o a ninguna) y no está en OTRA; si está
        //   en otra (p. ej. al borrar un duplicado), se liga a esa. Antes se liberaban todas y volvían a
        //   "Pendientes" aunque siguieran facturadas.
        const cargadas = facturasGlobales.map((f) => ({ id: String(f.id), invoice: String(f.invoice || ''), statusFactura: f.statusFactura, operacionesIds: (Array.isArray(f.operacionesIds) ? f.operacionesIds : []).map(String) }));
        const decisiones = await planLiberarAlEliminar('cliente', idsDeFacturas.map((id) => ({ idLista: id, idReal: idRealOp(id) })), new Set(ids.map(String)), cargadas);
        const aEscribir = decisiones.filter((d) => d.accion !== 'dejar');
        const escrituras = ids.length + aEscribir.length;
        if (escrituras > MAX_ESCRITURAS_LOTE) return alert(avisoLoteGrande(escrituras, 'Quita primero algunas operaciones de la factura y vuelve a intentar.'));
        const camposDe = (d: DecisionLiberar): Record<string, unknown> => d.accion === 'ligar'
          ? { facturaClienteId: d.facturaId, facturaClienteInvoice: d.folio, facturado: true }
          : { facturaClienteId: null, facturaClienteInvoice: null, facturado: false };
        const batch = writeBatch(db);
        ids.forEach(fid => batch.delete(doc(db, 'facturas_clientes', fid)));
        aEscribir.forEach((d) => batch.update(doc(db, 'operaciones', d.idReal), camposDe(d))); // ✅ V00451: id real
        await batch.commit();
        const porLista = new Map(aEscribir.map((d) => [d.idLista, camposDe(d)] as const));
        setFacturasGlobales(prev => prev.filter(f => !ids.includes(f.id)));
        setOperacionesGlobales(prev => prev.map(op => (porLista.has(String(op.id)) ? { ...op, ...porLista.get(String(op.id)) } : op)));
        aEscribir.forEach((d) => avisarOpsFacturacion([d.idLista], camposDe(d))); // ✅ V00451
        const ligadas = decisiones.filter((d) => d.accion !== 'liberar').length;
        if (ligadas > 0) avisar({ tipo: 'info', titulo: 'Factura eliminada', texto: `${ligadas} operación(es) siguen facturadas en otra factura y no volvieron a Pendientes.` });
      } catch (error) {
        console.error('Error al eliminar factura:', error);
        alert(mensajeDinero(error, 'Hubo un error al eliminar.'));
      }
    }
  };

  const valorOrdenFac = (f: any, campo: string): string | number => {
    switch (campo) {
      case 'statusFactura': return String(f.statusFactura || '').toLowerCase();
      case 'invoice': return String(f.invoice || '').toLowerCase();
      case 'fecha': return String(f.fecha || '');
      case 'remolque': return remolquesFacturaTokens(f).join(' ').toLowerCase();
      case 'cliente': return String(f.clienteNombre || '').toLowerCase();
      case 'refCliente': return refClienteDeFactura(f).toLowerCase();
      case 'numeroPago': return numerosPagoDe(f).join(', ').toLowerCase();
      case 'moneda': return String(f.monedaFacturacion || '').toLowerCase();
      case 'cantOps': return Number(f.operacionesIds?.length || 0);
      case 'total': return totalDeGrupo(f); // ✅ FIX MONEDA · V00448 · V00451: fila agrupada
      case 'createdAt': return String(f.createdAt || '');
      default: return '';
    }
  };

  // ✅ V00488: facturas sin fecha (o con una que no se reconoce): no entran en un filtro de fechas y se avisa cuántas.
  const sinFechaHist = useMemo(
    () => facturasGlobales.filter((f) => (!filtroCliente || String(f.clienteId || '') === filtroCliente) && !fechaFacturaISO(f.fecha)).length,
    [facturasGlobales, filtroCliente],
  );
  const historialOrdenado = useMemo(() => {
    const dir = ordenFac.dir === 'asc' ? 1 : -1;
    const q = textoBuscarFacturaDiferido.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.clienteNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.clienteId) { const nom = getNombreCliente(f.clienteId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaFacturacion || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      if (Array.isArray(f.operacionesGuardadas)) {
        if (f.operacionesGuardadas.some((op: any) => {
          const info = opInfoMap[String(op?.id || '')] || {};
          return String(op?.ref || '').toLowerCase().includes(q) ||
            String(op?.remolque || '').toLowerCase().includes(q) ||
            String(info.ref || '').toLowerCase().includes(q) ||
            String(info.remolque || '').toLowerCase().includes(q);
        })) return true;
      }
      return false;
    };
    const coincideCliente = (f: any) => !filtroCliente || String(f.clienteId || '') === filtroCliente;
    const coincideMoneda = (f: any) => filtroMonedaHist === 'todas' || codigoMonedaFactura(f) === filtroMonedaHist; // ✅ V00485
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = fechaFacturaISO(f.fecha); // ✅ V00488: cualquier formato guardado (antes solo AAAA-MM-DD)
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const filtradas = facturasGlobales.filter(f => coincideTexto(f) && coincideCliente(f) && coincideMoneda(f) && coincideFechas(f));
    const grupos = new Map<string, any>();
    for (const f of filtradas) {
      const key = `${String(f.invoice || f.id).trim().toLowerCase()}__${String(f.clienteId || '')}`;
      if (!grupos.has(key)) {
        grupos.set(key, {
          ...f,
          operacionesIds: Array.isArray(f.operacionesIds) ? [...f.operacionesIds] : [],
          operacionesGuardadas: Array.isArray(f.operacionesGuardadas) ? [...f.operacionesGuardadas] : [],
          remolques: Array.isArray(f.remolques) ? [...f.remolques] : [],
          subtotalFactura: Number(f.subtotalFactura) || 0,
          __groupIds: [f.id],
          __groupDocs: [f],
        });
      } else {
        const g = grupos.get(key);
        g.__groupIds.push(f.id);
        g.__groupDocs.push(f);
        const setIds = new Set<string>([...(g.operacionesIds || []).map(String), ...((f.operacionesIds || []).map(String))]);
        g.operacionesIds = Array.from(setIds);
        const mapG = new Map<string, any>();
        [...(g.operacionesGuardadas || []), ...(f.operacionesGuardadas || [])].forEach((o: any) => { if (o?.id) mapG.set(String(o.id), o); });
        g.operacionesGuardadas = Array.from(mapG.values());
        g.remolques = Array.from(new Set([...(g.remolques || []), ...((f.remolques) || [])].map((r: any) => String(r || '')).filter(Boolean)));
        g.subtotalFactura = Number(g.subtotalFactura || 0) + (Number(f.subtotalFactura) || 0);
        if (String(f.fecha || '') > String(g.fecha || '')) g.fecha = f.fecha;
        if (!g.createdAt || (f.createdAt && String(f.createdAt) < String(g.createdAt))) g.createdAt = f.createdAt || g.createdAt;
        const rank = (s: any) => { const t = String(s || '').toLowerCase(); if (t.includes('cancel')) return 3; if (t.includes('no')) return 2; return 1; };
        if (rank(f.statusFactura) > rank(g.statusFactura)) g.statusFactura = f.statusFactura;
        // ✅ V00451: los archivos de TODOS los documentos del grupo cuentan (antes solo los del
        //   primero: el PDF subido al segundo seguía mostrando "Sin doc"): lista unida, sin repetir.
        Object.assign(g, camposDocsDeGrupo(g, f));
      }
    }
    let agrupadas = Array.from(grupos.values());
    if (activeTab === 'pagadas') agrupadas = agrupadas.filter(g => facturaPagada(g)); // ✅ V00126
    if (filtroStatusFactura && filtroStatusFactura !== 'Todos') {
      agrupadas = agrupadas.filter(g => String(g.statusFactura || 'Facturado') === filtroStatusFactura);
    }
    return agrupadas.sort((a, b) => {
      const va = valorOrdenFac(a, ordenFac.campo);
      const vb = valorOrdenFac(b, ordenFac.campo);
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [facturasGlobales, ordenFac, textoBuscarFacturaDiferido, filtroCliente, fechaDesdeHist, fechaHastaHist, opInfoMap, filtroStatusFactura, filtroMonedaHist, activeTab, pagosPorFactura]);

  const resumenHistorial = useMemo(() => {
    let totalUSD = 0, totalMXN = 0, totalSinMoneda = 0, totalOps = 0, canceladas = 0;
    historialOrdenado.forEach(f => {
      // ✅ V00493: una factura cancelada sigue en la lista pero NO suma (su reemplazo ya suma).
      if (!sumaEnTotales(f.statusFactura, filtroStatusFactura)) { canceladas++; return; }
      const monto = totalDeGrupo(f); // ✅ FIX MONEDA · V00448 · V00451: fila agrupada: suma en la moneda de la factura
      // ✅ FIX: la moneda puede venir como nombre de catálogo ("Dólares",
      //   "Pesos") y las tarjetas comparaban contra 'USD'/'MXN' exactos, por
      //   lo que TOTAL FACTURADO marcaba $0.00. Se normaliza antes de sumar.
      //   ✅ V00439 (Fase 3.x): con el helper compartido (acepta las mismas formas y más).
      const mon = monedaCanonicaComun(monedaFacturaMostrar(f));
      if (mon === 'USD') totalUSD += monto;
      else if (mon === 'MXN') totalMXN += monto;
      else totalSinMoneda += monto;
      totalOps += Array.isArray(f.operacionesIds) ? f.operacionesIds.length : 0;
    });
    const r2c = (x: number) => Math.round(x * 100) / 100; // ✅ V00265: tarjetas a 2 decimales
    return { cuenta: historialOrdenado.length, canceladas, totalUSD: r2c(totalUSD), totalMXN: r2c(totalMXN), totalSinMoneda: r2c(totalSinMoneda), totalOps };
  }, [historialOrdenado, totalDeGrupo, filtroStatusFactura]);

  const conteoStatus = useMemo(() => {
    const q = textoBuscarFacturaDiferido.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.clienteNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.clienteId) { const nom = getNombreCliente(f.clienteId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaFacturacion || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      return false;
    };
    const coincideCliente = (f: any) => !filtroCliente || String(f.clienteId || '') === filtroCliente;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = fechaFacturaISO(f.fecha); // ✅ V00488: cualquier formato guardado (antes solo AAAA-MM-DD)
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const coincideMoneda = (f: any) => filtroMonedaHist === 'todas' || codigoMonedaFactura(f) === filtroMonedaHist; // ✅ V00485
    const base = facturasGlobales.filter(f => coincideTexto(f) && coincideCliente(f) && coincideMoneda(f) && coincideFechas(f));
    const c = { Todos: base.length } as Record<string, number>;
    base.forEach((f: any) => {
      const s = (String(f.statusFactura || 'Facturado').trim()) || 'Facturado';
      c[s] = (c[s] || 0) + 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, textoBuscarFacturaDiferido, filtroCliente, fechaDesdeHist, fechaHastaHist, filtroMonedaHist]);

  // ✅ Conteo de facturas por moneda (para el tab Todas | Dólares | Pesos del filtro).
  //    Respeta texto, cliente, fechas y status, pero NO el propio filtro de moneda.
  const conteoMonedaHist = useMemo(() => {
    const q = textoBuscarFacturaDiferido.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.clienteNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.clienteId) { const nom = getNombreCliente(f.clienteId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaFacturacion || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      return false;
    };
    const coincideCliente = (f: any) => !filtroCliente || String(f.clienteId || '') === filtroCliente;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = fechaFacturaISO(f.fecha); // ✅ V00488: cualquier formato guardado (antes solo AAAA-MM-DD)
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const coincideStatus = (f: any) => filtroStatusFactura === 'Todos' || String(f.statusFactura || 'Facturado') === filtroStatusFactura;
    const base = facturasGlobales.filter(f => coincideTexto(f) && coincideCliente(f) && coincideFechas(f) && coincideStatus(f));
    let usd = 0, mxn = 0;
    base.forEach((f: any) => {
      const mon = codigoMonedaFactura(f); // ✅ V00485
      if (mon === 'USD') usd++;
      else if (mon === 'MXN') mxn++;
    });
    return { todas: base.length, USD: usd, MXN: mxn };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, textoBuscarFacturaDiferido, filtroCliente, fechaDesdeHist, fechaHastaHist, filtroStatusFactura, empresasList, mapaCatalogos]);

  const statusBotones = useMemo(() => {
    const orden = ['Facturado', 'No Facturado', 'Cancelado'];
    const otros = Object.keys(conteoStatus).filter(k => k !== 'Todos');
    otros.sort((a, b) => {
      const ia = orden.indexOf(a); const ib = orden.indexOf(b);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.localeCompare(b, 'es', { sensitivity: 'base' });
    });
    return ['Todos', ...otros];
  }, [conteoStatus]);

  const toggleOrdenFac = (campo: string) =>
    setOrdenFac(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaFac = (campo: string) => ordenFac.campo === campo ? (ordenFac.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const totalPaginas = Math.ceil(historialOrdenado.length / registrosPorPagina);
  const indexLast = paginaActual * registrosPorPagina;
  const indexFirst = indexLast - registrosPorPagina;
  // ✅ V00438 (Fase 2.2): memo — antes era un arreglo nuevo en cada render y el
  //   efecto de abajo (getDocs de operaciones) corría en CADA render.
  const registrosVisibles = useMemo(() => historialOrdenado.slice(indexFirst, indexLast), [historialOrdenado, indexFirst, indexLast]);

  // ✅ V00438 (Fase 2.2): ids de operaciones por resolver como clave estable
  //   (ordenados): el efecto solo corre cuando cambia ese conjunto.
  const claveOpsPorResolver = useMemo(() => {
    const fuentes: any[] = esHistorial ? [...registrosVisibles] : [];
    if (facturaViendo) fuentes.push(facturaViendo);
    if (agregarRefFactura) fuentes.push(agregarRefFactura);
    const faltantes = new Set<string>();
    const considerar = (id: string) => {
      const k = String(id || '').trim();
      if (!k || opInfoMap[k]) return;
      if (pareceReferencia(k)) return;
      if (k.length < 6) return;
      faltantes.add(k);
    };
    const considerarValor = (valor: unknown) => String(valor || '').split(/[,\s]+/).forEach(t => considerar(t));
    fuentes.forEach((f: any) => {
      (Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : []).forEach((op: any) => {
        considerar(String(op?.id || ''));
        considerarValor(op?.ref);
      });
      (Array.isArray(f.operacionesIds) ? f.operacionesIds : []).forEach((id: unknown) => considerar(String(id || '')));
    });
    return JSON.stringify(Array.from(faltantes).sort());
  }, [esHistorial, registrosVisibles, facturaViendo, agregarRefFactura, opInfoMap]);

  // ✅ V00438 (Fase 2.2): ids ya pedidos (encontrados o no) — no se vuelven a
  //   consultar; antes los que no existen se pedían otra vez en cada render.
  const opsPedidasRef = useRef<Set<string>>(new Set());
  const resolverOpsFaltantes = useEffectEvent(async (ids: string[]) => {
    const nuevos: Record<string, any> = {};
    // ✅ V00443 (Fase 7.8/7.10): tandas de 30 EN PARALELO y TODAS las faltantes de lo visible
    //   (antes 150 por vuelta: si ninguna de esas 150 existía, las demás no se pedían nunca).
    const tandas: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) tandas.push(ids.slice(i, i + 30));
    await Promise.all(tandas.map(async (chunk) => {
      try {
        const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', chunk)));
        snap.docs.forEach(d => {
          const o: any = { id: d.id, ...(d.data() as any) };
          nuevos[d.id] = {
            ref: o.numReferencia || o.referencia || o.ref || d.id,
            remolque: txt(o.remolqueNombre, o.remolquePlaca, o.numeroRemolque),
            moneda: textoFacturadoEn(o, 'cliente'), // ✅ V00489
            clienteId: o.clientePaga || o.clienteId || '',
            refCliente: String(o.refCliente || ''), // ✅ NUEVO
          };
        });
      } catch (e) {
        chunk.forEach((id) => opsPedidasRef.current.delete(id)); // si falló la red, se puede volver a pedir
        console.warn('No se pudo resolver lote de operaciones del historial:', e);
      }
    }));
    if (Object.keys(nuevos).length) setOpInfoMap(prev => ({ ...prev, ...nuevos }));
  });
  useEffect(() => {
    const ids = (JSON.parse(claveOpsPorResolver) as string[]).filter((id) => !opsPedidasRef.current.has(id));
    if (ids.length === 0) return;
    ids.forEach((id) => opsPedidasRef.current.add(id));
    void resolverOpsFaltantes(ids);
  }, [claveOpsPorResolver]);

  type OpLike = Record<string, unknown>; // ✅ V00260
  type InfoOp = { ref?: unknown; refCliente?: unknown; [k: string]: unknown }; // ✅ V00260
  // ✅ V00260: acepta un mapa EXTRA de operaciones recién resueltas (lo usa la
  //   exportación a Excel, que resuelve TODO el historial y no puede esperar
  //   al setState de opInfoMap).
  const refDeOpCon = (op: OpLike | null | undefined, extra?: Record<string, InfoOp>): string => {
    const buscar = (k: string) => (extra && extra[k]) || opInfoMap[k];
    const id = String(op?.id || '');
    const directos = [op?.numReferencia, op?.referencia, op?.ref].map((v: any) => String(v || '')).filter(Boolean);
    const refDirecta = directos.find(pareceReferencia);
    if (refDirecta) return refDirecta;
    const info = buscar(id);
    if (info?.ref && pareceReferencia(String(info.ref))) return String(info.ref);
    const tokens = new Set<string>();
    [id, ...directos].forEach(v => String(v).split(/[,\s]+/).forEach(t => { if (t) tokens.add(t); }));
    const resueltas: string[] = [];
    tokens.forEach(t => { const i = buscar(t); if (i?.ref && pareceReferencia(String(i.ref))) resueltas.push(String(i.ref)); });
    if (resueltas.length) return Array.from(new Set(resueltas)).join(', ');
    // ✅ V00126: preferir la referencia resuelta de la operación antes que un valor directo tipo id
    const infoRef = info?.ref ? String(info.ref) : '';
    return (infoRef && !/^[0-9a-f]{8,}$/i.test(infoRef) ? infoRef : '') || directos[0] || infoRef || id;
  };
  const refDeOp = (op: OpLike | null | undefined): string => refDeOpCon(op);

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));
  useEffect(() => { setPaginaActual(1); }, [filtroCliente, ordenFac, fechaDesdeHist, fechaHastaHist, textoBuscarFactura, filtroStatusFactura, filtroMonedaHist]);
  useEffect(() => { setPaginaOps(1); }, [filtroCliente, ordenOps, fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, vistaOps, operacionesGlobales, filtroTipoOp]);

  const nombreClienteFactura_ = (f: any): string => {
    // ✅ V00262: MANDA el nombre de EMPRESAS. Se resuelve por clienteId o por
    //   el nombre guardado (getNombreCliente matchea id, nombre y nombreCorto);
    //   lo guardado en la factura queda de respaldo.
    if (f.clienteId) {
      const nom = getNombreCliente(f.clienteId);
      if (nom && nom !== '-' && nom !== f.clienteId) return nom;
    }
    const guardado = String(f.clienteNombre || f.cliente || '').trim();
    if (guardado) {
      const nom = getNombreCliente(guardado);
      if (nom && nom !== '-') return nom;
      return guardado;
    }
    return '-';
  };

  // ✅ REF CLIENTE de una factura: junta las referencias de cliente de sus
  //   operaciones (del snapshot o resueltas en vivo con opInfoMap), sin repetir.
  const refClienteDeFactura = (f: OpLike, extra?: Record<string, InfoOp>): string => { // ✅ V00260: mapa extra para exportación
    const refs: string[] = [];
    const vistos = new Set<string>();
    (Array.isArray(f?.operacionesGuardadas) ? (f.operacionesGuardadas as OpLike[]) : []).forEach((op) => {
      const k = String(op?.id || '');
      const v = String(op?.refCliente || (extra && extra[k])?.refCliente || opInfoMap[k]?.refCliente || '').trim();
      if (v && !vistos.has(v.toLowerCase())) { vistos.add(v.toLowerCase()); refs.push(v); }
    });
    return refs.join(', ');
  };

  // ✅ V00260: RESUELVE TODAS las referencias de operación del conjunto a
  //   exportar. El opInfoMap normal solo cubre las filas VISIBLES (paginación,
  //   tope 150) — por eso el Excel de facturas salía con IDs (7657fa80…) en
  //   vez de las referencias (TR-…): las facturas fuera de la página caían al
  //   fallback. Aquí se consultan por lotes de 30 (documentId in) TODOS los
  //   ids faltantes del historial filtrado y se regresa el mapa para uso
  //   inmediato (también se guarda en opInfoMap para la tabla).
  const resolverOpsParaExport = async (facturas: OpLike[]): Promise<Record<string, InfoOp>> => {
    const faltantes = new Set<string>();
    const considerar = (id: string) => {
      const k = String(id || '').trim();
      if (!k || opInfoMap[k] || pareceReferencia(k) || k.length < 6) return;
      faltantes.add(k);
    };
    const considerarValor = (valor: unknown) => String(valor || '').split(/[,\s]+/).forEach(t => considerar(t));
    facturas.forEach((f) => {
      (Array.isArray(f.operacionesGuardadas) ? (f.operacionesGuardadas as OpLike[]) : []).forEach((op) => {
        considerar(String(op?.id || ''));
        considerarValor(op?.ref);
      });
      (Array.isArray(f.operacionesIds) ? (f.operacionesIds as unknown[]) : []).forEach((id) => considerar(String(id || '')));
    });
    const nuevos: Record<string, InfoOp> = {};
    const ids = Array.from(faltantes);
    // ✅ V00261: los lotes van en PARALELO (12 a la vez). Con miles de facturas
    //   la versión en serie tardaba minutos sin avisar y parecía que el botón
    //   "no funcionaba".
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
    const CONCURRENCIA = 12;
    for (let g = 0; g < chunks.length; g += CONCURRENCIA) {
      await Promise.all(chunks.slice(g, g + CONCURRENCIA).map((chunk) => (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', chunk)));
        snap.docs.forEach(d => {
          const o = { id: d.id, ...(d.data() as Record<string, unknown>) } as Record<string, string>;
          nuevos[d.id] = {
            ref: o.numReferencia || o.referencia || o.ref || d.id,
            remolque: txt(o.remolqueNombre, o.remolquePlaca, o.numeroRemolque),
            moneda: textoFacturadoEn(o, 'cliente'), // ✅ V00489
            clienteId: o.clientePaga || o.clienteId || '',
            refCliente: String(o.refCliente || ''),
          };
        });
      } catch (e) { console.warn('No se pudo resolver lote de operaciones para exportar:', e); }
      })()));
    }
    if (Object.keys(nuevos).length) setOpInfoMap(prev => ({ ...prev, ...nuevos }));
    return nuevos;
  };

  // ✅ NUEVO — QUITAR UNA REFERENCIA (operación) DE LA FACTURA:
  //   la operación vuelve a "Por facturar", la factura recalcula totales y
  //   saldo con las operaciones restantes, y si la factura está aplicada en
  //   PAGOS, el snapshot del pago se actualiza con el nuevo total/saldo.
  const [quitandoRef, setQuitandoRef] = useState('');
  const quitarRefDeFactura = async (fv: any, opSnap: any) => {
    if (quitandoRef) return;
    const guardadas: any[] = Array.isArray(fv.operacionesGuardadas) ? fv.operacionesGuardadas : [];
    if (guardadas.length <= 1) {
      alert('No puedes dejar la factura sin operaciones.\n\nSi quieres deshacerla por completo, usa el botón de eliminar factura (las operaciones vuelven a Por facturar).');
      return;
    }
    const restantes = guardadas.filter((g) => String(g.id) !== String(opSnap.id));
    const nativoNuevo = totalNativoFactura({ monedaFacturacion: fv.monedaFacturacion, operacionesGuardadas: restantes });
    const pagado = Number(fv.montoPagado) || 0;
    if (nativoNuevo < pagado - 0.009) {
      alert(`No se puede quitar: el nuevo total (${formatoMoneda(nativoNuevo)}) quedaría por debajo de lo ya pagado (${formatoMoneda(pagado)}).\n\nElimina primero el pago aplicado en el módulo de Pagos y vuelve a intentar.`);
      return;
    }
    if (!window.confirm(`¿Quitar la referencia ${refDeOp(opSnap)} de la factura ${fv.invoice}?\n\n· La operación vuelve a "Por facturar".\n· La factura queda con ${restantes.length} operación(es) y total ${formatoMoneda(nativoNuevo)}.${pagado > 0 ? '\n· El pago aplicado se actualizará con el nuevo total/saldo.' : ''}`)) return;
    setQuitandoRef(String(opSnap.id));
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, lo hace el servidor (transacción;
      //   el historial del pago ya no se reescribe: el saldo vive en la factura).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('quitarOperacionFactura', { lado: 'cliente', operacionId: String(opSnap.id), permitirBorrarFactura: false });
        setFacturasGlobales((prev) => aplicarFacturas(prev, r.facturas, normalizarFactura));
        // La ficha (que puede ser un grupo de documentos) quita la operación aquí y toma
        // del servidor solo los totales del documento que la tenía.
        const nueva = r.facturas[fv.id];
        setFacturaViendo(normalizarFactura({
          ...fv, operacionesGuardadas: restantes,
          operacionesIds: (Array.isArray(fv.operacionesIds) ? fv.operacionesIds : []).filter((id: unknown) => String(id) !== String(opSnap.id)),
          ...(nueva ? camposEditadosFactura(nueva) : {}), id: fv.id,
        }));
        setOperacionesGlobales((prev) => aplicarOperaciones(prev, r.operaciones));
        return;
      }
      // ✅ V00451: se trabaja sobre las facturas FRESCAS que contienen la operación (antes se
      //   escribía la lista combinada de la ficha —que pudo quedar vieja y que en un grupo junta
      //   varios documentos— en el primero: se perdían operaciones agregadas después y el primer
      //   documento quedaba con las de los demás).
      const opIdQuitar = String(opSnap.id);
      const opLista = operacionesGlobales.find((o) => String(o.id) === opIdQuitar);
      const frescasConOp = await facturasFrescasConOp(opIdQuitar, opLista?.facturaClienteId);
      if (frescasConOp.length === 0) {
        alert('Esa operación ya no está en esta factura (alguien la cambió). La lista se va a refrescar.');
        recargarTodo();
        return;
      }
      const batch = writeBatch(db);
      const cambios: any[] = [];
      const totalesPorFactura = new Map<string, { total: number; pagado: number; pagosIds: string[] }>();
      for (const f of frescasConOp) {
        const ids = (f.operacionesIds || []).map(String).filter((id: string) => id !== opIdQuitar);
        const guardadas = (f.operacionesGuardadas || []).filter((o: any) => String(o.id) !== opIdQuitar);
        if (ids.length === 0) {
          if (tienePagosAplicados(f)) return alert(`La operación ${refDeOp(opSnap)} es la única del documento ${f.invoice}, que se eliminaría.\n\n${avisoFacturaConPagos(formatoMoneda(montoPagadoDe(f)))}`);
          batch.delete(doc(db, 'facturas_clientes', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
          continue;
        }
        const totales = totalesTrasCambioDeOps(f, guardadas);
        if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
        const data = { operacionesIds: ids, operacionesGuardadas: guardadas, operaciones: guardadas.map((g: any) => refDeOp(g)).filter(Boolean), remolques: remolquesDeGuardadas(guardadas), ...totales.campos, updatedAt: new Date().toISOString() };
        batch.set(doc(db, 'facturas_clientes', f.id), data, { merge: true });
        cambios.push({ tipo: 'update', id: f.id, data });
        totalesPorFactura.set(String(f.id), { total: totales.total, pagado: montoPagadoDe(f), pagosIds: Array.isArray(f.pagosIds) ? f.pagosIds.map(String) : [] });
      }
      // ✅ V00451: los archivos de un documento del folio que se borra pasan al otro documento del folio.
      (await rescatarDocsDeBorradas('clientes', frescasConOp.filter((f: { id?: unknown }) => cambios.some((c) => c.tipo === 'delete' && c.id === f.id)), facturasGlobales, batch))
        .forEach((e) => cambios.push({ tipo: 'update', id: e.id, data: e.campos }));
      // La operación vuelve a "Por facturar".
      batch.set(doc(db, 'operaciones', String(opLista ? idDeLista(opLista) : opIdQuitar)), {
        facturaClienteId: '', facturaClienteInvoice: '', facturado: false,
      }, { merge: true });
      await batch.commit();

      // ✅ Propagación a PAGOS: actualiza el snapshot de cada documento cambiado en los pagos
      //   donde esté aplicado (total y saldo nuevos).
      try {
        for (const [facturaId, t] of totalesPorFactura) {
          for (const pagoId of t.pagosIds) {
            const snapPago = await getDoc(doc(db, 'pagos', pagoId));
            if (!snapPago.exists()) continue;
            const pData: any = snapPago.data();
            const facturasPago: any[] = Array.isArray(pData.facturas) ? pData.facturas : [];
            let cambio = false;
            const nuevas = facturasPago.map((fa: any) => {
              if (String(fa.facturaId) !== facturaId) return fa;
              cambio = true;
              return { ...fa, total: t.total, saldoNuevo: Math.max(0, t.total - t.pagado) };
            });
            if (cambio) await setDoc(doc(db, 'pagos', pagoId), { facturas: nuevas }, { merge: true });
          }
        }
      } catch (eP) { console.warn('No se pudo actualizar el snapshot del pago:', eP); }

      void registrarLog('Facturación Clientes', 'Edición', `Quitó la referencia ${refDeOp(opSnap)} de la factura ${fv.invoice}.`);
      // Refresco local (tabla + modal).
      aplicarCambiosFacturas(cambios);
      const primero = cambios.find((c) => c.tipo === 'update' && c.id === fv.id);
      // ✅ V00451: la ficha deja de apuntar a los documentos borrados (guardar sus archivos fallaba).
      const borrados = new Set(cambios.filter((c) => c.tipo === 'delete').map((c) => String(c.id)));
      const idsVivos = (Array.isArray(fv.__groupIds) ? fv.__groupIds : [fv.id]).map(String).filter((id: string) => !borrados.has(id));
      setFacturaViendo(normalizarFactura({
        ...fv, operacionesGuardadas: restantes,
        operacionesIds: (Array.isArray(fv.operacionesIds) ? fv.operacionesIds : []).filter((id: any) => String(id) !== opIdQuitar),
        ...(primero ? { subtotalFactura: primero.data.subtotalFactura ?? fv.subtotalFactura, subtotalMonedaFactura: primero.data.subtotalMonedaFactura ?? fv.subtotalMonedaFactura } : {}),
        ...(Array.isArray(fv.__groupIds) ? {
          __groupIds: idsVivos,
          __groupDocs: (Array.isArray(fv.__groupDocs) ? fv.__groupDocs : []).filter((d: { id?: unknown } | null) => !borrados.has(String(d?.id))),
        } : {}),
        id: borrados.has(String(fv.id)) && idsVivos.length ? idsVivos[0] : fv.id,
      }));
      setOperacionesGlobales((prev: any[]) => prev.map((o: any) => String(o.id) === opIdQuitar ? { ...o, facturaClienteId: '', facturaClienteInvoice: '', facturado: false } : o));
      avisarOpsFacturacion([opIdQuitar], { facturaClienteId: '', facturaClienteInvoice: '', facturado: false });
    } catch (e) {
      console.error('No se pudo quitar la referencia:', e);
      alert(mensajeDinero(e, 'No se pudo quitar la referencia. Intenta de nuevo.'));
    } finally {
      setQuitandoRef('');
    }
  };

  const renderCeldaFactura = (f: any, colId: string) => {
    switch (colId) {
      case 'statusFactura': return chipStatusFactura(f.statusFactura);
      case 'invoice': return <span className="fcd-x10">{f.invoice}</span>;
      case 'fecha': return <span className="fcd-x11">{formatearFechaSpanish(f.fecha)}</span>;
      case 'remolque': return renderRemolqueTokens(remolquesFacturaTokens(f));
      case 'cliente': return <span className="fcd-x12">{nombreClienteFactura_(f)}</span>;
      case 'refCliente': { const rc = refClienteDeFactura(f); return rc ? <span className="fcd-x11">{rc}</span> : <span className="fcd-x1">-</span>; }
      case 'numeroPago': { const nums = numerosPagoDe(f); return nums.length ? <span className="fac-chips-pago">{nums.map(n => <span key={n} className="fac-chip-pago" title="Número de pago aplicado">{n}</span>)}</span> : <span className="fac-sin-pago">—</span>; }
      case 'moneda': { const mon = monedaFacturaMostrar(f); return <NombreMoneda moneda={mon} respaldo={mon} />; } // ✅ V00481
      case 'facturaCcp': return <span className="fcd-x11">{f.facturaCcp || '-'}</span>;
      case 'cantOps': return <span className="fcd-x1">{f.operacionesIds?.length || 0}</span>;
      case 'referencias': {
        const ops: any[] = Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : [];
        if (ops.length === 0) return <span className="fcd-x1">-</span>;
        return (
          <div className="fcd-x13">
            {ops.slice(0, 3).map((op: any, idx: number) => (
              <button className="fcd-x14"
                key={`${f.id}_ref_${op?.id || idx}`}
                onClick={(e) => { e.stopPropagation(); if (op?.id) setOpEditandoId(String(op.id)); }} /* ✅ V00274: abre el EDITOR de la operación */
                title="Editar esta operación en el formulario de Operaciones">
                {refDeOp(op)}
              </button>
            ))}
            {ops.length > 3 && (/* ✅ V00482: el resto en la ficha */
              <button type="button" className="fcd-mas-refs" onClick={(e) => { e.stopPropagation(); setFacturaViendo(f); }} title="Ver todas en la ficha">+{ops.length - 3}</button>
            )}
          </div>
        );
      }
      case 'total': return <Importe monto={totalDeGrupo(f)} moneda={monedaFacturaMostrar(f)} className="fcd-x15" />; // ✅ V00481
      case 'createdAt': return <span className="fcd-x1">{f.createdAt ? formatearFechaHora(f.createdAt) : '-'}</span>;
      default: return '-';
    }
  };

  // ✅ (E) Exportación PROFESIONAL a Excel del Historial (ExcelJS con estilos + logo).
  const [exportandoExcelHist, setExportandoExcelHist] = useState(false); // ✅ V00261

  // ✅ V00262: modal "Exportar a Excel" con selección y ORDEN de columnas
  //   (mismo patrón de Servicios Completados: cuadrícula + Drag & Drop).
  const [modalExportarFac, setModalExportarFac] = useState(false);
  // ✅ V00264: TARJETAS CLICABLES del historial — al presionar una tarjeta se
  //   abre el detalle de DÓNDE SALE el número (las facturas que lo componen),
  //   con opción de descargar en Excel exactamente esa información.
  type TarjetaResumen = 'listadas' | 'ops' | 'usd' | 'mxn';
  type FacturaLike = { id?: string; invoice?: unknown; fecha?: unknown; operacionesIds?: unknown[]; operacionesGuardadas?: OpLike[]; [k: string]: unknown };
  const [tarjetaAbierta, setTarjetaAbierta] = useState<TarjetaResumen | null>(null);
  const [exportandoTarjeta, setExportandoTarjeta] = useState(false);
  const monedaTarjetaDe = (f: FacturaLike): 'usd' | 'mxn' | 'otra' => {
    // ✅ V00439 (Fase 3.x): helper compartido (acepta las mismas formas y más).
    const mon = monedaCanonicaComun(monedaFacturaMostrar(f));
    return mon === 'USD' ? 'usd' : mon === 'MXN' ? 'mxn' : 'otra';
  };
  const facturasDeTarjeta = useMemo(() => {
    if (!tarjetaAbierta) return [] as FacturaLike[];
    if (tarjetaAbierta === 'listadas') return historialOrdenado as FacturaLike[]; // todas las del filtro actual
    // ✅ V00493: 'ops', 'usd' y 'mxn' sin las canceladas (como la tarjeta).
    const suman = (historialOrdenado as FacturaLike[]).filter((f) => sumaEnTotales(f.statusFactura, filtroStatusFactura));
    if (tarjetaAbierta === 'usd') return suman.filter((f) => monedaTarjetaDe(f) === 'usd');
    if (tarjetaAbierta === 'mxn') return suman.filter((f) => monedaTarjetaDe(f) === 'mxn');
    return suman;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- monedaTarjetaDe se recrea por render; historialOrdenado cubre el cambio real
  }, [tarjetaAbierta, historialOrdenado, filtroStatusFactura]);
  const tituloTarjeta: Record<TarjetaResumen, string> = {
    listadas: 'Facturas Listadas',
    ops: 'Ops. Facturadas',
    usd: 'Total Facturado (USD)',
    mxn: 'Total Facturado (MXN)',
  };
  // ✅ V00493: el total de la FILA (un folio con varios documentos), el mismo de la tarjeta y la tabla.
  const totalTarjetaAbierta = useMemo(() => facturasDeTarjeta.reduce((acc: number, f) => acc + totalDeGrupo(f), 0), [facturasDeTarjeta, totalDeGrupo]);
  const opsTarjetaAbierta = useMemo(() => facturasDeTarjeta.reduce((acc: number, f) => acc + (Array.isArray(f.operacionesIds) ? f.operacionesIds.length : 0), 0), [facturasDeTarjeta]);
  const exportarTarjetaExcel = async () => {
    if (exportandoTarjeta || !tarjetaAbierta || facturasDeTarjeta.length === 0) return;
    setExportandoTarjeta(true);
    try {
      const mapaExport = await resolverOpsParaExport(facturasDeTarjeta);
      const filas = facturasDeTarjeta.map((f) => ({
        invoice: f.invoice || '',
        fecha: f.fecha || '',
        cliente: nombreClienteFactura_(f),
        moneda: monedaFacturaMostrar(f),
        cantOps: Number(f.operacionesIds?.length || 0),
        referencias: Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas.map((op) => refDeOpCon(op, mapaExport)).filter(Boolean).join(', ') : '',
        total: totalDeGrupo(f), // ✅ V00493: total de la fila (como la tarjeta)
      }));
      await exportarExcelProfesional({
        nombreArchivo: `Tarjeta_${tarjetaAbierta.toUpperCase()}_${hoyLocalISO()}.xlsx`,
        tituloReporte: `Facturación · ${tituloTarjeta[tarjetaAbierta]}`,
        subtitulo: `${filas.length} facturas · ${opsTarjetaAbierta} operaciones · Total ${formatoMoneda(totalTarjetaAbierta)} · filtros actuales del historial`,
        nombreHoja: 'Detalle',
        columnas: [
          { key: 'invoice', label: 'Invoice', tipo: 'texto' as const },
          { key: 'fecha', label: 'Fecha', tipo: 'fecha' as const },
          { key: 'cliente', label: 'Cliente', tipo: 'texto' as const },
          { key: 'moneda', label: 'Moneda', tipo: 'texto' as const },
          { key: 'cantOps', label: 'Cant. Ops', tipo: 'numero' as const },
          { key: 'referencias', label: 'Referencias', tipo: 'texto' as const },
          { key: 'total', label: 'Total', tipo: 'monto' as const },
        ],
        filas,
      });
    } catch (e) {
      console.error('No se pudo exportar el detalle de la tarjeta:', e);
      alert('No se pudo exportar el detalle de la tarjeta.');
    } finally {
      setExportandoTarjeta(false);
    }
  };
  const [columnasExportFac, setColumnasExportFac] = useState<{ id: string; label: string; visible: boolean }[]>([]);
  const dragExportFacIdx = useRef<number | null>(null);
  const [dragOverExportFacIdx, setDragOverExportFacIdx] = useState<number | null>(null);
  const abrirModalExportarFac = () => {
    setColumnasExportFac(columnasFactura.map(c => ({ id: c.id, label: c.label, visible: c.visible })));
    setModalExportarFac(true);
  };
  const soltarColumnaExportFac = (destino: number) => {
    const origen = dragExportFacIdx.current;
    dragExportFacIdx.current = null;
    setDragOverExportFacIdx(null);
    if (origen === null || origen === destino) return;
    setColumnasExportFac(prev => {
      const arr = [...prev];
      const [mov] = arr.splice(origen, 1);
      arr.splice(destino, 0, mov);
      return arr;
    });
  };
  const exportarCSV = async () => {
    if (exportandoExcelHist) return;
    if (historialOrdenado.length === 0) return alert('No hay datos para exportar.');
    // ✅ V00262: exporta con la selección y el ORDEN elegidos en el modal.
    const columnasVisibles = (columnasExportFac.length ? columnasExportFac : columnasFactura).filter(c => c.visible);
    if (columnasVisibles.length === 0) return alert('Selecciona al menos una columna para exportar.');
    setModalExportarFac(false);
    setExportandoExcelHist(true);
    try { // ✅ V00261: cualquier fallo (incluida la resolución) avisa en vez de quedarse callado

    // ✅ V00260: resolver las referencias de TODO el historial (no solo la
    //   página visible) para que el Excel salga con TR-…, no con IDs.
    const mapaExport = await resolverOpsParaExport(historialOrdenado);

    const tipoExcel = (id: string): 'texto' | 'fecha' | 'fechaHora' | 'monto' | 'numero' => {
      if (id === 'total') return 'monto';
      if (id === 'fecha') return 'fecha';
      if (id === 'createdAt') return 'fechaHora';
      if (id === 'cantOps') return 'numero';
      return 'texto';
    };
    const columnas = columnasVisibles.map(c => ({ key: c.id, label: c.label, tipo: tipoExcel(c.id) }));

    const valorRaw = (f: any, colId: string): any => {
      switch (colId) {
        case 'statusFactura': return f.statusFactura || 'Facturado';
        case 'invoice': return f.invoice || '';
        case 'fecha': return f.fecha || '';
        case 'remolque': return remolqueTokensTexto(remolquesFacturaTokens(f));
        case 'cliente': return nombreClienteFactura_(f);
        case 'refCliente': return refClienteDeFactura(f, mapaExport); // ✅ V00260
        case 'numeroPago': return numerosPagoDe(f).join(', ');
        case 'moneda': return monedaFacturaMostrar(f);
        case 'facturaCcp': return f.facturaCcp || '';
        case 'cantOps': return Number(f.operacionesIds?.length || 0);
        case 'referencias': return Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas.map((op: any) => refDeOpCon(op, mapaExport)).filter(Boolean).join(', ') : ''; // ✅ V00260
        case 'total': return totalDeGrupo(f); // ✅ FIX MONEDA · V00448 · V00451: fila agrupada
        case 'createdAt': return f.createdAt || '';
        default: return '';
      }
    };

    const filas = historialOrdenado.map(f => {
      const fila: any = {};
      columnasVisibles.forEach(col => { fila[col.id] = valorRaw(f, col.id); });
      return fila;
    });

    const cliTxt = filtroCliente ? (nombreClienteSeleccionado || 'Cliente') : 'Todos los clientes';
    const rangoTxt = (fechaDesdeHist || fechaHastaHist) ? `${fechaDesdeHist || 'inicio'} a ${fechaHastaHist || 'hoy'}` : 'Todas las fechas';
    const statusTxt = filtroStatusFactura && filtroStatusFactura !== 'Todos' ? filtroStatusFactura : 'Todos los status';

    try {
      await exportarExcelProfesional({
        nombreArchivo: `Facturas_Clientes_${hoyLocalISO()}.xlsx`,
        tituloReporte: 'Reporte de Facturación · Facturas',
        subtitulo: `${statusTxt}  ·  Cliente: ${cliTxt}  ·  ${rangoTxt}  ·  ${filas.length} facturas`,
        nombreHoja: 'Facturas',
        columnas,
        filas,
      });
    } catch (e) {
      console.error('Error exportando Excel de facturas:', e);
      alert('No se pudo generar el Excel.');
    }
    } catch (e) { // ✅ V00261
      console.error('Error preparando el Excel de facturas:', e);
      alert('No se pudo generar el Excel (falló la resolución de referencias). Intenta de nuevo.');
    } finally {
      setExportandoExcelHist(false); // ✅ V00261
    }
  };

  // ✅ (F) Preparar la remisión de una factura → abre el modal de vista previa.
  //    Emisor según moneda: USD → Camila (emisorUSD), MXN → Rolando (emisorMXN).
  const abrirRemision = async (f: any) => {
    if (!f) return;
    if (!puedeGenerarRemision(f.statusFactura)) { alert(AVISO_REMISION_FACTURADA); return; } // ✅ V00481
    setCargandoRemision(true);
    try {
      // ✅ El encabezado toma la MONEDA YA FACTURADA, la misma de la columna
      //   "Moneda" del historial (monedaFacturaMostrar): si es Dólares/USD sale
      //   Camila; si es Pesos/MXN sale Rolando. La columna resuelve el NOMBRE
      //   del catálogo ("Dolares"/"Pesos"), por eso se detecta por texto y no
      //   solo por el código USD.
      // ✅ Fase 1.8 (e): helper compartido (acepta ID del catálogo, 'USD', 'Dólares', 'DLS'…).
      const esUSD = esMonedaUSD(monedaFacturaMostrar(f));
      const emisor = esUSD ? emisorUSD : emisorMXN;

      const ids = (Array.from(new Set((f.operacionesIds || []).map((x: any) => String(x)))) as string[]).filter(Boolean); // ✅ V00443 (Fase 7.10): todas (antes solo las primeras 60)
      const byId = new Map<string, any>();
      // ✅ V00443 (Fase 7.8): tandas de 30 EN PARALELO (antes una tras otra).
      const tandas: string[][] = [];
      for (let i = 0; i < ids.length; i += 30) tandas.push(ids.slice(i, i + 30));
      await Promise.all(tandas.map(async (chunk) => {
        try {
          const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', chunk)));
          snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) }));
        } catch (e) { console.warn('No se pudieron leer operaciones para la remisión:', e); }
      }));

      const guardadas: any[] = Array.isArray(f.operacionesGuardadas) && f.operacionesGuardadas.length
        ? f.operacionesGuardadas
        : ids.map((id) => ({ id }));

      const filas = guardadas.map((g: any) => {
        const o = byId.get(String(g.id)) || {};
        // (REMISIÓN CLIENTES) En EQ va el # de REMOLQUE; la unidad solo como
        // respaldo cuando la operación no tiene remolque capturado.
        const equipoRemolque = txt(o.remolqueNombre, o.remolquePlaca, o.numeroRemolque);
        const equipo = equipoRemolque !== '-' ? equipoRemolque : txt(o.unidadNombre, o.unidad);
        const importe = Number(g.monto) || (o.id ? obtenerMontoOperacion(o).conv : 0) || 0;
        const ref = refDeOp({ ...g, ...o }) || o.numReferencia || g.ref || '';
        const fechaFmt = formatearFechaSpanish(o.fechaServicio || o.createdAt || '');
        const org = txt(o.origenNombre, o.origen);
        const dst = txt(o.destinoNombre, o.destino);
        return {
          ref,
          fecha: fechaFmt === '-' ? '' : fechaFmt,
          equipo: equipo === '-' ? '' : equipo,
          origen: org === '-' ? '' : org,
          destino: dst === '-' ? '' : dst,
          descripcion: o.descripcionServicio || o.observacionesEjecutivo || o.descripcionMercancia || '',
          importe,
        };
      });

      const totalCalc = filas.reduce((s: number, r: any) => s + (Number(r.importe) || 0), 0);
      const total = totalCalc > 0 ? totalCalc : (Number(f.subtotalFactura) || 0);

      const emp: any = empresasList.find(e => e.id === f.clienteId) || {};

      setRemisionPreview({
        esUSD,
        emisorNombre: emisor.facturaNombre,
        emisorDireccion: emisor.direccion,
        emisorCiudadEstado: emisor.ciudadEstado,
        emisorEmail: emisor.email,
        numero: f.invoice || String(f.id || ''),
        fecha: String(f.fecha || '').slice(0, 10),
        clienteNombre: f.clienteNombre || getNombreCliente(f.clienteId) || '',
        diasCredito: String(emp.diasCredito ?? emp.credito ?? emp.diasDeCredito ?? ''),
        direccion: String(emp.direccion ?? emp.domicilio ?? emp.calle ?? ''),
        numExtInt: String(emp.numExtInt ?? emp.numeroExterior ?? emp.numExt ?? ''),
        colonia: String(emp.colonia ?? ''),
        ciudad: String(emp.ciudad ?? emp.municipio ?? ''),
        moneda: esUSD ? 'Dólares' : 'Pesos',
        observaciones: '',
        fechaTipoCambio: '',
        tipoCambio: '',
        total,
        filas,
      });
    } catch (e) {
      console.error('Error preparando la remisión:', e);
      alert('No se pudo preparar la remisión.');
    } finally {
      setCargandoRemision(false);
    }
  };

  const generarPDFDeRemision = () => {
    if (!remisionPreview) return;
    const data: RemisionData = {
      emisor: {
        facturaNombre: remisionPreview.emisorNombre || '',
        direccion: remisionPreview.emisorDireccion || '',
        ciudadEstado: remisionPreview.emisorCiudadEstado || '',
        email: remisionPreview.emisorEmail || '',
      },
      numero: remisionPreview.numero || '',
      fecha: remisionPreview.fecha || '',
      clienteNombre: remisionPreview.clienteNombre || '',
      diasCredito: remisionPreview.diasCredito || '',
      direccion: remisionPreview.direccion || '',
      numExtInt: remisionPreview.numExtInt || '',
      colonia: remisionPreview.colonia || '',
      ciudad: remisionPreview.ciudad || '',
      moneda: remisionPreview.moneda || '',
      observaciones: remisionPreview.observaciones || '',
      fechaTipoCambio: remisionPreview.fechaTipoCambio || '',
      tipoCambio: remisionPreview.tipoCambio || '',
      total: Number(remisionPreview.total) || 0,
      filas: (remisionPreview.filas || []).map((r: any) => ({
        ref: r.ref || '',
        fecha: r.fecha || '',
        equipo: r.equipo || '',
        origen: r.origen || '',
        destino: r.destino || '',
        descripcion: r.descripcion || '',
        importe: Number(r.importe) || 0,
      })),
    };
    generarRemisionPDF(data);
  };

  const setRP = (campo: string, valor: any) => setRemisionPreview((prev: any) => prev ? { ...prev, [campo]: valor } : prev);

  // ✅ Cambia el emisor de la remisión abierta (Rolando/MXN ↔ Camila/USD) sin
  //   perder el resto de la captura; también actualiza la denominación. Los
  //   campos del encabezado siguen siendo editables a mano después del cambio.
  const aplicarEmisorEnPreview = (usarUSD: boolean) => {
    const emisor = usarUSD ? emisorUSD : emisorMXN;
    setRemisionPreview((prev: any) => prev ? {
      ...prev,
      esUSD: usarUSD,
      emisorNombre: emisor.facturaNombre,
      emisorDireccion: emisor.direccion,
      emisorCiudadEstado: emisor.ciudadEstado,
      emisorEmail: emisor.email,
      moneda: usarUSD ? 'Dólares' : 'Pesos',
    } : prev);
  };
  const setRPFila = (idx: number, campo: string, valor: any) =>
    setRemisionPreview((prev: any) => {
      if (!prev) return prev;
      const filas = [...(prev.filas || [])];
      filas[idx] = { ...filas[idx], [campo]: valor };
      const total = filas.reduce((s: number, r: any) => s + (Number(r.importe) || 0), 0);
      return { ...prev, filas, total };
    });
  const quitarFilaRemision = (idx: number) =>
    setRemisionPreview((prev: any) => {
      if (!prev) return prev;
      const filas = (prev.filas || []).filter((_: any, i: number) => i !== idx);
      const total = filas.reduce((s: number, r: any) => s + (Number(r.importe) || 0), 0);
      return { ...prev, filas, total };
    });

  const handleDragStart = (_e: React.DragEvent, index: number) => setDraggedColIndex(index);
  const handleDragEnter = (index: number) => {
    if (draggedColIndex === null || draggedColIndex === index) return;
    const nuevas = [...columnasFactura];
    const movida = nuevas.splice(draggedColIndex, 1)[0];
    nuevas.splice(index, 0, movida);
    setDraggedColIndex(index);
    setColumnasFactura(nuevas);
  };
  const toggleColumnaVisible = (index: number) => {
    const nuevas = [...columnasFactura];
    nuevas[index].visible = !nuevas[index].visible;
    setColumnasFactura(nuevas);
  };

  const verDetalleOperacion = async (opId: string) => {
    if (!opId) return;
    setCargandoDetalle(true);
    setPestañaDetalleActiva('general');
    try {
      const snap = await getDoc(doc(db, 'operaciones', idRealOp(opId))); // ✅ V00451: id real
      if (snap.exists()) {
        setOperacionDetalle({ id: snap.id, ...(snap.data() as any) });
      } else {
        alert('No se encontró la operación (puede haber sido eliminada).');
      }
    } catch (e) {
      console.error('Error cargando detalle de operación:', e);
      alert('No se pudo cargar el detalle de la operación.');
    }
    setCargandoDetalle(false);
  };

  const det = operacionDetalle;
  // ✅ V00481: moneda e importes por operación de la ficha abierta (en la moneda de la factura).
  const monedaFicha = facturaViendo ? monedaFacturaMostrar(facturaViendo) : '';
  const importesFicha = facturaViendo ? importesDeRenglones(monedaFicha, facturaViendo.operacionesGuardadas) : [];
  // ✅ V00483: pagos aplicados a la factura abierta (todos los documentos de su folio).
  const pagosFicha = facturaViendo
    ? pagosDeFacturas(pagosDetalle, (Array.isArray(facturaViendo.__groupIds) && facturaViendo.__groupIds.length ? facturaViendo.__groupIds : [facturaViendo.id]).map(String))
    : [];
  const evalTipoOpText = String(det?.tipoOperacionNombre || det?.tipoOperacionId || '').toLowerCase();
  const evalIsFletes = evalTipoOpText.includes('fletes') || evalTipoOpText.includes('flete');
  const evalIsLogistica = evalTipoOpText.includes('logistica') || evalTipoOpText.includes('logística');
  const evalIsTransfer = evalTipoOpText.includes('transfer');
  const evalIsRoelca = String(det?.proveedorUnidadNombre || det?.proveedorUnidad || '').toLowerCase().includes('roelca');
  const showDetailInternalFleet = evalIsTransfer || ((evalIsLogistica || evalIsFletes) && evalIsRoelca);
  const showDetailExternalFleet = (evalIsLogistica || evalIsFletes) && !evalIsRoelca;

  const tabsDetalle = [
    { id: 'general', label: 'Información General' },
    { id: 'pedimento', label: 'Pedimento y CT' },
    { id: 'manifiestos', label: "Entry's y Manifiestos" },
    { id: 'unidad', label: 'Unidad y Operador' },
    { id: 'cobrar', label: 'Por Cobrar' },
  ];

  const tabStyle = (active: boolean) => ({
    padding: '12px 24px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? '#f0f6fc' : '#8b949e', borderBottom: active ? '2px solid #D84315' : '2px solid transparent',
    fontWeight: active ? 'bold' : 'normal' as any,
  });
  const thOrdenStyle: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
  const selectOrdenStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 10px', fontSize: '0.85rem' };
  const btnDirStyle: React.CSSProperties = { backgroundColor: '#21262d', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '8px 12px', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' };
  const dateInputStyle: React.CSSProperties = { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', padding: '9px 10px', fontSize: '0.9rem', colorScheme: 'dark' };

  const segBtnStyle = (active: boolean, col: string): React.CSSProperties => ({
    padding: '8px 14px', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold', whiteSpace: 'nowrap',
    backgroundColor: active ? `${col}22` : 'transparent',
    color: active ? col : '#8b949e',
    borderBottom: active ? `2px solid ${col}` : '2px solid transparent',
  });

  // Estilos reutilizables de los modales de remisión.
  const rInputStyle: React.CSSProperties = { width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.85rem', boxSizing: 'border-box' };
  const rLabelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.72rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' };
  const rCellStyle: React.CSSProperties = { padding: '6px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', color: '#c9d1d9', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' };

  const BuscadorCliente = () => (
    <div className="fcd-x16">
      <label className="fcd-x17">CLIENTE (opcional)</label>
      {filtroCliente ? (
        <div className="fcd-x18">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span className="fcd-x19">{nombreClienteSeleccionado}</span>
          <button className="fcd-x20" onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }} title="Quitar cliente">✕</button>
        </div>
      ) : (
        <div className="fcd-x21">
          <svg className="fcd-x22" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input className="fcd-x23" type="text" placeholder="Buscar cliente por nombre o RFC (opcional)..." value={textoBuscarCliente}
            onChange={(e) => { setTextoBuscarCliente(e.target.value); setMostrarSugerenciasCliente(true); }}
            onFocus={() => setMostrarSugerenciasCliente(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasCliente(false), 180)} />
        </div>
      )}
      {!filtroCliente && mostrarSugerenciasCliente && (
        <div className="fcd-x24">
          {clientesFiltradosBuscador.length === 0 ? (
            <div className="fcd-x25">{textoBuscarCliente.trim() ? 'Sin coincidencias' : 'No hay clientes (tipo Cliente-Paga) cargados'}</div>
          ) : (
            <>
              <div className="fcd-x26">{clientesFiltradosBuscador.length} {clientesFiltradosBuscador.length === 1 ? 'cliente' : 'clientes'}{textoBuscarCliente.trim() ? '' : ' (primeros 30)'}</div>
              {clientesFiltradosBuscador.map((cli: any) => (
                <div className="fcd-x27" key={cli.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFiltroCliente(cli.id); setTextoBuscarCliente(''); setMostrarSugerenciasCliente(false); setSeleccionadas([]); }}
                  onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div className="fcd-x28">{cli.nombre || cli.id}</div>
                  {cli.rfc && <div className="fcd-x29">{cli.rfc}</div>}
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );

  const OPS_POR_PAGINA = 100;
  const totalPaginasOps = Math.max(1, Math.ceil(operacionesMostradas.length / OPS_POR_PAGINA));
  const paginaOpsSegura = Math.min(paginaOps, totalPaginasOps);
  const operacionesPagina = operacionesMostradas.slice((paginaOpsSegura - 1) * OPS_POR_PAGINA, paginaOpsSegura * OPS_POR_PAGINA);

  const filtrosActivos = activeTab === 'operaciones'
    ? [fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, filtroTipoOp, filtroCliente].filter(Boolean).length
    : [textoBuscarFactura, fechaDesdeHist, fechaHastaHist, filtroCliente].filter(Boolean).length + (filtroMonedaHist !== 'todas' ? 1 : 0);
  const limpiarFiltros = () => {
    if (activeTab === 'operaciones') { setFechaDesdeOps(''); setFechaHastaOps(''); setTextoBuscarRemolqueOps(''); setFiltroTipoOp(''); }
    else { setTextoBuscarFactura(''); setFechaDesdeHist(''); setFechaHastaHist(''); setFiltroMonedaHist('todas'); }
    setFiltroCliente(''); setTextoBuscarCliente('');
  };

  return (
    <div className="module-container fcd-x30">
      {/* ✅ V00451: "Documentos de la factura" (píldora de la fila y tarjeta de la Ficha) */}
      {docsFacturaDe && (
        <DocumentosFacturaModal lado="clientes" fila={docsFacturaDe} onGuardado={aplicarDocsLocal} onCerrar={() => setDocsFacturaDe(null)} />
      )}
      {hiloFacturaId && <HiloModal tipo="cliente" facturaId={hiloFacturaId} onClose={() => setHiloFacturaId(null)} onEditarOperacion={(id) => setOpEditandoId(id)} />}
      {corrigiendoFacturas && (
        <CorregirFacturasModal lado="cliente" facturas={facturasGlobales} conServidor={flags.dineroPorServidor}
          monedaDe={monedaClienteDe} nombreDe={(id, f) => { const n = getNombreCliente(id); return n && n !== id ? n : String(f.clienteNombre || id || ''); }}
          onCorregidas={(cambios) => setFacturasGlobales(prev => prev.map(f => (cambios[f.id] ? normalizarFactura({ ...f, ...cambios[f.id] }) : f)))}
          onCerrar={() => setCorrigiendoFacturas(false)} />
      )}{/* ✅ V00482 */}
      {cancelarDe && (
        <ModalCancelarFactura invoice={String(cancelarDe.invoice || '')} sugerencias={foliosDelCliente(cancelarDe)}
          onVolver={() => setCancelarDe(null)}
          onConfirmar={async (datos) => { await handleCambiarStatusFactura(cancelarDe, 'Cancelado', datos); setCancelarDe(null); }} />
      )}{/* ✅ V00481 */}
      {opEditandoId && (
        <EditorOperacionEmbebido operacionId={opEditandoId} operacion={operacionesGlobales.find((o: any) => String(o.id) === opEditandoId)} onClose={() => setOpEditandoId(null)} />
      )}
      <h1 className="fcd-x31">Facturación de Clientes</h1>
      {mostrarAuditoria && (
        <AuditoriaCadenaCliente onCerrar={() => setMostrarAuditoria(false)} montoOperacion={(op) => obtenerMontoOperacion(op)} totalNativo={totalFactura}
          onEditarFactura={editarFacturaDesdeAuditoria} detras={!!facturaEditando || !!cancelarDe} />
      )}{/* ✅ V00318 */}

      <div className="fcd-x32">
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
        {/* ✅ V00126: facturas liquidadas con su # de pago */}
        <button onClick={() => setActiveTab('pagadas')} style={tabStyle(activeTab === 'pagadas')}>Pagadas</button>
        {/* ✅ V00450: Ref Cliente duplicada (pendientes de facturar) */}
        <button type="button" onClick={() => setActiveTab('revision')}
          className={`fcd-tab-revision${opsEnRevision.length > 0 ? ' fcd-tab-revision--con' : ''}${activeTab === 'revision' ? ' fcd-tab-revision--activa' : ''}`}
          title="Operaciones pendientes de facturar con una Ref Cliente que ya existe en otra operación">
          Revisión{' '}
          {mostrarCargandoOps || cargandoFacturas ? <CargandoDatos enLinea texto="Buscando…" /> : <span className="fcd-tab-revision__n">{opsEnRevision.length}</span>}
        </button>
        {/* ✅ V00318: verificación de la cadena Operación → Factura → Pago */}
        <button type="button" className="fcd-btn-auditoria" title="Verificar por cliente que cada operación esté facturada con el monto vigente y que cada factura cuadre con sus pagos" onClick={() => setMostrarAuditoria(true)}>🔍 Auditar cliente</button>
        <button onClick={recargarTodo} disabled={cargandoOperaciones || cargandoFacturas}
          title="Vuelve a leer operaciones y facturas desde la base de datos (limpia la caché)"
          style={{ marginLeft: 'auto', marginBottom: '6px', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '8px', color: '#c9d1d9', cursor: (cargandoOperaciones || cargandoFacturas) ? 'wait' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: (cargandoOperaciones || cargandoFacturas) ? 0.6 : 1 }}>
          <span className="fcd-x33">↻</span>
          {(cargandoOperaciones || cargandoFacturas) ? 'Refrescando…' : 'Refrescar'}
        </button>
      </div>

      {activeTab !== 'revision' && (
      <div className="fcd-x34">
        <button onClick={() => setFiltrosAbiertos(true)} title="Mostrar filtros"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${filtrosActivos > 0 ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          Filtros
          {filtrosActivos > 0 && <span className="fcd-x35">{filtrosActivos}</span>}
        </button>
        {filtrosActivos > 0 && (
          <button onClick={() => { limpiarFiltros(); if (activeTab === 'operaciones') setBusquedaOpsHecha(false); else setBusquedaHistHecha(false); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar todos los filtros">✕ Limpiar filtros</button>
        )}
        {activeTab === 'operaciones' && filtroTipoOp && (
          <span className="fcd-x36">
            {filtroTipoOp}
            <button className="fcd-x37" onClick={() => setFiltroTipoOp('')}>✕</button>
          </span>
        )}
        {esHistorial && filtroMonedaHist !== 'todas' && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 10px', backgroundColor: filtroMonedaHist === 'USD' ? 'rgba(88,166,255,0.1)' : 'rgba(63,185,80,0.1)', border: `1px solid ${filtroMonedaHist === 'USD' ? '#58a6ff' : '#3fb950'}`, borderRadius: '14px', color: filtroMonedaHist === 'USD' ? '#58a6ff' : '#3fb950', fontSize: '0.8rem', fontWeight: 'bold' }}>
            {filtroMonedaHist === 'USD' ? '$ Dólares (USD)' : '$ Pesos (MXN)'}
            <button className="fcd-x38" onClick={() => setFiltroMonedaHist('todas')}>✕</button>
          </span>
        )}
        {filtroCliente && (
          <span className="fcd-x39">
            {nombreClienteSeleccionado}
            <button className="fcd-x40" onClick={() => { setFiltroCliente(''); setTextoBuscarCliente(''); }}>✕</button>
          </span>
        )}
        {/* ✅ V00488: las que no tienen fecha (o no se reconoce) no entran en un filtro de fechas: se avisa */}
        {esHistorial && (fechaDesdeHist || fechaHastaHist) && sinFechaHist > 0 && (
          <span className="fcd-aviso-sin-fecha" role="status"
            title="Estas facturas no tienen fecha, o su fecha no se reconoce, y por eso no entran en un filtro de fechas. Para verlas, quita las fechas del filtro y corrige su fecha en Editar factura.">
            ⚠ {sinFechaHist.toLocaleString('es-MX')} factura{sinFechaHist === 1 ? '' : 's'} sin fecha no entra{sinFechaHist === 1 ? '' : 'n'} en el rango
          </span>
        )}
        {/* ✅ V00482: buscar y acciones del historial en esta misma fila (antes, un panel aparte con 6 botones) */}
        {esHistorial && (
          <AccionesHistorial
            buscar={{ valor: textoBuscarFactura, onCambiar: setTextoBuscarFactura, placeholder: 'Buscar: invoice, cliente, CCP, referencia, remolque…' }}
            onCorregir={() => setCorrigiendoFacturas(true)} corregirDeshabilitado={cargandoFacturas || facturasGlobales.length === 0}
            onColumnas={() => setModalColumnas(true)} onExportar={abrirModalExportarFac} exportando={exportandoExcelHist}
          />
        )}
      </div>
      )}

      {filtrosAbiertos && (
        <div className="fcd-x41" onClick={() => setFiltrosAbiertos(false)}>
          <div className="fcd-x42" onClick={(e) => e.stopPropagation()}>
            <div className="fcd-x43">
              <h3 className="fcd-x44">Filtros · {activeTab === 'operaciones' ? 'Operaciones' : 'Historial'}</h3>
              <button className="fcd-x45" onClick={() => setFiltrosAbiertos(false)}>✕</button>
            </div>

            {activeTab === 'operaciones' ? (
              <>
                <div className="fcd-x46">
                  <label className="fcd-x47"># REMOLQUE / REFERENCIA (opcional)</label>
                  <div className="fcd-x21">
                    <svg className="fcd-x48" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="fcd-x49" type="text" placeholder="Buscar por # remolque o referencia..." value={textoBuscarRemolqueOps}
                      onChange={(e) => setTextoBuscarRemolqueOps(e.target.value)} />
                    {textoBuscarRemolqueOps && (
                      <button className="fcd-x50" onClick={() => setTextoBuscarRemolqueOps('')} title="Limpiar">✕</button>
                    )}
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x51">TIPO DE OPERACIÓN (opcional)</label>
                  <select value={filtroTipoOp} onChange={(e) => setFiltroTipoOp(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: `1px solid ${filtroTipoOp ? '#a371f7' : '#30363d'}`, borderRadius: '6px', color: filtroTipoOp ? '#a371f7' : '#c9d1d9', fontSize: '0.9rem', fontWeight: filtroTipoOp ? 'bold' : 'normal', boxSizing: 'border-box' }}>
                    <option value="">Todos los tipos ({tiposOperacionDisponibles.length})</option>
                    {tiposOperacionDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {tiposOperacionDisponibles.length === 0 && (
                    <span className="fcd-x52">Carga las operaciones para ver los tipos disponibles.</span>
                  )}
                </div>
                <div className="fcd-x53">
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA HASTA</label>
                    <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeOps || fechaHastaOps) && (
                  <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                <div className="fcd-x46">
                  <label className="fcd-x55">VISTA</label>
                  <div className="fcd-x56">
                    <button onClick={() => { setVistaOps('pendientes'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'pendientes', '#f59e0b'), flex: 1 }}>Pendientes ({resumenOps.porFacturar})</button>
                    <button onClick={() => { setVistaOps('facturadas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'facturadas', '#10b981'), flex: 1 }}>Facturadas ({flags.consultasCanonicas && !facturadasCargadas ? '…' : resumenOps.facturadas})</button>
                    <button onClick={() => { setVistaOps('todas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'todas', '#58a6ff'), flex: 1 }}>Todas ({resumenOps.total})</button>
                  </div>
                </div>
                {/* ✅ V00126: pestañas por MONEDA de facturación */}
                <div className="fcd-x46">
                  <label className="fcd-x55">MONEDA</label>
                  <div className="fcd-x56">
                    <button onClick={() => { setMonedaVistaOps('USD'); setSeleccionadas([]); }} style={{ ...segBtnStyle(monedaVistaOps === 'USD', '#58a6ff'), flex: 1 }}>Dólares ({resumenMonedaOps.usd})</button>
                    <button onClick={() => { setMonedaVistaOps('MXN'); setSeleccionadas([]); }} style={{ ...segBtnStyle(monedaVistaOps === 'MXN', '#3fb950'), flex: 1 }}>Pesos ({resumenMonedaOps.mxn})</button>
                    <button onClick={() => { setMonedaVistaOps('todas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(monedaVistaOps === 'todas', '#8b949e'), flex: 1 }}>Todas ({resumenMonedaOps.todas})</button>
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x47">ORDENAR POR</label>
                  <div className="fcd-x57">
                    <select value={ordenOps.campo} onChange={(e) => setOrdenOps(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                      {columnasOps.filter(c => c.visible && c.orden).map(c => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                    <button onClick={() => setOrdenOps(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                      {ordenOps.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                    </button>
                  </div>
                </div>
                {BuscadorCliente()}
                <div className="fcd-x58">
                  Por defecto se muestran <b className="fcd-x1">todas</b> las operaciones completadas. El rango de fechas y el cliente son <b className="fcd-x1">opcionales</b> para acotar.
                </div>
              </>
            ) : (
              <>
                <div className="fcd-x46">
                  <label className="fcd-x59">BUSCAR EN HISTORIAL</label>
                  <div className="fcd-x21">
                    <svg className="fcd-x48" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="fcd-x23" type="text" placeholder="Invoice, cliente, status, CCP, referencia o # remolque..." value={textoBuscarFactura} onChange={(e) => setTextoBuscarFactura(e.target.value)} />
                    {textoBuscarFactura && (
                      <button className="fcd-x50" onClick={() => setTextoBuscarFactura('')} title="Limpiar búsqueda">✕</button>
                    )}
                  </div>
                </div>
                <div className="fcd-x53">
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeHist} onChange={(e) => setFechaDesdeHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="fcd-x54">
                    <label className="fcd-x47">FECHA HASTA</label>
                    <input type="date" value={fechaHastaHist} onChange={(e) => setFechaHastaHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeHist || fechaHastaHist) && (
                  <button onClick={() => { setFechaDesdeHist(''); setFechaHastaHist(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                <div className="fcd-x46">
                  <label className="fcd-x47">STATUS DE FACTURA</label>
                  <div className="fcd-x60">
                    {statusBotones.map(s => {
                      const col = s === 'Todos' ? '#58a6ff' : colorStatusFactura(s);
                      return (
                        <button key={s} onClick={() => setFiltroStatusFactura(s)} style={{ ...segBtnStyle(filtroStatusFactura === s, col), flex: '1 1 auto' }}>
                          {s} ({conteoStatus[s] ?? 0})
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x47">MONEDA DE FACTURACIÓN</label>
                  <div className="fcd-x56">
                    <button onClick={() => setFiltroMonedaHist('todas')} style={{ ...segBtnStyle(filtroMonedaHist === 'todas', '#58a6ff'), flex: 1 }}>Todas ({conteoMonedaHist.todas})</button>
                    <button onClick={() => setFiltroMonedaHist('USD')} style={{ ...segBtnStyle(filtroMonedaHist === 'USD', '#58a6ff'), flex: 1 }}>$ Dólares ({conteoMonedaHist.USD})</button>
                    <button onClick={() => setFiltroMonedaHist('MXN')} style={{ ...segBtnStyle(filtroMonedaHist === 'MXN', '#3fb950'), flex: 1 }}>$ Pesos ({conteoMonedaHist.MXN})</button>
                  </div>
                </div>
                <div className="fcd-x46">
                  <label className="fcd-x47">ORDENAR POR</label>
                  <div className="fcd-x57">
                    <select value={ordenFac.campo} onChange={(e) => setOrdenFac(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                <option value="statusFactura">Status</option>
                <option value="invoice">Invoice</option>
                <option value="fecha">Fecha</option>
                <option value="remolque"># Remolque</option>
                <option value="cliente">Cliente</option>
                <option value="moneda">Moneda</option>
                <option value="cantOps">Cant. Ops</option>
                <option value="total">Total</option>
                    </select>
                    <button onClick={() => setOrdenFac(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                      {ordenFac.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                    </button>
                  </div>
                </div>
                {BuscadorCliente()}
                <div className="fcd-x58">
                  Por defecto se muestran <b className="fcd-x1">todas</b> las facturas (sin filtro de fechas). Las facturas importadas sin fecha se ocultan al filtrar por fecha.
                </div>
              </>
            )}

            <div className="fcd-x61">
              <button className="fcd-x62" onClick={() => { limpiarFiltros(); if (activeTab === 'operaciones') setBusquedaOpsHecha(false); else setBusquedaHistHecha(false); }}>Limpiar</button>
              <button className="fcd-x63" onClick={() => { if (activeTab === 'operaciones') setBusquedaOpsHecha(true); else setBusquedaHistHecha(true); setFiltrosAbiertos(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'revision' ? (
        <div className="animation-fade-in">
          <RevisionRefCliente
            modulo="facturacionClientes"
            ops={opsEnRevision}
            duplicados={dupRef.porOp}
            cargando={mostrarCargandoOps || cargandoFacturas || dupRef.verificando}
            nombreCliente={(id, guardado) => { const n = id ? getNombreCliente(id) : ''; return n && n !== id && n !== '-' ? n : (guardado || n); }}
            onVer={(op) => setOpEditandoId(String(op.id))}
            etiquetaVer="✎ Operación"
            onMarcadas={alMarcarNoDuplicado}
          />
        </div>
      ) : activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div className="fcd-x64">
            <div className="fcd-x65">
              <span className="fcd-x66">Operaciones en espera por facturar</span>
              {mostrarCargandoOps ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fcd-x67">{resumenOps.porFacturar}</span>}
            </div>
            <div className="fcd-x65">
              <span className="fcd-x66">Operaciones ya facturadas (en historial)</span>
              {mostrarCargandoOps ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fcd-x68">{resumenOps.facturadas}</span>}
            </div>
            <div className="fcd-x65">
              <span className="fcd-x66">Total completadas cargadas</span>
              {mostrarCargandoOps ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fcd-x69">{resumenOps.total}</span>}
            </div>
          </div>

          <div className="fcd-x70">
            <div className="fcd-x71">
              <span className="fcd-x7">
                {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'mostrada' : 'mostradas'}
              </span>
            </div>

            <div className="fcd-x72">
              <button onClick={recargarTodo} disabled={cargandoOperaciones || cargandoFacturas} style={{ ...btnDirStyle, borderColor: '#58a6ff', color: '#58a6ff', fontWeight: 700 }} title="Vuelve a leer operaciones y facturas desde Firestore (limpia la caché) y recalcula todos los montos">{cargandoOperaciones ? '⏳ Actualizando…' : '↻ Actualizar'}</button>
              <button onClick={() => setModalColumnasOps(true)} style={btnDirStyle} title="Elegir y reordenar columnas">⚙ Configurar Columnas</button>
              <button onClick={exportarExcelOps} disabled={operacionesMostradas.length === 0}
                style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap',
                  cursor: operacionesMostradas.length === 0 ? 'not-allowed' : 'pointer',
                  backgroundColor: operacionesMostradas.length === 0 ? '#30363d' : '#1a7f37',
                  color: operacionesMostradas.length === 0 ? '#8b949e' : '#fff' }}>
                Exportar Excel
              </button>
              <button disabled={seleccionadas.length === 0} onClick={abrirModalCostoAdic}
                style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #58a6ff', backgroundColor: 'transparent', color: seleccionadas.length === 0 ? '#484f58' : '#58a6ff', fontWeight: 'bold', fontSize: '0.85rem', whiteSpace: 'nowrap', cursor: seleccionadas.length === 0 ? 'not-allowed' : 'pointer' }}
                title="Agregar un costo adicional al cliente en una operación seleccionada">
                Costo adicional
              </button>
              <button disabled={seleccionadas.length === 0 || seleccionMultiCliente} onClick={() => { const bloqueo = bloqueoPorRevision(opsDeSeleccion()); if (bloqueo) { alert(bloqueo); return; } setStatusFacturaForm('Facturado'); setAdjuntosFacturar([]); setModalAbierto(true); }}
                style={{ padding: '8px 20px', backgroundColor: (seleccionadas.length > 0 && !seleccionMultiCliente) ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && !seleccionMultiCliente) ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Generar Factura ({seleccionadas.length})
              </button>
            </div>
          </div>

          {topeOpsAlcanzado && (
            <div className="fcd-x73">
              Se alcanzó el tope de <b>{LIMITE_OPS_TODAS}</b> operaciones cargadas, por lo que podría haber más que no se muestran. Usa el <b>rango de fechas</b> o el <b>cliente</b> para acotar.
            </div>
          )}

          {seleccionMultiCliente && (
            <div className="fcd-x74">
              Seleccionaste operaciones de <b>distintos clientes</b>. Una factura debe ser de un solo cliente: usa el filtro de cliente o selecciona operaciones del mismo cliente.
            </div>
          )}

          {seleccionadas.length > 0 && !seleccionMultiCliente && (
            <div className="fcd-x75">
              <div className="fcd-x76">
                <div className="fcd-x77">
                  <span className="fcd-x78">Seleccionadas</span>
                  <span className="fcd-x69">{seleccionadas.length}</span>
                </div>
                <div className="fcd-x77">
                  <span className="fcd-x78">Conversión Estimada</span>
                  <span className="fcd-x79">{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
                <div className="fcd-x77">
                  <span className="fcd-x78">Cliente</span>
                  <span className="fcd-x80">{nombreClienteFactura || '—'}</span>
                </div>
                <div>
                  <span className="fcd-x78">Moneda</span>
                  <span className="fcd-x81"><NombreMoneda moneda={monedaFacturacion} respaldo="Sin moneda en Empresas" /></span>{/* ✅ V00481 */}
                </div>
              </div>
            </div>
          )}

          <div className="table-container fcd-x82">
            <table className="fcd-x83">
              <thead className="fcd-x84">
                <tr>
                  <th className="fcd-x85">ACCIONES</th>
                  <th className="fcd-x86"></th>
                  {columnasOps.filter(c => c.visible).map(col => (
                    <th key={col.id}
                      style={col.orden ? thOrdenStyle : { padding: '16px', borderBottom: '1px solid #30363d', whiteSpace: 'nowrap' }}
                      onClick={col.orden ? () => toggleOrdenOps(col.id) : undefined}>
                      {col.label.toUpperCase()}{col.orden ? flechaOps(col.id) : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaOpsHecha ? (
                  <tr><td className="fcd-x87" colSpan={columnasOps.filter(c => c.visible).length + 2}>
                    <div className="fcd-x88">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="fcd-x89">Define tus filtros y presiona <b className="fcd-x90">Buscar</b> para ver las operaciones.</span>
                      <button className="fcd-x91" onClick={() => setFiltrosAbiertos(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : mostrarCargandoOps ? (
                  <tr><td className="fcd-x92" colSpan={columnasOps.filter(c => c.visible).length + 2}><CargandoDatos texto="Cargando todas las operaciones completadas..." /></td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td className="fcd-x92" colSpan={columnasOps.filter(c => c.visible).length + 2}>No hay operaciones {vistaOps === 'facturadas' ? 'facturadas' : vistaOps === 'pendientes' ? 'pendientes' : 'completadas'} con los filtros actuales{filtroCliente ? ' para el cliente seleccionado' : ''}.</td></tr>
                ) : (
                  operacionesPagina.map(op => {
                    const m = obtenerMontoOperacion(op);
                    const yaFacturada = esFacturada(op);
                    return (
                      <tr key={op.id} onClick={() => { if (!yaFacturada) toggleSeleccion(op.id); }}
                        style={{ cursor: yaFacturada ? 'default' : 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : (yaFacturada ? 'rgba(16,185,129,0.04)' : 'transparent') }}>
                        <td className="fcd-x93">
                          {/* ✅ V00126: editar la operación completa (hilo Operaciones → Facturación) */}
                          <button className="fcd-btn-editar-op" onClick={(e) => { e.stopPropagation(); setOpEditandoId(String(op.id)); }} title="Editar esta operación en el formulario de Operaciones">✎ Operación</button>
                          {yaFacturada && op.facturaClienteId && <button className="fcd-btn-editar-op fcd-btn-hilo" onClick={(e) => { e.stopPropagation(); setHiloFacturaId(String(op.facturaClienteId)); }} title="Verificar el hilo Operaciones → Facturación → Pagos de esta factura">🔗 Hilo</button>}
                          {yaFacturada ? (
                            <div className="fcd-x94">
                              <button className="fcd-x95"
                                onClick={(e) => abrirGestionOp(e, op)}
                                title="Editar el # de factura de esta operación">
                                ✎ #
                              </button>
                              <button className="fcd-x96"
                                onClick={(e) => { e.stopPropagation(); quitarOpDeFactura(op); }}
                                title="Quitar esta operación de la factura (vuelve a Pendientes)">
                                ✕ Quitar
                              </button>
                            </div>
                          ) : (
                            <button className="fcd-x97"
                              onClick={(e) => { e.stopPropagation(); abrirCostoAdicParaOp(op.id); }}
                              title="Agregar costo adicional a esta operación">
                              ＋ Costo
                            </button>
                          )}
                        </td>
                        <td className="fcd-x98">
                          {yaFacturada ? (
                            <span className="fcd-x99" title="Ya facturada" />
                          ) : (
                            <input className="fcd-x100" type="checkbox" checked={seleccionadas.includes(op.id)} readOnly />
                          )}
                        </td>
                        {columnasOps.filter(c => c.visible).map(col => renderCeldaOps(op, col.id, m))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          {busquedaOpsHecha && totalPaginasOps > 1 && (
            <div className="fcd-x101">
              <button onClick={() => setPaginaOps(p => Math.max(1, p - 1))} disabled={paginaOpsSegura === 1}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === 1 ? 'not-allowed' : 'pointer', color: paginaOpsSegura === 1 ? '#484f58' : '#c9d1d9' }}>Anterior</button>
              <span className="fcd-x102">
                Página {paginaOpsSegura} / {totalPaginasOps} · {operacionesMostradas.length} operaciones
              </span>
              <button onClick={() => setPaginaOps(p => Math.min(totalPaginasOps, p + 1))} disabled={paginaOpsSegura === totalPaginasOps}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === totalPaginasOps ? 'not-allowed' : 'pointer', color: paginaOpsSegura === totalPaginasOps ? '#484f58' : '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>

      ) : (
        <div className="animation-fade-in">

          {/* ✅ V00264: tarjetas CLICABLES — abren el detalle de dónde sale el número */}
          <div className="fcd-x103">
            <div className="fcd-x104 fac-tarjeta-clicable" role="button" tabIndex={0} title="Ver de dónde sale este número" onClick={() => setTarjetaAbierta('listadas')}>
              <span className="fcd-x105">Facturas Listadas</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fcd-x106">{resumenHistorial.cuenta}</span>}{/* ✅ V00449 */}
              {!cargandoFacturas && resumenHistorial.canceladas > 0 && <small className="fcd-nota-canceladas">{resumenHistorial.canceladas} canceladas: no suman</small>}{/* ✅ V00493 */}
            </div>
            <div className="fcd-x104 fac-tarjeta-clicable" role="button" tabIndex={0} title="Ver de dónde sale este número" onClick={() => setTarjetaAbierta('ops')}>
              <span className="fcd-x105">Ops. Facturadas</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fcd-x107">{resumenHistorial.totalOps}</span>}
            </div>
            <div className="fcd-x104 fac-tarjeta-clicable" role="button" tabIndex={0} title="Ver de dónde sale este monto" onClick={() => setTarjetaAbierta('usd')}>
              <span className="fcd-x108">Total Facturado (<NombreMoneda moneda="USD" forma="codigo" />)</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fcd-x109">{formatoMoneda(resumenHistorial.totalUSD)}</span>}
            </div>
            <div className="fcd-x104 fac-tarjeta-clicable" role="button" tabIndex={0} title="Ver de dónde sale este monto" onClick={() => setTarjetaAbierta('mxn')}>
              <span className="fcd-x108">Total Facturado (<NombreMoneda moneda="MXN" forma="codigo" />)</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fcd-x110">{formatoMoneda(resumenHistorial.totalMXN)}</span>}
            </div>
          </div>

          <div className="table-container fcd-x82">
            <table className="fcd-x83">
              <thead className="fcd-x84">
                <tr>
                  <th className="fcd-x85">ACCIONES</th>
                  {columnasFactura.filter(c => c.visible).map(col => (
                    <th key={`th_${col.id}`} style={thOrdenStyle} onClick={() => toggleOrdenFac(col.id)}>
                      {col.label.toUpperCase()}{flechaFac(col.id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHistHecha ? (
                  <tr><td className="fcd-x87" colSpan={columnasFactura.filter(c => c.visible).length + 1}>
                    <div className="fcd-x88">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="fcd-x89">Define tus filtros y presiona <b className="fcd-x90">Buscar</b> para ver las facturas.</span>
                      <button className="fcd-x91" onClick={() => setFiltrosAbiertos(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : cargandoFacturas ? (
                  <tr><td className="fcd-x112" colSpan={columnasFactura.filter(c => c.visible).length + 1}><CargandoDatos texto="Cargando facturas..." /></td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td className="fcd-x112" colSpan={columnasFactura.filter(c => c.visible).length + 1}>
                    {facturasGlobales.length === 0
                      ? 'Aún no hay facturas registradas.'
                      : `No se encontraron facturas con los filtros actuales${textoBuscarFactura ? ` (búsqueda: "${textoBuscarFactura}")` : ''}${filtroStatusFactura !== 'Todos' ? ` (status: "${filtroStatusFactura}")` : ''}${filtroCliente ? ' para el cliente seleccionado' : ''}.`}
                  </td></tr>
                ) : (
                  registrosVisibles.map(f => (
                    <tr className="fcd-x113 fac-fila-clic" key={f.id} title="Clic en la fila para ver la ficha de la factura"
                      onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"]')) return; setFacturaViendo(f); }}>{/* ✅ V00381 */}
                      <td className="fcd-x98">
                        <div className="fcd-x114">
                          <PildoraDocsFactura archivos={docsDeFactura(f)} onAbrir={() => setDocsFacturaDe(f)} />{/* ✅ V00276 · ✅ V00451 */}
                          <button className="fcd-x115" title="Ver Ficha" onClick={() => setFacturaViendo(f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
{puedeGenerarRemision(f.statusFactura) && (/* ✅ V00481: con la factura Facturada ya no hay Remisión */
                          <button className="fcd-x116" title="Generar Remisión (PDF)" onClick={() => abrirRemision(f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
                          </button>)}
                          <button className="fcd-x117" title="Editar Factura" onClick={(e) => abrirEditarFactura(e, f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </button>
                          <button className="fcd-x118" title="Eliminar Factura" onClick={(e) => handleEliminarFactura(e, f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasFactura.filter(c => c.visible).map(col => (
                        <td className="fcd-x5" key={`cell_${f.id}_${col.id}`}>{renderCeldaFactura(f, col.id)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {busquedaHistHecha && totalPaginas > 1 && (
            <div className="fcd-x119">
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span className="fcd-x120">{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {/* ✅ V00264: detalle de una tarjeta del resumen — de dónde sale el número + descarga */}
      {tarjetaAbierta && (
        <div className="modal-overlay" onClick={() => setTarjetaAbierta(null)}>
          <div className="modal-content fac-tarjeta-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fac-tarjeta-modal__cabecera">
              <h3 className="fac-tarjeta-modal__titulo">{tituloTarjeta[tarjetaAbierta]}</h3>
              <button type="button" className="fac-export-modal__cerrar" onClick={() => setTarjetaAbierta(null)}>✕</button>
            </div>
            <div className="fac-tarjeta-modal__resumen">
              {facturasDeTarjeta.length.toLocaleString('es-MX')} factura(s) · {opsTarjetaAbierta.toLocaleString('es-MX')} operación(es) · Total <Importe monto={totalTarjetaAbierta} moneda={tarjetaAbierta === 'usd' ? 'USD' : tarjetaAbierta === 'mxn' ? 'MXN' : ''} />
              <span className="fac-tarjeta-modal__nota"> — con los filtros actuales del historial{tarjetaAbierta === 'usd' ? ', solo facturas en Dólares' : tarjetaAbierta === 'mxn' ? ', solo facturas en Pesos' : ''}{tarjetaAbierta !== 'listadas' && resumenHistorial.canceladas > 0 ? ', sin las canceladas' : ''}.</span>
            </div>
            <div className="fac-tarjeta-modal__lista">
              <div className="fac-tarjeta-modal__fila fac-tarjeta-modal__fila--encabezado">
                <span className="fac-tarjeta-modal__c-invoice">Invoice</span>
                <span className="fac-tarjeta-modal__c-fecha">Fecha</span>
                <span className="fac-tarjeta-modal__c-cliente">Cliente</span>
                <span className="fac-tarjeta-modal__c-ops">Ops</span>
                <span className="fac-tarjeta-modal__c-moneda">Moneda</span>
                <span className="fac-tarjeta-modal__c-total">Total</span>
              </div>
              {facturasDeTarjeta.map((f) => (
                <div key={f.id} className="fac-tarjeta-modal__fila">
                  <span className="fac-tarjeta-modal__c-invoice">{String(f.invoice || '—')}</span>
                  <span className="fac-tarjeta-modal__c-fecha">{String(f.fecha || '').slice(0, 10) || '—'}</span>
                  <span className="fac-tarjeta-modal__c-cliente" title={nombreClienteFactura_(f)}>{nombreClienteFactura_(f)}</span>
                  <span className="fac-tarjeta-modal__c-ops">{Number(f.operacionesIds?.length || 0)}</span>
                  <span className="fac-tarjeta-modal__c-moneda"><NombreMoneda moneda={monedaFacturaMostrar(f)} respaldo={monedaFacturaMostrar(f)} /></span>
                  <span className="fac-tarjeta-modal__c-total"><Importe monto={totalDeGrupo(f)} moneda={monedaFacturaMostrar(f)} /></span>
                </div>
              ))}
              {facturasDeTarjeta.length === 0 && <div className="fac-tarjeta-modal__vacio">Sin facturas con los filtros actuales.</div>}
            </div>
            <div className="fac-export-modal__pie">
              <span className="fac-export-modal__separador" />
              <button type="button" className="btn btn-outline" onClick={() => setTarjetaAbierta(null)}>Cerrar</button>
              <button type="button" className="fac-export-modal__exportar" onClick={exportarTarjetaExcel} disabled={exportandoTarjeta || facturasDeTarjeta.length === 0}>
                {exportandoTarjeta ? '⏳ Exportando…' : '⬇ Descargar Excel'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* ✅ V00262: modal Exportar a Excel — selección y ORDEN por Drag & Drop (patrón de Servicios Completados) */}
      {modalExportarFac && (
        <div className="modal-overlay" onClick={() => setModalExportarFac(false)}>
          <div className="modal-content fac-export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="fac-export-modal__cabecera">
              <h3 className="fac-export-modal__titulo">⬇ Exportar a Excel <span className="fac-export-modal__sub">({columnasExportFac.filter(c => c.visible).length} columnas)</span></h3>
              <button type="button" className="fac-export-modal__cerrar" onClick={() => setModalExportarFac(false)}>✕</button>
            </div>
            <div className="fac-export-modal__nota">Arrastra ⋮⋮ cualquier tarjeta para cambiar el orden. Marca las columnas que quieres incluir.</div>
            <div className="fac-export-cuadricula">
              {columnasExportFac.map((c, idx) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={() => { dragExportFacIdx.current = idx; }}
                  onDragOver={(e) => { e.preventDefault(); if (dragOverExportFacIdx !== idx) setDragOverExportFacIdx(idx); }}
                  onDragLeave={() => { if (dragOverExportFacIdx === idx) setDragOverExportFacIdx(null); }}
                  onDragEnd={() => { dragExportFacIdx.current = null; setDragOverExportFacIdx(null); }}
                  onDrop={() => soltarColumnaExportFac(idx)}
                  className={`fac-export-tarjeta${c.visible ? '' : ' fac-export-tarjeta--apagada'}${dragOverExportFacIdx === idx ? ' fac-export-tarjeta--destino' : ''}`}
                >
                  <span className="fac-export-tarjeta__punos" title="Arrastrar para reordenar">⋮⋮</span>
                  <input
                    type="checkbox"
                    checked={c.visible}
                    onChange={() => setColumnasExportFac(prev => prev.map((x, i) => (i === idx ? { ...x, visible: !x.visible } : x)))}
                  />
                  <span className={`fac-export-tarjeta__etiqueta${c.visible ? '' : ' fac-export-tarjeta__etiqueta--apagada'}`} title={c.label}>{c.label}</span>
                </div>
              ))}
            </div>
            <div className="fac-export-modal__pie">
              <button type="button" className="btn btn-outline" onClick={() => setColumnasExportFac(columnasFactura.map(c => ({ id: c.id, label: c.label, visible: c.visible })))}>Columnas de la tabla</button>
              <span className="fac-export-modal__separador" />
              <button type="button" className="btn btn-outline" onClick={() => setModalExportarFac(false)}>Cancelar</button>
              <button type="button" className="fac-export-modal__exportar" onClick={exportarCSV} disabled={exportandoExcelHist}>{exportandoExcelHist ? '⏳ Exportando…' : 'Exportar'}</button>
            </div>
          </div>
        </div>
      )}
      {modalColumnas && (
        <div className="modal-overlay fcd-x121">
          <div className="fcd-x122">
            <div className="fcd-x123">
              <h3 className="fcd-x124">Configurar Columnas</h3>
              <button className="fcd-x45" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="fcd-x125">Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel. <b className="fcd-x126">Esta configuración se guarda y se aplica para todos los usuarios.</b></p>
            <ul className="fcd-x127">
              {columnasFactura.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStart(e, idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="fcd-x128" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="fcd-x129">
              <button onClick={guardarConfigColumnasHistorial} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {modalColumnasOps && (
        <div className="modal-overlay fcd-x121">
          <div className="fcd-x130">
            <div className="fcd-x131">
              <div>
                <h3 className="fcd-x124">Configurar Columnas</h3>
                <span className="fcd-x132">
                  {columnasOps.filter(c => c.visible).length} visibles de {columnasOps.length} disponibles
                </span>
              </div>
              <button className="fcd-x45" onClick={() => { setModalColumnasOps(false); setBusquedaColOps(''); }}>✕</button>
            </div>
            <div className="fcd-x133">
              <div className="fcd-x134">
                <svg className="fcd-x48" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="fcd-x135" type="text" placeholder="Buscar columna por nombre o grupo..." value={busquedaColOps} onChange={(e) => setBusquedaColOps(e.target.value)} />
              </div>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: false })))} style={{ ...btnDirStyle, color: '#8b949e' }} title="Ocultar todas">Ocultar todas</button>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: true })))} style={{ ...btnDirStyle, color: '#10b981' }} title="Mostrar todas">Mostrar todas</button>
              <button onClick={() => setColumnasOps(COLUMNAS_OPS_BASE.map(c => ({ ...c })))} style={{ ...btnDirStyle, color: '#D84315' }} title="Restablecer al estado por defecto">Restablecer</button>
            </div>
            <p className="fcd-x136">
              Arrastra para reordenar. Marca las que quieras ver en la tabla y en el Excel. El grupo entre paréntesis indica de qué pestaña del detalle viene el campo. <b className="fcd-x126">Esta configuración se guarda y se aplica para todos los usuarios.</b>
            </p>
            <ul className="fcd-x137">
              {columnasOps
                .map((col, idx) => ({ col, idx }))
                .filter(({ col }) => {
                  if (!busquedaColOps.trim()) return true;
                  const q = busquedaColOps.trim().toLowerCase();
                  return String(col.label || '').toLowerCase().includes(q) || String(col.grupo || '').toLowerCase().includes(q) || String(col.id || '').toLowerCase().includes(q);
                })
                .map(({ col, idx }) => (
                  <li key={col.id} draggable={!busquedaColOps} onDragStart={(e) => handleDragStartOps(e, idx)} onDragEnter={() => handleDragEnterOps(idx)} onDragEnd={() => setDraggedColOpsIndex(null)} onDragOver={(e) => e.preventDefault()}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: draggedColOpsIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: busquedaColOps ? 'default' : 'grab' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                    <input className="fcd-x128" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} />
                    <div className="fcd-x138">
                      <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                      {col.grupo && (
                        <span className="fcd-x139">({col.grupo})</span>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
            <div className="fcd-x129">
              <button onClick={guardarConfigColumnasOps} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {modalCostoAdic && (
        <div className="modal-overlay fcd-x140">
          <div className="fcd-x141">
            <div className="fcd-x142">
              <h2 className="fcd-x143">Costo adicional al cliente</h2>
              <button className="fcd-x45" onClick={() => setModalCostoAdic(false)}>✕</button>
            </div>
            <p className="fcd-x144">
              Se suma a los <b className="fcd-x11">Cargos Adicionales</b> del cliente en la operación elegida y se recalcula su subtotal/conversión. Usa un monto negativo para aplicar un descuento.
            </p>
            <div className="fcd-x145">
              <div>
                <label className="fcd-x146">OPERACIÓN</label>
                <select className="fcd-x147" value={costoAdicOpId} onChange={e => setCostoAdicOpId(e.target.value)}>
                  <option value="">-- Selecciona una operación --</option>
                  {Array.from(new Set([costoAdicOpId, ...seleccionadas].filter(Boolean))).map(id => {
                    const o = operacionesGlobales.find(x => x.id === id);
                    const ref = o?.numReferencia || o?.referencia || o?.ref || String(id).substring(0, 6);
                    return <option key={id} value={id}>{ref}</option>;
                  })}
                </select>
              </div>
              {(() => {
                const o = operacionesGlobales.find(x => x.id === costoAdicOpId);
                if (!o) return null;
                const mm = obtenerMontoOperacion(o);
                return (
                  <div className="fcd-x148">
                    Cargos actuales: <b className="fcd-x11">{formatoMoneda(o.cargosAdicionales)}</b> · Conversión actual: <b className="fcd-x149">{formatoMoneda(mm.conv)}</b>
                  </div>
                );
              })()}
              <div>
                <label className="fcd-x146">MONTO ADICIONAL (en la moneda del convenio)</label>
                <input className="fcd-x150" type="number" step="any" value={costoAdicMonto} onChange={e => setCostoAdicMonto(e.target.value)} placeholder="Ej. 150.00" />
              </div>
              <div>
                <label className="fcd-x146">CONCEPTO (opcional)</label>
                <input className="fcd-x151" type="text" value={costoAdicConcepto} onChange={e => setCostoAdicConcepto(e.target.value)} placeholder="Ej. Estadía, maniobras, demora..." />
              </div>
            </div>
            <div className="fcd-x152">
              <button className="fcd-x153" onClick={() => setModalCostoAdic(false)} disabled={guardandoCostoAdic}>Cancelar</button>
              <button onClick={handleGuardarCostoAdic} disabled={guardandoCostoAdic || !costoAdicOpId} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: (guardandoCostoAdic || !costoAdicOpId) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (guardandoCostoAdic || !costoAdicOpId) ? 0.7 : 1 }}>{guardandoCostoAdic ? 'Guardando...' : 'Agregar costo'}</button>
            </div>
          </div>
        </div>
      )}

      {modalAbierto && (
        <div className="modal-overlay fcd-x154">
          <div className="fcd-x155">
            <div className="fcd-x142">
              <h2 className="fcd-x156">Generar Factura</h2>
              <button className="fcd-x45" onClick={() => setModalAbierto(false)}>✕</button>
            </div>
            <div className="fcd-x157">
              <div>
                <span className="fcd-x158">Cliente</span>
                <span className="fcd-x80">{nombreClienteFactura || getNombreCliente(clienteFacturaId)}</span>
              </div>
              <div className="fcd-x159">
                <span className="fcd-x158">Moneda Cliente</span>
                <span className="fcd-x160"><NombreMoneda moneda={monedaFacturacion} respaldo="Sin moneda" /></span>
              </div>
              <div className="fcd-x161">
                {/* ✅ V00481: en la moneda del cliente (Dólares → Dólares (Cliente); Pesos → Conversión Final) */}
                <span className="fcd-x158">Total ({seleccionadas.length} Ops)</span>
                <span className="fcd-x162"><Importe monto={totalSeleccionEnMoneda} moneda={monedaFacturacion} /></span>
              </div>
            </div>
            {clienteFacturaId && !monedaFacturacion && <div className="fcd-aviso-crear"><AvisoMonedaFactura texto={avisoSinMoneda('cliente')} error /></div>}
            <FormularioConfigurable modulo="facturacionClientes">{/* ✅ V00385 */}
            <form onSubmit={handleGuardarFactura}>
              <div className="fcd-x163">
                <div className="fcd-x164">
                  <label className="fcd-x146">STATUS DE LA FACTURA</label>
                  <select value={statusFacturaForm} onChange={e => setStatusFacturaForm(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(statusFacturaForm), border: `1px solid ${colorStatusFactura(statusFacturaForm)}`, borderRadius: '4px', fontWeight: 'bold' }}>
                    {STATUS_AL_CREAR.map(s => <option key={s} value={s}>{s}</option>)}{/* ✅ V00481: se cancela después, desde la ficha */}
                  </select>
                </div>
                <div className="fcd-x164">
                  <label className="fcd-x146">NÚMERO DE INVOICE</label>
                  <input className="fcd-x165" type="text" required placeholder="Ej. INV-2026-001" value={invoiceForm} onChange={e => setInvoiceForm(e.target.value)} />
                </div>
                <div>
                  <label className="fcd-x146">FECHA DE FACTURACIÓN</label>
                  <input className="fcd-x166" type="date" required value={fechaForm} onChange={e => setFechaForm(e.target.value)} />
                </div>
                <div>
                  <label className="fcd-x146">FACTURA CCP (Opcional)</label>
                  <input className="fcd-x166" type="text" placeholder="Referencia CCP..." value={facturaCcpForm} onChange={e => setFacturaCcpForm(e.target.value)} />
                </div>
                <div className="fac-doc-ancho">{/* ✅ V00390: documento a lo ancho del formulario */}
                  {/* ✅ V00276: documento de la factura (se sube al confirmar) */}
                  <label className="fcd-x146">DOCUMENTO DE LA FACTURA</label>
                  {/* ✅ V00451: varios (hasta 10), con vista previa; se suben al confirmar */}
                  <AdjuntosArchivos etiqueta="Archivos (opcional)" adjuntos={adjuntosFacturar} onCambiar={setAdjuntosFacturar} max={MAX_DOCS_FACTURA} deshabilitado={guardando} />
                </div>
              </div>
              <div className="fcd-x167">
                <button className="fcd-x153" type="button" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="fcd-x168" type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Confirmar Factura'}</button>
              </div>
            </form>
            </FormularioConfigurable>
          </div>
        </div>
      )}

      {facturaViendo && (
        <div className={`modal-overlay fcd-x169${opEditandoId ? ' fcd-detras-editor' : ''}`}>{/* ✅ V00481: detrás del editor de la operación */}
          <div className={`fcd-x170${pagosFicha.length > 0 ? ' fcd-ficha--con-pagos' : ''}`}>
            <div className="fcd-x171">
              <h2 className="fcd-x172">Ficha de Factura</h2>
              <div className="fcd-x173">
                
{puedeGenerarRemision(facturaViendo.statusFactura) && (/* ✅ V00481: con la factura Facturada ya no hay Remisión */
                <button onClick={() => abrirRemision(facturaViendo)} disabled={cargandoRemision}
                  title="Generar la Remisión en PDF de esta factura"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#fb923c', color: '#0d1117', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: cargandoRemision ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: cargandoRemision ? 0.7 : 1 }}>
                  {cargandoRemision ? 'Preparando...' : 'Remisión'}
                </button>)}
                <button className="fcd-x45" onClick={() => setFacturaViendo(null)}>✕</button>
              </div>
            </div>
            <div className="fcd-ficha-cuerpo">{/* ✅ V00483: con pagos, la ficha es más ancha y los pagos van a la derecha */}
            <div className="fcd-x174">
              <div className="fcd-x175">
                <span className="fcd-x176">Status de la factura</span>
                <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color: colorStatusFactura(facturaViendo.statusFactura), border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, backgroundColor: `${colorStatusFactura(facturaViendo.statusFactura)}1a`, whiteSpace: 'nowrap' }}>{facturaViendo.statusFactura || 'Facturado'}</span>
                <div className="fcd-x177">
                  <span className="fcd-x132">Cambiar a:</span>
                  <select value={facturaViendo.statusFactura || 'Facturado'} onChange={(e) => handleCambiarStatusFactura(facturaViendo, e.target.value)}
                    style={{ backgroundColor: '#0d1117', border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, color: colorStatusFactura(facturaViendo.statusFactura), borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}>
                    {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <CancelacionFicha factura={facturaViendo} />{/* ✅ V00481 */}
              {avisoMonedaDe(facturaViendo) && (
                <div className="fcd-aviso-moneda">
                  <AvisoMonedaFactura texto={`${avisoMonedaDe(facturaViendo)} Corrígela con Editar factura.`} />
                  <button type="button" className="fcd-btn-corregir-moneda" onClick={(e) => abrirEditarFactura(e, facturaViendo)}>Editar factura</button>
                </div>
              )}

              <div className="fcd-x178">
                <div className="fcd-x179">
                  <div>
                    <span className="fcd-x180">Invoice</span>
                    <span className="fcd-x181">{facturaViendo.invoice}</span>
                  </div>
                  <div className="fcd-x182">
                    <span className="fcd-x180">Moneda</span>
                    <span className="fcd-x160"><NombreMoneda moneda={monedaFicha} respaldo={monedaFicha} /></span>
                  </div>
                  <div className="fcd-x161">
                    <span className="fcd-x180">Fecha de Facturación</span>
                    <span className="fcd-x183">{formatearFechaSpanish(facturaViendo.fecha)}</span>
                  </div>
                </div>
                <div>
                  <span className="fcd-x180">Cliente Facturado</span>
                  <span className="fcd-x80">{facturaViendo.clienteNombre || getNombreCliente(facturaViendo.clienteId) || '-'}</span>
                </div>
                <div>
                  <span className="fcd-x180">Factura CCP</span>
                  <span className="fcd-x184">{facturaViendo.facturaCcp || '-'}</span>
                </div>
                <div>
                  <span className="fcd-x180">Total Facturado</span>
                  {/* ✅ V00481: el total EN LA MONEDA de la factura (antes la conversión a pesos aunque fuera en dólares) */}
                  <span className="fcd-x185"><Importe monto={totalDeGrupo(facturaViendo)} moneda={monedaFicha} conNombre /></span>
                </div>

                {/* ✅ V00381: documento de la factura bien visible */}
                <TarjetaDocumentoFactura archivos={docsDeFactura(facturaViendo)} onAbrir={() => setDocsFacturaDe(facturaViendo)} />{/* ✅ V00451: varios */}
                <div className="fcd-x186"><hr className="fcd-x187" /></div>

                <div className="fcd-x188">
                  <div className="fcd-x189">
                    <span className="fcd-x176">
                      Referencias / Operaciones Facturadas ({facturaViendo.operacionesGuardadas?.length || 0}) — haz clic para ver el detalle
                    </span>
{puedeAgregarOperaciones(facturaViendo.statusFactura) && (/* ✅ V00481: a una factura Facturada no se le agregan */
                    <button className="fcd-x190"
                      onClick={() => { setAgregarRefFactura(facturaViendo); setBusquedaRefPendiente(''); if (operacionesGlobales.length === 0) descargarOpsCompletadas(); }}
                      title="Agregar una operación pendiente (sin facturar) a esta factura">
                      ＋ Agregar referencia
                    </button>)}
                  </div>
                  <div className="fcd-x191">
                    {facturaViendo.operacionesGuardadas?.map((op: any, i: number) => {
                      const numeroCaja = remolqueDeOp(op);
                      return (
                        <button className="fcd-x192" key={op.id} onClick={() => verDetalleOperacion(op.id)} title="Ver detalle de la operación"
                          onMouseEnter={(e: any) => { e.currentTarget.style.backgroundColor = '#1f2d44'; e.currentTarget.style.borderColor = '#79b8ff'; }}
                          onMouseLeave={(e: any) => { e.currentTarget.style.backgroundColor = '#21262d'; e.currentTarget.style.borderColor = '#58a6ff'; }}>
                          <span className="fcd-x193">{refDeOp(op)}</span>
                          {numeroCaja && (
                            <span className="fcd-x194">
                              <span className="fcd-x1">Caja:</span> {numeroCaja}
                            </span>
                          )}
                          {op.convenioNombre && (
                            <span className="fcd-x194"><span className="fcd-x1">Convenio:</span> {op.convenioNombre}</span>
                          )}
                          {/* ✅ V00481: en la moneda de la factura (Dólares → Dólares (Cliente); Pesos → Conversión Final) */}
                          <span className="fcd-x195"><Importe monto={importesFicha[i]} moneda={monedaFicha} /></span>
                          {/* ✅ NUEVO: quitar esta referencia de la factura */}
                          <span
                            role="button"
                            title="Quitar esta referencia de la factura (la operación vuelve a Por facturar)"
                            onClick={(e: any) => { e.stopPropagation(); quitarRefDeFactura(facturaViendo, op); }}
                            style={{ marginLeft: '8px', color: quitandoRef === String(op.id) ? '#6e7681' : '#f85149', fontWeight: 700, cursor: 'pointer', padding: '0 4px' }}
                          >
                            {quitandoRef === String(op.id) ? '…' : '✕'}
                          </span>
                        </button>
                      );
                    }) || <span className="fcd-x1">Sin detalle de operaciones.</span>}
                  </div>
                </div>
              </div>
            </div>
            {pagosFicha.length > 0 && (
              <PagosDeFactura pagos={pagosFicha} moneda={monedaFicha} total={totalDeGrupo(facturaViendo)}
                onAbrir={puedeClave('pagos') ? (pago) => abrirPagoEnPagos({ id: pago.id, tipo: 'cliente' }) : undefined} />
            )}
            </div>
            <div className="fcd-x196">
              <button onClick={() => setFacturaViendo(null)} className="btn btn-outline fcd-x197">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}


      {gestionOp && (
        <div className="modal-overlay fcd-x213">
          <div className="fcd-x141">
            <div className="fcd-x214">
              <h2 className="fcd-x215">Gestionar operación facturada</h2>
              <button className="fcd-x45" onClick={() => setGestionOp(null)}>✕</button>
            </div>

            <div className="fcd-x216">
              Operación: <b className="fcd-x217">{gestionOp.numReferencia || gestionOp.referencia || gestionOp.ref || String(gestionOp.id).substring(0, 6)}</b><br />
              Factura actual: <b className="fcd-x218">{invoiceDeOp(gestionOp) || '—'}</b>
            </div>

            <div className="fcd-x219">
              <label className="fcd-x220">NUEVO NÚMERO DE FACTURA</label>
              <input className="fcd-x150" type="text" value={gestionInvoice} onChange={e => setGestionInvoice(e.target.value)} placeholder="Ej. INV-2026-001" />
              <p className="fcd-x221">
                La operación se moverá a la factura con ese número (del mismo cliente). Si no existe, se crea; si la factura original queda sin operaciones, se elimina. El Historial se actualiza solo.
              </p>
            </div>

            <div className="fcd-x222">
              <button onClick={() => quitarOpDeFactura(gestionOp)} disabled={guardandoGestionOp}
                style={{ padding: '8px 18px', backgroundColor: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', cursor: guardandoGestionOp ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoGestionOp ? 0.7 : 1 }}>
                ✕ Quitar de la factura
              </button>
              <div className="fcd-x223">
                <button className="fcd-x224" onClick={() => setGestionOp(null)} disabled={guardandoGestionOp}>Cancelar</button>
                <button onClick={() => editarInvoiceDeOp(gestionOp, gestionInvoice)} disabled={guardandoGestionOp || !gestionInvoice.trim()}
                  style={{ padding: '8px 18px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: (guardandoGestionOp || !gestionInvoice.trim()) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (guardandoGestionOp || !gestionInvoice.trim()) ? 0.7 : 1 }}>
                  {guardandoGestionOp ? 'Guardando...' : 'Cambiar número'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {agregarRefFactura && (
        <div className="modal-overlay fcd-x213">
          <div className="fcd-x225">
            <div className="fcd-x226">
              <div>
                <h2 className="fcd-x215">Agregar referencia a la factura</h2>
                <span className="fcd-x7">
                  Factura <b className="fcd-x218">{agregarRefFactura.invoice}</b> · {agregarRefFactura.clienteNombre || getNombreCliente(agregarRefFactura.clienteId) || '-'}
                </span>
              </div>
              <button className="fcd-x45" onClick={() => setAgregarRefFactura(null)}>✕</button>
            </div>

            <div className="fcd-x227">
              <svg className="fcd-x22" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input className="fcd-x23" type="text" autoFocus placeholder="Buscar operación pendiente por referencia o # remolque..." value={busquedaRefPendiente} onChange={e => setBusquedaRefPendiente(e.target.value)} />
            </div>

            <div className="fcd-x228">
              {cargandoOperaciones ? (
                <div className="fcd-x229">Cargando operaciones pendientes...</div>
              ) : operacionesGlobales.length === 0 ? (
                <div className="fcd-x230">
                  No hay operaciones cargadas.
                  <div className="fcd-x231">
                    <button onClick={() => descargarOpsCompletadas(true)} style={{ ...btnDirStyle, color: '#58a6ff', margin: '0 auto' }}>↻ Cargar operaciones</button>
                  </div>
                </div>
              ) : candidatosPendientes.length === 0 ? (
                <div className="fcd-x230">
                  No se encontraron operaciones pendientes{agregarRefFactura.clienteId ? ' de este cliente' : ''}{busquedaRefPendiente.trim() ? ` para "${busquedaRefPendiente}"` : ''}.
                </div>
              ) : (
                candidatosPendientes.map((op: any) => {
                  const mm = obtenerMontoOperacion(op);
                  return (
                    <div className="fcd-x232" key={op.id}>
                      <div className="fcd-x233">
                        <div className="fcd-x234">{op.numReferencia || op.referencia || op.ref || String(op.id).substring(0, 6)}</div>
                        <div className="fcd-x235">
                          {formatearFechaSpanish(op.fechaServicio || op.createdAt)} · {txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque)} · <Importe monto={esMonedaUSD(monedaFacturaMostrar(agregarRefFactura)) ? mm.dol : mm.conv} moneda={esMonedaUSD(monedaFacturaMostrar(agregarRefFactura)) ? 'USD' : 'MXN'} />
                        </div>
                      </div>
                      <button onClick={() => agregarOpAFactura(agregarRefFactura, op)} disabled={agregandoRef}
                        style={{ flexShrink: 0, backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', padding: '7px 14px', cursor: agregandoRef ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 'bold', opacity: agregandoRef ? 0.7 : 1 }}>
                        ＋ Agregar
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <div className="fcd-x236">
              <span className="fcd-x237">Solo se muestran operaciones <b className="fcd-x1">sin facturar</b>{agregarRefFactura.clienteId ? ' del mismo cliente' : ''} (máx. 50).</span>
              <button className="fcd-x238" onClick={() => setAgregarRefFactura(null)}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {facturaEditando && (
        <div className="modal-overlay fcd-x239">
          <div className="fcd-x240">
            <div className="fcd-x142">
              <h2 className="fcd-x143">Editar Factura</h2>
              <button className="fcd-x45" onClick={() => setFacturaEditando(null)}>✕</button>
            </div>

            {/* ✅ NUEVO — el cliente de la factura ahora es EDITABLE (corrige
                facturas a nombre del cliente equivocado; Pagos lo hereda). */}
            <div className="fcd-x241" style={{ display: 'block' }}>
              <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Cliente de la factura</label>
              <SelectBuscable
                opciones={empresasList
                  .slice()
                  .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }))
                  .map((e: any) => ({ value: e.id, label: String(e.nombre || e.id) }))}
                value={editClienteId}
                onChange={(id: string) => {
                  // ✅ V00481: otro cliente con otra moneda → el total sugerido pasa a esa moneda.
                  if (monedaClienteDe(id) !== monedaClienteDe(editClienteId)) setEditTotal(String(totalEditPara(facturaEditando, id)));
                  setEditClienteId(id);
                }}
                placeholder="Buscar cliente..."
              />
              {Array.isArray(facturaEditando.__groupIds) && facturaEditando.__groupIds.length > 1 && (
                <span> · <b className="fcd-x242">{facturaEditando.__groupIds.length} documentos agrupados</b> (el total y los archivos se guardan en el primero)</span>
              )}
            </div>

            <div className="fcd-x163">
              <div className="fcd-x164">
                <label className="fcd-x146">STATUS DE LA FACTURA</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(editStatus), border: `1px solid ${colorStatusFactura(editStatus)}`, borderRadius: '6px', fontWeight: 'bold', boxSizing: 'border-box' }}>
                  {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  {!STATUS_FACTURA_OPCIONES.includes(editStatus) && editStatus && <option value={editStatus}>{editStatus}</option>}
                </select>
              </div>
              {estaCancelada(editStatus) && (
                <div className="fcd-x164">{/* ✅ V00481: cancelar pide nota y la factura que la reemplaza */}
                  <CamposCancelacion idBase="fcd-edit-canc" valor={editCancelacion} onCambiar={setEditCancelacion}
                    sugerencias={foliosDelCliente({ ...facturaEditando, clienteId: editClienteId || facturaEditando.clienteId })} deshabilitado={guardandoEdit} />
                </div>
              )}
              <div className="fcd-x164">
                <label className="fcd-x146">NÚMERO DE INVOICE</label>
                <input className="fcd-x150" type="text" value={editInvoice} onChange={e => setEditInvoice(e.target.value)} placeholder="Ej. INV-2026-001" />
              </div>
              <div className="fcd-x164">
                {/* ✅ V00276: documento de la factura desde el editor (se sube al guardar) */}
                <label className="fcd-x146">DOCUMENTO DE LA FACTURA</label>
                {/* ✅ V00451: varios (hasta 10), con vista previa; se guardan al guardar */}
                <AdjuntosArchivos etiqueta="Archivos" adjuntos={adjuntosEdicion} onCambiar={setAdjuntosEdicion} max={MAX_DOCS_FACTURA} deshabilitado={guardandoEdit} />
              </div>
              <div>
                <label className="fcd-x146">FECHA DE FACTURACIÓN</label>
                <input className="fcd-x243" type="date" value={editFecha} onChange={e => setEditFecha(e.target.value)} />
              </div>
              <div>
                {/* ✅ V00481: SIEMPRE la del cliente en Empresas; no se elige ni se quita */}
                <span className="fcd-x146">MONEDA</span>
                <span className="fcd-moneda-fija" title="Es la moneda del cliente en Empresas"><NombreMoneda moneda={monedaClienteDe(editClienteId)} respaldo="Sin moneda en Empresas" /></span>
              </div>
              <div className="fcd-x164 fcd-edit-aviso">{/* ✅ V00481: la moneda es la del cliente */}
                {!monedaClienteDe(editClienteId) ? (
                  <AvisoMonedaFactura error texto={editClienteId ? avisoSinMoneda('cliente') : 'Elige el cliente de la factura: la moneda es la del cliente en Empresas.'} />
                ) : (
                  <AvisoMonedaFactura texto={(() => {
                    const aviso = avisoMonedaDistinta(monedaDeFactura(facturaEditando), monedaClienteDe(editClienteId), 'cliente');
                    if (!aviso) return null;
                    const pagos = tienePagosAplicados(facturaEditando) ? ' Tiene pagos aplicados: revisa su saldo en Pagos.' : '';
                    const monNueva = monedaClienteDe(editClienteId);
                    const recalculado = monNueva ? totalSugeridoEn(monNueva, facturaEditando.operacionesGuardadas) > 0 : false;
                    return `${aviso} Al guardar queda en ${nombreMoneda(monNueva)}; ${recalculado ? 'el total sugerido es el de sus operaciones en esa moneda' : 'sus operaciones no traen importe en esa moneda: captura el total'}. Revísalo.${pagos}`;
                  })()} />
                )}
              </div>
              <div>
                <label className="fcd-x146">TOTAL FACTURADO</label>
                <input className="fcd-x245" type="number" step="any" value={editTotal} onChange={e => setEditTotal(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="fcd-x146">FACTURA CCP (Opcional)</label>
                <input className="fcd-x151" type="text" value={editCcp} onChange={e => setEditCcp(e.target.value)} placeholder="Referencia CCP..." />
              </div>
            </div>

            <div className="fcd-x246">
              <button className="fcd-x153" onClick={() => setFacturaEditando(null)} disabled={guardandoEdit}>Cancelar</button>
              <button onClick={handleGuardarEdicionFactura} disabled={guardandoEdit} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: guardandoEdit ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoEdit ? 0.7 : 1 }}>{guardandoEdit ? 'Guardando...' : 'Guardar cambios'}</button>
            </div>
          </div>
        </div>
      )}

      {(operacionDetalle || cargandoDetalle) && (
        <div className="modal-overlay fcd-x247">
          <div className="form-card detail-card fcd-x248">
            {cargandoDetalle || !operacionDetalle ? (
              <div className="fcd-x249">Cargando detalle de la operación...</div>
            ) : (
              <>
                <div className="form-header fcd-x250">
                  <div className="fcd-x251">
                    <div>
                      <h2 className="fcd-x252">Detalle de Operación</h2>
                      <div className="fcd-x253">
                        <span className="fcd-x254">{det.ref || det.id?.substring(0, 6)}</span>
                        <span className="fcd-x255">{txt(det.statusNombre, det.status)}</span>
                      </div>
                    </div>
                    <button className="fcd-x256" onClick={() => setOperacionDetalle(null)} onMouseEnter={(e) => e.currentTarget.style.color = '#f0f6fc'} onMouseLeave={(e) => e.currentTarget.style.color = '#8b949e'}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                </div>

                <div className="fcd-x257">
                  {tabsDetalle.map(tab => (
                    <button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)}
                      style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontWeight: pestañaDetalleActiva === tab.id ? 600 : 'normal', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="detail-content fcd-x258">
                  {pestañaDetalleActiva === 'general' && (
                    <div className="fcd-x259">
                      <div><span className="fcd-x260">Tipo de Operación</span><span className="fcd-x261">{txt(det.tipoOperacionNombre, det.tipoOperacionId)}</span></div>
                      <div><span className="fcd-x260">Fecha de Servicio / Status</span><span className="fcd-x261">{mostrarDato(det.fechaServicio)} <span className="fcd-x262">|</span> <span className="fcd-x263">{txt(det.statusNombre, det.status)}</span></span></div>
                      {evalIsFletes ? (
                        <div><span className="fcd-x260">Fecha de Cita</span><span className="fcd-x261">{formatearFechaHora(det.fechaCita)}</span></div>
                      ) : (<div></div>)}
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265">Cliente (Paga)</span><span className="fcd-x261">{txt(det.clienteNombre, det.nombreCliente, det.clientePaga)}</span></div>
                      <div><span className="fcd-x265">Convenio (Tarifa)</span><span className="fcd-x261">{txt(det.convenioNombre, det.convenio)}</span></div>
                      <div><span className="fcd-x265"># de Remolque</span><span className="fcd-x261">{txt(det.remolqueNombre, det.remolquePlaca, det.numeroRemolque)}</span></div>
                      <div><span className="fcd-x265">Ref Cliente</span><span className="fcd-x261">{mostrarDato(det.refCliente)}</span></div>
                      <div><span className="fcd-x266">Origen</span><span className="fcd-x261">{txt(det.origenNombre, det.origen)}</span></div>
                      <div><span className="fcd-x266">Destino</span><span className="fcd-x261">{txt(det.destinoNombre, det.destino)}</span></div>
                      <div className="fcd-x267"><span className="fcd-x265">Observaciones Ejecutivo</span><div className="fcd-x268">{mostrarDato(det.observacionesEjecutivo)}</div></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'pedimento' && (
                    <div className="fcd-x259">
                      <div className="fcd-x164"><span className="fcd-x265">Cliente (Mercancía)</span><span className="fcd-x261">{txt(det.clienteMercanciaNombre, det.clienteMercancia)}</span></div>
                      <div><span className="fcd-x265">Descripción de la Mercancía</span><span className="fcd-x261">{mostrarDato(det.descripcionMercancia)}</span></div>
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265">Cantidad (Enteros)</span><span className="fcd-x261">{mostrarDato(det.cantidad)}</span></div>
                      <div><span className="fcd-x265">Embalaje</span><span className="fcd-x261">{txt(det.embalajeNombre, det.embalaje)}</span></div>
                      <div><span className="fcd-x265">Peso (Kg)</span><span className="fcd-x261">{mostrarDato(det.pesoKg)}</span></div>
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265"># DODA</span><span className="fcd-x261">{mostrarDato(det.numDoda)}</span></div>
                      <div><span className="fcd-x265">Fecha de Emisión (DODA)</span><span className="fcd-x261">{mostrarDato(det.fechaEmisionDoda)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'manifiestos' && (
                    <div className="fcd-x259">
                      <div><span className="fcd-x265"># de Entry's</span><span className="fcd-x261">{mostrarDato(det.numeroEntrys)}</span></div>
                      <div><span className="fcd-x265">Cantidad de Entry's</span><span className="fcd-x261">{mostrarDato(det.cantEntrys)}</span></div>
                      <div className="fcd-x186"><hr className="fcd-x264" /></div>
                      <div><span className="fcd-x265"># Manifiesto</span><span className="fcd-x261">{mostrarDato(det.numManifiesto)}</span></div>
                      <div><span className="fcd-x265">Proveedor de Servicios</span><span className="fcd-x261">{txt(det.provServiciosNombre, det.provServicios)}</span></div>
                      <div><span className="fcd-x265">Costo Manifiesto ($)</span><span className="fcd-x269">{formatoMoneda(det.montoManifiesto)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'unidad' && (
                    <div>
                      <div className="fcd-x270">
                        <div className="fcd-x186"><span className="fcd-x265">Proveedor de Transporte</span><span className="fcd-x271">{txt(det.proveedorUnidadNombre, det.proveedorUnidad)}</span></div>
                      </div>
                      <div className="fcd-x272">
                        <div className="fcd-x273">
                          <div><span className="fcd-x265">Facturado En:</span><span className="fcd-x261"><NombreMoneda moneda={monedaFacturaOperacion(det, 'proveedor')} respaldo={textoFacturadoEn(det, 'proveedor')} /></span></div>
                          <div><span className="fcd-x265">Convenio Proveedor</span><span className="fcd-x261">{txt(det.convenioProveedorNombre, det.convenioProveedor)}</span></div>
                          <div><span className="fcd-x265">Moneda del Convenio (Base)</span><span className="fcd-x261"><NombreMoneda moneda={det.monedaConvenioProv} respaldo={mostrarMoneda(det.monedaConvenioProv)} /></span></div>
                        </div>
                        <div className="fcd-x274">
                          <div><span className="fcd-x265">Monto a Pagar (Base)</span><span className="fcd-x261">{formatoMoneda(det.totalAPagarProv)}</span></div>
                          <div><span className="fcd-x265">Costos Adicionales</span><span className="fcd-x261">{formatoMoneda(det.cargosAdicionalesProv)}</span></div>
                          <div><span className="fcd-x260">Subtotal (Convenio + Costos)</span><span className="fcd-x275">{formatoMoneda(det.subtotalProv)}</span></div>
                        </div>
                        <div className="fcd-x276">
                          <div><span className="fcd-x265"><NombreMoneda moneda="USD" /></span><span className="fcd-x277"><Importe monto={det.dolaresProv} moneda="USD" /></span></div>
                          <div><span className="fcd-x265"><NombreMoneda moneda="MXN" /></span><span className="fcd-x277"><Importe monto={det.pesosProv} moneda="MXN" /></span></div>
                          <div><span className="fcd-x278">Conversión Final (Gasto)</span><span className="fcd-x279"><Importe monto={det.conversionProv} moneda="MXN" /></span></div>
                        </div>
                      </div>

                      {showDetailInternalFleet && (
                        <div className="fcd-x270">
                          <div className="fcd-x186"><h4 className="fcd-x280">Flota Operativa (Roelca)</h4></div>
                          <div><span className="fcd-x265">Unidad Asignada</span><span className="fcd-x261">{txt(det.unidadNombre, det.unidad)}</span>{/* ✅ V00465 */}<TagPuenteUnidad unidadId={det.unidad} grupo={grupoTagDeOperacion(det)} /></div>
                          <div className="fcd-x164"><span className="fcd-x265">Operador Asignado</span><span className="fcd-x261">{txt(det.operadorNombre, det.operador)}</span></div>
                          <div className="fcd-x186"><hr className="fcd-x187" /></div>
                          <div><span className="fcd-x265">Sueldo del Operador</span><span className="fcd-x261">{formatoMoneda(det.sueldoOperador)}</span></div>
                          <div><span className="fcd-x265">Sueldo Extra</span><span className="fcd-x261">{formatoMoneda(det.sueldoExtra)}</span></div>
                          <div><span className="fcd-x260">Sueldo Total</span><span className="fcd-x281">{formatoMoneda(det.sueldoTotal)}</span></div>
                          <div className="fcd-x186"><hr className="fcd-x187" /></div>
                          <div><span className="fcd-x265">Combustible</span><span className="fcd-x261">{formatoMoneda(det.combustible)}</span></div>
                          <div><span className="fcd-x265">Combustible Extra</span><span className="fcd-x261">{formatoMoneda(det.combustibleExtra)}</span></div>
                          <div><span className="fcd-x260">Total Combustible</span><span className="fcd-x275">{formatoMoneda(det.combustibleTotal)}</span></div>
                        </div>
                      )}

                      {showDetailExternalFleet && (
                        <div className="fcd-x270">
                          <div className="fcd-x186"><h4 className="fcd-x282">Flota Externa (Proveedor)</h4></div>
                          <div><span className="fcd-x266">Unidad Externa</span><span className="fcd-x261">{mostrarDato(det.unidadProveedor)}</span></div>
                          <div className="fcd-x164"><span className="fcd-x266">Operador Externo</span><span className="fcd-x261">{mostrarDato(det.operadorProveedor)}</span></div>
                        </div>
                      )}

                      <div className="fcd-x283">
                        <div className="fcd-x284">
                          <div className="fcd-x285">Total Gastos [Sueldos + Manifiesto]</div>
                          <div className="fcd-x286">{formatoMoneda(det.totalGastos)}</div>
                        </div>
                      </div>

                      <div className="fcd-x287">
                        <span className="fcd-x288">Observaciones (Unidad / Proveedor)</span>
                        <div className="fcd-x289">{mostrarDato(det.observacionesUnidad)}</div>
                      </div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'cobrar' && (
                    <div>
                      <div className="fcd-x270">
                        <div><span className="fcd-x265">Facturado En:</span><span className="fcd-x261"><NombreMoneda moneda={monedaFacturaOperacion(det, 'cliente')} respaldo={textoFacturadoEn(det, 'cliente')} /></span></div>
                        <div><span className="fcd-x265">Moneda Convenio (Cliente)</span><span className="fcd-x261"><NombreMoneda moneda={det.monedaConvenioCliente} respaldo={mostrarMoneda(det.monedaConvenioCliente)} /></span></div>
                        <div><span className="fcd-x265">Convenio Seleccionado (Base)</span><span className="fcd-x261">{formatoMoneda(det.montoConvenioCliente)}</span></div>
                        <div><span className="fcd-x265">Cargos Adicionales</span><span className="fcd-x261">{formatoMoneda(det.cargosAdicionales)}</span></div>
                        <div><span className="fcd-x260">Subtotal (Convenio + Cargos)</span><span className="fcd-x290">{formatoMoneda(det.subtotalCliente)}</span></div>
                        <div><span className="fcd-x265">Tipo de Cambio del Día</span><span className="fcd-x261">{mostrarDato(det.tipoCambioAprobado)}</span></div>
                      </div>
                      <div className="fcd-x291">
                        {/* ✅ V00481: Dólares en azul, Pesos en verde (la Conversión Final es en pesos) */}
                        <div><span className="fcd-x265"><NombreMoneda moneda="USD" /> (Cliente)</span><span className="fcd-x292"><Importe monto={det.dolaresCliente} moneda="USD" /></span></div>
                        <div><span className="fcd-x265"><NombreMoneda moneda="MXN" /> (Cliente)</span><span className="fcd-x277"><Importe monto={det.pesosCliente} moneda="MXN" /></span></div>
                        <div><span className="fcd-x260">Conversión Final (Ingreso)</span><span className="fcd-x293"><Importe monto={det.conversionCliente} moneda="MXN" /></span></div>
                      </div>
                      <div className="fcd-x294">
                        <span className="fcd-x295">Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                        <span className="fcd-x296">{formatoMoneda(det.utilidadEstimada)}</span>
                      </div>
                      <div className="fcd-x287">
                        <span className="fcd-x288">Observaciones (Facturación / Cobro)</span>
                        <div className="fcd-x289">{mostrarDato(det.observacionesCobrar)}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-actions fcd-x297">
                  {/* ✅ V00481: editar la operación en el formulario de Operaciones (la ficha queda detrás) */}
                  <button type="button" className="fcd-btn-editar-detalle" onClick={() => { const id = String(det.id); setOperacionDetalle(null); setOpEditandoId(id); }}>✎ Editar operación</button>
                  <button onClick={() => setOperacionDetalle(null)} className="btn btn-outline fcd-x298">Cerrar Detalle</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {/* ════════════════ MODAL VISTA PREVIA DE REMISIÓN (editable) ════════════════ */}
      {remisionPreview && (
        <div className="modal-overlay fcd-x311">
          <div className="fcd-x312">
            <div className="fcd-x313">
              <div>
                <h2 className="fcd-x143">Remisión · vista previa</h2>
                <div className="fcd-x314">
                  <button type="button" onClick={() => aplicarEmisorEnPreview(false)}
                    title="Usar el encabezado de PESOS (Rolando)"
                    style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer', backgroundColor: !remisionPreview.esUSD ? '#12352a' : 'transparent', color: !remisionPreview.esUSD ? '#3fb950' : '#8b949e', border: `1px solid ${!remisionPreview.esUSD ? '#3fb950' : '#30363d'}` }}>
                    PESOS (MXN) · Rolando
                  </button>
                  <button type="button" onClick={() => aplicarEmisorEnPreview(true)}
                    title="Usar el encabezado de DÓLARES (Camila)"
                    style={{ padding: '4px 12px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 'bold', cursor: 'pointer', backgroundColor: remisionPreview.esUSD ? '#1f3a5f' : 'transparent', color: remisionPreview.esUSD ? '#58a6ff' : '#8b949e', border: `1px solid ${remisionPreview.esUSD ? '#58a6ff' : '#30363d'}` }}>
                    DÓLARES (USD) · Camila
                  </button>
                </div>
              </div>
              <button className="fcd-x45" onClick={() => setRemisionPreview(null)}>✕</button>
            </div>
            <p className="fcd-x315">
              Revisa y edita lo que necesites; luego pulsa <b className="fcd-x316">Generar PDF</b>. Se abrirá el diálogo de impresión donde puedes elegir <b className="fcd-x11">“Guardar como PDF”</b>.
            </p>

            {/* Emisor (encabezado) */}
            <div className="fcd-x317">
              <div className="fcd-x318">ENCABEZADO (EMISOR)</div>
              <div className="fcd-x319">
                <div><label style={rLabelStyle}>NOMBRE</label><input type="text" value={remisionPreview.emisorNombre} onChange={e => setRP('emisorNombre', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>EMAIL</label><input type="text" value={remisionPreview.emisorEmail} onChange={e => setRP('emisorEmail', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DIRECCIÓN</label><input type="text" value={remisionPreview.emisorDireccion} onChange={e => setRP('emisorDireccion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD / ESTADO / TEL.</label><input type="text" value={remisionPreview.emisorCiudadEstado} onChange={e => setRP('emisorCiudadEstado', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            {/* Datos de la remisión y del cliente */}
            <div className="fcd-x317">
              <div className="fcd-x320">DATOS DE LA REMISIÓN Y DEL CLIENTE</div>
              <div className="fcd-x321">
                <div><label style={rLabelStyle}># REMISIÓN</label><input type="text" value={remisionPreview.numero} onChange={e => setRP('numero', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>FECHA</label><input type="text" value={remisionPreview.fecha} onChange={e => setRP('fecha', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DENOMINACIÓN</label><input type="text" value={remisionPreview.moneda} onChange={e => setRP('moneda', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DÍAS CRÉDITO</label><input type="text" value={remisionPreview.diasCredito} onChange={e => setRP('diasCredito', e.target.value)} style={rInputStyle} /></div>
                <div className="fcd-x164"><label style={rLabelStyle}>CLIENTE</label><input type="text" value={remisionPreview.clienteNombre} onChange={e => setRP('clienteNombre', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>NUM. EXT/INT</label><input type="text" value={remisionPreview.numExtInt} onChange={e => setRP('numExtInt', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>COLONIA</label><input type="text" value={remisionPreview.colonia} onChange={e => setRP('colonia', e.target.value)} style={rInputStyle} /></div>
                <div className="fcd-x186"><label style={rLabelStyle}>DIRECCIÓN</label><input type="text" value={remisionPreview.direccion} onChange={e => setRP('direccion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD</label><input type="text" value={remisionPreview.ciudad} onChange={e => setRP('ciudad', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            {/* Renglones de servicios */}
            <div className="fcd-x317">
              <div className="fcd-x322">SERVICIOS ({(remisionPreview.filas || []).length})</div>
              <div className="fcd-x323">
                <table className="fcd-x324">
                  <thead>
                    <tr className="fcd-x325">
                      <th className="fcd-x326">REF#</th>
                      <th className="fcd-x326">FECHA</th>
                      <th className="fcd-x326">EQ.</th>
                      <th className="fcd-x326">ORIGEN</th>
                      <th className="fcd-x326">DESTINO</th>
                      <th className="fcd-x326">DESCRIPCIÓN</th>
                      <th className="fcd-x327">IMPORTE</th>
                      <th className="fcd-x328"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(remisionPreview.filas || []).map((r: any, idx: number) => (
                      <tr className="fcd-x329" key={idx}>
                        <td className="fcd-x330"><input value={r.ref} onChange={e => setRPFila(idx, 'ref', e.target.value)} style={{ ...rCellStyle, minWidth: '90px' }} /></td>
                        <td className="fcd-x330"><input value={r.fecha} onChange={e => setRPFila(idx, 'fecha', e.target.value)} style={{ ...rCellStyle, minWidth: '90px' }} /></td>
                        <td className="fcd-x330"><input value={r.equipo} onChange={e => setRPFila(idx, 'equipo', e.target.value)} style={{ ...rCellStyle, minWidth: '60px' }} /></td>
                        <td className="fcd-x330"><input value={r.origen} onChange={e => setRPFila(idx, 'origen', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                        <td className="fcd-x330"><input value={r.destino} onChange={e => setRPFila(idx, 'destino', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                        <td className="fcd-x330"><input value={r.descripcion} onChange={e => setRPFila(idx, 'descripcion', e.target.value)} style={{ ...rCellStyle, minWidth: '160px' }} /></td>
                        <td className="fcd-x330"><input type="number" step="any" value={r.importe} onChange={e => setRPFila(idx, 'importe', e.target.value)} style={{ ...rCellStyle, minWidth: '90px', textAlign: 'right', color: '#3fb950' }} /></td>
                        <td className="fcd-x331">
                          <button className="fcd-x332" onClick={() => quitarFilaRemision(idx)} title="Quitar renglón">✕</button>
                        </td>
                      </tr>
                    ))}
                    {(remisionPreview.filas || []).length === 0 && (
                      <tr><td className="fcd-x333" colSpan={8}>Sin renglones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pie: tipo de cambio, total, observaciones */}
            <div className="fcd-x334">
              <div><label style={rLabelStyle}>FECHA TIPO DE CAMBIO (DOF)</label><input type="text" value={remisionPreview.fechaTipoCambio} onChange={e => setRP('fechaTipoCambio', e.target.value)} placeholder="Ej. 24/06/2026" style={rInputStyle} /></div>
              <div><label style={rLabelStyle}>TIPO DE CAMBIO</label><input type="text" value={remisionPreview.tipoCambio} onChange={e => setRP('tipoCambio', e.target.value)} placeholder="Ej. 17.5505" style={rInputStyle} /></div>
              <div><label style={rLabelStyle}>TOTAL</label><input type="number" step="any" value={remisionPreview.total} onChange={e => setRP('total', e.target.value)} style={{ ...rInputStyle, color: '#3fb950', fontWeight: 'bold' }} /></div>
              <div className="fcd-x186"><label style={rLabelStyle}>OBSERVACIONES</label><input type="text" value={remisionPreview.observaciones} onChange={e => setRP('observaciones', e.target.value)} style={rInputStyle} /></div>
            </div>

            <div className="fcd-x246">
              <button className="fcd-x153" onClick={() => setRemisionPreview(null)}>Cerrar</button>
              <button className="fcd-x335" onClick={generarPDFDeRemision}>Generar PDF</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
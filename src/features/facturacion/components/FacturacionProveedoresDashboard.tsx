// src/features/facturacion/components/FacturacionProveedoresDashboard.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// PARIDAD TOTAL CON FacturacionClientesDashboard (lado "POR PAGAR")
// ═══════════════════════════════════════════════════════════════════════
// Este módulo replica EXACTAMENTE el comportamiento del de Clientes, pero
// trabajando el lado del PROVEEDOR de transporte:
//   subtotal   = totalAPagarProv + cargosAdicionalesProv
//   moneda     = facturadoEnUnidad / monedaUnidadNombre
//   conversión = conversionProv (o recálculo USD/MXN)
//   Facturas en `facturas_proveedores`; la operación facturada se marca con
//   facturaProveedorId / facturaProveedorFolio / facturadoProveedor.
//
// ⚠️ CONFIG: ajusta ID_TIPO_PROVEEDOR con el ID del tipo "Proveedor" de tu
//    catálogo de empresas. Vacío ('') = el buscador muestra TODAS las empresas.
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useRef, useCallback, useDeferredValue, useEffectEvent } from 'react';
import { useBusquedaGlobal } from '../../../utils/busquedaGlobal'; // ✅ V00263
import { useModuloEscuchando } from '../../../utils/moduloVivoContexto'; // ✅ V00438 (Fase 2.7)
import { EditorOperacionEmbebido } from '../../operaciones/components/EditorOperacionEmbebido';
import { HiloModal } from '../../hilo/HiloModal';
import { datosAAplicar, notificarOperacionGuardada, suscribirOperacionGuardada } from '../../../utils/operacionesBus';
import { avisoYaFacturadas, facturaExistenteFresca, operacionesYaFacturadas } from '../services/facturarSeguro'; // ✅ V00451
import {
  collection,
  query,
  writeBatch,
  doc,
  limit,
  orderBy,
  where,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  documentId,
  startAfter,
  arrayUnion,
  onSnapshot,
} from 'firebase/firestore';
import { SelectBuscable } from '../../catalogos/components/SelectBuscable';
import { db } from '../../../config/firebase';
import * as XLSX from 'xlsx';
import { exportarExcelProfesional } from './exportarExcelProfesional';
import { generarRemisionPDF } from './generarRemisionPDF';
import type { EmisorRemision, RemisionData } from './generarRemisionPDF';
import { generarConfirmacionTarifaPDF, generarRateProveedorPDF } from './generarDocumentosProveedorPDF';
import type { ConfirmacionTarifaData, RateProveedorData } from './generarDocumentosProveedorPDF';
import { getAuth } from 'firebase/auth';
import { registrarLog } from '../../../utils/logger';
import './FacturacionProveedoresDashboard.css';
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
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { FormularioConfigurable } from '../../formularios/FormularioConfigurable';
import { esUSD as esMonedaUSD, monedaCanonica as monedaCanonicaComun, nombreMoneda } from '../../../shared/dominio/moneda';
import { ID_MXN, ID_USD, STATUS_COMPLETADOS } from '../../../shared/dominio/constantes'; // ✅ V00439 (Fase 3.x)
import { obtenerCatalogo, useCatalogo, useCatalogos } from '../../../shared/data/catalogos';
import type { DocCatalogo } from '../../../shared/data/catalogos'; // ✅ V00439 (Fase 3.x)
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
import { aplicarFacturas, aplicarOperaciones, llamarDinero, mensajeDinero } from '../services/dineroServidor'; // ✅ V00441
import { useFlags, useFlagsCargadas } from '../../../shared/data/flags';
import {
  aplicarConfigColumnasGuardada, colorStatusFactura, DOC_REMISION_EMISORES, fechaOrdenKey, LIMITE_FACTURAS_TODAS, LIMITE_OPS_TODAS,
  moverIdAlInicio, PAG_FACTURAS, pareceReferencia, parseFechaFactura, refNaturalKey, STATUS_FACTURA_OPCIONES, valorGenericoOp,
} from '../selectores'; // ✅ V00444 (Fase 8.1): una sola copia (antes idéntica en Clientes y Proveedores)
import { useOperacionesFacturables } from '../hooks/useOperacionesFacturables'; // ✅ V00444 (Fase 8.1)
import CargandoDatos from '../../../shared/components/CargandoDatos'; // ✅ V00449
import { conversionOperacion, monedaDeFactura, montoOperacion } from '../../../shared/dominio/dinero';
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
  cancelacionDe, estaCancelada, importesDeRenglones, monedaDeEmpresa, puedeAgregarOperaciones, puedeGenerarRemision,
  totalSugeridoEn, validarCancelacion,
} from '../services/reglasFactura';
import type { DatosCancelacion } from '../services/reglasFactura';
import { escribirEnGrupo, escrituraCancelacion } from '../services/statusFacturaDatos';
import { leerParaDocumento } from '../../../utils/direccionPdf'; // ✅ V00448
import TagPuenteUnidad from '../../puentes/components/TagPuenteUnidad'; // ✅ V00465
import { grupoTagDeOperacion } from '../../puentes/services/tagPuente';

// ──────────────────────────────────────────────────────────────────────
// Constantes
// ──────────────────────────────────────────────────────────────────────
const ID_TIPO_PROVEEDOR = '';                 // ID del tipo "Proveedor" en tiposEmpresa. Vacío = muestra todas las empresas.
const CAMPO_PROVEEDOR_OP = 'proveedorUnidad'; // campo de la operación que referencia al proveedor
// ✅ V00439 (Fase 3.x): IDs de moneda y status desde shared/dominio/constantes.


const CONFIG_COLUMNAS_COLLECTION = 'config_columnas';

const LS_REMISION_EMISORES = 'cfg_remision_emisores_v1';
// Emisor por defecto para remisiones en PESOS (MXN) → Rolando.
const EMISOR_MXN_DEFAULT: EmisorRemision = {
  facturaNombre: 'ROLANDO ROBERTO MONTALVO CISNEROS',
  direccion: 'MAR DE LAS ANTILLAS 947, COL. LA PAZ',
  ciudadEstado: 'NUEVO LAREDO, TAMPS | (867) 196 4690',
  email: 'COBRANZA@ROELCA.COM',
};
// Emisor por defecto para remisiones en DÓLARES (USD) → Camila.
const EMISOR_USD_DEFAULT: EmisorRemision = {
  facturaNombre: 'CAMILA MONTALVO OSORIO',
  direccion: 'MAR DE LAS ANTILLAS 947, COL. LA PAZ',
  ciudadEstado: 'NUEVO LAREDO, TAMPS | (867) 196 4690',
  email: 'COBRANZA@ROELCA.COM',
};
// ⚠️ v2 (V00126): reset para aplicar el nuevo orden Subtotal → Costo Adicional → Total → TC … → Conversión (MXN)
const DOC_COLUMNAS_OPS = 'facturacion_proveedores_ops_v2';
// ⚠️ V00126: reset para incluir la columna # Pago
const DOC_COLUMNAS_HISTORIAL = 'facturacion_proveedores_historial_v2';

const LS_COLS_OPS = 'cfgcols_facturacion_prov_ops_v1';
const LS_COLS_HIST = 'cfgcols_facturacion_prov_hist_v1';

// ✅ V00439 (Fase 3.x): el mapa id→nombre ya no se arma desde las copias de
//   catálogos en localStorage (cat_v1__/cat_v2__/roelca_catalogos_v2): sale de
//   los catálogos en vivo (ver services/mapaCatalogos.ts).

const moverStatusAlInicio = (cols: any[]): any[] => moverIdAlInicio(cols, 'statusFactura');


const COLUMNAS_FACTURA_BASE = [
  { id: 'statusFactura', label: 'Status',        visible: true },
  { id: 'invoice',      label: 'Factura Prov.', visible: true },
  { id: 'numeroPago',   label: '# Pago',        visible: true }, // ✅ V00126: número(s) de pago aplicados a la factura
  { id: 'fecha',        label: 'Fecha',         visible: true },
  { id: 'proveedor',    label: 'Proveedor',     visible: true },
  { id: 'moneda',       label: 'Moneda',        visible: true },
  { id: 'facturaCcp',   label: 'Referencia',    visible: true },
  { id: 'cantOps',      label: 'Cant. Ops',     visible: true },
  { id: 'referencias',  label: 'Referencias',   visible: true },
  { id: 'total',        label: 'Total',         visible: true },
  { id: 'createdAt',    label: 'Registrada',    visible: false },
];

// ✅ V00438 (Fase 2.8): claves de la copia vieja de operaciones/facturas en
//   localStorage (almacenSesion). Ya no se escriben; se borran una vez al montar.
const CLAVES_CACHE_LEGADO = ['roelca_ops_prov_completadas_v2', 'roelca_facturas_proveedores_v1', 'roelca_facturas_clientes_xref_v1'];

const normalizarFactura = (raw: any): any => {
  const fechaNorm = parseFechaFactura(raw.fecha || raw.fechaFactura);

  // Convierte a arreglo tanto si viene como arreglo, como si viene en texto
  // separado por comas (así llegan las facturas importadas desde el CSV).
  const aArray = (v: any): string[] => {
    if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
    if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
    return [];
  };

  const opsIds = aArray(raw.operacionesIds);
  const opsRefs = aArray(raw.operaciones);

  let opsGuardadas: any = raw.operacionesGuardadas;
  if (!Array.isArray(opsGuardadas) || opsGuardadas.length === 0) {
    // Sin detalle (factura importada): combinamos IDs + referencias por posición.
    const n = Math.max(opsIds.length, opsRefs.length);
    opsGuardadas = [];
    for (let i = 0; i < n; i++) {
      opsGuardadas.push({
        id: String(opsIds[i] || opsRefs[i] || ''),
        ref: String(opsRefs[i] || opsIds[i] || ''),
        monto: 0,
        subtotalBase: 0,
      });
    }
  }
  return {
    ...raw,
    fecha: fechaNorm || String(raw.fecha || raw.fechaFactura || ''),
    operacionesIds: opsIds,
    operaciones: opsRefs,
    operacionesGuardadas: opsGuardadas,
    subtotalFactura: Number(raw.subtotalFactura) || Number(raw.total) || 0,
    monedaProveedor: raw.monedaProveedor || raw.moneda || 'N/A',
    monedaId: raw.monedaId || '',
    proveedorNombre: raw.proveedorNombre || raw.proveedor || '',
    facturaCcp: raw.facturaCcp || raw.ccp || '',
    invoice: raw.invoice || raw.numeroInvoice || raw.numInvoice || raw.folio || String(raw.id || ''),
    statusFactura: raw.statusFactura || 'Facturado',
  };
};

const COLUMNAS_OPS_BASE: any[] = [
  { id: 'factura',       label: '# Factura',       visible: true,  orden: true,  grupo: 'General' },
  { id: 'facturaRoelca', label: 'Factura Roelca',  visible: true,  orden: false, grupo: 'General' },
  { id: 'ref',           label: 'Ref. Operación',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'fechaServicio', label: 'Fecha Servicio',  visible: true,  orden: true,  grupo: 'General' },
  { id: 'proveedor',     label: 'Proveedor',       visible: true,  orden: true,  grupo: 'General' },
  { id: 'cartaPorte',    label: 'Carta Porte',     visible: true,  orden: false, grupo: 'General' },
  { id: 'destino',       label: 'Destino',         visible: true,  orden: true,  grupo: 'General' },
  // ✅ V00126: Facturado en · Subtotal (convenio en moneda de factura) · Costo
  //    Adicional · Total · Tipo de Cambio · … · Conversión (MXN) SIEMPRE al final.
  { id: 'moneda',        label: 'Facturado en',    visible: true,  orden: false, grupo: 'Por Pagar' },
  { id: 'subtotal',      label: 'Subtotal',        visible: true,  orden: true,  grupo: 'Por Pagar' },
  { id: 'cargosAdicionalesProv', label: 'Costo Adicional', visible: true,  orden: true,  grupo: 'Por Pagar', tipo: 'monto', sourceField: 'cargosAdicionalesProv' },
  { id: 'total',         label: 'Total',           visible: true,  orden: true,  grupo: 'Por Pagar' },
  { id: 'tipoCambioAprobado',    label: 'Tipo de Cambio',  visible: true,  orden: true,  grupo: 'Por Pagar', tipo: 'numero', sourceField: 'tipoCambioAprobado' },
  { id: 'dolares',       label: 'Dólares',         visible: false, orden: false, grupo: 'Por Pagar' },
  { id: 'pesos',         label: 'Pesos',           visible: false, orden: false, grupo: 'Por Pagar' },
  { id: 'conv',          label: 'Conversión (MXN)', visible: true,  orden: true,  grupo: 'Por Pagar' },
  { id: 'tipoOperacion',  label: 'Tipo de Operación', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['tipoOperacionNombre', 'tipoOperacionId'] },
  { id: 'status',         label: 'Status',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['statusNombre', 'status'] },
  { id: 'fechaCita',      label: 'Fecha Cita',        visible: false, orden: true,  grupo: 'General', tipo: 'fechaHora', sourceField: 'fechaCita' },
  { id: 'convenio',       label: 'Convenio (Tarifa)', visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['convenioNombre', 'convenio'] },
  { id: 'remolque',       label: '# Remolque',        visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['remolqueNombre', 'remolquePlaca', 'numeroRemolque'] },
  { id: 'refCliente',     label: 'Ref Cliente',       visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: 'refCliente' },
  { id: 'origen',         label: 'Origen',            visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['origenNombre', 'origen'] },
  { id: 'cliente',        label: 'Cliente (Paga)',    visible: false, orden: true,  grupo: 'General', tipo: 'texto',     sourceField: ['clienteNombre', 'nombreCliente', 'clientePaga', 'clienteId'] },
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
  { id: 'montoConvenioCliente',  label: 'Monto Convenio Cliente',  visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'montoConvenioCliente' },
  { id: 'cargosAdicionales',     label: 'Cargos Adicionales',      visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'cargosAdicionales' },
  { id: 'subtotalCliente',       label: 'Subtotal Cliente',        visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'subtotalCliente' },
  { id: 'dolaresCliente',        label: 'Dólares Cliente',         visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'dolaresCliente' },
  { id: 'pesosCliente',          label: 'Pesos Cliente',           visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'pesosCliente' },
  { id: 'conversionCliente',     label: 'Conversión Cliente',      visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'conversionCliente' },
  { id: 'utilidadEstimada',      label: 'Utilidad Estimada',       visible: false, orden: true,  grupo: 'Por Cobrar', tipo: 'monto',  sourceField: 'utilidadEstimada' },
  { id: 'observacionesCobrar',   label: 'Obs. Facturación/Cobro',  visible: false, orden: false, grupo: 'Por Cobrar', tipo: 'texto',  sourceField: 'observacionesCobrar' },
];

// ✅ V00441 (Fase 5.1): la regla de monedas vive en src/shared/dominio/dinero.ts
//   (la misma que usa el servidor).
const calcularConversionProveedor = (op: any) => conversionOperacion(op, 'proveedor');


// ✅ FIX MONEDA — TOTAL NATIVO DE LA FACTURA (USD -> dólares, MXN -> pesos):
//   ✅ Fase 1.8: vive en ../services/totalesFactura (una sola regla para
//   Clientes y Proveedores, y la misma que recalcula subtotalMonedaFactura).

// ✅ V00441: dinero.ts (incluye el respaldo de la conversión guardada y de la
//   Confirmación de Tarifa).
const obtenerMontoOperacion = (op: any) => montoOperacion(op, 'proveedor');

// ✅ V00438 (Fase 2.4): helpers puros movidos fuera del componente para que las
//   claves de orden se puedan memoizar con dependencias reales.
const provDeOp = (op: any) => op?.[CAMPO_PROVEEDOR_OP] || op?.proveedorUnidadId;


export const FacturacionProveedoresDashboard = () => {
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
  const [activeTab, setActiveTab] = useState<'operaciones' | 'historial' | 'pagadas'>('operaciones');
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
    const q = query(collection(db, 'pagos'), where('tipo', '==', 'proveedor'));
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
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [seleccionadas, setSeleccionadas] = useState<string[]>([]);

  const [ordenOps, setOrdenOps] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fechaServicio', dir: 'desc' });
  const [ordenFac, setOrdenFac] = useState<{ campo: string; dir: 'asc' | 'desc' }>({ campo: 'fecha', dir: 'desc' });

  const [textoBuscarProveedor, setTextoBuscarProveedor] = useState('');
  const [mostrarSugerenciasProveedor, setMostrarSugerenciasProveedor] = useState(false);

  const [textoBuscarFactura, setTextoBuscarFactura] = useState('');
  useBusquedaGlobal((t) => setTextoBuscarFactura(t), 'facturas de proveedores'); // ✅ V00263: buscador global del topbar
  // ✅ V00438 (Fase 2.4): las búsquedas filtran miles de filas; con el valor
  //   diferido el input responde al teclear y la tabla se actualiza después.
  const textoBuscarRemolqueOpsDiferido = useDeferredValue(textoBuscarRemolqueOps);
  const textoBuscarFacturaDiferido = useDeferredValue(textoBuscarFactura);
  const [filtroStatusFactura, setFiltroStatusFactura] = useState<string>('Todos');
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
  //   Storage `facturas_documentos/facturas_proveedores/{id}/`. Se pide al facturar y se puede
  //   subir desde la fila, la ficha o el editor.
  // ✅ V00451: VARIOS documentos por factura (hasta 10): lista `docsFactura` + los campos de
  //   siempre (docFactura* = el primero, para lo que todavía lee uno solo). Facturar y
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
      return camposDocsFactura(await agregarDocsFactura('proveedores', idFactura, adjuntosFacturar, folio));
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
      const escrituras = await guardarDocsFactura('proveedores', fila, adjuntosEdicion);
      if (escrituras) aplicarDocsLocal(escrituras);
    } catch (eDoc: unknown) {
      console.error(eDoc);
      alert(`Los cambios de la factura SÍ se guardaron, pero los documentos no.\n\nMotivo: ${detalleError(eDoc)}`);
    }
  };
  // Cruce con Facturación de CLIENTES: para saber si la operación ya fue facturada a cliente.
  const [facturasClientesGlobales, setFacturasClientesGlobales] = useState<any[]>([]);
  const [facturaClienteViendo, setFacturaClienteViendo] = useState<any | null>(null);

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
  const [editProveedorId, setEditProveedorId] = useState(''); // ✅ NUEVO: reasignar proveedor
  type FacturaACancelar = { id?: unknown; invoice?: unknown; proveedorId?: unknown; statusFactura?: unknown; __groupIds?: unknown };
  // ✅ V00481: la moneda ya no se elige (es la del proveedor); cancelar pide nota y factura de reemplazo.
  const [editCancelacion, setEditCancelacion] = useState<DatosCancelacion>(CANCELACION_VACIA);
  const [cancelarDe, setCancelarDe] = useState<FacturaACancelar | null>(null);

  const [gestionOp, setGestionOp] = useState<any | null>(null);
  const [gestionInvoice, setGestionInvoice] = useState('');
  const [guardandoGestionOp, setGuardandoGestionOp] = useState(false);
  const [agregarRefFactura, setAgregarRefFactura] = useState<any | null>(null);
  const [busquedaRefPendiente, setBusquedaRefPendiente] = useState('');
  const [agregandoRef, setAgregandoRef] = useState(false);

  // ✅ V00126: sin redondeo — hasta 6 decimales tal cual resultan del cálculo.
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
      const todas: any[] = [];
      let cursor: any = null;
      for (let i = 0; i < Math.ceil(LIMITE_FACTURAS_TODAS / PAG_FACTURAS); i++) {
        const cons: any[] = [orderBy(documentId()), limit(PAG_FACTURAS)];
        if (cursor) cons.splice(1, 0, startAfter(cursor));
        const snap = await getDocs(query(collection(db, 'facturas_proveedores'), ...cons));
        if (snap.empty) break;
        snap.docs.forEach(d => todas.push(normalizarFactura({ id: d.id, ...(d.data() as any) })));
        cursor = snap.docs[snap.docs.length - 1];
        if (snap.docs.length < PAG_FACTURAS) break;
      }
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
      console.error('[Facturación Proveedores] Error al recargar facturas:', e);
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

  // ── Cruce con Facturación de CLIENTES ────────────────────────────────────
  // Carga (una vez) las facturas de clientes para saber si una
  // operación ya fue facturada al cliente y con qué número de factura.
  const cruceEnVueloRef = useRef(false); // ✅ V00447: una sola descarga del cruce
  const cargarFacturasClientesAlEntrar = useEffectEvent(() => {
    if (facturasClientesGlobales.length > 0 || cruceEnVueloRef.current) return;
    cruceEnVueloRef.current = true;

    const descargarClientes = async () => {
      try {
        const todas: any[] = [];
        let cursor: any = null;
        for (let i = 0; i < Math.ceil(LIMITE_FACTURAS_TODAS / PAG_FACTURAS); i++) {
          const cons: any[] = [orderBy(documentId()), limit(PAG_FACTURAS)];
          if (cursor) cons.splice(1, 0, startAfter(cursor));
          const snap = await getDocs(query(collection(db, 'facturas_clientes'), ...cons));
          if (snap.empty) break;
          snap.docs.forEach(d => {
            const f: any = d.data();
            todas.push({
              id: d.id,
              invoice: f.invoice || f.facturas || '',
              fecha: f.fecha || f.fechaFactura || '',
              clienteNombre: f.clienteNombre || f.cliente || '',
              statusFactura: f.statusFactura || f.status || '',
              moneda: f.monedaFacturacion || f.moneda || '',
              total: (f.subtotalFactura !== undefined ? f.subtotalFactura : (f.total !== undefined ? f.total : 0)),
              operacionesIds: f.operacionesIds || [],
              operaciones: f.operaciones || [],
            });
          });
          cursor = snap.docs[snap.docs.length - 1];
          if (snap.docs.length < PAG_FACTURAS) break;
        }
        setFacturasClientesGlobales(todas);
      } catch (e) {
        console.error('[Proveedores] Error cargando facturas de clientes (cruce):', e);
      }
      cruceEnVueloRef.current = false;
    };
    descargarClientes();
  });
  useEffect(() => cargarFacturasClientesAlEntrar(), []);

  // Mapa: operacionId / ref  ->  info de la factura de cliente donde aparece.
  const mapaFacturaClientePorOp = useMemo(() => {
    const aArr = (v: any): string[] => Array.isArray(v)
      ? v.map((x) => String(x || '').trim()).filter(Boolean)
      : (typeof v === 'string' ? v.split(',').map((x) => x.trim()).filter(Boolean) : []);
    const m = new Map<string, any>();
    (facturasClientesGlobales || []).forEach((f: any) => {
      const info = {
        facturaId: f.id,
        invoice: f.invoice || '',
        fecha: f.fecha || '',
        clienteNombre: f.clienteNombre || '',
        statusFactura: f.statusFactura || '',
        moneda: f.moneda || '',
        total: f.total ?? 0,
      };
      [...aArr(f.operacionesIds), ...aArr(f.operaciones)].forEach((k) => {
        if (k && !m.has(k)) m.set(k, info);
      });
    });
    return m;
  }, [facturasClientesGlobales]);

  const getFacturaClienteDeOp = (op: any): any | null => {
    if (!op) return null;
    return mapaFacturaClientePorOp.get(String(op.id))
      || mapaFacturaClientePorOp.get(String(op.ref || ''))
      || mapaFacturaClientePorOp.get(String(op.numReferencia || ''))
      || mapaFacturaClientePorOp.get(String(op.referencia || ''))
      || null;
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
  } = useOperacionesFacturables<any>('proveedor', STATUS_FACTURABLES, vistaOps); // eslint-disable-line @typescript-eslint/no-explicit-any -- operaciones sin tipo canónico en el tablero (antes useState<any[]>).

  const cargarOperacionesAlEntrar = useEffectEvent(() => {
    if (activeTab !== 'operaciones') return;
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

  // ✅ V00126: cualquier guardado en `operaciones` se refleja aquí al instante.
  useEffect(() => {
    return suscribirOperacionGuardada((aviso) => {
      const { id, data } = aviso;
      setOperacionesGlobales(prev => {
        const idx = prev.findIndex(o => String(o.id) === String(id));
        // ✅ V00451: solo los campos que cambiaron, si el aviso los dice (no pisa datos más nuevos).
        if (idx >= 0) { const next = [...prev]; next[idx] = { ...prev[idx], ...datosAAplicar(aviso), id: String(id) }; return next; }
        return [{ id: String(id), ...data }, ...prev];
      });
    });
  }, []);

  const recargarOperaciones = () => {
    setSeleccionadas([]);
    descargarOpsCompletadas(true);
  };

  // Refresca AMBAS colecciones (operaciones + facturas) forzando lectura desde Firestore.
  const recargarTodo = () => {
    recargarOperaciones();
    recargarFacturas();
  };

  // ✅ V00438 (Fase 2.4): índice de empresas por id / nombre / nombreCorto (gana
  //   la primera de la lista, igual que el .find de antes). getNombreEmpresa se
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

  const getNombreEmpresa = useCallback((idOrName: string) => {
    if (!idOrName) return '-';
    const found = empresaPorClave.get(idOrName);
    if (found) return found.nombre || found.nombreCorto || idOrName;
    const porCatalogo = mapaCatalogos[String(idOrName)];
    return porCatalogo || idOrName;
  }, [empresaPorClave, mapaCatalogos]);

  const proveedoresFiltradosBuscador = useMemo(() => {
    if (!empresasList.length) return [];
    const esProveedor = (emp: any) => {
      if (!ID_TIPO_PROVEEDOR) return true;
      const tipos = emp?.tiposEmpresa;
      if (Array.isArray(tipos)) return tipos.some((t: any) => String(t).trim() === ID_TIPO_PROVEEDOR);
      if (typeof tipos === 'string') return tipos.includes(ID_TIPO_PROVEEDOR);
      if (tipos && typeof tipos === 'object') return Object.values(tipos).some((v: any) => String(v).trim() === ID_TIPO_PROVEEDOR);
      return false;
    };
    const proveedores = empresasList
      .filter(esProveedor)
      .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }));
    if (!textoBuscarProveedor.trim()) return proveedores.slice(0, 30);
    const q = textoBuscarProveedor.toLowerCase().trim();
    return proveedores.filter((c: any) =>
      String(c.nombre || '').toLowerCase().includes(q) ||
      String(c.rfc || '').toLowerCase().includes(q)
    ).slice(0, 30);
  }, [empresasList, textoBuscarProveedor]);

  const nombreProveedorSeleccionado = useMemo(() => {
    if (!filtroProveedor || !empresasList.length) return filtroProveedor || '';
    const cli = empresasList.find(e => e.id === filtroProveedor);
    return cli?.nombre || filtroProveedor;
  }, [filtroProveedor, empresasList]);

  const opIndex = useMemo(() => {
    const m = new Map<string, { invoice: string; facturaId: string; fecha: string; proveedorId: string; moneda: string }>();
    facturasGlobales.forEach((f: any) => {
      const ids = Array.isArray(f.operacionesIds) ? f.operacionesIds : [];
      ids.forEach((id: any) => {
        const k = String(id || '');
        if (k && !m.has(k)) m.set(k, { invoice: f.invoice, facturaId: f.id, fecha: f.fecha, proveedorId: f.proveedorId, moneda: f.monedaProveedor });
      });
    });
    return m;
  }, [facturasGlobales]);

  const monedaDeProveedor = (provId: any): string => {
    if (!provId) return '';
    const empresa = empresasList.find(e => e.id === provId);
    const idMoneda = empresa?.monedaRef || empresa?.moneda || empresa?.monedaProveedor;
    if (idMoneda === ID_MXN) return 'MXN';
    if (idMoneda === ID_USD) return 'USD';
    return idMoneda ? String(idMoneda) : '';
  };

  const resolverMoneda = (val: any): string => {
    const s = String(val || '').trim();
    if (!s) return '';
    if (s === ID_USD || s.toUpperCase() === 'USD') return 'USD';
    if (s === ID_MXN || s.toUpperCase() === 'MXN') return 'MXN';
    if (s.toUpperCase() === 'N/A') return '';
    const nombre = mapaCatalogos[s];
    return nombre || s;
  };

  const monedaFacturaMostrar = (f: any): string => {
    const propia = resolverMoneda(f.monedaProveedor);
    if (propia) return propia;
    return monedaDeProveedor(f.proveedorId) || 'N/A';
  };

  // ✅ V00481: la moneda de una factura es SIEMPRE la del proveedor en Empresas (null si no tiene).
  const monedaProveedorDe = (provId: unknown): Moneda | null =>
    monedaDeEmpresa(empresasList.find((e) => e.id === provId), 'monedaProveedor', (id) => mapaCatalogos[id]);
  const avisoMonedaDe = (f: { proveedorId?: unknown } | null | undefined): string | null =>
    f ? avisoMonedaDistinta(monedaDeFactura(f), monedaProveedorDe(f.proveedorId), 'proveedor') : null;
  // Folios del mismo proveedor que se sugieren como la factura que reemplaza a una cancelada.
  const foliosDelProveedor = (f: { proveedorId?: unknown; invoice?: unknown } | null | undefined): string[] => {
    const propio = String(f?.invoice || '').trim();
    return Array.from(new Set(facturasGlobales
      .filter((x) => String(x.proveedorId || '') === String(f?.proveedorId || '') && !estaCancelada(x.statusFactura))
      .map((x) => String(x.invoice || '').trim())
      .filter((inv) => inv && inv !== propio))).slice(0, 200);
  };
  // Total que se precarga en Editar Factura: el de la factura; si su moneda no es la del proveedor,
  //   la suma de sus operaciones en la moneda del proveedor (Dólares o Conversión Final).
  const totalEditPara = (f: { operacionesGuardadas?: unknown }, provId: string): number => {
    const actual = r2(totalDeGrupo(f));
    const mon = monedaProveedorDe(provId);
    if (!mon || mon === monedaDeFactura(f)) return actual;
    const sugerido = r2(totalSugeridoEn(mon, f.operacionesGuardadas));
    return sugerido > 0 ? sugerido : actual;
  };

  const esFacturada = (op: any) => opIndex.has(String(op.id)) || !!op.facturaProveedorId || !!op.facturadoProveedor;
  const invoiceDeOp = (op: any): string => op.facturaProveedorFolio || opIndex.get(String(op.id))?.invoice || '';

  const proveedorFacturaId = useMemo(() => {
    if (filtroProveedor) return filtroProveedor;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = provDeOp(op);
      if (c) ids.add(String(c));
    });
    return ids.size === 1 ? [...ids][0] : '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroProveedor, seleccionadas, operacionesGlobales]);

  const seleccionMultiProveedor = useMemo(() => {
    if (filtroProveedor) return false;
    const ids = new Set<string>();
    seleccionadas.forEach(id => {
      const op = operacionesGlobales.find(o => o.id === id);
      const c = provDeOp(op);
      if (c) ids.add(String(c));
    });
    return ids.size > 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroProveedor, seleccionadas, operacionesGlobales]);

  const nombreProveedorFactura = useMemo(() => {
    if (!proveedorFacturaId) return '';
    const porCatalogo = getNombreEmpresa(proveedorFacturaId);
    if (porCatalogo && porCatalogo !== proveedorFacturaId) return porCatalogo;
    const op = operacionesGlobales.find(o => String(provDeOp(o) || '') === proveedorFacturaId);
    return op?.proveedorUnidadNombre || proveedorFacturaId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proveedorFacturaId, empresasList, operacionesGlobales]);

  // ✅ V00481: SIEMPRE la moneda del proveedor en Empresas ('USD' / 'MXN'); sin ella no se factura
  //   (antes caía a la moneda de una operación o a lo que tuviera el campo).
  const monedaProveedor = useMemo((): 'USD' | 'MXN' | '' => {
    if (!proveedorFacturaId) return '';
    return monedaDeEmpresa(empresasList.find(e => e.id === proveedorFacturaId), 'monedaProveedor', (id) => mapaCatalogos[id]) ?? '';
  }, [proveedorFacturaId, empresasList, mapaCatalogos]);

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

  const valorOrdenOp = useCallback((op: any, campo: string): string | number => {
    switch (campo) {
      case 'factura': return String(op.facturaProveedorFolio || '').toLowerCase();
      case 'ref': return refNaturalKey(op);
      case 'fechaServicio': return fechaOrdenKey(op.fechaServicio || op.createdAt);
      case 'proveedor': return getNombreEmpresa(provDeOp(op) || op.proveedorUnidadNombre).toLowerCase();
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
  }, [getNombreEmpresa, columnasOps, resolverNombre]);

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

  const coincideProveedorOp = (op: any) => !filtroProveedor || String(provDeOp(op) || '') === filtroProveedor;

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

  // ✅ Proveedores solo factura a proveedores EXTERNOS: se muestran únicamente las
  //    operaciones de Fletes, y las de Logística cuyo proveedor NO sea Roelca.
  //    (Transfer y Logística-Roelca usan flota propia; no aplican en Proveedores.)
  const esFacturableProveedor = (op: any): boolean => {
    const tipo = String(op?.tipoOperacionNombre || op?.tipoOperacionId || '').toLowerCase();
    const isFletes = tipo.includes('flete');
    const isLogistica = tipo.includes('logistica') || tipo.includes('logística');
    const esRoelca = String(op?.proveedorUnidadNombre || op?.proveedorUnidad || '').toLowerCase().includes('roelca');
    return isFletes || (isLogistica && !esRoelca);
  };

  // ✅ V00126: moneda en la que se factura/paga la operación al proveedor (USD / MXN / '')
  //   ✅ V00439 (Fase 3.x): helper compartido (ID del catálogo, código o nombre).
  const monedaFacturacionOp = (op: any): 'USD' | 'MXN' | '' => {
    const fact = String(op.facturadoEnUnidad || '');
    const nom = String(op.monedaUnidadNombre || '');
    if (monedaCanonicaComun(fact) === 'USD' || monedaCanonicaComun(nom) === 'USD') return 'USD';
    if (monedaCanonicaComun(fact) === 'MXN' || monedaCanonicaComun(nom) === 'MXN') return 'MXN';
    return '';
  };
  const resumenMonedaOps = useMemo(() => {
    const base = operacionesGlobales.filter(op => esFacturableProveedor(op) && dentroRangoFecha(op) && coincideProveedorOp(op) && coincideTipoOp(op) && (vistaOps === 'todas' || (vistaOps === 'facturadas') === esFacturada(op)));
    return { usd: base.filter(op => monedaFacturacionOp(op) === 'USD').length, mxn: base.filter(op => monedaFacturacionOp(op) === 'MXN').length, todas: base.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, fechaDesdeOps, fechaHastaOps, vistaOps, facturasGlobales]);

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
      if (esFacturableProveedor(op) && dentroRangoFecha(op) && coincideProveedorOp(op) && coincideTipoOp(op) && coincideVista(op) && coincideMonedaVista(op) && coincide(op)) indices.push(i);
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
  }, [operacionesGlobales, clavesOrdenOps, ordenOps.dir, fechaDesdeOps, fechaHastaOps, mapaCatalogos, vistaOps, monedaVistaOps, textoBuscarRemolqueOpsDiferido, facturasGlobales, filtroProveedor, filtroTipoOp]);

  const resumenOps = useMemo(() => {
    const enRango = operacionesGlobales.filter(op => esFacturableProveedor(op) && dentroRangoFecha(op) && coincideProveedorOp(op) && coincideTipoOp(op));
    const facturadas = enRango.filter(op => esFacturada(op)).length;
    const total = enRango.length;
    const porFacturar = total - facturadas;
    return { porFacturar, facturadas, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operacionesGlobales, fechaDesdeOps, fechaHastaOps, facturasGlobales, filtroProveedor, filtroTipoOp]);

  const toggleOrdenOps = (campo: string) =>
    setOrdenOps(prev => prev.campo === campo ? { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { campo, dir: 'asc' });
  const flechaOps = (campo: string) => ordenOps.campo === campo ? (ordenOps.dir === 'asc' ? ' ▲' : ' ▼') : '';

  const valorCeldaOps = (op: any, key: string, m: any) => {
    switch (key) {
      case 'factura': { const inv = invoiceDeOp(op); return inv || (esFacturada(op) ? 'Facturada' : 'Por facturar'); }
      case 'ref': return op.numReferencia || op.referencia || op.ref || op.id;
      case 'fechaServicio': return formatearFechaSpanish(op.fechaServicio || op.createdAt);
      case 'proveedor': return getNombreEmpresa(provDeOp(op) || op.proveedorUnidadNombre);
      case 'cartaPorte': return op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-';
      case 'destino': return op.destinoNombre || op.destino || '-';
      case 'moneda': return op.monedaUnidadNombre || mostrarMoneda(op.facturadoEnUnidad);
      case 'subtotal': return m.subtotal;
      case 'total': return m.total;
      case 'dolares': return m.dol;
      case 'pesos': return m.pes;
      case 'conv': return m.conv;
      default: {
        const col = columnasOps.find(c => c.id === key);
        return formatearValorGenericoOp(valorGenericoOp(op, col), col?.tipo);
      }
    }
  };

  const renderCeldaOps = (op: any, key: string, m: any) => {
    const tdBase: React.CSSProperties = { padding: '10px 12px', color: '#c9d1d9', whiteSpace: 'nowrap' }; // ✅ V00482: filas más bajas
    switch (key) {
      case 'factura': {
        const inv = invoiceDeOp(op);
        if (inv) return <td className="fpd-x1" key={key}><span className="fpd-x2">{inv}</span></td>;
        return <td className="fpd-x1" key={key}><span className="fpd-x3">Por facturar</span></td>;
      }
      case 'facturaRoelca': {
        const fc = getFacturaClienteDeOp(op);
        if (fc && (fc.invoice || fc.facturaId)) {
          return <td className="fpd-x1" key={key}>
            <button className="fpd-x4"
              onClick={(e) => { e.stopPropagation(); setFacturaClienteViendo({ ...fc, opRef: op.numReferencia || op.referencia || op.ref || op.id }); }}
              title="Ver dónde fue facturada (Facturación de Clientes)">
              {fc.invoice || 'Facturada'}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            </button>
          </td>;
        }
        return <td className="fpd-x1" key={key}><span className="fpd-x3">No facturada</span></td>;
      }
      case 'ref': return <td className="fpd-x5" key={key}>{op.numReferencia || op.referencia || op.ref || op.id.substring(0, 6)}</td>;
      case 'fechaServicio': return <td key={key} style={tdBase}>{formatearFechaSpanish(op.fechaServicio || op.createdAt)}</td>;
      case 'proveedor': return <td key={key} style={tdBase}>{getNombreEmpresa(provDeOp(op) || op.proveedorUnidadNombre)}</td>;
      case 'cartaPorte': return <td key={key} style={tdBase}>{op.cartaPorte || op.numeroCartaPorte || op.numDoda || '-'}</td>;
      case 'destino': return <td key={key} style={tdBase}>{op.destinoNombre || op.destino || '-'}</td>;
      // ✅ V00481: Pesos en verde y Dólares en azul (antes al revés); subtotal y total en la moneda en que se factura.
      case 'moneda': return <td key={key} style={tdBase}><NombreMoneda moneda={op.monedaUnidadNombre || op.facturadoEnUnidad} respaldo={op.monedaUnidadNombre || mostrarMoneda(op.facturadoEnUnidad)} /></td>;
      case 'subtotal': return <td key={key} style={tdBase}><Importe monto={m.subtotal} moneda={monedaFacturacionOp(op)} /></td>;
      case 'total': return <td key={key} style={tdBase}><Importe monto={m.total} moneda={monedaFacturacionOp(op)} className="fpd-total-op" /></td>;
      case 'dolares': return <td key={key} style={tdBase}><Importe monto={m.dol} moneda="USD" /></td>;
      case 'pesos': return <td key={key} style={tdBase}><Importe monto={m.pes} moneda="MXN" /></td>;
      case 'conv': return <td className="fpd-x6" key={key}><Importe monto={m.conv} moneda="MXN" /></td>;
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

  // ═══════════════════════════════════════════════════════════════════
  // (REMISIÓN) Encabezados por moneda + vista previa editable + PDF.
  // Portado de FacturacionClientesDashboard, adaptado a PROVEEDOR.
  // ═══════════════════════════════════════════════════════════════════
  const [emisorMXN, setEmisorMXN] = useState<EmisorRemision>(EMISOR_MXN_DEFAULT);
  const [emisorUSD, setEmisorUSD] = useState<EmisorRemision>(EMISOR_USD_DEFAULT);
  const [remisionPreview, setRemisionPreview] = useState<any | null>(null);
  const [cargandoRemision, setCargandoRemision] = useState(false);

  // Cargar encabezados (emisores) desde localStorage + Firestore (compartido).
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


  // Preparar la remisión de una factura de PROVEEDOR → abre el modal editable.
  const abrirRemision = async (f: any) => {
    if (!f) return;
    if (!puedeGenerarRemision(f.statusFactura)) { alert(AVISO_REMISION_FACTURADA); return; } // ✅ V00481
    setCargandoRemision(true);
    try {
      // ✅ Fase 1.8 (e): resolverMoneda puede devolver el NOMBRE del catálogo
      //   ('Dólares'/'Dolares'); con === 'USD' una factura en dólares salía con el
      //   emisor de pesos. El helper compartido acepta ID, código o nombre.
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
        const equipoUnidad = txt(o.unidadNombre, o.unidad);
        const equipo = equipoUnidad !== '-' ? equipoUnidad : txt(o.remolqueNombre, o.remolquePlaca, o.numeroRemolque);
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

      const emp: any = empresasList.find(e => e.id === f.proveedorId) || {};

      // ✅ NUEVO: si la factura ya tiene un encabezado de remisión GUARDADO,
      //   ese manda (mismo patrón que la Confirmación de Tarifa).
      const remGuardada = (f.encabezadoRemision && typeof f.encabezadoRemision === 'object') ? f.encabezadoRemision : null;
      const baseRemision = {
        esUSD,
        emisorNombre: emisor.facturaNombre,
        emisorDireccion: emisor.direccion,
        emisorCiudadEstado: emisor.ciudadEstado,
        emisorEmail: emisor.email,
        numero: f.invoice || String(f.id || ''),
        fecha: String(f.fecha || '').slice(0, 10),
        clienteNombre: f.proveedorNombre || getNombreEmpresa(f.proveedorId) || '',
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
      };
      setRemisionPreview(remGuardada
        ? { ...baseRemision, ...remGuardada, facturaId: String(f.id || '') }
        : { ...baseRemision, facturaId: String(f.id || '') });
    } catch (e) {
      console.error('Error preparando la remisión:', e);
      alert('No se pudo preparar la remisión.');
    } finally {
      setCargandoRemision(false);
    }
  };

  // ✅ NUEVO: guarda el Rate de Proveedor EDITADO en la factura, para que los
  //   cambios no se pierdan y todos los usuarios vean lo mismo al abrirlo.
  const guardarRate = async (avisar: boolean = true): Promise<boolean> => {
    if (!ratePreview) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preview del Rate sin tipo canónico.
    const { facturaId, ...campos } = ratePreview as any;
    if (!facturaId) {
      if (avisar) alert('No se encontró la factura a la que pertenece este Rate.');
      return false;
    }
    try {
      await updateDoc(doc(db, 'facturas_proveedores', String(facturaId)), { rateProveedor: campos });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lista de facturas sin tipo canónico.
      setFacturasGlobales(prev => prev.map((x: any) => (String(x.id) === String(facturaId) ? { ...x, rateProveedor: campos } : x)));
      registrarLog('Facturación Proveedores', 'Edición', `Guardó el Rate de Proveedor de la factura ${campos.facturaProveedor || facturaId}.`).catch(() => {});
      if (avisar) alert('Rate de Proveedor guardado. Los demás usuarios verán estos datos al abrirlo.');
      return true;
    } catch (e) {
      console.error('Error guardando el Rate de Proveedor:', e);
      alert('No se pudo guardar el Rate de Proveedor. Inténtalo de nuevo.');
      return false;
    }
  };

  // ✅ NUEVO: guarda el encabezado de la remisión EDITADO en la factura
  //   (facturas_proveedores) para que los cambios no se pierdan y los demás
  //   usuarios vean lo mismo al abrirla. Mismo patrón que la Confirmación.
  const guardarRemision = async (avisar: boolean = true): Promise<boolean> => {
    if (!remisionPreview) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- preview de remisión sin tipo canónico.
    const { facturaId, ...campos } = remisionPreview as any;
    if (!facturaId) {
      if (avisar) alert('No se encontró la factura a la que pertenece esta remisión.');
      return false;
    }
    try {
      await updateDoc(doc(db, 'facturas_proveedores', String(facturaId)), { encabezadoRemision: campos });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lista de facturas sin tipo canónico.
      setFacturasGlobales(prev => prev.map((x: any) => (String(x.id) === String(facturaId) ? { ...x, encabezadoRemision: campos } : x)));
      registrarLog('Facturación Proveedores', 'Edición', `Guardó el encabezado de la Remisión ${campos.numero || facturaId}.`).catch(() => {});
      if (avisar) alert('Encabezado de la remisión guardado. Los demás usuarios verán estos datos al abrirla.');
      return true;
    } catch (e) {
      console.error('Error guardando el encabezado de la remisión:', e);
      alert('No se pudo guardar el encabezado de la remisión. Inténtalo de nuevo.');
      return false;
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

  // ═══════════════════════════════════════════════════════════════════
  // ✅ (CONFIRMACIÓN DE TARIFA) por operación → pestaña "Asignar Operaciones"
  // ✅ (RATE DE PROVEEDOR) por factura → pestaña "Historial de Facturas"
  // Ambos con vista previa editable antes de descargar el PDF (con logo).
  // ═══════════════════════════════════════════════════════════════════
  const [confirmacionPreview, setConfirmacionPreview] = useState<any | null>(null);
  // ✅ NUEVO: modal con el LOG de generación de PDF de la confirmación
  //   (fecha, hora y quién lo generó).
  const [logConfirmacionAbierto, setLogConfirmacionAbierto] = useState(false);
  const [ratePreview, setRatePreview] = useState<any | null>(null);
  const [cargandoRate, setCargandoRate] = useState(false);

  // Nombre del usuario logueado (respaldo si la operación no registra quién la creó).
  const nombreCoordinadorActual = (): string => {
    try {
      const u = getAuth().currentUser;
      return u?.displayName || u?.email || '';
    } catch { return ''; }
  };

  // ✅ V00246: COORDINADOR = quien dio de alta la operación (op.creadoPor),
  //   NO quien genera la confirmación. Se resuelve el id/correo a nombre con
  //   el catálogo de usuarios; si la operación no lo tiene, se usa el actual.
  const [nombresUsuariosConf, setNombresUsuariosConf] = useState<Record<string, string>>({});
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'usuarios'));
        const mapa: Record<string, string> = {};
        snap.docs.forEach((d) => {
          const u = d.data() as any;
          const nombre = String(u.nombre || u.nombreCompleto || u.displayName || '').trim();
          if (!nombre) return;
          mapa[d.id] = nombre;
          if (u.email) mapa[String(u.email).toLowerCase()] = nombre;
          if (u.uid) mapa[String(u.uid)] = nombre;
        });
        setNombresUsuariosConf(mapa);
      } catch { /* si falla, se muestra el valor crudo */ }
    })();
  }, []);

  const coordinadorDeOperacion = (op: any): string => {
    const crudo = String(op?.creadoPor || '').trim();
    if (!crudo) return nombreCoordinadorActual();
    return nombresUsuariosConf[crudo] || nombresUsuariosConf[crudo.toLowerCase()] || crudo;
  };

  // Intenta armar la dirección de una bodega/dirección desde los catálogos cacheados.
  const direccionDeCatalogo = (direcciones: readonly DocCatalogo[], id: unknown): string => {
    if (id === undefined || id === null || id === '') return '';
    // ✅ V00439 (Fase 3.x): 'direcciones' del catálogo compartido (se pide al abrir
    //   la confirmación); los alias bodegas/ubicaciones/clientesBodegas ya no existían.
    const item = direcciones.find((x) => String(x.id) === String(id));
    if (item) {
      const partes = [
        item.direccion || item.domicilio || item.calle,
        item.colonia ? `Col. ${String(item.colonia)}` : '',
        item.cp || item.codigoPostal ? `C.P. ${String(item.cp || item.codigoPostal)}` : '',
        item.ciudad || item.municipio,
        item.estado,
      ].map((p) => String(p || '').trim()).filter(Boolean);
      if (partes.length) return partes.join(', ');
      if (item.label) return String(item.label);
    }
    return '';
  };

  const aTextoMoneda = (v: any): string => {
    const m = String(v || '').toUpperCase();
    if (m === 'USD' || m.includes('DOLAR') || m.includes('DÓLAR')) return 'Dólares';
    if (m === 'MXN' || m.includes('PESO')) return 'Pesos';
    return String(v || '');
  };

  const abrirConfirmacionTarifa = async (e: React.MouseEvent, op: any) => {
    e.stopPropagation();
    const direcciones = await leerParaDocumento(() => obtenerCatalogo('direcciones')); // ✅ V00448
    if (!direcciones) return;
    const m = obtenerMontoOperacion(op);
    const monedaFact = op.monedaUnidadNombre || mostrarMoneda(op.facturadoEnUnidad);
    const monedaConvRaw = mostrarMoneda(op.monedaConvenioProv);
    const monedaConv = monedaConvRaw !== '-' ? monedaConvRaw : monedaFact;
    const limpiar = (v: string) => (v === '-' ? '' : v);
    // ✅ NUEVO: los valores por defecto se calculan igual que siempre, pero si la
    //   operación ya tiene una confirmación GUARDADA (op.confirmacionTarifa), esa
    //   manda: así todos los usuarios ven los mismos datos editados.
    const base = {
      opId: String(op.id || ''),
      coordinador: coordinadorDeOperacion(op), // ✅ V00246
      referencia: refDeOp(op) || op.numReferencia || String(op.id || ''),
      remolque: limpiar(txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque)),
      tipoUnidad: limpiar(txt(op.tipoUnidadNombre, op.tipoUnidad)),
      placasRemolque: limpiar(txt(op.remolquePlaca, op.placasRemolque)),
      unidad: limpiar(txt(op.unidadProveedor, op.unidadNombre, op.unidad)),
      operador: limpiar(txt(op.operadorProveedor, op.operadorNombre, op.operador)),
      fechaServicio: formatearFechaSpanish(op.fechaServicio || op.createdAt),
      tipoCambio: String(op.tipoCambioAprobado || ''),
      proveedor: getNombreEmpresa(provDeOp(op) || op.proveedorUnidadNombre) || '',
      tipoOperacion: limpiar(txt(op.convenioProveedorNombre, op.convenioProveedor, op.convenioNombre, op.convenio)),
      impoExpoMov: limpiar(tipoOpNombre(op)),
      clienteOrigen: limpiar(txt(op.origenNombre, op.origen)),
      ciudadOrigen: direccionDeCatalogo(direcciones, op.origen),
      clienteDestino: limpiar(txt(op.destinoNombre, op.destino)),
      ciudadDestino: direccionDeCatalogo(direcciones, op.destino),
      refCliente: String(op.refCliente || ''),
      facturadoEn: aTextoMoneda(monedaFact),
      monedaConvenio: aTextoMoneda(monedaConv),
      // ✅ MONEDA DE PAGO: por defecto es la moneda de facturación, con lo que
      //   el total inicial (m.conv) coincide con la lógica actual. Al cambiarla
      //   se recalculan los montos a pagar (ver setCTMonto).
      monedaPago: aTextoMoneda(monedaFact),
      convenioProv: String(Number(op.totalAPagarProv) || 0),
      costosAdic: String(Number(op.cargosAdicionalesProv) || 0),
      subtotalProv: String(m.subtotal || 0),
      totalAFacturar: String(m.conv || 0),
      emisorDireccion: 'MAR DE LAS ANTILLAS #947, COL. LA PAZ, C.P. 88290',
      emisorCiudad: 'NUEVO LAREDO, TAMPS',
      // ✅ NUEVO: observaciones (se guardan con la confirmación y salen en el PDF).
      observaciones: '',
    };
    const guardada = (op.confirmacionTarifa && typeof op.confirmacionTarifa === 'object') ? op.confirmacionTarifa : null;
    setLogConfirmacionAbierto(false);
    setConfirmacionPreview(guardada ? { ...base, ...guardada, opId: base.opId } : base);
  };

  // ✅ NUEVO: guarda la confirmación editada en la operación (Firestore) para que
  //   los demás usuarios vean exactamente los mismos datos al abrirla.
  const guardarConfirmacion = async (avisar: boolean = true): Promise<boolean> => {
    if (!confirmacionPreview) return false;
    const { opId, ...campos } = confirmacionPreview as any;
    if (!opId) {
      if (avisar) alert('No se encontró la operación a la que pertenece esta confirmación.');
      return false;
    }
    try {
      await updateDoc(doc(db, 'operaciones', String(opId)), { confirmacionTarifa: campos });
      setOperacionesGlobales(prev => prev.map((o: any) => (String(o.id) === String(opId) ? { ...o, confirmacionTarifa: campos } : o)));
      registrarLog('Facturación Proveedores', 'Edición', `Guardó la Confirmación de Tarifa de ${campos.referencia || opId} (moneda de pago: ${campos.monedaPago || '-'}, total: ${campos.totalAFacturar || '0'})`).catch(() => {});
      if (avisar) alert('Confirmación de tarifa guardada. Los demás usuarios verán estos datos al abrirla.');
      return true;
    } catch (e) {
      console.error('Error guardando la confirmación de tarifa:', e);
      alert('No se pudo guardar la confirmación de tarifa. Inténtalo de nuevo.');
      return false;
    }
  };

  // ✅ NUEVO: LOG de generación del PDF de la confirmación. Guarda fecha, hora
  //   y quién lo generó en la operación (confirmacionTarifaLog) para que todos
  //   los usuarios lo vean en el modal de Log.
  const registrarGeneracionPDFConfirmacion = async () => {
    const opId = String(confirmacionPreview?.opId || '');
    if (!opId) return;
    const ahora = new Date();
    const entrada = {
      ts: ahora.toISOString(),
      fecha: ahora.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      hora: ahora.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      usuario: nombreCoordinadorActual() || 'Desconocido',
    };
    try {
      await updateDoc(doc(db, 'operaciones', opId), { confirmacionTarifaLog: arrayUnion(entrada) });
      setOperacionesGlobales(prev => prev.map((o: any) => (String(o.id) === opId
        ? { ...o, confirmacionTarifaLog: [...(Array.isArray(o.confirmacionTarifaLog) ? o.confirmacionTarifaLog : []), entrada] }
        : o)));
      registrarLog('Facturación Proveedores', 'PDF', `Generó el PDF de la Confirmación de Tarifa de ${confirmacionPreview?.referencia || opId}`).catch(() => {});
    } catch (e) {
      console.error('No se pudo registrar el log de generación del PDF:', e);
    }
  };

  // Entradas del log de la confirmación abierta (más recientes primero).
  const logDeConfirmacionActual = (): any[] => {
    const opId = String(confirmacionPreview?.opId || '');
    const op = operacionesGlobales.find((o: any) => String(o.id) === opId);
    const lista = Array.isArray(op?.confirmacionTarifaLog) ? [...op.confirmacionTarifaLog] : [];
    return lista.sort((a: any, b: any) => String(b?.ts || '').localeCompare(String(a?.ts || '')));
  };

  const generarPDFDeConfirmacion = async () => {
    if (!confirmacionPreview) return;
    // ✅ NUEVO: al generar el PDF también se guarda (sin alerta) — el documento
    //   siempre queda respaldado con lo que se ve en pantalla.
    await guardarConfirmacion(false);
    // ✅ NUEVO: queda registro de fecha, hora y quién generó el PDF.
    await registrarGeneracionPDFConfirmacion();
    const p = confirmacionPreview;
    const data = {
      coordinador: p.coordinador || '',
      referencia: p.referencia || '',
      remolque: p.remolque || '',
      tipoUnidad: p.tipoUnidad || '',
      placasRemolque: p.placasRemolque || '',
      unidad: p.unidad || '',
      operador: p.operador || '',
      fechaServicio: p.fechaServicio || '',
      tipoCambio: p.tipoCambio || '',
      proveedor: p.proveedor || '',
      tipoOperacion: p.tipoOperacion || '',
      impoExpoMov: p.impoExpoMov || '',
      clienteOrigen: p.clienteOrigen || '',
      ciudadOrigen: p.ciudadOrigen || '',
      clienteDestino: p.clienteDestino || '',
      ciudadDestino: p.ciudadDestino || '',
      refCliente: p.refCliente || '',
      facturadoEn: p.facturadoEn || '',
      monedaConvenio: p.monedaConvenio || '',
      convenioProv: p.convenioProv || '0',
      costosAdic: p.costosAdic || '0',
      subtotalProv: p.subtotalProv || '0',
      totalAFacturar: p.totalAFacturar || '0',
      emisorDireccion: p.emisorDireccion || '',
      emisorCiudad: p.emisorCiudad || '',
      // ✅ Moneda de pago (el generador del PDF puede mostrarla junto al total).
      monedaPago: p.monedaPago || '',
      // ✅ NUEVO: observaciones — salen en el PDF.
      observaciones: p.observaciones || '',
    } as ConfirmacionTarifaData;
    generarConfirmacionTarifaPDF(data);
  };

  const setCT = (campo: string, valor: any) => setConfirmacionPreview((prev: any) => prev ? { ...prev, [campo]: valor } : prev);

  // ✅ MONEDA DE PAGO — normaliza cualquier texto de moneda a USD/MXN.
  const claveMoneda = (v: any): '' | 'USD' | 'MXN' => {
    const m = String(v || '').toUpperCase();
    if (m.includes('USD') || m.includes('DOLAR') || m.includes('DÓLAR')) return 'USD';
    if (m.includes('MXN') || m.includes('PESO')) return 'MXN';
    return '';
  };
  const redondear2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

  // ✅ Recalcula SUBTOTAL y TOTAL A PAGAR según la MONEDA DE PAGO, manteniendo
  //   la lógica de la moneda de facturación (que sigue siendo el default):
  //   · subtotal (en moneda del convenio) = convenio prov. + costos adicionales.
  //   · pago == convenio            → total = subtotal (sin conversión).
  //   · convenio USD → pago Pesos   → total = subtotal × tipo de cambio.
  //   · convenio Pesos → pago USD   → total = subtotal ÷ tipo de cambio.
  //   Se dispara al cambiar: moneda de pago, moneda del convenio, convenio,
  //   costos adicionales o tipo de cambio. El subtotal y el total siguen
  //   siendo editables a mano por si se necesita forzar un monto.
  const setCTMonto = (campo: string, valor: any) => {
    setConfirmacionPreview((prev: any) => {
      if (!prev) return prev;
      const p: any = { ...prev, [campo]: valor };
      const subtotal = (Number(p.convenioProv) || 0) + (Number(p.costosAdic) || 0);
      const tc = Number(p.tipoCambio) || 0;
      const mConv = claveMoneda(p.monedaConvenio);
      const mPago = claveMoneda(p.monedaPago) || claveMoneda(p.facturadoEn);
      let total = subtotal;
      if (mConv && mPago && mConv !== mPago) {
        if (mConv === 'USD' && mPago === 'MXN') total = subtotal * tc;
        else if (mConv === 'MXN' && mPago === 'USD') total = tc > 0 ? subtotal / tc : subtotal;
      }
      p.subtotalProv = String(redondear2(subtotal));
      p.totalAFacturar = String(redondear2(total));
      return p;
    });
  };

  // Fecha (YYYY-MM-DD o similar) + N días → DD/MM/YYYY.
  const sumarDiasAFecha = (fechaISO: any, dias: number): string => {
    const d = new Date(String(fechaISO || '').slice(0, 10) + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + (Number(dias) || 0));
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  };
  const fechaDDMMYYYY = (fechaISO: any): string => sumarDiasAFecha(fechaISO, 0);

  const abrirRate = async (f: any) => {
    if (!f) return;
    setCargandoRate(true);
    try {
      const ids = (Array.from(new Set((f.operacionesIds || []).map((x: any) => String(x)))) as string[]).filter(Boolean); // ✅ V00443 (Fase 7.10): todas (antes solo las primeras 60)
      const byId = new Map<string, any>();
      // ✅ V00443 (Fase 7.8): tandas de 30 EN PARALELO (antes una tras otra).
      const tandas: string[][] = [];
      for (let i = 0; i < ids.length; i += 30) tandas.push(ids.slice(i, i + 30));
      await Promise.all(tandas.map(async (chunk) => {
        try {
          const snap = await getDocs(query(collection(db, 'operaciones'), where(documentId(), 'in', chunk)));
          snap.docs.forEach(d => byId.set(d.id, { id: d.id, ...(d.data() as any) }));
        } catch (e) { console.warn('No se pudieron leer operaciones para el rate:', e); }
      }));

      const guardadas: any[] = Array.isArray(f.operacionesGuardadas) && f.operacionesGuardadas.length
        ? f.operacionesGuardadas
        : ids.map((id) => ({ id }));

      // TC sugerido: primer tipoCambioAprobado > 0 entre las operaciones de la factura.
      // ✅ CORREGIDO: se calcula ANTES de armar las filas para poder usarlo como
      //   respaldo al convertir a pesos las operaciones que no traen TC propio.
      let tcSugerido = 0;
      guardadas.forEach((g: any) => {
        const o = byId.get(String(g.id)) || {};
        const tcOp0 = Number(o.tipoCambioAprobado) || 0;
        if (!tcSugerido && tcOp0 > 0) tcSugerido = tcOp0;
      });
      // ✅ Fase 1.8 (e): helper compartido; con === 'USD' el nombre del catálogo ('Dólares') contaba como pesos.
      const monedaFacturaEsUsd = esMonedaUSD(monedaFacturaMostrar(f));

      const filas = guardadas.map((g: any) => {
        const o = byId.get(String(g.id)) || {};
        const equipoUnidad = txt(o.unidadProveedor, o.unidadNombre, o.unidad);
        const equipo = equipoUnidad !== '-' ? equipoUnidad : txt(o.remolqueNombre, o.remolquePlaca, o.numeroRemolque);
        const m = o.id ? obtenerMontoOperacion(o) : { subtotal: 0, dol: 0, pes: 0, conv: 0 };
        const tcOp = Number(o.tipoCambioAprobado) || tcSugerido || 0;
        // ✅ CORREGIDO (v5): el Rate coloca lo que esté en "Conversión Proveedor
        //   (MXN)" de la operación (m.conv) — pero si detecta el caso del bug
        //   (convenio del proveedor en dólares o con la moneda vacía, pagado en
        //   Pesos, y la conversión guardada igual al subtotal sin convertir), la
        //   recalcula aquí con subtotal × TC, igual que el lado del cliente.
        const montoFactura = Number(g.monto) || 0;
        const nombreMonProv = String(o.monedaUnidadNombre || '').toUpperCase();
        const convUProv = o.monedaConvenioProv === ID_USD;
        const convMProv = o.monedaConvenioProv === ID_MXN;
        const factUProv = o.facturadoEnUnidad === ID_USD || nombreMonProv.includes('USD') || nombreMonProv.includes('DOLAR') || nombreMonProv.includes('DÓLAR');
        const factMProv = o.facturadoEnUnidad === ID_MXN || nombreMonProv.includes('MXN') || nombreMonProv.includes('PESO');
        const convenioProvUsdEfectivo = convUProv || (!convMProv && (factUProv || !o.monedaConvenioProv));
        // ✅ FIX MONTOS EN CERO: si la operación no trae montos guardados, se
        //   usa m.subtotal (obtenerMontoOperacion ya cae a la Confirmación de
        //   Tarifa guardada) — así el Rate muestra lo mismo que la tabla.
        const subtotalProvOp = Number(o.subtotalProv) || ((Number(o.totalAPagarProv) || 0) + (Number(o.cargosAdicionalesProv) || 0)) || (Number(m.subtotal) || 0);
        const provQuedoSinConvertir = convenioProvUsdEfectivo && factMProv && tcOp > 0 && subtotalProvOp > 0 && Math.abs((m.conv || 0) - subtotalProvOp) < 0.01;
        const proveedorMonto = provQuedoSinConvertir
          ? subtotalProvOp * tcOp
          : ((m.conv || 0) > 0
              ? m.conv
              : (montoFactura > 0
                  ? (monedaFacturaEsUsd && tcOp > 0 ? montoFactura * tcOp : montoFactura)
                  : (((Number(m.pes) || 0) + ((Number(m.dol) || 0) * (tcOp > 0 ? tcOp : 0))) || 0)));
        // ✅ CORREGIDO (v4): el Rate coloca lo que esté en "Conversión Cliente
        //   (MXN)" de la operación. Solo si ese campo quedó SIN convertir (el bug
        //   de la moneda del convenio vacía: convenio en dólares facturado en
        //   pesos, guardado igual al subtotal) o en 0, se recalcula aquí con la
        //   misma fórmula del formulario: subtotal × TC si el convenio es USD.
        const nombreMonCli = String(o.monedaCobroNombre || '').toUpperCase();
        const convU = o.monedaConvenioCliente === ID_USD;
        const convM = o.monedaConvenioCliente === ID_MXN;
        const monConvVacia = !o.monedaConvenioCliente;
        const factU = o.facturadoEnCobrar === ID_USD || nombreMonCli.includes('USD') || nombreMonCli.includes('DOLAR') || nombreMonCli.includes('DÓLAR');
        const factM = o.facturadoEnCobrar === ID_MXN || nombreMonCli.includes('MXN') || nombreMonCli.includes('PESO');
        // Con la moneda del convenio vacía se asume USD (el estándar de los convenios).
        const convenioUsdEfectivo = convU || (!convM && (factU || monConvVacia));
        const subtotalCli = Number(o.subtotalCliente) || ((Number(o.montoConvenioCliente) || 0) + (Number(o.cargosAdicionales) || 0));
        const dolCli = Number(o.dolaresCliente) || 0;
        const pesCli = Number(o.pesosCliente) || 0;
        const ingresoCliente = Number(o.conversionCliente) || 0;
        const quedoSinConvertir = convenioUsdEfectivo && factM && tcOp > 0 && subtotalCli > 0 && Math.abs(ingresoCliente - subtotalCli) < 0.01;
        let cobrado = ingresoCliente;
        if (ingresoCliente <= 0 || quedoSinConvertir) {
          if (subtotalCli > 0) {
            cobrado = convenioUsdEfectivo ? subtotalCli * tcOp : subtotalCli;
          } else if (dolCli > 0 || pesCli > 0) {
            cobrado = dolCli > 0 && tcOp > 0 ? pesCli + dolCli * tcOp : (pesCli || ingresoCliente);
          }
        }
        const fc = o.id ? getFacturaClienteDeOp(o) : null;
        const org = txt(o.origenNombre, o.origen);
        const dst = txt(o.destinoNombre, o.destino);
        const desc = txt(o.convenioProveedorNombre, o.convenioProveedor, o.convenioNombre, o.convenio);
        return {
          ref: refDeOp({ ...g, ...o }) || o.numReferencia || g.ref || '',
          equipo: equipo === '-' ? '' : equipo,
          origen: org === '-' ? '' : org,
          destino: dst === '-' ? '' : dst,
          descripcion: desc === '-' ? (o.descripcionServicio || o.observacionesEjecutivo || '') : desc,
          facturaRoelca: (fc && fc.invoice) ? String(fc.invoice) : '',
          cobrado,
          subtotalProv: Number(subtotalProvOp.toFixed(2)),
          provEnUsd: convenioProvUsdEfectivo,
          proveedor: proveedorMonto,
        };
      });

      const emp: any = empresasList.find(e => e.id === f.proveedorId) || {};
      const dias = String(emp.diasCredito ?? emp.credito ?? emp.diasDeCredito ?? '');
      // ✅ NUEVO: si la factura ya tiene un Rate GUARDADO, ese manda (mismo
      //   patrón que la Confirmación de Tarifa y la Remisión).
      const rateGuardado = (f.rateProveedor && typeof f.rateProveedor === 'object') ? f.rateProveedor : null;
      const baseRate = {
        fecha: fechaDDMMYYYY(f.fecha) || fechaDDMMYYYY(new Date().toISOString()),
        facturaProveedor: f.invoice || String(f.id || ''),
        proveedorNombre: f.proveedorNombre || getNombreEmpresa(f.proveedorId) || '',
        diasCredito: dias,
        vencimiento: sumarDiasAFecha(f.fecha, Number(dias) || 0),
        direccion: String(emp.direccion ?? emp.domicilio ?? emp.calle ?? ''),
        colonia: String(emp.colonia ?? ''),
        ciudad: String(emp.ciudad ?? emp.municipio ?? ''),
        moneda: monedaFacturaEsUsd ? 'DÓLARES' : 'PESOS', // ✅ Fase 1.8 (e)
        tipoCambio: tcSugerido > 0 ? String(tcSugerido) : '',
        observaciones: '',
        filas,
      };
      setRatePreview(rateGuardado
        ? { ...baseRate, ...rateGuardado, facturaId: String(f.id || '') }
        : { ...baseRate, facturaId: String(f.id || '') });
    } catch (e) {
      console.error('Error preparando el rate de proveedor:', e);
      alert('No se pudo preparar el Rate de Proveedor.');
    } finally {
      setCargandoRate(false);
    }
  };

  const generarPDFDeRate = () => {
    if (!ratePreview) return;
    const data = {
      fecha: ratePreview.fecha || '',
      facturaProveedor: ratePreview.facturaProveedor || '',
      proveedorNombre: ratePreview.proveedorNombre || '',
      diasCredito: ratePreview.diasCredito || '',
      vencimiento: ratePreview.vencimiento || '',
      direccion: ratePreview.direccion || '',
      colonia: ratePreview.colonia || '',
      ciudad: ratePreview.ciudad || '',
      moneda: ratePreview.moneda || 'PESOS',
      tipoCambio: ratePreview.tipoCambio || '',
      observaciones: ratePreview.observaciones || '',
      filas: (ratePreview.filas || []).map((r: any) => ({
        ref: r.ref || '',
        equipo: r.equipo || '',
        origen: r.origen || '',
        destino: r.destino || '',
        descripcion: r.descripcion || '',
        facturaRoelca: r.facturaRoelca || '',
        cobrado: Number(r.cobrado) || 0,
        subtotalProv: Number(r.subtotalProv) || 0,
        proveedor: Number(r.proveedor) || 0,
      })),
    } as RateProveedorData;
    generarRateProveedorPDF(data);
  };

  const setRT = (campo: string, valor: any) => setRatePreview((prev: any) => prev ? { ...prev, [campo]: valor } : prev);
  const setRTFila = (idx: number, campo: string, valor: any) =>
    setRatePreview((prev: any) => {
      if (!prev) return prev;
      const filas = [...(prev.filas || [])];
      filas[idx] = { ...filas[idx], [campo]: valor };
      // Al editar el SUBTOTAL del proveedor, la CONVERSIÓN se recalcula: si el
      // convenio es en dólares se multiplica por el TC vigente; si es en pesos
      // se toma tal cual.
      if (campo === 'subtotalProv') {
        const tc = Number(prev.tipoCambio) || 0;
        const base = Number(valor) || 0;
        if (base > 0) {
          const enUsd = !!filas[idx]?.provEnUsd;
          filas[idx] = { ...filas[idx], proveedor: Number(((enUsd && tc > 0) ? base * tc : base).toFixed(2)) };
        }
      }
      return { ...prev, filas };
    });
  // Cambiar el TIPO DE CAMBIO recalcula la CONVERSIÓN de TODAS las filas cuyo
  // convenio del proveedor es en dólares; las filas en pesos quedan tal cual.
  const setTipoCambioRate = (valor: string) =>
    setRatePreview((prev: any) => {
      if (!prev) return prev;
      const tc = Number(valor) || 0;
      const filas = (prev.filas || []).map((r: any) => {
        const base = Number(r.subtotalProv) || 0;
        return (base > 0 && r.provEnUsd && tc > 0) ? { ...r, proveedor: Number((base * tc).toFixed(2)) } : r;
      });
      return { ...prev, tipoCambio: valor, filas };
    });
  const quitarFilaRate = (idx: number) =>
    setRatePreview((prev: any) => {
      if (!prev) return prev;
      const filas = (prev.filas || []).filter((_: any, i: number) => i !== idx);
      return { ...prev, filas };
    });

  // Estilos reutilizables de los modales de remisión.
  const rInputStyle: React.CSSProperties = { width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.85rem', boxSizing: 'border-box' };
  const rLabelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.72rem', display: 'block', marginBottom: '4px', fontWeight: 'bold' };
  const rCellStyle: React.CSSProperties = { padding: '6px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '4px', color: '#c9d1d9', fontSize: '0.8rem', width: '100%', boxSizing: 'border-box' };

  // Exportación a Excel PROFESIONAL (con logo, igual que Clientes).
  const exportarExcelOps = async () => {
    if (operacionesMostradas.length === 0) return alert('No hay operaciones para exportar con los filtros actuales.');
    const cols = columnasOps.filter(c => c.visible);
    if (cols.length === 0) return alert('Selecciona al menos una columna para exportar.');

    const mapTipo = (t: any): 'texto' | 'fecha' | 'fechaHora' | 'monto' | 'numero' =>
      (t === 'monto' || t === 'numero' || t === 'fecha' || t === 'fechaHora') ? t : 'texto';
    const aNum = (v: any): number | null => {
      const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, ''));
      return isNaN(n) ? null : n;
    };

    const columnas = cols.map(c => ({
      key: c.id,
      label: c.label,
      tipo: mapTipo((c as any).tipo),
      soloCaja: /remolque/i.test(c.label || ''),
    }));

    const filas = operacionesMostradas.map(op => {
      const m = obtenerMontoOperacion(op);
      const fila: any = {};
      cols.forEach(c => {
        const raw = valorCeldaOps(op, c.id, m);
        const t = mapTipo((c as any).tipo);
        fila[c.id] = (t === 'monto' || t === 'numero') ? aNum(raw) : raw;
      });
      return fila;
    });

    const provTxt = filtroProveedor ? (nombreProveedorSeleccionado || 'Proveedor') : 'Todos los proveedores';
    const rangoTxt = (fechaDesdeOps || fechaHastaOps) ? `${fechaDesdeOps || 'inicio'} a ${fechaHastaOps || 'hoy'}` : 'Todas las fechas';
    const vistaTxt = vistaOps === 'facturadas' ? 'Facturadas' : vistaOps === 'todas' ? 'Todas' : 'Por facturar';
    const provFile = provTxt.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 30);

    try {
      await exportarExcelProfesional({
        nombreArchivo: `Facturacion_Proveedores_${vistaTxt}_${provFile}_${hoyLocalISO()}.xlsx`,
        tituloReporte: 'Reporte de Facturación · Operaciones (Proveedores)',
        subtitulo: `${vistaTxt}  ·  Proveedor: ${provTxt}  ·  ${rangoTxt}  ·  ${filas.length} operaciones`,
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
      const nuevoCargos = (Number(op.cargosAdicionalesProv) || 0) + monto;
      const { subtotal, dol, pes, conv } = calcularConversionProveedor({ ...op, cargosAdicionalesProv: nuevoCargos });
      const concepto = costoAdicConcepto.trim();
      const updates: any = {
        cargosAdicionalesProv: nuevoCargos,
        subtotalProv: subtotal,
        dolaresProv: dol,
        pesosProv: pes,
        conversionProv: conv,
      };
      if (concepto) {
        const obsPrev = String(op.observacionesUnidad || '').trim();
        updates.observacionesUnidad = `${obsPrev ? obsPrev + ' | ' : ''}Costo adicional: ${concepto} (${monto >= 0 ? '+' : ''}${monto})`;
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
  // ✅ V00481: lo que se va a facturar EN LA MONEDA DEL PROVEEDOR: Dólares → Dólares;
  //   Pesos → Conversión Final (la misma regla del total de la factura).
  const totalSeleccionEnMoneda = useMemo(() => {
    const renglones = seleccionadas.map((id) => operacionesGlobales.find((o) => o.id === id)).filter(Boolean).map((op) => {
      const m = obtenerMontoOperacion(op);
      return { monto: m.conv, dol: m.dol, pes: m.pes, subtotalBase: m.subtotal };
    });
    return monedaProveedor ? totalNativoDeOperaciones(monedaProveedor, renglones) : 0; // la misma regla con que se guarda el total
  }, [seleccionadas, operacionesGlobales, monedaProveedor]);

  // ✅ Fase 1.8: la factura FRESCA del servidor (facturasGlobales puede tener
  //   hasta 30 min), con la misma forma que la lista. null si ya no existe.
  const leerFacturaFresca = async (id: string) => {
    const snap = await getDoc(doc(db, 'facturas_proveedores', String(id)));
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
    const claves = ['invoice', 'fecha', 'facturaCcp', 'statusFactura', 'monedaProveedor', 'proveedorId', 'proveedorNombre',
      'subtotalFactura', 'subtotalMonedaFactura', 'saldoPendiente', 'statusPago', 'totalManualCentavos', 'updatedAt'];
    return Object.fromEntries(claves.filter((k) => k in f).map((k) => [k, f[k]]));
  };

  const handleGuardarFactura = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceForm.trim()) return alert('El # de Invoice es obligatorio.');
    // ✅ V00451: sin operaciones no se crea nada (antes, tras refrescar la lista, se podía crear una factura vacía).
    if (seleccionadas.length === 0) return alert('Selecciona al menos una operación para facturar.');
    if (seleccionMultiProveedor || !proveedorFacturaId) {
      return alert('Las operaciones seleccionadas deben ser de un mismo proveedor. Selecciona un proveedor en el filtro o elige operaciones de un solo proveedor.');
    }
    // ✅ Fase 1.8: 1 escritura por operación + la factura; avisar antes de que falle el commit.
    if (seleccionadas.length + 1 > MAX_ESCRITURAS_LOTE) return alert(avisoLoteGrande(seleccionadas.length + 1));
    // ✅ V00481: la moneda es la del proveedor en Empresas y es obligatoria.
    if (monedaProveedor !== 'USD' && monedaProveedor !== 'MXN') return alert(avisoSinMoneda('proveedor'));
    if (estaCancelada(statusFacturaForm)) return alert('Una factura nueva no se crea Cancelada: se cancela después desde su ficha.');
    // ✅ V00279: el documento NO es obligatorio para facturar — sin adjunto se
    //   factura directo y la fila queda con ⚠ como recordatorio visual.
    setGuardando(true);
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, factura el SERVIDOR (transacción).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('facturarOperaciones', {
          lado: 'proveedor', empresaId: proveedorFacturaId, empresaNombre: nombreProveedorFactura || getNombreEmpresa(proveedorFacturaId),
          invoice: invoiceForm.trim(), fecha: fechaForm, facturaCcp: facturaCcpForm.trim(), statusFactura: statusFacturaForm,
          moneda: monedaProveedor === 'USD' || monedaProveedor === 'MXN' ? monedaProveedor : '', operacionesIds: seleccionadas,
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
      const nuevoId = doc(collection(db, 'facturas_proveedores')).id;
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
          convenioNombre: String((op?.convenioProvNombre || op?.convenioProveedorNombre || op?.convenioNombre) || ''), // ✅ NUEVO: convenio revisable
          remolque: op ? txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque) : '',
        };
      });
      // ✅ FIX MONEDA: total en la moneda de la factura (no la conversión).
      // ✅ FIX: el total en la moneda de la factura depende de EN QUÉ se
      //   factura, no de la moneda del convenio: USD -> suma de dólares;
      //   MXN -> suma de la conversión (dólares × TC + pesos directos).
      const subtotalMonedaFactura = totalNativoFactura({
        monedaProveedor,
        operacionesGuardadas: operacionesResumenEstable,
      });
      const remolquesFactura = Array.from(new Set(
        operacionesResumenEstable.map((o: any) => String(o.remolque || '')).filter(r => r && r !== '-')
      ));
      const monedaIdFactura = monedaProveedor === 'MXN' ? ID_MXN : (monedaProveedor === 'USD' ? ID_USD : '');
      const operacionesRefs = operacionesResumenEstable.map((o: any) => o.ref).filter(Boolean);
      const data = {
        invoice: invoiceForm.trim(),
        fecha: fechaForm,
        facturaCcp: facturaCcpForm.trim(),
        statusFactura: statusFacturaForm,
        proveedorId: proveedorFacturaId,
        proveedorNombre: nombreProveedorFactura || getNombreEmpresa(proveedorFacturaId),
        monedaProveedor,
        monedaId: monedaIdFactura,                 // ← campo de la colección
        operacionesIds: seleccionadas,
        operaciones: operacionesRefs,              // ← campo de la colección (refs)
        operacionesGuardadas: operacionesResumenEstable,
        remolques: remolquesFactura,
        subtotalFactura: r2(resumenSeleccion.subtotal),
        subtotalMonedaFactura, // ✅ FIX MONEDA
        createdAt: new Date().toISOString(),
      };
      const invKey = invoiceForm.trim().toLowerCase();
      const coincideInvoice = (f: { invoice?: unknown; proveedorId?: unknown }) =>
        String(f.invoice || '').trim().toLowerCase() === invKey &&
        String(f.proveedorId || '') === String(proveedorFacturaId);
      const existenteCache = facturasGlobales.find(coincideInvoice);
      // ✅ Fase 1.8: se fusiona contra la factura FRESCA (sus operacionesIds /
      //   operacionesGuardadas actuales), no contra la copia en memoria.
      const fresca = existenteCache ? await leerFacturaFresca(existenteCache.id) : null;
      // ✅ V00451: si no está en la lista cargada se busca en el SERVIDOR (antes se creaba otra
      //   factura con el mismo folio y el documento quedaba escondido en esa segunda).
      const existente = fresca && coincideInvoice(fresca) ? fresca : await facturaExistenteFresca('proveedor', invoiceForm, String(proveedorFacturaId));
      // ✅ V00451: ninguna operación puede estar ya facturada según el SERVIDOR.
      const yaFacturadas = await operacionesYaFacturadas('proveedor', seleccionadas
        .map((id) => operacionesGlobales.find((o) => String(o.id) === String(id)))
        .filter((o): o is Record<string, unknown> => !!o)
        .map((op) => ({ idLista: String(op.id), idReal: String(op._docId ?? op.id), ref: String(op.ref ?? op.numReferencia ?? op.id ?? '') })),
        existente ? String(existente.id) : undefined);
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
        const monedaMerge = existente.monedaProveedor || monedaProveedor;
        // ✅ Fase 1.8: subtotalMonedaFactura se recalcula con TODAS las operaciones
        //   de la factura (antes se quedaba con el total anterior al merge).
        const totales = totalesTrasCambioDeOps({ ...existente, monedaProveedor: monedaMerge }, guardadasUnion);
        if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
        const merge = {
          invoice: existente.invoice || invoiceForm.trim(),
          facturaCcp: facturaCcpForm.trim() || existente.facturaCcp || '',
          statusFactura: statusFacturaForm || existente.statusFactura || 'Facturado',
          proveedorId: proveedorFacturaId,
          proveedorNombre: existente.proveedorNombre || data.proveedorNombre,
          monedaProveedor: monedaMerge,
          monedaId: existente.monedaId || monedaIdFactura,
          operacionesIds: idsUnion,
          operaciones: guardadasUnion.map((o: any) => o.ref).filter(Boolean),
          operacionesGuardadas: guardadasUnion,
          remolques: remolquesUnion,
          ...totales.campos, // subtotalFactura + subtotalMonedaFactura (+ saldo si ya tiene pagos)
          updatedAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_proveedores', docId), merge, { merge: true });
        facturaResultante = { ...existente, ...merge };
      } else {
        batch.set(doc(db, 'facturas_proveedores', docId), data);
      }
      seleccionadas.forEach(id => {
        batch.update(doc(db, 'operaciones', idRealOp(id)), { // ✅ V00451: id real
          facturaProveedorId: docId,
          facturaProveedorFolio: invoiceForm.trim(),
          facturadoProveedor: true,
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
        idsFacturadas.includes(op.id) ? { ...op, facturaProveedorId: docId, facturaProveedorFolio: invoiceTrim, facturadoProveedor: true } : op
      ));
      avisarOpsFacturacion(idsFacturadas, { facturaProveedorId: docId, facturaProveedorFolio: invoiceTrim, facturadoProveedor: true }); // ✅ V00451
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
      await escribirEnGrupo('facturas_proveedores', ids, { statusFactura: nuevoStatus, ...canc.firestore });
      setFacturasGlobales(prev => prev.map(f => ids.includes(f.id) ? canc.local({ ...f, statusFactura: nuevoStatus }) : f));
      setFacturaViendo((prev: any) => (prev && (ids.includes(prev.id) || prev.id === factura.id)) ? canc.local({ ...prev, statusFactura: nuevoStatus }) : prev);
      void registrarLog('Facturación Proveedores', 'Edición', cancelacion
        ? `Canceló la factura ${factura.invoice}: la reemplaza ${cancelacion.reemplazo.trim()}. Nota: ${cancelacion.nota.trim()}`
        : `Cambió el status de la factura ${factura.invoice} a ${nuevoStatus}.`);
    } catch (e) {
      console.error('Error actualizando status de factura:', e);
      if (cancelacion) throw new Error('No se pudo cancelar la factura. Revisa la conexión e intenta de nuevo.');
      alert('No se pudo actualizar el status de la factura.');
    }
  };

  const abrirEditarFactura = (e: React.MouseEvent, f: any) => {
    setAdjuntosEdicion(desdeGuardados(docsDeFactura(f))); // ✅ V00451: los documentos actuales (de todo el grupo)
    e.stopPropagation();
    setFacturaEditando(f);
    setEditInvoice(String(f.invoice || ''));
    setEditFecha(String(f.fecha || '').slice(0, 10));
    setEditCcp(String(f.facturaCcp || ''));
    setEditStatus(String(f.statusFactura || 'Facturado'));
    const cancelada = cancelacionDe(f); // ✅ V00481
    setEditCancelacion(cancelada ? { nota: cancelada.nota, reemplazo: cancelada.reemplazo } : CANCELACION_VACIA);
    // ✅ V00441: con la bandera, el total EN LA MONEDA de la factura (el que se ve en la
    //   tabla y el que guarda el servidor); antes se precargaba la conversión a pesos.
    // ✅ V00451: el total EN LA MONEDA de la factura también sin la bandera (antes, la conversión).
    // ✅ V00481: si la factura no está en la moneda del proveedor, el total sugerido ya es el de esa moneda.
    setEditTotal(String(totalEditPara(f, String(f.proveedorId || ''))));
    setEditProveedorId(String(f.proveedorId || '')); // ✅ NUEVO
  };

  const handleGuardarEdicionFactura = async () => {
    if (!facturaEditando) return;
    if (!editInvoice.trim()) return alert('El # de Invoice es obligatorio.');
    // ✅ V00481: la moneda es la del proveedor (Empresas) y es obligatoria; cancelar pide nota y reemplazo.
    const monedaEdit = monedaProveedorDe(editProveedorId);
    if (!monedaEdit) return alert(editProveedorId ? avisoSinMoneda('proveedor') : 'Elige el proveedor de la factura: la moneda es la del proveedor en Empresas.');
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
        if (cancelando) await escribirEnGrupo('facturas_proveedores', ids, canc.firestore);
        const r = await llamarDinero('editarFactura', {
          lado: 'proveedor', origen: 'facturacion', facturaIds: ids, invoice: editInvoice.trim(), fecha: editFecha || '', facturaCcp: editCcp.trim(),
          statusFactura: editStatus, moneda: monedaEdit, total: totalNum, ...(editProveedorId ? { empresaId: editProveedorId } : {}),
        });
        if (!cancelando) await escribirEnGrupo('facturas_proveedores', ids, canc.firestore);
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura).map((f) => (ids.includes(f.id) ? canc.local(f) : f)));
        const primera = r.facturas[ids[0]];
        if (primera) setFacturaViendo((prev: Record<string, unknown> | null) => (prev && ids.includes(String(prev.id))) ? canc.local({ ...prev, ...camposEditadosFactura(primera) }) : prev);
        if (!canc.vacia) void registrarLog('Facturación Proveedores', 'Edición', cancelando ? `Canceló la factura ${editInvoice.trim()}: la reemplaza ${editCancelacion.reemplazo.trim()}. Nota: ${editCancelacion.nota.trim()}` : `La factura ${editInvoice.trim()} dejó de estar Cancelada (${editStatus}).`);
        await guardarDocsDeEdicion(facturaEditando); // ✅ V00451
        setFacturaEditando(null);
        return;
      }
      const baseUpdate: any = {
        invoice: editInvoice.trim(),
        fecha: editFecha || '',
        facturaCcp: editCcp.trim(),
        statusFactura: editStatus,
        monedaProveedor: monedaEdit, // ✅ V00481: la del proveedor
        updatedAt: new Date().toISOString(),
      };
      // ✅ NUEVO — REASIGNAR PROVEEDOR (se refleja también en Pagos).
      if (editProveedorId) {
        const prov: any = empresasList.find((e: any) => e.id === editProveedorId);
        if (prov) { baseUpdate.proveedorId = editProveedorId; baseUpdate.proveedorNombre = String(prov.nombre || ''); }
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
      // ✅ V00451: el total solo se escribe si se CAMBIÓ, marcado como capturado a mano.
      const totalCambio = Math.abs(totalNum - r2(totalDeGrupo(facturaEditando))) > 0.009;

      const batch = writeBatch(db);
      ids.forEach((id, idx) => {
        batch.set(doc(db, 'facturas_proveedores', id), {
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
      if (!canc.vacia) void registrarLog('Facturación Proveedores', 'Edición', cancelando ? `Canceló la factura ${editInvoice.trim()}: la reemplaza ${editCancelacion.reemplazo.trim()}. Nota: ${editCancelacion.nota.trim()}` : `La factura ${editInvoice.trim()} dejó de estar Cancelada (${editStatus}).`);
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
      remolque: txt(op.remolqueNombre, op.remolquePlaca, op.numeroRemolque),
    };
  };

  // ✅ V00451: avisa a los demás módulos abiertos que la operación cambió de factura (operación
  //   COMPLETA: el bus de Facturación saca de su lista las que no traen un status facturable).
  const avisarOpsFacturacion = (ids: readonly string[], cambios: Record<string, unknown>) => {
    ids.forEach((id) => {
      const op = operacionesGlobales.find((o) => String(o.id) === String(id));
      if (op) notificarOperacionGuardada(String(id), { ...op, ...cambios }, 'facturacion-proveedores', Object.keys(cambios));
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
        const r = await llamarDinero('quitarOperacionFactura', { lado: 'proveedor', operacionId: opId, permitirBorrarFactura: true });
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura));
        setOperacionesGlobales(prev => aplicarOperaciones(prev, r.operaciones));
        setGestionOp(null);
        return;
      }
      const facturasConOp = await facturasFrescasConOp(opId, op.facturaProveedorId); // ✅ Fase 1.8
      const batch = writeBatch(db);
      const cambios: any[] = [];
      for (const f of facturasConOp) {
        const ids = (f.operacionesIds || []).map(String).filter((id: string) => id !== opId);
        const guardadas = (f.operacionesGuardadas || []).filter((o: any) => String(o.id) !== opId);
        if (ids.length === 0) {
          // ✅ Fase 1.8 (c): quitar la última operación BORRA la factura.
          if (tienePagosAplicados(f)) return alert(`La operación ${refTxt} es la única de la factura ${f.invoice}, que se eliminaría.\n\n${avisoFacturaConPagos(formatoMoneda(montoPagadoDe(f)))}`);
          batch.delete(doc(db, 'facturas_proveedores', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          // ✅ Fase 1.8 (d): subtotalMonedaFactura recalculado con las operaciones restantes.
          const totales = totalesTrasCambioDeOps(f, guardadas);
          if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), ...totales.campos, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_proveedores', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }
      // ✅ V00451: los archivos de un documento que se borra pasan al otro documento del mismo folio.
      (await rescatarDocsDeBorradas('proveedores', facturasConOp.filter((f: { id?: unknown }) => cambios.some((c) => c.tipo === 'delete' && c.id === f.id)), facturasGlobales, batch))
        .forEach((e) => cambios.push({ tipo: 'update', id: e.id, data: e.campos }));
      batch.update(doc(db, 'operaciones', idRealOp(opId)), { facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false } : o));
      avisarOpsFacturacion([opId], { facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false }); // ✅ V00451
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
    const provId = String(provDeOp(op) || '');
    setGuardandoGestionOp(true);
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, lo hace el servidor (transacción).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('moverOperacionFactura', { lado: 'proveedor', operacionId: opId, nuevoInvoice });
        setFacturasGlobales(prev => aplicarFacturas(prev, r.facturas, normalizarFactura));
        setOperacionesGlobales(prev => aplicarOperaciones(prev, r.operaciones));
        setGestionOp(null);
        return;
      }
      const facturasConOp = await facturasFrescasConOp(opId, op.facturaProveedorId); // ✅ Fase 1.8
      // ✅ V00448: si ya está en una factura con ese folio, no hay nada que mover (antes la
      // sacaba y creaba otra factura con el mismo folio).
      const yaEsDelFolio = (f: { invoice?: unknown; proveedorId?: unknown }) =>
        String(f.invoice || '').trim().toLowerCase() === nuevoInvoice.toLowerCase() && String(f.proveedorId || '') === provId;
      if (facturasConOp.length > 0 && facturasConOp.every(yaEsDelFolio)) { setGestionOp(null); return; }
      const batch = writeBatch(db);
      const cambios: any[] = [];

      let resumenOrigen: any = null;
      let metaCarry: any = null;
      for (const f of facturasConOp) {
        if (!metaCarry) metaCarry = { statusFactura: f.statusFactura, monedaProveedor: f.monedaProveedor, facturaCcp: f.facturaCcp, fecha: f.fecha, proveedorNombre: f.proveedorNombre };
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
          batch.delete(doc(db, 'facturas_proveedores', f.id));
          cambios.push({ tipo: 'delete', id: f.id });
        } else {
          const totales = totalesTrasCambioDeOps(f, guardadas); // ✅ Fase 1.8 (d)
          if (!totales.ok) return alert(avisoTotalBajoPagado(formatoMoneda(totales.total), formatoMoneda(totales.pagado)));
          const data = { operacionesIds: ids, operacionesGuardadas: guardadas, remolques: remolquesDeGuardadas(guardadas), ...totales.campos, updatedAt: new Date().toISOString() };
          batch.set(doc(db, 'facturas_proveedores', f.id), data, { merge: true });
          cambios.push({ tipo: 'update', id: f.id, data });
        }
      }

      // ✅ V00451: los archivos de un documento de origen que se borra pasan al otro documento de su folio.
      (await rescatarDocsDeBorradas('proveedores', facturasConOp.filter((f: { id?: unknown }) => cambios.some((c) => c.tipo === 'delete' && c.id === f.id)), facturasGlobales, batch))
        .forEach((e) => cambios.push({ tipo: 'update', id: e.id, data: e.campos }));
      const esDestino = (f: { id?: unknown; invoice?: unknown; proveedorId?: unknown }) =>
        String(f.invoice || '').trim().toLowerCase() === nuevoInvoice.toLowerCase() &&
        String(f.proveedorId || '') === provId &&
        !facturasConOp.some(fc => fc.id === f.id);
      // ✅ Fase 1.8: la factura destino se fusiona FRESCA, no desde la lista en memoria.
      const targetCache = facturasGlobales.find(esDestino);
      const targetFresca = targetCache ? await leerFacturaFresca(targetCache.id) : null;
      // ✅ V00451: si el folio destino no está en la lista cargada se busca en el SERVIDOR (antes se
      //   creaba otro documento con el mismo folio).
      const targetServidor = targetFresca && esDestino(targetFresca) ? null : await facturaExistenteFresca('proveedor', nuevoInvoice, provId);
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
        batch.set(doc(db, 'facturas_proveedores', targetId), data, { merge: true });
        cambios.push({ tipo: 'update', id: targetId, data });
      } else {
        targetId = doc(collection(db, 'facturas_proveedores')).id;
        const data: any = {
          invoice: nuevoInvoice,
          fecha: metaCarry?.fecha || '',
          facturaCcp: metaCarry?.facturaCcp || '',
          statusFactura: metaCarry?.statusFactura || 'Facturado',
          proveedorId: provId,
          proveedorNombre: metaCarry?.proveedorNombre || getNombreEmpresa(provId),
          monedaProveedor: metaCarry?.monedaProveedor || 'N/A',
          operacionesIds: [opId],
          operacionesGuardadas: [resumenOrigen],
          remolques: remolquesDeGuardadas([resumenOrigen]),
          subtotalFactura: r2(montoOp),
          subtotalMonedaFactura: totalNativoDeOperaciones(metaCarry?.monedaProveedor, [resumenOrigen]), // ✅ Fase 1.8 (d)
          createdAt: new Date().toISOString(),
        };
        batch.set(doc(db, 'facturas_proveedores', targetId), data);
        cambios.push({ tipo: 'create', id: targetId, data });
      }

      batch.update(doc(db, 'operaciones', idRealOp(opId)), { facturaProveedorId: targetId, facturaProveedorFolio: nuevoInvoice, facturadoProveedor: true });
      await batch.commit();
      aplicarCambiosFacturas(cambios);
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaProveedorId: targetId, facturaProveedorFolio: nuevoInvoice, facturadoProveedor: true } : o));
      avisarOpsFacturacion([opId], { facturaProveedorId: targetId, facturaProveedorFolio: nuevoInvoice, facturadoProveedor: true }); // ✅ V00451
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
    const opId = String(op.id);
    const rawId = (Array.isArray(facturaGrupo.__groupIds) && facturaGrupo.__groupIds.length) ? facturaGrupo.__groupIds[0] : facturaGrupo.id;
    const resumen = buildResumenOp(op);
    const monto = Number(resumen.monto) || 0;
    setAgregandoRef(true);
    try {
      // ✅ V00441 (Fase 5.4): con la bandera, lo hace el servidor (transacción).
      if (flags.dineroPorServidor) {
        const r = await llamarDinero('agregarOperacionFactura', { lado: 'proveedor', facturaId: rawId, operacionId: opId });
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
      const yaEnOtra = await operacionesYaFacturadas('proveedor', [{ idLista: opId, idReal: idRealOp(opId), ref: String(op.ref ?? op.numReferencia ?? opId) }], rawId);
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
      batch.set(doc(db, 'facturas_proveedores', rawId), data, { merge: true });
      batch.update(doc(db, 'operaciones', idRealOp(opId)), { facturaProveedorId: rawId, facturaProveedorFolio: rawDoc.invoice || facturaGrupo.invoice, facturadoProveedor: true });
      await batch.commit();
      setFacturasGlobales(prev => prev.map(f => f.id === rawId ? normalizarFactura({ ...f, ...data }) : f));
      setOperacionesGlobales(prev => prev.map(o => o.id === opId ? { ...o, facturaProveedorId: rawId, facturaProveedorFolio: rawDoc.invoice || facturaGrupo.invoice, facturadoProveedor: true } : o));
      avisarOpsFacturacion([opId], { facturaProveedorId: rawId, facturaProveedorFolio: rawDoc.invoice || facturaGrupo.invoice, facturadoProveedor: true }); // ✅ V00451
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
    const provId = String(agregarRefFactura.proveedorId || '');
    const q = busquedaRefPendiente.trim().toLowerCase();
    const lista = operacionesGlobales.filter(op => {
      if (esFacturada(op)) return false;
      if (provId && String(provDeOp(op) || '') !== provId) return false;
      if (!q) return true;
      const campos = [op.numReferencia, op.referencia, op.ref, op.remolqueNombre, op.remolquePlaca, op.numeroRemolque];
      return campos.some(v => String(v ?? '').toLowerCase().includes(q));
    });
    return lista.slice(0, 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agregarRefFactura, operacionesGlobales, busquedaRefPendiente, facturasGlobales]);

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
          const r = await llamarDinero('eliminarFactura', { lado: 'proveedor', facturaIds: ids });
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
        // Las operaciones a liberar salen de la versión fresca de cada factura.
        const idsLiberadas: string[] = Array.from(new Set(frescas.flatMap(f => (f ? (f.operacionesIds || []).map(String) : []))));
        const escrituras = ids.length + idsLiberadas.length;
        if (escrituras > MAX_ESCRITURAS_LOTE) return alert(avisoLoteGrande(escrituras, 'Quita primero algunas operaciones de la factura y vuelve a intentar.'));
        const batch = writeBatch(db);
        ids.forEach(fid => batch.delete(doc(db, 'facturas_proveedores', fid)));
        idsLiberadas.forEach(opId => {
          batch.update(doc(db, 'operaciones', idRealOp(opId)), { // ✅ V00451: id real
            facturaProveedorId: null,
            facturaProveedorFolio: null,
            facturadoProveedor: false,
          });
        });
        await batch.commit();
        setFacturasGlobales(prev => prev.filter(f => !ids.includes(f.id)));
        setOperacionesGlobales(prev => prev.map(op =>
          idsLiberadas.includes(op.id) ? { ...op, facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false } : op
        ));
        avisarOpsFacturacion(idsLiberadas, { facturaProveedorId: null, facturaProveedorFolio: null, facturadoProveedor: false }); // ✅ V00451
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
      case 'proveedor': return String(f.proveedorNombre || '').toLowerCase();
      case 'moneda': return String(f.monedaProveedor || '').toLowerCase();
      case 'cantOps': return Number(f.operacionesIds?.length || 0);
      case 'total': return totalDeGrupo(f); // ✅ FIX MONEDA · V00448 · V00451: fila agrupada
      case 'createdAt': return String(f.createdAt || '');
      default: return '';
    }
  };

  const historialOrdenado = useMemo(() => {
    const dir = ordenFac.dir === 'asc' ? 1 : -1;
    const q = textoBuscarFacturaDiferido.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.proveedorNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.proveedorId) { const nom = getNombreEmpresa(f.proveedorId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaProveedor || '').toLowerCase().includes(q)) return true;
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
    const coincideProveedor = (f: any) => !filtroProveedor || String(f.proveedorId || '') === filtroProveedor;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const filtradas = facturasGlobales.filter(f => coincideTexto(f) && coincideProveedor(f) && coincideFechas(f));
    const grupos = new Map<string, any>();
    for (const f of filtradas) {
      const key = `${String(f.invoice || f.id).trim().toLowerCase()}__${String(f.proveedorId || '')}`;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, ordenFac, textoBuscarFacturaDiferido, filtroProveedor, fechaDesdeHist, fechaHastaHist, opInfoMap, filtroStatusFactura, activeTab, pagosPorFactura]);

  const resumenHistorial = useMemo(() => {
    let totalUSD = 0, totalMXN = 0, totalSinMoneda = 0, totalOps = 0;
    historialOrdenado.forEach(f => {
      const monto = totalDeGrupo(f); // ✅ FIX MONEDA · V00448 · V00451: fila agrupada
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
    return { cuenta: historialOrdenado.length, totalUSD, totalMXN, totalSinMoneda, totalOps };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historialOrdenado, totalDeGrupo]);

  const conteoStatus = useMemo(() => {
    const q = textoBuscarFacturaDiferido.trim().toLowerCase();
    const coincideTexto = (f: any) => {
      if (!q) return true;
      if (String(f.invoice || '').toLowerCase().includes(q)) return true;
      if (String(f.proveedorNombre || '').toLowerCase().includes(q)) return true;
      if (String(f.statusFactura || '').toLowerCase().includes(q)) return true;
      if (f.proveedorId) { const nom = getNombreEmpresa(f.proveedorId); if (nom && nom.toLowerCase().includes(q)) return true; }
      if (String(f.facturaCcp || '').toLowerCase().includes(q)) return true;
      if (String(f.monedaProveedor || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(f.remolques) && f.remolques.some((r: any) => String(r || '').toLowerCase().includes(q))) return true;
      return false;
    };
    const coincideProveedor = (f: any) => !filtroProveedor || String(f.proveedorId || '') === filtroProveedor;
    const coincideFechas = (f: any) => {
      if (!fechaDesdeHist && !fechaHastaHist) return true;
      const fc = String(f.fecha || '').slice(0, 10);
      if (!fc) return false;
      if (fechaDesdeHist && fc < fechaDesdeHist) return false;
      if (fechaHastaHist && fc > fechaHastaHist) return false;
      return true;
    };
    const base = facturasGlobales.filter(f => coincideTexto(f) && coincideProveedor(f) && coincideFechas(f));
    const c = { Todos: base.length } as Record<string, number>;
    base.forEach((f: any) => {
      const s = (String(f.statusFactura || 'Facturado').trim()) || 'Facturado';
      c[s] = (c[s] || 0) + 1;
    });
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facturasGlobales, textoBuscarFacturaDiferido, filtroProveedor, fechaDesdeHist, fechaHastaHist]);

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
            moneda: o.monedaUnidadNombre || mostrarMoneda(o.facturadoEnUnidad),
            proveedorId: provDeOp(o) || '',
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

  // ✅ V00260: resuelve TODAS las referencias del conjunto a exportar (el
  //   opInfoMap normal solo cubre las filas visibles, tope 150 — por eso el
  //   Excel salía con IDs en vez de referencias).
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
            moneda: o.monedaUnidadNombre || mostrarMoneda(o.facturadoEnUnidad),
            proveedorId: provDeOp(o) || '',
          };
        });
      } catch (e) { console.warn('No se pudo resolver lote de operaciones para exportar:', e); }
      })()));
    }
    if (Object.keys(nuevos).length) setOpInfoMap(prev => ({ ...prev, ...nuevos }));
    return nuevos;
  };

  const irPaginaSiguiente = () => setPaginaActual(p => Math.min(p + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(p => Math.max(p - 1, 1));
  useEffect(() => { setPaginaActual(1); }, [filtroProveedor, ordenFac, fechaDesdeHist, fechaHastaHist, textoBuscarFactura, filtroStatusFactura]);
  useEffect(() => { setPaginaOps(1); }, [filtroProveedor, ordenOps, fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, vistaOps, operacionesGlobales, filtroTipoOp]);

  const nombreProveedorFactura_ = (f: any): string => {
    if (f.proveedorNombre) return f.proveedorNombre;
    if (f.proveedor) return f.proveedor;
    if (f.proveedorId) {
      const nom = getNombreEmpresa(f.proveedorId);
      if (nom && nom !== f.proveedorId) return nom;
    }
    return '-';
  };

  const valorCeldaFactura = (f: any, colId: string, extra?: Record<string, any>): any => {
    switch (colId) {
      case 'statusFactura': return f.statusFactura || 'Facturado';
      case 'invoice': return f.invoice || '';
      case 'fecha': return formatearFechaSpanish(f.fecha);
      case 'proveedor': return nombreProveedorFactura_(f);
      case 'numeroPago': return numerosPagoDe(f).join(', ');
      case 'moneda': return monedaFacturaMostrar(f);
      case 'facturaCcp': return f.facturaCcp || '-';
      case 'cantOps': return f.operacionesIds?.length || 0;
      case 'referencias':
        return Array.isArray(f.operacionesGuardadas)
          ? f.operacionesGuardadas.map((op: any) => refDeOpCon(op, extra)).filter(Boolean).join(', ') // ✅ V00260
          : '-';
      case 'total': return totalDeGrupo(f); // ✅ FIX MONEDA · V00448 · V00451: fila agrupada
      case 'createdAt': return f.createdAt ? formatearFechaHora(f.createdAt) : '-';
      default: return '-';
    }
  };

  const renderCeldaFactura = (f: any, colId: string) => {
    switch (colId) {
      case 'statusFactura': return chipStatusFactura(f.statusFactura);
      case 'invoice': return <span className="fpd-x7">{f.invoice}</span>;
      case 'fecha': return <span className="fpd-x8">{formatearFechaSpanish(f.fecha)}</span>;
      case 'proveedor': return <span className="fpd-x9">{nombreProveedorFactura_(f)}</span>;
      case 'numeroPago': { const nums = numerosPagoDe(f); return nums.length ? <span className="fac-chips-pago">{nums.map(n => <span key={n} className="fac-chip-pago" title="Número de pago aplicado">{n}</span>)}</span> : <span className="fac-sin-pago">—</span>; }
      case 'moneda': { const mon = monedaFacturaMostrar(f); return <NombreMoneda moneda={mon} respaldo={mon} />; } // ✅ V00481
      case 'facturaCcp': return <span className="fpd-x8">{f.facturaCcp || '-'}</span>;
      case 'cantOps': return <span className="fpd-x10">{f.operacionesIds?.length || 0}</span>;
      case 'referencias': {
        const ops: any[] = Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : [];
        if (ops.length === 0) return <span className="fpd-x10">-</span>;
        return (
          <div className="fpd-x11">
            {ops.slice(0, 3).map((op: any, idx: number) => (
              <button className="fpd-x12"
                key={`${f.id}_ref_${op?.id || idx}`}
                onClick={(e) => { e.stopPropagation(); if (op?.id) setOpEditandoId(String(op.id)); }} /* ✅ V00274: abre el EDITOR de la operación */
                title="Editar esta operación en el formulario de Operaciones">
                {refDeOp(op)}
              </button>
            ))}
            {ops.length > 3 && (/* ✅ V00482: el resto en la ficha */
              <button type="button" className="fpd-mas-refs" onClick={(e) => { e.stopPropagation(); setFacturaViendo(f); }} title="Ver todas en la ficha">+{ops.length - 3}</button>
            )}
          </div>
        );
      }
      case 'total': return <Importe monto={totalDeGrupo(f)} moneda={monedaFacturaMostrar(f)} className="fpd-x13" />; // ✅ V00481
      case 'createdAt': return <span className="fpd-x10">{f.createdAt ? formatearFechaHora(f.createdAt) : '-'}</span>;
      default: return '-';
    }
  };

  const [exportandoExcelHist, setExportandoExcelHist] = useState(false); // ✅ V00261
  const exportarCSV = async () => {
    if (exportandoExcelHist) return;
    if (historialOrdenado.length === 0) return alert('No hay datos para exportar.');
    const columnasVisibles = columnasFactura.filter(c => c.visible);
    if (columnasVisibles.length === 0) return alert('Selecciona al menos una columna para exportar.');
    setExportandoExcelHist(true);
    try { // ✅ V00261: cualquier fallo avisa en vez de quedarse callado
      // ✅ V00260: resolver las referencias de TODO el historial antes de exportar.
      const mapaExport = await resolverOpsParaExport(historialOrdenado);
      const datosExcel = historialOrdenado.map(f => {
        const fila: any = {};
        columnasVisibles.forEach(col => { fila[col.label] = valorCeldaFactura(f, col.id, mapaExport); });
        return fila;
      });
      const worksheet = XLSX.utils.json_to_sheet(datosExcel);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Facturas_Proveedores');
      XLSX.writeFile(workbook, `Facturas_Proveedores_${hoyLocalISO()}.xlsx`);
    } catch (e) { // ✅ V00261
      console.error('Error exportando Excel de facturas:', e);
      alert('No se pudo generar el Excel (falló la resolución de referencias). Intenta de nuevo.');
    } finally {
      setExportandoExcelHist(false); // ✅ V00261
    }
  };

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

  const BuscadorProveedor = () => (
    <div className="fpd-x14">
      <label className="fpd-x15">PROVEEDOR (opcional)</label>
      {filtroProveedor ? (
        <div className="fpd-x16">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          <span className="fpd-x17">{nombreProveedorSeleccionado}</span>
          <button className="fpd-x18" onClick={() => { setFiltroProveedor(''); setTextoBuscarProveedor(''); setMostrarSugerenciasProveedor(false); setSeleccionadas([]); }} title="Quitar proveedor">✕</button>
        </div>
      ) : (
        <div className="fpd-x19">
          <svg className="fpd-x20" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input className="fpd-x21" type="text" placeholder="Buscar proveedor por nombre o RFC (opcional)..." value={textoBuscarProveedor}
            onChange={(e) => { setTextoBuscarProveedor(e.target.value); setMostrarSugerenciasProveedor(true); }}
            onFocus={() => setMostrarSugerenciasProveedor(true)} onBlur={() => setTimeout(() => setMostrarSugerenciasProveedor(false), 180)} />
        </div>
      )}
      {!filtroProveedor && mostrarSugerenciasProveedor && (
        <div className="fpd-x22">
          {proveedoresFiltradosBuscador.length === 0 ? (
            <div className="fpd-x23">{textoBuscarProveedor.trim() ? 'Sin coincidencias' : 'No hay proveedores cargados'}</div>
          ) : (
            <>
              <div className="fpd-x24">{proveedoresFiltradosBuscador.length} {proveedoresFiltradosBuscador.length === 1 ? 'proveedor' : 'proveedores'}{textoBuscarProveedor.trim() ? '' : ' (primeros 30)'}</div>
              {proveedoresFiltradosBuscador.map((cli: any) => (
                <div className="fpd-x25" key={cli.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setFiltroProveedor(cli.id); setTextoBuscarProveedor(''); setMostrarSugerenciasProveedor(false); setSeleccionadas([]); }}
                  onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = '#21262d'} onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}>
                  <div className="fpd-x26">{cli.nombre || cli.id}</div>
                  {cli.rfc && <div className="fpd-x27">{cli.rfc}</div>}
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
    ? [fechaDesdeOps, fechaHastaOps, textoBuscarRemolqueOps, filtroTipoOp, filtroProveedor].filter(Boolean).length
    : [textoBuscarFactura, fechaDesdeHist, fechaHastaHist, filtroProveedor].filter(Boolean).length;
  const limpiarFiltros = () => {
    if (activeTab === 'operaciones') { setFechaDesdeOps(''); setFechaHastaOps(''); setTextoBuscarRemolqueOps(''); setFiltroTipoOp(''); }
    else { setTextoBuscarFactura(''); setFechaDesdeHist(''); setFechaHastaHist(''); }
    setFiltroProveedor(''); setTextoBuscarProveedor('');
  };

  return (
    <div className="module-container fpd-x28">
      {/* ✅ V00451: "Documentos de la factura" (píldora de la fila y tarjeta de la Ficha) */}
      {docsFacturaDe && (
        <DocumentosFacturaModal lado="proveedores" fila={docsFacturaDe} onGuardado={aplicarDocsLocal} onCerrar={() => setDocsFacturaDe(null)} />
      )}
      {hiloFacturaId && <HiloModal tipo="proveedor" facturaId={hiloFacturaId} onClose={() => setHiloFacturaId(null)} onEditarOperacion={(id) => setOpEditandoId(id)} />}
      {corrigiendoFacturas && (
        <CorregirFacturasModal lado="proveedor" facturas={facturasGlobales} conServidor={flags.dineroPorServidor}
          monedaDe={monedaProveedorDe} nombreDe={(id, f) => { const n = getNombreEmpresa(id); return n && n !== id && n !== '-' ? n : String(f.proveedorNombre || id || ''); }}
          onCorregidas={(cambios) => setFacturasGlobales(prev => prev.map(f => (cambios[f.id] ? normalizarFactura({ ...f, ...cambios[f.id] }) : f)))}
          onCerrar={() => setCorrigiendoFacturas(false)} />
      )}{/* ✅ V00482 */}
      {cancelarDe && (
        <ModalCancelarFactura invoice={String(cancelarDe.invoice || '')} sugerencias={foliosDelProveedor(cancelarDe)}
          onVolver={() => setCancelarDe(null)}
          onConfirmar={async (datos) => { await handleCambiarStatusFactura(cancelarDe, 'Cancelado', datos); setCancelarDe(null); }} />
      )}{/* ✅ V00481 */}
      {opEditandoId && (
        <EditorOperacionEmbebido operacionId={opEditandoId} operacion={operacionesGlobales.find((o: any) => String(o.id) === opEditandoId)} onClose={() => setOpEditandoId(null)} />
      )}
      <h1 className="fpd-x29">Facturación de Proveedores</h1>

      <div className="fpd-x30">
        <button onClick={() => setActiveTab('operaciones')} style={tabStyle(activeTab === 'operaciones')}>Asignar Operaciones</button>
        <button onClick={() => setActiveTab('historial')} style={tabStyle(activeTab === 'historial')}>Historial de Facturas</button>
        {/* ✅ V00126: facturas liquidadas con su # de pago */}
        <button onClick={() => setActiveTab('pagadas')} style={tabStyle(activeTab === 'pagadas')}>Pagadas</button>
      </div>

      <div className="fpd-x31">
        <button onClick={() => setFiltrosAbiertos(true)} title="Mostrar filtros"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 16px', backgroundColor: '#161b22', border: `1px solid ${filtrosActivos > 0 ? '#D84315' : '#30363d'}`, borderRadius: '8px', color: '#c9d1d9', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.88rem' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
          Filtros
          {filtrosActivos > 0 && <span className="fpd-x32">{filtrosActivos}</span>}
        </button>
        {filtrosActivos > 0 && (
          <button onClick={() => { limpiarFiltros(); if (activeTab === 'operaciones') setBusquedaOpsHecha(false); else setBusquedaHistHecha(false); }} style={{ ...btnDirStyle, color: '#8b949e' }} title="Quitar todos los filtros">✕ Limpiar filtros</button>
        )}
        {activeTab === 'operaciones' && filtroTipoOp && (
          <span className="fpd-x33">
            {filtroTipoOp}
            <button className="fpd-x34" onClick={() => setFiltroTipoOp('')}>✕</button>
          </span>
        )}
        {filtroProveedor && (
          <span className="fpd-x35">
            {nombreProveedorSeleccionado}
            <button className="fpd-x36" onClick={() => { setFiltroProveedor(''); setTextoBuscarProveedor(''); }}>✕</button>
          </span>
        )}
        {/* ✅ V00482: buscar y acciones del historial en esta misma fila (antes, un panel aparte) */}
        {esHistorial && (
          <AccionesHistorial
            buscar={{ valor: textoBuscarFactura, onCambiar: setTextoBuscarFactura, placeholder: 'Buscar: factura, proveedor, referencia, remolque…' }}
            onCorregir={() => setCorrigiendoFacturas(true)} corregirDeshabilitado={cargandoFacturas || facturasGlobales.length === 0}
            onColumnas={() => setModalColumnas(true)} onExportar={exportarCSV} exportando={exportandoExcelHist}
          />
        )}
      </div>

      {filtrosAbiertos && (
        <div className="fpd-x37" onClick={() => setFiltrosAbiertos(false)}>
          <div className="fpd-x38" onClick={(e) => e.stopPropagation()}>
            <div className="fpd-x39">
              <h3 className="fpd-x40">Filtros · {activeTab === 'operaciones' ? 'Operaciones' : 'Historial'}</h3>
              <button className="fpd-x41" onClick={() => setFiltrosAbiertos(false)}>✕</button>
            </div>

            {activeTab === 'operaciones' ? (
              <>
                <div className="fpd-x42">
                  <label className="fpd-x43"># REMOLQUE / REFERENCIA (opcional)</label>
                  <div className="fpd-x19">
                    <svg className="fpd-x44" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="fpd-x45" type="text" placeholder="Buscar por # remolque o referencia..." value={textoBuscarRemolqueOps}
                      onChange={(e) => setTextoBuscarRemolqueOps(e.target.value)} />
                    {textoBuscarRemolqueOps && (
                      <button className="fpd-x46" onClick={() => setTextoBuscarRemolqueOps('')} title="Limpiar">✕</button>
                    )}
                  </div>
                </div>
                <div className="fpd-x42">
                  <label className="fpd-x47">TIPO DE OPERACIÓN (opcional)</label>
                  <select value={filtroTipoOp} onChange={(e) => setFiltroTipoOp(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: `1px solid ${filtroTipoOp ? '#a371f7' : '#30363d'}`, borderRadius: '6px', color: filtroTipoOp ? '#a371f7' : '#c9d1d9', fontSize: '0.9rem', fontWeight: filtroTipoOp ? 'bold' : 'normal', boxSizing: 'border-box' }}>
                    <option value="">Todos los tipos ({tiposOperacionDisponibles.length})</option>
                    {tiposOperacionDisponibles.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {tiposOperacionDisponibles.length === 0 && (
                    <span className="fpd-x48">Carga las operaciones para ver los tipos disponibles.</span>
                  )}
                </div>
                <div className="fpd-x49">
                  <div className="fpd-x50">
                    <label className="fpd-x43">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeOps} onChange={(e) => setFechaDesdeOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="fpd-x50">
                    <label className="fpd-x43">FECHA HASTA</label>
                    <input type="date" value={fechaHastaOps} onChange={(e) => setFechaHastaOps(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeOps || fechaHastaOps) && (
                  <button onClick={() => { setFechaDesdeOps(''); setFechaHastaOps(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                <div className="fpd-x42">
                  <label className="fpd-x51">VISTA</label>
                  <div className="fpd-x52">
                    <button onClick={() => { setVistaOps('pendientes'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'pendientes', '#f59e0b'), flex: 1 }}>Pendientes ({resumenOps.porFacturar})</button>
                    <button onClick={() => { setVistaOps('facturadas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'facturadas', '#10b981'), flex: 1 }}>Facturadas ({flags.consultasCanonicas && !facturadasCargadas ? '…' : resumenOps.facturadas})</button>
                    <button onClick={() => { setVistaOps('todas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(vistaOps === 'todas', '#58a6ff'), flex: 1 }}>Todas ({resumenOps.total})</button>
                  </div>
                </div>
                {/* ✅ V00126: pestañas por MONEDA de facturación */}
                <div className="fpd-x42">
                  <label className="fpd-x51">MONEDA</label>
                  <div className="fpd-x52">
                    <button onClick={() => { setMonedaVistaOps('USD'); setSeleccionadas([]); }} style={{ ...segBtnStyle(monedaVistaOps === 'USD', '#58a6ff'), flex: 1 }}>Dólares ({resumenMonedaOps.usd})</button>
                    <button onClick={() => { setMonedaVistaOps('MXN'); setSeleccionadas([]); }} style={{ ...segBtnStyle(monedaVistaOps === 'MXN', '#3fb950'), flex: 1 }}>Pesos ({resumenMonedaOps.mxn})</button>
                    <button onClick={() => { setMonedaVistaOps('todas'); setSeleccionadas([]); }} style={{ ...segBtnStyle(monedaVistaOps === 'todas', '#8b949e'), flex: 1 }}>Todas ({resumenMonedaOps.todas})</button>
                  </div>
                </div>
                <div className="fpd-x42">
                  <label className="fpd-x43">ORDENAR POR</label>
                  <div className="fpd-x53">
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
                {BuscadorProveedor()}
                <div className="fpd-x54">
                  Por defecto se muestran <b className="fpd-x10">todas</b> las operaciones completadas. El rango de fechas y el proveedor son <b className="fpd-x10">opcionales</b> para acotar.
                </div>
              </>
            ) : (
              <>
                <div className="fpd-x42">
                  <label className="fpd-x55">BUSCAR EN HISTORIAL</label>
                  <div className="fpd-x19">
                    <svg className="fpd-x44" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                    <input className="fpd-x21" type="text" placeholder="Factura, proveedor, status, referencia o # remolque..." value={textoBuscarFactura} onChange={(e) => setTextoBuscarFactura(e.target.value)} />
                    {textoBuscarFactura && (
                      <button className="fpd-x46" onClick={() => setTextoBuscarFactura('')} title="Limpiar búsqueda">✕</button>
                    )}
                  </div>
                </div>
                <div className="fpd-x49">
                  <div className="fpd-x50">
                    <label className="fpd-x43">FECHA DESDE</label>
                    <input type="date" value={fechaDesdeHist} onChange={(e) => setFechaDesdeHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                  <div className="fpd-x50">
                    <label className="fpd-x43">FECHA HASTA</label>
                    <input type="date" value={fechaHastaHist} onChange={(e) => setFechaHastaHist(e.target.value)} style={{ ...dateInputStyle, width: '100%', boxSizing: 'border-box' }} />
                  </div>
                </div>
                {(fechaDesdeHist || fechaHastaHist) && (
                  <button onClick={() => { setFechaDesdeHist(''); setFechaHastaHist(''); }} style={{ ...btnDirStyle, color: '#8b949e', alignSelf: 'flex-start' }} title="Quitar filtro de fechas">✕ Limpiar fechas</button>
                )}
                <div className="fpd-x42">
                  <label className="fpd-x43">STATUS DE FACTURA</label>
                  <div className="fpd-x56">
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
                <div className="fpd-x42">
                  <label className="fpd-x43">ORDENAR POR</label>
                  <div className="fpd-x53">
                    <select value={ordenFac.campo} onChange={(e) => setOrdenFac(prev => ({ ...prev, campo: e.target.value }))} style={{ ...selectOrdenStyle, flex: 1 }}>
                <option value="statusFactura">Status</option>
                <option value="invoice">Factura</option>
                <option value="fecha">Fecha</option>
                <option value="proveedor">Proveedor</option>
                <option value="moneda">Moneda</option>
                <option value="cantOps">Cant. Ops</option>
                <option value="total">Total</option>
                    </select>
                    <button onClick={() => setOrdenFac(prev => ({ ...prev, dir: prev.dir === 'asc' ? 'desc' : 'asc' }))} style={btnDirStyle} title="Cambiar dirección">
                      {ordenFac.dir === 'asc' ? '▲ Asc' : '▼ Desc'}
                    </button>
                  </div>
                </div>
                {BuscadorProveedor()}
                <div className="fpd-x54">
                  Por defecto se muestran <b className="fpd-x10">todas</b> las facturas (sin filtro de fechas). Las facturas importadas sin fecha se ocultan al filtrar por fecha.
                </div>
              </>
            )}

            <div className="fpd-x57">
              <button className="fpd-x58" onClick={() => { limpiarFiltros(); if (activeTab === 'operaciones') setBusquedaOpsHecha(false); else setBusquedaHistHecha(false); }}>Limpiar</button>
              <button className="fpd-x59" onClick={() => { if (activeTab === 'operaciones') setBusquedaOpsHecha(true); else setBusquedaHistHecha(true); setFiltrosAbiertos(false); }}>Buscar</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'operaciones' ? (
        <div className="animation-fade-in">
          <div className="fpd-x60">
            <div className="fpd-x61">
              <span className="fpd-x62">Operaciones en espera por facturar</span>
              {mostrarCargandoOps ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fpd-x63">{resumenOps.porFacturar}</span>}
            </div>
            <div className="fpd-x61">
              <span className="fpd-x62">Operaciones ya facturadas (en historial)</span>
              {mostrarCargandoOps ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fpd-x64">{resumenOps.facturadas}</span>}
            </div>
            <div className="fpd-x61">
              <span className="fpd-x62">Total completadas cargadas</span>
              {mostrarCargandoOps ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fpd-x65">{resumenOps.total}</span>}
            </div>
          </div>

          <div className="fpd-x66">
            <div className="fpd-x67">
              <span className="fpd-x3">
                {operacionesMostradas.length} {operacionesMostradas.length === 1 ? 'mostrada' : 'mostradas'}
              </span>
            </div>

            <div className="fpd-x68">
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
                title="Agregar un costo adicional al proveedor en una operación seleccionada">
                Costo adicional
              </button>
              <button disabled={seleccionadas.length === 0 || seleccionMultiProveedor} onClick={() => {
                // ✅ ALERTA MONTOS EN CERO: si alguna operación seleccionada no
                //   tiene montos en NINGUNA fuente, se pide revisar Operaciones.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- operaciones sin tipo canónico (mismo criterio del archivo).
                const opsSel: any[] = seleccionadas
                  .map((id) => operacionesGlobales.find((o) => String(o.id) === String(id)))
                  .filter(Boolean);
                const enCero = opsSel.filter(op => { const mm = obtenerMontoOperacion(op); return (mm.subtotal || 0) <= 0 && (mm.conv || 0) <= 0; });
                if (enCero.length > 0) {
                  const refs = enCero.map(op => refDeOp(op) || op.numReferencia || op.id).join(', ');
                  const seguir = window.confirm(`ATENCIÓN: ${enCero.length} operación(es) tienen los montos EN CERO:\n\n${refs}\n\nRevisa su registro en el módulo de Operaciones (convenio del proveedor y montos) antes de facturar.\n\n¿Deseas continuar de todos modos?`);
                  if (!seguir) return;
                }
                setStatusFacturaForm('Facturado'); setAdjuntosFacturar([]); setModalAbierto(true);
              }}
                style={{ padding: '8px 20px', backgroundColor: (seleccionadas.length > 0 && !seleccionMultiProveedor) ? '#D84315' : '#30363d', color: '#fff', border: 'none', borderRadius: '6px', cursor: (seleccionadas.length > 0 && !seleccionMultiProveedor) ? 'pointer' : 'not-allowed', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Generar Factura ({seleccionadas.length})
              </button>
            </div>
          </div>

          {topeOpsAlcanzado && (
            <div className="fpd-x69">
              Se alcanzó el tope de <b>{LIMITE_OPS_TODAS}</b> operaciones cargadas, por lo que podría haber más que no se muestran. Usa el <b>rango de fechas</b> o el <b>proveedor</b> para acotar.
            </div>
          )}

          {seleccionMultiProveedor && (
            <div className="fpd-x70">
              Seleccionaste operaciones de <b>distintos proveedores</b>. Una factura debe ser de un solo proveedor: usa el filtro de proveedor o selecciona operaciones del mismo proveedor.
            </div>
          )}

          {seleccionadas.length > 0 && !seleccionMultiProveedor && (
            <div className="fpd-x71">
              <div className="fpd-x72">
                <div className="fpd-x73">
                  <span className="fpd-x74">Seleccionadas</span>
                  <span className="fpd-x65">{seleccionadas.length}</span>
                </div>
                <div className="fpd-x73">
                  <span className="fpd-x74">Conversión Estimada</span>
                  <span className="fpd-x75">{formatoMoneda(resumenSeleccion.subtotal)}</span>
                </div>
                <div className="fpd-x73">
                  <span className="fpd-x74">Proveedor</span>
                  <span className="fpd-x76">{nombreProveedorFactura || '—'}</span>
                </div>
                <div>
                  <span className="fpd-x74">Moneda</span>
                  <span className="fpd-x77"><NombreMoneda moneda={monedaProveedor} respaldo="Sin moneda en Empresas" /></span>{/* ✅ V00481 */}
                </div>
              </div>
            </div>
          )}

          <div className="table-container fpd-x78">
            <table className="fpd-x79">
              <thead className="fpd-x80">
                <tr>
                  <th className="fpd-x81">ACCIONES</th>
                  <th className="fpd-x82"></th>
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
                  <tr><td className="fpd-x83" colSpan={columnasOps.filter(c => c.visible).length + 2}>
                    <div className="fpd-x84">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="fpd-x85">Define tus filtros y presiona <b className="fpd-x86">Buscar</b> para ver las operaciones.</span>
                      <button className="fpd-x87" onClick={() => setFiltrosAbiertos(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : mostrarCargandoOps ? (
                  <tr><td className="fpd-x88" colSpan={columnasOps.filter(c => c.visible).length + 2}><CargandoDatos texto="Cargando todas las operaciones completadas..." /></td></tr>
                ) : operacionesMostradas.length === 0 ? (
                  <tr><td className="fpd-x88" colSpan={columnasOps.filter(c => c.visible).length + 2}>No hay operaciones {vistaOps === 'facturadas' ? 'facturadas' : vistaOps === 'pendientes' ? 'pendientes' : 'completadas'} con los filtros actuales{filtroProveedor ? ' para el proveedor seleccionado' : ''}.</td></tr>
                ) : (
                  operacionesPagina.map(op => {
                    const m = obtenerMontoOperacion(op);
                    const yaFacturada = esFacturada(op);
                    return (
                      <tr key={op.id} onClick={() => { if (!yaFacturada) toggleSeleccion(op.id); }}
                        style={{ cursor: yaFacturada ? 'default' : 'pointer', borderBottom: '1px solid #21262d', backgroundColor: seleccionadas.includes(op.id) ? 'rgba(216,67,21,0.1)' : (yaFacturada ? 'rgba(16,185,129,0.04)' : 'transparent') }}>
                        <td className="fpd-x89">
                          {/* ✅ V00126: editar la operación completa (hilo Operaciones → Facturación) */}
                          <button className="fpd-btn-editar-op" onClick={(e) => { e.stopPropagation(); setOpEditandoId(String(op.id)); }} title="Editar esta operación en el formulario de Operaciones">✎ Operación</button>
                          {yaFacturada && op.facturaProveedorId && <button className="fpd-btn-editar-op fpd-btn-hilo" onClick={(e) => { e.stopPropagation(); setHiloFacturaId(String(op.facturaProveedorId)); }} title="Verificar el hilo Operaciones → Facturación → Pagos de esta factura">🔗 Hilo</button>}
                          {yaFacturada ? (
                            <div className="fpd-x90">
                              <button className="fpd-x91" onClick={(e) => { void abrirConfirmacionTarifa(e, op); }} title="Generar la Confirmación de Tarifa a Proveedor en PDF">Tarifa</button>
                              <button className="fpd-x92" onClick={(e) => abrirGestionOp(e, op)} title="Editar el # de factura de esta operación">✎ #</button>
                              <button className="fpd-x93" onClick={(e) => { e.stopPropagation(); quitarOpDeFactura(op); }} title="Quitar esta operación de la factura (vuelve a Pendientes)">✕ Quitar</button>
                            </div>
                          ) : (
                            <div className="fpd-x90">
                              <button className="fpd-x91" onClick={(e) => { void abrirConfirmacionTarifa(e, op); }} title="Generar la Confirmación de Tarifa a Proveedor en PDF">Tarifa</button>
                              <button className="fpd-x94" onClick={(e) => { e.stopPropagation(); abrirCostoAdicParaOp(op.id); }} title="Agregar costo adicional a esta operación">＋ Costo</button>
                            </div>
                          )}
                        </td>
                        <td className="fpd-x95">
                          {yaFacturada ? (
                            <span className="fpd-x96" title="Ya facturada" />
                          ) : (
                            <input className="fpd-x97" type="checkbox" checked={seleccionadas.includes(op.id)} readOnly />
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
            <div className="fpd-x98">
              <button onClick={() => setPaginaOps(p => Math.max(1, p - 1))} disabled={paginaOpsSegura === 1}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === 1 ? 'not-allowed' : 'pointer', color: paginaOpsSegura === 1 ? '#484f58' : '#c9d1d9' }}>Anterior</button>
              <span className="fpd-x99">
                Página {paginaOpsSegura} / {totalPaginasOps} · {operacionesMostradas.length} operaciones
              </span>
              <button onClick={() => setPaginaOps(p => Math.min(totalPaginasOps, p + 1))} disabled={paginaOpsSegura === totalPaginasOps}
                style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaOpsSegura === totalPaginasOps ? 'not-allowed' : 'pointer', color: paginaOpsSegura === totalPaginasOps ? '#484f58' : '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>

      ) : (
        <div className="animation-fade-in">
          <div className="fpd-x100">
            <div className="fpd-x101">
              <span className="fpd-x102">Facturas Listadas</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fpd-x103">{resumenHistorial.cuenta}</span>}{/* ✅ V00449 */}
            </div>
            <div className="fpd-x101">
              <span className="fpd-x102">Ops. Facturadas</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fpd-x104">{resumenHistorial.totalOps}</span>}
            </div>
            <div className="fpd-x101">
              <span className="fpd-x105">Total Facturado (<NombreMoneda moneda="USD" forma="codigo" />)</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fpd-x106">{formatoMoneda(resumenHistorial.totalUSD)}</span>}
            </div>
            <div className="fpd-x101">
              <span className="fpd-x105">Total Facturado (<NombreMoneda moneda="MXN" forma="codigo" />)</span>
              {cargandoFacturas ? <CargandoDatos compacto texto="Cargando…" /> : <span className="fpd-x107">{formatoMoneda(resumenHistorial.totalMXN)}</span>}
            </div>
          </div>

          <div className="table-container fpd-x78">
            <table className="fpd-x79">
              <thead className="fpd-x80">
                <tr>
                  <th className="fpd-x81">ACCIONES</th>
                  {columnasFactura.filter(c => c.visible).map(col => (
                    <th key={`th_${col.id}`} style={thOrdenStyle} onClick={() => toggleOrdenFac(col.id)}>
                      {col.label.toUpperCase()}{flechaFac(col.id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!busquedaHistHecha ? (
                  <tr><td className="fpd-x83" colSpan={columnasFactura.filter(c => c.visible).length + 1}>
                    <div className="fpd-x84">
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#30363d" strokeWidth="1.6"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
                      <span className="fpd-x85">Define tus filtros y presiona <b className="fpd-x86">Buscar</b> para ver las facturas.</span>
                      <button className="fpd-x87" onClick={() => setFiltrosAbiertos(true)}>Abrir filtros</button>
                    </div>
                  </td></tr>
                ) : cargandoFacturas ? (
                  <tr><td className="fpd-x110" colSpan={columnasFactura.filter(c => c.visible).length + 1}><CargandoDatos texto="Cargando facturas..." /></td></tr>
                ) : registrosVisibles.length === 0 ? (
                  <tr><td className="fpd-x110" colSpan={columnasFactura.filter(c => c.visible).length + 1}>
                    {facturasGlobales.length === 0
                      ? 'Aún no hay facturas registradas.'
                      : `No se encontraron facturas con los filtros actuales${textoBuscarFactura ? ` (búsqueda: "${textoBuscarFactura}")` : ''}${filtroStatusFactura !== 'Todos' ? ` (status: "${filtroStatusFactura}")` : ''}${filtroProveedor ? ' para el proveedor seleccionado' : ''}.`}
                  </td></tr>
                ) : (
                  registrosVisibles.map(f => (
                    <tr className="fpd-x111 fac-fila-clic" key={f.id} title="Clic en la fila para ver la ficha de la factura"
                      onClick={(e) => { if ((e.target as HTMLElement).closest('button, a, input, select, textarea, label, [role="button"]')) return; setFacturaViendo(f); }}>{/* ✅ V00381 */}
                      <td className="fpd-x95">
                        <div className="fpd-x112">
                          <PildoraDocsFactura archivos={docsDeFactura(f)} onAbrir={() => setDocsFacturaDe(f)} />{/* ✅ V00276 · ✅ V00451 */}
                          <button className="fpd-x113" title="Ver Ficha" onClick={() => setFacturaViendo(f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                          </button>
                          <button title="Generar el Rate de Proveedor en PDF (relación de referencias de esta factura)" disabled={cargandoRate} onClick={() => abrirRate(f)} style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: cargandoRate ? 'not-allowed' : 'pointer', padding: '6px', display: 'flex', opacity: cargandoRate ? 0.6 : 1 }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line></svg>
                          </button>
                          <button className="fpd-x114" title="Editar Factura" onClick={(e) => abrirEditarFactura(e, f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                          </button>
                          <button className="fpd-x115" title="Eliminar Factura" onClick={(e) => handleEliminarFactura(e, f)}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>
                        </div>
                      </td>
                      {columnasFactura.filter(c => c.visible).map(col => (
                        <td className="fpd-x1" key={`cell_${f.id}_${col.id}`}>{renderCeldaFactura(f, col.id)}</td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {busquedaHistHecha && totalPaginas > 1 && (
            <div className="fpd-x116">
              <button onClick={irPaginaAnterior} disabled={paginaActual === 1} style={{ padding: '8px 16px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Anterior</button>
              <span className="fpd-x117">{paginaActual} / {totalPaginas}</span>
              <button onClick={irPaginaSiguiente} disabled={paginaActual === totalPaginas} style={{ padding: '8px 16px', cursor: (paginaActual === totalPaginas) ? 'not-allowed' : 'pointer', background: 'none', border: 'none', color: '#c9d1d9' }}>Siguiente</button>
            </div>
          )}
        </div>
      )}

      {modalColumnas && (
        <div className="modal-overlay fpd-x118">
          <div className="fpd-x119">
            <div className="fpd-x120">
              <h3 className="fpd-x121">Configurar Columnas</h3>
              <button className="fpd-x41" onClick={() => setModalColumnas(false)}>✕</button>
            </div>
            <p className="fpd-x122">Arrastra para reordenar. Desmarca las que quieras ocultar de la tabla y del Excel. <b className="fpd-x123">Esta configuración se guarda y se aplica para todos los usuarios.</b></p>
            <ul className="fpd-x124">
              {columnasFactura.map((col, idx) => (
                <li key={col.id} draggable onDragStart={(e) => handleDragStart(e, idx)} onDragEnter={() => handleDragEnter(idx)} onDragEnd={() => setDraggedColIndex(null)} onDragOver={(e) => e.preventDefault()}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', backgroundColor: draggedColIndex === idx ? '#1f2937' : '#161b22', border: '1px solid #30363d', borderRadius: '6px', cursor: 'grab' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <input className="fpd-x125" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisible(idx)} />
                  <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal' }}>{col.label}</span>
                </li>
              ))}
            </ul>
            <div className="fpd-x126">
              <button onClick={guardarConfigColumnasHistorial} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {modalColumnasOps && (
        <div className="modal-overlay fpd-x118">
          <div className="fpd-x127">
            <div className="fpd-x128">
              <div>
                <h3 className="fpd-x121">Configurar Columnas</h3>
                <span className="fpd-x129">
                  {columnasOps.filter(c => c.visible).length} visibles de {columnasOps.length} disponibles
                </span>
              </div>
              <button className="fpd-x41" onClick={() => { setModalColumnasOps(false); setBusquedaColOps(''); }}>✕</button>
            </div>
            <div className="fpd-x130">
              <div className="fpd-x131">
                <svg className="fpd-x44" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input className="fpd-x132" type="text" placeholder="Buscar columna por nombre o grupo..." value={busquedaColOps} onChange={(e) => setBusquedaColOps(e.target.value)} />
              </div>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: false })))} style={{ ...btnDirStyle, color: '#8b949e' }} title="Ocultar todas">Ocultar todas</button>
              <button onClick={() => setColumnasOps(cs => cs.map(c => ({ ...c, visible: true })))} style={{ ...btnDirStyle, color: '#10b981' }} title="Mostrar todas">Mostrar todas</button>
              <button onClick={() => setColumnasOps(COLUMNAS_OPS_BASE.map(c => ({ ...c })))} style={{ ...btnDirStyle, color: '#D84315' }} title="Restablecer al estado por defecto">Restablecer</button>
            </div>
            <p className="fpd-x133">
              Arrastra para reordenar. Marca las que quieras ver en la tabla y en el Excel. El grupo entre paréntesis indica de qué pestaña del detalle viene el campo. <b className="fpd-x123">Esta configuración se guarda y se aplica para todos los usuarios.</b>
            </p>
            <ul className="fpd-x134">
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
                    <input className="fpd-x125" type="checkbox" checked={col.visible} onChange={() => toggleColumnaVisibleOps(idx)} />
                    <div className="fpd-x135">
                      <span style={{ color: col.visible ? '#c9d1d9' : '#484f58', fontSize: '0.85rem', fontWeight: col.visible ? 'bold' : 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.label}</span>
                      {col.grupo && (
                        <span className="fpd-x136">({col.grupo})</span>
                      )}
                    </div>
                  </li>
                ))}
            </ul>
            <div className="fpd-x126">
              <button onClick={guardarConfigColumnasOps} disabled={guardandoCols} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 32px', borderRadius: '6px', cursor: guardandoCols ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoCols ? 0.7 : 1 }}>{guardandoCols ? 'Guardando...' : 'Guardar para todos'}</button>
            </div>
          </div>
        </div>
      )}

      {modalCostoAdic && (
        <div className="modal-overlay fpd-x137">
          <div className="fpd-x138">
            <div className="fpd-x139">
              <h2 className="fpd-x140">Costo adicional al proveedor</h2>
              <button className="fpd-x41" onClick={() => setModalCostoAdic(false)}>✕</button>
            </div>
            <p className="fpd-x141">
              Se suma a los <b className="fpd-x8">Cargos Adicionales</b> del proveedor en la operación elegida y se recalcula su subtotal/conversión. Usa un monto negativo para aplicar un descuento.
            </p>
            <div className="fpd-x142">
              <div>
                <label className="fpd-x143">OPERACIÓN</label>
                <select className="fpd-x144" value={costoAdicOpId} onChange={e => setCostoAdicOpId(e.target.value)}>
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
                  <div className="fpd-x145">
                    Cargos actuales: <b className="fpd-x8">{formatoMoneda(o.cargosAdicionalesProv)}</b> · Conversión actual: <b className="fpd-x146">{formatoMoneda(mm.conv)}</b>
                  </div>
                );
              })()}
              <div>
                <label className="fpd-x143">MONTO ADICIONAL (en la moneda del convenio)</label>
                <input className="fpd-x147" type="number" step="any" value={costoAdicMonto} onChange={e => setCostoAdicMonto(e.target.value)} placeholder="Ej. 150.00" />
              </div>
              <div>
                <label className="fpd-x143">CONCEPTO (opcional)</label>
                <input className="fpd-x148" type="text" value={costoAdicConcepto} onChange={e => setCostoAdicConcepto(e.target.value)} placeholder="Ej. Estadía, maniobras, demora..." />
              </div>
            </div>
            <div className="fpd-x149">
              <button className="fpd-x150" onClick={() => setModalCostoAdic(false)} disabled={guardandoCostoAdic}>Cancelar</button>
              <button onClick={handleGuardarCostoAdic} disabled={guardandoCostoAdic || !costoAdicOpId} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: (guardandoCostoAdic || !costoAdicOpId) ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: (guardandoCostoAdic || !costoAdicOpId) ? 0.7 : 1 }}>{guardandoCostoAdic ? 'Guardando...' : 'Agregar costo'}</button>
            </div>
          </div>
        </div>
      )}

      {modalAbierto && (
        <div className="modal-overlay fpd-x151">
          <div className="fpd-x152">
            <div className="fpd-x139">
              <h2 className="fpd-x153">Registrar Factura de Proveedor</h2>
              <button className="fpd-x41" onClick={() => setModalAbierto(false)}>✕</button>
            </div>
            <div className="fpd-x154">
              <div>
                <span className="fpd-x155">Proveedor</span>
                <span className="fpd-x76">{nombreProveedorFactura || getNombreEmpresa(proveedorFacturaId)}</span>
              </div>
              <div className="fpd-x156">
                <span className="fpd-x155">Moneda Proveedor</span>
                <span className="fpd-x157"><NombreMoneda moneda={monedaProveedor} respaldo="Sin moneda" /></span>
              </div>
              <div className="fpd-x158">
                {/* ✅ V00481: en la moneda del proveedor (Dólares → Dólares; Pesos → Conversión Final) */}
                <span className="fpd-x155">Total ({seleccionadas.length} Ops)</span>
                <span className="fpd-x159"><Importe monto={totalSeleccionEnMoneda} moneda={monedaProveedor} /></span>
              </div>
            </div>
            {proveedorFacturaId && !monedaProveedor && <div className="fpd-aviso-crear"><AvisoMonedaFactura texto={avisoSinMoneda('proveedor')} error /></div>}
            <FormularioConfigurable modulo="facturacionProveedores">{/* ✅ V00385 */}
            <form onSubmit={handleGuardarFactura}>
              <div className="fpd-x160">
                <div className="fpd-x161">
                  <label className="fpd-x143">STATUS DE LA FACTURA</label>
                  <select value={statusFacturaForm} onChange={e => setStatusFacturaForm(e.target.value)}
                    style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(statusFacturaForm), border: `1px solid ${colorStatusFactura(statusFacturaForm)}`, borderRadius: '4px', fontWeight: 'bold' }}>
                    {STATUS_AL_CREAR.map(s => <option key={s} value={s}>{s}</option>)}{/* ✅ V00481: se cancela después, desde la ficha */}
                  </select>
                </div>
                <div className="fpd-x161">
                  <label className="fpd-x143">N° DE FACTURA DEL PROVEEDOR</label>
                  <input className="fpd-x162" type="text" required placeholder="Ej. A-1234" value={invoiceForm} onChange={e => setInvoiceForm(e.target.value)} />
                </div>
                <div>
                  <label className="fpd-x143">FECHA DE FACTURACIÓN</label>
                  <input className="fpd-x163" type="date" required value={fechaForm} onChange={e => setFechaForm(e.target.value)} />
                </div>
                <div>
                  <label className="fpd-x143">REFERENCIA (Opcional)</label>
                  <input className="fpd-x163" type="text" placeholder="Referencia interna..." value={facturaCcpForm} onChange={e => setFacturaCcpForm(e.target.value)} />
                </div>
                <div className="fac-doc-ancho">{/* ✅ V00390: documento a lo ancho del formulario */}
                  {/* ✅ V00276: documento de la factura (se sube al confirmar) */}
                  <label className="fpd-x143">DOCUMENTO DE LA FACTURA</label>
                  {/* ✅ V00451: varios (hasta 10), con vista previa; se suben al confirmar */}
                  <AdjuntosArchivos etiqueta="Archivos (opcional)" adjuntos={adjuntosFacturar} onCambiar={setAdjuntosFacturar} max={MAX_DOCS_FACTURA} deshabilitado={guardando} />
                </div>
              </div>
              <div className="fpd-x164">
                <button className="fpd-x150" type="button" onClick={() => setModalAbierto(false)} disabled={guardando}>Cancelar</button>
                <button className="fpd-x165" type="submit" disabled={guardando}>{guardando ? 'Guardando...' : 'Confirmar Factura'}</button>
              </div>
            </form>
            </FormularioConfigurable>
          </div>
        </div>
      )}

      {facturaClienteViendo && (
        <div className="modal-overlay fpd-x166" onClick={() => setFacturaClienteViendo(null)}>
          <div className="fpd-x167" onClick={(e) => e.stopPropagation()}>
            <div className="fpd-x168">
              <h3 className="fpd-x169">Factura Roelca (Cliente)</h3>
              <button className="fpd-x170" onClick={() => setFacturaClienteViendo(null)}>✕</button>
            </div>
            <div className="fpd-x171">
              <div className="fpd-x172">
                Esta operación <strong>ya fue facturada al cliente</strong> en <strong>Facturación de Clientes</strong>.
              </div>
              {[
                ['Operación', facturaClienteViendo.opRef],
                ['# Factura Cliente', facturaClienteViendo.invoice || '-'],
                ['Cliente', facturaClienteViendo.clienteNombre || '-'],
                ['Fecha de la factura', facturaClienteViendo.fecha ? formatearFechaSpanish(facturaClienteViendo.fecha) : '-'],
                ['Status', facturaClienteViendo.statusFactura || '-'],
                ['Moneda', facturaClienteViendo.moneda || '-'],
                ['Total facturado', formatoMoneda(facturaClienteViendo.total)],
              ].map(([label, val]: any, i: number) => (
                <div className="fpd-x173" key={i}>
                  <span className="fpd-x174">{label}</span>
                  <span className="fpd-x175">{val}</span>
                </div>
              ))}
              <div className="fpd-x48">Ref. factura (id): {facturaClienteViendo.facturaId}</div>
            </div>
            <div className="fpd-x176">
              <button className="fpd-x177" onClick={() => setFacturaClienteViendo(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      {facturaViendo && (
        <div className={`modal-overlay fpd-x178${opEditandoId ? ' fpd-detras-editor' : ''}`}>{/* ✅ V00481: detrás del editor de la operación */}
          <div className={`fpd-x179${pagosFicha.length > 0 ? ' fpd-ficha--con-pagos' : ''}`}>
            <div className="fpd-x180">
              <h2 className="fpd-x181">Ficha de Factura</h2>
              
              <button className="fpd-x41" onClick={() => setFacturaViendo(null)}>✕</button>
            </div>
            <div className="fpd-ficha-cuerpo">{/* ✅ V00483: con pagos, la ficha es más ancha y los pagos van a la derecha */}
            <div className="fpd-x182">
              <div className="fpd-x183">
                <span className="fpd-x184">Status de la factura</span>
                <span style={{ padding: '4px 12px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 'bold', color: colorStatusFactura(facturaViendo.statusFactura), border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, backgroundColor: `${colorStatusFactura(facturaViendo.statusFactura)}1a`, whiteSpace: 'nowrap' }}>{facturaViendo.statusFactura || 'Facturado'}</span>
                <div className="fpd-x185">
                  <span className="fpd-x129">Cambiar a:</span>
                  <select value={facturaViendo.statusFactura || 'Facturado'} onChange={(e) => handleCambiarStatusFactura(facturaViendo, e.target.value)}
                    style={{ backgroundColor: '#0d1117', border: `1px solid ${colorStatusFactura(facturaViendo.statusFactura)}`, color: colorStatusFactura(facturaViendo.statusFactura), borderRadius: '6px', padding: '6px 10px', fontSize: '0.85rem', fontWeight: 'bold', cursor: 'pointer' }}>
                    {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <CancelacionFicha factura={facturaViendo} />{/* ✅ V00481 */}
              {avisoMonedaDe(facturaViendo) && (
                <div className="fpd-aviso-moneda">
                  <AvisoMonedaFactura texto={`${avisoMonedaDe(facturaViendo)} Corrígela con Editar factura.`} />
                  <button type="button" className="fpd-btn-corregir-moneda" onClick={(e) => abrirEditarFactura(e, facturaViendo)}>Editar factura</button>
                </div>
              )}

              <div className="fpd-x186">
                <div className="fpd-x187">
                  <div>
                    <span className="fpd-x188">Factura Prov.</span>
                    <span className="fpd-x189">{facturaViendo.invoice}</span>
                  </div>
                  <div className="fpd-x190">
                    <span className="fpd-x188">Moneda</span>
                    <span className="fpd-x157"><NombreMoneda moneda={monedaFicha} respaldo={monedaFicha} /></span>
                  </div>
                  <div className="fpd-x158">
                    <span className="fpd-x188">Fecha de Facturación</span>
                    <span className="fpd-x191">{formatearFechaSpanish(facturaViendo.fecha)}</span>
                  </div>
                </div>
                <div>
                  <span className="fpd-x188">Proveedor Facturado</span>
                  <span className="fpd-x76">{facturaViendo.proveedorNombre || getNombreEmpresa(facturaViendo.proveedorId) || '-'}</span>
                </div>
                <div>
                  <span className="fpd-x188">Referencia</span>
                  <span className="fpd-x192">{facturaViendo.facturaCcp || '-'}</span>
                </div>
                <div>
                  <span className="fpd-x188">Total Facturado</span>
                  {/* ✅ V00481: el total EN LA MONEDA de la factura (antes la conversión a pesos aunque fuera en dólares) */}
                  <span className="fpd-x193"><Importe monto={totalDeGrupo(facturaViendo)} moneda={monedaFicha} conNombre /></span>
                </div>

                {/* ✅ V00381: documento de la factura bien visible */}
                <TarjetaDocumentoFactura archivos={docsDeFactura(facturaViendo)} onAbrir={() => setDocsFacturaDe(facturaViendo)} />{/* ✅ V00451: varios */}
                <div className="fpd-x194"><hr className="fpd-x195" /></div>

                <div className="fpd-x196">
                  <div className="fpd-x197">
                    <span className="fpd-x184">
                      Referencias / Operaciones Facturadas ({facturaViendo.operacionesGuardadas?.length || 0}) — haz clic para ver el detalle
                    </span>
{puedeAgregarOperaciones(facturaViendo.statusFactura) && (/* ✅ V00481: a una factura Facturada no se le agregan */
                    <button className="fpd-x198"
                      onClick={() => { setAgregarRefFactura(facturaViendo); setBusquedaRefPendiente(''); if (operacionesGlobales.length === 0) descargarOpsCompletadas(); }}
                      title="Agregar una operación pendiente (sin facturar) a esta factura">
                      ＋ Agregar referencia
                    </button>)}
                  </div>
                  <div className="fpd-x199">
                    {facturaViendo.operacionesGuardadas?.map((op: any, i: number) => (
                      <button className="fpd-x200" key={op.id} onClick={() => verDetalleOperacion(op.id)} title="Ver detalle de la operación"
                        onMouseEnter={(e: any) => { e.currentTarget.style.backgroundColor = '#1f2d44'; e.currentTarget.style.borderColor = '#79b8ff'; }}
                        onMouseLeave={(e: any) => { e.currentTarget.style.backgroundColor = '#21262d'; e.currentTarget.style.borderColor = '#58a6ff'; }}>
                        <span className="fpd-x201">{refDeOp(op)}</span>
                        {op.convenioNombre && (<span style={{ color: '#8b949e', fontSize: '0.72rem' }}>Convenio: {op.convenioNombre}</span>)}
                          {/* ✅ V00481: en la moneda de la factura (Dólares → Dólares; Pesos → Conversión Final) */}
                          <span className="fpd-x202"><Importe monto={importesFicha[i]} moneda={monedaFicha} /></span>
                      </button>
                    )) || <span className="fpd-x10">Sin detalle de operaciones.</span>}
                  </div>
                </div>
              </div>
            </div>
            {pagosFicha.length > 0 && (
              <PagosDeFactura pagos={pagosFicha} moneda={monedaFicha} total={totalDeGrupo(facturaViendo)}
                onAbrir={puedeClave('pagos') ? (pago) => abrirPagoEnPagos({ id: pago.id, tipo: 'proveedor' }) : undefined} />
            )}
            </div>
            <div className="fpd-x203">
              <button onClick={() => abrirRate(facturaViendo)} disabled={cargandoRate}
                title="Generar el Rate de Proveedor en PDF (relación de referencias de esta factura)"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#10b981', color: '#0d1117', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: cargandoRate ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: cargandoRate ? 0.7 : 1, marginRight: '8px' }}>
                {cargandoRate ? 'Preparando...' : 'Rate Proveedor'}
              </button>
{puedeGenerarRemision(facturaViendo.statusFactura) && (/* ✅ V00481: con la factura Facturada ya no hay Remisión */
              <button onClick={() => abrirRemision(facturaViendo)} disabled={cargandoRemision}
                title="Generar la Remisión en PDF de esta factura"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#fb923c', color: '#0d1117', border: 'none', borderRadius: '6px', padding: '8px 16px', cursor: cargandoRemision ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem', opacity: cargandoRemision ? 0.7 : 1, marginRight: '8px' }}>
                {cargandoRemision ? 'Preparando...' : 'Remisión'}
              </button>)}
              <button onClick={() => setFacturaViendo(null)} className="btn btn-outline fpd-x204">Cerrar Ficha</button>
            </div>
          </div>
        </div>
      )}


      {gestionOp && (
        <div className="modal-overlay fpd-x220">
          <div className="fpd-x138">
            <div className="fpd-x221">
              <h2 className="fpd-x222">Gestionar operación facturada</h2>
              <button className="fpd-x41" onClick={() => setGestionOp(null)}>✕</button>
            </div>
            <div className="fpd-x223">
              Operación: <b className="fpd-x224">{gestionOp.numReferencia || gestionOp.referencia || gestionOp.ref || String(gestionOp.id).substring(0, 6)}</b><br />
              Factura actual: <b className="fpd-x225">{invoiceDeOp(gestionOp) || '—'}</b>
            </div>
            <div className="fpd-x226">
              <label className="fpd-x227">NUEVO NÚMERO DE FACTURA</label>
              <input className="fpd-x147" type="text" value={gestionInvoice} onChange={e => setGestionInvoice(e.target.value)} placeholder="Ej. A-1234" />
              <p className="fpd-x228">
                La operación se moverá a la factura con ese número (del mismo proveedor). Si no existe, se crea; si la factura original queda sin operaciones, se elimina. El Historial se actualiza solo.
              </p>
            </div>
            <div className="fpd-x229">
              <button onClick={() => quitarOpDeFactura(gestionOp)} disabled={guardandoGestionOp}
                style={{ padding: '8px 18px', backgroundColor: 'transparent', color: '#ef4444', border: '1px solid #ef4444', borderRadius: '6px', cursor: guardandoGestionOp ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoGestionOp ? 0.7 : 1 }}>
                ✕ Quitar de la factura
              </button>
              <div className="fpd-x109">
                <button className="fpd-x230" onClick={() => setGestionOp(null)} disabled={guardandoGestionOp}>Cancelar</button>
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
        <div className="modal-overlay fpd-x220">
          <div className="fpd-x231">
            <div className="fpd-x232">
              <div>
                <h2 className="fpd-x222">Agregar referencia a la factura</h2>
                <span className="fpd-x3">
                  Factura <b className="fpd-x225">{agregarRefFactura.invoice}</b> · {agregarRefFactura.proveedorNombre || getNombreEmpresa(agregarRefFactura.proveedorId) || '-'}
                </span>
              </div>
              <button className="fpd-x41" onClick={() => setAgregarRefFactura(null)}>✕</button>
            </div>
            <div className="fpd-x233">
              <svg className="fpd-x20" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input className="fpd-x21" type="text" autoFocus placeholder="Buscar operación pendiente por referencia o # remolque..." value={busquedaRefPendiente} onChange={e => setBusquedaRefPendiente(e.target.value)} />
            </div>
            <div className="fpd-x234">
              {cargandoOperaciones ? (
                <div className="fpd-x235">Cargando operaciones pendientes...</div>
              ) : operacionesGlobales.length === 0 ? (
                <div className="fpd-x236">
                  No hay operaciones cargadas.
                  <div className="fpd-x237">
                    <button onClick={() => descargarOpsCompletadas(true)} style={{ ...btnDirStyle, color: '#58a6ff', margin: '0 auto' }}>↻ Cargar operaciones</button>
                  </div>
                </div>
              ) : candidatosPendientes.length === 0 ? (
                <div className="fpd-x236">
                  No se encontraron operaciones pendientes{agregarRefFactura.proveedorId ? ' de este proveedor' : ''}{busquedaRefPendiente.trim() ? ` para "${busquedaRefPendiente}"` : ''}.
                </div>
              ) : (
                candidatosPendientes.map((op: any) => {
                  const mm = obtenerMontoOperacion(op);
                  return (
                    <div className="fpd-x238" key={op.id}>
                      <div className="fpd-x239">
                        <div className="fpd-x240">{op.numReferencia || op.referencia || op.ref || String(op.id).substring(0, 6)}</div>
                        <div className="fpd-x241">
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
            <div className="fpd-x242">
              <span className="fpd-x243">Solo se muestran operaciones <b className="fpd-x10">sin facturar</b>{agregarRefFactura.proveedorId ? ' del mismo proveedor' : ''} (máx. 50).</span>
              <button className="fpd-x244" onClick={() => setAgregarRefFactura(null)}>Listo</button>
            </div>
          </div>
        </div>
      )}

      {facturaEditando && (
        <div className="modal-overlay fpd-x245">
          <div className="fpd-x246">
            <div className="fpd-x139">
              <h2 className="fpd-x140">Editar Factura</h2>
              <button className="fpd-x41" onClick={() => setFacturaEditando(null)}>✕</button>
            </div>

            <div className="fpd-x247">
              <label style={{ display: 'block', color: '#8b949e', fontSize: '0.75rem', marginBottom: '4px', fontWeight: 600, textTransform: 'uppercase' }}>Proveedor de la factura</label>
              <SelectBuscable
                opciones={empresasList
                  .slice()
                  .sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es', { sensitivity: 'base' }))
                  .map((e: any) => ({ value: e.id, label: String(e.nombre || e.id) }))}
                value={editProveedorId}
                onChange={(id: string) => {
                  // ✅ V00481: otro proveedor con otra moneda → el total sugerido pasa a esa moneda.
                  if (monedaProveedorDe(id) !== monedaProveedorDe(editProveedorId)) setEditTotal(String(totalEditPara(facturaEditando, id)));
                  setEditProveedorId(id);
                }}
                placeholder="Buscar proveedor..."
              />
              {Array.isArray(facturaEditando.__groupIds) && facturaEditando.__groupIds.length > 1 && (
                <span> · <b className="fpd-x248">{facturaEditando.__groupIds.length} documentos agrupados</b> (el total y los archivos se guardan en el primero)</span>
              )}
            </div>

            <div className="fpd-x160">
              <div className="fpd-x161">
                <label className="fpd-x143">STATUS DE LA FACTURA</label>
                <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', color: colorStatusFactura(editStatus), border: `1px solid ${colorStatusFactura(editStatus)}`, borderRadius: '6px', fontWeight: 'bold', boxSizing: 'border-box' }}>
                  {STATUS_FACTURA_OPCIONES.map(s => <option key={s} value={s}>{s}</option>)}
                  {!STATUS_FACTURA_OPCIONES.includes(editStatus) && editStatus && <option value={editStatus}>{editStatus}</option>}
                </select>
              </div>
              {estaCancelada(editStatus) && (
                <div className="fpd-x161">{/* ✅ V00481: cancelar pide nota y la factura que la reemplaza */}
                  <CamposCancelacion idBase="fpd-edit-canc" valor={editCancelacion} onCambiar={setEditCancelacion}
                    sugerencias={foliosDelProveedor({ ...facturaEditando, proveedorId: editProveedorId || facturaEditando.proveedorId })} deshabilitado={guardandoEdit} />
                </div>
              )}
              <div className="fpd-x161">
                <label className="fpd-x143">NÚMERO DE FACTURA</label>
                <input className="fpd-x147" type="text" value={editInvoice} onChange={e => setEditInvoice(e.target.value)} placeholder="Ej. A-1234" />
              </div>
              <div className="fpd-x161">
                {/* ✅ V00276: documento de la factura desde el editor (se sube al guardar) */}
                <label className="fpd-x143">DOCUMENTO DE LA FACTURA</label>
                {/* ✅ V00451: varios (hasta 10), con vista previa; se guardan al guardar */}
                <AdjuntosArchivos etiqueta="Archivos" adjuntos={adjuntosEdicion} onCambiar={setAdjuntosEdicion} max={MAX_DOCS_FACTURA} deshabilitado={guardandoEdit} />
              </div>
              <div>
                <label className="fpd-x143">FECHA DE FACTURACIÓN</label>
                <input className="fpd-x249" type="date" value={editFecha} onChange={e => setEditFecha(e.target.value)} />
              </div>
              <div>
                {/* ✅ V00481: SIEMPRE la del proveedor en Empresas; no se elige ni se quita */}
                <span className="fpd-x143">MONEDA</span>
                <span className="fpd-moneda-fija" title="Es la moneda del proveedor en Empresas"><NombreMoneda moneda={monedaProveedorDe(editProveedorId)} respaldo="Sin moneda en Empresas" /></span>
              </div>
              <div className="fpd-x161 fpd-edit-aviso">{/* ✅ V00481: la moneda es la del proveedor */}
                {!monedaProveedorDe(editProveedorId) ? (
                  <AvisoMonedaFactura error texto={editProveedorId ? avisoSinMoneda('proveedor') : 'Elige el proveedor de la factura: la moneda es la del proveedor en Empresas.'} />
                ) : (
                  <AvisoMonedaFactura texto={(() => {
                    const aviso = avisoMonedaDistinta(monedaDeFactura(facturaEditando), monedaProveedorDe(editProveedorId), 'proveedor');
                    if (!aviso) return null;
                    const pagos = tienePagosAplicados(facturaEditando) ? ' Tiene pagos aplicados: revisa su saldo en Pagos.' : '';
                    const monNueva = monedaProveedorDe(editProveedorId);
                    const recalculado = monNueva ? totalSugeridoEn(monNueva, facturaEditando.operacionesGuardadas) > 0 : false;
                    return `${aviso} Al guardar queda en ${nombreMoneda(monNueva)}; ${recalculado ? 'el total sugerido es el de sus operaciones en esa moneda' : 'sus operaciones no traen importe en esa moneda: captura el total'}. Revísalo.${pagos}`;
                  })()} />
                )}
              </div>
              <div>
                <label className="fpd-x143">TOTAL FACTURADO</label>
                <input className="fpd-x251" type="number" step="any" value={editTotal} onChange={e => setEditTotal(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <label className="fpd-x143">REFERENCIA (Opcional)</label>
                <input className="fpd-x148" type="text" value={editCcp} onChange={e => setEditCcp(e.target.value)} placeholder="Referencia interna..." />
              </div>
            </div>

            <div className="fpd-x252">
              <button className="fpd-x150" onClick={() => setFacturaEditando(null)} disabled={guardandoEdit}>Cancelar</button>
              <button onClick={handleGuardarEdicionFactura} disabled={guardandoEdit} style={{ padding: '8px 24px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: guardandoEdit ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: guardandoEdit ? 0.7 : 1 }}>{guardandoEdit ? 'Guardando...' : 'Guardar cambios'}</button>
            </div>
          </div>
        </div>
      )}

      {(operacionDetalle || cargandoDetalle) && (
        <div className="modal-overlay fpd-x253">
          <div className="form-card detail-card fpd-x254">
            {cargandoDetalle || !operacionDetalle ? (
              <div className="fpd-x255">Cargando detalle de la operación...</div>
            ) : (
              <>
                <div className="form-header fpd-x256">
                  <div className="fpd-x257">
                    <div>
                      <h2 className="fpd-x258">Detalle de Operación</h2>
                      <div className="fpd-x259">
                        <span className="fpd-x260">{det.ref || det.id?.substring(0, 6)}</span>
                        <span className="fpd-x261">{txt(det.statusNombre, det.status)}</span>
                      </div>
                    </div>
                    <button className="fpd-x262" onClick={() => setOperacionDetalle(null)} onMouseEnter={(e) => e.currentTarget.style.color = '#f0f6fc'} onMouseLeave={(e) => e.currentTarget.style.color = '#8b949e'}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                </div>

                <div className="fpd-x263">
                  {tabsDetalle.map(tab => (
                    <button key={tab.id} onClick={() => setPestañaDetalleActiva(tab.id)}
                      style={{ padding: '12px 16px', background: 'none', border: 'none', borderBottom: pestañaDetalleActiva === tab.id ? '2px solid #D84315' : '2px solid transparent', color: pestañaDetalleActiva === tab.id ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontWeight: pestañaDetalleActiva === tab.id ? 600 : 'normal', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="detail-content fpd-x264">
                  {pestañaDetalleActiva === 'general' && (
                    <div className="fpd-x265">
                      <div><span className="fpd-x266">Tipo de Operación</span><span className="fpd-x267">{txt(det.tipoOperacionNombre, det.tipoOperacionId)}</span></div>
                      <div><span className="fpd-x266">Fecha de Servicio / Status</span><span className="fpd-x267">{mostrarDato(det.fechaServicio)} <span className="fpd-x268">|</span> <span className="fpd-x269">{txt(det.statusNombre, det.status)}</span></span></div>
                      {evalIsFletes ? (
                        <div><span className="fpd-x266">Fecha de Cita</span><span className="fpd-x267">{formatearFechaHora(det.fechaCita)}</span></div>
                      ) : (<div></div>)}
                      <div className="fpd-x194"><hr className="fpd-x270" /></div>
                      <div><span className="fpd-x271">Cliente (Paga)</span><span className="fpd-x267">{txt(det.clienteNombre, det.nombreCliente, det.clientePaga)}</span></div>
                      <div><span className="fpd-x271">Convenio (Tarifa)</span><span className="fpd-x267">{txt(det.convenioNombre, det.convenio)}</span></div>
                      <div><span className="fpd-x271"># de Remolque</span><span className="fpd-x267">{txt(det.remolqueNombre, det.remolquePlaca, det.numeroRemolque)}</span></div>
                      <div><span className="fpd-x271">Ref Cliente</span><span className="fpd-x267">{mostrarDato(det.refCliente)}</span></div>
                      <div><span className="fpd-x272">Origen</span><span className="fpd-x267">{txt(det.origenNombre, det.origen)}</span></div>
                      <div><span className="fpd-x272">Destino</span><span className="fpd-x267">{txt(det.destinoNombre, det.destino)}</span></div>
                      <div className="fpd-x273"><span className="fpd-x271">Observaciones Ejecutivo</span><div className="fpd-x274">{mostrarDato(det.observacionesEjecutivo)}</div></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'pedimento' && (
                    <div className="fpd-x265">
                      <div className="fpd-x161"><span className="fpd-x271">Cliente (Mercancía)</span><span className="fpd-x267">{txt(det.clienteMercanciaNombre, det.clienteMercancia)}</span></div>
                      <div><span className="fpd-x271">Descripción de la Mercancía</span><span className="fpd-x267">{mostrarDato(det.descripcionMercancia)}</span></div>
                      <div className="fpd-x194"><hr className="fpd-x270" /></div>
                      <div><span className="fpd-x271">Cantidad (Enteros)</span><span className="fpd-x267">{mostrarDato(det.cantidad)}</span></div>
                      <div><span className="fpd-x271">Embalaje</span><span className="fpd-x267">{txt(det.embalajeNombre, det.embalaje)}</span></div>
                      <div><span className="fpd-x271">Peso (Kg)</span><span className="fpd-x267">{mostrarDato(det.pesoKg)}</span></div>
                      <div className="fpd-x194"><hr className="fpd-x270" /></div>
                      <div><span className="fpd-x271"># DODA</span><span className="fpd-x267">{mostrarDato(det.numDoda)}</span></div>
                      <div><span className="fpd-x271">Fecha de Emisión (DODA)</span><span className="fpd-x267">{mostrarDato(det.fechaEmisionDoda)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'manifiestos' && (
                    <div className="fpd-x265">
                      <div><span className="fpd-x271"># de Entry's</span><span className="fpd-x267">{mostrarDato(det.numeroEntrys)}</span></div>
                      <div><span className="fpd-x271">Cantidad de Entry's</span><span className="fpd-x267">{mostrarDato(det.cantEntrys)}</span></div>
                      <div className="fpd-x194"><hr className="fpd-x270" /></div>
                      <div><span className="fpd-x271"># Manifiesto</span><span className="fpd-x267">{mostrarDato(det.numManifiesto)}</span></div>
                      <div><span className="fpd-x271">Proveedor de Servicios</span><span className="fpd-x267">{txt(det.provServiciosNombre, det.provServicios)}</span></div>
                      <div><span className="fpd-x271">Costo Manifiesto ($)</span><span className="fpd-x275">{formatoMoneda(det.montoManifiesto)}</span></div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'unidad' && (
                    <div>
                      <div className="fpd-x276">
                        <div className="fpd-x194"><span className="fpd-x271">Proveedor de Transporte</span><span className="fpd-x277">{txt(det.proveedorUnidadNombre, det.proveedorUnidad)}</span></div>
                      </div>
                      <div className="fpd-x278">
                        <div className="fpd-x279">
                          <div><span className="fpd-x271">Facturado En:</span><span className="fpd-x267"><NombreMoneda moneda={det.monedaUnidadNombre || det.facturadoEnUnidad} respaldo={det.monedaUnidadNombre || mostrarMoneda(det.facturadoEnUnidad)} /></span></div>
                          <div><span className="fpd-x271">Convenio Proveedor</span><span className="fpd-x267">{txt(det.convenioProveedorNombre, det.convenioProveedor)}</span></div>
                          <div><span className="fpd-x271">Moneda del Convenio (Base)</span><span className="fpd-x267"><NombreMoneda moneda={det.monedaConvenioProv} respaldo={mostrarMoneda(det.monedaConvenioProv)} /></span></div>
                        </div>
                        <div className="fpd-x280">
                          <div><span className="fpd-x271">Monto a Pagar (Base)</span><span className="fpd-x267">{formatoMoneda(det.totalAPagarProv)}</span></div>
                          <div><span className="fpd-x271">Costos Adicionales</span><span className="fpd-x267">{formatoMoneda(det.cargosAdicionalesProv)}</span></div>
                          <div><span className="fpd-x266">Subtotal (Convenio + Costos)</span><span className="fpd-x281">{formatoMoneda(det.subtotalProv)}</span></div>
                        </div>
                        <div className="fpd-x282">
                          {/* ✅ V00481: Dólares en azul, Pesos en verde (la Conversión Final es en pesos) */}
                          <div><span className="fpd-x271"><NombreMoneda moneda="USD" /></span><span className="fpd-x283"><Importe monto={det.dolaresProv} moneda="USD" /></span></div>
                          <div><span className="fpd-x271"><NombreMoneda moneda="MXN" /></span><span className="fpd-x283"><Importe monto={det.pesosProv} moneda="MXN" /></span></div>
                          <div><span className="fpd-x284">Conversión Final (Gasto)</span><span className="fpd-x285"><Importe monto={det.conversionProv} moneda="MXN" /></span></div>
                        </div>
                      </div>

                      {showDetailInternalFleet && (
                        <div className="fpd-x276">
                          <div className="fpd-x194"><h4 className="fpd-x286">Flota Operativa (Roelca)</h4></div>
                          <div><span className="fpd-x271">Unidad Asignada</span><span className="fpd-x267">{txt(det.unidadNombre, det.unidad)}</span>{/* ✅ V00465 */}<TagPuenteUnidad unidadId={det.unidad} grupo={grupoTagDeOperacion(det)} /></div>
                          <div className="fpd-x161"><span className="fpd-x271">Operador Asignado</span><span className="fpd-x267">{txt(det.operadorNombre, det.operador)}</span></div>
                          <div className="fpd-x194"><hr className="fpd-x195" /></div>
                          <div><span className="fpd-x271">Sueldo del Operador</span><span className="fpd-x267">{formatoMoneda(det.sueldoOperador)}</span></div>
                          <div><span className="fpd-x271">Sueldo Extra</span><span className="fpd-x267">{formatoMoneda(det.sueldoExtra)}</span></div>
                          <div><span className="fpd-x266">Sueldo Total</span><span className="fpd-x287">{formatoMoneda(det.sueldoTotal)}</span></div>
                          <div className="fpd-x194"><hr className="fpd-x195" /></div>
                          <div><span className="fpd-x271">Combustible</span><span className="fpd-x267">{formatoMoneda(det.combustible)}</span></div>
                          <div><span className="fpd-x271">Combustible Extra</span><span className="fpd-x267">{formatoMoneda(det.combustibleExtra)}</span></div>
                          <div><span className="fpd-x266">Total Combustible</span><span className="fpd-x281">{formatoMoneda(det.combustibleTotal)}</span></div>
                        </div>
                      )}

                      {showDetailExternalFleet && (
                        <div className="fpd-x276">
                          <div className="fpd-x194"><h4 className="fpd-x288">Flota Externa (Proveedor)</h4></div>
                          <div><span className="fpd-x272">Unidad Externa</span><span className="fpd-x267">{mostrarDato(det.unidadProveedor)}</span></div>
                          <div className="fpd-x161"><span className="fpd-x272">Operador Externo</span><span className="fpd-x267">{mostrarDato(det.operadorProveedor)}</span></div>
                        </div>
                      )}

                      <div className="fpd-x289">
                        <div className="fpd-x290">
                          <div className="fpd-x291">Total Gastos [Sueldos + Manifiesto]</div>
                          <div className="fpd-x292">{formatoMoneda(det.totalGastos)}</div>
                        </div>
                      </div>

                      <div className="fpd-x293">
                        <span className="fpd-x294">Observaciones (Unidad / Proveedor)</span>
                        <div className="fpd-x295">{mostrarDato(det.observacionesUnidad)}</div>
                      </div>
                    </div>
                  )}

                  {pestañaDetalleActiva === 'cobrar' && (
                    <div>
                      <div className="fpd-x276">
                        <div><span className="fpd-x271">Facturado En:</span><span className="fpd-x267"><NombreMoneda moneda={det.monedaCobroNombre || det.facturadoEnCobrar} respaldo={det.monedaCobroNombre || mostrarMoneda(det.facturadoEnCobrar)} /></span></div>
                        <div><span className="fpd-x271">Moneda Convenio (Cliente)</span><span className="fpd-x267"><NombreMoneda moneda={det.monedaConvenioCliente} respaldo={mostrarMoneda(det.monedaConvenioCliente)} /></span></div>
                        <div><span className="fpd-x271">Convenio Seleccionado (Base)</span><span className="fpd-x267">{formatoMoneda(det.montoConvenioCliente)}</span></div>
                        <div><span className="fpd-x271">Cargos Adicionales</span><span className="fpd-x267">{formatoMoneda(det.cargosAdicionales)}</span></div>
                        <div><span className="fpd-x266">Subtotal (Convenio + Cargos)</span><span className="fpd-x296">{formatoMoneda(det.subtotalCliente)}</span></div>
                        <div><span className="fpd-x271">Tipo de Cambio del Día</span><span className="fpd-x267">{mostrarDato(det.tipoCambioAprobado)}</span></div>
                      </div>
                      <div className="fpd-x297">
                        <div><span className="fpd-x271"><NombreMoneda moneda="USD" /> (Cliente)</span><span className="fpd-x298"><Importe monto={det.dolaresCliente} moneda="USD" /></span></div>
                        <div><span className="fpd-x271"><NombreMoneda moneda="MXN" /> (Cliente)</span><span className="fpd-x283"><Importe monto={det.pesosCliente} moneda="MXN" /></span></div>
                        <div><span className="fpd-x266">Conversión Final (Ingreso)</span><span className="fpd-x299"><Importe monto={det.conversionCliente} moneda="MXN" /></span></div>
                      </div>
                      <div className="fpd-x300">
                        <span className="fpd-x301">Utilidad Estimada de la Operación (Ingreso - Gasto)</span>
                        <span className="fpd-x302">{formatoMoneda(det.utilidadEstimada)}</span>
                      </div>
                      <div className="fpd-x293">
                        <span className="fpd-x294">Observaciones (Facturación / Cobro)</span>
                        <div className="fpd-x295">{mostrarDato(det.observacionesCobrar)}</div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="form-actions fpd-x303">
                  {/* ✅ V00481: editar la operación en el formulario de Operaciones (la ficha queda detrás) */}
                  <button type="button" className="fpd-btn-editar-detalle" onClick={() => { const id = String(det.id); setOperacionDetalle(null); setOpEditandoId(id); }}>✎ Editar operación</button>
                  <button onClick={() => setOperacionDetalle(null)} className="btn btn-outline fpd-x304">Cerrar Detalle</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}


      {/* ════════════════ MODAL VISTA PREVIA DE REMISIÓN (editable) ════════════════ */}
      {remisionPreview && (
        <div className="modal-overlay fpd-x317">
          <div className="fpd-x318">
            <div className="fpd-x319">
              <div>
                <h2 className="fpd-x140">Remisión · vista previa</h2>
                <span style={{ color: remisionPreview.esUSD ? '#58a6ff' : '#3fb950', fontSize: '0.82rem', fontWeight: 'bold' }}>
                  {remisionPreview.esUSD ? 'DÓLARES (USD) → Camila' : 'PESOS (MXN) → Rolando'}
                </span>
              </div>
              <button className="fpd-x41" onClick={() => setRemisionPreview(null)}>✕</button>
            </div>
            <p className="fpd-x320">
              Revisa y edita lo que necesites; luego pulsa <b className="fpd-x321">Generar PDF</b>. Se descargará la remisión en PDF con el logo.
            </p>

            {/* Emisor (encabezado) */}
            <div className="fpd-x322">
              <div className="fpd-x323">ENCABEZADO (EMISOR)</div>
              <div className="fpd-x324">
                <div><label style={rLabelStyle}>NOMBRE</label><input type="text" value={remisionPreview.emisorNombre} onChange={e => setRP('emisorNombre', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>EMAIL</label><input type="text" value={remisionPreview.emisorEmail} onChange={e => setRP('emisorEmail', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DIRECCIÓN</label><input type="text" value={remisionPreview.emisorDireccion} onChange={e => setRP('emisorDireccion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD / ESTADO / TEL.</label><input type="text" value={remisionPreview.emisorCiudadEstado} onChange={e => setRP('emisorCiudadEstado', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            {/* Datos de la remisión y del proveedor */}
            <div className="fpd-x322">
              <div className="fpd-x325">DATOS DE LA REMISIÓN Y DEL PROVEEDOR</div>
              <div className="fpd-x326">
                <div><label style={rLabelStyle}># REMISIÓN</label><input type="text" value={remisionPreview.numero} onChange={e => setRP('numero', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>FECHA</label><input type="text" value={remisionPreview.fecha} onChange={e => setRP('fecha', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DENOMINACIÓN</label><input type="text" value={remisionPreview.moneda} onChange={e => setRP('moneda', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DÍAS CRÉDITO</label><input type="text" value={remisionPreview.diasCredito} onChange={e => setRP('diasCredito', e.target.value)} style={rInputStyle} /></div>
                <div className="fpd-x161"><label style={rLabelStyle}>PROVEEDOR</label><input type="text" value={remisionPreview.clienteNombre} onChange={e => setRP('clienteNombre', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>NUM. EXT/INT</label><input type="text" value={remisionPreview.numExtInt} onChange={e => setRP('numExtInt', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>COLONIA</label><input type="text" value={remisionPreview.colonia} onChange={e => setRP('colonia', e.target.value)} style={rInputStyle} /></div>
                <div className="fpd-x194"><label style={rLabelStyle}>DIRECCIÓN</label><input type="text" value={remisionPreview.direccion} onChange={e => setRP('direccion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD</label><input type="text" value={remisionPreview.ciudad} onChange={e => setRP('ciudad', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            {/* Renglones de servicios */}
            <div className="fpd-x322">
              <div className="fpd-x327">SERVICIOS ({(remisionPreview.filas || []).length})</div>
              <div className="fpd-x328">
                <table className="fpd-x329">
                  <thead>
                    <tr className="fpd-x330">
                      <th className="fpd-x331">REF#</th>
                      <th className="fpd-x331">FECHA</th>
                      <th className="fpd-x331">EQ.</th>
                      <th className="fpd-x331">ORIGEN</th>
                      <th className="fpd-x331">DESTINO</th>
                      <th className="fpd-x331">DESCRIPCIÓN</th>
                      <th className="fpd-x332">IMPORTE</th>
                      <th className="fpd-x333"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(remisionPreview.filas || []).map((r: any, idx: number) => (
                      <tr className="fpd-x334" key={idx}>
                        <td className="fpd-x335"><input value={r.ref} onChange={e => setRPFila(idx, 'ref', e.target.value)} style={{ ...rCellStyle, minWidth: '90px' }} /></td>
                        <td className="fpd-x335"><input value={r.fecha} onChange={e => setRPFila(idx, 'fecha', e.target.value)} style={{ ...rCellStyle, minWidth: '90px' }} /></td>
                        <td className="fpd-x335"><input value={r.equipo} onChange={e => setRPFila(idx, 'equipo', e.target.value)} style={{ ...rCellStyle, minWidth: '60px' }} /></td>
                        <td className="fpd-x335"><input value={r.origen} onChange={e => setRPFila(idx, 'origen', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                        <td className="fpd-x335"><input value={r.destino} onChange={e => setRPFila(idx, 'destino', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                        <td className="fpd-x335"><input value={r.descripcion} onChange={e => setRPFila(idx, 'descripcion', e.target.value)} style={{ ...rCellStyle, minWidth: '160px' }} /></td>
                        <td className="fpd-x335"><input type="number" step="any" value={r.importe} onChange={e => setRPFila(idx, 'importe', e.target.value)} style={{ ...rCellStyle, minWidth: '90px', textAlign: 'right', color: '#3fb950' }} /></td>
                        <td className="fpd-x336">
                          <button className="fpd-x337" onClick={() => quitarFilaRemision(idx)} title="Quitar renglón">✕</button>
                        </td>
                      </tr>
                    ))}
                    {(remisionPreview.filas || []).length === 0 && (
                      <tr><td className="fpd-x338" colSpan={8}>Sin renglones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pie: tipo de cambio, total, observaciones */}
            <div className="fpd-x339">
              <div><label style={rLabelStyle}>FECHA TIPO DE CAMBIO (DOF)</label><input type="text" value={remisionPreview.fechaTipoCambio} onChange={e => setRP('fechaTipoCambio', e.target.value)} placeholder="Ej. 24/06/2026" style={rInputStyle} /></div>
              <div><label style={rLabelStyle}>TIPO DE CAMBIO</label><input type="text" value={remisionPreview.tipoCambio} onChange={e => setRP('tipoCambio', e.target.value)} placeholder="Ej. 17.5505" style={rInputStyle} /></div>
              <div><label style={rLabelStyle}>TOTAL</label><input type="number" step="any" value={remisionPreview.total} onChange={e => setRP('total', e.target.value)} style={{ ...rInputStyle, color: '#3fb950', fontWeight: 'bold' }} /></div>
              <div className="fpd-x194"><label style={rLabelStyle}>OBSERVACIONES</label><input type="text" value={remisionPreview.observaciones} onChange={e => setRP('observaciones', e.target.value)} style={rInputStyle} /></div>
            </div>

            <div className="fpd-x252">
              <button className="fpd-x150" onClick={() => setRemisionPreview(null)}>Cerrar</button>
              <button className="fpd-x350" onClick={() => guardarRemision(true)} title="Guardar los cambios para que no se pierdan y los demás usuarios los vean">Guardar</button>
              <button className="fpd-x340" onClick={async () => { await guardarRemision(false); generarPDFDeRemision(); }} title="Guarda los cambios y descarga el PDF">Generar PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* (CONFIRMACIÓN DE TARIFA) Vista previa editable → PDF */}
      {confirmacionPreview && (
        <div className="modal-overlay fpd-x341" onClick={() => setConfirmacionPreview(null)}>
          <div className="fpd-x342" onClick={(e) => e.stopPropagation()}>
            <div className="fpd-x39">
              <div className="fpd-x343">
                <h2 className="fpd-x140">Confirmación de Tarifa a Proveedor</h2>
                <span className="fpd-x344">{confirmacionPreview.referencia}</span>
              </div>
              <button className="fpd-x41" onClick={() => setConfirmacionPreview(null)}>✕</button>
            </div>
            <p className="fpd-x320">
              Revisa y completa lo que falte (los campos vacíos salen en blanco en el documento); luego pulsa <b className="fpd-x321">Generar PDF</b>. Se descargará la confirmación con el logo.
            </p>

            <div className="fpd-x322">
              <div className="fpd-x323">DATOS GENERALES</div>
              <div className="fpd-x345">
                <div><label style={rLabelStyle}>COORDINADOR</label><input type="text" value={confirmacionPreview.coordinador} onChange={e => setCT('coordinador', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>No. REFERENCIA</label><input type="text" value={confirmacionPreview.referencia} onChange={e => setCT('referencia', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>FECHA DEL SERVICIO</label><input type="text" value={confirmacionPreview.fechaServicio} onChange={e => setCT('fechaServicio', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>PROVEEDOR</label><input type="text" value={confirmacionPreview.proveedor} onChange={e => setCT('proveedor', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>TIPO DE OPER. (TARIFARIO)</label><input type="text" value={confirmacionPreview.tipoOperacion} onChange={e => setCT('tipoOperacion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>IMPO / EXPO / MOV</label><input type="text" value={confirmacionPreview.impoExpoMov} onChange={e => setCT('impoExpoMov', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>TIPO DE CAMBIO DOF $</label><input type="text" value={confirmacionPreview.tipoCambio} onChange={e => setCTMonto('tipoCambio', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            <div className="fpd-x322">
              <div className="fpd-x325">UNIDAD / EQUIPO</div>
              <div className="fpd-x345">
                <div><label style={rLabelStyle}>REMOLQUE</label><input type="text" value={confirmacionPreview.remolque} onChange={e => setCT('remolque', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>TIPO DE UNIDAD</label><input type="text" value={confirmacionPreview.tipoUnidad} onChange={e => setCT('tipoUnidad', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>PLACAS REMOLQUE</label><input type="text" value={confirmacionPreview.placasRemolque} onChange={e => setCT('placasRemolque', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>UNIDAD</label><input type="text" value={confirmacionPreview.unidad} onChange={e => setCT('unidad', e.target.value)} style={rInputStyle} /></div>
                <div className="fpd-x161"><label style={rLabelStyle}>OPERADOR</label><input type="text" value={confirmacionPreview.operador} onChange={e => setCT('operador', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            <div className="fpd-x322">
              <div className="fpd-x327">RUTA</div>
              <div className="fpd-x324">
                <div><label style={rLabelStyle}>CLIENTE ORIGEN</label><input type="text" value={confirmacionPreview.clienteOrigen} onChange={e => setCT('clienteOrigen', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD ORIGEN (DIRECCIÓN)</label><input type="text" value={confirmacionPreview.ciudadOrigen} onChange={e => setCT('ciudadOrigen', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CLIENTE DESTINO</label><input type="text" value={confirmacionPreview.clienteDestino} onChange={e => setCT('clienteDestino', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>CIUDAD DESTINO (DIRECCIÓN)</label><input type="text" value={confirmacionPreview.ciudadDestino} onChange={e => setCT('ciudadDestino', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>#REF CLIENTE</label><input type="text" value={confirmacionPreview.refCliente} onChange={e => setCT('refCliente', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            <div className="fpd-x322">
              <div className="fpd-x346">MONTOS</div>
              <div className="fpd-x345">
                <div><label style={rLabelStyle}>FACTURADO EN</label><input type="text" value={confirmacionPreview.facturadoEn} onChange={e => setCTMonto('facturadoEn', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>MONEDA DEL CONVENIO</label><input type="text" value={confirmacionPreview.monedaConvenio} onChange={e => setCTMonto('monedaConvenio', e.target.value)} style={rInputStyle} /></div>
                {/* MONEDA DE PAGO: define en qué moneda se pagan los montos */}
                <div>
                  <label style={{ ...rLabelStyle, color: '#fb923c' }}>MONEDA DE PAGO</label>
                  <select value={confirmacionPreview.monedaPago || ''} onChange={e => setCTMonto('monedaPago', e.target.value)} style={{ ...rInputStyle, cursor: 'pointer' }}>
                    <option value="Pesos">Pesos</option>
                    <option value="Dólares">Dólares</option>
                  </select>
                </div>
                <div><label style={rLabelStyle}>CONVENIO PROV. $</label><input type="text" value={confirmacionPreview.convenioProv} onChange={e => setCTMonto('convenioProv', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>COSTOS ADIC. $</label><input type="text" value={confirmacionPreview.costosAdic} onChange={e => setCTMonto('costosAdic', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>SUBTOTAL PROV. $ {claveMoneda(confirmacionPreview.monedaConvenio) ? `(${claveMoneda(confirmacionPreview.monedaConvenio)})` : ''}</label><input type="text" value={confirmacionPreview.subtotalProv} onChange={e => setCT('subtotalProv', e.target.value)} style={rInputStyle} /></div>
                <div><label style={{ ...rLabelStyle, color: '#f85149' }}>TOTAL A PAGAR $ {claveMoneda(confirmacionPreview.monedaPago) ? `(${claveMoneda(confirmacionPreview.monedaPago)})` : ''}</label><input type="text" value={confirmacionPreview.totalAFacturar} onChange={e => setCT('totalAFacturar', e.target.value)} style={{ ...rInputStyle, color: '#f85149', fontWeight: 'bold' }} /></div>
              </div>
            </div>

            <div className="fpd-x322">
              <div className="fpd-x347">OBSERVACIONES</div>
              {/* NUEVO: se guardan con la confirmación y salen en el PDF */}
              <textarea
                value={confirmacionPreview.observaciones || ''}
                onChange={e => setCT('observaciones', e.target.value)}
                placeholder="Observaciones que saldrán impresas en el PDF de la confirmación..."
                rows={3}
                style={{ ...rInputStyle, width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: '64px', fontFamily: 'inherit', lineHeight: 1.4 }}
              />
            </div>

            <div className="fpd-x348">
              {/* NUEVO: log de generación del PDF (fecha, hora y usuario) */}
              <button className="fpd-x349" onClick={() => setLogConfirmacionAbierto(true)} title="Ver quién y cuándo ha generado el PDF de esta confirmación">
                Log ({logDeConfirmacionActual().length})
              </button>
              <div className="fpd-x49">
                <button className="fpd-x150" onClick={() => setConfirmacionPreview(null)}>Cerrar</button>
                <button className="fpd-x350" onClick={() => guardarConfirmacion(true)} title="Guardar los cambios para que los demás usuarios los vean">Guardar</button>
                <button className="fpd-x340" onClick={generarPDFDeConfirmacion} title="Guarda los cambios, registra el log y descarga el PDF">Generar PDF</button>
              </div>
            </div>
          </div>

          {/* NUEVO: MODAL DE LOG — quién y cuándo generó el PDF */}
          {logConfirmacionAbierto && (
            <div className="fpd-x351" onClick={(e) => { e.stopPropagation(); setLogConfirmacionAbierto(false); }}>
              <div className="fpd-x352" onClick={e => e.stopPropagation()}>
                <div className="fpd-x353">
                  <div>
                    <div className="fpd-x354">Log de generación de PDF</div>
                    <div className="fpd-x355">Confirmación de Tarifa · <span className="fpd-x356">{confirmacionPreview.referencia}</span></div>
                  </div>
                  <button className="fpd-x357" onClick={() => setLogConfirmacionAbierto(false)}>✕</button>
                </div>
                <div className="fpd-x358">
                  {logDeConfirmacionActual().length === 0 ? (
                    <div className="fpd-x359">
                      Aún no se ha generado el PDF de esta confirmación.
                    </div>
                  ) : (
                    <table className="fpd-x360">
                      <thead>
                        <tr className="fpd-x361">
                          <th className="fpd-x362">Fecha</th>
                          <th className="fpd-x363">Hora</th>
                          <th className="fpd-x364">Generó el PDF</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logDeConfirmacionActual().map((l: any, i: number) => (
                          <tr className="fpd-x365" key={`${l.ts || i}`}>
                            <td className="fpd-x366">{l.fecha || '-'}</td>
                            <td className="fpd-x367">{l.hora || '-'}</td>
                            <td className="fpd-x368">{l.usuario || 'Desconocido'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* (RATE DE PROVEEDOR) Vista previa editable → PDF */}
      {ratePreview && (
        <div className="modal-overlay fpd-x341" onClick={() => setRatePreview(null)}>
          <div className="fpd-x369" onClick={(e) => e.stopPropagation()}>
            <div className="fpd-x39">
              <div className="fpd-x343">
                <h2 className="fpd-x140">Rate de Proveedor</h2>
                <span className="fpd-x370">Factura {ratePreview.facturaProveedor}</span>
              </div>
              <button className="fpd-x41" onClick={() => setRatePreview(null)}>✕</button>
            </div>
            <p className="fpd-x320">
              Relación de referencias amparadas con la factura del proveedor. La <b className="fpd-x8">utilidad</b> se calcula sola (cobrado − proveedor). Pulsa <b className="fpd-x310">Generar PDF</b> para descargar en horizontal con el logo.
            </p>

            <div className="fpd-x322">
              <div className="fpd-x371">DATOS DEL PROVEEDOR Y DE LA FACTURA</div>
              <div className="fpd-x326">
                <div><label style={rLabelStyle}>FACTURA DEL PROVEEDOR</label><input type="text" value={ratePreview.facturaProveedor} onChange={e => setRT('facturaProveedor', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>FECHA</label><input type="text" value={ratePreview.fecha} onChange={e => setRT('fecha', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>DÍAS DE CRÉDITO</label><input type="text" value={ratePreview.diasCredito} onChange={e => setRT('diasCredito', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>VENCIMIENTO</label><input type="text" value={ratePreview.vencimiento} onChange={e => setRT('vencimiento', e.target.value)} style={rInputStyle} /></div>
                <div className="fpd-x161"><label style={rLabelStyle}>PROVEEDOR</label><input type="text" value={ratePreview.proveedorNombre} onChange={e => setRT('proveedorNombre', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>MONEDA</label><input type="text" value={ratePreview.moneda} onChange={e => setRT('moneda', e.target.value)} style={rInputStyle} /></div>
                <div><label style={{ ...rLabelStyle, color: '#f59e0b' }}>TIPO DE CAMBIO</label><input type="text" value={ratePreview.tipoCambio || ''} onChange={e => setTipoCambioRate(e.target.value)} placeholder="Ej. 17.5505" style={{ ...rInputStyle, borderColor: '#f59e0b' }} /></div>
                <div><label style={rLabelStyle}>CIUDAD</label><input type="text" value={ratePreview.ciudad} onChange={e => setRT('ciudad', e.target.value)} style={rInputStyle} /></div>
                <div className="fpd-x194"><label style={rLabelStyle}>DIRECCIÓN</label><input type="text" value={ratePreview.direccion} onChange={e => setRT('direccion', e.target.value)} style={rInputStyle} /></div>
                <div><label style={rLabelStyle}>COLONIA</label><input type="text" value={ratePreview.colonia} onChange={e => setRT('colonia', e.target.value)} style={rInputStyle} /></div>
              </div>
            </div>

            <div className="fpd-x322">
              <div className="fpd-x325">REFERENCIAS ({(ratePreview.filas || []).length})</div>
              <div className="fpd-x328">
                <table className="fpd-x372">
                  <thead>
                    <tr className="fpd-x330">
                      <th className="fpd-x331">REF#</th>
                      <th className="fpd-x331">EQ.</th>
                      <th className="fpd-x331">ORIGEN</th>
                      <th className="fpd-x331">DESTINO</th>
                      <th className="fpd-x331">DESCRIPCIÓN</th>
                      <th className="fpd-x331">FACTURA ROELCA</th>
                      <th className="fpd-x332">COBRADO (PESOS)</th>
                      <th className="fpd-x373">SUBTOTAL PROV.</th>
                      <th className="fpd-x332">CONVERSIÓN (PESOS)</th>
                      <th className="fpd-x332">UTILIDAD</th>
                      <th className="fpd-x333"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ratePreview.filas || []).map((r: any, idx: number) => {
                      const utilidad = (Number(r.cobrado) || 0) - (Number(r.proveedor) || 0);
                      return (
                        <tr className="fpd-x334" key={idx}>
                          <td className="fpd-x335"><input value={r.ref} onChange={e => setRTFila(idx, 'ref', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                          <td className="fpd-x335"><input value={r.equipo} onChange={e => setRTFila(idx, 'equipo', e.target.value)} style={{ ...rCellStyle, minWidth: '80px' }} /></td>
                          <td className="fpd-x335"><input value={r.origen} onChange={e => setRTFila(idx, 'origen', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                          <td className="fpd-x335"><input value={r.destino} onChange={e => setRTFila(idx, 'destino', e.target.value)} style={{ ...rCellStyle, minWidth: '110px' }} /></td>
                          <td className="fpd-x335"><input value={r.descripcion} onChange={e => setRTFila(idx, 'descripcion', e.target.value)} style={{ ...rCellStyle, minWidth: '140px' }} /></td>
                          <td className="fpd-x335"><input value={r.facturaRoelca} onChange={e => setRTFila(idx, 'facturaRoelca', e.target.value)} style={{ ...rCellStyle, minWidth: '90px' }} /></td>
                          <td className="fpd-x335"><input type="number" step="any" value={r.cobrado} onChange={e => setRTFila(idx, 'cobrado', e.target.value)} style={{ ...rCellStyle, minWidth: '90px', textAlign: 'right', color: '#3fb950' }} /></td>
                          <td className="fpd-x335"><input type="number" step="any" value={r.subtotalProv} onChange={e => setRTFila(idx, 'subtotalProv', e.target.value)} title="Subtotal del proveedor (convenio + costos, en la moneda del convenio); la CONVERSIÓN = subtotal × TC si el convenio es en dólares" style={{ ...rCellStyle, minWidth: '90px', textAlign: 'right', color: '#f59e0b' }} /></td>
                          <td className="fpd-x335"><input type="number" step="any" value={r.proveedor} onChange={e => setRTFila(idx, 'proveedor', e.target.value)} style={{ ...rCellStyle, minWidth: '90px', textAlign: 'right', color: '#3b82f6' }} /></td>
                          <td style={{ padding: '4px 10px', textAlign: 'right', color: utilidad < 0 ? '#f85149' : '#c9d1d9', fontSize: '0.82rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>{formatoMoneda(utilidad)}</td>
                          <td className="fpd-x336">
                            <button className="fpd-x337" onClick={() => quitarFilaRate(idx)} title="Quitar renglón">✕</button>
                          </td>
                        </tr>
                      );
                    })}
                    {(ratePreview.filas || []).length === 0 && (
                      <tr><td className="fpd-x338" colSpan={11}>Sin renglones.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="fpd-x374">
                <span>Cobrado: <b className="fpd-x146">{formatoMoneda((ratePreview.filas || []).reduce((s: number, r: any) => s + (Number(r.cobrado) || 0), 0))}</b></span>
                <span>Subtotal Prov.: <b className="fpd-x248">{formatoMoneda((ratePreview.filas || []).reduce((s: number, r: any) => s + (Number(r.subtotalProv) || 0), 0))}</b></span>
                <span>Conversión: <b className="fpd-x309">{formatoMoneda((ratePreview.filas || []).reduce((s: number, r: any) => s + (Number(r.proveedor) || 0), 0))}</b></span>
                <span>Utilidad: <b className="fpd-x9">{formatoMoneda((ratePreview.filas || []).reduce((s: number, r: any) => s + ((Number(r.cobrado) || 0) - (Number(r.proveedor) || 0)), 0))}</b></span>
              </div>
            </div>

            <div className="fpd-x322">
              <label style={rLabelStyle}>OBSERVACIONES</label>
              <input type="text" value={ratePreview.observaciones} onChange={e => setRT('observaciones', e.target.value)} style={rInputStyle} />
            </div>

            <div className="fpd-x252">
              <button className="fpd-x150" onClick={() => setRatePreview(null)}>Cerrar</button>
              <button className="fpd-x350" onClick={() => guardarRate(true)} title="Guardar los cambios para que no se pierdan y los demás usuarios los vean">Guardar</button>
              <button className="fpd-x375" onClick={async () => { await guardarRate(false); generarPDFDeRate(); }} title="Guarda los cambios y descarga el PDF">Generar PDF</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
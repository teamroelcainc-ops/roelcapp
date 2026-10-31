// src/features/facturacion/hooks/useEdicionFacturaCliente.ts
// ---------------------------------------------------------------------------
// ✅ V00540 — Estado y guardado de "Editar factura" (clientes). Antes vivía dentro de
//   FacturacionClientesDashboard; ahora es su propio formulario (components/EditarFacturaCliente.tsx) para
//   abrirlo también encima de la Revisión de datos. El guardado es EL MISMO, paso por paso (V00441 · V00451 ·
//   V00481 · V00520 · V00525 · V00533 · V00536). Lo único que cambia: lo que antes parchaba directo la lista y
//   la ficha del tablero ahora se avisa con `onEscrito` (quien lo abrió decide qué hacer con eso).
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import type { Adjunto } from '../../../shared/archivos/adjuntos';
import { avisar } from '../../../shared/data/avisos';
import { useCatalogo } from '../../../shared/data/catalogos';
import { useFlags } from '../../../shared/data/flags';
import { ErrorDinero, monedaDeFactura, tienePagosAplicados } from '../../../shared/dominio/dinero';
import { nombreMoneda } from '../../../shared/dominio/moneda';
import type { Moneda } from '../../../shared/dominio/moneda';
import { aCentavos, r2 } from '../../../shared/dominio/numeros';
import { formatearMoneda } from '../../../shared/utils/formatos';
import { registrarLog } from '../../../utils/logger';
import { aplicarActualizarFactura, idsDocsFactura, planActualizarFactura } from '../services/actualizarFactura';
import type { PlanActualizarFactura } from '../services/actualizarFactura';
import { importeEn } from '../services/cotejoCfdi';
import { llamarDinero, mensajeDinero } from '../services/dineroServidor';
import { camposIniciales, claveEdicion } from '../services/edicionFacturaCliente';
import type { CamposEdicionFactura, EscritoEdicionFactura, FilaFactura } from '../services/edicionFacturaCliente';
import { escribirFolioEnOperaciones } from '../services/folioEnOperaciones';
import { guardarDocsFactura } from '../services/guardarDocsFactura';
import { detalleError } from '../services/documentosFactura';
import { construirMapaCatalogos } from '../services/mapaCatalogos';
import type { EmpresaFacturacion } from '../services/mapaCatalogos';
import { codigoMonedaFactura, monedaFacturacionCliente } from '../services/monedaFacturaCliente';
import { avisoMonedaDistinta, avisoSinMoneda, estaCancelada, totalSugeridoEn, validarCancelacion } from '../services/reglasFactura';
import { escribirEnGrupo, escrituraCancelacion } from '../services/statusFacturaDatos';
import { guardarSubtotalManual } from '../services/subtotalManual';
import { totalDeFilaFactura, totalNativoFactura, totalNativoFacturaLegado } from '../services/totalesFactura';
import { useOperacionesDeFactura } from './useOperacionesDeFactura';
import type { OperacionesDeFactura } from './useOperacionesDeFactura';

interface OpcionesEdicion {
  /** La fila tal como se abrió (no se sigue a la lista mientras se edita, como siempre). */
  factura: FilaFactura;
  /** Las facturas de clientes (lista en vivo): folios para la cancelación y los documentos del folio. */
  facturas: readonly FilaFactura[];
  onCerrar: () => void;
  onEscrito?: (escrito: EscritoEdicionFactura) => void;
}

export interface EdicionFacturaCliente {
  campos: CamposEdicionFactura;
  cambiar: <K extends keyof CamposEdicionFactura>(campo: K, valor: CamposEdicionFactura[K]) => void;
  /** Elegir el cliente (solo si la factura no tiene): otro cliente con otra moneda → el subtotal sugerido pasa a esa moneda. */
  elegirCliente: (id: string) => void;
  guardando: boolean;
  hayCambios: boolean;
  guardar: () => Promise<void>;
  empresas: readonly EmpresaFacturacion[];
  nombreCliente: string;
  monedaCliente: Moneda | null;
  /** ✅ V00481: el cliente no tiene moneda (error) o la factura está en otra que la del cliente (null = sin aviso). */
  avisoMoneda: { texto: string | null; error: boolean };
  sugerenciasReemplazo: string[];
  ops: OperacionesDeFactura;
  monedaOps: Moneda | '';
  monedaVista: Moneda | null;
  plan: PlanActualizarFactura;
  sumaOps: number | null;
  bloqueoSubtotal: string;
  documentosAgrupados: number;
}

export function useEdicionFacturaCliente({ factura, facturas, onCerrar, onEscrito }: OpcionesEdicion): EdicionFacturaCliente {
  const flags = useFlags();
  const empresas = useCatalogo('empresas').datos as EmpresaFacturacion[];
  const { datos: catalogoMoneda } = useCatalogo('catalogo_moneda');
  // Solo las monedas y las empresas: es lo que resuelve una moneda guardada como id (como el mapa del tablero).
  const mapa = useMemo(() => construirMapaCatalogos([catalogoMoneda], empresas), [catalogoMoneda, empresas]);
  const monedaClienteDe = (clienteId: unknown): Moneda | null => monedaFacturacionCliente(clienteId, empresas, mapa);
  const codigoMoneda = (f: unknown): Moneda | null => codigoMonedaFactura(f, empresas, mapa);
  // ✅ V00448 · V00451: el total del folio con la regla que se muestra en la tabla.
  const totalDeGrupo = (f: unknown): number => totalDeFilaFactura(f, flags.dineroPorServidor ? totalNativoFactura : totalNativoFacturaLegado);
  // El total que se precarga: el de la factura; si su moneda no es la del cliente, la suma de sus operaciones
  //   en la moneda del cliente (Dólares (Cliente) o Conversión Final).
  const totalEditPara = (f: FilaFactura, clienteId: string): number => {
    const actual = r2(totalDeGrupo(f));
    const mon = monedaClienteDe(clienteId);
    if (!mon || mon === monedaDeFactura(f)) return actual;
    const sugerido = r2(totalSugeridoEn(mon, f.operacionesGuardadas));
    return sugerido > 0 ? sugerido : actual;
  };

  const [inicio] = useState(() => {
    const c = camposIniciales(factura, totalEditPara(factura, String(factura.clienteId || '')));
    return { campos: c, clave: claveEdicion(c) };
  });
  const [campos, setCampos] = useState<CamposEdicionFactura>(inicio.campos);
  const [guardando, setGuardando] = useState(false);
  const cambiar = <K extends keyof CamposEdicionFactura>(campo: K, valor: CamposEdicionFactura[K]): void => {
    setCampos((prev) => ({ ...prev, [campo]: valor }));
  };
  const elegirCliente = (id: string): void => {
    setCampos((prev) => ({
      ...prev,
      clienteId: id,
      // ✅ V00481: otro cliente con otra moneda → el total sugerido pasa a esa moneda.
      total: monedaClienteDe(id) !== monedaClienteDe(prev.clienteId) ? String(totalEditPara(factura, id)) : prev.total,
    }));
  };

  // ✅ V00520 — sus operaciones (con ✎ Editar), si alguna cambió de costo y cómo queda la factura al presionar
  //   Actualizar (que se activa solo si algo cambió). ✅ V00525: sin importes guardados, Actualizar los completa.
  const monedaOps: Moneda | '' = monedaDeFactura(factura) ?? '';
  const monedaVista = codigoMoneda(factura);
  const ops = useOperacionesDeFactura(factura, monedaOps || monedaVista || '');
  const plan = planActualizarFactura(factura, ops.actuales, {
    moneda: monedaOps || null, monedaVista, monedaDoc: codigoMoneda, cargando: ops.cargando, dineroPorServidor: !!flags.dineroPorServidor,
  });
  const sincronizarAlActualizar = !!plan.sincronizar && !plan.impedimento;
  const completarAlActualizar = !!plan.completar && !estaCancelada(campos.status);
  // ✅ V00533: el subtotal se escribe a mano (con aviso contra el documento); no en un folio con varios registros.
  const ids = idsDocsFactura(factura);
  const bloqueoSubtotal = ids.length > 1 ? 'Esta factura está en varios registros con el mismo folio: el subtotal no se cambia desde aquí.' : '';
  const monedaCliente = monedaClienteDe(campos.clienteId);
  const sumaOps = ops.cargando || !monedaCliente
    ? null
    : r2(Array.from(ops.actuales.values()).reduce((s, op) => s + aCentavos(importeEn(monedaCliente, op)), 0) / 100);
  const hayCambios = sincronizarAlActualizar || completarAlActualizar || claveEdicion(campos) !== inicio.clave;

  // Folios del mismo cliente que se sugieren como la factura que reemplaza a una cancelada.
  const sugerenciasReemplazo = useMemo(() => {
    const clienteId = String(campos.clienteId || factura.clienteId || '');
    const propio = String(factura.invoice || '').trim();
    return Array.from(new Set(facturas
      .filter((x) => String(x.clienteId || '') === clienteId && !estaCancelada(x.statusFactura))
      .map((x) => String(x.invoice || '').trim())
      .filter((inv) => inv && inv !== propio))).slice(0, 200);
  }, [facturas, campos.clienteId, factura]);

  // ✅ V00481: la moneda es la del cliente; si la factura está en otra, al guardar queda en la del cliente.
  const textoMonedaDistinta = (): string | null => {
    const aviso = avisoMonedaDistinta(monedaDeFactura(factura), monedaCliente, 'cliente');
    if (!aviso || !monedaCliente) return null;
    const pagos = tienePagosAplicados(factura) ? ' Tiene pagos aplicados: revisa su saldo en Pagos.' : '';
    const recalculado = totalSugeridoEn(monedaCliente, factura.operacionesGuardadas) > 0;
    return `${aviso} Al guardar queda en ${nombreMoneda(monedaCliente)}; ${recalculado ? 'el total sugerido es el de sus operaciones en esa moneda' : 'sus operaciones no traen importe en esa moneda: corrige el costo en cada operación'}. Revísalo.${pagos}`;
  };
  const avisoMoneda = monedaCliente
    ? { texto: textoMonedaDistinta(), error: false }
    : { texto: campos.clienteId ? avisoSinMoneda('cliente') : 'Elige el cliente de la factura: la moneda es la del cliente en Empresas.', error: true };

  const empresaElegida = empresas.find((e) => e.id === campos.clienteId);
  const nombreCliente = String(factura.clienteNombre || empresaElegida?.nombre || empresaElegida?.nombreCorto || mapa[campos.clienteId] || campos.clienteId);

  /** ✅ V00451: los documentos se guardan DESPUÉS de la factura (la factura nunca depende de la subida). */
  const guardarDocs = async (adjuntos: readonly Adjunto[]): Promise<void> => {
    try {
      const escrituras = await guardarDocsFactura('clientes', factura, adjuntos);
      if (escrituras) onEscrito?.({ tipo: 'docs', escrituras });
    } catch (eDoc: unknown) {
      console.error(eDoc);
      alert(`Los cambios de la factura SÍ se guardaron, pero los documentos no.\n\nMotivo: ${detalleError(eDoc)}`);
    }
  };

  const guardar = async (): Promise<void> => {
    const { invoice, fecha, ccp, status, cancelacion, clienteId, total, adjuntos } = campos;
    if (!invoice.trim()) { alert('El # de Invoice es obligatorio.'); return; }
    // ✅ V00481: la moneda es la del cliente (Empresas) y es obligatoria; cancelar pide nota y reemplazo.
    const monedaEdit = monedaClienteDe(clienteId);
    if (!monedaEdit) { alert(clienteId ? avisoSinMoneda('cliente') : 'Elige el cliente de la factura: la moneda es la del cliente en Empresas.'); return; }
    const cancelando = estaCancelada(status);
    if (cancelando) { const falta = validarCancelacion(cancelacion, invoice); if (falta) { alert(falta); return; } }
    // ✅ V00533: el subtotal capturado a mano, revisado antes de guardar nada (la transacción lo vuelve a revisar).
    const totalNum = Number(total) || 0;
    const subtotalCambio = Math.abs(totalNum - r2(totalDeGrupo(factura))) > 0.009;
    if (subtotalCambio && !flags.dineroPorServidor) {
      if (bloqueoSubtotal) { alert(bloqueoSubtotal); return; }
      if (!(totalNum > 0)) { alert('El subtotal debe ser mayor que $0.00.'); return; }
      const pagadoAntes = Number(factura.montoPagado) || 0;
      if (totalNum < pagadoAntes - 0.009) { alert(`No se puede: el subtotal (${formatearMoneda(totalNum)}) quedaría por debajo de lo ya pagado (${formatearMoneda(pagadoAntes)}). Elimina primero el pago en Pagos.`); return; }
    }
    const canc = escrituraCancelacion(factura, status, cancelando ? cancelacion : null);
    const logCancelacion = (): void => {
      if (canc.vacia) return;
      void registrarLog('Facturación Clientes', 'Edición', cancelando
        ? `Canceló la factura ${invoice.trim()}: la reemplaza ${cancelacion.reemplazo.trim()}. Nota: ${cancelacion.nota.trim()}`
        : `La factura ${invoice.trim()} dejó de estar Cancelada (${status}).`);
    };
    setGuardando(true);
    try {
      // ✅ V00441 (Fase 5.5): con la bandera, el servidor guarda el total como MANUAL.
      if (flags.dineroPorServidor) {
        // ✅ V00481: los datos de la cancelación van ANTES (si el servidor falla quedan sin efecto: solo se
        //   muestran con status Cancelado); al salir de Cancelado se borran DESPUÉS.
        if (cancelando) await escribirEnGrupo('facturas_clientes', ids, canc.firestore);
        const r = await llamarDinero('editarFactura', {
          lado: 'cliente', origen: 'facturacion', facturaIds: ids, invoice: invoice.trim(), fecha: fecha || '', facturaCcp: ccp.trim(),
          statusFactura: status, moneda: monedaEdit, total: totalNum, ...(clienteId ? { empresaId: clienteId } : {}),
        });
        if (!cancelando) await escribirEnGrupo('facturas_clientes', ids, canc.firestore);
        onEscrito?.({ tipo: 'servidor', ids, facturas: r.facturas, canc });
        logCancelacion();
        await guardarDocs(adjuntos); // ✅ V00451
        onCerrar();
        return;
      }
      const baseUpdate: Record<string, unknown> = {
        invoice: invoice.trim(),
        fecha: fecha || '',
        facturaCcp: ccp.trim(),
        statusFactura: status,
        monedaFacturacion: monedaEdit, // ✅ V00481: la del cliente
        updatedAt: new Date().toISOString(),
      };
      // Reasignar cliente: corrige facturas que quedaron a nombre de otro cliente (Pagos lee clienteId/clienteNombre).
      if (clienteId) {
        const cli = empresas.find((e) => e.id === clienteId);
        if (cli) { baseUpdate.clienteId = clienteId; baseUpdate.clienteNombre = String(cli.nombre || ''); }
      }
      // ✅ V00533: el subtotal NO va en este lote (escritura de dinero → transacción al final).
      const batch = writeBatch(db);
      ids.forEach((id) => {
        batch.set(doc(db, 'facturas_clientes', id), { ...baseUpdate, ...canc.firestore }, { merge: true });
      });
      await batch.commit();
      // ✅ V00536: el # de Invoice también en sus operaciones.
      try {
        await escribirFolioEnOperaciones('cliente', invoice.trim(), facturas.filter((f) => ids.includes(String(f.id))).map((f) => ({ id: String(f.id), datos: f })));
      } catch (e) {
        console.error('[Facturación] No se escribió el folio en las operaciones:', e);
        avisar({ tipo: 'alerta', titulo: 'El folio no llegó a las operaciones', texto: 'La factura se guardó, pero sus operaciones siguen con el folio anterior. Vuelve a guardar la factura para reintentar.' });
      }
      // ✅ V00279: el DOCUMENTO se sube DESPUÉS de guardar (en facturación no es obligatorio).
      await guardarDocs(adjuntos);
      onEscrito?.({ tipo: 'directo', ids, campos: baseUpdate, canc });
      logCancelacion();
      // ✅ V00520: Actualizar también pone la factura al día con sus operaciones (si alguna cambió de costo).
      // ✅ V00525: no guardó lo que cobró cada operación → se guarda lo que cobra hoy cada una (el total no cambia).
      if (sincronizarAlActualizar || completarAlActualizar) {
        const r = await aplicarActualizarFactura(factura, { ...plan, completar: completarAlActualizar ? plan.completar : null }, invoice.trim(), auth.currentUser?.email || '');
        onEscrito?.({ tipo: 'actualizar', resultado: r });
        if (r.errorCompletar) throw new ErrorDinero(`Los demás cambios se guardaron, pero no lo que cobra cada operación: ${r.errorCompletar}`);
      }
      // ✅ V00533: el subtotal capturado a mano va AL FINAL (gana sobre lo que haya puesto Actualizar), en UNA
      //   transacción que relee la factura: lo pagado de ese momento, saldo, status y marca de capturado a mano.
      if (subtotalCambio) {
        const antes = r2(totalDeGrupo(factura));
        let datos: Record<string, unknown>;
        try {
          datos = await guardarSubtotalManual(ids[0], totalNum, new Date().toISOString(), auth.currentUser?.email || '');
        } catch (e) {
          throw new ErrorDinero(`Los demás cambios se guardaron, pero no el subtotal: ${e instanceof ErrorDinero ? e.message : 'no se pudo guardar (revisa tu conexión).'}`);
        }
        onEscrito?.({ tipo: 'subtotal', id: ids[0], datos });
        void registrarLog('Facturación Clientes', 'Edición', `Subtotal de la factura ${invoice.trim()} capturado a mano: ${antes.toFixed(2)} → ${totalNum.toFixed(2)} ${monedaEdit}.`);
      }
      onCerrar();
    } catch (e) {
      console.error('Error guardando edición de factura:', e);
      alert(e instanceof ErrorDinero ? e.message : mensajeDinero(e, 'No se pudo guardar la edición de la factura.'));
    } finally {
      setGuardando(false);
    }
  };

  return {
    campos, cambiar, elegirCliente, guardando, hayCambios, guardar,
    empresas, nombreCliente, monedaCliente, avisoMoneda, sugerenciasReemplazo,
    ops, monedaOps, monedaVista, plan, sumaOps, bloqueoSubtotal, documentosAgrupados: ids.length,
  };
}

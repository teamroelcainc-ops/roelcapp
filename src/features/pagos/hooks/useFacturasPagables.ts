// src/features/pagos/hooks/useFacturasPagables.ts
// ---------------------------------------------------------------------------
// ✅ V00452 — FACTURAS DE PAGOS EN VIVO. Antes, "Registrar Pago" descargaba TODAS las facturas
// (hasta 12,000, de 1,000 en 1,000 una tras otra) cada vez que se abría: 8–10 s. Ahora:
//   · un listener compartido por colección (useColeccionViva): se abre al entrar a Pagos, en
//     segundo plano, y sigue abierto 15 min después de salir;
//   · la primera vez muestra lo que ya está en la caché del navegador (IndexedDB) y se pone al
//     día con el servidor; después solo llegan los CAMBIOS (lecturas: una descarga por sesión,
//     no una por apertura);
//   · los saldos se actualizan solos al registrar, editar o eliminar un pago (también si lo hace
//     otra persona): ya no hace falta "Recargar".
// Con `consultasCanonicas` + `dineroPorServidor` (el servidor mantiene `abierta`) solo se
// escuchan las facturas abiertas.
// ---------------------------------------------------------------------------
import { useMemo } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import type { Query } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { obtenerVivo, reintentarVivo, useColeccionViva } from '../../../shared/data/coleccionesVivas';
import type { DocVivo } from '../../../shared/data/coleccionesVivas';
import { facturasMtto, facturasPagablesDe } from '../services/facturasPagables';
import type { FacturaPagable, MonedaEmpresa, PagoAplicado, TipoPago } from '../services/facturasPagables';

/** Tope de gastos MTTO que se agrupan (como antes). */
const LIMITE_GASTOS_MTTO = 3000;

interface Consulta { clave: string; crear: () => Query }

/** Consulta en vivo de las facturas (o gastos MTTO) de una pestaña de Pagos. */
export const consultaFacturasPagables = (tipo: TipoPago, soloAbiertas: boolean): Consulta => {
  if (tipo === 'mtto') {
    return {
      clave: 'pagos:gastos_mtto',
      crear: () => query(collection(db, 'gastos_mtto'), orderBy('createdAt', 'desc'), limit(LIMITE_GASTOS_MTTO)),
    };
  }
  const coleccion = tipo === 'cliente' ? 'facturas_clientes' : 'facturas_proveedores';
  return soloAbiertas
    ? { clave: `pagos:${coleccion}:abiertas`, crear: () => query(collection(db, coleccion), where('abierta', '==', true)) }
    : { clave: `pagos:${coleccion}`, crear: () => query(collection(db, coleccion)) };
};

export interface OpcionesFacturasPagables {
  /** false = no escuchar todavía (banderas sin cargar, o la pantalla aún no lo necesita). */
  activo: boolean;
  soloAbiertas: boolean;
  reglaUnica: boolean;
  monedaEmpresa: MonedaEmpresa;
  /** Pagos de la pestaña MTTO (su saldo se deriva de ellos). */
  pagosMtto: readonly PagoAplicado[];
}

export interface FacturasPagablesEstado {
  facturas: FacturaPagable[];
  /** Ya hay una lista (de la caché del navegador o del servidor). */
  listo: boolean;
  /** Confirmada por el servidor (saldos al día). */
  alDia: boolean;
  error: string | null;
  /** Vuelve a abrir el listener si murió por un error. */
  reintentar: () => void;
}

const convertir = (datos: readonly DocVivo[], tipo: TipoPago, o: Omit<OpcionesFacturasPagables, 'activo' | 'soloAbiertas'>): FacturaPagable[] =>
  tipo === 'mtto' ? facturasMtto(datos, o.pagosMtto) : facturasPagablesDe(datos, tipo, { reglaUnica: o.reglaUnica, monedaEmpresa: o.monedaEmpresa });

export function useFacturasPagables(tipo: TipoPago, o: OpcionesFacturasPagables): FacturasPagablesEstado {
  const { clave, crear } = consultaFacturasPagables(tipo, o.soloAbiertas);
  // avisarConfirmacion: "Guardar Pago" espera saldos confirmados por el servidor; sin esto, si la caché
  //   ya tenía todo y el servidor confirma sin cambios, la confirmación no se publicaba.
  const vivo = useColeccionViva(o.activo ? clave : null, crear, { avisarConfirmacion: true });
  const { reglaUnica, monedaEmpresa, pagosMtto } = o;
  const facturas = useMemo(
    () => convertir(vivo.datos, tipo, { reglaUnica, monedaEmpresa, pagosMtto: tipo === 'mtto' ? pagosMtto : [] }),
    [vivo.datos, tipo, reglaUnica, monedaEmpresa, pagosMtto],
  );
  return { facturas, listo: o.activo && vivo.listo, alDia: o.activo && vivo.delServidor, error: vivo.error, reintentar: () => reintentarVivo(clave) };
}

/**
 * Lo mismo fuera del render (reportes): usa el listener abierto o lo abre y espera la lista
 * CONFIRMADA por el servidor (máx. 2 min; sin red, lo que haya en la caché). Rechaza si no llegó nada.
 */
export async function obtenerFacturasPagables(tipo: TipoPago, o: Omit<OpcionesFacturasPagables, 'activo'>): Promise<FacturaPagable[]> {
  const { clave, crear } = consultaFacturasPagables(tipo, o.soloAbiertas);
  const datos = await obtenerVivo(clave, crear, 120000, { fresco: true });
  return convertir(datos, tipo, o);
}

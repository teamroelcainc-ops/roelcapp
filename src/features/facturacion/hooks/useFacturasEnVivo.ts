// src/features/facturacion/hooks/useFacturasEnVivo.ts
// ---------------------------------------------------------------------------
// ✅ V00497 — FACTURAS DE FACTURACIÓN EN VIVO (listener compartido).
//   Antes cada tablero (Clientes y Proveedores, que además bajaba las de clientes para el cruce)
//   descargaba TODAS las facturas al montar, una sola vez: con el módulo abierto desde ayer en otra
//   computadora se veía la lista de ayer (y se podía volver a facturar algo ya facturado), y cada
//   entrada costaba más de 12,000 lecturas por colección.
//   Ahora usan el MISMO listener que Pagos y Estadísticas (`pagos:facturas_clientes` /
//   `pagos:facturas_proveedores`, consultaFacturasPagables(lado, false)): la lista está siempre al
//   día, la primera vez sale de la caché del navegador y después solo llegan los cambios.
//
//   Parches locales: los tableros siguen aplicando a la lista lo que acaban de escribir
//   (`setFacturas(prev => …)`) para verlo al instante. Ese parche vale solo sobre la versión del
//   listener con la que se hizo: cuando el listener trae una nueva (que ya incluye lo escrito), el
//   parche se descarta y manda el servidor. No es una copia sincronizada con un efecto: la lista que
//   se muestra se calcula en el render (parche si es de la versión actual; si no, la del listener).
//   El parche nunca deja dos facturas con el mismo id: con una escritura desde la web, el listener ya
//   trae la factura nueva antes de que termine el commit y el parche la volvía a agregar (el Historial
//   la contaba doble y "Editar" escribía dos veces el mismo documento).
//
//   "Cargando" hasta que el SERVIDOR confirma la lista: la caché del navegador puede tener solo una
//   parte (p. ej. solo las facturas abiertas que usa Pagos) y con ella Pendientes saldría mal.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reintentarVivo, useColeccionViva } from '../../../shared/data/coleccionesVivas';
import type { DocVivo } from '../../../shared/data/coleccionesVivas';
import { avisar } from '../../../shared/data/avisos';
import { consultaFacturasPagables } from '../../pagos/hooks/useFacturasPagables';

const fechaDe = (f: unknown): string => String((f as { fecha?: unknown } | null)?.fecha ?? '');
const idDe = (f: unknown): string => String((f as { id?: unknown } | null)?.id ?? '');

/** Una sola fila por id (gana la primera: la que puso el parche). */
export const sinRepetidas = <T,>(lista: readonly T[]): T[] => {
  const vistos = new Set<string>();
  return lista.filter((f) => {
    const id = idDe(f);
    if (!id) return true;
    if (vistos.has(id)) return false;
    vistos.add(id);
    return true;
  });
};

/** Más recientes primero; las que no tienen fecha, al final (el orden de siempre del Historial). */
export const ordenarPorFechaDesc = <T,>(lista: T[]): T[] =>
  lista.sort((a, b) => {
    const fa = fechaDe(a);
    const fb = fechaDe(b);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return fb.localeCompare(fa);
  });

export interface FacturasEnVivo<T> {
  facturas: T[];
  /** Parche local inmediato de lo recién escrito (se descarta con la siguiente versión del listener). */
  setFacturas: (cambio: (prev: T[]) => T[]) => void;
  /** Aún no llega la lista confirmada por el servidor (y no hubo error). */
  cargando: boolean;
  /** Confirmada por el servidor. */
  alDia: boolean;
  error: string | null;
  /** Vuelve a abrir el listener si murió por un error. */
  reintentar: () => void;
}

/**
 * @param normalizar Debe ser estable (definida fuera del componente): se aplica a cada factura cuando
 *   llega una versión nueva del listener.
 */
export function useFacturasEnVivo<T>(lado: 'cliente' | 'proveedor', normalizar: (raw: DocVivo) => T): FacturasEnVivo<T> {
  const { clave, crear } = consultaFacturasPagables(lado, false);
  const vivo = useColeccionViva(clave, crear, { avisarConfirmacion: true });
  const base = useMemo(() => ordenarPorFechaDesc(vivo.datos.map(normalizar)), [vivo.datos, normalizar]);

  const [parche, setParche] = useState<{ base: T[]; lista: T[] } | null>(null);
  const baseRef = useRef(base);
  useEffect(() => { baseRef.current = base; }, [base]);
  const setFacturas = useCallback((cambio: (prev: T[]) => T[]) => {
    setParche((p) => {
      const actual = baseRef.current;
      return { base: actual, lista: sinRepetidas(cambio(p && p.base === actual ? p.lista : actual)) };
    });
  }, []);

  const avisado = useRef<string | null>(null);
  useEffect(() => {
    if (!vivo.error || avisado.current === vivo.error) return;
    avisado.current = vivo.error;
    avisar({
      tipo: 'alerta',
      titulo: lado === 'cliente' ? 'Facturas de clientes' : 'Facturas de proveedores',
      texto: `No se pudieron leer las facturas (${vivo.error}). Presiona Refrescar para intentar de nuevo.`,
    });
  }, [vivo.error, lado]);

  return {
    facturas: parche && parche.base === base ? parche.lista : base,
    setFacturas,
    cargando: !vivo.delServidor && !vivo.error,
    alDia: vivo.delServidor,
    error: vivo.error,
    reintentar: () => reintentarVivo(clave),
  };
}

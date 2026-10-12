// src/features/nominas/services/useNominas.ts
// ---------------------------------------------------------------------------
// ✅ Fase 1.8b — Listeners de Referencias de Nómina.
//   · useNominasPaginadas: historial ordenado por fecha de pago, ventana en
//     vivo + "Cargar más" con cursor (startAfter).
//   · useHistorialNominasOperador: TODAS las nóminas de un operador (base de
//     los saldos de préstamo y ahorro), sin depender de la ventana anterior.
// ---------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import type { QueryDocumentSnapshot, QuerySnapshot } from 'firebase/firestore';
import {
  aDocNomina, consultaNominasLegado, consultaNominasPorOperadorId, consultaNominasPorOperadorNombre,
  consultaNominasRecientes, leerHuecoNominas, leerPaginaNominas,
} from './nominasService';
import { TAM_PAGINA_NOMINAS, ordenarNominasRecientes, tieneFechaPagoCanonica, unirNominasPorId } from './reglasNomina';
import type { DocNomina } from './reglasNomina';

interface FilaAnterior {
  snap: QueryDocumentSnapshot;
  datos: DocNomina;
}

const aFila = (d: QueryDocumentSnapshot): FilaAnterior => ({ snap: d, datos: aDocNomina(d) });

const unirFilas = (a: readonly FilaAnterior[], b: readonly FilaAnterior[]): FilaAnterior[] => {
  const vistos = new Set<string>();
  return [...a, ...b].filter(f => (vistos.has(f.snap.id) ? false : (vistos.add(f.snap.id), true)));
};

export interface NominasPaginadas {
  /** Ventana en vivo + páginas de "Cargar más" + heredadas sin fechaPago AAAA-MM-DD; sin repetidos, más recientes primero. */
  nominas: DocNomina[];
  /** ✅ V00449: ya llegó la primera respuesta del listener (o falló): antes de eso, una lista vacía no es "no hay nóminas". */
  listo: boolean;
  /** Puede haber nóminas más antiguas que las cargadas. */
  hayMas: boolean;
  cargandoMas: boolean;
  /** Carga la página siguiente; lanza el error de Firestore si falla. */
  cargarMas: () => Promise<void>;
  /** Refleja un cambio local en las páginas de "Cargar más" (no tienen listener). */
  parchearNomina: (id: string, cambios: Record<string, unknown>) => void;
  /** Quita una nómina eliminada de las páginas de "Cargar más". */
  quitarNomina: (id: string) => void;
}

export function useNominasPaginadas(tamPagina: number = TAM_PAGINA_NOMINAS): NominasPaginadas {
  const [recientes, setRecientes] = useState<QueryDocumentSnapshot[]>([]);
  const [anteriores, setAnteriores] = useState<FilaAnterior[]>([]);
  // null = todavía no se pidió ninguna página anterior.
  const [hayMasAnteriores, setHayMasAnteriores] = useState<boolean | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [listo, setListo] = useState(false); // ✅ V00449
  // PENDIENTE Fase 4: quitar cuando migrarEsquemaV2 rellene fechaPago
  const [legado, setLegado] = useState<DocNomina[]>([]);
  // Copias para los callbacks de Firestore (se actualizan junto con el estado).
  const anterioresRef = useRef<FilaAnterior[]>([]);
  const ultimoVivoIdRef = useRef<string | null>(null);

  const cambiarAnteriores = useCallback((fn: (prev: FilaAnterior[]) => FilaAnterior[]) => {
    const siguiente = fn(anterioresRef.current);
    anterioresRef.current = siguiente;
    setAnteriores(siguiente);
  }, []);

  useEffect(() => {
    const bajaPrincipal = onSnapshot(consultaNominasRecientes(tamPagina), (snap) => {
      setRecientes(snap.docs);
      setListo(true);
      const ultimo = snap.docs[snap.docs.length - 1];
      const cambioUltimo = (ultimo?.id ?? null) !== ultimoVivoIdRef.current;
      ultimoVivoIdRef.current = ultimo?.id ?? null;
      // Si llegaron nóminas nuevas arriba, las últimas de la ventana salen de
      // ella; si ya hay páginas de "Cargar más", se recuperan las que quedaron
      // entre ambas para que no desaparezcan de la lista.
      const ant = anterioresRef.current;
      if (!ultimo || !cambioUltimo || ant.length === 0 || snap.size < tamPagina) return;
      if (ant.some(a => a.snap.id === ultimo.id)) return;
      leerHuecoNominas(ultimo, ant[0].snap)
        .then(r => { if (!r.empty) cambiarAnteriores(prev => unirFilas(r.docs.map(aFila), prev)); })
        .catch((err: unknown) => console.warn('[Nómina] No se pudo completar el historial entre páginas:', err));
    }, (err) => { console.error('[Nómina] Error escuchando referencias_nomina:', err); setListo(true); });
    // PENDIENTE Fase 4: quitar cuando migrarEsquemaV2 rellene fechaPago
    //   Segundo listener = la consulta ORIGINAL (limit sin orderBy). Solo aporta
    //   las nóminas migradas sin fechaPago AAAA-MM-DD, que la consulta ordenada
    //   excluye (campo ausente) o manda al final (Timestamp); mismo ciclo de vida.
    const bajaLegado = onSnapshot(consultaNominasLegado(tamPagina), (snap) => {
      setLegado(snap.docs.map(aDocNomina).filter(n => !tieneFechaPagoCanonica(n)));
    }, (err) => console.error('[Nómina] Error escuchando referencias_nomina (heredadas):', err));
    return () => { bajaPrincipal(); bajaLegado(); };
  }, [tamPagina, cambiarAnteriores]);

  const cargarMas = useCallback(async () => {
    const ant = anterioresRef.current;
    const cursor = ant.length > 0 ? ant[ant.length - 1].snap : recientes[recientes.length - 1];
    if (!cursor) return;
    setCargandoMas(true);
    try {
      const pagina = await leerPaginaNominas(cursor, tamPagina);
      cambiarAnteriores(prev => unirFilas(prev, pagina.docs.map(aFila)));
      setHayMasAnteriores(pagina.size >= tamPagina);
    } finally {
      setCargandoMas(false);
    }
  }, [recientes, tamPagina, cambiarAnteriores]);

  const parchearNomina = useCallback((id: string, cambios: Record<string, unknown>) => {
    cambiarAnteriores(prev => (prev.some(f => f.datos.id === id)
      ? prev.map(f => (f.datos.id === id ? { ...f, datos: { ...f.datos, ...cambios, id } } : f))
      : prev));
  }, [cambiarAnteriores]);

  const quitarNomina = useCallback((id: string) => {
    cambiarAnteriores(prev => (prev.some(f => f.datos.id === id) ? prev.filter(f => f.datos.id !== id) : prev));
  }, [cambiarAnteriores]);

  // Orden en pantalla: el mismo criterio cliente que usaba el módulo (ver ordenarNominasRecientes).
  const nominas = useMemo(
    () => ordenarNominasRecientes(unirNominasPorId(recientes.map(aDocNomina), anteriores.map(f => f.datos), legado)),
    [recientes, anteriores, legado],
  );

  return {
    nominas,
    listo,
    hayMas: hayMasAnteriores ?? recientes.length >= tamPagina,
    cargandoMas,
    cargarMas,
    parchearNomina,
    quitarNomina,
  };
}

interface ParteHistorial {
  docs: DocNomina[];
  /** El snapshot ya está confirmado por el servidor (no solo la caché local). */
  delServidor: boolean;
}

interface EstadoHistorial {
  clave: string;
  porId: ParteHistorial | null;
  porNombre: ParteHistorial | null;
  error: boolean;
}

const estadoVacio = (clave: string): EstadoHistorial => ({ clave, porId: null, porNombre: null, error: false });

export interface HistorialOperador {
  /** Todas las nóminas del operador (operadorId == id  Ó  operadorNombre == nombre). */
  historial: DocNomina[];
  /** Ambas consultas llegaron confirmadas por el servidor: el historial está completo. */
  listo: boolean;
  error: boolean;
}

/**
 * Historial COMPLETO de un operador, en vivo. Es la base del saldo de préstamo
 * y ahorro (inicial + otorgado − pagado de TODAS sus nóminas), así que no usa
 * limit; `listo` solo se enciende con datos del servidor, para no guardar
 * saldos calculados con una caché parcial.
 */
export function useHistorialNominasOperador(operadorId: string, operadorNombre: string): HistorialOperador {
  const clave = `${operadorId}␟${operadorNombre}`;
  const [estado, setEstado] = useState<EstadoHistorial>(() => estadoVacio(''));

  useEffect(() => {
    if (!operadorId && !operadorNombre) return;
    const actualizar = (cambio: Partial<Omit<EstadoHistorial, 'clave'>>) =>
      setEstado(prev => ({ ...(prev.clave === clave ? prev : estadoVacio(clave)), ...cambio }));
    const parte = (snap: QuerySnapshot): ParteHistorial => ({
      docs: snap.docs.map(aDocNomina),
      delServidor: !snap.metadata.fromCache,
    });
    const alError = (err: unknown) => {
      console.error('[Nómina] Error leyendo el historial del operador:', err);
      actualizar({ error: true });
    };
    const bajas: Array<() => void> = [];
    if (operadorId) {
      bajas.push(onSnapshot(consultaNominasPorOperadorId(operadorId), { includeMetadataChanges: true },
        snap => actualizar({ porId: parte(snap) }), alError));
    }
    if (operadorNombre) {
      bajas.push(onSnapshot(consultaNominasPorOperadorNombre(operadorNombre), { includeMetadataChanges: true },
        snap => actualizar({ porNombre: parte(snap) }), alError));
    }
    return () => bajas.forEach(baja => baja());
  }, [clave, operadorId, operadorNombre]);

  const vigente = estado.clave === clave;
  const porId = vigente ? estado.porId : null;
  const porNombre = vigente ? estado.porNombre : null;
  const historial = useMemo(() => unirNominasPorId(porId?.docs, porNombre?.docs), [porId, porNombre]);
  const listo = (!!operadorId || !!operadorNombre)
    && (!operadorId || !!porId?.delServidor)
    && (!operadorNombre || !!porNombre?.delServidor);

  return { historial, listo, error: vigente && estado.error };
}

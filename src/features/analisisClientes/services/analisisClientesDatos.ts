// src/features/analisisClientes/services/analisisClientesDatos.ts
// ✅ V00479 — operaciones del periodo para el análisis de clientes: UNA lectura por rango de fecha
// (fechaServicioISO con `consultasCanonicas`; si no, fechaServicio, igual que Estadísticas).
// La pantalla la guarda con TanStack Query: volver al módulo no vuelve a leer.
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { obtenerFlags } from '../../../shared/data/flags';
import type { Periodo } from './analisisClientes';

export type DocOperacion = Record<string, unknown> & { id: string };

export const CLAVE_ANALISIS_CLIENTES = ['analisisClientes', 'operaciones'] as const;

export const leerOperacionesDelPeriodo = async (periodo: Periodo): Promise<DocOperacion[]> => {
  const campo = (await obtenerFlags()).consultasCanonicas ? 'fechaServicioISO' : 'fechaServicio';
  const snap = await getDocs(query(collection(db, 'operaciones'), where(campo, '>=', periodo.inicio), where(campo, '<=', periodo.fin)));
  // El id del DOCUMENTO al final: un campo `id` guardado (AppSheet) no lo pisa.
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
};

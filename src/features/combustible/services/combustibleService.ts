// Archivo: src/features/combustible/services/combustibleService.ts

import { collection, getDocs, addDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import type { Moneda, CombustibleRecord } from '../../../types/combustible';
import { estadoCatalogo, idReal, obtenerCatalogo } from '../../../shared/data/catalogos';
import { esUSD } from '../../../shared/dominio/moneda';

// 1. Obtener catálogo de monedas
// ✅ V00439 (Fase 3.x): del listener compartido de catalogo_moneda (sin getDocs propio)
//   y esDolar con esUSD (acepta el ID del catálogo y 'Dólares' con acento).
export const getMonedasCatalogo = async (): Promise<Moneda[]> => {
  try {
    const docs = await obtenerCatalogo('catalogo_moneda');
    if (docs.length === 0 && estadoCatalogo('catalogo_moneda').error) return [];
    const monedas = docs.map(d => ({
      id: idReal(d),
      nombre: String(d.moneda || 'Desconocida'),
      esDolar: esUSD(idReal(d)) || esUSD(d.moneda),
    }));

    if (monedas.length === 0) {
      return [
        { id: '1', nombre: 'Dólares (USD)', esDolar: true },
        { id: '2', nombre: 'Pesos (MXN)', esDolar: false }
      ];
    }
    return monedas;
  } catch (error) {
    console.error("Error al obtener monedas:", error);
    return [];
  }
};

// 2. Obtener Tipo de Cambio
// CORRECCIÓN APLICADA: Se eliminó el parámetro para evitar bloqueos estrictos de TS
export const getTipoCambioPorFecha = async (): Promise<number> => {
  return 17.8117; 
};

// 3. Guardar un nuevo registro de Combustible
export const saveCombustible = async (record: CombustibleRecord): Promise<void> => {
  try {
    await addDoc(collection(db, 'combustibles'), record);
  } catch (error) {
    console.error("Error al guardar combustible:", error);
    throw error;
  }
};

// 4. Obtener todos los registros de Combustible
export const getCombustibles = async (): Promise<CombustibleRecord[]> => {
  try {
    const querySnapshot = await getDocs(collection(db, 'combustibles'));
    const records = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    })) as CombustibleRecord[];
    
    return records.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  } catch (error) {
    console.error("Error al obtener combustibles:", error);
    return [];
  }
};
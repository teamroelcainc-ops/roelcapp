// src/hooks/useEstadoConexion.ts
// Estado de la conexión a internet (online/offline) con suscripción a los
// eventos del navegador. Para lógica preventiva en formularios: deshabilitar
// Guardar, avisar al usuario, etc.
import { useSyncExternalStore } from 'react';

const suscribir = (notificar: () => void) => {
  window.addEventListener('online', notificar);
  window.addEventListener('offline', notificar);
  return () => {
    window.removeEventListener('online', notificar);
    window.removeEventListener('offline', notificar);
  };
};

const leer = () => navigator.onLine;

export function useEstadoConexion(): { enLinea: boolean } {
  const enLinea = useSyncExternalStore(suscribir, leer, () => true);
  return { enLinea };
}

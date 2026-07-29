// src/stores/useNavMovilStore.ts
// Estado global (Zustand) de la BARRA DE NAVEGACIÓN INFERIOR móvil: qué
// accesos directos muestra. Se persiste en localStorage por dispositivo.
import { create } from 'zustand';

const LS_KEY = 'roelca_nav_movil_v1';
export const MAX_ITEMS_NAV = 4;

const leerInicial = (): string[] => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const arr: unknown = JSON.parse(raw);
      if (Array.isArray(arr) && arr.every((x) => typeof x === 'string') && arr.length > 0) {
        return arr.slice(0, MAX_ITEMS_NAV);
      }
    }
  } catch { /* almacenamiento bloqueado o corrupto: usar el default */ }
  return ['operaciones', 'serviciosCompletados', 'serviciosCancelados'];
};

interface NavMovilStore {
  items: string[];
  setItems: (items: string[]) => void;
}

export const useNavMovilStore = create<NavMovilStore>((set) => ({
  items: leerInicial(),
  setItems: (items) => {
    const recortados = items.slice(0, MAX_ITEMS_NAV);
    try { localStorage.setItem(LS_KEY, JSON.stringify(recortados)); } catch { /* ignorar */ }
    set({ items: recortados });
  },
}));

// src/contexts/EtiquetasContext.tsx
// ---------------------------------------------------------------------------
// ✅ ETIQUETAS PERSONALIZABLES: nombres de los apartados/subapartados del menú
//   y de columnas, editables desde Configuración → Etiquetas (con permiso).
//   Las personalizaciones viven en Firestore `settings_ui/etiquetas` como un
//   mapa { clave: texto } y se aplican en vivo (onSnapshot) a toda la app.
//   Uso: const { etq } = useEtiquetas(); etq('menu.operaciones', 'Operaciones')
// ---------------------------------------------------------------------------
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../config/firebase';

interface EtiquetasContexto {
  overrides: Record<string, string>;
  etq: (clave: string, porDefecto: string) => string;
  guardarEtiquetas: (cambios: Record<string, string>) => Promise<void>;
  cargado: boolean;
}

const Contexto = createContext<EtiquetasContexto>({
  overrides: {},
  etq: (_c, d) => d,
  guardarEtiquetas: async () => { /* noop hasta montar el provider */ },
  cargado: false,
});

export const EtiquetasProvider = ({ children }: { children: ReactNode }) => {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings_ui', 'etiquetas'), (snap) => {
      const data = snap.exists() ? (snap.data() as Record<string, unknown>) : {};
      const limpio: Record<string, string> = {};
      Object.entries(data).forEach(([k, v]) => {
        if (typeof v === 'string' && v.trim()) limpio[k] = v;
      });
      setOverrides(limpio);
      setCargado(true);
    }, (err) => {
      console.warn('No se pudieron cargar las etiquetas personalizadas:', err);
      setCargado(true);
    });
    return unsub;
  }, []);

  const etq = (clave: string, porDefecto: string) => overrides[clave] || porDefecto;

  const guardarEtiquetas = async (cambios: Record<string, string>) => {
    // Los textos vacíos regresan la etiqueta a su valor por defecto.
    await setDoc(doc(db, 'settings_ui', 'etiquetas'), cambios, { merge: true });
  };

  return (
    <Contexto.Provider value={{ overrides, etq, guardarEtiquetas, cargado }}>
      {children}
    </Contexto.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- hook acompañante del provider.
export const useEtiquetas = () => useContext(Contexto);

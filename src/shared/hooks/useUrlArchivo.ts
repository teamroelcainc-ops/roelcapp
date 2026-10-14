// src/shared/hooks/useUrlArchivo.ts
// ✅ V00451: URL local (blob:) de un archivo elegido, para verlo antes de subirlo. Se libera cuando
//   deja de usarse; con el retraso, el doble montaje de StrictMode (desarrollo) no la libera
//   mientras se ve.
import { useEffect, useMemo, useRef } from 'react';

export function useUrlArchivo(file: File | null): string {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  const enUsoRef = useRef('');
  useEffect(() => {
    enUsoRef.current = url;
    return () => {
      enUsoRef.current = '';
      setTimeout(() => { if (url && enUsoRef.current !== url) URL.revokeObjectURL(url); }, 0);
    };
  }, [url]);
  return url;
}

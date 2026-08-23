// src/hooks/useEstadoPersistente.ts
// useState respaldado en localStorage: el valor sobrevive recargas y regresos
// al módulo. Uso: const [filtro, setFiltro] = useEstadoPersistente('modulo_filtro', '').
import { useState, useEffect } from 'react';

export function useEstadoPersistente<T>(clave: string, valorInicial: T) {
  const [valor, setValor] = useState<T>(() => {
    try {
      const guardado = localStorage.getItem(`persist_${clave}`);
      return guardado !== null ? (JSON.parse(guardado) as T) : valorInicial;
    } catch {
      return valorInicial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(`persist_${clave}`, JSON.stringify(valor));
    } catch { /* sin espacio: el estado sigue funcionando en memoria */ }
  }, [clave, valor]);

  return [valor, setValor] as const;
}

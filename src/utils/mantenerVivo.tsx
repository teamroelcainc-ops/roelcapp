// src/utils/mantenerVivo.tsx
// ---------------------------------------------------------------------------
// ✅ V00264: MANTENER VIVO — los módulos pesados NO se desmontan al navegar:
//   la primera visita los monta y al cambiar de módulo solo se OCULTAN
//   (display:none). Al regresar, la tabla aparece AL INSTANTE tal cual quedó:
//   mismos filtros, misma búsqueda, misma página — sin recargar ni re-filtrar.
//   El contexto (moduloVivoContexto) expone si el módulo está visible, para
//   que utilidades como el buscador global sepan cuál es el módulo ACTIVO.
// ---------------------------------------------------------------------------
import React, { useEffect, useState } from 'react';
import { ContextoModuloVivoActivo } from './moduloVivoContexto';

export const MantenerVivo: React.FC<{ activo: boolean; children: React.ReactNode }> = ({ activo, children }) => {
  const [montado, setMontado] = useState(activo);
  useEffect(() => {
    // Cerrojo de una sola vía: la PRIMERA activación monta y ya no se desmonta.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cerrojo intencional; corre una única vez al activarse
    if (activo) setMontado(true);
  }, [activo]);
  if (!montado) return null; // nunca visitado: no cuesta nada
  return (
    <ContextoModuloVivoActivo.Provider value={activo}>
      <div className={activo ? 'modulo-vivo' : 'modulo-vivo modulo-vivo--oculto'}>{children}</div>
    </ContextoModuloVivoActivo.Provider>
  );
};

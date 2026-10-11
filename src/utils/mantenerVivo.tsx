// src/utils/mantenerVivo.tsx
// ---------------------------------------------------------------------------
// ✅ V00264: MANTENER VIVO — los módulos pesados NO se desmontan al navegar:
//   la primera visita los monta y al cambiar de módulo solo se OCULTAN
//   (display:none). Al regresar, la tabla aparece AL INSTANTE tal cual quedó:
//   mismos filtros, misma búsqueda, misma página — sin recargar ni re-filtrar.
//   El contexto (moduloVivoContexto) expone si el módulo está visible, para
//   que utilidades como el buscador global sepan cuál es el módulo ACTIVO.
// ---------------------------------------------------------------------------
import React, { Suspense, useEffect, useState } from 'react';
import { ContextoModuloEscuchando, ContextoModuloVivoActivo, MINUTOS_GRACIA_ESCUCHA } from './moduloVivoContexto';
import CargandoModulo from '../components/layout/CargandoModulo';

// ✅ V00447: `siempreEscuchando` — el módulo de inicio (Operaciones Activas) no cierra sus
//   listeners al ocultarse, como antes de la V00438: es al que más se regresa y reabrirlos
//   después de 30 min obligaba a bajar todo otra vez (tarjetas de casetas y diésel).
export const MantenerVivo: React.FC<{ activo: boolean; siempreEscuchando?: boolean; children: React.ReactNode }> = ({ activo, siempreEscuchando = false, children }) => {
  const [montado, setMontado] = useState(activo);
  useEffect(() => {
    // Cerrojo de una sola vía: la PRIMERA activación monta y ya no se desmonta.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cerrojo intencional; corre una única vez al activarse
    if (activo) setMontado(true);
  }, [activo]);
  // ✅ V00446: oculto, sus listeners siguen escuchando MINUTOS_GRACIA_ESCUCHA (ver contexto).
  const [graciaVencida, setGraciaVencida] = useState(false);
  useEffect(() => {
    if (activo) return undefined;
    const t = setTimeout(() => setGraciaVencida(true), MINUTOS_GRACIA_ESCUCHA * 60 * 1000);
    return () => { clearTimeout(t); setGraciaVencida(false); };
  }, [activo]);
  const escuchando = activo || siempreEscuchando || !graciaVencida;
  if (!montado) return null; // nunca visitado: no cuesta nada
  return (
    <ContextoModuloEscuchando.Provider value={escuchando}>
    <ContextoModuloVivoActivo.Provider value={activo}>
      {/* ✅ V00438 (Fase 2.10): Suspense propio — la primera carga de este módulo ya
          no reemplaza por "Cargando…" a los demás módulos vivos. */}
      <div className={activo ? 'modulo-vivo' : 'modulo-vivo modulo-vivo--oculto'}>
        <Suspense fallback={<CargandoModulo />}>{children}</Suspense>
      </div>
    </ContextoModuloVivoActivo.Provider>
    </ContextoModuloEscuchando.Provider>
  );
};

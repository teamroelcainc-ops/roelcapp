// src/features/autorizaciones/useAutorizacionesCampos.ts
// ✅ V00140: hook genérico para que CUALQUIER formulario respete Autorizaciones.
//   · campoBloqueado(k): true si el campo está controlado para el rol del usuario.
//   · propsBloqueo(k):   props listas para el input (disabled + title + clase).
//   · verificarAccion(): al guardar/crear/borrar, evalúa las reglas de acción y
//     de campos modificados; si requieren autorización, avisa y bloquea.
//   Los Admin siempre están exentos (mismo criterio que Operaciones).
import { useEffect, useMemo, useState } from 'react';
import {
  cargarConfigModulo, evaluarAutorizacion, obtenerUsuarioAut,
  MODULOS_AUTORIZABLES, type AccionAut, type ConfigModuloAut,
} from './autorizaciones';

export const useAutorizacionesCampos = (moduloClave: string) => {
  const [config, setConfig] = useState<ConfigModuloAut | null | undefined>(undefined);
  const [usuario, setUsuario] = useState<{ uid: string; nombre: string; roles: string[]; esAdmin: boolean } | null>(null);

  useEffect(() => {
    let activo = true;
    cargarConfigModulo(moduloClave).then((c) => { if (activo) setConfig(c); }).catch(() => { if (activo) setConfig(null); });
    obtenerUsuarioAut().then((u) => { if (activo) setUsuario(u); }).catch(() => { if (activo) setUsuario(null); });
    return () => { activo = false; };
  }, [moduloClave]);

  const etiquetas = useMemo(() => {
    const m = MODULOS_AUTORIZABLES.find((x) => x.clave === moduloClave);
    const map: Record<string, string> = {};
    (m?.campos || []).forEach((c) => { map[c.key] = c.label; });
    return map;
  }, [moduloClave]);

  const camposBloqueados = useMemo(() => {
    if (!config || !usuario || usuario.esAdmin) return new Set<string>();
    const claves = Object.keys(config.campos || {});
    const r = evaluarAutorizacion(config, 'editar', usuario, claves, etiquetas);
    return new Set(r.camposControlados);
  }, [config, usuario, etiquetas]);

  const campoBloqueado = (k: string) => camposBloqueados.has(k);
  const propsBloqueo = (k: string) => campoBloqueado(k)
    ? { disabled: true, title: `El campo "${etiquetas[k] || k}" está bloqueado por Autorizaciones para tu rol.` }
    : {};

  /** Evalúa una acción al guardar. Si requiere autorización, muestra el motivo y regresa false. */
  const verificarAccion = (accion: AccionAut, camposModificados: string[] = []): boolean => {
    if (!usuario) return true; // sin sesión resuelta aún: no bloquear
    const r = evaluarAutorizacion(config ?? null, accion, usuario, camposModificados, etiquetas);
    if (!r.requiere) return true;
    alert(`⛔ Esta acción requiere autorización de un Administrador:\n\n· ${r.motivos.join('\n· ')}\n\nPídele a un Admin que realice el cambio o ajuste las reglas en Configuración → Autorizaciones.`);
    return false;
  };

  return { cargado: config !== undefined && usuario !== null, esAdmin: !!usuario?.esAdmin, campoBloqueado, propsBloqueo, verificarAccion, camposBloqueados };
};

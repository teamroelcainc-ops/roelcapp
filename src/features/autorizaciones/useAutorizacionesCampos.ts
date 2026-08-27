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
  MODULOS_AUTORIZABLES, crearSolicitudAccesoCampo, cargarAccesosCampoVigentes,
  type AccionAut, type ConfigModuloAut,
} from './autorizaciones';

export const useAutorizacionesCampos = (moduloClave: string) => {
  const [config, setConfig] = useState<ConfigModuloAut | null | undefined>(undefined);
  const [usuario, setUsuario] = useState<{ uid: string; nombre: string; roles: string[]; esAdmin: boolean } | null>(null);
  // ✅ V00141: accesos temporales aprobados (Solicitar autorización → aprobada)
  const [accesosVigentes, setAccesosVigentes] = useState<Set<string>>(new Set());
  // ✅ V00141: modal "No tienes acceso para modificar este campo"
  const [solicitudCampo, setSolicitudCampo] = useState<string>('');
  const [solicitudEnviando, setSolicitudEnviando] = useState(false);
  const [solicitudEnviada, setSolicitudEnviada] = useState(false);
  const [contextoRegistro, setContextoRegistro] = useState<{ docId?: string; referencia?: string }>({});

  useEffect(() => {
    let activo = true;
    cargarConfigModulo(moduloClave).then((c) => { if (activo) setConfig(c); }).catch(() => { if (activo) setConfig(null); });
    obtenerUsuarioAut().then(async (u) => {
      if (!activo) return;
      setUsuario(u);
      if (u && !u.esAdmin) {
        const acc = await cargarAccesosCampoVigentes(u.uid);
        if (activo) setAccesosVigentes(acc[moduloClave] || new Set());
      }
    }).catch(() => { if (activo) setUsuario(null); });
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
    // ✅ V00141: un acceso aprobado y vigente destapa el campo para este usuario
    return new Set(r.camposControlados.filter((k) => !accesosVigentes.has(k)));
  }, [config, usuario, etiquetas, accesosVigentes]);

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

  /** ✅ V00141: abre el modal "No tienes acceso…" para un campo bloqueado. */
  const abrirSolicitudAcceso = (campo: string, ctx?: { docId?: string; referencia?: string }) => {
    setSolicitudCampo(campo); setSolicitudEnviada(false);
    if (ctx) setContextoRegistro(ctx);
  };
  const cerrarSolicitudAcceso = () => { setSolicitudCampo(''); setSolicitudEnviada(false); };
  const enviarSolicitudAcceso = async () => {
    if (!solicitudCampo || solicitudEnviando) return;
    setSolicitudEnviando(true);
    try {
      const m = MODULOS_AUTORIZABLES.find((x) => x.clave === moduloClave);
      await crearSolicitudAccesoCampo({
        modulo: moduloClave, moduloLabel: m?.label || moduloClave, coleccion: m?.coleccion || moduloClave,
        campo: solicitudCampo, campoLabel: etiquetas[solicitudCampo] || solicitudCampo,
        docId: contextoRegistro.docId, referencia: contextoRegistro.referencia,
      });
      setSolicitudEnviada(true);
    } catch (e: any) {
      alert(`No se pudo enviar la solicitud: ${e?.message || e}`);
    } finally { setSolicitudEnviando(false); }
  };

  return {
    cargado: config !== undefined && usuario !== null, esAdmin: !!usuario?.esAdmin,
    campoBloqueado, propsBloqueo, verificarAccion, camposBloqueados,
    etiquetas, abrirSolicitudAcceso, cerrarSolicitudAcceso, enviarSolicitudAcceso,
    solicitudCampo, solicitudEnviando, solicitudEnviada, setContextoRegistro,
  };
};

export type CtrlAutorizaciones = ReturnType<typeof useAutorizacionesCampos>;

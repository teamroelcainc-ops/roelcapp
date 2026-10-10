// src/features/formularios/configFormularios.ts
// ============================================================================
// ✅ V00385: CONFIGURACIÓN DE FORMULARIOS (compartida para todos los usuarios)
//
//   config_formularios/{modulo} → { campos: { [clave]: CampoFormCfg }, ... }
//     · etiquetaOriginal : el texto con el que el campo nace en el código
//     · etiqueta         : nombre personalizado ('' = el original)
//     · orden            : posición dentro de su sección (vacío = la natural)
//     · oculto           : oculto para TODOS (el editor lo sigue mostrando)
//     · obligatorio      : no se puede guardar el formulario con el campo vacío
//     · rolesVisibles    : roles que lo VEN ([] = todos). Admin siempre lo ve.
//     · indice           : orden en que se descubrió (para listarlo en Autorizaciones)
//
//   Los campos se DESCUBREN solos: al abrir un formulario envuelto en
//   <FormularioConfigurable>, cada etiqueta con su control se registra aquí.
// ============================================================================
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { useEsAdmin, usePermisoRol } from '../../shared/data/sesion';
import { useUsuarioStore } from '../../stores/useUsuarioStore';

export interface CampoFormCfg {
  etiquetaOriginal?: string;
  etiqueta?: string;
  orden?: number | null;
  oculto?: boolean;
  obligatorio?: boolean;
  rolesVisibles?: string[];
  indice?: number;
}

export interface ConfigFormulario {
  campos: Record<string, CampoFormCfg>;
}

export const COL_CONFIG_FORMULARIOS = 'config_formularios';
export const PERMISO_EDITAR_FORMULARIOS = 'Editar Formularios';

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

/** Clave estable a partir del texto original de la etiqueta. */
export const claveDeEtiqueta = (texto: string): string =>
  String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\*/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'campo';

/** ¿El usuario ve el campo? Admin siempre; sin roles = todos. */
export const campoVisiblePara = (cfg: CampoFormCfg | undefined, usuario: { roles: string[]; esAdmin: boolean } | null): boolean => {
  if (!cfg) return true;
  if (!usuario || usuario.esAdmin) return true;
  const objetivo = (cfg.rolesVisibles || []).filter(Boolean);
  if (objetivo.length === 0) return true;
  const set = new Set(objetivo.map(norm));
  return (usuario.roles || []).some((r) => set.has(norm(r)));
};

/** Config en vivo de un formulario. */
export const useConfigFormulario = (modulo: string) => {
  const [config, setConfig] = useState<ConfigFormulario>({ campos: {} });
  const [cargada, setCargada] = useState(false);
  useEffect(() => {
    if (!modulo) return;
    const unsub = onSnapshot(doc(db, COL_CONFIG_FORMULARIOS, modulo), (snap) => {
      const x = (snap.exists() ? snap.data() : {}) as { campos?: Record<string, CampoFormCfg> };
      setConfig({ campos: x.campos || {} });
      setCargada(true);
    }, () => setCargada(true));
    return () => unsub();
  }, [modulo]);
  return { config, cargada };
};

/** Todas las configs (para Autorizaciones). */
export const useConfigsFormularios = () => {
  const [configs, setConfigs] = useState<Record<string, ConfigFormulario>>({});
  useEffect(() => {
    const unsub = onSnapshot(collection(db, COL_CONFIG_FORMULARIOS), (snap) => {
      const out: Record<string, ConfigFormulario> = {};
      snap.docs.forEach((d) => { out[d.id] = { campos: ((d.data() as { campos?: Record<string, CampoFormCfg> }).campos) || {} }; });
      setConfigs(out);
    }, () => {});
    return () => unsub();
  }, []);
  return configs;
};

/** Guarda (merge profundo) cambios de campos de un formulario. */
export const guardarCamposFormulario = async (modulo: string, campos: Record<string, CampoFormCfg>): Promise<void> => {
  const limpio: Record<string, CampoFormCfg> = {};
  Object.entries(campos).forEach(([k, v]) => {
    const c: Record<string, unknown> = {};
    Object.entries(v || {}).forEach(([ck, cv]) => { if (cv !== undefined) c[ck] = cv; });
    limpio[k] = c as CampoFormCfg;
  });
  await setDoc(doc(db, COL_CONFIG_FORMULARIOS, modulo), { campos: limpio, actualizadoEn: new Date().toISOString() }, { merge: true });
};

/** Usuario actual + si puede usar el editor de formularios (Admin o permiso del rol).
 *  ✅ V00439 (Fase 3.x): desde la sesión (useUsuarioStore + catálogo de roles en
 *  vivo); ya no relee usuarios/{uid} ni la colección `roles` (ni su caché de 60 s).
 *  `usuario` es null mientras la sesión no está publicada (igual que antes al cargar). */
export const usePermisoFormularios = () => {
  const haySesion = useUsuarioStore((s) => s.usuario !== null);
  const roles = useUsuarioStore((s) => s.rolesEfectivos);
  const esAdmin = useEsAdmin();
  const conPermiso = usePermisoRol(PERMISO_EDITAR_FORMULARIOS);
  const usuario = useMemo(() => (haySesion ? { roles, esAdmin } : null), [haySesion, roles, esAdmin]);
  return { usuario, puedeEditar: haySesion && (esAdmin || conPermiso) };
};

// ── validadores de los formularios montados (para los que guardan con un botón fuera del <form>) ──
export const validadoresFormularios = new Map<string, () => boolean>();
/** true si el formulario del módulo tiene completos sus campos obligatorios (avisa si no). */
export const validarFormularioConfigurable = (modulo: string): boolean => {
  const v = validadoresFormularios.get(modulo);
  return v ? v() : true;
};

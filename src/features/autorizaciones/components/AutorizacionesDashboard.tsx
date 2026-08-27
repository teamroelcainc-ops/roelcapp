// src/features/autorizaciones/components/AutorizacionesDashboard.tsx
// ============================================================================
// ✅ MÓDULO DE AUTORIZACIONES (solo Admin)
//   · Pestaña "Pendientes": solicitudes en espera; el Admin ve el detalle del
//     cambio (anterior → propuesto), aprueba (se aplica automáticamente) o
//     rechaza con motivo.
//   · Pestaña "Configuración": todos los módulos con sus acciones y campos;
//     se marca qué requiere autorización y a qué roles aplica (vacío = todos).
//   · Pestaña "Historial": solicitudes ya resueltas.
// ============================================================================
import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { onSnapshot, query, where, orderBy } from 'firebase/firestore';
import {
  MODULOS_AUTORIZABLES, ACCIONES,
  cargarConfigModulo, guardarConfigModulo, aplicarSolicitudGenerica, reglaAplica, HORAS_VIGENCIA_ACCESO,
  obtenerUsuarioAut,
  getDocs, collection, updateDoc, doc, db,
} from '../autorizaciones';
import type { ConfigModuloAut, ReglaAut, SolicitudAut } from '../autorizaciones';
import { guardarOperacionSegura } from '../../operaciones/services/operacionesService';
import { registrarLog } from '../../../utils/logger';
import './AutorizacionesDashboard.css';

const REGLA_VACIA: ReglaAut = { requiere: false, roles: [] };

// ✅ NUEVO: resume los campos involucrados en una solicitud para el Historial
//   de Actividad (en ediciones solo los que realmente cambiaron de valor).
const camposDeSolicitudLog = (s: SolicitudAut): string => {
  const claves = s.accion === 'editar'
    ? Object.keys(s.datosPropuestos || {}).filter(k => String((s.datosAnteriores || {})[k] ?? '') !== String((s.datosPropuestos || {})[k] ?? ''))
    : Object.keys(s.datosPropuestos || {});
  if (claves.length === 0) return '';
  const etiquetas = ETIQUETAS_CAMPO[s.modulo] || {};
  const visibles = claves.slice(0, 12).map(k => etiquetas[k] || k);
  const resto = claves.length - visibles.length;
  return visibles.join(', ') + (resto > 0 ? ` y ${resto} más` : '');
};

const ETIQUETAS_CAMPO: Record<string, Record<string, string>> = {};
MODULOS_AUTORIZABLES.forEach(m => {
  ETIQUETAS_CAMPO[m.clave] = {};
  m.campos.forEach(c => { ETIQUETAS_CAMPO[m.clave][c.key] = c.label; });
});

export const AutorizacionesDashboard = () => {
  const [usuario, setUsuario] = useState<{ nombre: string; esAdmin: boolean } | null>(null);
  // ✅ Acceso por ROL: Admin siempre, o cualquier rol con el módulo 'Autorizaciones' asignado.
  const [accesoPermitido, setAccesoPermitido] = useState<boolean | null>(null);
  const [pestana, setPestana] = useState<'pendientes' | 'configuracion' | 'historial'>('pendientes');

  // ── Configuración ──
  const [configs, setConfigs] = useState<Record<string, ConfigModuloAut>>({});
  // ✅ V00140: VISTA PREVIA del formulario de un módulo (simula un rol)
  const [previewModulo, setPreviewModulo] = useState<string>('');
  const [previewRol, setPreviewRol] = useState<string>('');
  const [moduloAbierto, setModuloAbierto] = useState<string>('');
  const [rolesCatalogo, setRolesCatalogo] = useState<string[]>([]);
  const [guardandoModulo, setGuardandoModulo] = useState<string>('');
  const [cargandoConfig, setCargandoConfig] = useState(true);

  // ── Solicitudes ──
  const [pendientes, setPendientes] = useState<SolicitudAut[]>([]);
  const [historial, setHistorial] = useState<SolicitudAut[]>([]);
  const [procesando, setProcesando] = useState<string>('');
  const [solicitudDetalle, setSolicitudDetalle] = useState<SolicitudAut | null>(null);

  useEffect(() => {
    (async () => {
      const u = await obtenerUsuarioAut();
      setUsuario({ nombre: u.nombre, esAdmin: u.esAdmin });
      if (u.esAdmin) { setAccesoPermitido(true); return; }
      try {
        const normA = (x: any) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
        const rolesSet = new Set((u.roles || []).map(normA));
        const snap = await getDocs(collection(db, 'roles'));
        const permitido = snap.docs.some((d: any) => {
          const rd = d.data() || {};
          if (!rolesSet.has(normA(rd.nombre)) && !rolesSet.has(normA(d.id))) return false;
          return (rd.modulosPermitidos || []).some((m: string) => normA(m) === 'AUTORIZACIONES');
        });
        setAccesoPermitido(permitido);
      } catch { setAccesoPermitido(false); }
    })();
  }, []);

  // Roles disponibles (para "aplica a roles")
  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(collection(db, 'roles'));
        const nombres = snap.docs.map((d: any) => String((d.data() || {}).nombre || '')).filter(Boolean)
          .filter(n => !n.toUpperCase().includes('ADMIN')); // Admin siempre exento
        setRolesCatalogo([...new Set(nombres)].sort((a, b) => a.localeCompare(b, 'es')));
      } catch (e) { console.error('Error cargando roles:', e); }
    })();
  }, []);

  // Configs de todos los módulos
  useEffect(() => {
    (async () => {
      setCargandoConfig(true);
      const nuevo: Record<string, ConfigModuloAut> = {};
      await Promise.all(MODULOS_AUTORIZABLES.map(async m => {
        nuevo[m.clave] = (await cargarConfigModulo(m.clave)) || { acciones: {}, campos: {} };
      }));
      setConfigs(nuevo);
      setCargandoConfig(false);
    })();
  }, []);

  // Solicitudes pendientes (tiempo real)
  useEffect(() => {
    const q = query(collection(db, 'solicitudes_autorizacion'), where('estado', '==', 'pendiente'));
    const unsub = onSnapshot(q, (snap: any) => {
      const lista = snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as SolicitudAut[];
      lista.sort((a, b) => String(a.creadaEn).localeCompare(String(b.creadaEn)));
      setPendientes(lista);
    }, (e: any) => console.error('Error escuchando solicitudes:', e));
    return () => unsub();
  }, []);

  // Historial (últimas 100 resueltas)
  useEffect(() => {
    if (pestana !== 'historial') return;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'solicitudes_autorizacion'), orderBy('creadaEn', 'desc')));
        const lista = (snap.docs.map((d: any) => ({ id: d.id, ...d.data() })) as SolicitudAut[])
          .filter(s => s.estado !== 'pendiente').slice(0, 100);
        setHistorial(lista);
      } catch (e) { console.error('Error cargando historial:', e); }
    })();
  }, [pestana, pendientes.length]);

  // ── Mutadores de configuración ──
  const setRegla = (modulo: string, tipo: 'acciones' | 'campos', key: string, cambio: Partial<ReglaAut>) => {
    setConfigs(prev => {
      const cfg = prev[modulo] || { acciones: {}, campos: {} };
      const actual: ReglaAut = { ...REGLA_VACIA, ...(cfg[tipo] as any)?.[key] };
      return { ...prev, [modulo]: { ...cfg, [tipo]: { ...(cfg[tipo] as any), [key]: { ...actual, ...cambio } } } };
    });
  };
  const toggleRolRegla = (modulo: string, tipo: 'acciones' | 'campos', key: string, rol: string) => {
    setConfigs(prev => {
      const cfg = prev[modulo] || { acciones: {}, campos: {} };
      const actual: ReglaAut = { ...REGLA_VACIA, ...(cfg[tipo] as any)?.[key] };
      const roles = actual.roles.includes(rol) ? actual.roles.filter(r => r !== rol) : [...actual.roles, rol];
      return { ...prev, [modulo]: { ...cfg, [tipo]: { ...(cfg[tipo] as any), [key]: { ...actual, roles } } } };
    });
  };

  // ✅ UX: fila expandible de roles, buscador de campos y acciones masivas.
  const [reglaExpandida, setReglaExpandida] = useState<string>('');
  const [filtroCampos, setFiltroCampos] = useState<string>('');

  const setRolesRegla = (modulo: string, tipo: 'acciones' | 'campos', key: string, roles: string[]) => {
    setConfigs(prev => {
      const cfg = prev[modulo] || { acciones: {}, campos: {} };
      const actual: ReglaAut = { ...REGLA_VACIA, ...(cfg[tipo] as any)?.[key] };
      return { ...prev, [modulo]: { ...cfg, [tipo]: { ...(cfg[tipo] as any), [key]: { ...actual, roles } } } };
    });
  };

  // Marca o desmarca TODOS los campos del módulo de un clic.
  const marcarTodosCampos = (modulo: string, valor: boolean) => {
    const mod = MODULOS_AUTORIZABLES.find(m => m.clave === modulo);
    if (!mod) return;
    setConfigs(prev => {
      const cfg = prev[modulo] || { acciones: {}, campos: {} };
      const campos: Record<string, ReglaAut> = { ...cfg.campos };
      mod.campos.forEach(c => {
        const actual: ReglaAut = { ...REGLA_VACIA, ...campos[c.key] };
        campos[c.key] = { ...actual, requiere: valor };
      });
      return { ...prev, [modulo]: { ...cfg, campos } };
    });
  };

  // Copia los roles de una regla a TODAS las reglas marcadas del módulo
  // (para no repetir la misma selección regla por regla).
  const aplicarRolesATodoElModulo = (modulo: string, roles: string[]) => {
    setConfigs(prev => {
      const cfg = prev[modulo] || { acciones: {}, campos: {} };
      const acciones: any = { ...cfg.acciones };
      Object.keys(acciones).forEach(k => { if (acciones[k]?.requiere) acciones[k] = { ...acciones[k], roles: [...roles] }; });
      const campos: any = { ...cfg.campos };
      Object.keys(campos).forEach(k => { if (campos[k]?.requiere) campos[k] = { ...campos[k], roles: [...roles] }; });
      return { ...prev, [modulo]: { acciones, campos } };
    });
  };

  const resumenRoles = (regla: ReglaAut): string =>
    regla.roles.length === 0 ? 'Todos los roles' : (regla.roles.length === 1 ? regla.roles[0] : `${regla.roles.length} roles`);

  const guardarModulo = async (modulo: string) => {
    setGuardandoModulo(modulo);
    try {
      await guardarConfigModulo(modulo, configs[modulo] || { acciones: {}, campos: {} });
      await registrarLog('Autorizaciones', 'Configuración', `Actualizó las reglas de autorización del módulo "${MODULOS_AUTORIZABLES.find(m => m.clave === modulo)?.label || modulo}"`);
      alert('Configuración guardada. Aplica para todos los usuarios.');
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar la configuración. Revisa tu conexión.');
    } finally { setGuardandoModulo(''); }
  };

  // ── Aprobar / Rechazar ──
  const aprobar = async (s: SolicitudAut) => {
    if (!s.id || procesando) return;
    // ✅ V00141: solicitud de ACCESO a un campo — no aplica datos: otorga permiso temporal
    if (s.tipo === 'accesoCampo') {
      if (!window.confirm(`¿Dar ACCESO al campo "${s.campoSolicitadoLabel || s.campoSolicitado}" de ${s.moduloLabel} a ${s.solicitanteNombre} durante ${HORAS_VIGENCIA_ACCESO} horas?`)) return;
      setProcesando(s.id);
      try {
        await updateDoc(doc(db, 'solicitudes_autorizacion', s.id), {
          estado: 'aprobada', resueltaEn: new Date().toISOString(), resueltaPorNombre: usuario?.nombre || 'Admin',
          vigenciaHasta: new Date(Date.now() + HORAS_VIGENCIA_ACCESO * 3600000).toISOString(),
          notificadaSolicitante: false,
        });
        await registrarLog('Autorizaciones', 'Aprobación', `Otorgó acceso temporal (${HORAS_VIGENCIA_ACCESO}h) al campo "${s.campoSolicitadoLabel || s.campoSolicitado}" de ${s.moduloLabel} a ${s.solicitanteNombre}.`);
        setSolicitudDetalle(null);
      } catch (e: any) { alert(`No se pudo otorgar el acceso: ${e?.message || 'error'}`); }
      finally { setProcesando(''); }
      return;
    }
    if (!window.confirm(`¿Aprobar y APLICAR este cambio?\n\nMódulo: ${s.moduloLabel}\nAcción: ${ACCIONES.find(a => a.key === s.accion)?.label}\n${s.referencia ? `Registro: ${s.referencia}` : ''}`)) return;
    setProcesando(s.id);
    try {
      // ✅ Crear operación usa el guardado SEGURO (consecutivo de referencia).
      if (s.accion === 'crear' && s.estrategiaCrear === 'segura' && s.modulo === 'operaciones') {
        await guardarOperacionSegura(s.datosPropuestos || {});
      } else {
        await aplicarSolicitudGenerica(s);
      }
      await updateDoc(doc(db, 'solicitudes_autorizacion', s.id), {
        estado: 'aprobada', resueltaEn: new Date().toISOString(), resueltaPorNombre: usuario?.nombre || 'Admin',
      });
      // ✅ HISTORIAL: quién autorizó, qué solicitó quién y qué campos abarcó el cambio.
      const camposTxtA = camposDeSolicitudLog(s);
      await registrarLog('Autorizaciones', 'Aprobación', `Aprobó ${ACCIONES.find(a => a.key === s.accion)?.label || s.accion} en ${s.moduloLabel}${s.referencia ? ` (${s.referencia})` : ''} solicitado por ${s.solicitanteNombre}${camposTxtA ? `. Campos del cambio: ${camposTxtA}` : ''}`);
      setSolicitudDetalle(null);
    } catch (e: any) {
      console.error(e);
      alert(`No se pudo aplicar el cambio: ${e?.message || 'error desconocido'}. La solicitud sigue pendiente.`);
    } finally { setProcesando(''); }
  };

  const rechazar = async (s: SolicitudAut) => {
    if (!s.id || procesando) return;
    const motivo = window.prompt('Motivo del rechazo (se mostrará en el historial):', '');
    if (motivo === null) return;
    setProcesando(s.id);
    try {
      await updateDoc(doc(db, 'solicitudes_autorizacion', s.id), {
        estado: 'rechazada', notificadaSolicitante: false, resueltaEn: new Date().toISOString(), resueltaPorNombre: usuario?.nombre || 'Admin', motivoRechazo: motivo || 'Sin motivo',
      });
      const camposTxtR = camposDeSolicitudLog(s);
      await registrarLog('Autorizaciones', 'Rechazo', `Rechazó ${ACCIONES.find(a => a.key === s.accion)?.label || s.accion} en ${s.moduloLabel}${s.referencia ? ` (${s.referencia})` : ''} solicitado por ${s.solicitanteNombre}${camposTxtR ? `. Campos del cambio: ${camposTxtR}` : ''}. Motivo: ${motivo || 'Sin motivo'}`);
      setSolicitudDetalle(null);
    } catch (e) {
      console.error(e);
      alert('No se pudo rechazar la solicitud.');
    } finally { setProcesando(''); }
  };

  const fmtFecha = (iso?: string) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; }
  };

  const diffDeSolicitud = (s: SolicitudAut): { campo: string; antes: string; despues: string }[] => {
    const etiquetas = ETIQUETAS_CAMPO[s.modulo] || {};
    const claves = (s.camposAfectados && s.camposAfectados.length > 0)
      ? s.camposAfectados
      : Object.keys(s.datosPropuestos || {});
    return claves.map(k => ({
      campo: etiquetas[k] || k,
      antes: s.accion === 'crear' ? '—' : String((s.datosAnteriores || {})[k] ?? '—'),
      despues: String((s.datosPropuestos || {})[k] ?? '—'),
    }));
  };

  // ── Estilos base ──
  const card: CSSProperties = { backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '10px' };
  const btn = (bg: string): CSSProperties => ({ padding: '8px 18px', backgroundColor: bg, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' });
  const chip = (activo: boolean): CSSProperties => ({ padding: '3px 10px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer', border: `1px solid ${activo ? '#D84315' : '#30363d'}`, backgroundColor: activo ? 'rgba(216,67,21,0.2)' : 'transparent', color: activo ? '#fb923c' : '#8b949e', userSelect: 'none' });

  if (accesoPermitido === false) {
    return (
      <div className="ad-x1">
        <div className="ad-x2"></div>
        <h2 className="ad-x3">No tienes acceso a este módulo</h2>
        <p className="ad-x4">Pide al administrador que asigne el módulo "Autorizaciones" a tu rol.</p>
      </div>
    );
  }

  const renderRegla = (modulo: string, tipo: 'acciones' | 'campos', key: string, label: string) => {
    const regla: ReglaAut = { ...REGLA_VACIA, ...((configs[modulo]?.[tipo] as any)?.[key]) };
    const idRegla = `${modulo}|${tipo}|${key}`;
    const expandida = reglaExpandida === idRegla;
    return (
      <div key={`${tipo}-${key}`} style={{ backgroundColor: '#161b22', border: `1px solid ${regla.requiere ? 'rgba(216,67,21,0.55)' : '#21262d'}`, borderRadius: '8px' }}>
        {/* Fila principal: marcar el campo es la acción primaria */}
        <div className="ad-x5">
          <label className="ad-x6">
            <input className="ad-x7" type="checkbox" checked={regla.requiere} onChange={() => setRegla(modulo, tipo, key, { requiere: !regla.requiere })} />
            <span style={{ color: regla.requiere ? '#f0f6fc' : '#8b949e', fontSize: '0.88rem', fontWeight: regla.requiere ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
          </label>
          {regla.requiere && (
            <button type="button" onClick={() => setReglaExpandida(expandida ? '' : idRegla)}
              title="Elegir a qué roles aplica esta regla"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 12px', borderRadius: '999px', border: `1px solid ${regla.roles.length === 0 ? '#3fb950' : '#D84315'}`, backgroundColor: 'transparent', color: regla.roles.length === 0 ? '#3fb950' : '#fb923c', cursor: 'pointer', fontSize: '0.72rem', fontWeight: 700, flexShrink: 0 }}>
              {resumenRoles(regla)} {expandida ? '▴' : '▾'}
            </button>
          )}
        </div>
        {/* Panel de roles: solo al expandir, con atajos */}
        {regla.requiere && expandida && (
          <div className="ad-x8">
            <div className="ad-x9">
              {/* Chip TODOS: sin roles seleccionados = aplica a todos */}
              <span style={{ ...chip(regla.roles.length === 0), borderColor: regla.roles.length === 0 ? '#3fb950' : '#30363d', color: regla.roles.length === 0 ? '#3fb950' : '#8b949e', backgroundColor: regla.roles.length === 0 ? 'rgba(63,185,80,0.15)' : 'transparent' }}
                onClick={() => setRolesRegla(modulo, tipo, key, [])}>
                ✓ TODOS LOS ROLES
              </span>
              {rolesCatalogo.map(rol => (
                <span key={rol} style={chip(regla.roles.includes(rol))} onClick={() => toggleRolRegla(modulo, tipo, key, rol)}>{rol}</span>
              ))}
            </div>
            <div className="ad-x10">
              <button className="ad-x11" type="button" onClick={() => setRolesRegla(modulo, tipo, key, [...rolesCatalogo])}>Seleccionar todos</button>
              <button className="ad-x11" type="button" onClick={() => setRolesRegla(modulo, tipo, key, [])}>Limpiar (= todos)</button>
              <button className="ad-x12" type="button" onClick={() => { aplicarRolesATodoElModulo(modulo, regla.roles); setReglaExpandida(''); }} title="Copia esta selección de roles a todas las acciones y campos marcados del módulo">Aplicar a todo el módulo</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="ad-x13">
      <div className="ad-x14">
        <h1 className="ad-x15">Autorizaciones</h1>
        <div className="ad-x16">
          {([
            { key: 'pendientes', label: `Pendientes${pendientes.length ? ` (${pendientes.length})` : ''}` },
            { key: 'configuracion', label: 'Configuración' },
            { key: 'historial', label: 'Historial' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setPestana(t.key)} style={{ padding: '8px 16px', borderRadius: '6px', border: `1px solid ${pestana === t.key ? '#D84315' : '#30363d'}`, backgroundColor: pestana === t.key ? 'rgba(216,67,21,0.18)' : '#161b22', color: pestana === t.key ? '#fb923c' : '#c9d1d9', cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ PENDIENTES ══ */}
      {pestana === 'pendientes' && (
        <div className="ad-x17">
          {pendientes.length === 0 && (
            <div style={{ ...card, padding: '40px', textAlign: 'center', color: '#8b949e' }}>
              No hay solicitudes pendientes de autorización.
            </div>
          )}
          {pendientes.map(s => (
            <div key={s.id} style={{ ...card, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap', borderLeft: '4px solid #fb923c' }}>
              <div className="ad-x18">
                <div className="ad-x19">
                  <span className="ad-x20">{s.moduloLabel}</span>
                  <span style={{ padding: '2px 10px', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700, backgroundColor: s.accion === 'borrar' ? 'rgba(248,81,73,0.18)' : 'rgba(88,166,255,0.15)', color: s.accion === 'borrar' ? '#f85149' : '#58a6ff', border: `1px solid ${s.accion === 'borrar' ? '#f85149' : '#58a6ff'}` }}>
                    {ACCIONES.find(a => a.key === s.accion)?.label || s.accion}
                  </span>
                  {s.referencia && <span className="ad-x21">{s.referencia}</span>}
                </div>
                <div className="ad-x22">
                  Solicitó <b className="ad-x23">{s.solicitanteNombre}</b> ({(s.solicitanteRoles || []).join(', ') || 'sin rol'}) · {fmtFecha(s.creadaEn)}
                </div>
                {(s.motivosControl || []).length > 0 && (
                  <div className="ad-x24">{(s.motivosControl || []).join(' ')}</div>
                )}
              </div>
              <div className="ad-x16">
                <button onClick={() => setSolicitudDetalle(s)} style={btn('#21262d')}>Ver detalle</button>
                <button onClick={() => aprobar(s)} disabled={procesando === s.id} style={{ ...btn('#238636'), opacity: procesando === s.id ? 0.6 : 1 }}>{procesando === s.id ? 'Aplicando...' : 'Aprobar'}</button>
                <button onClick={() => rechazar(s)} disabled={procesando === s.id} style={btn('#da3633')}>Rechazar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ══ CONFIGURACIÓN ══ */}
      {pestana === 'configuracion' && (
        <div className="ad-x25">
          <div style={{ ...card, padding: '14px 18px', color: '#8b949e', fontSize: '0.85rem' }}>
            Marca con su casilla las <b className="ad-x23">acciones</b> y <b className="ad-x23">campos</b> que requieren autorización. Por defecto cada regla aplica a <b className="ad-x26">todos los roles</b>; si quieres limitarla, pulsa la píldora de roles y elige. Con <b className="ad-x27">"Aplicar a todo el módulo"</b> copias una selección de roles a todas las reglas marcadas de un clic. Los usuarios <b className="ad-x27">Admin siempre están exentos</b>. La configuración se comparte con todos los usuarios.
          </div>
          {cargandoConfig && <div className="ad-x28">Cargando configuración...</div>}
          {!cargandoConfig && MODULOS_AUTORIZABLES.map(m => {
            const abierto = moduloAbierto === m.clave;
            const cfg = configs[m.clave] || { acciones: {}, campos: {} };
            const activas = ACCIONES.filter(a => (cfg.acciones as any)?.[a.key]?.requiere).length
              + Object.values(cfg.campos || {}).filter((r: any) => r?.requiere).length;
            return (
              <div key={m.clave} style={card}>
                <div className="ad-x29" onClick={() => setModuloAbierto(abierto ? '' : m.clave)}>
                  <div className="ad-x30">
                    <span className="ad-x31">{abierto ? '▼' : '▶'}</span>
                    <span className="ad-x32">{m.label}</span>
                    {!m.integrado && <span className="ad-x33">pendiente de integrar</span>}
                    {m.campos.length > 0 && (
                      <button className="ad-prev-btn" onClick={(e) => { e.stopPropagation(); setPreviewModulo(m.clave); setPreviewRol(rolesCatalogo[0] || ''); }} title="Simula cómo verá el formulario cada rol con las reglas actuales">👁 Vista previa</button>
                    )}
                  </div>
                  {activas > 0 && <span className="ad-x34">{activas} regla{activas === 1 ? '' : 's'} activa{activas === 1 ? '' : 's'}</span>}
                </div>
                {abierto && (
                  <div className="ad-x35">
                    <div>
                      <div className="ad-x36">Acciones</div>
                      <div className="ad-x37">
                        {ACCIONES.map(a => renderRegla(m.clave, 'acciones', a.key, a.label))}
                      </div>
                    </div>
                    {m.campos.length > 0 && (
                      <div>
                        <div className="ad-x38">
                          <div className="ad-x39">Campos (al editar)</div>
                          <div className="ad-x40">
                            <input className="ad-x41" type="text" value={filtroCampos} onChange={e => setFiltroCampos(e.target.value)} placeholder="Buscar campo..." />
                            <button className="ad-x42" type="button" onClick={() => marcarTodosCampos(m.clave, true)}>Marcar todos</button>
                            <button className="ad-x42" type="button" onClick={() => marcarTodosCampos(m.clave, false)}>Desmarcar todos</button>
                          </div>
                        </div>
                        {/* Cuadrícula de dos columnas: más campos visibles sin scroll */}
                        <div className="ad-x43">
                          {m.campos
                            .filter(c => !filtroCampos.trim() || c.label.toLowerCase().includes(filtroCampos.trim().toLowerCase()))
                            .map(c => renderRegla(m.clave, 'campos', c.key, c.label))}
                        </div>
                      </div>
                    )}
                    <div className="ad-x44">
                      <button onClick={() => guardarModulo(m.clave)} disabled={guardandoModulo === m.clave} style={btn('#D84315')}>
                        {guardandoModulo === m.clave ? 'Guardando...' : 'Guardar para todos'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ══ HISTORIAL ══ */}
      {pestana === 'historial' && (
        <div className="ad-x45">
          {historial.length === 0 && <div style={{ ...card, padding: '30px', textAlign: 'center', color: '#8b949e' }}>Sin solicitudes resueltas todavía.</div>}
          {historial.map(s => (
            <div key={s.id} style={{ ...card, padding: '12px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', borderLeft: `4px solid ${s.estado === 'aprobada' ? '#238636' : '#da3633'}` }}>
              <div>
                <div className="ad-x46">
                  <span style={{ color: s.estado === 'aprobada' ? '#3fb950' : '#f85149', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase' }}>{s.estado}</span>
                  <span className="ad-x32">{s.moduloLabel}</span>
                  <span className="ad-x47">{ACCIONES.find(a => a.key === s.accion)?.label}</span>
                  {s.referencia && <span className="ad-x48">{s.referencia}</span>}
                </div>
                <div className="ad-x49">
                  Solicitó {s.solicitanteNombre} · {fmtFecha(s.creadaEn)} · Resolvió {s.resueltaPorNombre || '—'} · {fmtFecha(s.resueltaEn)}
                  {s.estado === 'rechazada' && s.motivoRechazo ? ` · Motivo: ${s.motivoRechazo}` : ''}
                </div>
              </div>
              <button onClick={() => setSolicitudDetalle(s)} style={btn('#21262d')}>Ver detalle</button>
            </div>
          ))}
        </div>
      )}

      {/* ══ MODAL DETALLE ══ */}
      {solicitudDetalle && (
        <div className="ad-x50">
          <div style={{ ...card, maxWidth: '720px', width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="ad-x51">
              <h3 className="ad-x52">
                {solicitudDetalle.moduloLabel} · {ACCIONES.find(a => a.key === solicitudDetalle.accion)?.label}
                {solicitudDetalle.referencia ? <span className="ad-x53">{solicitudDetalle.referencia}</span> : null}
              </h3>
              <button className="ad-x54" onClick={() => setSolicitudDetalle(null)}>✕</button>
            </div>
            <div className="ad-x55">
              <div className="ad-x56">
                Solicitó <b className="ad-x23">{solicitudDetalle.solicitanteNombre}</b> ({(solicitudDetalle.solicitanteRoles || []).join(', ') || 'sin rol'}) · {fmtFecha(solicitudDetalle.creadaEn)}
              </div>
              {(solicitudDetalle.motivosControl || []).length > 0 && (
                <div className="ad-x57">
                  {(solicitudDetalle.motivosControl || []).map((m, i) => <div key={i}>• {m}</div>)}
                </div>
              )}
              <table className="ad-x58">
                <thead>
                  <tr className="ad-x59">
                    <th className="ad-x60">Campo</th>
                    <th className="ad-x60">Anterior</th>
                    <th className="ad-x60">Propuesto</th>
                  </tr>
                </thead>
                <tbody>
                  {diffDeSolicitud(solicitudDetalle).map((d, i) => (
                    <tr className="ad-x61" key={i}>
                      <td className="ad-x62">{d.campo}</td>
                      <td className="ad-x63">{d.antes}</td>
                      <td className="ad-x64">{d.despues}</td>
                    </tr>
                  ))}
                  {diffDeSolicitud(solicitudDetalle).length === 0 && (
                    <tr><td className="ad-x65" colSpan={3}>Sin cambios de campos que mostrar.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {solicitudDetalle.estado === 'pendiente' && (
              <div className="ad-x66">
                <button onClick={() => rechazar(solicitudDetalle)} disabled={!!procesando} style={btn('#da3633')}>Rechazar</button>
                <button onClick={() => aprobar(solicitudDetalle)} disabled={!!procesando} style={btn('#238636')}>{procesando ? 'Aplicando...' : 'Aprobar y aplicar'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ✅ V00140: VISTA PREVIA — simula el formulario del módulo con las reglas actuales */}
      {previewModulo && (() => {
        const mod = MODULOS_AUTORIZABLES.find(x => x.clave === previewModulo);
        if (!mod) return null;
        const cfg = configs[previewModulo] || { acciones: {}, campos: {} };
        const rolSel = previewRol ? [previewRol] : [];
        const accionesCtrl = ACCIONES.filter(a => reglaAplica((cfg.acciones as any)?.[a.key], rolSel));
        return (
          <div className="modal-overlay ad-prev-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreviewModulo(''); }}>
            <div className="ad-prev-card">
              <div className="ad-prev-header">
                <h3 className="ad-prev-titulo">👁 Vista previa · {mod.label}</h3>
                <button className="ad-x16 ad-prev-cerrar" onClick={() => setPreviewModulo('')}>✕</button>
              </div>
              <div className="ad-prev-cuerpo">
                <label className="ad-prev-rol">
                  <span>Simular con el rol:</span>
                  <select className="form-control ad-prev-select" value={previewRol} onChange={(e) => setPreviewRol(e.target.value)}>
                    {rolesCatalogo.length === 0 && <option value="">(sin roles en catálogo)</option>}
                    {rolesCatalogo.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <span className="ad-prev-nota">Los Admin siempre ven todo editable.</span>
                </label>
                <div className="ad-prev-acciones">
                  {ACCIONES.map(a => {
                    const ctrl = accionesCtrl.some(x => x.key === a.key);
                    return <span key={a.key} className={`ad-prev-chip ${ctrl ? 'ctrl' : 'libre'}`}>{ctrl ? '🔒' : '✓'} {a.label}{ctrl ? ' → requiere autorización' : ''}</span>;
                  })}
                </div>
                <div className="ad-prev-form">
                  {mod.campos.map(c => {
                    const bloqueado = reglaAplica((cfg.campos as any)?.[c.key], rolSel);
                    return (
                      <div className="ad-prev-campo" key={c.key}>
                        <label className="ad-prev-etq">{c.label}{bloqueado && <span className="ad-prev-lock"> 🔒</span>}</label>
                        <input className="ad-prev-input" disabled={bloqueado} readOnly placeholder={bloqueado ? 'Bloqueado por Autorizaciones para este rol' : 'Editable'} title={bloqueado ? `Con el rol "${previewRol}" este campo queda bloqueado` : 'Editable para este rol'} />
                      </div>
                    );
                  })}
                </div>
                <p className="ad-prev-pie">Así se verá el formulario de <b>{mod.label}</b> para un usuario con el rol <b>{previewRol || '—'}</b> con las reglas actuales{'\u00A0'}(incluye cambios sin guardar). 🔒 = campo deshabilitado; acciones controladas piden autorización al guardar.</p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default AutorizacionesDashboard;
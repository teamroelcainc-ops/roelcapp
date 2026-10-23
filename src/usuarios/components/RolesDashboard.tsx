// src/usuarios/components/RolesDashboard.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, getDoc, setDoc, deleteDoc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { registrarLog } from '../../utils/logger';
import { useCatalogo } from '../../shared/data/catalogos';
import './RolesDashboard.css';

// ============================================================================
// Módulos del sistema, agrupados igual que el menú lateral (App.tsx).
// Incluye TODOS los items del menú y de los submenús, con las MISMAS etiquetas
// que se muestran en el sidebar (para que el filtrado por permisos coincida).
// ============================================================================
const GRUPOS_MODULOS: { grupo: string; modulos: string[] }[] = [
  { grupo: 'General', modulos: ['Mis Operaciones', 'Operaciones Activas', 'Pagos', 'Estadísticas', 'Análisis de Clientes', 'Servicios Completados', 'Servicios Cancelados', 'Reportes', 'Reporte de Vencimiento', 'Historial de Cambios', 'Panel de Control', 'Tablero (CRM)', 'Catálogos'] },
  { grupo: 'Gastos', modulos: ['MTTO', 'Referencias del Diesel', 'Referencias de Puentes', 'Costos Adicionales'] },
  { grupo: 'Clientes', modulos: ['Convenio de Clientes', 'Tarifario Clientes', 'Detalles del Convenio', 'Facturación de Clientes'] }, // ✅ V00198
  { grupo: 'Proveedores', modulos: ['Convenio de Proveedores', 'Facturación de Proveedores', 'Tarifario Proveedores', 'Detalles del Convenio (Proveedores)'] },
  { grupo: 'Empleados', modulos: ['Colaboradores', 'Historial de Chequeo', 'Nómina', 'Deducciones'] },
  { grupo: 'Bases de Datos', modulos: ['Empresas', 'Contactos', 'Direcciones', 'Tipo de Cambio', 'Saldos de Puentes', 'Combustible', 'Unidades Propias', 'Remolques', 'Proveedores de Unidad', 'Unidades del Proveedor'] }, // ✅ V00364: + Saldos de Puentes
  { grupo: 'Configuración', modulos: ['Usuarios', 'Roles y Permisos', 'Historial de Actividad', 'Reglas de Estatus', 'Datos de la Empresa', 'Autorizaciones', 'Personalizar Etiquetas'] },
  // ✅ NUEVO: permisos especiales de acción (no son items de menú; habilitan
  // capacidades puntuales). "Editar Referencia" permite editar la referencia
  // (# Ref) de una operación al editarla, igual que un ADMIN.
  // "Ver todos los chequeos": ver el Historial del Reloj Checador de TODOS los
  // colaboradores; sin este permiso, cada quien ve SOLO sus propios registros.
  // ✅ V00224: "Editar Tarifa (Origen/Destino)" enciende el botón que asigna
  // origen y destino a las tarifas desde una operación de flete.
  // ✅ V00364: "Personalizar Vista (Operaciones)" habilita el botón ✎ Vista de
  //   Operaciones Activas (ocultar/mostrar botones del módulo).
  { grupo: 'Permisos Especiales', modulos: ['Editar Referencia', 'Ver todos los chequeos', 'Editar Tarifa (Origen/Destino)', 'Personalizar Vista (Operaciones)', 'Editar Formularios'] }, // ✅ V00385: botón ✎ Editar formulario (Admin siempre)
];

// Lista plana con todos los módulos (útil para "Seleccionar todo").
const TODOS_LOS_MODULOS = GRUPOS_MODULOS.flatMap(g => g.modulos);

// ✅ V00336: nombre VISIBLE de cada permiso. Los roles guardan el nombre
//   interno (no se migra nada y nadie gana ni pierde acceso); aquí solo se
//   traduce lo que se muestra:
//   · 'Historial de Cambios'   (versiones de la app) → "Historial de Versiones"
//   · 'Historial de Actividad' (bitácora de acciones) → "Historial de Cambios"
const ETIQUETA_PERMISO: Record<string, string> = {
  'Historial de Cambios': 'Historial de Versiones',
  'Historial de Actividad': 'Historial de Cambios',
};
const etiquetaPermiso = (modulo: string): string => ETIQUETA_PERMISO[modulo] ?? modulo;

export const RolesDashboard: React.FC = () => {
  // ✅ V00439 (Fase 3.x): roles desde el catálogo compartido (el mismo listener que App).
  const { datos: datosRoles } = useCatalogo('roles');
  const roles: any[] = datosRoles;
  // ✅ V00160: VISTAS ADICIONALES POR USUARIO — módulos extra fuera del rol.
  const [usuariosLista, setUsuariosLista] = useState<any[]>([]);
  const [usuarioVistasId, setUsuarioVistasId] = useState('');
  const [extrasSel, setExtrasSel] = useState<string[]>([]);
  const [guardandoExtras, setGuardandoExtras] = useState(false);
  const [ipOficial, setIpOficial] = useState('');
  const [guardandoIp, setGuardandoIp] = useState(false);
  
  // Estados para el Modal de Rol
  const [modalAbierto, setModalAbierto] = useState(false);
  const [rolEditando, setRolEditando] = useState<any>(null);
  
  const [nombreRol, setNombreRol] = useState('');
  const [modulos, setModulos] = useState<string[]>([]);
  // ✅ V00437 (Fase 1.7): el login exige la red de la oficina a los usuarios con este rol.
  const [requiereIPOficina, setRequiereIPOficina] = useState(false);
  const [cargandoRol, setCargandoRol] = useState(false);

  useEffect(() => {
    // Suscripción a usuarios (los roles llegan por useCatalogo, arriba)
    const unsubUsuarios = onSnapshot(collection(db, 'usuarios'), (snapshot) => {
      setUsuariosLista(snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es')));
    });

    // Cargar Configuración IP
    const fetchConfig = async () => {
      const configRef = doc(db, 'configuracion', 'seguridad');
      const snap = await getDoc(configRef);
      if (snap.exists()) {
        // ✅ V00437: un solo valor para el login (`ipOficina`) y el reloj checador (`ipOficial`).
        setIpOficial(snap.data().ipOficina || snap.data().ipOficial || '');
      }
    };
    fetchConfig();

    return () => { unsubUsuarios(); };
  }, []);

  const detectarIp = async () => {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const data = await res.json();
      setIpOficial(data.ip);
    } catch (e) {
      alert("No se pudo detectar tu IP automáticamente.");
    }
  };

  const guardarIp = async () => {
    const valor = ipOficial.trim();
    if (!valor) return;
    setGuardandoIp(true);
    try {
      // ✅ V00437: se guarda con los DOS nombres para que el login (`ipOficina`)
      //   y el Reloj Checador (`ipOficial`) usen el mismo valor.
      await setDoc(doc(db, 'configuracion', 'seguridad'), { ipOficial: valor, ipOficina: valor }, { merge: true });
      await registrarLog('Seguridad', 'Actualización', `Actualizó la IP Oficial (Reloj Checador e inicio de sesión) a: ${valor}`);
      alert("IP Oficial guardada. El Reloj Checador y el inicio de sesión (roles que requieren la red de la oficina) ahora usarán esta red.");
    } catch (e) {
      alert("Error al guardar IP.");
    } finally {
      setGuardandoIp(false);
    }
  };

  const abrirModalNuevo = () => {
    setRolEditando(null);
    setNombreRol('');
    setModulos([]);
    setRequiereIPOficina(false);
    setModalAbierto(true);
  };

  const abrirModalEditar = (rol: any) => {
    setRolEditando(rol);
    setNombreRol(rol.nombre);
    setModulos(rol.modulosPermitidos || []);
    setRequiereIPOficina(rol.requiereIPOficina === true);
    setModalAbierto(true);
  };

  const toggleModulo = (mod: string) => {
    setModulos(prev => prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]);
  };

  // ✅ NUEVO: marca / desmarca todos los módulos de un grupo de una sola vez.
  const toggleGrupoModulos = (mods: string[]) => {
    setModulos(prev => {
      const todos = mods.every(m => prev.includes(m));
      if (todos) return prev.filter(m => !mods.includes(m));
      return Array.from(new Set([...prev, ...mods]));
    });
  };

  // ✅ NUEVO: seleccionar / quitar TODOS los módulos del sistema.
  const toggleTodos = () => {
    const todos = TODOS_LOS_MODULOS.every(m => modulos.includes(m));
    setModulos(todos ? [] : [...TODOS_LOS_MODULOS]);
  };

  const guardarRol = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombreRol.trim()) return alert("El nombre del rol es obligatorio");
    
    setCargandoRol(true);
    try {
      const datosRol = {
        nombre: nombreRol.toUpperCase().trim(),
        modulosPermitidos: modulos,
        requiereIPOficina,
        timestamp: Date.now()
      };

      if (rolEditando) {
        await updateDoc(doc(db, 'roles', rolEditando.id), datosRol);
        await registrarLog('Roles', 'Edición', `Editó el rol: ${datosRol.nombre}`);
      } else {
        await addDoc(collection(db, 'roles'), datosRol);
        await registrarLog('Roles', 'Creación', `Creó el rol: ${datosRol.nombre}`);
      }
      setModalAbierto(false);
    } catch (error) {
      alert("Error al guardar rol.");
    } finally {
      setCargandoRol(false);
    }
  };

  const eliminarRol = async (id: string, nombre: string) => {
    if (window.confirm(`¿Estás seguro de eliminar el rol ${nombre}?`)) {
      try {
        await deleteDoc(doc(db, 'roles', id));
        await registrarLog('Roles', 'Eliminación', `Eliminó el rol: ${nombre}`);
      } catch (error) {
        alert("Error al eliminar.");
      }
    }
  };

  const todosSeleccionados = TODOS_LOS_MODULOS.every(m => modulos.includes(m));

  return (
    <div className="module-container rld-x1">
      
      {/* SECCIÓN 1: CONFIGURACIÓN IP (EXCLUSIVO PARA EL RELOJ) */}
      <div className="rld-x2">
        <h3 className="rld-x3">
          Configuración de Red para Reloj Checador
        </h3>
        <p className="rld-x4">
          Define aquí la Dirección IP pública del internet de tu oficina. Los colaboradores operativos <strong>solo podrán registrar su asistencia</strong> si se encuentran conectados a esta red.
        </p>
        <div className="rld-x5">
          <input 
            type="text" 
            value={ipOficial} 
            onChange={(e) => setIpOficial(e.target.value)} 
            placeholder="Ej. 192.168.1.1" 
            className="form-control rld-x6" 
          />
          <button onClick={detectarIp} className="btn btn-outline rld-x7">
            Detectar mi IP actual
          </button>
          <button onClick={guardarIp} className="btn btn-primary rld-x8" disabled={guardandoIp}>
            {guardandoIp ? 'Guardando...' : 'Guardar IP Oficial'}
          </button>
        </div>
      </div>

      {/* SECCIÓN 2: LISTA DE ROLES */}
      <div className="module-header rld-x9">
        <h2 className="rld-x10">
          Configuración {'>'} <span className="rld-x11">Roles y Permisos ({roles.length})</span>
        </h2>
        <button className="btn btn-primary" onClick={abrirModalNuevo}>+ Nuevo Rol</button>
      </div>

      <div className="table-container rld-x12">
        <table className="data-table rld-x13">
          <thead className="rld-x14">
            <tr>
              <th className="rld-x15">ACCIONES</th>
              <th className="rld-x16">NOMBRE DEL ROL</th>
              <th className="rld-x16">MÓDULOS PERMITIDOS</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(rol => (
              <tr className="rld-x17" key={rol.id}>
                <td className="rld-x18">
                  <div className="rld-x19">
                    <button 
                      onClick={() => abrirModalEditar(rol)} 
                      className="btn-small btn-edit rld-x20"
                    >
                      Editar
                    </button>
                    <button 
                      onClick={() => eliminarRol(rol.id, rol.nombre)} 
                      className="btn-small btn-danger rld-x21"
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
                <td className="rld-x22">
                  {rol.nombre}
                  {rol.requiereIPOficina === true && (
                    <span className="rd-ip-badge" title="Solo puede iniciar sesión desde la red de la oficina">Red de oficina</span>
                  )}
                </td>
                <td className="rld-x23">
                  <div className="rld-x24">
                    {rol.modulosPermitidos?.map((mod: string) => (
                      <span className="rld-x25" key={mod}>
                        {etiquetaPermiso(mod)}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL DE EDICIÓN DE ROL */}
      {/* ✅ V00160: VISTAS ADICIONALES POR USUARIO
          Permite que un usuario vea módulos que su rol NO incluye, sin crear
          otro rol. Se guarda en usuarios/{id}.modulosExtra y App los suma a los
          permisos del rol al iniciar sesión. */}
      {(() => {
        const usuarioSel: any = usuariosLista.find((u: any) => u.id === usuarioVistasId) || null;
        const rolesDelUsuario: string[] = usuarioSel ? (Array.isArray(usuarioSel.roles) ? usuarioSel.roles : (usuarioSel.rol ? [usuarioSel.rol] : [])) : [];
        const porRol = new Set<string>();
        roles.forEach((r: any) => { if (rolesDelUsuario.includes(r.nombre)) (r.modulosPermitidos || []).forEach((m: string) => porRol.add(m)); });
        const toggleExtra = (m: string) => setExtrasSel(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
        const guardarExtras = async () => {
          if (!usuarioSel || guardandoExtras) return;
          setGuardandoExtras(true);
          try {
            await updateDoc(doc(db, 'usuarios', usuarioSel.id), { modulosExtra: extrasSel });
            await registrarLog('Roles y Permisos', 'Edición', `Asignó vistas adicionales a ${usuarioSel.nombre || usuarioSel.correo || usuarioSel.id}: ${extrasSel.length ? extrasSel.join(', ') : '(ninguna)'}.`);
            alert(`Vistas adicionales guardadas. ✅\n\nEl usuario las verá al recargar o volver a iniciar sesión.`);
          } catch (e: any) { alert(`No se pudo guardar: ${e?.message || e}`); }
          finally { setGuardandoExtras(false); }
        };
        return (
          <div className="rd-vistas-card">
            <h3 className="rd-vistas-titulo">🖥 Vistas adicionales por usuario</h3>
            <p className="rd-vistas-sub">Dale a un usuario acceso a módulos que su rol no incluye, sin crear un rol nuevo. Lo del rol aparece marcado y bloqueado; lo que marques aquí se SUMA solo para ese usuario.</p>
            <select className="form-control rd-vistas-select" value={usuarioVistasId}
              onChange={(e) => {
                const id = e.target.value; setUsuarioVistasId(id);
                const u: any = usuariosLista.find((x: any) => x.id === id);
                setExtrasSel(Array.isArray(u?.modulosExtra) ? u.modulosExtra : []);
              }}>
              <option value="">— Elige un usuario —</option>
              {usuariosLista.map((u: any) => <option key={u.id} value={u.id}>{u.nombre || u.correo || u.id}{Array.isArray(u.modulosExtra) && u.modulosExtra.length ? ` (+${u.modulosExtra.length})` : ''}</option>)}
            </select>
            {usuarioSel && (
              <>
                <div className="rd-vistas-roles">Roles del usuario: {rolesDelUsuario.length ? rolesDelUsuario.join(', ') : '(sin rol)'}</div>
                <div className="rd-vistas-grid">
                  {GRUPOS_MODULOS.map(g => (
                    <div key={g.grupo} className="rd-vistas-grupo">
                      <div className="rd-vistas-grupo-titulo">{g.grupo}</div>
                      {g.modulos.map(m => {
                        const delRol = porRol.has(m);
                        return (
                          <label key={m} className={`rd-vistas-item${delRol ? ' rd-vistas-rol' : ''}`} title={delRol ? 'Incluido por su rol' : 'Vista adicional solo para este usuario'}>
                            <input type="checkbox" checked={delRol || extrasSel.includes(m)} disabled={delRol} onChange={() => toggleExtra(m)} />
                            <span>{etiquetaPermiso(m)}</span>{delRol && <em className="rd-vistas-tag">por rol</em>}
                          </label>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div className="rd-vistas-acciones">
                  <button type="button" className="btn btn-primary" onClick={guardarExtras} disabled={guardandoExtras}>{guardandoExtras ? 'Guardando…' : 'Guardar vistas del usuario'}</button>
                </div>
              </>
            )}
          </div>
        );
      })()}

      {modalAbierto && (
        <div className="modal-overlay rld-x26">
          <div className="form-card rld-x27">
            <div className="form-header rld-x28">
              <h2 className="rld-x29">
                {rolEditando ? 'Editar Rol' : 'Nuevo Rol'}
              </h2>
              <button className="rld-x30" onClick={() => setModalAbierto(false)}>✕</button>
            </div>

            <form className="rld-x31" onSubmit={guardarRol}>
              <div className="form-group rld-x32">
                <label className="form-label rld-x33">Nombre del Rol (Ej. VENTAS, ADMIN) *</label>
                <input 
                  type="text" 
                  className="form-control rld-x34" 
                  value={nombreRol} 
                  onChange={(e) => setNombreRol(e.target.value)} 
                  required
                />
              </div>

              {/* ✅ V00437 (Fase 1.7): restricción de red por rol (la revisa el login). */}
              <div className="form-group rld-x32">
                <label className="rld-x45" title="Los usuarios con este rol solo podrán iniciar sesión desde la red de la oficina (la IP configurada arriba).">
                  <input className="rld-x39"
                    type="checkbox"
                    checked={requiereIPOficina}
                    onChange={(e) => setRequiereIPOficina(e.target.checked)}
                  />
                  Requiere red de la oficina (IP)
                </label>
              </div>

              <div className="form-group rld-x35">
                <div className="rld-x36">
                  <label className="form-label rld-x37">Selecciona los módulos a los que tendrá acceso:</label>
                  <label className="rld-x38">
                    <input className="rld-x39"
                      type="checkbox"
                      checked={todosSeleccionados}
                      onChange={toggleTodos}
                    />
                    Seleccionar todo
                  </label>
                </div>

                <div className="rld-x40">
                  {GRUPOS_MODULOS.map(g => {
                    const todosGrupo = g.modulos.every(m => modulos.includes(m));
                    const algunosGrupo = g.modulos.some(m => modulos.includes(m));
                    return (
                      <div className="rld-x41" key={g.grupo}>
                        {/* Encabezado del grupo (equivale al item del MENÚ) */}
                        <label className="rld-x42">
                          <input className="rld-x39"
                            type="checkbox"
                            checked={todosGrupo}
                            ref={el => { if (el) el.indeterminate = !todosGrupo && algunosGrupo; }}
                            onChange={() => toggleGrupoModulos(g.modulos)}
                          />
                          <span className="rld-x43">{g.grupo}</span>
                        </label>

                        {/* Módulos del grupo (equivalen a los items del SUBMENÚ) */}
                        <div className="rld-x44">
                          {g.modulos.map(mod => (
                            <label className="rld-x45" key={mod}>
                              <input className="rld-x39" 
                                type="checkbox" 
                                checked={modulos.includes(mod)} 
                                onChange={() => toggleModulo(mod)}
                              />
                              {etiquetaPermiso(mod)}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rld-x46">
                <button type="button" onClick={() => setModalAbierto(false)} className="btn btn-outline rld-x47">Cancelar</button>
                <button type="submit" className="btn btn-primary rld-x48" disabled={cargandoRol}>
                  {cargandoRol ? 'Guardando...' : 'Guardar Rol'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
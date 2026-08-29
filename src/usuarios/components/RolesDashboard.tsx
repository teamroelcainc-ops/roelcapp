// src/usuarios/components/RolesDashboard.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, getDoc, setDoc, deleteDoc, updateDoc, addDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { registrarLog } from '../../utils/logger';
import './RolesDashboard.css';

// ============================================================================
// Módulos del sistema, agrupados igual que el menú lateral (App.tsx).
// Incluye TODOS los items del menú y de los submenús, con las MISMAS etiquetas
// que se muestran en el sidebar (para que el filtrado por permisos coincida).
// ============================================================================
const GRUPOS_MODULOS: { grupo: string; modulos: string[] }[] = [
  { grupo: 'General', modulos: ['Mis Operaciones', 'Operaciones Activas', 'Pagos', 'Estadísticas', 'Servicios Completados', 'Servicios Cancelados', 'Reportes', 'Reporte de Vencimiento', 'Catálogos'] },
  { grupo: 'Gastos', modulos: ['MTTO', 'Referencias del Diesel', 'Referencias de Puentes', 'Costos Adicionales'] },
  { grupo: 'Clientes', modulos: ['Convenio de Clientes', 'Facturación de Clientes'] },
  { grupo: 'Proveedores', modulos: ['Convenio de Proveedores', 'Facturación de Proveedores'] },
  { grupo: 'Empleados', modulos: ['Colaboradores', 'Historial de Chequeo', 'Nómina', 'Deducciones'] },
  { grupo: 'Bases de Datos', modulos: ['Empresas', 'Contactos', 'Direcciones', 'Tipo de Cambio', 'Combustible', 'Unidades Propias', 'Remolques', 'Proveedores de Unidad', 'Unidades del Proveedor'] },
  { grupo: 'Configuración', modulos: ['Usuarios', 'Roles y Permisos', 'Historial de Actividad', 'Reglas de Estatus', 'Datos de la Empresa', 'Autorizaciones', 'Personalizar Etiquetas'] },
  // ✅ NUEVO: permisos especiales de acción (no son items de menú; habilitan
  // capacidades puntuales). "Editar Referencia" permite editar la referencia
  // (# Ref) de una operación al editarla, igual que un ADMIN.
  // "Ver todos los chequeos": ver el Historial del Reloj Checador de TODOS los
  // colaboradores; sin este permiso, cada quien ve SOLO sus propios registros.
  { grupo: 'Permisos Especiales', modulos: ['Editar Referencia', 'Ver todos los chequeos'] },
];

// Lista plana con todos los módulos (útil para "Seleccionar todo").
const TODOS_LOS_MODULOS = GRUPOS_MODULOS.flatMap(g => g.modulos);

export const RolesDashboard: React.FC = () => {
  const [roles, setRoles] = useState<any[]>([]);
  const [ipOficial, setIpOficial] = useState('');
  const [guardandoIp, setGuardandoIp] = useState(false);
  
  // Estados para el Modal de Rol
  const [modalAbierto, setModalAbierto] = useState(false);
  const [rolEditando, setRolEditando] = useState<any>(null);
  
  const [nombreRol, setNombreRol] = useState('');
  const [modulos, setModulos] = useState<string[]>([]);
  const [cargandoRol, setCargandoRol] = useState(false);

  useEffect(() => {
    // Suscripción a Roles
    const unsubRoles = onSnapshot(collection(db, 'roles'), (snapshot) => {
      const rolesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRoles(rolesData);
    });

    // Cargar Configuración IP
    const fetchConfig = async () => {
      const configRef = doc(db, 'configuracion', 'seguridad');
      const snap = await getDoc(configRef);
      if (snap.exists()) {
        setIpOficial(snap.data().ipOficial || '');
      }
    };
    fetchConfig();

    return () => unsubRoles();
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
    if (!ipOficial) return;
    setGuardandoIp(true);
    try {
      await setDoc(doc(db, 'configuracion', 'seguridad'), { ipOficial }, { merge: true });
      await registrarLog('Seguridad', 'Actualización', `Actualizó la IP Oficial del Reloj Checador a: ${ipOficial}`);
      alert("IP Oficial guardada. El Reloj Checador ahora usará esta red.");
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
    setModalAbierto(true);
  };

  const abrirModalEditar = (rol: any) => {
    setRolEditando(rol);
    setNombreRol(rol.nombre);
    setModulos(rol.modulosPermitidos || []);
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
    <div className="module-container rd-x1">
      
      {/* SECCIÓN 1: CONFIGURACIÓN IP (EXCLUSIVO PARA EL RELOJ) */}
      <div className="rd-x2">
        <h3 className="rd-x3">
          Configuración de Red para Reloj Checador
        </h3>
        <p className="rd-x4">
          Define aquí la Dirección IP pública del internet de tu oficina. Los colaboradores operativos <strong>solo podrán registrar su asistencia</strong> si se encuentran conectados a esta red.
        </p>
        <div className="rd-x5">
          <input 
            type="text" 
            value={ipOficial} 
            onChange={(e) => setIpOficial(e.target.value)} 
            placeholder="Ej. 192.168.1.1" 
            className="form-control rd-x6" 
          />
          <button onClick={detectarIp} className="btn btn-outline rd-x7">
            Detectar mi IP actual
          </button>
          <button onClick={guardarIp} className="btn btn-primary rd-x8" disabled={guardandoIp}>
            {guardandoIp ? 'Guardando...' : 'Guardar IP Oficial'}
          </button>
        </div>
      </div>

      {/* SECCIÓN 2: LISTA DE ROLES */}
      <div className="module-header rd-x9">
        <h2 className="rd-x10">
          Configuración {'>'} <span className="rd-x11">Roles y Permisos ({roles.length})</span>
        </h2>
        <button className="btn btn-primary" onClick={abrirModalNuevo}>+ Nuevo Rol</button>
      </div>

      <div className="table-container rd-x12">
        <table className="data-table rd-x13">
          <thead className="rd-x14">
            <tr>
              <th className="rd-x15">ACCIONES</th>
              <th className="rd-x16">NOMBRE DEL ROL</th>
              <th className="rd-x16">MÓDULOS PERMITIDOS</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(rol => (
              <tr className="rd-x17" key={rol.id}>
                <td className="rd-x18">
                  <div className="rd-x19">
                    <button 
                      onClick={() => abrirModalEditar(rol)} 
                      className="btn-small btn-edit rd-x20"
                    >
                      Editar
                    </button>
                    <button 
                      onClick={() => eliminarRol(rol.id, rol.nombre)} 
                      className="btn-small btn-danger rd-x21"
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
                <td className="rd-x22">{rol.nombre}</td>
                <td className="rd-x23">
                  <div className="rd-x24">
                    {rol.modulosPermitidos?.map((mod: string) => (
                      <span className="rd-x25" key={mod}>
                        {mod}
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
      {modalAbierto && (
        <div className="modal-overlay rd-x26">
          <div className="form-card rd-x27">
            <div className="form-header rd-x28">
              <h2 className="rd-x29">
                {rolEditando ? 'Editar Rol' : 'Nuevo Rol'}
              </h2>
              <button className="rd-x30" onClick={() => setModalAbierto(false)}>✕</button>
            </div>

            <form className="rd-x31" onSubmit={guardarRol}>
              <div className="form-group rd-x32">
                <label className="form-label rd-x33">Nombre del Rol (Ej. VENTAS, ADMIN) *</label>
                <input 
                  type="text" 
                  className="form-control rd-x34" 
                  value={nombreRol} 
                  onChange={(e) => setNombreRol(e.target.value)} 
                  required
                />
              </div>

              <div className="form-group rd-x35">
                <div className="rd-x36">
                  <label className="form-label rd-x37">Selecciona los módulos a los que tendrá acceso:</label>
                  <label className="rd-x38">
                    <input className="rd-x39"
                      type="checkbox"
                      checked={todosSeleccionados}
                      onChange={toggleTodos}
                    />
                    Seleccionar todo
                  </label>
                </div>

                <div className="rd-x40">
                  {GRUPOS_MODULOS.map(g => {
                    const todosGrupo = g.modulos.every(m => modulos.includes(m));
                    const algunosGrupo = g.modulos.some(m => modulos.includes(m));
                    return (
                      <div className="rd-x41" key={g.grupo}>
                        {/* Encabezado del grupo (equivale al item del MENÚ) */}
                        <label className="rd-x42">
                          <input className="rd-x39"
                            type="checkbox"
                            checked={todosGrupo}
                            ref={el => { if (el) el.indeterminate = !todosGrupo && algunosGrupo; }}
                            onChange={() => toggleGrupoModulos(g.modulos)}
                          />
                          <span className="rd-x43">{g.grupo}</span>
                        </label>

                        {/* Módulos del grupo (equivalen a los items del SUBMENÚ) */}
                        <div className="rd-x44">
                          {g.modulos.map(mod => (
                            <label className="rd-x45" key={mod}>
                              <input className="rd-x39" 
                                type="checkbox" 
                                checked={modulos.includes(mod)} 
                                onChange={() => toggleModulo(mod)}
                              />
                              {mod}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rd-x46">
                <button type="button" onClick={() => setModalAbierto(false)} className="btn btn-outline rd-x47">Cancelar</button>
                <button type="submit" className="btn btn-primary rd-x48" disabled={cargandoRol}>
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
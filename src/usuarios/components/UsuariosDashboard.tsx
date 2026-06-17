// src/usuarios/components/UsuariosDashboard.tsx
import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { db, secondaryAuth } from '../../config/firebase';
import { registrarLog } from '../../utils/logger'; 

export const UsuariosDashboard = () => {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [rolesDisponibles, setRolesDisponibles] = useState<any[]>([]);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [usuarioActual, setUsuarioActual] = useState<any | null>(null);
  const [cargando, setCargando] = useState(false);

  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rolesAsignados, setRolesAsignados] = useState<string[]>([]);

  // NUEVOS ESTADOS PARA EL HISTORIAL DE SESIONES
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [usuarioHistorial, setUsuarioHistorial] = useState<any | null>(null);
  const [logsSesion, setLogsSesion] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  useEffect(() => {
    const unsubUsuarios = onSnapshot(collection(db, 'usuarios'), (snapshot) => {
      setUsuarios(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubRoles = onSnapshot(collection(db, 'roles'), (snapshot) => {
      setRolesDisponibles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubUsuarios();
      unsubRoles();
    };
  }, []);

  // EFECTO PARA BUSCAR EL HISTORIAL CUANDO SE ABRE EL MODAL
  useEffect(() => {
    if (!historialAbierto || !usuarioHistorial) return;
    
    setCargandoHistorial(true);
    const q = query(
      collection(db, 'historial_actividad'),
      where('usuario', '==', usuarioHistorial.email),
      where('modulo', '==', 'Sesión') // Filtramos solo lo que sea inicio/cierre de sesión
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Ordenamos por fecha (el más reciente primero) usando JavaScript
      logs.sort((a: any, b: any) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
      
      setLogsSesion(logs);
      setCargandoHistorial(false);
    });

    return () => unsubscribe();
  }, [historialAbierto, usuarioHistorial]);

  const handleAbrirModal = (user?: any) => {
    if (user) {
      setUsuarioActual(user);
      setNombre(user.nombre || '');
      setEmail(user.email || '');
      setPassword(''); 
      setRolesAsignados(user.roles || []);
    } else {
      setUsuarioActual(null);
      setNombre('');
      setEmail('');
      setPassword('');
      setRolesAsignados([]);
    }
    setModalAbierto(true);
  };

  const handleAbrirHistorial = (user: any) => {
    setUsuarioHistorial(user);
    setHistorialAbierto(true);
  };

  const handleToggleRol = (rolNombre: string) => {
    setRolesAsignados(prev => 
      prev.includes(rolNombre) ? prev.filter(r => r !== rolNombre) : [...prev, rolNombre]
    );
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      if (usuarioActual) {
        await setDoc(doc(db, 'usuarios', usuarioActual.id), {
          nombre: nombre.toUpperCase(),
          roles: rolesAsignados,
          fechaActualizacion: new Date().toISOString()
        }, { merge: true });
        
        await registrarLog('Usuarios', 'Edición', `Actualizó los roles/datos del usuario: ${email}`);
        
      } else {
        if (password.length < 6) {
          alert('La contraseña debe tener al menos 6 caracteres.');
          setCargando(false);
          return;
        }

        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
        const newUserId = userCredential.user.uid;

        await setDoc(doc(db, 'usuarios', newUserId), {
          email: email.toLowerCase(),
          nombre: nombre.toUpperCase(),
          roles: rolesAsignados,
          fechaCreacion: new Date().toISOString(),
          activo: true,
          isOnline: false,
          ultimoAcceso: null
        });

        await registrarLog('Usuarios', 'Creación', `Creó el acceso para el usuario: ${email}`);

        try {
          await sendPasswordResetEmail(secondaryAuth, email);
          alert(`Usuario creado con éxito.\n\nSe ha enviado un correo a ${email} para que el usuario establezca su contraseña definitiva.`);
        } catch (emailError) {
          console.error("Error al enviar el correo:", emailError);
          alert("El usuario fue creado, pero hubo un problema al enviar el correo automático.");
        }

        await signOut(secondaryAuth);
      }
      
      setModalAbierto(false);
    } catch (error: any) {
      console.error(error);
      alert('Error: ' + (error.message || 'No se pudo guardar el usuario.'));
    } finally {
      setCargando(false);
    }
  };

  const handleEliminar = async (user: any) => {
    if (window.confirm(`¿Eliminar el acceso del usuario ${user.email}?\n\nNota: Por seguridad, esto elimina sus permisos, pero su cuenta seguirá existiendo en la base de datos de Auth.`)) {
      await deleteDoc(doc(db, 'usuarios', user.id));
      await registrarLog('Usuarios', 'Eliminación', `Revocó el acceso y eliminó al usuario: ${user.email}`);
    }
  };

  const formatearFecha = (fechaIso: string) => {
    if (!fechaIso) return 'Nunca ha ingresado';
    const fecha = new Date(fechaIso);
    return fecha.toLocaleString('es-ES', { 
      day: '2-digit', month: 'short', year: 'numeric', 
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  };

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '1.25rem', color: '#8b949e', margin: 0, fontWeight: '400' }}>
          Configuración {'>'} <span style={{ color: '#f0f6fc', fontWeight: '600' }}>Gestión de Usuarios ({usuarios.length})</span>
        </h2>
        <button className="btn-primary" onClick={() => handleAbrirModal()}>+ Nuevo Usuario</button>
      </div>

      <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto' }}>
        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead style={{ backgroundColor: '#161b22', borderBottom: '1px solid #30363d' }}>
            <tr>
              <th style={{ padding: '16px', width: '220px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600' }}>ACCIONES</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600' }}>ESTADO</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600' }}>USUARIO</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600' }}>CORREO</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600' }}>ROLES ASIGNADOS</th>
              <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600' }}>ÚLTIMO ACCESO</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>No hay usuarios registrados.</td></tr>
            ) : (
              usuarios.map(user => (
                <tr key={user.id} style={{ borderBottom: '1px solid #21262d' }}>
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                      <button onClick={() => handleAbrirModal(user)} style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px 10px', fontSize: '0.8rem' }}>Editar</button>
                      {/* BOTÓN NUEVO PARA VER SESIONES */}
                      <button onClick={() => handleAbrirHistorial(user)} style={{ background: 'transparent', border: '1px solid #10b981', borderRadius: '4px', color: '#10b981', cursor: 'pointer', padding: '6px 10px', fontSize: '0.8rem' }}>Sesiones</button>
                      <button onClick={() => handleEliminar(user)} style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px 10px', fontSize: '0.8rem' }}>Eliminar</button>
                    </div>
                  </td>
                  
                  <td style={{ padding: '16px', textAlign: 'center' }}>
                    {user.isOnline ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#10b981', fontSize: '0.85rem', fontWeight: '500', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '4px 8px', borderRadius: '12px' }}>
                        <span style={{ width: '8px', height: '8px', backgroundColor: '#10b981', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 8px #10b981' }}></span>
                        En línea
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#8b949e', fontSize: '0.85rem', fontWeight: '500', backgroundColor: 'rgba(139, 148, 158, 0.1)', padding: '4px 8px', borderRadius: '12px' }}>
                        <span style={{ width: '8px', height: '8px', backgroundColor: '#8b949e', borderRadius: '50%', display: 'inline-block' }}></span>
                        Desconectado
                      </span>
                    )}
                  </td>

                  <td style={{ padding: '16px', color: '#f0f6fc', fontWeight: '600' }}>{user.nombre}</td>
                  <td style={{ padding: '16px', color: '#8b949e' }}>{user.email}</td>
                  <td style={{ padding: '16px', color: '#c9d1d9' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {user.roles?.map((r: string) => (
                        <span key={r} style={{ backgroundColor: '#21262d', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', border: '1px solid #30363d', color: '#58a6ff' }}>{r}</span>
                      ))}
                    </div>
                  </td>

                  <td style={{ padding: '16px', color: '#8b949e', fontSize: '0.9rem' }}>
                    {formatearFecha(user.ultimoAcceso)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* --- MODAL PARA EDITAR/CREAR USUARIO --- */}
      {modalAbierto && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)' }}>
          <div className="form-card" style={{ maxWidth: '600px', width: '100%', borderRadius: '12px', border: '1px solid #444', backgroundColor: '#0d1117' }}>
            <div className="form-header" style={{ padding: '24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.25rem', color: '#f0f6fc', margin: 0, fontWeight: '500' }}>{usuarioActual ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
              <button onClick={() => setModalAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>
            
            <form onSubmit={handleGuardar} style={{ padding: '24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
                <div className="form-group">
                  <label style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Nombre Completo *</label>
                  <input 
                    type="text" 
                    value={nombre} 
                    onChange={(e) => setNombre(e.target.value)} 
                    required 
                    className="form-control" 
                    style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', width: '100%', padding: '10px', borderRadius: '6px' }}
                  />
                </div>

                <div className="form-group">
                  <label style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Correo Electrónico *</label>
                  <input 
                    type="email" 
                    value={email} 
                    onChange={(e) => setEmail(e.target.value)} 
                    required 
                    disabled={!!usuarioActual} 
                    className="form-control" 
                    style={{ backgroundColor: !!usuarioActual ? '#161b22' : '#010409', border: '1px solid #30363d', color: !!usuarioActual ? '#8b949e' : '#c9d1d9', width: '100%', padding: '10px', borderRadius: '6px' }}
                  />
                </div>
              </div>

              {!usuarioActual && (
                <div className="form-group" style={{ marginBottom: '24px' }}>
                  <label style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '8px' }}>Contraseña Temporal (Mín. 6 caracteres) *</label>
                  <input 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                    minLength={6}
                    className="form-control" 
                    style={{ backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', width: '100%', padding: '10px', borderRadius: '6px' }}
                  />
                </div>
              )}

              <div className="form-group">
                <label style={{ color: '#8b949e', fontSize: '0.85rem', display: 'block', marginBottom: '12px' }}>Roles del Usuario:</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
                  {rolesDisponibles.map(rol => (
                    <label key={rol.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c9d1d9', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input 
                        type="checkbox" 
                        checked={rolesAsignados.includes(rol.nombre)} 
                        onChange={() => handleToggleRol(rol.nombre)} 
                        style={{ accentColor: '#D84315', width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                      {rol.nombre}
                    </label>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '32px', display: 'flex', justifyContent: 'flex-end', gap: '12px', borderTop: '1px solid #30363d', paddingTop: '20px' }}>
                <button type="button" onClick={() => setModalAbierto(false)} style={{ backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', padding: '10px 24px', borderRadius: '6px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" disabled={cargando} style={{ backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '10px 24px', borderRadius: '6px', cursor: 'pointer' }}>
                  {cargando ? 'Guardando...' : (usuarioActual ? 'Actualizar Usuario' : 'Crear Usuario')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL PARA VER EL HISTORIAL DE SESIONES --- */}
      {historialAbierto && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1000 }}>
          <div className="form-card" style={{ maxWidth: '650px', width: '100%', borderRadius: '12px', border: '1px solid #444', backgroundColor: '#0d1117', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="form-header" style={{ padding: '24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '1.25rem', color: '#f0f6fc', margin: 0, fontWeight: '500' }}>Registro de Sesiones</h2>
                <span style={{ color: '#8b949e', fontSize: '0.85rem' }}>{usuarioHistorial?.nombre} ({usuarioHistorial?.email})</span>
              </div>
              <button onClick={() => setHistorialAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
            </div>
            
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              {cargandoHistorial ? (
                <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px' }}>Consultando registros encriptados...</div>
              ) : logsSesion.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#8b949e', padding: '40px' }}>Este usuario aún no tiene registros de inicio o cierre de sesión.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #30363d' }}>
                      <th style={{ padding: '12px 8px', color: '#8b949e', fontSize: '0.75rem', fontWeight: '600' }}>FECHA Y HORA</th>
                      <th style={{ padding: '12px 8px', color: '#8b949e', fontSize: '0.75rem', fontWeight: '600' }}>ACCIÓN</th>
                      <th style={{ padding: '12px 8px', color: '#8b949e', fontSize: '0.75rem', fontWeight: '600' }}>DETALLE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsSesion.map(log => (
                      <tr key={log.id} style={{ borderBottom: '1px solid #21262d' }}>
                        <td style={{ padding: '12px 8px', color: '#c9d1d9', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                          {formatearFecha(log.fecha)}
                        </td>
                        <td style={{ padding: '12px 8px' }}>
                          <span style={{ 
                            backgroundColor: log.accion === 'Inicio de Sesión' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                            color: log.accion === 'Inicio de Sesión' ? '#10b981' : '#ef4444', 
                            padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid transparent' 
                          }}>
                            {log.accion}
                          </span>
                        </td>
                        <td style={{ padding: '12px 8px', color: '#8b949e', fontSize: '0.85rem' }}>
                          {log.detalle}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
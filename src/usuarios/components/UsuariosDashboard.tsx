// src/usuarios/components/UsuariosDashboard.tsx
import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, doc, setDoc, updateDoc, deleteDoc, query, where } from 'firebase/firestore';
import { createUserWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { db, secondaryAuth } from '../../config/firebase';
import { registrarLog } from '../../utils/logger';
import { nombreDeEmpleado } from '../../utils/nombreEmpleado';
import { DIAS_SEMANA, HORARIO_VACIO, horarioDeHoy, type HorarioTrabajo } from '../../utils/horarioTrabajo';
import './UsuariosDashboard.css'; 

// Comprime y redimensiona la imagen a un cuadrado pequeño (máx 256px) en base64,
// para que la foto pese pocos KB y quepa sin problema en el documento de Firestore.
const procesarImagen = (file: File, maxLado = 256): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > height) {
          if (width > maxLado) { height = Math.round((height * maxLado) / width); width = maxLado; }
        } else {
          if (height > maxLado) { width = Math.round((width * maxLado) / height); height = maxLado; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('No se pudo procesar la imagen.'));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Archivo de imagen no válido.'));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(file);
  });

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
  const [fotoPerfil, setFotoPerfil] = useState<string>(''); // ✅ NUEVO
  // ✅ NUEVO: exención de la validación de IP en el Reloj Checador (por usuario).
  const [exentoIpChecador, setExentoIpChecador] = useState(false);
  // ✅ NUEVO: vínculo Usuario ↔ Colaborador (empleados). Un colaborador solo
  //   puede estar conectado a UN usuario: los ya conectados no se ofrecen.
  const [colaboradores, setColaboradores] = useState<{ id: string; nombre: string }[]>([]);
  const [colaboradorId, setColaboradorId] = useState('');
  const [busquedaColab, setBusquedaColab] = useState('');
  // ✅ NUEVO: horario de trabajo semanal (lo usan el Reloj Checador y la
  //   alerta global de "no has marcado").
  const [horarioTrabajo, setHorarioTrabajo] = useState<HorarioTrabajo>({ ...HORARIO_VACIO });
  // ✅ NUEVO: ficha de usuario (clic en la fila) + modal dedicado de horarios.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- el doc de usuario no tiene tipo canónico en este módulo (igual que la lista `usuarios`).
  const [usuarioFicha, setUsuarioFicha] = useState<any | null>(null);
  const [modalHorario, setModalHorario] = useState<null | { origen: 'form' | 'ficha' }>(null);
  const [horarioBorrador, setHorarioBorrador] = useState<HorarioTrabajo>({ ...HORARIO_VACIO });
  const [guardandoHorario, setGuardandoHorario] = useState(false);

  const abrirModalHorario = (origen: 'form' | 'ficha') => {
    const base = origen === 'form' ? horarioTrabajo : { ...HORARIO_VACIO, ...(usuarioFicha?.horarioTrabajo || {}) };
    setHorarioBorrador(JSON.parse(JSON.stringify({ ...HORARIO_VACIO, ...base })));
    setModalHorario({ origen });
  };

  const guardarModalHorario = async () => {
    if (!modalHorario) return;
    if (modalHorario.origen === 'form') {
      // Dentro del formulario: solo se refleja en el estado; se persiste al guardar el usuario.
      setHorarioTrabajo(horarioBorrador);
      setModalHorario(null);
      return;
    }
    // Desde la ficha: se guarda DIRECTO en el documento del usuario.
    if (!usuarioFicha?.id) return;
    setGuardandoHorario(true);
    try {
      await updateDoc(doc(db, 'usuarios', usuarioFicha.id), { horarioTrabajo: horarioBorrador });
      await registrarLog('Usuarios', 'Edición', `Actualizó el horario de trabajo de ${usuarioFicha.nombre || usuarioFicha.email}.`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mismo doc sin tipo canónico.
      setUsuarioFicha((prev: any) => prev ? { ...prev, horarioTrabajo: horarioBorrador } : prev);
      setModalHorario(null);
    } catch (e) {
      console.error('No se pudo guardar el horario:', e);
      alert('No se pudo guardar el horario. Intenta de nuevo.');
    } finally {
      setGuardandoHorario(false);
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);            // ✅ NUEVO

  // NUEVOS ESTADOS PARA EL HISTORIAL DE SESIONES
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [usuarioHistorial, setUsuarioHistorial] = useState<any | null>(null);
  const [logsSesion, setLogsSesion] = useState<any[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  useEffect(() => {
    const unsubUsuarios = onSnapshot(collection(db, 'usuarios'), (snapshot) => {
      setUsuarios(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubColabs = onSnapshot(collection(db, 'empleados'), (snapshot) => {
      // ✅ Los empleados NO tienen campo `nombre`: se compone con
      //   firstName + apellidos (o alias) — ver utils/nombreEmpleado.
      const lista = snapshot.docs
        .map(d => ({ id: d.id, nombre: nombreDeEmpleado(d.data()) }))
        .filter(c => c.nombre)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
      setColaboradores(lista);
    });

    const unsubRoles = onSnapshot(collection(db, 'roles'), (snapshot) => {
      setRolesDisponibles(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubUsuarios();
      unsubRoles();
      unsubColabs();
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
      setFotoPerfil(user.fotoPerfil || ''); // ✅ NUEVO
      setExentoIpChecador(user.exentoIpChecador === true); // ✅ NUEVO
      setColaboradorId(user.colaboradorId || ''); // ✅ NUEVO
      setBusquedaColab('');
      setHorarioTrabajo({ ...HORARIO_VACIO, ...(user.horarioTrabajo || {}) }); // ✅ NUEVO
    } else {
      setUsuarioActual(null);
      setNombre('');
      setEmail('');
      setPassword('');
      setRolesAsignados([]);
      setFotoPerfil(''); // ✅ NUEVO
      setExentoIpChecador(false); // ✅ NUEVO
      setColaboradorId(''); // ✅ NUEVO
      setBusquedaColab('');
      setHorarioTrabajo({ ...HORARIO_VACIO }); // ✅ NUEVO
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

  // ✅ NUEVO: elegir y procesar la imagen de perfil
  const elegirFoto = () => fileRef.current?.click();

  const onArchivoFoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Selecciona un archivo de imagen (JPG, PNG, etc.).');
      return;
    }
    try {
      const dataUrl = await procesarImagen(file);
      setFotoPerfil(dataUrl);
    } catch (err: any) {
      alert(err?.message || 'No se pudo procesar la imagen.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargando(true);
    try {
      if (usuarioActual) {
        await setDoc(doc(db, 'usuarios', usuarioActual.id), {
          nombre: nombre.toUpperCase(),
          roles: rolesAsignados,
          fotoPerfil: fotoPerfil || '', // ✅ NUEVO
          exentoIpChecador, // ✅ NUEVO: puede checar desde cualquier red
          colaboradorId: colaboradorId || '', // ✅ NUEVO: vínculo con Colaborador
          horarioTrabajo, // ✅ NUEVO: horario semanal para el Reloj Checador
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
          fotoPerfil: fotoPerfil || '', // ✅ NUEVO
          exentoIpChecador, // ✅ NUEVO: puede checar desde cualquier red
          colaboradorId: colaboradorId || '', // ✅ NUEVO: vínculo con Colaborador
          horarioTrabajo, // ✅ NUEVO: horario semanal para el Reloj Checador
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

  const inicialesDe = (user: any) => (user?.nombre ? user.nombre.substring(0, 2).toUpperCase() : 'US');

  return (
    <div className="module-container ud-x1">
      <div className="ud-x2">
        <h2 className="ud-x3">
          Configuración {'>'} <span className="ud-x4">Gestión de Usuarios ({usuarios.length})</span>
        </h2>
        <button className="btn-primary" onClick={() => handleAbrirModal()}>+ Nuevo Usuario</button>
      </div>

      <div className="table-container ud-x5">
        <table className="data-table ud-x6">
          <thead className="ud-x7">
            <tr>
              <th className="ud-x8">ACCIONES</th>
              <th className="ud-x9">ESTADO</th>
              <th className="ud-x9">USUARIO</th>
              <th className="ud-x9">CORREO</th>
              <th className="ud-x9">ROLES ASIGNADOS</th>
              <th className="ud-x9">ÚLTIMO ACCESO</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.length === 0 ? (
              <tr><td className="ud-x10" colSpan={6}>No hay usuarios registrados.</td></tr>
            ) : (
              usuarios.map(user => (
                <tr className="ud-x11 ud-fila-clicable" key={user.id} onClick={() => setUsuarioFicha(user)} title="Ver detalle del usuario">
                  <td className="ud-x12" onClick={(e) => e.stopPropagation()}>
                    <div className="ud-x13">
                      <button className="ud-x14" onClick={() => handleAbrirModal(user)}>Editar</button>
                      {/* BOTÓN NUEVO PARA VER SESIONES */}
                      <button className="ud-x15" onClick={() => handleAbrirHistorial(user)}>Sesiones</button>
                      <button className="ud-x16" onClick={() => handleEliminar(user)}>Eliminar</button>
                    </div>
                  </td>
                  
                  <td className="ud-x12">
                    {user.isOnline ? (
                      <span className="ud-x17">
                        <span className="ud-x18"></span>
                        En línea
                      </span>
                    ) : (
                      <span className="ud-x19">
                        <span className="ud-x20"></span>
                        Desconectado
                      </span>
                    )}
                  </td>

                  <td className="ud-x21">
                    <div className="ud-x22">
                      <div className="ud-x23">
                        {user.fotoPerfil
                          ? <img className="ud-x24" src={user.fotoPerfil} alt="" />
                          : inicialesDe(user)}
                      </div>
                      {user.nombre}
                    </div>
                  </td>
                  <td className="ud-x25">{user.email}</td>
                  <td className="ud-x26">
                    <div className="ud-x27">
                      {user.roles?.map((r: string) => (
                        <span className="ud-x28" key={r}>{r}</span>
                      ))}
                    </div>
                  </td>

                  <td className="ud-x29">
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
        <div className="modal-overlay ud-x30">
          <div className="form-card ud-x31">
            <div className="form-header ud-x32">
              <h2 className="ud-x33">{usuarioActual ? 'Editar Usuario' : 'Nuevo Usuario'}</h2>
              <button className="ud-x34" onClick={() => setModalAbierto(false)}>✕</button>
            </div>
            
            <form className="ud-x35" onSubmit={handleGuardar}>
              {/* ✅ Formulario ancho en 3 columnas (como el detalle de operación):
                  1) Identidad · 2) Roles y vínculos · 3) Horario de trabajo. */}
              <div className="ud-form-cols">
              <div className="ud-form-col">
              {/* NUEVO: Foto de perfil */}
              <div className="form-group ud-x36">
                <label className="ud-x37">Foto de Perfil</label>
                <div className="ud-x38">
                  <div className="ud-x39">
                    {fotoPerfil
                      ? <img className="ud-x24" src={fotoPerfil} alt="Perfil" />
                      : (nombre ? nombre.substring(0, 2).toUpperCase() : 'US')}
                  </div>
                  <div className="ud-x40">
                    <input className="ud-x41" ref={fileRef} type="file" accept="image/*" onChange={onArchivoFoto} />
                    <button className="ud-x42" type="button" onClick={elegirFoto}>Elegir imagen</button>
                    {fotoPerfil && (
                      <button className="ud-x43" type="button" onClick={() => setFotoPerfil('')}>Quitar</button>
                    )}
                  </div>
                </div>
              </div>

              <div className="ud-x44">
                <div className="form-group">
                  <label className="ud-x45">Nombre Completo *</label>
                  <input 
                    type="text" 
                    value={nombre} 
                    onChange={(e) => setNombre(e.target.value)} 
                    required 
                    className="form-control ud-x46"
                  />
                </div>

                <div className="form-group">
                  <label className="ud-x45">Correo Electrónico *</label>
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
                <div className="form-group ud-x36">
                  <label className="ud-x45">Contraseña Temporal (Mín. 6 caracteres) *</label>
                  <input 
                    type="password" 
                    value={password} 
                    onChange={(e) => setPassword(e.target.value)} 
                    required 
                    minLength={6}
                    className="form-control ud-x46"
                  />
                </div>
              )}

              </div>

              <div className="ud-form-col">
              <div className="form-group">
                <label className="ud-x37">Roles del Usuario:</label>
                <div className="ud-x47">
                  {rolesDisponibles.map(rol => (
                    <label className="ud-x48" key={rol.id}>
                      <input className="ud-x49" 
                        type="checkbox" 
                        checked={rolesAsignados.includes(rol.nombre)} 
                        onChange={() => handleToggleRol(rol.nombre)}
                      />
                      {rol.nombre}
                    </label>
                  ))}
                </div>

                {/* ✅ NUEVO: vínculo Usuario ↔ Colaborador (exclusivo) */}
                <div className="ud-colab">
                  <label className="form-label">Conectar con colaborador</label>
                  {(() => {
                    // Colaboradores ya conectados a OTROS usuarios: no se ofrecen.
                    const ocupados = new Set(
                      usuarios
                        .filter(u => u.colaboradorId && (!usuarioActual || u.id !== usuarioActual.id))
                        .map(u => String(u.colaboradorId))
                    );
                    const disponibles = colaboradores.filter(c =>
                      !ocupados.has(c.id) &&
                      (!busquedaColab.trim() || c.nombre.toLowerCase().includes(busquedaColab.toLowerCase()))
                    );
                    const seleccionado = colaboradores.find(c => c.id === colaboradorId);
                    return colaboradorId ? (
                      <div className="ud-colab-seleccionado">
                        <span>{seleccionado?.nombre || colaboradorId}</span>
                        <button type="button" onClick={() => setColaboradorId('')} title="Quitar vínculo">✕</button>
                      </div>
                    ) : (
                      <div className="ud-colab-buscador">
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Buscar colaborador por nombre..."
                          value={busquedaColab}
                          onChange={(e) => setBusquedaColab(e.target.value)}
                        />
                        {busquedaColab.trim() && (
                          <ul className="ud-colab-sugerencias">
                            {disponibles.length === 0 ? (
                              <li className="ud-colab-vacio">Sin colaboradores disponibles (los ya conectados no se muestran).</li>
                            ) : disponibles.slice(0, 8).map(c => (
                              <li key={c.id}>
                                <button type="button" onClick={() => { setColaboradorId(c.id); setBusquedaColab(''); }}>{c.nombre}</button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })()}
                  <small className="ud-colab-nota">Vincula este usuario con su registro de Colaboradores (para "Mis Operaciones"). Cada colaborador solo puede conectarse a un usuario.</small>
                </div>

                {/* ✅ NUEVO: exención de IP en el Reloj Checador por usuario */}
                <label className="ud-exento-ip">
                  <input className="ud-x49"
                    type="checkbox"
                    checked={exentoIpChecador}
                    onChange={(e) => setExentoIpChecador(e.target.checked)}
                  />
                  <span>
                    <strong>Exento de IP en el Reloj Checador</strong>
                    <small>Puede registrar su asistencia desde cualquier red (no solo el WiFi de la oficina). Los roles Admin, Gerencia y Sistemas ya están exentos.</small>
                  </span>
                </label>

              </div>

              <div className="ud-form-col">
                {/* ✅ Horario de trabajo: resumen + edición en su propio modal */}
                <div className="ud-horario">
                  <label className="form-label">Horario de trabajo (Reloj Checador)</label>
                  <small className="ud-horario-nota">Con el horario configurado, el checador avisa si se marca antes o después, y la app alerta cuando no se ha marcado.</small>
                  <div className="ud-horario-resumen">
                    {DIAS_SEMANA.map(d => {
                      const dia = horarioTrabajo[d.clave];
                      return (
                        <div className={`ud-horario-resumen-fila${dia?.activo ? ' activa' : ''}`} key={d.clave}>
                          <span>{d.etiqueta}</span>
                          <span>{dia?.activo && dia.entrada && dia.salida ? `${dia.entrada} – ${dia.salida}` : 'No labora'}</span>
                        </div>
                      );
                    })}
                  </div>
                  <button type="button" className="ud-horario-configurar" onClick={() => abrirModalHorario('form')}>
                    Configurar horario
                  </button>
                </div>
              </div>

              </div>
              </div>

              <div className="ud-x50">
                <button className="ud-x51" type="button" onClick={() => setModalAbierto(false)}>Cancelar</button>
                <button className="ud-x52" type="submit" disabled={cargando}>
                  {cargando ? 'Guardando...' : (usuarioActual ? 'Actualizar Usuario' : 'Crear Usuario')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL PARA VER EL HISTORIAL DE SESIONES --- */}
      {historialAbierto && (
        <div className="modal-overlay ud-x53">
          <div className="form-card ud-x54">
            <div className="form-header ud-x32">
              <div>
                <h2 className="ud-x33">Registro de Sesiones</h2>
                <span className="ud-x55">{usuarioHistorial?.nombre} ({usuarioHistorial?.email})</span>
              </div>
              <button className="ud-x34" onClick={() => setHistorialAbierto(false)}>✕</button>
            </div>
            
            <div className="ud-x56">
              {cargandoHistorial ? (
                <div className="ud-x57">Consultando registros encriptados...</div>
              ) : logsSesion.length === 0 ? (
                <div className="ud-x57">Este usuario aún no tiene registros de inicio o cierre de sesión.</div>
              ) : (
                <table className="ud-x6">
                  <thead>
                    <tr className="ud-x58">
                      <th className="ud-x59">FECHA Y HORA</th>
                      <th className="ud-x59">ACCIÓN</th>
                      <th className="ud-x59">DETALLE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logsSesion.map(log => (
                      <tr className="ud-x11" key={log.id}>
                        <td className="ud-x60">
                          {formatearFecha(log.fecha)}
                        </td>
                        <td className="ud-x61">
                          <span style={{ 
                            backgroundColor: log.accion === 'Inicio de Sesión' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', 
                            color: log.accion === 'Inicio de Sesión' ? '#10b981' : '#ef4444', 
                            padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid transparent' 
                          }}>
                            {log.accion}
                          </span>
                        </td>
                        <td className="ud-x62">
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

      {/* ✅ FICHA DE USUARIO (clic en la fila) */}
      {usuarioFicha && (
        <div className="modal-overlay ud-x30" onClick={() => setUsuarioFicha(null)}>
          <div className="form-card ud-ficha" onClick={(e) => e.stopPropagation()}>
            <div className="ud-x32">
              <h2 className="ud-x33">Detalle del Usuario</h2>
              <button className="ud-x34" onClick={() => setUsuarioFicha(null)}>✕</button>
            </div>

            <div className="ud-ficha-cuerpo">
              <div className="ud-ficha-identidad">
                <div className="ud-x39">
                  {usuarioFicha.fotoPerfil
                    ? <img className="ud-x24" src={usuarioFicha.fotoPerfil} alt="" />
                    : inicialesDe(usuarioFicha)}
                </div>
                <div className="ud-ficha-datos">
                  <span className="ud-ficha-nombre">{usuarioFicha.nombre}</span>
                  <span className="ud-ficha-correo">{usuarioFicha.email}</span>
                  <div className="ud-x27">
                    {usuarioFicha.roles?.map((r: string) => (
                      <span className="ud-x28" key={r}>{r}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="ud-ficha-seccion">
                <span className="ud-ficha-etiqueta">Colaborador conectado</span>
                <span className="ud-ficha-valor">
                  {usuarioFicha.colaboradorId
                    ? (colaboradores.find(c => c.id === usuarioFicha.colaboradorId)?.nombre || usuarioFicha.colaboradorId)
                    : 'Sin vincular'}
                </span>
              </div>

              <div className="ud-ficha-seccion">
                <span className="ud-ficha-etiqueta">Reloj Checador</span>
                <span className="ud-ficha-valor">
                  {usuarioFicha.exentoIpChecador === true ? 'Exento de IP (puede checar desde cualquier red)' : 'Requiere la red de la oficina'}
                </span>
              </div>

              <div className="ud-ficha-seccion">
                <div className="ud-ficha-horario-encabezado">
                  <span className="ud-ficha-etiqueta">Horario de trabajo</span>
                  <button type="button" className="ud-horario-configurar" onClick={() => abrirModalHorario('ficha')}>
                    Configurar horario
                  </button>
                </div>
                <div className="ud-horario-resumen">
                  {DIAS_SEMANA.map(d => {
                    const dia = (usuarioFicha.horarioTrabajo || {})[d.clave];
                    return (
                      <div className={`ud-horario-resumen-fila${dia?.activo ? ' activa' : ''}`} key={d.clave}>
                        <span>{d.etiqueta}</span>
                        <span>{dia?.activo && dia.entrada && dia.salida ? `${dia.entrada} – ${dia.salida}` : 'No labora'}</span>
                      </div>
                    );
                  })}
                </div>
                {horarioDeHoy(usuarioFicha.horarioTrabajo) && (
                  <small className="ud-ficha-hoy">Hoy: {horarioDeHoy(usuarioFicha.horarioTrabajo)?.entrada} – {horarioDeHoy(usuarioFicha.horarioTrabajo)?.salida}</small>
                )}
              </div>
            </div>

            <div className="ud-x50 ud-ficha-pie">
              <button className="ud-x51" onClick={() => setUsuarioFicha(null)}>Cerrar</button>
              <button className="ud-x52" onClick={() => { const u = usuarioFicha; setUsuarioFicha(null); handleAbrirModal(u); }}>Editar Usuario</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ MODAL DEDICADO: HORARIO DE TRABAJO */}
      {modalHorario && (
        <div className="modal-overlay ud-horario-overlay">
          <div className="form-card ud-horario-modal">
            <div className="ud-x32">
              <h2 className="ud-x33">Horario de Trabajo</h2>
              <button className="ud-x34" onClick={() => setModalHorario(null)}>✕</button>
            </div>

            <div className="ud-horario-modal-cuerpo">
              <small className="ud-horario-nota">Marca los días laborables y captura su hora de entrada y salida (formato 24 h).</small>
              <div className="ud-horario-tabla">
                {DIAS_SEMANA.map(d => {
                  const dia = horarioBorrador[d.clave] || { activo: false, entrada: '', salida: '' };
                  return (
                    <div className={`ud-horario-fila${dia.activo ? ' activa' : ''}`} key={d.clave}>
                      <label className="ud-horario-dia">
                        <input className="ud-x49"
                          type="checkbox"
                          checked={dia.activo}
                          onChange={(e) => setHorarioBorrador(prev => ({ ...prev, [d.clave]: { ...dia, activo: e.target.checked } }))}
                        />
                        {d.etiqueta}
                      </label>
                      <input
                        type="time"
                        className="ud-horario-hora"
                        value={dia.entrada}
                        disabled={!dia.activo}
                        onChange={(e) => setHorarioBorrador(prev => ({ ...prev, [d.clave]: { ...dia, entrada: e.target.value } }))}
                        title="Hora de entrada"
                      />
                      <span className="ud-horario-sep">a</span>
                      <input
                        type="time"
                        className="ud-horario-hora"
                        value={dia.salida}
                        disabled={!dia.activo}
                        onChange={(e) => setHorarioBorrador(prev => ({ ...prev, [d.clave]: { ...dia, salida: e.target.value } }))}
                        title="Hora de salida"
                      />
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="ud-horario-copiar"
                onClick={() => {
                  const lun = horarioBorrador.lun;
                  if (!lun?.activo || !lun.entrada || !lun.salida) { alert('Configura primero el Lunes para copiarlo al resto de la semana.'); return; }
                  setHorarioBorrador(prev => {
                    const nuevo = { ...prev };
                    ['mar', 'mie', 'jue', 'vie'].forEach(c => { nuevo[c] = { ...lun }; });
                    return nuevo;
                  });
                }}
              >Copiar Lunes a Mar–Vie</button>
            </div>

            <div className="ud-x50">
              <button className="ud-x51" type="button" onClick={() => setModalHorario(null)} disabled={guardandoHorario}>Cancelar</button>
              <button className="ud-x52" type="button" onClick={guardarModalHorario} disabled={guardandoHorario}>
                {guardandoHorario ? 'Guardando...' : 'Guardar Horario'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
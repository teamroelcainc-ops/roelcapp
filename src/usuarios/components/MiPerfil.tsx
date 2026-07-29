// src/usuarios/components/MiPerfil.tsx
import React, { useState, useRef } from 'react';
import { updateDoc, doc } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth, db } from '../../config/firebase';
import { registrarLog } from '../../utils/logger';
import './MiPerfil.css';

interface MiPerfilProps {
  usuario: any;                       // documento del usuario (id, email, nombre, fotoPerfil, ...)
  onClose: () => void;
  onActualizado: (usuario: any) => void; // notifica al padre para refrescar avatar
}

// Comprime y redimensiona la imagen a un cuadrado pequeño (máx 256px) en base64.
// Así la foto pesa pocos KB y cabe sin problema en el documento de Firestore.
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

export const MiPerfil: React.FC<MiPerfilProps> = ({ usuario, onClose, onActualizado }) => {
  const [foto, setFoto] = useState<string>(usuario?.fotoPerfil || '');
  const [guardandoFoto, setGuardandoFoto] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [passActual, setPassActual] = useState('');
  const [passNueva, setPassNueva] = useState('');
  const [passConfirma, setPassConfirma] = useState('');
  const [guardandoPass, setGuardandoPass] = useState(false);

  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');

  const iniciales = usuario?.nombre ? usuario.nombre.substring(0, 2).toUpperCase() : 'US';

  const elegirFoto = () => fileRef.current?.click();

  const onArchivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setMensaje('');
    if (!file.type.startsWith('image/')) {
      setError('Selecciona un archivo de imagen (JPG, PNG, etc.).');
      return;
    }
    try {
      const dataUrl = await procesarImagen(file);
      setFoto(dataUrl);
    } catch (err: any) {
      setError(err?.message || 'No se pudo procesar la imagen.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const guardarFoto = async () => {
    if (!usuario?.id) {
      setError('No hay un usuario válido para actualizar la foto.');
      return;
    }
    setGuardandoFoto(true);
    setError('');
    setMensaje('');
    try {
      await updateDoc(doc(db, 'usuarios', usuario.id), { fotoPerfil: foto });
      await registrarLog('Usuarios', 'Edición', 'Actualizó su foto de perfil.');
      onActualizado({ ...usuario, fotoPerfil: foto });
      setMensaje('Foto de perfil actualizada.');
    } catch (err: any) {
      console.error(err);
      setError('No se pudo guardar la foto. Intenta de nuevo.');
    } finally {
      setGuardandoFoto(false);
    }
  };

  const quitarFoto = async () => {
    if (!usuario?.id) return;
    setGuardandoFoto(true);
    setError('');
    setMensaje('');
    try {
      await updateDoc(doc(db, 'usuarios', usuario.id), { fotoPerfil: '' });
      setFoto('');
      onActualizado({ ...usuario, fotoPerfil: '' });
      setMensaje('Foto de perfil eliminada.');
    } catch (err: any) {
      console.error(err);
      setError('No se pudo quitar la foto.');
    } finally {
      setGuardandoFoto(false);
    }
  };

  const cambiarPassword = async () => {
    setError('');
    setMensaje('');

    if (!auth.currentUser || !auth.currentUser.email) {
      setError('El cambio de contraseña no está disponible en modo de prueba (Bypass). Inicia sesión con tu correo y contraseña.');
      return;
    }
    if (!passActual || !passNueva || !passConfirma) {
      setError('Completa los tres campos de contraseña.');
      return;
    }
    if (passNueva.length < 6) {
      setError('La nueva contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (passNueva !== passConfirma) {
      setError('La nueva contraseña y su confirmación no coinciden.');
      return;
    }

    setGuardandoPass(true);
    try {
      // Firebase exige autenticación reciente para cambiar la contraseña.
      const cred = EmailAuthProvider.credential(auth.currentUser.email, passActual);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, passNueva);
      await registrarLog('Seguridad', 'Cambio de Contraseña', 'El usuario actualizó su contraseña.');
      setMensaje('Contraseña actualizada correctamente.');
      setPassActual(''); setPassNueva(''); setPassConfirma('');
    } catch (err: any) {
      console.error(err);
      const code = err?.code || '';
      if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
        setError('La contraseña actual es incorrecta.');
      } else if (code === 'auth/weak-password') {
        setError('La nueva contraseña es demasiado débil.');
      } else if (code === 'auth/too-many-requests') {
        setError('Demasiados intentos. Espera unos minutos e intenta de nuevo.');
      } else {
        setError('No se pudo cambiar la contraseña. Intenta de nuevo.');
      }
    } finally {
      setGuardandoPass(false);
    }
  };

  const labelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.8rem', display: 'block', marginBottom: '6px' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' };

  return (
    <div className="modal-overlay mp-x1">
      <div className="form-card mp-x2">
        <div className="form-header mp-x3">
          <h2 className="mp-x4">Mi Perfil</h2>
          <button className="mp-x5" onClick={onClose}>✕</button>
        </div>

        <div className="mp-x6">
          {error && (
            <div className="mp-x7">{error}</div>
          )}
          {mensaje && (
            <div className="mp-x8">{mensaje}</div>
          )}

          {/* ───── FOTO DE PERFIL ───── */}
          <h3 className="mp-x9">Foto de Perfil</h3>
          <div className="mp-x10">
            <div className="mp-x11">
              {foto ? <img className="mp-x12" src={foto} alt="Perfil" /> : iniciales}
            </div>
            <div className="mp-x13">
              <input className="mp-x14" ref={fileRef} type="file" accept="image/*" onChange={onArchivo} />
              <button className="mp-x15" type="button" onClick={elegirFoto}>Elegir imagen</button>
              {foto && (
                <button className="mp-x16" type="button" onClick={quitarFoto} disabled={guardandoFoto}>Quitar foto</button>
              )}
            </div>
          </div>
          <p className="mp-x17">La imagen se ajusta automáticamente a un tamaño pequeño antes de guardarse.</p>
          <button type="button" onClick={guardarFoto} disabled={guardandoFoto} style={{ padding: '10px 20px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: guardandoFoto ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
            {guardandoFoto ? 'Guardando...' : 'Guardar Foto'}
          </button>

          <hr className="mp-x18" />

          {/* ───── CONTRASEÑA ───── */}
          <h3 className="mp-x9">Cambiar Contraseña</h3>
          <div className="mp-x19">
            <div>
              <label style={labelStyle}>Contraseña actual</label>
              <input type="password" value={passActual} onChange={e => setPassActual(e.target.value)} placeholder="••••••••" style={inputStyle} />
            </div>
            <div className="mp-x20">
              <div>
                <label style={labelStyle}>Nueva contraseña</label>
                <input type="password" value={passNueva} onChange={e => setPassNueva(e.target.value)} placeholder="Mín. 6 caracteres" style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Confirmar nueva</label>
                <input type="password" value={passConfirma} onChange={e => setPassConfirma(e.target.value)} placeholder="Repite la nueva" style={inputStyle} />
              </div>
            </div>
          </div>
          <button type="button" onClick={cambiarPassword} disabled={guardandoPass} style={{ padding: '10px 20px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', cursor: guardandoPass ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
            {guardandoPass ? 'Actualizando...' : 'Actualizar Contraseña'}
          </button>
        </div>

        <div className="mp-x21">
          <button className="mp-x22" onClick={onClose}>Cerrar</button>
        </div>
      </div>
    </div>
  );
};
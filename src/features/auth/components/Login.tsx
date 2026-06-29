// src/features/auth/components/Login.tsx
import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { doc, updateDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
// ✅ NUEVO: logo de la empresa (mismo base64 que usan los PDF) para mostrarlo en el login.
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';

// Clave de localStorage para recordar el último correo que inició sesión en ESTA computadora.
const LS_ULTIMO_CORREO = 'roelca_ultimo_correo';

interface LoginProps {
  onLoginSuccess: () => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mostrarPassword, setMostrarPassword] = useState(false); // ✅ NUEVO: ver/ocultar contraseña
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState(''); // ✅ NUEVO: mensajes de éxito (ej. reset enviado)
  const [loading, setLoading] = useState(false);
  const [enviandoReset, setEnviandoReset] = useState(false); // ✅ NUEVO

  // ✅ NUEVO: al abrir el login, precargamos el último correo guardado en esta computadora.
  useEffect(() => {
    try {
      const ultimo = localStorage.getItem(LS_ULTIMO_CORREO);
      if (ultimo) setEmail(ultimo);
    } catch {
      // localStorage puede no estar disponible (modo privado, etc.); lo ignoramos.
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMensaje('');
    setLoading(true);

    try {
      // 1. Validar correo y contraseña en Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const user = userCredential.user;

      // 2. Traer el perfil del usuario para ver qué roles tiene asignados
      const userDoc = await getDoc(doc(db, 'usuarios', user.uid));
      if (!userDoc.exists()) throw new Error("Perfil de usuario no encontrado.");
      const userData = userDoc.data();

      // 3. Traer la configuración de seguridad global (La IP de la Oficina)
      const configDoc = await getDoc(doc(db, 'configuracion', 'seguridad'));
      const ipOficina = configDoc.exists() ? configDoc.data().ipOficina : '';

      // 4. Verificar si alguno de sus roles requiere estar en la oficina
      let requiereEstarEnOficina = false;
      if (userData.roles && userData.roles.length > 0) {
        const rolesQuery = query(collection(db, 'catalogo_roles'), where('nombre', 'in', userData.roles));
        const rolesSnap = await getDocs(rolesQuery);
        
        rolesSnap.forEach((rolDoc) => {
          if (rolDoc.data().requiereIPOficina) {
            requiereEstarEnOficina = true;
          }
        });
      }

      // 5. EL CENTINELA: Si su rol exige oficina, comprobamos su IP actual
      if (requiereEstarEnOficina) {
        try {
          const ipRes = await fetch('https://api.ipify.org?format=json');
          const ipData = await ipRes.json();
          const userIPActual = ipData.ip;

          if (userIPActual !== ipOficina) {
            // ¡INTRUSO BLOQUEADO!
            await signOut(auth); // Cerramos la sesión que Firebase acababa de abrir
            await registrarLog('Seguridad', 'Bloqueo de Red', `Intento de acceso denegado para ${email}. IP detectada: ${userIPActual}`);
            setError('ACCESO DENEGADO. Por medidas de seguridad, tu rol solo permite iniciar sesión desde la red WiFi de la oficina de Roelca Inc.');
            setLoading(false);
            return; // Cortamos la ejecución aquí
          }
        } catch (fetchError) {
          // Si por alguna razón el bloqueador de anuncios del usuario bloquea la comprobación de IP
          await signOut(auth);
          setError('No pudimos verificar la seguridad de tu red. Desactiva tu bloqueador de anuncios (AdBlock) e intenta de nuevo.');
          setLoading(false);
          return;
        }
      }

      // 6. SI PASÓ TODAS LAS PRUEBAS: Lo dejamos entrar al sistema
      await updateDoc(doc(db, 'usuarios', user.uid), {
        isOnline: true,
        ultimoAcceso: new Date().toISOString()
      });

      // ✅ NUEVO: recordamos este correo en la computadora para la próxima vez.
      try { localStorage.setItem(LS_ULTIMO_CORREO, email); } catch { /* ignore */ }

      await registrarLog('Sesión', 'Inicio de Sesión', 'El usuario ingresó exitosamente al sistema.');

      onLoginSuccess();
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes("ACCESO DENEGADO")) {
        setError(err.message);
      } else {
        setError('Correo o contraseña incorrectos. Por favor, verifica tus datos.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ✅ NUEVO: Envía el correo de recuperación de contraseña (Firebase) al email escrito.
  const handleResetPassword = async () => {
    setError('');
    setMensaje('');

    const correo = email.trim();
    if (!correo) {
      setError('Escribe tu correo electrónico arriba para enviarte el enlace de recuperación.');
      return;
    }

    setEnviandoReset(true);
    try {
      await sendPasswordResetEmail(auth, correo);
      await registrarLog('Sesión', 'Recuperación de Contraseña', `Se solicitó restablecer la contraseña para ${correo}.`);
      setMensaje(`Te enviamos un enlace de recuperación a ${correo}. Revisa tu bandeja de entrada (y la carpeta de spam).`);
    } catch (err: any) {
      console.error(err);
      const code = err?.code || '';
      if (code === 'auth/invalid-email') {
        setError('El correo electrónico no tiene un formato válido.');
      } else if (code === 'auth/user-not-found') {
        // Por seguridad mostramos un mensaje neutro (no confirmamos si el correo existe o no).
        setMensaje(`Si ${correo} está registrado, te enviamos un enlace de recuperación. Revisa tu bandeja de entrada.`);
      } else {
        setError('No se pudo enviar el correo de recuperación. Intenta de nuevo en unos minutos.');
      }
    } finally {
      setEnviandoReset(false);
    }
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', display: 'flex', backgroundColor: '#010409', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div className="form-card" style={{ maxWidth: '400px', width: '100%', padding: '40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          {/* ✅ NUEVO: Logo de la empresa */}
          <img
            src={LOGO_DEFAULT}
            alt="Roelca Inc."
            style={{ maxWidth: '120px', height: 'auto', marginBottom: '16px' }}
          />
          <p style={{ color: '#8b949e', margin: 0, fontSize: '0.9rem' }}>Ingresa tus credenciales para acceder al sistema</p>
        </div>

        {error && (
          <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#ef4444', padding: '16px', borderRadius: '6px', marginBottom: '20px', fontSize: '0.85rem', textAlign: 'center', lineHeight: '1.5', fontWeight: '500' }}>
            {error}
          </div>
        )}

        {mensaje && (
          <div style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.4)', color: '#10b981', padding: '16px', borderRadius: '6px', marginBottom: '20px', fontSize: '0.85rem', textAlign: 'center', lineHeight: '1.5', fontWeight: '500' }}>
            {mensaje}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.85rem', marginBottom: '8px' }}>Correo Electrónico</label>
            <input 
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="form-control" 
              placeholder="tu@correo.com"
              required 
              style={{ width: '100%', padding: '12px', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px' }}
            />
          </div>

          <div className="form-group" style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', color: '#8b949e', fontSize: '0.85rem', marginBottom: '8px' }}>Contraseña</label>
            {/* ✅ NUEVO: campo con botón de ojo para mostrar/ocultar la contraseña */}
            <div style={{ position: 'relative' }}>
              <input 
                type={mostrarPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-control" 
                placeholder="••••••••"
                required 
                style={{ width: '100%', padding: '12px 46px 12px 12px', backgroundColor: '#010409', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '6px', boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setMostrarPassword((v) => !v)}
                title={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: '#8b949e', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onMouseEnter={(e: any) => (e.currentTarget.style.color = '#c9d1d9')}
                onMouseLeave={(e: any) => (e.currentTarget.style.color = '#8b949e')}
              >
                {mostrarPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                )}
              </button>
            </div>
          </div>

          {/* ✅ NUEVO: "¿Olvidaste tu contraseña?" debajo del campo de contraseña */}
          <div style={{ textAlign: 'right', marginBottom: '24px' }}>
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={enviandoReset}
              style={{ background: 'none', border: 'none', color: '#58a6ff', fontSize: '0.8rem', cursor: enviandoReset ? 'not-allowed' : 'pointer', padding: 0, textDecoration: 'underline', opacity: enviandoReset ? 0.7 : 1 }}
            >
              {enviandoReset ? 'Enviando enlace...' : '¿Olvidaste tu contraseña?'}
            </button>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            style={{ width: '100%', padding: '12px', backgroundColor: '#D84315', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '1rem', fontWeight: '500', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? 'Verificando red y accesos...' : 'Iniciar Sesión'}
          </button>
        </form>

      </div>
    </div>
  );
};
// src/features/relojChecador/components/RelojChecadorModal.tsx
import React, { useState, useEffect } from 'react';
import { collection, addDoc, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import './RelojChecadorModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usuario: any;
}

export const RelojChecadorModal: React.FC<Props> = ({ isOpen, onClose, usuario }) => {
  const [tiempoActual, setTiempoActual] = useState(new Date());
  const [tipoRegistro, setTipoRegistro] = useState('');
  
  const [coordenadasVisuales, setCoordenadasVisuales] = useState(''); 
  const [ubicacionBD, setUbicacionBD] = useState(''); 
  
  const [obteniendoGps, setObteniendoGps] = useState(false);
  const [cargando, setCargando] = useState(false);
  
  const [registrosHoy, setRegistrosHoy] = useState<string[]>([]);
  const [cargandoDatos, setCargandoDatos] = useState(true);

  const [ipValida, setIpValida] = useState<boolean | null>(null);
  const [ipActualUsuario, setIpActualUsuario] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    const timer = setInterval(() => {
      setTiempoActual(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !usuario) return;

    const inicializarChecador = async () => {
      setCargandoDatos(true);
      try {
        const rolesExentos = ['Admin', 'Gerencia', 'Sistemas'];
        let accesoPermitido = true;

        if (!rolesExentos.includes(usuario.rol)) {
          const configRef = doc(db, 'configuracion', 'seguridad');
          const configSnap = await getDoc(configRef);
          const ipOficial = configSnap.exists() ? configSnap.data().ipOficial : null;

          if (ipOficial) {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            const ipActual = data.ip;
            setIpActualUsuario(ipActual);

            if (ipActual !== ipOficial) {
              accesoPermitido = false;
            }
          }
        }

        setIpValida(accesoPermitido);

        if (!accesoPermitido) {
          setCargandoDatos(false);
          return;
        }

        const fechaLocal = new Date().toLocaleDateString('es-MX');
        const q = query(
          collection(db, 'reloj_checador'),
          where('userId', '==', usuario.id),
          where('fecha', '==', fechaLocal)
        );
        
        const snap = await getDocs(q);
        const tipos = snap.docs.map(doc => doc.data().tipoRegistro);
        
        setRegistrosHoy(tipos);

        if (!tipos.includes('Llegada al Turno')) {
          setTipoRegistro('Llegada al Turno');
        } else if (tipos.includes('Llegada al Turno') && !tipos.includes('Salida a la Comida') && !tipos.includes('Salida del Turno')) {
          setTipoRegistro('Salida del Turno');
        } else if (tipos.includes('Salida a la Comida') && !tipos.includes('Llegada de la Comida')) {
          setTipoRegistro('Llegada de la Comida');
        } else if (tipos.includes('Llegada de la Comida') && !tipos.includes('Salida del Turno')) {
          setTipoRegistro('Salida del Turno');
        } else {
          setTipoRegistro(''); 
        }

      } catch (error) {
        console.error("Error al inicializar checador:", error);
        alert("Hubo un problema de conexión al verificar la red.");
      } finally {
        setCargandoDatos(false);
      }
    };

    inicializarChecador();
  }, [isOpen, usuario]);

  const obtenerUbicacion = () => {
    if (!navigator.geolocation) {
      alert('Tu navegador no soporta geolocalización.');
      return;
    }
    
    setObteniendoGps(true);

    // CONFIGURACIÓN ROBUSTA PARA PC DE ESCRITORIO Y NAVEGADORES PRIVADOS
    const opcionesGps = {
      enableHighAccuracy: false, // En PC, true provoca fallos si no hay chip GPS
      timeout: 15000,           // Máximo 15 segundos esperando
      maximumAge: 0             // No usar caché vieja
    };

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        
        setCoordenadasVisuales(`${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
        
        // Link real y funcional de Google Maps con Pin Exacto
        const mapsLink = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
        setUbicacionBD(mapsLink);
        
        setObteniendoGps(false);
      },
      (error) => {
        console.error("Error GPS detallado:", error);
        let mensaje = 'No se pudo obtener la ubicación automáticamente.\n\nMotivo: ';
        
        if (error.code === 1) mensaje += 'Permiso denegado. (Revisa la configuración de Privacidad de Windows/Mac o del navegador Brave).';
        else if (error.code === 2) mensaje += 'Posición no disponible. (Común en PC de escritorio sin tarjeta WiFi).';
        else if (error.code === 3) mensaje += 'El tiempo de espera se agotó.';
        else mensaje += 'Error desconocido.';

        alert(mensaje + '\n\nPuedes escribir la dirección o "Ubicación en Oficina" manualmente en el recuadro si tu rol lo permite.');
        setObteniendoGps(false);
      },
      opcionesGps
    );
  };

  const handleIngresoManualGPS = (e: React.ChangeEvent<HTMLInputElement>) => {
    const texto = e.target.value;
    setCoordenadasVisuales(texto);
    setUbicacionBD(texto); 
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ubicacionBD) {
      alert("La ubicación es obligatoria para poder checar. Por favor presiona el botón GPS o escríbela a mano.");
      return;
    }
    if (!tipoRegistro) {
      alert("No hay un tipo de registro válido seleccionado.");
      return;
    }

    setCargando(true);
    try {
      const fechaLocal = tiempoActual.toLocaleDateString('es-MX');
      const horaLocal = tiempoActual.toLocaleTimeString('es-MX');

      await addDoc(collection(db, 'reloj_checador'), {
        userId: usuario.id,
        userName: usuario.nombre || usuario.correo, 
        fecha: fechaLocal,
        hora: horaLocal,
        tipoRegistro: tipoRegistro,
        ubicacion: ubicacionBD, 
        ipRegistro: ipActualUsuario || 'Exento',
        timestamp: tiempoActual.getTime() 
      });

      await registrarLog('Asistencia', 'Chequeo', `${usuario.nombre || usuario.correo} registró: ${tipoRegistro}`);
      alert("¡Registro guardado exitosamente!");
      onClose();
    } catch (error) {
      console.error("Error al guardar chequeo:", error);
      alert("Error al guardar. Revisa tu conexión.");
    } finally {
      setCargando(false);
    }
  };

  if (!isOpen || !usuario) return null;

  const hasLlegadaTurno = registrosHoy.includes('Llegada al Turno');
  const hasSalidaComida = registrosHoy.includes('Salida a la Comida');
  const hasLlegadaComida = registrosHoy.includes('Llegada de la Comida');
  const hasSalidaTurno = registrosHoy.includes('Salida del Turno');

  const opcionesDisponibles: string[] = [];

  if (!hasLlegadaTurno) {
    opcionesDisponibles.push('Llegada al Turno');
  } else if (!hasSalidaTurno) {
    if (!hasSalidaComida) opcionesDisponibles.push('Salida a la Comida');
    if (hasSalidaComida && !hasLlegadaComida) opcionesDisponibles.push('Llegada de la Comida');
    if (!hasSalidaComida || (hasSalidaComida && hasLlegadaComida)) opcionesDisponibles.push('Salida del Turno');
  }

  const jornadaTerminada = hasSalidaTurno;

  return (
    <div className="modal-overlay rcm-x1">
      <div className="form-card rcm-x2">
        <div className="rcm-x3">
          <h2 className="rcm-x4">⏱️ Reloj Checador</h2>
          <p className="rcm-x5">Registra tu asistencia del día</p>
        </div>

        {cargandoDatos ? (
          <div className="rcm-x6">
            <div className="rcm-x7">⏳</div>
            Verificando credenciales de red y leyendo historial del día...
          </div>
        ) : ipValida === false ? (
          <div className="rcm-x8">
            <div className="rcm-x9">
              <span className="rcm-x10">⛔</span>
              <h3 className="rcm-x11">Acceso Denegado</h3>
              <p className="rcm-x12">
                No estás conectado a la red WiFi oficial de la oficina.<br/><br/>
                Tu IP actual es: <strong className="rcm-x13">{ipActualUsuario}</strong>
              </p>
            </div>
            <button onClick={onClose} className="btn btn-outline rcm-x14">Cerrar</button>
          </div>
        ) : (
          <form className="rcm-x15" onSubmit={handleSubmit}>
            
            <div className="rcm-x16">
              <div className="rcm-x17">
                {tiempoActual.toLocaleTimeString('es-MX', { hour12: false })}
              </div>
              <div className="rcm-x18">
                {tiempoActual.toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label rcm-x19">Colaborador</label>
              <input type="text" className="form-control rcm-x20" value={usuario.nombre || usuario.correo} disabled />
            </div>

            {jornadaTerminada ? (
              <div className="rcm-x21">
                <span className="rcm-x22">¡Jornada Finalizada! 🎉</span>
                <span className="rcm-x23">Ya has registrado tu salida del turno por el día de hoy. ¡Buen trabajo!</span>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label className="form-label rcm-x19">Tipo de Registro *</label>
                  <select 
                    className="form-control rcm-x24" 
                    value={tipoRegistro} 
                    onChange={(e) => setTipoRegistro(e.target.value)} 
                    required
                  >
                    {opcionesDisponibles.map(opcion => (
                      <option key={opcion} value={opcion}>{opcion}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label rcm-x19">Ubicación (Lat, Lng) *</label>
                  <div className="rcm-x25">
                    <input 
                      type="text" 
                      className="form-control font-mono rcm-x26" 
                      value={coordenadasVisuales} 
                      onChange={handleIngresoManualGPS} 
                      placeholder="Presiona el botón de GPS..." 
                      required 
                      readOnly={obteniendoGps}
                    />
                    <button type="button" onClick={obtenerUbicacion} disabled={obteniendoGps} className="btn btn-outline rcm-x27">
                      {obteniendoGps ? 'Buscando...' : '📍 GPS'}
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="rcm-x28">
              <button type="button" onClick={onClose} className="btn btn-outline">{jornadaTerminada ? 'Cerrar' : 'Cancelar'}</button>
              
              {!jornadaTerminada && (
                <button type="submit" className="btn btn-primary rcm-x29" disabled={cargando || obteniendoGps || !tipoRegistro}>
                  {cargando ? 'Registrando...' : 'Confirmar Chequeo'}
                </button>
              )}
            </div>

          </form>
        )}
      </div>
    </div>
  );
};
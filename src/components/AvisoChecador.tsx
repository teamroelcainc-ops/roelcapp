// src/components/AvisoChecador.tsx
// ---------------------------------------------------------------------------
// Alerta GLOBAL del Reloj Checador: si el usuario tiene horario configurado
// para hoy y ya pasó su hora de entrada (o de salida) sin la marca
// correspondiente, aparece un aviso naranja bajo la barra superior.
// Solo aplica cuando el horario está configurado en Usuarios (requisito).
// ---------------------------------------------------------------------------
import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../config/firebase';
import { useUsuarioStore } from '../stores/useUsuarioStore';
import { horarioDeHoy } from '../utils/horarioTrabajo';
import { AlarmClock } from 'lucide-react';
import './AvisoChecador.css';

export function AvisoChecador() {
  const usuario = useUsuarioStore((s) => s.usuario);
  const [tiposHoy, setTiposHoy] = useState<string[] | null>(null); // null = cargando
  const [ahora, setAhora] = useState(new Date());
  const [descartadoPara, setDescartadoPara] = useState(''); // "fecha|tipo" descartado

  const diaHoy = useMemo(() => horarioDeHoy(usuario?.horarioTrabajo, ahora), [usuario?.horarioTrabajo, ahora]);
  // Variable simple para las dependencias del efecto (regla exhaustive-deps):
  // la suscripción solo depende de SI hay horario hoy, no del objeto completo
  // (que cambia de referencia cada minuto con el reloj).
  const hayHorarioHoy = !!diaHoy;

  // Re-evaluar cada minuto (para que el aviso aparezca al cruzar la hora).
  useEffect(() => {
    const timer = window.setInterval(() => setAhora(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Marcas del día del usuario, en vivo (mismo formato de fecha que el checador).
  useEffect(() => {
    // Sin usuario u horario hoy no se suscribe nada; el render ya se corta por
    // `!diaHoy`, así que no hace falta resetear el estado aquí (regla de hooks).
    if (!usuario?.id || !hayHorarioHoy) return;
    const fechaLocal = new Date().toLocaleDateString('es-MX');
    const q = query(
      collection(db, 'reloj_checador'),
      where('userId', '==', usuario.id),
      where('fecha', '==', fechaLocal)
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setTiposHoy(snap.docs.map((d) => String((d.data() as { tipoRegistro?: string }).tipoRegistro || '')));
    }, () => setTiposHoy([]));
    return () => unsubscribe();
  }, [usuario?.id, hayHorarioHoy]);

  if (!usuario || !diaHoy || tiposHoy === null) return null;

  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  const [eh, em] = diaHoy.entrada.split(':').map(Number);
  const [sh, sm] = diaHoy.salida.split(':').map(Number);
  const entradaMin = eh * 60 + em;
  const salidaMin = sh * 60 + sm;

  const faltaLlegada = minutosAhora >= entradaMin && !tiposHoy.includes('Llegada al Turno');
  const faltaSalida = !faltaLlegada && minutosAhora >= salidaMin && tiposHoy.includes('Llegada al Turno') && !tiposHoy.includes('Salida del Turno');

  if (!faltaLlegada && !faltaSalida) return null;

  const tipo = faltaLlegada ? 'llegada' : 'salida';
  const claveDescarte = `${new Date().toLocaleDateString('es-MX')}|${tipo}`;
  if (descartadoPara === claveDescarte) return null;

  return (
    <div className="avchk-banner" role="alert">
      <AlarmClock size={16} />
      <span className="avchk-texto">
        {faltaLlegada
          ? <>No has marcado tu <strong>llegada</strong> en el Reloj Checador. Tu entrada era a las <strong>{diaHoy.entrada}</strong>.</>
          : <>No has marcado tu <strong>salida</strong> en el Reloj Checador. Tu salida era a las <strong>{diaHoy.salida}</strong>.</>}
      </span>
      <button className="avchk-cerrar" onClick={() => setDescartadoPara(claveDescarte)} title="Ocultar por ahora">✕</button>
    </div>
  );
}

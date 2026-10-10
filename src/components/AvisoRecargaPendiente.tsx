// src/components/AvisoRecargaPendiente.tsx
// ✅ V00438 (Fase 2.10): cuando hay una versión nueva de la app pero un
//   formulario abierto (o un guardado en curso) detiene la recarga, se avisa
//   para que el usuario guarde y cierre; la app se actualiza sola después.
import { useSyncExternalStore } from 'react';
import { hayRecargaEnEspera, suscribirEdiciones } from '../shared/utils/edicionesAbiertas';
import './AvisoRecargaPendiente.css';

export default function AvisoRecargaPendiente() {
  const enEspera = useSyncExternalStore(suscribirEdiciones, hayRecargaEnEspera, hayRecargaEnEspera);
  if (!enEspera) return null;
  return (
    <div className="aviso-recarga" role="status">
      Hay una versión nueva del sistema. Guarda y cierra el formulario abierto: la app se actualizará sola.
    </div>
  );
}

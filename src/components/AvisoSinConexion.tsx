// src/components/AvisoSinConexion.tsx
// Banner global: aparece cuando el dispositivo pierde internet. Las escrituras
// de Firestore quedan ENCOLADAS por el caché persistente y se sincronizan
// solas al reconectar — el banner lo comunica para que el usuario no repita
// la operación pensando que falló.
import { WifiOff } from 'lucide-react';
import { useEstadoConexion } from '../hooks/useEstadoConexion';
import './AvisoSinConexion.css';

export function AvisoSinConexion() {
  const { enLinea } = useEstadoConexion();
  if (enLinea) return null;
  return (
    <div className="aviso-sin-conexion" role="status">
      <WifiOff size={15} />
      <span>Sin conexión — puedes seguir consultando; los cambios se sincronizarán al reconectar.</span>
    </div>
  );
}

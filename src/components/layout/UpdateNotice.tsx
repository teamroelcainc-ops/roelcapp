import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { APP_VERSION, VERSION_CHECK_MS } from '../../config/version';
import './UpdateNotice.css';

/**
 * Aviso de versión nueva. Compara la versión que trae el paquete cargado en
 * esta pestaña contra la que sirve el servidor: si no coinciden, es que se
 * publicó algo y quien está trabajando quedó con la versión vieja.
 *
 * Se consulta un archivo estático, no Firestore: no gasta lecturas de la base
 * y funciona aunque la cuota diaria esté agotada.
 */
export function UpdateNotice() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        // cache: 'no-store' evita que el navegador conteste con la copia
        // vieja, que es justo lo que haría inútil la comparación.
        const response = await fetch('/version.json', { cache: 'no-store' });
        if (!response.ok) return;
        const data: unknown = await response.json();
        const latest =
          typeof data === 'object' && data !== null && 'version' in data
            ? String((data as { version: unknown }).version)
            : '';
        if (!cancelled && latest !== '' && latest !== APP_VERSION) setAvailable(true);
      } catch {
        // Sin conexión no se avisa nada: no es un error que deba mostrarse.
      }
    };

    void check();
    const timer = window.setInterval(() => void check(), VERSION_CHECK_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!available) return null;

  return (
    <button
      type="button"
      className="updnotice"
      title="Reload to get the latest version"
      onClick={() => window.location.reload()}
    >
      <RefreshCw size={15} />
      <span className="updnotice-text">New version available</span>
      <span className="updnotice-action">Update</span>
    </button>
  );
}

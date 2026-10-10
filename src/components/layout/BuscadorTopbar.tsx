// src/components/layout/BuscadorTopbar.tsx
// ✅ V00438 (Fase 2.1): el buscador del topbar con su PROPIO estado. Antes el
//   texto vivía en App.tsx y cada tecla re-renderizaba App y los 12 módulos que
//   MantenerVivo deja montados. Mismo comportamiento (V00263): emite el texto al
//   módulo activo, se deshabilita si el módulo no tiene búsqueda y se limpia al
//   cambiar de módulo. Usa las clases de siempre (topbar-buscador*).
import { useEffect, useState } from 'react';
import {
  emitirBusquedaGlobal, etiquetaReceptorBusqueda, hayReceptorBusqueda, suscribirReceptorBusqueda,
} from '../../utils/busquedaGlobal';

export default function BuscadorTopbar() {
  const [texto, setTexto] = useState('');
  const [receptorActivo, setReceptorActivo] = useState(hayReceptorBusqueda());
  const [etiqueta, setEtiqueta] = useState(etiquetaReceptorBusqueda());

  useEffect(() => suscribirReceptorBusqueda(() => {
    setReceptorActivo(hayReceptorBusqueda());
    setEtiqueta(etiquetaReceptorBusqueda());
    setTexto(''); // al cambiar de módulo, el buscador arranca limpio
  }), []);

  const escribir = (t: string) => { setTexto(t); emitirBusquedaGlobal(t); };

  return (
    <div className="topbar-buscador">
      <span className="topbar-buscador__lupa">🔍</span>
      <input
        className="topbar-buscador__input"
        type="text"
        value={texto}
        disabled={!receptorActivo}
        placeholder={receptorActivo ? `Buscar en ${etiqueta}…` : 'Sin búsqueda en este módulo'}
        title={receptorActivo ? 'Filtra lo que ves en el módulo actual' : 'Este módulo no tiene búsqueda'}
        onChange={(e) => escribir(e.target.value)}
      />
      {texto && (
        <button type="button" className="topbar-buscador__limpiar" onClick={() => escribir('')} title="Limpiar búsqueda">✕</button>
      )}
    </div>
  );
}

// src/components/layout/BuscadorTopbar.tsx
// ✅ V00438 (Fase 2.1): el buscador del topbar con su PROPIO estado (antes cada tecla
//   re-renderizaba App y los módulos que MantenerVivo deja montados).
// ✅ V00502: BUSCADOR GLOBAL (como el de QuickBooks). Al escribir abre una lista con TODO lo que
//   coincide en la app: operaciones, facturas, pagos, empresas, convenios, empleados, unidades y
//   remolques; clic (o Enter) abre su detalle en su módulo (shared/data/aperturas.ts). Sigue
//   filtrando el módulo actual mientras se escribe, como antes (V00263), si ese módulo busca.
//   Ctrl+K lo enfoca desde cualquier pantalla. La lista y su búsqueda (features/buscador) se
//   cargan la primera vez que se abre: aquí solo queda la caja.
import { Suspense, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  emitirBusquedaGlobal, etiquetaReceptorBusqueda, hayReceptorBusqueda, suscribirReceptorBusqueda,
} from '../../utils/busquedaGlobal';
import { abrirRegistro } from '../../shared/data/aperturas';
import { lazyWithRetry } from '../../utils/lazyWithRetry';
import type { ManejadorTeclas } from '../../features/buscador/components/PanelBuscador';
import type { ResultadoBusqueda } from '../../features/buscador/services/resultados';
import './BuscadorTopbar.css';

const PanelBuscador = lazyWithRetry(() => import('../../features/buscador/components/PanelBuscador'), 'PanelBuscador');
const ID_LISTA = 'bgl-lista';

export default function BuscadorTopbar() {
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [receptorActivo, setReceptorActivo] = useState(hayReceptorBusqueda());
  const [etiqueta, setEtiqueta] = useState(etiquetaReceptorBusqueda());
  const cajaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const teclasRef = useRef<ManejadorTeclas | null>(null);

  useEffect(() => suscribirReceptorBusqueda(() => {
    setReceptorActivo(hayReceptorBusqueda());
    setEtiqueta(etiquetaReceptorBusqueda());
    // Al cambiar de módulo arranca limpio, salvo que se esté escribiendo en él (✅ V00502: abrir un
    // resultado cambia de módulo y la siguiente búsqueda se borraba a media palabra).
    if (document.activeElement !== inputRef.current) setTexto('');
  }), []);

  // Ctrl+K (⌘K) enfoca el buscador; clic fuera lo cierra.
  useEffect(() => {
    const tecla = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setAbierto(true);
      }
    };
    const fuera = (e: MouseEvent) => { if (cajaRef.current && !cajaRef.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('keydown', tecla);
    document.addEventListener('mousedown', fuera);
    return () => { document.removeEventListener('keydown', tecla); document.removeEventListener('mousedown', fuera); };
  }, []);

  const escribir = (t: string) => {
    setTexto(t);
    setAbierto(true);
    if (receptorActivo) emitirBusquedaGlobal(t);
  };

  const abrir = (r: ResultadoBusqueda) => {
    setAbierto(false);
    setTexto('');
    if (receptorActivo) emitirBusquedaGlobal('');
    inputRef.current?.blur();
    abrirRegistro(r.destino.modulo, r.destino.id, r.destino.tipo);
  };

  const alTeclear = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { setAbierto(false); return; }
    if (e.key === 'ArrowDown') setAbierto(true);
    if (abierto && teclasRef.current?.(e.key)) e.preventDefault();
  };

  return (
    <div className={`topbar-buscador${abierto ? ' bgt-buscando' : ''}`} ref={cajaRef}>
      <span className="topbar-buscador__lupa">🔍</span>
      <input
        ref={inputRef}
        className="topbar-buscador__input"
        type="text"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={ID_LISTA}
        aria-autocomplete="list"
        value={texto}
        placeholder="Buscar en toda la app (Ctrl+K)"
        title={receptorActivo ? `Busca en toda la app y también filtra ${etiqueta}` : 'Busca operaciones, facturas, pagos, empresas, convenios, empleados, unidades y remolques'}
        onChange={(e) => escribir(e.target.value)}
        onFocus={() => setAbierto(true)}
        onKeyDown={alTeclear}
      />
      {texto && (
        <button type="button" className="topbar-buscador__limpiar" onClick={() => escribir('')} title="Limpiar búsqueda">✕</button>
      )}
      {abierto && (
        <Suspense fallback={null}>
          <PanelBuscador id={ID_LISTA} texto={texto} filtraModulo={receptorActivo ? etiqueta : null}
            registrarTeclas={(fn) => { teclasRef.current = fn; }} onAbrir={abrir} />
        </Suspense>
      )}
    </div>
  );
}

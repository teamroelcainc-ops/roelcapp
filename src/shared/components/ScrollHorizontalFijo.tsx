// src/shared/components/ScrollHorizontalFijo.tsx
// ---------------------------------------------------------------------------
// ✅ V00530 — Tabla ancha con su barra de desplazamiento horizontal SIEMPRE a la vista: la barra se
// queda pegada abajo de la pantalla mientras la tabla se ve (position: sticky), en lugar de estar al
// final de la tabla (había que bajar hasta abajo para moverla). La barra y la tabla se mueven juntas.
// Con trackpad o Shift + rueda la tabla se sigue moviendo directo.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import './ScrollHorizontalFijo.css';

interface Props {
  children: ReactNode;
}

export default function ScrollHorizontalFijo({ children }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const barra = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState({ contenido: 0, desborda: false });

  useEffect(() => {
    const c = caja.current;
    if (!c) return undefined;
    const medir = () => setAncho((prev) => {
      const contenido = c.scrollWidth;
      const desborda = contenido > c.clientWidth + 1;
      return prev.contenido === contenido && prev.desborda === desborda ? prev : { contenido, desborda };
    });
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(c);
    Array.from(c.children).forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, []);

  // Cada una sigue a la otra; al igualarse, el eco del evento ya no cambia nada.
  const deCaja = () => { if (caja.current && barra.current && barra.current.scrollLeft !== caja.current.scrollLeft) barra.current.scrollLeft = caja.current.scrollLeft; };
  const deBarra = () => { if (caja.current && barra.current && caja.current.scrollLeft !== barra.current.scrollLeft) caja.current.scrollLeft = barra.current.scrollLeft; };

  return (
    <>
      <div ref={caja} className="shf-caja" onScroll={deCaja}>{children}</div>
      {ancho.desborda && (
        <div ref={barra} className="shf-barra" onScroll={deBarra} aria-hidden="true">
          <div className="shf-relleno" style={{ '--shf-ancho': `${ancho.contenido}px` } as CSSProperties} />
        </div>
      )}
    </>
  );
}

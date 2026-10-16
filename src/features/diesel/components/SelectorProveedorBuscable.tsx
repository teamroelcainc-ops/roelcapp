// src/features/diesel/components/SelectorProveedorBuscable.tsx
// ✅ V00457: sale de ReferenciasDieselDashboard para usarlo también en "Agregar saldo de
//   diesel" desde la tarjeta Saldo Diesel de Operaciones Activas (ahí no está cargado el
//   CSS del módulo). Mismo comportamiento de siempre:
//   - Lleva su propio estado: NO se cierra cuando el padre se re-renderiza (p. ej. al
//     llegar datos de Firestore).
//   - Se filtra escribiendo, ideal cuando hay muchos proveedores.
//   - Se cierra al hacer clic fuera.
//   Los estilos (antes en línea y con el hover por JavaScript) viven en su .css.
import { useEffect, useMemo, useRef, useState } from 'react';
import './SelectorProveedorBuscable.css';

export interface ProveedorOpcion {
  id: string;
  nombre?: unknown;
}

interface Props {
  proveedores: readonly ProveedorOpcion[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  resolverNombre?: (id: string) => string;
}

const nombreDe = (p: ProveedorOpcion): string => String(p.nombre || p.id);

export default function SelectorProveedorBuscable({ proveedores, value, onChange, placeholder = 'Seleccionar proveedor...', resolverNombre }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const contenedorRef = useRef<HTMLDivElement>(null);

  const seleccionado = proveedores.find((p) => p.id === value) || null;
  const nombreMostrado = seleccionado ? nombreDe(seleccionado) : (value && resolverNombre ? resolverNombre(value) : '');

  useEffect(() => {
    const alPresionar = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
        setBusqueda('');
      }
    };
    document.addEventListener('mousedown', alPresionar);
    return () => document.removeEventListener('mousedown', alPresionar);
  }, []);

  const filtrados = useMemo(() => {
    const t = busqueda.trim().toLowerCase();
    if (!t) return proveedores;
    return proveedores.filter((p) => String(p.nombre || '').toLowerCase().includes(t));
  }, [proveedores, busqueda]);

  return (
    <div className="spd-caja" ref={contenedorRef}>
      <button className="spd-boton" type="button" onClick={() => setAbierto((o) => !o)}>
        <span className={`spd-texto${nombreMostrado ? '' : ' spd-texto--vacio'}`}>{nombreMostrado || placeholder}</span>
        <span className="spd-flecha">{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="spd-panel">
          <div className="spd-buscar">
            <input className="spd-input" autoFocus type="text" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar proveedor..." />
          </div>
          <ul className="spd-lista">
            {filtrados.length === 0 ? (
              <li className="spd-vacio">Sin resultados</li>
            ) : (
              filtrados.map((p) => (
                <li key={p.id} className={`spd-opcion${p.id === value ? ' spd-opcion--elegida' : ''}`}
                  onClick={() => { onChange(p.id); setAbierto(false); setBusqueda(''); }}>
                  {nombreDe(p)}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// src/features/catalogos/components/SelectBuscable.tsx
//
// ✅ SELECT CON BÚSQUEDA (reutilizable, sin dependencias externas)
//    Reemplaza los <select> nativos por un campo de texto que filtra opciones
//    en vivo. Tolerante a acentos y mayúsculas. Tema oscuro (#0d1117 / #30363d)
//    consistente con el resto de los módulos.
//
//    Uso:
//      <SelectBuscable
//        opciones={[{ value: 'abc', label: 'Nuevo Laredo' }, ...]}
//        value={formData.aduana}
//        onChange={(v) => setFormData({ ...formData, aduana: v })}
//        placeholder="Seleccione una opción..."
//      />
import React, { useState, useRef, useEffect, useMemo } from 'react';
import './SelectBuscable.css';

export interface OpcionBuscable {
  value: string;
  label: string;
}

interface Props {
  opciones: OpcionBuscable[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Estilos extra para el contenedor (ancho, minWidth, etc.) */
  estiloContenedor?: React.CSSProperties;
}

// Normaliza texto para comparar sin acentos ni mayúsculas ("Vacía" === "vacia")
const normalizar = (s: string) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

export const SelectBuscable: React.FC<Props> = ({
  opciones,
  value,
  onChange,
  placeholder = 'Seleccione una opción...',
  disabled = false,
  estiloContenedor,
}) => {
  const [abierto, setAbierto] = useState(false);
  const [textoBusqueda, setTextoBusqueda] = useState('');
  const [indiceActivo, setIndiceActivo] = useState(0);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);

  // Etiqueta de la opción seleccionada actualmente (tolerante a tipos/acentos)
  const etiquetaSeleccionada = useMemo(() => {
    if (value === undefined || value === null || value === '') return '';
    const encontrada = opciones.find(
      (o) => String(o.value) === String(value) || normalizar(o.value) === normalizar(String(value))
    );
    return encontrada ? encontrada.label : String(value);
  }, [opciones, value]);

  // Opciones filtradas por el texto de búsqueda
  const opcionesFiltradas = useMemo(() => {
    const termino = normalizar(textoBusqueda);
    if (!termino) return opciones;
    return opciones.filter((o) => normalizar(o.label).includes(termino));
  }, [opciones, textoBusqueda]);

  // Cerrar al hacer clic fuera del componente
  useEffect(() => {
    const handleClickFuera = (e: MouseEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) {
        setAbierto(false);
        setTextoBusqueda('');
      }
    };
    document.addEventListener('mousedown', handleClickFuera);
    return () => document.removeEventListener('mousedown', handleClickFuera);
  }, []);

  // Reiniciar el índice activo cuando cambia el filtro
  useEffect(() => { setIndiceActivo(0); }, [textoBusqueda, abierto]);

  // Mantener visible la opción activa al navegar con teclado
  useEffect(() => {
    if (!abierto || !listaRef.current) return;
    const activo = listaRef.current.querySelector('[data-activo="true"]') as HTMLElement | null;
    if (activo) activo.scrollIntoView({ block: 'nearest' });
  }, [indiceActivo, abierto]);

  const seleccionar = (opcion: OpcionBuscable) => {
    onChange(opcion.value);
    setAbierto(false);
    setTextoBusqueda('');
  };

  const limpiar = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setTextoBusqueda('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!abierto && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      setAbierto(true);
      return;
    }
    if (!abierto) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndiceActivo((prev) => Math.min(prev + 1, opcionesFiltradas.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndiceActivo((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (opcionesFiltradas[indiceActivo]) seleccionar(opcionesFiltradas[indiceActivo]);
    } else if (e.key === 'Escape') {
      setAbierto(false);
      setTextoBusqueda('');
    }
  };

  return (
    <div
      ref={contenedorRef}
      style={{ position: 'relative', width: '100%', ...estiloContenedor }}
    >
      {/* Campo visible: al abrir se convierte en caja de búsqueda */}
      <div
        onClick={() => { if (!disabled) setAbierto(true); }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: '#0d1117',
          border: `1px solid ${abierto ? '#58a6ff' : '#30363d'}`,
          borderRadius: '6px',
          padding: '0 10px',
          cursor: disabled ? 'not-allowed' : 'text',
          opacity: disabled ? 0.55 : 1,
          transition: 'border-color 0.15s ease',
        }}
      >
        {/* Icono de búsqueda */}
        <svg className="sb-x1" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>

        <input
          type="text"
          value={abierto ? textoBusqueda : etiquetaSeleccionada}
          onChange={(e) => { setTextoBusqueda(e.target.value); if (!abierto) setAbierto(true); }}
          onFocus={() => { if (!disabled) setAbierto(true); }}
          onKeyDown={handleKeyDown}
          placeholder={abierto ? (etiquetaSeleccionada || placeholder) : placeholder}
          disabled={disabled}
          style={{
            flex: 1,
            minWidth: 0,
            backgroundColor: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#c9d1d9',
            padding: '10px 0',
            fontSize: '0.95rem',
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />

        {/* Botón para limpiar la selección */}
        {value !== '' && value !== undefined && value !== null && !disabled && (
          <button className="sb-x2"
            type="button"
            onClick={limpiar}
            title="Limpiar selección"
          >
            ✕
          </button>
        )}

        {/* Flecha indicadora */}
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: abierto ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {/* Lista desplegable de opciones */}
      {abierto && !disabled && (
        <div className="sb-x3"
          ref={listaRef}
        >
          {opcionesFiltradas.length === 0 ? (
            <div className="sb-x4">
              Sin resultados para "{textoBusqueda}"
            </div>
          ) : (
            opcionesFiltradas.map((opcion, i) => {
              const esActiva = i === indiceActivo;
              const esSeleccionada = String(opcion.value) === String(value);
              return (
                <div
                  key={`${opcion.value}-${i}`}
                  data-activo={esActiva ? 'true' : 'false'}
                  onClick={() => seleccionar(opcion)}
                  onMouseEnter={() => setIndiceActivo(i)}
                  style={{
                    padding: '9px 14px',
                    fontSize: '0.92rem',
                    cursor: 'pointer',
                    color: esSeleccionada ? '#58a6ff' : '#c9d1d9',
                    backgroundColor: esActiva ? '#21262d' : 'transparent',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  <span className="sb-x5">{opcion.label}</span>
                  {esSeleccionada && <span className="sb-x6">✓</span>}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default SelectBuscable;
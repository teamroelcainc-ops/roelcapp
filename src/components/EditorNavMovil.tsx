// src/components/EditorNavMovil.tsx
// Módulo para EDITAR la barra de navegación inferior (móvil): el usuario
// elige hasta 4 accesos directos entre los módulos a los que tiene permiso.
// El orden de la barra es el orden en el que los selecciona.
import { X, Check } from 'lucide-react';
import { useState } from 'react';
import { MODULOS_NAV } from './modulosNavMovil';
import { useNavMovilStore, MAX_ITEMS_NAV } from '../stores/useNavMovilStore';
import './EditorNavMovil.css';

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  puedeVer: (clave: string) => boolean;
}

export function EditorNavMovil({ abierto, onCerrar, puedeVer }: Props) {
  const itemsGuardados = useNavMovilStore((s) => s.items);
  const setItems = useNavMovilStore((s) => s.setItems);
  const [seleccion, setSeleccion] = useState<string[]>(itemsGuardados);

  if (!abierto) return null;

  const disponibles = MODULOS_NAV.filter((m) => puedeVer(m.clave));

  const alternar = (clave: string) => {
    setSeleccion((prev) => {
      if (prev.includes(clave)) return prev.filter((c) => c !== clave);
      if (prev.length >= MAX_ITEMS_NAV) return prev; // tope alcanzado
      return [...prev, clave];
    });
  };

  const guardar = () => {
    if (seleccion.length === 0) {
      alert('Elige al menos un acceso directo para la barra.');
      return;
    }
    setItems(seleccion);
    onCerrar();
  };

  return (
    <div className="editor-nav-overlay" onClick={onCerrar}>
      <div className="editor-nav-card" onClick={(e) => e.stopPropagation()}>
        <div className="editor-nav-encabezado">
          <div>
            <h2>Barra inferior</h2>
            <p>Elige hasta {MAX_ITEMS_NAV} accesos directos. El orden en que los marcas es el orden de la barra.</p>
          </div>
          <button className="editor-nav-cerrar" onClick={onCerrar} title="Cerrar"><X size={18} /></button>
        </div>

        <ul className="editor-nav-lista">
          {disponibles.map(({ clave, etiqueta, Icono }) => {
            const posicion = seleccion.indexOf(clave);
            const marcado = posicion !== -1;
            const bloqueado = !marcado && seleccion.length >= MAX_ITEMS_NAV;
            return (
              <li key={clave}>
                <button
                  className={`editor-nav-item${marcado ? ' marcado' : ''}`}
                  onClick={() => alternar(clave)}
                  disabled={bloqueado}
                  title={bloqueado ? `Máximo ${MAX_ITEMS_NAV}: desmarca uno para elegir otro` : undefined}
                >
                  <Icono size={18} />
                  <span className="editor-nav-etiqueta">{etiqueta}</span>
                  {marcado && (
                    <span className="editor-nav-orden">
                      {posicion + 1} <Check size={13} />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="editor-nav-pie">
          <span className="editor-nav-conteo">{seleccion.length} / {MAX_ITEMS_NAV}</span>
          <div className="editor-nav-acciones">
            <button className="editor-nav-btn-cancelar" onClick={onCerrar}>Cancelar</button>
            <button className="editor-nav-btn-guardar" onClick={guardar}>Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

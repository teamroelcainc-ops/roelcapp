// src/components/BarraNavMovil.tsx
// Barra de navegación INFERIOR para teléfono (patrón de app nativa), SIEMPRE
// fija abajo. Los accesos directos son CONFIGURABLES por el usuario con el
// botón ✎ (abre el editor); se persisten en el dispositivo (useNavMovilStore).
// Solo se pinta en pantallas chicas (ver su CSS hermano).
import { Menu, Pencil } from 'lucide-react';
import { MODULOS_NAV } from './modulosNavMovil';
import { useNavMovilStore } from '../stores/useNavMovilStore';
import './BarraNavMovil.css';

interface Props {
  moduloActivo: string;
  onNavegar: (modulo: string) => void;
  onAbrirMenu: () => void;
  onEditar: () => void;
  puedeVer: (clave: string) => boolean;
}

export function BarraNavMovil({ moduloActivo, onNavegar, onAbrirMenu, onEditar, puedeVer }: Props) {
  const items = useNavMovilStore((s) => s.items);

  const visibles = items
    .map((clave) => MODULOS_NAV.find((m) => m.clave === clave))
    .filter((m): m is NonNullable<typeof m> => !!m && puedeVer(m.clave));

  return (
    <nav className="nav-movil" aria-label="Navegación principal">
      {visibles.map(({ clave, etiqueta, Icono }) => (
        <button
          key={clave}
          className={`nav-movil-item${moduloActivo === clave ? ' activo' : ''}`}
          onClick={() => onNavegar(clave)}
        >
          <Icono size={20} />
          <span>{etiqueta}</span>
        </button>
      ))}
      <button className="nav-movil-item" onClick={onAbrirMenu}>
        <Menu size={20} />
        <span>Menú</span>
      </button>
      <button className="nav-movil-editar" onClick={onEditar} title="Personalizar la barra">
        <Pencil size={12} />
      </button>
    </nav>
  );
}

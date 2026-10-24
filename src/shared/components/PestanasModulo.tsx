// src/shared/components/PestanasModulo.tsx
// ---------------------------------------------------------------------------
// ✅ V00480 — pestañas arriba de un apartado del menú que junta varios módulos (Operaciones:
// Activas / Completadas / Canceladas; Facturación: Clientes / Proveedores). Cada pestaña es un
// módulo de siempre, con su permiso; aquí solo se navega entre ellos. Con una sola pestaña
// permitida no se pinta.
// ---------------------------------------------------------------------------
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import './PestanasModulo.css';

export interface PestanaModulo<K extends string> {
  modulo: K;
  texto: string;
  Icono: LucideIcon;
  /** Color del ícono. */
  color: string;
}

interface Props<K extends string> {
  /** Nombre del apartado (para lectores de pantalla). */
  etiqueta: string;
  pestanas: readonly PestanaModulo<K>[];
  activo: K;
  puede: (modulo: K) => boolean;
  onCambiar: (modulo: K) => void;
}

export default function PestanasModulo<K extends string>({ etiqueta, pestanas, activo, puede, onCambiar }: Props<K>) {
  const visibles = pestanas.filter((p) => puede(p.modulo));
  if (visibles.length < 2) return null;
  return (
    <nav className="pmo-barra" aria-label={etiqueta}>
      {visibles.map(({ modulo, texto, Icono, color }) => (
        <button
          key={modulo}
          type="button"
          className={`pmo-tab${modulo === activo ? ' pmo-tab--activa' : ''}`}
          style={{ '--pmo-color': color } as CSSProperties}
          aria-current={modulo === activo ? 'page' : undefined}
          onClick={() => { if (modulo !== activo) onCambiar(modulo); }}
        >
          <Icono size={16} aria-hidden="true" />
          {texto}
        </button>
      ))}
    </nav>
  );
}

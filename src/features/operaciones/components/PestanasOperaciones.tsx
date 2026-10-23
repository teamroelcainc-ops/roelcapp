// src/features/operaciones/components/PestanasOperaciones.tsx
// ---------------------------------------------------------------------------
// ✅ V00477 — OPERACIONES EN UN SOLO LUGAR: el menú tiene un solo "Operaciones" y estas
// pestañas cambian entre Activas, Completadas y Canceladas. Cada pestaña es el módulo de
// siempre (OperacionesDashboard, ServiciosCompletados, ServiciosCancelados) con su permiso,
// sus filtros y su ?modulo=…; aquí solo se navega entre ellos. MantenerVivo conserva cada
// pestaña al cambiar (no se vuelve a cargar).
// ---------------------------------------------------------------------------
import { CheckCircle2, Truck, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ModuloOperaciones } from '../services/modulosOperaciones';
import './PestanasOperaciones.css';

const PESTANAS: { modulo: ModuloOperaciones; texto: string; Icono: LucideIcon }[] = [
  { modulo: 'operaciones', texto: 'Activas', Icono: Truck },
  { modulo: 'serviciosCompletados', texto: 'Completadas', Icono: CheckCircle2 },
  { modulo: 'serviciosCancelados', texto: 'Canceladas', Icono: XCircle },
];

interface Props {
  activo: ModuloOperaciones;
  puede: (modulo: ModuloOperaciones) => boolean;
  onCambiar: (modulo: ModuloOperaciones) => void;
}

export default function PestanasOperaciones({ activo, puede, onCambiar }: Props) {
  const visibles = PESTANAS.filter((p) => puede(p.modulo));
  if (visibles.length < 2) return null;
  return (
    <nav className="pop-barra" aria-label="Operaciones">
      {visibles.map(({ modulo, texto, Icono }) => (
        <button
          key={modulo}
          type="button"
          className={`pop-tab pop-tab--${modulo}${modulo === activo ? ' pop-tab--activa' : ''}`}
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

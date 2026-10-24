// src/features/operaciones/components/PestanasOperaciones.tsx
// ---------------------------------------------------------------------------
// ✅ V00477 — OPERACIONES EN UN SOLO LUGAR: el menú tiene un solo "Operaciones" y estas
// pestañas cambian entre Activas, Completadas y Canceladas. Cada pestaña es el módulo de
// siempre (OperacionesDashboard, ServiciosCompletados, ServiciosCancelados) con su permiso,
// sus filtros y su ?modulo=…; aquí solo se navega entre ellos. MantenerVivo conserva cada
// pestaña al cambiar (no se vuelve a cargar).
// ✅ V00480: la barra es la compartida (PestanasModulo), la misma de Facturación.
// ---------------------------------------------------------------------------
import { CheckCircle2, Truck, XCircle } from 'lucide-react';
import PestanasModulo from '../../../shared/components/PestanasModulo';
import type { PestanaModulo } from '../../../shared/components/PestanasModulo';
import type { ModuloOperaciones } from '../services/modulosOperaciones';

const PESTANAS: readonly PestanaModulo<ModuloOperaciones>[] = [
  { modulo: 'operaciones', texto: 'Activas', Icono: Truck, color: '#d84315' },
  { modulo: 'serviciosCompletados', texto: 'Completadas', Icono: CheckCircle2, color: '#3fb950' },
  { modulo: 'serviciosCancelados', texto: 'Canceladas', Icono: XCircle, color: '#f85149' },
];

interface Props {
  activo: ModuloOperaciones;
  puede: (modulo: ModuloOperaciones) => boolean;
  onCambiar: (modulo: ModuloOperaciones) => void;
}

export default function PestanasOperaciones({ activo, puede, onCambiar }: Props) {
  return <PestanasModulo etiqueta="Operaciones" pestanas={PESTANAS} activo={activo} puede={puede} onCambiar={onCambiar} />;
}

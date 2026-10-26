// src/features/operaciones/components/PestanasOperaciones.tsx
// ---------------------------------------------------------------------------
// ✅ V00477 — OPERACIONES EN UN SOLO LUGAR: el menú tiene un solo "Operaciones" y estas
// pestañas cambian entre Activas, Completadas y Canceladas. Cada pestaña es el módulo de
// siempre (OperacionesDashboard, ServiciosCompletados, ServiciosCancelados) con su permiso,
// sus filtros y su ?modulo=…; aquí solo se navega entre ellos. MantenerVivo conserva cada
// pestaña al cambiar (no se vuelve a cargar).
// ✅ V00480: la barra es la compartida (PestanasModulo), la misma de Facturación.
// ---------------------------------------------------------------------------
import { Suspense, useState } from 'react';
import { CheckCircle2, Truck, Wand2, XCircle } from 'lucide-react';
import PestanasModulo from '../../../shared/components/PestanasModulo';
import type { PestanaModulo } from '../../../shared/components/PestanasModulo';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import type { ModuloOperaciones } from '../services/modulosOperaciones';
import './PestanasOperaciones.css';

// ✅ V00487: la ventana (y lo que lee) se carga al presionar el botón.
const CorregirMonedasConvenioModal = lazyWithRetry(() => import('./CorregirMonedasConvenioModal'), 'CorregirMonedasConvenioModal');

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
  const [corrigiendo, setCorrigiendo] = useState(false);
  return (
    <>
      <PestanasModulo etiqueta="Operaciones" pestanas={PESTANAS} activo={activo} puede={puede} onCambiar={onCambiar}
        acciones={(
          <button type="button" className="pop-btn-corregir" onClick={() => setCorrigiendo(true)}
            title="Pone Facturado en con la moneda de su empresa y la moneda del convenio a las que no la tienen, y recalcula sus montos (primero muestra qué cambia)">
            <Wand2 size={15} aria-hidden="true" /> Corregir monedas
          </button>
        )} />
      {corrigiendo && (
        <Suspense fallback={null}>
          <CorregirMonedasConvenioModal onCerrar={() => setCorrigiendo(false)} />
        </Suspense>
      )}
    </>
  );
}

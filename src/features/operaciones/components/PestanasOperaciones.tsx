// src/features/operaciones/components/PestanasOperaciones.tsx
// ---------------------------------------------------------------------------
// ✅ V00477 — OPERACIONES EN UN SOLO LUGAR: el menú tiene un solo "Operaciones" y estas
// pestañas cambian entre Activas, Completadas y Canceladas. Cada pestaña es el módulo de
// siempre (OperacionesDashboard, ServiciosCompletados, ServiciosCancelados) con su permiso,
// sus filtros y su ?modulo=…; aquí solo se navega entre ellos. MantenerVivo conserva cada
// pestaña al cambiar (no se vuelve a cargar).
// ✅ V00480: la barra es la compartida (PestanasModulo), la misma de Facturación.
// ✅ V00498: + pestaña Reportes (antes su propio ítem del menú) y botón "Excel" (todas las
//   operaciones de un rango de fechas, de cualquier status).
// ---------------------------------------------------------------------------
import { Suspense, useState } from 'react';
import { BarChart3, CheckCircle2, FileSpreadsheet, Truck, Wand2, XCircle } from 'lucide-react';
import PestanasModulo from '../../../shared/components/PestanasModulo';
import type { PestanaModulo } from '../../../shared/components/PestanasModulo';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import type { ModuloOperaciones } from '../services/modulosOperaciones';
import './PestanasOperaciones.css';

// ✅ V00487: la ventana (y lo que lee) se carga al presionar el botón.
const CorregirMonedasConvenioModal = lazyWithRetry(() => import('./CorregirMonedasConvenioModal'), 'CorregirMonedasConvenioModal');
const ExcelOperaciones = lazyWithRetry(() => import('./exportar/ExcelOperaciones'), 'ExcelOperaciones'); // ✅ V00498

const PESTANAS: readonly PestanaModulo<ModuloOperaciones>[] = [
  { modulo: 'operaciones', texto: 'Activas', Icono: Truck, color: '#d84315' },
  { modulo: 'serviciosCompletados', texto: 'Completadas', Icono: CheckCircle2, color: '#3fb950' },
  { modulo: 'serviciosCancelados', texto: 'Canceladas', Icono: XCircle, color: '#f85149' },
  { modulo: 'reportes', texto: 'Reportes', Icono: BarChart3, color: '#a371f7' }, // ✅ V00498
];

interface Props {
  activo: ModuloOperaciones;
  puede: (modulo: ModuloOperaciones) => boolean;
  onCambiar: (modulo: ModuloOperaciones) => void;
}

export default function PestanasOperaciones({ activo, puede, onCambiar }: Props) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [exportando, setExportando] = useState(false);
  return (
    <>
      <PestanasModulo etiqueta="Operaciones" pestanas={PESTANAS} activo={activo} puede={puede} onCambiar={onCambiar}
        acciones={(
          <>
            <button type="button" className="pop-btn-excel" onClick={() => setExportando(true)}
              title="Descarga en Excel TODAS las operaciones de un rango de fechas de servicio, de cualquier status (con las configuraciones de columnas guardadas)">
              <FileSpreadsheet size={15} aria-hidden="true" /> Excel
            </button>
            <button type="button" className="pop-btn-corregir" onClick={() => setCorrigiendo(true)}
              title="Pone Facturado en con la moneda de su empresa y la moneda del convenio a las que no la tienen, y recalcula sus montos (primero muestra qué cambia)">
              <Wand2 size={15} aria-hidden="true" /> Corregir monedas
            </button>
          </>
        )} />
      {corrigiendo && (
        <Suspense fallback={null}>
          <CorregirMonedasConvenioModal onCerrar={() => setCorrigiendo(false)} />
        </Suspense>
      )}
      {exportando && (
        <Suspense fallback={null}>
          <ExcelOperaciones onCerrar={() => setExportando(false)} />
        </Suspense>
      )}
    </>
  );
}

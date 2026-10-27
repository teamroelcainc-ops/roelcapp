// src/features/operaciones/components/exportar/ExcelOperaciones.tsx
// ---------------------------------------------------------------------------
// ✅ V00498 — "Excel de operaciones" (botón de las pestañas de Operaciones): TODAS las operaciones de
// un rango de fechas de servicio, de cualquier status (activas, completadas, canceladas, en falso),
// con las mismas ventanas y configuraciones guardadas que el Excel de Servicios Completados.
// ✅ V00499: sin tope de cantidad (lee en páginas) y la ventana dice cuántas lleva leídas.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { hoyLocalISO } from '../../../../utils/fechaHoraLocal';
import { cargarColumnasGuardadas } from '../completados/columnas';
import { claveUltimaSeleccion } from '../../services/configsExportExcel';
import { descargarExcel, filasExcel } from '../../services/excelOperaciones';
import { leerOperacionesDelRango } from '../../services/operacionesDelRangoExcel';
import ModalExportarExcel from './ModalExportarExcel';
import type { RangoExcel } from './ModalExportarExcel';

/** Las mismas configuraciones y la misma "última selección" que Servicios Completados. */
const MODULO_CONFIGS = 'serviciosCompletados';
const PREFIJO_ULTIMA = 'roelca_completadas_export_v1_';

/** Columnas por defecto: las de la tabla de Servicios Completados (visibles primero, en su orden). */
const columnasPorDefecto = () => {
  const tabla = cargarColumnasGuardadas();
  return [...tabla.filter((c) => c.visible), ...tabla.filter((c) => !c.visible)].map((c) => ({ id: c.id, label: c.label, visible: c.visible }));
};

const primeroDelMes = (hoy: string): string => `${hoy.slice(0, 8)}01`;
const miles = (n: number): string => n.toLocaleString('es-MX');
/** Deja que la ventana pinte el aviso antes de armar el archivo (armarlo ocupa la página unos segundos). */
const dejarPintar = (): Promise<void> => new Promise((listo) => { setTimeout(listo, 50); });

export default function ExcelOperaciones({ onCerrar }: { onCerrar: () => void }) {
  const [rango, setRango] = useState<RangoExcel>(() => { const hoy = hoyLocalISO(); return { desde: primeroDelMes(hoy), hasta: hoy }; });

  const [avance, setAvance] = useState('');

  const exportar = async (columnas: { id: string; label: string }[]): Promise<boolean> => {
    setAvance('Leyendo operaciones del rango…');
    try {
      const operaciones = await leerOperacionesDelRango(rango.desde, rango.hasta,
        (leidas) => setAvance(`Leyendo operaciones del rango… ${miles(leidas)} leídas`));
      if (operaciones.length === 0) {
        alert(`No hay operaciones con fecha de servicio del ${rango.desde} al ${rango.hasta}.`);
        return false;
      }
      setAvance(`Armando el Excel con ${miles(operaciones.length)} operaciones…`);
      await dejarPintar();
      await descargarExcel(filasExcel(operaciones, columnas), 'Operaciones', `Operaciones_${rango.desde}_a_${rango.hasta}.xlsx`);
      return true;
    } finally {
      setAvance('');
    }
  };

  return (
    <ModalExportarExcel
      moduloConfigs={MODULO_CONFIGS}
      claveUltima={claveUltimaSeleccion(PREFIJO_ULTIMA)}
      columnasPorDefecto={columnasPorDefecto}
      rango={rango}
      onCambiarRango={setRango}
      subtitulo="Todas las operaciones del rango (por fecha de servicio), de cualquier status. Elige una configuración guardada o crea una nueva."
      onExportar={exportar}
      textoExportando={avance || undefined}
      onCerrar={onCerrar}
    />
  );
}

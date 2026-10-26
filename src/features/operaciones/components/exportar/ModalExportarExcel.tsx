// src/features/operaciones/components/exportar/ModalExportarExcel.tsx
// ---------------------------------------------------------------------------
// ✅ V00498 — VENTANAS DEL EXCEL (antes dentro de ServiciosCompletados.tsx, V00254/V00338):
//   1) "Configuraciones de exportación": las guardadas (Usar / 🗑) o "Nueva configuración"; con
//      `rango`, también el rango de fechas (Excel de operaciones).
//   2) "Exportar a Excel": columnas para incluir y su orden (arrastrar ⋮⋮), guardar la configuración
//      con nombre, "Columnas de la tabla" y Exportar.
//   Quien la usa decide qué operaciones van (onExportar) y arma el archivo.
// ---------------------------------------------------------------------------
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import CargandoDatos from '../../../../shared/components/CargandoDatos';
import {
  borrarConfigExcel, columnasDesdeGuardadas, guardarConfigExcel, guardarUltimaSeleccion, leerUltimaSeleccion, listarConfigsExcel,
} from '../../services/configsExportExcel';
import type { ColumnaElegible, ConfigExcel } from '../../services/configsExportExcel';
import './ModalExportarExcel.css';

export interface RangoExcel { desde: string; hasta: string }

interface Props {
  /** Clave de las configuraciones guardadas (config_export_excel.modulo). */
  moduloConfigs: string;
  /** Clave (por usuario) de la última selección de columnas. */
  claveUltima: string;
  /** Columnas por defecto: las visibles de la tabla en su orden y, al final, las ocultas. */
  columnasPorDefecto: () => ColumnaElegible[];
  /** Con rango: se elige en la primera ventana y se valida antes de exportar. */
  rango?: RangoExcel;
  onCambiarRango?: (r: RangoExcel) => void;
  subtitulo?: string;
  /** Arma y descarga el Excel con estas columnas (en este orden). false = no se pudo (la ventana sigue abierta). */
  onExportar: (columnas: { id: string; label: string }[]) => Promise<boolean>;
  onCerrar: () => void;
}

export default function ModalExportarExcel({
  moduloConfigs, claveUltima, columnasPorDefecto, rango, onCambiarRango, subtitulo, onExportar, onCerrar,
}: Props) {
  const [paso, setPaso] = useState<'configs' | 'columnas'>('configs');
  const [configs, setConfigs] = useState<ConfigExcel[] | null>(null);
  const [columnas, setColumnas] = useState<ColumnaElegible[]>([]);
  const [nombre, setNombre] = useState('');
  const [configId, setConfigId] = useState('');
  const [exportando, setExportando] = useState(false);
  const arrastrada = useRef<number | null>(null);
  const [destino, setDestino] = useState<number | null>(null);

  useEffect(() => {
    let vivo = true;
    listarConfigsExcel(moduloConfigs)
      .then((l) => { if (vivo) setConfigs(l); })
      .catch((e: unknown) => { console.error('Configuraciones de exportación:', e); if (vivo) setConfigs([]); });
    return () => { vivo = false; };
  }, [moduloConfigs]);

  const rangoInvalido = rango ? (!rango.desde || !rango.hasta ? 'Elige las dos fechas del rango.' : rango.desde > rango.hasta ? 'La fecha "Desde" es posterior a "Hasta".' : '') : '';

  const usar = (c: ConfigExcel) => {
    setColumnas(columnasDesdeGuardadas(c.columnas, columnasPorDefecto()));
    setNombre(c.nombre); setConfigId(c.id); setPaso('columnas');
  };
  const nueva = () => {
    const ultima = leerUltimaSeleccion(claveUltima);
    setColumnas(ultima ? columnasDesdeGuardadas(ultima, columnasPorDefecto()) : columnasPorDefecto());
    setNombre(''); setConfigId(''); setPaso('columnas');
  };
  const borrar = async (c: ConfigExcel) => {
    if (!window.confirm(`¿Borrar la configuración "${c.nombre}"?`)) return;
    try { await borrarConfigExcel(c.id); setConfigs((prev) => (prev ?? []).filter((x) => x.id !== c.id)); }
    catch (e) { alert(`No se pudo borrar: ${(e as Error)?.message || e}`); }
  };
  const guardar = async () => {
    const n = nombre.trim();
    if (!n) { alert('Ponle un NOMBRE a la configuración para guardarla.'); return; }
    try {
      const id = await guardarConfigExcel(moduloConfigs, n, columnas, configId || undefined);
      setConfigId(id);
      alert(`Configuración "${n}" guardada. La encontrarás al presionar el botón de Excel.`);
    } catch (e) { alert(`No se pudo guardar la configuración: ${(e as Error)?.message || e}`); }
  };
  const soltar = (hacia: number) => {
    const desde = arrastrada.current;
    arrastrada.current = null;
    setDestino(null);
    if (desde === null || desde === hacia) return;
    setColumnas((prev) => {
      const arr = [...prev];
      const [item] = arr.splice(desde, 1);
      arr.splice(hacia, 0, item);
      return arr;
    });
  };
  const exportar = async () => {
    const elegidas = columnas.filter((c) => c.visible);
    if (elegidas.length === 0) { alert('Selecciona al menos una columna para exportar.'); return; }
    if (rangoInvalido) { alert(rangoInvalido); return; }
    setExportando(true);
    try {
      const listo = await onExportar(elegidas.map((c) => ({ id: c.id, label: c.label })));
      if (listo) {
        guardarUltimaSeleccion(claveUltima, columnas);
        onCerrar();
      }
    } catch (e) {
      console.error('Excel:', e);
      alert(`No se pudo armar el Excel: ${(e as Error)?.message || e}`);
    } finally { setExportando(false); }
  };

  const campoRango = rango && onCambiarRango && (
    <div className="mxe-rango">
      <label className="mxe-rango-campo">Desde
        <input type="date" className="form-control" value={rango.desde} onChange={(e) => onCambiarRango({ ...rango, desde: e.target.value })} />
      </label>
      <label className="mxe-rango-campo">Hasta
        <input type="date" className="form-control" value={rango.hasta} onChange={(e) => onCambiarRango({ ...rango, hasta: e.target.value })} />
      </label>
      {rangoInvalido && <span className="mxe-rango-error" role="alert">{rangoInvalido}</span>}
    </div>
  );

  return createPortal(
    <>
      <button type="button" className="mxe-fondo" aria-label="Cerrar" tabIndex={-1} onClick={exportando ? undefined : onCerrar} />
      {paso === 'configs' ? (
        <div className="mxe-ventana mxe-ventana--configs" role="dialog" aria-modal="true" aria-labelledby="mxe-titulo">
          <div className="mxe-encabezado">
            <div className="mxe-titulo-caja">
              <span id="mxe-titulo" className="mxe-titulo">📋 Configuraciones de exportación</span>
              {configs && <span className="mxe-cuenta">({configs.length})</span>}
            </div>
            <button type="button" className="mxe-cerrar" onClick={onCerrar} title="Cerrar" aria-label="Cerrar">✕</button>
          </div>
          {campoRango}
          <div className="mxe-sub">{subtitulo || 'Elige una configuración guardada para armar el Excel con ella, o crea una nueva.'}</div>
          {configs === null ? <CargandoDatos compacto texto="Cargando configuraciones…" /> : configs.length === 0 && <div className="mxe-vacio">Aún no hay configuraciones guardadas.</div>}
          {configs && configs.length > 0 && (
            <ul className="mxe-lista">
              {configs.map((c) => (
                <li key={c.id} className="mxe-item">
                  <span className="mxe-nombre">{c.nombre}</span>
                  <span className="mxe-cols">{c.columnas.filter((x) => x.visible).length} columnas</span>
                  <button type="button" className="mxe-btn mxe-btn--principal mxe-btn--chico" onClick={() => usar(c)} title="Armar el Excel con esta configuración">Usar</button>
                  <button type="button" className="mxe-btn mxe-btn--chico" onClick={() => { void borrar(c); }} title="Borrar esta configuración" aria-label={`Borrar ${c.nombre}`}>🗑</button>
                </li>
              ))}
            </ul>
          )}
          <div className="mxe-pie">
            <span className="mxe-pregunta">¿Quieres agregar una nueva configuración?</span>
            <button type="button" className="mxe-btn" onClick={onCerrar}>Cancelar</button>
            <button type="button" className="mxe-btn mxe-btn--principal" onClick={nueva}>➕ Nueva configuración</button>
          </div>
        </div>
      ) : (
        <div className="mxe-ventana" role="dialog" aria-modal="true" aria-labelledby="mxe-titulo-cols">
          <div className="mxe-encabezado">
            <div className="mxe-titulo-caja">
              <span id="mxe-titulo-cols" className="mxe-titulo">Exportar a Excel</span>
              <span className="mxe-cuenta">({columnas.filter((c) => c.visible).length} columnas)</span>
            </div>
            <button type="button" className="mxe-cerrar" onClick={onCerrar} disabled={exportando} title="Cerrar" aria-label="Cerrar">✕</button>
          </div>
          {campoRango}
          <div className="mxe-ayuda">
            Arrastra <span className="mxe-asa">⋮⋮</span> cualquier tarjeta para cambiar el orden. Marca las columnas que quieres incluir.
          </div>
          <ul className="mxe-cuadricula">
            {columnas.map((c, idx) => (
              <li
                key={c.id}
                draggable
                onDragStart={() => { arrastrada.current = idx; }}
                onDragOver={(e) => { e.preventDefault(); if (destino !== idx) setDestino(idx); }}
                onDragLeave={() => { if (destino === idx) setDestino(null); }}
                onDragEnd={() => { arrastrada.current = null; setDestino(null); }}
                onDrop={() => soltar(idx)}
                className={`mxe-tarjeta${c.visible ? '' : ' mxe-tarjeta--apagada'}${destino === idx ? ' mxe-tarjeta--destino' : ''}`}
              >
                <span className="mxe-asa" title="Arrastrar para reordenar">⋮⋮</span>
                <input className="mxe-check" type="checkbox" checked={c.visible} aria-label={c.label}
                  onChange={() => setColumnas((prev) => prev.map((x, i) => (i === idx ? { ...x, visible: !x.visible } : x)))} />
                <span className={`mxe-etiqueta${c.visible ? '' : ' mxe-etiqueta--apagada'}`} title={c.label}>{c.label}</span>
              </li>
            ))}
          </ul>
          <div className="mxe-guardar">
            <input type="text" className="form-control mxe-guardar-input" placeholder="Nombre de la configuración (ej. Reporte semanal cliente)…"
              value={nombre} onChange={(e) => setNombre(e.target.value)} />
            <button type="button" className="mxe-btn mxe-btn--tenue" onClick={() => { void guardar(); }}
              title="Guardar esta selección y orden de columnas con el nombre indicado — quedará disponible para todos al presionar el botón de Excel">💾 Guardar configuración</button>
          </div>
          <div className="mxe-pie">
            <button type="button" className="mxe-btn mxe-btn--tenue" onClick={() => setColumnas(columnasPorDefecto())}
              title="Restablecer con las columnas visibles de la tabla, en su orden actual">Columnas de la tabla</button>
            <span className="mxe-espacio" />
            {exportando && <CargandoDatos compacto texto="Armando el Excel…" />}
            <button type="button" className="mxe-btn" onClick={onCerrar} disabled={exportando}>Cancelar</button>
            <button type="button" className="mxe-btn mxe-btn--principal" onClick={() => { void exportar(); }} disabled={exportando}>Exportar</button>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}

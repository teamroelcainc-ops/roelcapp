// src/shared/components/AdjuntosArchivos.tsx
// ✅ V00451: CARGA DE ARCHIVOS de toda la app (antes solo el comprobante de Pagos, V00450).
//   · Zona punteada: clic o arrastrar uno o VARIOS archivos (hasta `max`; sin límite en expedientes).
//   · Un renglón por archivo: nombre, tamaño, estado (Guardado / Se sube al guardar), Ver,
//     Reemplazar y × (quitar).
//   · Vista previa en el MISMO formulario del archivo elegido: PDF en un visor, imagen tal cual.
//   Componente controlado: la pantalla tiene la lista (`adjuntos`) y la guarda al confirmar
//   (src/shared/archivos/subirAdjuntos.ts).
import { useRef, useState } from 'react';
import { useUrlArchivo } from '../hooks/useUrlArchivo';
import VistaPreviaArchivo from './VistaPreviaArchivo';
import type { ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import {
  ACCEPT_TIPOS, MAX_ADJUNTOS, MAX_MB_ADJUNTO, adjuntoNuevo, esImagen, esPdf, tamanoLegible, tipoDeDataUrl, validarArchivo,
} from '../archivos/adjuntos';
import type { Adjunto, TiposAdjunto } from '../archivos/adjuntos';
import './AdjuntosArchivos.css';

interface Props {
  adjuntos: readonly Adjunto[];
  onCambiar: (adjuntos: Adjunto[]) => void;
  /** Cuántos archivos como máximo (10 por omisión; `SIN_LIMITE` en expedientes; 1 = uno solo). */
  max?: number;
  tipos?: TiposAdjunto;
  maxMb?: number;
  etiqueta?: string;
  deshabilitado?: boolean;
  /** Sin vista previa abierta al elegir (listas largas, espacios chicos). */
  previaCerrada?: boolean;
}

const describirTipos = (t: TiposAdjunto): string => (t === 'imagen' ? 'Imagen' : t === 'pdf-imagen' ? 'PDF o imagen' : t === 'factura' ? 'PDF, XML o imagen' : 'Cualquier archivo'); // ✅ V00530: factura

export default function AdjuntosArchivos({
  adjuntos, onCambiar, max = MAX_ADJUNTOS, tipos = 'pdf-imagen', maxMb = MAX_MB_ADJUNTO,
  etiqueta, deshabilitado = false, previaCerrada = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reemplazoRef = useRef<HTMLInputElement>(null);
  const reemplazarClave = useRef<string>('');
  const [arrastrando, setArrastrando] = useState(false);
  // Archivo en la vista previa ('' = ninguno). Por omisión, el primero.
  const [claveVista, setClaveVista] = useState<string>(previaCerrada ? '' : (adjuntos[0]?.clave ?? ''));
  const [cerrada, setCerrada] = useState(previaCerrada);
  const unico = max === 1;
  const sinLimite = !Number.isFinite(max);
  const lleno = adjuntos.length >= max;

  const visto = adjuntos.find((a) => a.clave === claveVista) ?? (cerrada ? undefined : adjuntos[0]);

  // URL local SOLO del archivo nuevo que se está viendo.
  const urlNueva = useUrlArchivo(visto?.estado === 'nuevo' ? visto.file : null);

  const agregar = (lista: readonly File[]): void => {
    if (deshabilitado || lista.length === 0) return;
    const errores: string[] = [];
    const validos = lista.filter((f) => { const e = validarArchivo(f, tipos, maxMb); if (e) errores.push(e); return !e; });
    if (unico && validos.length) {
      const nuevo = adjuntoNuevo(validos[0]);
      onCambiar([nuevo]);
      setClaveVista(nuevo.clave); setCerrada(false);
    } else {
      const lugar = Math.max(0, max - adjuntos.length);
      const entran = validos.slice(0, lugar);
      if (validos.length > entran.length) errores.push(`Solo se permiten ${max} archivos: ${validos.length - entran.length} no se agregaron.`);
      if (entran.length) {
        const nuevos = entran.map(adjuntoNuevo);
        onCambiar([...adjuntos, ...nuevos]);
        setClaveVista(nuevos[nuevos.length - 1].clave); setCerrada(false);
      }
    }
    if (errores.length) alert(errores.join('\n'));
  };

  const alElegir = (e: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // permite volver a elegir el mismo archivo
    agregar(files);
  };
  const alElegirReemplazo = (e: ChangeEvent<HTMLInputElement>): void => {
    const f = e.target.files?.[0];
    e.target.value = '';
    const clave = reemplazarClave.current;
    reemplazarClave.current = '';
    if (!f || !clave) return;
    const error = validarArchivo(f, tipos, maxMb);
    if (error) { alert(error); return; }
    const nuevo = adjuntoNuevo(f);
    onCambiar(adjuntos.map((a) => (a.clave === clave ? nuevo : a)));
    setClaveVista(nuevo.clave); setCerrada(false);
  };
  const abrirSelector = (): void => { if (!deshabilitado) inputRef.current?.click(); };
  const reemplazar = (a: Adjunto): void => {
    if (deshabilitado) return;
    reemplazarClave.current = a.clave;
    reemplazoRef.current?.click();
  };
  const quitar = (a: Adjunto): void => {
    if (deshabilitado) return;
    if (a.estado === 'guardado' && !window.confirm(`¿Quitar "${a.archivo.nombre}"? Se quita al guardar.`)) return;
    onCambiar(adjuntos.filter((x) => x.clave !== a.clave));
  };
  const ver = (a: Adjunto): void => {
    if (visto?.clave === a.clave && !cerrada) { setCerrada(true); setClaveVista(''); return; }
    setClaveVista(a.clave); setCerrada(false);
  };

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirSelector(); }
  };
  // Arrastrar y soltar en TODO el bloque (también sobre la lista y la vista previa): soltar fuera
  // de la zona abría el archivo en el navegador y se perdía lo capturado.
  const alArrastrar = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    if (!arrastrando && !deshabilitado) setArrastrando(true);
  };
  const alSalir = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastrando(false);
  };
  const alSoltar = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setArrastrando(false);
    if (unico || !lleno) agregar(Array.from(e.dataTransfer.files ?? []));
    else alert(`Ya hay ${max} archivos (el máximo). Quita o reemplaza alguno.`);
  };

  const nombreDe = (a: Adjunto): string => (a.estado === 'nuevo' ? a.file.name : a.archivo.nombre);
  // Guardados sin tipo: el de su `data:` URL (fotos en base64) o, si la carga es solo de imágenes, imagen.
  const tipoDe = (a: Adjunto): string => (a.estado === 'nuevo' ? a.file.type
    : a.archivo.tipo || tipoDeDataUrl(a.archivo.url) || (tipos === 'imagen' ? 'image/*' : ''));
  const tamanoDe = (a: Adjunto): string => tamanoLegible(a.estado === 'nuevo' ? a.file.size : a.archivo.tamano ?? 0);
  const urlDe = (a: Adjunto): string => (a.estado === 'nuevo' ? (a.clave === visto?.clave ? urlNueva : '') : a.archivo.url);
  const urlVista = visto ? urlDe(visto) : '';
  const conteo = sinLimite ? `${adjuntos.length}` : `${adjuntos.length} de ${max}`;
  const titulo = etiqueta ?? (unico ? 'Archivo' : 'Archivos');

  return (
    <div
      className={`adj-caja${arrastrando ? ' adj-caja--arrastrando' : ''}${deshabilitado ? ' adj-caja--deshabilitada' : ''}`}
      onDragOver={alArrastrar} onDragEnter={alArrastrar} onDragLeave={alSalir} onDrop={alSoltar}
    >
      <div className="adj-etiqueta">
        {titulo}
        {!unico && adjuntos.length > 0 && <span className="adj-conteo">{conteo}</span>}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPT_TIPOS[tipos]} multiple={!unico} className="adj-input-oculto" onChange={alElegir} tabIndex={-1} aria-hidden="true" />
      <input ref={reemplazoRef} type="file" accept={ACCEPT_TIPOS[tipos]} className="adj-input-oculto" onChange={alElegirReemplazo} tabIndex={-1} aria-hidden="true" />

      {adjuntos.length > 0 && (
        <ul className="adj-lista">
          {adjuntos.map((a) => {
            const nombre = nombreDe(a);
            const activo = visto?.clave === a.clave && !cerrada;
            return (
              <li key={a.clave} className={`adj-renglon${activo ? ' adj-renglon--activo' : ''}`}>
                <span className="adj-icono" aria-hidden="true">{esPdf(nombre, tipoDe(a)) ? '📄' : esImagen(nombre, tipoDe(a)) ? '🖼️' : '📎'}</span>
                <button type="button" className="adj-nombre" title={activo ? 'Ocultar vista previa' : 'Ver vista previa'} onClick={() => ver(a)}>{nombre}</button>
                {tamanoDe(a) && <span className="adj-tamano">{tamanoDe(a)}</span>}
                <span className={`adj-estado${a.estado === 'nuevo' ? ' adj-estado--nuevo' : ''}`}>{a.estado === 'nuevo' ? 'Se sube al guardar' : 'Guardado'}</span>
                <span className="adj-acciones">
                  <button type="button" className="adj-btn" onClick={() => ver(a)}>{activo ? 'Ocultar' : 'Ver'}</button>
                  <button type="button" className="adj-btn" onClick={() => reemplazar(a)} disabled={deshabilitado} title="Elegir otro archivo en lugar de este">Reemplazar</button>
                  <button type="button" className="adj-quitar" onClick={() => quitar(a)} disabled={deshabilitado} aria-label={`Quitar ${nombre}`} title="Quitar">×</button>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {visto && !cerrada && <VistaPreviaArchivo url={urlVista} nombre={nombreDe(visto)} tipo={tipoDe(visto)} />}

      {(!lleno || adjuntos.length === 0) && (
        <div className="adj-zona" role="button" tabIndex={deshabilitado ? -1 : 0} aria-disabled={deshabilitado} onClick={abrirSelector} onKeyDown={alTeclear}>
          <span className="adj-zona-titulo">📎 {adjuntos.length === 0 ? (unico ? 'Agregar archivo' : 'Agregar archivos') : 'Agregar más'}</span>
          <span className="adj-zona-sub">
            Arrastra aquí o haz clic · {describirTipos(tipos)} · Máx. {maxMb} MB{unico ? '' : sinLimite ? ' · sin límite de archivos' : ` · hasta ${max} archivos`}
          </span>
        </div>
      )}
    </div>
  );
}

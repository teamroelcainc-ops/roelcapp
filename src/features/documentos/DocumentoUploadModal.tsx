// src/features/documentos/DocumentoUploadModal.tsx
//
// Modal REUTILIZABLE para subir documentos desde cualquier módulo
// (empleados, clientes, proveedores, unidades, etc.).
//
// • Sube los archivos a Firebase Storage en:
//     <coleccionOrigen>/<nombre del registro>/<nombre del documento>/<archivo>
// • Registra la metadata en la colección UNIFICADA "documentos" (un documento por archivo),
//   LIGADA al registro de origen mediante { coleccionOrigen, registroId }.
//
// ✅ V00451 — EXPEDIENTE SIN LÍMITE DE ARCHIVOS (misma carga que Pagos: AdjuntosArchivos):
//   · Al elegir el tipo se ven los archivos YA guardados de ese tipo, con Ver, Reemplazar y ×.
//   · Se pueden agregar VARIOS archivos (sin límite). Cada uno es un documento: el primero toma
//     el id de siempre (`col__registro__tipo`) si está libre; los demás, uno con sufijo único y
//     el tipo "Tipo (2)", "Tipo (3)"… (como la Carga Masiva).
//   · "Subir Documento" aplica todo: quita, reemplaza (el mismo documento, archivo nuevo; se borra
//     el viejo) y sube los nuevos. Las fechas/vence/observaciones del modal van a los archivos
//     nuevos o reemplazados. Antes: UN archivo y subir el mismo tipo sustituía al anterior.
//   La lógica pura está en expediente.ts y la de Storage/Firestore en expedienteServicio.ts.
//
// ✅ Integración con el catálogo `catalogo_tipo_archivo`:
//   1. El dropdown mezcla la lista fija del módulo con los tipos del catálogo
//      cuyo Módulo corresponda (Empleado, Empresa, Unidad, Operación, etc.).
//   2. El apartado "¿Vence?" se muestra únicamente si el tipo seleccionado tiene
//      Vence = "Sí" en el catálogo; si no, el documento se guarda con vence=false.
//   3. Botón "+" junto al select para dar de alta un tipo de archivo nuevo
//      DIRECTO en `catalogo_tipo_archivo` sin salir del formulario.
//
// Ejemplos de uso:
//   <DocumentoUploadModal coleccionOrigen="empleados" registroId={emp.id} registroNombre="Juan Pérez" ... />
//   <DocumentoUploadModal coleccionOrigen="empresas"  registroId={cli.id} registroNombre="ACME SA de CV" ... />

import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { addDoc, collection } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { SelectBuscable } from '../catalogos/components/SelectBuscable';
import { idReal, useCatalogo } from '../../shared/data/catalogos';
import AdjuntosArchivos from '../../shared/components/AdjuntosArchivos';
import CargandoDatos from '../../shared/components/CargandoDatos';
import { SIN_LIMITE } from '../../shared/archivos/adjuntos';
import type { Adjunto } from '../../shared/archivos/adjuntos';
import {
  SIN_CAMBIOS, aplicarCambioLista, cambiosAlCambiarTipo, esDelTipo, listaVisible, mensajeError, nombreSubcarpetaDoc,
  normTexto, planGuardado, sanitizarRuta, totalPlan,
} from './expediente';
import type { CambiosExpediente, DocumentoExpediente } from './expediente';
import { guardarCambiosExpediente, leerDocumentosDeRegistro } from './expedienteServicio';
import './DocumentoUploadModal.css';

// Catálogo por defecto (genérico). Cada módulo puede pasar su propia lista por props.
const TIPOS_DOCUMENTO_DEFAULT = [
  '1. Identificación Oficial',
  '2. Comprobante de Domicilio',
  '3. RFC (Constancia de Situación Fiscal)',
  '4. Contrato',
  '5. Otro',
];

// Opciones de Módulo — deben coincidir con las del catálogo `tipo_archivo`
// definido en catalogSchemas.tsx.
const MODULOS_TIPO_ARCHIVO = ['Empleado', 'Cliente', 'Proveedor', 'Bodega', 'Empresa', 'Operación', 'Unidad', 'Otro'];

// Mapea la colección de origen a los Módulos del catálogo que le aplican.
// (Las empresas engloban clientes y proveedores en esta app.)
const MODULOS_POR_COLECCION: Record<string, string[]> = {
  empleados: ['Empleado'],
  empresas: ['Empresa', 'Cliente', 'Proveedor'],
  clientes: ['Cliente'],
  proveedores: ['Proveedor'],
  operaciones: ['Operación'],
  unidades: ['Unidad'],
  bodegas: ['Bodega'],
};
const MODULOS_OTRO = ['Otro'];

// Interpreta el campo `vence` del catálogo: SOLO "Sí" (o equivalentes) activa
// el apartado de vencimiento; "No", vacío o sin marcar => NO se muestra.
const esVenceSi = (valor: unknown): boolean => {
  if (valor === true || valor === 1) return true;
  const v = normTexto(valor);
  return v === 'si' || v === '1' || v === 'true';
};

// El campo `modulo` del catálogo puede venir como string, string con comas
// ("Cliente , Proveedor , Empleado") o array. Devuelve la lista normalizada.
const modulosDeRegistro = (valor: unknown): string[] => {
  if (Array.isArray(valor)) return valor.map(normTexto).filter(Boolean);
  return String(valor ?? '').split(',').map(normTexto).filter(Boolean);
};

// Orden natural por prefijo numérico ("1.", "1.1", "10.") y después alfabético.
const ordenarTipos = (a: string, b: string): number => {
  const pa = String(a).match(/^(\d+(?:\.\d+)?)/);
  const pb = String(b).match(/^(\d+(?:\.\d+)?)/);
  if (pa && pb) {
    const na = parseFloat(pa[1]);
    const nb = parseFloat(pb[1]);
    if (na !== nb) return na - nb;
  } else if (pa) return -1;
  else if (pb) return 1;
  return a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' });
};

interface TipoArchivoCatalogo {
  id: string;
  nombre: string;
  modulos: string[];   // normalizados
  vence: boolean;      // true SOLO si el catálogo dice "Sí"
  obligatorio?: string;
}

interface DocumentoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  coleccionOrigen: string;     // colección desde la que se sube: 'empleados', 'clientes', ...
  registroId: string;          // id del registro de origen (para ligar el documento)
  registroNombre: string;      // nombre legible del registro (se usa como carpeta)
  tiposDocumento?: string[];   // catálogo de tipos; si no se pasa, usa el default
  onUploaded?: () => void;
}

/** Botones Sí/No del alta de tipo (estado finito → clases). */
function SiNo({ valor, onCambiar }: { valor: 'Sí' | 'No'; onCambiar: (v: 'Sí' | 'No') => void }) {
  return (
    <div className="dum-x13">
      <button type="button" className={`dsub-seg${valor === 'No' ? ' dsub-seg--no' : ''}`} onClick={() => onCambiar('No')}>No</button>
      <button type="button" className={`dsub-seg${valor === 'Sí' ? ' dsub-seg--si' : ''}`} onClick={() => onCambiar('Sí')}>Sí</button>
    </div>
  );
}

export function DocumentoUploadModal({
  isOpen, onClose, coleccionOrigen, registroId, registroNombre, tiposDocumento, onUploaded,
}: DocumentoUploadModalProps) {
  const tiposBase = (tiposDocumento && tiposDocumento.length > 0) ? tiposDocumento : TIPOS_DOCUMENTO_DEFAULT;
  const [tipoDoc, setTipoDoc] = useState(tiposBase[0]);
  const [fechaExpedicion, setFechaExpedicion] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  // ✅ V00451: documentos ya guardados del registro (lectura única al abrir) y cambios pendientes.
  const [carga, setCarga] = useState<{ docs: DocumentoExpediente[] | null; error: string }>({ docs: null, error: '' });
  const [cambios, setCambios] = useState<CambiosExpediente>(SIN_CAMBIOS);
  const [progreso, setProgreso] = useState<{ hechas: number; total: number } | null>(null);
  const subiendo = progreso !== null;

  // ✅ V00451: cada vez que se abre (o cambia el registro) empieza limpio.
  const claveApertura = isOpen ? `${coleccionOrigen}|${registroId}` : '';
  const [aperturaPrevia, setAperturaPrevia] = useState(claveApertura);
  if (claveApertura !== aperturaPrevia) {
    setAperturaPrevia(claveApertura);
    if (claveApertura) {
      setCarga({ docs: null, error: '' });
      setCambios(SIN_CAMBIOS);
      setObservaciones('');
      setFechaExpedicion('');
      setFechaVencimiento('');
    }
  }

  useEffect(() => {
    if (!isOpen || !registroId) return;
    let vivo = true;
    leerDocumentosDeRegistro(registroId, coleccionOrigen)
      .then((docs) => { if (vivo) setCarga({ docs, error: '' }); })
      .catch((e: unknown) => {
        console.error('Error leyendo los documentos guardados:', e);
        if (vivo) setCarga({ docs: [], error: 'No se pudieron leer los documentos guardados. Cierra y vuelve a abrir.' });
      });
    return () => { vivo = false; };
  }, [isOpen, registroId, coleccionOrigen]);

  // ✅ V00439 (Fase 3.x): catálogo de Tipo de Archivo del listener compartido,
  //   solo mientras el modal está abierto (antes getDocs en cada apertura).
  const { datos: tiposArchivoCat, listo: tiposArchivoListos } = useCatalogo('catalogo_tipo_archivo', { activo: isOpen });
  const catalogoTipos = useMemo<TipoArchivoCatalogo[]>(() => tiposArchivoCat.map(data => ({
    id: idReal(data),
    nombre: String(data.nombre || '').trim(),
    modulos: modulosDeRegistro(data.modulo),
    vence: esVenceSi(data.vence),
    obligatorio: data.obligatorio as string | undefined,
  })).filter(t => t.nombre), [tiposArchivoCat]);
  const cargandoCatalogo = isOpen && !tiposArchivoListos;

  // ✅ NUEVO: mini-formulario para dar de alta un tipo de archivo desde aquí.
  const modulosSugeridos = useMemo(() => MODULOS_POR_COLECCION[normTexto(coleccionOrigen)] || MODULOS_OTRO, [coleccionOrigen]);
  const [mostrarNuevoTipo, setMostrarNuevoTipo] = useState(false);
  const [nuevoTipoNombre, setNuevoTipoNombre] = useState('');
  const [nuevoTipoModulo, setNuevoTipoModulo] = useState(modulosSugeridos[0]);
  const [nuevoTipoObligatorio, setNuevoTipoObligatorio] = useState<'Sí' | 'No'>('No');
  const [nuevoTipoVence, setNuevoTipoVence] = useState<'Sí' | 'No'>('No');
  const [guardandoTipo, setGuardandoTipo] = useState(false);

  // Tipos del catálogo que aplican al módulo actual.
  const tiposCatalogoModulo = useMemo(() => {
    const modsBuscados = modulosSugeridos.map(normTexto);
    return catalogoTipos.filter(t =>
      t.modulos.length === 0 || t.modulos.some(m => modsBuscados.includes(m))
    );
  }, [catalogoTipos, modulosSugeridos]);

  // Dropdown final.
  // ✅ FUENTE DE VERDAD: el catálogo `catalogo_tipo_archivo` (filtrado por el
  //   Módulo que corresponde a la colección de origen). La lista fija que
  //   pasa cada módulo por props SOLO se usa como respaldo cuando el catálogo
  //   todavía no tiene tipos para ese módulo (o no se pudo cargar).
  const tipos = useMemo(() => {
    const vistos = new Set<string>();
    const resultado: string[] = [];
    const agregar = (nombre: string) => {
      const clave = normTexto(nombreSubcarpetaDoc(nombre));
      if (!clave || vistos.has(clave)) return;
      vistos.add(clave);
      resultado.push(nombre);
    };
    if (tiposCatalogoModulo.length > 0) {
      tiposCatalogoModulo.forEach(t => agregar(t.nombre));
    } else {
      tiposBase.forEach(agregar);
    }
    return resultado.sort(ordenarTipos);
  }, [tiposBase, tiposCatalogoModulo]);

  // ✅ V00451: cambiar de tipo conserva los archivos elegidos (como nuevos del tipo nuevo);
  //   quitar/reemplazar eran de los guardados del tipo anterior y se descartan.
  const cambiarTipo = (nuevo: string) => {
    if (nuevo === tipoDoc) return;
    setTipoDoc(nuevo);
    setCambios(cambiosAlCambiarTipo);
  };

  // Si el tipo seleccionado desapareció de la lista (cambio de módulo), se
  // regresa al primero disponible. ✅ V00451: Effect Event (antes eslint-disable).
  const ajustarTipo = useEffectEvent(() => {
    if (tipos.length > 0 && !tipos.includes(tipoDoc)) cambiarTipo(tipos[0]);
  });
  useEffect(() => { ajustarTipo(); }, [tipos]);

  // Registro del catálogo que corresponde al tipo seleccionado (por nombre,
  // tolerante a acentos y al prefijo numérico).
  const registroCatalogoSeleccionado = useMemo(() => {
    const claveSel = normTexto(nombreSubcarpetaDoc(tipoDoc));
    return catalogoTipos.find(t => normTexto(nombreSubcarpetaDoc(t.nombre)) === claveSel) || null;
  }, [catalogoTipos, tipoDoc]);

  // ✅ REGLA NUEVA (puntos 2 y 3): el apartado de vencimiento SOLO se muestra
  //   si el catálogo marca Vence = "Sí" para el tipo seleccionado.
  const vence = registroCatalogoSeleccionado ? registroCatalogoSeleccionado.vence : false;

  // Al cambiar a un tipo que NO vence se limpian las fechas capturadas.
  useEffect(() => {
    if (!vence) { setFechaExpedicion(''); setFechaVencimiento(''); }
  }, [vence]);

  if (!isOpen) return null;

  const carpeta = sanitizarRuta(registroNombre) || sanitizarRuta(registroId) || 'sin_nombre';
  const subcarpeta = nombreSubcarpetaDoc(tipoDoc);

  // ✅ V00451: lista del tipo elegido = guardados (o su reemplazo) + nuevos.
  const docsGuardados = registroId ? carga.docs : [];
  const cargandoDocs = docsGuardados === null;
  const guardadosDelTipo = (docsGuardados ?? []).filter((d) => esDelTipo(d, tipoDoc));
  const adjuntos = listaVisible(guardadosDelTipo, cambios);
  const plan = planGuardado(guardadosDelTipo, cambios);
  const subeArchivos = plan.nuevos.length + plan.reemplazar.length > 0;
  const alCambiarAdjuntos = (siguiente: Adjunto[]) =>
    setCambios((c) => aplicarCambioLista(c, listaVisible(guardadosDelTipo, c), siguiente));

  // ✅ NUEVO (punto 4): alta de un Tipo de Archivo directo en el catálogo.
  const handleGuardarNuevoTipo = async () => {
    const nombre = nuevoTipoNombre.trim();
    if (!nombre) { alert('Escribe el nombre del tipo de archivo.'); return; }
    const claveNueva = normTexto(nombreSubcarpetaDoc(nombre));
    const yaExiste = catalogoTipos.some(t => normTexto(nombreSubcarpetaDoc(t.nombre)) === claveNueva)
      || tiposBase.some(t => normTexto(nombreSubcarpetaDoc(t)) === claveNueva);
    if (yaExiste) { alert('Ya existe un tipo de archivo con ese nombre.'); return; }

    setGuardandoTipo(true);
    try {
      await addDoc(collection(db, 'catalogo_tipo_archivo'), {
        nombre,
        modulo: nuevoTipoModulo,
        obligatorio: nuevoTipoObligatorio,
        vence: nuevoTipoVence,
        createdAt: new Date().toISOString(),
        creadoDesde: `formulario_documentos_${coleccionOrigen}`,
      });
      // El alta llega sola por el listener compartido del catálogo.
      cambiarTipo(nombre);
      setMostrarNuevoTipo(false);
      setNuevoTipoNombre('');
      setNuevoTipoObligatorio('No');
      setNuevoTipoVence('No');
      setNuevoTipoModulo(modulosSugeridos[0]);
    } catch (e: unknown) {
      console.error('Error creando tipo de archivo:', e);
      alert('No se pudo crear el tipo de archivo.\n\nDetalle: ' + mensajeError(e));
    }
    setGuardandoTipo(false);
  };

  // ✅ V00451: aplica quitar / reemplazar / subir nuevos y avisa de TODO lo que falle.
  const handleSubir = async () => {
    if (!registroId) { alert('No se puede ligar el documento: falta el identificador del registro de origen.'); return; }
    if (cargandoDocs) return;
    if (carga.error) { alert(carga.error); return; }
    const total = totalPlan(plan);
    if (total === 0) { alert('Agrega al menos un archivo (o reemplaza o quita uno guardado).'); return; }
    if (vence && subeArchivos && (!fechaExpedicion || !fechaVencimiento)) {
      alert('Este tipo de documento vence (según el catálogo): debes indicar la fecha de expedición y la de vencimiento.');
      return;
    }
    setProgreso({ hechas: 0, total });
    try {
      const r = await guardarCambiosExpediente(
        { coleccionOrigen, registroId, registroNombre, tipoDocumento: tipoDoc, carpeta, subcarpeta, vence, fechaExpedicion, fechaVencimiento, observaciones },
        plan, guardadosDelTipo, docsGuardados ?? [],
        (hechas) => setProgreso({ hechas, total }),
      );
      const partes = [
        r.subidos ? `${r.subidos} subido(s)` : '',
        r.reemplazados ? `${r.reemplazados} reemplazado(s)` : '',
        r.quitados ? `${r.quitados} quitado(s)` : '',
      ].filter(Boolean).join(', ');
      if (r.errores.length === 0) {
        alert(`Documentos guardados: ${partes}.`);
        setCambios(SIN_CAMBIOS);
        setObservaciones('');
        setFechaExpedicion('');
        setFechaVencimiento('');
        onUploaded?.();
        onClose();
        return;
      }
      // Algo falló: se queda abierto con lo pendiente para reintentar, y se releen los guardados.
      if (partes) onUploaded?.();
      setCambios(r.pendientes);
      setCarga({ docs: null, error: '' });
      try {
        setCarga({ docs: await leerDocumentosDeRegistro(registroId, coleccionOrigen), error: '' });
      } catch (e: unknown) {
        console.error('Error releyendo los documentos guardados:', e);
        setCarga({ docs: [], error: 'No se pudieron leer los documentos guardados. Cierra y vuelve a abrir.' });
      }
      alert(`${partes ? `Se guardó: ${partes}.\n\n` : ''}No se pudo (${r.errores.length} de ${total}):\n• ${r.errores.join('\n• ')}\n\nLo que falló sigue pendiente en la lista: vuelve a guardar para reintentar.\nVerifica la conexión y que las reglas de Firebase permitan la escritura.`);
    } catch (e: unknown) {
      console.error('Error subiendo documentos:', e);
      alert('No se pudieron guardar los documentos.\n\nDetalle: ' + mensajeError(e));
    } finally {
      setProgreso(null);
    }
  };

  const textoBoton = progreso
    ? `Guardando ${progreso.hechas}/${progreso.total}…`
    : subeArchivos || totalPlan(plan) === 0
      ? (plan.nuevos.length + plan.reemplazar.length > 1 ? 'Subir Documentos' : 'Subir Documento')
      : 'Guardar cambios';

  return (
    <div className="modal-overlay dum-x1">
      <div className="form-card dum-x2">
        <div className="form-header dum-x3">
          <h3 className="dum-x4">Subir Documento{registroNombre ? ` — ${registroNombre}` : ''}</h3>
          <button className="dum-x5" type="button" onClick={onClose} disabled={subiendo}>✕</button>
        </div>

        <div className="dum-x6">
          <div className="dum-x7">
            Se guardará en: <span className="dum-x8">{sanitizarRuta(coleccionOrigen)} / {carpeta} / {subcarpeta} /</span>
            <span className="dum-x9"> · ligado a {coleccionOrigen} ({registroId || '—'})</span>
          </div>

          <div className="dsub-fila">
            <label className="dsub-etq">Tipo de archivo</label>
            <div className="dsub-tipo">
              {/* ✅ Lista desplegable CON BÚSQUEDA (convención de toda la app) */}
              <div className="dsub-tipo-select">
                <SelectBuscable
                  opciones={tipos.map((t) => ({ value: t, label: t }))}
                  value={tipoDoc}
                  onChange={cambiarTipo}
                  placeholder="Buscar tipo de archivo..."
                  disabled={subiendo}
                />
              </div>
              {/* ✅ NUEVO: alta de tipo de archivo directo desde el formulario */}
              <button
                type="button"
                className={`dsub-mas${mostrarNuevoTipo ? ' dsub-mas--activo' : ''}`}
                title="Agregar un tipo de archivo nuevo al catálogo"
                onClick={() => setMostrarNuevoTipo(v => !v)}
              >+</button>
            </div>
          </div>

          {cargandoCatalogo && (
            <div className="dum-x9 dsub-nota-catalogo">Cargando catálogo de tipos de archivo…</div>
          )}

          {/* ✅ NUEVO: mini-formulario de alta en catalogo_tipo_archivo */}
          {mostrarNuevoTipo && (
            <div className="dsub-nuevo">
              <div className="dsub-nuevo-titulo">Nuevo tipo de archivo (se guarda en el catálogo)</div>
              <div className="dsub-fila">
                <label className="dsub-etq">Nombre</label>
                <input className="dsub-input" type="text" value={nuevoTipoNombre} onChange={(e) => setNuevoTipoNombre(e.target.value)} placeholder='Ej. "21. Carta Responsiva"' />
              </div>
              <div className="dsub-fila">
                <label className="dsub-etq">Módulo</label>
                <SelectBuscable
                  opciones={MODULOS_TIPO_ARCHIVO.map((m) => ({ value: m, label: m }))}
                  value={nuevoTipoModulo}
                  onChange={setNuevoTipoModulo}
                  placeholder="Buscar módulo..."
                />
              </div>
              <div className="dsub-fila">
                <label className="dsub-etq">Obligatorio</label>
                <SiNo valor={nuevoTipoObligatorio} onCambiar={setNuevoTipoObligatorio} />
              </div>
              <div className="dsub-fila">
                <label className="dsub-etq">¿Vence?</label>
                <SiNo valor={nuevoTipoVence} onCambiar={setNuevoTipoVence} />
              </div>
              <div className="dsub-acciones-tipo">
                <button type="button" className="btn btn-outline dum-x15" disabled={guardandoTipo} onClick={() => setMostrarNuevoTipo(false)}>Cancelar</button>
                <button type="button" className="dsub-btn-primario" onClick={handleGuardarNuevoTipo} disabled={guardandoTipo}>
                  {guardandoTipo ? 'Guardando…' : 'Guardar Tipo'}
                </button>
              </div>
            </div>
          )}

          {/* ✅ V00451: los archivos de este tipo (guardados + nuevos), sin límite. */}
          <div className="dsub-fila dsub-fila--arriba">
            <label className="dsub-etq dsub-etq--arriba">Archivos</label>
            <div className="dsub-archivos">
              {cargandoDocs ? (
                <CargandoDatos compacto texto="Cargando documentos guardados…" />
              ) : (
                <>
                  {carga.error && <div className="dsub-error">{carga.error}</div>}
                  <AdjuntosArchivos
                    key={subcarpeta}
                    etiqueta={subcarpeta || 'Archivos'}
                    adjuntos={adjuntos}
                    onCambiar={alCambiarAdjuntos}
                    max={SIN_LIMITE}
                    tipos="pdf-imagen"
                    deshabilitado={subiendo || !!carga.error}
                    previaCerrada={guardadosDelTipo.length > 0}
                  />
                  <p className="dsub-ayuda">
                    Los archivos nuevos se AGREGAN a este tipo. Para renovar uno guardado usa «Reemplazar» en su renglón.
                  </p>
                </>
              )}
            </div>
          </div>

          {/* ✅ REGLA NUEVA: el apartado de vencimiento se muestra SOLO si el
              catálogo marca Vence = "Sí" para el tipo seleccionado. */}
          {vence && (
            <>
              <div className="dsub-fila">
                <label className="dsub-etq">Vencimiento</label>
                <span className="dsub-aviso-vence">
                  Este tipo de documento vence (definido en el catálogo de Tipo de Archivo). Las fechas se aplican a los archivos nuevos o reemplazados.
                </span>
              </div>
              <div className="dsub-fila">
                <label className="dsub-etq">Fecha de expedición</label>
                <input type="date" className="dsub-input" value={fechaExpedicion} onChange={(e) => setFechaExpedicion(e.target.value)} disabled={subiendo} />
              </div>
              <div className="dsub-fila">
                <label className="dsub-etq">Fecha de vencimiento</label>
                <input type="date" className="dsub-input" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} disabled={subiendo} />
              </div>
            </>
          )}

          <div className="dsub-fila dsub-fila--arriba">
            <label className="dsub-etq dsub-etq--arriba">Observaciones</label>
            <textarea className="dsub-input dsub-textarea" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} placeholder="Notas opcionales sobre el documento..." disabled={subiendo} />
          </div>
        </div>

        <div className="dum-x14">
          <button type="button" onClick={onClose} disabled={subiendo} className="btn btn-outline dum-x15">Cancelar</button>
          <button type="button" className="dsub-btn-primario dsub-btn-subir" onClick={handleSubir} disabled={subiendo || cargandoDocs}>
            {textoBoton}
          </button>
        </div>
      </div>
    </div>
  );
}

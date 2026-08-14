// src/features/documentos/DocumentoUploadModal.tsx
//
// Modal REUTILIZABLE para subir documentos desde cualquier módulo
// (empleados, clientes, proveedores, unidades, etc.).
//
// • Sube el archivo a Firebase Storage en:
//     <coleccionOrigen>/<nombre del registro>/<nombre del documento>/<archivo>
// • Registra la metadata en la colección UNIFICADA "documentos", LIGADA al
//   registro de origen mediante { coleccionOrigen, registroId }.
//
// ✅ NUEVO — Integración con el catálogo `catalogo_tipo_archivo`:
//   1. Al abrir el modal se carga el catálogo de Tipo de Archivo y el
//      dropdown mezcla la lista fija del módulo con los tipos del catálogo
//      cuyo Módulo corresponda (Empleado, Empresa, Unidad, Operación, etc.).
//   2. El apartado "¿Vence?" YA NO es un toggle manual: se muestra únicamente
//      si el tipo seleccionado tiene Vence = "Sí" en el catálogo. Si el
//      catálogo dice "No" o no tiene nada marcado, el apartado NO aparece y
//      el documento se guarda con vence=false.
//   3. Botón "+" junto al select para dar de alta un tipo de archivo nuevo
//      DIRECTO en `catalogo_tipo_archivo` sin salir del formulario.
//
// Ejemplos de uso:
//   <DocumentoUploadModal coleccionOrigen="empleados" registroId={emp.id} registroNombre="Juan Pérez" ... />
//   <DocumentoUploadModal coleccionOrigen="empresas"  registroId={cli.id} registroNombre="ACME SA de CV" ... />

import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
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

// Quita caracteres no válidos para rutas de Storage
const sanitizarRuta = (s: string) =>
  String(s || '').trim().replace(/[\/\\:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();
// Subcarpeta = nombre del documento sin el prefijo numérico ("16. " -> "Contrato Laboral")
const nombreSubcarpetaDoc = (label: string) => sanitizarRuta(String(label).replace(/^\d+\.\s*/, ''));

// Normaliza texto para comparar (sin acentos, minúsculas, espacios simples).
const normTexto = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

// Interpreta el campo `vence` del catálogo: SOLO "Sí" (o equivalentes) activa
// el apartado de vencimiento; "No", vacío o sin marcar => NO se muestra.
const esVenceSi = (valor: any): boolean => {
  if (valor === true || valor === 1) return true;
  const v = normTexto(valor);
  return v === 'si' || v === '1' || v === 'true';
};

// El campo `modulo` del catálogo puede venir como string, string con comas
// ("Cliente , Proveedor , Empleado") o array. Devuelve la lista normalizada.
const modulosDeRegistro = (valor: any): string[] => {
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

export const DocumentoUploadModal: React.FC<DocumentoUploadModalProps> = ({
  isOpen, onClose, coleccionOrigen, registroId, registroNombre, tiposDocumento, onUploaded,
}) => {
  const tiposBase = (tiposDocumento && tiposDocumento.length > 0) ? tiposDocumento : TIPOS_DOCUMENTO_DEFAULT;
  const [tipoDoc, setTipoDoc] = useState(tiposBase[0]);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [arrastrando, setArrastrando] = useState(false);
  const [fechaExpedicion, setFechaExpedicion] = useState('');
  const [fechaVencimiento, setFechaVencimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  // ✅ NUEVO: catálogo de Tipo de Archivo cargado de Firestore.
  const [catalogoTipos, setCatalogoTipos] = useState<TipoArchivoCatalogo[]>([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(false);

  // ✅ NUEVO: mini-formulario para dar de alta un tipo de archivo desde aquí.
  const modulosSugeridos = MODULOS_POR_COLECCION[normTexto(coleccionOrigen)] || ['Otro'];
  const [mostrarNuevoTipo, setMostrarNuevoTipo] = useState(false);
  const [nuevoTipoNombre, setNuevoTipoNombre] = useState('');
  const [nuevoTipoModulo, setNuevoTipoModulo] = useState(modulosSugeridos[0]);
  const [nuevoTipoObligatorio, setNuevoTipoObligatorio] = useState<'Sí' | 'No'>('No');
  const [nuevoTipoVence, setNuevoTipoVence] = useState<'Sí' | 'No'>('No');
  const [guardandoTipo, setGuardandoTipo] = useState(false);

  // Carga (o recarga) el catálogo `catalogo_tipo_archivo`.
  const cargarCatalogoTipos = async () => {
    setCargandoCatalogo(true);
    try {
      const snap = await getDocs(collection(db, 'catalogo_tipo_archivo'));
      const tipos: TipoArchivoCatalogo[] = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          nombre: String(data.nombre || '').trim(),
          modulos: modulosDeRegistro(data.modulo),
          vence: esVenceSi(data.vence),
          obligatorio: data.obligatorio,
        };
      }).filter(t => t.nombre);
      setCatalogoTipos(tipos);
    } catch (e) {
      console.warn('No se pudo cargar catalogo_tipo_archivo (se usa la lista fija):', e);
    }
    setCargandoCatalogo(false);
  };

  useEffect(() => {
    if (isOpen) cargarCatalogoTipos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Tipos del catálogo que aplican al módulo actual.
  const tiposCatalogoModulo = useMemo(() => {
    const modsBuscados = modulosSugeridos.map(normTexto);
    return catalogoTipos.filter(t =>
      t.modulos.length === 0 || t.modulos.some(m => modsBuscados.includes(m))
    );
  }, [catalogoTipos, modulosSugeridos]);

  // Dropdown final: lista fija del módulo + tipos del catálogo (sin duplicados,
  // comparando sin acentos ni prefijo numérico).
  const tipos = useMemo(() => {
    const vistos = new Set<string>();
    const resultado: string[] = [];
    const agregar = (nombre: string) => {
      const clave = normTexto(nombreSubcarpetaDoc(nombre));
      if (!clave || vistos.has(clave)) return;
      vistos.add(clave);
      resultado.push(nombre);
    };
    tiposBase.forEach(agregar);
    tiposCatalogoModulo.forEach(t => agregar(t.nombre));
    return resultado.sort(ordenarTipos);
  }, [tiposBase, tiposCatalogoModulo]);

  // Si el tipo seleccionado desapareció de la lista (cambio de módulo), se
  // regresa al primero disponible.
  useEffect(() => {
    if (tipos.length > 0 && !tipos.includes(tipoDoc)) setTipoDoc(tipos[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipos]);

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
  const extPreview = archivo ? (archivo.name.lastIndexOf('.') >= 0 ? archivo.name.slice(archivo.name.lastIndexOf('.')) : '') : '';
  const nombreFinalPreview = `${subcarpeta}${extPreview}`;

  const labelStyle: React.CSSProperties = { color: '#8b949e', fontSize: '0.9rem' };
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px 12px', backgroundColor: '#010409', border: '1px solid #30363d', borderRadius: '8px', color: '#c9d1d9', fontSize: '0.9rem', boxSizing: 'border-box' };
  const filaStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '160px 1fr', alignItems: 'center', gap: '16px' };
  const segBtn = (activo: boolean, colorActivo: string): React.CSSProperties => ({
    padding: '10px 30px', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
    backgroundColor: activo ? colorActivo : 'transparent',
    color: activo ? '#fff' : '#8b949e', transition: 'all 0.15s ease',
  });

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
      await cargarCatalogoTipos();
      setTipoDoc(nombre);
      setMostrarNuevoTipo(false);
      setNuevoTipoNombre('');
      setNuevoTipoObligatorio('No');
      setNuevoTipoVence('No');
      setNuevoTipoModulo(modulosSugeridos[0]);
    } catch (e: any) {
      console.error('Error creando tipo de archivo:', e);
      alert('No se pudo crear el tipo de archivo.\n\nDetalle: ' + (e?.message || e));
    }
    setGuardandoTipo(false);
  };

  const handleSubir = async () => {
    if (!archivo) { alert('Selecciona un archivo.'); return; }
    if (!registroId) { alert('No se puede ligar el documento: falta el identificador del registro de origen.'); return; }
    if (vence && (!fechaExpedicion || !fechaVencimiento)) {
      alert('Este tipo de documento vence (según el catálogo): debes indicar la fecha de expedición y la de vencimiento.');
      return;
    }
    setSubiendo(true);
    try {
      // El nombre del archivo se reescribe con el TIPO de documento (conservando la extensión)
      const punto = archivo.name.lastIndexOf('.');
      const extension = punto >= 0 ? archivo.name.slice(punto) : '';
      const nombreFinal = `${subcarpeta}${extension}`;

      const ruta = `${sanitizarRuta(coleccionOrigen)}/${carpeta}/${subcarpeta}/${nombreFinal}`;
      const r = storageRef(storage, ruta);
      await uploadBytes(r, archivo, archivo.type ? { contentType: archivo.type } : undefined);
      const url = await getDownloadURL(r);

      // Un documento por (registro + tipo): si se vuelve a subir el mismo tipo, se reemplaza
      const docId = sanitizarRuta(`${coleccionOrigen}__${registroId}__${subcarpeta}`).replace(/\s+/g, '_');

      // Colección UNIFICADA "documentos" + liga al registro de origen
      await setDoc(doc(db, 'documentos', docId), {
        coleccionOrigen,
        registroId,
        registroNombre: registroNombre || '',
        tipoDocumento: tipoDoc,
        carpeta,
        subcarpeta,
        nombreArchivo: nombreFinal,
        path: ruta,
        url,
        vence,
        fechaExpedicion: vence ? fechaExpedicion : '',
        fechaVencimiento: vence ? fechaVencimiento : '',
        observaciones: observaciones || '',
        createdAt: new Date().toISOString(),
      }, { merge: true });

      alert('Documento subido correctamente.');
      setArchivo(null);
      setObservaciones('');
      setFechaExpedicion('');
      setFechaVencimiento('');
      onUploaded?.();
      onClose();
    } catch (e: any) {
      console.error('Error subiendo documento:', e);
      alert('No se pudo subir el documento.\n\nVerifica que Firebase Storage esté habilitado y que las reglas permitan la escritura.\n\nDetalle: ' + (e?.message || e));
    }
    setSubiendo(false);
  };

  return (
    <div className="modal-overlay dum-x1">
      <div className="form-card dum-x2">
        <div className="form-header dum-x3">
          <h3 className="dum-x4">Subir Documento{registroNombre ? ` — ${registroNombre}` : ''}</h3>
          <button className="dum-x5" type="button" onClick={onClose}>✕</button>
        </div>

        <div className="dum-x6">
          <div className="dum-x7">
            Se guardará en: <span className="dum-x8">{sanitizarRuta(coleccionOrigen)} / {carpeta} / {subcarpeta} / {nombreFinalPreview}</span>
            <span className="dum-x9"> · ligado a {coleccionOrigen} ({registroId || '—'})</span>
          </div>

          <div style={filaStyle}>
            <label style={labelStyle}>Tipo de archivo</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
                {tipos.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {/* ✅ NUEVO: alta de tipo de archivo directo desde el formulario */}
              <button
                type="button"
                title="Agregar un tipo de archivo nuevo al catálogo"
                onClick={() => setMostrarNuevoTipo(v => !v)}
                style={{
                  flexShrink: 0, width: '38px', height: '38px', borderRadius: '8px', cursor: 'pointer',
                  border: mostrarNuevoTipo ? '1px solid #D84315' : '1px solid #30363d',
                  backgroundColor: mostrarNuevoTipo ? 'rgba(216,67,21,0.15)' : '#161b22',
                  color: mostrarNuevoTipo ? '#D84315' : '#c9d1d9', fontSize: '1.15rem', fontWeight: 700,
                }}
              >+</button>
            </div>
          </div>

          {cargandoCatalogo && (
            <div className="dum-x9" style={{ fontSize: '0.75rem', marginTop: '-12px' }}>Cargando catálogo de tipos de archivo…</div>
          )}

          {/* ✅ NUEVO: mini-formulario de alta en catalogo_tipo_archivo */}
          {mostrarNuevoTipo && (
            <div style={{ border: '1px dashed #D84315', borderRadius: '10px', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px', backgroundColor: 'rgba(216,67,21,0.05)' }}>
              <div style={{ color: '#f0f6fc', fontWeight: 600, fontSize: '0.9rem' }}>Nuevo tipo de archivo (se guarda en el catálogo)</div>
              <div style={filaStyle}>
                <label style={labelStyle}>Nombre</label>
                <input style={inputStyle} type="text" value={nuevoTipoNombre} onChange={(e) => setNuevoTipoNombre(e.target.value)} placeholder='Ej. "21. Carta Responsiva"' />
              </div>
              <div style={filaStyle}>
                <label style={labelStyle}>Módulo</label>
                <select style={inputStyle} value={nuevoTipoModulo} onChange={(e) => setNuevoTipoModulo(e.target.value)}>
                  {MODULOS_TIPO_ARCHIVO.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={filaStyle}>
                <label style={labelStyle}>Obligatorio</label>
                <div className="dum-x13">
                  <button type="button" onClick={() => setNuevoTipoObligatorio('No')} style={segBtn(nuevoTipoObligatorio === 'No', '#30363d')}>No</button>
                  <button type="button" onClick={() => setNuevoTipoObligatorio('Sí')} style={segBtn(nuevoTipoObligatorio === 'Sí', '#D84315')}>Sí</button>
                </div>
              </div>
              <div style={filaStyle}>
                <label style={labelStyle}>¿Vence?</label>
                <div className="dum-x13">
                  <button type="button" onClick={() => setNuevoTipoVence('No')} style={segBtn(nuevoTipoVence === 'No', '#30363d')}>No</button>
                  <button type="button" onClick={() => setNuevoTipoVence('Sí')} style={segBtn(nuevoTipoVence === 'Sí', '#D84315')}>Sí</button>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button type="button" className="btn btn-outline dum-x15" disabled={guardandoTipo} onClick={() => setMostrarNuevoTipo(false)}>Cancelar</button>
                <button
                  type="button"
                  onClick={handleGuardarNuevoTipo}
                  disabled={guardandoTipo}
                  style={{ padding: '10px 20px', borderRadius: '6px', border: 'none', backgroundColor: guardandoTipo ? '#21262d' : '#D84315', color: guardandoTipo ? '#6e7681' : '#fff', fontWeight: 'bold', cursor: guardandoTipo ? 'not-allowed' : 'pointer' }}
                >
                  {guardandoTipo ? 'Guardando…' : 'Guardar Tipo'}
                </button>
              </div>
            </div>
          )}

          <div style={filaStyle}>
            <label style={labelStyle}>Archivo</label>
            <label
              onDragOver={(e) => { e.preventDefault(); if (!arrastrando) setArrastrando(true); }}
              onDragLeave={(e) => { e.preventDefault(); setArrastrando(false); }}
              onDrop={(e) => { e.preventDefault(); setArrastrando(false); const f = e.dataTransfer?.files?.[0]; if (f) setArchivo(f); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', minHeight: '90px', padding: '16px', borderRadius: '8px', cursor: 'pointer', backgroundColor: arrastrando ? 'rgba(216,67,21,0.1)' : '#010409', border: arrastrando ? '1px dashed #D84315' : (archivo ? '1px solid rgba(63,185,80,0.5)' : '1px solid #30363d') }}
            >
              {archivo ? (
                <span className="dum-x10">✓ {archivo.name}</span>
              ) : (
                <>
                  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#8b949e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span className="dum-x11">Haz clic o arrastra un archivo aquí</span>
                </>
              )}
              <input className="dum-x12" type="file" accept=".pdf,image/*" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
            </label>
          </div>

          {/* ✅ REGLA NUEVA: el apartado de vencimiento se muestra SOLO si el
              catálogo marca Vence = "Sí" para el tipo seleccionado. */}
          {vence && (
            <>
              <div style={{ ...filaStyle, alignItems: 'center' }}>
                <label style={labelStyle}>Vencimiento</label>
                <span style={{ color: '#D84315', fontSize: '0.8rem', fontWeight: 600 }}>
                  Este tipo de documento vence (definido en el catálogo de Tipo de Archivo).
                </span>
              </div>
              <div style={filaStyle}>
                <label style={labelStyle}>Fecha de expedición</label>
                <input type="date" value={fechaExpedicion} onChange={(e) => setFechaExpedicion(e.target.value)} style={inputStyle} />
              </div>
              <div style={filaStyle}>
                <label style={labelStyle}>Fecha de vencimiento</label>
                <input type="date" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} style={inputStyle} />
              </div>
            </>
          )}

          <div style={{ ...filaStyle, alignItems: 'flex-start' }}>
            <label style={{ ...labelStyle, paddingTop: '8px' }}>Observaciones</label>
            <textarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} placeholder="Notas opcionales sobre el documento..." />
          </div>
        </div>

        <div className="dum-x14">
          <button type="button" onClick={onClose} disabled={subiendo} className="btn btn-outline dum-x15">Cancelar</button>
          <button type="button" onClick={handleSubir} disabled={subiendo} style={{ padding: '10px 24px', borderRadius: '6px', border: 'none', backgroundColor: subiendo ? '#21262d' : '#D84315', color: subiendo ? '#6e7681' : '#fff', fontWeight: 'bold', cursor: subiendo ? 'not-allowed' : 'pointer' }}>
            {subiendo ? 'Subiendo...' : 'Subir Documento'}
          </button>
        </div>
      </div>
    </div>
  );
};

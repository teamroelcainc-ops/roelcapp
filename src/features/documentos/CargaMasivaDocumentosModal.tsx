// src/features/documentos/CargaMasivaDocumentosModal.tsx
// ---------------------------------------------------------------------------
// ✅ V00144: CARGA MASIVA DE DOCUMENTOS por carpetas.
//   Seleccionas la carpeta raíz del registro (ej. "Adriana") con toda su
//   estructura ("1. Solicitud Empleo", "2. INE", …) y se sube todo de golpe:
//   · Cada subcarpeta = un tipo de documento (se quita el prefijo "N. ").
//   · Se cruza contra el catálogo `catalogo_tipo_archivo`: los tipos que NO
//     vencen se suben directo; los que SÍ vencen piden fechas aquí mismo.
//   · Si un tipo que vence se deja sin fecha, se AVISA pero se sube igual.
//   Mismo esquema que DocumentoUploadModal: un documento por (registro + tipo),
//   Storage en <coleccion>/<registro>/<tipo>/<tipo>.<ext> y doc en `documentos`.
// ---------------------------------------------------------------------------
import React, { useMemo, useState } from 'react';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../config/firebase';
import './CargaMasivaDocumentosModal.css';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  coleccionOrigen: string;   // 'empleados' | 'empresas' | 'unidades' | …
  registroId: string;
  registroNombre: string;
  onUploaded?: () => void;
}

const sanitizarRuta = (s: string) =>
  String(s || '').trim().replace(/[/\\:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();
const quitarPrefijoNum = (s: string) => sanitizarRuta(String(s).replace(/^\d+(\.\d+)*\.?\s*/, ''));
const normalizar = (s: string) => quitarPrefijoNum(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const esVenceSi = (v: any) => ['si', 'sí', 'true', 'yes', '1'].includes(String(v ?? '').trim().toLowerCase());

const MODULO_POR_COLECCION: Record<string, string[]> = {
  empleados: ['empleado'], empresas: ['empresa', 'cliente', 'proveedor'],
  unidades: ['unidad'], operaciones: ['operación', 'operacion'],
};

interface ItemCarga {
  tipoLabel: string;       // nombre de la subcarpeta ya limpio ("Solicitud Empleo")
  archivo: File;
  extras: number;          // archivos adicionales en la misma carpeta (se omiten)
  vence: boolean;          // según catálogo
  enCatalogo: boolean;
  fechaExpedicion: string;
  fechaVencimiento: string;
  estado: 'pendiente' | 'subiendo' | 'ok' | 'error';
}

export const CargaMasivaDocumentosModal: React.FC<Props> = ({ isOpen, onClose, coleccionOrigen, registroId, registroNombre, onUploaded }) => {
  const [items, setItems] = useState<ItemCarga[]>([]);
  const [analizando, setAnalizando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [progreso, setProgreso] = useState({ hechas: 0, total: 0 });

  const cerrar = () => { if (!subiendo) { setItems([]); onClose(); } };

  const analizarArchivos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAnalizando(true);
    try {
      // catálogo de tipos (para saber cuáles vencen)
      let catalogo: { nombre: string; vence: boolean; modulos: string[] }[] = [];
      try {
        const snap = await getDocs(collection(db, 'catalogo_tipo_archivo'));
        catalogo = snap.docs.map((d) => {
          const x: any = d.data();
          const mods = Array.isArray(x.modulo) ? x.modulo : String(x.modulo || '').split(',');
          return { nombre: String(x.nombre || ''), vence: esVenceSi(x.vence), modulos: mods.map((m: any) => normalizar(String(m))) };
        }).filter((t) => t.nombre);
      } catch { /* sin catálogo: todo se trata como no-vence */ }
      const modsColeccion = (MODULO_POR_COLECCION[coleccionOrigen] || []).map(normalizar);

      // agrupar: subcarpeta contenedora del archivo = tipo de documento
      const porCarpeta = new Map<string, File[]>();
      Array.from(files).forEach((f: any) => {
        const rel = String(f.webkitRelativePath || f.name);
        const partes = rel.split('/').filter(Boolean);
        if (/^\./.test(f.name)) return; // ocultos
        const carpeta = partes.length >= 2 ? partes[partes.length - 2] : (partes[0] || f.name);
        const clave = quitarPrefijoNum(carpeta) || sanitizarRuta(f.name);
        if (!porCarpeta.has(clave)) porCarpeta.set(clave, []);
        porCarpeta.get(clave)!.push(f);
      });

      const lista: ItemCarga[] = Array.from(porCarpeta.entries()).map(([tipoLabel, archivos]) => {
        const cat = catalogo.find((c) => {
          if (normalizar(c.nombre) !== normalizar(tipoLabel)) return false;
          if (!modsColeccion.length || !c.modulos.length) return true;
          return c.modulos.some((m) => modsColeccion.includes(m)) || c.modulos.includes('todos');
        }) || catalogo.find((c) => normalizar(c.nombre) === normalizar(tipoLabel));
        return {
          tipoLabel, archivo: archivos[0], extras: archivos.length - 1,
          vence: cat ? cat.vence : false, enCatalogo: !!cat,
          fechaExpedicion: '', fechaVencimiento: '', estado: 'pendiente' as const,
        };
      }).sort((a, b) => a.tipoLabel.localeCompare(b.tipoLabel, 'es'));
      setItems(lista);
    } finally { setAnalizando(false); }
  };

  const setFecha = (idx: number, campo: 'fechaExpedicion' | 'fechaVencimiento', valor: string) =>
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [campo]: valor } : it));

  const resumen = useMemo(() => ({
    total: items.length,
    conVenc: items.filter((i) => i.vence).length,
    sinFecha: items.filter((i) => i.vence && !i.fechaVencimiento).length,
  }), [items]);

  const subirTodo = async () => {
    if (!items.length || subiendo) return;
    const sinFecha = items.filter((i) => i.vence && !i.fechaVencimiento);
    if (sinFecha.length) {
      const ok = window.confirm(
        `⚠ Estos documentos VENCEN según el catálogo y no les colocaste fecha de vencimiento:\n\n· ${sinFecha.map((i) => i.tipoLabel).join('\n· ')}\n\n` +
        'Se subirán de todas formas (sin fecha), pero no podrán alertar su vencimiento hasta que la captures.\n\n¿Continuar con la carga?'
      );
      if (!ok) return;
    }
    setSubiendo(true);
    setProgreso({ hechas: 0, total: items.length });
    const carpeta = sanitizarRuta(registroNombre) || sanitizarRuta(registroId) || 'sin_nombre';
    let hechas = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      setItems((prev) => prev.map((x, k) => k === i ? { ...x, estado: 'subiendo' } : x));
      try {
        const punto = it.archivo.name.lastIndexOf('.');
        const extension = punto >= 0 ? it.archivo.name.slice(punto) : '';
        const subcarpeta = sanitizarRuta(it.tipoLabel);
        const nombreFinal = `${subcarpeta}${extension}`;
        const ruta = `${sanitizarRuta(coleccionOrigen)}/${carpeta}/${subcarpeta}/${nombreFinal}`;
        const r = storageRef(storage, ruta);
        await uploadBytes(r, it.archivo, it.archivo.type ? { contentType: it.archivo.type } : undefined);
        const url = await getDownloadURL(r);
        const docId = sanitizarRuta(`${coleccionOrigen}__${registroId}__${subcarpeta}`).replace(/\s+/g, '_');
        await setDoc(doc(db, 'documentos', docId), {
          coleccionOrigen, registroId, registroNombre: registroNombre || '',
          tipoDocumento: it.tipoLabel, carpeta, subcarpeta,
          nombreArchivo: nombreFinal, path: ruta, url,
          vence: it.vence,
          fechaExpedicion: it.vence ? it.fechaExpedicion : '',
          fechaVencimiento: it.vence ? it.fechaVencimiento : '',
          observaciones: '', createdAt: new Date().toISOString(),
        }, { merge: true });
        setItems((prev) => prev.map((x, k) => k === i ? { ...x, estado: 'ok' } : x));
      } catch (e) {
        console.error('Carga masiva — error en', it.tipoLabel, e);
        setItems((prev) => prev.map((x, k) => k === i ? { ...x, estado: 'error' } : x));
      }
      hechas++; setProgreso({ hechas, total: items.length });
    }
    setSubiendo(false);
    onUploaded?.();
    const errores = items.filter((i) => i.estado === 'error').length;
    alert(`Carga masiva terminada.\n\nSubidos: ${items.length - errores} de ${items.length}${errores ? `\nCon error: ${errores} (reintenta solo esos)` : ''}`);
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay cmd-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) cerrar(); }}>
      <div className="cmd-card">
        <div className="cmd-header">
          <h3 className="cmd-titulo">📁 Carga masiva de documentos · <span className="cmd-nombre">{registroNombre || registroId}</span></h3>
          <button type="button" className="cmd-cerrar" onClick={cerrar} disabled={subiendo}>✕</button>
        </div>
        <div className="cmd-cuerpo">
          <p className="cmd-instr">Selecciona la <b>carpeta raíz</b> del registro (la que contiene "1. Solicitud Empleo", "2. INE", …). Cada subcarpeta se sube como un tipo de documento; los tipos que <b>vencen</b> (según el catálogo) piden su fecha aquí mismo.</p>
          <label className="cmd-selector">
            {/* @ts-expect-error webkitdirectory no está en los tipos de React */}
            <input type="file" webkitdirectory="true" directory="true" multiple disabled={subiendo || analizando} onChange={(e) => analizarArchivos(e.target.files)} />
            <span className="cmd-selector-btn">{analizando ? '⏳ Analizando…' : '📂 Elegir carpeta del colaborador'}</span>
          </label>

          {items.length > 0 && (
            <>
              <div className="cmd-resumen">
                {resumen.total} documento(s) · {resumen.conVenc} con vencimiento{resumen.sinFecha ? <span className="cmd-warn"> · ⚠ {resumen.sinFecha} sin fecha</span> : null}
              </div>
              <div className="cmd-tabla-wrap">
                <table className="cmd-tabla">
                  <thead><tr><th>Documento</th><th>Archivo</th><th>Expedición</th><th>Vencimiento</th><th></th></tr></thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.tipoLabel} className={`cmd-fila-${it.estado}`}>
                        <td className="cmd-tipo">{it.tipoLabel}{!it.enCatalogo && <span className="cmd-nuevo" title="No está en el catálogo de tipos; se sube como no-vence">nuevo</span>}{it.extras > 0 && <span className="cmd-extra" title="Solo se sube el primer archivo de la carpeta">+{it.extras} omitido(s)</span>}</td>
                        <td className="cmd-arch">{it.archivo.name}</td>
                        <td>{it.vence ? <input type="date" className="cmd-fecha" value={it.fechaExpedicion} disabled={subiendo} onChange={(e) => setFecha(i, 'fechaExpedicion', e.target.value)} /> : <span className="cmd-na">No vence</span>}</td>
                        <td>{it.vence ? <input type="date" className={`cmd-fecha${!it.fechaVencimiento ? ' cmd-fecha-falta' : ''}`} value={it.fechaVencimiento} disabled={subiendo} onChange={(e) => setFecha(i, 'fechaVencimiento', e.target.value)} /> : <span className="cmd-na">—</span>}</td>
                        <td className="cmd-estado">{it.estado === 'ok' ? '✅' : it.estado === 'error' ? '❌' : it.estado === 'subiendo' ? '⏳' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cmd-acciones">
                {subiendo && <span className="cmd-progreso">Subiendo… {progreso.hechas}/{progreso.total}</span>}
                <button type="button" className="btn btn-outline" onClick={cerrar} disabled={subiendo}>Cancelar</button>
                <button type="button" className="btn btn-primary" onClick={subirTodo} disabled={subiendo || items.length === 0}>{subiendo ? '⏳ Subiendo…' : `⬆ Subir todo (${items.length})`}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

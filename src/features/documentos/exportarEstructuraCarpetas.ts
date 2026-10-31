// src/features/documentos/exportarEstructuraCarpetas.ts
// ---------------------------------------------------------------------------
// ✅ V00172: EXPORTAR ESTRUCTURA DE CARPETAS (zip) por módulo/categoría.
//   Genera un .zip con la carpeta raíz del registro y una subcarpeta VACÍA y
//   numerada por cada tipo de documento del catálogo `catalogo_tipo_archivo`
//   que aplique a esa categoría (cliente, proveedor, empresa, empleado,
//   unidad…). Es el espejo exacto de la Carga Masiva: llenas las carpetas en
//   tu PC y luego subes la carpeta completa con el botón 📁.
// ---------------------------------------------------------------------------
import { cargarJSZip } from '../../shared/utils/zip'; // ✅ V00534: jszip se carga al exportar
import { estadoCatalogo, obtenerCatalogo } from '../../shared/data/catalogos';

const sanitizar = (s: string) => String(s || '').trim().replace(/[/\\:*?"<>|#]+/g, '').replace(/\s+/g, ' ').trim();
const normalizar = (s: string) => sanitizar(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Descarga un zip con las carpetas vacías de los tipos de documento que aplican. */
export const exportarEstructuraCarpetas = async (p: {
  registroNombre: string;
  /** categorías del catálogo que aplican (ej. ['cliente','empresa'] o ['empleado']) */
  modulos: string[];
}): Promise<number> => {
  // ✅ V00439 (Fase 3.x): del listener compartido de catálogos (antes getDocs propio).
  const docsTipos = await obtenerCatalogo('catalogo_tipo_archivo');
  const errorTipos = estadoCatalogo('catalogo_tipo_archivo').error;
  if (docsTipos.length === 0 && errorTipos) throw new Error(errorTipos);
  const modsBuscados = p.modulos.map(normalizar);
  const tipos = docsTipos
    .map((x) => {
      const mods = (Array.isArray(x.modulo) ? x.modulo : String(x.modulo || '').split(','))
        .map((m: unknown) => normalizar(String(m)));
      return { nombre: sanitizar(String(x.nombre || '')), mods, orden: Number(x.orden) || 9999 };
    })
    .filter((t) => t.nombre && (t.mods.includes('todos') || t.mods.some((m: string) => modsBuscados.some((b) => m.includes(b) || b.includes(m)))))
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es'));

  if (tipos.length === 0) throw new Error('El catálogo de Tipos de Archivo no tiene tipos para esta categoría.');

  const JSZip = await cargarJSZip();
  const zip = new JSZip();
  const raiz = sanitizar(p.registroNombre) || 'Registro';
  tipos.forEach((t, i) => {
    // Carpeta vacía numerada, igual a como las organizas: "1. Solicitud Empleo/"
    zip.folder(`${raiz}/${i + 1}. ${t.nombre}`);
  });
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Carpetas ${raiz}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return tipos.length;
};

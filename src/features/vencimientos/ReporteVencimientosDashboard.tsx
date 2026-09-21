// src/features/vencimientos/ReporteVencimientosDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00154: REPORTE DE VENCIMIENTO — documentos de empleados, empresas y
//   unidades con fecha de vencimiento.
//   · Pestaña 1 "Vencidos y por vencer": primero los VENCIDOS (rojo) y después
//     los POR VENCER (ámbar), ordenados por proximidad de la fecha.
//   · Pestaña 2 "Sin fechas": todos los documentos sin fecha de emisión o de
//     vencimiento, con edición de fechas DIRECTO en la tabla (guardado al
//     instante en Firestore).
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, getDocs, onSnapshot, updateDoc } from 'firebase/firestore';
import { obtenerUsuarioAut, cargarConfigModulo, evaluarAutorizacion, crearSolicitudAutorizacion } from '../autorizaciones/autorizaciones'; // ✅ V00325
import type { ConfigModuloAut } from '../autorizaciones/autorizaciones'; // ✅ V00325
import * as XLSX from 'xlsx';
import { db } from '../../config/firebase';
import { EditorEncabezados } from '../../components/EditorEncabezados';
import { useEtiquetas } from '../../contexts/EtiquetasContext';
import './ReporteVencimientosDashboard.css';

interface DocVenc {
  id: string;
  coleccionOrigen: string;
  registroId: string;
  registroNombre: string;
  tipoDocumento: string;
  nombreArchivo: string;
  url?: string;
  vence: boolean;
  fechaExpedicion: string;
  fechaVencimiento: string;
  dias: number | null; // días para vencer (negativo = vencido); null si no hay fecha
  porClasificar?: boolean;
}

const ETQ_ORIGEN: Record<string, string> = {
  empleados: 'Empleado', empresas: 'Empresa', unidades: 'Unidad',
  operaciones: 'Operación', bodegas: 'Bodega',
};
const fmtFecha = (iso?: string) => {
  if (!iso) return '—';
  const [y, m, d] = String(iso).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
};

export const ReporteVencimientosDashboard = () => {
  const { etq } = useEtiquetas();
  const [docs, setDocs] = useState<DocVenc[]>([]);
  const [cargando, setCargando] = useState(true);
  const [pestana, setPestana] = useState<'vencimientos' | 'sinFechas' | 'sinClasificar'>('vencimientos');
  // ✅ V00179: DOCUMENTOS SIN CLASIFICAR — catálogo de tipos para reubicarlos aquí mismo.
  const [tiposCatalogo, setTiposCatalogo] = useState<{ nombre: string; vence: boolean; modulos: string[] }[]>([]);
  const [reubicandoId, setReubicandoId] = useState('');
  useEffect(() => {
    getDocs(collection(db, 'catalogo_tipo_archivo')).then((snap) => {
      const esSi = (v: any) => v === true || /^(s|y|1|true)/i.test(String(v ?? ''));
      const nrm = (t: any) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      setTiposCatalogo(snap.docs.map((d) => {
        const x: any = d.data();
        const mods = (Array.isArray(x.modulo) ? x.modulo : String(x.modulo || '').split(',')).map((m: any) => nrm(m)).filter(Boolean);
        return { nombre: String(x.nombre || '').trim(), vence: esSi(x.vence), modulos: mods };
      }).filter((t) => t.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
    }).catch(() => setTiposCatalogo([]));
  }, []);
  // tipos que aplican según la colección de origen del documento
  const tiposParaDoc = (d: DocVenc) => {
    const col = String(d.coleccionOrigen || '').toLowerCase();
    const buscados = col.startsWith('emple') ? ['empleado']
      : col.startsWith('empre') ? ['cliente', 'proveedor', 'bodega', 'empresa']
      : col.startsWith('unidad') ? ['unidad'] : [];
    if (!buscados.length) return tiposCatalogo;
    const aplica = tiposCatalogo.filter((t) => !t.modulos.length || t.modulos.includes('todos') || t.modulos.some((m) => buscados.some((b) => m.includes(b) || b.includes(m))));
    return aplica.length ? aplica : tiposCatalogo;
  };
  const reubicarDoc = async (d: DocVenc, tipoNombre: string) => {
    const cat = tiposCatalogo.find((t) => t.nombre === tipoNombre);
    if (!cat || reubicandoId) return;
    setReubicandoId(d.id);
    try {
      await guardarConAutorizacion(d, { tipoDocumento: cat.nombre, subcarpeta: cat.nombre, vence: cat.vence }, { porClasificar: false }); // ✅ V00325
    } catch (e: any) { alert(`No se pudo reubicar: ${e?.message || e}`); }
    finally { setReubicandoId(''); }
  };
  const [filtroOrigen, setFiltroOrigen] = useState<string>('todos');
  // ✅ V00325: AUTORIZACIONES — no todos pueden cambiar documentos o fechas.
  //   Las reglas (por rol y por campo) se configuran en el módulo de
  //   Autorizaciones (módulo "Reporte de Vencimiento").
  const [autUsuario, setAutUsuario] = useState<{ uid: string; nombre: string; roles: string[]; esAdmin: boolean } | null>(null);
  const [autConfig, setAutConfig] = useState<ConfigModuloAut | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const [u, c] = await Promise.all([obtenerUsuarioAut(), cargarConfigModulo('reporteVencimientos')]);
        setAutUsuario(u); setAutConfig(c);
      } catch (e) { console.error('Autorizaciones del reporte:', e); }
    })();
  }, []);
  const ETIQUETAS_RV: Record<string, string> = {
    tipoDocumento: 'Tipo de documento', subcarpeta: 'Carpeta / clasificación',
    fechaExpedicion: 'Fecha de expedición', fechaVencimiento: 'Fecha de vencimiento',
    vence: 'Control de vencimiento (sí/no)',
  };
  /** Escribe directo si el usuario puede; si no, crea la SOLICITUD en
   *  Autorizaciones y el cambio se aplica cuando lo aprueben. */
  const guardarConAutorizacion = async (d: Pick<DocVenc, 'id'> & Partial<DocVenc>, cambios: Record<string, unknown>, extraSinControl: Record<string, unknown> = {}): Promise<boolean> => {
    const u = autUsuario;
    const ev = evaluarAutorizacion(autConfig, 'editar', u || { roles: [], esAdmin: false }, Object.keys(cambios), ETIQUETAS_RV);
    if (!u || !ev.requiere) {
      await updateDoc(doc(db, 'documentos', d.id), { ...cambios, ...extraSinControl });
      return true;
    }
    const anteriores: Record<string, unknown> = {};
    Object.keys(cambios).forEach((k) => { anteriores[k] = (d as unknown as Record<string, unknown>)[k] ?? ''; });
    await crearSolicitudAutorizacion({
      modulo: 'reporteVencimientos', moduloLabel: 'Reporte de Vencimiento', accion: 'editar',
      coleccion: 'documentos', docId: d.id,
      referencia: `${d.registroNombre || ''} · ${d.tipoDocumento || d.nombreArchivo || 'documento'}`.trim(),
      camposAfectados: Object.keys(cambios), datosPropuestos: { ...cambios, ...extraSinControl }, datosAnteriores: anteriores,
      motivosControl: ev.motivos,
      solicitanteUid: u.uid, solicitanteNombre: u.nombre, solicitanteRoles: u.roles,
      tipo: 'accion', estrategiaCrear: 'directa',
    });
    alert(`Este cambio requiere AUTORIZACIÓN y se envió como solicitud:\n\n${ev.motivos.join('\n')}\n\nSe aplicará cuando lo aprueben en el módulo de Autorizaciones.`);
    return false;
  };
  // ✅ V00292: FILTRO DE DÍAS — de inicio SOLO vencidos y ≤45 días.
  const [filtroDias, setFiltroDias] = useState<'45' | '60' | 'mas60' | 'todos'>('45');
  const [busqueda, setBusqueda] = useState('');
  const [soloQueVencen, setSoloQueVencen] = useState(true); // pestaña 2
  const [guardandoId, setGuardandoId] = useState('');
  // ✅ V00155: nombres reales de los registros — muchos documentos guardan solo
  //   el ID (registroNombre vacío o con pinta de id); se resuelven contra
  //   empleados / empresas / unidades.
  const [nombres, setNombres] = useState<Record<string, Record<string, string>>>({});
  // ✅ V00189: dueños DE BAJA/INACTIVOS — sus documentos NO aparecen en el
  //   reporte ni cuentan como vencidos (ids por colección).
  const [bajas, setBajas] = useState<Record<string, Set<string>>>({ empleados: new Set(), empresas: new Set(), unidades: new Set() });
  useEffect(() => {
    (async () => {
      const out: Record<string, Record<string, string>> = { empleados: {}, empresas: {}, unidades: {} };
      const bj: Record<string, Set<string>> = { empleados: new Set(), empresas: new Set(), unidades: new Set() };
      try {
        const [se, sm, su] = await Promise.all([
          getDocs(collection(db, 'empleados')),
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'unidades')),
        ]);
        se.docs.forEach((d) => { const x: any = d.data(); if (x.activo === false || /^(baja|inactiv)/i.test(String(x.status || ''))) bj.empleados.add(d.id); out.empleados[d.id] = (`${x.firstName || x.nombres || ''} ${x.lastNamePaternal || x.apellidoPaterno || ''} ${x.lastNameMaternal || x.apellidoMaterno || ''}`.replace(/\s+/g, ' ').trim()) || String(x.nombre || x.nombreCompleto || x.employeeId || d.id); });
        sm.docs.forEach((d) => { const x: any = d.data(); if (/^(baja|inactiv)/i.test(String(x.status || ''))) bj.empresas.add(d.id); out.empresas[d.id] = String(x.nombre || x.empresa || d.id); });
        su.docs.forEach((d) => { const x: any = d.data(); if ((x.activa ?? x.activo) === false || /^(baja|inactiv)/i.test(String(x.status || ''))) bj.unidades.add(d.id); out.unidades[d.id] = String(x.unidad || x.placas || x.nombre || d.id); });
      } catch (e) { console.error('[Reporte Vencimiento] nombres:', e); }
      setNombres(out); setBajas(bj);
    })();
  }, []);
  const pareceId = (t: string) => /^[0-9a-f]{8,}$/i.test(String(t || '').trim());
  // ✅ V00189: ¿el dueño del documento está de baja? (id exacto o por prefijo)
  const duenioDeBaja = (d: DocVenc): boolean => {
    const col = String(d.coleccionOrigen || '').toLowerCase();
    const colKey = col.startsWith('emple') ? 'empleados' : col.startsWith('empre') ? 'empresas' : col.startsWith('unidad') ? 'unidades' : '';
    if (!colKey) return false;
    const set = bajas[colKey];
    if (!set || set.size === 0) return false;
    const delDocId = (() => { const partes = String(d.id || '').split('__'); return partes.length >= 3 ? partes[1] : ''; })();
    const candidatos = [d.registroId, delDocId].map((c) => String(c || '').trim()).filter(Boolean);
    for (const c of candidatos) {
      if (set.has(c)) return true;
      if (c.length >= 6) { for (const id of set) { if (id.startsWith(c) || c.startsWith(id)) return true; } }
    }
    return false;
  };
  // ✅ V00158: resolución ROBUSTA del nombre — muchos documentos migrados guardan
  //   el id recortado o solo en el docId (empleados__<id>__<tipo>); se prueba
  //   coincidencia exacta y por prefijo contra la colección correspondiente.
  const nombreRegistro = (d: DocVenc): string => {
    const col = String(d.coleccionOrigen || '').toLowerCase();
    const colKey = col.startsWith('emple') ? 'empleados' : col.startsWith('empre') ? 'empresas' : col.startsWith('unidad') ? 'unidades' : col;
    const mapa = nombres[colKey] || {};
    const delDocId = (() => {
      const partes = String(d.id || '').split('__');
      return partes.length >= 3 ? partes[1] : '';
    })();
    const candidatos = [d.registroId, delDocId, pareceId(d.registroNombre) ? d.registroNombre : '']
      .map((c) => String(c || '').trim()).filter(Boolean);
    for (const c of candidatos) {
      if (mapa[c] && !pareceId(mapa[c])) return mapa[c]; // exacto (y con nombre real)
    }
    // por prefijo (ids recortados en la migración): el candidato es prefijo del id
    // real, o el id real es prefijo del candidato.
    for (const c of candidatos) {
      if (c.length < 6) continue;
      const k = Object.keys(mapa).find((id) => id.startsWith(c) || c.startsWith(id));
      if (k && !pareceId(mapa[k])) return mapa[k];
    }
    if (d.registroNombre && !pareceId(d.registroNombre)) return d.registroNombre;
    return d.registroNombre || d.registroId || '—';
  };

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'documentos'), (snap) => {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const lista: DocVenc[] = snap.docs.map((d) => {
        const x: any = d.data();
        let dias: number | null = null;
        if (x.fechaVencimiento) {
          const v = new Date(String(x.fechaVencimiento) + 'T00:00:00');
          if (!isNaN(v.getTime())) dias = Math.floor((v.getTime() - hoy.getTime()) / 86400000);
        }
        return {
          id: d.id,
          coleccionOrigen: String(x.coleccionOrigen || ''),
          porClasificar: x.porClasificar === true || String(x.tipoDocumento || '').trim() === 'Por clasificar',
          registroId: String(x.registroId || ''),
          registroNombre: String(x.registroNombre || x.carpeta || x.registroId || '—'),
          tipoDocumento: String(x.tipoDocumento || x.subcarpeta || x.nombreArchivo || 'Documento'),
          nombreArchivo: String(x.nombreArchivo || ''),
          url: x.url,
          vence: !!x.vence,
          fechaExpedicion: String(x.fechaExpedicion || ''),
          fechaVencimiento: String(x.fechaVencimiento || ''),
          dias,
        };
      });
      setDocs(lista);
      setCargando(false);
    }, () => setCargando(false));
    return () => unsub();
  }, []);

  const coincide = (d: DocVenc) => {
    if (filtroOrigen !== 'todos' && d.coleccionOrigen !== filtroOrigen) return false;
    const q = busqueda.trim().toLowerCase();
    if (!q) return true;
    return `${nombreRegistro(d)} ${d.registroNombre} ${d.tipoDocumento} ${ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen}`.toLowerCase().includes(q);
  };

  // Pestaña 1: vencidos primero, luego por vencer, por proximidad.
  // ✅ V00189: universo visible del reporte — sin documentos de dueños de baja.
  const docsVisibles = useMemo(() => docs.filter((d) => !duenioDeBaja(d)), [docs, bajas]);

  const filasVencimientos = useMemo(() => {
    const conFecha = docsVisibles.filter((d) => d.vence && d.dias !== null && coincide(d));
    let vencidos = conFecha.filter((d) => (d.dias as number) < 0).sort((a, b) => (a.dias! - b.dias!)); // más vencido primero
    let porVencer = conFecha.filter((d) => (d.dias as number) >= 0).sort((a, b) => (a.dias! - b.dias!)); // más próximo primero
    // ✅ V00292: de inicio solo lo urgente (vencidos y ≤45 días); el select amplía.
    if (filtroDias === '45') porVencer = porVencer.filter((d) => (d.dias as number) <= 45);
    else if (filtroDias === '60') porVencer = porVencer.filter((d) => (d.dias as number) <= 60);
    else if (filtroDias === 'mas60') { porVencer = porVencer.filter((d) => (d.dias as number) > 60); vencidos = []; }
    return { vencidos, porVencer, todas: [...vencidos, ...porVencer] };
  }, [docs, filtroOrigen, busqueda, filtroDias, bajas]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pestaña 2: sin fecha de emisión o vencimiento (editable en la tabla).
  const filasSinFechas = useMemo(() =>
    docsVisibles.filter((d) => coincide(d) && (soloQueVencen ? d.vence : true) && (!d.fechaVencimiento || !d.fechaExpedicion))
      .sort((a, b) => Number(b.vence) - Number(a.vence) || nombreRegistro(a).localeCompare(nombreRegistro(b), 'es') || a.tipoDocumento.localeCompare(b.tipoDocumento, 'es')),
  [docs, filtroOrigen, busqueda, soloQueVencen]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardarCampo = async (d: DocVenc, campo: 'fechaExpedicion' | 'fechaVencimiento' | 'vence', valor: string | boolean) => {
    setGuardandoId(d.id);
    try { await guardarConAutorizacion(d, { [campo]: valor }); } // ✅ V00325
    catch (e: any) { alert(`No se pudo guardar: ${e?.message || e}`); }
    finally { setGuardandoId(''); }
  };

  // ✅ V00292: el TIPO también se edita en la tabla y guarda EN SU TABLA
  //   (documentos), con la relación del catálogo (subcarpeta y vence).
  const guardarTipo = async (d: DocVenc, tipoNombre: string) => {
    const cat = tiposCatalogo.find((t) => t.nombre === tipoNombre);
    if (!cat) return;
    setGuardandoId(d.id);
    try { await guardarConAutorizacion(d, { tipoDocumento: cat.nombre, subcarpeta: cat.nombre, vence: cat.vence }, { porClasificar: false }); } // ✅ V00325
    catch (e) { alert(`No se pudo guardar el tipo: ${(e as { message?: string })?.message || e}`); }
    finally { setGuardandoId(''); }
  };

  // ✅ V00292: EDITOR del registro (botón ✏ en las tres pestañas) — guarda todo
  //   junto en la colección `documentos` respetando la relación del catálogo.
  const [docEditor, setDocEditor] = useState<{ id: string; tipoDocumento: string; vence: boolean; fechaExpedicion: string; fechaVencimiento: string } | null>(null);
  const [guardandoEditor, setGuardandoEditor] = useState(false);
  const abrirEditorDoc = (d: DocVenc) => setDocEditor({ id: d.id, tipoDocumento: d.tipoDocumento, vence: d.vence, fechaExpedicion: d.fechaExpedicion, fechaVencimiento: d.fechaVencimiento });
  const guardarEditorDoc = async () => {
    if (!docEditor || guardandoEditor) return;
    setGuardandoEditor(true);
    try {
      const cat = tiposCatalogo.find((t) => t.nombre === docEditor.tipoDocumento);
      await guardarConAutorizacion(docEditor, {
        ...(cat ? { tipoDocumento: cat.nombre, subcarpeta: cat.nombre } : {}),
        vence: docEditor.vence,
        fechaExpedicion: docEditor.fechaExpedicion,
        fechaVencimiento: docEditor.vence ? docEditor.fechaVencimiento : '',
      }, cat ? { porClasificar: false } : {}); // ✅ V00325
      setDocEditor(null);
    } catch (e) { alert(`No se pudo guardar: ${(e as { message?: string })?.message || e}`); }
    setGuardandoEditor(false);
  };

  // ✅ V00292: alta rápida de TIPOS DE ARCHIVO al catálogo (botón + como el de
  //   Cliente Mercancía) — queda guardado en catalogo_tipo_archivo para todos.
  const agregarTipoRapido = async (): Promise<string> => {
    const nombre = String(window.prompt('Nombre del nuevo TIPO DE ARCHIVO (se guarda en el catálogo catalogo_tipo_archivo):') || '').trim();
    if (!nombre) return '';
    const vence = window.confirm('¿Este tipo de documento VENCE (controla fecha de vencimiento)?\n\nAceptar = Sí vence · Cancelar = No vence');
    try {
      await addDoc(collection(db, 'catalogo_tipo_archivo'), { nombre, vence, modulo: ['todos'], creadoDesde: 'reporte_vencimientos', createdAt: new Date().toISOString() });
      setTiposCatalogo((prev) => [...prev, { nombre, vence, modulos: ['todos'] }].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
      return nombre;
    } catch (e) { alert(`No se pudo guardar el tipo: ${(e as { message?: string })?.message || e}`); return ''; }
  };


  const exportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const filas = filasVencimientos.todas.map((d) => [
      ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen, nombreRegistro(d), d.tipoDocumento,
      fmtFecha(d.fechaExpedicion), fmtFecha(d.fechaVencimiento),
      (d.dias as number) < 0 ? `VENCIDO hace ${Math.abs(d.dias as number)} día(s)` : `Vence en ${d.dias} día(s)`,
    ]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['TIPO', 'USUARIO DEL DOCUMENTO', 'DOCUMENTO', 'EXPEDICIÓN', 'VENCIMIENTO', 'ESTADO'], ...filas]), 'Vencimientos');
    XLSX.writeFile(wb, 'Reporte_Vencimientos.xlsx');
  };

  const chipEstado = (d: DocVenc) => {
    const dias = d.dias as number;
    if (dias < 0) return <span className="rv-chip rv-rojo">Vencido hace {Math.abs(dias)} día(s)</span>;
    if (dias === 0) return <span className="rv-chip rv-ambar">Vence HOY</span>;
    return <span className="rv-chip rv-ambar">Vence en {dias} día(s)</span>;
  };

  return (
    <div className="dashboard-container rv-contenedor">
      <div className="rv-encabezado">
        <div>
          <h2 className="rv-titulo">{etq('rv.titulo', 'Reporte de Vencimiento')}</h2>
          <p className="rv-sub">Documentos de empleados, empresas y unidades con control de vencimiento.{autConfig && !autUsuario?.esAdmin && <span className="rv-chip-aut" title="Cambiar el tipo de documento o las fechas puede requerir aprobación — las reglas viven en el módulo de Autorizaciones (Reporte de Vencimiento)"> 🔒 Ediciones controladas por Autorizaciones</span>}</p>
        </div>
        <div className="rv-encabezado-der">
          <EditorEncabezados titulo="Reporte de Vencimiento" claves={[
            { clave: 'rv.titulo', porDefecto: 'Reporte de Vencimiento', ayuda: 'Título del módulo' },
            { clave: 'rv.tab_vencidos', porDefecto: 'Vencidos y por vencer', ayuda: 'Pestaña 1' },
            { clave: 'rv.tab_sin_fechas', porDefecto: 'Sin fechas de emisión o vencimiento', ayuda: 'Pestaña 2' },
            { clave: 'rv.tab_sin_clasificar', porDefecto: 'Documentos sin clasificar', ayuda: 'Pestaña 3' },
            { clave: 'rv.col_usuario', porDefecto: 'Usuario del documento', ayuda: 'Columna del poseedor' },
          ]} />
          <button className="btn btn-outline rv-btn-excel" onClick={exportarExcel} disabled={filasVencimientos.todas.length === 0}>⬇ Excel</button>
        </div>
      </div>

      <div className="rv-tabs">
        <button className={`rv-tab${pestana === 'vencimientos' ? ' activa' : ''}`} onClick={() => setPestana('vencimientos')}>
          {etq('rv.tab_vencidos', 'Vencidos y por vencer')}
          {filasVencimientos.vencidos.length > 0 && <span className="rv-badge rv-rojo">{filasVencimientos.vencidos.length}</span>}
          {filasVencimientos.porVencer.length > 0 && <span className="rv-badge rv-ambar">{filasVencimientos.porVencer.length}</span>}
        </button>
        <button className={`rv-tab${pestana === 'sinFechas' ? ' activa' : ''}`} onClick={() => setPestana('sinFechas')}>
          {etq('rv.tab_sin_fechas', 'Sin fechas de emisión o vencimiento')}
          {filasSinFechas.length > 0 && <span className="rv-badge rv-gris">{filasSinFechas.length}</span>}
        </button>
        {/* ✅ V00179: pestaña 3 — documentos pendientes de clasificar */}
        <button className={`rv-tab${pestana === 'sinClasificar' ? ' activa' : ''}`} onClick={() => setPestana('sinClasificar')}>
          {etq('rv.tab_sin_clasificar', 'Documentos sin clasificar')}
          <span className="rv-chip rv-chip-clasificar">{docsVisibles.filter((d) => d.porClasificar).length}</span>
        </button>
      </div>

      <div className="rv-filtros">
        <input className="form-control rv-buscar" type="text" placeholder="Buscar por usuario o documento…" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        {pestana === 'vencimientos' && (
          <select className="form-control rv-select" value={filtroDias} onChange={(e) => setFiltroDias(e.target.value as typeof filtroDias)} title="Rango de días por vencer (los vencidos siempre se muestran, salvo en 'Más de 60')">{/* ✅ V00292 */}
            <option value="45">Vence en 45 días o menos</option>
            <option value="60">Vence en 60 días o menos</option>
            <option value="mas60">Más de 60 días</option>
            <option value="todos">Todos</option>
          </select>
        )}
        <select className="form-control rv-select" value={filtroOrigen} onChange={(e) => setFiltroOrigen(e.target.value)}>
          <option value="todos">Todos (empleados, empresas, unidades)</option>
          <option value="empleados">Empleados</option>
          <option value="empresas">Empresas</option>
          <option value="unidades">Unidades</option>
        </select>
        {pestana === 'sinFechas' && (
          <label className="rv-check">
            <input type="checkbox" checked={soloQueVencen} onChange={(e) => setSoloQueVencen(e.target.checked)} />
            <span>Solo documentos que vencen</span>
          </label>
        )}
      </div>

      {cargando ? <p className="rv-cargando">⏳ Cargando documentos…</p> : (
        <div className="rv-tabla-wrap">
          {pestana === 'sinClasificar' ? (
            <table className="rv-tabla">
              <thead><tr><th>Tipo</th><th>{etq('rv.col_usuario', 'Usuario del documento')}</th><th>Archivo</th><th>Reubicar en la carpeta…</th><th></th></tr></thead>
              <tbody>
                {docsVisibles.filter((d) => d.porClasificar && (filtroOrigen === 'todos' || d.coleccionOrigen === filtroOrigen)).length === 0 ? (
                  <tr><td colSpan={5} className="rv-vacio">No hay documentos pendientes de clasificar. 🎉</td></tr>
                ) : docsVisibles.filter((d) => d.porClasificar && (filtroOrigen === 'todos' || d.coleccionOrigen === filtroOrigen)).map((d) => (
                  <tr key={d.id}>
                    <td>{ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen || '—'}</td>
                    <td className="rv-registro">{nombreRegistro(d)}</td>
                    <td>{d.nombreArchivo || d.tipoDocumento}</td>
                    <td>
                      {/* ✅ V00179: elegir el tipo lo REUBICA al instante en la carpeta
                          correcta de ese cliente/proveedor/colaborador/unidad */}
                      <div className="rv-reubicar-linea">{/* ✅ V00292: búsqueda + alta rápida al catálogo */}
                        <input type="text" className="form-control rv-input-reubicar" list={`rvTipos_${d.id}`} placeholder={reubicandoId === d.id ? '⏳ Reubicando…' : 'Buscar carpeta/tipo…'} disabled={reubicandoId === d.id} defaultValue=""
                          onChange={(e) => { const t = tiposParaDoc(d).find((x) => x.nombre === e.target.value); if (t) { reubicarDoc(d, t.nombre); e.target.value = ''; } }} />
                        <datalist id={`rvTipos_${d.id}`}>
                          {tiposParaDoc(d).map((t) => <option key={t.nombre} value={t.nombre}>{t.vence ? 'vence' : ''}</option>)}
                        </datalist>
                        <button type="button" className="rv-btn-mas-tipo" title="Agregar un tipo de archivo nuevo al catálogo y reubicar aquí" disabled={reubicandoId === d.id}
                          onClick={async () => { const nombre = await agregarTipoRapido(); if (nombre) reubicarDoc(d, nombre); }}>+</button>
                      </div>
                    </td>
                    <td className="rv-celda-ver"><button type="button" className="rv-btn-editar" title="Editar este registro (tipo, vence y fechas)" onClick={() => abrirEditorDoc(d)}>✎</button>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">Ver</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : pestana === 'vencimientos' ? (

            <table className="rv-tabla">
              <thead><tr><th>Tipo</th><th>{etq('rv.col_usuario', 'Usuario del documento')}</th><th>Documento</th><th>Expedición</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead>
              <tbody>
                {filasVencimientos.todas.length === 0 && <tr><td colSpan={7} className="rv-vacio">Sin documentos vencidos ni por vencer con los filtros actuales. ✅</td></tr>}
                {filasVencimientos.todas.map((d) => (
                  <tr key={d.id} className={`${(d.dias as number) < 0 ? 'rv-fila-vencido' : 'rv-fila-porvencer'}${guardandoId === d.id ? ' rv-fila-guardando' : ''}`}>
                    <td>{ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen || '—'}</td>
                    <td className="rv-registro">{nombreRegistro(d)}</td>
                    {/* ✅ V00292: tipo y vencimiento editables EN LA TABLA — guardan en `documentos` con la relación del catálogo */}
                    <td className="rv-doc">
                      <select className="rv-select-tipo" value={tiposCatalogo.some((t) => t.nombre === d.tipoDocumento) ? d.tipoDocumento : ''} onChange={(e) => { if (e.target.value) guardarTipo(d, e.target.value); }}>
                        {!tiposCatalogo.some((t) => t.nombre === d.tipoDocumento) && <option value="">{d.tipoDocumento}</option>}
                        {tiposParaDoc(d).map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre}</option>)}
                      </select>
                    </td>
                    <td className="rv-fecha"><input type="date" className="rv-input-fecha" value={d.fechaExpedicion} onChange={(e) => guardarCampo(d, 'fechaExpedicion', e.target.value)} /></td>
                    <td className="rv-fecha"><input type="date" className="rv-input-fecha" value={d.fechaVencimiento} onChange={(e) => guardarCampo(d, 'fechaVencimiento', e.target.value)} /></td>
                    <td>{chipEstado(d)}</td>
                    <td className="rv-celda-ver">
                      <button type="button" className="rv-btn-editar" title="Editar este registro (tipo, vence y fechas)" onClick={() => abrirEditorDoc(d)}>✎</button>
                      {d.url && <a className="rv-ver" href={d.url} target="_blank" rel="noopener noreferrer">Ver</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="rv-tabla">
              <thead><tr><th>Tipo</th><th>{etq('rv.col_usuario', 'Usuario del documento')}</th><th>Documento</th><th>Vence</th><th>Expedición</th><th>Vencimiento</th><th></th></tr></thead>
              <tbody>
                {filasSinFechas.length === 0 && <tr><td colSpan={7} className="rv-vacio">Todos los documentos tienen sus fechas completas. ✅</td></tr>}
                {filasSinFechas.map((d) => (
                  <tr key={d.id} className={guardandoId === d.id ? 'rv-fila-guardando' : ''}>
                    <td>{ETQ_ORIGEN[d.coleccionOrigen] || d.coleccionOrigen || '—'}</td>
                    <td className="rv-registro">{nombreRegistro(d)}</td>
                    <td className="rv-doc">
                      <select className="rv-select-tipo" value={tiposCatalogo.some((t) => t.nombre === d.tipoDocumento) ? d.tipoDocumento : ''} onChange={(e) => { if (e.target.value) guardarTipo(d, e.target.value); }}>{/* ✅ V00292 */}
                        {!tiposCatalogo.some((t) => t.nombre === d.tipoDocumento) && <option value="">{d.tipoDocumento}</option>}
                        {tiposParaDoc(d).map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre}</option>)}
                      </select>
                    </td>
                    <td><input type="checkbox" checked={d.vence} title="¿Este documento vence?" onChange={(e) => guardarCampo(d, 'vence', e.target.checked)} /></td>
                    {/* ✅ Edición DIRECTA en la tabla: se guarda al elegir la fecha */}
                    <td><input type="date" className={`rv-input-fecha${!d.fechaExpedicion ? ' rv-falta' : ''}`} value={d.fechaExpedicion} onChange={(e) => guardarCampo(d, 'fechaExpedicion', e.target.value)} /></td>
                    <td><input type="date" className={`rv-input-fecha${!d.fechaVencimiento ? ' rv-falta' : ''}`} value={d.fechaVencimiento} disabled={!d.vence} title={d.vence ? '' : 'Marca "Vence" para capturar el vencimiento'} onChange={(e) => guardarCampo(d, 'fechaVencimiento', e.target.value)} /></td>
                    <td className="rv-celda-ver">{guardandoId === d.id && <span className="rv-guardando">⏳</span>}<button type="button" className="rv-btn-editar" title="Editar este registro (tipo, vence y fechas)" onClick={() => abrirEditorDoc(d)}>✎</button>{d.url && <a className="rv-ver" href={d.url} target="_blank" rel="noopener noreferrer" title="Visualizar el documento">Ver</a>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {/* ✅ V00292: editor del registro — guarda todo junto en `documentos` */}
      {docEditor && (
        <div className="modal-overlay rv-editor-overlay" onClick={(e) => { if (e.target === e.currentTarget) setDocEditor(null); }}>
          <div className="rv-editor-modal">
            <div className="rv-editor-encabezado">
              <h3 className="rv-editor-titulo">Editar registro del documento</h3>
              <button type="button" className="rv-editor-cerrar" onClick={() => setDocEditor(null)}>✕</button>
            </div>
            <div className="rv-editor-cuerpo">
              <label className="rv-editor-campo">
                <span>Tipo de archivo (carpeta)</span>
                <select className="form-control" value={tiposCatalogo.some((t) => t.nombre === docEditor.tipoDocumento) ? docEditor.tipoDocumento : ''} onChange={(e) => { const cat = tiposCatalogo.find((t) => t.nombre === e.target.value); setDocEditor((p) => (p ? { ...p, tipoDocumento: e.target.value, vence: cat ? cat.vence : p.vence } : p)); }}>
                  {!tiposCatalogo.some((t) => t.nombre === docEditor.tipoDocumento) && <option value="">{docEditor.tipoDocumento}</option>}
                  {tiposCatalogo.map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre}{t.vence ? ' · vence' : ''}</option>)}
                </select>
              </label>
              <label className="rv-editor-campo rv-editor-campo--check">
                <input type="checkbox" checked={docEditor.vence} onChange={(e) => setDocEditor((p) => (p ? { ...p, vence: e.target.checked } : p))} />
                <span>¿Este documento vence?</span>
              </label>
              <label className="rv-editor-campo">
                <span>Fecha de expedición</span>
                <input type="date" className="form-control" value={docEditor.fechaExpedicion} onChange={(e) => setDocEditor((p) => (p ? { ...p, fechaExpedicion: e.target.value } : p))} />
              </label>
              <label className="rv-editor-campo">
                <span>Fecha de vencimiento</span>
                <input type="date" className="form-control" value={docEditor.fechaVencimiento} disabled={!docEditor.vence} onChange={(e) => setDocEditor((p) => (p ? { ...p, fechaVencimiento: e.target.value } : p))} />
              </label>
            </div>
            <div className="rv-editor-pie">
              <button type="button" className="btn btn-outline" onClick={() => setDocEditor(null)}>Cancelar</button>
              <button type="button" className="rv-editor-guardar" disabled={guardandoEditor} onClick={guardarEditorDoc}>{guardandoEditor ? 'Guardando…' : 'Guardar cambios'}</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

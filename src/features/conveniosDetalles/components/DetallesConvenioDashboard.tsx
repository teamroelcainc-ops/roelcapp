// src/features/conveniosDetalles/components/DetallesConvenioDashboard.tsx
//
// ✅ NUEVO (V00112) — DETALLES DEL CONVENIO (vista de solo lectura).
//   Tabla plana con TODOS los detalles/tarifas de los convenios, una fila por
//   detalle, para Clientes y Proveedores (mismo componente, prop `tipo`).
//   Columnas: ID · Convenio (número consecutivo del convenio general) ·
//   Cliente/Proveedor · Tarifa (descripción desde catalogo_tarifas_referencia)
//   · Costo de la tarifa.
//   La edición sigue viviendo en los módulos de Convenios; esto es un índice
//   rápido para consultar y buscar tarifas sin abrir convenio por convenio.
// ✅ V00196 (solo CLIENTES): se quitan las columnas ID y Convenio y se muestra
//   el CONSECUTIVO del detalle (CONV-001 en adelante, campo `consecutivo` que
//   asignan la migración y la aprobación de tarifarios); la columna Moneda se
//   renombra a "Cotizado En". Proveedores conserva su vista anterior.
// ✅ V00197 (solo CLIENTES):
//   · Buscador con el diseño de la app (la clase .form-input-elegante no
//     existía en ningún CSS; ahora los inputs usan .form-control global).
//   · PESTAÑAS: Convenios Activos (vigentes) · Convenios Cancelados (Baja) ·
//     Convenios Inactivos (✅ V00217: por STATUS del detalle) · No identificados (la tarifa
//     no resuelve en el catálogo) · Vacíos (sin costo o sin moneda).
// ✅ V00198 (clientes): se quita la pestaña "Convenios Cancelados"; el módulo
//   tiene permiso PROPIO en Roles y respeta Configuración → Autorizaciones
//   (Editar al guardar cambios, Borrar al eliminar); el botón de eliminar usa
//   el icono rojo estándar de la app (btn-small btn-danger).
// ✅ V00199 (clientes): columna STATUS editable por renglón (Pendiente ·
//   Aprobado · Inactivo · Cancelado) — se guarda con "Guardar cambios" y
//   respeta Autorizaciones como edición del campo Status.
// ✅ V00202: si un detalle está aquí, está APROBADO — el status vacío se
//   muestra (y se guarda al editar) como "Aprobado".
// ✅ V00215: UNIR duplicados — se marcan con los checkboxes, se elige cuál se
//   conserva y las operaciones que usaban los otros se REAPUNTAN al conservado
//   antes de mandarlos a la Papelera (mismo patrón que Catálogos).
// ✅ V00211: PARIDAD PROVEEDORES — todas las funciones de clientes (pestañas,
//   consecutivo, status, uso en operaciones [op.convenioProveedor], selección
//   múltiple, edición en modal, Sin cotización) aplican también a proveedores.

import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, updateDoc, writeBatch, setDoc, query, where } from 'firebase/firestore'; // ✅ V00215/V00231/V00232
import { reservarConsecutivosDetalle, reservarConsecutivosDetalleProveedor } from '../consecutivos'; // ✅ V00231
import { db as dbFs, eliminarRegistro } from '../../../config/firebase';
import { db } from '../../../config/firebase';
import { obtenerCacheMemoria, guardarCacheMemoria } from '../../../utils/cacheMemoria';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos'; // ✅ V00198
import './DetallesConvenioDashboard.css';

/** ✅ V00231: campo de BÚSQUEDA para elegir de una lista (no desplegable). */
const BuscadorSimple = ({ etiqueta, opciones, valor, onElegir }: {
  etiqueta: string;
  opciones: { id: string; nombre: string }[];
  valor: string;
  onElegir: (id: string) => void;
}) => {
  // ✅ V00231: el texto mostrado se DERIVA del valor elegido; mientras el
  //   usuario escribe manda su búsqueda (sin efectos ni renders en cascada).
  const nombreDe = (id: string) => opciones.find((o) => o.id === id)?.nombre || '';
  const [busqueda, setBusqueda] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const texto = busqueda ?? nombreDe(valor);
  const setTexto = (t: string) => setBusqueda(t);
  const n = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const sugerencias = (texto.trim() ? opciones.filter((o) => n(o.nombre).includes(n(texto))) : opciones).slice(0, 12);
  return (
    <label className="dcv-edit-label">
      {etiqueta}
      <div className="dcv-buscador">
        <input
          type="text"
          className="form-control"
          placeholder="Buscar…"
          value={texto}
          onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onBlur={() => window.setTimeout(() => { setAbierto(false); setBusqueda(null); }, 150)}
        />
        {texto && <button type="button" className="dcv-limpiar" onMouseDown={(e) => { e.preventDefault(); setBusqueda(null); onElegir(''); }}>✕</button>}
        {abierto && sugerencias.length > 0 && (
          <div className="dcv-sugerencias">
            {sugerencias.map((o) => (
              <button key={o.id} type="button" className="dcv-sugerencia" onMouseDown={(e) => { e.preventDefault(); onElegir(o.id); setBusqueda(null); setAbierto(false); }}>
                {o.nombre}
              </button>
            ))}
          </div>
        )}
      </div>
    </label>
  );
};

// ✅ V00207: normalizador para detectar textos como "No identificado"
const norm2 = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

interface Props { tipo: 'clientes' | 'proveedores'; }

interface FilaDetalle {
  id: string;
  consecutivo: string; // ✅ V00196: CONV-001… del detalle (clientes)
  numeroConvenio: string;
  moneda: string;
  numeroOrden: number;
  entidad: string;      // cliente o proveedor según `tipo`
  tarifa: string;       // descripción de la tarifa de referencia
  tarifaId: string;     // ✅ V00207: id de la tarifa (para corregir No identificados)
  origen: string;       // ✅ V00231: municipios del detalle
  destino: string;
  costo: number | null;
  status: string; // ✅ V00199: status propio del detalle
  // ✅ V00197: para las pestañas (clientes)
  statusConvenio: string;
  vencido: boolean;
  identificada: boolean;
}

const TTL_MS = 5 * 60 * 1000; // 5 min: suficiente para navegar sin re-leer

const DetallesConvenioDashboard: React.FC<Props> = ({ tipo }) => {
  const esClientes = tipo === 'clientes';
  const COL_CONVENIOS = esClientes ? 'convenios_clientes' : 'convenios_proveedores';
  const COL_DETALLES = esClientes ? 'convenios_clientes_detalles' : 'convenios_proveedores_detalles';
  const CAMPO_ENTIDAD = esClientes ? 'clienteNombre' : 'proveedorNombre';
  const ETIQUETA_ENTIDAD = esClientes ? 'Cliente' : 'Proveedor';
  const CLAVE_CACHE = `detalles_convenio__${tipo}`;

  const [filas, setFilas] = useState<FilaDetalle[] | null>(() => obtenerCacheMemoria<FilaDetalle[]>(CLAVE_CACHE, TTL_MS));
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [ordenAsc, setOrdenAsc] = useState(false);
  // ✅ V00206: operaciones que usan cada detalle (op.convenio = id del detalle)
  const [usosOps, setUsosOps] = useState<Record<string, { ref: string; fecha: string; status: string; tipo: string; entidad: string; monto: string; docId: string }[]>>({});
  const [usoAbierto, setUsoAbierto] = useState<FilaDetalle | null>(null);
  // ✅ V00207: selección múltiple para borrado masivo (solo clientes)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [borrandoSel, setBorrandoSel] = useState(false);
  // ✅ V00231: alta de convenios desde este módulo.
  const [modalAgregar, setModalAgregar] = useState(false);
  const [guardandoAlta, setGuardandoAlta] = useState(false);
  const [tarifariosAlta, setTarifariosAlta] = useState<{ id: string; etiqueta: string; entidad: string; convenioId: string; moneda: string }[]>([]);
  const [tarifasAlta, setTarifasAlta] = useState<{ id: string; nombre: string }[]>([]);
  const [municipiosAlta, setMunicipiosAlta] = useState<{ id: string; nombre: string }[]>([]);
  const [alta, setAlta] = useState({ tarifarioId: '', tarifaId: '', origen: '', destino: '', moneda: '', status: 'Aprobado', costo: '' });

  // ✅ V00217: buscador por cliente/proveedor (además del de texto)
  const [filtroEntidad, setFiltroEntidad] = useState('');
  // ✅ V00220: si se llegó aquí desde una referencia clicable, el buscador
  //   arranca con esa referencia.
  useEffect(() => {
    try {
      const crudo = localStorage.getItem('roelca_buscar');
      if (!crudo) return;
      const d = JSON.parse(crudo);
      const claveMod = esClientes ? 'detallesConvenioClientes' : 'detallesConvenioProveedores';
      if (String(d?.modulo || '') !== claveMod || !d?.texto) return;
      setBusqueda(String(d.texto));
      localStorage.removeItem('roelca_buscar');
    } catch { /* noop */ }
  }, [esClientes]);

  // ✅ V00215: unir duplicados
  const [modalUnir, setModalUnir] = useState(false);
  const [conservarId, setConservarId] = useState('');
  const [uniendo, setUniendo] = useState(false);
  // ✅ V00207: catálogo de tarifas para CORREGIR los "No identificados"
  const [tarifasLista, setTarifasLista] = useState<{ id: string; nombre: string }[]>([]);
  // ✅ V00207: edición en modal (lápiz al inicio de la fila)
  const [editando, setEditando] = useState<FilaDetalle | null>(null);
  // ✅ V00232: la edición usa los MISMOS campos que el alta.
  const [editForm, setEditForm] = useState<{ tarifaId: string; moneda: string; status: string; costo: string; origen: string; destino: string }>({ tarifaId: '', moneda: '', status: '', costo: '', origen: '', destino: '' });
  const [guardandoEdicion, setGuardandoEdicion] = useState(false);
  // ✅ V00197: pestañas (solo clientes)
  // ✅ V00198: sin la pestaña "Convenios Cancelados"
  // ✅ V00207: nueva pestaña "Sin cotización" (sin moneda); "Vacíos" queda solo para costo vacío/0
  const PESTANAS = ['Convenios Activos', 'Convenios Inactivos', 'No identificados', 'Vacíos', 'Sin cotización'] as const;
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>('Convenios Activos');
  // ✅ NUEVO (V00122): edición en línea (varios de golpe) + eliminar con papelera
  const [cambios, setCambios] = useState<Record<string, { tarifa?: number; moneda?: string; status?: string }>>({}); // ✅ V00199: + status
  const [guardando, setGuardando] = useState(false);
  // ✅ NUEVO (V00123): monedas desde el CATÁLOGO (nada hardcodeado)
  const [monedasCat, setMonedasCat] = useState<string[]>([]);
  // ✅ V00198: reglas de Autorizaciones (módulo propio; en proveedores no hay reglas registradas y todo pasa)
  const aut = useAutorizacionesCampos(esClientes ? 'detallesConvenioClientes' : 'detallesConvenioProveedores');

  const ESTADOS_DETALLE = ['Pendiente', 'Aprobado', 'Inactivo', 'Cancelado']; // ✅ V00199
  const marcarCambio = (id: string, campo: 'tarifa' | 'moneda' | 'status', v: number | string) =>
    setCambios((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: v as never } }));
  const guardarCambios = async () => {
    const ids = Object.keys(cambios);
    if (ids.length === 0 || guardando) return;
    // ✅ V00198: Editar respeta Autorizaciones (campos: moneda y/o tarifa)
    const camposTocados = [...new Set(ids.flatMap((id) => Object.keys(cambios[id])))];
    if (!aut.verificarAccion('editar', camposTocados)) return;
    setGuardando(true);
    try {
      for (const id of ids) await updateDoc(doc(dbFs, COL_DETALLES, id), { ...cambios[id] } as Record<string, unknown>);
      setFilas((prev) => (prev || []).map((f) => cambios[f.id] ? { ...f, costo: cambios[f.id].tarifa ?? f.costo, moneda: String(cambios[f.id].moneda ?? f.moneda), status: String(cambios[f.id].status ?? f.status) } : f));
      setCambios({});
      alert(`Se guardaron ${ids.length} detalle(s). ✅`);
    } catch { alert('No se pudieron guardar todos los cambios.'); }
    setGuardando(false);
  };
  const eliminarDetalle = async (id: string) => {
    if (!aut.verificarAccion('borrar')) return; // ✅ V00198
    if (!window.confirm('¿Eliminar este detalle del convenio?\n\nSe enviará a la Papelera de Reciclaje (nota obligatoria).')) return;
    try {
      await eliminarRegistro(COL_DETALLES, id, { modulo: 'Detalles del Convenio' });
      setFilas((prev) => (prev || []).filter((f) => f.id !== id));
      setSeleccion((prev) => { const s = new Set(prev); s.delete(id); return s; });
    } catch { /* cancelado o error: sin cambios */ }
  };

  // ✅ V00207: BORRADO MASIVO — una sola nota para todos los seleccionados.
  const eliminarSeleccionados = async () => {
    if (seleccion.size === 0 || borrandoSel) return;
    if (!aut.verificarAccion('borrar')) return;
    if (!window.confirm(`¿Eliminar ${seleccion.size} convenio(s) seleccionado(s)?\n\nTodos se enviarán a la Papelera de Reciclaje.`)) return;
    const motivo = String(window.prompt('Nota de eliminación (obligatoria) para los registros seleccionados:') || '').trim();
    if (!motivo) { alert('La nota es obligatoria. No se eliminó nada.'); return; }
    setBorrandoSel(true);
    try {
      const ids = Array.from(seleccion);
      let ok = 0;
      for (const id of ids) {
        try {
          await eliminarRegistro(COL_DETALLES, id, { modulo: 'Detalles del Convenio', motivo });
          ok += 1;
        } catch { /* continúa con el resto */ }
      }
      setFilas((prev) => (prev || []).filter((f) => !seleccion.has(f.id)));
      setSeleccion(new Set());
      alert(`${ok} de ${ids.length} convenio(s) enviados a la Papelera. ✅`);
    } finally {
      setBorrandoSel(false);
    }
  };

  /** ✅ V00232: abre la operación en su FORMULARIO de edición, en el módulo
   *  que corresponde según su status. */
  const editarOperacion = (op: { ref: string; docId: string; status: string }) => {
    const completada = op.status.toLowerCase().includes('completad');
    const modulo = completada ? 'serviciosCompletados' : 'operaciones';
    try {
      localStorage.setItem('roelca_abrir_registro', JSON.stringify({ modulo, coleccion: 'operaciones', docId: op.docId, vista: 'editar', ts: Date.now() }));
      localStorage.setItem('roelca_buscar', JSON.stringify({ modulo, texto: op.ref, ts: Date.now() }));
    } catch { /* noop */ }
    window.dispatchEvent(new CustomEvent('roelca:navegar', { detail: { modulo } }));
    setUsoAbierto(null);
  };

  // ✅ V00231: catálogos del alta (tarifarios, tarifas y municipios).
  const abrirAlta = async () => {
    setModalAgregar(true);
    try {
      const [snapTar, snapRef, snapMun] = await Promise.all([
        getDocs(collection(db, esClientes ? 'tarifario_clientes' : 'tarifario_proveedores')),
        getDocs(collection(db, 'catalogo_tarifas_referencia')),
        getDocs(collection(db, 'catalogo_municipios')),
      ]);
      setTarifariosAlta(
        snapTar.docs
          .map((d) => {
            const t = d.data() as Record<string, unknown>;
            const cons = String(t.consecutivo || d.id);
            const ent = String((esClientes ? t.clienteNombre : t.proveedorNombre) || '');
            return { id: d.id, etiqueta: `${cons} - ${ent}`, entidad: ent, convenioId: String(t.convenioId || ''), moneda: String(t.moneda || '') };
          })
          .filter((t) => t.entidad)
          .sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, 'es', { sensitivity: 'base' }))
      );
      setTarifasAlta(
        snapRef.docs.map((d) => ({ id: d.id, nombre: String((d.data() as Record<string, unknown>).descripcion || '') }))
          .filter((t) => t.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
      );
      setMunicipiosAlta(
        snapMun.docs.map((d) => ({ id: d.id, nombre: String((d.data() as Record<string, unknown>).municipio || '') }))
          .filter((m) => m.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
      );
    } catch (e) {
      console.error('No se pudieron cargar los catálogos del alta:', e);
    }
  };

  /** ✅ V00231: reglas de ruta según el tipo de servicio de la tarifa.
   *  Cruce de Importación → Laredo a Nuevo Laredo. Cruce de Exportación → al
   *  revés. En fletes se capturan a mano y son obligatorios. */
  const rutaSugerida = (nombreTarifa: string): { origen: string; destino: string; obligatorio: boolean } => {
    const t = norm2(nombreTarifa);
    const idPorNombre = (n: string) => municipiosAlta.find((m) => norm2(m.nombre) === norm2(n))?.id || '';
    if (t.includes('flete')) return { origen: '', destino: '', obligatorio: true };
    if (t.includes('cruce') && t.includes('importacion')) return { origen: idPorNombre('Laredo'), destino: idPorNombre('Nuevo Laredo'), obligatorio: false };
    if (t.includes('cruce') && t.includes('exportacion')) return { origen: idPorNombre('Nuevo Laredo'), destino: idPorNombre('Laredo'), obligatorio: false };
    return { origen: '', destino: '', obligatorio: false };
  };

  const guardarAlta = async () => {
    if (guardandoAlta) return;
    const tarifario = tarifariosAlta.find((t) => t.id === alta.tarifarioId);
    const tarifa = tarifasAlta.find((t) => t.id === alta.tarifaId);
    if (!tarifario || !tarifa) { alert('Elige el cliente/proveedor y la tarifa.'); return; }
    const regla = rutaSugerida(tarifa.nombre);
    if (regla.obligatorio && (!alta.origen || !alta.destino)) {
      alert('En los fletes el origen y el destino son obligatorios.');
      return;
    }
    // ✅ V00233: si el cliente no cotiza en dólares, la moneda se elige a mano.
    if (!alta.moneda) { alert('Selecciona la moneda de cotización.'); return; }
    if (!aut.verificarAccion('crear')) return;
    setGuardandoAlta(true);
    try {
      const [consec] = esClientes ? await reservarConsecutivosDetalle(1) : await reservarConsecutivosDetalleProveedor(1);
      const nombreMun = (id: string) => municipiosAlta.find((m) => m.id === id)?.nombre || '';

      // ✅ V00233: el origen/destino elegidos se guardan TAMBIÉN en la tarifa
      //   del catálogo y su descripción se rearma con esos municipios.
      let nombreTarifa = tarifa.nombre;
      if (alta.origen || alta.destino) {
        const nombresMun = new Set(municipiosAlta.map((m) => m.nombre));
        const base = String(tarifa.nombre).split(' - ').map((x) => x.trim()).filter((x) => x && !nombresMun.has(x));
        nombreTarifa = [...base, nombreMun(alta.origen), nombreMun(alta.destino)].filter(Boolean).join(' - ');
        try {
          await updateDoc(doc(dbFs, 'catalogo_tarifas_referencia', tarifa.id), {
            origen: alta.origen, destino: alta.destino, descripcion: nombreTarifa,
          });
          setTarifasAlta((prev) => prev.map((t) => t.id === tarifa.id ? { ...t, nombre: nombreTarifa } : t));
        } catch (e) { console.error('No se pudo actualizar la tarifa del catálogo:', e); }
      }
      await setDoc(doc(dbFs, COL_DETALLES, consec), {
        convenioId: tarifario.convenioId,
        tarifarioId: tarifario.id,
        tipoConvenioId: tarifa.id,
        tipoConvenioNombre: nombreTarifa,
        tarifa: parseFloat(alta.costo) || 0,
        moneda: alta.moneda,
        status: alta.status,
        consecutivo: consec,
        origen: alta.origen,
        origenNombre: nombreMun(alta.origen),
        destino: alta.destino,
        destinoNombre: nombreMun(alta.destino),
      });
      setModalAgregar(false);
      setAlta({ tarifarioId: '', tarifaId: '', origen: '', destino: '', moneda: '', status: 'Aprobado', costo: '' });
      await cargar(true);
      alert(`Convenio ${consec} agregado. ✅`);
    } catch (e) {
      console.error('No se pudo agregar el convenio:', e);
      alert('No se pudo agregar el convenio.');
    } finally {
      setGuardandoAlta(false);
    }
  };

  // ✅ V00215: UNIR los detalles seleccionados en uno solo.
  const abrirModalUnir = () => {
    if (seleccion.size < 2) return;
    const ids = Array.from(seleccion);
    // Por defecto se conserva el que más operaciones tenga (y a igualdad, el consecutivo menor).
    const mejor = [...ids].sort((a, b) => {
      const ua = (usosOps[a] || []).length, ub = (usosOps[b] || []).length;
      if (ub !== ua) return ub - ua;
      const fa = (filas || []).find((f) => f.id === a), fb = (filas || []).find((f) => f.id === b);
      return String(fa?.consecutivo || '').localeCompare(String(fb?.consecutivo || ''));
    })[0];
    setConservarId(mejor || ids[0]);
    setModalUnir(true);
  };

  const unirSeleccionados = async () => {
    if (!conservarId || seleccion.size < 2 || uniendo) return;
    if (!aut.verificarAccion('borrar')) return;
    const descartados = Array.from(seleccion).filter((id) => id !== conservarId);
    const opsAfectadas = descartados.reduce((n, id) => n + (usosOps[id] || []).length, 0);
    const consConservado = (filas || []).find((f) => f.id === conservarId)?.consecutivo || conservarId;
    if (!window.confirm(`¿Unir ${descartados.length + 1} convenios en ${consConservado}?\n\n· ${opsAfectadas} operación(es) que usaban los otros quedarán apuntando a ${consConservado}.\n· Los ${descartados.length} restantes se enviarán a la Papelera.`)) return;
    setUniendo(true);
    try {
      // 1) Reapuntar las operaciones de los descartados al conservado.
      const campoOp = esClientes ? 'convenio' : 'convenioProveedor';
      const campoNombre = esClientes ? 'convenioNombre' : 'convenioProveedorNombre';
      const filaConservada = (filas || []).find((f) => f.id === conservarId);
      const snapOps = await getDocs(collection(db, 'operaciones'));
      let lote = writeBatch(db);
      let enLote = 0;
      let reapuntadas = 0;
      for (const d of snapOps.docs) {
        const o = d.data() as Record<string, unknown>;
        if (!descartados.includes(String(o[campoOp] || ''))) continue;
        const cambios: Record<string, unknown> = { [campoOp]: conservarId };
        if (filaConservada?.tarifa) cambios[campoNombre] = filaConservada.tarifa;
        lote.update(d.ref, cambios);
        reapuntadas += 1;
        enLote += 1;
        if (enLote >= 400) { await lote.commit(); lote = writeBatch(db); enLote = 0; }
      }
      if (enLote > 0) await lote.commit();

      // 2) Los descartados se van a la Papelera con una sola nota.
      let borrados = 0;
      for (const id of descartados) {
        try {
          await eliminarRegistro(COL_DETALLES, id, { modulo: 'Detalles del Convenio', motivo: `Unido con ${consConservado} (duplicado)` });
          borrados += 1;
        } catch { /* continúa */ }
      }

      setFilas((prev) => (prev || []).filter((f) => !descartados.includes(f.id)));
      setSeleccion(new Set());
      setModalUnir(false);
      alert(`Convenios unidos en ${consConservado}. ✅\n\n· Operaciones reapuntadas: ${reapuntadas}\n· Convenios enviados a la Papelera: ${borrados}`);
    } catch (e) {
      console.error('No se pudieron unir los convenios:', e);
      alert('No se pudieron unir los convenios.');
    } finally {
      setUniendo(false);
    }
  };

  // ✅ V00207: EDICIÓN EN MODAL (lápiz) — también corrige los "No identificados"
  //   asignando la tarifa correcta del catálogo.
  const abrirEdicion = async (f: FilaDetalle) => {
    setEditForm({
      tarifaId: f.tarifaId || '',
      moneda: String(f.moneda || ''),
      status: String(f.status || 'Aprobado'),
      costo: String(f.costo ?? ''),
      origen: '', destino: '',
    });
    setEditando(f);
    // ✅ V00232: mismos catálogos que el alta (tarifas y municipios) y se
    //   precargan los municipios guardados en el detalle.
    try {
      if (tarifasAlta.length === 0 || municipiosAlta.length === 0) {
        const [snapRef, snapMun] = await Promise.all([
          getDocs(collection(db, 'catalogo_tarifas_referencia')),
          getDocs(collection(db, 'catalogo_municipios')),
        ]);
        setTarifasAlta(snapRef.docs.map((d) => ({ id: d.id, nombre: String((d.data() as Record<string, unknown>).descripcion || '') })).filter((t) => t.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })));
        setMunicipiosAlta(snapMun.docs.map((d) => ({ id: d.id, nombre: String((d.data() as Record<string, unknown>).municipio || '') })).filter((m) => m.nombre).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' })));
      }
      const det = await getDocs(query(collection(db, COL_DETALLES), where('__name__', '==', f.id)));
      if (!det.empty) {
        const x = det.docs[0].data() as Record<string, unknown>;
        setEditForm((p) => ({ ...p, origen: String(x.origen || ''), destino: String(x.destino || '') }));
      }
    } catch (e) { console.error('No se pudieron cargar los catálogos de edición:', e); }
  };

  const guardarEdicion = async () => {
    if (!editando || guardandoEdicion) return;
    const f = editando;
    const tocados: string[] = [];
    if (editForm.tarifaId !== (f.tarifaId || '')) tocados.push('tarifa');
    if (editForm.moneda !== String(f.moneda || '')) tocados.push('moneda');
    if (editForm.status !== String(f.status || 'Aprobado')) tocados.push('status');
    if (String(editForm.costo) !== String(f.costo ?? '')) tocados.push('tarifa');
    if (!aut.verificarAccion('editar', [...new Set(tocados)])) return;
    setGuardandoEdicion(true);
    try {
      const nombreTarifa = tarifasLista.find((t) => t.id === editForm.tarifaId)?.nombre || '';
      const nombreMunEd = (id: string) => municipiosAlta.find((m) => m.id === id)?.nombre || '';
      const cambiosDoc: Record<string, unknown> = {
        moneda: editForm.moneda,
        status: editForm.status,
        tarifa: parseFloat(editForm.costo) || 0,
        // ✅ V00232: origen y destino igual que en el alta
        origen: editForm.origen,
        origenNombre: nombreMunEd(editForm.origen),
        destino: editForm.destino,
        destinoNombre: nombreMunEd(editForm.destino),
      };
      if (editForm.tarifaId) {
        cambiosDoc.tipoConvenioId = editForm.tarifaId;
        cambiosDoc.tipoConvenioNombre = nombreTarifa;
      }
      await updateDoc(doc(dbFs, COL_DETALLES, f.id), cambiosDoc);
      setFilas((prev) => (prev || []).map((x) => x.id === f.id ? {
        ...x,
        moneda: editForm.moneda,
        status: editForm.status,
        costo: parseFloat(editForm.costo) || 0,
        origen: nombreMunEd(editForm.origen),
        destino: nombreMunEd(editForm.destino),
        tarifaId: editForm.tarifaId || x.tarifaId,
        tarifa: nombreTarifa || x.tarifa,
        identificada: editForm.tarifaId ? true : x.identificada,
      } : x));
      setEditando(null);
    } catch (e) {
      console.error('No se pudo guardar la edición del detalle:', e);
      alert('No se pudo guardar la edición del detalle.');
    } finally {
      setGuardandoEdicion(false);
    }
  };

  const cargar = async (forzar = false) => {
    if (cargando) return;
    if (!forzar) {
      const enCache = obtenerCacheMemoria<FilaDetalle[]>(CLAVE_CACHE, TTL_MS);
      if (enCache) { setFilas(enCache); return; }
    }
    setCargando(true);
    try {
      const [snapConv, snapDet, snapTar, snapMon] = await Promise.all([
        getDocs(collection(db, COL_CONVENIOS)),
        getDocs(collection(db, COL_DETALLES)),
        getDocs(collection(db, 'catalogo_tarifas_referencia')),
        getDocs(collection(db, 'catalogo_moneda')), // ✅ V00123
      ]);
      // ✅ V00206/V00211: operaciones que usan cada detalle (clientes: op.convenio; proveedores: op.convenioProveedor)
      {
        try {
          const snapOps = await getDocs(collection(db, 'operaciones'));
          const mapa: Record<string, { ref: string; fecha: string; status: string; tipo: string; entidad: string; monto: string; docId: string }[]> = {};
          snapOps.docs.forEach((d) => {
            const o = d.data() as Record<string, unknown>;
            const conv = String((esClientes ? o.convenio : o.convenioProveedor) || '').trim();
            if (!conv) return;
            if (!mapa[conv]) mapa[conv] = [];
            mapa[conv].push({
              ref: String(o.ref || d.id.substring(0, 6)),
              fecha: String(o.fechaServicio || ''),
              status: String(o.status || o.estatus || ''),
              // ✅ V00218: más contexto en el modal de uso
              tipo: String(o.tipoOperacionNombre || o.trafico || ''),
              entidad: String((esClientes ? (o.clientePagaNombre || o.clienteNombre) : (o.proveedorUnidadNombre || o.proveedorNombre)) || ''),
              monto: String((esClientes ? o.montoConvenioCliente : o.totalAPagarProv) ?? ''),
              docId: d.id, // ✅ V00232: para abrir su formulario de edición
            });
          });
          Object.values(mapa).forEach((lista) => lista.sort((a, b) => b.fecha.localeCompare(a.fecha)));
          setUsosOps(mapa);
        } catch { setUsosOps({}); }
      }
      setMonedasCat(snapMon.docs.map((d) => String((d.data() as { moneda?: unknown }).moneda || '')).filter(Boolean));

      const hoyISO = new Date().toISOString().slice(0, 10);
      const convenios: Record<string, { numero: string; entidad: string; moneda: string; status: string; vencido: boolean }> = {};
      snapConv.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        const venc = String(x.fechaVencimiento || '');
        convenios[d.id] = {
          numero: String(x.numeroConvenio || ''),
          entidad: String(x[CAMPO_ENTIDAD] || ''),
          moneda: String(x.monedaNombre || ''), // ✅ NUEVO (V00119)
          status: String(x.status || 'Activo'), // ✅ V00197
          vencido: !!venc && venc < hoyISO,     // ✅ V00197
        };
      });

      const tarifas: Record<string, string> = {};
      snapTar.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        tarifas[d.id] = String(x.descripcion || '');
      });
      // ✅ V00207: lista para el selector de tarifa del modal de edición
      setTarifasLista(
        snapTar.docs.map((d) => ({ id: d.id, nombre: String((d.data() as Record<string, unknown>).descripcion || '') }))
          .filter((t) => t.nombre)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
      );

      const resultado: FilaDetalle[] = snapDet.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const conv = convenios[String(x.convenioId || '')] || { numero: '', entidad: '', moneda: '', status: 'Activo', vencido: false };
        const idTarifa = String(x.tipoConvenioId || '');
        const crudoCosto = (x.costo !== undefined && x.costo !== null && x.costo !== '') ? x.costo : x.tarifa; // ✅ V00122: los detalles guardan `tarifa`
        const costoNum = (crudoCosto === undefined || crudoCosto === null || crudoCosto === '') ? null : Number(crudoCosto);
        const nombreGuardado = String(x.tipoConvenioNombre || '').trim();
        return {
          id: d.id,
          consecutivo: String(x.consecutivo || ''), // ✅ V00196
          numeroConvenio: conv.numero || '—',
          numeroOrden: parseInt(String(conv.numero || '').replace(/\D/g, ''), 10) || 0,
          entidad: conv.entidad || '—',
          // ✅ CORREGIDO (V00126): la moneda del DETALLE manda; la del maestro solo es respaldo.
          //   Antes se mostraba siempre la del maestro, por lo que el cambio guardado parecía "revertirse".
          moneda: String(x.moneda || ''),
          tarifa: tarifas[idTarifa] || nombreGuardado || '—',
          tarifaId: idTarifa, // ✅ V00207
          origen: String(x.origenNombre || ''),   // ✅ V00231
          destino: String(x.destinoNombre || ''),
          costo: costoNum !== null && !isNaN(costoNum) ? costoNum : null,
          status: String(x.status || ''), // ✅ V00199
          // ✅ V00197: datos para las pestañas
          statusConvenio: conv.status,
          vencido: conv.vencido,
          // ✅ V00207: "No identificado" literal también cuenta como no identificada
          identificada: !!tarifas[idTarifa] || (!!nombreGuardado && !norm2(nombreGuardado).includes('no identificad')),
        };
      });

      guardarCacheMemoria(CLAVE_CACHE, resultado);
      setFilas(resultado);
    } catch (e) {
      console.error('Error cargando detalles del convenio:', e);
      alert('No se pudieron cargar los detalles del convenio. Revisa tu conexión.');
    }
    setCargando(false);
  };

  useEffect(() => {
    cargar(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  const filasVisibles = useMemo(() => {
    let lista = filas || [];
    // ✅ V00197: filtro por pestaña — ✅ V00211: ambos tipos
    {
      const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      // ✅ V00217: Activos/Inactivos por el STATUS DEL DETALLE (antes se
      //   derivaba del vencimiento del convenio y marcaba como "inactivos"
      //   registros que en realidad están aprobados y vigentes).
      const st = (f: FilaDetalle) => String(f.status || 'Aprobado').trim();
      const noIdent = (f: FilaDetalle) => !f.identificada || norm(f.tarifa).includes('no identificad');
      const vacia = (f: FilaDetalle) => f.costo === null || f.costo === 0; // ✅ V00207: solo costo
      const sinCotizacion = (f: FilaDetalle) => !String(f.moneda || '').trim(); // ✅ V00207
      if (pestana === 'Convenios Activos') lista = lista.filter((f) => st(f) !== 'Inactivo' && st(f) !== 'Cancelado');
      else if (pestana === 'Convenios Inactivos') lista = lista.filter((f) => st(f) === 'Inactivo' || st(f) === 'Cancelado');
      else if (pestana === 'No identificados') lista = lista.filter(noIdent);
      else if (pestana === 'Vacíos') lista = lista.filter(vacia);
      else if (pestana === 'Sin cotización') lista = lista.filter(sinCotizacion);
    }
    // ✅ V00217: filtro por entidad (cliente o proveedor)
    if (filtroEntidad) lista = lista.filter((f) => f.entidad === filtroEntidad);
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter((f) =>
        `${f.id} ${f.consecutivo} ${f.numeroConvenio} ${f.entidad} ${f.tarifa} ${f.moneda || '—'} ${f.costo ?? ''}`.toLowerCase().includes(b)
      );
    }
    return [...lista].sort((a, b) => {
      // ✅ V00196: en CLIENTES ordena por el consecutivo del detalle.
      if (esClientes) {
        const na = parseInt(a.consecutivo.replace(/\D/g, ''), 10) || 0;
        const nb = parseInt(b.consecutivo.replace(/\D/g, ''), 10) || 0;
        const base = (na - nb) !== 0 ? (na - nb) : a.numeroOrden - b.numeroOrden;
        return ordenAsc ? base : -base;
      }
      const dif = a.numeroOrden - b.numeroOrden;
      const base = dif !== 0 ? dif : a.numeroConvenio.localeCompare(b.numeroConvenio);
      return ordenAsc ? base : -base;
    });
  }, [filas, busqueda, ordenAsc, esClientes, pestana, filtroEntidad]);

  // ✅ V00218: detecta duplicados EXACTOS — mismo cliente/proveedor, misma
  //   tarifa, mismo costo y misma moneda (el caso que sí conviene unir).
  const clavesDuplicadas = useMemo(() => {
    const cuenta: Record<string, number> = {};
    (filas || []).forEach((f) => {
      const k = `${f.entidad}|${f.tarifaId || f.tarifa}|${f.costo ?? ''}|${f.moneda}`;
      cuenta[k] = (cuenta[k] || 0) + 1;
    });
    return new Set(Object.keys(cuenta).filter((k) => cuenta[k] > 1));
  }, [filas]);
  const esDuplicado = (f: FilaDetalle) => clavesDuplicadas.has(`${f.entidad}|${f.tarifaId || f.tarifa}|${f.costo ?? ''}|${f.moneda}`);

  // ✅ V00217: entidades presentes, para el selector
  const entidades = useMemo(
    () => Array.from(new Set((filas || []).map((f) => f.entidad).filter((e) => e && e !== '—'))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    [filas]
  );

  
  return (
    <div className="module-container dcv-x1">
      {/* ✅ V00217: encabezado en su propio bloque (el subtítulo se montaba
          sobre el título por un margen negativo) y texto actualizado. */}
      <div className="dcv-encabezado">
        <h1 className="module-title dcv-titulo">Detalles del Convenio — {esClientes ? 'Clientes' : 'Proveedores'}</h1>
        <p className="dcv-x2">
          Índice de todas las tarifas de los convenios de {esClientes ? 'clientes' : 'proveedores'}.
          Usa el lápiz para editar una tarifa, o los checkboxes para unir duplicados y eliminar en bloque.
        </p>
      </div>

      {/* ✅ V00197: pestañas — ✅ V00211: también proveedores */}
      {(
        <div className="dcv-pestanas">
          {PESTANAS.map((pst) => (
            <button key={pst} type="button" className={`dcv-pestana ${pestana === pst ? 'dcv-pestana-activa' : ''}`} onClick={() => setPestana(pst)}>
              {pst}
            </button>
          ))}
        </div>
      )}

      <div className="dcv-x3">
        <input
          className="form-control dcv-x4"
          type="text"
          placeholder={`Buscar por convenio, ${ETIQUETA_ENTIDAD.toLowerCase()}, tarifa o costo...`}
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        {/* ✅ V00217: buscador por cliente/proveedor */}
        <select className="form-control dcv-select-entidad" value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)}>
          <option value="">{esClientes ? 'Todos los clientes' : 'Todos los proveedores'}</option>
          {entidades.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <button
          className="btn btn-outline"
          onClick={() => setOrdenAsc((v) => !v)}
          title="Cambiar orden por número de convenio"
        >
          {esClientes ? 'Consecutivo' : 'Convenio'} {ordenAsc ? '↑' : '↓'}
        </button>
        <button
          className="btn btn-outline"
          onClick={() => cargar(true)}
          disabled={cargando}
          title="Volver a leer desde Firebase"
        >
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
        {/* ✅ NUEVO (V00122): guarda todos los renglones editados de golpe */}
        <button className="btn" style={{ backgroundColor: '#238636', color: '#fff', border: 'none', fontWeight: 600, opacity: Object.keys(cambios).length === 0 ? 0.5 : 1 }} disabled={Object.keys(cambios).length === 0 || guardando} onClick={guardarCambios}>
          {guardando ? 'Guardando…' : `Guardar cambios (${Object.keys(cambios).length})`}
        </button>
        {/* ✅ V00207: borrado masivo de los seleccionados */}
        {/* ✅ V00231: alta de convenios */}
        <button className="btn dcv-btn-agregar" onClick={abrirAlta}>+ Agregar</button>
        {/* ✅ V00215: unir duplicados */}
        {seleccion.size >= 2 && (
          <button className="btn btn-outline dcv-btn-unir" disabled={uniendo} onClick={abrirModalUnir}>
            {uniendo ? 'Uniendo…' : `⚭ Unir (${seleccion.size})`}
          </button>
        )}
        {seleccion.size > 0 && (
          <button className="btn btn-outline dcv-btn-borrar-sel" disabled={borrandoSel} onClick={eliminarSeleccionados}>
            {borrandoSel ? 'Eliminando…' : `🗑 Eliminar seleccionados (${seleccion.size})`}
          </button>
        )}
      </div>

      {filas === null ? (
        <div className="dcv-x5">Cargando detalles del convenio…</div>
      ) : filasVisibles.length === 0 ? (
        <div className="dcv-x5">
          {busqueda ? 'Sin resultados para la búsqueda.' : 'Aún no hay detalles de convenio capturados.'}
        </div>
      ) : (
        <div className="dcv-x6">
          <table className="data-table dcv-x7">
            <thead>
              <tr>
                {/* ✅ V00207: checkbox de selección + ACCIONES al inicio — ✅ V00211: ambos tipos */}
                {(
                  <th className="dcv-th-check">
                    <input
                      type="checkbox"
                      checked={filasVisibles.length > 0 && filasVisibles.every((f) => seleccion.has(f.id))}
                      onChange={(e) => {
                        const marcar = e.target.checked;
                        setSeleccion((prev) => {
                          const s = new Set(prev);
                          filasVisibles.forEach((f) => { if (marcar) s.add(f.id); else s.delete(f.id); });
                          return s;
                        });
                      }}
                    />
                  </th>
                )}
                <th>Acciones</th>
                {/* ✅ V00196 (clientes): CONSECUTIVO reemplaza a ID y Convenio; Moneda → "Cotizado En" */}
                <th>Consecutivo</th>{/* ✅ V00211: también proveedores */}
                <th>{ETIQUETA_ENTIDAD}</th>
                <th>Tarifa</th>
                <th>Origen</th>{/* ✅ V00231 */}
                <th>Destino</th>
                <th>Cotizado En</th>
                <th>Status</th>{/* ✅ V00199 */}
                <th>Operaciones</th>{/* ✅ V00206: veces usado */}
                <th className="dcv-x8">Costo de la Tarifa</th>

              </tr>
            </thead>
            <tbody>
              {filasVisibles.map((f) => (
                /* ✅ V00206: clic en la fila = ver en cuántas operaciones se usó */
                <tr key={f.id} className="dcv-fila-click" onClick={() => setUsoAbierto(f)}>
                  {(
                    /* ✅ V00207: checkbox de selección para borrado masivo */
                    <td className="dcv-th-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={seleccion.has(f.id)}
                        onChange={(e) => setSeleccion((prev) => { const s = new Set(prev); if (e.target.checked) s.add(f.id); else s.delete(f.id); return s; })}
                      />
                    </td>
                  )}
                  {(
                    /* ✅ V00207: editar (corrige tarifa/No identificado) y eliminar AL INICIO */
                    <td className="dcv-td-acciones" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-small btn-edit dcv-mr6" title="Editar este detalle (tarifa, cotizado en, status y costo)" onClick={() => abrirEdicion(f)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                      <button className="btn-small btn-danger" title="Eliminar (va a la Papelera de Reciclaje)" onClick={() => eliminarDetalle(f.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                    </td>
                  )}
                  <td className="dcv-x10" title={`Convenio ${f.numeroConvenio} · id ${f.id}`}>{f.consecutivo || '—'}</td>{/* ✅ V00211 */}
                  <td>{f.entidad}</td>
                  <td>
                    {f.tarifa}
                    {/* ✅ V00218: aviso de convenio repetido con la misma tarifa */}
                    {esDuplicado(f) && <span className="dcv-chip-dup" title="Este cliente/proveedor tiene otro convenio idéntico (misma tarifa y mismo monto) — conviene unirlos">⚠ duplicado</span>}
                  </td>
                  <td>{f.origen || '—'}</td>{/* ✅ V00231 */}
                  <td>{f.destino || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>{(() => { const val = String(cambios[f.id]?.moneda ?? f.moneda ?? ''); const ops = monedasCat.length > 0 ? monedasCat : ['Pesos', 'Dólares']; const lista = val && !ops.includes(val) ? [...ops, val] : ops; return (
                    <select className="form-control dcv-select-moneda" value={val} onChange={(e) => marcarCambio(f.id, 'moneda', e.target.value)}>
                      <option value="">— Sin moneda —</option>
                      {lista.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>); })()}</td>
                  {(
                    /* ✅ V00199: status editable del detalle (se guarda con "Guardar cambios") */
                    <td onClick={(e) => e.stopPropagation()}>
                      {/* ✅ V00202: vacío = Aprobado (estar en Detalles implica aprobado) */}
                      <select className="form-control dcv-select-moneda" value={String(cambios[f.id]?.status ?? (f.status || 'Aprobado'))} onChange={(e) => marcarCambio(f.id, 'status', e.target.value)}>
                        {ESTADOS_DETALLE.map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </td>
                  )}
                  {(
                    /* ✅ V00206: total de operaciones que usaron este convenio */
                    <td className="dcv-td-usos">{(usosOps[f.id] || []).length}</td>
                  )}
                  <td className="dcv-x8" onClick={(e) => e.stopPropagation()}><input type="number" step="0.01" className="form-control dcv-input-costo" value={cambios[f.id]?.tarifa ?? (f.costo ?? 0)} onChange={(e) => marcarCambio(f.id, 'tarifa', parseFloat(e.target.value) || 0)} /></td>

                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="dcv-x11">Mostrando {filasVisibles.length} de {(filas || []).length} detalle(s)</div>

      {/* ✅ V00231: MODAL — agregar convenio */}
      {modalAgregar && (
        <div className="modal-overlay" onClick={() => !guardandoAlta && setModalAgregar(false)}>
          <div className="dcv-modal dcv-modal-alta" onClick={(e) => e.stopPropagation()}>
            <div className="dcv-modal-encabezado">
              <div>
                <h3 className="dcv-modal-titulo">Agregar convenio</h3>
                <p className="dcv-modal-sub">El consecutivo CONV-### se asigna solo al guardar.</p>
              </div>
              <button type="button" className="dcv-cerrar" onClick={() => !guardandoAlta && setModalAgregar(false)}>✕</button>
            </div>

            {/* ✅ V00233: orden pedido — tarifario, tarifa, origen, destino,
                costo, cotizado en, status */}
            <div className="dcv-alta-campos">
              <BuscadorSimple
                etiqueta={esClientes ? '# de tarifario - Cliente' : '# de tarifario - Proveedor'}
                opciones={tarifariosAlta.map((t) => ({ id: t.id, nombre: t.etiqueta }))}
                valor={alta.tarifarioId}
                onElegir={(id) => {
                  const t = tarifariosAlta.find((x) => x.id === id);
                  // Dólares se propone solo; en pesos hay que elegir la moneda.
                  const esUSD = String(t?.moneda || '').toUpperCase().includes('USD') || String(t?.moneda || '').toLowerCase().includes('dolar');
                  setAlta((p) => ({ ...p, tarifarioId: id, moneda: esUSD ? 'Dólares' : '' }));
                }}
              />
              <BuscadorSimple
                etiqueta="Tarifa (catálogo)"
                opciones={tarifasAlta}
                valor={alta.tarifaId}
                onElegir={(id) => {
                  const t = tarifasAlta.find((x) => x.id === id);
                  const r = rutaSugerida(t?.nombre || '');
                  setAlta((p) => ({ ...p, tarifaId: id, origen: r.origen, destino: r.destino }));
                }}
              />
              <BuscadorSimple
                etiqueta={`Origen${rutaSugerida(tarifasAlta.find((t) => t.id === alta.tarifaId)?.nombre || '').obligatorio ? ' *' : ''}`}
                opciones={municipiosAlta}
                valor={alta.origen}
                onElegir={(id) => setAlta((p) => ({ ...p, origen: id }))}
              />
              <BuscadorSimple
                etiqueta={`Destino${rutaSugerida(tarifasAlta.find((t) => t.id === alta.tarifaId)?.nombre || '').obligatorio ? ' *' : ''}`}
                opciones={municipiosAlta}
                valor={alta.destino}
                onElegir={(id) => setAlta((p) => ({ ...p, destino: id }))}
              />
              <label className="dcv-edit-label">Costo de la Tarifa
                {/* ✅ V00233: entero y de 25 en 25 */}
                <input
                  type="number" step={25} min={0}
                  className="form-control"
                  value={alta.costo}
                  onChange={(e) => setAlta((p) => ({ ...p, costo: e.target.value.replace(/[^0-9]/g, '') }))}
                />
              </label>
              <label className="dcv-edit-label">Cotizado En
                <select className="form-control" value={alta.moneda} onChange={(e) => setAlta((p) => ({ ...p, moneda: e.target.value }))}>
                  <option value="">Selecciona una moneda</option>
                  {(monedasCat.length > 0 ? monedasCat : ['Pesos', 'Dólares']).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="dcv-edit-label">Status
                <select className="form-control" value={alta.status} onChange={(e) => setAlta((p) => ({ ...p, status: e.target.value }))}>
                  {ESTADOS_DETALLE.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </label>
            </div>

            <div className="dcv-modal-pie dcv-modal-pie-edit">
              <button type="button" className="btn btn-outline" disabled={guardandoAlta} onClick={() => setModalAgregar(false)}>Cancelar</button>
              <button type="button" className="btn dcv-btn-guardar-edit" disabled={guardandoAlta} onClick={guardarAlta}>{guardandoAlta ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ V00215: MODAL — unir duplicados eligiendo cuál se conserva */}
      {modalUnir && (
        <div className="modal-overlay" onClick={() => !uniendo && setModalUnir(false)}>
          <div className="dcv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dcv-modal-encabezado">
              <div>
                <h3 className="dcv-modal-titulo">Unir convenios duplicados</h3>
                <p className="dcv-modal-sub">Elige cuál se conserva. Las operaciones de los demás quedarán apuntando a ése y los otros se irán a la Papelera.</p>
              </div>
              <button type="button" className="dcv-cerrar" onClick={() => !uniendo && setModalUnir(false)}>✕</button>
            </div>
            <div className="dcv-unir-lista">
              {Array.from(seleccion).map((id) => {
                const f = (filas || []).find((x) => x.id === id);
                if (!f) return null;
                const usos = (usosOps[id] || []).length;
                return (
                  <label key={id} className={`dcv-unir-opcion ${conservarId === id ? 'dcv-unir-elegida' : ''}`}>
                    <input type="radio" name="conservar" checked={conservarId === id} onChange={() => setConservarId(id)} />
                    <span className="dcv-x10">{f.consecutivo || f.id}</span>
                    <span className="dcv-unir-tarifa">{f.tarifa}</span>
                    <span className="dcv-unir-costo">{f.costo ?? 0} {f.moneda || '—'}</span>
                    <span className="dcv-unir-usos">{usos} op.</span>
                  </label>
                );
              })}
            </div>
            <div className="dcv-modal-pie dcv-modal-pie-edit">
              <button type="button" className="btn btn-outline" disabled={uniendo} onClick={() => setModalUnir(false)}>Cancelar</button>
              <button type="button" className="btn dcv-btn-guardar-edit" disabled={uniendo || !conservarId} onClick={unirSeleccionados}>{uniendo ? 'Uniendo…' : 'Unir'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ V00207: MODAL DE EDICIÓN — corrige tarifa (No identificados), cotizado en, status y costo */}
      {editando && (
        <div className="modal-overlay" onClick={() => !guardandoEdicion && setEditando(null)}>
          <div className="dcv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dcv-modal-encabezado">
              <div>
                <h3 className="dcv-modal-titulo">Editar detalle <span className="dcv-x10">{editando.consecutivo || editando.id}</span></h3>
                <p className="dcv-modal-sub">{editando.entidad}{!editando.identificada && ' · Este detalle está como "No identificado": elige la tarifa correcta y guarda.'}</p>
              </div>
              <button type="button" className="dcv-cerrar" onClick={() => !guardandoEdicion && setEditando(null)}>✕</button>
            </div>
            <div className="dcv-alta-campos">
              {/* ✅ V00232: mismos campos y buscadores que el alta */}
              <BuscadorSimple
                etiqueta="Tarifa (catálogo)"
                opciones={tarifasAlta.length > 0 ? tarifasAlta : tarifasLista}
                valor={editForm.tarifaId}
                onElegir={(id) => {
                  const t = (tarifasAlta.length > 0 ? tarifasAlta : tarifasLista).find((x) => x.id === id);
                  const r = rutaSugerida(t?.nombre || '');
                  setEditForm((p) => ({ ...p, tarifaId: id, origen: r.origen || p.origen, destino: r.destino || p.destino }));
                }}
              />
              <BuscadorSimple etiqueta="Origen" opciones={municipiosAlta} valor={editForm.origen} onElegir={(id) => setEditForm((p) => ({ ...p, origen: id }))} />
              <BuscadorSimple etiqueta="Destino" opciones={municipiosAlta} valor={editForm.destino} onElegir={(id) => setEditForm((p) => ({ ...p, destino: id }))} />
              <label className="dcv-edit-label">Cotizado En
                <select className="form-control" value={editForm.moneda} onChange={(e) => setEditForm((p) => ({ ...p, moneda: e.target.value }))}>
                  <option value="">— Sin moneda —</option>
                  {(monedasCat.length > 0 ? monedasCat : ['Pesos', 'Dólares']).map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="dcv-edit-label">Status
                <select className="form-control" value={editForm.status} onChange={(e) => setEditForm((p) => ({ ...p, status: e.target.value }))}>
                  {ESTADOS_DETALLE.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              </label>
              <label className="dcv-edit-label">Costo de la Tarifa
                <input type="number" step="0.01" min="0" className="form-control" value={editForm.costo} onChange={(e) => setEditForm((p) => ({ ...p, costo: e.target.value }))} />
              </label>
            </div>
            <div className="dcv-modal-pie dcv-modal-pie-edit">
              <button type="button" className="btn btn-outline" disabled={guardandoEdicion} onClick={() => setEditando(null)}>Cancelar</button>
              <button type="button" className="btn dcv-btn-guardar-edit" disabled={guardandoEdicion} onClick={guardarEdicion}>{guardandoEdicion ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ✅ V00206: MODAL — operaciones que han usado este convenio */}
      {usoAbierto && (
        <div className="modal-overlay" onClick={() => setUsoAbierto(null)}>
          <div className="dcv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dcv-modal-encabezado">
              <div>
                <h3 className="dcv-modal-titulo">Uso del convenio <span className="dcv-x10">{usoAbierto.consecutivo || usoAbierto.numeroConvenio || usoAbierto.id}</span></h3>
                <p className="dcv-modal-sub">{usoAbierto.entidad} · {usoAbierto.tarifa}</p>
              </div>
              <button type="button" className="dcv-cerrar" onClick={() => setUsoAbierto(null)}>✕</button>
            </div>
            {/* ✅ V00231: ficha completa del convenio */}
            <div className="dcv-ficha">
              <div><span className="dcv-x1lbl">Consecutivo</span><b className="dcv-x10">{usoAbierto.consecutivo || usoAbierto.id}</b></div>
              <div><span className="dcv-x1lbl">{ETIQUETA_ENTIDAD}</span><b>{usoAbierto.entidad}</b></div>
              <div><span className="dcv-x1lbl">Tarifa</span><b>{usoAbierto.tarifa}</b></div>
              <div><span className="dcv-x1lbl">Origen</span><b>{usoAbierto.origen || '—'}</b></div>
              <div><span className="dcv-x1lbl">Destino</span><b>{usoAbierto.destino || '—'}</b></div>
              <div><span className="dcv-x1lbl">Costo</span><b>{usoAbierto.costo ?? '—'} {usoAbierto.moneda || ''}</b></div>
              <div><span className="dcv-x1lbl">Status</span><b>{usoAbierto.status || 'Aprobado'}</b></div>
              <div><span className="dcv-x1lbl">Convenio</span><b>{usoAbierto.numeroConvenio || '—'}</b></div>
              <div className="dcv-ficha-ancho">
                {/* ✅ V00232: fecha Y dónde se usó por última vez */}
                <span className="dcv-x1lbl">Último uso en operaciones</span>
                {(() => {
                  const ult = [...(usosOps[usoAbierto.id] || [])].filter((o) => o.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(-1)[0];
                  if (!ult) return <b>Sin uso registrado</b>;
                  return (
                    <b>
                      {ult.fecha} · <button type="button" className="dcv-ref-link" onClick={() => editarOperacion(ult)}>{ult.ref}</button>
                      {ult.tipo ? ` · ${ult.tipo}` : ''}{ult.status ? ` · ${ult.status}` : ''}
                    </b>
                  );
                })()}
              </div>
            </div>

            <p className="dcv-uso-total">
              {/* ✅ V00218: son las operaciones de ESTE convenio, todas del mismo cliente/proveedor */}
              <b>{usoAbierto.entidad}</b> · usado en <b>{(usosOps[usoAbierto.id] || []).length}</b> operación(es).
            </p>
            {(usosOps[usoAbierto.id] || []).length > 0 && (
              <div className="dcv-modal-marco">
                <table className="dcv-tabla-usos">
                  {/* ✅ V00218: detalle completo de las operaciones de ese convenio */}
                  <thead><tr><th>REF</th><th>FECHA</th><th>TIPO</th><th>STATUS</th><th className="dcv-usos-monto">MONTO</th></tr></thead>
                  <tbody>
                    {(usosOps[usoAbierto.id] || []).map((o, i) => (
                      <tr key={`${o.ref}-${i}`}>
                        {/* ✅ V00232: al hacer clic se abre su formulario de edición */}
                        <td><button type="button" className="dcv-ref-link" title={`Editar ${o.ref}`} onClick={() => editarOperacion(o)}>{o.ref || '—'}</button></td>
                        <td>{o.fecha || '—'}</td>
                        <td>{o.tipo || '—'}</td>
                        <td>{o.status || '—'}</td>
                        <td className="dcv-usos-monto">{o.monto ? `$${Number(o.monto).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="dcv-modal-pie">
              <button type="button" className="btn btn-outline" onClick={() => setUsoAbierto(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DetallesConvenioDashboard;

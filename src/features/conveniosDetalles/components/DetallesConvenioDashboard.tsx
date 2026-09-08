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
//     Convenios Inactivos (vencidos sin Baja) · No identificados (la tarifa
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

import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db as dbFs, eliminarRegistro } from '../../../config/firebase';
import { db } from '../../../config/firebase';
import { obtenerCacheMemoria, guardarCacheMemoria } from '../../../utils/cacheMemoria';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos'; // ✅ V00198
import './DetallesConvenioDashboard.css';

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
  const [usosOps, setUsosOps] = useState<Record<string, { ref: string; fecha: string; status: string }[]>>({});
  const [usoAbierto, setUsoAbierto] = useState<FilaDetalle | null>(null);
  // ✅ V00207: selección múltiple para borrado masivo (solo clientes)
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [borrandoSel, setBorrandoSel] = useState(false);
  // ✅ V00207: catálogo de tarifas para CORREGIR los "No identificados"
  const [tarifasLista, setTarifasLista] = useState<{ id: string; nombre: string }[]>([]);
  // ✅ V00207: edición en modal (lápiz al inicio de la fila)
  const [editando, setEditando] = useState<FilaDetalle | null>(null);
  const [editForm, setEditForm] = useState<{ tarifaId: string; moneda: string; status: string; costo: string }>({ tarifaId: '', moneda: '', status: '', costo: '' });
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

  // ✅ V00207: EDICIÓN EN MODAL (lápiz) — también corrige los "No identificados"
  //   asignando la tarifa correcta del catálogo.
  const abrirEdicion = (f: FilaDetalle) => {
    setEditForm({ tarifaId: f.tarifaId || '', moneda: String(f.moneda || ''), status: String(f.status || 'Aprobado'), costo: String(f.costo ?? '') });
    setEditando(f);
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
      const cambiosDoc: Record<string, unknown> = {
        moneda: editForm.moneda,
        status: editForm.status,
        tarifa: parseFloat(editForm.costo) || 0,
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
      // ✅ V00206: operaciones que usan cada detalle (solo clientes; op.convenio = id del detalle)
      if (esClientes) {
        try {
          const snapOps = await getDocs(collection(db, 'operaciones'));
          const mapa: Record<string, { ref: string; fecha: string; status: string }[]> = {};
          snapOps.docs.forEach((d) => {
            const o = d.data() as Record<string, unknown>;
            const conv = String(o.convenio || '').trim();
            if (!conv) return;
            if (!mapa[conv]) mapa[conv] = [];
            mapa[conv].push({
              ref: String(o.ref || d.id.substring(0, 6)),
              fecha: String(o.fechaServicio || ''),
              status: String(o.status || o.estatus || ''),
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
    // ✅ V00197: filtro por pestaña (solo clientes)
    if (esClientes) {
      const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const noIdent = (f: FilaDetalle) => !f.identificada || norm(f.tarifa).includes('no identificad');
      const vacia = (f: FilaDetalle) => f.costo === null || f.costo === 0; // ✅ V00207: solo costo
      const sinCotizacion = (f: FilaDetalle) => !String(f.moneda || '').trim(); // ✅ V00207
      if (pestana === 'Convenios Activos') lista = lista.filter((f) => f.statusConvenio !== 'Baja' && !f.vencido);
      else if (pestana === 'Convenios Inactivos') lista = lista.filter((f) => f.statusConvenio !== 'Baja' && f.vencido);
      else if (pestana === 'No identificados') lista = lista.filter(noIdent);
      else if (pestana === 'Vacíos') lista = lista.filter(vacia);
      else if (pestana === 'Sin cotización') lista = lista.filter(sinCotizacion);
    }
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
  }, [filas, busqueda, ordenAsc, esClientes, pestana]);

  
  return (
    <div className="module-container dcv-x1">
      <h1 className="module-title">Detalles del Convenio — {esClientes ? 'Clientes' : 'Proveedores'}</h1>
      <p className="dcv-x2">
        Índice de todas las tarifas capturadas en los convenios de {esClientes ? 'clientes' : 'proveedores'}.
        Para editar una tarifa, ábrela desde su convenio en el módulo de Convenios.
      </p>

      {/* ✅ V00197: pestañas (solo clientes) */}
      {esClientes && (
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
        {esClientes && seleccion.size > 0 && (
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
                {/* ✅ V00207 (clientes): checkbox de selección + ACCIONES al inicio */}
                {esClientes && (
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
                {esClientes && <th>Acciones</th>}
                {/* ✅ V00196 (clientes): CONSECUTIVO reemplaza a ID y Convenio; Moneda → "Cotizado En" */}
                {esClientes ? <th>Consecutivo</th> : <><th>ID</th><th>Convenio</th></>}
                <th>{ETIQUETA_ENTIDAD}</th>
                <th>Tarifa</th>
                <th>{esClientes ? 'Cotizado En' : 'Moneda'}</th>
                {esClientes && <th>Status</th>}{/* ✅ V00199 */}
                {esClientes && <th>Operaciones</th>}{/* ✅ V00206: veces usado */}
                <th className="dcv-x8">Costo de la Tarifa</th>
                {!esClientes && <th className="dcv-x8">Acciones</th>}{/* ✅ V00207: en clientes van al inicio */}
              </tr>
            </thead>
            <tbody>
              {filasVisibles.map((f) => (
                /* ✅ V00206: clic en la fila = ver en cuántas operaciones se usó */
                <tr key={f.id} className={esClientes ? 'dcv-fila-click' : ''} onClick={() => esClientes && setUsoAbierto(f)}>
                  {esClientes && (
                    /* ✅ V00207: checkbox de selección para borrado masivo */
                    <td className="dcv-th-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={seleccion.has(f.id)}
                        onChange={(e) => setSeleccion((prev) => { const s = new Set(prev); if (e.target.checked) s.add(f.id); else s.delete(f.id); return s; })}
                      />
                    </td>
                  )}
                  {esClientes && (
                    /* ✅ V00207: editar (corrige tarifa/No identificado) y eliminar AL INICIO */
                    <td className="dcv-td-acciones" onClick={(e) => e.stopPropagation()}>
                      <button className="btn-small btn-edit dcv-mr6" title="Editar este detalle (tarifa, cotizado en, status y costo)" onClick={() => abrirEdicion(f)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg></button>
                      <button className="btn-small btn-danger" title="Eliminar (va a la Papelera de Reciclaje)" onClick={() => eliminarDetalle(f.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>
                    </td>
                  )}
                  {esClientes
                    ? <td className="dcv-x10" title={`Convenio ${f.numeroConvenio} · id ${f.id}`}>{f.consecutivo || '—'}</td>
                    : <><td className="dcv-x9" title={f.id}>{f.id}</td><td className="dcv-x10">{f.numeroConvenio}</td></>}
                  <td>{f.entidad}</td>
                  <td>{f.tarifa}</td>
                  <td onClick={(e) => e.stopPropagation()}>{(() => { const val = String(cambios[f.id]?.moneda ?? f.moneda ?? ''); const ops = monedasCat.length > 0 ? monedasCat : ['Pesos', 'Dólares']; const lista = val && !ops.includes(val) ? [...ops, val] : ops; return (
                    <select className="form-control dcv-select-moneda" value={val} onChange={(e) => marcarCambio(f.id, 'moneda', e.target.value)}>
                      <option value="">— Sin moneda —</option>
                      {lista.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>); })()}</td>
                  {esClientes && (
                    /* ✅ V00199: status editable del detalle (se guarda con "Guardar cambios") */
                    <td onClick={(e) => e.stopPropagation()}>
                      {/* ✅ V00202: vacío = Aprobado (estar en Detalles implica aprobado) */}
                      <select className="form-control dcv-select-moneda" value={String(cambios[f.id]?.status ?? (f.status || 'Aprobado'))} onChange={(e) => marcarCambio(f.id, 'status', e.target.value)}>
                        {ESTADOS_DETALLE.map((st) => <option key={st} value={st}>{st}</option>)}
                      </select>
                    </td>
                  )}
                  {esClientes && (
                    /* ✅ V00206: total de operaciones que usaron este convenio */
                    <td className="dcv-td-usos">{(usosOps[f.id] || []).length}</td>
                  )}
                  <td className="dcv-x8" onClick={(e) => e.stopPropagation()}><input type="number" step="0.01" className="form-control dcv-input-costo" value={cambios[f.id]?.tarifa ?? (f.costo ?? 0)} onChange={(e) => marcarCambio(f.id, 'tarifa', parseFloat(e.target.value) || 0)} /></td>
                  {!esClientes && (
                    <td className="dcv-x8" onClick={(e) => e.stopPropagation()}><button className="btn-small btn-danger" title="Eliminar (va a la Papelera de Reciclaje)" onClick={() => eliminarDetalle(f.id)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="dcv-x11">Mostrando {filasVisibles.length} de {(filas || []).length} detalle(s)</div>

      {/* ✅ V00207: MODAL DE EDICIÓN — corrige tarifa (No identificados), cotizado en, status y costo */}
      {esClientes && editando && (
        <div className="modal-overlay" onClick={() => !guardandoEdicion && setEditando(null)}>
          <div className="dcv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dcv-modal-encabezado">
              <div>
                <h3 className="dcv-modal-titulo">Editar detalle <span className="dcv-x10">{editando.consecutivo || editando.id}</span></h3>
                <p className="dcv-modal-sub">{editando.entidad}{!editando.identificada && ' · Este detalle está como "No identificado": elige la tarifa correcta y guarda.'}</p>
              </div>
              <button type="button" className="dcv-cerrar" onClick={() => !guardandoEdicion && setEditando(null)}>✕</button>
            </div>
            <div className="dcv-edit-campos">
              <label className="dcv-edit-label">Tarifa
                <select className="form-control" value={editForm.tarifaId} onChange={(e) => setEditForm((p) => ({ ...p, tarifaId: e.target.value }))}>
                  <option value="">{editando.identificada ? `— Conservar: ${editando.tarifa} —` : '— Elegir la tarifa correcta —'}</option>
                  {tarifasLista.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
                </select>
              </label>
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
      {esClientes && usoAbierto && (
        <div className="modal-overlay" onClick={() => setUsoAbierto(null)}>
          <div className="dcv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dcv-modal-encabezado">
              <div>
                <h3 className="dcv-modal-titulo">Uso del convenio <span className="dcv-x10">{usoAbierto.consecutivo || usoAbierto.numeroConvenio || usoAbierto.id}</span></h3>
                <p className="dcv-modal-sub">{usoAbierto.entidad} · {usoAbierto.tarifa}</p>
              </div>
              <button type="button" className="dcv-cerrar" onClick={() => setUsoAbierto(null)}>✕</button>
            </div>
            <p className="dcv-uso-total">Usado en <b>{(usosOps[usoAbierto.id] || []).length}</b> operación(es).</p>
            {(usosOps[usoAbierto.id] || []).length > 0 && (
              <div className="dcv-modal-marco">
                <table className="dcv-tabla-usos">
                  <thead><tr><th>REF</th><th>FECHA DE SERVICIO</th><th>STATUS</th></tr></thead>
                  <tbody>
                    {(usosOps[usoAbierto.id] || []).map((o, i) => (
                      <tr key={`${o.ref}-${i}`}><td className="dcv-x10">{o.ref || '—'}</td><td>{o.fecha || '—'}</td><td>{o.status || '—'}</td></tr>
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

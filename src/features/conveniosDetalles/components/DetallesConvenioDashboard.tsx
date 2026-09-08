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

import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db as dbFs, eliminarRegistro } from '../../../config/firebase';
import { db } from '../../../config/firebase';
import { obtenerCacheMemoria, guardarCacheMemoria } from '../../../utils/cacheMemoria';
import './DetallesConvenioDashboard.css';

interface Props { tipo: 'clientes' | 'proveedores'; }

interface FilaDetalle {
  id: string;
  consecutivo: string; // ✅ V00196: CONV-001… del detalle (clientes)
  numeroConvenio: string;
  moneda: string;
  numeroOrden: number;
  entidad: string;      // cliente o proveedor según `tipo`
  tarifa: string;       // descripción de la tarifa de referencia
  costo: number | null;
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
  // ✅ V00197: pestañas (solo clientes)
  const PESTANAS = ['Convenios Activos', 'Convenios Cancelados', 'Convenios Inactivos', 'No identificados', 'Vacíos'] as const;
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>('Convenios Activos');
  // ✅ NUEVO (V00122): edición en línea (varios de golpe) + eliminar con papelera
  const [cambios, setCambios] = useState<Record<string, { tarifa?: number; moneda?: string }>>({});
  const [guardando, setGuardando] = useState(false);
  // ✅ NUEVO (V00123): monedas desde el CATÁLOGO (nada hardcodeado)
  const [monedasCat, setMonedasCat] = useState<string[]>([]);
  const marcarCambio = (id: string, campo: 'tarifa' | 'moneda', v: number | string) =>
    setCambios((prev) => ({ ...prev, [id]: { ...prev[id], [campo]: v as never } }));
  const guardarCambios = async () => {
    const ids = Object.keys(cambios);
    if (ids.length === 0 || guardando) return;
    setGuardando(true);
    try {
      for (const id of ids) await updateDoc(doc(dbFs, COL_DETALLES, id), { ...cambios[id] } as Record<string, unknown>);
      setFilas((prev) => (prev || []).map((f) => cambios[f.id] ? { ...f, costo: cambios[f.id].tarifa ?? f.costo, moneda: String(cambios[f.id].moneda ?? f.moneda) } : f));
      setCambios({});
      alert(`Se guardaron ${ids.length} detalle(s). ✅`);
    } catch { alert('No se pudieron guardar todos los cambios.'); }
    setGuardando(false);
  };
  const eliminarDetalle = async (id: string) => {
    if (!window.confirm('¿Eliminar este detalle del convenio?\n\nSe enviará a la Papelera de Reciclaje (nota obligatoria).')) return;
    try {
      await eliminarRegistro(COL_DETALLES, id, { modulo: 'Detalles del Convenio' });
      setFilas((prev) => (prev || []).filter((f) => f.id !== id));
    } catch { /* cancelado o error: sin cambios */ }
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

      const resultado: FilaDetalle[] = snapDet.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const conv = convenios[String(x.convenioId || '')] || { numero: '', entidad: '', moneda: '', status: 'Activo', vencido: false };
        const idTarifa = String(x.tipoConvenioId || '');
        const crudoCosto = (x.costo !== undefined && x.costo !== null && x.costo !== '') ? x.costo : x.tarifa; // ✅ V00122: los detalles guardan `tarifa`
        const costoNum = (crudoCosto === undefined || crudoCosto === null || crudoCosto === '') ? null : Number(crudoCosto);
        return {
          id: d.id,
          consecutivo: String(x.consecutivo || ''), // ✅ V00196
          numeroConvenio: conv.numero || '—',
          numeroOrden: parseInt(String(conv.numero || '').replace(/\D/g, ''), 10) || 0,
          entidad: conv.entidad || '—',
          // ✅ CORREGIDO (V00126): la moneda del DETALLE manda; la del maestro solo es respaldo.
          //   Antes se mostraba siempre la del maestro, por lo que el cambio guardado parecía "revertirse".
          moneda: String(x.moneda || ''),
          tarifa: tarifas[idTarifa] || String(x.tipoConvenioNombre || '') || '—',
          costo: costoNum !== null && !isNaN(costoNum) ? costoNum : null,
          // ✅ V00197: datos para las pestañas
          statusConvenio: conv.status,
          vencido: conv.vencido,
          identificada: !!(tarifas[idTarifa] || String(x.tipoConvenioNombre || '').trim()),
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
      const vacia = (f: FilaDetalle) => f.costo === null || f.costo === 0 || !String(f.moneda || '').trim();
      if (pestana === 'Convenios Activos') lista = lista.filter((f) => f.statusConvenio !== 'Baja' && !f.vencido);
      else if (pestana === 'Convenios Cancelados') lista = lista.filter((f) => f.statusConvenio === 'Baja');
      else if (pestana === 'Convenios Inactivos') lista = lista.filter((f) => f.statusConvenio !== 'Baja' && f.vencido);
      else if (pestana === 'No identificados') lista = lista.filter(noIdent);
      else if (pestana === 'Vacíos') lista = lista.filter(vacia);
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
                {/* ✅ V00196 (clientes): CONSECUTIVO reemplaza a ID y Convenio; Moneda → "Cotizado En" */}
                {esClientes ? <th>Consecutivo</th> : <><th>ID</th><th>Convenio</th></>}
                <th>{ETIQUETA_ENTIDAD}</th>
                <th>Tarifa</th>
                <th>{esClientes ? 'Cotizado En' : 'Moneda'}</th>
                <th className="dcv-x8">Costo de la Tarifa</th>
                <th className="dcv-x8">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.map((f) => (
                <tr key={f.id}>
                  {esClientes
                    ? <td className="dcv-x10" title={`Convenio ${f.numeroConvenio} · id ${f.id}`}>{f.consecutivo || '—'}</td>
                    : <><td className="dcv-x9" title={f.id}>{f.id}</td><td className="dcv-x10">{f.numeroConvenio}</td></>}
                  <td>{f.entidad}</td>
                  <td>{f.tarifa}</td>
                  <td>{(() => { const val = String(cambios[f.id]?.moneda ?? f.moneda ?? ''); const ops = monedasCat.length > 0 ? monedasCat : ['Pesos', 'Dólares']; const lista = val && !ops.includes(val) ? [...ops, val] : ops; return (
                    <select className="form-control dcv-select-moneda" value={val} onChange={(e) => marcarCambio(f.id, 'moneda', e.target.value)}>
                      <option value="">— Sin moneda —</option>
                      {lista.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>); })()}</td>
                  <td className="dcv-x8"><input type="number" step="0.01" className="form-control dcv-input-costo" value={cambios[f.id]?.tarifa ?? (f.costo ?? 0)} onChange={(e) => marcarCambio(f.id, 'tarifa', parseFloat(e.target.value) || 0)} /></td>
                  <td className="dcv-x8"><button className="btn-small btn-danger" title="Eliminar (va a la Papelera de Reciclaje)" onClick={() => eliminarDetalle(f.id)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="dcv-x11">Mostrando {filasVisibles.length} de {(filas || []).length} detalle(s)</div>
    </div>
  );
};

export default DetallesConvenioDashboard;

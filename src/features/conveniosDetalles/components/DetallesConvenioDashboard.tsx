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

import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, doc, updateDoc } from 'firebase/firestore';
import { db as dbFs, eliminarRegistro } from '../../../config/firebase';
import { db } from '../../../config/firebase';
import { obtenerCacheMemoria, guardarCacheMemoria } from '../../../utils/cacheMemoria';
import './DetallesConvenioDashboard.css';

interface Props { tipo: 'clientes' | 'proveedores'; }

interface FilaDetalle {
  id: string;
  numeroConvenio: string;
  moneda: string;
  numeroOrden: number;
  entidad: string;      // cliente o proveedor según `tipo`
  tarifa: string;       // descripción de la tarifa de referencia
  costo: number | null;
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
  // ✅ NUEVO (V00122): edición en línea (varios de golpe) + eliminar con papelera
  const [cambios, setCambios] = useState<Record<string, { tarifa?: number; moneda?: string }>>({});
  const [guardando, setGuardando] = useState(false);
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
      const [snapConv, snapDet, snapTar] = await Promise.all([
        getDocs(collection(db, COL_CONVENIOS)),
        getDocs(collection(db, COL_DETALLES)),
        getDocs(collection(db, 'catalogo_tarifas_referencia')),
      ]);

      const convenios: Record<string, { numero: string; entidad: string; moneda: string }> = {};
      snapConv.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        convenios[d.id] = {
          numero: String(x.numeroConvenio || ''),
          entidad: String(x[CAMPO_ENTIDAD] || ''),
          moneda: String(x.monedaNombre || ''), // ✅ NUEVO (V00119)
        };
      });

      const tarifas: Record<string, string> = {};
      snapTar.docs.forEach((d) => {
        const x = d.data() as Record<string, unknown>;
        tarifas[d.id] = String(x.descripcion || '');
      });

      const resultado: FilaDetalle[] = snapDet.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        const conv = convenios[String(x.convenioId || '')] || { numero: '', entidad: '', moneda: '' };
        const idTarifa = String(x.tipoConvenioId || '');
        const crudoCosto = (x.costo !== undefined && x.costo !== null && x.costo !== '') ? x.costo : x.tarifa; // ✅ V00122: los detalles guardan `tarifa`
        const costoNum = (crudoCosto === undefined || crudoCosto === null || crudoCosto === '') ? null : Number(crudoCosto);
        return {
          id: d.id,
          numeroConvenio: conv.numero || '—',
          numeroOrden: parseInt(String(conv.numero || '').replace(/\D/g, ''), 10) || 0,
          entidad: conv.entidad || '—',
          moneda: conv.moneda || '—', // ✅ NUEVO (V00119)
          tarifa: tarifas[idTarifa] || String(x.tipoConvenioNombre || '') || '—',
          costo: costoNum !== null && !isNaN(costoNum) ? costoNum : null,
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
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter((f) =>
        `${f.id} ${f.numeroConvenio} ${f.entidad} ${f.tarifa} ${f.moneda} ${f.costo ?? ''}`.toLowerCase().includes(b)
      );
    }
    return [...lista].sort((a, b) => {
      const dif = a.numeroOrden - b.numeroOrden;
      const base = dif !== 0 ? dif : a.numeroConvenio.localeCompare(b.numeroConvenio);
      return ordenAsc ? base : -base;
    });
  }, [filas, busqueda, ordenAsc]);

  
  return (
    <div className="module-container dcv-x1">
      <h1 className="module-title">Detalles del Convenio — {esClientes ? 'Clientes' : 'Proveedores'}</h1>
      <p className="dcv-x2">
        Índice de todas las tarifas capturadas en los convenios de {esClientes ? 'clientes' : 'proveedores'}.
        Para editar una tarifa, ábrela desde su convenio en el módulo de Convenios.
      </p>

      <div className="dcv-x3">
        <input
          className="form-input-elegante dcv-x4"
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
          Convenio {ordenAsc ? '↑' : '↓'}
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
                <th>ID</th>
                <th>Convenio</th>
                <th>{ETIQUETA_ENTIDAD}</th>
                <th>Tarifa</th>
                <th>Moneda</th>
                <th className="dcv-x8">Costo de la Tarifa</th>
                <th className="dcv-x8">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filasVisibles.map((f) => (
                <tr key={f.id}>
                  <td className="dcv-x9" title={f.id}>{f.id}</td>
                  <td className="dcv-x10">{f.numeroConvenio}</td>
                  <td>{f.entidad}</td>
                  <td>{f.tarifa}</td>
                  <td><select className="form-input-elegante" style={{ padding: '4px 6px', width: '100px' }} value={String(cambios[f.id]?.moneda ?? f.moneda ?? 'Pesos')} onChange={(e) => marcarCambio(f.id, 'moneda', e.target.value)}><option value="Pesos">Pesos</option><option value="Dólares">Dólares</option><option value="Dolares">Dolares</option><option value="—">—</option></select></td>
                  <td className="dcv-x8"><input type="number" step="0.01" className="form-input-elegante" style={{ width: '110px', padding: '4px 8px', textAlign: 'right' }} value={cambios[f.id]?.tarifa ?? (f.costo ?? 0)} onChange={(e) => marcarCambio(f.id, 'tarifa', parseFloat(e.target.value) || 0)} /></td>
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

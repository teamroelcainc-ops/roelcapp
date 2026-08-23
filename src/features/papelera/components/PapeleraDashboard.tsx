// src/features/papelera/components/PapeleraDashboard.tsx
//
// ✅ NUEVO (V00115) — PAPELERA DE RECICLAJE GLOBAL.
//   Todo registro eliminado en la app (vía el helper central o los borrados
//   en lote que copian con payloadPapeleraGlobal) queda aquí con: quién lo
//   eliminó, cuándo, de qué colección/módulo, la NOTA obligatoria y una copia
//   COMPLETA de los datos. La restauración usa setDoc con el ID ORIGINAL, así
//   el registro vuelve exactamente como estaba y las referencias vivas se
//   reconectan. También lee la colección legada `papelera_catalogos` (lo
//   eliminado entre V00106 y V00114) para no perder ese historial.

import React, { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, getDoc, setDoc, deleteDoc, doc, writeBatch } from 'firebase/firestore';
import { db, COL_PAPELERA_GLOBAL } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import './PapeleraDashboard.css';

const COL_LEGADA = 'papelera_catalogos';

interface ItemPapelera {
  id: string;
  origen: string;            // colección de la papelera de donde se leyó
  coleccion: string;         // colección original del registro
  registroId: string;
  datos: Record<string, unknown>;
  motivo: string;
  modulo: string;
  eliminadoPor: string;
  eliminadoEn: string;
}

const PapeleraDashboard: React.FC = () => {
  const [items, setItems] = useState<ItemPapelera[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [filtroColeccion, setFiltroColeccion] = useState('');
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null);
  const [vaciando, setVaciando] = useState(false);

  const cargar = async () => {
    if (cargando) return;
    setCargando(true);
    try {
      const [snapGlobal, snapLegada] = await Promise.all([
        getDocs(collection(db, COL_PAPELERA_GLOBAL)),
        getDocs(collection(db, COL_LEGADA)),
      ]);
      const mapear = (d: { id: string; data: () => Record<string, unknown> }, origen: string): ItemPapelera => {
        const x = d.data();
        return {
          id: d.id,
          origen,
          coleccion: String(x.coleccion || ''),
          registroId: String(x.registroId || ''),
          datos: (x.datos as Record<string, unknown>) || {},
          motivo: String(x.motivo || ''),
          modulo: String(x.modulo || x.catalogoTitulo || x.coleccion || ''),
          eliminadoPor: String(x.eliminadoPor || '—'),
          eliminadoEn: String(x.eliminadoEn || ''),
        };
      };
      const todos = [
        ...snapGlobal.docs.map((d) => mapear(d, COL_PAPELERA_GLOBAL)),
        ...snapLegada.docs.map((d) => mapear(d, COL_LEGADA)),
      ].sort((a, b) => b.eliminadoEn.localeCompare(a.eliminadoEn));
      setItems(todos);
    } catch (e) {
      console.error('Error cargando la papelera de reciclaje:', e);
      setItems([]);
      alert('No se pudo cargar la Papelera de Reciclaje. Revisa tu conexión.');
    }
    setCargando(false);
  };

  useEffect(() => { cargar(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const colecciones = useMemo(
    () => Array.from(new Set((items || []).map((i) => i.coleccion).filter(Boolean))).sort(),
    [items]
  );

  const resumen = (item: ItemPapelera): string => {
    const vals = Object.values(item.datos || {})
      .map((v) => (v && typeof v === 'object' && (v as { id?: unknown }).id) ? String((v as { id?: unknown }).id) : String(v ?? ''))
      .filter((v) => v && v !== 'undefined' && v !== '[object Object]' && v.length < 80);
    return vals.slice(0, 3).join(' · ') || item.registroId || '—';
  };

  const visibles = useMemo(() => {
    let lista = items || [];
    if (filtroColeccion) lista = lista.filter((i) => i.coleccion === filtroColeccion);
    if (busqueda.trim()) {
      const b = busqueda.toLowerCase();
      lista = lista.filter((i) =>
        `${i.registroId} ${i.coleccion} ${i.modulo} ${i.motivo} ${i.eliminadoPor} ${resumen(i)}`.toLowerCase().includes(b)
      );
    }
    return lista;
  }, [items, busqueda, filtroColeccion]);

  const restaurar = async (item: ItemPapelera) => {
    if (restaurandoId || !item.coleccion || !item.registroId) return;
    setRestaurandoId(item.id);
    try {
      const destino = doc(db, item.coleccion, item.registroId);
      const existente = await getDoc(destino);
      if (existente.exists()) {
        const sobre = window.confirm(
          `Ya existe un registro con el mismo ID en "${item.coleccion}".\n\n¿Deseas SOBRESCRIBIRLO con la copia de la papelera?`
        );
        if (!sobre) { setRestaurandoId(null); return; }
      }
      // Restauración EXACTA: mismo ID, mismos datos (sin transformación alguna).
      await setDoc(destino, item.datos || {});
      await deleteDoc(doc(db, item.origen, item.id));
      setItems((prev) => (prev || []).filter((x) => x.id !== item.id));
      try { await registrarLog('Papelera de Reciclaje', 'Restauración', `Restauró el registro ${item.registroId} en ${item.coleccion} (${item.modulo})`); } catch { /* no romper */ }
      alert(`Registro restaurado en "${item.coleccion}" con su ID original y sus datos íntegros. ✅`);
    } catch (e) {
      console.error('Error restaurando:', e);
      alert('No se pudo restaurar el registro. Revisa tu conexión e inténtalo de nuevo.');
    }
    setRestaurandoId(null);
  };

  const eliminarDefinitivo = async (item: ItemPapelera) => {
    if (!window.confirm('¿Eliminar DEFINITIVAMENTE esta copia de la papelera?\n\nDespués de esto ya no se podrá restaurar.')) return;
    try {
      await deleteDoc(doc(db, item.origen, item.id));
      setItems((prev) => (prev || []).filter((x) => x.id !== item.id));
      try { await registrarLog('Papelera de Reciclaje', 'Eliminación', `Eliminó definitivamente el registro ${item.registroId} (${item.coleccion})`); } catch { /* no romper */ }
    } catch {
      alert('No se pudo eliminar de la papelera.');
    }
  };

  const vaciar = async () => {
    if (vaciando || visibles.length === 0) return;
    const ok = window.confirm(
      `¿Eliminar DEFINITIVAMENTE los ${visibles.length} registro(s) visibles de la papelera` +
      `${filtroColeccion ? ' (solo la colección filtrada)' : ''}?\n\nEsta acción no se puede deshacer.`
    );
    if (!ok) return;
    setVaciando(true);
    try {
      // Agrupa por colección de origen para respetar el batch por colección
      const porOrigen: Record<string, string[]> = {};
      visibles.forEach((i) => { (porOrigen[i.origen] = porOrigen[i.origen] || []).push(i.id); });
      for (const [origen, ids] of Object.entries(porOrigen)) {
        for (let i = 0; i < ids.length; i += 400) {
          const lote = ids.slice(i, i + 400);
          const batch = writeBatch(db);
          lote.forEach((id) => batch.delete(doc(db, origen, id)));
          await batch.commit();
        }
      }
      const idsBorrados = new Set(visibles.map((i) => i.id));
      setItems((prev) => (prev || []).filter((x) => !idsBorrados.has(x.id)));
      try { await registrarLog('Papelera de Reciclaje', 'Eliminación', `Vació ${idsBorrados.size} registro(s) de la papelera`); } catch { /* no romper */ }
    } catch {
      alert('No se pudo vaciar la papelera por completo. Vuelve a intentar.');
    }
    setVaciando(false);
  };

  return (
    <div className="module-container pr-x1">
      <h1 className="module-title">Papelera de Reciclaje</h1>
      <p className="pr-x2">
        Todo registro eliminado en la aplicación queda aquí con su nota obligatoria, quién lo eliminó y cuándo.
        Restaurar lo devuelve a su colección original con el mismo ID y sus datos íntegros.
      </p>

      <div className="pr-x3">
        <select className="form-input-elegante pr-x4" value={filtroColeccion} onChange={(e) => setFiltroColeccion(e.target.value)}>
          <option value="">Todas las colecciones</option>
          {colecciones.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          className="form-input-elegante pr-x5"
          type="text"
          placeholder="Buscar por registro, módulo, nota o usuario..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
        <button className="btn btn-outline" onClick={cargar} disabled={cargando} title="Volver a leer la papelera">
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
        <button
          className="btn pr-x6"
          onClick={vaciar}
          disabled={vaciando || visibles.length === 0}
          title="Elimina definitivamente todo lo visible (respeta el filtro)"
        >
          {vaciando ? 'Vaciando…' : `Vaciar (${visibles.length})`}
        </button>
      </div>

      {items === null ? (
        <div className="pr-x7">Cargando papelera…</div>
      ) : visibles.length === 0 ? (
        <div className="pr-x7">
          {busqueda || filtroColeccion ? 'Sin resultados con los filtros actuales.' : 'La papelera está vacía.'}
        </div>
      ) : (
        <div className="pr-x8">
          <table className="data-table pr-x9">
            <thead>
              <tr>
                <th className="pr-x10">Eliminado</th>
                <th>Módulo / Colección</th>
                <th>Registro</th>
                <th>Nota</th>
                <th>Eliminado por</th>
                <th className="pr-x11">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((item) => (
                <tr key={`${item.origen}_${item.id}`}>
                  <td className="pr-x12">
                    {item.eliminadoEn ? new Date(item.eliminadoEn).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                  </td>
                  <td>
                    <div className="pr-x13">{item.modulo}</div>
                    <div className="pr-x14">{item.coleccion}</div>
                  </td>
                  <td className="pr-x15" title={resumen(item)}>{resumen(item)}</td>
                  <td className="pr-x16" title={item.motivo}>{item.motivo || '—'}</td>
                  <td className="pr-x12">{item.eliminadoPor}</td>
                  <td className="pr-x11">
                    <button
                      className="btn btn-outline pr-x17"
                      onClick={() => restaurar(item)}
                      disabled={restaurandoId !== null}
                      title="Restaurar con su ID original y datos íntegros"
                    >
                      {restaurandoId === item.id ? 'Restaurando…' : 'Restaurar'}
                    </button>
                    <button className="btn-small btn-danger pr-x18" onClick={() => eliminarDefinitivo(item)} title="Eliminar definitivamente">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pr-x19">Mostrando {visibles.length} de {(items || []).length} registro(s) en la papelera</div>
    </div>
  );
};

export default PapeleraDashboard;

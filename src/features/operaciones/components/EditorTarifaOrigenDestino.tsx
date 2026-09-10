// src/features/operaciones/components/EditorTarifaOrigenDestino.tsx
// ---------------------------------------------------------------------------
// ✅ V00224 — Editor compartido de ORIGEN y DESTINO de las tarifas de
//   referencia usadas por una operación de FLETE (la del cliente y la del
//   proveedor). Se usa desde el formulario de la operación y desde el detalle
//   de Servicios Completados; el botón que lo abre depende del permiso
//   "Editar Tarifa (Origen/Destino)" en Roles y Permisos.
//
//   Al guardar: escribe origen/destino en la tarifa del catálogo, rearma su
//   descripción y propaga el nombre a los detalles de convenio que la usan.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import './EditorTarifaOrigenDestino.css';

type Municipio = { id: string; nombre: string };
type LadoTarifa = { tarifaId: string; descripcion: string; origen: string; destino: string } | null;

interface Props {
  /** Referencia visible de la operación (solo para el encabezado). */
  refOperacion: string;
  /** Id del detalle de convenio del CLIENTE (operacion.convenio). */
  detalleClienteId?: string;
  /** Id del detalle de convenio del PROVEEDOR (operacion.convenioProveedor). */
  detalleProveedorId?: string;
  onCerrar: () => void;
}

export function EditorTarifaOrigenDestino({ refOperacion, detalleClienteId, detalleProveedorId, onCerrar }: Props) {
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [municipios, setMunicipios] = useState<Municipio[]>([]);
  const [cliente, setCliente] = useState<LadoTarifa>(null);
  const [proveedor, setProveedor] = useState<LadoTarifa>(null);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const snapMun = await getDocs(collection(db, 'catalogo_municipios'));
        const lista = snapMun.docs
          .map((d) => ({ id: d.id, nombre: String((d.data() as Record<string, unknown>).municipio || '') }))
          .filter((m) => m.nombre)
          .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));

        const cargarLado = async (detalleId: string | undefined, coleccion: string): Promise<LadoTarifa> => {
          if (!detalleId) return null;
          const det = await getDoc(doc(db, coleccion, detalleId));
          if (!det.exists()) return null;
          const tarifaId = String((det.data() as Record<string, unknown>).tipoConvenioId || '');
          if (!tarifaId) return null;
          const tar = await getDoc(doc(db, 'catalogo_tarifas_referencia', tarifaId));
          if (!tar.exists()) return null;
          const t = tar.data() as Record<string, unknown>;
          return {
            tarifaId,
            descripcion: String(t.descripcion || ''),
            origen: String(t.origen || ''),
            destino: String(t.destino || ''),
          };
        };

        const [cli, prov] = await Promise.all([
          cargarLado(detalleClienteId, 'convenios_clientes_detalles'),
          cargarLado(detalleProveedorId, 'convenios_proveedores_detalles'),
        ]);
        if (!activo) return;
        setMunicipios(lista);
        setCliente(cli);
        setProveedor(prov);
      } catch (e) {
        console.error('No se pudieron cargar las tarifas de la operación:', e);
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
  }, [detalleClienteId, detalleProveedorId]);

  const nombreMun = (id: string) => municipios.find((m) => m.id === id)?.nombre || '';

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try {
      let actualizadas = 0;
      let propagados = 0;
      for (const lado of [cliente, proveedor]) {
        if (!lado?.tarifaId) continue;
        // Se conserva la descripción base y se le anexan los municipios elegidos
        // (quitando primero los que ya estuvieran al final).
        const partes = String(lado.descripcion || '').split(' - ').map((x) => x.trim()).filter(Boolean);
        const nombresMun = new Set(municipios.map((m) => m.nombre));
        const base = partes.filter((x) => !nombresMun.has(x));
        const nuevaDesc = [...base, nombreMun(lado.origen), nombreMun(lado.destino)].filter(Boolean).join(' - ');

        await updateDoc(doc(db, 'catalogo_tarifas_referencia', lado.tarifaId), {
          origen: lado.origen,
          destino: lado.destino,
          descripcion: nuevaDesc,
        });
        actualizadas += 1;

        for (const col of ['convenios_clientes_detalles', 'convenios_proveedores_detalles']) {
          const snap = await getDocs(query(collection(db, col), where('tipoConvenioId', '==', lado.tarifaId)));
          if (snap.empty) continue;
          const lote = writeBatch(db);
          snap.docs.forEach((d) => { lote.update(d.ref, { tipoConvenioNombre: nuevaDesc }); propagados += 1; });
          await lote.commit();
        }
      }
      await registrarLog('Operaciones', 'Edición', `Asignó origen/destino a ${actualizadas} tarifa(s) desde la operación ${refOperacion}.`);
      alert(`Tarifas actualizadas. ✅\n\n· Tarifas del catálogo: ${actualizadas}\n· Detalles de convenio actualizados: ${propagados}\n\nPara refrescar tarifarios y operaciones, corre "⟳ Rearmar descripciones" en Catálogos → Tarifas de Referencia.`);
      onCerrar();
    } catch (e) {
      console.error('No se pudo guardar el origen/destino de las tarifas:', e);
      alert('No se pudo guardar el origen y destino de las tarifas.');
    } finally {
      setGuardando(false);
    }
  };

  const bloque = (titulo: string, lado: LadoTarifa, set: (v: LadoTarifa) => void) => (
    <div className="eto-bloque">
      <div className="eto-lado">{titulo}</div>
      {!lado ? (
        <div className="eto-vacio">Esta operación no tiene tarifa identificada de este lado.</div>
      ) : (
        <>
          <div className="eto-nombre">{lado.descripcion || '—'}</div>
          <div className="eto-campos">
            <label className="eto-label">
              Origen
              <select className="form-control" value={lado.origen} onChange={(e) => set({ ...lado, origen: e.target.value })}>
                <option value="">— Sin origen —</option>
                {municipios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </label>
            <label className="eto-label">
              Destino
              <select className="form-control" value={lado.destino} onChange={(e) => set({ ...lado, destino: e.target.value })}>
                <option value="">— Sin destino —</option>
                {municipios.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </label>
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="modal-overlay eto-overlay" onClick={() => !guardando && onCerrar()}>
      <div className="eto-modal" onClick={(e) => e.stopPropagation()}>
        <div className="eto-head">
          <div>
            <h3 className="eto-tit">Origen y destino de las tarifas</h3>
            <p className="eto-sub">Operación {refOperacion} · se actualiza la tarifa del catálogo y su descripción</p>
          </div>
          <button type="button" className="eto-x" onClick={() => !guardando && onCerrar()}>✕</button>
        </div>

        {cargando ? (
          <div className="eto-vacio">Cargando tarifas…</div>
        ) : (
          <>
            {bloque('TARIFA DEL CLIENTE', cliente, setCliente)}
            {bloque('TARIFA DEL PROVEEDOR', proveedor, setProveedor)}
            <div className="eto-pie">
              <button type="button" className="btn btn-outline" disabled={guardando} onClick={onCerrar}>Cancelar</button>
              <button type="button" className="btn eto-guardar" disabled={guardando || (!cliente && !proveedor)} onClick={guardar}>
                {guardando ? 'Guardando…' : 'Guardar y propagar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default EditorTarifaOrigenDestino;

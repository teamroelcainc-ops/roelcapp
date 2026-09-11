// src/features/operaciones/components/EditorTarifaOrigenDestino.tsx
// ---------------------------------------------------------------------------
// ✅ V00224 — Editor compartido de ORIGEN y DESTINO de las tarifas de
//   referencia usadas por una operación de FLETE (la del cliente y la del
//   proveedor). Se usa desde el formulario de la operación y desde el detalle
//   de Servicios Completados; el botón que lo abre depende del permiso
//   "Editar Tarifa (Origen/Destino)" en Roles y Permisos.
//
//   ✅ V00230: los municipios se eligen con BUSCADOR (no lista desplegable) y
//   al guardar la nueva descripción se propaga a TODO: detalles de convenio
//   (clientes y proveedores), líneas de los tarifarios y nombre guardado en
//   las operaciones.
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

  // ✅ V00230: buscador de municipio (en vez de lista desplegable).
  const BuscadorMunicipio = ({ etiqueta, valor, onElegir }: { etiqueta: string; valor: string; onElegir: (id: string) => void }) => {
    const [texto, setTexto] = useState(nombreMun(valor));
    const [abierto, setAbierto] = useState(false);
    useEffect(() => { setTexto(nombreMun(valor)); }, [valor]);
    const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const sugerencias = texto.trim().length === 0
      ? municipios.slice(0, 12)
      : municipios.filter((m) => norm(m.nombre).includes(norm(texto))).slice(0, 12);
    return (
      <label className="eto-label">
        {etiqueta}
        <div className="eto-buscador">
          <input
            type="text"
            className="form-control"
            placeholder="Buscar municipio…"
            value={texto}
            onChange={(e) => { setTexto(e.target.value); setAbierto(true); }}
            onFocus={() => setAbierto(true)}
            onBlur={() => window.setTimeout(() => setAbierto(false), 150)}
          />
          {texto && (
            <button type="button" className="eto-limpiar" title="Quitar" onMouseDown={(e) => { e.preventDefault(); setTexto(''); onElegir(''); }}>✕</button>
          )}
          {abierto && sugerencias.length > 0 && (
            <div className="eto-sugerencias">
              {sugerencias.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="eto-sugerencia"
                  onMouseDown={(e) => { e.preventDefault(); onElegir(m.id); setTexto(m.nombre); setAbierto(false); }}
                >
                  {m.nombre}
                </button>
              ))}
            </div>
          )}
        </div>
      </label>
    );
  };

  const guardar = async () => {
    if (guardando) return;
    setGuardando(true);
    try {
      let actualizadas = 0;
      let propagados = 0;
      let tarifariosTocados = 0;
      let opsTocadas = 0;
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

        // 1) Detalles de convenio (clientes y proveedores) — y se recuerdan
        //    sus ids para actualizar después el nombre en las operaciones.
        const detallesTocados: string[] = [];
        for (const col of ['convenios_clientes_detalles', 'convenios_proveedores_detalles']) {
          const snap = await getDocs(query(collection(db, col), where('tipoConvenioId', '==', lado.tarifaId)));
          if (snap.empty) continue;
          const lote = writeBatch(db);
          snap.docs.forEach((d) => { lote.update(d.ref, { tipoConvenioNombre: nuevaDesc }); detallesTocados.push(d.id); propagados += 1; });
          await lote.commit();
        }

        // 2) ✅ V00230: líneas dentro de los TARIFARIOS que usan esta tarifa.
        for (const col of ['tarifario_clientes', 'tarifario_proveedores']) {
          const snapT = await getDocs(collection(db, col));
          for (const d of snapT.docs) {
            const x = d.data() as Record<string, unknown>;
            const lineas = Array.isArray(x.tarifas) ? (x.tarifas as Record<string, unknown>[]) : [];
            let cambio = false;
            const nuevas = lineas.map((l) => {
              if (String(l.tarifaReferenciaId || '') !== lado.tarifaId) return l;
              if (String(l.descripcion || '') === nuevaDesc) return l;
              cambio = true;
              return { ...l, descripcion: nuevaDesc };
            });
            if (cambio) { await updateDoc(d.ref, { tarifas: nuevas }); tarifariosTocados += 1; }
          }
        }

        // 3) ✅ V00230: nombre del convenio guardado en las OPERACIONES.
        for (let i = 0; i < detallesTocados.length; i += 10) {
          const trozo = detallesTocados.slice(i, i + 10);
          for (const campo of ['convenio', 'convenioProveedor']) {
            const snapOps = await getDocs(query(collection(db, 'operaciones'), where(campo, 'in', trozo)));
            if (snapOps.empty) continue;
            const lote = writeBatch(db);
            snapOps.docs.forEach((d) => {
              lote.update(d.ref, campo === 'convenio' ? { convenioNombre: nuevaDesc } : { convenioProveedorNombre: nuevaDesc });
              opsTocadas += 1;
            });
            await lote.commit();
          }
        }
      }
      await registrarLog('Operaciones', 'Edición', `Asignó origen/destino a ${actualizadas} tarifa(s) desde la operación ${refOperacion}.`);
      alert(`Tarifas actualizadas y propagadas. ✅\n\n· Tarifas del catálogo: ${actualizadas}\n· Detalles de convenio: ${propagados}\n· Tarifarios: ${tarifariosTocados}\n· Operaciones: ${opsTocadas}`);
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
            <BuscadorMunicipio etiqueta="Origen" valor={lado.origen} onElegir={(id) => set({ ...lado, origen: id })} />
            <BuscadorMunicipio etiqueta="Destino" valor={lado.destino} onElegir={(id) => set({ ...lado, destino: id })} />
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

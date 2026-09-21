// ✅ V00329: HISTORIAL DE CAMBIOS — informe para la gerencia de todo lo que se
//   ha actualizado en el sistema, con fecha y hora. Incluye rango de fechas y
//   botón para COPIAR el informe en lenguaje cotidiano y pegarlo en WhatsApp.
//   Todos los usuarios con el módulo lo VEN; solo Admin agrega/edita/borra.
import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { obtenerUsuarioAut } from '../autorizaciones/autorizaciones';
import { CAMBIOS_APP } from '../../config/historialCambios'; // ✅ V00330: registro automático
import './HistorialCambiosDashboard.css';

interface CambioHist {
  id: string;
  fecha: string;    // aaaa-mm-dd
  hora: string;     // HH:MM
  version: string;  // V00XXX
  titulo: string;   // título corto
  resumen: string;  // explicación cotidiana (para WhatsApp)
  detalle: string;  // detalle técnico opcional
  creadoPor: string;
  origen: 'app' | 'manual'; // ✅ V00330: 'app' = registrado automáticamente por la versión
}

const hoyISO = () => new Date().toISOString().slice(0, 10);
const ahoraHM = () => new Date().toTimeString().slice(0, 5);
const ddmm = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);

const FORM_VACIO = { fecha: hoyISO(), hora: ahoraHM(), version: '', titulo: '', resumen: '', detalle: '' };

export const HistorialCambiosDashboard: React.FC = () => {
  const [cambios, setCambios] = useState<CambioHist[]>([]);
  const [esAdmin, setEsAdmin] = useState(false);
  const [nombreUsuario, setNombreUsuario] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [rangoIni, setRangoIni] = useState('');
  const [rangoFin, setRangoFin] = useState('');
  const [form, setForm] = useState<Record<string, string>>({ ...FORM_VACIO });
  const [editandoId, setEditandoId] = useState('');
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [importAbierto, setImportAbierto] = useState(false);
  const [importTexto, setImportTexto] = useState('');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    obtenerUsuarioAut().then(u => { setEsAdmin(u.esAdmin); setNombreUsuario(u.nombre); }).catch(() => {});
    const unsub = onSnapshot(collection(db, 'historial_cambios'), snap => {
      const filas: CambioHist[] = snap.docs.map(d => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          fecha: String(x.fecha || ''), hora: String(x.hora || ''),
          version: String(x.version || ''), titulo: String(x.titulo || ''),
          resumen: String(x.resumen || ''), detalle: String(x.detalle || ''),
          creadoPor: String(x.creadoPor || ''),
          origen: 'manual' as const,
        };
      });
      filas.sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`));
      setCambios(filas);
    });
    return () => unsub();
  }, []);

  // ✅ V00330: REGISTRO AUTOMÁTICO — las entradas que viajan con el código se
  //   combinan con las manuales; si una versión también se registró a mano,
  //   se muestra la manual.
  const todas = useMemo(() => {
    const versionesManuales = new Set(cambios.map(c => c.version).filter(Boolean));
    const deApp: CambioHist[] = CAMBIOS_APP
      .filter(a => !versionesManuales.has(a.version))
      .map(a => ({
        id: `app-${a.version}`, fecha: a.fecha, hora: a.hora || '',
        version: a.version, titulo: a.titulo, resumen: a.resumen,
        detalle: a.detalle || '', creadoPor: 'Registro automático de la versión',
        origen: 'app' as const,
      }));
    const lista = [...cambios, ...deApp];
    lista.sort((a, b) => `${b.fecha} ${b.hora}`.localeCompare(`${a.fecha} ${a.hora}`) || b.version.localeCompare(a.version));
    return lista;
  }, [cambios]);

  const visibles = useMemo(() => todas.filter(c => {
    if (rangoIni && c.fecha < rangoIni) return false;
    if (rangoFin && c.fecha > rangoFin) return false;
    if (busqueda.trim()) {
      const t = busqueda.trim().toLowerCase();
      if (!`${c.version} ${c.titulo} ${c.resumen} ${c.detalle}`.toLowerCase().includes(t)) return false;
    }
    return true;
  }), [todas, rangoIni, rangoFin, busqueda]);

  const guardar = async () => {
    if (!form.fecha || !form.titulo.trim()) { alert('La fecha y el título son obligatorios.'); return; }
    const datos = {
      fecha: form.fecha, hora: form.hora || '', version: form.version.trim(),
      titulo: form.titulo.trim(), resumen: form.resumen.trim(), detalle: form.detalle.trim(),
    };
    try {
      if (editandoId) await updateDoc(doc(db, 'historial_cambios', editandoId), datos);
      else await addDoc(collection(db, 'historial_cambios'), { ...datos, creadoPor: nombreUsuario, creadoEn: new Date().toISOString() });
      setForm({ ...FORM_VACIO, fecha: hoyISO(), hora: ahoraHM() }); setEditandoId(''); setAltaAbierta(false);
    } catch (e) { console.error(e); alert('No se pudo guardar el cambio.'); }
  };

  const borrar = async (c: CambioHist) => {
    if (!confirm(`¿Borrar el cambio "${c.titulo}" (${c.version || ddmm(c.fecha)})?`)) return;
    try { await deleteDoc(doc(db, 'historial_cambios', c.id)); }
    catch (e) { console.error(e); alert('No se pudo borrar.'); }
  };

  // Importación masiva: una línea por cambio → fecha | versión | título | resumen
  const importar = async () => {
    const lineas = importTexto.split('\n').map(l => l.trim()).filter(Boolean);
    if (lineas.length === 0) return;
    let ok = 0;
    for (const ln of lineas) {
      const partes = ln.split('|').map(p => p.trim());
      if (partes.length < 3) continue;
      const [fecha, version, titulo, resumen = ''] = partes;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
      try {
        await addDoc(collection(db, 'historial_cambios'), {
          fecha, hora: '', version, titulo, resumen, detalle: '',
          creadoPor: nombreUsuario, creadoEn: new Date().toISOString(),
        });
        ok++;
      } catch (e) { console.error(e); }
    }
    alert(`Importados ${ok} de ${lineas.length} renglones.`);
    setImportTexto(''); setImportAbierto(false);
  };

  // ── El informe cotidiano para WhatsApp (usa el rango y filtros visibles) ──
  const copiarWhatsApp = async () => {
    if (visibles.length === 0) { alert('No hay cambios en el rango seleccionado.'); return; }
    const delAl = rangoIni || rangoFin
      ? `_Del ${ddmm(rangoIni || visibles[visibles.length - 1].fecha)} al ${ddmm(rangoFin || visibles[0].fecha)}_`
      : `_Al ${ddmm(hoyISO())}_`;
    const cuerpo = [...visibles].reverse().map(c => {
      const enc = `📅 ${ddmm(c.fecha)}${c.hora ? ` ${c.hora}` : ''}${c.version ? ` — *${c.version}*` : ''}`;
      const texto = c.resumen || c.titulo;
      return `${enc}\n• ${texto}`;
    }).join('\n\n');
    const informe = `*Actualizaciones del sistema Roelca* 🛠\n${delAl}\n\n${cuerpo}`;
    try {
      await navigator.clipboard.writeText(informe);
      setCopiado(true); setTimeout(() => setCopiado(false), 2500);
    } catch { alert(informe); }
  };

  const editar = (c: CambioHist) => {
    setForm({ fecha: c.fecha, hora: c.hora, version: c.version, titulo: c.titulo, resumen: c.resumen, detalle: c.detalle });
    setEditandoId(c.id); setAltaAbierta(true);
  };

  return (
    <div className="dashboard-container hc-cont">
      <h2 className="hc-titulo">🕘 Historial de Cambios</h2>
      <p className="hc-sub">Informe de todas las actualizaciones del sistema — con fecha y hora — para que la gerencia sepa qué se ha hecho. Las versiones de la app se registran SOLAS al publicarse (⚙ auto); también puedes registrar cambios a mano.</p>

      <div className="hc-barra">
        <input type="text" className="form-control hc-buscar" placeholder="Buscar por versión, título o descripción..." value={busqueda} onChange={e => setBusqueda(e.target.value)} />
        <span className="hc-rango" title="Filtra el listado y el informe que se copia">
          De <input type="date" className="form-control hc-rango-input" value={rangoIni} onChange={e => setRangoIni(e.target.value)} />
          a <input type="date" className="form-control hc-rango-input" value={rangoFin} onChange={e => setRangoFin(e.target.value)} />
          {(rangoIni || rangoFin) && <button type="button" className="hc-mini" title="Quitar el rango" onClick={() => { setRangoIni(''); setRangoFin(''); }}>✕</button>}
        </span>
        <button type="button" className="btn btn-primary hc-btn-wa" title="Copia el informe del rango en lenguaje cotidiano, listo para pegar en WhatsApp" onClick={copiarWhatsApp}>
          {copiado ? '✓ Copiado — pégalo en WhatsApp' : '📋 Copiar para WhatsApp'}
        </button>
        {esAdmin && (
          <>
            <button type="button" className="btn btn-outline hc-btn" onClick={() => { setEditandoId(''); setForm({ ...FORM_VACIO, fecha: hoyISO(), hora: ahoraHM() }); setAltaAbierta(v => !v); }}>➕ Registrar cambio</button>
            <button type="button" className="btn btn-outline hc-btn" title="Pega varias líneas: fecha | versión | título | explicación sencilla" onClick={() => setImportAbierto(v => !v)}>📥 Importación masiva</button>
          </>
        )}
      </div>

      {esAdmin && altaAbierta && (
        <div className="hc-form">
          <div className="hc-form-fila">
            <label className="hc-lbl">Fecha<input type="date" className="form-control" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} /></label>
            <label className="hc-lbl">Hora<input type="time" className="form-control" value={form.hora} onChange={e => setForm(f => ({ ...f, hora: e.target.value }))} /></label>
            <label className="hc-lbl">Versión<input type="text" className="form-control" placeholder="V00329" value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} /></label>
          </div>
          <label className="hc-lbl">Título<input type="text" className="form-control" placeholder="Qué se hizo, en corto" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} /></label>
          <label className="hc-lbl">Explicación sencilla (para WhatsApp)<textarea className="form-control hc-ta" rows={2} placeholder="Cómo se lo contarías a la gerencia, sin tecnicismos" value={form.resumen} onChange={e => setForm(f => ({ ...f, resumen: e.target.value }))} /></label>
          <label className="hc-lbl">Detalle técnico (opcional)<textarea className="form-control hc-ta" rows={2} value={form.detalle} onChange={e => setForm(f => ({ ...f, detalle: e.target.value }))} /></label>
          <div className="hc-form-acciones">
            <button type="button" className="btn btn-outline" onClick={() => { setAltaAbierta(false); setEditandoId(''); }}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={guardar}>{editandoId ? 'Guardar cambios' : 'Registrar'}</button>
          </div>
        </div>
      )}

      {esAdmin && importAbierto && (
        <div className="hc-form">
          <p className="hc-ayuda">Una línea por cambio, separando con <b>|</b> :&nbsp; <code>2026-09-21 | V00325 | Reporte bajo autorizaciones | Ya no todos pueden cambiar fechas de documentos</code></p>
          <textarea className="form-control hc-ta" rows={6} value={importTexto} onChange={e => setImportTexto(e.target.value)} placeholder="2026-09-21 | V00325 | Título | Explicación sencilla" />
          <div className="hc-form-acciones">
            <button type="button" className="btn btn-outline" onClick={() => setImportAbierto(false)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={importar}>Importar</button>
          </div>
        </div>
      )}

      <div className="hc-lista">
        {visibles.length === 0 && <div className="hc-vacio">No hay cambios registrados{rangoIni || rangoFin ? ' en el rango seleccionado' : ''}.</div>}
        {visibles.map(c => (
          <div key={c.id} className="hc-item">
            <div className="hc-item-enc">
              <span className="hc-fecha">📅 {ddmm(c.fecha)}{c.hora ? ` · ${c.hora}` : ''}</span>
              {c.version && <span className="hc-version">{c.version}</span>}
              {c.origen === 'app' && <span className="hc-auto" title="Registrado automáticamente al publicarse esta versión de la app">⚙ auto</span>}
              <span className="hc-item-titulo">{c.titulo}</span>
              {esAdmin && c.origen !== 'app' && (
                <span className="hc-item-acciones">
                  <button type="button" className="hc-mini" title="Editar" onClick={() => editar(c)}>✎</button>
                  <button type="button" className="hc-mini hc-mini--rojo" title="Borrar" onClick={() => borrar(c)}>🗑</button>
                </span>
              )}
            </div>
            {c.resumen && <div className="hc-resumen">{c.resumen}</div>}
            {c.detalle && <details className="hc-detalle"><summary>Detalle técnico</summary>{c.detalle}</details>}
          </div>
        ))}
      </div>
    </div>
  );
};

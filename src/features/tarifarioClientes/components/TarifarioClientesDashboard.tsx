// src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00191 — TARIFARIO CLIENTES (módulo nuevo).
//   Captura: Fecha, Cliente que Paga, Moneda del cliente y Crédito — moneda y
//   crédito vienen DIRECTO de la tabla Empresas y NO son editables aquí.
//   El botón "Pre convenios" abre un modal con las TARIFAS DE REFERENCIA
//   (catalogo_tarifas_referencia) y al Guardar se crea el registro en
//   `tarifario_clientes` con status "Pendiente".
// ✅ V00192 — MEJORAS:
//   · El formulario de captura ahora vive en un MODAL (botón "+ Nuevo
//     Tarifario"); la página muestra solo la lista.
//   · Al marcar una tarifa con varios costos sugeridos se elige UNO (el que
//     saldrá como TARIFA en el documento); por defecto el primero.
//   · EXPORTAR PDF con el formato del tarifario de Roelca (logo + encabezado +
//     tabla TIPO DE SERVICIO / CLAVE / TARIFA + condiciones + firma), con
//     botón tanto en la fila de la tabla como dentro del detalle expandido.
//     Mismo mecanismo que los demás PDF: ventana con window.print().
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db, auth } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';
import './TarifarioClientesDashboard.css';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- docs sin tipo canónico (mismo criterio de otros módulos).
type Doc = any;

/** Canoniza cualquier representación de moneda (id de catálogo o nombre) a USD/MXN. */
const canonMoneda = (v: unknown): 'USD' | 'MXN' | '' => {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (t === ID_USD) return 'USD';
  if (t === ID_MXN) return 'MXN';
  const u = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (u.includes('USD') || u.includes('DOLAR') || u === 'US$' || u === 'DLS') return 'USD';
  if (u.includes('MXN') || u.includes('PESO') || u === 'MN') return 'MXN';
  return '';
};

const fmtMoney = (n: number): string =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Costos sugeridos (> 0) de una tarifa de referencia. */
const costosDe = (t: Doc): number[] =>
  [t.tarifa_cliente_1, t.tarifa_cliente_2, t.tarifa_cliente_3].map((v) => Number(v) || 0).filter((v) => v > 0);

/** Clave de servicio de la tarifa, si el catálogo la tiene. */
const claveDe = (t: Doc): string =>
  String(t?.clave || t?.claveServicio || t?.clave_servicio || '').trim();

const norm = (t: unknown): string =>
  String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const esc = (t: unknown): string =>
  String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Fecha larga en español: "jueves, 20 de agosto de 2026". */
const fechaLarga = (iso: string): string => {
  const [a, m, d] = String(iso || '').split('-').map((x) => parseInt(x, 10));
  if (!a || !m || !d) return iso || '';
  return new Date(a, m - 1, d).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
};

export function TarifarioClientesDashboard() {
  // ── Catálogos ──
  const [empresas, setEmpresas] = useState<Doc[]>([]);
  const [tiposEmpresaCat, setTiposEmpresaCat] = useState<Record<string, string>>({});
  const [tarifasRef, setTarifasRef] = useState<Doc[]>([]);
  const [cargandoCat, setCargandoCat] = useState(true);

  // ── Captura (✅ V00192: ahora en modal) ──
  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [fecha, setFecha] = useState(hoyLocalISO());
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [clienteSel, setClienteSel] = useState<Doc | null>(null);

  // ── Modal Pre convenios ──
  const [modalAbierto, setModalAbierto] = useState(false);
  const [busquedaTarifa, setBusquedaTarifa] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  // ✅ V00192: costo elegido por tarifa (índice dentro de costosDe). Default 0.
  const [costoElegido, setCostoElegido] = useState<Record<string, number>>({});
  const [guardando, setGuardando] = useState(false);

  // ── Pre convenios guardados ──
  const [registros, setRegistros] = useState<Doc[]>([]);
  const [filaAbierta, setFilaAbierta] = useState('');

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const [eSnap, tSnap, trSnap] = await Promise.all([
          getDocs(collection(db, 'empresas')),
          getDocs(collection(db, 'catalogo_tipo_empresa')),
          getDocs(collection(db, 'catalogo_tarifas_referencia')),
        ]);
        if (!activo) return;
        setEmpresas(eSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        const tipos: Record<string, string> = {};
        tSnap.docs.forEach((d) => { tipos[d.id] = String((d.data() as Doc).nombre || ''); });
        setTiposEmpresaCat(tipos);
        setTarifasRef(
          trSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
            .sort((a: Doc, b: Doc) => String(a.descripcion || '').localeCompare(String(b.descripcion || ''), 'es', { sensitivity: 'base' }))
        );
      } catch (e) {
        console.error('No se pudieron cargar los catálogos del tarifario:', e);
      } finally {
        if (activo) setCargandoCat(false);
      }
    })();

    const unsub = onSnapshot(
      query(collection(db, 'tarifario_clientes'), orderBy('createdAt', 'desc'), limit(200)),
      (snap) => setRegistros(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRegistros([])
    );
    return () => { activo = false; unsub(); };
  }, []);

  /** Etiquetas de tipo de la empresa (tiposEmpresa guarda ids del catálogo). */
  const tiposDe = (emp: Doc): string[] => {
    const crudos: unknown[] = Array.isArray(emp?.tiposEmpresa) ? emp.tiposEmpresa : (emp?.tiposEmpresa ? [emp.tiposEmpresa] : []);
    return crudos.map((t) => tiposEmpresaCat[String(t)] || String(t)).filter(Boolean);
  };

  // Sugerencias del buscador de cliente — las empresas tipo "Cliente (Paga)"
  // van primero, pero todas son elegibles.
  const sugerencias = useMemo(() => {
    const b = norm(busquedaCliente);
    if (b.length < 2) return [];
    const coincide = empresas.filter((e) =>
      norm(e.nombre).includes(b) || norm(e.nombreCorto).includes(b)
    );
    const esPaga = (e: Doc) => tiposDe(e).some((t) => norm(t).includes('paga'));
    return coincide
      .sort((a, b2) => (Number(esPaga(b2)) - Number(esPaga(a))) || String(a.nombre || '').localeCompare(String(b2.nombre || ''), 'es', { sensitivity: 'base' }))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busquedaCliente, empresas, tiposEmpresaCat]);

  // Moneda y crédito — solo lectura, directo de Empresas.
  const monedaCliente = clienteSel ? (canonMoneda(clienteSel.moneda) || canonMoneda(clienteSel.monedaId) || canonMoneda(clienteSel.monedaNombre)) : '';
  const etiquetaMoneda = monedaCliente === 'USD' ? 'USD — Dólares' : monedaCliente === 'MXN' ? 'MXN — Pesos' : '';
  const creditoDias = Number(clienteSel?.diasCredito) || 0;
  const limiteCredito = Number(clienteSel?.limiteCredito) || 0;
  const etiquetaCredito = clienteSel
    ? `${creditoDias > 0 ? `${creditoDias} día(s)` : 'Sin días de crédito'}${limiteCredito > 0 ? ` · Límite ${fmtMoney(limiteCredito)}` : ''}`
    : '';

  const elegirCliente = (emp: Doc) => {
    setClienteSel(emp);
    setBusquedaCliente(String(emp.nombre || ''));
    setSugerenciasAbiertas(false);
  };

  const cerrarCaptura = () => {
    if (guardando) return;
    setCapturaAbierta(false);
    setModalAbierto(false);
    setSugerenciasAbiertas(false);
  };

  const tarifasVisibles = useMemo(() => {
    const b = norm(busquedaTarifa);
    if (!b) return tarifasRef;
    return tarifasRef.filter((t) =>
      norm(t.descripcion).includes(b) || norm(t.origen).includes(b) || norm(t.destino).includes(b)
    );
  }, [tarifasRef, busquedaTarifa]);

  const toggleTarifa = (id: string) =>
    setSeleccion((prev) => { const s = new Set(prev); if (s.has(id)) s.delete(id); else s.add(id); return s; });

  const guardarPreConvenio = async () => {
    if (!clienteSel || seleccion.size === 0 || guardando) return;
    setGuardando(true);
    try {
      const elegidas = tarifasRef.filter((t) => seleccion.has(t.id));
      await addDoc(collection(db, 'tarifario_clientes'), {
        fecha,
        clienteId: String(clienteSel.id),
        clienteNombre: String(clienteSel.nombre || ''),
        clienteNombreCorto: String(clienteSel.nombreCorto || ''),
        moneda: monedaCliente,
        monedaNombre: etiquetaMoneda,
        creditoDias,
        limiteCredito,
        tarifas: elegidas.map((t) => {
          const costos = costosDe(t);
          const idx = Math.min(costoElegido[t.id] ?? 0, Math.max(costos.length - 1, 0));
          return {
            tarifaReferenciaId: String(t.id),
            descripcion: String(t.descripcion || ''),
            clave: claveDe(t),
            origen: String(t.origen || ''),
            destino: String(t.destino || ''),
            costosSugeridos: costos,
            // ✅ V00192: costo ELEGIDO — es el que sale como TARIFA en el PDF.
            tarifa: costos[idx] || 0,
            status: 'Pendiente',
          };
        }),
        status: 'Pendiente',
        createdAt: new Date().toISOString(),
        creadoPor: auth.currentUser?.email || '',
      });
      await registrarLog('Tarifario Clientes', 'Creación', `Creó un pre convenio de "${clienteSel.nombre}" con ${elegidas.length} tarifa(s) (status Pendiente).`);
      setModalAbierto(false);
      setCapturaAbierta(false);
      setSeleccion(new Set());
      setCostoElegido({});
      setBusquedaTarifa('');
      setClienteSel(null);
      setBusquedaCliente('');
    } catch (e) {
      console.error('No se pudo guardar el pre convenio:', e);
      alert('No se pudo guardar el pre convenio.');
    } finally {
      setGuardando(false);
    }
  };

  const eliminarRegistro = async (r: Doc) => {
    if (!window.confirm(`¿Eliminar el pre convenio de "${r.clienteNombre}" del ${r.fecha}?`)) return;
    try {
      await deleteDoc(doc(db, 'tarifario_clientes', r.id));
      await registrarLog('Tarifario Clientes', 'Eliminación', `Eliminó el pre convenio de "${r.clienteNombre}" (${r.fecha}).`);
    } catch (e) {
      console.error('No se pudo eliminar el pre convenio:', e);
      alert('No se pudo eliminar el pre convenio.');
    }
  };

  // ── ✅ V00192: EXPORTAR PDF con el formato del tarifario de Roelca ──
  const construirHTMLTarifario = (r: Doc): string => {
    const filas = (Array.isArray(r.tarifas) ? r.tarifas : []).map((t: Doc, i: number) => {
      const tarifa = Number(t.tarifa) || (Array.isArray(t.costosSugeridos) ? Number(t.costosSugeridos[0]) : 0) || 0;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="desc">${esc(t.descripcion || '')}</td>
        <td class="clave">${esc(t.clave || '')}</td>
        <td class="signo">$</td>
        <td class="tarifa">${(tarifa).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>`;
    }).join('');

    const condiciones = [
      'Servicios en Falso se cobra el 50% del Servicio Solicitado.',
      'Para todo cruce se requiere la información necesaria para generar el Complemento Carta Porte.',
      'No se despachan embarques sin Complemento Carta Porte.',
      'Se consideran 2 hr libres para atencion de Rojos de Importacion e Inspecciones.',
      'Amarillos NO cuentan con horas libres.',
      'Se considera 1 hr libre para carga/descarga y entrega de Documentos y/o Despacho.',
      'Tarifas facturadas en Pesos, se multiplica por el Tipo de Cambio del Diario Oficial del dia del Servicio.',
      'Movimientos se cotizan como complemento de un Servicio de Cruce.',
      'Dias Festivos Mexicanos y Domingos todos los servicios se cobran DOBLE (Expo - Impo).',
      'Multas por Errores en Docs, Sobre Peso, Gruas x Fuera de Servicio de la caja, deberan ser pagadas de CONTADO.',
      'Distancias Extraordinarias SE COTIZAN POR EVENTO.',
      'Cobro por refacturacion $15 usd  - $300 mxn',
    ].map((c) => `<div class="cond">- ${esc(c)}</div>`).join('');

    const credito = Number(r.creditoDias) > 0 ? `${r.creditoDias} día(s)` : '';

    const css = `
      * { box-sizing: border-box; }
      body { font-family: Calibri, Arial, sans-serif; color: #000; margin: 0; padding: 28px 46px; font-size: 11.5px; }
      .encabezado { display: flex; align-items: flex-start; }
      .logo { width: 150px; }
      .logo img { width: 140px; }
      .datos { flex: 1; text-align: center; color: #1f6fb2; line-height: 1.35; }
      .datos .razon { color: #e07b00; font-weight: bold; font-size: 15px; }
      .datos .rfc { font-weight: bold; }
      .fecha-linea { text-align: right; margin: 14px 0 4px 0; }
      .fecha-linea b { margin-right: 8px; }
      .cliente-bloque { display: flex; justify-content: space-between; margin: 2px 0 14px 0; }
      .cliente-nombre { font-weight: bold; text-decoration: underline; }
      .tabla { width: 100%; border-collapse: collapse; margin-top: 6px; }
      .tabla th { border-bottom: 1px solid #000; padding: 2px 6px; font-size: 11.5px; text-align: center; }
      .tabla th.izq { text-align: left; padding-left: 30px; }
      .tabla td { padding: 3px 6px; }
      .tabla td.num { width: 24px; text-align: right; }
      .tabla td.desc { text-align: left; }
      .tabla td.clave { width: 120px; text-align: center; font-family: Consolas, monospace; }
      .tabla td.signo { width: 14px; text-align: right; }
      .tabla td.tarifa { width: 80px; text-align: right; }
      .condiciones { margin-top: 26px; line-height: 1.55; }
      .aviso { margin-top: 22px; }
      .gracias { margin-top: 20px; }
      .firma { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
      .firma .contacto { line-height: 1.5; }
      .firma .contacto a { color: #1f6fb2; }
      .firma .aceptacion { width: 46%; text-align: center; border-top: 1px solid #000; padding-top: 3px; font-size: 10.5px; }
      .ctpat { text-align: right; margin-top: 18px; font-weight: bold; font-size: 15px; color: #b30000; }
      @media print { body { padding: 18px 36px; } }
    `;

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>TARIFAS_${esc(String(r.clienteNombre || 'CLIENTE').toUpperCase().replace(/[^A-Z0-9]+/g, '_'))}_${esc(String(r.fecha || '').slice(0, 4))}</title>
      <style type="text/css">${css}</style></head><body>
      <div class="encabezado">
        <div class="logo"><img src="${LOGO_DEFAULT}" alt="Roelca" /></div>
        <div class="datos">
          <div class="razon">ROELCAINC S.A. DE C.V.</div>
          <div>Mar de las Antillas #947, Col. La Paz, C.P. 88290</div>
          <div>Nuevo Laredo, Tamaulipas, México.</div>
          <div>Tel. + 52 (867) 196 4690</div>
          <div class="rfc">ROE-180119-IV4</div>
          <div>www.roelca.com</div>
        </div>
        <div class="logo"></div>
      </div>
      <div class="fecha-linea"><b>FECHA:</b> ${esc(fechaLarga(r.fecha))}</div>
      <div class="cliente-bloque">
        <div><span class="cliente-nombre">${esc(String(r.clienteNombre || '').toUpperCase())}</span><br/><b>CLIENTE:</b> ${esc(String(r.clienteNombreCorto || r.clienteNombre || '').toUpperCase())}</div>
        <div><b>MONEDA:</b> ${esc(r.moneda || '')}</div>
        <div><b>CREDITO:</b> ${esc(credito)}</div>
      </div>
      <table class="tabla">
        <thead><tr><th></th><th class="izq">TIPO DE SERVICIO</th><th>CLAVE DE SERVICIO</th><th colspan="2">TARIFA</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>
      <div class="condiciones">${condiciones}</div>
      <div class="aviso">Cualquier incremento o modificacion se notificara con 15 dias de anticipacion</div>
      <div class="gracias">Agradecemos su confianza y preferencia.</div>
      <div class="firma">
        <div class="contacto">
          Lic.Gabriela Rotceh M. Osorio<br/>
          <a href="mailto:gerencia@roelca.com">gerencia@roelca.com</a><br/>
          Roelcainc, S.A. de C.V.<br/>
          Tel. (867) 217 8856
        </div>
        <div class="aceptacion">NOMBRE, FIRMA Y SELLO DE ACEPTACION DE TARIFAS</div>
      </div>
      <div class="ctpat">CTPAT™</div>
      <script>window.onload=function(){setTimeout(function(){window.print();},300);}</scr${''}ipt>
      </body></html>`;
  };

  const exportarPDF = (r: Doc) => {
    const w = window.open('', '_blank');
    if (!w) { alert('Permite las ventanas emergentes para descargar el PDF.'); return; }
    w.document.open();
    w.document.write(construirHTMLTarifario(r));
    w.document.close();
  };

  return (
    <div className="tc-contenedor">
      <div className="tc-encabezado">
        <div>
          <h1 className="tc-titulo">Tarifario Clientes</h1>
          <p className="tc-sub">Pre convenios del cliente a partir de las Tarifas de Referencia. La moneda y el crédito vienen de la tabla Empresas y no se editan aquí.</p>
        </div>
        {/* ✅ V00192: la captura ahora abre en modal */}
        <button type="button" className="tc-btn-preconvenio" onClick={() => { setCapturaAbierta(true); setFecha(hoyLocalISO()); }}>
          + Nuevo Tarifario
        </button>
      </div>

      {/* ── PRE CONVENIOS GUARDADOS ── */}
      <div className="tc-lista">
        <h2 className="tc-subtitulo">Pre convenios capturados</h2>
        {registros.length === 0 ? (
          <p className="tc-vacio">Aún no hay pre convenios capturados. Usa "+ Nuevo Tarifario" para crear el primero.</p>
        ) : (
          <div className="tc-marco">
            <table className="tc-tabla">
              <thead>
                <tr><th></th><th>FECHA</th><th>CLIENTE</th><th>MONEDA</th><th>CRÉDITO</th><th>TARIFAS</th><th>STATUS</th><th>ACCIONES</th></tr>
              </thead>
              <tbody>
                {registros.map((r) => (
                  <>
                    <tr key={r.id}>
                      <td className="tc-td-toggle">
                        <button type="button" className="tc-toggle" onClick={() => setFilaAbierta(filaAbierta === r.id ? '' : r.id)} title={filaAbierta === r.id ? 'Contraer' : 'Ver las tarifas'}>
                          {filaAbierta === r.id ? '▾' : '▸'}
                        </button>
                      </td>
                      <td>{r.fecha || '—'}</td>
                      <td className="tc-td-cliente">{r.clienteNombre || '—'}</td>
                      <td>{r.moneda ? <span className={`tc-chip ${r.moneda === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{r.moneda}</span> : '—'}</td>
                      <td>{r.creditoDias > 0 ? `${r.creditoDias} día(s)` : '—'}</td>
                      <td className="tc-td-num">{Array.isArray(r.tarifas) ? r.tarifas.length : 0}</td>
                      <td><span className={`tc-chip ${String(r.status) === 'Pendiente' ? 'tc-chip-pendiente' : 'tc-chip-otro'}`}>{r.status || '—'}</span></td>
                      <td className="tc-td-acciones">
                        {/* ✅ V00192: exportar PDF desde la tabla */}
                        <button type="button" className="tc-btn-pdf" title="Exportar el tarifario en PDF" onClick={() => exportarPDF(r)}>PDF</button>
                        <button type="button" className="tc-btn-eliminar" title="Eliminar este pre convenio" onClick={() => eliminarRegistro(r)}>🗑</button>
                      </td>
                    </tr>
                    {filaAbierta === r.id && (
                      <tr key={`${r.id}-det`} className="tc-fila-detalle">
                        <td colSpan={8}>
                          <div className="tc-detalle-acciones">
                            {/* ✅ V00192: exportar PDF también desde el detalle */}
                            <button type="button" className="tc-btn-pdf" onClick={() => exportarPDF(r)}>⬇ Descargar PDF</button>
                          </div>
                          <table className="tc-tabla-interna">
                            <thead>
                              <tr><th>DESCRIPCIÓN</th><th>CLAVE</th><th>ORIGEN</th><th>DESTINO</th><th>TARIFA</th><th>COSTOS SUGERIDOS</th><th>STATUS</th></tr>
                            </thead>
                            <tbody>
                              {(r.tarifas || []).map((t: Doc, i: number) => (
                                <tr key={`${r.id}-${i}`}>
                                  <td>{t.descripcion || '—'}</td>
                                  <td>{t.clave || '—'}</td>
                                  <td>{t.origen || '—'}</td>
                                  <td>{t.destino || '—'}</td>
                                  <td className="tc-td-num">{fmtMoney(Number(t.tarifa) || (Array.isArray(t.costosSugeridos) ? Number(t.costosSugeridos[0]) : 0) || 0)}</td>
                                  <td className="tc-td-num">{(t.costosSugeridos || []).length > 0 ? (t.costosSugeridos as number[]).map(fmtMoney).join(' · ') : '—'}</td>
                                  <td><span className="tc-chip tc-chip-pendiente">{t.status || 'Pendiente'}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── ✅ V00192: MODAL DE CAPTURA ── */}
      {capturaAbierta && (
        <div className="modal-overlay tc-overlay" onClick={cerrarCaptura}>
          <div className="tc-modal tc-modal-captura" onClick={(e) => e.stopPropagation()}>
            <div className="tc-modal-encabezado">
              <div>
                <h3 className="tc-modal-titulo">Nuevo Tarifario</h3>
                <p className="tc-modal-sub">Elige el cliente y presiona "Pre convenios" para armar el paquete de tarifas.</p>
              </div>
              <button type="button" className="tc-cerrar" onClick={cerrarCaptura}>✕</button>
            </div>

            <div className="tc-captura">
              <div className="tc-campo">
                <label className="tc-label">Fecha</label>
                <input type="date" className="form-control" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>

              <div className="tc-campo tc-campo-cliente">
                <label className="tc-label">Cliente que Paga</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder={cargandoCat ? 'Cargando empresas…' : 'Buscar cliente…'}
                  value={busquedaCliente}
                  disabled={cargandoCat}
                  onChange={(e) => { setBusquedaCliente(e.target.value); setClienteSel(null); setSugerenciasAbiertas(true); }}
                  onFocus={() => setSugerenciasAbiertas(true)}
                />
                {sugerenciasAbiertas && sugerencias.length > 0 && !clienteSel && (
                  <div className="tc-sugerencias">
                    {sugerencias.map((emp) => (
                      <button key={emp.id} type="button" className="tc-sugerencia" onClick={() => elegirCliente(emp)}>
                        <span className="tc-sug-nombre">{emp.nombre}</span>
                        <span className="tc-sug-tipo">{emp.numeroCliente ? `${emp.numeroCliente} · ` : ''}{tiposDe(emp).join(' · ') || 'Sin tipo'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="tc-campo">
                <label className="tc-label">Moneda del Cliente</label>
                <input type="text" className="form-control tc-solo-lectura" value={clienteSel ? (etiquetaMoneda || 'SIN MONEDA en Empresas') : ''} placeholder="—" readOnly disabled />
              </div>

              <div className="tc-campo">
                <label className="tc-label">Crédito</label>
                <input type="text" className="form-control tc-solo-lectura" value={etiquetaCredito} placeholder="—" readOnly disabled />
              </div>
            </div>

            <div className="tc-modal-pie">
              <span className="tc-conteo-sel">{clienteSel ? `Cliente: ${clienteSel.nombre}` : 'Elige un cliente para continuar'}</span>
              <div className="tc-modal-botones">
                <button type="button" className="btn btn-outline" onClick={cerrarCaptura}>Cancelar</button>
                <button
                  type="button"
                  className="tc-btn-preconvenio"
                  disabled={!clienteSel}
                  title={clienteSel ? 'Elegir las tarifas de referencia que conforman el pre convenio' : 'Primero elige el cliente'}
                  onClick={() => { setModalAbierto(true); setBusquedaTarifa(''); }}
                >
                  Pre convenios
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL PRE CONVENIOS ── */}
      {modalAbierto && clienteSel && (
        <div className="modal-overlay tc-overlay tc-overlay-tarifas" onClick={() => !guardando && setModalAbierto(false)}>
          <div className="tc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tc-modal-encabezado">
              <div>
                <h3 className="tc-modal-titulo">Pre convenio — <span className="tc-td-cliente">{clienteSel.nombre}</span></h3>
                <p className="tc-modal-sub">
                  Marca las tarifas y elige el costo que aplicará. Se guardará con status <b>Pendiente</b>.
                  {etiquetaMoneda && <> Moneda del cliente: <span className={`tc-chip ${monedaCliente === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{monedaCliente}</span></>}
                </p>
              </div>
              <button type="button" className="tc-cerrar" onClick={() => !guardando && setModalAbierto(false)}>✕</button>
            </div>

            <input
              type="text"
              className="form-control tc-buscador-tarifas"
              placeholder="Buscar por descripción, origen o destino…"
              value={busquedaTarifa}
              onChange={(e) => setBusquedaTarifa(e.target.value)}
            />

            <div className="tc-marco tc-modal-marco">
              {tarifasVisibles.length === 0 ? (
                <p className="tc-vacio">{tarifasRef.length === 0 ? 'No hay tarifas en el catálogo de Tarifas de Referencia.' : 'Ninguna tarifa coincide con la búsqueda.'}</p>
              ) : (
                <table className="tc-tabla">
                  <thead>
                    <tr><th className="tc-th-check"></th><th>DESCRIPCIÓN</th><th>CLAVE</th><th>ORIGEN</th><th>DESTINO</th><th>COSTO A APLICAR</th></tr>
                  </thead>
                  <tbody>
                    {tarifasVisibles.map((t) => {
                      const costos = costosDe(t);
                      const marcada = seleccion.has(t.id);
                      const idx = Math.min(costoElegido[t.id] ?? 0, Math.max(costos.length - 1, 0));
                      return (
                        <tr key={t.id} className={marcada ? 'tc-fila-marcada' : ''} onClick={() => toggleTarifa(t.id)}>
                          <td className="tc-th-check">
                            <input type="checkbox" checked={marcada} onChange={() => toggleTarifa(t.id)} onClick={(e) => e.stopPropagation()} />
                          </td>
                          <td>{t.descripcion || '—'}</td>
                          <td className="tc-td-num">{claveDe(t) || '—'}</td>
                          <td>{t.origen || '—'}</td>
                          <td>{t.destino || '—'}</td>
                          <td className="tc-td-num" onClick={(e) => e.stopPropagation()}>
                            {costos.length === 0 ? '—' : costos.length === 1 ? fmtMoney(costos[0]) : (
                              /* ✅ V00192: al haber varios costos sugeridos, se elige el que aplica */
                              <select
                                className="form-control tc-select-costo"
                                value={idx}
                                onChange={(e) => setCostoElegido((p) => ({ ...p, [t.id]: Number(e.target.value) }))}
                              >
                                {costos.map((c, i) => <option key={i} value={i}>{fmtMoney(c)}</option>)}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="tc-modal-pie">
              <span className="tc-conteo-sel"><b>{seleccion.size}</b> tarifa(s) seleccionada(s)</span>
              <div className="tc-modal-botones">
                <button type="button" className="btn btn-outline" disabled={guardando} onClick={() => setModalAbierto(false)}>Cancelar</button>
                <button type="button" className="tc-btn-guardar" disabled={seleccion.size === 0 || guardando} onClick={guardarPreConvenio}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TarifarioClientesDashboard;

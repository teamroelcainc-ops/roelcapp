// src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00211 — TARIFARIO PROVEEDORES: espejo del Tarifario Clientes (V00191-V00210): captura de pre convenios a
//   partir de las Tarifas de Referencia; moneda y crédito vienen de Empresas.
// ✅ V00192 — Captura en modal "+ Nuevo Tarifario"; costo elegido por tarifa;
//   export PDF (formato tarifario Roelca) en fila y detalle vía window.print.
// ✅ V00193 — Columna "Cotizado En" (USD/MXN); formulario a dos columnas;
//   pre convenios guardados visibles dentro del formulario.
// ✅ V00194 — MEJORAS:
//   · Botones EDITAR y ELIMINAR al INICIO de la fila (convención de la app).
//   · Clic en cualquier parte de la fila abre/cierra el DETALLE del registro.
//   · Desde el detalle se puede APROBAR (status Pendiente → "Aprobado").
//   · El modal de pre convenio queda con columnas: TARIFAS · TARIFAS
//     SUGERIDAS · TARIFA (campo de moneda editable) · COTIZADO EN; los costos
//     sugeridos son chips que llenan el campo TARIFA al hacer clic.
//   · EDICIÓN de un pre convenio existente (mismo flujo de captura, guarda
//     con updateDoc y registra log de Edición).
// ✅ V00195 — MEJORAS:
//   · El DETALLE ahora es un MODAL con toda la información del registro
//     (cliente, fecha, moneda, crédito, quién lo creó/aprobó, tabla de
//     tarifas, Aprobar y Descargar PDF).
//   · Integrado con Configuración → AUTORIZACIONES: Agregar, Editar y Borrar
//     se evalúan POR SEPARADO con las reglas del módulo "Tarifario Clientes"
//     (puede quedar libre agregar pero requerir autorización para editar);
//     Aprobar se evalúa como edición del campo Status.
// ✅ V00196 — PRE CONVENIO → CONVENIO:
//   · Al APROBAR un tarifario, sus tarifas pasan a Convenios: si el cliente ya
//     tiene convenio se agregan ahí (regla: un convenio por proveedor); si no,
//     se crea con el siguiente número CONV-###. Cada detalle nace con su
//     CONSECUTIVO (CONV-001 en adelante) visible en Detalles del Convenio.
//     Mientras está Pendiente NO toca Convenios.
//   · Botón "⇪ Importar Convenios": migra los convenios existentes (con todas
//     sus tarifas) a Tarifario Clientes en status "Aprobado" y asigna
//     consecutivo a los detalles que no lo tengan. Idempotente: los convenios
//     ya vinculados se saltan.
// ✅ V00198 — MEJORAS:
//   · Iconos de Editar/Eliminar con el estándar de la app (lápiz azul y bote
//     rojo, clases globales btn-small btn-edit / btn-danger).
//   · El MODAL DE DETALLE también tiene Editar y Eliminar, además del status.
//   · STATUS con 4 estados: Pendiente · Aprobado · Inactivo · Cancelado; en el
//     detalle CADA LÍNEA puede cancelarse o inactivarse por separado (select
//     por tarifa), sin afectar todo el tarifario.
// ✅ V00199 — MEJORAS:
//   · Botones "Editar"/"Eliminar" CON NOMBRE en el modal de detalle (en la
//     tabla siguen los iconos solos).
//   · El STATUS del tarifario también se cambia desde el detalle (select con
//     los 4 estados; elegir "Aprobado" corre el flujo completo hacia
//     Convenios).
//   · Los consecutivos de los detalles se reservan con TRANSACCIÓN
//     (reservarConsecutivosDetalle): irrepetibles, sin brincos, y la CLAVE
//     (id del documento) del detalle nuevo ES su consecutivo.
// ✅ V00200 — MEJORAS:
//   · Iconos de la TABLA ahora sí con el estándar azul/rojo (el reemplazo de
//     V00198 no aplicó por un desfase de indentación; fuera emojis).
//   · El CONSECUTIVO del detalle acompaña a cada tarifa: se guarda en la
//     línea al aprobar, la migración lo copia (y repara los ya migrados), se
//     ve en el detalle (columna CONSECUTIVO + número de convenio en la
//     cabecera) y el PDF lo imprime como CLAVE DE SERVICIO.
// ✅ V00201 — CONSECUTIVO EN VIVO:
//   · El consecutivo que se muestra (detalle y PDF) se RESUELVE leyendo
//     convenios_proveedores_detalles — la fuente de la verdad es el consecutivo
//     que quedó en Detalles del Convenio, aunque la línea del tarifario no lo
//     traiga guardado (registros migrados). Sin pasos manuales.
//   · Se quita el número de convenio de la cabecera del detalle (no aplica).
// ✅ V00202 — MEJORAS:
//   · COTIZADO EN editable por línea desde el detalle (select USD/MXN); el
//     cambio (y el de status de línea) se refleja también en el detalle del
//     convenio correspondiente (moneda / status) para que Detalles del
//     Convenio y las Operaciones vean lo mismo.
//   · La fase de reparación de la migración marca "Aprobado" los detalles del
//     convenio sin status (si están en Detalles, están aprobados).
// ✅ V00204 — FIX: la celda CONSECUTIVO de la fila no se insertó en V00203
//   (encabezado con 8 columnas y filas con 7 → botones recorridos); ahora la
//   fila tiene su celda y el orden de columnas queda como antes.
// ✅ V00203 — CONSECUTIVO DEL TARIFARIO (TAR-###):
//   · Cada tarifario tiene su consecutivo TAR-001, TAR-002… único e
//     irrepetible (misma transacción de contador que los detalles) y la CLAVE
//     del documento nuevo ES su consecutivo. Primera columna de la tabla.
//   · La migración lo asigna a los importados y la reparación se lo pone a
//     los tarifarios existentes que no lo tengan.
// ---------------------------------------------------------------------------
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBusquedaGlobal } from '../../../utils/busquedaGlobal'; // ✅ V00263
import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore';
import { db, auth, storage } from '../../../config/firebase'; // ✅ V00273: storage para el tarifario firmado
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'; // ✅ V00273
import { registrarLog } from '../../../utils/logger';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';
import html2pdf from 'html2pdf.js'; // ✅ V00250: descarga directa (como Operaciones)
import { LOGO_CTPAT_SRC } from '../../../utils/logoCtpat'; // ✅ V00250/V00251
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos';
import { reservarConsecutivosDetalleProveedor, reservarConsecutivosTarifarioProveedor } from '../../conveniosDetalles/consecutivos'; // ✅ V00199/V00203
import { cargarObligatoriosTarifa, guardarObligatoriosTarifa, ETIQUETAS_CAMPOS_TARIFA, OBLIGATORIOS_TARIFA_DEFAULT, type CamposObligatoriosTarifa } from '../../../utils/camposObligatoriosTarifa'; // ✅ V00286
import '../../tarifarioClientes/components/TarifarioClientesDashboard.css'; // ✅ V00211: mismo estilo

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

/** ✅ V00196: nombre e id de catálogo de la moneda para Convenios. */
const nombreMoneda = (m: unknown): string => (canonMoneda(m) === 'MXN' ? 'Pesos' : 'Dólares');
const idMoneda = (m: unknown): string => (canonMoneda(m) === 'MXN' ? ID_MXN : ID_USD);
const pad3 = (n: number): string => String(n).padStart(3, '0');

// ✅ V00198: mismos iconos azul/rojo que el resto de la app.
const IconoEditar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
);
const IconoEliminar = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
);

// ✅ V00198: los 4 estados y su chip.
const STATUS_TARIFARIO = ['Pendiente', 'Aprobado', 'Inactivo', 'Cancelado'] as const;
const chipStatus = (st: unknown): string => {
  const v = String(st || 'Pendiente');
  if (v === 'Aprobado') return 'tc-chip tc-chip-aprobado';
  if (v === 'Cancelado') return 'tc-chip tc-chip-cancelado';
  if (v === 'Inactivo') return 'tc-chip tc-chip-inactivo';
  return 'tc-chip tc-chip-pendiente';
};

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

export function TarifarioProveedoresDashboard() {
  // ── Catálogos ──
  const [empresas, setEmpresas] = useState<Doc[]>([]);
  // ✅ V00283: el NOMBRE del proveedor es SIEMPRE la razón social actual de la
  //   empresa (por proveedorId); el texto guardado solo es respaldo.
  const razonSocialDe = (r: Doc): string => {
    const emp = empresas.find((e) => String(e.id) === String(r.proveedorId || ''));
    return String(emp?.nombre || r.proveedorNombre || '');
  };
  const [tiposEmpresaCat, setTiposEmpresaCat] = useState<Record<string, string>>({});
  const [tarifasRef, setTarifasRef] = useState<Doc[]>([]);
  const [cargandoCat, setCargandoCat] = useState(true);

  // ── Captura (modal) ──
  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [fecha, setFecha] = useState(hoyLocalISO());
  // ✅ V00212: fechas de emisión (fecha) y VENCIMIENTO del tarifario; el
  //   convenio que se cree al aprobar hereda ambas.
  const [fechaVencimiento, setFechaVencimiento] = useState(`${hoyLocalISO().slice(0, 4)}-12-31`);
  const [busquedaProveedor, setBusquedaCliente] = useState('');
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [proveedorSel, setClienteSel] = useState<Doc | null>(null);
  // ✅ V00194: si hay id, la captura está EDITANDO ese pre convenio.
  const [editandoId, setEditandoId] = useState('');

  // ── Modal Pre convenios ──
  const [modalAbierto, setModalAbierto] = useState(false);
  const [busquedaTarifa, setBusquedaTarifa] = useState('');
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  // ✅ V00194: TARIFA como campo de moneda editable (texto numérico por tarifa).
  const [tarifaValor, setTarifaValor] = useState<Record<string, string>>({});
  // ✅ V00193: moneda en que se cotiza cada tarifa ("Cotizado En"). Default: la del cliente.
  const [monedaTarifa, setMonedaTarifa] = useState<Record<string, 'USD' | 'MXN'>>({});
  // ✅ V00214: líneas EXTRA — la misma tarifa puede ir varias veces en el
  //   tarifario, siempre que el MONTO sea distinto (mismo servicio, precios
  //   diferentes de forma permanente).
  const [extras, setExtras] = useState<{ key: string; tarifaRefId: string; valor: string; moneda: 'USD' | 'MXN' }[]>([]);
  const [guardando, setGuardando] = useState(false);

  // ── Pre convenios guardados ──
  const [registros, setRegistros] = useState<Doc[]>([]);
  // ✅ V00195: el detalle es un modal — aquí vive el id del registro abierto.
  const [detalleId, setDetalleId] = useState('');

  // ✅ V00195: reglas de Configuración → Autorizaciones para este módulo.
  const aut = useAutorizacionesCampos('tarifarioProveedores');

  // ✅ V00205: consecutivo TARI-### AUTOMÁTICO — al detectar tarifarios sin
  //   consecutivo se les asigna al vuelo (los más antiguos primero, reserva
  //   transaccional: único, irrepetible y sin brincos), sin botones.
  const backfillEnCurso = useRef(false);
  useEffect(() => {
    const faltantes = registros.filter((r) => !String(r.consecutivo || '').trim());
    if (faltantes.length === 0 || backfillEnCurso.current) return;
    backfillEnCurso.current = true;
    (async () => {
      try {
        const orden = [...faltantes].sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
        const nums = await reservarConsecutivosTarifarioProveedor(orden.length);
        for (let i = 0; i < orden.length; i++) {
          await updateDoc(doc(db, 'tarifario_proveedores', orden[i].id), { consecutivo: nums[i] });
        }
      } catch (e) {
        console.error('No se pudieron asignar consecutivos TARI-:', e);
      } finally {
        backfillEnCurso.current = false;
      }
    })();
  }, [registros]);
  // ✅ V00196: migración de Convenios existentes → Tarifarios aprobados.
  const [migrando, setMigrando] = useState(false);
  // ✅ V00219: buscador y filtros de la lista.
  const [busquedaLista, setBusquedaLista] = useState('');
  useBusquedaGlobal((t) => setBusquedaLista(t), 'los tarifarios de proveedores'); // ✅ V00263: buscador global del topbar
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroEntidad, setFiltroEntidad] = useState('');
  const [filtroMoneda, setFiltroMoneda] = useState('');

  // ✅ V00220: si se llegó aquí desde una referencia clicable, el buscador
  //   arranca con esa referencia.
  useEffect(() => {
    try {
      const crudo = localStorage.getItem('roelca_buscar');
      if (!crudo) return;
      const d = JSON.parse(crudo);
      if (String(d?.modulo || '') !== 'tarifarioProveedores' || !d?.texto) return;
      setBusquedaLista(String(d.texto));
      localStorage.removeItem('roelca_buscar');
    } catch { /* noop */ }
  }, []);

  // ✅ V00201: detalles del convenio en vivo — de aquí sale el consecutivo real.
  const [detallesConv, setDetallesConv] = useState<Doc[]>([]);

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
      query(collection(db, 'tarifario_proveedores'), orderBy('createdAt', 'desc'), limit(200)),
      (snap) => setRegistros(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRegistros([])
    );
    // ✅ V00201: consecutivos reales desde Detalles del Convenio, siempre al día.
    const unsubDet = onSnapshot(
      collection(db, 'convenios_proveedores_detalles'),
      (snap) => setDetallesConv(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setDetallesConv([])
    );
    return () => { activo = false; unsub(); unsubDet(); };
  }, []);

  /** Etiquetas de tipo de la empresa (tiposEmpresa guarda ids del catálogo). */
  const tiposDe = (emp: Doc): string[] => {
    const crudos: unknown[] = Array.isArray(emp?.tiposEmpresa) ? emp.tiposEmpresa : (emp?.tiposEmpresa ? [emp.tiposEmpresa] : []);
    return crudos.map((t) => tiposEmpresaCat[String(t)] || String(t)).filter(Boolean);
  };

  // Sugerencias del buscador de cliente — las empresas tipo "Cliente (Paga)"
  // van primero, pero todas son elegibles.
  const sugerencias = useMemo(() => {
    const b = norm(busquedaProveedor);
    if (b.length < 2) return [];
    const coincide = empresas.filter((e) =>
      norm(e.nombre).includes(b) || norm(e.nombreCorto).includes(b)
    );
    const esPaga = (e: Doc) => tiposDe(e).some((t) => norm(t).includes('proveedor') || norm(t).includes('transport')); // ✅ V00211
    return coincide
      .sort((a, b2) => (Number(esPaga(b2)) - Number(esPaga(a))) || String(a.nombre || '').localeCompare(String(b2.nombre || ''), 'es', { sensitivity: 'base' }))
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busquedaProveedor, empresas, tiposEmpresaCat]);

  // Moneda y crédito — solo lectura, directo de Empresas.
  const monedaProveedor = proveedorSel ? (canonMoneda(proveedorSel.moneda) || canonMoneda(proveedorSel.monedaId) || canonMoneda(proveedorSel.monedaNombre)) : '';
  const etiquetaMoneda = monedaProveedor === 'USD' ? 'USD — Dólares' : monedaProveedor === 'MXN' ? 'MXN — Pesos' : '';
  const creditoDias = Number(proveedorSel?.diasCredito) || 0;
  const limiteCredito = Number(proveedorSel?.limiteCredito) || 0;
  const etiquetaCredito = proveedorSel
    ? `${creditoDias > 0 ? `${creditoDias} día(s)` : 'Sin días de crédito'}${limiteCredito > 0 ? ` · Límite ${fmtMoney(limiteCredito)}` : ''}`
    : '';

  const elegirProveedor = (emp: Doc) => {
    setClienteSel(emp);
    setBusquedaCliente(String(emp.nombre || ''));
    setSugerenciasAbiertas(false);
  };

  // ✅ V00280: GUARDAR CAMBIOS de la cabecera en EDICIÓN sin pasar por la
  //   captura de tarifas — antes el único guardado vivía dentro de
  //   "Pre convenios" y al editar (fechas, "Tarifario obligatorio" o el
  //   documento) no había botón para guardar.
  const guardarCabeceraEdicion = async () => {
    if (!editandoId) return;
    if (!aut.verificarAccion('editar', ['fecha', 'cotizadoEn'])) return;
    setGuardando(true);
    try {
      await updateDoc(doc(db, 'tarifario_proveedores', editandoId), {
        fecha,
        fechaVencimiento,
        // ✅ V00288: relación real si se cambió el proveedor (elegido de la lista).
        ...(proveedorSel ? { proveedorId: String(proveedorSel.id), proveedorNombre: String(proveedorSel.nombre || '') } : {}),
        docObligatorio: docObligatorioForm, // ✅ V00277
        editadoEl: new Date().toISOString(),
        editadoPor: auth.currentUser?.email || '',
      });
      if (docNuevoFile) {
        try { await subirDocFirmadoA(editandoId, docNuevoFile, String((proveedorSel)?.nombre || '')); }
        catch (eDoc: unknown) {
          console.error(eDoc);
          const det = (eDoc as { code?: string; message?: string })?.code || (eDoc as { message?: string })?.message || String(eDoc);
          alert(`Los cambios se guardaron, pero el documento no se pudo subir.\n\nMotivo: ${det}\n\nPuedes reintentar desde la fila (📎/⚠).`);
        }
        setDocNuevoFile(null);
      }
      await registrarLog('Tarifario Proveedores', 'Edición', `Editó la cabecera del pre convenio ${editandoId} de "${String((proveedorSel)?.nombre || '')}" (fechas / tarifario obligatorio / documento).`);
      cerrarCaptura();
    } catch (e) {
      console.error('No se pudo guardar la cabecera del pre convenio:', e);
      alert('No se pudieron guardar los cambios.');
    } finally {
      setGuardando(false);
    }
  };

  const limpiarCaptura = () => {
    setEditandoId('');
    setDocNuevoFile(null); // ✅ V00274
    setDocObligatorioForm(true); // ✅ V00277: el default es obligatorio
    setFechaVencimiento(`${hoyLocalISO().slice(0, 4)}-12-31`); // ✅ V00212
    setSeleccion(new Set());
    setExtras([]); // ✅ V00214
    setTarifaValor({});
    setMonedaTarifa({});
    setBusquedaTarifa('');
    setClienteSel(null);
    setBusquedaCliente('');
  };

  const cerrarCaptura = () => {
    if (guardando) return;
    // ✅ V00284: preguntar SIEMPRE antes de salir (Cancelar, ✕ o clic fuera).
    if (!window.confirm('¿Seguro que quieres salir?\n\nSe perderán los cambios sin guardar.')) return;
    setCapturaAbierta(false);
    setModalAbierto(false);
    setSugerenciasAbiertas(false);
    limpiarCaptura();
  };

  // ✅ V00194: abrir la captura en modo EDICIÓN con todo precargado.
  const abrirEdicion = (r: Doc) => {
    setDocObligatorioForm(esDocObligatorio(r)); // ✅ V00277
    const emp = empresas.find((e) => String(e.id) === String(r.proveedorId));
    const pseudo = emp || { id: r.proveedorId, nombre: r.proveedorNombre, nombreCorto: r.proveedorNombreCorto, moneda: r.moneda, diasCredito: r.creditoDias, limiteCredito: r.limiteCredito };
    setClienteSel(pseudo);
    setBusquedaCliente(String(pseudo.nombre || ''));
    setFecha(String(r.fecha || hoyLocalISO()));
    setFechaVencimiento(String(r.fechaVencimiento || `${String(r.fecha || hoyLocalISO()).slice(0, 4)}-12-31`)); // ✅ V00212
    const sel = new Set<string>();
    const valores: Record<string, string> = {};
    const monedas: Record<string, 'USD' | 'MXN'> = {};
    const extrasCarga: { key: string; tarifaRefId: string; valor: string; moneda: 'USD' | 'MXN' }[] = [];
    (Array.isArray(r.tarifas) ? r.tarifas : []).forEach((t: Doc, i: number) => {
      const id = String(t.tarifaReferenciaId || '');
      if (!id) return;
      const monto = String(Number(t.tarifa) || (Array.isArray(t.costosSugeridos) ? Number(t.costosSugeridos[0]) : 0) || '');
      const m = canonMoneda(t.cotizadoEn);
      if (!sel.has(id)) {
        // ✅ V00214: la primera línea de cada tarifa va al renglón principal…
        sel.add(id);
        valores[id] = monto;
        if (m) monedas[id] = m;
      } else {
        // …y las repeticiones (mismo servicio, otro monto) van como extras.
        extrasCarga.push({ key: `x${i}-${id}`, tarifaRefId: id, valor: monto, moneda: m || 'USD' });
      }
    });
    setExtras(extrasCarga);
    setSeleccion(sel);
    setTarifaValor(valores);
    setMonedaTarifa(monedas);
    setEditandoId(String(r.id));
    setSugerenciasAbiertas(false);
    setBusquedaTarifa('');
    setCapturaAbierta(true);
  };

  // ✅ V00219: lista filtrada (buscador de texto + proveedor + status + moneda).
  const registrosVisibles = useMemo(() => {
    const b = norm(busquedaLista);
    return registros.filter((r) => {
      if (filtroStatus && String(r.status || 'Pendiente') !== filtroStatus) return false;
      if (filtroEntidad && String(r.proveedorNombre || '') !== filtroEntidad) return false;
      if (filtroMoneda && canonMoneda(r.moneda) !== filtroMoneda) return false;
      if (!b) return true;
      const enTarifas = (Array.isArray(r.tarifas) ? r.tarifas : []).some((t: Doc) =>
        norm(t.descripcion).includes(b) || norm(t.consecutivo).includes(b));
      return norm(r.proveedorNombre).includes(b) || norm(r.consecutivo).includes(b) ||
        norm(r.id).includes(b) || norm(r.fecha).includes(b) || enTarifas;
    });
  }, [registros, busquedaLista, filtroStatus, filtroEntidad, filtroMoneda]);

  const entidadesLista = useMemo(
    () => Array.from(new Set(registros.map((r) => String(r.proveedorNombre || '')).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    [registros]
  );

  const tarifasVisibles = useMemo(() => {
    const b = norm(busquedaTarifa);
    if (!b) return tarifasRef;
    return tarifasRef.filter((t) =>
      norm(t.descripcion).includes(b) || norm(t.origen).includes(b) || norm(t.destino).includes(b)
    );
  }, [tarifasRef, busquedaTarifa]);

  const toggleTarifa = (t: Doc) =>
    setSeleccion((prev) => {
      const s = new Set(prev);
      if (s.has(t.id)) {
        s.delete(t.id);
      } else {
        s.add(t.id);
        // Al marcar, precarga TARIFA con el primer costo sugerido si está vacía.
        setTarifaValor((p) => (p[t.id] ? p : { ...p, [t.id]: String(costosDe(t)[0] ?? '') }));
      }
      return s;
    });

  const guardarPreConvenio = async () => {
    if (!proveedorSel || seleccion.size === 0 || guardando) return;
    // ✅ V00195: Agregar y Editar se autorizan POR SEPARADO según las reglas del módulo.
    if (!aut.verificarAccion(editandoId ? 'editar' : 'crear', editandoId ? ['fecha', 'proveedorId', 'tarifas', 'tarifa', 'cotizadoEn'] : [])) return;
    setGuardando(true);
    try {
      const elegidas = tarifasRef.filter((t) => seleccion.has(t.id));
      // ✅ V00214: líneas finales = principales + extras (misma tarifa, otro monto).
      const lineaDe = (t: Doc, monto: number, mon: string) => {
        const costos = costosDe(t);
        return {
          tarifaReferenciaId: String(t.id),
          descripcion: String(t.descripcion || ''),
          clave: claveDe(t),
          origen: String(t.origen || ''),
          destino: String(t.destino || ''),
          costosSugeridos: costos,
          tarifa: monto || costos[0] || 0,
          cotizadoEn: mon || monedaProveedor || 'USD',
          status: 'Pendiente',
        };
      };
      // ✅ V00283: la MONEDA DE COTIZACIÓN es obligatoria en cada línea.
      const sinMoneda = elegidas.filter((t) => !canonMoneda(monedaTarifa[t.id]));
      const extrasSinMoneda = extras.filter((x) => seleccion.has(x.tarifaRefId) && !canonMoneda(x.moneda));
      if (sinMoneda.length > 0 || extrasSinMoneda.length > 0) {
        alert(`Elige la MONEDA DE COTIZACIÓN (USD o MXN) de cada tarifa antes de guardar.\n\nFalta en: ${[...sinMoneda.map((t) => String(t.descripcion || '')), ...extrasSinMoneda.map(() => '(tarifa adicional)')].join(', ')}`);
        setGuardando(false);
        return;
      }
      const lineas = [
        ...elegidas.map((t) => lineaDe(t, Number(tarifaValor[t.id]) || 0, monedaTarifa[t.id] || '')),
        ...extras
          .filter((x) => seleccion.has(x.tarifaRefId))
          .map((x) => {
            const t = tarifasRef.find((tr) => String(tr.id) === x.tarifaRefId);
            return t ? lineaDe(t, Number(x.valor) || 0, x.moneda) : null;
          })
          .filter(Boolean) as Doc[],
      ];
      // Candado: la misma tarifa NO puede repetirse con el MISMO monto.
      const vistos = new Set<string>();
      for (const l of lineas) {
        const k = `${l.tarifaReferenciaId}|${Number(l.tarifa) || 0}|${l.cotizadoEn}`;
        if (vistos.has(k)) {
          alert(`La tarifa "${l.descripcion}" está repetida con el mismo monto (${fmtMoney(Number(l.tarifa) || 0)} ${l.cotizadoEn}).\n\nPuedes repetir un mismo servicio, pero cada línea debe tener una tarifa distinta.`);
          setGuardando(false);
          return;
        }
        vistos.add(k);
      }
      const payload = {
        fecha,
        fechaVencimiento, // ✅ V00212
        proveedorId: String(proveedorSel.id),
        proveedorNombre: String(proveedorSel.nombre || ''),
        proveedorNombreCorto: String(proveedorSel.nombreCorto || ''),
        moneda: monedaProveedor,
        monedaNombre: etiquetaMoneda,
        creditoDias,
        limiteCredito,
        tarifas: lineas, // ✅ V00214
        docObligatorio: docObligatorioForm, // ✅ V00277
        status: 'Pendiente',
      };
      if (editandoId) {
        // ✅ V00194: EDICIÓN de un pre convenio existente.
        await updateDoc(doc(db, 'tarifario_proveedores', editandoId), {
          ...payload,
          editadoEl: new Date().toISOString(),
          editadoPor: auth.currentUser?.email || '',
        });
        await registrarLog('Tarifario Proveedores', 'Edición', `Editó el pre convenio del proveedor "${proveedorSel.nombre}" (${fecha}) con ${elegidas.length} tarifa(s).`);
        if (docNuevoFile) { try { await subirDocFirmadoA(editandoId, docNuevoFile, String(proveedorSel?.nombre || '')); } catch (eDoc) { console.error(eDoc); alert('El tarifario se guardó, pero el documento firmado no se pudo subir. Súbelo desde la fila (📎).'); } } // ✅ V00274
      } else {
        // ✅ V00203: consecutivo TAR-### reservado por transacción; la CLAVE del doc ES el consecutivo.
        const [consecTar] = await reservarConsecutivosTarifarioProveedor(1);
        await setDoc(doc(db, 'tarifario_proveedores', consecTar), {
          ...payload,
          consecutivo: consecTar,
          createdAt: new Date().toISOString(),
          creadoPor: auth.currentUser?.email || '',
        });
        await registrarLog('Tarifario Proveedores', 'Creación', `Creó el pre convenio ${consecTar} de "${proveedorSel.nombre}" con ${elegidas.length} tarifa(s) (status Pendiente).`);
        if (docNuevoFile) { try { await subirDocFirmadoA(consecTar, docNuevoFile, String(proveedorSel?.nombre || '')); } catch (eDoc) { console.error(eDoc); alert('El tarifario se creó, pero el documento firmado no se pudo subir. Súbelo desde la fila (📎).'); } } // ✅ V00274
      }
      setModalAbierto(false);
      setCapturaAbierta(false);
      limpiarCaptura();
    } catch (e) {
      console.error('No se pudo guardar el pre convenio:', e);
      alert('No se pudo guardar el pre convenio.');
    } finally {
      setGuardando(false);
    }
  };

  const eliminarRegistro = async (r: Doc) => {
    if (!aut.verificarAccion('borrar')) return; // ✅ V00195
    if (!window.confirm(`¿Eliminar el pre convenio del proveedor "${r.proveedorNombre}" del ${r.fecha}?`)) return;
    try {
      await deleteDoc(doc(db, 'tarifario_proveedores', r.id));
      await registrarLog('Tarifario Proveedores', 'Eliminación', `Eliminó el pre convenio del proveedor "${r.proveedorNombre}" (${r.fecha}).`);
    } catch (e) {
      console.error('No se pudo eliminar el pre convenio:', e);
      alert('No se pudo eliminar el pre convenio.');
    }
  };

  /** ✅ V00196: siguiente CONV-### para el convenio maestro.
   *  ✅ V00199: los consecutivos de DETALLE ahora los reserva
   *  reservarConsecutivosDetalle (transacción: únicos y sin brincos). */
  const siguientes = async () => {
    const [snapConv, snapDet] = await Promise.all([
      getDocs(collection(db, 'convenios_proveedores')),
      getDocs(collection(db, 'convenios_proveedores_detalles')),
    ]);
    const numsConv = snapConv.docs.map((d) => parseInt(String((d.data() as Doc).numeroConvenio || '').replace(/\D/g, ''), 10) || 0);
    return {
      snapConv, snapDet,
      sigConvenio: (numsConv.length ? Math.max(...numsConv) : 0) + 1,
    };
  };

  // ✅ V00194: aprobar desde el detalle (Pendiente → "Aprobado", doc + líneas).
  // ✅ V00196: al aprobar, los pre convenios PASAN A CONVENIOS — se agregan al
  //   convenio del cliente (o se crea uno nuevo CONV-###) y cada detalle nace
  //   con su consecutivo. Mientras está Pendiente no se toca Convenios.
  // ✅ V00273: TARIFARIO FIRMADO — regla nueva: para APROBAR un tarifario debe
  //   tener subido su documento firmado (el mismo tarifario escaneado y
  //   firmado). El archivo va a Storage y el doc guarda docFirmadoUrl/Nombre/
  //   Fecha (relación 1:1 con el tarifario). Los aprobados de antes se quedan
  //   aprobados, pero la fila muestra ⚠ hasta que se les suba el documento.
  const inputDocFirmadoRef = useRef<HTMLInputElement | null>(null);
  const tarifarioDocRef = useRef<Doc | null>(null);
  const aprobarTrasSubirRef = useRef(false);
  const [subiendoDocFirmado, setSubiendoDocFirmado] = useState<string>('');
  const pedirTarifarioFirmado = (r: Doc, aprobarDespues = false) => {
    tarifarioDocRef.current = r;
    aprobarTrasSubirRef.current = aprobarDespues;
    inputDocFirmadoRef.current?.click();
  };
  // ✅ V00274: subida reutilizable (fila, ficha, editar y NUEVO — en el nuevo
  //   se difiere el archivo hasta tener el consecutivo del tarifario).
  const subirDocFirmadoA = async (id: string, archivo: File, nombreEntidad: string) => {
    const limpio = archivo.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destino = storageRef(storage, `tarifarios_firmados/tarifario_proveedores/${id}/${Date.now()}_${limpio}`);
    await uploadBytes(destino, archivo, archivo.type ? { contentType: archivo.type } : undefined);
    const url = await getDownloadURL(destino);
    await updateDoc(doc(db, 'tarifario_proveedores', id), {
      docFirmadoUrl: url,
      docFirmadoNombre: archivo.name,
      docFirmadoFecha: new Date().toISOString().slice(0, 10),
      docFirmadoPor: auth.currentUser?.email || '', // ✅ V00283: quién subió el documento
    });
    await registrarLog('Tarifario Proveedores', 'Edición', `Subió el tarifario firmado de "${nombreEntidad}" (${id}): ${archivo.name}.`);
    return url;
  };
  const [docNuevoFile, setDocNuevoFile] = useState<File | null>(null); // ✅ V00274: archivo elegido en el modal (nuevo/editar)
  // ✅ V00277: "Tarifario obligatorio" (Sí/No) — si es Sí (el default, y el valor
  //   de TODOS los registros que no traen el campo), el tarifario firmado es
  //   requisito para aprobar (candado V00273); si es No, se puede aprobar sin él.
  const esDocObligatorio = (r: Doc | null | undefined): boolean => (r as Doc | null | undefined)?.docObligatorio !== false;
  const [docObligatorioForm, setDocObligatorioForm] = useState<boolean>(true);
  const inputDocModalRef = useRef<HTMLInputElement | null>(null);

  const alElegirDocFirmado = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    e.target.value = ''; // permite volver a elegir el mismo archivo
    const r = tarifarioDocRef.current;
    if (!archivo || !r) return;
    setSubiendoDocFirmado(String(r.id));
    try {
      const url = await subirDocFirmadoA(String(r.id), archivo, String(r.proveedorNombre || ''));
      if (aprobarTrasSubirRef.current) {
        aprobarTrasSubirRef.current = false;
        await aprobarRegistro({ ...r, docFirmadoUrl: url }); // continúa la aprobación
      } else {
        alert('Tarifario firmado subido. ✅');
      }
    } catch (err) {
      console.error('No se pudo subir el tarifario firmado:', err);
      alert('No se pudo subir el tarifario firmado.');
    } finally {
      setSubiendoDocFirmado('');
      tarifarioDocRef.current = null;
    }
  };

  const aprobarRegistro = async (r: Doc) => {
    // ✅ V00273: CANDADO — sin el tarifario firmado no hay aprobación…
    // ✅ V00277: …salvo que el registro tenga "Tarifario obligatorio" en No.
    if (esDocObligatorio(r) && !String(r.docFirmadoUrl || '').trim()) {
      if (window.confirm('Para aprobar, primero sube el TARIFARIO FIRMADO (escaneado).\n\n¿Quieres subirlo ahora? Al terminar la subida, la aprobación continúa sola.')) {
        pedirTarifarioFirmado(r, true);
      }
      return;
    }
    if (!aut.verificarAccion('editar', ['status'])) return; // ✅ V00195: aprobar = editar Status
    if (!window.confirm(`¿Aprobar el pre convenio del proveedor "${r.proveedorNombre}" del ${r.fecha}?\n\nSus tarifas pasarán al módulo de Convenios (Detalles del Convenio).`)) return;
    try {
      let convenioId = String(r.convenioId || '');
      let numeroConvenio = String(r.numeroConvenio || '');

      if (!convenioId) {
        const { snapConv, sigConvenio } = await siguientes();
        // ✅ V00199: consecutivos reservados por transacción (únicos, sin brincos)
        const lineas: Doc[] = Array.isArray(r.tarifas) ? r.tarifas : [];
        const consecutivos = await reservarConsecutivosDetalleProveedor(lineas.length);
        const batch = writeBatch(db);

        // Regla de la app: UN convenio por proveedor — si ya existe, se agregan ahí.
        const existente = snapConv.docs.find((d) => String((d.data() as Doc).proveedorId || '') === String(r.proveedorId || ''));
        let convenioRef;
        if (existente) {
          convenioRef = doc(db, 'convenios_proveedores', existente.id);
          numeroConvenio = String((existente.data() as Doc).numeroConvenio || '');
        } else {
          convenioRef = doc(collection(db, 'convenios_proveedores'));
          numeroConvenio = `CONV-${pad3(sigConvenio)}`;
          batch.set(convenioRef, {
            numeroConvenio,
            proveedorId: String(r.proveedorId || ''),
            proveedorNombre: String(r.proveedorNombre || ''),
            monedaId: idMoneda(r.moneda),
            monedaNombre: nombreMoneda(r.moneda),
            credito: Number(r.creditoDias) || 0,
            fechaConvenio: String(r.fecha || hoyLocalISO()),
            // ✅ V00212: el convenio hereda las fechas del tarifario
            fechaVencimiento: vencimientoDe(r), // ✅ V00219
            creadoDesdeTarifario: String(r.id),
          });
        }
        convenioId = convenioRef.id;

        lineas.forEach((t: Doc, i: number) => {
          // ✅ V00199: la CLAVE del detalle ES su consecutivo (irrepetible por definición)
          batch.set(doc(db, 'convenios_proveedores_detalles', consecutivos[i]), {
            convenioId,
            tipoConvenioId: String(t.tarifaReferenciaId || ''),
            tipoConvenioNombre: String(t.descripcion || ''),
            tarifa: Number(t.tarifa) || 0,
            moneda: nombreMoneda(t.cotizadoEn || r.moneda),
            consecutivo: consecutivos[i],
            status: String(t.status || 'Aprobado'),
            tarifarioId: String(r.id),
          });
        });

        batch.update(doc(db, 'tarifario_proveedores', r.id), {
          status: 'Aprobado',
          // ✅ V00200: cada línea guarda SU consecutivo (la clave del detalle)
          tarifas: lineas.map((t: Doc, i: number) => ({ ...t, status: 'Aprobado', consecutivo: consecutivos[i] })),
          convenioId,
          numeroConvenio,
          aprobadoEl: new Date().toISOString(),
          aprobadoPor: auth.currentUser?.email || '',
        });
        await batch.commit();
        await registrarLog('Tarifario Proveedores', 'Aprobación', `Aprobó el pre convenio del proveedor "${r.proveedorNombre}" (${r.fecha}) y pasó ${Array.isArray(r.tarifas) ? r.tarifas.length : 0} tarifa(s) al convenio ${numeroConvenio}.`);
        alert(`Pre convenio aprobado. Sus tarifas ya están en el convenio ${numeroConvenio} (Detalles del Convenio). ✅`);
      } else {
        await updateDoc(doc(db, 'tarifario_proveedores', r.id), {
          status: 'Aprobado',
          tarifas: (Array.isArray(r.tarifas) ? r.tarifas : []).map((t: Doc) => ({ ...t, status: 'Aprobado' })),
          aprobadoEl: new Date().toISOString(),
          aprobadoPor: auth.currentUser?.email || '',
        });
        await registrarLog('Tarifario Proveedores', 'Aprobación', `Aprobó el pre convenio del proveedor "${r.proveedorNombre}" (${r.fecha}).`);
        // ✅ V00282: SINCRONIZACIÓN RELACIONAL — al re-aprobar el tarifario, sus
        //   detalles de convenio (clave = consecutivo de cada línea) se aprueban
        //   también. Antes esta rama no los tocaba y quedaban en Pendiente.
        for (const t of (Array.isArray(r.tarifas) ? r.tarifas : [])) {
          const cc = String((t as Doc).consecutivo || '').trim();
          if (!cc) continue;
          try { await updateDoc(doc(db, 'convenios_proveedores_detalles', cc), { status: 'Aprobado', tarifarioId: String(r.id) }); } catch { /* detalle inexistente: lo cubre el motor */ }
        }
      }
    } catch (e) {
      console.error('No se pudo aprobar el pre convenio:', e);
      alert('No se pudo aprobar el pre convenio.');
    }
  };

  // ✅ V00196: MIGRACIÓN — todos los convenios existentes pasan a Tarifario
  //   Clientes en status "Aprobado" con todas sus tarifas, y se asigna
  //   consecutivo a los detalles que no lo tengan. Se puede correr varias
  //   veces: los convenios ya vinculados se saltan.
  const importarConvenios = async () => {
    if (migrando) return;
    if (!aut.verificarAccion('crear')) return;
    if (!window.confirm('¿Importar TODOS los convenios de "Convenios de Proveedores" a Tarifario Clientes en status "Aprobado" con todas sus tarifas?\n\nTambién se asignará el consecutivo (CONV-001…) a los detalles que no lo tengan. Los convenios ya importados se saltan.')) return;
    setMigrando(true);
    try {
      const { snapConv, snapDet } = await siguientes();
      const snapTarifarios = await getDocs(collection(db, 'tarifario_proveedores'));
      const yaVinculados = new Set(snapTarifarios.docs.map((d) => String((d.data() as Doc).convenioId || '')).filter(Boolean));

      const catalogo: Record<string, Doc> = {};
      tarifasRef.forEach((t) => { catalogo[String(t.id)] = t; });
      const empresaDe: Record<string, Doc> = {};
      empresas.forEach((e) => { empresaDe[String(e.id)] = e; });

      // 1) Consecutivos faltantes en detalles (ordenados por número de convenio).
      const numeroDe: Record<string, string> = {};
      snapConv.docs.forEach((d) => { numeroDe[d.id] = String((d.data() as Doc).numeroConvenio || ''); });
      const sinConsecutivo = snapDet.docs
        .filter((d) => !String((d.data() as Doc).consecutivo || '').trim())
        .sort((a, b) => {
          const na = parseInt((numeroDe[String((a.data() as Doc).convenioId || '')] || '').replace(/\D/g, ''), 10) || 0;
          const nb = parseInt((numeroDe[String((b.data() as Doc).convenioId || '')] || '').replace(/\D/g, ''), 10) || 0;
          return na - nb || a.id.localeCompare(b.id);
        });
      // ✅ V00199: el rango se reserva por transacción — únicos y sin brincos.
      const reservados = await reservarConsecutivosDetalleProveedor(sinConsecutivo.length);
      for (let i = 0; i < sinConsecutivo.length; i++) {
        await updateDoc(doc(db, 'convenios_proveedores_detalles', sinConsecutivo[i].id), { consecutivo: reservados[i] });
      }
      // ✅ V00202: si un detalle está en Detalles del Convenio, está APROBADO.
      let statusPuestos = 0;
      for (const d of snapDet.docs) {
        if (!String((d.data() as Doc).status || '').trim()) {
          await updateDoc(doc(db, 'convenios_proveedores_detalles', d.id), { status: 'Aprobado' });
          statusPuestos += 1;
        }
      }

      // 2) Convenio → tarifario aprobado (con todas sus tarifas).
      const detallesPorConvenio: Record<string, Doc[]> = {};
      snapDet.docs.forEach((d) => {
        const x = { id: d.id, ...(d.data() as Doc) };
        const k = String(x.convenioId || '');
        if (!detallesPorConvenio[k]) detallesPorConvenio[k] = [];
        detallesPorConvenio[k].push(x);
      });

      // ✅ V00203: consecutivos TAR-### para los convenios que se van a importar.
      const porImportar = snapConv.docs.filter((d) => !yaVinculados.has(d.id));
      const consecsTar = await reservarConsecutivosTarifarioProveedor(porImportar.length);
      let importados = 0;
      for (const d of porImportar) {
        const c = d.data() as Doc;
        const emp = empresaDe[String(c.proveedorId || '')] || {};
        const monedaConv = canonMoneda(c.monedaNombre) || canonMoneda(c.monedaId) || 'USD';
        const lineas = (detallesPorConvenio[d.id] || []).map((det) => {
          const ref = catalogo[String(det.tipoConvenioId || '')] || {};
          return {
            tarifaReferenciaId: String(det.tipoConvenioId || ''),
            descripcion: String(det.tipoConvenioNombre || ref.descripcion || ''),
            clave: claveDe(ref),
            origen: String(ref.origen || ''),
            destino: String(ref.destino || ''),
            costosSugeridos: costosDe(ref),
            tarifa: Number(det.tarifa) || 0,
            cotizadoEn: canonMoneda(det.moneda) || monedaConv,
            status: 'Aprobado',
            // ✅ V00200: el consecutivo del detalle viaja con la línea
            consecutivo: String(det.consecutivo || (String(det.id).startsWith('CONV-') ? det.id : '')),
          };
        });
        const consecTar = consecsTar[importados];
        await setDoc(doc(db, 'tarifario_proveedores', consecTar), {
          consecutivo: consecTar, // ✅ V00203
          fecha: String(c.fechaConvenio || hoyLocalISO()),
          fechaVencimiento: String(c.fechaVencimiento || `${String(c.fechaConvenio || hoyLocalISO()).slice(0, 4)}-12-31`), // ✅ V00212
          proveedorId: String(c.proveedorId || ''),
          proveedorNombre: String(c.proveedorNombre || ''),
          proveedorNombreCorto: String(emp.nombreCorto || ''),
          moneda: monedaConv,
          monedaNombre: monedaConv === 'USD' ? 'USD — Dólares' : 'MXN — Pesos',
          creditoDias: Number(c.credito) || 0,
          limiteCredito: Number(emp.limiteCredito) || 0,
          tarifas: lineas,
          status: 'Aprobado',
          convenioId: d.id,
          numeroConvenio: String(c.numeroConvenio || ''),
          migradoDeConvenio: true,
          createdAt: new Date().toISOString(),
          creadoPor: auth.currentUser?.email || '',
          aprobadoEl: new Date().toISOString(),
          aprobadoPor: auth.currentUser?.email || '',
        });
        importados += 1;
      }

      // ✅ V00203: tarifarios existentes sin TAR-### reciben el suyo (solo el
      //   campo; conservan su clave original).
      const tarSinConsec = snapTarifarios.docs.filter((td) => !String((td.data() as Doc).consecutivo || '').trim());
      const tarNuevos = await reservarConsecutivosTarifarioProveedor(tarSinConsec.length);
      for (let i = 0; i < tarSinConsec.length; i++) {
        await updateDoc(doc(db, 'tarifario_proveedores', tarSinConsec[i].id), { consecutivo: tarNuevos[i] });
      }

      // ✅ V00200: REPARA los tarifarios ya migrados que no traían consecutivo
      //   en sus líneas — se toma del detalle correspondiente del convenio.
      let reparados = 0;
      for (const td of snapTarifarios.docs) {
        const t = td.data() as Doc;
        const lineasT: Doc[] = Array.isArray(t.tarifas) ? t.tarifas : [];
        if (!t.convenioId || lineasT.length === 0 || lineasT.every((l: Doc) => String(l.consecutivo || '').trim())) continue;
        const dets = (detallesPorConvenio[String(t.convenioId)] || []);
        const usados = new Set<string>();
        const nuevas = lineasT.map((l: Doc) => {
          if (String(l.consecutivo || '').trim()) return l;
          const det = dets.find((dd) => !usados.has(String(dd.id)) && String(dd.tipoConvenioId || '') === String(l.tarifaReferenciaId || ''));
          if (!det) return l;
          usados.add(String(det.id));
          const cons = String(det.consecutivo || (String(det.id).startsWith('CONV-') ? det.id : ''));
          return cons ? { ...l, consecutivo: cons } : l;
        });
        if (JSON.stringify(nuevas) !== JSON.stringify(lineasT)) {
          await updateDoc(doc(db, 'tarifario_proveedores', td.id), { tarifas: nuevas });
          reparados += 1;
        }
      }

      await registrarLog('Tarifario Proveedores', 'Migración', `Importó ${importados} convenio(s) a Tarifario Clientes en status Aprobado y asignó ${sinConsecutivo.length} consecutivo(s) a Detalles del Convenio.`);
      alert(`Migración lista. ✅\n\n· Convenios importados como tarifarios Aprobados: ${importados}\n· Detalles con consecutivo nuevo: ${sinConsecutivo.length}\n· Convenios ya vinculados (saltados): ${yaVinculados.size}\n· Tarifarios reparados con consecutivos: ${reparados}\n· Detalles marcados Aprobado: ${statusPuestos}\n· Tarifarios con TAR- nuevo: ${tarSinConsec.length}`);
    } catch (e) {
      console.error('No se pudo importar los convenios:', e);
      alert('No se pudo completar la importación de convenios.');
    } finally {
      setMigrando(false);
    }
  };

  // ✅ V00199: cambiar el STATUS DEL TARIFARIO desde el detalle. Elegir
  //   "Aprobado" corre el flujo completo (crea/actualiza el convenio).
  const cambiarStatusTarifario = async (r: Doc, nuevo: string) => {
    if (nuevo === String(r.status || 'Pendiente')) return;
    if (nuevo === 'Aprobado') { await aprobarRegistro(r); return; }
    if (!aut.verificarAccion('editar', ['status'])) return;
    try {
      await updateDoc(doc(db, 'tarifario_proveedores', r.id), { status: nuevo });
      await registrarLog('Tarifario Proveedores', 'Edición', `Cambió el status del pre convenio del proveedor "${r.proveedorNombre}" (${r.fecha}) a "${nuevo}".`);
    } catch (e) {
      console.error('No se pudo cambiar el status del tarifario:', e);
      alert('No se pudo cambiar el status del tarifario.');
    }
  };

  // ✅ V00198: cambiar el status de UNA línea del pre convenio (Cancelado /
  //   Inactivo / etc.) sin afectar el resto — se autoriza como editar Status.
  // ✅ V00283: EDITOR DE LÍNEA (lápiz de la fila del convenio en la ficha) y
  //   ALTA de tarifas nuevas al pre convenio. idx === null → línea nueva.
  const [lineaEditor, setLineaEditor] = useState<{ regId: string; idx: number | null; tarifaRefId: string; costo: string; cotizadoEn: string; status: string; origen: string; destino: string; tarifaTexto?: string; tarifarioTexto?: string } | null>(null);
  // ✅ V00286: configuración COMPARTIDA de campos obligatorios (Firestore).
  const [configOblig, setConfigOblig] = useState<CamposObligatoriosTarifa>({ ...OBLIGATORIOS_TARIFA_DEFAULT });
  const [mostrarConfigOblig, setMostrarConfigOblig] = useState(false);
  const [guardandoOblig, setGuardandoOblig] = useState(false);
  useEffect(() => { if (lineaEditor) { setMostrarConfigOblig(false); cargarObligatoriosTarifa().then(setConfigOblig); } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineaEditor !== null]);
  const guardarConfigOblig = async () => {
    if (guardandoOblig) return;
    setGuardandoOblig(true);
    try {
      await guardarObligatoriosTarifa(configOblig);
      await registrarLog('Tarifario Proveedores', 'Edición', `Cambió los campos obligatorios del formulario de tarifas (aplica a todos los usuarios).`);
      setMostrarConfigOblig(false);
      alert('Configuración guardada. Aplica para TODOS los usuarios. ✅');
    } catch (e) { console.error(e); alert('No se pudo guardar la configuración.'); }
    setGuardandoOblig(false);
  };
  /** ✅ V00286: valida los campos según la configuración compartida. */
  const faltantesSegunConfig = (le: NonNullable<typeof lineaEditor>): string[] => {
    const faltan: string[] = [];
    if (configOblig.tarifaRefId && !le.tarifaRefId) faltan.push(ETIQUETAS_CAMPOS_TARIFA.tarifaRefId);
    if (configOblig.origen && !le.origen.trim()) faltan.push(ETIQUETAS_CAMPOS_TARIFA.origen);
    if (configOblig.destino && !le.destino.trim()) faltan.push(ETIQUETAS_CAMPOS_TARIFA.destino);
    if (configOblig.costo && !(Number(le.costo) > 0)) faltan.push(ETIQUETAS_CAMPOS_TARIFA.costo);
    if (configOblig.status && !le.status) faltan.push(ETIQUETAS_CAMPOS_TARIFA.status);
    return faltan;
  };
  const [guardandoLinea, setGuardandoLinea] = useState(false);

  const guardarLineaEditor = async () => {
    if (!lineaEditor || guardandoLinea) return;
    const r = registros.find((x) => String(x.id) === lineaEditor.regId);
    if (!r) return;
    if (!canonMoneda(lineaEditor.cotizadoEn)) { alert('La MONEDA DE COTIZACIÓN (USD o MXN) es obligatoria.'); return; }
    if (lineaEditor.status && !STATUS_TARIFARIO.includes(lineaEditor.status as typeof STATUS_TARIFARIO[number])) { alert(`El STATUS debe ser uno de la lista: ${STATUS_TARIFARIO.join(', ')}.`); return; } // ✅ V00288
    { const faltan = faltantesSegunConfig(lineaEditor); if (faltan.length > 0) { alert(`Completa los campos obligatorios antes de guardar:\n\n· ${faltan.join('\n· ')}`); return; } } // ✅ V00286
    if (!aut.verificarAccion('editar', ['tarifa'])) return;
    setGuardandoLinea(true);
    try {
      const tarifas: Doc[] = Array.isArray(r.tarifas) ? [...(r.tarifas as Doc[])] : [];
      if (lineaEditor.idx === null) {
        const ref = tarifasRef.find((t) => String(t.id) === lineaEditor.tarifaRefId);
        if (!ref) { alert('Elige la TARIFA del catálogo.'); setGuardandoLinea(false); return; }
        const nueva: Doc = {
          tarifaReferenciaId: String(ref.id),
          descripcion: String(ref.descripcion || ''),
          clave: claveDe(ref),
          origen: String(lineaEditor.origen || ref.origen || ''),
          destino: String(lineaEditor.destino || ref.destino || ''),
          costosSugeridos: costosDe(ref),
          tarifa: Number(lineaEditor.costo) || 0,
          cotizadoEn: canonMoneda(lineaEditor.cotizadoEn),
          status: lineaEditor.status || 'Pendiente',
        };
        if (String(r.convenioId || '')) {
          const [cc] = await reservarConsecutivosDetalleProveedor(1);
          nueva.consecutivo = cc;
          await setDoc(doc(db, 'convenios_proveedores_detalles', cc), {
            convenioId: String(r.convenioId),
            tipoConvenioId: String(ref.id),
            tipoConvenioNombre: String(ref.descripcion || ''),
            tarifa: Number(lineaEditor.costo) || 0,
            moneda: nombreMoneda(lineaEditor.cotizadoEn),
            consecutivo: cc,
            status: nueva.status,
            tarifarioId: String(r.id),
          });
        }
        tarifas.push(nueva);
        await updateDoc(doc(db, 'tarifario_proveedores', r.id), { tarifas });
        await registrarLog('Tarifario Proveedores', 'Edición', `Agregó la tarifa "${nueva.descripcion}" (${fmtMoney(Number(nueva.tarifa) || 0)} ${nueva.cotizadoEn}) al pre convenio de "${razonSocialDe(r)}".`);
      } else {
        const t = tarifas[lineaEditor.idx];
        if (!t) { setGuardandoLinea(false); return; }
        tarifas[lineaEditor.idx] = { ...t, tarifa: Number(lineaEditor.costo) || 0, cotizadoEn: canonMoneda(lineaEditor.cotizadoEn), status: lineaEditor.status || String(t.status || 'Pendiente'), origen: lineaEditor.origen.trim(), destino: lineaEditor.destino.trim() };
        await updateDoc(doc(db, 'tarifario_proveedores', r.id), { tarifas });
        const cc = String(t.consecutivo || '').trim();
        if (cc) { try { await updateDoc(doc(db, 'convenios_proveedores_detalles', cc), { tarifa: Number(lineaEditor.costo) || 0, moneda: nombreMoneda(lineaEditor.cotizadoEn), status: tarifas[lineaEditor.idx].status, tarifarioId: String(r.id) }); } catch { /* lo cubre el motor v1.2 */ } }
        await registrarLog('Tarifario Proveedores', 'Edición', `Editó la tarifa "${t.descripcion || ''}" del pre convenio de "${razonSocialDe(r)}" (${fmtMoney(Number(lineaEditor.costo) || 0)} ${canonMoneda(lineaEditor.cotizadoEn)}).`);
      }
      setLineaEditor(null);
    } catch (e) {
      console.error('No se pudo guardar la tarifa:', e);
      alert('No se pudo guardar la tarifa.');
    }
    setGuardandoLinea(false);
  };

  // ✅ V00291: SINCRONIZAR CONVENIOS — corregido de raíz. La versión V00289
  //   exigía tipoConvenioId === tarifaReferenciaId y las líneas MIGRADAS no
  //   traen ese id: nunca encontraba el CONV correcto y CREABA consecutivos
  //   nuevos (duplicados). Ahora el match es en cascada: (1) id de tarifa +
  //   monto; (2) DESCRIPCIÓN normalizada + monto; (3) descripción única.
  //   Además REPARA los duplicados creados: la línea re-adopta el CONV
  //   original y el detalle duplicado (creado por la sync) se elimina.
  const [sincronizandoConv, setSincronizandoConv] = useState(false);
  const normDesc = (x: unknown): string => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const numConsec = (c: string): number => { const m = c.match(/(\d+)\s*$/); return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER; };
  const sincronizarConvenios = async (r: Doc, opciones?: { silencioso?: boolean }) => {
    if (sincronizandoConv) return;
    if (!aut.verificarAccion('editar', ['status'])) return;
    setSincronizandoConv(true);
    try {
      const tarifas: Doc[] = Array.isArray(r.tarifas) ? [...(r.tarifas as Doc[])] : [];
      const convId = String(r.convenioId || '');
      if (!convId) { if (!opciones?.silencioso) alert('Este tarifario aún no tiene convenio (se asigna al aprobar).'); setSincronizandoConv(false); return { ligadas: 0, reparadas: 0, creadas: 0, huerfanos: 0 }; }
      // ✅ V00296: los detalles equivalentes pueden vivir en OTRO convenio
      //   maestro del MISMO cliente/proveedor (p. ej. CONV-489 de UnitedLink en
      //   un convenio anterior). La búsqueda ahora abarca TODOS los convenios
      //   de la misma empresa, no solo el ligado al tarifario.
      const entId = String(r.proveedorId || '').trim();
      const idsConvenios = new Set<string>([convId]);
      if (entId) {
        try {
          const snapMaestros = await getDocs(query(collection(db, 'convenios_proveedores'), where('proveedorId', '==', entId)));
          snapMaestros.docs.forEach((d) => idsConvenios.add(d.id));
        } catch { /* sin permiso o índice: se sigue solo con el convenio del tarifario */ }
      }
      const listaIds = Array.from(idsConvenios);
      const detalles: (Doc & { id: string })[] = [];
      for (let i = 0; i < listaIds.length; i += 10) {
        const chunk = listaIds.slice(i, i + 10);
        const snapDet = chunk.length === 1
          ? await getDocs(query(collection(db, 'convenios_proveedores_detalles'), where('convenioId', '==', chunk[0])))
          : await getDocs(query(collection(db, 'convenios_proveedores_detalles'), where('convenioId', 'in', chunk)));
        snapDet.docs.forEach((d) => detalles.push({ id: d.id, ...(d.data() as Doc) }));
      }
      const usados = new Set(tarifas.map((t) => String(t.consecutivo || '')).filter(Boolean));
      const buscarDetalle = (t: Doc): (Doc & { id: string }) | undefined => {
        const libres = detalles.filter((d) => !usados.has(String(d.consecutivo || d.id)));
        const idRef = String(t.tarifaReferenciaId || '');
        const monto = Number(t.tarifa) || 0;
        const desc = normDesc(t.descripcion);
        // 1) id de tarifa del catálogo + monto
        let cand = idRef ? libres.filter((d) => String(d.tipoConvenioId || '') === idRef && Math.abs((Number(d.tarifa) || 0) - monto) < 0.005) : [];
        // 2) descripción + monto (la relación REAL para migrados)
        if (cand.length === 0 && desc) cand = libres.filter((d) => normDesc(d.tipoConvenioNombre) === desc && Math.abs((Number(d.tarifa) || 0) - monto) < 0.005);
        // 3) descripción única (aunque el monto difiera: la línea manda y se alinea)
        if (cand.length === 0 && desc) {
          const porDesc = libres.filter((d) => normDesc(d.tipoConvenioNombre) === desc);
          if (porDesc.length === 1) cand = porDesc;
        }
        // el MÁS ANTIGUO primero (CONV de número menor)
        cand.sort((a, b) => numConsec(String(a.consecutivo || a.id)) - numConsec(String(b.consecutivo || b.id)));
        return cand[0] as (Doc & { id: string }) | undefined;
      };
      let ligadas = 0, creadas = 0, reparadas = 0, reconstruidos = 0, vacias = 0;
      // ── FASE 0 ✅ V00301: si una línea YA tiene consecutivo pero su detalle no
      //   existe (quedó a medias en una sincronización anterior), el detalle se
      //   RECONSTRUYE con ESA MISMA clave — jamás se reserva un número nuevo.
      for (const t of tarifas) {
        const cc = String(t.consecutivo || '').trim();
        if (!cc) continue;
        if (detalles.some((d) => String(d.consecutivo || d.id) === cc)) continue;
        try {
          await setDoc(doc(db, 'convenios_proveedores_detalles', cc), {
            convenioId: convId,
            tipoConvenioId: String(t.tarifaReferenciaId || ''),
            tipoConvenioNombre: String(t.descripcion || ''),
            tarifa: Number(t.tarifa) || 0,
            moneda: nombreMoneda(t.cotizadoEn || r.moneda),
            consecutivo: cc,
            status: String(t.status || 'Aprobado'),
            tarifarioId: String(r.id),
          });
          detalles.push({ id: cc, convenioId: convId, consecutivo: cc, tipoConvenioId: String(t.tarifaReferenciaId || ''), tipoConvenioNombre: String(t.descripcion || ''), tarifa: Number(t.tarifa) || 0, status: String(t.status || 'Aprobado'), tarifarioId: String(r.id) } as Doc & { id: string });
          reconstruidos += 1;
        } catch { /* mejor esfuerzo */ }
      }
      // ── FASE 1: reparar duplicados — la línea vuelve al CONV original ──
      for (let i = 0; i < tarifas.length; i++) {
        const t = tarifas[i];
        const cc = String(t.consecutivo || '').trim();
        if (!cc) continue;
        const propio = detalles.find((d) => String(d.consecutivo || d.id) === cc);
        // solo se consideran duplicados los detalles CREADOS por la sincronización
        if (!propio || String(propio.tarifarioId || '') !== String(r.id)) continue;
        usados.delete(cc);
        const original = buscarDetalle(t);
        usados.add(cc);
        if (original && numConsec(String(original.consecutivo || original.id)) < numConsec(cc)) {
          const ccOrig = String(original.consecutivo || original.id);
          tarifas[i] = { ...t, consecutivo: ccOrig };
          usados.delete(cc);
          usados.add(ccOrig);
          await updateDoc(doc(db, 'convenios_proveedores_detalles', String(original.id)), { status: String(t.status || 'Aprobado'), tarifa: Number(t.tarifa) || 0, tarifarioId: String(r.id) });
          try { await deleteDoc(doc(db, 'convenios_proveedores_detalles', String(propio.id))); } catch { /* mejor esfuerzo */ }
          reparadas += 1;
        }
      }
      // ── FASE 2 ✅ V00301: ligar (o crear) las líneas SIN consecutivo — ahora
      //   IDEMPOTENTE: (a) las líneas VACÍAS (sin tarifa del catálogo, sin
      //   descripción y sin monto) NO generan convenios — se reportan; (b) antes
      //   de reservar un número nuevo se RE-USA cualquier residuo propio
      //   equivalente de una pasada anterior; (c) la línea guarda su consecutivo
      //   EN FIRESTORE ANTES de crear el detalle — si algo falla a la mitad, el
      //   siguiente clic reconstruye (FASE 0) en vez de crear otro juego.
      const guardarTarifas = async () => { await updateDoc(doc(db, 'tarifario_proveedores', r.id), { tarifas }); };
      for (let i = 0; i < tarifas.length; i++) {
        const t = tarifas[i];
        if (String(t.consecutivo || '').trim()) continue;
        const lineaVacia = !String(t.tarifaReferenciaId || '').trim() && !normDesc(t.descripcion) && !(Number(t.tarifa) > 0);
        if (lineaVacia) { vacias += 1; continue; }
        const det = buscarDetalle(t);
        if (det) {
          const cc = String(det.consecutivo || det.id);
          tarifas[i] = { ...t, consecutivo: cc };
          usados.add(cc);
          await guardarTarifas();
          await updateDoc(doc(db, 'convenios_proveedores_detalles', String(det.id)), { status: String(t.status || 'Aprobado'), tarifa: Number(t.tarifa) || 0, tarifarioId: String(r.id) });
          ligadas += 1;
          continue;
        }
        // residuo propio de una pasada anterior (misma descripción, creado por
        // este tarifario y sin línea que lo use): se RE-USA, no se crea otro.
        const residuo = detalles.find((d) => !usados.has(String(d.consecutivo || d.id)) && String(d.tarifarioId || '') === String(r.id) && normDesc(d.tipoConvenioNombre) === normDesc(t.descripcion));
        if (residuo) {
          const cc = String(residuo.consecutivo || residuo.id);
          tarifas[i] = { ...t, consecutivo: cc };
          usados.add(cc);
          await guardarTarifas();
          await updateDoc(doc(db, 'convenios_proveedores_detalles', String(residuo.id)), { status: String(t.status || 'Aprobado'), tarifa: Number(t.tarifa) || 0, tarifarioId: String(r.id) });
          ligadas += 1;
          continue;
        }
        const [cc] = await reservarConsecutivosDetalleProveedor(1);
        tarifas[i] = { ...t, consecutivo: cc };
        usados.add(cc);
        await guardarTarifas(); // ✅ la línea PRIMERO; el detalle después
        await setDoc(doc(db, 'convenios_proveedores_detalles', cc), {
          convenioId: convId,
          tipoConvenioId: String(t.tarifaReferenciaId || ''),
          tipoConvenioNombre: String(t.descripcion || ''),
          tarifa: Number(t.tarifa) || 0,
          moneda: nombreMoneda(t.cotizadoEn || r.moneda),
          consecutivo: cc,
          status: String(t.status || 'Aprobado'),
          tarifarioId: String(r.id),
        });
        creadas += 1;
      }
      // ── FASE 3 ✅ V00295: limpiar HUÉRFANOS — detalles que ESTA sincronización
      //   creó (tarifarioId = este tarifario), que ninguna línea usa ya y que
      //   tienen su gemelo original (misma descripción) en el convenio. ──
      let huerfanos = 0;
      for (const dDet of detalles) {
        const cc = String(dDet.consecutivo || dDet.id);
        if (usados.has(cc)) continue;
        if (String(dDet.tarifarioId || '') !== String(r.id)) continue;
        const gemelo = detalles.find((o) => String(o.id) !== String(dDet.id) && normDesc(o.tipoConvenioNombre) === normDesc(dDet.tipoConvenioNombre) && usados.has(String(o.consecutivo || o.id)));
        const vacioPropio = !normDesc(dDet.tipoConvenioNombre) && !String(dDet.tipoConvenioId || '').trim(); // ✅ V00301: residuo sin contenido
        if (!gemelo && !vacioPropio) continue;
        try { await deleteDoc(doc(db, 'convenios_proveedores_detalles', String(dDet.id))); huerfanos += 1; } catch { /* mejor esfuerzo */ }
      }
      if (ligadas + creadas + reparadas + huerfanos + reconstruidos > 0) {
        await updateDoc(doc(db, 'tarifario_proveedores', r.id), { tarifas });
        await registrarLog('Tarifario Proveedores', 'Edición', `Sincronizó convenios del pre convenio de "${razonSocialDe(r)}": ${ligadas} ligada(s), ${reparadas} duplicado(s) reparado(s), ${creadas} creada(s), ${huerfanos} huérfano(s) eliminado(s).`);
        if (!opciones?.silencioso) alert(`Sincronización completa. ✅\n\n· Líneas ligadas a su convenio original: ${ligadas}\n· Duplicados reparados (la línea volvió a su CONV original): ${reparadas}\n· Convenios creados (no existían): ${creadas}\n· Detalles reconstruidos (línea ya tenía su #): ${reconstruidos}\n· Duplicados huérfanos eliminados: ${huerfanos}${vacias > 0 ? `\n\n⚠ ${vacias} línea(s) VACÍA(S) (sin tarifa ni descripción): no generan convenio — complétalas o elimínalas con 🗑.` : ''}`);
      } else if (!opciones?.silencioso) {
        alert('Todas las líneas ya tienen su # de convenio correcto. ✅');
      }
      return { ligadas, reparadas, creadas, huerfanos };
    } catch (e) {
      console.error('No se pudo sincronizar:', e);
      if (!opciones?.silencioso) alert('No se pudo completar la sincronización.');
      return { ligadas: 0, reparadas: 0, creadas: 0, huerfanos: 0 };
    } finally {
      setSincronizandoConv(false);
    }
  };

  // ✅ V00295: SINCRONIZACIÓN GLOBAL — acomoda TODOS los tarifarios de una vez
  //   para que Convenios y Tarifarios digan lo mismo, sin duplicados.
  const [sincronizandoTodo, setSincronizandoTodo] = useState(false);
  // ✅ V00297: FASE INVERSA — recorre TODOS los detalles de convenios y liga
  //   cada uno a SU tarifario (tarifarioId), para que no quede un solo
  //   convenio sin tarifario. Resolución, del criterio más fuerte al más débil:
  //   (a) el tarifario cuya línea tiene el MISMO consecutivo (relación
  //   directa; además alinea status/tarifa del detalle con la línea);
  //   (b) el ÚNICO tarifario ligado al mismo convenio maestro;
  //   (c) un tarifario de la MISMA empresa con una línea de igual descripción
  //   (y monto si hay varias) — y si esa línea no tenía consecutivo, lo
  //   adopta, cerrando la relación en los dos sentidos.
  //   Lo que no se pueda resolver con certeza se reporta, no se inventa.
  const ligarConveniosSinTarifario = async (): Promise<{ ligados: number; pendientes: number }> => {
    const idsTarifarios = new Set(registros.map((x) => String(x.id)));
    const tariPorConsec = new Map<string, Doc>();
    const tarisPorConvenioId = new Map<string, Doc[]>();
    registros.forEach((r) => {
      const cid = String(r.convenioId || '').trim();
      if (cid) tarisPorConvenioId.set(cid, [...(tarisPorConvenioId.get(cid) || []), r]);
      (Array.isArray(r.tarifas) ? (r.tarifas as Doc[]) : []).forEach((t) => {
        const cc = String(t.consecutivo || '').trim();
        if (cc && !tariPorConsec.has(cc)) tariPorConsec.set(cc, r);
      });
    });
    const snapMaestros = await getDocs(collection(db, 'convenios_proveedores'));
    const entDeConvenio = new Map<string, string>();
    snapMaestros.docs.forEach((d) => entDeConvenio.set(d.id, String((d.data() as Doc).proveedorId || '')));
    const registrosPorEnt = new Map<string, Doc[]>();
    registros.forEach((r) => {
      const e = String(r.proveedorId || '').trim();
      if (e) registrosPorEnt.set(e, [...(registrosPorEnt.get(e) || []), r]);
    });
    const snapDetTodos = await getDocs(collection(db, 'convenios_proveedores_detalles'));
    let ligados = 0, pendientes = 0;
    for (const dSnap of snapDetTodos.docs) {
      const d = { id: dSnap.id, ...(dSnap.data() as Doc) };
      const tarActual = String(d.tarifarioId || '').trim();
      if (tarActual && idsTarifarios.has(tarActual)) continue; // ya está bien ligado
      const cc = String(d.consecutivo || d.id).trim();
      const descD = normDesc(d.tipoConvenioNombre);
      const montoD = Number(d.tarifa) || 0;
      // (a) por consecutivo — la relación directa
      let tari = tariPorConsec.get(cc);
      let lineaAlinear: Doc | null = null;
      if (tari) {
        lineaAlinear = (Array.isArray(tari.tarifas) ? (tari.tarifas as Doc[]) : []).find((t) => String(t.consecutivo || '') === cc) || null;
      }
      // (b) único tarifario del mismo convenio maestro
      if (!tari) {
        const delConvenio = tarisPorConvenioId.get(String(d.convenioId || '').trim()) || [];
        if (delConvenio.length === 1) tari = delConvenio[0];
      }
      // (c) por empresa + descripción (y monto si hay varias candidatas)
      let lineaAdoptar: { r: Doc; idx: number } | null = null;
      if (!tari && descD) {
        const ent = entDeConvenio.get(String(d.convenioId || '').trim()) || '';
        const candidatos: { r: Doc; idx: number }[] = [];
        (registrosPorEnt.get(ent) || []).forEach((r) => {
          (Array.isArray(r.tarifas) ? (r.tarifas as Doc[]) : []).forEach((t, idx) => {
            if (normDesc(t.descripcion) === descD) candidatos.push({ r, idx });
          });
        });
        let elegido = candidatos.length === 1 ? candidatos[0] : candidatos.find((c) => Math.abs((Number((c.r.tarifas as Doc[])[c.idx].tarifa) || 0) - montoD) < 0.005);
        if (!elegido && candidatos.length > 0) elegido = undefined;
        if (elegido) {
          tari = elegido.r;
          const linea = (elegido.r.tarifas as Doc[])[elegido.idx];
          if (!String(linea.consecutivo || '').trim()) lineaAdoptar = elegido; // la línea adopta este CONV
          else lineaAlinear = linea;
        }
      }
      if (!tari) { pendientes += 1; continue; }
      try {
        const cambios: Doc = { tarifarioId: String(tari.id) };
        if (lineaAlinear) {
          const stL = String(lineaAlinear.status || '').trim();
          if (stL && stL !== String(d.status || '')) cambios.status = stL;
          const tfL = Number(lineaAlinear.tarifa) || 0;
          if (tfL > 0 && Math.abs(tfL - montoD) >= 0.005) cambios.tarifa = tfL;
        }
        await updateDoc(doc(db, 'convenios_proveedores_detalles', d.id), cambios);
        if (lineaAdoptar) {
          const tarifasNuevas = [...(lineaAdoptar.r.tarifas as Doc[])];
          tarifasNuevas[lineaAdoptar.idx] = { ...tarifasNuevas[lineaAdoptar.idx], consecutivo: cc };
          await updateDoc(doc(db, 'tarifario_proveedores', String(lineaAdoptar.r.id)), { tarifas: tarifasNuevas });
          tariPorConsec.set(cc, lineaAdoptar.r);
        }
        ligados += 1;
      } catch { pendientes += 1; }
    }
    return { ligados, pendientes };
  };

  const sincronizarTodosLosTarifarios = async () => {
    if (sincronizandoTodo || sincronizandoConv) return;
    const conConvenio = registros.filter((x) => String(x.convenioId || '').trim());
    if (conConvenio.length === 0) { alert('No hay tarifarios con convenio para sincronizar.'); return; }
    if (!window.confirm(`Se van a sincronizar ${conConvenio.length} tarifario(s) contra sus convenios:\n\n· Las líneas sin # adoptan su CONV original (por tarifa y descripción).\n· Los duplicados creados por error se reparan y eliminan.\n· Solo se crean CONV nuevos cuando de verdad no existen.\n\n¿Continuar?`)) return;
    setSincronizandoTodo(true);
    let L = 0, R = 0, C = 0, H = 0, conCambios = 0;
    try {
      for (const r of conConvenio) {
        const res = (await sincronizarConvenios(r, { silencioso: true })) || { ligadas: 0, reparadas: 0, creadas: 0, huerfanos: 0 };
        L += res.ligadas; R += res.reparadas; C += res.creadas; H += res.huerfanos;
        if (res.ligadas + res.reparadas + res.creadas + res.huerfanos > 0) conCambios += 1;
      }
      // ✅ V00297: y ahora la relación INVERSA — ningún convenio sin tarifario.
      const inv = await ligarConveniosSinTarifario();
      alert(`Sincronización GLOBAL completa. ✅\n\n· Tarifarios revisados: ${conConvenio.length} (con cambios: ${conCambios})\n· Líneas ligadas a su convenio original: ${L}\n· Duplicados reparados: ${R}\n· Convenios creados: ${C}\n· Duplicados huérfanos eliminados: ${H}\n\nRelación inversa (convenios → tarifario):\n· Convenios ligados a su tarifario: ${inv.ligados}\n· Sin tarifario identificable (revisar a mano): ${inv.pendientes}`);
    } catch (e) { console.error(e); alert('La sincronización global se interrumpió; vuelve a ejecutarla para continuar.'); }
    setSincronizandoTodo(false);
  };

  const eliminarLinea = async (r: Doc, idx: number) => {
    if (!aut.verificarAccion('borrar')) return;
    const tarifas: Doc[] = Array.isArray(r.tarifas) ? [...(r.tarifas as Doc[])] : [];
    const t = tarifas[idx];
    if (!t) return;
    const cc = String(t.consecutivo || '').trim();
    if (!window.confirm(`¿Eliminar la tarifa "${t.descripcion || ''}"${cc ? ` (${cc})` : ''} de este pre convenio?${cc ? '\n\nTambién se eliminará su detalle en Convenios (Detalles del Convenio).' : ''}`)) return;
    try {
      tarifas.splice(idx, 1);
      await updateDoc(doc(db, 'tarifario_proveedores', r.id), { tarifas });
      if (cc) { try { await deleteDoc(doc(db, 'convenios_proveedores_detalles', cc)); } catch { /* mejor esfuerzo */ } }
      await registrarLog('Tarifario Proveedores', 'Eliminación', `Eliminó la tarifa "${t.descripcion || ''}"${cc ? ` (${cc})` : ''} del pre convenio de "${razonSocialDe(r)}".`);
    } catch (e) {
      console.error('No se pudo eliminar la tarifa:', e);
      alert('No se pudo eliminar la tarifa.');
    }
  };

  const cambiarStatusLinea = async (r: Doc, idx: number, nuevo: string) => {
    if (!aut.verificarAccion('editar', ['status'])) return;
    try {
      const tarifas = (Array.isArray(r.tarifas) ? r.tarifas : []).map((t: Doc, i: number) => (i === idx ? { ...t, status: nuevo } : t));
      await updateDoc(doc(db, 'tarifario_proveedores', r.id), { tarifas });
      // ✅ V00202: la línea y su detalle del convenio comparten status.
      const detL = detalleDeLinea(r, tarifas[idx]);
      if (detL) { try { await updateDoc(doc(db, 'convenios_proveedores_detalles', String(detL.id)), { status: nuevo }); } catch { /* mejor esfuerzo */ } }
      await registrarLog('Tarifario Proveedores', 'Edición', `Cambió el status de la tarifa "${tarifas[idx]?.descripcion || ''}" del pre convenio del proveedor "${r.proveedorNombre}" a "${nuevo}".`);
    } catch (e) {
      console.error('No se pudo cambiar el status de la tarifa:', e);
      alert('No se pudo cambiar el status de la tarifa.');
    }
  };

  /** ✅ V00201: líneas del tarifario con su CONSECUTIVO REAL — el guardado en
   *  la línea manda; si falta (migrados), se toma del detalle del convenio
   *  (por tarifarioId o por convenioId + tipo de tarifa, sin repetir). */
  const lineasConConsecutivo = (r: Doc): Doc[] => {
    const lineas: Doc[] = Array.isArray(r.tarifas) ? r.tarifas : [];
    const usados = new Set<string>();
    return lineas.map((t: Doc) => {
      if (String(t.consecutivo || '').trim()) return t;
      const det = detallesConv.find((d) =>
        !usados.has(String(d.id)) &&
        String(d.tipoConvenioId || '') === String(t.tarifaReferenciaId || '') &&
        ((String(d.tarifarioId || '') !== '' && String(d.tarifarioId) === String(r.id)) ||
          (String(r.convenioId || '') !== '' && String(d.convenioId || '') === String(r.convenioId)))
      );
      if (!det) return t;
      usados.add(String(det.id));
      const cons = String(det.consecutivo || (String(det.id).startsWith('CONV-') ? det.id : ''));
      return cons ? { ...t, consecutivo: cons } : t;
    });
  };

  /** ✅ V00202: detalle del convenio que corresponde a una línea (por consecutivo,
   *  por tarifarioId o por convenioId + tipo). */
  const detalleDeLinea = (r: Doc, t: Doc): Doc | undefined => {
    const cons = String(t.consecutivo || '').trim();
    if (cons) return detallesConv.find((d) => String(d.consecutivo || d.id) === cons);
    return detallesConv.find((d) =>
      String(d.tipoConvenioId || '') === String(t.tarifaReferenciaId || '') &&
      ((String(d.tarifarioId || '') !== '' && String(d.tarifarioId) === String(r.id)) ||
        (String(r.convenioId || '') !== '' && String(d.convenioId || '') === String(r.convenioId)))
    );
  };

  // ✅ V00202: COTIZADO EN editable por línea desde el detalle.
  const cambiarCotizadoLinea = async (r: Doc, idx: number, nuevo: 'USD' | 'MXN') => {
    if (!aut.verificarAccion('editar', ['cotizadoEn'])) return;
    try {
      const lineas: Doc[] = Array.isArray(r.tarifas) ? r.tarifas : [];
      const tarifas = lineas.map((t: Doc, i: number) => (i === idx ? { ...t, cotizadoEn: nuevo } : t));
      await updateDoc(doc(db, 'tarifario_proveedores', r.id), { tarifas });
      // Cascada al detalle del convenio (la moneda de cotización que ven Detalles y Operaciones).
      const det = detalleDeLinea(r, lineas[idx]);
      if (det) { try { await updateDoc(doc(db, 'convenios_proveedores_detalles', String(det.id)), { moneda: nombreMoneda(nuevo) }); } catch { /* mejor esfuerzo */ } }
      await registrarLog('Tarifario Proveedores', 'Edición', `Cambió el Cotizado En de la tarifa "${lineas[idx]?.descripcion || ''}" del pre convenio del proveedor "${r.proveedorNombre}" a ${nuevo}.`);
    } catch (e) {
      console.error('No se pudo cambiar el Cotizado En de la tarifa:', e);
      alert('No se pudo cambiar el Cotizado En de la tarifa.');
    }
  };

  // ── PDF con el formato del tarifario de Roelca (✅ V00192) ──
  const construirHTMLTarifario = (r: Doc): string => {
    const filas = lineasConConsecutivo(r).map((t: Doc, i: number) => {
      const tarifa = Number(t.tarifa) || (Array.isArray(t.costosSugeridos) ? Number(t.costosSugeridos[0]) : 0) || 0;
      return `<tr>
        <td class="num">${i + 1}</td>
        <td class="desc">${esc(t.descripcion || '')}</td>
        <td class="clave">${esc(t.consecutivo || t.clave || '')}</td>
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

    // ✅ V00250: los estilos van con el prefijo del contenedor porque el HTML
    //   ya no abre en una ventana aparte: se monta como <div> temporal en el
    //   propio documento (técnica de Operaciones/html2pdf) y sin el prefijo
    //   la regla de body/etc. contaminaría toda la app.
    const css = `
      #tarifario-pdf-hoja * { box-sizing: border-box; }
      #tarifario-pdf-hoja { font-family: Calibri, Arial, sans-serif; color: #000; margin: 0; padding: 10mm 12mm; font-size: 11.5px; width: 216mm; background: #fff; }
      #tarifario-pdf-hoja .encabezado { display: flex; align-items: flex-start; }
      #tarifario-pdf-hoja .logo { width: 150px; }
      #tarifario-pdf-hoja .logo img { width: 140px; }
      #tarifario-pdf-hoja .datos { flex: 1; text-align: center; color: #1f6fb2; line-height: 1.35; }
      #tarifario-pdf-hoja .datos .razon { color: #e07b00; font-weight: bold; font-size: 15px; }
      #tarifario-pdf-hoja .datos .rfc { font-weight: bold; }
      #tarifario-pdf-hoja .fecha-linea { text-align: right; margin: 14px 0 4px 0; }
      #tarifario-pdf-hoja .fecha-linea b { margin-right: 8px; }
      #tarifario-pdf-hoja .cliente-bloque { display: flex; justify-content: space-between; margin: 2px 0 14px 0; }
      #tarifario-pdf-hoja .cliente-nombre { font-weight: bold; text-decoration: underline; }
      #tarifario-pdf-hoja .tabla { width: 100%; border-collapse: collapse; margin-top: 6px; }
      #tarifario-pdf-hoja .tabla th { border-bottom: 1px solid #000; padding: 2px 6px; font-size: 11.5px; text-align: center; }
      #tarifario-pdf-hoja .tabla th.izq { text-align: left; padding-left: 30px; }
      #tarifario-pdf-hoja .tabla td { padding: 3px 6px; }
      #tarifario-pdf-hoja .tabla td.num { width: 24px; text-align: right; }
      #tarifario-pdf-hoja .tabla td.desc { text-align: left; }
      #tarifario-pdf-hoja .tabla td.clave { width: 120px; text-align: center; font-family: Consolas, monospace; }
      #tarifario-pdf-hoja .tabla td.signo { width: 14px; text-align: right; }
      #tarifario-pdf-hoja .tabla td.tarifa { width: 80px; text-align: right; }
      #tarifario-pdf-hoja .condiciones { margin-top: 26px; line-height: 1.55; }
      #tarifario-pdf-hoja .aviso { margin-top: 22px; }
      #tarifario-pdf-hoja .gracias { margin-top: 20px; }
      #tarifario-pdf-hoja .firma { margin-top: 26px; display: flex; justify-content: space-between; align-items: flex-end; }
      #tarifario-pdf-hoja .firma .contacto { line-height: 1.5; }
      #tarifario-pdf-hoja .firma .contacto a { color: #1f6fb2; }
      #tarifario-pdf-hoja .firma .aceptacion { width: 46%; text-align: center; border-top: 1px solid #000; padding-top: 3px; font-size: 10.5px; }
      #tarifario-pdf-hoja .ctpat-logo { margin-top: 18px; display: flex; justify-content: flex-end; }
      #tarifario-pdf-hoja .ctpat-logo .ctpat-caja { width: 46%; text-align: center; }
      #tarifario-pdf-hoja .ctpat-logo img { width: 34mm; }
    `;

    // ✅ V00250: ahora se devuelve un <div> (no un documento completo) para
    //   que html2pdf lo "fotografíe" y lo descargue directo, como Operaciones.
    return `<div id="tarifario-pdf-hoja">
      <style type="text/css">${css}</style>
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
      <div class="fecha-linea"><b>VIGENCIA:</b> ${esc(fechaLarga(vencimientoDe(r)))}</div>
      <div class="cliente-bloque">
        <div><span class="cliente-nombre">${esc(String(r.proveedorNombre || '').toUpperCase())}</span><br/><b>PROVEEDOR:</b> ${esc(String(r.proveedorNombreCorto || r.proveedorNombre || '').toUpperCase())}</div>
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
      <div class="ctpat-logo"><div class="ctpat-caja"><img src="${LOGO_CTPAT_SRC}" alt="CTPAT" /></div></div>
      </div>`;
  };

  // ✅ V00250: DESCARGA DIRECTA (un clic → se baja el PDF, sin abrir la
  //   impresora), la MISMA técnica de Operaciones (pdfGenerator/html2pdf):
  //   div temporal fuera de pantalla + espera de imágenes + .save().
  const exportarPDF = async (r: Doc) => {
    const cont = document.createElement('div');
    cont.style.position = 'fixed';
    cont.style.left = '-10000px';
    cont.style.top = '0';
    cont.innerHTML = construirHTMLTarifario(r);
    document.body.appendChild(cont);
    try {
      // Esperar a que TODAS las imágenes (logo Roelca y CTPAT) decodifiquen
      // antes de generar el PDF (lección de pdfGenerator: si no, se omiten).
      const imgs = Array.from(cont.querySelectorAll('img')) as HTMLImageElement[];
      await Promise.all(imgs.map((im) => (im.complete && im.naturalWidth > 0)
        ? Promise.resolve()
        : new Promise<void>((res) => { im.onload = () => res(); im.onerror = () => res(); })));
      const filename = `TARIFAS_${String(r.proveedorNombre || 'PROVEEDOR').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_${String(r.fecha || '').slice(0, 4)}.pdf`;
      await html2pdf().set({
        margin: 0,
        filename,
        image: { type: 'jpeg' as const, quality: 0.98 },
        html2canvas: { backgroundColor: '#ffffff', scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'letter', orientation: 'portrait' as const },
      }).from(cont.firstElementChild as HTMLElement).save();
    } catch (e) {
      console.error('No se pudo descargar el PDF del tarifario:', e);
      alert('No se pudo descargar el PDF del tarifario.');
    } finally {
      if (cont.parentNode) document.body.removeChild(cont);
    }
  };

  /** ✅ V00219: TODOS los tarifarios vencen el 31/12 del año en curso, salvo
   *  que se les haya capturado otra fecha de vencimiento. */
  const vencimientoDe = (r: Doc): string =>
    String(r.fechaVencimiento || '').trim() || `${hoyLocalISO().slice(0, 4)}-12-31`;

  /** ✅ V00212: ¿el tarifario ya venció? */
  const vencido = (r: Doc): boolean => vencimientoDe(r) < hoyLocalISO();

  /** Tabla interna de tarifas de un registro (formulario y detalle — ✅ V00194).
   *  ✅ V00198: con `editable` el STATUS de cada línea es un select (4 estados). */
  const tablaTarifasDe = (r: Doc, editable = false) => (
    <table className="tc-tabla-interna">
      <thead>
        <tr><th>CONSECUTIVO</th><th>TARIFAS</th><th>ORIGEN — DESTINO</th><th>TARIFAS SUGERIDAS</th><th>TARIFA</th><th>COTIZADO EN</th><th>STATUS</th>{editable && <th>ACCIONES</th>}</tr>{/* ✅ V00200 · ✅ V00283 */}
      </thead>
      <tbody>
        {lineasConConsecutivo(r).map((t: Doc, i: number) => (
          <tr key={`${r.id}-${i}`}>
            <td className="tc-td-consecutivo">{t.consecutivo || '—'}</td>{/* ✅ V00200 */}
            <td>
              <div>{t.descripcion || '—'}</div>
              {(t.clave || t.origen || t.destino) && (
                <div className="tc-sub-linea">{[t.clave, t.origen && `${t.origen} → ${t.destino || '?'}`].filter(Boolean).join(' · ')}</div>
              )}
            </td>
            <td className="tc-td-ruta">{(String(t.origen || '').trim() || String(t.destino || '').trim()) ? `${String(t.origen || '').trim() || '—'} — ${String(t.destino || '').trim() || '—'}` : '—'}</td>{/* ✅ V00300: la ruta que sincroniza el convenio, visible en la ficha */}
            <td className="tc-td-num">{(t.costosSugeridos || []).length > 0 ? (t.costosSugeridos as number[]).map(fmtMoney).join(' · ') : '—'}</td>
            <td className="tc-td-num">{fmtMoney(Number(t.tarifa) || (Array.isArray(t.costosSugeridos) ? Number(t.costosSugeridos[0]) : 0) || 0)}</td>
            <td>
              {editable ? (
                /* ✅ V00202: Cotizado En editable por línea */
                <select className="form-control tc-select-costo" value={canonMoneda(t.cotizadoEn || r.moneda) || 'USD'} onChange={(e) => cambiarCotizadoLinea(r, i, e.target.value as 'USD' | 'MXN')}>
                  <option value="USD">USD</option>
                  <option value="MXN">MXN</option>
                </select>
              ) : (
                (t.cotizadoEn || r.moneda) ? <span className={`tc-chip ${(t.cotizadoEn || r.moneda) === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{t.cotizadoEn || r.moneda}</span> : '—'
              )}
            </td>
            <td>
              {editable ? (
                /* ✅ V00198: cancelar/inactivar SOLO esta línea */
                <select className="form-control tc-select-costo" value={String(t.status || 'Pendiente')} onChange={(e) => cambiarStatusLinea(r, i, e.target.value)}>
                  {STATUS_TARIFARIO.map((st) => <option key={st} value={st}>{st}</option>)}
                </select>
              ) : (
                <span className={chipStatus(t.status)}>{t.status || 'Pendiente'}</span>
              )}
            </td>
            {editable && (
              <td className="tc-td-acciones-linea">{/* ✅ V00283: editar/eliminar la línea */}
                <button type="button" className="tc-btn-linea tc-btn-linea--editar" title="Editar esta tarifa (costo, moneda y status)"
                  onClick={(e) => { e.stopPropagation(); setLineaEditor({ regId: String(r.id), idx: i, tarifaRefId: String(t.tarifaReferenciaId || ''), costo: String(t.tarifa ?? ''), cotizadoEn: canonMoneda(t.cotizadoEn || r.moneda) || '', status: String(t.status || 'Pendiente'), origen: String(t.origen || ''), destino: String(t.destino || ''), tarifaTexto: String(t.descripcion || '') }); }}>{/* ✅ V00289: la descripción viaja con la línea (sin esperas) */}<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg></button>
                <button type="button" className="tc-btn-linea tc-btn-linea--borrar" title="Eliminar esta tarifa del pre convenio"
                  onClick={(e) => { e.stopPropagation(); eliminarLinea(r, i); }}>🗑</button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="tc-contenedor">
      {/* ✅ V00273: selector de archivo del tarifario firmado (oculto) */}
      <input ref={inputDocFirmadoRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="tc-input-doc-oculto" onChange={alElegirDocFirmado} />
      <div className="tc-encabezado">
        <div>
          <h1 className="tc-titulo">Tarifario Proveedores</h1>
          <p className="tc-sub">Pre convenios del proveedor a partir de las Tarifas de Referencia. La moneda y el crédito vienen de la tabla Empresas y no se editan aquí.</p>
        </div>
        <div className="tc-encabezado-botones">
          {/* ✅ V00196: migración de Convenios existentes → Tarifarios aprobados */}
          <button type="button" className="tc-btn-importar" disabled={migrando} title="Pasa todos los convenios de Convenios de Proveedores a Tarifario Clientes en status Aprobado" onClick={importarConvenios}>
            {migrando ? 'Importando…' : '⇪ Importar Convenios'}
          </button>
          <button type="button" className="tc-btn-importar tc-btn-sync-todo" disabled={sincronizandoTodo} title="Acomoda TODOS los tarifarios contra Convenios: liga originales, repara duplicados y elimina huérfanos" onClick={sincronizarTodosLosTarifarios}>{sincronizandoTodo ? '⏳ Sincronizando todo…' : '⟳ Sincronizar TODOS'}</button>{/* ✅ V00295 */}
          <button type="button" className="tc-btn-preconvenio" onClick={() => { limpiarCaptura(); setCapturaAbierta(true); setFecha(hoyLocalISO()); }}>
            + Nuevo Tarifario
          </button>
        </div>
      </div>

      {/* ── PRE CONVENIOS GUARDADOS ── */}
      <div className="tc-lista">
        <h2 className="tc-subtitulo">Pre convenios capturados</h2>

        {/* ✅ V00219: buscador y filtros */}
        <div className="tc-filtros">
          <input
            type="text"
            className="form-control tc-filtro-busqueda"
            placeholder="Buscar por consecutivo, proveedor, fecha o tarifa…"
            value={busquedaLista}
            onChange={(e) => setBusquedaLista(e.target.value)}
          />
          <select className="form-control tc-filtro-select" value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)}>
            <option value="">Todos los proveedors</option>
            {entidadesLista.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select className="form-control tc-filtro-select" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)}>
            <option value="">Todos los status</option>
            {STATUS_TARIFARIO.map((st) => <option key={st} value={st}>{st}</option>)}
          </select>
          <select className="form-control tc-filtro-select tc-filtro-corto" value={filtroMoneda} onChange={(e) => setFiltroMoneda(e.target.value)}>
            <option value="">Moneda</option>
            <option value="USD">USD</option>
            <option value="MXN">MXN</option>
          </select>
          {(busquedaLista || filtroEntidad || filtroStatus || filtroMoneda) && (
            <button type="button" className="tc-btn-limpiar" onClick={() => { setBusquedaLista(''); setFiltroEntidad(''); setFiltroStatus(''); setFiltroMoneda(''); }}>
              ✕ Limpiar
            </button>
          )}
          <span className="tc-filtros-conteo">{registrosVisibles.length} de {registros.length}</span>
        </div>
        {registros.length === 0 ? (
          <p className="tc-vacio">Aún no hay pre convenios capturados. Usa "+ Nuevo Tarifario" para crear el primero.</p>
        ) : (
          <div className="tc-marco">
            <table className="tc-tabla">
              <thead>
                <tr><th>ACCIONES</th><th>CONSECUTIVO</th><th>EMISIÓN</th><th>VENCE</th>{/* ✅ V00212 */}<th>PROVEEDOR</th><th>MONEDA</th><th>CRÉDITO</th><th>TARIFAS</th><th>STATUS</th></tr>{/* ✅ V00205: acciones primero */}
              </thead>
              <tbody>
                {registrosVisibles.map((r) => (
                  /* ✅ V00195: clic en la fila abre el DETALLE EN MODAL; acciones al inicio */
                  <tr key={r.id} className="tc-fila-click" onClick={() => setDetalleId(r.id)}>
                    <td className="tc-td-acciones" onClick={(e) => e.stopPropagation()}>
                      {/* ✅ V00200: iconos estándar azul/rojo (adiós emojis) */}
                      <span
                        className={`tc-doc-firmado${String(r.docFirmadoUrl || '') ? ' tc-doc-firmado--ok' : (esDocObligatorio(r) && String(r.status || '') === 'Aprobado' ? ' tc-doc-firmado--falta' : '')}`}
                        title={String(r.docFirmadoUrl || '')
                          ? `Tarifario firmado subido${r.docFirmadoFecha ? ` el ${r.docFirmadoFecha}` : ''} — clic para verlo; clic con Ctrl para reemplazarlo`
                          : (!esDocObligatorio(r)
                            ? 'Tarifario obligatorio: No — el documento es opcional (clic para subirlo si quieres)'
                            : (String(r.status || '') === 'Aprobado'
                              ? 'APROBADO SIN el tarifario firmado — clic para subir el escaneado firmado'
                              : 'Aún sin tarifario firmado — clic para subirlo (obligatorio para aprobar)'))}
                        onClick={(e) => { /* ✅ V00273 */
                          if (subiendoDocFirmado === String(r.id)) return;
                          const url = String(r.docFirmadoUrl || '');
                          if (url && !e.ctrlKey) { window.open(url, '_blank', 'noopener'); return; }
                          pedirTarifarioFirmado(r);
                        }}
                      >{subiendoDocFirmado === String(r.id) ? '⏳' : (String(r.docFirmadoUrl || '') ? '📄' : (esDocObligatorio(r) && String(r.status || '') === 'Aprobado' ? '⚠' : '📎'))}</span>
                      <button type="button" className="btn-small btn-edit tc-mr6" title="Editar este pre convenio" onClick={() => abrirEdicion(r)}><IconoEditar /></button>
                      <button type="button" className="btn-small btn-danger tc-mr6" title="Eliminar este pre convenio" onClick={() => eliminarRegistro(r)}><IconoEliminar /></button>
                      <button type="button" className="tc-btn-pdf" title="Exportar el tarifario en PDF" onClick={() => exportarPDF(r)}>PDF</button>
                    </td>
                    {/* ✅ V00205: consecutivo TARI-### (segunda columna) */}
                    <td className="tc-td-consecutivo">{r.consecutivo || (String(r.id).startsWith('TARI-') || String(r.id).startsWith('TAR-') ? r.id : '—')}</td>
                    <td>{r.fecha || '—'}</td>
                    <td className={vencido(r) ? 'tc-td-vencido' : ''}>{vencimientoDe(r)}</td>{/* ✅ V00219 */}{/* ✅ V00212 */}
                    <td className="tc-td-cliente">{razonSocialDe(r) || '—'}</td>{/* ✅ V00283 */}
                    <td>{r.moneda ? <span className={`tc-chip ${r.moneda === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{r.moneda}</span> : '—'}</td>
                    <td>{r.creditoDias > 0 ? `${r.creditoDias} día(s)` : '—'}</td>
                    <td className="tc-td-num">{Array.isArray(r.tarifas) ? r.tarifas.length : 0}</td>
                    <td><span className={chipStatus(r.status)}>{r.status || '—'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── ✅ V00195: MODAL DE DETALLE con toda la información ── */}
      {detalleId && (() => {
        const r = registros.find((x) => x.id === detalleId);
        if (!r) return null;
        return (
          <div className="modal-overlay tc-overlay" onClick={() => setDetalleId('')}>
            <div className="tc-modal tc-modal-detalle" onClick={(e) => e.stopPropagation()}>
              <div className="tc-modal-encabezado">
                <div>
                  <h3 className="tc-modal-titulo">Detalle del Pre Convenio — <span className="tc-td-cliente">{razonSocialDe(r) || '—'}</span></h3>
                  <p className="tc-modal-sub">Toda la información del registro. Desde aquí puedes aprobarlo o descargar el PDF.</p>
                </div>
                <button type="button" className="tc-cerrar" onClick={() => setDetalleId('')}>✕</button>
              </div>

              <div className="tc-detalle-datos">
                <div><span className="tc-label">Consecutivo</span><b className="tc-td-consecutivo">{r.consecutivo || (String(r.id).startsWith('TARI-') || String(r.id).startsWith('TAR-') ? r.id : '—')}</b></div>{/* ✅ V00203 */}
                <div><span className="tc-label">Fecha de Emisión</span><b>{r.fecha || '—'}</b></div>
                <div><span className="tc-label">Fecha de Vencimiento</span><b className={vencido(r) ? 'tc-td-vencido' : ''}>{vencimientoDe(r)}</b></div>{/* ✅ V00212 */}{/* ✅ V00201: sin número de convenio (no aplica) */}
                <div><span className="tc-label">Moneda</span>{r.moneda ? <span className={`tc-chip ${r.moneda === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{r.moneda}</span> : '—'}</div>
                <div><span className="tc-label">Crédito</span><b>{Number(r.creditoDias) > 0 ? `${r.creditoDias} día(s)` : '—'}{Number(r.limiteCredito) > 0 ? ` · Límite ${fmtMoney(Number(r.limiteCredito))}` : ''}</b></div>
                <div>
                  <span className="tc-label">Status</span>
                  {/* ✅ V00199: el status del tarifario se cambia desde aquí */}
                  <select className="form-control tc-select-costo" value={String(r.status || 'Pendiente')} onChange={(e) => cambiarStatusTarifario(r, e.target.value)}>
                    {STATUS_TARIFARIO.map((st) => <option key={st} value={st}>{st}</option>)}
                  </select>
                </div>
                <div><span className="tc-label">Creado por</span><b>{r.creadoPor || '—'}</b></div>
                <div><span className="tc-label">{String(r.status) === 'Aprobado' ? 'Aprobado por' : 'Editado por'}</span><b>{(String(r.status) === 'Aprobado' ? r.aprobadoPor : r.editadoPor) || '—'}</b></div>
                {String(r.docFirmadoUrl || '') !== '' && (
                  <div><span className="tc-label">Documento subido por</span><b>{r.docFirmadoPor || '—'}{r.docFirmadoFecha ? ` · ${r.docFirmadoFecha}` : ''}</b></div>
                )}{/* ✅ V00283 */}
              </div>

              <div className="tc-marco tc-modal-marco">
                {tablaTarifasDe(r, true)}
              </div>

              <div className="tc-modal-pie">
                <span className="tc-conteo-sel">{Array.isArray(r.tarifas) ? r.tarifas.length : 0} tarifa(s) en este pre convenio</span>
                <button type="button" className="tc-btn-agregar-linea" title="Agregar otra tarifa a este pre convenio"
                  onClick={() => setLineaEditor({ regId: String(r.id), idx: null, tarifaRefId: '', costo: '', cotizadoEn: '', status: 'Pendiente', origen: '', destino: '' })}>+ Agregar tarifa</button>{/* ✅ V00283 */}
                <button type="button" className="tc-btn-sincronizar-conv" title="Ligar las líneas sin # de convenio con su detalle en Convenios (o crearlo)" disabled={sincronizandoConv} onClick={() => sincronizarConvenios(r)}>{sincronizandoConv ? 'Sincronizando…' : '⟳ Sincronizar convenios'}</button>{/* ✅ V00289 */}
                <div className="tc-modal-botones">
                  {/* ✅ V00199: en el detalle, los botones llevan su NOMBRE */}
                  <button
                    type="button"
                    className={`btn-small tc-btn-nombrado tc-doc-firmado-ficha${String(r.docFirmadoUrl || '') ? ' tc-doc-firmado--ok' : (esDocObligatorio(r) && String(r.status || '') === 'Aprobado' ? ' tc-doc-firmado--falta' : '')}`}
                    title={String(r.docFirmadoUrl || '') ? `Tarifario firmado subido${r.docFirmadoFecha ? ` el ${r.docFirmadoFecha}` : ''} — clic para verlo; Ctrl+clic para reemplazarlo` : (esDocObligatorio(r) ? 'Subir el tarifario firmado (obligatorio para aprobar)' : 'Tarifario obligatorio: No — subir el documento es opcional')}
                    onClick={(e) => { /* ✅ V00274: documento firmado desde la ficha */
                      const url = String(r.docFirmadoUrl || '');
                      if (url && !e.ctrlKey) { window.open(url, '_blank', 'noopener'); return; }
                      pedirTarifarioFirmado(r);
                    }}
                  >{String(r.docFirmadoUrl || '') ? '📄' : '📎'} Tarifario firmado</button>
                  <button type="button" className="btn-small btn-edit tc-btn-nombrado" title="Editar este pre convenio" onClick={() => { setDetalleId(''); abrirEdicion(r); }}><IconoEditar /> Editar</button>
                  <button type="button" className="btn-small btn-danger tc-btn-nombrado" title="Eliminar este pre convenio" onClick={() => { setDetalleId(''); eliminarRegistro(r); }}><IconoEliminar /> Eliminar</button>
                  {String(r.status) !== 'Aprobado' && (
                    <button type="button" className="tc-btn-aprobar" onClick={() => aprobarRegistro(r)}>✔ Aprobar</button>
                  )}
                  <button type="button" className="tc-btn-pdf" onClick={() => exportarPDF(r)}>⬇ Descargar PDF</button>
                  <button type="button" className="btn btn-outline" onClick={() => setDetalleId('')}>Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── MODAL DE CAPTURA (✅ V00192; edición ✅ V00194) ── */}
      {capturaAbierta && (
        <div className="modal-overlay tc-overlay" onClick={cerrarCaptura}>
          <div className="tc-modal tc-modal-captura" onClick={(e) => e.stopPropagation()}>
            <div className="tc-modal-encabezado">
              <div>
                <h3 className="tc-modal-titulo">{editandoId ? 'Editar Tarifario' : 'Nuevo Tarifario'}</h3>
                <p className="tc-modal-sub">Elige el proveedor y presiona "Pre convenios" para armar el paquete de tarifas.</p>
              </div>
              <button type="button" className="tc-cerrar" onClick={cerrarCaptura}>✕</button>
            </div>

            <div className="tc-captura">
              <div className="tc-campo">
                <label className="tc-label">Fecha de Emisión</label>
                <input type="date" className="form-control" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </div>

              {/* ✅ V00212: vencimiento del tarifario (se hereda al convenio) */}
              <div className="tc-campo">
                <label className="tc-label">Fecha de Vencimiento</label>
                <input type="date" className="form-control" value={fechaVencimiento} onChange={(e) => setFechaVencimiento(e.target.value)} />
              </div>

              {/* ✅ V00274: TARIFARIO FIRMADO también desde el formulario — en
                  edición muestra el ya subido; el archivo elegido se sube AL
                  GUARDAR (en el nuevo, cuando ya existe el consecutivo). */}
              <div className="tc-campo tc-campo-docfirmado">
                <label className="tc-label">Tarifario firmado (escaneado){docObligatorioForm ? ' — obligatorio para aprobar' : ' — opcional para este tarifario'}</label>
                <div className="tc-docfirmado-linea">
                  {/* ✅ V00277: regla por tarifario */}
                  <label className="tc-doc-oblig-label" htmlFor="tcDocOblig">Tarifario obligatorio</label>
                  <select id="tcDocOblig" className="form-control tc-doc-oblig-select" value={docObligatorioForm ? 'si' : 'no'} onChange={(e) => setDocObligatorioForm(e.target.value === 'si')} title="Sí: no se puede aprobar sin el tarifario firmado. No: se puede aprobar sin documento.">
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                  {(() => {
                    const rEd = editandoId ? registros.find((x: Doc) => String(x.id) === editandoId) : null;
                    const urlActual = String(rEd?.docFirmadoUrl || '');
                    return (
                      <>
                        {docNuevoFile ? (
                          <span className="tc-docfirmado-nombre" title="Se subirá al guardar">📎 {docNuevoFile.name}</span>
                        ) : urlActual ? (
                          <button type="button" className="tc-docfirmado-ver" onClick={() => window.open(urlActual, '_blank', 'noopener')} title={`Subido${rEd?.docFirmadoFecha ? ` el ${rEd.docFirmadoFecha}` : ''} — clic para verlo`}>📄 {String(rEd?.docFirmadoNombre || 'Ver documento')}</button>
                        ) : (
                          <span className="tc-docfirmado-nombre tc-docfirmado-nombre--vacio">Sin documento</span>
                        )}
                        <button type="button" className="btn-small tc-docfirmado-btn" onClick={() => inputDocModalRef.current?.click()}>{urlActual || docNuevoFile ? 'Reemplazar…' : 'Elegir archivo…'}</button>
                        {docNuevoFile && <button type="button" className="btn-small tc-docfirmado-btn" onClick={() => setDocNuevoFile(null)} title="Quitar el archivo elegido">✕</button>}
                        <input ref={inputDocModalRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="tc-input-doc-oculto" onChange={(e) => { const f = e.target.files?.[0] || null; e.target.value = ''; if (f) setDocNuevoFile(f); }} />
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="tc-campo tc-campo-cliente">
                <label className="tc-label">Proveedor</label>
                <div className="tc-cliente-linea">{/* ✅ V00288: en EDICIÓN el nombre NO se escribe a mano — solo se elige de la lista */}
                <input
                  type="text"
                  className="form-control"
                  placeholder={cargandoCat ? 'Cargando empresas…' : 'Buscar proveedor…'}
                  value={busquedaProveedor}
                  disabled={cargandoCat}
                  readOnly={!!editandoId && !!proveedorSel}
                  title={editandoId && proveedorSel ? 'El nombre viene de Empresas (razón social). Usa "Cambiar" para elegir otro proveedor de la lista.' : undefined}
                  onChange={(e) => { if (editandoId && proveedorSel) return; setBusquedaCliente(e.target.value); setClienteSel(null); setSugerenciasAbiertas(true); }}
                  onFocus={() => { if (editandoId && proveedorSel) return; setSugerenciasAbiertas(true); }}
                />
                {!!editandoId && !!proveedorSel && (
                  <button type="button" className="tc-btn-cambiar-cliente" title="Elegir otro proveedor de la lista" onClick={() => { setClienteSel(null); setBusquedaCliente(''); setSugerenciasAbiertas(true); }}>Cambiar</button>
                )}
                </div>
                {sugerenciasAbiertas && sugerencias.length > 0 && !proveedorSel && (
                  <div className="tc-sugerencias">
                    {sugerencias.map((emp) => (
                      <button key={emp.id} type="button" className="tc-sugerencia" onClick={() => elegirProveedor(emp)}>
                        <span className="tc-sug-nombre">{emp.nombre}</span>
                        <span className="tc-sug-tipo">{emp.numeroCliente ? `${emp.numeroCliente} · ` : ''}{tiposDe(emp).join(' · ') || 'Sin tipo'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="tc-campo">
                <label className="tc-label">Moneda del Proveedor</label>
                <input type="text" className="form-control tc-solo-lectura" value={proveedorSel ? (etiquetaMoneda || 'SIN MONEDA en Empresas') : ''} placeholder="—" readOnly disabled />
              </div>

              <div className="tc-campo">
                <label className="tc-label">Crédito</label>
                <input type="text" className="form-control tc-solo-lectura" value={etiquetaCredito} placeholder="—" readOnly disabled />
              </div>
            </div>

            {/* ✅ V00193: pre convenios ya guardados del proveedor elegido, visibles en el formulario */}
            {proveedorSel && (
              <div className="tc-captura-guardados">
                <h4 className="tc-guardados-titulo">Pre convenios guardados de este proveedor</h4>
                {registros.filter((r) => String(r.proveedorId) === String(proveedorSel.id)).length === 0 ? (
                  <p className="tc-vacio tc-vacio-mini">Este proveedor aún no tiene pre convenios guardados.</p>
                ) : (
                  registros.filter((r) => String(r.proveedorId) === String(proveedorSel.id)).map((r) => (
                    <div key={`cap-${r.id}`} className="tc-guardado-bloque">
                      <div className="tc-guardado-encabezado">
                        <span><b>{r.fecha || '—'}</b> · {Array.isArray(r.tarifas) ? r.tarifas.length : 0} tarifa(s)</span>
                        <span className="tc-guardado-acciones">
                          <span className={chipStatus(r.status)}>{r.status || '—'}</span>
                          <button type="button" className="tc-btn-pdf" onClick={() => exportarPDF(r)}>PDF</button>
                        </span>
                      </div>
                      {tablaTarifasDe(r)}
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="tc-modal-pie">
              <span className="tc-conteo-sel">{proveedorSel ? `Proveedor: ${proveedorSel.nombre}` : 'Elige un proveedor para continuar'}</span>
              <div className="tc-modal-botones">
                <button type="button" className="btn btn-outline" onClick={cerrarCaptura}>Cancelar</button>
                {editandoId && (
                  <button type="button" className="tc-btn-guardar-cabecera" disabled={guardando} title="Guardar fechas, tarifario obligatorio y documento sin tocar las tarifas" onClick={guardarCabeceraEdicion}>
                    {guardando ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                )}{/* ✅ V00280 */}
                <button
                  type="button"
                  className="tc-btn-preconvenio"
                  disabled={!proveedorSel}
                  title={proveedorSel ? 'Elegir las tarifas de referencia que conforman el pre convenio' : 'Primero elige el cliente'}
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
      {modalAbierto && proveedorSel && (
        <div className="modal-overlay tc-overlay tc-overlay-tarifas" onClick={() => !guardando && setModalAbierto(false)}>
          <div className="tc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tc-modal-encabezado">
              <div>
                <h3 className="tc-modal-titulo">Pre convenio — <span className="tc-td-cliente">{proveedorSel.nombre}</span></h3>
                <p className="tc-modal-sub">
                  Marca las tarifas, captura la TARIFA y elige en qué moneda se cotiza. Se guardará con status <b>Pendiente</b>.
                  {etiquetaMoneda && <> Moneda del proveedor: <span className={`tc-chip ${monedaProveedor === 'USD' ? 'tc-chip-usd' : 'tc-chip-mxn'}`}>{monedaProveedor}</span></>}
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
                    {/* ✅ V00194: TARIFAS · TARIFAS SUGERIDAS · TARIFA (moneda) · COTIZADO EN */}
                    <tr><th className="tc-th-check"></th><th>TARIFAS</th><th>TARIFAS SUGERIDAS</th><th>TARIFA</th><th>COTIZADO EN</th></tr>
                  </thead>
                  <tbody>
                    {tarifasVisibles.map((t) => {
                      const costos = costosDe(t);
                      const marcada = seleccion.has(t.id);
                      return (
                        <tr key={t.id} className={marcada ? 'tc-fila-marcada' : ''} onClick={() => toggleTarifa(t)}>
                          <td className="tc-th-check">
                            <input type="checkbox" checked={marcada} onChange={() => toggleTarifa(t)} onClick={(e) => e.stopPropagation()} />
                          </td>
                          <td>
                            <div>{t.descripcion || '—'}</div>
                            {(claveDe(t) || t.origen || t.destino) && (
                              <div className="tc-sub-linea">{[claveDe(t), t.origen && `${t.origen} → ${t.destino || '?'}`].filter(Boolean).join(' · ')}</div>
                            )}
                          </td>
                          <td className="tc-td-num" onClick={(e) => e.stopPropagation()}>
                            {costos.length === 0 ? '—' : costos.map((c, i) => (
                              <button
                                key={i}
                                type="button"
                                className="tc-chip-sugerido"
                                title="Usar este costo como TARIFA"
                                onClick={() => { setTarifaValor((p) => ({ ...p, [t.id]: String(c) })); if (!marcada) toggleTarifa(t); }}
                              >
                                {fmtMoney(c)}
                              </button>
                            ))}
                          </td>
                          <td className="tc-td-num" onClick={(e) => e.stopPropagation()}>
                            {/* ✅ V00194: TARIFA como campo de moneda */}
                            <div className="tc-input-moneda">
                              <span>$</span>
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                className="form-control tc-input-tarifa"
                                placeholder="0.00"
                                value={tarifaValor[t.id] ?? ''}
                                onChange={(e) => setTarifaValor((p) => ({ ...p, [t.id]: e.target.value }))}
                              />
                            </div>
                          </td>
                          <td className="tc-td-num" onClick={(e) => e.stopPropagation()}>
                            <select
                              className="form-control tc-select-costo"
                              value={monedaTarifa[t.id] || ''}
                              onChange={(e) => setMonedaTarifa((p) => ({ ...p, [t.id]: e.target.value as 'USD' | 'MXN' }))}
                            >
                              <option value="">— Elegir —</option>{/* ✅ V00283: obligatoria */}
                              <option value="USD">USD</option>
                              <option value="MXN">MXN</option>
                            </select>
                            {/* ✅ V00214: agregar otra tarifa para ESTE MISMO servicio */}
                            {marcada && (
                              <button
                                type="button"
                                className="tc-btn-otra-tarifa"
                                title="Agregar otra tarifa para este mismo servicio (con monto distinto)"
                                onClick={() => setExtras((p) => [...p, { key: `x${Date.now()}-${t.id}`, tarifaRefId: String(t.id), valor: '', moneda: (monedaTarifa[t.id] || '') as 'USD' | 'MXN' }])}
                              >
                                + otra tarifa
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {/* ✅ V00214: líneas EXTRA de la misma tarifa (otro monto) */}
                    {extras.filter((x) => seleccion.has(x.tarifaRefId) && tarifasVisibles.some((t) => String(t.id) === x.tarifaRefId)).map((x) => {
                      const t = tarifasRef.find((tr) => String(tr.id) === x.tarifaRefId);
                      return (
                        <tr key={x.key} className="tc-fila-extra">
                          <td className="tc-th-check tc-extra-marca">↳</td>
                          <td>
                            <div>{t?.descripcion || '—'}</div>
                            <div className="tc-sub-linea">Tarifa adicional del mismo servicio</div>
                          </td>
                          <td className="tc-td-num">—</td>
                          <td className="tc-td-num">
                            <div className="tc-input-moneda">
                              <span>$</span>
                              <input
                                type="number" min="0" step="0.01"
                                className="form-control tc-input-tarifa"
                                placeholder="0.00"
                                value={x.valor}
                                onChange={(e) => setExtras((p) => p.map((y) => y.key === x.key ? { ...y, valor: e.target.value } : y))}
                              />
                            </div>
                          </td>
                          <td className="tc-td-num">
                            <select
                              className="form-control tc-select-costo"
                              value={x.moneda}
                              onChange={(e) => setExtras((p) => p.map((y) => y.key === x.key ? { ...y, moneda: e.target.value as 'USD' | 'MXN' } : y))}
                            >
                              <option value="USD">USD</option>
                              <option value="MXN">MXN</option>
                            </select>
                            <button type="button" className="tc-btn-quitar-extra" title="Quitar esta tarifa adicional" onClick={() => setExtras((p) => p.filter((y) => y.key !== x.key))}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            <div className="tc-modal-pie">
              <span className="tc-conteo-sel"><b>{seleccion.size + extras.filter((x) => seleccion.has(x.tarifaRefId)).length}</b> línea(s) · {seleccion.size} servicio(s)</span>{/* ✅ V00214 */}
              <div className="tc-modal-botones">
                <button type="button" className="btn btn-outline" disabled={guardando} onClick={() => setModalAbierto(false)}>Cancelar</button>
                <button type="button" className="tc-btn-guardar" disabled={seleccion.size === 0 || guardando} onClick={guardarPreConvenio}>
                  {guardando ? 'Guardando…' : editandoId ? 'Guardar cambios' : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ✅ V00286: FORMULARIO de tarifa (Agregar/Editar) — mismo diseño que
          "Agregar convenio": tarifario, tarifa del catálogo, origen/destino,
          descripción automática, costo, moneda y status. El ⚙ configura los
          CAMPOS OBLIGATORIOS y esa configuración es compartida (Firestore):
          aplica a TODOS los usuarios. */}
      {lineaEditor && (() => {
        const rEd = registros.find((x) => String(x.id) === lineaEditor.regId);
        if (!rEd) return null;
        const esNueva = lineaEditor.idx === null;
        const refSel = tarifasRef.find((t) => String(t.id) === lineaEditor.tarifaRefId);
        const lineaAct = !esNueva && Array.isArray(rEd.tarifas) ? (rEd.tarifas as Doc[])[lineaEditor.idx as number] : undefined;
        const consLinea = String(lineaAct?.consecutivo || '');
        const descripcionAuto = `${consLinea || 'CONV-### (al guardar)'} - ${String(refSel?.descripcion || lineaAct?.descripcion || '')}`.trim();
        const ob = configOblig;
        const ast = (k: keyof typeof ob) => (ob[k] ? ' *' : '');
        return (
          <div className="modal-overlay tc-overlay tc-overlay-linea" onClick={(e) => { if (e.target !== e.currentTarget) return; if (window.confirm('¿Seguro que quieres salir?\n\nSe perderán los cambios sin guardar.')) setLineaEditor(null); }}>{/* ✅ V00288: solo el clic DIRECTO al fondo pregunta */}
            <div className="tc-modal tc-modal-linea" onClick={(e) => e.stopPropagation()}>
              <div className="tc-modal-encabezado">
                <div>
                  <h3 className="tc-modal-titulo">{esNueva ? 'Agregar tarifa' : 'Editar tarifa'} — <span className="tc-td-cliente">{razonSocialDe(rEd)}</span></h3>
                  <p className="tc-modal-sub">{esNueva ? 'El consecutivo CONV-### se asigna solo al guardar (si el tarifario ya tiene convenio).' : `${consLinea} · edición de la línea.`}</p>
                </div>
                <div className="tc-linea-encabezado-acciones">
                  <button type="button" className="tc-btn-config-oblig" title="Configurar los campos obligatorios de este formulario (aplica a TODOS los usuarios)" onClick={() => setMostrarConfigOblig((v) => !v)}>⚙</button>
                  <button type="button" className="tc-cerrar" onClick={() => { if (window.confirm('¿Seguro que quieres salir?\n\nSe perderán los cambios sin guardar.')) setLineaEditor(null); }}>✕</button>
                </div>
              </div>

              {mostrarConfigOblig && (
                <div className="tc-config-oblig">
                  <div className="tc-config-oblig-titulo">Campos obligatorios (para todos los usuarios)</div>
                  {(Object.keys(ETIQUETAS_CAMPOS_TARIFA) as (keyof CamposObligatoriosTarifa)[]).map((k) => (
                    <label key={k} className="tc-config-oblig-item">
                      <input type="checkbox" checked={!!configOblig[k]} onChange={(e) => setConfigOblig((p) => ({ ...p, [k]: e.target.checked }))} />
                      <span>{ETIQUETAS_CAMPOS_TARIFA[k]}</span>
                    </label>
                  ))}
                  <label className="tc-config-oblig-item tc-config-oblig-item--fija" title="Regla de negocio: no se puede desactivar">
                    <input type="checkbox" checked disabled />
                    <span>Cotizado En (siempre obligatoria)</span>
                  </label>
                  <button type="button" className="tc-btn-guardar-cabecera tc-btn-guardar-oblig" disabled={guardandoOblig} onClick={guardarConfigOblig}>{guardandoOblig ? 'Guardando…' : 'Guardar configuración'}</button>
                </div>
              )}

              <div className="tc-form-grid tc-form-grid-linea">
                <label className="tc-campo">
                  <span># de tarifario</span>
                  <input type="text" className="form-control" value={`${String(rEd.consecutivo || rEd.id)} - ${razonSocialDe(rEd)}`} readOnly />
                </label>
                <label className="tc-campo">
                  <span>Tarifa (catálogo){ast('tarifaRefId')}</span>
                  <input type="text" className="form-control" list="tcListaTarifasProv" placeholder="Buscar..." disabled={!esNueva}
                    value={refSel ? String(refSel.descripcion || '') : (lineaEditor.tarifaTexto || (lineaEditor.tarifaRefId ? String((tarifasRef.find((x) => String(x.id) === lineaEditor.tarifaRefId)?.descripcion) || '') : ''))}
                    onChange={(e) => {
                      const texto = e.target.value;
                      const t = tarifasRef.find((x) => String(x.descripcion || '') === texto);
                      setLineaEditor((p) => (p ? { ...p, tarifaTexto: texto, tarifarioTexto: p.tarifarioTexto, tarifaRefId: t ? String(t.id) : '', origen: t ? String(t.origen || p.origen || '') : p.origen, destino: t ? String(t.destino || p.destino || '') : p.destino } : p));
                    }} />
                  <datalist id="tcListaTarifasProv">
                    {tarifasRef.map((t) => <option key={String(t.id)} value={String(t.descripcion || t.id)} />)}
                  </datalist>
                </label>
                <label className="tc-campo">
                  <span>Origen{ast('origen')}</span>
                  <input type="text" className="form-control" placeholder="Buscar..." value={lineaEditor.origen} onChange={(e) => setLineaEditor((p) => (p ? { ...p, origen: e.target.value } : p))} />
                </label>
                <label className="tc-campo">
                  <span>Destino{ast('destino')}</span>
                  <input type="text" className="form-control" placeholder="Buscar..." value={lineaEditor.destino} onChange={(e) => setLineaEditor((p) => (p ? { ...p, destino: e.target.value } : p))} />
                </label>
                <label className="tc-campo tc-campo-ancho">
                  <span>Descripción (automática)</span>
                  <input type="text" className="form-control" value={descripcionAuto} readOnly />
                </label>
                <label className="tc-campo">
                  <span>Costo de la Tarifa{ast('costo')}</span>
                  <input type="number" min="0" step="0.01" className="form-control" value={lineaEditor.costo} onChange={(e) => setLineaEditor((p) => (p ? { ...p, costo: e.target.value } : p))} />
                </label>
                <label className="tc-campo">
                  <span>Cotizado En *</span>
                  <select className="form-control" value={lineaEditor.cotizadoEn} onChange={(e) => setLineaEditor((p) => (p ? { ...p, cotizadoEn: e.target.value } : p))}>{/* ✅ V00289: lista desplegable */}
                    <option value="">Selecciona una moneda</option>
                    <option value="USD">USD</option>
                    <option value="MXN">MXN</option>
                  </select>
                </label>
                <label className="tc-campo">
                  <span>Status{ast('status')}</span>
                  <input type="text" className="form-control" list="tcListaStatusProv" placeholder="Buscar..." value={lineaEditor.status} onChange={(e) => setLineaEditor((p) => (p ? { ...p, status: e.target.value } : p))} />
                  <datalist id="tcListaStatusProv">{STATUS_TARIFARIO.map((st) => <option key={st} value={st} />)}</datalist>
                </label>
              </div>
              <div className="tc-modal-pie">
                <span className="tc-conteo-sel">{canonMoneda(lineaEditor.cotizadoEn) ? '' : 'Elige la moneda de cotización para poder guardar.'}</span>
                <div className="tc-modal-botones">
                  <button type="button" className="btn btn-outline" onClick={() => { if (window.confirm('¿Seguro que quieres salir?\n\nSe perderán los cambios sin guardar.')) setLineaEditor(null); }}>Cancelar</button>
                  <button type="button" className="tc-btn-guardar-cabecera" disabled={guardandoLinea || !canonMoneda(lineaEditor.cotizadoEn) || (esNueva && !lineaEditor.tarifaRefId)} onClick={guardarLineaEditor}>
                    {guardandoLinea ? 'Guardando…' : 'Guardar cambios'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default TarifarioProveedoresDashboard;

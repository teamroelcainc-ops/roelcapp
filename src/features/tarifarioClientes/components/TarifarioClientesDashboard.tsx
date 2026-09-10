// src/features/tarifarioClientes/components/TarifarioClientesDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ V00191 — TARIFARIO CLIENTES (módulo nuevo): captura de pre convenios a
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
//     tiene convenio se agregan ahí (regla: un convenio por cliente); si no,
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
//     convenios_clientes_detalles — la fuente de la verdad es el consecutivo
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
import { collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../../../config/firebase';
import { registrarLog } from '../../../utils/logger';
import { hoyLocalISO } from '../../../utils/fechaHoraLocal';
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';
import { useAutorizacionesCampos } from '../../autorizaciones/useAutorizacionesCampos';
import { reservarConsecutivosDetalle, reservarConsecutivosTarifario } from '../../conveniosDetalles/consecutivos'; // ✅ V00199/V00203
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

export function TarifarioClientesDashboard() {
  // ── Catálogos ──
  const [empresas, setEmpresas] = useState<Doc[]>([]);
  const [tiposEmpresaCat, setTiposEmpresaCat] = useState<Record<string, string>>({});
  const [tarifasRef, setTarifasRef] = useState<Doc[]>([]);
  const [cargandoCat, setCargandoCat] = useState(true);

  // ── Captura (modal) ──
  const [capturaAbierta, setCapturaAbierta] = useState(false);
  const [fecha, setFecha] = useState(hoyLocalISO());
  // ✅ V00212: fechas de emisión (fecha) y VENCIMIENTO del tarifario; el
  //   convenio que se cree al aprobar hereda ambas.
  const [fechaVencimiento, setFechaVencimiento] = useState(`${hoyLocalISO().slice(0, 4)}-12-31`);
  const [busquedaCliente, setBusquedaCliente] = useState('');
  const [sugerenciasAbiertas, setSugerenciasAbiertas] = useState(false);
  const [clienteSel, setClienteSel] = useState<Doc | null>(null);
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
  const aut = useAutorizacionesCampos('tarifarioClientes');

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
        const nums = await reservarConsecutivosTarifario(orden.length);
        for (let i = 0; i < orden.length; i++) {
          await updateDoc(doc(db, 'tarifario_clientes', orden[i].id), { consecutivo: nums[i] });
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
      if (String(d?.modulo || '') !== 'tarifarioClientes' || !d?.texto) return;
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
      query(collection(db, 'tarifario_clientes'), orderBy('createdAt', 'desc'), limit(200)),
      (snap) => setRegistros(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setRegistros([])
    );
    // ✅ V00201: consecutivos reales desde Detalles del Convenio, siempre al día.
    const unsubDet = onSnapshot(
      collection(db, 'convenios_clientes_detalles'),
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

  const limpiarCaptura = () => {
    setEditandoId('');
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
    setCapturaAbierta(false);
    setModalAbierto(false);
    setSugerenciasAbiertas(false);
    limpiarCaptura();
  };

  // ✅ V00194: abrir la captura en modo EDICIÓN con todo precargado.
  const abrirEdicion = (r: Doc) => {
    const emp = empresas.find((e) => String(e.id) === String(r.clienteId));
    const pseudo = emp || { id: r.clienteId, nombre: r.clienteNombre, nombreCorto: r.clienteNombreCorto, moneda: r.moneda, diasCredito: r.creditoDias, limiteCredito: r.limiteCredito };
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

  // ✅ V00219: lista filtrada (buscador de texto + cliente + status + moneda).
  const registrosVisibles = useMemo(() => {
    const b = norm(busquedaLista);
    return registros.filter((r) => {
      if (filtroStatus && String(r.status || 'Pendiente') !== filtroStatus) return false;
      if (filtroEntidad && String(r.clienteNombre || '') !== filtroEntidad) return false;
      if (filtroMoneda && canonMoneda(r.moneda) !== filtroMoneda) return false;
      if (!b) return true;
      const enTarifas = (Array.isArray(r.tarifas) ? r.tarifas : []).some((t: Doc) =>
        norm(t.descripcion).includes(b) || norm(t.consecutivo).includes(b));
      return norm(r.clienteNombre).includes(b) || norm(r.consecutivo).includes(b) ||
        norm(r.id).includes(b) || norm(r.fecha).includes(b) || enTarifas;
    });
  }, [registros, busquedaLista, filtroStatus, filtroEntidad, filtroMoneda]);

  const entidadesLista = useMemo(
    () => Array.from(new Set(registros.map((r) => String(r.clienteNombre || '')).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
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
    if (!clienteSel || seleccion.size === 0 || guardando) return;
    // ✅ V00195: Agregar y Editar se autorizan POR SEPARADO según las reglas del módulo.
    if (!aut.verificarAccion(editandoId ? 'editar' : 'crear', editandoId ? ['fecha', 'clienteId', 'tarifas', 'tarifa', 'cotizadoEn'] : [])) return;
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
          cotizadoEn: mon || monedaCliente || 'USD',
          status: 'Pendiente',
        };
      };
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
        clienteId: String(clienteSel.id),
        clienteNombre: String(clienteSel.nombre || ''),
        clienteNombreCorto: String(clienteSel.nombreCorto || ''),
        moneda: monedaCliente,
        monedaNombre: etiquetaMoneda,
        creditoDias,
        limiteCredito,
        tarifas: lineas, // ✅ V00214
        status: 'Pendiente',
      };
      if (editandoId) {
        // ✅ V00194: EDICIÓN de un pre convenio existente.
        await updateDoc(doc(db, 'tarifario_clientes', editandoId), {
          ...payload,
          editadoEl: new Date().toISOString(),
          editadoPor: auth.currentUser?.email || '',
        });
        await registrarLog('Tarifario Clientes', 'Edición', `Editó el pre convenio de "${clienteSel.nombre}" (${fecha}) con ${elegidas.length} tarifa(s).`);
      } else {
        // ✅ V00203: consecutivo TAR-### reservado por transacción; la CLAVE del doc ES el consecutivo.
        const [consecTar] = await reservarConsecutivosTarifario(1);
        await setDoc(doc(db, 'tarifario_clientes', consecTar), {
          ...payload,
          consecutivo: consecTar,
          createdAt: new Date().toISOString(),
          creadoPor: auth.currentUser?.email || '',
        });
        await registrarLog('Tarifario Clientes', 'Creación', `Creó el pre convenio ${consecTar} de "${clienteSel.nombre}" con ${elegidas.length} tarifa(s) (status Pendiente).`);
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
    if (!window.confirm(`¿Eliminar el pre convenio de "${r.clienteNombre}" del ${r.fecha}?`)) return;
    try {
      await deleteDoc(doc(db, 'tarifario_clientes', r.id));
      await registrarLog('Tarifario Clientes', 'Eliminación', `Eliminó el pre convenio de "${r.clienteNombre}" (${r.fecha}).`);
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
      getDocs(collection(db, 'convenios_clientes')),
      getDocs(collection(db, 'convenios_clientes_detalles')),
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
  const aprobarRegistro = async (r: Doc) => {
    if (!aut.verificarAccion('editar', ['status'])) return; // ✅ V00195: aprobar = editar Status
    if (!window.confirm(`¿Aprobar el pre convenio de "${r.clienteNombre}" del ${r.fecha}?\n\nSus tarifas pasarán al módulo de Convenios (Detalles del Convenio).`)) return;
    try {
      let convenioId = String(r.convenioId || '');
      let numeroConvenio = String(r.numeroConvenio || '');

      if (!convenioId) {
        const { snapConv, sigConvenio } = await siguientes();
        // ✅ V00199: consecutivos reservados por transacción (únicos, sin brincos)
        const lineas: Doc[] = Array.isArray(r.tarifas) ? r.tarifas : [];
        const consecutivos = await reservarConsecutivosDetalle(lineas.length);
        const batch = writeBatch(db);

        // Regla de la app: UN convenio por cliente — si ya existe, se agregan ahí.
        const existente = snapConv.docs.find((d) => String((d.data() as Doc).clienteId || '') === String(r.clienteId || ''));
        let convenioRef;
        if (existente) {
          convenioRef = doc(db, 'convenios_clientes', existente.id);
          numeroConvenio = String((existente.data() as Doc).numeroConvenio || '');
        } else {
          convenioRef = doc(collection(db, 'convenios_clientes'));
          numeroConvenio = `CONV-${pad3(sigConvenio)}`;
          batch.set(convenioRef, {
            numeroConvenio,
            clienteId: String(r.clienteId || ''),
            clienteNombre: String(r.clienteNombre || ''),
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
          batch.set(doc(db, 'convenios_clientes_detalles', consecutivos[i]), {
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

        batch.update(doc(db, 'tarifario_clientes', r.id), {
          status: 'Aprobado',
          // ✅ V00200: cada línea guarda SU consecutivo (la clave del detalle)
          tarifas: lineas.map((t: Doc, i: number) => ({ ...t, status: 'Aprobado', consecutivo: consecutivos[i] })),
          convenioId,
          numeroConvenio,
          aprobadoEl: new Date().toISOString(),
          aprobadoPor: auth.currentUser?.email || '',
        });
        await batch.commit();
        await registrarLog('Tarifario Clientes', 'Aprobación', `Aprobó el pre convenio de "${r.clienteNombre}" (${r.fecha}) y pasó ${Array.isArray(r.tarifas) ? r.tarifas.length : 0} tarifa(s) al convenio ${numeroConvenio}.`);
        alert(`Pre convenio aprobado. Sus tarifas ya están en el convenio ${numeroConvenio} (Detalles del Convenio). ✅`);
      } else {
        await updateDoc(doc(db, 'tarifario_clientes', r.id), {
          status: 'Aprobado',
          tarifas: (Array.isArray(r.tarifas) ? r.tarifas : []).map((t: Doc) => ({ ...t, status: 'Aprobado' })),
          aprobadoEl: new Date().toISOString(),
          aprobadoPor: auth.currentUser?.email || '',
        });
        await registrarLog('Tarifario Clientes', 'Aprobación', `Aprobó el pre convenio de "${r.clienteNombre}" (${r.fecha}).`);
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
    if (!window.confirm('¿Importar TODOS los convenios de "Convenios de Clientes" a Tarifario Clientes en status "Aprobado" con todas sus tarifas?\n\nTambién se asignará el consecutivo (CONV-001…) a los detalles que no lo tengan. Los convenios ya importados se saltan.')) return;
    setMigrando(true);
    try {
      const { snapConv, snapDet } = await siguientes();
      const snapTarifarios = await getDocs(collection(db, 'tarifario_clientes'));
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
      const reservados = await reservarConsecutivosDetalle(sinConsecutivo.length);
      for (let i = 0; i < sinConsecutivo.length; i++) {
        await updateDoc(doc(db, 'convenios_clientes_detalles', sinConsecutivo[i].id), { consecutivo: reservados[i] });
      }
      // ✅ V00202: si un detalle está en Detalles del Convenio, está APROBADO.
      let statusPuestos = 0;
      for (const d of snapDet.docs) {
        if (!String((d.data() as Doc).status || '').trim()) {
          await updateDoc(doc(db, 'convenios_clientes_detalles', d.id), { status: 'Aprobado' });
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
      const consecsTar = await reservarConsecutivosTarifario(porImportar.length);
      let importados = 0;
      for (const d of porImportar) {
        const c = d.data() as Doc;
        const emp = empresaDe[String(c.clienteId || '')] || {};
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
        await setDoc(doc(db, 'tarifario_clientes', consecTar), {
          consecutivo: consecTar, // ✅ V00203
          fecha: String(c.fechaConvenio || hoyLocalISO()),
          fechaVencimiento: String(c.fechaVencimiento || `${String(c.fechaConvenio || hoyLocalISO()).slice(0, 4)}-12-31`), // ✅ V00212
          clienteId: String(c.clienteId || ''),
          clienteNombre: String(c.clienteNombre || ''),
          clienteNombreCorto: String(emp.nombreCorto || ''),
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
      const tarNuevos = await reservarConsecutivosTarifario(tarSinConsec.length);
      for (let i = 0; i < tarSinConsec.length; i++) {
        await updateDoc(doc(db, 'tarifario_clientes', tarSinConsec[i].id), { consecutivo: tarNuevos[i] });
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
          await updateDoc(doc(db, 'tarifario_clientes', td.id), { tarifas: nuevas });
          reparados += 1;
        }
      }

      await registrarLog('Tarifario Clientes', 'Migración', `Importó ${importados} convenio(s) a Tarifario Clientes en status Aprobado y asignó ${sinConsecutivo.length} consecutivo(s) a Detalles del Convenio.`);
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
      await updateDoc(doc(db, 'tarifario_clientes', r.id), { status: nuevo });
      await registrarLog('Tarifario Clientes', 'Edición', `Cambió el status del pre convenio de "${r.clienteNombre}" (${r.fecha}) a "${nuevo}".`);
    } catch (e) {
      console.error('No se pudo cambiar el status del tarifario:', e);
      alert('No se pudo cambiar el status del tarifario.');
    }
  };

  // ✅ V00198: cambiar el status de UNA línea del pre convenio (Cancelado /
  //   Inactivo / etc.) sin afectar el resto — se autoriza como editar Status.
  const cambiarStatusLinea = async (r: Doc, idx: number, nuevo: string) => {
    if (!aut.verificarAccion('editar', ['status'])) return;
    try {
      const tarifas = (Array.isArray(r.tarifas) ? r.tarifas : []).map((t: Doc, i: number) => (i === idx ? { ...t, status: nuevo } : t));
      await updateDoc(doc(db, 'tarifario_clientes', r.id), { tarifas });
      // ✅ V00202: la línea y su detalle del convenio comparten status.
      const detL = detalleDeLinea(r, tarifas[idx]);
      if (detL) { try { await updateDoc(doc(db, 'convenios_clientes_detalles', String(detL.id)), { status: nuevo }); } catch { /* mejor esfuerzo */ } }
      await registrarLog('Tarifario Clientes', 'Edición', `Cambió el status de la tarifa "${tarifas[idx]?.descripcion || ''}" del pre convenio de "${r.clienteNombre}" a "${nuevo}".`);
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
      await updateDoc(doc(db, 'tarifario_clientes', r.id), { tarifas });
      // Cascada al detalle del convenio (la moneda de cotización que ven Detalles y Operaciones).
      const det = detalleDeLinea(r, lineas[idx]);
      if (det) { try { await updateDoc(doc(db, 'convenios_clientes_detalles', String(det.id)), { moneda: nombreMoneda(nuevo) }); } catch { /* mejor esfuerzo */ } }
      await registrarLog('Tarifario Clientes', 'Edición', `Cambió el Cotizado En de la tarifa "${lineas[idx]?.descripcion || ''}" del pre convenio de "${r.clienteNombre}" a ${nuevo}.`);
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
      <div class="fecha-linea"><b>VIGENCIA:</b> ${esc(fechaLarga(vencimientoDe(r)))}</div>
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
        <tr><th>CONSECUTIVO</th><th>TARIFAS</th><th>TARIFAS SUGERIDAS</th><th>TARIFA</th><th>COTIZADO EN</th><th>STATUS</th></tr>{/* ✅ V00200 */}
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
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="tc-contenedor">
      <div className="tc-encabezado">
        <div>
          <h1 className="tc-titulo">Tarifario Clientes</h1>
          <p className="tc-sub">Pre convenios del cliente a partir de las Tarifas de Referencia. La moneda y el crédito vienen de la tabla Empresas y no se editan aquí.</p>
        </div>
        <div className="tc-encabezado-botones">
          {/* ✅ V00196: migración de Convenios existentes → Tarifarios aprobados */}
          <button type="button" className="tc-btn-importar" disabled={migrando} title="Pasa todos los convenios de Convenios de Clientes a Tarifario Clientes en status Aprobado" onClick={importarConvenios}>
            {migrando ? 'Importando…' : '⇪ Importar Convenios'}
          </button>
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
            placeholder="Buscar por consecutivo, cliente, fecha o tarifa…"
            value={busquedaLista}
            onChange={(e) => setBusquedaLista(e.target.value)}
          />
          <select className="form-control tc-filtro-select" value={filtroEntidad} onChange={(e) => setFiltroEntidad(e.target.value)}>
            <option value="">Todos los clientes</option>
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
                <tr><th>ACCIONES</th><th>CONSECUTIVO</th><th>EMISIÓN</th><th>VENCE</th>{/* ✅ V00212 */}<th>CLIENTE</th><th>MONEDA</th><th>CRÉDITO</th><th>TARIFAS</th><th>STATUS</th></tr>{/* ✅ V00205: acciones primero */}
              </thead>
              <tbody>
                {registrosVisibles.map((r) => (
                  /* ✅ V00195: clic en la fila abre el DETALLE EN MODAL; acciones al inicio */
                  <tr key={r.id} className="tc-fila-click" onClick={() => setDetalleId(r.id)}>
                    <td className="tc-td-acciones" onClick={(e) => e.stopPropagation()}>
                      {/* ✅ V00200: iconos estándar azul/rojo (adiós emojis) */}
                      <button type="button" className="btn-small btn-edit tc-mr6" title="Editar este pre convenio" onClick={() => abrirEdicion(r)}><IconoEditar /></button>
                      <button type="button" className="btn-small btn-danger tc-mr6" title="Eliminar este pre convenio" onClick={() => eliminarRegistro(r)}><IconoEliminar /></button>
                      <button type="button" className="tc-btn-pdf" title="Exportar el tarifario en PDF" onClick={() => exportarPDF(r)}>PDF</button>
                    </td>
                    {/* ✅ V00205: consecutivo TARI-### (segunda columna) */}
                    <td className="tc-td-consecutivo">{r.consecutivo || (String(r.id).startsWith('TARI-') || String(r.id).startsWith('TAR-') ? r.id : '—')}</td>
                    <td>{r.fecha || '—'}</td>
                    <td className={vencido(r) ? 'tc-td-vencido' : ''}>{vencimientoDe(r)}</td>{/* ✅ V00219 */}{/* ✅ V00212 */}
                    <td className="tc-td-cliente">{r.clienteNombre || '—'}</td>
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
                  <h3 className="tc-modal-titulo">Detalle del Pre Convenio — <span className="tc-td-cliente">{r.clienteNombre || '—'}</span></h3>
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
              </div>

              <div className="tc-marco tc-modal-marco">
                {tablaTarifasDe(r, true)}
              </div>

              <div className="tc-modal-pie">
                <span className="tc-conteo-sel">{Array.isArray(r.tarifas) ? r.tarifas.length : 0} tarifa(s) en este pre convenio</span>
                <div className="tc-modal-botones">
                  {/* ✅ V00199: en el detalle, los botones llevan su NOMBRE */}
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
                <p className="tc-modal-sub">Elige el cliente y presiona "Pre convenios" para armar el paquete de tarifas.</p>
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

            {/* ✅ V00193: pre convenios ya guardados del cliente elegido, visibles en el formulario */}
            {clienteSel && (
              <div className="tc-captura-guardados">
                <h4 className="tc-guardados-titulo">Pre convenios guardados de este cliente</h4>
                {registros.filter((r) => String(r.clienteId) === String(clienteSel.id)).length === 0 ? (
                  <p className="tc-vacio tc-vacio-mini">Este cliente aún no tiene pre convenios guardados.</p>
                ) : (
                  registros.filter((r) => String(r.clienteId) === String(clienteSel.id)).map((r) => (
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
                  Marca las tarifas, captura la TARIFA y elige en qué moneda se cotiza. Se guardará con status <b>Pendiente</b>.
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
                              value={monedaTarifa[t.id] || monedaCliente || 'USD'}
                              onChange={(e) => setMonedaTarifa((p) => ({ ...p, [t.id]: e.target.value as 'USD' | 'MXN' }))}
                            >
                              <option value="USD">USD</option>
                              <option value="MXN">MXN</option>
                            </select>
                            {/* ✅ V00214: agregar otra tarifa para ESTE MISMO servicio */}
                            {marcada && (
                              <button
                                type="button"
                                className="tc-btn-otra-tarifa"
                                title="Agregar otra tarifa para este mismo servicio (con monto distinto)"
                                onClick={() => setExtras((p) => [...p, { key: `x${Date.now()}-${t.id}`, tarifaRefId: String(t.id), valor: '', moneda: monedaTarifa[t.id] || (monedaCliente as 'USD' | 'MXN') || 'USD' }])}
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
    </div>
  );
}

export default TarifarioClientesDashboard;

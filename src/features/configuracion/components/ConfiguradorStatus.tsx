import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { collection, doc, getDoc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';

/* ============================================================
   TIPOS
============================================================ */
interface NodoPosicion { x: number; y: number; }

interface ReglaStatus {
  id: string;
  orden: number;
  nombreStatus: string;
  tipoMecanismo: 'automatico' | 'manual' | 'boton_decision';
  camposRequeridos: string[];
  opcionesSiguientes: string[];   // ids de los nodos siguientes
  posicion?: NodoPosicion;
  descripcion?: string;
}

interface FlujoGuardado {
  id: string;
  configId: string;
  tipoServicio: string;
  trafico: string;
  carga: string;
  ultimaActualizacion: string;
  flujo: ReglaStatus[];
}

type CombinacionEdicion =
  | { tipoServicio: string; trafico: string; carga: string; flujo?: ReglaStatus[] }
  | undefined;

/* ============================================================
   CATÁLOGO COMPLETO DE CAMPOS DE OPERACIÓN
   Todos los campos del FormularioOperacion, agrupados por sección.
   Estos son los que pueden marcarse como "requeridos" para que un nodo
   automático avance, o como obligatorios antes de mostrar un manual/decisión.
============================================================ */
const CAMPOS_OPERACION_COMPLETOS: { seccion: string; campos: { id: string; label: string }[] }[] = [
  {
    seccion: 'General',
    campos: [
      { id: 'tipoOperacionId',        label: 'Tipo de Operación' },
      { id: 'fechaServicio',          label: 'Fecha de Servicio' },
      { id: 'fechaCita',              label: 'Fecha de Cita' },
      { id: 'clientePaga',            label: 'Cliente (Paga)' },
      { id: 'convenio',               label: 'Convenio (Tarifa)' },
      { id: 'numeroRemolque',         label: 'Número de Remolque' },
      { id: 'refCliente',             label: 'Ref Cliente' },
      { id: 'origen',                 label: 'Origen' },
      { id: 'destino',                label: 'Destino' },
      { id: 'observacionesEjecutivo', label: 'Observaciones Ejecutivo' },
    ],
  },
  {
    seccion: 'Pedimento y Carta Porte',
    campos: [
      { id: 'clienteMercancia',     label: 'Cliente (Mercancía)' },
      { id: 'descripcionMercancia', label: 'Descripción Mercancía' },
      { id: 'cantidad',             label: 'Cantidad' },
      { id: 'embalaje',             label: 'Embalaje' },
      { id: 'pesoKg',               label: 'Peso (Kg)' },
      { id: 'numDoda',              label: '# DODA' },
      { id: 'fechaEmisionDoda',     label: 'Fecha Emisión DODA' },
      { id: 'pdfCartaPorte',        label: 'PDF Carta Porte' },
      { id: 'pdfDoda',              label: 'PDF DODA' },
    ],
  },
  {
    seccion: "Entry's y Manifiesto",
    campos: [
      { id: 'numeroEntrys',     label: "# de Entry's" },
      { id: 'cantEntrys',       label: "Cantidad de Entry's" },
      { id: 'pdfsEntrys',       label: "PDFs Entry's" },
      { id: 'numManifiesto',    label: '# Manifiesto' },
      { id: 'provServicios',    label: 'Proveedor de Servicios' },
      { id: 'montoManifiesto',  label: 'Costo Manifiesto' },
      { id: 'pdfManifiesto',    label: 'PDF Manifiesto' },
    ],
  },
  {
    seccion: 'Unidad y Operador',
    campos: [
      { id: 'proveedorUnidad',        label: 'Proveedor de Transporte' },
      { id: 'facturadoEnUnidad',      label: 'Facturado En (Unidad)' },
      { id: 'convenioProveedor',      label: 'Convenio Proveedor' },
      { id: 'totalAPagarProv',        label: 'Monto a Pagar Proveedor' },
      { id: 'cargosAdicionalesProv',  label: 'Cargos Adicionales Proveedor' },
      { id: 'unidad',                 label: 'Unidad (Flota Interna)' },
      { id: 'operador',               label: 'Operador (Flota Interna)' },
      { id: 'sueldoOperador',         label: 'Sueldo Operador' },
      { id: 'sueldoExtra',            label: 'Sueldo Extra' },
      { id: 'combustible',            label: 'Combustible' },
      { id: 'combustibleExtra',       label: 'Combustible Extra' },
      { id: 'unidadProveedor',        label: 'Unidad del Proveedor (Externa)' },
      { id: 'operadorProveedor',      label: 'Operador del Proveedor (Externo)' },
      { id: 'observacionesUnidad',    label: 'Observaciones Unidad' },
    ],
  },
  {
    seccion: 'Por Cobrar',
    campos: [
      { id: 'facturadoEnCobrar',     label: 'Facturado En (Cobrar)' },
      { id: 'montoConvenioCliente',  label: 'Monto Convenio Cliente' },
      { id: 'cargosAdicionales',     label: 'Cargos Adicionales Cliente' },
      { id: 'tipoCambioAprobado',    label: 'Tipo de Cambio Aprobado' },
      { id: 'observacionesCobrar',   label: 'Observaciones Cobrar' },
    ],
  },
];

// Mapa plano id → label para búsquedas rápidas
const CAMPOS_OPERACION_FLAT: { id: string; label: string }[] =
  CAMPOS_OPERACION_COMPLETOS.flatMap(s => s.campos);

const labelCampo = (id: string): string =>
  CAMPOS_OPERACION_FLAT.find(c => c.id === id)?.label || id;

const TIPO_META: Record<ReglaStatus['tipoMecanismo'], { label: string; color: string; bg: string; icon: string }> = {
  automatico:     { label: 'Automático',       color: '#34d399', bg: 'rgba(52,211,153,0.10)', icon: '⚡' },
  manual:         { label: 'Acción Manual',    color: '#60a5fa', bg: 'rgba(96,165,250,0.10)', icon: '✋' },
  boton_decision: { label: 'Decisión',         color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '◇' },
};

/* ============================================================
   CONSTANTES DE LAYOUT
============================================================ */
const NODE_W = 260;
const NODE_H = 96;
const GRID = 20;
const SIDEBAR_W = 260;
const INSPECTOR_W = 340;

/* ============================================================
   MODAL: SELECCIÓN DE CAMPOS REQUERIDOS
============================================================ */
const ModalCamposRequeridos = ({
  abierto,
  seleccionados,
  tipoMecanismo,
  onConfirmar,
  onCerrar,
}: {
  abierto: boolean;
  seleccionados: string[];
  tipoMecanismo: ReglaStatus['tipoMecanismo'];
  onConfirmar: (ids: string[]) => void;
  onCerrar: () => void;
}) => {
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    if (abierto) {
      setSeleccion(new Set(seleccionados));
      setBusqueda('');
    }
  }, [abierto, seleccionados]);

  if (!abierto) return null;

  const toggle = (id: string) => {
    setSeleccion(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const marcarSeccion = (campos: { id: string }[]) => {
    setSeleccion(prev => {
      const next = new Set(prev);
      campos.forEach(c => next.add(c.id));
      return next;
    });
  };

  const limpiarSeccion = (campos: { id: string }[]) => {
    setSeleccion(prev => {
      const next = new Set(prev);
      campos.forEach(c => next.delete(c.id));
      return next;
    });
  };

  const limpiarTodo = () => setSeleccion(new Set());

  const filtro = busqueda.trim().toLowerCase();
  const seccionesFiltradas = filtro
    ? CAMPOS_OPERACION_COMPLETOS
        .map(s => ({
          ...s,
          campos: s.campos.filter(c =>
            c.label.toLowerCase().includes(filtro) || c.id.toLowerCase().includes(filtro)
          ),
        }))
        .filter(s => s.campos.length > 0)
    : CAMPOS_OPERACION_COMPLETOS;

  const meta = TIPO_META[tipoMecanismo];

  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 3000,
        background: 'rgba(5,7,12,0.7)',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{
        width: 'min(720px, 100%)', maxHeight: '88vh',
        background: 'linear-gradient(180deg, #11151d 0%, #0d1118 100%)',
        border: '1px solid #232a3a', borderRadius: 14,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid #1c2230',
          background: `linear-gradient(180deg, ${meta.bg}, transparent)`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: meta.bg, color: meta.color,
              border: `1px solid ${meta.color}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700,
            }}>{meta.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#e6ebf5', letterSpacing: -0.2 }}>
                Campos requeridos para avanzar
              </div>
              <div style={{ fontSize: 12, color: '#7a8499', marginTop: 2 }}>
                Marca los campos del formulario de operaciones que deben estar llenos.
              </div>
            </div>
            <button onClick={onCerrar} style={{
              background: 'none', border: 'none', color: '#7a8499',
              cursor: 'pointer', fontSize: 20, padding: '0 4px',
            }} title="Cerrar (Esc)">×</button>
          </div>

          {/* Buscador */}
          <input
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar campo…"
            style={{
              width: '100%',
              background: '#0a0d14',
              border: '1px solid #232a3a',
              color: '#e6ebf5',
              borderRadius: 8,
              padding: '9px 12px',
              fontSize: 13,
              outline: 'none',
              marginTop: 10,
            }}
          />
        </div>

        {/* Lista */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
          {seccionesFiltradas.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#5f697d', fontSize: 13 }}>
              No se encontraron campos.
            </div>
          ) : seccionesFiltradas.map(sec => {
            const totalSec = sec.campos.length;
            const marcadosSec = sec.campos.filter(c => seleccion.has(c.id)).length;
            return (
              <div key={sec.seccion} style={{ marginBottom: 16 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  marginBottom: 8,
                }}>
                  <div style={{
                    fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2,
                    color: '#a9b3c7', fontWeight: 700,
                  }}>
                    {sec.seccion}
                    <span style={{
                      marginLeft: 8, background: '#1a1f2b', border: '1px solid #2a3142',
                      borderRadius: 999, padding: '1px 8px', fontSize: 10.5, color: '#7a8499',
                      fontWeight: 600,
                    }}>
                      {marcadosSec}/{totalSec}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => marcarSeccion(sec.campos)} style={miniBtn}>Marcar todos</button>
                    <button onClick={() => limpiarSeccion(sec.campos)} style={miniBtn}>Limpiar</button>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {sec.campos.map(c => {
                    const checked = seleccion.has(c.id);
                    return (
                      <label key={c.id} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 10px',
                        background: checked ? `${meta.bg}` : '#0f1320',
                        border: `1px solid ${checked ? meta.color + '66' : '#222a39'}`,
                        borderRadius: 8,
                        cursor: 'pointer',
                        transition: 'all 120ms ease',
                        fontSize: 12.5,
                        color: checked ? '#e6ebf5' : '#a9b3c7',
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(c.id)}
                          style={{ accentColor: meta.color, flexShrink: 0 }}
                        />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid #1c2230',
          background: '#0a0d14',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: 12,
        }}>
          <div style={{ fontSize: 12, color: '#7a8499' }}>
            <b style={{ color: '#e6ebf5' }}>{seleccion.size}</b> campo{seleccion.size === 1 ? '' : 's'} seleccionado{seleccion.size === 1 ? '' : 's'}
            {seleccion.size > 0 && (
              <button onClick={limpiarTodo} style={{
                marginLeft: 10, background: 'none', border: 'none',
                color: '#f87171', cursor: 'pointer', fontSize: 12, padding: 0,
              }}>Limpiar todo</button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onCerrar} style={{
              background: '#1a1f2b', color: '#c9d1d9',
              border: '1px solid #2c3344', borderRadius: 8,
              padding: '8px 14px', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}>Cancelar</button>
            <button onClick={() => onConfirmar(Array.from(seleccion))} style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff', border: 'none', borderRadius: 8,
              padding: '8px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(99,102,241,0.3)',
            }}>Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const miniBtn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #2a3142',
  color: '#a9b3c7',
  borderRadius: 6,
  padding: '3px 8px',
  fontSize: 11,
  cursor: 'pointer',
};

/* ============================================================
   EDITOR PRINCIPAL
============================================================ */
const EditorFlujoAppSheet = ({
  flujoInicial,
  onVolver
}: {
  flujoInicial?: CombinacionEdicion;
  onVolver: () => void;
}) => {
  /* ---------- estado base ---------- */
  const [catalogoStatus, setCatalogoStatus] = useState<string[]>([]);
  const [tiposOperacion, setTiposOperacion] = useState<any[]>([]);
  // ✅ NUEVO: opciones del dropdown "Tráfico" vienen ahora del catálogo `catalogo_trafico`
  const [traficos, setTraficos] = useState<string[]>([]);
  const [tipoServicio, setTipoServicio] = useState(flujoInicial?.tipoServicio || '');
  const [trafico, setTrafico]           = useState(flujoInicial?.trafico       || '');
  const [carga, setCarga]               = useState(flujoInicial?.carga         || '');
  const [reglas, setReglas]             = useState<ReglaStatus[]>([]);
  const [cargando, setCargando]         = useState(false);
  const [guardando, setGuardando]       = useState(false);
  const [mensaje, setMensaje]           = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null);

  /* ---------- canvas ---------- */
  const [zoom, setZoom]             = useState(1);
  const [pan, setPan]               = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning]   = useState(false);
  const panStart                    = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  /* ---------- selección / drag ---------- */
  const [nodoSel, setNodoSel]                 = useState<string | null>(null);
  const [seleccionados, setSeleccionados]     = useState<Set<string>>(new Set());
  const [draggingId, setDraggingId]           = useState<string | null>(null);
  const dragOffset                            = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /* ---------- conexiones ---------- */
  const [conectando, setConectando]   = useState<{ from: string; toX: number; toY: number } | null>(null);

  /* ---------- portapapeles ---------- */
  const [clipboardInfo, setClipboardInfo]   = useState<{ count: number; origen: string } | null>(null);

  /* ---------- ✅ NUEVO: visibilidad de paneles laterales ---------- */
  const [sidebarVisible, setSidebarVisible]     = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);

  /* ---------- ✅ NUEVO: modal de campos requeridos ---------- */
  const [modalCamposAbierto, setModalCamposAbierto] = useState(false);

  /* ---------- ✅ NUEVO: dropdown del botón "Agregar paso" ---------- */
  const [menuAgregarAbierto, setMenuAgregarAbierto] = useState(false);

  /* ---------- refs ---------- */
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const configId = `${tipoServicio}_${trafico}_${carga}`;
  const configValido = !!tipoServicio && !!trafico && !!carga;

  /* ============================================================
     CARGA INICIAL
  ============================================================ */
  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const statusSnap = await getDocs(collection(db, 'catalogo_status_servicio'));
        setCatalogoStatus(statusSnap.docs.map(d => d.data().nombre).sort());
        const opSnap = await getDocs(collection(db, 'catalogo_tipo_operacion'));
        setTiposOperacion(opSnap.docs.map(d => ({ id: d.id, tipo_operacion: d.data().tipo_operacion })));
        // ✅ NUEVO: lee `catalogo_trafico` y deja solo los `nombre` ordenados
        const trafSnap = await getDocs(collection(db, 'catalogo_trafico'));
        setTraficos(
          trafSnap.docs
            .map(d => (d.data() as any).nombre)
            .filter((n: any) => typeof n === 'string' && n.trim() !== '')
            .sort((a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' }))
        );
      } catch (e) {
        console.error(e);
      }
    };
    cargarDatos();
    leerClipboardInfo();
  }, []);

  const leerClipboardInfo = () => {
    try {
      const raw = localStorage.getItem('roelca_flujo_clipboard');
      if (!raw) { setClipboardInfo(null); return; }
      const parsed = JSON.parse(raw);
      if (parsed?.nodos?.length) {
        setClipboardInfo({ count: parsed.nodos.length, origen: parsed.origen || 'flujo previo' });
      } else {
        setClipboardInfo(null);
      }
    } catch {
      setClipboardInfo(null);
    }
  };

  useEffect(() => {
    const cargarReglas = async () => {
      if (!configValido) { setReglas([]); return; }
      setCargando(true);
      try {
        const docSnap = await getDoc(doc(db, 'config_flujos_operacion', configId));
        if (docSnap.exists()) {
          const flujoData: ReglaStatus[] = (docSnap.data().flujo || [])
            .sort((a: ReglaStatus, b: ReglaStatus) => a.orden - b.orden)
            .map((r: ReglaStatus, i: number) => ({
              ...r,
              posicion: r.posicion ?? autoPosicion(i),
            }));
          setReglas(flujoData);
        } else {
          setReglas([]);
        }
      } finally {
        setCargando(false);
      }
    };
    cargarReglas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipoServicio, trafico, carga]);

  /* posición automática inicial en cascada diagonal suave */
  const autoPosicion = (i: number): NodoPosicion => ({
    x: 120 + (i % 3) * (NODE_W + 80),
    y: 120 + Math.floor(i / 3) * (NODE_H + 100) + (i % 3) * 40,
  });

  /* ============================================================
     ✅ NUEVO: AUTO-CENTRAR EL FLUJO
     Se ejecuta cuando:
       - se toggle la visibilidad de los paneles laterales
       - se cargan reglas nuevas
     Calcula el bounding box del flujo y ajusta `pan` para que
     el centro del flujo coincida con el centro del canvas visible.
  ============================================================ */
  const centrarFlujo = useCallback(() => {
    if (reglas.length === 0 || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const minX = Math.min(...reglas.map(r => r.posicion?.x ?? 0));
    const maxX = Math.max(...reglas.map(r => (r.posicion?.x ?? 0) + NODE_W));
    const minY = Math.min(...reglas.map(r => r.posicion?.y ?? 0));
    const maxY = Math.max(...reglas.map(r => (r.posicion?.y ?? 0) + NODE_H));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setPan({
      x: rect.width / 2 - cx * zoom,
      y: rect.height / 2 - cy * zoom,
    });
  }, [reglas, zoom]);

  // Centra cuando cambia la visibilidad de cualquier panel.
  // Pequeño delay para que el DOM termine la transición de ancho.
  useEffect(() => {
    const t = setTimeout(centrarFlujo, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarVisible, inspectorVisible]);

  /* ============================================================
     ATAJOS DE TECLADO
  ============================================================ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return;
      }
      // No procesar atajos si hay un modal abierto (excepto Escape)
      if (modalCamposAbierto && e.key !== 'Escape') return;

      const cmd = e.ctrlKey || e.metaKey;

      if (cmd && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        copiarSeleccion();
      } else if (cmd && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        pegarClipboard();
      } else if (cmd && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicarSeleccion();
      } else if (cmd && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        seleccionarTodo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (seleccionados.size > 0) {
          e.preventDefault();
          eliminarSeleccion();
        }
      } else if (e.key === 'Escape') {
        if (modalCamposAbierto) setModalCamposAbierto(false);
        else if (menuAgregarAbierto) setMenuAgregarAbierto(false);
        else {
          setNodoSel(null);
          setSeleccionados(new Set());
          setConectando(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodoSel, seleccionados, reglas, modalCamposAbierto, menuAgregarAbierto]);

  /* ============================================================
     COORDENADAS DEL MOUSE EN EL CANVAS (en unidades del mundo)
  ============================================================ */
  const mouseToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top  - pan.y) / zoom,
    };
  }, [pan.x, pan.y, zoom]);

  /* ============================================================
     PAN DEL CANVAS
  ============================================================ */
  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).dataset.canvasBg !== 'true') return;
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };

  /* ============================================================
     DRAG DE NODOS
  ============================================================ */
  const onNodeMouseDown = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const regla = reglas.find(r => r.id === id);
    if (!regla?.posicion) return;

    if (e.ctrlKey || e.metaKey) {
      setSeleccionados(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      setNodoSel(id);
    } else {
      if (!seleccionados.has(id)) {
        setSeleccionados(new Set([id]));
      }
      setNodoSel(id);
    }

    setDraggingId(id);
    const w = mouseToWorld(e.clientX, e.clientY);
    dragOffset.current = { x: w.x - regla.posicion.x, y: w.y - regla.posicion.y };
  };

  /* ============================================================
     MOVIMIENTO GLOBAL DE MOUSE
  ============================================================ */
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isPanning && panStart.current) {
        setPan({
          x: panStart.current.px + (e.clientX - panStart.current.x),
          y: panStart.current.py + (e.clientY - panStart.current.y),
        });
      }
      if (draggingId) {
        const w = mouseToWorld(e.clientX, e.clientY);
        const nx = Math.round((w.x - dragOffset.current.x) / GRID) * GRID;
        const ny = Math.round((w.y - dragOffset.current.y) / GRID) * GRID;

        setReglas(prev => {
          const anchor = prev.find(r => r.id === draggingId);
          if (!anchor?.posicion) return prev;
          const dx = nx - anchor.posicion.x;
          const dy = ny - anchor.posicion.y;
          const target = seleccionados.size > 1 && seleccionados.has(draggingId)
            ? seleccionados
            : new Set([draggingId]);
          return prev.map(r => {
            if (!target.has(r.id) || !r.posicion) return r;
            return { ...r, posicion: { x: r.posicion.x + dx, y: r.posicion.y + dy } };
          });
        });
      }
      if (conectando) {
        const w = mouseToWorld(e.clientX, e.clientY);
        setConectando(c => c ? { ...c, toX: w.x, toY: w.y } : c);
      }
    };
    const onUp = (e: MouseEvent) => {
      if (isPanning && panStart.current) {
        const dx = Math.abs(e.clientX - panStart.current.x);
        const dy = Math.abs(e.clientY - panStart.current.y);
        const movioApenas = dx < 5 && dy < 5;
        const conModif = e.ctrlKey || e.metaKey || e.shiftKey;
        if (movioApenas && !conModif) {
          setNodoSel(null);
          setSeleccionados(new Set());
        }
      }
      setIsPanning(false);
      panStart.current = null;
      setDraggingId(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isPanning, draggingId, conectando, mouseToWorld]);

  /* ============================================================
     ZOOM (rueda)
  ============================================================ */
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = -e.deltaY * 0.001;
    setZoom(z => Math.max(0.4, Math.min(1.6, z + delta)));
  };

  /* ============================================================
     OPERACIONES SOBRE NODOS
  ============================================================ */
  const agregarNodo = (tipo: ReglaStatus['tipoMecanismo']) => {
    const idx = reglas.length;
    const nuevo: ReglaStatus = {
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      orden: idx + 1,
      nombreStatus: '',
      tipoMecanismo: tipo,
      camposRequeridos: [],
      opcionesSiguientes: [],
      posicion: autoPosicion(idx),
    };
    setReglas(prev => [...prev, nuevo]);
    setNodoSel(nuevo.id);
    setSeleccionados(new Set([nuevo.id]));
    setMenuAgregarAbierto(false);
    // Al crear un nodo, asegurar que el inspector esté visible para editarlo
    if (!inspectorVisible) setInspectorVisible(true);
  };

  const actualizarNodo = (id: string, patch: Partial<ReglaStatus>) => {
    setReglas(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const eliminarNodo = (id: string) => {
    setReglas(prev => prev
      .filter(r => r.id !== id)
      .map(r => ({ ...r, opcionesSiguientes: (r.opcionesSiguientes || []).filter(s => s !== id) }))
    );
    setNodoSel(null);
    setSeleccionados(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const duplicarNodo = (id: string) => {
    const r = reglas.find(x => x.id === id);
    if (!r) return;
    const copia: ReglaStatus = {
      ...r,
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      orden: reglas.length + 1,
      nombreStatus: r.nombreStatus ? `${r.nombreStatus} (copia)` : '',
      posicion: { x: (r.posicion?.x ?? 100) + 40, y: (r.posicion?.y ?? 100) + 40 },
      opcionesSiguientes: [],
    };
    setReglas(prev => [...prev, copia]);
    setNodoSel(copia.id);
    setSeleccionados(new Set([copia.id]));
  };

  /* ============================================================
     PORTAPAPELES
  ============================================================ */
  const nuevoId = () => `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  const copiarSeleccion = () => {
    if (seleccionados.size === 0) return;
    const nodos = reglas.filter(r => seleccionados.has(r.id));
    if (nodos.length === 0) return;

    const idsCopiados = new Set(nodos.map(n => n.id));
    const payload = {
      version: 1,
      origen: configValido ? configId : 'flujo sin guardar',
      copiadoEn: new Date().toISOString(),
      nodos: nodos.map(n => ({
        ...n,
        opcionesSiguientes: (n.opcionesSiguientes || []).filter(s => idsCopiados.has(s)),
      })),
    };
    try {
      localStorage.setItem('roelca_flujo_clipboard', JSON.stringify(payload));
      setClipboardInfo({ count: nodos.length, origen: payload.origen });
      setMensaje({
        tipo: 'ok',
        texto: `${nodos.length} ${nodos.length === 1 ? 'paso copiado' : 'pasos copiados'} al portapapeles.`,
      });
      setTimeout(() => setMensaje(null), 2200);
    } catch {
      setMensaje({ tipo: 'err', texto: 'No se pudo copiar (almacenamiento lleno).' });
    }
  };

  const pegarClipboard = () => {
    let payload: any;
    try {
      const raw = localStorage.getItem('roelca_flujo_clipboard');
      if (!raw) {
        setMensaje({ tipo: 'err', texto: 'El portapapeles está vacío. Primero copia algún paso.' });
        setTimeout(() => setMensaje(null), 2500);
        return;
      }
      payload = JSON.parse(raw);
    } catch {
      setMensaje({ tipo: 'err', texto: 'Portapapeles corrupto.' });
      return;
    }
    if (!payload?.nodos?.length) return;

    const mapIds: Record<string, string> = {};
    payload.nodos.forEach((n: ReglaStatus) => { mapIds[n.id] = nuevoId(); });

    const offsetX = 60;
    const offsetY = 60;
    const baseOrden = reglas.length;

    const pegados: ReglaStatus[] = payload.nodos.map((n: ReglaStatus, i: number) => ({
      ...n,
      id: mapIds[n.id],
      orden: baseOrden + i + 1,
      opcionesSiguientes: (n.opcionesSiguientes || [])
        .map(s => mapIds[s])
        .filter(Boolean),
      posicion: {
        x: (n.posicion?.x ?? 100) + offsetX,
        y: (n.posicion?.y ?? 100) + offsetY,
      },
    }));

    setReglas(prev => [...prev, ...pegados]);
    setSeleccionados(new Set(pegados.map(p => p.id)));
    setNodoSel(pegados[0]?.id ?? null);

    setMensaje({
      tipo: 'ok',
      texto: `${pegados.length} ${pegados.length === 1 ? 'paso pegado' : 'pasos pegados'} desde "${payload.origen}".`,
    });
    setTimeout(() => setMensaje(null), 2500);
  };

  const duplicarSeleccion = () => {
    if (seleccionados.size === 0) return;
    const nodos = reglas.filter(r => seleccionados.has(r.id));
    const idsCopiados = new Set(nodos.map(n => n.id));
    const mapIds: Record<string, string> = {};
    nodos.forEach(n => { mapIds[n.id] = nuevoId(); });

    const baseOrden = reglas.length;
    const duplicados: ReglaStatus[] = nodos.map((n, i) => ({
      ...n,
      id: mapIds[n.id],
      orden: baseOrden + i + 1,
      opcionesSiguientes: (n.opcionesSiguientes || [])
        .filter(s => idsCopiados.has(s))
        .map(s => mapIds[s]),
      posicion: {
        x: (n.posicion?.x ?? 100) + 40,
        y: (n.posicion?.y ?? 100) + 40,
      },
    }));

    setReglas(prev => [...prev, ...duplicados]);
    setSeleccionados(new Set(duplicados.map(d => d.id)));
    setNodoSel(duplicados[0]?.id ?? null);
  };

  const eliminarSeleccion = () => {
    if (seleccionados.size === 0) return;
    if (seleccionados.size > 1) {
      if (!window.confirm(`¿Eliminar ${seleccionados.size} nodos seleccionados?`)) return;
    }
    const ids = seleccionados;
    setReglas(prev => prev
      .filter(r => !ids.has(r.id))
      .map(r => ({ ...r, opcionesSiguientes: (r.opcionesSiguientes || []).filter(s => !ids.has(s)) }))
    );
    setSeleccionados(new Set());
    setNodoSel(null);
  };

  const seleccionarTodo = () => {
    setSeleccionados(new Set(reglas.map(r => r.id)));
  };

  const limpiarClipboard = () => {
    localStorage.removeItem('roelca_flujo_clipboard');
    setClipboardInfo(null);
  };

  /* ============================================================
     CONEXIONES
  ============================================================ */
  const iniciarConexion = (e: React.MouseEvent, fromId: string) => {
    e.stopPropagation();
    const r = reglas.find(x => x.id === fromId);
    if (!r?.posicion) return;
    setConectando({
      from: fromId,
      toX: r.posicion.x + NODE_W,
      toY: r.posicion.y + NODE_H / 2,
    });
  };

  const finalizarConexion = (toId: string) => {
    if (!conectando) return;
    if (conectando.from === toId) { setConectando(null); return; }
    setReglas(prev => prev.map(r => {
      if (r.id !== conectando.from) return r;
      const set = new Set(r.opcionesSiguientes || []);
      set.add(toId);
      return { ...r, opcionesSiguientes: Array.from(set) };
    }));
    setConectando(null);
  };

  const eliminarConexion = (fromId: string, toId: string) => {
    setReglas(prev => prev.map(r => {
      if (r.id !== fromId) return r;
      return { ...r, opcionesSiguientes: (r.opcionesSiguientes || []).filter(s => s !== toId) };
    }));
  };

  /* ============================================================
     GUARDAR
  ============================================================ */
  const guardar = async () => {
    if (!configValido) {
      setMensaje({ tipo: 'err', texto: 'Selecciona Servicio, Tráfico y Carga antes de guardar.' });
      return;
    }
    const flujoFinal = reglas.map((r, i) => ({ ...r, orden: i + 1 }));

    setGuardando(true);
    setMensaje(null);
    try {
      await setDoc(doc(db, 'config_flujos_operacion', configId), {
        configId,
        tipoServicio,
        trafico,
        carga,
        ultimaActualizacion: new Date().toISOString(),
        flujo: flujoFinal,
      });
      setMensaje({ tipo: 'ok', texto: 'Flujo guardado correctamente.' });
      setTimeout(() => onVolver(), 700);
    } catch (e: any) {
      setMensaje({ tipo: 'err', texto: `Error al guardar: ${e?.message ?? e}` });
    } finally {
      setGuardando(false);
    }
  };

  /* ============================================================
     AUTO-LAYOUT
  ============================================================ */
  const autoOrganizar = () => {
    setReglas(prev => prev.map((r, i) => ({ ...r, posicion: autoPosicion(i) })));
    setTimeout(() => { setZoom(1); centrarFlujo(); }, 30);
  };

  /* ============================================================
     DERIVADOS
  ============================================================ */
  const reglaSel = useMemo(() => reglas.find(r => r.id === nodoSel) || null, [reglas, nodoSel]);

  const portOut = (r: ReglaStatus) => ({
    x: (r.posicion?.x ?? 0) + NODE_W,
    y: (r.posicion?.y ?? 0) + NODE_H / 2,
  });
  const portIn = (r: ReglaStatus) => ({
    x: (r.posicion?.x ?? 0),
    y: (r.posicion?.y ?? 0) + NODE_H / 2,
  });

  const curva = (x1: number, y1: number, x2: number, y2: number) => {
    const dx = Math.max(60, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  };

  const worldSize = useMemo(() => {
    const maxX = Math.max(2400, ...reglas.map(r => (r.posicion?.x ?? 0) + NODE_W + 400));
    const maxY = Math.max(1600, ...reglas.map(r => (r.posicion?.y ?? 0) + NODE_H + 400));
    return { w: maxX, h: maxY };
  }, [reglas]);

  /* ============================================================
     RENDER
  ============================================================ */
  return (
    <div style={S.shell}>
      <style>{CSS_GLOBAL}</style>

      {/* ===== TOP BAR ===== */}
      <header style={S.topbar}>
        <div style={S.topLeft}>
          <button onClick={onVolver} style={S.backBtn} title="Volver">
            <span style={{ fontSize: 18, lineHeight: 1 }}>←</span>
            <span>Volver</span>
          </button>
          <div style={S.divider} />
          <div style={S.brand}>
            <div style={S.brandDot} />
            <div>
              <div style={S.brandTitle}>Editor de Flujos</div>
              <div style={S.brandSub}>{configValido ? configId.replace(/_/g, ' · ') : 'Nuevo flujo'}</div>
            </div>
          </div>

          {/* ✅ NUEVO: Toggle del sidebar izquierdo */}
          <button
            onClick={() => setSidebarVisible(v => !v)}
            style={{ ...S.iconBtn, marginLeft: 4 }}
            title={sidebarVisible ? 'Ocultar paleta' : 'Mostrar paleta'}
          >
            {sidebarVisible ? '◀' : '▶'}
          </button>
        </div>

        <div style={S.topCenter}>
          <SelectorCampo
            label="Servicio"
            value={tipoServicio}
            onChange={setTipoServicio}
            options={tiposOperacion.map(t => t.tipo_operacion)}
            placeholder="Selecciona…"
          />
          <SelectorCampo
            label="Tráfico"
            value={trafico}
            onChange={setTrafico}
            options={traficos}
            placeholder="Selecciona…"
          />
          <SelectorCampo
            label="Carga"
            value={carga}
            onChange={setCarga}
            options={['Cargada', 'Vacía', 'N/A']}
            placeholder="Selecciona…"
          />
        </div>

        <div style={S.topRight}>
          {seleccionados.size > 1 && (
            <div style={{
              padding: '4px 10px',
              background: 'rgba(167,139,250,0.10)',
              border: '1px solid rgba(167,139,250,0.35)',
              borderRadius: 999,
              fontSize: 11.5,
              color: '#cfc1ff',
              fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <span style={{ fontSize: 14 }}>✓</span>
              {seleccionados.size} seleccionados
            </div>
          )}
          {mensaje && (
            <div style={{
              ...S.toast,
              background: mensaje.tipo === 'ok' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
              color:      mensaje.tipo === 'ok' ? '#34d399' : '#f87171',
              border: `1px solid ${mensaje.tipo === 'ok' ? 'rgba(52,211,153,0.4)' : 'rgba(248,113,113,0.4)'}`,
            }}>
              {mensaje.texto}
            </div>
          )}

          {/* ✅ NUEVO: Botón "Agregar paso" prominente con dropdown */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setMenuAgregarAbierto(v => !v)}
              style={S.addStepBtn}
              title="Agregar nuevo paso al flujo"
            >
              <span style={{ fontSize: 15, lineHeight: 1, marginRight: 2 }}>+</span>
              Agregar paso
              <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.8 }}>▾</span>
            </button>
            {menuAgregarAbierto && (
              <>
                {/* backdrop para cerrar el menú clickeando fuera */}
                <div
                  onClick={() => setMenuAgregarAbierto(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 1100 }}
                />
                <div style={{
                  position: 'absolute', top: 'calc(100% + 6px)', right: 0,
                  width: 260,
                  background: '#11151d',
                  border: '1px solid #2a3142',
                  borderRadius: 12,
                  padding: 6,
                  boxShadow: '0 16px 40px rgba(0,0,0,0.55)',
                  zIndex: 1200,
                }}>
                  {(Object.keys(TIPO_META) as ReglaStatus['tipoMecanismo'][]).map(t => {
                    const m = TIPO_META[t];
                    return (
                      <button
                        key={t}
                        onClick={() => agregarNodo(t)}
                        className="hov-tile"
                        style={{
                          width: '100%',
                          display: 'flex', gap: 10, alignItems: 'flex-start',
                          background: 'transparent',
                          border: 'none',
                          borderRadius: 8,
                          padding: '9px 10px',
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{
                          width: 28, height: 28, borderRadius: 7,
                          background: m.bg, color: m.color,
                          border: `1px solid ${m.color}44`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 14, fontWeight: 700, flexShrink: 0,
                        }}>{m.icon}</div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13, color: m.color, marginBottom: 2 }}>
                            {m.label}
                          </div>
                          <div style={{ fontSize: 11, color: '#7a8499', lineHeight: 1.35 }}>
                            {t === 'automatico' && 'Avanza solo cuando los campos requeridos se llenan.'}
                            {t === 'manual'     && 'El usuario presiona un botón para avanzar.'}
                            {t === 'boton_decision' && 'Divide el flujo en múltiples caminos.'}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <button onClick={guardar} disabled={guardando || !configValido} style={{
            ...S.saveBtn,
            opacity: guardando || !configValido ? 0.55 : 1,
            cursor:  guardando || !configValido ? 'not-allowed' : 'pointer',
          }}>
            {guardando ? 'Guardando…' : 'Guardar flujo'}
          </button>

          {/* ✅ NUEVO: Toggle del inspector */}
          <button
            onClick={() => setInspectorVisible(v => !v)}
            style={S.iconBtn}
            title={inspectorVisible ? 'Ocultar inspector' : 'Mostrar inspector'}
          >
            {inspectorVisible ? '▶' : '◀'}
          </button>
        </div>
      </header>

      {/* ===== CUERPO ===== */}
      <div style={S.body}>
        {/* Sidebar izquierdo: paleta de nodos (toggleable) */}
        {sidebarVisible && (
          <aside style={S.sidebar}>
            <div style={S.sidebarTitle}>Bloques</div>
            <div style={S.sidebarSub}>Haz clic para agregar al lienzo</div>

            <BlockTile tipo="automatico"
              title="Automático"
              desc="Avanza solo cuando se cumplen los campos requeridos."
              onClick={() => agregarNodo('automatico')}
            />
            <BlockTile tipo="manual"
              title="Acción Manual"
              desc="El usuario presiona un botón para avanzar."
              onClick={() => agregarNodo('manual')}
            />
            <BlockTile tipo="boton_decision"
              title="Decisión"
              desc="Divide el flujo en múltiples caminos posibles."
              onClick={() => agregarNodo('boton_decision')}
            />

            <div style={{ ...S.sidebarTitle, marginTop: 24 }}>Portapapeles</div>
            <div style={S.sidebarSub}>
              Copia pasos de un flujo para reutilizarlos en otro.
            </div>

            {clipboardInfo && (
              <div style={{
                background: 'linear-gradient(180deg, rgba(167,139,250,0.10), rgba(99,102,241,0.06))',
                border: '1px solid rgba(167,139,250,0.32)',
                borderRadius: 10,
                padding: '10px 12px',
                marginBottom: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{
                    fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1,
                    color: '#a78bfa', fontWeight: 700,
                  }}>En portapapeles</div>
                  <button
                    onClick={limpiarClipboard}
                    title="Vaciar portapapeles"
                    style={{
                      background: 'none', border: 'none', color: '#7a8499',
                      cursor: 'pointer', fontSize: 13, padding: 0,
                    }}
                  >×</button>
                </div>
                <div style={{ fontSize: 13, color: '#e6ebf5', fontWeight: 600, marginTop: 4 }}>
                  {clipboardInfo.count} {clipboardInfo.count === 1 ? 'paso' : 'pasos'}
                </div>
                <div style={{ fontSize: 11, color: '#7a8499', marginTop: 2 }}>
                  desde <span style={{ color: '#a9b3c7' }}>{clipboardInfo.origen}</span>
                </div>
              </div>
            )}

            <button
              onClick={copiarSeleccion}
              disabled={seleccionados.size === 0}
              style={{
                ...S.toolBtn,
                opacity: seleccionados.size === 0 ? 0.5 : 1,
                cursor: seleccionados.size === 0 ? 'not-allowed' : 'pointer',
              }}
              title="Ctrl+C"
            >
              <span>⎘</span> Copiar selección
              {seleccionados.size > 0 && (
                <span style={S.kbdInline}>{seleccionados.size}</span>
              )}
            </button>
            <button
              onClick={pegarClipboard}
              disabled={!clipboardInfo}
              style={{
                ...S.toolBtn,
                opacity: !clipboardInfo ? 0.5 : 1,
                cursor: !clipboardInfo ? 'not-allowed' : 'pointer',
                ...(clipboardInfo ? {
                  borderColor: 'rgba(167,139,250,0.45)',
                  color: '#cfc1ff',
                  background: 'rgba(167,139,250,0.08)',
                } : {}),
              }}
              title="Ctrl+V"
            >
              <span>⎗</span> Pegar aquí
              {clipboardInfo && <span style={S.kbdInline}>{clipboardInfo.count}</span>}
            </button>
            <button
              onClick={duplicarSeleccion}
              disabled={seleccionados.size === 0}
              style={{
                ...S.toolBtn,
                opacity: seleccionados.size === 0 ? 0.5 : 1,
                cursor: seleccionados.size === 0 ? 'not-allowed' : 'pointer',
              }}
              title="Ctrl+D"
            >
              <span>⧉</span> Duplicar selección
            </button>

            <div style={{ ...S.sidebarTitle, marginTop: 24 }}>Lienzo</div>
            <button onClick={autoOrganizar} style={S.toolBtn}>
              <span>⟲</span> Reorganizar nodos
            </button>
            <button onClick={() => { setZoom(1); centrarFlujo(); }} style={S.toolBtn}>
              <span>⤧</span> Centrar vista
            </button>
            <button onClick={seleccionarTodo} style={S.toolBtn} title="Ctrl+A">
              <span>▣</span> Seleccionar todo
            </button>

            <div style={S.legend}>
              <div style={S.legendTitle}>Atajos</div>
              <div style={S.legendItem}><b>Ctrl + Click</b> añade a la selección.</div>
              <div style={S.legendItem}><b>Ctrl + C / V</b> copiar y pegar pasos.</div>
              <div style={S.legendItem}><b>Ctrl + D</b> duplicar en sitio.</div>
              <div style={S.legendItem}><b>Ctrl + A</b> seleccionar todo.</div>
              <div style={S.legendItem}><b>Supr</b> elimina la selección.</div>
              <div style={S.legendItem}><b>Ctrl + Rueda</b> zoom.</div>
            </div>
          </aside>
        )}

        {/* Canvas central */}
        <div
          ref={canvasRef}
          style={S.canvas}
          onMouseDown={onCanvasMouseDown}
          onWheel={onWheel}
          data-canvas-bg="true"
        >
          {/* Fondo de cuadrícula */}
          <div data-canvas-bg="true" style={{
            ...S.gridBg,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
            backgroundSize: `${GRID * zoom}px ${GRID * zoom}px, ${GRID * 5 * zoom}px ${GRID * 5 * zoom}px`,
          }} />

          {/* Capa transformable */}
          <div
            data-canvas-bg="true"
            style={{
              position: 'absolute',
              inset: 0,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: worldSize.w,
              height: worldSize.h,
              cursor: isPanning ? 'grabbing' : 'default',
            }}
          >
            {/* SVG de conexiones */}
            <svg
              width={worldSize.w}
              height={worldSize.h}
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}
            >
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill="#7c8aa3" />
                </marker>
                <marker id="arrowHi" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto">
                  <path d="M0,0 L10,5 L0,10 z" fill="#a78bfa" />
                </marker>
              </defs>

              {reglas.flatMap(r =>
                (r.opcionesSiguientes || []).map(toId => {
                  const target = reglas.find(x => x.id === toId);
                  if (!target || !r.posicion || !target.posicion) return null;
                  const p1 = portOut(r);
                  const p2 = portIn(target);
                  const isHi = nodoSel === r.id || nodoSel === toId
                            || seleccionados.has(r.id) || seleccionados.has(toId);
                  return (
                    <g key={`${r.id}-${toId}`} style={{ pointerEvents: 'auto' }}>
                      <path
                        d={curva(p1.x, p1.y, p2.x, p2.y)}
                        stroke={isHi ? '#a78bfa' : '#4b5566'}
                        strokeWidth={isHi ? 2.4 : 1.8}
                        fill="none"
                        markerEnd={isHi ? 'url(#arrowHi)' : 'url(#arrow)'}
                        style={{ transition: 'stroke 120ms ease' }}
                      />
                      <g
                        transform={`translate(${(p1.x + p2.x) / 2}, ${(p1.y + p2.y) / 2})`}
                        style={{ cursor: 'pointer' }}
                        onClick={(e) => { e.stopPropagation(); eliminarConexion(r.id, toId); }}
                      >
                        <circle r={10} fill="#1a1f2b" stroke="#3a4252" />
                        <text textAnchor="middle" dominantBaseline="central" fontSize="13" fill="#f87171" style={{ userSelect: 'none' }}>×</text>
                      </g>
                    </g>
                  );
                })
              )}

              {conectando && (() => {
                const from = reglas.find(r => r.id === conectando.from);
                if (!from?.posicion) return null;
                const p1 = portOut(from);
                return (
                  <path
                    d={curva(p1.x, p1.y, conectando.toX, conectando.toY)}
                    stroke="#a78bfa"
                    strokeWidth={2}
                    strokeDasharray="6 6"
                    fill="none"
                  />
                );
              })()}
            </svg>

            {/* Nodo START */}
            <div style={{
              position: 'absolute',
              left: 40,
              top: 40,
              padding: '10px 18px',
              borderRadius: 999,
              background: 'linear-gradient(135deg, rgba(167,139,250,0.18), rgba(96,165,250,0.18))',
              border: '1px solid rgba(167,139,250,0.4)',
              color: '#e9e4ff',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              boxShadow: '0 4px 18px rgba(167,139,250,0.18)',
            }}>
              ▶ Evento: Nueva Operación
            </div>

            {/* Nodos */}
            {reglas.map(r => {
              const meta = TIPO_META[r.tipoMecanismo];
              const isSel = nodoSel === r.id;
              const isMulti = seleccionados.has(r.id);
              const borderColor = isSel
                ? meta.color
                : (isMulti ? '#a78bfa' : '#2c3344');
              const shadow = isSel
                ? `0 0 0 4px ${meta.color}22, 0 10px 30px rgba(0,0,0,0.5)`
                : (isMulti
                    ? `0 0 0 3px rgba(167,139,250,0.20), 0 8px 24px rgba(0,0,0,0.45)`
                    : '0 6px 22px rgba(0,0,0,0.4)');
              return (
                <div
                  key={r.id}
                  onMouseDown={(e) => onNodeMouseDown(e, r.id)}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    position: 'absolute',
                    left: r.posicion?.x ?? 0,
                    top:  r.posicion?.y ?? 0,
                    width: NODE_W,
                    minHeight: NODE_H,
                    background: 'linear-gradient(180deg, #1c2230 0%, #161b25 100%)',
                    border: `1.5px solid ${borderColor}`,
                    borderRadius: 14,
                    boxShadow: shadow,
                    cursor: draggingId === r.id ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    transition: 'box-shadow 140ms ease, border-color 140ms ease',
                  }}
                >
                  {isMulti && !isSel && (
                    <div style={{
                      position: 'absolute', top: -8, right: -8,
                      width: 18, height: 18, borderRadius: '50%',
                      background: '#a78bfa', color: '#0a0d14',
                      fontSize: 11, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '2px solid #0a0d14',
                      boxShadow: '0 2px 6px rgba(167,139,250,0.5)',
                    }}>✓</div>
                  )}
                  <div style={{
                    height: 6,
                    background: `linear-gradient(90deg, ${meta.color}, transparent)`,
                    borderTopLeftRadius: 13,
                    borderTopRightRadius: 13,
                  }} />

                  <div style={{ padding: '10px 14px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: 7,
                        background: meta.bg,
                        color: meta.color,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700,
                        border: `1px solid ${meta.color}33`,
                      }}>{meta.icon}</div>
                      <div style={{
                        fontSize: 10.5,
                        textTransform: 'uppercase',
                        letterSpacing: 1.1,
                        color: meta.color,
                        fontWeight: 700,
                      }}>{meta.label}</div>
                    </div>

                    <div style={{
                      color: r.nombreStatus ? '#e6ebf5' : '#6b7385',
                      fontWeight: 600,
                      fontSize: 15,
                      lineHeight: 1.25,
                      letterSpacing: -0.1,
                    }}>
                      {r.nombreStatus || 'Sin estatus asignado'}
                    </div>

                    {(r.camposRequeridos?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {r.camposRequeridos.slice(0, 3).map(c => (
                          <span key={c} style={S.tag}>
                            {labelCampo(c)}
                          </span>
                        ))}
                        {r.camposRequeridos.length > 3 && (
                          <span style={S.tag}>+{r.camposRequeridos.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Puerto entrada (izquierda) */}
                  <div
                    onMouseUp={() => finalizarConexion(r.id)}
                    style={{
                      position: 'absolute', left: -7, top: NODE_H / 2 - 7,
                      width: 14, height: 14, borderRadius: '50%',
                      background: '#0d1117',
                      border: `2px solid ${meta.color}`,
                      boxShadow: `0 0 0 3px ${meta.color}22`,
                    }}
                    title="Entrada"
                  />
                  {/* Puerto salida (derecha) */}
                  <div
                    onMouseDown={(e) => iniciarConexion(e, r.id)}
                    style={{
                      position: 'absolute', right: -7, top: NODE_H / 2 - 7,
                      width: 14, height: 14, borderRadius: '50%',
                      background: meta.color,
                      border: '2px solid #0d1117',
                      cursor: 'crosshair',
                      boxShadow: `0 0 12px ${meta.color}aa`,
                    }}
                    title="Arrastra para conectar"
                  />
                </div>
              );
            })}

            {reglas.length === 0 && (
              <div style={{
                position: 'absolute',
                left: '50%', top: '40%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                color: '#5a6275',
                pointerEvents: 'none',
              }}>
                <div style={{ fontSize: 44, marginBottom: 6 }}>◇</div>
                <div style={{ fontWeight: 600, color: '#8b94a9', fontSize: 16 }}>Lienzo vacío</div>
                <div style={{ marginTop: 4, fontSize: 13 }}>
                  Usa el botón <b style={{ color: '#a78bfa' }}>+ Agregar paso</b> arriba o la paleta lateral para comenzar.
                </div>
              </div>
            )}
          </div>

          {/* Controles flotantes de zoom */}
          <div style={S.zoomBar}>
            <button style={S.zoomBtn} onClick={() => setZoom(z => Math.min(1.6, z + 0.1))}>+</button>
            <div style={S.zoomLabel}>{Math.round(zoom * 100)}%</div>
            <button style={S.zoomBtn} onClick={() => setZoom(z => Math.max(0.4, z - 0.1))}>−</button>
            <div style={{ height: 1, background: '#2a3142', margin: '4px 0' }} />
            <button style={S.zoomBtn} onClick={() => { setZoom(1); centrarFlujo(); }} title="Centrar">⌂</button>
          </div>

          {cargando && (
            <div style={S.loadingOverlay}>Cargando flujo…</div>
          )}
        </div>

        {/* Panel derecho: inspector (toggleable) */}
        {inspectorVisible && (
          <aside style={S.inspector}>
            {!reglaSel ? (
              <div style={S.emptyInspector}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>◌</div>
                <div style={{ fontWeight: 600, color: '#c9d1d9' }}>Inspector</div>
                <div style={{ marginTop: 6, fontSize: 13, color: '#7a8499', lineHeight: 1.5 }}>
                  Selecciona un nodo del lienzo para configurar su nombre, mecanismo de avance, campos requeridos y conexiones.
                </div>
              </div>
            ) : (
              <Inspector
                regla={reglaSel}
                catalogoStatus={catalogoStatus}
                todosNodos={reglas}
                onChange={(patch) => actualizarNodo(reglaSel.id, patch)}
                onDuplicar={() => duplicarNodo(reglaSel.id)}
                onEliminar={() => eliminarNodo(reglaSel.id)}
                onDesconectar={(toId) => eliminarConexion(reglaSel.id, toId)}
                onAbrirModalCampos={() => setModalCamposAbierto(true)}
              />
            )}
          </aside>
        )}
      </div>

      {/* ✅ NUEVO: Modal de selección de campos requeridos */}
      <ModalCamposRequeridos
        abierto={modalCamposAbierto && !!reglaSel}
        seleccionados={reglaSel?.camposRequeridos || []}
        tipoMecanismo={reglaSel?.tipoMecanismo || 'automatico'}
        onCerrar={() => setModalCamposAbierto(false)}
        onConfirmar={(ids) => {
          if (reglaSel) actualizarNodo(reglaSel.id, { camposRequeridos: ids });
          setModalCamposAbierto(false);
        }}
      />
    </div>
  );
};

/* ============================================================
   COMPONENTES AUXILIARES
============================================================ */
const SelectorCampo = ({ label, value, onChange, options, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
}) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1, color: '#7a8499', fontWeight: 600 }}>{label}</span>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        background: '#11151d',
        border: '1px solid #2a3142',
        color: '#e6ebf5',
        borderRadius: 8,
        padding: '7px 10px',
        fontSize: 13,
        minWidth: 150,
        outline: 'none',
      }}
    >
      <option value="">{placeholder || '—'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </label>
);

const BlockTile = ({ tipo, title, desc, onClick }: {
  tipo: ReglaStatus['tipoMecanismo'];
  title: string;
  desc: string;
  onClick: () => void;
}) => {
  const meta = TIPO_META[tipo];
  return (
    <button onClick={onClick} className="hov-tile" style={{
      display: 'flex', gap: 10, alignItems: 'flex-start',
      width: '100%',
      textAlign: 'left',
      background: 'linear-gradient(180deg, #1a1f2b, #151a24)',
      border: '1px solid #262d3e',
      borderRadius: 10,
      padding: '11px 12px',
      cursor: 'pointer',
      color: '#c9d1d9',
      marginBottom: 8,
      transition: 'transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 8,
        background: meta.bg,
        color: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 16, fontWeight: 700,
        border: `1px solid ${meta.color}44`,
        flexShrink: 0,
      }}>{meta.icon}</div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, color: meta.color }}>{title}</div>
        <div style={{ fontSize: 11.5, color: '#7a8499', lineHeight: 1.35 }}>{desc}</div>
      </div>
    </button>
  );
};

const Inspector = ({
  regla, catalogoStatus, todosNodos,
  onChange, onDuplicar, onEliminar, onDesconectar, onAbrirModalCampos,
}: {
  regla: ReglaStatus;
  catalogoStatus: string[];
  todosNodos: ReglaStatus[];
  onChange: (p: Partial<ReglaStatus>) => void;
  onDuplicar: () => void;
  onEliminar: () => void;
  onDesconectar: (toId: string) => void;
  onAbrirModalCampos: () => void;
}) => {
  const meta = TIPO_META[regla.tipoMecanismo];
  const camposCount = (regla.camposRequeridos || []).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Encabezado */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid #232a3a',
        background: `linear-gradient(180deg, ${meta.bg}, transparent)`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{
            width: 26, height: 26, borderRadius: 7,
            background: meta.bg, color: meta.color,
            border: `1px solid ${meta.color}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700,
          }}>{meta.icon}</div>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: meta.color, fontWeight: 700 }}>
            {meta.label}
          </div>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: '#e6ebf5' }}>
          {regla.nombreStatus || 'Configurar nodo'}
        </div>
      </div>

      {/* Contenido scroll */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Nombre del estatus */}
        <Section title="Nombre del estatus">
          <select
            value={regla.nombreStatus}
            onChange={(e) => onChange({ nombreStatus: e.target.value })}
            style={S.input}
          >
            <option value="">Selecciona un estatus…</option>
            {catalogoStatus.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Section>

        {/* Tipo de mecanismo */}
        <Section title="Mecanismo de avance">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {(Object.keys(TIPO_META) as ReglaStatus['tipoMecanismo'][]).map(t => {
              const m = TIPO_META[t];
              const active = regla.tipoMecanismo === t;
              return (
                <button
                  key={t}
                  onClick={() => onChange({ tipoMecanismo: t })}
                  style={{
                    background: active ? m.bg : '#11151d',
                    color: active ? m.color : '#8b94a9',
                    border: `1px solid ${active ? m.color : '#262d3e'}`,
                    borderRadius: 8,
                    padding: '8px 6px',
                    fontSize: 11.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 120ms ease',
                  }}
                  title={m.label}
                >
                  <div style={{ fontSize: 14 }}>{m.icon}</div>
                  {m.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11.5, color: '#7a8499', marginTop: 6, lineHeight: 1.5 }}>
            {regla.tipoMecanismo === 'automatico' && 'El sistema avanzará automáticamente cuando los campos requeridos se llenen.'}
            {regla.tipoMecanismo === 'manual'     && 'Se mostrará como botón en la app; el usuario decide cuándo avanzar.'}
            {regla.tipoMecanismo === 'boton_decision' && 'Se mostrará como botón; permite múltiples caminos siguientes.'}
          </div>
        </Section>

        {/* ✅ NUEVO: Campos requeridos (ahora via modal) */}
        <Section
          title="Campos requeridos para avanzar"
          hint="Marca los campos del formulario de operaciones que deben estar llenos para que este paso se active."
        >
          {camposCount === 0 ? (
            <div style={{
              padding: '12px 14px',
              background: '#0f1320',
              border: '1px dashed #2a3142',
              borderRadius: 8,
              fontSize: 12.5,
              color: '#7a8499',
              textAlign: 'center',
              marginBottom: 8,
            }}>
              Sin campos requeridos.
            </div>
          ) : (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 5,
              marginBottom: 10,
              padding: '8px 10px',
              background: '#0f1320',
              border: '1px solid #222a39',
              borderRadius: 8,
              maxHeight: 140,
              overflowY: 'auto',
            }}>
              {(regla.camposRequeridos || []).map(id => (
                <span key={id} style={{
                  fontSize: 11,
                  background: meta.bg,
                  border: `1px solid ${meta.color}55`,
                  color: meta.color,
                  borderRadius: 999,
                  padding: '3px 9px',
                  fontWeight: 600,
                }}>
                  {labelCampo(id)}
                </span>
              ))}
            </div>
          )}
          <button
            onClick={onAbrirModalCampos}
            style={{
              width: '100%',
              background: `linear-gradient(135deg, ${meta.color}22, ${meta.color}11)`,
              border: `1px solid ${meta.color}55`,
              color: meta.color,
              borderRadius: 8,
              padding: '9px 12px',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              transition: 'all 120ms ease',
            }}
          >
            <span style={{ fontSize: 14 }}>⚙</span>
            {camposCount === 0 ? 'Configurar campos' : `Editar campos (${camposCount})`}
          </button>
        </Section>

        {/* Conexiones salientes */}
        <Section title="Caminos siguientes" hint="Estos son los nodos a los que conecta este paso.">
          {(regla.opcionesSiguientes || []).length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#6b7385', fontStyle: 'italic', padding: '8px 0' }}>
              Aún no hay conexiones. Arrastra desde el puerto derecho de este nodo hacia otro.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {regla.opcionesSiguientes.map(toId => {
                const target = todosNodos.find(n => n.id === toId);
                const tMeta = target ? TIPO_META[target.tipoMecanismo] : null;
                return (
                  <div key={toId} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '7px 10px',
                    background: '#11151d',
                    border: '1px solid #222a39',
                    borderRadius: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      <span style={{ color: tMeta?.color ?? '#8b94a9' }}>→</span>
                      <span style={{
                        fontSize: 13,
                        color: '#c9d1d9',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{target?.nombreStatus || '(sin nombre)'}</span>
                    </div>
                    <button onClick={() => onDesconectar(toId)} style={{
                      background: 'none', border: 'none', color: '#f87171', cursor: 'pointer',
                      fontSize: 14, padding: '0 4px',
                    }} title="Desconectar">×</button>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      {/* Acciones inferiores */}
      <div style={{
        padding: 12,
        borderTop: '1px solid #232a3a',
        display: 'flex',
        gap: 8,
        background: '#0f1320',
      }}>
        <button onClick={onDuplicar} style={S.actionBtn}>Duplicar</button>
        <button onClick={onEliminar} style={{ ...S.actionBtn, color: '#f87171', borderColor: '#5a2424' }}>Eliminar</button>
      </div>
    </div>
  );
};

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div>
    <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#7a8499', fontWeight: 700, marginBottom: 6 }}>
      {title}
    </div>
    {children}
    {hint && <div style={{ fontSize: 11.5, color: '#5f697d', marginTop: 6, lineHeight: 1.45 }}>{hint}</div>}
  </div>
);

/* ============================================================
   LISTA DE FLUJOS GUARDADOS
============================================================ */
export const ConfiguradorStatus = () => {
  const [vista, setVista] = useState<'lista' | 'configurar'>('lista');
  const [combinacion, setCombinacion] = useState<CombinacionEdicion>(undefined);
  const [flujos, setFlujos] = useState<FlujoGuardado[]>([]);
  const [filtro, setFiltro] = useState('');

  useEffect(() => {
    if (vista === 'lista') {
      getDocs(collection(db, 'config_flujos_operacion')).then(snap => {
        setFlujos(snap.docs.map(d => ({ id: d.id, ...d.data() } as FlujoGuardado)));
      });
    }
  }, [vista]);

  if (vista === 'configurar') {
    return <EditorFlujoAppSheet flujoInicial={combinacion} onVolver={() => setVista('lista')} />;
  }

  const filtrados = flujos.filter(f => {
    const t = filtro.toLowerCase();
    return !t ||
      f.tipoServicio?.toLowerCase().includes(t) ||
      f.trafico?.toLowerCase().includes(t) ||
      f.carga?.toLowerCase().includes(t);
  });

  return (
    <div style={{ minHeight: '100vh', background: '#0a0d14', color: '#c9d1d9', padding: '32px 28px' }}>
      <style>{CSS_GLOBAL}</style>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: '#7a8499', fontWeight: 600 }}>
              Configuración
            </div>
            <h1 style={{ margin: '4px 0 6px', fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
              Reglas de Estatus
            </h1>
            <div style={{ color: '#7a8499', fontSize: 14 }}>
              Diseña visualmente cómo avanzan tus operaciones entre estados.
            </div>
          </div>
          <button
            onClick={() => { setCombinacion(undefined); setVista('configurar'); }}
            style={{
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              color: '#fff',
              border: 'none',
              borderRadius: 10,
              padding: '11px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 8px 24px rgba(99,102,241,0.32)',
            }}
          >
            + Crear nuevo flujo
          </button>
        </div>

        <input
          placeholder="Buscar por servicio, tráfico o carga…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          style={{
            width: '100%',
            background: '#11151d',
            border: '1px solid #232a3a',
            borderRadius: 10,
            padding: '11px 14px',
            color: '#e6ebf5',
            fontSize: 14,
            outline: 'none',
            marginBottom: 16,
          }}
        />

        <div style={{
          background: '#0f1320',
          border: '1px solid #1c2230',
          borderRadius: 14,
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#11151d', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: '#7a8499' }}>
                <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600 }}>Servicio</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600 }}>Tráfico</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600 }}>Carga</th>
                <th style={{ textAlign: 'left', padding: '12px 16px', fontWeight: 600 }}>Pasos</th>
                <th style={{ textAlign: 'right', padding: '12px 16px', fontWeight: 600 }}>Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 36, textAlign: 'center', color: '#5f697d' }}>
                    No hay flujos guardados todavía.
                  </td>
                </tr>
              )}
              {filtrados.map(f => (
                <tr key={f.id} style={{ borderTop: '1px solid #1c2230' }} className="hov-row">
                  <td style={{ padding: '14px 16px', fontWeight: 500 }}>{f.tipoServicio}</td>
                  <td style={{ padding: '14px 16px', color: '#a9b3c7' }}>{f.trafico}</td>
                  <td style={{ padding: '14px 16px', color: '#a9b3c7' }}>{f.carga}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      background: 'rgba(96,165,250,0.12)',
                      color: '#7eb6ff',
                      border: '1px solid rgba(96,165,250,0.3)',
                      borderRadius: 999,
                      padding: '2px 10px',
                      fontSize: 12,
                      fontWeight: 600,
                    }}>
                      {(f.flujo || []).length} pasos
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => { setCombinacion(f); setVista('configurar'); }}
                      style={{
                        background: '#1a1f2b',
                        color: '#c9d1d9',
                        border: '1px solid #2c3344',
                        borderRadius: 8,
                        padding: '6px 14px',
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      Editar →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ConfiguradorStatus;

/* ============================================================
   ESTILOS
============================================================ */
const S: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex', flexDirection: 'column',
    height: '100vh', width: '100%',
    background: '#0a0d14',
    color: '#c9d1d9',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    overflow: 'hidden',
  },
  topbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 18px',
    background: 'linear-gradient(180deg, #0f1320 0%, #0c0f18 100%)',
    borderBottom: '1px solid #1c2230',
    gap: 16,
    flexShrink: 0,
  },
  topLeft:   { display: 'flex', alignItems: 'center', gap: 14, minWidth: 280 },
  topCenter: { display: 'flex', alignItems: 'flex-end', gap: 10, flex: 1, justifyContent: 'center', flexWrap: 'wrap' },
  topRight:  { display: 'flex', alignItems: 'center', gap: 10, minWidth: 280, justifyContent: 'flex-end' },

  backBtn: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: '#1a1f2b', border: '1px solid #2c3344',
    color: '#c9d1d9', cursor: 'pointer',
    borderRadius: 8, padding: '7px 12px',
    fontSize: 13, fontWeight: 500,
  },
  iconBtn: {
    background: '#1a1f2b', border: '1px solid #2c3344',
    color: '#a9b3c7', cursor: 'pointer',
    borderRadius: 8, width: 32, height: 32,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 11, fontWeight: 600,
    transition: 'all 120ms ease',
  },
  divider: { width: 1, height: 28, background: '#232a3a' },

  brand: { display: 'flex', alignItems: 'center', gap: 10 },
  brandDot: {
    width: 10, height: 10, borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #ec4899)',
    boxShadow: '0 0 12px rgba(139,92,246,0.7)',
  },
  brandTitle: { fontSize: 14, fontWeight: 600, lineHeight: 1.2 },
  brandSub:   { fontSize: 11, color: '#7a8499', marginTop: 2 },

  saveBtn: {
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    color: '#fff',
    border: 'none',
    borderRadius: 10,
    padding: '9px 18px',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    boxShadow: '0 6px 18px rgba(99,102,241,0.32)',
    transition: 'transform 100ms ease',
  },
  addStepBtn: {
    background: 'linear-gradient(135deg, rgba(167,139,250,0.18), rgba(99,102,241,0.18))',
    color: '#cfc1ff',
    border: '1px solid rgba(167,139,250,0.4)',
    borderRadius: 10,
    padding: '8px 14px',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 4,
    transition: 'all 120ms ease',
  },
  toast: {
    padding: '6px 12px',
    fontSize: 12,
    borderRadius: 8,
    fontWeight: 500,
  },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  sidebar: {
    width: SIDEBAR_W,
    flexShrink: 0,
    background: '#0d1118',
    borderRight: '1px solid #1c2230',
    padding: '16px 14px',
    overflowY: 'auto',
  },
  sidebarTitle: {
    fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1.2,
    color: '#7a8499', fontWeight: 700, marginBottom: 4,
  },
  sidebarSub: { fontSize: 11.5, color: '#5f697d', marginBottom: 12 },

  toolBtn: {
    width: '100%',
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#11151d',
    border: '1px solid #222a39',
    color: '#a9b3c7',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 12.5,
    cursor: 'pointer',
    marginTop: 6,
    transition: 'all 120ms ease',
  },
  kbdInline: {
    marginLeft: 'auto',
    background: '#222a39',
    color: '#cfc1ff',
    fontSize: 10.5,
    fontWeight: 700,
    padding: '1px 7px',
    borderRadius: 999,
    minWidth: 18,
    textAlign: 'center',
  },

  legend: {
    marginTop: 22, padding: 12,
    background: '#0f1320',
    border: '1px solid #1c2230',
    borderRadius: 10,
  },
  legendTitle: {
    fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 1.2,
    color: '#7a8499', fontWeight: 700, marginBottom: 6,
  },
  legendItem: { fontSize: 11.5, color: '#7a8499', lineHeight: 1.6 },

  canvas: {
    flex: 1, position: 'relative', overflow: 'hidden',
    background: '#0a0d14',
  },
  gridBg: {
    position: 'absolute', inset: 0,
    backgroundImage: `
      radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px),
      radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px)
    `,
    pointerEvents: 'none',
  },

  zoomBar: {
    position: 'absolute', right: 16, bottom: 16,
    background: '#0f1320',
    border: '1px solid #1c2230',
    borderRadius: 10,
    padding: 4,
    display: 'flex', flexDirection: 'column', gap: 2,
    boxShadow: '0 10px 24px rgba(0,0,0,0.4)',
  },
  zoomBtn: {
    width: 32, height: 28,
    background: 'transparent',
    border: 'none',
    color: '#a9b3c7',
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 500,
    borderRadius: 6,
  },
  zoomLabel: { fontSize: 11, color: '#7a8499', textAlign: 'center', padding: '2px 0' },

  loadingOverlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(10,13,20,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#8b94a9', fontSize: 14,
    backdropFilter: 'blur(4px)',
  },

  inspector: {
    width: INSPECTOR_W,
    flexShrink: 0,
    background: '#0d1118',
    borderLeft: '1px solid #1c2230',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  },
  emptyInspector: {
    padding: '60px 24px',
    textAlign: 'center',
    color: '#5f697d',
  },

  input: {
    width: '100%',
    background: '#11151d',
    border: '1px solid #232a3a',
    color: '#e6ebf5',
    borderRadius: 8,
    padding: '9px 11px',
    fontSize: 13,
    outline: 'none',
  },
  actionBtn: {
    flex: 1,
    background: '#11151d',
    border: '1px solid #2a3142',
    color: '#c9d1d9',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 120ms ease',
  },
  tag: {
    fontSize: 10.5,
    background: '#1a1f2b',
    border: '1px solid #2a3142',
    color: '#8b94a9',
    borderRadius: 999,
    padding: '2px 8px',
    fontWeight: 500,
  },
};

const CSS_GLOBAL = `
  *::-webkit-scrollbar { width: 8px; height: 8px; }
  *::-webkit-scrollbar-track { background: transparent; }
  *::-webkit-scrollbar-thumb { background: #232a3a; border-radius: 4px; }
  *::-webkit-scrollbar-thumb:hover { background: #2c3344; }

  .hov-tile:hover {
    transform: translateY(-1px);
    border-color: #3a4360 !important;
    box-shadow: 0 8px 20px rgba(0,0,0,0.4);
    background: #1a1f2b !important;
  }
  .hov-row:hover { background: #11151d; }
`;
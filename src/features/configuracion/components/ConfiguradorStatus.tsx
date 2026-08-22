import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { collection, doc, getDoc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './ConfiguradorStatus.css';

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
  // ✅ NUEVO: configuración del formulario por flujo (no por nodo)
  pestanasVisibles?: TabType[];
  camposObligatorios?: string[];
}

type CombinacionEdicion =
  | { tipoServicio: string; trafico: string; carga: string; flujo?: ReglaStatus[] }
  | undefined;

/* ============================================================
   NUEVO: PESTAÑAS DEL FORMULARIO DE OPERACIONES
   Controla, por flujo completo (Servicio + Tráfico + Carga), qué pestañas
   se muestran en el Formulario de Operaciones y qué campos son obligatorios
   para poder guardar. Esto es independiente de `camposRequeridos` de cada
   nodo (que controla el AVANCE de status, no el guardado del formulario).
============================================================ */
type TabType = 'general' | 'pedimento' | 'manifiesto' | 'unidad' | 'cobrar';

const TABS_FORMULARIO: { id: TabType; label: string }[] = [
  { id: 'general',    label: 'General' },
  { id: 'pedimento',  label: 'Pedimento y Carta Porte' },
  { id: 'manifiesto', label: "Entry's y Manifiesto" },
  { id: 'unidad',     label: 'Unidad y Operador' },
  { id: 'cobrar',     label: 'Por Cobrar' },
];

// ✅ Opciones del selector "Carga" (Reglas de Status). DEBEN coincidir con el
//    campo `estado_carga` del catálogo de Tarifas de Referencia.
//    "Trompo" va como una opción MÁS dentro de esta misma lista.
const OPCIONES_CARGA = ['Cargada', 'Vacía', 'N/A', 'Trompo'];

/* ============================================================
   CATÁLOGO COMPLETO DE CAMPOS DE OPERACIÓN
   Todos los campos del FormularioOperacion, agrupados por sección.
   Cada sección está etiquetada con la pestaña (`tab`) del formulario a la
   que pertenece, para poder agrupar la selección de campos obligatorios.
   Estos son los que pueden marcarse como "requeridos" para que un nodo
   automático avance, o como obligatorios antes de mostrar un manual/decisión.
============================================================ */
const CAMPOS_OPERACION_COMPLETOS: { seccion: string; tab: TabType; campos: { id: string; label: string }[] }[] = [
  {
    seccion: 'General',
    tab: 'general',
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
    tab: 'pedimento',
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
    tab: 'manifiesto',
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
    tab: 'unidad',
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
    tab: 'cobrar',
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
const NODE_H = 116;
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
    <div className="cs-x1"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
    >
      <div className="cs-x2">
        {/* Header */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid #1c2230',
          background: `linear-gradient(180deg, ${meta.bg}, transparent)`,
        }}>
          <div className="cs-x3">
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: meta.bg, color: meta.color,
              border: `1px solid ${meta.color}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700,
            }}>{meta.icon}</div>
            <div className="cs-x4">
              <div className="cs-x5">
                Campos requeridos para avanzar
              </div>
              <div className="cs-x6">
                Marca los campos del formulario de operaciones que deben estar llenos.
              </div>
            </div>
            <button className="cs-x7" onClick={onCerrar} title="Cerrar (Esc)">×</button>
          </div>

          {/* Buscador */}
          <input className="cs-x8"
            autoFocus
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar campo…"
          />
        </div>

        {/* Lista */}
        <div className="cs-x9">
          {seccionesFiltradas.length === 0 ? (
            <div className="cs-x10">
              No se encontraron campos.
            </div>
          ) : seccionesFiltradas.map(sec => {
            const totalSec = sec.campos.length;
            const marcadosSec = sec.campos.filter(c => seleccion.has(c.id)).length;
            return (
              <div className="cs-x11" key={sec.seccion}>
                <div className="cs-x12">
                  <div className="cs-x13">
                    {sec.seccion}
                    <span className="cs-x14">
                      {marcadosSec}/{totalSec}
                    </span>
                  </div>
                  <div className="cs-x15">
                    <button onClick={() => marcarSeccion(sec.campos)} style={miniBtn}>Marcar todos</button>
                    <button onClick={() => limpiarSeccion(sec.campos)} style={miniBtn}>Limpiar</button>
                  </div>
                </div>
                <div className="cs-x16">
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
                        <span className="cs-x17">
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
        <div className="cs-x18">
          <div className="cs-x19">
            <b className="cs-x20">{seleccion.size}</b> campo{seleccion.size === 1 ? '' : 's'} seleccionado{seleccion.size === 1 ? '' : 's'}
            {seleccion.size > 0 && (
              <button className="cs-x21" onClick={limpiarTodo}>Limpiar todo</button>
            )}
          </div>
          <div className="cs-x22">
            <button className="cs-x23" onClick={onCerrar}>Cancelar</button>
            <button className="cs-x24" onClick={() => onConfirmar(Array.from(seleccion))}>Aplicar</button>
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
   NUEVO: MODAL "CONFIGURAR FORMULARIO" (POR FLUJO)
   Define, para el flujo completo (Servicio + Tráfico + Carga):
     - qué pestañas se muestran en el Formulario de Operaciones
     - qué campos son obligatorios para poder guardar
   No tiene relación con `camposRequeridos` de los nodos (eso controla el
   avance de status; esto controla el guardado del formulario).
============================================================ */
const ACCENT_FORM = { color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' };

const ModalConfigurarFormulario = ({
  abierto,
  pestanasIniciales,
  camposObligatoriosIniciales,
  onConfirmar,
  onCerrar,
}: {
  abierto: boolean;
  pestanasIniciales: TabType[];
  camposObligatoriosIniciales: string[];
  onConfirmar: (pestanas: TabType[], camposObligatorios: string[]) => void;
  onCerrar: () => void;
}) => {
  const [pestanas, setPestanas] = useState<Set<TabType>>(new Set());
  const [campos, setCampos] = useState<Set<string>>(new Set());
  const [busqueda, setBusqueda] = useState('');

  useEffect(() => {
    if (abierto) {
      // Si el flujo no tiene pestañas configuradas todavía, el formulario las
      // muestra TODAS por defecto: precargamos el modal reflejando ese estado.
      setPestanas(new Set(
        pestanasIniciales.length > 0 ? pestanasIniciales : TABS_FORMULARIO.map(t => t.id)
      ));
      setCampos(new Set(camposObligatoriosIniciales));
      setBusqueda('');
    }
  }, [abierto, pestanasIniciales, camposObligatoriosIniciales]);

  if (!abierto) return null;

  const togglePestana = (id: TabType) => {
    setPestanas(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleCampo = (id: string) => {
    setCampos(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const marcarSeccion = (campos_: { id: string }[]) => {
    setCampos(prev => {
      const next = new Set(prev);
      campos_.forEach(c => next.add(c.id));
      return next;
    });
  };

  const limpiarSeccion = (campos_: { id: string }[]) => {
    setCampos(prev => {
      const next = new Set(prev);
      campos_.forEach(c => next.delete(c.id));
      return next;
    });
  };

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

  const sinPestanas = pestanas.size === 0;

  return (
    <div className="cs-x1"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}
    >
      <div className="cs-x25">
        {/* Header */}
        <div style={{
          padding: '18px 20px',
          borderBottom: '1px solid #1c2230',
          background: `linear-gradient(180deg, ${ACCENT_FORM.bg}, transparent)`,
        }}>
          <div className="cs-x26">
            <div style={{
              width: 30, height: 30, borderRadius: 8,
              background: ACCENT_FORM.bg, color: ACCENT_FORM.color,
              border: `1px solid ${ACCENT_FORM.color}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 700,
            }}>⚙</div>
            <div className="cs-x4">
              <div className="cs-x5">
                Configurar formulario de operaciones
              </div>
              <div className="cs-x6">
                Define, para este flujo, qué pestañas se muestran y qué campos son obligatorios para guardar.
              </div>
            </div>
            <button className="cs-x7" onClick={onCerrar} title="Cerrar (Esc)">×</button>
          </div>
        </div>

        {/* Contenido scroll */}
        <div className="cs-x27">

          {/* Pestañas visibles */}
          <div>
            <div className="cs-x28">
              Pestañas visibles en el formulario
            </div>
            <div className="cs-x29">
              Marca las pestañas que debe mostrar el formulario para este flujo. Si no guardas ninguna configuración, se muestran todas por defecto.
            </div>
            <div className="cs-x30">
              {TABS_FORMULARIO.map(t => {
                const checked = pestanas.has(t.id);
                return (
                  <label key={t.id} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '9px 12px',
                    background: checked ? ACCENT_FORM.bg : '#0f1320',
                    border: `1px solid ${checked ? ACCENT_FORM.color + '66' : '#222a39'}`,
                    borderRadius: 8,
                    cursor: 'pointer',
                    transition: 'all 120ms ease',
                    fontSize: 12.5,
                    color: checked ? '#e6ebf5' : '#a9b3c7',
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => togglePestana(t.id)}
                      style={{ accentColor: ACCENT_FORM.color, flexShrink: 0 }}
                    />
                    <span>{t.label}</span>
                  </label>
                );
              })}
            </div>
            {sinPestanas && (
              <div className="cs-x31">
                Debes dejar al menos una pestaña visible; de lo contrario el formulario quedaría sin contenido.
              </div>
            )}
          </div>

          {/* Campos obligatorios */}
          <div>
            <div className="cs-x32">
              <div className="cs-x13">
                Campos obligatorios para guardar
              </div>
              {campos.size > 0 && (
                <button className="cs-x33" onClick={() => setCampos(new Set())}>Limpiar todo ({campos.size})</button>
              )}
            </div>
            <div className="cs-x29">
              El formulario no permitirá guardar la operación si estos campos están vacíos. Si ocultas una pestaña, sus campos se ignoran aunque estén marcados aquí.
            </div>

            <input className="cs-x34"
              autoFocus
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar campo…"
            />

            {seccionesFiltradas.length === 0 ? (
              <div className="cs-x35">
                No se encontraron campos.
              </div>
            ) : seccionesFiltradas.map(sec => {
              const totalSec = sec.campos.length;
              const marcadosSec = sec.campos.filter(c => campos.has(c.id)).length;
              const tabInfo = TABS_FORMULARIO.find(t => t.id === sec.tab);
              const pestanaOculta = !pestanas.has(sec.tab);
              return (
                <div className="cs-x11" key={sec.seccion}>
                  <div className="cs-x36">
                    <div className="cs-x37">
                      {sec.seccion}
                      <span className="cs-x38">
                        {marcadosSec}/{totalSec}
                      </span>
                      <span style={{
                        background: pestanaOculta ? 'rgba(248,113,113,0.10)' : 'rgba(52,211,153,0.10)',
                        border: `1px solid ${pestanaOculta ? 'rgba(248,113,113,0.35)' : 'rgba(52,211,153,0.35)'}`,
                        color: pestanaOculta ? '#f87171' : '#34d399',
                        borderRadius: 999, padding: '1px 8px', fontSize: 10, fontWeight: 600,
                        textTransform: 'none', letterSpacing: 0,
                      }}>
                        Pestaña «{tabInfo?.label}» {pestanaOculta ? 'oculta' : 'visible'}
                      </span>
                    </div>
                    <div className="cs-x15">
                      <button onClick={() => marcarSeccion(sec.campos)} style={miniBtn}>Marcar todos</button>
                      <button onClick={() => limpiarSeccion(sec.campos)} style={miniBtn}>Limpiar</button>
                    </div>
                  </div>
                  <div className="cs-x16">
                    {sec.campos.map(c => {
                      const checked = campos.has(c.id);
                      return (
                        <label key={c.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '8px 10px',
                          background: checked ? ACCENT_FORM.bg : '#0f1320',
                          border: `1px solid ${checked ? ACCENT_FORM.color + '66' : '#222a39'}`,
                          borderRadius: 8,
                          cursor: 'pointer',
                          transition: 'all 120ms ease',
                          fontSize: 12.5,
                          color: checked ? '#e6ebf5' : '#a9b3c7',
                        }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCampo(c.id)}
                            style={{ accentColor: ACCENT_FORM.color, flexShrink: 0 }}
                          />
                          <span className="cs-x17">
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
        </div>

        {/* Footer */}
        <div className="cs-x18">
          <div className="cs-x19">
            <b className="cs-x20">{pestanas.size}</b>/{TABS_FORMULARIO.length} pestañas visibles
            {' · '}
            <b className="cs-x20">{campos.size}</b> campo{campos.size === 1 ? '' : 's'} obligatorio{campos.size === 1 ? '' : 's'}
          </div>
          <div className="cs-x22">
            <button className="cs-x23" onClick={onCerrar}>Cancelar</button>
            <button
              disabled={sinPestanas}
              onClick={() => onConfirmar(Array.from(pestanas), Array.from(campos))}
              style={{
                background: sinPestanas ? '#2c3344' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                color: '#fff', border: 'none', borderRadius: 8,
                padding: '8px 18px', fontSize: 13, fontWeight: 600,
                cursor: sinPestanas ? 'not-allowed' : 'pointer',
                opacity: sinPestanas ? 0.6 : 1,
                boxShadow: sinPestanas ? 'none' : '0 4px 12px rgba(99,102,241,0.3)',
              }}
            >Aplicar</button>
          </div>
        </div>
      </div>
    </div>
  );
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
  // ✅ NUEVO (V00110): opciones del dropdown "Carga" vienen del catálogo C/V
  //   (`catalogo_carga_vacia`); si está vacío, se usa la lista fija de respaldo.
  const [opcionesCarga, setOpcionesCarga] = useState<string[]>(OPCIONES_CARGA);
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

  /* ---------- NUEVO: visibilidad de paneles laterales ---------- */
  const [sidebarVisible, setSidebarVisible]     = useState(true);
  const [inspectorVisible, setInspectorVisible] = useState(true);

  /* ---------- NUEVO: modal de campos requeridos ---------- */
  const [modalCamposAbierto, setModalCamposAbierto] = useState(false);

  /* ---------- NUEVO: configuración del formulario por flujo ----------
     `null` = el flujo todavía no tiene esta configuración guardada
     (no se debe escribir el campo en el documento hasta que el usuario
     lo configure explícitamente, para no romper flujos viejos). */
  const [pestanasVisibles, setPestanasVisibles]     = useState<TabType[] | null>(null);
  const [camposObligatorios, setCamposObligatorios] = useState<string[] | null>(null);
  const [modalFormularioAbierto, setModalFormularioAbierto] = useState(false);

  /* ---------- NUEVO: dropdown del botón "Agregar paso" ---------- */
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
        // ✅ NUEVO (V00110): lee el catálogo C/V (`catalogo_carga_vacia`). Si
        //   trae registros, sus nombres alimentan el dropdown "Carga"; si está
        //   vacío, se conserva la lista fija de respaldo (OPCIONES_CARGA).
        const cvSnap = await getDocs(collection(db, 'catalogo_carga_vacia'));
        const nombresCV = cvSnap.docs
          .map(d => (d.data() as { nombre?: unknown }).nombre)
          .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
          .sort((a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
        if (nombresCV.length > 0) setOpcionesCarga(nombresCV);
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
      if (!configValido) {
        setReglas([]);
        setPestanasVisibles(null);
        setCamposObligatorios(null);
        return;
      }
      setCargando(true);
      try {
        const docSnap = await getDoc(doc(db, 'config_flujos_operacion', configId));
        if (docSnap.exists()) {
          const data = docSnap.data();
          const flujoData: ReglaStatus[] = (data.flujo || [])
            .sort((a: ReglaStatus, b: ReglaStatus) => a.orden - b.orden)
            .map((r: ReglaStatus, i: number) => ({
              ...r,
              posicion: r.posicion ?? autoPosicion(i),
            }));
          setReglas(flujoData);
          // ✅ NUEVO: precarga config del formulario; si el flujo no la tiene
          // guardada, se deja en `null` (el Formulario asumirá "todas las
          // pestañas" / "sin campos extra obligatorios" por defecto).
          setPestanasVisibles(Array.isArray(data.pestanasVisibles) ? data.pestanasVisibles : null);
          setCamposObligatorios(Array.isArray(data.camposObligatorios) ? data.camposObligatorios : null);
        } else {
          setReglas([]);
          setPestanasVisibles(null);
          setCamposObligatorios(null);
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
     NUEVO: AUTO-CENTRAR EL FLUJO
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
      if ((modalCamposAbierto || modalFormularioAbierto) && e.key !== 'Escape') return;

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
        else if (modalFormularioAbierto) setModalFormularioAbierto(false);
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
  }, [nodoSel, seleccionados, reglas, modalCamposAbierto, modalFormularioAbierto, menuAgregarAbierto]);

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
      // ✅ NUEVO: solo se incluyen `pestanasVisibles` / `camposObligatorios`
      // si el usuario ya las configuró explícitamente (no son `null`). Así
      // los flujos viejos que nunca abrieron "Configurar formulario" se
      // re-guardan sin esos campos, y el Formulario sigue aplicando sus
      // valores por defecto (todas las pestañas, sin campos extra).
      const configFormulario: Partial<Pick<FlujoGuardado, 'pestanasVisibles' | 'camposObligatorios'>> = {};
      if (pestanasVisibles !== null) configFormulario.pestanasVisibles = pestanasVisibles;
      if (camposObligatorios !== null) configFormulario.camposObligatorios = camposObligatorios;

      await setDoc(doc(db, 'config_flujos_operacion', configId), {
        configId,
        tipoServicio,
        trafico,
        carga,
        ultimaActualizacion: new Date().toISOString(),
        flujo: flujoFinal,
        ...configFormulario,
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
            <span className="cs-x39">←</span>
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

          {/* NUEVO: Toggle del sidebar izquierdo */}
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
            options={carga && !opcionesCarga.includes(carga) ? [...opcionesCarga, carga] : opcionesCarga}
            placeholder="Selecciona…"
          />
        </div>

        <div style={S.topRight}>
          {seleccionados.size > 1 && (
            <div className="cs-x40">
              <span className="cs-x41">✓</span>
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

          {/* NUEVO: Botón "Agregar paso" prominente con dropdown */}
          <div className="cs-x42">
            <button
              onClick={() => setMenuAgregarAbierto(v => !v)}
              style={S.addStepBtn}
              title="Agregar nuevo paso al flujo"
            >
              <span className="cs-x43">+</span>
              Agregar paso
              <span className="cs-x44">▾</span>
            </button>
            {menuAgregarAbierto && (
              <>
                {/* backdrop para cerrar el menú clickeando fuera */}
                <div className="cs-x45"
                  onClick={() => setMenuAgregarAbierto(false)}
                />
                <div className="cs-x46">
                  {(Object.keys(TIPO_META) as ReglaStatus['tipoMecanismo'][]).map(t => {
                    const m = TIPO_META[t];
                    return (
                      <button
                        key={t}
                        onClick={() => agregarNodo(t)}
                        className="hov-tile cs-x47"
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
                          <div className="cs-x48">
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

          {/* NUEVO: Configuración del formulario por flujo (pestañas + campos obligatorios) */}
          <button
            onClick={() => setModalFormularioAbierto(true)}
            disabled={!configValido}
            style={{
              ...S.configFormBtn,
              opacity: !configValido ? 0.55 : 1,
              cursor: !configValido ? 'not-allowed' : 'pointer',
            }}
            title="Configura qué pestañas se muestran y qué campos son obligatorios en el formulario de operaciones para este flujo"
          >
            <span className="cs-x41">⚙</span>
            Configurar formulario
            {(pestanasVisibles !== null || camposObligatorios !== null) && (
              <span className="cs-x49" title="Este flujo ya tiene una configuración de formulario guardada" />
            )}
          </button>

          <button onClick={guardar} disabled={guardando || !configValido} style={{
            ...S.saveBtn,
            opacity: guardando || !configValido ? 0.55 : 1,
            cursor:  guardando || !configValido ? 'not-allowed' : 'pointer',
          }}>
            {guardando ? 'Guardando…' : 'Guardar flujo'}
          </button>

          {/* NUEVO: Toggle del inspector */}
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
              <div className="cs-x50">
                <div className="cs-x51">
                  <div className="cs-x52">En portapapeles</div>
                  <button className="cs-x53"
                    onClick={limpiarClipboard}
                    title="Vaciar portapapeles"
                  >×</button>
                </div>
                <div className="cs-x54">
                  {clipboardInfo.count} {clipboardInfo.count === 1 ? 'paso' : 'pasos'}
                </div>
                <div className="cs-x55">
                  desde <span className="cs-x56">{clipboardInfo.origen}</span>
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
            <svg className="cs-x57"
              width={worldSize.w}
              height={worldSize.h}
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
                    <g className="cs-x58" key={`${r.id}-${toId}`}>
                      <path className="cs-x59"
                        d={curva(p1.x, p1.y, p2.x, p2.y)}
                        stroke={isHi ? '#a78bfa' : '#4b5566'}
                        strokeWidth={isHi ? 2.4 : 1.8}
                        fill="none"
                        markerEnd={isHi ? 'url(#arrowHi)' : 'url(#arrow)'}
                      />
                      <g className="cs-x60"
                        transform={`translate(${(p1.x + p2.x) / 2}, ${(p1.y + p2.y) / 2})`}
                        onClick={(e) => { e.stopPropagation(); eliminarConexion(r.id, toId); }}
                      >
                        <circle r={10} fill="#1a1f2b" stroke="#3a4252" />
                        <text className="cs-x61" textAnchor="middle" dominantBaseline="central" fontSize="13" fill="#f87171">×</text>
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
            <div className="cs-x62">
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
                    height: NODE_H,
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
                    <div className="cs-x63">✓</div>
                  )}
                  <div style={{
                    height: 6,
                    background: `linear-gradient(90deg, ${meta.color}, transparent)`,
                    borderTopLeftRadius: 13,
                    borderTopRightRadius: 13,
                  }} />

                  <div style={{
                    height: NODE_H - 6,
                    overflow: 'hidden',
                    padding: '10px 14px 12px',
                  }}>
                    <div className="cs-x64">
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
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {r.nombreStatus || 'Sin estatus asignado'}
                    </div>

                    {(r.camposRequeridos?.length ?? 0) > 0 && (
                      <div style={{
                        marginTop: 8,
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        maxWidth: '100%',
                        background: '#11151d',
                        border: `1px solid ${meta.color}38`,
                        borderRadius: 999,
                        padding: '3px 10px 3px 8px',
                      }}>
                        <span style={{
                          width: 14, height: 14, borderRadius: '50%',
                          background: meta.bg, color: meta.color,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 8.5, fontWeight: 700, flexShrink: 0,
                        }}>{r.camposRequeridos.length}</span>
                        <span className="cs-x65">
                          campo{r.camposRequeridos.length === 1 ? '' : 's'} requerido{r.camposRequeridos.length === 1 ? '' : 's'} para avanzar
                        </span>
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
              <div className="cs-x66">
                <div className="cs-x67">◇</div>
                <div className="cs-x68">Lienzo vacío</div>
                <div className="cs-x69">
                  Usa el botón <b className="cs-x70">+ Agregar paso</b> arriba o la paleta lateral para comenzar.
                </div>
              </div>
            )}
          </div>

          {/* Controles flotantes de zoom */}
          <div style={S.zoomBar}>
            <button style={S.zoomBtn} onClick={() => setZoom(z => Math.min(1.6, z + 0.1))}>+</button>
            <div style={S.zoomLabel}>{Math.round(zoom * 100)}%</div>
            <button style={S.zoomBtn} onClick={() => setZoom(z => Math.max(0.4, z - 0.1))}>−</button>
            <div className="cs-x71" />
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
                <div className="cs-x72">◌</div>
                <div className="cs-x73">Inspector</div>
                <div className="cs-x74">
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

      {/* NUEVO: Modal de selección de campos requeridos */}
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

      {/* NUEVO: Modal "Configurar formulario" — config por flujo completo */}
      <ModalConfigurarFormulario
        abierto={modalFormularioAbierto}
        pestanasIniciales={pestanasVisibles ?? []}
        camposObligatoriosIniciales={camposObligatorios ?? []}
        onCerrar={() => setModalFormularioAbierto(false)}
        onConfirmar={(pestanas, campos) => {
          setPestanasVisibles(pestanas);
          setCamposObligatorios(campos);
          setModalFormularioAbierto(false);
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
  <label className="cs-x75">
    <span className="cs-x76">{label}</span>
    <select className="cs-x77"
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
    <button onClick={onClick} className="hov-tile cs-x78">
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
        <div className="cs-x79">{desc}</div>
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
    <div className="cs-x80">
      {/* Encabezado */}
      <div style={{
        padding: '14px 16px',
        borderBottom: '1px solid #232a3a',
        background: `linear-gradient(180deg, ${meta.bg}, transparent)`,
      }}>
        <div className="cs-x81">
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
        <div className="cs-x82">
          {regla.nombreStatus || 'Configurar nodo'}
        </div>
      </div>

      {/* Contenido scroll */}
      <div className="cs-x83">
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
          <div className="cs-x84">
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
                  <div className="cs-x41">{m.icon}</div>
                  {m.label}
                </button>
              );
            })}
          </div>
          <div className="cs-x85">
            {regla.tipoMecanismo === 'automatico' && 'El sistema avanzará automáticamente cuando los campos requeridos se llenen.'}
            {regla.tipoMecanismo === 'manual'     && 'Se mostrará como botón en la app; el usuario decide cuándo avanzar.'}
            {regla.tipoMecanismo === 'boton_decision' && 'Se mostrará como botón; permite múltiples caminos siguientes.'}
          </div>
        </Section>

        {/* NUEVO: Campos requeridos (ahora via modal) */}
        <Section
          title="Campos requeridos para avanzar"
          hint="Marca los campos del formulario de operaciones que deben estar llenos para que este paso se active."
        >
          {camposCount === 0 ? (
            <div className="cs-x86">
              Sin campos requeridos.
            </div>
          ) : (
            <div className="cs-x87">
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
            <span className="cs-x41">⚙</span>
            {camposCount === 0 ? 'Configurar campos' : `Editar campos (${camposCount})`}
          </button>
        </Section>

        {/* Conexiones salientes */}
        <Section title="Caminos siguientes" hint="Estos son los nodos a los que conecta este paso.">
          {(regla.opcionesSiguientes || []).length === 0 ? (
            <div className="cs-x88">
              Aún no hay conexiones. Arrastra desde el puerto derecho de este nodo hacia otro.
            </div>
          ) : (
            <div className="cs-x89">
              {regla.opcionesSiguientes.map(toId => {
                const target = todosNodos.find(n => n.id === toId);
                const tMeta = target ? TIPO_META[target.tipoMecanismo] : null;
                return (
                  <div className="cs-x90" key={toId}>
                    <div className="cs-x91">
                      <span style={{ color: tMeta?.color ?? '#8b94a9' }}>→</span>
                      <span className="cs-x92">{target?.nombreStatus || '(sin nombre)'}</span>
                    </div>
                    <button className="cs-x93" onClick={() => onDesconectar(toId)} title="Desconectar">×</button>
                  </div>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      {/* Acciones inferiores */}
      <div className="cs-x94">
        <button onClick={onDuplicar} style={S.actionBtn}>Duplicar</button>
        <button onClick={onEliminar} style={{ ...S.actionBtn, color: '#f87171', borderColor: '#5a2424' }}>Eliminar</button>
      </div>
    </div>
  );
};

const Section = ({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) => (
  <div>
    <div className="cs-x95">
      {title}
    </div>
    {children}
    {hint && <div className="cs-x96">{hint}</div>}
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
    <div className="cs-x97">
      <style>{CSS_GLOBAL}</style>
      <div className="cs-x98">
        <div className="cs-x99">
          <div>
            <div className="cs-x100">
              Configuración
            </div>
            <h1 className="cs-x101">
              Reglas de Estatus
            </h1>
            <div className="cs-x102">
              Diseña visualmente cómo avanzan tus operaciones entre estados.
            </div>
          </div>
          <button className="cs-x103"
            onClick={() => { setCombinacion(undefined); setVista('configurar'); }}
          >
            + Crear nuevo flujo
          </button>
        </div>

        <input className="cs-x104"
          placeholder="Buscar por servicio, tráfico o carga…"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
        />

        <div className="cs-x105">
          <table className="cs-x106">
            <thead>
              <tr className="cs-x107">
                <th className="cs-x108">Servicio</th>
                <th className="cs-x108">Tráfico</th>
                <th className="cs-x108">Carga</th>
                <th className="cs-x108">Pasos</th>
                <th className="cs-x109">Acción</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.length === 0 && (
                <tr>
                  <td className="cs-x110" colSpan={5}>
                    No hay flujos guardados todavía.
                  </td>
                </tr>
              )}
              {filtrados.map(f => (
                <tr key={f.id} className="hov-row cs-x111">
                  <td className="cs-x112">{f.tipoServicio}</td>
                  <td className="cs-x113">{f.trafico}</td>
                  <td className="cs-x113">{f.carga}</td>
                  <td className="cs-x114">
                    <span className="cs-x115">
                      {(f.flujo || []).length} pasos
                    </span>
                  </td>
                  <td className="cs-x116">
                    <button className="cs-x117"
                      onClick={() => { setCombinacion(f); setVista('configurar'); }}
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
  configFormBtn: {
    background: '#1a1f2b',
    color: '#cfc1ff',
    border: '1px solid rgba(167,139,250,0.4)',
    borderRadius: 10,
    padding: '9px 16px',
    fontWeight: 600,
    fontSize: 13,
    display: 'flex', alignItems: 'center', gap: 7,
    transition: 'all 120ms ease',
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
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
   CATÁLOGOS LOCALES
============================================================ */
const CAMPOS_OPERACION = [
  { id: 'operador',        label: 'Operador Asignado'   },
  { id: 'unidad',          label: 'Unidad Asignada'     },
  { id: 'numeroRemolque',  label: 'Número de Remolque'  },
  { id: 'numDoda',         label: 'DODA'                },
  { id: 'numManifiesto',   label: 'Manifiesto'          }
];

const TIPO_META: Record<ReglaStatus['tipoMecanismo'], { label: string; color: string; bg: string; icon: string }> = {
  automatico:     { label: 'Automático',       color: '#34d399', bg: 'rgba(52,211,153,0.10)', icon: '⚡' },
  manual:         { label: 'Acción Manual',    color: '#60a5fa', bg: 'rgba(96,165,250,0.10)', icon: '✋' },
  boton_decision: { label: 'Decisión',         color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '◇' },
};

/* ============================================================
   CONSTANTES DE LAYOUT (VERTICAL / TOP-DOWN)
============================================================ */
const NODE_W = 260;
const NODE_H = 96;
const GRID = 20;

// ✅ NUEVO: espaciado para el layout vertical en árbol
const V_SPACING = 60;   // separación vertical entre niveles (de un nodo a su hijo)
const H_SPACING = 40;   // separación horizontal entre hermanos (cuando hay ramas paralelas)
const ROOT_X = 120;     // X inicial de la primera columna
const ROOT_Y = 120;     // Y inicial del primer nivel

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
  const [draggingId, setDraggingId]           = useState<string | null>(null);
  const dragOffset                            = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  /* ---------- conexiones ---------- */
  const [conectando, setConectando]   = useState<{ from: string; toX: number; toY: number } | null>(null);

  /* ---------- inspector colapsable ---------- */
  // ✅ Estado para mostrar/ocultar el panel derecho.
  // Empieza colapsado. Se abre SOLO cuando el usuario presiona el botón flotante de "Inspector".
  // Importante: NO se abre solo al hacer clic en un nodo, para no interrumpir el flujo de trabajo.
  const [inspectorColapsado, setInspectorColapsado] = useState(true);

  // ✅ Menú flotante "Agregar nodo" (botón + en el canvas)
  const [menuAgregarAbierto, setMenuAgregarAbierto] = useState(false);

  /* ---------- refs ---------- */
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const configId = `${tipoServicio}_${trafico}_${carga}`;
  const configValido = !!tipoServicio && !!trafico && !!carga;

  /* ============================================================
     LAYOUT VERTICAL EN ÁRBOL
     Calcula posiciones siguiendo la jerarquía de conexiones:
     - Raíces (sin padre) arriba.
     - Hijos debajo de su padre.
     - Hermanos del mismo nivel se distribuyen horizontalmente SIN solaparse,
       respetando que cada subárbol tenga su propio espacio.
     - Cuando un nodo tiene varios hijos (rama de decisión), los hijos se
       centran horizontalmente debajo del padre.
  ============================================================ */
  const calcularLayoutVertical = useCallback((nodos: ReglaStatus[]): ReglaStatus[] => {
    if (nodos.length === 0) return nodos;

    // 1) Mapas auxiliares
    const mapa = new Map(nodos.map(n => [n.id, n]));
    const padres = new Map<string, string[]>();
    nodos.forEach(n => padres.set(n.id, []));
    nodos.forEach(n => {
      (n.opcionesSiguientes || []).forEach(hijoId => {
        const lista = padres.get(hijoId) || [];
        if (!lista.includes(n.id)) lista.push(n.id);
        padres.set(hijoId, lista);
      });
    });

    // 2) Raíces
    let raices = nodos.filter(n => (padres.get(n.id) || []).length === 0);
    if (raices.length === 0) raices = [nodos[0]];

    // 3) Algoritmo "Reingold-Tilford" simplificado:
    //    - Recorremos el árbol en post-orden calculando el "ancho" (en columnas) que ocupa cada subárbol.
    //    - El ancho de un nodo hoja = 1 columna.
    //    - El ancho de un nodo con hijos = suma de anchos de sus hijos.
    //    - Luego asignamos coordenadas X según el ancho acumulado, y Y según la profundidad.

    const COLUMN_W = NODE_W + H_SPACING; // ancho de una "columna" en píxeles
    const visitados = new Set<string>();   // para evitar ciclos
    const anchoSubarbol = new Map<string, number>(); // # columnas que ocupa cada subárbol

    const calcularAncho = (id: string): number => {
      if (visitados.has(id)) return anchoSubarbol.get(id) ?? 1;
      visitados.add(id);
      const nodo = mapa.get(id);
      const hijos = (nodo?.opcionesSiguientes || []).filter(h => mapa.has(h));
      if (hijos.length === 0) {
        anchoSubarbol.set(id, 1);
        return 1;
      }
      let total = 0;
      hijos.forEach(h => { total += calcularAncho(h); });
      const ancho = Math.max(1, total);
      anchoSubarbol.set(id, ancho);
      return ancho;
    };
    raices.forEach(r => calcularAncho(r.id));

    // 4) Asignación de coordenadas:
    //    - Y: nivel de profundidad * (NODE_H + V_SPACING)
    //    - X: cada subárbol ocupa "anchoSubarbol" columnas; el nodo se centra dentro de sus columnas.
    const nuevasPos = new Map<string, NodoPosicion>();
    const colocados = new Set<string>();

    const colocar = (id: string, columnaInicio: number, nivel: number) => {
      if (colocados.has(id)) return;
      colocados.add(id);
      const nodo = mapa.get(id);
      if (!nodo) return;
      const ancho = anchoSubarbol.get(id) ?? 1;
      const hijos = (nodo.opcionesSiguientes || []).filter(h => mapa.has(h));

      // Centro del nodo: dentro de las columnas que ocupa su subárbol
      const centroColumna = columnaInicio + ancho / 2;
      nuevasPos.set(id, {
        x: ROOT_X + (centroColumna - 0.5) * COLUMN_W - NODE_W / 2 + NODE_W / 2,
        y: ROOT_Y + nivel * (NODE_H + V_SPACING),
      });

      // Colocar hijos de izquierda a derecha, cada uno ocupando sus columnas
      let cursor = columnaInicio;
      hijos.forEach(h => {
        const anchoHijo = anchoSubarbol.get(h) ?? 1;
        colocar(h, cursor, nivel + 1);
        cursor += anchoHijo;
      });
    };

    // Colocar todas las raíces una al lado de la otra
    let cursorRaiz = 0;
    raices.forEach(r => {
      const ancho = anchoSubarbol.get(r.id) ?? 1;
      colocar(r.id, cursorRaiz, 0);
      cursorRaiz += ancho;
    });

    // Nodos huérfanos (no alcanzables desde ninguna raíz): los apilamos al final
    nodos.forEach(n => {
      if (!nuevasPos.has(n.id)) {
        nuevasPos.set(n.id, {
          x: ROOT_X + cursorRaiz * COLUMN_W,
          y: ROOT_Y + Array.from(nuevasPos.values()).reduce((m, p) => Math.max(m, p.y), 0) + (NODE_H + V_SPACING),
        });
        cursorRaiz += 1;
      }
    });

    return nodos.map(n => ({ ...n, posicion: nuevasPos.get(n.id) || n.posicion || { x: ROOT_X, y: ROOT_Y } }));
  }, []);

  /* posición automática inicial cuando agregamos un nodo nuevo: lo ponemos debajo del último */
  const autoPosicion = (idx: number): NodoPosicion => ({
    x: ROOT_X,
    y: ROOT_Y + idx * (NODE_H + V_SPACING),
  });

  /* ============================================================
     CARGA INICIAL
  ============================================================ */
  useEffect(() => {
    const cargarDatos = async () => {
      try {
        const statusSnap = await getDocs(collection(db, 'catalogo_status_servicio'));
        const nombres = statusSnap.docs.map(d => d.data().nombre as string).filter(Boolean);
        // ✅ Orden natural por el número que aparece al inicio del nombre.
        // "10.1 MET" debe ir DESPUÉS de "2. Algo", no antes (como haría sort() alfabético).
        // Usamos Intl.Collator con numeric:true que entiende secuencias de dígitos como números.
        const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
        nombres.sort(collator.compare);
        setCatalogoStatus(nombres);

        const opSnap = await getDocs(collection(db, 'catalogo_tipo_operacion'));
        setTiposOperacion(opSnap.docs.map(d => ({ id: d.id, tipo_operacion: d.data().tipo_operacion })));
      } catch (e) {
        console.error(e);
      }
    };
    cargarDatos();
  }, []);

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
          // ✅ Si hay nodos sin posición guardada, recalculamos layout vertical de todos
          const tieneSinPos = flujoData.some(r => !r.posicion);
          setReglas(tieneSinPos ? calcularLayoutVertical(flujoData) : flujoData);
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

  /* ============================================================
     ATAJOS DE TECLADO
  ============================================================ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && nodoSel) {
        eliminarNodo(nodoSel);
      } else if (e.key === 'Escape') {
        setNodoSel(null);
        setConectando(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodoSel]);

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
    setNodoSel(null);
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
    setNodoSel(id);
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
        setReglas(prev => prev.map(r =>
          r.id === draggingId ? { ...r, posicion: { x: nx, y: ny } } : r
        ));
      }
      if (conectando) {
        const w = mouseToWorld(e.clientX, e.clientY);
        setConectando(c => c ? { ...c, toX: w.x, toY: w.y } : c);
      }
    };
    const onUp = () => {
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
    // ✅ Si hay nodos previos, posicionar el nuevo debajo del más bajo (en Y), no encimado.
    let posInicial: NodoPosicion;
    if (reglas.length === 0) {
      posInicial = { x: ROOT_X, y: ROOT_Y };
    } else {
      const masAbajo = reglas.reduce(
        (acc, r) => (r.posicion && r.posicion.y > acc.y ? r.posicion : acc),
        { x: ROOT_X, y: ROOT_Y } as NodoPosicion
      );
      posInicial = { x: masAbajo.x, y: masAbajo.y + NODE_H + V_SPACING };
    }
    const nuevo: ReglaStatus = {
      id: `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      orden: idx + 1,
      nombreStatus: '',
      tipoMecanismo: tipo,
      camposRequeridos: [],
      opcionesSiguientes: [],
      posicion: posInicial,
    };
    setReglas(prev => [...prev, nuevo]);
    setNodoSel(nuevo.id);
    setMenuAgregarAbierto(false); // ✅ cierra el menú flotante si estaba abierto
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
  };

  /* ============================================================
     CONEXIONES
     ✅ AHORA: salida por ABAJO del nodo, entrada por ARRIBA.
  ============================================================ */
  const iniciarConexion = (e: React.MouseEvent, fromId: string) => {
    e.stopPropagation();
    const r = reglas.find(x => x.id === fromId);
    if (!r?.posicion) return;
    setConectando({
      from: fromId,
      toX: r.posicion.x + NODE_W / 2,
      toY: r.posicion.y + NODE_H,
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
    const flujoFinal = reglas.map((r, i) => ({
      ...r,
      orden: i + 1,
    }));

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
     AUTO-LAYOUT (ahora usa el layout vertical en árbol)
  ============================================================ */
  const autoOrganizar = () => {
    setReglas(prev => calcularLayoutVertical(prev));
    setPan({ x: 0, y: 0 });
    setZoom(1);
  };

  /* ============================================================
     DERIVADOS
  ============================================================ */
  const reglaSel = useMemo(() => reglas.find(r => r.id === nodoSel) || null, [reglas, nodoSel]);

  /* ✅ helpers para puntos de conexión VERTICALES:
        - salida: parte inferior centrada
        - entrada: parte superior centrada */
  const portOut = (r: ReglaStatus) => ({
    x: (r.posicion?.x ?? 0) + NODE_W / 2,
    y: (r.posicion?.y ?? 0) + NODE_H,
  });
  const portIn = (r: ReglaStatus) => ({
    x: (r.posicion?.x ?? 0) + NODE_W / 2,
    y: (r.posicion?.y ?? 0),
  });

  /* ✅ Curva Bézier VERTICAL (los puntos de control se desplazan en Y, no en X).
        Esto hace que la línea salga hacia abajo del nodo origen
        y entre hacia abajo del nodo destino, como en un diagrama de flujo real. */
  const curva = (x1: number, y1: number, x2: number, y2: number) => {
    const dy = Math.max(40, Math.abs(y2 - y1) * 0.5);
    return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
  };

  /* tamaño "virtual" del mundo */
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
            options={['Importación', 'Exportación', 'Nacional', 'N/A']}
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
          <button onClick={guardar} disabled={guardando || !configValido} style={{
            ...S.saveBtn,
            opacity: guardando || !configValido ? 0.55 : 1,
            cursor:  guardando || !configValido ? 'not-allowed' : 'pointer',
          }}>
            {guardando ? 'Guardando…' : 'Guardar flujo'}
          </button>
        </div>
      </header>

      {/* ===== CUERPO ===== */}
      <div style={S.body}>
        {/* Sidebar izquierdo: paleta de nodos */}
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

          <div style={{ ...S.sidebarTitle, marginTop: 24 }}>Herramientas</div>
          <button onClick={autoOrganizar} style={S.toolBtn}>
            <span>⟲</span> Reorganizar (vertical)
          </button>
          <button onClick={() => { setPan({ x: 0, y: 0 }); setZoom(1); }} style={S.toolBtn}>
            <span>⤧</span> Centrar vista
          </button>

          <div style={S.legend}>
            <div style={S.legendTitle}>Tips</div>
            <div style={S.legendItem}><b>El flujo va de arriba hacia abajo</b>.</div>
            <div style={S.legendItem}>Usa el botón <b>+</b> abajo del lienzo o esta paleta para agregar nodos.</div>
            <div style={S.legendItem}>Para <b>múltiples caminos</b>, arrastra desde el puerto inferior de un nodo hacia varios nodos distintos. Cada conexión es un camino.</div>
            <div style={S.legendItem}><b>Ctrl + Rueda</b> para zoom.</div>
            <div style={S.legendItem}><b>Supr</b> elimina el nodo seleccionado.</div>
          </div>
        </aside>

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
                  const isHi = nodoSel === r.id || nodoSel === toId;
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
                      {/* Botón eliminar conexión, a la mitad */}
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

              {/* Conexión en progreso */}
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

            {/* Nodo START (visual, no editable) */}
            <div style={{
              position: 'absolute',
              left: ROOT_X + NODE_W / 2 - 110,
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
              ▼ Evento: Nueva Operación
            </div>

            {/* Nodos */}
            {reglas.map(r => {
              const meta = TIPO_META[r.tipoMecanismo];
              const isSel = nodoSel === r.id;
              return (
                <div
                  key={r.id}
                  onMouseDown={(e) => onNodeMouseDown(e, r.id)}
                  onClick={(e) => { e.stopPropagation(); setNodoSel(r.id); }}
                  style={{
                    position: 'absolute',
                    left: r.posicion?.x ?? 0,
                    top:  r.posicion?.y ?? 0,
                    width: NODE_W,
                    minHeight: NODE_H,
                    background: 'linear-gradient(180deg, #1c2230 0%, #161b25 100%)',
                    border: `1.5px solid ${isSel ? meta.color : '#2c3344'}`,
                    borderRadius: 14,
                    boxShadow: isSel
                      ? `0 0 0 4px ${meta.color}22, 0 10px 30px rgba(0,0,0,0.5)`
                      : '0 6px 22px rgba(0,0,0,0.4)',
                    cursor: draggingId === r.id ? 'grabbing' : 'grab',
                    userSelect: 'none',
                    transition: 'box-shadow 140ms ease, border-color 140ms ease',
                  }}
                >
                  {/* franja superior */}
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
                            {CAMPOS_OPERACION.find(x => x.id === c)?.label || c}
                          </span>
                        ))}
                        {r.camposRequeridos.length > 3 && (
                          <span style={S.tag}>+{r.camposRequeridos.length - 3}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ✅ Puerto entrada (ARRIBA, centrado) */}
                  <div
                    onMouseUp={() => finalizarConexion(r.id)}
                    style={{
                      position: 'absolute',
                      left: NODE_W / 2 - 7,
                      top: -7,
                      width: 14, height: 14, borderRadius: '50%',
                      background: '#0d1117',
                      border: `2px solid ${meta.color}`,
                      boxShadow: `0 0 0 3px ${meta.color}22`,
                    }}
                    title="Entrada (recibe el flujo)"
                  />
                  {/* ✅ Puerto salida (ABAJO, centrado) */}
                  <div
                    onMouseDown={(e) => iniciarConexion(e, r.id)}
                    style={{
                      position: 'absolute',
                      left: NODE_W / 2 - 7,
                      bottom: -7,
                      width: 14, height: 14, borderRadius: '50%',
                      background: meta.color,
                      border: '2px solid #0d1117',
                      cursor: 'crosshair',
                      boxShadow: `0 0 12px ${meta.color}aa`,
                    }}
                    title="Salida (arrastra hacia abajo para conectar)"
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
                <div style={{ marginTop: 4, fontSize: 13 }}>Agrega un bloque desde la paleta de la izquierda para empezar.</div>
              </div>
            )}
          </div>

          {/* Controles flotantes de zoom */}
          <div style={S.zoomBar}>
            <button style={S.zoomBtn} onClick={() => setZoom(z => Math.min(1.6, z + 0.1))}>+</button>
            <div style={S.zoomLabel}>{Math.round(zoom * 100)}%</div>
            <button style={S.zoomBtn} onClick={() => setZoom(z => Math.max(0.4, z - 0.1))}>−</button>
            <div style={{ height: 1, background: '#2a3142', margin: '4px 0' }} />
            <button style={S.zoomBtn} onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset">⌂</button>
          </div>

          {/* ✅ NUEVO: Botón flotante "+ Agregar nodo" abajo a la izquierda del canvas.
              Abre un mini-menú con los 3 tipos disponibles.
              Útil para no tener que ir al sidebar izquierdo cada vez. */}
          <div style={S.addNodeContainer}>
            {menuAgregarAbierto && (
              <div style={S.addNodeMenu}>
                {(Object.keys(TIPO_META) as ReglaStatus['tipoMecanismo'][]).map(t => {
                  const m = TIPO_META[t];
                  return (
                    <button
                      key={t}
                      onClick={() => agregarNodo(t)}
                      style={{
                        ...S.addNodeMenuItem,
                        borderLeft: `3px solid ${m.color}`,
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = m.bg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = '#11151d'; }}
                    >
                      <span style={{ color: m.color, fontSize: 16, marginRight: 8 }}>{m.icon}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                        <span style={{ color: m.color, fontWeight: 600, fontSize: 12 }}>{m.label}</span>
                        <span style={{ color: '#7a8499', fontSize: 11, marginTop: 2 }}>
                          {t === 'automatico'     && 'Avanza al cumplir campos'}
                          {t === 'manual'         && 'Requiere acción manual'}
                          {t === 'boton_decision' && 'Múltiples caminos'}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            <button
              onClick={() => setMenuAgregarAbierto(v => !v)}
              style={{
                ...S.addNodeFab,
                background: menuAgregarAbierto
                  ? 'linear-gradient(135deg, #4f46e5, #7c3aed)'
                  : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                transform: menuAgregarAbierto ? 'rotate(45deg)' : 'rotate(0deg)',
              }}
              title="Agregar nodo al flujo"
            >
              <span style={{ fontSize: 22, lineHeight: 1, color: '#fff', fontWeight: 300 }}>+</span>
            </button>
          </div>

          {cargando && (
            <div style={S.loadingOverlay}>Cargando flujo…</div>
          )}
        </div>

        {/* Panel derecho: inspector (colapsable) */}
        <aside style={{
          ...S.inspector,
          // ✅ Cuando está colapsado, ancho 0 con transición suave para ocultarlo sin desmontarlo.
          width: inspectorColapsado ? 0 : 340,
          minWidth: inspectorColapsado ? 0 : 340,
          borderLeft: inspectorColapsado ? 'none' : '1px solid #1c2230',
          transition: 'width 200ms ease, min-width 200ms ease',
        }}>
          {!inspectorColapsado && (
            <>
              {/* Botón para colapsar (flecha apuntando a la derecha, dentro del panel) */}
              <button
                onClick={() => setInspectorColapsado(true)}
                style={S.inspectorToggleInside}
                title="Ocultar panel"
              >
                →
              </button>

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
                  campos={CAMPOS_OPERACION}
                  todosNodos={reglas}
                  onChange={(patch) => actualizarNodo(reglaSel.id, patch)}
                  onDuplicar={() => duplicarNodo(reglaSel.id)}
                  onEliminar={() => eliminarNodo(reglaSel.id)}
                  onDesconectar={(toId) => eliminarConexion(reglaSel.id, toId)}
                />
              )}
            </>
          )}
        </aside>

        {/* ✅ Botón flotante para expandir el inspector cuando está colapsado.
            Se posiciona pegado al borde derecho. Muestra un badge si hay un nodo seleccionado. */}
        {inspectorColapsado && (
          <button
            onClick={() => setInspectorColapsado(false)}
            style={S.inspectorToggleOutside}
            title={reglaSel ? `Mostrar inspector (${reglaSel.nombreStatus || 'nodo seleccionado'})` : 'Mostrar inspector'}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>←</span>
            <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 600 }}>
              Inspector
            </span>
            {reglaSel && (
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: TIPO_META[reglaSel.tipoMecanismo].color,
                boxShadow: `0 0 8px ${TIPO_META[reglaSel.tipoMecanismo].color}`,
              }} />
            )}
          </button>
        )}
      </div>
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
  regla, catalogoStatus, campos, todosNodos,
  onChange, onDuplicar, onEliminar, onDesconectar
}: {
  regla: ReglaStatus;
  catalogoStatus: string[];
  campos: { id: string; label: string }[];
  todosNodos: ReglaStatus[];
  onChange: (p: Partial<ReglaStatus>) => void;
  onDuplicar: () => void;
  onEliminar: () => void;
  onDesconectar: (toId: string) => void;
}) => {
  const meta = TIPO_META[regla.tipoMecanismo];
  const toggleCampo = (id: string) => {
    const set = new Set(regla.camposRequeridos || []);
    set.has(id) ? set.delete(id) : set.add(id);
    onChange({ camposRequeridos: Array.from(set) });
  };

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

        {/* Campos requeridos */}
        <Section title="Campos requeridos para avanzar" hint="Los caminos siguientes solo se activan si estos campos están llenos.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {campos.map(c => {
              const checked = regla.camposRequeridos?.includes(c.id);
              return (
                <label key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  padding: '8px 10px',
                  background: checked ? 'rgba(96,165,250,0.08)' : '#11151d',
                  border: `1px solid ${checked ? '#3b5a8a' : '#222a39'}`,
                  borderRadius: 8,
                  cursor: 'pointer',
                  transition: 'all 120ms ease',
                }}>
                  <input
                    type="checkbox"
                    checked={!!checked}
                    onChange={() => toggleCampo(c.id)}
                    style={{ accentColor: '#60a5fa' }}
                  />
                  <span style={{ fontSize: 13, color: checked ? '#cfe0f7' : '#c9d1d9' }}>{c.label}</span>
                </label>
              );
            })}
          </div>
        </Section>

        {/* Conexiones salientes */}
        <Section title="Caminos siguientes" hint="Estos son los nodos a los que conecta este paso.">
          {(regla.opcionesSiguientes || []).length === 0 ? (
            <div style={{ fontSize: 12.5, color: '#6b7385', fontStyle: 'italic', padding: '8px 0' }}>
              Aún no hay conexiones. Arrastra desde el puerto inferior de este nodo hacia el puerto superior de otro.
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
                      <span style={{ color: tMeta?.color ?? '#8b94a9' }}>↓</span>
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
  toast: {
    padding: '6px 12px',
    fontSize: 12,
    borderRadius: 8,
    fontWeight: 500,
  },

  body: { display: 'flex', flex: 1, overflow: 'hidden' },

  sidebar: {
    width: 260,
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

  // ✅ NUEVO: Botón flotante "+" (FAB) y su menú desplegable.
  addNodeContainer: {
    position: 'absolute',
    left: 20,
    bottom: 20,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 10,
    zIndex: 6,
  },
  addNodeFab: {
    width: 52,
    height: 52,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 24px rgba(99,102,241,0.45)',
    transition: 'transform 200ms ease, background 200ms ease',
  },
  addNodeMenu: {
    background: '#0f1320',
    border: '1px solid #2a3142',
    borderRadius: 10,
    padding: 6,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 220,
    boxShadow: '0 12px 28px rgba(0,0,0,0.5)',
    animation: 'fadeUp 160ms ease',
  },
  addNodeMenuItem: {
    display: 'flex',
    alignItems: 'center',
    padding: '9px 10px',
    background: '#11151d',
    border: '1px solid transparent',
    borderRadius: 7,
    cursor: 'pointer',
    transition: 'background 120ms ease',
    width: '100%',
    textAlign: 'left',
  },

  loadingOverlay: {
    position: 'absolute', inset: 0,
    background: 'rgba(10,13,20,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#8b94a9', fontSize: 14,
    backdropFilter: 'blur(4px)',
  },

  inspector: {
    width: 340,
    flexShrink: 0,
    background: '#0d1118',
    borderLeft: '1px solid #1c2230',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    position: 'relative',
  },
  emptyInspector: {
    padding: '60px 24px',
    textAlign: 'center',
    color: '#5f697d',
  },

  // ✅ Botón "←" pequeño dentro del panel, esquina superior izquierda, para colapsar.
  inspectorToggleInside: {
    position: 'absolute',
    top: 12,
    left: 12,
    width: 26,
    height: 26,
    borderRadius: 6,
    background: '#1a1f2b',
    border: '1px solid #2c3344',
    color: '#a9b3c7',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },

  // ✅ Botón flotante vertical pegado al borde derecho del canvas para expandir el inspector.
  inspectorToggleOutside: {
    position: 'absolute',
    right: 0,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'linear-gradient(180deg, #1a1f2b, #151a24)',
    border: '1px solid #2c3344',
    borderRight: 'none',
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    color: '#a9b3c7',
    cursor: 'pointer',
    padding: '14px 8px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    boxShadow: '-4px 0 14px rgba(0,0,0,0.35)',
    zIndex: 5,
    transition: 'background 120ms ease',
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
  }
  .hov-row:hover { background: #11151d; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;
// src/features/empresas/services/reporteEmpresas.ts
// ---------------------------------------------------------------------------
// ✅ V00507 — REPORTE DE EMPRESAS (lógica pura; las lecturas están en reporteEmpresasLectura.ts).
// Clientes y proveedores con su dirección y cuántas operaciones tienen, separadas en Importación,
// Exportación y Otros (movimientos, en falso y sin clasificar).
//   · Categoría: la empresa es CLIENTE si uno de sus tipos dice "Cliente" (Paga o Mercancía) y
//     PROVEEDOR si dice "Proveedor" (Transporte o Servicios). Una empresa que aparece en
//     operaciones con ese papel también entra aunque su tipo no lo diga. Puede estar en las dos.
//   · Papel en la operación: cliente = el que paga o el de la mercancía; proveedor = el de
//     transporte o el de servicios. Cada operación cuenta UNA vez por empresa y categoría.
//   · La empresa de cada papel se busca igual que los campos canónicos (operacionCanonica): por su
//     id (el del documento o el de AppSheet) y, en registros viejos que guardaron el nombre, por un
//     nombre que solo tenga una empresa.
//   · Clase: canceladas NO cuentan; "en falso" va a Otros aunque fuera cruce; lo demás con la regla
//     de Estadísticas (clasificacionOperacion.ts) y, si no dice, con el tráfico de la operación.
// ---------------------------------------------------------------------------
import { TIPO_EMPRESA } from '../../../shared/dominio/constantes';
import { crearIndice, esOperacionPrueba, estadoGrupoDe, FUENTES_CANONICAS } from '../../../shared/dominio/operacionCanonica';
import { normalizarTexto, pareceId } from '../../../shared/dominio/texto';
import { buscarEntrada, entradasCatalogo, idsDeRegistro, nombreDeRegistro } from '../../../shared/data/indiceCatalogo';
import type { EntradaCatalogo } from '../../../shared/data/indiceCatalogo';
import { movimientoDeOperacion, movimientoDeTexto, normalizarMovimiento } from '../../operaciones/services/clasificacionOperacion';

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export type Categoria = 'cliente' | 'proveedor';
export const CATEGORIAS: readonly Categoria[] = ['cliente', 'proveedor'];

/** Campos canónicos de cada papel; sus campos de origen están en FUENTES_CANONICAS. */
const PAPELES: Readonly<Record<Categoria, readonly string[]>> = {
  cliente: ['clientePagaId', 'clienteMercanciaId'],
  proveedor: ['proveedorUnidadId', 'provServiciosId'],
};

/** Ids fijos de la app por categoría (por si el catálogo de tipos no trae el nombre). */
const TIPOS_FIJOS: Readonly<Record<Categoria, readonly string[]>> = {
  cliente: [TIPO_EMPRESA.clientePaga],
  proveedor: [TIPO_EMPRESA.proveedorUnidad, TIPO_EMPRESA.proveedorServicios],
};
const PALABRA: Readonly<Record<Categoria, string>> = { cliente: 'cliente', proveedor: 'proveedor' };

export type ClaseOperacion = 'importacion' | 'exportacion' | 'movimiento' | 'falso' | 'sinClasificar';

export interface ConteoOperaciones {
  total: number;
  importacion: number;
  exportacion: number;
  movimiento: number;
  falso: number;
  sinClasificar: number;
  /** Fecha de servicio más reciente (AAAA-MM-DD) o ''. */
  ultima: string;
}

export interface DireccionReporte {
  completa: string;
  calle: string;
  numExterior: string;
  numInterior: string;
  colonia: string;
  municipio: string;
  estado: string;
  cp: string;
  pais: string;
}

export interface FilaReporteEmpresa {
  id: string;
  numero: string;
  nombre: string;
  nombreCorto: string;
  status: string;
  tipos: string;
  direccion: DireccionReporte;
  otrasDirecciones: string;
  conteo: ConteoOperaciones;
}

export interface ReporteEmpresas {
  clientes: FilaReporteEmpresa[];
  proveedores: FilaReporteEmpresa[];
  /** Operaciones revisadas (sin las de prueba). */
  revisadas: number;
  /** Canceladas: no cuentan en nada. */
  canceladas: number;
  /** Operaciones DISTINTAS que cuentan en cada categoría (una con dos clientes cuenta una vez). */
  totales: Record<Categoria, ConteoOperaciones>;
  /** Operaciones que traen cliente / proveedor, pero no es ninguna empresa de Empresas. */
  sinEmpresa: Record<Categoria, number>;
  /** Operaciones sin cliente / sin proveedor. */
  sinPapel: Record<Categoria, number>;
}

export interface EntradaReporteEmpresas {
  empresas: readonly Datos[];
  operaciones: readonly Datos[];
  tiposEmpresa?: readonly Datos[];
  direcciones?: readonly Datos[];
  status?: readonly Datos[];
  trafico?: readonly Datos[];
}

const conteoVacio = (): ConteoOperaciones => ({ total: 0, importacion: 0, exportacion: 0, movimiento: 0, falso: 0, sinClasificar: 0, ultima: '' });

const sumar = (c: ConteoOperaciones, clase: ClaseOperacion, fecha: string): void => {
  c.total += 1;
  c[clase] += 1;
  if (fecha > c.ultima) c.ultima = fecha;
};

/** Otros = movimientos + en falso + sin clasificar. */
export const otrosDe = (c: ConteoOperaciones): number => c.movimiento + c.falso + c.sinClasificar;

const DESDE_MOVIMIENTO = { 'Importación': 'importacion', 'Exportación': 'exportacion', 'Movimiento': 'movimiento' } as const;

/**
 * Clase de la operación para el reporte. `nombreStatus` da el nombre del status del catálogo (para
 * saber si es cancelada o en falso) y `nombreTrafico` el del tráfico (respaldo de la clasificación).
 */
export const claseDeOperacion = (
  op: Datos, nombreStatus: (id: string) => string | undefined, nombreTrafico: (valor: unknown) => string,
): ClaseOperacion | 'cancelada' => {
  const grupo = estadoGrupoDe(op, nombreStatus(txt(op.status)));
  if (grupo === 'cancelada') return 'cancelada';
  if (grupo === 'falso') return 'falso';
  const mov = movimientoDeOperacion(op);
  if (mov !== 'Sin clasificar') return DESDE_MOVIMIENTO[mov];
  const porTrafico = movimientoDeTexto(normalizarMovimiento(nombreTrafico(op.trafico ?? op.traficoNombre ?? op.traficoId)));
  return porTrafico === 'Sin clasificar' ? 'sinClasificar' : DESDE_MOVIMIENTO[porTrafico];
};

/** Nombre de cada registro de un catálogo por cualquiera de sus ids. */
const nombresPorId = (docs: readonly Datos[], preferidos: readonly string[]): Map<string, string> => {
  const m = new Map<string, string>();
  docs.forEach((d) => {
    const nombre = nombreDeRegistro(d, preferidos);
    if (nombre) idsDeRegistro(d).forEach((id) => { if (!m.has(id)) m.set(id, nombre); });
  });
  return m;
};

// ── Empresas: índice por id y por nombre único ────────────────────────────
interface IndiceEmpresas { porId: Map<string, number>; porNombre: ReadonlyMap<string, string | null>; idReal: Map<string, number> }

const indiceEmpresas = (empresas: readonly Datos[]): IndiceEmpresas => {
  const porId = new Map<string, number>();
  const idReal = new Map<string, number>();
  const docs: { id: string; nombres: unknown[] }[] = [];
  empresas.forEach((e, i) => {
    const ids = idsDeRegistro(e);
    if (ids.length === 0) return;
    ids.forEach((id) => { if (!porId.has(id)) porId.set(id, i); });
    if (!idReal.has(ids[0])) idReal.set(ids[0], i);
    docs.push({ id: ids[0], nombres: [e.nombre, e.razonSocial, e.nombreCorto] });
  });
  return { porId, porNombre: crearIndice(docs).porNombre, idReal };
};

/** Empresa (posición en la lista) de un papel de la operación; `conValor` = el papel traía algo. */
const empresaDelPapel = (op: Datos, campo: string, indice: IndiceEmpresas): { empresa: number | null; conValor: boolean } => {
  let conValor = false;
  for (const fuente of FUENTES_CANONICAS[campo] ?? [campo]) {
    const v = txt(op[fuente]);
    if (!v || normalizarTexto(v) === 'n/a') continue;
    conValor = true;
    const porId = indice.porId.get(v);
    if (porId !== undefined) return { empresa: porId, conValor };
    if (pareceId(v)) continue;
    const id = indice.porNombre.get(normalizarTexto(v));
    if (typeof id === 'string') {
      const i = indice.idReal.get(id);
      if (i !== undefined) return { empresa: i, conValor };
    }
  }
  return { empresa: null, conValor };
};

// ── Tipos y direcciones de una empresa ────────────────────────────────────
const valoresDeTipos = (v: unknown): unknown[] => (Array.isArray(v) ? v : v ? [v] : []);

/** Nombres de los tipos de la empresa (los objetos viejos traen su nombre; los ids se buscan en el catálogo). */
const nombresDeTipos = (e: Datos, tipos: readonly EntradaCatalogo[]): { nombres: string[]; ids: string[] } => {
  const nombres: string[] = [];
  const ids: string[] = [];
  valoresDeTipos(e.tiposEmpresa).forEach((t) => {
    if (t && typeof t === 'object') {
      const o = t as Datos;
      const entrada = buscarEntrada(tipos, o.id);
      const nombre = txt(o.nombre) || txt(o.tipo) || entrada?.nombre || txt(o.id);
      if (nombre) nombres.push(nombre);
      if (txt(o.id)) ids.push(txt(o.id));
      return;
    }
    const valor = txt(t);
    if (!valor) return;
    ids.push(valor);
    nombres.push(buscarEntrada(tipos, valor)?.nombre ?? valor);
  });
  return { nombres: Array.from(new Set(nombres)), ids };
};

const esDeCategoria = (nombreTipo: string, categoria: Categoria): boolean => normalizarTexto(nombreTipo).includes(PALABRA[categoria]);

const DIR_VACIA: DireccionReporte = { completa: '', calle: '', numExterior: '', numInterior: '', colonia: '', municipio: '', estado: '', cp: '', pais: '' };

const direccionDeDoc = (d: Datos): DireccionReporte => {
  const calle = txt(d.calleNombre);
  const numExterior = txt(d.numExterior);
  const numInterior = txt(d.numInterior);
  const colonia = txt(d.coloniaNombre);
  const municipio = txt(d.municipioNombre);
  const estado = txt(d.estadoNombre);
  const cp = txt(d.cpNombre);
  const pais = txt(d.paisNombre);
  const armada = [[calle, numExterior, numInterior && `Int. ${numInterior}`].filter(Boolean).join(' '), colonia, municipio, estado, cp && `C.P. ${cp}`, pais].filter(Boolean).join(', ');
  return { completa: txt(d.direccionCompleta) || armada, calle, numExterior, numInterior, colonia, municipio, estado, cp, pais };
};

interface RefDireccion { id: string; texto: string; tipo: string }

/** Direcciones de la empresa: las de cada tipo (Directorio) y la general vieja (direccionId/direccion). */
const referenciasDireccion = (e: Datos, dirPorId: ReadonlyMap<string, Datos>): RefDireccion[] => {
  const refs: RefDireccion[] = [];
  (Array.isArray(e.direccionesPorTipo) ? e.direccionesPorTipo : []).forEach((x: unknown) => {
    if (!x || typeof x !== 'object') return;
    const o = x as Datos;
    refs.push({ id: txt(o.direccionId), texto: txt(o.direccionNombre), tipo: txt(o.tipoNombre) });
  });
  const general = txt(e.direccionId) || txt(e.direccion);
  const textoGeneral = txt(e.direccionLabel) || (dirPorId.has(txt(e.direccion)) ? '' : txt(e.direccion));
  if (general || textoGeneral) refs.push({ id: general, texto: textoGeneral, tipo: '' });
  return refs;
};

/** La dirección del tipo de la categoría (si la hay), luego la general y luego las demás; sin repetir. */
const direccionesDe = (
  e: Datos, categoria: Categoria, dirPorId: ReadonlyMap<string, Datos>, tipos: readonly EntradaCatalogo[],
): { principal: DireccionReporte; otras: string } => {
  const refs = referenciasDireccion(e, dirPorId);
  const nombreTipo = (t: string) => buscarEntrada(tipos, t)?.nombre ?? t;
  const peso = (r: RefDireccion) => (r.tipo && esDeCategoria(nombreTipo(r.tipo), categoria) ? 0 : r.tipo ? 2 : 1);
  const ordenadas = refs.map((r, i) => ({ r, i })).sort((a, b) => peso(a.r) - peso(b.r) || a.i - b.i).map((x) => x.r);
  const vistas = new Set<string>();
  const lista: DireccionReporte[] = [];
  ordenadas.forEach((r) => {
    const doc = r.id ? dirPorId.get(r.id) : undefined;
    // Sin documento en el Directorio: el texto guardado (o lo guardado en el id, si no tiene forma de id).
    const texto = r.texto || (r.id && !pareceId(r.id) ? r.id : '');
    const dir = doc ? direccionDeDoc(doc) : { ...DIR_VACIA, completa: texto };
    if (!dir.completa) return;
    const clave = normalizarTexto(dir.completa);
    if (vistas.has(clave)) return;
    vistas.add(clave);
    lista.push(dir);
  });
  return { principal: lista[0] ?? DIR_VACIA, otras: lista.slice(1).map((d) => d.completa).join(' | ') };
};

// ── Reporte ───────────────────────────────────────────────────────────────
const ordenar = (filas: FilaReporteEmpresa[]): FilaReporteEmpresa[] =>
  filas.sort((a, b) => b.conteo.total - a.conteo.total || a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));

export const armarReporteEmpresas = (entrada: EntradaReporteEmpresas): ReporteEmpresas => {
  const { empresas } = entrada;
  const tipos = entradasCatalogo(entrada.tiposEmpresa ?? [], ['tipo']);
  const statusPorId = nombresPorId(entrada.status ?? [], ['nombre']);
  const traficos = entradasCatalogo(entrada.trafico ?? [], ['trafico', 'nombre']);
  const nombreTrafico = (v: unknown): string => buscarEntrada(traficos, v)?.nombre ?? txt(v);
  const dirPorId = new Map<string, Datos>();
  (entrada.direcciones ?? []).forEach((d) => idsDeRegistro(d).forEach((id) => { if (!dirPorId.has(id)) dirPorId.set(id, d); }));
  const indice = indiceEmpresas(empresas);

  const conteos: Record<Categoria, Map<number, ConteoOperaciones>> = { cliente: new Map(), proveedor: new Map() };
  const totales: Record<Categoria, ConteoOperaciones> = { cliente: conteoVacio(), proveedor: conteoVacio() };
  const sinEmpresa: Record<Categoria, number> = { cliente: 0, proveedor: 0 };
  const sinPapel: Record<Categoria, number> = { cliente: 0, proveedor: 0 };
  let revisadas = 0;
  let canceladas = 0;

  entrada.operaciones.forEach((op) => {
    if (esOperacionPrueba(op)) return;
    revisadas += 1;
    const clase = claseDeOperacion(op, (id) => statusPorId.get(id), nombreTrafico);
    if (clase === 'cancelada') { canceladas += 1; return; }
    const fecha = txt(op._fechaISO);
    CATEGORIAS.forEach((cat) => {
      const encontradas = new Set<number>();
      let conValor = false;
      PAPELES[cat].forEach((campo) => {
        const r = empresaDelPapel(op, campo, indice);
        conValor = conValor || r.conValor;
        if (r.empresa !== null) encontradas.add(r.empresa);
      });
      if (encontradas.size === 0) {
        if (conValor) sinEmpresa[cat] += 1; else sinPapel[cat] += 1;
        return;
      }
      sumar(totales[cat], clase, fecha);
      encontradas.forEach((i) => {
        const c = conteos[cat].get(i) ?? conteoVacio();
        sumar(c, clase, fecha);
        conteos[cat].set(i, c);
      });
    });
  });

  const filas: Record<Categoria, FilaReporteEmpresa[]> = { cliente: [], proveedor: [] };
  empresas.forEach((e, i) => {
    const ids = idsDeRegistro(e);
    if (ids.length === 0) return;
    const t = nombresDeTipos(e, tipos);
    CATEGORIAS.forEach((cat) => {
      const conteo = conteos[cat].get(i);
      const porTipo = t.nombres.some((n) => esDeCategoria(n, cat)) || t.ids.some((id) => TIPOS_FIJOS[cat].includes(id));
      if (!porTipo && !conteo) return;
      const dir = direccionesDe(e, cat, dirPorId, tipos);
      filas[cat].push({
        id: ids[0],
        numero: txt(e.numCliente),
        nombre: txt(e.nombre) || txt(e.razonSocial) || txt(e.nombreCorto),
        nombreCorto: txt(e.nombreCorto),
        status: txt(e.status),
        tipos: t.nombres.join(', '),
        direccion: dir.principal,
        otrasDirecciones: dir.otras,
        conteo: conteo ?? conteoVacio(),
      });
    });
  });

  return {
    clientes: ordenar(filas.cliente),
    proveedores: ordenar(filas.proveedor),
    revisadas,
    canceladas,
    totales,
    sinEmpresa,
    sinPapel,
  };
};

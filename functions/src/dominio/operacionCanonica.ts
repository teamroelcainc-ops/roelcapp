// ⚠ ARCHIVO GENERADO por scripts/sincronizar-dominio.mjs — NO EDITAR.
// Fuente: src/shared/dominio (se edita allá y se vuelve a copiar).
// src/shared/dominio/operacionCanonica.ts
// ---------------------------------------------------------------------------
// ✅ V00440 (Fase 4) — MODELO CANÓNICO DE UNA OPERACIÓN (lógica PURA).
//
// La base guarda las relaciones mezcladas: `clientePaga` puede traer el ID de la
// empresa o su nombre (registros de AppSheet), la fecha viene en tres formatos,
// los montos a veces son texto y el "estado" se deduce del ID o del nombre del
// status. Este archivo calcula, a partir del documento tal como está, los campos
// CANÓNICOS que se escriben JUNTO a los legados (no los reemplazan todavía):
//
//   fechaServicioISO · clientePagaId · clienteMercanciaId · provServiciosId ·
//   proveedorUnidadId · origenId · destinoId · convenioClienteId · convenioProveedorId · statusId · unidadId · operadorId ·
//   cargaId · aduanaId · monedaCliente/monedaProveedor ('USD'|'MXN') ·
//   *Centavos (enteros) · estadoGrupo · empresasIds · porFacturarCliente/Proveedor ·
//   nominaId · esPrueba · esquemaVersion
//
// Lo usan: el trigger del servidor (functions/src/canonico.ts), crearOperacion,
// la migración (functions/scripts/migrarEsquemaV2.ts) y la web (estadoGrupoDe).
//
// Regla de resolución de una relación (la MISMA en el trigger y en la migración,
// para que nunca se contradigan):
//   · un valor que es un ID existente, o que tiene forma de ID, se guarda TAL CUAL
//     (la migración avisa si no existe o si es la llave de AppSheet de otro doc).
//   · con índice (solo la migración), un nombre → su ID si es ÚNICO; homónimos = "ambiguo".
//   · si no se puede resolver, el campo canónico NO se calcula (no se toca lo que
//     ya tenga el documento) y se reporta en `pendientes`.
// ---------------------------------------------------------------------------
import { ESQUEMA_OPERACION_VERSION, STATUS_CANCELADO, STATUS_COMPLETADOS } from './constantes.js';
import type { EstadoGrupo } from './constantes.js';
import { aFechaServicioISO } from './fechas.js';
import { monedaCanonica } from './moneda.js';
import type { Moneda } from './moneda.js';
import { aCentavos, aNumero } from './numeros.js';
import { normalizarTexto, pareceId } from './texto.js';

type Datos = Record<string, unknown>;

const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

// ── Operaciones de prueba (V00380) ─────────────────────────────────────────
export const PREFIJO_PRUEBA = 'PR.';

/** Operación de prueba: `esPrueba: true` o referencia con prefijo `PR.`. */
export const esOperacionPrueba = (op: unknown): boolean => {
  if (!op || typeof op !== 'object') return false;
  const o = op as { esPrueba?: unknown; ref?: unknown };
  if (o.esPrueba === true) return true;
  return txt(o.ref).toUpperCase().startsWith(PREFIJO_PRUEBA);
};

// ── Estado (activa / completada / falso / cancelada) ───────────────────────
const grupoPorNombre = (n: unknown): EstadoGrupo | null => {
  const t = normalizarTexto(n);
  if (!t) return null;
  if (t.includes('cancel')) return 'cancelada';
  if (t.includes('falso')) return 'falso';
  if (t.includes('complet')) return 'completada';
  return null;
};

/**
 * Grupo de estado de una operación. Misma regla que ya usaban las pantallas:
 *   1) status = Cancelado (ID) → cancelada
 *   2) status = Servicio Completado (cualquiera de sus dos IDs) → completada,
 *      o falso si el nombre del status dice "Falso"
 *   3) si el ID no es final, manda el NOMBRE (primero el del catálogo, luego el
 *      guardado en la operación): cancel… / falso / complet…
 *   4) lo demás → activa
 * `nombreCatalogo` = nombre del status según catalogo_status_servicio (si se tiene).
 */
export const estadoGrupoDe = (op: { status?: unknown; statusNombre?: unknown }, nombreCatalogo?: unknown): EstadoGrupo => {
  const id = txt(op.status);
  if (id === STATUS_CANCELADO) return 'cancelada';
  const porNombre = grupoPorNombre(nombreCatalogo) ?? grupoPorNombre(op.statusNombre);
  if (STATUS_COMPLETADOS.includes(id)) return porNombre === 'falso' ? 'falso' : 'completada';
  return porNombre ?? 'activa';
};

/** Completada o Falso: lo que entra a Completados, Facturación y Nómina. */
export const esGrupoTerminado = (g: EstadoGrupo): boolean => g === 'completada' || g === 'falso';

// ── Facturación ───────────────────────────────────────────────────────────
export const facturadaCliente = (op: Datos): boolean =>
  !!(txt(op.facturaClienteId) || op.facturado === true || txt(op.facturaClienteInvoice));
export const facturadaProveedor = (op: Datos): boolean =>
  !!(txt(op.facturaProveedorId) || op.facturadoProveedor === true || txt(op.facturaProveedorFolio));

/**
 * Facturación de Proveedores solo factura a proveedores EXTERNOS: Fletes, y
 * Logística cuyo proveedor no es Roelca (Transfer y Logística-Roelca son flota
 * propia). Regla por texto heredada de FacturacionProveedoresDashboard: PENDIENTE
 * pasar a IDs de catalogo_tipo_operacion cuando se fijen como constantes.
 */
export const esFacturableProveedor = (op: Datos): boolean => {
  const tipo = normalizarTexto(op.tipoOperacionNombre || op.tipoOperacionId);
  const esFlete = tipo.includes('flete');
  const esLogistica = tipo.includes('logistica');
  const esRoelca = normalizarTexto(op.proveedorUnidadNombre || op.proveedorUnidad).includes('roelca');
  return esFlete || (esLogistica && !esRoelca);
};

// ── Índices para resolver relaciones ──────────────────────────────────────
export interface IndiceIds {
  /** IDs de documento existentes. */
  ids: ReadonlySet<string>;
  /** nombre normalizado → ID (null = varios documentos con ese nombre). */
  porNombre: ReadonlyMap<string, string | null>;
  /** Campo `id` guardado DENTRO del documento (llave de AppSheet) → ID del documento. */
  alias?: ReadonlyMap<string, string>;
}

/** Arma un índice: cada documento con su ID, su llave de AppSheet y los textos por los que se le nombra. */
export const crearIndice = (docs: Iterable<{ id: string; nombres: readonly unknown[]; alias?: unknown }>): IndiceIds => {
  const ids = new Set<string>();
  const porNombre = new Map<string, string | null>();
  const alias = new Map<string, string>();
  for (const d of docs) {
    ids.add(d.id);
    const a = txt(d.alias);
    if (a && a !== d.id) alias.set(a, d.id);
    const vistos = new Set<string>();
    for (const n of d.nombres) {
      const k = normalizarTexto(n);
      if (!k || vistos.has(k)) continue;
      vistos.add(k);
      const previo = porNombre.get(k);
      porNombre.set(k, previo === undefined || previo === d.id ? d.id : null);
    }
  }
  return { ids, porNombre, alias };
};

/** No se pudo calcular el campo (se deja como esté y se reporta). */
export type MotivoPendiente = 'ambiguo' | 'sinCoincidencia' | 'fechaInvalida' | 'fechaFaltante' | 'monedaDesconocida';
/** Se calculó, pero conviene revisarlo (el ID no existe o es una llave de AppSheet). */
export type MotivoAviso = 'idInexistente' | 'aliasAppSheet' | 'fechaRespaldo';
export interface Pendiente { campo: string; valor: string; motivo: MotivoPendiente }
export interface Aviso { campo: string; valor: string; motivo: MotivoAviso; detalle?: string }

type Resolucion =
  | { estado: 'vacio' }
  | { estado: 'ok'; id: string; aviso?: Omit<Aviso, 'campo'> }
  | { estado: 'pendiente'; valor: string; motivo: MotivoPendiente };

/** ¿Tiene forma de ID de documento? Convenios: `CONV-054`, `054` (sin espacios ni " - "). */
const formaDeIdConvenio = (v: string): boolean => !/\s/.test(v) && v.length <= 40;

/**
 * Resuelve una relación revisando los candidatos EN ORDEN (el campo vigente
 * primero): un ID existente, una llave de AppSheet, algo con forma de ID (se
 * conserva tal cual, igual en el trigger y en la migración) o, con índice, un
 * nombre único. El primero que resuelve gana.
 */
const resolver = (candidatos: readonly unknown[], indice: IndiceIds | undefined, formaDeId: (v: string) => boolean = pareceId): Resolucion => {
  const valores = candidatos.map(txt).filter((v) => v && normalizarTexto(v) !== 'n/a');
  if (valores.length === 0) return { estado: 'vacio' };
  let ambiguo: string | null = null;
  for (const v of valores) {
    if (indice?.ids.has(v)) return { estado: 'ok', id: v };
    const alias = indice?.alias?.get(v);
    if (alias) return { estado: 'ok', id: v, aviso: { valor: v, motivo: 'aliasAppSheet', detalle: alias } };
    if (formaDeId(v)) return indice ? { estado: 'ok', id: v, aviso: { valor: v, motivo: 'idInexistente' } } : { estado: 'ok', id: v };
    const porNombre = indice?.porNombre.get(normalizarTexto(v));
    if (typeof porNombre === 'string') return { estado: 'ok', id: porNombre };
    if (porNombre === null && ambiguo === null) ambiguo = v;
  }
  if (ambiguo !== null) return { estado: 'pendiente', valor: ambiguo, motivo: 'ambiguo' };
  return { estado: 'pendiente', valor: valores[0], motivo: 'sinCoincidencia' };
};

// ── Campos canónicos ──────────────────────────────────────────────────────
export interface CamposCanonicos {
  fechaServicioISO: string | null;
  clientePagaId: string | null;
  clienteMercanciaId: string | null;
  provServiciosId: string | null;
  proveedorUnidadId: string | null;
  origenId: string | null;
  destinoId: string | null;
  convenioClienteId: string | null;
  convenioProveedorId: string | null;
  statusId: string | null;
  unidadId: string | null;
  operadorId: string | null;
  cargaId: string | null;
  aduanaId: string | null;
  monedaCliente: Moneda | null;
  monedaProveedor: Moneda | null;
  montoConvenioClienteCentavos: number;
  cargosAdicionalesCentavos: number;
  totalAPagarProvCentavos: number;
  cargosAdicionalesProvCentavos: number;
  sueldoOperadorCentavos: number;
  estadoGrupo: EstadoGrupo;
  empresasIds: string[];
  porFacturarCliente: boolean;
  porFacturarProveedor: boolean;
  nominaId: string | null;
  esPrueba: boolean;
  esquemaVersion: number;
}

/** Nombres de los campos canónicos (para leer, comparar y verificar). */
export const CAMPOS_CANONICOS: readonly (keyof CamposCanonicos)[] = [
  'fechaServicioISO', 'clientePagaId', 'clienteMercanciaId', 'provServiciosId', 'proveedorUnidadId', 'origenId',
  'destinoId', 'convenioClienteId', 'convenioProveedorId', 'statusId', 'unidadId', 'operadorId', 'cargaId', 'aduanaId',
  'monedaCliente', 'monedaProveedor', 'montoConvenioClienteCentavos', 'cargosAdicionalesCentavos', 'totalAPagarProvCentavos',
  'cargosAdicionalesProvCentavos', 'sueldoOperadorCentavos', 'estadoGrupo', 'empresasIds', 'porFacturarCliente',
  'porFacturarProveedor', 'nominaId', 'esPrueba', 'esquemaVersion',
];
const NOMBRES_CANONICOS: ReadonlySet<string> = new Set(CAMPOS_CANONICOS);

export interface ContextoCanonico {
  empresas?: IndiceIds;
  empleados?: IndiceIds;
  unidades?: IndiceIds;
  status?: IndiceIds;
  conveniosCliente?: IndiceIds;
  conveniosProveedor?: IndiceIds;
  cargas?: IndiceIds;
  aduanas?: IndiceIds;
  /** ID de status → nombre en catalogo_status_servicio. */
  nombreStatus?: (id: string) => string | undefined;
  /**
   * Migración: además de los campos de origen, considera (al final) el valor que
   * ya tenga el propio campo canónico — registros viejos traían `unidadId`,
   * `clientePagaId`… con el mismo nombre. El trigger NO lo hace (ese valor lo
   * escribió él mismo); para conservarlo usa `cambiosCanonicos` (functions).
   */
  incluirPropio?: boolean;
}

/**
 * Campos de origen de cada relación canónica, en orden de prioridad. Incluye
 * los nombres que usaban registros viejos; si uno coincide con el nombre del
 * campo canónico, solo cuenta con `incluirPropio`.
 */
export const FUENTES_CANONICAS: Readonly<Record<string, readonly string[]>> = {
  clientePagaId: ['clientePaga', 'clienteId', 'clientePagaId'],
  clienteMercanciaId: ['clienteMercancia', 'clienteMercanciaId'],
  provServiciosId: ['provServicios', 'provServiciosId'],
  proveedorUnidadId: ['proveedorUnidad', 'proveedorUnidadId'],
  origenId: ['origen', 'origenId'],
  destinoId: ['destino', 'destinoId'],
  convenioClienteId: ['convenio', 'convenioId', 'idConvenio', 'convenioDetalleId', 'convenioClienteId'],
  convenioProveedorId: ['convenioProveedor', 'convenioProveedorId'],
  statusId: ['status', 'statusId'],
  unidadId: ['unidad', 'unidadId'],
  operadorId: ['operador', 'operadorId'],
  cargaId: ['carga', 'cargaId'],
  aduanaId: ['aduanaNombre', 'aduana', 'aduanaId'],
};

/** Campos de origen REALES (sin ningún nombre canónico): para saber si cambió el dato del usuario. */
export const fuentesReales = (campo: string): string[] => (FUENTES_CANONICAS[campo] ?? []).filter((f) => !NOMBRES_CANONICOS.has(f));

/** Papel de cada empresa en la operación → su campo canónico (ficha de Empresas, Fase 7.6). */
export const ROLES_EMPRESA: readonly [string, keyof CamposCanonicos][] = [
  ['clientePaga', 'clientePagaId'], ['clienteMercancia', 'clienteMercanciaId'], ['provServicios', 'provServiciosId'],
  ['proveedorUnidad', 'proveedorUnidadId'], ['origen', 'origenId'], ['destino', 'destinoId'],
];

/** empresasIds a partir de los IDs por papel (valores finales del documento). */
export const empresasDeRoles = (valores: Datos): string[] => {
  const s = new Set<string>();
  for (const [, campo] of ROLES_EMPRESA) { const v = txt(valores[campo]); if (v) s.add(v); }
  return Array.from(s).sort();
};

const MONTOS_CENTAVOS: readonly [string, keyof CamposCanonicos][] = [
  ['montoConvenioCliente', 'montoConvenioClienteCentavos'],
  ['cargosAdicionales', 'cargosAdicionalesCentavos'],
  ['totalAPagarProv', 'totalAPagarProvCentavos'],
  ['cargosAdicionalesProv', 'cargosAdicionalesProvCentavos'],
  ['sueldoOperador', 'sueldoOperadorCentavos'],
];

const ES_ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface ResultadoCanonico {
  /** Solo los campos que se pudieron calcular (los demás no se tocan). */
  campos: Partial<CamposCanonicos>;
  /** Campos que no se pudieron calcular (se dejan como estén). */
  pendientes: Pendiente[];
  /** Campos calculados que conviene revisar (ID inexistente, llave de AppSheet). */
  avisos: Aviso[];
}

/** Calcula los campos canónicos de una operación (documento crudo). */
export const camposCanonicos = (op: Datos, ctx: ContextoCanonico = {}): ResultadoCanonico => {
  const campos: Partial<CamposCanonicos> = {};
  const salida = campos as Record<string, unknown>;
  const pendientes: Pendiente[] = [];
  const avisos: Aviso[] = [];
  const fuentes = (campo: string): unknown[] => (ctx.incluirPropio ? FUENTES_CANONICAS[campo] ?? [] : fuentesReales(campo)).map((f) => op[f]);
  const poner = (campo: keyof CamposCanonicos, r: Resolucion): void => {
    if (r.estado === 'ok') {
      salida[campo] = r.id;
      if (r.aviso) avisos.push({ campo, ...r.aviso });
    } else if (r.estado === 'vacio') salida[campo] = null;
    else pendientes.push({ campo, valor: r.valor, motivo: r.motivo });
  };

  // Fecha de servicio (misma regla que "⚡ Acelerar búsquedas"). Si no se reconoce,
  // se conserva un fechaServicioISO válido que ya tenga el documento.
  const iso = aFechaServicioISO(op.fechaServicio);
  if (iso) campos.fechaServicioISO = iso;
  else if (!ES_ISO.test(txt(op.fechaServicioISO))) {
    campos.fechaServicioISO = null;
    const bruto = txt(op.fechaServicio);
    pendientes.push({ campo: 'fechaServicioISO', valor: bruto, motivo: bruto ? 'fechaInvalida' : 'fechaFaltante' });
  }

  // Relaciones.
  for (const [, campo] of ROLES_EMPRESA) poner(campo, resolver(fuentes(campo), ctx.empresas));
  poner('convenioClienteId', resolver(fuentes('convenioClienteId'), ctx.conveniosCliente, formaDeIdConvenio));
  poner('convenioProveedorId', resolver(fuentes('convenioProveedorId'), ctx.conveniosProveedor, formaDeIdConvenio));
  const rStatus = resolver(fuentes('statusId'), ctx.status);
  poner('statusId', rStatus);
  poner('unidadId', resolver(fuentes('unidadId'), ctx.unidades));
  poner('operadorId', resolver(fuentes('operadorId'), ctx.empleados));
  // Carga/Vacía y Aduana se guardan por NOMBRE: sin su catálogo no se calculan.
  if (ctx.cargas) poner('cargaId', resolver(fuentes('cargaId'), ctx.cargas));
  if (ctx.aduanas) poner('aduanaId', resolver(fuentes('aduanaId'), ctx.aduanas));

  // Todas las empresas que participan (array-contains): las de cada papel; si un
  // papel no se resolvió, cuenta el ID que ya tenía el documento para ese papel.
  campos.empresasIds = empresasDeRoles({ ...op, ...campos });

  // Monedas de facturación (misma regla que las pestañas de moneda de Facturación).
  const monCli = monedaCanonica(op.facturadoEnCobrar) ?? monedaCanonica(op.monedaCobroNombre);
  const monProv = monedaCanonica(op.facturadoEnUnidad) ?? monedaCanonica(op.monedaUnidadNombre);
  campos.monedaCliente = monCli;
  campos.monedaProveedor = monProv;
  if (!monCli && aNumero(op.montoConvenioCliente) > 0) pendientes.push({ campo: 'monedaCliente', valor: txt(op.facturadoEnCobrar || op.monedaCobroNombre), motivo: 'monedaDesconocida' });
  if (!monProv && aNumero(op.totalAPagarProv) > 0) pendientes.push({ campo: 'monedaProveedor', valor: txt(op.facturadoEnUnidad || op.monedaUnidadNombre), motivo: 'monedaDesconocida' });

  // Montos en centavos enteros.
  for (const [origen, destino] of MONTOS_CENTAVOS) salida[destino] = aCentavos(op[origen]);

  // Estado y pendientes de facturar, con el status que queda en el documento: el
  // resuelto o, si no se pudo resolver, el statusId que ya tenía (así el trigger y
  // la migración calculan lo mismo para registros con el status solo en statusId).
  const statusFinal = rStatus.estado === 'ok' ? rStatus.id : txt(op.statusId) || txt(op.status);
  Object.assign(campos, estadoYFacturacion(op, statusFinal, ctx));

  const nomina = txt(op.referenciaNominaId);
  campos.nominaId = nomina || null;
  campos.esquemaVersion = ESQUEMA_OPERACION_VERSION;
  return { campos, pendientes, avisos };
};

/**
 * estadoGrupo, esPrueba y porFacturar* a partir del status FINAL de la operación
 * (el trigger lo vuelve a llamar si conservó un statusId que no pudo resolver).
 */
export const estadoYFacturacion = (op: Datos, statusId: string, ctx: Pick<ContextoCanonico, 'nombreStatus'> = {}): Pick<CamposCanonicos, 'estadoGrupo' | 'esPrueba' | 'porFacturarCliente' | 'porFacturarProveedor'> => {
  const grupo = estadoGrupoDe({ status: statusId, statusNombre: op.statusNombre }, statusId ? ctx.nombreStatus?.(statusId) : undefined);
  const prueba = esOperacionPrueba(op);
  const terminada = esGrupoTerminado(grupo);
  return {
    estadoGrupo: grupo,
    esPrueba: prueba,
    // Mismas reglas que Facturación Clientes / Proveedores.
    porFacturarCliente: !prueba && terminada && !facturadaCliente(op),
    porFacturarProveedor: !prueba && terminada && esFacturableProveedor(op) && !facturadaProveedor(op),
  };
};

const iguales = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => x === b[i]);
  }
  // null y ausente son lo mismo para un campo canónico.
  return (a ?? null) === (b ?? null);
};

/**
 * ✅ V00448: campos que se escriben aunque valgan null. Una consulta con
 * orderBy('fechaServicioISO') DEJA FUERA los documentos que no tienen el campo; con
 * `null` explícito sí salen (al final, en orden descendente). Antes una operación sin
 * fecha de servicio no aparecía en las listas canónicas (activas, por empresa…).
 */
const SIEMPRE_ESCRITOS: ReadonlySet<string> = new Set(['fechaServicioISO']);

/** Solo los campos canónicos que cambian respecto al documento actual (vacío = no escribir). */
export const diferenciasCanonicas = (actual: Datos, calculados: Partial<CamposCanonicos>): Partial<CamposCanonicos> => {
  const salida: Partial<CamposCanonicos> = {};
  for (const [k, v] of Object.entries(calculados) as [keyof CamposCanonicos, unknown][]) {
    const falta = SIEMPRE_ESCRITOS.has(k) && actual[k] === undefined;
    if (falta || !iguales(actual[k], v)) (salida as Record<string, unknown>)[k] = v;
  }
  return salida;
};

// ── Carga/Vacía, Aduana y Expo/Impo desde el convenio (regla V00258) ──────
/** Catálogo pequeño por nombre: id → nombre, nombre normalizado → nombre. */
export interface CatalogoNombres {
  porId: ReadonlyMap<string, string>;
  porNorm: ReadonlyMap<string, string>;
}

const ALIAS_CV: Record<string, string> = { cargada: 'cargado', vacia: 'vacio' };
const claveCV = (seg: string): string => ALIAS_CV[seg] || seg;

/**
 * "EL CONVENIO MANDA" (V00258): la Carga/Vacía y la Aduana se toman de los
 * segmentos del nombre del convenio ("Transfer - Cargado - Colombia") contra los
 * catálogos; el campo directo es respaldo. Expo/Impo solo si la operación no trae
 * uno válido. Devuelve SOLO lo que cambia. (Antes vivía en functions/src/relacional.ts.)
 * PENDIENTE (Fase 6.3): guardar cargaId/aduanaId en el detalle del convenio y
 * dejar de partir el nombre.
 */
export const derivarDesdeConvenio = (x: Datos, catCV: CatalogoNombres, catAdu: CatalogoNombres): Record<string, string> => {
  const cambios: Record<string, string> = {};
  const conv = txt(x.convenioNombre);
  const segmentos = conv.split(' - ').map((s) => normalizarTexto(s)).filter(Boolean);

  let cvFinal = '';
  for (let i = segmentos.length - 1; i >= 0; i--) {
    const m = catCV.porNorm.get(claveCV(segmentos[i]));
    if (m) { cvFinal = m; break; }
  }
  if (!cvFinal) {
    const bruto = txt(x.carga || x.estadoCarga || x.cargaVacia || x.cargadoVacio);
    if (bruto && normalizarTexto(bruto) !== 'n/a') cvFinal = catCV.porId.get(bruto) || catCV.porNorm.get(claveCV(normalizarTexto(bruto))) || '';
  }
  if (cvFinal && String(x.carga || '') !== cvFinal) cambios.carga = cvFinal;

  let aduFinal = '';
  for (let i = segmentos.length - 1; i >= 0; i--) {
    const m = catAdu.porNorm.get(segmentos[i]);
    if (m) { aduFinal = m; break; }
  }
  if (!aduFinal) {
    const bruto = txt(x.aduanaNombre || x.aduana || x.aduanaId);
    if (bruto) aduFinal = catAdu.porId.get(bruto) || catAdu.porNorm.get(normalizarTexto(bruto)) || '';
  }
  if (aduFinal && String(x.aduanaNombre || '') !== aduFinal) cambios.aduanaNombre = aduFinal;

  const trafNorm = normalizarTexto(x.trafico);
  const trafValido = trafNorm.includes('export') || trafNorm.includes('import') || trafNorm.includes('movimiento');
  if (!trafValido) {
    const texto = normalizarTexto(`${conv} ${txt(x.tipoOperacionNombre || x.tipoServicioNombre || x.tipoServicio)}`);
    const trafFinal = texto.includes('export') ? 'Exportación' : texto.includes('import') ? 'Importación' : texto.includes('movimiento') ? 'Movimiento' : '';
    if (trafFinal) cambios.trafico = trafFinal;
  }
  return cambios;
};

// ── Números del formulario (Fase 4.6) ─────────────────────────────────────
/** Campos numéricos de la operación que el formulario a veces guardaba como texto. */
export const CAMPOS_NUMERICOS_OPERACION = [
  'montoConvenioCliente', 'cargosAdicionales', 'totalAPagarProv', 'cargosAdicionalesProv', 'sueldoOperador',
  'sueldoExtra', 'sueldoTotal', 'combustible', 'combustibleExtra', 'combustibleTotal', 'tipoCambioAprobado',
  'tipoCambioDia', 'montoManifiesto', 'pesoKg', 'kilometrajeEstimado', 'cantEntrys', 'puenteMonto',
] as const;

/**
 * Convierte a number los campos numéricos que vienen como texto ('1,250.50' → 1250.5).
 * Un texto vacío se deja igual (vacío ≠ 0) y un texto que no es número también.
 */
export const normalizarNumerosOperacion = <T extends Datos>(datos: T): T => {
  const salida: Datos = { ...datos };
  for (const campo of CAMPOS_NUMERICOS_OPERACION) {
    const v = salida[campo];
    if (typeof v !== 'string') continue;
    const limpio = v.replace(/[$,\s]/g, '');
    if (!limpio) continue;
    const n = Number(limpio);
    if (Number.isFinite(n)) salida[campo] = n;
  }
  return salida as T;
};

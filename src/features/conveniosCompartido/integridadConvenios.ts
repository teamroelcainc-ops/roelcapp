// src/features/conveniosCompartido/integridadConvenios.ts
// ---------------------------------------------------------------------------
// ✅ V00429 — INTEGRIDAD RELACIONAL DE LOS CONVENIOS (regla de Jesús: "bajo
//   ningún concepto" un convenio puede quedar sin CLIENTE/PROVEEDOR, sin
//   TARIFA o sin la LLAVE FORÁNEA hacia su tarifario).
//
//   Cada detalle de convenio (convenios_*_detalles) DEBE tener:
//     · tarifarioId   → FK al tarifario padre (tarifario_clientes / _proveedores)
//     · convenioId    → convenio maestro VIVO de la misma empresa
//     · clienteId / proveedorId (+ nombre) → la empresa, escrita en el propio
//                       detalle para que nunca dependa solo del maestro
//     · tipoConvenioId (+ tipoConvenioNombre) → tarifa del catálogo
//   y su línea en tarifas[] del tarifario (relación 1:1 por NÚMERO de
//   consecutivo: CONV-173 = 173).
//
//   asegurarIntegridad() resuelve todo lo que falte, del criterio más fuerte al
//   más débil, y JAMÁS inventa números de convenio ni borra nada:
//     tarifario: FK válida → línea con el mismo # → único tarifario del
//                convenio maestro → tarifario de la empresa (o se crea uno)
//     maestro:   el del tarifario si está vivo → el de la empresa → se crea
//     tarifa:    la del detalle → la de su línea → por nombre en el catálogo
//   Lo que no se pueda resolver con certeza se REPORTA.
// ---------------------------------------------------------------------------
import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../../config/firebase';
import { claveConsecutivo } from '../../utils/claveConsecutivo';
import { reservarConsecutivosTarifario, reservarConsecutivosTarifarioProveedor } from '../conveniosDetalles/consecutivos';

export type TipoRel = 'clientes' | 'proveedores';
type D = Record<string, unknown>;

interface CfgRel { maestros: string; detalles: string; tarifarios: string; campoId: string; campoNombre: string; etiqueta: string }
export const CFG_REL: Record<TipoRel, CfgRel> = {
  clientes:    { maestros: 'convenios_clientes',    detalles: 'convenios_clientes_detalles',    tarifarios: 'tarifario_clientes',    campoId: 'clienteId',   campoNombre: 'clienteNombre',   etiqueta: 'cliente' },
  proveedores: { maestros: 'convenios_proveedores', detalles: 'convenios_proveedores_detalles', tarifarios: 'tarifario_proveedores', campoId: 'proveedorId', campoNombre: 'proveedorNombre', etiqueta: 'proveedor' },
};

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

const norm = (v: unknown): string => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const s = (v: unknown): string => String(v ?? '').trim();
const pad3 = (n: number): string => String(n).padStart(3, '0');
const esUSD = (m: unknown): boolean => { const t = norm(m).toUpperCase(); return t.includes('USD') || t.includes('DOLAR') || s(m) === ID_USD; };
const monedaDetalle = (m: unknown): string => (s(m) ? (esUSD(m) ? 'Dólares' : 'Pesos') : '');
const monedaLinea = (m: unknown): string => (s(m) ? (esUSD(m) ? 'USD' : 'MXN') : '');

/** Empresa dueña de un convenio maestro (todas las variantes de nombre de campo). */
export const entidadDeMaestro = (tipo: TipoRel, c: D | undefined): string => {
  if (!c) return '';
  return tipo === 'clientes'
    ? s(c.clienteId ?? c.cliente ?? c.id_cliente ?? c.clientePaga ?? c.empresaId ?? c.empresa)
    : s(c.proveedorId ?? c.proveedor ?? c.id_proveedor ?? c.empresaId ?? c.empresa);
};

/** Campos obligatorios que le faltan a un detalle (para bloquear guardados y para avisos). */
export const faltantesDetalle = (tipo: TipoRel, det: D): string[] => {
  const cfg = CFG_REL[tipo];
  const f: string[] = [];
  if (!s(det.tarifarioId)) f.push('tarifario (llave foránea)');
  if (!s(det.convenioId)) f.push('convenio maestro');
  if (!s(det[cfg.campoId])) f.push(cfg.etiqueta);
  if (!s(det.tipoConvenioId)) f.push('tarifa del catálogo');
  return f;
};

export interface ReporteIntegridad {
  revisados: number;
  fkEscritas: number;
  entidadEscrita: number;
  maestroReapuntado: number;
  tarifaResuelta: number;
  lineasCreadas: number;
  lineasCompletadas: number;
  detallesCreados: number;
  maestrosCreados: number;
  tarifariosCreados: number;
  tarifariosReligados: number;
  sinTarifario: string[];
  sinEntidad: string[];
  sinTarifa: string[];
}

export const resumenReporte = (r: ReporteIntegridad): string => {
  const listar = (a: string[]) => (a.length === 0 ? 'ninguno ✅' : `${a.length} → ${a.slice(0, 15).join(', ')}${a.length > 15 ? '…' : ''}`);
  return [
    `· Convenios revisados: ${r.revisados}`,
    `· Llave foránea (tarifario) escrita: ${r.fkEscritas}`,
    `· Cliente/proveedor escrito en el convenio: ${r.entidadEscrita}`,
    `· Convenios reapuntados a su convenio maestro vivo: ${r.maestroReapuntado}`,
    `· Tarifas del catálogo resueltas: ${r.tarifaResuelta}`,
    `· Líneas del tarifario reconstruidas: ${r.lineasCreadas} (completadas: ${r.lineasCompletadas})`,
    `· Convenios reconstruidos desde líneas: ${r.detallesCreados}`,
    `· Tarifarios religados a su maestro: ${r.tarifariosReligados} · maestros creados: ${r.maestrosCreados} · tarifarios creados: ${r.tarifariosCreados}`,
    '',
    'PENDIENTES (no se pudieron resolver con certeza — corrígelos con el ✏):',
    `· Sin tarifario identificable: ${listar(r.sinTarifario)}`,
    `· Tarifario sin ${'cliente/proveedor'}: ${listar(r.sinEntidad)}`,
    `· Sin tarifa del catálogo: ${listar(r.sinTarifa)}`,
  ].join('\n');
};

export const huboCambios = (r: ReporteIntegridad): boolean =>
  r.fkEscritas + r.entidadEscrita + r.maestroReapuntado + r.tarifaResuelta + r.lineasCreadas + r.lineasCompletadas
  + r.detallesCreados + r.maestrosCreados + r.tarifariosCreados + r.tarifariosReligados > 0;

/**
 * Revisa y REPARA la relación de los convenios de `tipo`.
 * @param opciones.soloIds  revisa solo esos detalles (y no reconstruye detalles
 *                          desde líneas) — para llamarlo justo después de crear uno.
 */
export const asegurarIntegridad = async (tipo: TipoRel, opciones?: { soloIds?: string[] }): Promise<ReporteIntegridad> => {
  const cfg = CFG_REL[tipo];
  const rep: ReporteIntegridad = {
    revisados: 0, fkEscritas: 0, entidadEscrita: 0, maestroReapuntado: 0, tarifaResuelta: 0, lineasCreadas: 0, lineasCompletadas: 0,
    detallesCreados: 0, maestrosCreados: 0, tarifariosCreados: 0, tarifariosReligados: 0, sinTarifario: [], sinEntidad: [], sinTarifa: [],
  };
  const [snapTar, snapMae, snapDet, snapCat] = await Promise.all([
    getDocs(collection(db, cfg.tarifarios)),
    getDocs(collection(db, cfg.maestros)),
    getDocs(collection(db, cfg.detalles)),
    getDocs(collection(db, 'catalogo_tarifas_referencia')),
  ]);

  // ── Catálogo de tarifas: id → nombre, y nombre → id (solo si es único) ──
  const catNombre = new Map<string, string>();
  const catPorNombre = new Map<string, string>();
  const nombresRepetidos = new Set<string>();
  snapCat.docs.forEach((d) => {
    const nombre = s((d.data() as D).descripcion);
    catNombre.set(d.id, nombre);
    const k = norm(nombre);
    if (!k) return;
    if (catPorNombre.has(k)) nombresRepetidos.add(k); else catPorNombre.set(k, d.id);
  });
  nombresRepetidos.forEach((k) => catPorNombre.delete(k));
  const tarifaPorNombre = (nombre: unknown): string => catPorNombre.get(norm(nombre)) || '';

  // ── Maestros ──
  const maestros = new Map<string, D>();
  const duenio = new Map<string, string>();
  snapMae.docs.forEach((d) => { const x = d.data() as D; maestros.set(d.id, x); duenio.set(d.id, entidadDeMaestro(tipo, x)); });

  // ── Tarifarios ──
  const tarifarios = snapTar.docs.map((d) => ({ id: d.id, data: { ...(d.data() as D) } }));
  type Tar = (typeof tarifarios)[number];
  const tarPorId = new Map<string, Tar>();
  tarifarios.forEach((t) => { tarPorId.set(t.id, t); const c = s(t.data.consecutivo); if (c) tarPorId.set(c, t); });
  const lineasDe = (t: Tar): D[] => (Array.isArray(t.data.tarifas) ? (t.data.tarifas as D[]) : []);
  const vigente = (t: Tar) => !['Cancelado', 'Inactivo'].includes(s(t.data.status));
  const tarPorLinea = new Map<string, Tar>();
  // primero los vigentes: si un # vive en dos tarifarios manda el vigente
  [...tarifarios].sort((a, b) => Number(vigente(b)) - Number(vigente(a))).forEach((t) => {
    lineasDe(t).forEach((l) => { const k = claveConsecutivo(l?.consecutivo); if (k && !tarPorLinea.has(k)) tarPorLinea.set(k, t); });
  });
  const tarsDeEntidad = (e: string): Tar[] => tarifarios.filter((t) => s(t.data[cfg.campoId]) === e);
  const tarsCambiados = new Set<string>();

  // ── Convenio maestro VIVO del tarifario (se religa o se crea si hace falta) ──
  const maestroMemo = new Map<string, string>();
  const asegurarMaestro = async (t: Tar): Promise<string> => {
    if (maestroMemo.has(t.id)) return maestroMemo.get(t.id)!;
    const e = s(t.data[cfg.campoId]);
    const actual = s(t.data.convenioId);
    const dActual = duenio.get(actual);
    let elegido = '';
    if (actual && dActual !== undefined && (dActual === e || dActual === '')) elegido = actual;
    if (!elegido) {
      const deLaEntidad = Array.from(maestros.entries()).filter(([id]) => duenio.get(id) === e);
      const propio = deLaEntidad.find(([, x]) => s(x.creadoDesdeTarifario) === t.id);
      const menor = [...deLaEntidad].sort((a, b) => (Number(claveConsecutivo(a[1].numeroConvenio)) || 9e9) - (Number(claveConsecutivo(b[1].numeroConvenio)) || 9e9))[0];
      elegido = (propio || menor)?.[0] || '';
    }
    if (!elegido) {
      const maxNum = Array.from(maestros.values()).reduce((m, x) => Math.max(m, Number(claveConsecutivo(x.numeroConvenio)) || 0), 0);
      const ref = doc(collection(db, cfg.maestros));
      const nuevo: D = {
        numeroConvenio: pad3(maxNum + 1),
        [cfg.campoId]: e,
        [cfg.campoNombre]: s(t.data[cfg.campoNombre]),
        monedaId: esUSD(t.data.moneda) ? ID_USD : ID_MXN,
        monedaNombre: esUSD(t.data.moneda) ? 'Dólares' : 'Pesos',
        fechaConvenio: s(t.data.fecha) || new Date().toISOString().slice(0, 10),
        fechaVencimiento: s(t.data.fechaVencimiento) || `${new Date().getFullYear()}-12-31`,
        creadoDesdeTarifario: t.id,
        creadoPorIntegridad: true,
      };
      await setDoc(ref, nuevo);
      maestros.set(ref.id, nuevo);
      duenio.set(ref.id, e);
      elegido = ref.id;
      rep.maestrosCreados += 1;
    }
    if (elegido !== actual) {
      t.data.convenioId = elegido;
      t.data.numeroConvenio = s(maestros.get(elegido)?.numeroConvenio);
      tarsCambiados.add(t.id);
      rep.tarifariosReligados += 1;
    }
    maestroMemo.set(t.id, elegido);
    return elegido;
  };

  // ── Tarifario para un detalle huérfano de una empresa conocida ──
  const tarifarioDeEntidad = async (e: string, convenioId: string, nombreEnt: string): Promise<Tar | undefined> => {
    const propios = tarsDeEntidad(e);
    const vig = propios.filter(vigente);
    const base = vig.length > 0 ? vig : propios;
    if (base.length > 0) {
      return base.find((t) => s(t.data.convenioId) === convenioId)
        || [...base].sort((a, b) => (Number(claveConsecutivo(b.data.consecutivo)) || 0) - (Number(claveConsecutivo(a.data.consecutivo)) || 0))[0];
    }
    // La empresa no tiene NINGÚN tarifario: se crea (aprobado, sin documento obligatorio).
    const [cons] = tipo === 'clientes' ? await reservarConsecutivosTarifario(1) : await reservarConsecutivosTarifarioProveedor(1);
    const maestro = maestros.get(convenioId);
    const data: D = {
      consecutivo: cons,
      fecha: new Date().toISOString().slice(0, 10),
      fechaVencimiento: `${new Date().getFullYear()}-12-31`,
      [cfg.campoId]: e,
      [cfg.campoNombre]: nombreEnt || s(maestro?.[cfg.campoNombre]),
      moneda: esUSD(maestro?.monedaId ?? maestro?.monedaNombre) ? 'USD' : 'MXN',
      status: 'Aprobado',
      tarifas: [],
      convenioId: convenioId && duenio.get(convenioId) === e ? convenioId : '',
      docObligatorio: false,
      creadoPorIntegridad: true,
      createdAt: new Date().toISOString(),
    };
    await setDoc(doc(db, cfg.tarifarios, cons), data);
    const t: Tar = { id: cons, data };
    tarifarios.push(t);
    tarPorId.set(cons, t);
    rep.tarifariosCreados += 1;
    return t;
  };

  // ── Detalles ──
  const detalles = snapDet.docs.map((d) => ({ id: d.id, data: d.data() as D })).filter((d) => d.data._eliminado !== true);
  const soloIds = opciones?.soloIds ? new Set(opciones.soloIds.map(String)) : null;
  const clavesConDetalle = new Set<string>();
  detalles.forEach((d) => { const k = claveConsecutivo(d.data.consecutivo || d.id); if (k) clavesConDetalle.add(k); });
  const cambiosDet = new Map<string, D>();

  for (const det of detalles) {
    if (soloIds && !soloIds.has(det.id)) continue;
    rep.revisados += 1;
    const x = det.data;
    const etiqueta = s(x.consecutivo) || det.id;
    const k = claveConsecutivo(x.consecutivo || det.id);
    // 1) TARIFARIO padre
    const e0 = s(x[cfg.campoId]) || duenio.get(s(x.convenioId)) || ''; // empresa que el convenio YA declara
    const porFk = tarPorId.get(s(x.tarifarioId));
    let t = porFk; // la FK válida manda
    if (!t && k) t = tarPorLinea.get(k);
    if (!t && s(x.convenioId)) {
      const delMaestro = tarifarios.filter((tt) => s(tt.data.convenioId) === s(x.convenioId));
      if (delMaestro.length === 1) t = delMaestro[0];
    }
    // inferido pero de OTRA empresa (número repetido de datos viejos): se busca el de su empresa
    if (t && t !== porFk && e0 && s(t.data[cfg.campoId]) && s(t.data[cfg.campoId]) !== e0) t = undefined;
    if (!t && e0) t = await tarifarioDeEntidad(e0, s(x.convenioId), s(x[cfg.campoNombre]));
    if (!t) { rep.sinTarifario.push(etiqueta); continue; }
    const e = s(t.data[cfg.campoId]);
    if (!e) { rep.sinEntidad.push(`${etiqueta} (${s(t.data.consecutivo) || t.id})`); continue; }

    const upd: D = {};
    // 2) LLAVE FORÁNEA
    if (s(x.tarifarioId) !== t.id) { upd.tarifarioId = t.id; rep.fkEscritas += 1; }
    // 3) CONVENIO MAESTRO vivo de la misma empresa
    const convId = await asegurarMaestro(t);
    const dDet = duenio.get(s(x.convenioId));
    if (!s(x.convenioId) || dDet === undefined || (dDet !== '' && dDet !== e)) { upd.convenioId = convId; rep.maestroReapuntado += 1; }
    // 4) EMPRESA escrita en el propio convenio
    const nombreEnt = s(t.data[cfg.campoNombre]);
    if (s(x[cfg.campoId]) !== e || (nombreEnt && s(x[cfg.campoNombre]) !== nombreEnt)) {
      upd[cfg.campoId] = e;
      if (nombreEnt) upd[cfg.campoNombre] = nombreEnt;
      if (s(x[cfg.campoId]) !== e) rep.entidadEscrita += 1;
    }
    // 5) LÍNEA del tarifario
    const ls = lineasDe(t);
    let linea = k ? ls.find((l) => claveConsecutivo(l?.consecutivo) === k) : undefined;
    // 6) TARIFA del catálogo
    let tarifaId = s(x.tipoConvenioId);
    if (!catNombre.has(tarifaId)) {
      const deLinea = s(linea?.tarifaReferenciaId);
      const cand = catNombre.has(deLinea) ? deLinea : (tarifaPorNombre(x.tipoConvenioNombre) || tarifaPorNombre(linea?.descripcion));
      if (cand) { upd.tipoConvenioId = cand; tarifaId = cand; rep.tarifaResuelta += 1; }
    }
    const nombreTarifa = s(x.tipoConvenioNombre) || s(linea?.descripcion) || s(catNombre.get(tarifaId));
    if (!s(x.tipoConvenioNombre) && nombreTarifa) upd.tipoConvenioNombre = nombreTarifa;
    if (!catNombre.has(tarifaId)) rep.sinTarifa.push(etiqueta);
    // 7) la línea existe y está completa
    if (!linea) {
      linea = {
        tarifaReferenciaId: catNombre.has(tarifaId) ? tarifaId : '',
        descripcion: nombreTarifa,
        clave: '',
        origen: s(x.origenNombre || x.origen),
        destino: s(x.destinoNombre || x.destino),
        costosSugeridos: [],
        tarifa: Number(x.tarifa) || 0,
        cotizadoEn: monedaLinea(x.moneda) || monedaLinea(t.data.moneda),
        status: s(x.status) || 'Aprobado',
        consecutivo: s(x.consecutivo) || det.id,
        ...(Array.isArray(x.montos) && (x.montos as unknown[]).length > 1 ? { montos: (x.montos as unknown[]).map(Number) } : {}),
      };
      t.data.tarifas = [...ls, linea];
      tarsCambiados.add(t.id);
      if (k) tarPorLinea.set(k, t);
      rep.lineasCreadas += 1;
    } else {
      let completada = false;
      const nuevaLinea: D = { ...linea };
      if (!s(linea.tarifaReferenciaId) && catNombre.has(tarifaId)) { nuevaLinea.tarifaReferenciaId = tarifaId; completada = true; }
      if (!s(linea.descripcion) && nombreTarifa) { nuevaLinea.descripcion = nombreTarifa; completada = true; }
      if (completada) {
        t.data.tarifas = ls.map((l) => (l === linea ? nuevaLinea : l));
        tarsCambiados.add(t.id);
        rep.lineasCompletadas += 1;
      }
    }
    if (Object.keys(upd).length > 0) cambiosDet.set(det.id, upd);
  }

  // 8) LÍNEAS con # pero SIN convenio → el convenio se reconstruye con SU número
  if (!soloIds) {
    for (const t of tarifarios) {
      const e = s(t.data[cfg.campoId]);
      if (!e) continue;
      for (const l of lineasDe(t)) {
        const cc = s(l?.consecutivo);
        const k = claveConsecutivo(cc);
        if (!cc || !k || clavesConDetalle.has(k)) continue;
        const convId = await asegurarMaestro(t);
        let tarifaId = s(l.tarifaReferenciaId);
        if (!catNombre.has(tarifaId)) tarifaId = tarifaPorNombre(l.descripcion);
        await setDoc(doc(db, cfg.detalles, cc), {
          convenioId: convId,
          tarifarioId: t.id,
          [cfg.campoId]: e,
          [cfg.campoNombre]: s(t.data[cfg.campoNombre]),
          tipoConvenioId: tarifaId,
          tipoConvenioNombre: s(l.descripcion) || s(catNombre.get(tarifaId)),
          tarifa: Number(l.tarifa) || 0,
          moneda: monedaDetalle(l.cotizadoEn || t.data.moneda),
          status: s(l.status) || 'Aprobado',
          consecutivo: cc,
          origenNombre: s(l.origen),
          destinoNombre: s(l.destino),
          ...(Array.isArray(l.montos) && (l.montos as unknown[]).length > 1 ? { montos: (l.montos as unknown[]).map(Number) } : {}),
        });
        clavesConDetalle.add(k);
        rep.detallesCreados += 1;
        if (!tarifaId) rep.sinTarifa.push(cc);
      }
    }
  }

  // 9) Escritura por lotes (≤ 450)
  const escrituras: { col: string; id: string; data: D }[] = [];
  cambiosDet.forEach((data, id) => escrituras.push({ col: cfg.detalles, id, data }));
  tarsCambiados.forEach((id) => {
    const t = tarPorId.get(id);
    if (t) escrituras.push({ col: cfg.tarifarios, id: t.id, data: { tarifas: lineasDe(t), convenioId: s(t.data.convenioId), numeroConvenio: s(t.data.numeroConvenio) } });
  });
  for (let i = 0; i < escrituras.length; i += 450) {
    const lote = writeBatch(db);
    escrituras.slice(i, i + 450).forEach((w) => lote.update(doc(db, w.col, w.id), w.data));
    await lote.commit();
  }
  return rep;
};

/** Cuántos detalles (de una lista ya cargada) tienen algún obligatorio vacío. */
export const contarIncompletos = (tipo: TipoRel, detalles: { id: string; data: D }[]): string[] =>
  detalles.filter((d) => d.data._eliminado !== true && faltantesDetalle(tipo, d.data).length > 0).map((d) => s(d.data.consecutivo) || d.id);

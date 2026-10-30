/**
 * ✅ V00492 — T.C. DEL DOF AUTOMÁTICO (Cloud Function programada, 12:00 a. m. hora de Texas desde la V00533)
 * ------------------------------------------------------------------------------
 * Pedido del cliente: "todos los días a las 5:00 a. m. (hora de Texas) se coloque el tipo de
 * cambio DOF del día; debe ser el correcto y solo a las 5:00".
 *
 * Qué valor es: el que publica HOY el Diario Oficial = el FIX que Banxico determinó el día
 * hábil bancario anterior (serie SF43718, FIX por fecha de determinación). Ej.: FIX del viernes
 * 23-oct-2026 (18.6670) = DOF del lunes 26-oct. Tabla de Banxico: "Publicación DOF: el día hábil
 * bancario inmediato siguiente a su determinación".
 *
 * Cómo se asegura que es el correcto:
 *   · El día hábil bancario anterior se calcula con el calendario de la CNBV (fines de semana +
 *     los 11 días inhábiles bancarios de México, con Semana Santa y los lunes que se recorren).
 *     El último FIX que trae Banxico DEBE ser de ese día; si no (Banxico aún no lo publica, o un
 *     día inhábil extraordinario), no se registra nada y se reintenta (y si sigue mal, queda para
 *     capturarlo a mano).
 *   · Los días sin DOF (sábado, domingo, inhábiles bancarios de México) llevan el DOF del último
 *     día hábil (se toma de Banxico, no del renglón anterior, por si ese faltara). Los festivos de
 *     la app (config_dias_festivos/general) llevan el T.C. del renglón anterior, como el formulario.
 *     Al registrar un día se crean también los días sin DOF que siguen (viernes → sábado y domingo).
 *   · Una fecha no se repite ni se sobrescribe: si alguien ya capturó el día, no se toca (si el
 *     valor capturado no es el del DOF, queda un aviso en los logs).
 *
 * Cuándo corre: UNA vez al día a las 12:00 de la noche (America/Chicago: hora central de Texas,
 * con su horario de verano). ✅ V00533: antes a las 5:00; el cliente lo pidió a medianoche. A esa
 * hora el FIX del día hábil anterior ya está publicado (Banxico lo da hacia el mediodía de CDMX) y
 * `hoy` ya es el día nuevo en Texas. Solo si esa corrida falla (Banxico no responde) Cloud
 * Scheduler la reintenta a los pocos minutos, hasta 3 veces; nunca más tarde en el día.
 *
 * Campos: los del formulario (dia, fecha, tcDof en texto con 4 decimales, tendencia, tipoTendencia)
 * + origen, fechaFix, creadoPor, createdAt. OJO: ningún campo nuevo puede contener "dof", "valor",
 * "cambio", "monto" ni llamarse "tc": valorDeTipoCambio (shared/dominio/tipoCambio.ts) toma el
 * primer campo así.
 *
 * Token de Banxico en Secret Manager:  firebase functions:secrets:set BANXICO_TOKEN
 * Basado en el parche "T.C. del DOF automático a las 5 a. m." (sesión del 23-oct), con estos
 * cambios: solo 5:00 (antes 5, 7 y 9), hora de Texas (antes Matamoros), calendario bancario de
 * México y la verificación del día hábil anterior.
 * ------------------------------------------------------------------------------
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { onSchedule } from 'firebase-functions/v2/scheduler';

if (getApps().length === 0) initializeApp();

const BANXICO_TOKEN = defineSecret('BANXICO_TOKEN');
/** Hora de Texas (central; El Paso es la única parte en hora de montaña). */
export const ZONA_TEXAS = 'America/Chicago';
export const SERIE_FIX = 'SF43718';
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
/** Días que se crean hacia adelante como máximo (inhábiles seguidos). */
const MAX_ADELANTE = 14;

// ── Fechas (lógica pura, con pruebas en test/tipoCambioDof.test.ts) ─────────────

/** Fecha AAAA-MM-DD de un instante en la zona dada. */
export const fechaEnZona = (instante: Date, zona = ZONA_TEXAS): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);

const aFecha = (iso: string): Date => new Date(`${iso}T12:00:00Z`);
const aIso = (d: Date): string => d.toISOString().slice(0, 10);

export const sumarDias = (iso: string, n: number): string => {
  const d = aFecha(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return aIso(d);
};

export const nombreDia = (iso: string): string => DIAS[aFecha(iso).getUTCDay()];

const esFinDeSemana = (iso: string): boolean => { const dow = aFecha(iso).getUTCDay(); return dow === 0 || dow === 6; };

/** Domingo de Pascua (algoritmo gregoriano anónimo). */
export const domingoDePascua = (anio: number): string => {
  const a = anio % 19; const b = Math.floor(anio / 100); const c = anio % 100;
  const d = Math.floor(b / 4); const e = b % 4; const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3); const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4); const k = c % 4; const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31); const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
};

/** n-ésimo lunes de un mes (1 = primero). */
const lunesDelMes = (anio: number, mes: number, n: number): string => {
  const primero = new Date(Date.UTC(anio, mes - 1, 1, 12));
  const desfase = (8 - primero.getUTCDay()) % 7; // días hasta el primer lunes
  return aIso(new Date(Date.UTC(anio, mes - 1, 1 + desfase + 7 * (n - 1), 12)));
};

/**
 * Días inhábiles bancarios de México (calendario de la CNBV) de un año, además de sábados y
 * domingos: 1-ene, 1er lunes de febrero, 3er lunes de marzo, jueves y viernes santos, 1-may,
 * 16-sep, 2-nov, 3er lunes de noviembre, 12-dic, 25-dic y 1-oct del año de cambio de gobierno
 * federal (2024, 2030…).
 */
export const inhabilesBancariosMx = (anio: number): Set<string> => {
  const fijo = (mmdd: string) => `${anio}-${mmdd}`;
  const pascua = domingoDePascua(anio);
  const dias = [
    fijo('01-01'), lunesDelMes(anio, 2, 1), lunesDelMes(anio, 3, 3), sumarDias(pascua, -3), sumarDias(pascua, -2),
    fijo('05-01'), fijo('09-16'), fijo('11-02'), lunesDelMes(anio, 11, 3), fijo('12-12'), fijo('12-25'),
  ];
  if (anio >= 2024 && (anio - 2024) % 6 === 0) dias.push(fijo('10-01'));
  return new Set(dias);
};

/** ¿Hay DOF (día hábil bancario en México)? */
export const esHabilBancario = (iso: string): boolean =>
  !esFinDeSemana(iso) && !inhabilesBancariosMx(Number(iso.slice(0, 4))).has(iso);

/** Día hábil bancario inmediato anterior (el día en que se determinó el FIX que publica `iso`). */
export const habilBancarioAnterior = (iso: string): string => {
  let f = sumarDias(iso, -1);
  for (let i = 0; i < 15 && !esHabilBancario(f); i += 1) f = sumarDias(f, -1);
  return f;
};

/** Festivos de la app (config_dias_festivos/general: texto o { fecha }). */
export const leerFestivos = (datos: unknown): Set<string> => {
  const lista = (datos as { festivos?: unknown } | undefined)?.festivos;
  if (!Array.isArray(lista)) return new Set();
  return new Set(
    lista
      .map((f) => String(typeof f === 'object' && f !== null ? (f as { fecha?: unknown }).fecha ?? '' : f))
      .filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)),
  );
};

/**
 * ¿El día lleva el T.C. del día anterior? Sin DOF (fin de semana o inhábil bancario de México) o
 * festivo de la app (la misma regla que el formulario de Tipo de Cambio).
 */
export const llevaTcAnterior = (iso: string, festivosApp: ReadonlySet<string>): boolean =>
  !esHabilBancario(iso) || festivosApp.has(iso);

const motivoInhabil = (iso: string): string => (esFinDeSemana(iso) ? 'fin de semana' : 'día festivo');

// ── Banxico (puro) ──────────────────────────────────────────────────────────────

export type Observacion = { fecha: string; valor: string };

/** Observaciones válidas de la respuesta de SieAPIRest (fecha dd/mm/aaaa → AAAA-MM-DD; "N/E" fuera). */
export const leerSerieBanxico = (json: unknown): Observacion[] => {
  const datos = (json as { bmx?: { series?: { datos?: { fecha?: string; dato?: string }[] }[] } })?.bmx?.series?.[0]?.datos ?? [];
  const r: Observacion[] = [];
  for (const d of datos) {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d.fecha ?? '');
    const n = Number(String(d.dato ?? '').replace(/,/g, ''));
    if (!m || !Number.isFinite(n) || n < 5 || n > 60) continue;
    r.push({ fecha: `${m[3]}-${m[2]}-${m[1]}`, valor: n.toFixed(4) });
  }
  return r.sort((a, b) => a.fecha.localeCompare(b.fecha));
};

/**
 * T.C. que publica el DOF en `hoy` (día hábil bancario): el FIX del día hábil bancario anterior.
 * Error si Banxico no lo trae (aún no publicado, o no se determinó ese día).
 */
export const dofDelDia = (obs: readonly Observacion[], hoy: string): Observacion => {
  const esperado = habilBancarioAnterior(hoy);
  const fix = obs.find((o) => o.fecha === esperado);
  if (!fix) {
    const ultimo = obs.filter((o) => o.fecha < hoy).pop();
    throw new Error(`Banxico no trae el FIX del ${esperado} (el DOF del ${hoy}); el último es ${ultimo ? `del ${ultimo.fecha}` : 'ninguno'}`);
  }
  return fix;
};

/** Tendencia con el mismo texto que el formulario. */
export const tendenciaContra = (actual: string, anterior: string | null): { tendencia: string; tipoTendencia: string } => {
  const a = parseFloat(actual);
  const b = anterior === null ? NaN : parseFloat(anterior);
  if (Number.isNaN(b)) return { tendencia: 'Sin cambio (Primer registro)', tipoTendencia: 'igual' };
  const dif = a - b;
  if (dif > 0) return { tendencia: `Subió ${dif.toFixed(4)} centavos`, tipoTendencia: 'subio' };
  if (dif < 0) return { tendencia: `Bajó ${Math.abs(dif).toFixed(4)} centavos`, tipoTendencia: 'bajo' };
  return { tendencia: 'Sin cambio', tipoTendencia: 'igual' };
};

// ── Plan del día (puro) ─────────────────────────────────────────────────────────

export type RenglonTc = { dia: string; fecha: string; tcDof: string; tendencia: string; tipoTendencia: string; origen: string; fechaFix?: string };

export interface EntradaPlan {
  hoy: string;
  festivosApp: ReadonlySet<string>;
  /** T.C. del último renglón anterior a hoy (null si no hay). */
  tcAnterior: string | null;
  /** Fechas que ya tienen renglón (de hoy en adelante). */
  existentes: ReadonlySet<string>;
  /** Observaciones de Banxico (solo hacen falta si hoy tiene DOF). */
  obs: readonly Observacion[] | null;
}

/**
 * Renglones a crear hoy: el de hoy y los días siguientes que llevan el mismo T.C. (sin DOF o
 * festivos de la app, seguidos). Vacío si hoy ya tiene renglón. El T.C. de hoy:
 *   · día hábil bancario → el DOF de hoy (FIX del día hábil anterior);
 *   · sin DOF (fin de semana, inhábil bancario) → el DOF del último día hábil, de Banxico;
 *   · festivo de la app que sí tiene DOF → el T.C. del renglón anterior (regla del formulario).
 */
export const planTipoCambioDof = (e: EntradaPlan): RenglonTc[] => {
  if (e.existentes.has(e.hoy)) return [];
  const base = { dia: nombreDia(e.hoy), fecha: e.hoy };
  const sinCambio = (f: string) => `Sin cambio (${motivoInhabil(f)}: mismo T.C. del día anterior)`;
  let hoyRenglon: RenglonTc;
  if (esHabilBancario(e.hoy) && e.festivosApp.has(e.hoy)) {
    if (!e.tcAnterior) throw new Error(`${e.hoy} es festivo y no hay T.C. anterior que copiar`);
    hoyRenglon = { ...base, tcDof: e.tcAnterior, tendencia: sinCambio(e.hoy), tipoTendencia: 'igual', origen: 'Automático (festivo: T.C. anterior)' };
  } else {
    if (!e.obs) throw new Error('Faltan los datos de Banxico');
    const conDof = esHabilBancario(e.hoy);
    const fix = dofDelDia(e.obs, conDof ? e.hoy : habilBancarioAnterior(e.hoy));
    const igualAlAnterior = e.tcAnterior !== null && Math.abs(parseFloat(e.tcAnterior) - parseFloat(fix.valor)) < 0.00005;
    hoyRenglon = {
      ...base, tcDof: fix.valor,
      ...(conDof || !igualAlAnterior ? tendenciaContra(fix.valor, e.tcAnterior) : { tendencia: sinCambio(e.hoy), tipoTendencia: 'igual' }),
      origen: conDof ? `Banxico ${SERIE_FIX} (automático)` : `Banxico ${SERIE_FIX} (día sin DOF: el del último día hábil)`, fechaFix: fix.fecha,
    };
  }
  const renglones = [hoyRenglon];
  for (let f = sumarDias(e.hoy, 1); llevaTcAnterior(f, e.festivosApp) && renglones.length <= MAX_ADELANTE; f = sumarDias(f, 1)) {
    if (e.existentes.has(f)) continue;
    renglones.push({
      dia: nombreDia(f), fecha: f, tcDof: hoyRenglon.tcDof, tendencia: sinCambio(f), tipoTendencia: 'igual',
      origen: 'Automático (día sin DOF)', ...(hoyRenglon.fechaFix ? { fechaFix: hoyRenglon.fechaFix } : {}),
    });
  }
  return renglones;
};

// ── Firestore + Banxico ─────────────────────────────────────────────────────────

async function serieBanxico(hoy: string, token: string): Promise<Observacion[]> {
  const url = `https://www.banxico.org.mx/SieAPIRest/service/v1/series/${SERIE_FIX}/datos/${sumarDias(hoy, -15)}/${sumarDias(hoy, -1)}`;
  const resp = await fetch(url, { headers: { 'Bmx-Token': token, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!resp.ok) throw new Error(`Banxico respondió ${resp.status}`);
  return leerSerieBanxico(await resp.json());
}

/** Registra el T.C. de hoy (y los días sin DOF que siguen). Devuelve lo que hizo. */
export async function registrarTipoCambioDof(hoy: string, token: string): Promise<string> {
  const db = getFirestore();
  const col = db.collection('tipo_cambio');

  const hoyYa = await col.where('fecha', '==', hoy).limit(1).get();
  if (!hoyYa.empty) {
    // No se sobrescribe lo capturado; solo se avisa si no es el DOF.
    if (esHabilBancario(hoy)) {
      try {
        const fix = dofDelDia(await serieBanxico(hoy, token), hoy);
        const capturado = String(hoyYa.docs[0].get('tcDof') ?? '');
        if (Math.abs(parseFloat(capturado) - parseFloat(fix.valor)) > 0.00005) {
          logger.warn(`tipoCambioDofDiario: ${hoy} ya tenía T.C. ${capturado}, pero el DOF es ${fix.valor} (FIX del ${fix.fecha}); no se cambió`);
        }
      } catch (e) {
        logger.warn(`tipoCambioDofDiario: no se pudo comparar el T.C. capturado del ${hoy}`, e);
      }
    }
    return `${hoy} ya tenía T.C.; nada que hacer`;
  }

  const [festivosSnap, antSnap, existentesSnap] = await Promise.all([
    db.doc('config_dias_festivos/general').get(),
    col.where('fecha', '<', hoy).orderBy('fecha', 'desc').limit(1).get(),
    col.where('fecha', '>=', hoy).where('fecha', '<=', sumarDias(hoy, MAX_ADELANTE + 1)).get(),
  ]);
  const festivosApp = leerFestivos(festivosSnap.data());
  const tcAnterior = antSnap.empty ? null : String(antSnap.docs[0].get('tcDof') ?? '') || null;
  const existentes = new Set(existentesSnap.docs.map((d) => String(d.get('fecha') ?? '')));
  const obs = esHabilBancario(hoy) && festivosApp.has(hoy) ? null : await serieBanxico(hoy, token);
  const plan = planTipoCambioDof({ hoy, festivosApp, tcAnterior, existentes, obs });
  if (plan.length === 0) return `${hoy} ya tenía T.C.; nada que hacer`;

  // Cada fecha se vuelve a revisar dentro de la transacción: si alguien la capturó mientras tanto, esa no se crea.
  const ahora = new Date().toISOString();
  const creados = await db.runTransaction(async (tx) => {
    const libres: RenglonTc[] = [];
    for (const r of plan) if ((await tx.get(col.where('fecha', '==', r.fecha).limit(1))).empty) libres.push(r);
    for (const r of libres) tx.create(col.doc(), { ...r, creadoPor: 'Sistema', createdAt: ahora });
    return libres;
  });

  if (creados.length > 0) {
    const fechaFix = creados[0].fechaFix;
    await db.collection('historial_actividad').add({
      usuario: 'Sistema (Banxico)',
      modulo: 'Tipo de Cambio',
      accion: 'Creación',
      detalle: `T.C. DOF automático ${creados[0].tcDof} para ${creados.map((r) => r.fecha).join(', ')}${fechaFix ? ` (FIX del ${fechaFix})` : ''}`,
      fecha: ahora,
    });
  }
  return creados.length > 0 ? `Registrado ${creados[0].tcDof} en ${creados.map((r) => r.fecha).join(', ')}` : `${hoy} lo capturó alguien mientras tanto`;
}

export const tipoCambioDofDiario = onSchedule(
  {
    schedule: '0 0 * * *', timeZone: ZONA_TEXAS, region: 'us-central1', secrets: [BANXICO_TOKEN], timeoutSeconds: 120,
    // ✅ V00533: a las 12:00 de la noche. Solo si esa corrida falla: reintentos a los pocos minutos (≈0:02, 0:06, 0:11), nunca más tarde.
    retryCount: 3, minBackoffSeconds: 120, maxBackoffSeconds: 300, maxRetrySeconds: 1200,
  },
  async () => {
    const hoy = fechaEnZona(new Date());
    try {
      logger.info(`tipoCambioDofDiario: ${await registrarTipoCambioDof(hoy, BANXICO_TOKEN.value())}`);
    } catch (e) {
      logger.error(`tipoCambioDofDiario: no se pudo registrar el T.C. del ${hoy}`, e);
      throw e; // para que Cloud Scheduler lo reintente
    }
  },
);

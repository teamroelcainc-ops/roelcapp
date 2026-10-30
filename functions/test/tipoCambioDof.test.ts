// ✅ V00492 — T.C. del DOF automático: fechas en Texas, calendario bancario de México, DOF del día y plan.
import { describe, expect, it, vi } from 'vitest';

vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: vi.fn() }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/params', () => ({ defineSecret: () => ({ value: () => 'token' }) }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: (_o: unknown, fn: unknown) => fn }));

const m = await import('../src/tipoCambioDof');

const banxico = (datos: [string, string][]) => ({ bmx: { series: [{ idSerie: 'SF43718', datos: datos.map(([fecha, dato]) => ({ fecha, dato })) }] } });
// Tabla de Banxico (FIX por fecha de determinación), oct-2026: DOF del 23-oct = 18.7005 (FIX del 22).
const OBS = m.leerSerieBanxico(banxico([
  ['19/10/2026', '18.4253'], ['20/10/2026', '18.4200'], ['21/10/2026', '18.6425'], ['22/10/2026', '18.7005'], ['23/10/2026', '18.6670'],
  ['24/10/2026', 'N/E'], ['25/10/2026', 'N/E'],
]));
const plan = (hoy: string, extra: Partial<Parameters<typeof m.planTipoCambioDof>[0]> = {}) =>
  m.planTipoCambioDof({ hoy, festivosApp: new Set(), tcAnterior: '18.6425', existentes: new Set(), obs: OBS, ...extra });

describe('fecha de Texas', () => {
  it('a las 5:00 de Texas la fecha es la local (con y sin horario de verano)', () => {
    expect(m.fechaEnZona(new Date('2026-10-26T10:00:00Z'))).toBe('2026-10-26'); // 5:00 CDT
    expect(m.fechaEnZona(new Date('2026-11-02T11:00:00Z'))).toBe('2026-11-02'); // 5:00 CST
    expect(m.fechaEnZona(new Date('2026-10-26T04:59:00Z'))).toBe('2026-10-25'); // 23:59 del domingo
  });
  it('a las 12:00 de la noche de Texas (V00533) la fecha ya es el día nuevo', () => {
    expect(m.fechaEnZona(new Date('2026-10-26T05:00:00Z'))).toBe('2026-10-26'); // 0:00 CDT
    expect(m.fechaEnZona(new Date('2026-11-02T06:00:00Z'))).toBe('2026-11-02'); // 0:00 CST
  });
});

describe('calendario bancario de México (CNBV)', () => {
  it('2026: los 11 días inhábiles', () => {
    expect([...m.inhabilesBancariosMx(2026)].sort()).toEqual([
      '2026-01-01', '2026-02-02', '2026-03-16', '2026-04-02', '2026-04-03', '2026-05-01',
      '2026-09-16', '2026-11-02', '2026-11-16', '2026-12-12', '2026-12-25',
    ]);
    expect(m.domingoDePascua(2027)).toBe('2027-03-28');
    expect(m.inhabilesBancariosMx(2030).has('2030-10-01')).toBe(true); // cambio de gobierno federal
    expect(m.inhabilesBancariosMx(2027).has('2027-10-01')).toBe(false);
  });
  it('día hábil bancario anterior (fin de semana y lunes festivo)', () => {
    expect(m.habilBancarioAnterior('2026-10-26')).toBe('2026-10-23'); // lunes → viernes
    expect(m.habilBancarioAnterior('2026-11-17')).toBe('2026-11-13'); // martes después del lunes 16 festivo
    expect(m.habilBancarioAnterior('2026-04-06')).toBe('2026-04-01'); // después de Semana Santa
    expect(m.esHabilBancario('2026-11-16')).toBe(false);
  });
});

describe('DOF del día', () => {
  it('es el FIX del día hábil bancario anterior', () => {
    expect(m.dofDelDia(OBS, '2026-10-23')).toEqual({ fecha: '2026-10-22', valor: '18.7005' });
    expect(m.dofDelDia(OBS, '2026-10-26')).toEqual({ fecha: '2026-10-23', valor: '18.6670' });
  });
  it('si Banxico no trae ese FIX, error (no se registra un valor que no es)', () => {
    const sinViernes = OBS.filter((o) => o.fecha !== '2026-10-23');
    expect(() => m.dofDelDia(sinViernes, '2026-10-26')).toThrow(/FIX del 2026-10-23/);
  });
  it('ignora N/E y formatea a 4 decimales', () => {
    expect(m.leerSerieBanxico(banxico([['16/11/2026', 'N/E'], ['17/11/2026', '18.5']]))).toEqual([{ fecha: '2026-11-17', valor: '18.5000' }]);
    expect(m.leerSerieBanxico({})).toEqual([]);
  });
});

describe('plan del día', () => {
  it('lunes hábil: el DOF del día con su tendencia', () => {
    expect(plan('2026-10-26', { tcAnterior: '18.7005' })).toEqual([
      { dia: 'Lunes', fecha: '2026-10-26', tcDof: '18.6670', tendencia: 'Bajó 0.0335 centavos', tipoTendencia: 'bajo', origen: 'Banxico SF43718 (automático)', fechaFix: '2026-10-23' },
    ]);
  });
  it('viernes: también crea sábado y domingo con el mismo T.C.', () => {
    const r = plan('2026-10-23');
    expect(r.map((x) => [x.fecha, x.tcDof, x.tipoTendencia])).toEqual([['2026-10-23', '18.7005', 'subio'], ['2026-10-24', '18.7005', 'igual'], ['2026-10-25', '18.7005', 'igual']]);
    expect(r[1].tendencia).toBe('Sin cambio (fin de semana: mismo T.C. del día anterior)');
  });
  it('ya tiene renglón: nada (no se sobrescribe); los días siguientes que ya existen se saltan', () => {
    expect(plan('2026-10-26', { existentes: new Set(['2026-10-26']) })).toEqual([]);
    expect(plan('2026-10-23', { existentes: new Set(['2026-10-24']) }).map((x) => x.fecha)).toEqual(['2026-10-23', '2026-10-25']);
  });
  it('sábado sin renglón (falló el viernes): el DOF del último día hábil, de Banxico', () => {
    const r = plan('2026-10-24', { tcAnterior: '18.6425' });
    expect(r.map((x) => [x.fecha, x.tcDof])).toEqual([['2026-10-24', '18.7005'], ['2026-10-25', '18.7005']]);
    expect(r[0].origen).toMatch(/día sin DOF/);
    expect(plan('2026-10-24', { tcAnterior: '18.7005' })[0].tendencia).toBe('Sin cambio (fin de semana: mismo T.C. del día anterior)');
  });
  it('festivo de la app que sí tiene DOF: el T.C. del renglón anterior (regla del formulario)', () => {
    const r = plan('2026-10-26', { festivosApp: new Set(['2026-10-26']), tcAnterior: '18.7005', obs: null });
    expect(r[0]).toMatchObject({ tcDof: '18.7005', tipoTendencia: 'igual', tendencia: 'Sin cambio (día festivo: mismo T.C. del día anterior)' });
  });
  it('festivo de la app sin T.C. anterior: error', () => {
    expect(() => plan('2026-10-26', { festivosApp: new Set(['2026-10-26']), tcAnterior: null, obs: null })).toThrow(/festivo/);
  });
});

describe('tendencia', () => {
  it('con el texto del formulario', () => {
    expect(m.tendenciaContra('18.7005', '18.6425')).toEqual({ tendencia: 'Subió 0.0580 centavos', tipoTendencia: 'subio' });
    expect(m.tendenciaContra('18.6', null).tipoTendencia).toBe('igual');
  });
});

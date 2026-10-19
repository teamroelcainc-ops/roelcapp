// ✅ V00463 — guardarOperacionSegura: reintentos con el mismo clienteOpId y aviso claro.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const llamadas: Record<string, unknown>[] = [];
const servidor = { fallos: 0, aterriza: false, errorFuncion: '', idem: new Map<string, { id: string; ref: string }>(), n: 0 };
const updateDoc = vi.fn(async (...args: unknown[]) => { void args; });
const registrarLog = vi.fn(async (...args: unknown[]) => { void args; });

vi.mock('firebase/app', () => ({ getApp: () => ({}) }));
vi.mock('../../../config/firebase', () => ({ db: {} }));
vi.mock('../../../utils/logger', () => ({ registrarLog: (...a: unknown[]) => registrarLog(...a) }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
  getDoc: async () => ({ exists: () => false, data: () => ({}) }),
  updateDoc: (...a: unknown[]) => updateDoc(...a),
}));
// crearOperacion de mentira: idempotente por clienteOpId, como la real.
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => async (datos: Record<string, unknown>) => {
    llamadas.push(datos);
    const clave = String(datos.clienteOpId);
    const crear = () => {
      const previo = servidor.idem.get(clave);
      if (previo) return { ...previo, yaExistia: true };
      servidor.n += 1;
      const r = { id: `op${servidor.n}`, ref: `${String(datos.prefijo)}-${String(datos.ddmmyy)}-00${servidor.n}` };
      servidor.idem.set(clave, r);
      return { ...r, yaExistia: false };
    };
    if (servidor.errorFuncion) throw Object.assign(new Error(servidor.errorFuncion), { code: 'functions/invalid-argument' });
    if (servidor.fallos > 0) {
      servidor.fallos -= 1;
      if (servidor.aterriza) crear(); // llegó al servidor, pero la respuesta se perdió
      throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    }
    return { data: { success: true, version: 'prueba', ...crear() } };
  },
}));

const { guardarOperacionSegura } = await import('./operacionesService');
const op = { tipoOperacionNombre: 'Transfer', fechaServicio: '2026-10-19', clienteNombre: 'X' };

describe('guardarOperacionSegura (V00463)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    llamadas.length = 0; updateDoc.mockClear(); registrarLog.mockClear();
    Object.assign(servidor, { fallos: 0, aterriza: false, errorFuncion: '', n: 0 }); servidor.idem.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('un "internal" pasajero se reintenta solo con el MISMO clienteOpId y no duplica', async () => {
    servidor.fallos = 2; servidor.aterriza = true;
    const p = guardarOperacionSegura(op, { clienteOpId: 'envio-1' });
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ success: true, id: 'op1', ref: 'TR-191026-001' });
    expect(llamadas.map((l) => l.clienteOpId)).toEqual(['envio-1', 'envio-1', 'envio-1']);
    expect(servidor.n).toBe(1);
    expect(updateDoc).not.toHaveBeenCalled(); // mismos datos: no hace falta reescribir
    expect(registrarLog).toHaveBeenCalledWith('Operaciones', 'Reintento', expect.stringContaining('TR-191026-001'));
  });

  it('si no hay respuesta en 3 intentos explica qué pasó; el siguiente Guardar usa la operación que sí llegó y le aplica lo nuevo', async () => {
    servidor.fallos = 3; servidor.aterriza = true;
    const p = guardarOperacionSegura(op, { clienteOpId: 'envio-2' }).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    const e = await p as Error;
    expect(e.message).toContain('No se pudo comunicar con el servidor');
    expect(e.message).toContain('3 veces');
    expect(e.message).toContain('Detalle técnico: internal');
    expect(registrarLog).toHaveBeenCalledWith('Operaciones', 'Error', expect.stringContaining('sin respuesta del servidor'));
    // Guardar otra vez (con un cambio): misma operación, sin duplicar, con el dato nuevo.
    const p2 = guardarOperacionSegura({ ...op, clienteNombre: 'Y', ref: 'no-se-copia' }, { clienteOpId: 'envio-2' });
    await vi.runAllTimersAsync();
    await expect(p2).resolves.toMatchObject({ id: 'op1' });
    expect(servidor.n).toBe(1);
    expect(updateDoc).toHaveBeenCalledWith({ path: 'operaciones/op1' }, expect.objectContaining({ clienteNombre: 'Y' }));
    expect(updateDoc.mock.calls[0][1]).not.toHaveProperty('ref');
  });

  it('un error de la función no se reintenta y se muestra su mensaje', async () => {
    servidor.errorFuncion = 'operacion.fechaServicio: demasiado largo';
    const p = guardarOperacionSegura({ ...op }, { clienteOpId: 'envio-3' }).catch((e: Error) => e);
    await vi.runAllTimersAsync();
    expect((await p as Error).message).toBe('operacion.fechaServicio: demasiado largo');
    expect(llamadas).toHaveLength(1);
  });
});

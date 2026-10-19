// ✅ V00463 — reintentos de crearOperacion / renumerarOperacion.
import { describe, expect, it } from 'vitest';
import { codigoCallable, conReintentos, ErrorTrasReintentos, esFalloDeConexion, esReintentable } from './reintentosCallable';

const error = (code: string, message: string) => Object.assign(new Error(message), { code });
const sinEspera = () => Promise.resolve();

describe('reintentos de callables', () => {
  it('"internal" sin mensaje propio es un fallo de conexión; con mensaje es de la función', () => {
    expect(codigoCallable(error('functions/internal', 'internal'))).toBe('internal');
    expect(esFalloDeConexion(error('functions/internal', 'internal'))).toBe(true);
    expect(esFalloDeConexion(error('functions/unavailable', ''))).toBe(true);
    expect(esFalloDeConexion(error('functions/internal', 'INTERNAL'))).toBe(true); // excepción no controlada: mismo texto
    expect(esFalloDeConexion(error('functions/internal', 'No se pudo crear la operación.'))).toBe(false);
    expect(esFalloDeConexion(error('functions/invalid-argument', 'fechaServicio: muy largo'))).toBe(false);
    expect(esReintentable(error('functions/aborted', 'Demasiadas creaciones simultáneas.'))).toBe(true);
    expect(esReintentable(error('functions/permission-denied', 'Solo personal'))).toBe(false);
  });

  it('reintenta lo pasajero y devuelve cuántos intentos tomó', async () => {
    let n = 0;
    const r = await conReintentos(async () => { n++; if (n < 3) throw error('functions/internal', 'internal'); return 'ok'; }, [10, 20], sinEspera);
    expect(r).toEqual({ valor: 'ok', intentos: 3, ultimoCodigo: 'internal' });
  });

  it('no reintenta un error de la función y se rinde después del último intento', async () => {
    let n = 0;
    await expect(conReintentos(async () => { n++; throw error('functions/invalid-argument', 'dato malo'); }, [10, 20], sinEspera))
      .rejects.toMatchObject({ intentos: 1, message: 'dato malo' });
    expect(n).toBe(1);
    n = 0;
    let t = 0;
    const e = await conReintentos(async () => { n++; t += 5000; throw error('functions/internal', 'internal'); }, [10, 20], sinEspera, () => t).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorTrasReintentos);
    expect(e).toMatchObject({ intentos: 3, segundos: 15 });
    expect(n).toBe(3);
  });
});

// ✅ V00440 (Fase 4.4) — qué escribe el trigger operacionEscrita en los campos canónicos.
import { describe, expect, it } from 'vitest';
import { cambiosCanonicos } from '../src/canonico';
import { camposCanonicos, crearIndice } from '../src/dominio/operacionCanonica.js';
import type { ContextoCanonico } from '../src/dominio/operacionCanonica.js';
import { STATUS_COMPLETADOS } from '../src/dominio/constantes.js';

const ctx: ContextoCanonico = {
  status: crearIndice([{ id: 'aaaa1111', nombres: ['En ruta'] }, { id: STATUS_COMPLETADOS[0], nombres: ['Servicio Completado'] }]),
  nombreStatus: (id) => (id === 'aaaa1111' ? 'En ruta' : id === STATUS_COMPLETADOS[0] ? 'Servicio Completado' : undefined),
};

const op = {
  ref: 'TR-101026-001', fechaServicio: '2026-10-10', status: 'aaaa1111', statusNombre: 'En ruta',
  clientePaga: 'a1b2c3d4', proveedorUnidad: 'b1b2c3d4', operador: 'e1e2e3e4',
};

/** Simula el trigger: aplica lo que escribe y devuelve el documento resultante. */
const pasar = (antes: Record<string, unknown> | undefined, despues: Record<string, unknown>) => {
  const c = cambiosCanonicos(antes, despues, ctx);
  return { cambios: c, doc: { ...despues, ...c } };
};

describe('cambiosCanonicos (trigger)', () => {
  it('operación nueva: escribe todos los canónicos', () => {
    const c = cambiosCanonicos(undefined, op, ctx);
    expect(c).toMatchObject({ fechaServicioISO: '2026-10-10', estadoGrupo: 'activa', clientePagaId: 'a1b2c3d4', esquemaVersion: 2 });
    expect(c.empresasIds).toEqual(['a1b2c3d4', 'b1b2c3d4']);
  });

  it('segunda pasada (la escritura del propio trigger): no escribe nada → no hay bucle', () => {
    const primera = pasar(undefined, op).doc;
    expect(cambiosCanonicos(op, primera, ctx)).toEqual({});
  });

  it('la app móvil cambia el status: solo cambian estadoGrupo, statusId y porFacturar', () => {
    const antes = pasar(undefined, op).doc;
    const despues = { ...antes, status: STATUS_COMPLETADOS[0], statusNombre: 'Servicio Completado' };
    expect(cambiosCanonicos(antes, despues, ctx)).toEqual({ statusId: STATUS_COMPLETADOS[0], estadoGrupo: 'completada', porFacturarCliente: true });
  });

  it('registro viejo con `unidadId` y sin `unidad`: el trigger lo conserva en todas las pasadas', () => {
    const viejo = { ...op, unidadId: 'u1u2u3u4' };
    const p1 = pasar(viejo, { ...viejo, notas: 'x' });
    expect(p1.cambios.unidadId).toBeUndefined();
    const p2 = pasar({ ...viejo, notas: 'x' }, p1.doc);
    expect(p2.cambios).toEqual({});
    expect(p2.doc.unidadId).toBe('u1u2u3u4');
  });

  it('lo que resolvió la migración (nombres viejos) no lo deshace el trigger', () => {
    const conNombres = { ...op, clientePaga: 'ACME', origen: 'Bodega Norte' };
    const migrada = { ...conNombres, ...camposCanonicos(conNombres, ctx).campos, clientePagaId: 'a1b2c3d4', origenId: 'b9b9b9b9', empresasIds: ['a1b2c3d4', 'b1b2c3d4', 'b9b9b9b9'] };
    // El trigger se dispara por la escritura de la migración (cambian solo canónicos):
    expect(cambiosCanonicos(conNombres, migrada, ctx)).toEqual({});
    // Y por una edición posterior que no toca esos datos:
    expect(cambiosCanonicos(migrada, { ...migrada, notas: 'x' }, ctx)).toEqual({});
  });

  it('si el dato cambia a algo que no se puede resolver, el ID viejo se limpia y sale de empresasIds', () => {
    const antes = pasar(undefined, op).doc;
    const despues = { ...antes, clientePaga: 'Otra Empresa SA' };
    const c = cambiosCanonicos(antes, despues, ctx);
    expect(c.clientePagaId).toBeNull();
    expect(c.empresasIds).toEqual(['b1b2c3d4']);
  });

  it('status solo en el statusId viejo: trigger y migración calculan el mismo estado', () => {
    const viejo = { ...op, status: '', statusNombre: '', statusId: STATUS_COMPLETADOS[0] };
    const migracion = camposCanonicos(viejo, { ...ctx, incluirPropio: true }).campos;
    expect(migracion).toMatchObject({ estadoGrupo: 'completada', porFacturarCliente: true });
    const migrada = { ...viejo, ...migracion };
    expect(cambiosCanonicos(viejo, migrada, ctx)).toEqual({});
  });

  it('documento nuevo que ya trae canónicos (restaurado de la papelera): se conservan', () => {
    const conNombres = { ...op, clientePaga: 'ACME', origen: 'Bodega Norte' };
    const restaurada = { ...conNombres, ...camposCanonicos(conNombres, ctx).campos, clientePagaId: 'a1b2c3d4', origenId: 'b9b9b9b9', empresasIds: ['a1b2c3d4', 'b1b2c3d4', 'b9b9b9b9'] };
    expect(cambiosCanonicos(undefined, restaurada, ctx)).toEqual({});
  });

  it('si se borra la fecha de servicio, fechaServicioISO se limpia (si no cambia, se conserva)', () => {
    const antes = pasar(undefined, op).doc;
    expect(cambiosCanonicos(antes, { ...antes, fechaServicio: '' }, ctx)).toMatchObject({ fechaServicioISO: null });
    const ilegible = { ...antes, fechaServicio: 'pendiente' };
    expect(cambiosCanonicos(ilegible, { ...ilegible, notas: 'x' }, ctx).fechaServicioISO).toBeUndefined();
  });

  it('si el dato se vacía, el ID se vuelve null', () => {
    const antes = pasar(undefined, op).doc;
    expect(cambiosCanonicos(antes, { ...antes, operador: '' }, ctx)).toEqual({ operadorId: null });
  });
});

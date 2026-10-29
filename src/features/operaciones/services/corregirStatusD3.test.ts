// ✅ V00517 — Corrección D3: a qué status del catálogo corresponde lo guardado en la operación.
import { describe, expect, it } from 'vitest';
import { buscarStatus, camposStatus, filasPruebaD3, motivoAlCorregir, numeroDeStatus, planCorregirStatusD3, respaldoD3, statusDelCatalogo } from './corregirStatusD3';
import type { StatusD3 } from './revisionDatos';

const catalogo = statusDelCatalogo([
  { id: 'a1000001', nombre: '1. Pre-Documentado' },
  { id: 'a1000003', _docId: 'a1000003', nombre: '3. Documentado (Asignado)' },
  { id: 'a1000041', nombre: '4.1 Salida de Bódega' },
  { id: 'a1000042', nombre: '4.1 Salida del Patio (Roelca)' },
  { id: 'a1000005', nombre: '5. En Tránsito (a Origen)' },
  { id: 'sinNombre', nombre: '' },
]);
const op = (ref: string, status: string, statusNombre = ''): StatusD3 => ({ opId: `id-${ref}`, ref, cliente: 'Cliente', fecha: '2026-10-29', status, statusNombre });

describe('buscarStatus', () => {
  it('mismo nombre sin importar espacios, acentos ni mayúsculas', () => {
    expect(buscarStatus('3. documentado  (asignado) ', catalogo)).toMatchObject({ tipo: 'una', regla: 'mismo nombre', destino: { id: 'a1000003' } });
    expect(buscarStatus('5. En Transito (a Origen)', catalogo)).toMatchObject({ tipo: 'una', regla: 'mismo nombre', destino: { id: 'a1000005' } });
  });
  it('nombre anterior: el del catálogo es el mismo con algo más al final', () => {
    expect(buscarStatus('3. Documentado', catalogo)).toMatchObject({ tipo: 'una', regla: 'nombre anterior', destino: { nombre: '3. Documentado (Asignado)' } });
  });
  it('mismo número solo si hay uno; con dos del mismo número no se adivina', () => {
    expect(buscarStatus('3. Manifestado', catalogo)).toMatchObject({ tipo: 'una', regla: 'mismo número', destino: { id: 'a1000003' } });
    expect(buscarStatus('4.1 Salida', catalogo)).toEqual({ tipo: 'varias', nombres: ['4.1 Salida de Bódega', '4.1 Salida del Patio (Roelca)'] });
    expect(buscarStatus('Algo raro', catalogo)).toEqual({ tipo: 'ninguna' });
    expect(buscarStatus('f0f0f0f0', catalogo)).toEqual({ tipo: 'ninguna' });
  });
  it('número de un status', () => {
    expect(numeroDeStatus('3. Documentado')).toBe('3');
    expect(numeroDeStatus('4.1 Salida')).toBe('4.1');
    expect(numeroDeStatus('13. En Destino')).toBe('13');
    expect(numeroDeStatus('Documentado')).toBe('');
  });
});

describe('plan', () => {
  const plan = planCorregirStatusD3([
    op('TR-1', '3. Documentado (Asignado)', '3. Documentado (Asignado)'),
    op('TR-2', '3. Documentado'),
    op('TR-3', 'f0f0f0f0', '3. Documentado'), // id que ya no existe: se usa el nombre guardado
    op('TR-4', '4.1 Salida'),
    op('TR-5', ''),
    op('TR-6', 'Algo raro'),
  ], catalogo);
  it('corrige las que tienen un solo status del catálogo y dice por qué deja las demás', () => {
    expect(plan.corregir.map((c) => [c.op.ref, c.destino.id, c.regla, c.desde])).toEqual([
      ['TR-1', 'a1000003', 'mismo nombre', '3. Documentado (Asignado)'],
      ['TR-2', 'a1000003', 'nombre anterior', '3. Documentado'],
      ['TR-3', 'a1000003', 'nombre anterior', '3. Documentado'],
    ]);
    expect(plan.omitidas.map((o) => [o.op.ref, o.motivo])).toEqual([
      ['TR-4', 'Se parece a varios status del catálogo (4.1 Salida de Bódega o 4.1 Salida del Patio (Roelca)): corregirla a mano'],
      ['TR-5', 'No tiene status: capturarlo en el formulario'],
      ['TR-6', 'No se parece a ningún status del catálogo: corregirla a mano'],
    ]);
  });
  it('escribe el id y el nombre del catálogo; la prueba y el respaldo traen lo de antes', () => {
    expect(camposStatus(plan.corregir[1].destino, 'T')).toEqual({ status: 'a1000003', statusNombre: '3. Documentado (Asignado)', statusCorregidoPorRevision: 'T' });
    expect(filasPruebaD3(plan)).toHaveLength(6);
    expect(filasPruebaD3(plan)[1]).toMatchObject({ 'Acción': 'Se corrige', Referencia: 'TR-2', 'status guardado': '3. Documentado', 'Status del catálogo': '3. Documentado (Asignado)', 'Cómo se encontró': 'nombre anterior ("3. Documentado")' });
    const r = respaldoD3(plan, 'T', 'yo@roelca') as { operaciones: { ref: string; antes: unknown }[] };
    expect(r.operaciones.map((o) => [o.ref, o.antes])).toEqual([
      ['TR-1', { status: '3. Documentado (Asignado)', statusNombre: '3. Documentado (Asignado)' }],
      ['TR-2', { status: '3. Documentado', statusNombre: '' }],
      ['TR-3', { status: 'f0f0f0f0', statusNombre: '3. Documentado' }],
    ]);
  });
  it('al escribir: no toca la que cambió de status, ya no existe o cuyo status salió del catálogo', () => {
    const c = plan.corregir[1];
    expect(motivoAlCorregir({ status: '3. Documentado', statusNombre: '' }, { nombre: '3. Documentado (Asignado)' }, c)).toBe('');
    expect(motivoAlCorregir({ status: 'a1000005', statusNombre: '5. En Tránsito (a Origen)' }, { nombre: 'x' }, c)).toBe('Cambió de status desde la revisión (se dejó como está)');
    expect(motivoAlCorregir(null, { nombre: 'x' }, c)).toBe('La operación ya no existe');
    expect(motivoAlCorregir({ status: '3. Documentado', statusNombre: '' }, null, c)).toBe('Ese status ya no está en el catálogo');
  });
});

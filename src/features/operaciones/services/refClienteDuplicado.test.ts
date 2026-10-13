// ✅ V00450 — REF CLIENTE DUPLICADA: normalización, variantes y cruce lista ↔ servidor.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/firebase', () => ({ db: {}, auth: { currentUser: null } }));

import { claveRefCliente, cuentaParaDuplicado, detectarDuplicados, resumenOp, variantesConsulta } from './refClienteDuplicado';
import type { OpRefResumen } from './refClienteDuplicado';
import { armarLotes } from './refClienteDuplicadoServidor';
import { STATUS_CANCELADO } from '../../../shared/dominio/constantes';

const r = (id: string, refCliente: string, extra: Record<string, unknown> = {}): OpRefResumen =>
  resumenOp({ ref: `TR-${id}`, refCliente, ...extra }, id);

describe('claveRefCliente', () => {
  it('ignora mayúsculas y espacios', () => {
    expect(claveRefCliente(' po 123 ')).toBe('PO123');
    expect(claveRefCliente('PO123')).toBe('PO123');
    expect(claveRefCliente('Po 123')).toBe('PO123');
  });
  it('vacía, de relleno o muy corta no se compara', () => {
    for (const v of ['', '   ', 'N/A', 'n/a', 'NA', 'N / A', 's/r', 'S/N', 'n/d', 'sin', '-', '---', '0', '000', '12', null, undefined, {}, 'Sin Ref', 'no aplica']) {
      expect(claveRefCliente(v)).toBe('');
    }
  });
  it('acepta números', () => {
    expect(claveRefCliente(45678)).toBe('45678');
  });
});

describe('variantesConsulta', () => {
  it('incluye la captura exacta, mayúsculas, minúsculas, sin espacios, separada y con espacio al final', () => {
    expect(variantesConsulta(' Po 12 ')).toEqual([' Po 12 ', 'Po 12', 'PO 12', 'po 12', 'PO12', 'po12', 'PO12 ']);
    expect(variantesConsulta('ABC123')).toContain('ABC 123');
    expect(variantesConsulta('ABC123')).toContain('abc 123');
  });
  it('agrega el número si la Ref es numérica (sin ceros a la izquierda)', () => {
    expect(variantesConsulta('45678')).toEqual(['45678', '45678 ', 45678]);
    expect(variantesConsulta('045678')).toEqual(['045678', '045678 ']);
  });
  it('nunca pasa de 30 valores por Ref', () => {
    expect(variantesConsulta('  Mi Ref Larga 123 ').length).toBeLessThanOrEqual(30);
  });
  it('sin clave no hay variantes', () => {
    expect(variantesConsulta('N/A')).toEqual([]);
  });
});

describe('cuentaParaDuplicado', () => {
  it('fuera canceladas y de prueba', () => {
    expect(cuentaParaDuplicado({ status: STATUS_CANCELADO })).toBe(false);
    expect(cuentaParaDuplicado({ statusNombre: 'Cancelado' })).toBe(false);
    expect(cuentaParaDuplicado({ esPrueba: true })).toBe(false);
    expect(cuentaParaDuplicado({ ref: 'PR.TR-1' })).toBe(false);
    expect(cuentaParaDuplicado({ ref: 'TR-1', status: 'x' })).toBe(true);
  });
});

describe('resumenOp', () => {
  it('revisada solo si la marca es de la Ref actual', () => {
    expect(r('1', 'PO 1', { refClienteRevisado: 'PO1' }).revisada).toBe(true);
    expect(r('1', 'PO 2', { refClienteRevisado: 'PO1' }).revisada).toBe(false);
    expect(r('1', 'PO 1').revisada).toBe(false);
  });
});

describe('detectarDuplicados', () => {
  it('en memoria: dos de la lista con la misma Ref (sin importar mayúsculas/espacios)', () => {
    const m = detectarDuplicados([r('a', 'PO 1'), r('b', 'po1'), r('c', 'PO2')], new Map());
    expect([...m.keys()].sort()).toEqual(['a', 'b']);
    expect(m.get('a')?.otras.map((x) => x.id)).toEqual(['b']);
  });
  it('con el servidor: una de la lista y otra que no está cargada', () => {
    const serv = new Map([['PO1', [r('a', 'PO1'), r('z', 'PO1', { facturaClienteInvoice: 'INV-9' })]]]);
    const m = detectarDuplicados([r('a', 'PO1')], serv);
    expect(m.get('a')?.otras.map((x) => x.id)).toEqual(['z']);
    expect(m.get('a')?.otras[0].facturada).toBe(true);
  });
  it('la misma operación del servidor no cuenta como duplicada (aunque su `id` de lista sea otro)', () => {
    const serv = new Map([['PO1', [r('docReal', 'PO1')]]]);
    const local = { ...r('idViejo', 'PO1'), ref: 'TR-docReal' };
    expect(detectarDuplicados([local], serv).size).toBe(0);
  });
  it('lo local manda: si la Ref se cambió en la lista, la versión vieja del servidor no cuenta', () => {
    // b tenía PO1 en el servidor, pero en la lista ya dice PO9.
    const serv = new Map([['PO1', [r('a', 'PO1'), r('b', 'PO1')]]]);
    const m = detectarDuplicados([r('a', 'PO1'), r('b', 'PO9')], serv);
    expect(m.size).toBe(0);
  });
  it('usa el ID real del servidor para escribir', () => {
    const serv = new Map([['PO1', [r('real', 'PO1'), r('z', 'PO1')]]]);
    const local = { ...r('lista', 'PO1'), ref: 'TR-real' };
    const info = detectarDuplicados([local], serv).get('lista');
    expect(info?.idReal).toBe('real');
    expect(info?.grupo.map((x) => x.id).sort()).toEqual(['real', 'z']);
  });
  it('folio repetido en el servidor: identidad por ID, no por consecutivo', () => {
    const serv = new Map([['PO1', [{ ...r('id1', 'PO1'), ref: 'TR-R' }, { ...r('id2', 'PO1'), ref: 'TR-R' }]]]);
    const local = { ...r('id1', 'PO1'), ref: 'TR-R' };
    expect(detectarDuplicados([local], serv).get('id1')?.otras.map((x) => x.id)).toEqual(['id2']);
  });
  it('con el folio en dos documentos y un ID de lista que no volvió, no adivina cuál es', () => {
    const serv = new Map([['PO1', [{ ...r('id1', 'PO1'), ref: 'TR-R' }, { ...r('id2', 'PO1'), ref: 'TR-R' }]]]);
    const local = { ...r('viejo', 'PO1'), ref: 'TR-R' };
    const info = detectarDuplicados([local], serv).get('viejo');
    expect(info?.idReal).toBe('viejo');
    expect(info?.otras.map((x) => x.id).sort()).toEqual(['id1', 'id2']);
  });
  it('una de la lista que ya no cuenta (cancelada, sin Ref) saca su copia vieja del servidor', () => {
    const serv = new Map([['PO1', [r('a', 'PO1'), r('b', 'PO1')]]]);
    const bCancelada = { ...r('b', 'PO1'), clave: '' };
    expect(detectarDuplicados([r('a', 'PO1'), bCancelada], serv).size).toBe(0);
  });
  it('revisada por otra persona: cuenta la marca del servidor', () => {
    const serv = new Map([['PO1', [r('a', 'PO1', { refClienteRevisado: 'PO1' }), r('z', 'PO1')]]]);
    expect(detectarDuplicados([r('a', 'PO1')], serv).get('a')?.revisada).toBe(true);
  });
  it('conserva la marca de revisada de la lista', () => {
    const m = detectarDuplicados([r('a', 'PO1', { refClienteRevisado: 'PO1' }), r('b', 'PO1')], new Map());
    expect(m.get('a')?.revisada).toBe(true);
    expect(m.get('b')?.revisada).toBe(false);
  });
});

describe('armarLotes', () => {
  it('lotes de máximo 30 valores sin partir las variantes de una Ref', () => {
    const v = new Map<string, (string | number)[]>();
    for (let i = 0; i < 12; i++) v.set(`R${i}`, ['a', 'b', 'c', 'd', 'e'].map((x) => `${x}${i}`));
    const lotes = armarLotes(v);
    expect(lotes.every((l) => l.valores.length <= 30)).toBe(true);
    expect(lotes.flatMap((l) => l.claves)).toHaveLength(12);
    expect(lotes[0].claves).toHaveLength(6);
  });
});

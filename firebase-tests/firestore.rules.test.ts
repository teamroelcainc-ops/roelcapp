// firebase-tests/firestore.rules.test.ts — ✅ V00437 (Fase 1.4)
// Pruebas de firestore.rules contra el EMULADOR (nunca contra producción).
// Correr: npm run test:rules   (requiere firebase-tools: npm i -g firebase-tools)
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-roelca',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'usuarios', 'admin1'), { nombre: 'Admin', roles: ['ADMIN'] });
    await setDoc(doc(db, 'usuarios', 'pers1'), { nombre: 'Tráfico', roles: ['Trafico'] });
    await setDoc(doc(db, 'usuarios', 'adminis1'), { nombre: 'Administrativo', roles: ['ADMINISTRATIVO'] });
    await setDoc(doc(db, 'usuarios', 'cli1'), { nombre: 'Cliente', tipoUsuario: 'Cliente ', empresasClienteIds: ['E1'] });
    await setDoc(doc(db, 'usuarios', 'inact1'), { nombre: 'Baja', roles: ['Trafico'], activo: false });
    await setDoc(doc(db, 'operaciones', 'op1'), { ref: 'TR-010126-001', operador: 'emp1', status: 's1' });
    await setDoc(doc(db, 'roles', 'r1'), { nombre: 'Trafico' });
    await setDoc(doc(db, 'configuracion', 'flags'), {});
    await setDoc(doc(db, 'configuracion', 'metas_operaciones'), {});
    await setDoc(doc(db, 'meta', 'versionesCatalogos'), {});
    await setDoc(doc(db, 'historial_actividad', 'h1'), { accion: 'x' });
  });
});

afterAll(async () => {
  await env.cleanup();
});

// Contextos: sin claims (transición) y con claims (ya sincronizados).
const sinClaims = (uid: string) => env.authenticatedContext(uid).firestore();
const conClaims = (uid: string, claims: Record<string, boolean>) => env.authenticatedContext(uid, claims).firestore();

describe('acceso general', () => {
  it('sin sesión no lee nada', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'operaciones', 'op1')));
  });
  it('una cuenta SIN documento en usuarios no lee nada (antes era admin)', async () => {
    await assertFails(getDoc(doc(sinClaims('fantasma'), 'operaciones', 'op1')));
  });
  it('personal sin claims (transición) lee y escribe operaciones', async () => {
    const db = sinClaims('pers1');
    await assertSucceeds(getDoc(doc(db, 'operaciones', 'op1')));
    await assertSucceeds(updateDoc(doc(db, 'operaciones', 'op1'), { status: 's2' }));
  });
  it('personal con claims no necesita documento', async () => {
    await assertSucceeds(getDoc(doc(conClaims('pers1', { personal: true, admin: false, cliente: false }), 'operaciones', 'op1')));
  });
  it('claims revocados (personal: false) no caen al respaldo del documento', async () => {
    await assertFails(getDoc(doc(conClaims('pers1', { personal: false, admin: false, cliente: false }), 'operaciones', 'op1')));
  });
  it('usuario desactivado no lee', async () => {
    await assertFails(getDoc(doc(sinClaims('inact1'), 'operaciones', 'op1')));
  });
});

describe('clientes de la app móvil', () => {
  it('no leen colecciones', async () => {
    await assertFails(getDoc(doc(sinClaims('cli1'), 'operaciones', 'op1')));
    await assertFails(getDoc(doc(conClaims('cli1', { personal: false, admin: false, cliente: true }), 'operaciones', 'op1')));
  });
  it('leen su propio perfil y actualizan solo sus campos de sesión', async () => {
    const db = sinClaims('cli1');
    await assertSucceeds(getDoc(doc(db, 'usuarios', 'cli1')));
    await assertSucceeds(updateDoc(doc(db, 'usuarios', 'cli1'), { ultimoAccesoMovil: '2026-10-10' }));
    await assertFails(updateDoc(doc(db, 'usuarios', 'cli1'), { empresasClienteIds: ['E1', 'E2'] }));
  });
});

describe('perfil propio y roles', () => {
  it('nadie se sube sus propios roles', async () => {
    await assertFails(updateDoc(doc(sinClaims('pers1'), 'usuarios', 'pers1'), { roles: ['ADMIN'] }));
    await assertFails(updateDoc(doc(sinClaims('pers1'), 'usuarios', 'pers1'), { modulosExtra: ['facturacionClientes'] }));
  });
  it('sí puede marcar su sesión y su foto', async () => {
    await assertSucceeds(updateDoc(doc(sinClaims('pers1'), 'usuarios', 'pers1'), { isOnline: true, ultimoAcceso: 'x' }));
    await assertSucceeds(updateDoc(doc(sinClaims('pers1'), 'usuarios', 'pers1'), { fotoPerfil: 'url' }));
  });
  it('el personal no edita perfiles ajenos ni roles; el admin sí', async () => {
    await assertFails(updateDoc(doc(sinClaims('pers1'), 'usuarios', 'admin1'), { nombre: 'x' }));
    await assertFails(setDoc(doc(sinClaims('pers1'), 'roles', 'r2'), { nombre: 'Nuevo' }));
    await assertSucceeds(setDoc(doc(sinClaims('admin1'), 'roles', 'r2'), { nombre: 'Nuevo' }));
    await assertSucceeds(updateDoc(doc(sinClaims('admin1'), 'usuarios', 'pers1'), { roles: ['Trafico', 'Facturacion'] }));
  });
  it('un rol "ADMINISTRATIVO" no es admin', async () => {
    await assertFails(setDoc(doc(sinClaims('adminis1'), 'roles', 'r3'), { nombre: 'X' }));
  });
  it('admin se revisa en el documento: un claim admin viejo no basta', async () => {
    await assertFails(setDoc(doc(conClaims('pers1', { personal: true, admin: true, cliente: false }), 'roles', 'r4'), { nombre: 'Y' }));
    await assertSucceeds(setDoc(doc(conClaims('admin1', { personal: true, admin: true, cliente: false }), 'roles', 'r4'), { nombre: 'Y' }));
  });
  it('con claim personal pero perfil borrado: lee (≤1 h) pero ya no escribe', async () => {
    const db = conClaims('borrado1', { personal: true, admin: false, cliente: false });
    await assertSucceeds(getDoc(doc(db, 'operaciones', 'op1')));
    await assertFails(updateDoc(doc(db, 'operaciones', 'op1'), { status: 'x' }));
  });
});

describe('configuración, bitácora y meta', () => {
  it('banderas y seguridad: solo admin', async () => {
    await assertFails(setDoc(doc(sinClaims('pers1'), 'configuracion', 'flags'), { consultasCanonicas: true }));
    await assertSucceeds(setDoc(doc(sinClaims('admin1'), 'configuracion', 'flags'), { consultasCanonicas: false }));
    await assertFails(setDoc(doc(sinClaims('pers1'), 'configuracion', 'seguridad'), { ipOficina: '1.2.3.4' }));
  });
  it('metas y datos de la empresa: el personal sí los edita', async () => {
    await assertSucceeds(setDoc(doc(sinClaims('pers1'), 'configuracion', 'metas_operaciones'), { transfer: 10 }, { merge: true }));
    await assertSucceeds(setDoc(doc(sinClaims('pers1'), 'configuracion', 'empresa'), { nombre: 'Roelca' }, { merge: true }));
  });
  it('bitácora: se agrega, no se edita ni se borra', async () => {
    const db = sinClaims('pers1');
    await assertSucceeds(addDoc(collection(db, 'historial_actividad'), { accion: 'y' }));
    await assertFails(updateDoc(doc(db, 'historial_actividad', 'h1'), { accion: 'z' }));
    await assertFails(deleteDoc(doc(db, 'historial_actividad', 'h1')));
  });
  it('saldos_corrientes (V00441): se lee, solo el servidor escribe', async () => {
    await assertSucceeds(getDoc(doc(sinClaims('pers1'), 'saldos_corrientes', 'diesel_x')));
    await assertFails(setDoc(doc(sinClaims('pers1'), 'saldos_corrientes', 'diesel_x'), { dias: {} }));
  });
  it('meta: se lee, no se escribe', async () => {
    await assertSucceeds(getDoc(doc(sinClaims('pers1'), 'meta', 'versionesCatalogos')));
    await assertFails(setDoc(doc(sinClaims('admin1'), 'meta', 'versionesCatalogos'), { x: 1 }));
  });
});

describe('contrato de la app móvil (operador = personal)', () => {
  it('crea horarios, cambia el status de la operación y escribe su rastreo', async () => {
    const db = sinClaims('pers1');
    await assertSucceeds(addDoc(collection(db, 'horarios'), { operacionId: 'op1', origen: 'app-movil' }));
    await assertSucceeds(updateDoc(doc(db, 'operaciones', 'op1'), { status: 's3', statusNombre: 'Verde' }));
    await assertSucceeds(setDoc(doc(db, 'rastreo_operaciones', 'op1'), { activo: true }));
    await assertSucceeds(setDoc(doc(db, 'rastreo_operaciones', 'op1', 'puntos', 't1'), { puntos: [] }));
  });
});

// ✅ V00441 (Fase 5.8) — dinero: con la bandera dineroPorServidor, solo el servidor.
describe('dinero (bandera dineroPorServidor)', () => {
  const ponerBandera = (valor: boolean) => env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'configuracion', 'flags'), { dineroPorServidor: valor }, { merge: true });
    await setDoc(doc(db, 'facturas_clientes', 'F1'), { invoice: 'A-1', subtotalMonedaFactura: 100, montoPagado: 0, statusFactura: 'Enviada' });
    await setDoc(doc(db, 'facturas_proveedores', 'FP1'), { invoice: 'B-1', subtotalMonedaFactura: 50 });
    await setDoc(doc(db, 'pagos', 'P1'), { tipo: 'cliente', monto: 10, facturas: [] });
    await setDoc(doc(db, 'pagos', 'PM1'), { tipo: 'mtto', monto: 10, facturas: [] });
  });

  describe('apagada (como antes)', () => {
    beforeAll(() => ponerBandera(false));
    it('el personal escribe dinero de facturas y pagos', async () => {
      const db = sinClaims('pers1');
      await assertSucceeds(updateDoc(doc(db, 'facturas_clientes', 'F1'), { montoPagado: 5, saldoPendiente: 95 }));
      await assertSucceeds(setDoc(doc(db, 'facturas_clientes', 'F2'), { invoice: 'A-2', subtotalMonedaFactura: 10 }));
      await assertSucceeds(deleteDoc(doc(db, 'facturas_clientes', 'F2')));
      await assertSucceeds(setDoc(doc(db, 'pagos', 'P2'), { tipo: 'cliente', monto: 5 }));
      await assertSucceeds(updateDoc(doc(db, 'pagos', 'P1'), { monto: 12 }));
    });
    it('renglones y aplicaciones: nunca desde el navegador', async () => {
      const db = sinClaims('pers1');
      await assertFails(setDoc(doc(db, 'facturas_clientes', 'F1', 'renglones', 'o1'), { montoCentavos: 100 }));
      await assertFails(setDoc(doc(db, 'facturas_proveedores', 'FP1', 'aplicaciones', 'P1'), { aplicadoCentavos: 100 }));
      await assertSucceeds(getDoc(doc(db, 'facturas_clientes', 'F1', 'renglones', 'o1')));
    });
  });

  describe('encendida', () => {
    beforeAll(() => ponerBandera(true));
    afterAll(() => ponerBandera(false));
    it('no crea, borra ni cambia el dinero de una factura', async () => {
      const db = sinClaims('pers1');
      await assertFails(setDoc(doc(db, 'facturas_clientes', 'F3'), { invoice: 'A-3' }));
      await assertFails(deleteDoc(doc(db, 'facturas_clientes', 'F1')));
      await assertFails(updateDoc(doc(db, 'facturas_clientes', 'F1'), { montoPagado: 50 }));
      await assertFails(updateDoc(doc(db, 'facturas_clientes', 'F1'), { subtotalMonedaFactura: 1 }));
      await assertFails(updateDoc(doc(db, 'facturas_proveedores', 'FP1'), { totalManualCentavos: 1 }));
      await assertFails(updateDoc(doc(db, 'facturas_proveedores', 'FP1'), { operacionesIds: ['x'] }));
    });
    it('sí cambia documento, status de factura y nombres', async () => {
      const db = sinClaims('pers1');
      await assertSucceeds(updateDoc(doc(db, 'facturas_clientes', 'F1'), { docFacturaUrl: 'u', docFacturaNombre: 'f.pdf', statusFactura: 'Pagada' }));
      await assertSucceeds(updateDoc(doc(db, 'facturas_clientes', 'F1'), { clienteNombre: 'Acme' }));
      await assertSucceeds(updateDoc(doc(db, 'facturas_proveedores', 'FP1'), { rateProveedor: { a: 1 } }));
    });
    it('pagos de clientes/proveedores: solo datos sin dinero; MTTO sigue igual', async () => {
      const db = sinClaims('pers1');
      await assertFails(setDoc(doc(db, 'pagos', 'P3'), { tipo: 'cliente', monto: 5 }));
      await assertFails(updateDoc(doc(db, 'pagos', 'P1'), { monto: 99 }));
      await assertFails(updateDoc(doc(db, 'pagos', 'P1'), { tipo: 'mtto' }));
      await assertFails(deleteDoc(doc(db, 'pagos', 'P1')));
      await assertSucceeds(updateDoc(doc(db, 'pagos', 'P1'), { referencia: 'R-1', observaciones: 'ok', entidadNombre: 'Acme' }));
      await assertSucceeds(setDoc(doc(db, 'pagos', 'PM2'), { tipo: 'mtto', monto: 5 }));
      await assertSucceeds(updateDoc(doc(db, 'pagos', 'PM1'), { monto: 7 }));
      await assertFails(updateDoc(doc(db, 'pagos', 'PM1'), { tipo: 'proveedor' }));
      await assertSucceeds(deleteDoc(doc(db, 'pagos', 'PM2')));
    });
  });
});

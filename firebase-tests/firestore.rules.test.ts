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

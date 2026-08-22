// src/config/firebase.ts
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
  memoryLocalCache,
  collection, addDoc, updateDoc, deleteDoc, doc,
} from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import type { DocumentData, UpdateData } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Inicializar Firebase (Solo una vez)
const app = initializeApp(firebaseConfig);

// ✅ GUARDIÁN DE ESPACIO: los cachés regenerables de la app (catálogos
//    cat_v1__/cat_v2__, etc.) pueden llenar los ~5MB de localStorage y eso
//    tumbaba la inicialización de Firestore (QuotaExceededError → assertion
//    b815 → app congelada en "Cargando..."). Antes de arrancar, si el
//    almacenamiento viene saturado, se liberan SOLO las claves de caché
//    regenerable (nunca las de sesión de Firebase ni preferencias).
const PREFIJOS_CACHE_REGENERABLE = ['cat_v1__', 'cat_v2__', 'flujo_v1__'];
const liberarEspacioSiEsNecesario = () => {
  try {
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      total += k.length + (localStorage.getItem(k)?.length || 0);
    }
    // ~3.5MB de umbral (los navegadores dan ~5MB por origen).
    if (total > 3_500_000) {
      const aBorrar: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i) || '';
        if (PREFIJOS_CACHE_REGENERABLE.some(p => k.startsWith(p))) aBorrar.push(k);
      }
      aBorrar.forEach(k => localStorage.removeItem(k));
      console.warn(`[storage] Se liberaron ${aBorrar.length} cachés regenerables (almacenamiento saturado).`);
    }
  } catch { /* almacenamiento bloqueado: continuar */ }
};
liberarEspacioSiEsNecesario();

// ✅ CACHÉ PERSISTENTE DE FIRESTORE (IndexedDB).
//    · Los datos ya vistos quedan guardados EN EL DISPOSITIVO: al reabrir la
//      app, las vistas pintan al instante desde el caché mientras el SDK
//      sincroniza en segundo plano (sensación de app instalada).
//    · Los listeners onSnapshot sirven primero desde caché (latencia ~0) y
//      solo se facturan lecturas por los documentos que CAMBIARON.
//    · La app funciona offline: consultas y escrituras se encolan y se
//      sincronizan solas al volver la conexión.
//    · persistentSingleTabManager: coordina SIN usar localStorage (el manager
//      multi-pestaña escribía en localStorage y crasheaba con la cuota llena).
//      Si hay varias pestañas, la primera usa persistencia y las demás operan
//      normal contra el servidor.
//    · Si el navegador no permite IndexedDB (p. ej. modo privado estricto),
//      se cae a caché EN MEMORIA y la app sigue funcionando.
let dbInterno: Firestore;
try {
  dbInterno = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentSingleTabManager(undefined) }),
  });
} catch (e) {
  console.warn('[firestore] Persistencia no disponible; usando caché en memoria.', e);
  dbInterno = initializeFirestore(app, { localCache: memoryLocalCache() });
}
export const db = dbInterno;

export const auth = getAuth(app);
// ✅ Storage ligado explícitamente a la app principal (mismo proyecto/bucket que db/auth)
export const storage = getStorage(app);

// --- ESTAS SON LAS FUNCIONES CRUD ---
// ✅ Sin `any` en las firmas: aceptan cualquier registro tipado del proyecto.
//    El cast interno a los tipos del SDK está documentado: updateDoc exige
//    índices con notación de punto (`a.b`) que nuestros tipos de dominio no
//    declaran, pero el dato en runtime es un objeto plano válido.

// ✅ NUEVO (V00109) — INVALIDACIÓN CENTRAL DE CACHÉS DE CATÁLOGO: los módulos
//   (Operaciones, Facturación, Estadísticas…) cachean los catálogos en
//   localStorage (cat_v2__*) hasta 24 h. Antes, solo el módulo de Catálogos
//   limpiaba esas cachés; al editar en Bases de Datos (empresas, empleados,
//   unidades…) o Convenios, el resto de la app seguía mostrando valores viejos
//   hasta que la caché expiraba. Ahora, CUALQUIER escritura hecha con estos
//   helpers sobre una colección tipo catálogo borra las cachés locales, y los
//   módulos re-descargan datos frescos en su siguiente carga.
const COLECCIONES_TIPO_CATALOGO = new Set([
  'empresas', 'unidades', 'empleados', 'remolques', 'proveedores_unidad',
  'convenios_clientes', 'convenios_clientes_detalles',
  'convenios_proveedores', 'convenios_proveedores_detalles',
  'tipo_cambio', 'direcciones',
]);
const invalidarCachesCatalogosLocales = (nombreColeccion: string) => {
  try {
    if (!nombreColeccion.startsWith('catalogo_') && !COLECCIONES_TIPO_CATALOGO.has(nombreColeccion)) return;
    Object.keys(localStorage)
      .filter((k) => k.startsWith('cat_v2__') || k.startsWith('cat_v1__'))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('catalogos_invalidados_en', String(Date.now()));
  } catch { /* almacenamiento no disponible: continuar sin caché */ }
};

export const agregarRegistro = async (nombreColeccion: string, data: object) => {
  const ref = await addDoc(collection(db, nombreColeccion), data as DocumentData);
  invalidarCachesCatalogosLocales(nombreColeccion);
  return ref;
};

export const actualizarRegistro = async (nombreColeccion: string, id: string, data: object) => {
  const res = await updateDoc(doc(db, nombreColeccion, id), data as UpdateData<DocumentData>);
  invalidarCachesCatalogosLocales(nombreColeccion);
  return res;
};

export const eliminarRegistro = async (nombreColeccion: string, id: string) => {
  const res = await deleteDoc(doc(db, nombreColeccion, id));
  invalidarCachesCatalogosLocales(nombreColeccion);
  return res;
};

// --- TRUCO PARA CREAR USUARIOS SIN CERRAR SESIÓN DEL ADMIN ---
// Inicializamos una app secundaria con la misma configuración
const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
export const secondaryAuth = getAuth(secondaryApp);

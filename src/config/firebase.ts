// src/config/firebase.ts
import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection, addDoc, updateDoc, deleteDoc, doc,
} from "firebase/firestore";
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

// ✅ CACHÉ PERSISTENTE DE FIRESTORE (IndexedDB, multi-pestaña).
//    · Los datos ya vistos quedan guardados EN EL DISPOSITIVO: al reabrir la
//      app, las vistas pintan al instante desde el caché mientras el SDK
//      sincroniza en segundo plano (sensación de app instalada).
//    · Los listeners onSnapshot sirven primero desde caché (latencia ~0) y
//      solo se facturan lecturas por los documentos que CAMBIARON.
//    · La app funciona offline: consultas y escrituras se encolan y se
//      sincronizan solas al volver la conexión.
//    · persistentMultipleTabManager permite varias pestañas sin conflicto.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const auth = getAuth(app);
// ✅ Storage ligado explícitamente a la app principal (mismo proyecto/bucket que db/auth)
export const storage = getStorage(app);

// --- ESTAS SON LAS FUNCIONES CRUD ---
// ✅ Sin `any` en las firmas: aceptan cualquier registro tipado del proyecto.
//    El cast interno a los tipos del SDK está documentado: updateDoc exige
//    índices con notación de punto (`a.b`) que nuestros tipos de dominio no
//    declaran, pero el dato en runtime es un objeto plano válido.
export const agregarRegistro = async (nombreColeccion: string, data: object) => {
  return await addDoc(collection(db, nombreColeccion), data as DocumentData);
};

export const actualizarRegistro = async (nombreColeccion: string, id: string, data: object) => {
  return await updateDoc(doc(db, nombreColeccion, id), data as UpdateData<DocumentData>);
};

export const eliminarRegistro = async (nombreColeccion: string, id: string) => {
  return await deleteDoc(doc(db, nombreColeccion, id));
};

// --- TRUCO PARA CREAR USUARIOS SIN CERRAR SESIÓN DEL ADMIN ---
// Inicializamos una app secundaria con la misma configuración
const secondaryApp = initializeApp(firebaseConfig, 'SecondaryApp');
export const secondaryAuth = getAuth(secondaryApp);

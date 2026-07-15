// src/features/autorizaciones/autorizaciones.ts
// ============================================================================
// ✅ MÓDULO DE AUTORIZACIONES (núcleo compartido)
//
//   · config_autorizaciones/{modulo}  → matriz de qué requiere autorización:
//       acciones (crear/editar/borrar) y campos específicos, cada uno con la
//       lista de roles a los que aplica (vacía = aplica a TODOS los roles).
//       Los usuarios ADMIN siempre están exentos.
//   · solicitudes_autorizacion        → cola de aprobación: cuando un usuario
//       sin exención intenta una acción controlada, el cambio NO se guarda;
//       se crea una solicitud que el Admin aprueba (se aplica automáticamente)
//       o rechaza desde el módulo "Autorizaciones".
// ============================================================================
import { doc, getDoc, getDocs, collection, setDoc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../../config/firebase';

// ── Tipos ───────────────────────────────────────────────────────────────────
export type AccionAut = 'crear' | 'editar' | 'borrar';

export interface ReglaAut {
  requiere: boolean;
  roles: string[]; // vacío = aplica a todos los roles (excepto Admin)
}

export interface ConfigModuloAut {
  acciones: Partial<Record<AccionAut, ReglaAut>>;
  campos: Record<string, ReglaAut>; // key de campo -> regla (aplica al EDITAR ese campo)
}

export interface SolicitudAut {
  id?: string;
  modulo: string;            // clave del módulo (ej. 'operaciones')
  moduloLabel: string;
  accion: AccionAut;
  coleccion: string;         // colección de Firestore donde se aplica
  docId?: string;            // requerido para editar/borrar
  referencia?: string;       // texto identificador legible (ej. ref de la operación)
  camposAfectados?: string[];
  datosPropuestos?: Record<string, any>;
  datosAnteriores?: Record<string, any>;
  motivosControl?: string[]; // por qué requirió autorización
  estado: 'pendiente' | 'aprobada' | 'rechazada';
  solicitanteUid: string;
  solicitanteNombre: string;
  solicitanteRoles: string[];
  creadaEn: string;          // ISO
  resueltaEn?: string;
  resueltaPorNombre?: string;
  motivoRechazo?: string;
  // 'segura' = usar el guardado especial del módulo al aprobar (ej. consecutivo
  // de referencia en operaciones). La aplica el AutorizacionesDashboard.
  estrategiaCrear?: 'directa' | 'segura';
}

// ── Registro de módulos autorizables ────────────────────────────────────────
// TODOS los módulos aparecen en el configurador. Los campos detallados se van
// agregando conforme se integra cada formulario (hoy: operaciones y tipoCambio).
export interface ModuloAutorizable {
  clave: string;
  label: string;
  coleccion: string;
  campos: { key: string; label: string }[];
  integrado: boolean; // true = su formulario ya intercepta el guardado
}

export const MODULOS_AUTORIZABLES: ModuloAutorizable[] = [
  {
    clave: 'operaciones', label: 'Operaciones', coleccion: 'operaciones', integrado: true,
    campos: [
      { key: 'ref', label: 'Referencia' },
      { key: 'tipoOperacionId', label: 'Tipo de Operación' },
      { key: 'fechaServicio', label: 'Fecha de Servicio' },
      { key: 'clientePaga', label: 'Cliente (Paga)' },
      { key: 'convenio', label: 'Convenio (Tarifa) Cliente' },
      { key: 'trafico', label: 'Importación / Exportación' },
      { key: 'carga', label: 'Cargada / Vacía' },
      { key: 'numeroRemolque', label: '# de Remolque' },
      { key: 'refCliente', label: 'Ref Cliente' },
      { key: 'origen', label: 'Origen' },
      { key: 'destino', label: 'Destino' },
      { key: 'proveedorUnidad', label: 'Proveedor de Transporte' },
      { key: 'unidad', label: 'Unidad' },
      { key: 'operador', label: 'Operador' },
      { key: 'sueldoOperador', label: 'Sueldo Operador' },
      { key: 'sueldoExtra', label: 'Sueldo Extra' },
      { key: 'combustible', label: 'Combustible' },
      { key: 'combustibleExtra', label: 'Combustible Extra' },
      { key: 'montoManifiesto', label: 'Costo Manifiesto' },
      { key: 'convenioProveedor', label: 'Convenio (Tarifa) Proveedor' },
      { key: 'totalAPagarProv', label: 'Monto a Pagar Proveedor' },
      { key: 'cargosAdicionalesProv', label: 'Cargos Adicionales (Proveedor)' },
      { key: 'puenteId', label: 'Caseta / Puente' },
      { key: 'montoConvenioCliente', label: 'Monto Convenio Cliente' },
      { key: 'cargosAdicionales', label: 'Cargos Adicionales (Cliente)' },
      { key: 'tipoCambioAprobado', label: 'Tipo de Cambio Aprobado' },
      { key: 'status', label: 'Status' },
    ],
  },
  {
    clave: 'tipoCambio', label: 'Tipo de Cambio', coleccion: 'tipo_cambio', integrado: true,
    campos: [
      { key: 'fecha', label: 'Fecha' },
      { key: 'tcDof', label: 'T.C. DOF' },
    ],
  },
  // ── Pendientes de integrar (aparecen en el configurador; sus formularios se conectan después) ──
  { clave: 'serviciosCompletados', label: 'Servicios Completados', coleccion: 'operaciones', campos: [], integrado: false },
  { clave: 'serviciosCancelados', label: 'Servicios Cancelados', coleccion: 'operaciones', campos: [], integrado: false },
  { clave: 'facturacionClientes', label: 'Facturación de Clientes', coleccion: 'facturas_clientes', campos: [], integrado: false },
  { clave: 'facturacionProveedores', label: 'Facturación de Proveedores', coleccion: 'facturas_proveedores', campos: [], integrado: false },
  { clave: 'referenciasDiesel', label: 'Referencias del Diesel', coleccion: 'referencias_diesel', campos: [], integrado: false },
  { clave: 'referenciasPuentes', label: 'Referencias de Puentes', coleccion: 'referencias_puentes', campos: [], integrado: false },
  { clave: 'referenciasNomina', label: 'Nómina', coleccion: 'referencias_nomina', campos: [], integrado: false },
  { clave: 'deducciones', label: 'Deducciones', coleccion: 'deducciones', campos: [], integrado: false },
  { clave: 'mtto', label: 'MTTO', coleccion: 'mtto', campos: [], integrado: false },
  { clave: 'costosAdicionales', label: 'Costos Adicionales', coleccion: 'costos_adicionales', campos: [], integrado: false },
  { clave: 'empresas', label: 'Empresas', coleccion: 'empresas', campos: [], integrado: false },
  { clave: 'contactos', label: 'Contactos', coleccion: 'contactos', campos: [], integrado: false },
  { clave: 'direcciones', label: 'Direcciones', coleccion: 'direcciones', campos: [], integrado: false },
  { clave: 'conveniosClientes', label: 'Convenios de Clientes', coleccion: 'convenios_clientes', campos: [], integrado: false },
  { clave: 'conveniosProveedores', label: 'Convenios de Proveedores', coleccion: 'convenios_proveedores', campos: [], integrado: false },
  { clave: 'colaboradores', label: 'Colaboradores', coleccion: 'empleados', campos: [], integrado: false },
  { clave: 'unidades', label: 'Unidades Propias', coleccion: 'unidades', campos: [], integrado: false },
  { clave: 'remolques', label: 'Remolques', coleccion: 'remolques', campos: [], integrado: false },
  { clave: 'proveedoresUnidad', label: 'Proveedores de Unidad', coleccion: 'proveedores_unidad', campos: [], integrado: false },
  { clave: 'unidadesProveedor', label: 'Unidades del Proveedor', coleccion: 'unidades_proveedor', campos: [], integrado: false },
  { clave: 'combustible', label: 'Combustible', coleccion: 'combustible', campos: [], integrado: false },
  { clave: 'catalogos', label: 'Catálogos', coleccion: 'catalogos', campos: [], integrado: false },
];

export const ACCIONES: { key: AccionAut; label: string }[] = [
  { key: 'crear', label: 'Agregar' },
  { key: 'editar', label: 'Editar' },
  { key: 'borrar', label: 'Borrar' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────
const normAut = (s: any) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();

export const esRolAdmin = (roles: string[]): boolean =>
  (roles || []).some(r => normAut(r).includes('ADMIN'));

/** Usuario actual con sus roles (misma lógica que el resto de la app). */
export const obtenerUsuarioAut = async (): Promise<{ uid: string; nombre: string; roles: string[]; esAdmin: boolean }> => {
  const u = auth.currentUser;
  // Sin sesión con doc (bypass) = acceso total, se trata como Admin.
  if (!u) return { uid: '', nombre: 'Sistema', roles: ['ADMIN'], esAdmin: true };
  try {
    const snap = await getDoc(doc(db, 'usuarios', u.uid));
    if (!snap.exists()) return { uid: u.uid, nombre: u.email || 'Usuario', roles: ['ADMIN'], esAdmin: true };
    const data: any = snap.data();
    const roles: string[] = Array.isArray(data.roles) ? data.roles : (data.rol ? [String(data.rol)] : []);
    return { uid: u.uid, nombre: data.nombre || u.email || 'Usuario', roles, esAdmin: esRolAdmin(roles) };
  } catch {
    return { uid: u.uid, nombre: u.email || 'Usuario', roles: [], esAdmin: false };
  }
};

/** Config de un módulo (o null si no se ha configurado). */
export const cargarConfigModulo = async (modulo: string): Promise<ConfigModuloAut | null> => {
  try {
    const snap = await getDoc(doc(db, 'config_autorizaciones', modulo));
    if (!snap.exists()) return null;
    const d: any = snap.data();
    return { acciones: d.acciones || {}, campos: d.campos || {} };
  } catch (e) {
    console.error('Error cargando config de autorizaciones:', modulo, e);
    return null;
  }
};

const reglaAplica = (regla: ReglaAut | undefined, rolesUsuario: string[]): boolean => {
  if (!regla || !regla.requiere) return false;
  const objetivo = (regla.roles || []).filter(Boolean);
  if (objetivo.length === 0) return true; // sin roles = aplica a todos
  const set = new Set(objetivo.map(normAut));
  return (rolesUsuario || []).some(r => set.has(normAut(r)));
};

/**
 * Evalúa si una acción requiere autorización para el usuario.
 *  · Admin siempre exento.
 *  · 'editar' también revisa reglas por CAMPO sobre los campos modificados.
 */
export const evaluarAutorizacion = (
  config: ConfigModuloAut | null,
  accion: AccionAut,
  usuario: { roles: string[]; esAdmin: boolean },
  camposModificados: string[] = [],
  etiquetasCampos: Record<string, string> = {},
): { requiere: boolean; motivos: string[]; camposControlados: string[] } => {
  if (!config || usuario.esAdmin) return { requiere: false, motivos: [], camposControlados: [] };
  const motivos: string[] = [];
  const camposControlados: string[] = [];

  if (reglaAplica(config.acciones?.[accion], usuario.roles)) {
    const nombreAccion = ACCIONES.find(a => a.key === accion)?.label || accion;
    motivos.push(`La acción "${nombreAccion}" requiere autorización.`);
  }
  if (accion === 'editar') {
    camposModificados.forEach(campo => {
      if (reglaAplica(config.campos?.[campo], usuario.roles)) {
        camposControlados.push(campo);
        motivos.push(`El campo "${etiquetasCampos[campo] || campo}" requiere autorización para editarse.`);
      }
    });
  }
  return { requiere: motivos.length > 0, motivos, camposControlados };
};

/** Diff superficial: claves de `nuevos` cuyo valor cambió respecto a `anteriores`. */
export const camposModificadosDe = (nuevos: Record<string, any>, anteriores: Record<string, any>): string[] => {
  const cambios: string[] = [];
  Object.keys(nuevos || {}).forEach(k => {
    const a = anteriores?.[k];
    const b = nuevos[k];
    const sa = typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a ?? '');
    const sb = typeof b === 'object' && b !== null ? JSON.stringify(b) : String(b ?? '');
    if (sa !== sb) cambios.push(k);
  });
  return cambios;
};

/** Crea la solicitud pendiente. Devuelve el id. */
export const crearSolicitudAutorizacion = async (s: Omit<SolicitudAut, 'estado' | 'creadaEn'>): Promise<string> => {
  const payload: SolicitudAut = {
    ...s,
    // Firestore no acepta undefined
    docId: s.docId || '',
    referencia: s.referencia || '',
    camposAfectados: s.camposAfectados || [],
    datosPropuestos: s.datosPropuestos || {},
    datosAnteriores: s.datosAnteriores || {},
    motivosControl: s.motivosControl || [],
    estrategiaCrear: s.estrategiaCrear || 'directa',
    estado: 'pendiente',
    creadaEn: new Date().toISOString(),
  };
  Object.keys(payload as any).forEach(k => { if ((payload as any)[k] === undefined) delete (payload as any)[k]; });
  const ref = await addDoc(collection(db, 'solicitudes_autorizacion'), payload as any);
  return ref.id;
};

/** Guarda la config de un módulo (compartida para todos). */
export const guardarConfigModulo = async (modulo: string, config: ConfigModuloAut): Promise<void> => {
  await setDoc(doc(db, 'config_autorizaciones', modulo), {
    ...config,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
};

/** Aplica una solicitud aprobada de forma genérica (editar/borrar/crear directa). */
export const aplicarSolicitudGenerica = async (s: SolicitudAut): Promise<void> => {
  if (s.accion === 'editar') {
    if (!s.docId) throw new Error('La solicitud de edición no tiene documento destino.');
    await updateDoc(doc(db, s.coleccion, s.docId), s.datosPropuestos || {});
  } else if (s.accion === 'borrar') {
    if (!s.docId) throw new Error('La solicitud de borrado no tiene documento destino.');
    await deleteDoc(doc(db, s.coleccion, s.docId));
  } else {
    await addDoc(collection(db, s.coleccion), s.datosPropuestos || {});
  }
};

// Re-export de utilidades de Firestore que usa el dashboard (evita imports dobles).
export { getDocs, collection, updateDoc, doc, db };
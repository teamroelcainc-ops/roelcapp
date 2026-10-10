// src/shared/dominio/nombres.ts
// ---------------------------------------------------------------------------
// ✅ V00442 (Fase 6.2) — EL mapa de copias de nombres (maestro → destinos) y sus
// reglas, sin Firebase. Lo usan el trigger de propagación (functions/src/propagacion.ts)
// y el script que pone todo al día (functions/scripts/propagarNombres.ts).
// Reglas de EMPRESA = las del formulario de operación (V00271/V00354):
//   · razón social → Cliente (Paga), Cliente Mercancía, Proveedor de Transporte,
//     facturas, pagos, tarifarios, convenios, diésel (V00342);
//   · nombre corto → Origen, Destino y Prov. Servicios (lo que muestra el buscador).
// ---------------------------------------------------------------------------
type Datos = Record<string, unknown>;
const txt = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

export interface Destino {
  coleccion: string;
  campoId: string;
  campoNombre: string;
  campoIdCanonico?: string;
  /** Regla de nombre para ESTE destino (si no, la del maestro). */
  regla?: (d: Datos) => string;
}
export interface Maestro { coleccion: string; nombre: (d: Datos) => string; destinos: readonly Destino[] }

const nombreCortoDe = (e: Datos): string => txt(e.nombreCorto ?? e.nombre_corto ?? e.nombrecorto ?? e.shortName ?? e.alias);
/** Razón social (FormularioOperacion.razonSocialEmpresa). */
export const razonSocialEmpresa = (e: Datos): string => txt(e.razonSocial) || txt(e.nombre) || txt(e.empresa) || nombreCortoDe(e);
/** Nombre que muestra el buscador (FormularioOperacion.nombreEmpresaMostrar). */
export const nombreMostrarEmpresa = (e: Datos): string => nombreCortoDe(e) || txt(e.nombre) || txt(e.empresa) || txt(e.razonSocial);

const op = (campoId: string, campoNombre: string, campoIdCanonico?: string, regla?: (d: Datos) => string): Destino =>
  ({ coleccion: 'operaciones', campoId, campoNombre, campoIdCanonico, regla });

/** EL mapa: maestro → (colección, campo con su ID, campo con su nombre[, regla]). */
export const MAESTROS: readonly Maestro[] = [
  {
    coleccion: 'empresas', nombre: razonSocialEmpresa, destinos: [
      op('clientePaga', 'clientePagaNombre', 'clientePagaId'), op('clientePaga', 'clienteNombre', 'clientePagaId'),
      op('clienteMercancia', 'clienteMercanciaNombre', 'clienteMercanciaId'), op('proveedorUnidad', 'proveedorUnidadNombre', 'proveedorUnidadId'),
      op('provServicios', 'provServiciosNombre', 'provServiciosId', nombreMostrarEmpresa),
      op('origen', 'origenNombre', 'origenId', nombreMostrarEmpresa), op('destino', 'destinoNombre', 'destinoId', nombreMostrarEmpresa),
      { coleccion: 'facturas_clientes', campoId: 'clienteId', campoNombre: 'clienteNombre' },
      { coleccion: 'facturas_proveedores', campoId: 'proveedorId', campoNombre: 'proveedorNombre' },
      { coleccion: 'pagos', campoId: 'entidadId', campoNombre: 'entidadNombre', campoIdCanonico: 'empresaId' },
      { coleccion: 'tarifario_clientes', campoId: 'clienteId', campoNombre: 'clienteNombre' },
      { coleccion: 'tarifario_proveedores', campoId: 'proveedorId', campoNombre: 'proveedorNombre' },
      { coleccion: 'convenios_clientes', campoId: 'clienteId', campoNombre: 'clienteNombre' },
      { coleccion: 'convenios_proveedores', campoId: 'proveedorId', campoNombre: 'proveedorNombre' },
      { coleccion: 'convenios_clientes_detalles', campoId: 'clienteId', campoNombre: 'clienteNombre' },
      { coleccion: 'convenios_proveedores_detalles', campoId: 'proveedorId', campoNombre: 'proveedorNombre' },
      { coleccion: 'unidades_proveedor', campoId: 'proveedorId', campoNombre: 'proveedorNombre' },
      { coleccion: 'referencias_diesel', campoId: 'proveedorId', campoNombre: 'proveedorNombre' },
    ],
  },
  { coleccion: 'catalogo_status_servicio', nombre: (d) => txt(d.nombre) || txt(d.descripcion), destinos: [op('status', 'statusNombre', 'statusId')] },
  { coleccion: 'catalogo_tipo_operacion', nombre: (d) => txt(d.tipo_operacion), destinos: [op('tipoOperacion', 'tipoOperacionNombre'), op('tipoOperacionId', 'tipoOperacionNombre')] },
  { coleccion: 'unidades', nombre: (d) => txt(d.unidad) || txt(d.nombre), destinos: [op('unidad', 'unidadNombre', 'unidadId')] },
  { coleccion: 'empleados', nombre: (d) => `${txt(d.firstName)} ${txt(d.lastNamePaternal)}`.trim(), destinos: [op('operador', 'operadorNombre', 'operadorId')] },
];

export const maestroDe = (coleccion: string): Maestro => {
  const m = MAESTROS.find((x) => x.coleccion === coleccion);
  if (!m) throw new Error(`Sin maestro ${coleccion}`);
  return m;
};

/**
 * Nombres que le tocan a un documento de `coleccion` según los maestros dados
 * (colección del maestro → id → datos). Solo los que difieren de lo guardado.
 * El ID canónico manda sobre el de siempre (que puede traer un nombre de AppSheet).
 */
export const cambiosDeNombres = (coleccion: string, doc: Datos, maestros: ReadonlyMap<string, ReadonlyMap<string, Datos>>): Datos => {
  const cambios: Datos = {};
  for (const m of MAESTROS) {
    const registros = maestros.get(m.coleccion);
    if (!registros) continue;
    for (const d of m.destinos) {
      if (d.coleccion !== coleccion) continue;
      const id = (d.campoIdCanonico && txt(doc[d.campoIdCanonico])) || txt(doc[d.campoId]);
      const maestro = id ? registros.get(id) : undefined;
      if (!maestro) continue;
      const nombre = (d.regla ?? m.nombre)(maestro);
      if (nombre && txt(doc[d.campoNombre]) !== nombre) cambios[d.campoNombre] = nombre;
    }
  }
  return cambios;
};

/** ¿Cambió alguno de los nombres que este maestro propaga (con cualquiera de sus reglas)? */
export const cambioDeNombre = (maestro: Maestro, antes: Datos, despues: Datos): boolean => {
  const reglas = new Set([maestro.nombre, ...maestro.destinos.map((d) => d.regla).filter((r): r is (d: Datos) => string => !!r)]);
  return Array.from(reglas).some((r) => r(despues) !== r(antes) && !!r(despues));
};


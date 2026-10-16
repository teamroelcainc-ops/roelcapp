/**
 * Valor primitivo que puede vivir en un documento de Firestore dentro del app.
 * (Las fechas se guardan como string ISO "YYYY-MM-DD".)
 */
export type FieldValue = string | number | boolean | null;

/** Registro genérico con el que trabaja el motor CRUD. */
export interface EntityData {
  id: string;
  [key: string]: FieldValue | string[];
}

/**
 * Acciones disponibles por módulo. Las cuatro primeras son sobre los registros;
 * las cuatro últimas gobiernan los botones de la barra superior de la tabla.
 */
export type PermissionAction =
  | 'ver'
  | 'crear'
  | 'editar'
  | 'eliminar'
  | 'plantilla'
  | 'importar'
  | 'exportar'
  | 'filtrar'
  /** Ver los campos de dinero del módulo (cobros, montos, descuentos). */
  | 'verFinanzas'
  /** Ver las notas internas de seguimiento del módulo. */
  | 'verNotas'
  /**
   * Usar el botón "+" para dar de alta un registro de este módulo desde el
   * formulario de otro (p. ej. crear una estación mientras se captura un
   * conductor). Es independiente de 'crear': se puede permitir capturar en el
   * módulo y aun así no dejar crear catálogos al vuelo, o al revés.
   */
  | 'altaRapida'
  /**
   * Seleccionar varios registros y eliminarlos de una vez. Va aparte de
   * 'eliminar' porque el borrado masivo es mucho más peligroso: se puede
   * permitir borrar de uno en uno sin habilitar el borrado en bloque.
   */
  | 'eliminarMasivo'
  /** Abrir los editores del formulario: campos, encabezados y pestañas. */
  | 'configurarForm'
  /** Modificar los campos protegidos del módulo (los marcados como tales). */
  | 'editarProtegidos'
  /**
   * Configurar la ventana de captura del módulo (el horario semanal, hora de
   * Texas, en que se permite capturar). Pensada para BC Reports.
   */
  /** Marcar registros como verificados (check de "información correcta"). */
  | 'verificar'
  /** Usar "View as": entrar al app viendo exactamente lo que ve otro usuario. */
  | 'verComo'
  /** Ver la pestaña "Historic" (semanas anteriores) del módulo. */
  | 'verHistorico'
  /** Configurar los umbrales de alerta (números en rojo) del módulo. */
  | 'configurarAlertas'
  /** Elegir quién recibe el correo al guardar un formulario del módulo. */
  | 'avisosCorreo'
  /** Renombrar y reordenar menús y tablas (modo Edit de la barra superior). */
  | 'personalizarMenu'
  | 'ventanaCaptura'
  /**
   * Ver el monitor de lecturas de Firestore (burbuja "Reads"). Herramienta
   * de diagnóstico: OCULTA de fábrica para todos; se enciende por rol (basta
   * concederla en cualquier módulo) cuando se quiere vigilar el consumo.
   */
  /** RETIRADO en V00057: el monitor de lecturas ya no existe en la interfaz.
   *  Se conserva el valor para no romper los roles que lo tengan guardado. */
  | 'monitorLecturas'
  /**
   * Capturar aunque la ventana esté cerrada. Para supervisores u oficina que
   * corrigen datos fuera del horario; el resto de las reglas (un camión por
   * ventana, camión en taller) siguen aplicando.
   */
  | 'capturarFueraVentana';

/** Visibilidad de registros por módulo, definida por rol. */
export type ViewScope = 'all' | 'own' | 'station' | 'entity_station';

export type ModulePermissions = Partial<Record<PermissionAction, boolean>> & {
  /** all = todos · own = solo sus registros · station = los de sus estaciones ·
      entity_station = los que coinciden con su estación Y entidad. */
  alcance?: ViewScope;
};

export interface Role {
  id: string;
  name: string;
  permissions: Record<string, ModulePermissions>;
}

/** Perfil en la colección `users` (id = uid de Firebase Auth). Origen: BD_USERS. */
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  roleId: string;
  status: string;
  /** Entidades asignadas: el usuario solo ve registros de estas entidades. */
  scopeEntities?: string[];
  /** Estaciones asignadas: el usuario solo ve registros de estas estaciones. */
  scopeStations?: string[];
  /** Office: acceso a los registros de TODAS las entidades y estaciones. */
  isOffice?: boolean;
  /**
   * ACCESOS EXTRA de esta persona, además de lo que da su rol: por módulo,
   * las acciones concedidas. Sirve para adelantarle una vista a alguien sin
   * cambiar el rol de todo su grupo (p. ej. dos BC que ya usan Fleet Report
   * mientras los demás siguen sin verlo). Nunca QUITA lo que da el rol.
   */
  permissionOverrides?: Record<string, Partial<Record<PermissionAction, boolean>>>;
}

/** Tipos de campo soportados por el motor de formularios. */
export type FieldType =
  | 'text'
  | 'number'
  | 'currency'
  | 'date'
  /** Hora del día (HH:MM), p. ej. la hora del incidente. */
  | 'time'
  | 'textarea'
  | 'bool'
  | 'enum'
  | 'ref';

export interface RefFilter {
  field: string;
  value: FieldValue;
}

export interface FieldConfig {
  /** Solo los administradores ven este campo (lo aplica el layout del admin). */
  adminOnly?: boolean;
  /** Clave del campo en el documento (camelCase del nombre de columna original). */
  key: string;
  /** Etiqueta que se muestra en formularios, tablas y Excel. */
  label: string;
  type: FieldType;
  required?: boolean;
  /**
   * El campo NO sale en el Excel del botón Exportar. Sirve para los datos que
   * el sistema agrega por su cuenta (quién capturó) cuando el archivo debe
   * salir con unas columnas exactas y ninguna de más.
   */
  exportable?: boolean;
  /**
   * Va SIEMPRE en el Excel, aunque el layout (Customize) lo oculte de la
   * tabla o del detalle: lecturas que el archivo debe traer (millaje, llantas).
   */
  exportAlways?: boolean;
  /** Valores permitidos cuando type === 'enum'. */
  enumValues?: readonly string[];
  /** Colección referenciada cuando type === 'ref' (se muestra el nombre, nunca el id). */
  refCollection?: string;
  /** Filtro opcional para las opciones del ref (p. ej. solo assets tipo SCANNER). */
  refFilter?: RefFilter;
  /** false = no aparece como columna en la tabla (sí en el formulario y el Excel). */
  table?: boolean;
  /** false = no aparece en el formulario: lo llena el sistema (p. ej. capturista). */
  form?: boolean;
  /**
   * true = aunque el sistema lo llene (form:false), sí aparece en la plantilla
   * y en la importación CSV, para poder migrar el dato original.
   */
  importable?: boolean;
  /**
   * Otros nombres de columna que este campo acepta al importar
   * (encabezados tal como salen de AppSheet).
   */
  importAliases?: string[];
  /** Campo calculado en vivo (no se guarda ni se captura): OK/ALERT/CAUTION, etc. */
  compute?: (row: EntityData) => FieldValue;
  /** Renderizar el valor como badge de color en tablas y detalle. */
  badge?: boolean;
  /** Tono del badge según el valor mostrado (Preventive ámbar, Corrective rojo…). */
  badgeTones?: Record<string, 'positive' | 'negative' | 'neutral' | 'info' | 'warning'>;
  /** El campo solo aparece en el formulario cuando otro campo tiene cierto valor. */
  /**
   * El campo solo se muestra cuando otro campo tiene cierto valor. Con `value`
   * se compara el valor guardado; con `refNameIn` se compara el NOMBRE del
   * registro referenciado (p. ej. mostrar el correo solo cuando el tipo de
   * solicitud se llama "ADP"), útil porque el id del catálogo cambia por base.
   */
  visibleWhen?: {
    field: string;
    value?: FieldValue;
    /** Se cumple si el campo tiene CUALQUIERA de estos valores. */
    valueIn?: readonly FieldValue[];
    refNameIn?: string[];
  };
  /**
   * El campo solo lo ven los roles con esa acción marcada en la matriz de
   * permisos del módulo. Sirve para datos que no le tocan a todo el mundo:
   * lo que se le cobra al conductor, o las notas internas de seguimiento.
   * Aplica en formulario, tabla, detalle y exportación.
   */
  requiresAction?: PermissionAction;
  /**
   * El campo se VE siempre, pero solo lo puede modificar quien tenga la
   * acción "Edit locked fields" del módulo en la matriz de Roles. Para datos
   * que no debe cambiar cualquiera: el estatus de una orden, un monto.
   */
  editRequiresAction?: boolean;
  /** Al capturar un registro nuevo, la fecha arranca en el día de hoy. */
  defaultToday?: boolean;
  /**
   * Copia un dato del registro referenciado por otro campo del formulario
   * (p. ej. el Next mant del camión elegido).
   */
  copyFromRefField?: { field: string; sourceField: string };
  /**
   * Muestra la referencia usando SOLO este campo del registro apuntado, en vez
   * de la etiqueta completa del catálogo. Sirve cuando en un módulo estorba el
   * dato extra: en Fleet basta el número de unidad, sin la placa.
   */
  refLabelFrom?: string;
  /**
   * Marca el campo que decide el alcance por estación o entidad. Sin esto se
   * usan TODOS los campos que apunten a esos catálogos, y en Trucks bastaba
   * con que coincidiera la estación de registro para ver el camión, aunque
   * hoy esté en otra.
   */
  scopeKey?: 'station' | 'entity';
  /**
   * Al guardar, escribe este valor en el registro referenciado por otro campo
   * (p. ej. el millaje capturado actualiza el camión). Evita tener que
   * recalcularlo leyendo todos los mantenimientos.
   */
  syncToRefField?: { field: string; targetField: string; onlyWhen?: (row: EntityData) => boolean };
  /**
   * Destaca el dato en el visor de detalle (número grande y recuadro con
   * acento). 'value' es un dato clave (el millaje actual); 'balance' es un
   * saldo que además se pinta en rojo cuando llega a cero o menos (la
   * diferencia de millaje de un camión pasado de mantenimiento).
   */
  highlight?: 'value' | 'balance';
  /**
   * El valor se fija al dar de alta y ya no se puede cambiar al editar (p. ej.
   * la fecha de entrada al inventario, que debe quedar como constancia del día
   * en que llegó la mercancía). En el alta se captura normal; después se
   * muestra bloqueado y no se reenvía al guardar.
   */
  lockedAfterCreate?: boolean;
  /**
   * El sistema fija el valor al dar de alta (con `defaultToday`, `defaultValue`
   * o el alcance del usuario) y NADIE lo edita, ni al crear ni al editar: la
   * fecha en que se cargaron los uniformes debe quedar como constancia del día
   * real. Se muestra bloqueado siempre; al crear sí se guarda, al editar ya no
   * se reenvía.
   */
  fixedOnCreate?: boolean;
  /**
   * El layout del admin (Customize) NO puede ocultar este campo ni quitarlo
   * de la tabla o del detalle: una configuración vieja que escondía
   * "Captured by" hacía desaparecer la columna BC al recargar.
   */
  lockedInLayout?: boolean;
  /**
   * Valor que SIEMPRE sale de la referencia (`copyFromRefField`): se ve
   * bloqueado y al guardar (alta y edición) el sistema lo vuelve a tomar del
   * registro referenciado. Entidad y estación del Fleet Report = las del camión.
   */
  lockedFromRef?: boolean;
  /**
   * El campo no se pide al CREAR (toma su defaultValue), pero sí aparece al
   * editar. Para datos que siempre nacen igual y solo cambian después, como el
   * estatus de una solicitud: quita un paso del alta sin perder el control.
   */
  hideOnCreate?: boolean;
  /**
   * Campo visible en el formulario pero NO capturable: su valor lo mantiene
   * el sistema (p. ej. el millaje actual del camión, que escribe cada
   * mantenimiento preventivo). Se muestra bloqueado y no se reenvía al
   * guardar, para no pisar un valor que pudo cambiar mientras el
   * formulario estaba abierto.
   */
  readOnly?: boolean;
  /** Valor inicial tomado de las asignaciones del usuario (primera de su alcance). */
  defaultFromUserScope?: 'entity' | 'station';
  /**
   * Al guardar, copia el NOMBRE resuelto de esta referencia en otra clave del
   * documento. Sirve para que otros módulos sigan mostrando el nombre sin
   * tener que leer la colección referenciada.
   */
  copyLabelTo?: string;
  /**
   * En el alta rápida ("+") no se elige un registro ya existente: se capturan
   * aquí los datos del catálogo referenciado y se crean AMBOS de una vez
   * (p. ej. un conductor nuevo se guarda en Team y en Drivers).
   */
  quickAddInline?: boolean;
  /**
   * Si este campo está vacío o no se puede resolver, se muestra el valor de
   * esta otra clave. Sirve durante migraciones (dato viejo en otro campo).
   */
  fallbackField?: string;
  /**
   * Filtra las opciones según el valor actual de OTRO campo del mismo formulario.
   * map traduce ese valor al valor a filtrar (null = sin filtro).
   */
  refFilterFromField?: {
    field: string;
    targetField: string;
    map: Record<string, string | null>;
  };
  /**
   * Filtra las opciones usando un dato del REGISTRO referenciado por otro campo.
   * Ej.: las tallas se limitan al tipo de talla de la prenda elegida.
   */
  refFilterFromRefField?: {
    /** Campo del formulario que apunta a otro registro. */
    field: string;
    /** Clave a leer en ese registro. */
    sourceField: string;
    /** Clave a comparar en las opciones de este campo. */
    targetField: string;
  };
  /** Valor por defecto al crear. */
  defaultValue?: FieldValue;
}

export interface DetailConfig {
  /** Texto del botón de alta (por omisión "Add"). */
  addLabel?: string;
  /** Qué es cada renglón al capturarlo en el alta ("truck" por omisión; "uniform"). */
  rowNoun?: string;
  /** Botón de la captura en el alta ("Add truck" por omisión). */
  draftAddLabel?: string;
  /**
   * Botones de alta adicionales que abren el mismo formulario con algunos
   * campos ya definidos. Sirve para atajos frecuentes, como registrar un
   * mantenimiento correctivo sin tener que cambiar el tipo a mano.
   */
  extraAdd?: {
    label: string;
    tone?: 'negative' | 'neutral';
    preset: Record<string, FieldValue>;
  }[];
  /** Colección de los renglones de detalle. */
  collection: string;
  /** Campo del detalle que apunta al id del registro maestro. */
  parentKey: string;
  title: string;
  fields: FieldConfig[];
  /**
   * Un mismo valor de este campo no puede repetirse entre los renglones de
   * un mismo registro maestro (p. ej. un camión solo entra una vez en cada
   * BC Report). Se valida al capturar, tanto en el alta como al agregar
   * renglones a un registro ya guardado.
   */
  uniqueRowKey?: { key: string; label: string };
  /**
   * Campo del registro MAESTRO donde el motor mantiene cuántos renglones
   * tiene (se suma al crear y se resta al borrar, de forma atómica). Con él
   * la tabla puede decir qué registros están VACÍOS sin leer los renglones.
   * Los registros de antes de esta versión no lo traen: el módulo lo
   * completa solo, una vez, con una consulta de conteo por registro visible.
   */
  countField?: string;
  /**
   * Dónde contar los renglones para countField. Por omisión se cuenta la
   * colección del detalle, pero en BC Reports los renglones HISTÓRICOS
   * (migrados) existen solo en el espejo (maintenance); como cada renglón
   * capturado en el app también crea su espejo, contar ahí cubre ambos.
   */
  countSource?: { collection: string; parentKey: string };
  /**
   * El detalle solo se habilita cuando el campo indicado apunta a un registro
   * cuyo nombre está en la lista (p. ej. tipo de solicitud = "Uniforms").
   */
  enabledWhen?: { field: string; refNameIn: string[] };
  /**
   * Descuenta de un inventario: antes de guardar valida que haya existencia
   * suficiente (entradas menos salidas ya registradas).
   */
  stockControl?: {
    /** Colección de entradas al inventario. */
    entriesCollection: string;
    /** Claves que identifican el artículo (deben existir en ambas colecciones). */
    matchKeys: string[];
    /** Clave de la cantidad. */
    quantityKey: string;
  };
  /**
   * Copia cada renglón a otra colección (p. ej. los renglones del BC Report
   * también viven en Maintenance, marcados con su origen).
   */
  mirror?: {
    collection: string;
    /** Prefijo del id del documento espejo: `${prefix}${idDelRenglón}`. */
    idPrefix: string;
    build: (
      parentId: string,
      parent: EntityData,
      row: Record<string, FieldValue>,
    ) => Record<string, FieldValue>;
  };
}

/** Lista de solo lectura ligada al registro (historial, movimientos, etc.). */
export interface RelatedView {
  id: string;
  title: string;
  collection: string;
  /** Campo de la otra colección que apunta al id de este registro. */
  foreignKey: string;
  fields: FieldConfig[];
  /** Filtro fijo opcional (p. ej. solo mantenimiento correctivo). */
  filter?: { field: string; value: FieldValue };
  emptyMessage?: string;
}

/** Bitácora automática de cambios en ciertos campos del módulo. */
export interface ChangeLogConfig {
  collection: string;
  /** Campo de la bitácora que apunta al id del registro. */
  foreignKey: string;
  /** Claves de los campos vigilados. */
  watch: string[];
}

/** Una pestaña del formulario por pasos. */
export interface FormStep {
  id: string;
  /** Nombre visible de la pestaña; el admin lo puede cambiar. */
  title: string;
  /** Claves de los campos que se capturan en esta pestaña, en orden. */
  fieldKeys: string[];
}

/**
 * Aviso de cobertura entre dos colecciones: de los N registros de una lista
 * (los camiones), cuántos están dados de alta en otra (Fleet) y cuáles no.
 */
export interface CoverageConfig {
  /** Lista de referencia (p. ej. camiones). */
  sourceCollection: string;
  /** Colección que debe cubrirla (p. ej. fleet). */
  targetCollection: string;
  /** Campo de la colección destino que apunta al registro de referencia. */
  targetKey: string;
  /** Campos con los que se identifica un registro de referencia en la lista. */
  sourceLabelKeys: string[];
  sourceLabel: string;
  coveredLabel: string;
  missingLabel: string;
  /** Campo de estación del registro de referencia (Current station del camión). */
  sourceStationKey?: string;
  /** Campo "agregado por" (uid) en la colección destino, para el conteo personal. */
  targetOwnerKey?: string;
  /**
   * Si se define, la cobertura se mide contra la SEMANA VIGENTE de ese
   * módulo con ventana de captura (Fleet Report): cuenta solo lo capturado
   * dentro del horario asignado y se recalcula sola al cambiar la semana o
   * el horario.
   */
  targetWindowModuleId?: string;
}

/**
 * Ventana de captura: el módulo solo admite altas entre una fecha/hora de
 * inicio y una de cierre que fija el administrador (en hora de Texas), y
 * dentro de esa ventana cada registro del catálogo indicado (los camiones)
 * solo se puede capturar UNA vez, sin importar quién lo capture.
 */
export interface CaptureWindowConfig {
  /** Id del documento de configuración (settings_windows/<id>). */
  id: string;
  /** Nombre visible de la ventana en avisos ("BC Report window"). */
  label: string;
  /** Regla "una vez por ventana" sobre un campo de referencia del detalle. */
  once: {
    /** Campo del renglón de detalle que apunta al catálogo (idTruck). */
    detailKey: string;
    /** Catálogo que debe quedar cubierto en cada ventana (trucks). */
    sourceCollection: string;
    /**
     * Campo del catálogo con su ESTACIÓN ACTUAL ("Current station"): es el
     * único criterio de pertenencia — un camión cuenta para la estación en
     * la que está hoy, sin importar la entidad (varias entidades comparten
     * estación).
     */
    sourceStationKey: string;
    /** Campo bool/estatus del catálogo que marca si está activo. */
    sourceActiveKey?: string;
    /** Cómo se llama un registro del catálogo en los avisos ("truck"). */
    sourceLabel: string;
  };
  /**
   * Registros de otras colecciones que dejan fuera a un elemento del
   * catálogo mientras sigan abiertos (una orden de taller, un correctivo
   * pendiente). Se consultan en el servidor solo los que tienen alguno de
   * los estatus abiertos, y `match` afina en el cliente (p. ej. solo los
   * mantenimientos correctivos).
   */
  /**
   * true = los camiones bloqueados (taller / correctivo) SÍ se pueden
   * capturar: siguen marcados como "no exigidos", pero no salen del
   * desplegable ni se rechazan al guardar (Fleet Report).
   */
  blockedSelectable?: boolean;
  blockedBy: {
    collection: string;
    /** Campo de esa colección que apunta al catálogo (idTruck). */
    refKey: string;
    /** Campo de estatus y valores que se consideran "abierto". */
    statusKey: string;
    openValues: string[];
    match?: (row: EntityData) => boolean;
    /** Texto del motivo: "in Shop (open order)". */
    label: string;
  }[];
}

/**
 * Icono de estado junto al número de unidad (Trucks): taller abierto,
 * correctivo pendiente o Current station = la estación de mantenimiento.
 */
export interface UnitStatusConfig {
  /** Módulo con ventana cuyos bloqueos (taller/correctivo) se reutilizan. */
  windowModuleId: string;
  /** Campo de estación del registro (Current station). */
  stationKey: string;
  /** Nombre de la estación que significa "en mantenimiento". */
  maintenanceStationName: string;
  /** Columna donde se dibuja el icono (número de unidad). */
  columnKey: string;
}

export interface ModuleConfig {
  /** Id estable del módulo (se usa en permisos y rutas). */
  id: string;
  /** Iconos de estado del camión (taller / correctivo / estación Maintenance). */
  unitStatus?: UnitStatusConfig;
  /** false = el diálogo Export Excel no muestra el filtro por fechas (Drivers). */
  exportDateFilter?: boolean;
  /**
   * Excel COMPLETO: todo lo que se carga en el módulo, aunque el layout lo
   * oculte — campos del código, campos personalizados (cf_…) y la fecha y
   * hora exactas de captura. Quien lo descarga quita lo que no necesite.
   */
  exportEverything?: boolean;
  /**
   * SEGUNDA HOJA con los renglones del detalle: cada renglón en su propia
   * fila, precedido por las columnas de su encabezado. Además, en la hoja
   * del encabezado se agrega una columna que resume sus renglones.
   * Sin esto, el Excel de un módulo maestro-detalle (Requirements) sale sin
   * lo que de verdad se pidió: la prenda y la talla.
   */
  exportDetailSheet?: {
    /** Nombre de la segunda hoja ("Uniform lines"). */
    sheetName: string;
    /** Encabezado de la columna resumen ("Uniforms requested"). */
    summaryLabel: string;
    /**
     * Campos del renglón que arman el resumen, en orden: el primero es el
     * nombre, los siguientes van entre paréntesis y los numéricos como ×N.
     */
    summaryKeys: string[];
    /** Encabezado de la columna con cuántos renglones tiene ("Lines"). */
    countLabel?: string;
  };
  /**
   * Alta con PRECARGA: al elegir `field` (el camión) se traen `keys` del
   * último registro de ese camión en este módulo; si no hay, del registro
   * del camión en `fallbackCollection` (Fleet).
   */
  prefillFromPrevious?: {
    field: string;
    keys: string[];
    fallbackCollection?: string;
  };
  collection: string;
  title: string;
  /** Nombre del ícono de lucide-react. */
  icon: string;
  fields: FieldConfig[];
  /** Si se define, este campo se llena automáticamente con el uid del usuario actual. */
  autoUserField?: string;
  /** Módulo de detalle (maestro–detalle), p. ej. renglones del reporte BC. */
  /**
   * Divide el alta en pestañas para que se llene rápido, sobre todo en
   * teléfono. Los campos que no aparezcan en ningún paso se agregan al
   * último, para que nunca se pierda uno al reconfigurar.
   */
  formSteps?: FormStep[];
  /**
   * Tope de registros que se leen al abrir el módulo, de los más recientes
   * hacia atrás. Se pone en los módulos con miles de renglones: sin él, cada
   * visita cuesta una lectura por documento y agota la cuota diaria.
   */
  listLimit?: number;
  /** Aviso de cobertura en la parte superior de la tabla. */
  coverage?: CoverageConfig;
  /** Ventana de captura con "una vez por ventana" (p. ej. los BC Reports). */
  captureWindow?: CaptureWindowConfig;
  /**
   * Habilita en Import CSV el modo "actualizar registros existentes casando
   * por este campo" (sin crear ni duplicar nada). `key` es el campo de
   * referencia que identifica al registro (idTeam en Drivers), `label` el
   * nombre de la columna en el archivo y `textField` el campo de texto del
   * registro donde quedó guardado el nombre (respaldo cuando la referencia
   * no resuelve).
   */
  importMatch?: { key: string; label: string; textField?: string };
  /**
   * Campo bool/texto de activo del módulo: pinta el botón de la tabla para
   * marcar activo/inactivo. Los inactivos salen de todos los desplegables.
   */
  activeToggle?: string;
  /**
   * Campo bool de VERIFICACIÓN: botón (solo admin) para marcar el registro
   * como revisado y con la información correcta. Guarda también quién y
   * cuándo lo verificó.
   */
  verifyToggle?: string;
  /**
   * Campos que NO se pueden repetir dentro de la misma ventana semanal
   * (Fleet Report: ni el camión ni el driver, sin excepciones).
   */
  uniqueInWindow?: string[];
  /**
   * Catálogo que TODOS ven completo: no se filtra por entidad ni por
   * estación, sin importar la visibilidad del rol (Drivers: cualquier BC
   * debe poder elegir o consultar a cualquier conductor).
   */
  alwaysVisible?: boolean;
  /**
   * Con visibilidad restringida en el rol (own / station / entity_station),
   * el módulo se filtra SOLO por su campo de estación (scopeKey 'station'):
   * se ignoran la entidad y el capturista (Trucks: Current station).
   */
  stationOnlyScope?: boolean;
  /**
   * Los usuarios acotados a estaciones se suscriben SOLO a los registros de
   * sus estaciones (cláusula "in" por servidor): menos lecturas por sesión.
   */
  scopeServerSide?: boolean;
  /**
   * Habilita "Merge duplicates" (solo admin): agrupa registros cuyo nombre
   * es la misma persona escrita distinto ("ADAMS, Rayjohnal" y "Rayjohnal
   * Adams"), conserva uno, reapunta hacia él las referencias listadas y
   * elimina las copias.
   */
  dedupe?: {
    /** Campo de texto con el nombre a comparar. */
    labelKey: string;
    /** Quiénes lo referencian y por qué campo (drivers.idTeam). */
    references: {
      collection: string;
      key: string;
      /** Campo de texto en el referenciador que guarda copia del nombre. */
      alsoCopyLabelTo?: string;
    }[];
    /**
     * Referencias guardadas dentro de un ARREGLO (las estaciones asignadas a
     * un usuario, `users.scopeStations`): al fusionar hay que cambiar el id
     * dentro del arreglo, no el documento entero.
     */
    arrayReferences?: { collection: string; key: string }[];
  };
  /**
   * Impide dar de alta dos registros con el mismo valor en este campo. Al
   * intentarlo, se avisa quién capturó el que ya existe.
   */
  uniqueBy?: {
    field: string;
    label: string;
    /**
     * Compara sin distinguir mayúsculas ni espacios de sobra: "770", "770 "
     * y "Office"/"OFFICE" son el mismo nombre. Para catálogos escritos a
     * mano por varias personas.
     */
    ignoreCase?: boolean;
  };
  detail?: DetailConfig;
  /**
   * Pestañas que separan los registros del módulo (p. ej. mantenimiento
   * preventivo, correctivo y el que viene del BC Report).
   */
  viewTabs?: {
    id: string;
    label: string;
    tone?: 'positive' | 'negative' | 'neutral' | 'info' | 'warning';
    /** Filas que muestra la pestaña; sin filtro = todas. */
    match?: (row: EntityData) => boolean;
  }[];
  /**
   * Exportación a Excel de los renglones ligados al módulo, combinando datos
   * del encabezado y del renglón (p. ej. los mantenimientos de un BC Report).
   */
  exportRows?: {
    collection: string;
    /** Campo del renglón que apunta al encabezado. */
    parentKey: string;
    columns: {
      label: string;
      /** De dónde sale el valor: del encabezado o del propio renglón. */
      from: 'parent' | 'row';
      field: FieldConfig;
    }[];
  };
  /** Listas de solo lectura que se abren desde cada renglón. */
  relatedViews?: RelatedView[];
  /** Registra automáticamente los cambios de los campos vigilados. */
  changeLog?: ChangeLogConfig;
  /**
   * Importación masiva de renglones de detalle en un solo CSV: cada fila trae
   * también los datos del encabezado y el sistema agrupa por `groupBy`,
   * creando o reutilizando el registro maestro que corresponda.
   */
  bulkDetailImport?: {
    buttonLabel: string;
    title: string;
    /** Claves del encabezado que identifican un mismo registro maestro. */
    groupBy: string[];
  };
}
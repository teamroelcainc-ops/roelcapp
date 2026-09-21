// ✅ V00330: REGISTRO AUTOMÁTICO del Historial de Cambios.
//   Este archivo viaja CON el código: cada entrega de versión añade aquí su
//   entrada, así el módulo "Historial de Cambios" se actualiza SOLO al
//   publicar — sin capturar nada a mano. Las entradas manuales (Firestore)
//   se combinan con estas; si una versión se registra a mano, la manual manda.
//   Formato de fecha: aaaa-mm-dd. La hora es opcional.

export interface CambioApp {
  fecha: string;
  hora?: string;
  version: string;
  titulo: string;
  resumen: string;   // explicación cotidiana (la que se copia para WhatsApp)
  detalle?: string;  // detalle técnico opcional
}

export const CAMBIOS_APP: CambioApp[] = [
  { fecha: '2026-09-21', hora: '20:10', version: 'V00335', titulo: 'Rango de fechas y moneda en la auditoría por empresa', resumen: 'La auditoría de la empresa ahora filtra las operaciones por rango de fecha de servicio y muestra la moneda configurada en la ficha de la empresa.' },
  { fecha: '2026-09-21', hora: '19:20', version: 'V00334', titulo: 'Auditoría de la cadena por EMPRESA', resumen: 'Desde la ficha de cualquier empresa (botón 🔍) se ve toda su cadena en vivo — operaciones, facturación y pagos — separada por su papel: Cliente que Paga, Cliente de Mercancía o Proveedor de transporte y servicios.' },
  { fecha: '2026-09-21', hora: '18:40', version: 'V00332', titulo: 'Combustible y Catálogos bajo Autorizaciones', resumen: 'Se integraron Combustible y Catálogos al módulo de Autorizaciones: en Combustible se controlan sus campos y acciones, y en Catálogos quién puede crear, editar o borrar registros de cualquier catálogo.' },
  { fecha: '2026-09-21', hora: '17:05', version: 'V00331', titulo: 'La autorización solo mira lo que tú tocas', resumen: 'Al guardar una empresa, la autorización se revisa únicamente sobre los campos que el usuario realmente modificó; lo que el formulario recalcula solo ya no dispara avisos ni afecta a los demás campos.' },
  { fecha: '2026-09-21', hora: '16:45', version: 'V00330', titulo: 'El historial de cambios se llena solo', resumen: 'Cada actualización de la app queda registrada automáticamente en el Historial de Cambios, con fecha, versión y su explicación — ya no hay que capturarla a mano.' },
  { fecha: '2026-09-21', version: 'V00329', titulo: 'Módulo Historial de Cambios + escritura corregida en Empresas', resumen: 'Se estrenó el módulo Historial de Cambios para la gerencia (con informe copiable para WhatsApp) y se corrigió que algunos campos de Empresas perdieran el cursor al escribir.' },
  { fecha: '2026-09-21', version: 'V00328', titulo: 'Autorización solo si de verdad se modificó', resumen: 'Al guardar una empresa ya no pide autorización por campos que nadie tocó; solo por lo que sí se cambió.' },
  { fecha: '2026-09-21', version: 'V00327', titulo: 'Los campos protegidos se ven bloqueados', resumen: 'En Empresas, los campos que requieren autorización aparecen atenuados con candado 🔒; al darles clic se solicita el acceso temporal.' },
  { fecha: '2026-09-21', version: 'V00326', titulo: 'Regla "Agregar libre" en Autorizaciones', resumen: 'Ahora un campo protegido puede capturarse libremente la PRIMERA vez (ej. la Moneda al crear la empresa) y quedar bloqueado para cambios posteriores.' },
  { fecha: '2026-09-21', version: 'V00325', titulo: 'Reporte de Vencimiento bajo Autorizaciones', resumen: 'Cambiar documentos o fechas del Reporte de Vencimiento ya no es libre: si el usuario no está autorizado, el cambio se convierte en una solicitud que un Admin aprueba.' },
  { fecha: '2026-09-20', version: 'V00324', titulo: 'Auditoría: rango de fechas, edición al frente y detalle legible', resumen: 'La auditoría filtra las operaciones por fecha de servicio, el formulario de edición abre al frente (y la auditoría te espera donde ibas) y el ojito muestra el detalle con nombres, no claves.' },
  { fecha: '2026-09-20', version: 'V00323', titulo: 'Auditoría más grande, con ✓ Revisado y caminos', resumen: 'La auditoría ocupa el 80% de la pantalla; cada pieza tiene botón ✓ Revisado (los revisados se van al final, los problemas al inicio) y al hacer clic en una operación, factura o pago se muestra SOLO su camino.' },
  { fecha: '2026-09-19', version: 'V00322', titulo: 'Auditoría en vivo, con detalle y edición', resumen: 'La auditoría quedó conectada en vivo: cualquier corrección se refleja al momento; cada pieza tiene ver detalle y editar, se resaltan los problemas y las monedas que no concuerdan.' },
  { fecha: '2026-09-19', version: 'V00320', titulo: 'Auditoría en tres columnas con monedas', resumen: 'La auditoría se ve en tres columnas (Operaciones, Facturación, Pagos) con las monedas de cada pieza a la vista y el camino de cada operación iluminado.' },
  { fecha: '2026-09-19', version: 'V00319', titulo: 'La auditoría busca solo clientes que pagan', resumen: 'El buscador de la auditoría ya no lista todas las empresas: solo los clientes que pagan.' },
  { fecha: '2026-09-19', version: 'V00318', titulo: 'Nueva Auditoría de la cadena por cliente', resumen: 'Se estrenó la auditoría que cruza operaciones, facturas y pagos de un cliente: detecta operaciones que cambiaron después de facturarse, sin facturar, dobles cobros y pagos descuadrados, con Excel del reporte.' },
  { fecha: '2026-09-19', version: 'V00317', titulo: 'Reparar nombres con CONV + Excel completo por empresa', resumen: 'Botón para limpiar los nombres que traían el "CONV-###" incrustado, y descarga de un Excel por empresa con sus operaciones, facturación y pagos en tres hojas.' },
  { fecha: '2026-09-18', version: 'V00316', titulo: 'Los módulos ya no se desordenan al recargar', resumen: 'Se corrigió que la app se viera desacomodada al recargar justo después de publicarse una actualización.' },
  { fecha: '2026-09-18', version: 'V00315', titulo: 'Unir duplicados con toda la información', resumen: 'Al unir registros duplicados de empresas se ve la ficha de cada candidato (tipos, RFC, status, fecha de alta y operaciones) antes de decidir cuál queda.' },
  { fecha: '2026-09-18', version: 'V00314', titulo: 'Nombres de convenio limpios y clientes bien distinguidos', resumen: 'Los convenios ya no muestran el "CONV-###" en el nombre y el buscador de Cliente (Paga) distingue empresas con el mismo nombre.' },
  { fecha: '2026-09-18', version: 'V00313', titulo: 'Tarifas A/B y catálogos en vivo en operaciones', resumen: 'El modal de operaciones muestra el número de tarifario correcto, deja elegir Tarifa A o B en convenios con dos montos, y los convenios y tarifarios se actualizan en vivo mientras el formulario está abierto.' },
  { fecha: '2026-09-17', version: 'V00312', titulo: 'Abrir en pestaña nueva con filtros + tablas más ágiles', resumen: 'Convenios, tarifarios y cancelados abren en pestaña nueva conservando los filtros; las tablas grandes cargan por partes y las barras de desplazamiento siempre se ven.' },
  { fecha: '2026-09-17', version: 'V00311', titulo: 'Corregido el error al abrir en pestaña nueva tras publicar', resumen: 'Se corrigió el error que a veces salía al abrir "Ver en nueva pestaña" justo después de publicarse una actualización.' },
];

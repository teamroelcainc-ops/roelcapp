// src/features/etiquetas/components/EtiquetasDashboard.tsx
// ---------------------------------------------------------------------------
// ✅ PERSONALIZAR ETIQUETAS: editor de los nombres del menú (apartados y
//   subapartados) y de columnas de módulos adheridos al sistema. Visible solo
//   para roles con el permiso "Personalizar Etiquetas". Guarda en Firestore
//   `settings_ui/etiquetas`; los cambios se aplican EN VIVO a todos.
//   Dejar un texto vacío regresa la etiqueta a su valor por defecto.
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { useEtiquetas } from '../../../contexts/EtiquetasContext';
import { Save } from 'lucide-react';
import './EtiquetasDashboard.css';

// Catálogo de etiquetas editables: clave estable + texto por defecto.
const CATALOGO: { seccion: string; items: { clave: string; porDefecto: string }[] }[] = [
  {
    seccion: 'Menú · Apartados y subapartados',
    items: [
      { clave: 'menu.mis_operaciones', porDefecto: 'Mis Operaciones' },
      { clave: 'menu.operaciones_activas', porDefecto: 'Operaciones Activas' },
      { clave: 'menu.servicios_completados', porDefecto: 'Servicios Completados' },
      { clave: 'menu.servicios_cancelados', porDefecto: 'Servicios Cancelados' },
      { clave: 'menu.reportes', porDefecto: 'Reportes' },
      { clave: 'menu.estad_sticas', porDefecto: 'Estadísticas' },
      { clave: 'menu.pagos', porDefecto: 'Pagos' },
      { clave: 'menu.gastos', porDefecto: 'Gastos' },
      { clave: 'menu.mtto', porDefecto: 'MTTO' },
      { clave: 'menu.referencias_del_diesel', porDefecto: 'Referencias del Diesel' },
      { clave: 'menu.referencias_de_puentes', porDefecto: 'Referencias de Puentes' },
      { clave: 'menu.costos_adicionales', porDefecto: 'Costos Adicionales' },
      { clave: 'menu.clientes', porDefecto: 'Clientes' },
      { clave: 'menu.convenio_de_clientes', porDefecto: 'Convenio de Clientes' },
      { clave: 'menu.facturaci_n_de_clientes', porDefecto: 'Facturación de Clientes' },
      { clave: 'menu.proveedores', porDefecto: 'Proveedores' },
      { clave: 'menu.convenio_de_proveedores', porDefecto: 'Convenio de Proveedores' },
      { clave: 'menu.facturaci_n_de_proveedores', porDefecto: 'Facturación de Proveedores' },
      { clave: 'menu.empleados', porDefecto: 'Empleados' },
      { clave: 'menu.colaboradores', porDefecto: 'Colaboradores' },
      { clave: 'menu.historial_de_asistencia', porDefecto: 'Historial de Asistencia' },
      { clave: 'menu.referencias_de_n_mina', porDefecto: 'Referencias de Nómina' },
      { clave: 'menu.deducciones', porDefecto: 'Deducciones' },
      { clave: 'menu.bases_de_datos', porDefecto: 'Bases de Datos' },
      { clave: 'menu.empresas', porDefecto: 'Empresas' },
      { clave: 'menu.contactos', porDefecto: 'Contactos' },
      { clave: 'menu.direcciones', porDefecto: 'Direcciones' },
      { clave: 'menu.tipo_de_cambio', porDefecto: 'Tipo de Cambio' },
      { clave: 'menu.combustible', porDefecto: 'Combustible' },
      { clave: 'menu.unidades_propias', porDefecto: 'Unidades Propias' },
      { clave: 'menu.remolques', porDefecto: 'Remolques' },
      { clave: 'menu.proveedores_de_unidad', porDefecto: 'Proveedores de Unidad' },
      { clave: 'menu.unidades_del_proveedor', porDefecto: 'Unidades del Proveedor' },
      { clave: 'menu.cat_logos', porDefecto: 'Catálogos' },
      { clave: 'menu.configuraci_n', porDefecto: 'Configuración' },
      { clave: 'menu.usuarios', porDefecto: 'Usuarios' },
      { clave: 'menu.roles_y_permisos', porDefecto: 'Roles y Permisos' },
      { clave: 'menu.reglas_de_estatus', porDefecto: 'Reglas de Estatus' },
      { clave: 'menu.autorizaciones', porDefecto: 'Autorizaciones' },
      { clave: 'menu.personalizar_etiquetas', porDefecto: 'Personalizar Etiquetas' },
      // ✅ V00167: encabezados del módulo Estadísticas (también editables ahí con "✎ Encabezados")
      { clave: 'est.modo_operaciones', porDefecto: 'Operaciones' },
      { clave: 'est.modo_facturacion', porDefecto: 'Facturación' },
      { clave: 'est.tab_desglose', porDefecto: 'Desglose (tipo · C/V · exp/imp/mov · cliente · operador · unidad · proveedor)' },
      { clave: 'est.tab_operativa', porDefecto: 'Estadística de servicios (diario · semanal · mensual · clientes)' },
      { clave: 'est.tab_servicios', porDefecto: 'Servicios por mes' },
      // ✅ V00168: Reporte de Vencimiento y Panel de Control
      { clave: 'rv.titulo', porDefecto: 'Reporte de Vencimiento' },
      { clave: 'rv.tab_vencidos', porDefecto: 'Vencidos y por vencer' },
      { clave: 'rv.tab_sin_fechas', porDefecto: 'Sin fechas de emisión o vencimiento' },
      { clave: 'rv.col_usuario', porDefecto: 'Usuario del documento' },
      { clave: 'pc.titulo', porDefecto: 'Panel de Control' },
      { clave: 'pc.graf_ops', porDefecto: 'Operaciones por mes' },
      { clave: 'pc.graf_fact', porDefecto: 'Facturación por mes (MXN)' },
      { clave: 'pc.graf_util', porDefecto: 'Utilidad estimada por mes (MXN)' },
      { clave: 'pc.top_unidades', porDefecto: '🚛 Unidades más usadas' },
      { clave: 'pc.top_operadores', porDefecto: '👷 Operadores más asignados' },
      { clave: 'menu.datos_de_la_empresa', porDefecto: 'Datos de la Empresa' },
      { clave: 'menu.importaci_n_de_datos', porDefecto: 'Importación de Datos' },
      { clave: 'menu.logs', porDefecto: 'Logs' },
    ],
  },
  {
    seccion: 'Estadísticas · Columnas de la tabla de operaciones',
    items: [
      { clave: 'col.est.referencia', porDefecto: 'Referencia' },
      { clave: 'col.est.fecha_servicio', porDefecto: 'Fecha Servicio' },
      { clave: 'col.est.linea', porDefecto: 'Línea' },
      { clave: 'col.est.tipo_de_operacion', porDefecto: 'Tipo de Operación' },
      { clave: 'col.est.status', porDefecto: 'Status' },
      { clave: 'col.est.cliente', porDefecto: 'Cliente' },
      { clave: 'col.est.convenio', porDefecto: 'Convenio' },
      { clave: 'col.est.unidad', porDefecto: 'Unidad' },
      { clave: 'col.est.operador', porDefecto: 'Operador' },
      { clave: 'col.est.remolque', porDefecto: 'Remolque' },
      { clave: 'col.est.origen', porDefecto: 'Origen' },
      { clave: 'col.est.destino', porDefecto: 'Destino' },
      { clave: 'col.est.km_estimado', porDefecto: 'Km Estimado' },
      { clave: 'col.est.moneda', porDefecto: 'Moneda' },
    ],
  },
];

export function EtiquetasDashboard() {
  const { overrides, guardarEtiquetas } = useEtiquetas();
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState('');

  const valorDe = (clave: string) =>
    borrador[clave] !== undefined ? borrador[clave] : (overrides[clave] || '');

  const hayCambios = Object.keys(borrador).length > 0;

  const guardar = async () => {
    setGuardando(true);
    try {
      await guardarEtiquetas(borrador);
      setBorrador({});
      alert('Etiquetas guardadas. Los cambios ya se aplicaron para todos los usuarios.');
    } catch (e) {
      console.error('No se pudieron guardar las etiquetas:', e);
      alert('No se pudieron guardar las etiquetas.');
    } finally {
      setGuardando(false);
    }
  };

  const b = busqueda.trim().toLowerCase();

  return (
    <div className="etq-contenedor">
      <div className="etq-encabezado">
        <div>
          <h1 className="etq-titulo">Personalizar Etiquetas</h1>
          <p className="etq-subtitulo">
            Cambia los nombres del menú y de columnas para toda la empresa. Deja un campo vacío para regresar al nombre original.
          </p>
        </div>
        <button className="etq-guardar" onClick={guardar} disabled={!hayCambios || guardando}>
          <Save size={15} /> {guardando ? 'Guardando…' : `Guardar${hayCambios ? ` (${Object.keys(borrador).length})` : ''}`}
        </button>
      </div>

      <input
        type="text"
        className="etq-buscador"
        placeholder="Buscar etiqueta…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />

      {CATALOGO.map((sec) => {
        const visibles = sec.items.filter((i) =>
          !b || i.porDefecto.toLowerCase().includes(b) || (overrides[i.clave] || '').toLowerCase().includes(b));
        if (visibles.length === 0) return null;
        return (
          <div className="etq-seccion" key={sec.seccion}>
            <h2 className="etq-seccion-titulo">{sec.seccion}</h2>
            <div className="etq-lista">
              {visibles.map((item) => {
                const personalizado = valorDe(item.clave);
                return (
                  <div className="etq-fila" key={item.clave}>
                    <span className="etq-defecto" title={item.clave}>{item.porDefecto}</span>
                    <span className="etq-flecha">→</span>
                    <input
                      type="text"
                      className={`etq-input${personalizado && personalizado !== item.porDefecto ? ' modificada' : ''}`}
                      placeholder={item.porDefecto}
                      value={personalizado}
                      onChange={(e) => setBorrador((prev) => ({ ...prev, [item.clave]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default EtiquetasDashboard;

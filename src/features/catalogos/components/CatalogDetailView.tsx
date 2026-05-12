// src/features/catalogos/components/CatalogDetailView.tsx
import React from 'react';
import type { CatalogSchema, CatalogDetailSchema } from '../config/catalogSchemas';

interface DataRow {
  [key: string]: any;
}

interface Props {
  schema: CatalogSchema;
  parentData: DataRow | null;
  detailsData?: Record<string, DataRow[]>; 
}

export const CatalogDetailView: React.FC<Props> = ({ schema, parentData, detailsData = {} }) => {
  if (!parentData) return <div className="p-4 text-gray-500">Seleccione un registro para ver los detalles.</div>;

  // Función para formatear fechas en español (para el banner de baja)
  const formatearFechaEsp = (fechaString: string) => {
    if (!fechaString) return 'No definida';
    return new Date(fechaString + 'T00:00:00').toLocaleDateString('es-ES', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
  };

  return (
    <div className="w-full bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* SECCIÓN PRINCIPAL */}
      <div className="p-6 border-b border-gray-200 bg-gray-50">
        
        <div className="flex items-center gap-2 mb-6">
          {schema.icono}
          <h2 className="text-xl font-bold text-gray-800">
            {schema.titulo} - Detalles
            {/* Etiqueta Visual de Estado */}
            {parentData.activo !== undefined && (
              <span className={`ml-4 px-3 py-1 text-xs font-bold rounded-full ${parentData.activo ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-red-100 text-red-700 border border-red-200'}`}>
                {parentData.activo ? 'Activo' : 'Baja'}
              </span>
            )}
          </h2>
        </div>

        {/* ✅ BANNER DE BAJA (Renderizado Condicional) */}
        {parentData.activo === false && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-4">
            <div className="text-2xl">⚠️</div>
            <div>
              <h3 className="text-red-700 font-bold mb-2">Registro Dado de Baja</h3>
              <div className="flex flex-wrap gap-6 text-sm text-gray-700">
                <p><strong>Fecha de Baja:</strong> {formatearFechaEsp(parentData.fechaBaja)}</p>
                <p><strong>Motivo:</strong> {parentData.observacionBaja || 'No especificado'}</p>
              </div>
            </div>
          </div>
        )}
        
        {/* ✅ GRID ESTRICTO DE 3 COLUMNAS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {schema.fields.map((field) => (
            <div key={field.name} className="flex flex-col">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                {field.label}
              </span>
              <span className="text-sm text-gray-900 font-medium bg-white p-2 rounded border border-gray-200 min-h-[38px] flex items-center">
                {parentData[field.name] || 'N/A'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* SECCIÓN DE DETALLES: Sub-colecciones */}
      {schema.details && schema.details.length > 0 && (
        <div className="p-6 flex flex-col gap-8">
          {schema.details.map((detailSchema) => {
            let dataList = detailsData[detailSchema.collection] || [];
            
            // ✅ REGLA ESTRICTA: Conexión de ID_SERVICES con catalogo_tarifas_referencia
            // Filtramos localmente para garantizar que los detalles correspondan exclusivamente al ID padre.
            if (detailSchema.collection === 'tarifas_rendimiento') {
              dataList = dataList.filter((row: any) => String(row.ID_SERVICES) === String(parentData.id));
            } else {
              // Respaldo de seguridad para el resto de colecciones dinámicas
              dataList = dataList.filter((row: any) => String(row[detailSchema.foreignKey]) === String(parentData.id));
            }

            return (
              <ResponsiveTable 
                key={detailSchema.collection} 
                schema={detailSchema} 
                data={dataList} 
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

// COMPONENTE INTERNO: Transformación de tabla a tarjetas en móviles
const ResponsiveTable: React.FC<{ schema: CatalogDetailSchema, data: DataRow[] }> = ({ schema, data }) => {
  return (
    <div className="w-full">
      <style>{`
        @media (max-width: 767px) {
          .table-responsive-${schema.collection} thead { display: none; }
          .table-responsive-${schema.collection} tbody tr { 
            display: block; 
            margin-bottom: 1rem; 
            border: 1px solid #e5e7eb; 
            border-radius: 0.5rem; 
            padding: 0.5rem 1rem;
            background: #fff;
          }
          .table-responsive-${schema.collection} tbody td { 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            border-bottom: 1px solid #f3f4f6; 
            padding: 0.75rem 0; 
            font-size: 0.875rem;
          }
          .table-responsive-${schema.collection} tbody td:last-child { border-bottom: none; }
          .table-responsive-${schema.collection} tbody td::before { 
            content: attr(data-label); 
            font-weight: 600; 
            color: #6b7280; 
            margin-right: 1rem;
          }
        }
      `}</style>
      
      <div className="flex items-center gap-2 mb-4">
        <div className="text-blue-600">{schema.icono}</div>
        <h3 className="text-lg font-semibold text-gray-800">{schema.titulo}</h3>
      </div>

      {data.length === 0 ? (
        <p className="text-sm text-gray-500 italic border border-dashed border-gray-300 p-4 rounded-md text-center">
          No hay registros asociados.
        </p>
      ) : (
        <table className={`table-responsive-${schema.collection} w-full text-left border-collapse`}>
          <thead className="bg-gray-100 rounded-t-md">
            <tr>
              {schema.fields.map((col) => (
                <th key={col.name} className="p-3 text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-200">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {data.map((row, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                {schema.fields.map((col) => (
                  <td 
                    key={col.name} 
                    data-label={col.label} 
                    className="p-3 text-sm text-gray-800"
                  >
                    {col.type === 'currency' 
                      ? `$${Number(row[col.name] || 0).toFixed(2)}` 
                      : row[col.name]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
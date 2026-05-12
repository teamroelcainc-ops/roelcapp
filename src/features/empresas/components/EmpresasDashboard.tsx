// src/features/empresas/components/EmpresasDashboard.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, getDocs } from 'firebase/firestore';
import { db, eliminarRegistro, actualizarRegistro } from '../../../config/firebase';
import { FormularioEmpresa } from './FormularioEmpresa';
import { registrarLog } from '../../../utils/logger';
import * as XLSX from 'xlsx';

const opcionesFiltro = [
  'Todo', 'Proveedor (Servicios)', 'Empresa Inactiva', 'Baja', 'Cliente (Mercancía)', 
  'Propietario (Remolques)', 'Bodega', 'Cliente (Paga)', 'Proveedor (Transporte)', 'Empresas Roelca'
];

// 📋 LISTA DE TODAS LAS COLUMNAS DISPONIBLES PARA EXCEL
const opcionesColumnasExcel = [
  { key: 'numCliente', label: '# de Cliente' },
  { key: 'nombre', label: 'Razón Social' },
  { key: 'nombreCorto', label: 'Nombre Corto' },
  { key: 'status', label: 'Status' },
  { key: 'tiposEmpresa', label: 'Tipo(s) de Empresa' },
  { key: 'servicios', label: 'Servicios Ofrecidos' },
  { key: 'clienteRelacionado', label: 'Cliente Relacionado' },
  { key: 'rfcTaxId', label: 'RFC/Tax ID' },
  { key: 'fechaUltimoServicio', label: 'Último Servicio' },
  { key: 'regimenFiscal', label: 'Régimen Fiscal' },
  { key: 'moneda', label: 'Moneda' },
  { key: 'tipoFactura', label: 'Tipo de Factura' },
  { key: 'condicionPago', label: 'Condición de Pago' },
  { key: 'diasCredito', label: 'Días de Crédito' },
  { key: 'limiteCredito', label: 'Límite de Crédito' },
  { key: 'direccion', label: 'Dirección' },
  { key: 'maps', label: 'Maps' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'correo', label: 'Correo' },
  { key: 'fechaBaja', label: 'Fecha de Baja' },
  { key: 'observacionesBaja', label: 'Observaciones de Baja' }
];

const EmpresasDashboard = () => {
  const [estadoFormulario, setEstadoFormulario] = useState<'cerrado' | 'abierto' | 'minimizado'>('cerrado');
  const [empresaEditando, setEmpresaEditando] = useState<any | null>(null);
  
  const [empresaViendo, setEmpresaViendo] = useState<any | null>(null);
  const [activeTabDetalle, setActiveTabDetalle] = useState<'general' | 'fiscal' | 'contacto'>('general');

  const [empresas, setEmpresas] = useState<any[]>([]);
  const [filtroActivo, setFiltroActivo] = useState('Todo');
  const [busqueda, setBusqueda] = useState('');

  const [modalBajaAbierto, setModalBajaAbierto] = useState(false);
  const [empresaParaBaja, setEmpresaParaBaja] = useState<any | null>(null);
  const [fechaBaja, setFechaBaja] = useState(new Date().toISOString().split('T')[0]);
  const [observacionesBaja, setObservacionesBaja] = useState('');
  const [guardandoBaja, setGuardandoBaja] = useState(false);

  // ✅ ESTADOS PARA EL MODAL DE EXCEL
  const [modalExcelAbierto, setModalExcelAbierto] = useState(false);
  const [excelFiltroTipo, setExcelFiltroTipo] = useState('Todo');
  const [excelColumnasSeleccionadas, setExcelColumnasSeleccionadas] = useState<string[]>(
    opcionesColumnasExcel.map(col => col.key)
  );

  // MOTOR DE DICCIONARIOS PARA TRADUCCIÓN DE IDs
  const [diccionarios, setDiccionarios] = useState<any>({});

  // ✅ ESTADOS DE PAGINACIÓN
  const [paginaActual, setPaginaActual] = useState(1);
  const registrosPorPagina = 50;

  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'empresas'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      
      data.sort((a: any, b: any) => {
        if (a.numCliente && b.numCliente) {
          return b.numCliente.localeCompare(a.numCliente, undefined, { numeric: true, sensitivity: 'base' });
        }
        return 0;
      });
      
      setEmpresas(data);
    });

    const fetchDiccionarios = async () => {
      try {
        const getDict = async (col: string, labelField: string, formatFn?: Function) => {
          const snap = await getDocs(collection(db, col));
          const dict: any = {};
          snap.forEach(doc => dict[doc.id] = formatFn ? formatFn(doc.data()) : doc.data()[labelField]);
          return dict;
        };

        const [reg, mon, fac, dir, tEmpresa, tServicio] = await Promise.all([
          getDict('catalogo_regimen_fiscal', '', (d: any) => `${d.clave} - ${d.descripcion}`),
          getDict('catalogo_moneda', 'moneda'),
          getDict('catalogo_tipo_factura', 'nombre'),
          getDict('direcciones', 'direccionCompleta'),
          getDict('catalogo_tipo_empresa', 'tipo'),
          getDict('catalogo_tipo_servicio', 'nombre')
        ]);

        setDiccionarios({ 
          regimenes: reg, monedas: mon, facturas: fac, direcciones: dir, 
          tiposEmpresa: tEmpresa, tiposServicio: tServicio 
        });
      } catch (error) {
        console.error("Error cargando diccionarios de traducción:", error);
      }
    };

    fetchDiccionarios();
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    setPaginaActual(1);
  }, [busqueda, filtroActivo]);

  const handleNuevo = () => { setEmpresaEditando(null); setEstadoFormulario('abierto'); };
  
  const editarEmpresa = (empresa: any) => { 
    setEmpresaEditando(empresa); 
    setEmpresaViendo(null); 
    setEstadoFormulario('abierto'); 
  };

  const verDetalle = (empresa: any) => {
    setEmpresaViendo(empresa);
    setActiveTabDetalle('general');
  };
  
  const eliminarEmpresa = async (id: string) => {
    if (window.confirm('¿Estás seguro de que deseas eliminar permanentemente esta empresa?')) {
      try {
        await eliminarRegistro('empresas', id);
        await registrarLog('Empresas', 'Eliminación', `Eliminó permanentemente una empresa.`);
        setEmpresaViendo(null); 
      } catch (error) {
        alert('Hubo un error al eliminar. Revisa tu conexión a internet.');
      }
    }
  };

  const abrirModalBaja = (empresa: any) => {
    setEmpresaParaBaja(empresa);
    setFechaBaja(new Date().toISOString().split('T')[0]);
    setObservacionesBaja('');
    setModalBajaAbierto(true);
  };

  const confirmarBaja = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoBaja(true);
    try {
      await actualizarRegistro('empresas', empresaParaBaja.id, {
        status: 'Baja',
        fechaBaja: fechaBaja,
        observacionesBaja: observacionesBaja
      });
      await registrarLog('Empresas', 'Edición', `Dio de baja a la empresa: ${empresaParaBaja.nombre}`);
      
      if (empresaViendo && empresaViendo.id === empresaParaBaja.id) {
        setEmpresaViendo({ ...empresaViendo, status: 'Baja', fechaBaja, observacionesBaja });
      }
      setModalBajaAbierto(false);
    } catch (error) {
      alert("Error al dar de baja. Revisa tu conexión.");
    } finally {
      setGuardandoBaja(false);
    }
  };

  const renderArrayValues = (values: any) => {
    if (!values) return '-';
    if (Array.isArray(values)) {
      if (values.length === 0) return '-';
      return values.join(', ');
    }
    return values; 
  };

  const mostrarDato = (dato: any) => (dato && dato !== '' ? dato : '-');

  const getLabel = (idOrRaw: string, dictName: string) => {
    if (!idOrRaw) return '-';
    const dict = diccionarios[dictName];
    if (dict && dict[idOrRaw]) return dict[idOrRaw];
    return idOrRaw; 
  };

  const getLabelExt = (labelField: string, idField: string, dictName: string) => {
    if (labelField && labelField !== '-') return labelField;
    if (!idField) return '-';
    const dict = diccionarios[dictName];
    if (dict && dict[idField]) return dict[idField];
    return idField;
  };

  const getArrayLabels = (idsArray: any, dictName: string) => {
    if (!idsArray) return [];
    const dict = diccionarios[dictName];
    if (Array.isArray(idsArray)) {
      return idsArray.map(item => {
        if (dict && dict[item]) return dict[item];
        return item;
      });
    }
    if (typeof idsArray === 'string') {
      if (dict && dict[idsArray]) return [dict[idsArray]];
      return [idsArray];
    }
    return [];
  };

  const registrosListos = useMemo(() => {
    return empresas.map(emp => {
      let clienteRelName = emp.clienteRelacionadoNombre;
      if (!clienteRelName && emp.clienteRelacionadoId) {
        const match = empresas.find(e => e.id === emp.clienteRelacionadoId);
        clienteRelName = match ? match.nombre : emp.clienteRelacionadoId;
      }
      return {
        ...emp,
        _regimenLabel: getLabelExt(emp.regimenFiscalLabel, emp.regimenFiscalId || emp.regimenFiscal, 'regimenes'),
        _monedaLabel: getLabel(emp.moneda, 'monedas'),
        _facturaLabel: getLabel(emp.tipoFactura, 'facturas'),
        _direccionLabel: getLabelExt(emp.direccionLabel, emp.direccionId || emp.direccion, 'direcciones'),
        _clienteRelLabel: clienteRelName || '-',
        _tiposEmpresaArray: getArrayLabels(emp.tiposEmpresa, 'tiposEmpresa'),
        _tiposServicioArray: getArrayLabels(emp.tiposServicio, 'tiposServicio')
      };
    });
  }, [empresas, diccionarios]);

  const registrosFiltrados = useMemo(() => {
    return registrosListos.filter(emp => {
      let pasaFiltro = true;
      if (filtroActivo === 'Empresa Inactiva') pasaFiltro = emp.status === 'Inactiva';
      else if (filtroActivo === 'Baja') pasaFiltro = emp.status === 'Baja';
      else if (filtroActivo !== 'Todo') {
        pasaFiltro = emp._tiposEmpresaArray.includes(filtroActivo) || emp._tiposServicioArray.includes(filtroActivo);
      }
      if (!pasaFiltro) return false;

      if (!busqueda.trim()) return true;
      const term = busqueda.toLowerCase();
      return (
        String(emp.nombre || '').toLowerCase().includes(term) ||
        String(emp.numCliente || '').toLowerCase().includes(term) ||
        String(emp.nombreCorto || '').toLowerCase().includes(term) ||
        String(emp.rfcTaxId || '').toLowerCase().includes(term) ||
        String(emp._clienteRelLabel || '').toLowerCase().includes(term)
      );
    });
  }, [registrosListos, filtroActivo, busqueda]);

  const totalPaginas = Math.ceil(registrosFiltrados.length / registrosPorPagina);
  const indiceUltimoRegistro = paginaActual * registrosPorPagina;
  const indicePrimerRegistro = indiceUltimoRegistro - registrosPorPagina;
  const registrosEnPantalla = registrosFiltrados.slice(indicePrimerRegistro, indiceUltimoRegistro);

  const irPaginaSiguiente = () => setPaginaActual(prev => Math.min(prev + 1, totalPaginas));
  const irPaginaAnterior = () => setPaginaActual(prev => Math.max(prev - 1, 1));

  const handleToggleColumnaExcel = (key: string) => {
    setExcelColumnasSeleccionadas(prev => 
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const seleccionarTodasColumnas = () => setExcelColumnasSeleccionadas(opcionesColumnasExcel.map(c => c.key));
  const deseleccionarTodasColumnas = () => setExcelColumnasSeleccionadas([]);

  const ejecutarExportacionExcel = () => {
    if (excelColumnasSeleccionadas.length === 0) return alert("Selecciona al menos una columna para exportar.");

    let datosAExportar = [...registrosListos];
    
    if (excelFiltroTipo === 'Empresa Inactiva') {
      datosAExportar = datosAExportar.filter(e => e.status === 'Inactiva');
    } else if (excelFiltroTipo === 'Baja') {
      datosAExportar = datosAExportar.filter(e => e.status === 'Baja');
    } else if (excelFiltroTipo !== 'Todo') {
      datosAExportar = datosAExportar.filter(e => e._tiposEmpresaArray.includes(excelFiltroTipo) || e._tiposServicioArray.includes(excelFiltroTipo));
    }

    if (datosAExportar.length === 0) {
      return alert("No hay empresas que coincidan con este filtro para exportar.");
    }

    const datosExcel = datosAExportar.map(emp => {
      const rowData: any = {};
      
      if (excelColumnasSeleccionadas.includes('numCliente')) rowData['# de Cliente'] = emp.numCliente || '';
      if (excelColumnasSeleccionadas.includes('nombre')) rowData['Razón Social'] = emp.nombre || '';
      if (excelColumnasSeleccionadas.includes('nombreCorto')) rowData['Nombre Corto'] = emp.nombreCorto || '';
      if (excelColumnasSeleccionadas.includes('status')) rowData['Status'] = emp.status || '';
      if (excelColumnasSeleccionadas.includes('tiposEmpresa')) rowData['Tipo(s) de Empresa'] = renderArrayValues(emp._tiposEmpresaArray);
      if (excelColumnasSeleccionadas.includes('servicios')) rowData['Servicios Ofrecidos'] = renderArrayValues(emp._tiposServicioArray);
      if (excelColumnasSeleccionadas.includes('clienteRelacionado')) rowData['Cliente Relacionado'] = emp._clienteRelLabel !== '-' ? emp._clienteRelLabel : '';
      if (excelColumnasSeleccionadas.includes('rfcTaxId')) rowData['RFC/Tax ID'] = emp.rfcTaxId || '';
      if (excelColumnasSeleccionadas.includes('fechaUltimoServicio')) rowData['Último Servicio'] = emp.fechaUltimoServicio || '';
      if (excelColumnasSeleccionadas.includes('regimenFiscal')) rowData['Régimen Fiscal'] = emp._regimenLabel !== '-' ? emp._regimenLabel : '';
      if (excelColumnasSeleccionadas.includes('moneda')) rowData['Moneda'] = emp._monedaLabel !== '-' ? emp._monedaLabel : '';
      if (excelColumnasSeleccionadas.includes('tipoFactura')) rowData['Tipo de Factura'] = emp._facturaLabel !== '-' ? emp._facturaLabel : '';
      if (excelColumnasSeleccionadas.includes('condicionPago')) rowData['Condición de Pago'] = emp.condicionPago || '';
      if (excelColumnasSeleccionadas.includes('diasCredito')) rowData['Días de Crédito'] = emp.diasCredito || 0;
      if (excelColumnasSeleccionadas.includes('limiteCredito')) rowData['Límite de Crédito'] = emp.limiteCredito || 0;
      if (excelColumnasSeleccionadas.includes('direccion')) rowData['Dirección'] = emp._direccionLabel !== '-' ? emp._direccionLabel : '';
      if (excelColumnasSeleccionadas.includes('maps')) rowData['Maps'] = emp.maps || '';
      if (excelColumnasSeleccionadas.includes('telefono')) rowData['Teléfono'] = emp.telefono || '';
      if (excelColumnasSeleccionadas.includes('correo')) rowData['Correo'] = emp.correo || '';
      if (excelColumnasSeleccionadas.includes('fechaBaja')) rowData['Fecha de Baja'] = emp.fechaBaja || '';
      if (excelColumnasSeleccionadas.includes('observacionesBaja')) rowData['Observaciones de Baja'] = emp.observacionesBaja || '';

      return rowData;
    });

    const worksheet = XLSX.utils.json_to_sheet(datosExcel);
    const columnWidths = Object.keys(datosExcel[0]).map(k => ({ wch: Math.max(k.length, 20) }));
    worksheet['!cols'] = columnWidths;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Directorio_Empresas');
    XLSX.writeFile(workbook, `Empresas_${excelFiltroTipo.replace(/ /g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`);
    
    setModalExcelAbierto(false);
  };

  const tabStyle = (isActive: boolean) => ({
    padding: '12px 20px', background: 'none', border: 'none',
    borderBottom: isActive ? '2px solid #D84315' : '2px solid transparent',
    color: isActive ? '#f0f6fc' : '#8b949e', cursor: 'pointer',
    fontWeight: isActive ? '600' : 'normal', fontSize: '0.9rem',
    transition: 'all 0.2s ease', outline: 'none'
  });

  return (
    <div className="module-container" style={{ padding: '24px', animation: 'fadeIn 0.3s ease', width: '100%', boxSizing: 'border-box' }}>
      
      {estadoFormulario !== 'cerrado' && (
        <FormularioEmpresa 
          estado={estadoFormulario} initialData={empresaEditando} registros={empresas}
          onClose={() => { setEstadoFormulario('cerrado'); setEmpresaEditando(null); }}
          onMinimize={() => setEstadoFormulario('minimizado')} onRestore={() => setEstadoFormulario('abierto')}
        />
      )}

      <div style={{ width: '100%', margin: '0 auto' }}>
        
        <h1 className="module-title" style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 24px 0', fontWeight: 'bold' }}>
          Empresas
        </h1>

        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', width: '100%' }}>
          
          <div style={{ flex: '1 1 auto', maxWidth: '200px', minWidth: '150px' }}>
            <select 
              className="form-control" 
              value={filtroActivo} 
              onChange={(e) => setFiltroActivo(e.target.value)}
              style={{ width: '100%', backgroundColor: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', cursor: 'pointer', padding: '10px', borderRadius: '6px' }}
            >
              {opcionesFiltro.map(opcion => (
                <option key={opcion} value={opcion}>
                  {opcion === 'Todo' ? 'Filtro: Todos' : opcion}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: '2 1 250px', display: 'flex', justifyContent: 'center' }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: '500px' }}>
              <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#8b949e' }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              <input 
                type="text" 
                placeholder="Buscar Razón Social, RFC, Alias o # Cliente..." 
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                style={{ width: '100%', padding: '10px 10px 10px 40px', backgroundColor: '#0d1117', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem', boxSizing: 'border-box' }}
              />
            </div>
          </div>

          <div style={{ flex: '1 1 auto', display: 'flex', gap: '12px', justifyContent: 'flex-end', minWidth: '280px' }}>
            <button 
              className="btn btn-outline" 
              title="Exportar a Excel"
              onClick={() => setModalExcelAbierto(true)} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent', border: '1px solid #8b949e', color: '#c9d1d9', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            </button>
            <button 
              className="btn btn-primary" 
              title="Agregar Empresa"
              onClick={handleNuevo} 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#D84315', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div className="content-body" style={{ display: 'block', width: '100%' }}>
          <div className="table-container" style={{ border: '1px solid #30363d', borderRadius: '8px', overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 280px)', width: '100%' }}>
            <table className="data-table" style={{ width: '100%', minWidth: '1200px', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead style={{ backgroundColor: '#161b22', position: 'sticky', top: 0, zIndex: 10 }}>
                <tr>
                  <th style={{ padding: '16px', width: '140px', textAlign: 'center', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', position: 'sticky', left: 0, backgroundColor: '#161b22', zIndex: 12, borderRight: '1px solid #30363d', borderBottom: '1px solid #30363d' }}>Acciones</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}># de Cliente</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Empresa</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Nombre Corto</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Tipo de Empresa</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Servicios</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>RFC / Tax Id</th>
                  <th style={{ padding: '16px', color: '#8b949e', fontSize: '0.8rem', fontWeight: '600', textTransform: 'uppercase', whiteSpace: 'nowrap', borderBottom: '1px solid #30363d' }}>Fecha Serv.</th>
                </tr>
              </thead>
              <tbody>
                {registrosEnPantalla.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: '#8b949e' }}>
                      {busqueda || filtroActivo !== 'Todo' ? 'No se encontraron empresas con estos filtros.' : 'Aún no hay empresas registradas.'}
                    </td>
                  </tr>
                ) : (
                  registrosEnPantalla.map((emp) => (
                    <tr 
                      key={emp.id} 
                      style={{ borderBottom: '1px solid #21262d', backgroundColor: hoveredRowId === emp.id ? '#21262d' : '#0d1117', transition: 'background-color 0.2s', cursor: 'pointer' }}
                      onMouseEnter={() => setHoveredRowId(emp.id)} 
                      onMouseLeave={() => setHoveredRowId(null)}
                      onClick={() => verDetalle(emp)}
                    >
                      <td style={{ padding: '16px', textAlign: 'center', position: 'sticky', left: 0, backgroundColor: 'inherit', zIndex: 5, borderRight: '1px solid #30363d' }} onClick={(e: any) => e.stopPropagation()}>
                        <div className="actions-cell" style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          
                          <button 
                            className="btn-small btn-edit" 
                            title="Editar Empresa"
                            onClick={(e) => { e.stopPropagation(); editarEmpresa(emp); }}
                            style={{ background: 'transparent', border: '1px solid #3b82f6', borderRadius: '4px', color: '#3b82f6', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                          </button>
                          
                          {/* BOTÓN DAR BAJA */}
                          {emp.status !== 'Baja' && (
                            <button 
                              className="btn-small btn-warning" 
                              title="Dar de Baja a la Empresa"
                              onClick={(e) => { e.stopPropagation(); abrirModalBaja(emp); }}
                              style={{ background: 'transparent', border: '1px solid #f59e0b', borderRadius: '4px', color: '#f59e0b', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                              onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(245, 158, 11, 0.1)'}
                              onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
                            </button>
                          )}

                          <button 
                            className="btn-small btn-danger" 
                            title="Eliminar Empresa"
                            onClick={(e) => { e.stopPropagation(); eliminarEmpresa(emp.id); }}
                            style={{ background: 'transparent', border: '1px solid #ef4444', borderRadius: '4px', color: '#ef4444', cursor: 'pointer', padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }}
                            onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                          </button>

                        </div>
                      </td>

                      <td className="font-mono" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                        {emp.status === 'Baja' ? <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{emp.numCliente}</span> : emp.numCliente}
                      </td>
                      <td style={{ padding: '16px', fontWeight: '500', color: emp.status === 'Baja' ? '#ef4444' : '#f0f6fc', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>
                        {emp.nombre} {emp.status === 'Baja' && <span style={{ fontSize: '0.7rem', border: '1px solid #ef4444', padding: '2px 4px', borderRadius: '4px', marginLeft: '6px' }}>BAJA</span>}
                      </td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{mostrarDato(emp.nombreCorto)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.85rem', maxWidth: '200px', whiteSpace: 'normal' }}>
                        {renderArrayValues(emp._tiposEmpresaArray)}
                      </td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.85rem', maxWidth: '200px', whiteSpace: 'normal' }}>
                        {renderArrayValues(emp._tiposServicioArray)}
                      </td>
                      <td className="font-mono" style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{mostrarDato(emp.rfcTaxId)}</td>
                      <td style={{ padding: '16px', color: '#c9d1d9', fontSize: '0.95rem', whiteSpace: 'nowrap' }}>{mostrarDato(emp.fechaUltimoServicio)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {registrosFiltrados.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 8px', flexWrap: 'wrap', gap: '10px' }}>
              <div style={{ color: '#8b949e', fontSize: '0.9rem' }}>
                Mostrando {indicePrimerRegistro + 1} - {Math.min(indiceUltimoRegistro, registrosFiltrados.length)} de {registrosFiltrados.length} registros
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  title="Página Anterior"
                  onClick={irPaginaAnterior} 
                  disabled={paginaActual === 1}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === 1 ? '#0d1117' : '#21262d', color: paginaActual === 1 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                <span style={{ padding: '6px 12px', color: '#f0f6fc', fontWeight: 'bold' }}>{paginaActual} / {totalPaginas || 1}</span>
                <button 
                  title="Página Siguiente"
                  onClick={irPaginaSiguiente} 
                  disabled={paginaActual === totalPaginas || totalPaginas === 0}
                  style={{ padding: '6px 12px', backgroundColor: paginaActual === totalPaginas || totalPaginas === 0 ? '#0d1117' : '#21262d', color: paginaActual === totalPaginas || totalPaginas === 0 ? '#484f58' : '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: paginaActual === totalPaginas || totalPaginas === 0 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* MODAL CONFIGURACIÓN REPORTE EXCEL */}
      {modalExcelAbierto && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 2000, display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
          <div style={{ maxWidth: '600px', width: '100%', backgroundColor: '#0d1117', borderRadius: '12px', border: '1px solid #30363d', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}>
            
            <div style={{ padding: '20px 24px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <h2 style={{ margin: 0, color: '#f0f6fc', fontSize: '1.25rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#238636" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Generar Reporte Excel
              </h2>
              <button onClick={() => setModalExcelAbierto(false)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>

            <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
              
              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: '#f0f6fc', fontWeight: 'bold', marginBottom: '8px', fontSize: '1rem' }}>
                  1. Selecciona el Tipo de Cliente/Empresa a exportar:
                </label>
                <select 
                  value={excelFiltroTipo} 
                  onChange={(e) => setExcelFiltroTipo(e.target.value)}
                  style={{ width: '100%', padding: '10px', backgroundColor: '#161b22', border: '1px solid #30363d', borderRadius: '6px', color: '#c9d1d9', fontSize: '0.95rem' }}
                >
                  {opcionesFiltro.map(opcion => (
                    <option key={`xls_${opcion}`} value={opcion}>{opcion === 'Todo' ? 'Todos los registros' : opcion}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '12px' }}>
                  <label style={{ color: '#f0f6fc', fontWeight: 'bold', fontSize: '1rem', margin: 0 }}>
                    2. Selecciona las columnas a incluir:
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button onClick={seleccionarTodasColumnas} style={{ background: 'transparent', border: 'none', color: '#58a6ff', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>Marcar todas</button>
                    <button onClick={deseleccionarTodasColumnas} style={{ background: 'transparent', border: 'none', color: '#8b949e', fontSize: '0.8rem', cursor: 'pointer', textDecoration: 'underline' }}>Desmarcar todas</button>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', backgroundColor: '#161b22', padding: '16px', borderRadius: '8px', border: '1px solid #30363d' }}>
                  {opcionesColumnasExcel.map(col => {
                    const isChecked = excelColumnasSeleccionadas.includes(col.key);
                    return (
                      <label key={col.key} style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isChecked ? '#f0f6fc' : '#8b949e', cursor: 'pointer', fontSize: '0.9rem' }}>
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={() => handleToggleColumnaExcel(col.key)}
                          style={{ cursor: 'pointer' }}
                        />
                        {col.label}
                      </label>
                    );
                  })}
                </div>
              </div>

            </div>

            <div style={{ padding: '16px 24px', borderTop: '1px solid #30363d', display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button 
                onClick={() => setModalExcelAbierto(false)} 
                style={{ padding: '8px 16px', backgroundColor: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: '6px', cursor: 'pointer' }}
              >
                Cancelar
              </button>
              <button 
                onClick={ejecutarExportacionExcel}
                style={{ padding: '8px 16px', backgroundColor: '#238636', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Generar y Descargar Excel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DETALLES DE EMPRESA */}
      {empresaViendo && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1000 }}>
          <div className="form-card detail-card" style={{ maxWidth: '850px', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '12px', overflow: 'hidden' }}>
            
            <div className="form-header" style={{ borderBottom: '1px solid #30363d', padding: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ color: '#f0f6fc', margin: 0, fontSize: '1.25rem' }}>Detalle de Empresa <span style={{ color: '#D84315' }}>{empresaViendo.numCliente}</span></h2>
                {empresaViendo.status === 'Baja' && (
                  <span style={{ display: 'inline-block', marginTop: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '4px 8px', borderRadius: '4px', fontSize: '0.75rem', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                    EMPRESA DADA DE BAJA EL {empresaViendo.fechaBaja}
                  </span>
                )}
              </div>
              <button onClick={() => setEmpresaViendo(null)} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: '1.2rem' }}>✕</button>
            </div>
            
            <div style={{ display: 'flex', borderBottom: '1px solid #30363d', backgroundColor: '#161b22', padding: '0 24px' }}>
              <button type="button" onClick={() => setActiveTabDetalle('general')} style={tabStyle(activeTabDetalle === 'general')}>General</button>
              <button type="button" onClick={() => setActiveTabDetalle('fiscal')} style={tabStyle(activeTabDetalle === 'fiscal')}>Comercial / Fiscal</button>
              <button type="button" onClick={() => setActiveTabDetalle('contacto')} style={tabStyle(activeTabDetalle === 'contacto')}>Contacto</button>
            </div>

            <div className="detail-content" style={{ padding: '24px', minHeight: '300px' }}>
              
              {activeTabDetalle === 'general' && (
                <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', animation: 'fadeIn 0.3s ease' }}>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Razón Social</span><span className="detail-value" style={{ color: '#f0f6fc', fontSize: '1rem', fontWeight: 'bold' }}>{mostrarDato(empresaViendo.nombre)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Nombre Corto</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.nombreCorto)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Status</span><span className="detail-value" style={{ color: '#c9d1d9', display: 'flex', alignItems: 'center', gap: '8px' }}><span className={`dot ${empresaViendo.status === 'Activa' ? 'dot-green' : empresaViendo.status === 'Baja' ? 'dot-red' : 'dot-gray'}`}></span>{mostrarDato(empresaViendo.status)}</span></div>
                  
                  <div className="detail-item" style={{ gridColumn: 'span 3' }}><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Tipo(s) de Empresa</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{renderArrayValues(empresaViendo._tiposEmpresaArray)}</span></div>
                  <div className="detail-item" style={{ gridColumn: 'span 3' }}><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Servicios Ofrecidos</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{renderArrayValues(empresaViendo._tiposServicioArray)}</span></div>
                  
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>RFC / Tax ID</span><span className="detail-value font-mono" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.rfcTaxId)}</span></div>
                  <div className="detail-item" style={{ gridColumn: 'span 2' }}><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Fecha del último servicio</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.fechaUltimoServicio)}</span></div>
                  
                  {Array.isArray(empresaViendo.tiposEmpresa) && empresaViendo.tiposEmpresa.includes('Cliente (Mercancía)') && (
                    <div className="detail-item" style={{ gridColumn: 'span 3' }}><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Cliente Paga (Relacionado)</span><span className="detail-value" style={{ color: '#58a6ff', fontWeight: '500' }}>{mostrarDato(empresaViendo._clienteRelLabel)}</span></div>
                  )}

                  {empresaViendo.status === 'Baja' && (
                    <div style={{ gridColumn: 'span 3', backgroundColor: 'rgba(239, 68, 68, 0.05)', padding: '16px', borderRadius: '8px', border: '1px dashed #ef4444', display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px' }}>
                      <div className="detail-item" style={{ marginBottom: '0' }}><span className="detail-label" style={{ color: '#ef4444', fontSize: '0.8rem', display:'block' }}>Fecha de Baja</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.fechaBaja)}</span></div>
                      <div className="detail-item"><span className="detail-label" style={{ color: '#ef4444', fontSize: '0.8rem', display:'block' }}>Observaciones de Baja</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.observacionesBaja)}</span></div>
                    </div>
                  )}
                </div>
              )}

              {activeTabDetalle === 'fiscal' && (
                <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', animation: 'fadeIn 0.3s ease' }}>
                  <div className="detail-item" style={{ gridColumn: 'span 3' }}><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Régimen Fiscal</span><span className="detail-value" style={{ color: '#f0f6fc', fontSize: '0.95rem' }}>{mostrarDato(empresaViendo._regimenLabel)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Moneda</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo._monedaLabel)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Tipo de Factura</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo._facturaLabel)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Condición de Pago</span><span className="detail-value" style={{ color: '#58a6ff', fontWeight: 'bold' }}>{mostrarDato(empresaViendo.condicionPago)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Días de Crédito</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.diasCredito)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Límite de Crédito</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{empresaViendo.limiteCredito ? `$${empresaViendo.limiteCredito}` : '-'}</span></div>
                </div>
              )}

              {activeTabDetalle === 'contacto' && (
                <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', animation: 'fadeIn 0.3s ease' }}>
                  <div className="detail-item" style={{ gridColumn: 'span 2' }}><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Dirección de Facturación</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo._direccionLabel)}</span></div>
                  <div className="detail-item" style={{ gridColumn: 'span 2' }}><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Link de Maps</span>
                    {empresaViendo.maps ? <a href={empresaViendo.maps} target="_blank" rel="noopener noreferrer" style={{ color: '#58a6ff', textDecoration: 'none' }}>Ver en Google Maps ↗</a> : <span style={{ color: '#c9d1d9' }}>-</span>}
                  </div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Teléfono</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.telefono)}</span></div>
                  <div className="detail-item"><span className="detail-label" style={{ color: '#8b949e', fontSize: '0.85rem', display:'block' }}>Correo Electrónico</span><span className="detail-value" style={{ color: '#c9d1d9' }}>{mostrarDato(empresaViendo.correo)}</span></div>
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* MODAL DE BAJA DE EMPRESA */}
      {modalBajaAbierto && (
        <div className="modal-overlay" style={{ backdropFilter: 'blur(4px)', zIndex: 1100 }}>
          <div className="form-card modal-content" style={{ maxWidth: '400px', backgroundColor: '#0d1117', border: '1px solid #444', borderRadius: '8px' }}>
            <h3 style={{ color: '#ef4444', marginTop: 0 }}>Dar de baja Empresa</h3>
            <p style={{ color: '#c9d1d9', fontSize: '0.9rem' }}>Vas a dar de baja a: <strong>{empresaParaBaja?.nombre}</strong></p>
            <form onSubmit={confirmarBaja}>
              <div className="form-group" style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#8b949e', marginBottom: '8px', fontSize: '0.9rem' }}>Fecha de Baja *</label>
                <input 
                  type="date" 
                  className="form-control" 
                  value={fechaBaja} 
                  onChange={(e) => setFechaBaja(e.target.value)} 
                  required 
                  style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '4px' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', color: '#8b949e', marginBottom: '8px', fontSize: '0.9rem' }}>Observaciones (Opcional)</label>
                <textarea 
                  className="form-control" 
                  rows={3} 
                  value={observacionesBaja} 
                  onChange={(e) => setObservacionesBaja(e.target.value)} 
                  placeholder="Motivo de la baja..."
                  style={{ width: '100%', padding: '8px', backgroundColor: '#161b22', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '4px' }}
                />
              </div>
              <div className="form-actions" style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button type="button" className="btn btn-outline" onClick={() => setModalBajaAbierto(false)} disabled={guardandoBaja} style={{ padding: '8px 16px', background: 'none', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: '4px', cursor: 'pointer' }}>Cancelar</button>
                <button type="submit" className="btn btn-danger" disabled={guardandoBaja} style={{ padding: '8px 16px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  {guardandoBaja ? 'Guardando...' : 'Confirmar Baja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmpresasDashboard;
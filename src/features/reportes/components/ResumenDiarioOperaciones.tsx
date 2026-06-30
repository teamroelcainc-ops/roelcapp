// src/features/reportes/components/ResumenDiarioOperaciones.tsx
//
// ═══════════════════════════════════════════════════════════════════════
// RESÚMENES DIARIOS DE OPERACIONES (Transfer / Logística / Fletes)
// ═══════════════════════════════════════════════════════════════════════
// Réplica en React de los tres reportes que antes se generaban con Google
// Apps Script + AppSheet. Toman las operaciones de la colección `operaciones`
// de Firestore, filtran por UN día (fechaServicio) y arman el PDF con el
// MISMO diseño (logo + landscape + tablas). El PDF se descarga abriendo la
// ventana de impresión del navegador → "Guardar como PDF" (igual que el
// ReportesDashboard del proyecto).
//
// RUTA: src/features/reportes/components/ResumenDiarioOperaciones.tsx
//
// Clasificación (por `tipoOperacionNombre` o catálogo de tipo de operación):
//   • Transfer  → contiene "transfer"
//   • Logística → contiene "logist"
//   • Fletes    → contiene "flete"
//
// Cómo se derivan los conteos especiales (ajustables por palabra clave):
//   • TIPO DE SERVICIO  = agrupado por nombre de Convenio.
//   • TROMPO            = ops cuyo Convenio/Tipo contiene "trompo".
//   • CARGA DE DIESEL   = ops con combustible (diésel) > 0.
//   • CARGA DE GASOLINA = ops cuyo Convenio/Tipo contiene "gasolina".
//   • LOGISTICA ROELCA  = ops cuyo Convenio/Tipo contiene "logistica roelca".
//   • CANCELADA         = ops cuyo estatus contiene "cancel".
//   • ROELCA (Logística)= ops cuyo Proveedor de Transporte contiene "roelca".
//   • DIESEL (col.)     = suma de `combustibleTotal` (o combustible+extra) por unidad.
//   • REF. COBRABLES    = Servicios − No Cobrables (cancelada / no cobrable).
// ═══════════════════════════════════════════════════════════════════════

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../../../config/firebase';
// Mismo logo base64 que usan los demás PDF del proyecto.
import { LOGO_DEFAULT } from '../../../utils/pdfGenerator';

type TipoResumen = 'Transfer' | 'Logística' | 'Fletes';
const TIPOS: TipoResumen[] = ['Transfer', 'Logística', 'Fletes'];

// ---------- Helpers de texto / fecha ----------
const norm = (s: any): string =>
  String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

const esId = (v: any): boolean => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return false;
  return /^[0-9a-f]{6,}$/i.test(s) || /^[A-Za-z0-9]{18,}$/.test(s);
};

// Escapa texto para insertarlo en el HTML del PDF de forma segura.
const esc = (s: any): string =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fmtNum = (val: any): string => {
  const n = parseFloat(String(val));
  return isNaN(n) ? '0.00' : n.toFixed(2);
};

// Normaliza cualquier formato de fecha a "YYYY-MM-DD" (ISO, Timestamp, DD/MM/YYYY…).
const normalizarFechaISO = (valor: any): string => {
  if (valor === null || valor === undefined || valor === '') return '';
  if (typeof valor === 'object') {
    try {
      if (typeof valor.toDate === 'function') { const d = valor.toDate(); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); }
      if (typeof valor.seconds === 'number') return new Date(valor.seconds * 1000).toISOString().slice(0, 10);
      if (valor instanceof Date && !isNaN(valor.getTime())) return valor.toISOString().slice(0, 10);
    } catch { /* sigue */ }
    return '';
  }
  if (typeof valor === 'number') {
    const d = new Date(valor > 1e12 ? valor : valor * 1000);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  const s = String(valor).trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    const a = Number(m[1]), b = Number(m[2]);
    let dd = a, mm = b;
    if (a <= 12 && b > 12) { mm = a; dd = b; }
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
    return `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

// "YYYY-MM-DD" → "DD/MM/YYYY"
const fmtFechaLatina = (iso: string): string => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

// Agrupa por una clave de texto → [{label, count}] ordenado por count desc.
const groupCount = (arr: any[], keyFn: (o: any) => string, def: string) => {
  const m = new Map<string, number>();
  arr.forEach(o => { const k = (keyFn(o) || '').trim() || def; m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
};

interface Maps {
  emp: Record<string, string>;
  tipo: Record<string, string>;
  status: Record<string, string>;
  conv: Record<string, string>;
  uni: Record<string, string>;
  ope: Record<string, string>;
}

export const ResumenDiarioOperaciones = () => {
  const hoyISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  const [fecha, setFecha] = useState(hoyISO);
  const [realizadoPor, setRealizadoPor] = useState('');
  const [tipoActivo, setTipoActivo] = useState<TipoResumen>('Transfer');

  const [opsAll, setOpsAll] = useState<any[]>([]);
  const [maps, setMaps] = useState<Maps>({ emp: {}, tipo: {}, status: {}, conv: {}, uni: {}, ope: {} });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cargadoRef = useRef(false);

  // Prefill "Realizado por" con el nombre del usuario logueado (editable).
  useEffect(() => {
    try {
      const u = auth.currentUser;
      if (u) setRealizadoPor(u.displayName || u.email || '');
    } catch { /* noop */ }
  }, []);

  // Carga catálogos + TODAS las operaciones una sola vez (filtramos por día en memoria
  // porque las fechas pueden venir en formatos mezclados).
  const cargarTodo = async () => {
    setCargando(true); setError(null);
    try {
      const [opSnap, eSnap, tSnap, sSnap, cdSnap, tarSnap, uniSnap, empSnap] = await Promise.all([
        getDocs(collection(db, 'operaciones')),
        getDocs(collection(db, 'empresas')),
        getDocs(collection(db, 'catalogo_tipo_operacion')),
        getDocs(collection(db, 'catalogo_status_servicio')),
        getDocs(collection(db, 'convenios_clientes_detalles')),
        getDocs(collection(db, 'catalogo_tarifas_referencia')),
        getDocs(collection(db, 'unidades')),
        getDocs(collection(db, 'empleados')),
      ]);

      const emp: Record<string, string> = {};
      eSnap.docs.forEach(d => { emp[d.id] = String((d.data() as any).nombre || ''); });

      const tipo: Record<string, string> = {};
      tSnap.docs.forEach(d => { tipo[d.id] = String((d.data() as any).tipo_operacion || ''); });

      const status: Record<string, string> = {};
      sSnap.docs.forEach(d => { status[d.id] = String((d.data() as any).nombre || ''); });

      const uni: Record<string, string> = {};
      uniSnap.docs.forEach(d => {
        const u = d.data() as any;
        const txt = String(u.unidad || u.nombre || '').trim();
        if (txt) uni[d.id] = txt;
      });

      const ope: Record<string, string> = {};
      empSnap.docs.forEach(d => {
        const o = d.data() as any;
        const txt = `${o.firstName || ''} ${o.lastNamePaternal || ''}`.trim() || String(o.nombre || o.nombreCompleto || '').trim();
        if (txt) ope[d.id] = txt;
      });

      const tarifas: Record<string, string> = {};
      tarSnap.docs.forEach(d => {
        const data = d.data() as any;
        tarifas[d.id] = String(data.descripcion || data.nombre || data.tarifa || data.concepto || '');
      });
      const conv: Record<string, string> = {};
      cdSnap.docs.forEach(d => {
        const data = d.data() as any;
        const tarifaId = data.tipoConvenioId || data.tipo_convenio_id || data.tipoConvenio || data.tipo_convenio || data['TIPO DE CONVENIO'];
        const nombre = data.tipoConvenioNombre || tarifas[String(tarifaId)] || '';
        if (nombre) conv[d.id] = nombre;
      });

      const ops = opSnap.docs.map(d => {
        const data = d.data() as any;
        const iso = normalizarFechaISO(data.fechaServicio);
        return { id: d.id, ...data, _fechaISO: iso };
      });

      setMaps({ emp, tipo, status, conv, uni, ope });
      setOpsAll(ops);
      cargadoRef.current = true;
    } catch (e: any) {
      console.error('Error cargando datos para resúmenes diarios:', e);
      setError(e?.message || 'No se pudieron cargar las operaciones.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => { cargarTodo(); /* eslint-disable-next-line */ }, []);

  // ---------- Resolutores de nombres (desnormalizado → catálogo → crudo) ----------
  const tipoTexto = (o: any): string => String(o.tipoOperacionNombre || maps.tipo[String(o.tipoOperacionId)] || '');
  const clasificar = (o: any): TipoResumen | 'Otro' => {
    const t = norm(tipoTexto(o));
    if (t.includes('transfer')) return 'Transfer';
    if (t.includes('logist')) return 'Logística';
    if (t.includes('flete')) return 'Fletes';
    return 'Otro';
  };
  const nombreCliente = (o: any): string => {
    const d = o.clienteNombre || o.nombreCliente;
    if (d && !esId(d)) return String(d);
    const k = String(o.clientePaga || o.clienteId || '').trim();
    return maps.emp[k] || (k && !esId(k) ? k : '');
  };
  const nombreProveedor = (o: any): string => {
    const d = o.proveedorUnidadNombre;
    if (d && !esId(d)) return String(d);
    const k = String(o.proveedorUnidad || '').trim();
    return maps.emp[k] || (k && !esId(k) ? k : '');
  };
  const nombreConvenio = (o: any): string => {
    const d = o.convenioNombre;
    if (d && !esId(d)) return String(d);
    const k = String(o.convenio || '').trim();
    return maps.conv[k] || (k && !esId(k) ? k : '');
  };
  const nombreUnidad = (o: any): string => {
    const d = o.unidadNombre;
    if (d && !esId(d)) return String(d);
    const k = String(o.unidad || '').trim();
    return maps.uni[k] || (k && !esId(k) ? k : '');
  };
  const nombreOperador = (o: any): string => {
    const d = o.operadorNombre;
    if (d && !esId(d)) return String(d);
    const k = String(o.operador || '').trim();
    return maps.ope[k] || (k && !esId(k) ? k : '');
  };
  const statusNombre = (o: any): string => {
    const d = o.statusNombre;
    if (d && !esId(d)) return String(d);
    const k = String(o.status || '').trim();
    return maps.status[k] || (k && !esId(k) ? k : '');
  };

  const dieselDe = (o: any): number => {
    const t = Number(o.combustibleTotal);
    if (!isNaN(t) && t) return t;
    return (Number(o.combustible) || 0) + (Number(o.combustibleExtra) || 0);
  };
  const textoServicio = (o: any): string => norm(`${nombreConvenio(o)} ${tipoTexto(o)}`);
  const matchKw = (o: any, kw: string): boolean => textoServicio(o).includes(kw);
  const esCancelada = (o: any): boolean => norm(statusNombre(o)).includes('cancel');
  const esNoCobrable = (o: any): boolean => { const s = norm(statusNombre(o)); return s.includes('cancel') || s.includes('no cobrable'); };
  const esRoelca = (o: any): boolean => norm(nombreProveedor(o)).includes('roelca');

  // Operaciones del día seleccionado.
  const opsDia = useMemo(
    () => opsAll.filter(o => o._fechaISO === fecha),
    [opsAll, fecha]
  );

  // ---------- Cálculo de un resumen por tipo ----------
  const computarTipo = (tipo: TipoResumen) => {
    const ops = opsDia.filter(o => clasificar(o) === tipo);
    const servicios = ops.length;
    const tipoServicio = groupCount(ops, nombreConvenio, '(Sin convenio)');
    const clientes = groupCount(ops, nombreCliente, '(Sin cliente)');
    const cancelada = ops.filter(esCancelada).length;
    const noCobrables = ops.filter(esNoCobrable).length;
    const refCobrables = servicios - noCobrables;

    if (tipo === 'Transfer') {
      const operadores = groupCount(ops, nombreOperador, '(Sin operador)');
      // Unidades con OP (conteo) y DIESEL (suma de combustible).
      const um = new Map<string, { op: number; diesel: number }>();
      ops.forEach(o => {
        const k = (nombreUnidad(o) || '').trim() || '(Sin unidad)';
        const cur = um.get(k) || { op: 0, diesel: 0 };
        cur.op += 1; cur.diesel += dieselDe(o);
        um.set(k, cur);
      });
      const unidades = [...um.entries()].map(([label, v]) => ({ label, op: v.op, diesel: v.diesel }))
        .sort((a, b) => b.op - a.op || a.label.localeCompare(b.label, 'es', { sensitivity: 'base' }));
      const dieselTotal = unidades.reduce((s, u) => s + u.diesel, 0);

      const trompo = ops.filter(o => matchKw(o, 'trompo')).length;
      const cargaDiesel = ops.filter(o => dieselDe(o) > 0).length;
      const cargaGasolina = ops.filter(o => matchKw(o, 'gasolina')).length;
      const logisticaRoelca = ops.filter(o => matchKw(o, 'logistica roelca') || matchKw(o, 'logística roelca')).length;

      return {
        tipo, servicios, refCobrables, cancelada,
        tipoServicio, clientes, operadores, unidades, dieselTotal,
        trompo, cargaDiesel, cargaGasolina, logisticaRoelca,
      };
    }

    // Logística / Fletes
    const proveedores = groupCount(ops, nombreProveedor, '(Sin proveedor)');
    const roelca = ops.filter(esRoelca).length;
    return { tipo, servicios, refCobrables, cancelada, tipoServicio, clientes, proveedores, roelca };
  };

  // ---------- CSS del PDF (réplica del diseño de AppSheet) ----------
  const CSS = `
    @page { size: letter landscape; margin: 0.25in; }
    * { box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 10px; margin: 0; padding: 0; color: #333; line-height: 1.2; background-color: #fff; }
    .page-container { width: 100%; max-width: 10.5in; margin: auto; }
    table { width: 95%; margin: 0 auto 6px auto; border-collapse: collapse; table-layout: fixed; font-size: 10px; }
    td, th { border: 1px solid #ccc; padding: 3px 5px; vertical-align: middle; overflow: hidden; }
    .w-80 { width: 80%; } .w-20 { width: 20%; }
    .text-cell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #444; }
    .num-cell { text-align: center; font-weight: bold; color: #111; }
    .text-center { text-align: center; } .text-right { text-align: right; }
    .bold { font-weight: bold; } .border-none { border: none; }
    .header-table td { border: none; padding-bottom: 10px; }
    .main-title { text-align: center; font-size: 16px; font-weight: bold; color: #000; letter-spacing: 1px; border-bottom: 2px solid #000; padding-bottom: 5px; }
    .logo-img { width: 120px; }
    .info-header { font-weight: bold; color: #555; }
    .info-val { font-weight: bold; color: #000; border-bottom: 1px solid #ccc; padding: 0 5px; }
    .table-header { background-color: #f0f0f0; font-weight: bold; text-transform: uppercase; font-size: 9px; color: #333; }
    .table-header td { border: 1px solid #bbb; }
    .highlight-cell { background-color: #e6e6e6; }
    .column-wrapper { display: flex; justify-content: center; gap: 15px; margin-bottom: 10px; width: 100%; align-items: flex-start; }
    .col-left { width: 38%; } .col-right { width: 58%; } .col-inf { flex: 1; }
  `;

  const filas2 = (rows: { label: string; count: number }[]): string =>
    rows.length === 0
      ? `<tr><td colspan="2" class="text-center">Sin datos registrados</td></tr>`
      : rows.map(r => `<tr><td class="text-cell w-80">${esc(r.label)}</td><td class="num-cell w-20">${fmtNum(r.count)}</td></tr>`).join('');

  const filasUnidades = (rows: { label: string; op: number; diesel: number }[]): string =>
    rows.length === 0
      ? `<tr><td colspan="3" class="text-center">Sin datos registrados</td></tr>`
      : rows.map(r => `<tr><td class="text-cell w-80">${esc(r.label)}</td><td class="num-cell w-20">${fmtNum(r.op)}</td><td class="num-cell w-20">${fmtNum(r.diesel)}</td></tr>`).join('');

  const cabecera = (titulo: string, etiquetaRealizo: string): string => `
    <table class="header-table" style="width: 100%;">
      <tbody><tr>
        <td style="width: 150px;">${LOGO_DEFAULT ? `<img alt="Logo" class="logo-img" src="${LOGO_DEFAULT}" />` : `<h2>LOGO</h2>`}</td>
        <td class="main-title">${titulo}</td>
      </tr></tbody>
    </table>
    <table style="border: none; margin-bottom: 15px;">
      <tbody><tr>
        <td class="border-none" style="width: 40%;"></td>
        <td class="border-none text-right info-header">${etiquetaRealizo}</td>
        <td class="border-none info-val text-center" style="width: 180px;">${esc(realizadoPor)}</td>
        <td class="border-none text-right info-header">FECHA:</td>
        <td class="border-none info-val text-center" style="width: 120px;">${esc(fmtFechaLatina(fecha))}</td>
      </tr></tbody>
    </table>`;

  const cuerpoTransfer = (d: any): string => `
    ${cabecera('RESUMEN DIARIO DE OPERACIONES TRANSFER', 'REALIZADO POR:')}
    <div class="column-wrapper">
      <div class="col-left">
        <table><tbody>
          <tr><td class="bold text-cell w-80">SERVICIOS:</td><td class="table-header text-center w-20">${fmtNum(d.servicios)}</td></tr>
          <tr><td class="text-cell">OTROS COBRABLES (TROMPOS)</td><td class="num-cell highlight-cell">${fmtNum(0)}</td></tr>
          <tr><td class="text-cell">CARGA DE DIESEL</td><td class="num-cell">${fmtNum(d.cargaDiesel)}</td></tr>
          <tr><td class="text-cell">CARGA DE GASOLINA</td><td class="num-cell">${fmtNum(d.cargaGasolina)}</td></tr>
          <tr><td class="text-cell">CANCELADA</td><td class="num-cell">${fmtNum(d.cancelada)}</td></tr>
          <tr><td class="text-cell">TROMPO</td><td class="num-cell">${fmtNum(d.trompo)}</td></tr>
          <tr><td class="text-cell">OTROS NO COBRABLES</td><td class="num-cell highlight-cell">${fmtNum(0)}</td></tr>
          <tr><td class="text-cell">LOGISTICA ROELCA</td><td class="num-cell">${fmtNum(d.logisticaRoelca)}</td></tr>
          <tr><td class="bold text-cell">SERVICIOS TOTALES TRANSFER</td><td class="table-header text-center" style="border: 2px solid #555;">${fmtNum(d.servicios)}</td></tr>
          <tr><td class="bold text-cell">REF. COBRABLES TRANSFER</td><td class="num-cell" style="color: #004080;">${fmtNum(d.refCobrables)}</td></tr>
        </tbody></table>
      </div>
      <div class="col-right">
        <table>
          <thead><tr class="table-header"><td class="text-center w-80">TIPO DE SERVICIO</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr></thead>
          <tbody>${filas2(d.tipoServicio)}</tbody>
        </table>
      </div>
    </div>
    <div class="column-wrapper">
      <div class="col-inf">
        <table>
          <thead>
            <tr class="table-header"><td class="text-center w-80">${fmtNum(d.clientes.length)}</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr>
            <tr class="table-header"><td class="text-center w-80">CLIENTES</td><td class="text-center w-20">#</td></tr>
          </thead>
          <tbody>${filas2(d.clientes)}</tbody>
        </table>
      </div>
      <div class="col-inf" style="flex: 1.3;">
        <table>
          <thead>
            <tr class="table-header"><td class="text-center" style="width: 50%;">${fmtNum(d.unidades.length)}</td><td class="text-center" style="width: 25%;">${fmtNum(d.servicios)}</td><td class="text-center" style="width: 25%;">${fmtNum(d.dieselTotal)}</td></tr>
            <tr class="table-header"><td class="text-center">UNIDADES</td><td class="text-center">OP</td><td class="text-center">DIESEL</td></tr>
          </thead>
          <tbody>${filasUnidades(d.unidades)}</tbody>
        </table>
      </div>
      <div class="col-inf">
        <table>
          <thead>
            <tr class="table-header"><td class="text-center w-80">${fmtNum(d.operadores.length)}</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr>
            <tr class="table-header"><td class="text-center w-80">OPERADORES</td><td class="text-center w-20">#</td></tr>
          </thead>
          <tbody>${filas2(d.operadores)}</tbody>
        </table>
      </div>
    </div>`;

  const cuerpoLogistica = (d: any): string => `
    ${cabecera('RESUMEN DIARIO DE OPERACIONES LOGISTICA', 'REALIZÓ EL REPORTE:')}
    <div class="column-wrapper">
      <div class="col-left">
        <table><tbody>
          <tr><td class="bold text-cell w-80">SERVICIOS:</td><td class="table-header text-center w-20">${fmtNum(d.servicios)}</td></tr>
          <tr><td class="text-cell">OTROS COBRABLES</td><td class="num-cell highlight-cell">${fmtNum(0)}</td></tr>
          <tr><td class="text-cell">CANCELADA</td><td class="num-cell">${fmtNum(d.cancelada)}</td></tr>
          <tr><td class="text-cell">OTROS NO COBRABLES</td><td class="num-cell highlight-cell">${fmtNum(0)}</td></tr>
          <tr><td class="text-cell">ROELCA</td><td class="num-cell">${fmtNum(d.roelca)}</td></tr>
          <tr><td class="bold text-cell">SERVICIOS TOTALES LOGISTICA</td><td class="table-header text-center" style="border: 2px solid #555;">${fmtNum(d.servicios)}</td></tr>
          <tr><td class="bold text-cell">REF. COBRABLES LOGISTICA</td><td class="num-cell" style="color: #004080;">${fmtNum(d.refCobrables)}</td></tr>
        </tbody></table>
      </div>
      <div class="col-right">
        <table>
          <thead><tr class="table-header"><td class="text-center w-80">TIPO DE SERVICIO</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr></thead>
          <tbody>${filas2(d.tipoServicio)}</tbody>
        </table>
      </div>
    </div>
    <div class="column-wrapper">
      <div class="col-inf">
        <table>
          <thead>
            <tr class="table-header"><td class="text-center w-80">${fmtNum(d.clientes.length)}</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr>
            <tr class="table-header"><td class="text-center w-80">CLIENTES</td><td class="text-center w-20">#</td></tr>
          </thead>
          <tbody>${filas2(d.clientes)}</tbody>
        </table>
      </div>
      <div class="col-inf">
        <table>
          <thead>
            <tr class="table-header"><td class="text-center w-80">${fmtNum(d.proveedores.length)}</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr>
            <tr class="table-header"><td class="text-center w-80">PROVEEDORES</td><td class="text-center w-20">#</td></tr>
          </thead>
          <tbody>${filas2(d.proveedores)}</tbody>
        </table>
      </div>
    </div>`;

  const cuerpoFletes = (d: any): string => `
    ${cabecera('RESUMEN DIARIO DE OPERACIONES FLETES', 'REALIZADO POR:')}
    <div class="column-wrapper">
      <div class="col-left">
        <table><tbody>
          <tr><td class="bold text-cell w-80">SERVICIOS:</td><td class="table-header text-center w-20">${fmtNum(d.servicios)}</td></tr>
          <tr><td class="text-cell">OTROS COBRABLES</td><td class="num-cell highlight-cell">${fmtNum(0)}</td></tr>
          <tr><td class="text-cell">CANCELADA</td><td class="num-cell">${fmtNum(d.cancelada)}</td></tr>
          <tr><td class="text-cell">OTROS NO COBRABLES</td><td class="num-cell highlight-cell">${fmtNum(0)}</td></tr>
          <tr><td class="bold text-cell">SERVICIOS TOTALES FLETES</td><td class="table-header text-center" style="border: 2px solid #555;">${fmtNum(d.servicios)}</td></tr>
          <tr><td class="bold text-cell">REF. COBRABLES FLETES</td><td class="num-cell" style="color: #004080;">${fmtNum(d.refCobrables)}</td></tr>
        </tbody></table>
      </div>
      <div class="col-right">
        <table>
          <thead><tr class="table-header"><td class="text-center w-80">TIPO DE SERVICIO</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr></thead>
          <tbody>${filas2(d.tipoServicio)}</tbody>
        </table>
      </div>
    </div>
    <div class="column-wrapper">
      <div class="col-inf">
        <table>
          <thead>
            <tr class="table-header"><td class="text-center w-80">${fmtNum(d.clientes.length)}</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr>
            <tr class="table-header"><td class="text-center w-80">CLIENTES</td><td class="text-center w-20">#</td></tr>
          </thead>
          <tbody>${filas2(d.clientes)}</tbody>
        </table>
      </div>
      <div class="col-inf">
        <table>
          <thead>
            <tr class="table-header"><td class="text-center w-80">${fmtNum(d.proveedores.length)}</td><td class="text-center w-20">${fmtNum(d.servicios)}</td></tr>
            <tr class="table-header"><td class="text-center w-80">PROVEEDORES</td><td class="text-center w-20">#</td></tr>
          </thead>
          <tbody>${filas2(d.proveedores)}</tbody>
        </table>
      </div>
    </div>`;

  const construirHTML = (tipo: TipoResumen, conPrint: boolean): string => {
    const d = computarTipo(tipo);
    const cuerpo = tipo === 'Transfer' ? cuerpoTransfer(d) : tipo === 'Logística' ? cuerpoLogistica(d) : cuerpoFletes(d);
    const scriptPrint = conPrint
      ? `<script>window.onload=function(){setTimeout(function(){window.print();},250);}</script>`
      : '';
    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Resumen Diario ${esc(tipo)}</title><style type="text/css">${CSS}</style></head><body><div class="page-container">${cuerpo}</div>${scriptPrint}</body></html>`;
  };

  const descargarPDF = (tipo: TipoResumen) => {
    const w = window.open('', '_blank');
    if (!w) { alert('Permite las ventanas emergentes para descargar el PDF.'); return; }
    w.document.open();
    w.document.write(construirHTML(tipo, true));
    w.document.close();
  };

  // ---------- UI ----------
  const inputEstilo: React.CSSProperties = { background: '#0d1117', border: '1px solid #30363d', color: '#c9d1d9', borderRadius: 6, padding: '8px 10px', fontSize: '0.9rem' };
  const btnPrimary: React.CSSProperties = { padding: '10px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(180deg,#ea580c,#c2410c)', color: '#fff', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };
  const btnOutline: React.CSSProperties = { padding: '9px 16px', borderRadius: 8, border: '1px solid #30363d', background: 'transparent', color: '#c9d1d9', fontWeight: 600, fontSize: '0.9rem', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 };

  const totalDia = opsDia.length;
  const previewSrc = useMemo(() => construirHTML(tipoActivo, false), [tipoActivo, opsDia, maps, realizadoPor, fecha]);

  return (
    <div style={{ padding: 24, width: '100%', boxSizing: 'border-box', color: '#c9d1d9', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <h1 style={{ fontSize: '1.5rem', color: '#f0f6fc', margin: '0 0 4px', fontWeight: 'bold' }}>Resúmenes Diarios de Operaciones</h1>
      <p style={{ color: '#8b949e', margin: '0 0 20px', fontSize: '0.92rem' }}>Genera el resumen diario de Transfer, Logística o Fletes y descárgalo en PDF (mismo formato de antes).</p>

      {/* Barra de filtros */}
      <div style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, padding: 18, marginBottom: 18, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Fecha</label>
          <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} style={inputEstilo} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: '1 1 240px', minWidth: 200 }}>
          <label style={{ fontSize: '0.72rem', color: '#8b949e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px' }}>Realizado por</label>
          <input type="text" value={realizadoPor} onChange={e => setRealizadoPor(e.target.value)} placeholder="Nombre de quien realiza el reporte" style={{ ...inputEstilo, width: '100%' }} />
        </div>
        <button onClick={cargarTodo} disabled={cargando} style={{ ...btnOutline, opacity: cargando ? 0.6 : 1 }} title="Volver a leer las operaciones desde la base de datos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
          {cargando ? 'Cargando…' : 'Recargar'}
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={() => descargarPDF(tipoActivo)} disabled={cargando || totalDia === 0} style={{ ...btnPrimary, opacity: (cargando || totalDia === 0) ? 0.55 : 1 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Descargar PDF {tipoActivo}
        </button>
      </div>

      {/* Selector de tipo */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TIPOS.map(t => {
          const activo = t === tipoActivo;
          const count = opsDia.filter(o => clasificar(o) === t).length;
          return (
            <button key={t} onClick={() => setTipoActivo(t)}
              style={{
                padding: '9px 16px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem',
                border: activo ? '1px solid #fb923c' : '1px solid #30363d',
                background: activo ? 'rgba(251,146,60,0.12)' : 'transparent',
                color: activo ? '#fb923c' : '#c9d1d9',
                display: 'inline-flex', alignItems: 'center', gap: 8,
              }}>
              {t}
              <span style={{ background: activo ? '#fb923c' : '#30363d', color: activo ? '#0d1117' : '#c9d1d9', borderRadius: 20, padding: '1px 8px', fontSize: '0.72rem', fontWeight: 700 }}>{count}</span>
            </button>
          );
        })}
      </div>

      {error && <div style={{ background: 'rgba(248,81,73,.08)', border: '1px solid rgba(248,81,73,.3)', color: '#ff9b94', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontSize: '0.88rem' }}>{error}</div>}

      {!cargando && totalDia === 0 && !error && (
        <div style={{ background: '#0d1117', border: '1px dashed #30363d', borderRadius: 12, padding: 30, textAlign: 'center', color: '#6e7681', marginBottom: 16 }}>
          No hay operaciones registradas el <b style={{ color: '#fb923c' }}>{fmtFechaLatina(fecha)}</b>. Cambia la fecha o pulsa <b style={{ color: '#fb923c' }}>Recargar</b>.
        </div>
      )}

      {/* Vista previa */}
      <div style={{ background: '#fff', border: '1px solid #30363d', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ background: '#0d1117', padding: '10px 14px', borderBottom: '1px solid #30363d', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>Vista previa · {tipoActivo} · {fmtFechaLatina(fecha)}</span>
          <span style={{ color: '#8b949e', fontSize: '0.8rem' }}>{cargando ? 'Cargando…' : `${opsDia.filter(o => clasificar(o) === tipoActivo).length} operación(es)`}</span>
        </div>
        <iframe title="preview-resumen" srcDoc={previewSrc} style={{ width: '100%', height: 520, border: 'none', background: '#fff' }} />
      </div>
    </div>
  );
};

export default ResumenDiarioOperaciones;
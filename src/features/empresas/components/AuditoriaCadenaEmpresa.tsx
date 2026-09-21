// ✅ V00333: AUDITORÍA DE LA CADENA POR EMPRESA — desde la ficha de Empresas.
//   Muestra, EN VIVO y separado por el PAPEL de la empresa, todo lo suyo:
//   · Cliente (Paga): sus operaciones, su facturación y sus pagos, cruzados.
//   · Cliente (Mercancía): las operaciones donde va su mercancía (la
//     facturación corre por el cliente que PAGA; se indica quién paga).
//   · Proveedor (transporte y servicios): sus operaciones, la facturación de
//     proveedor y los pagos hechos al proveedor, cruzados.
//   Clic en una operación, factura o pago muestra SOLO su camino (clic de
//   nuevo para volver). Se abre desde el botón 🔍 de la ficha de la empresa.
import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import './AuditoriaCadenaEmpresa.css';

interface Props { empresaId: string; empresaNombre: string; onCerrar: () => void; }

type Papel = 'paga' | 'mercancia' | 'proveedor';

const money = (n: number) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ID_USD = '7dca62b3'; const ID_MXN = 'f95d8894';
const nombreMoneda = (v: unknown): string => {
  const t = String(v || '').trim();
  if (!t) return '';
  if (t.includes(ID_USD) || /d[oó]lar|usd/i.test(t)) return 'USD';
  if (t.includes(ID_MXN) || /peso|mxn/i.test(t)) return 'MXN';
  return t.length > 12 ? '' : t.toUpperCase();
};
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
/** ✅ V00335: fecha a ISO aaaa-mm-dd (acepta ISO o d/m/aaaa de las migradas). */
const fechaISO = (v: unknown): string => {
  const t = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
};

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapear = (s: any): any[] => s.docs.map((d: any) => ({ id: d.id, ...d.data() }));
/** Fusiona dos fuentes de la misma colección (alias de campo distintos) por id. */
const fusionar = (prev: any[] | null, nuevos: any[], fuente: 'a' | 'b'): any[] => {
  const marcados = nuevos.map((x) => ({ ...x, __f: fuente }));
  const otras = (prev || []).filter((x) => x.__f !== fuente);
  const m = new Map<string, any>();
  [...otras, ...marcados].forEach((x) => m.set(String(x.id), x));
  return Array.from(m.values());
};

export const AuditoriaCadenaEmpresa: React.FC<Props> = ({ empresaId, empresaNombre, onCerrar }) => {
  const [papel, setPapel] = useState<Papel>('paga');
  const [opsPaga, setOpsPaga] = useState<any[] | null>(null);
  const [opsMerc, setOpsMerc] = useState<any[] | null>(null);
  const [opsProv, setOpsProv] = useState<any[] | null>(null);
  const [factCli, setFactCli] = useState<any[] | null>(null);
  const [factProv, setFactProv] = useState<any[] | null>(null);
  const [pagosCli, setPagosCli] = useState<any[] | null>(null);
  const [pagosProv, setPagosProv] = useState<any[] | null>(null);
  const [sel, setSel] = useState<{ tipo: 'op' | 'fact' | 'pago'; id: string } | null>(null);
  // ✅ V00335: rango de fechas (fecha de servicio de las operaciones) y la
  //   MONEDA configurada en la ficha de la empresa.
  const [rangoIni, setRangoIni] = useState('');
  const [rangoFin, setRangoFin] = useState('');
  const [monedaEmpresa, setMonedaEmpresa] = useState('');

  useEffect(() => {
    if (!empresaId) return;
    getDoc(doc(db, 'empresas', empresaId))
      .then((d) => setMonedaEmpresa(nombreMoneda((d.data() as Record<string, unknown> | undefined)?.moneda || (d.data() as Record<string, unknown> | undefined)?.monedaId)))
      .catch((e) => console.error('ACE moneda empresa:', e)); // ✅ V00335
    const subs = [
      onSnapshot(query(collection(db, 'operaciones'), where('clientePaga', '==', empresaId)), (s) => setOpsPaga(mapear(s)), (e) => console.error('ACE ops paga:', e)),
      onSnapshot(query(collection(db, 'operaciones'), where('clienteMercancia', '==', empresaId)), (s) => setOpsMerc(mapear(s)), (e) => console.error('ACE ops mercancía:', e)),
      onSnapshot(query(collection(db, 'operaciones'), where('proveedorUnidad', '==', empresaId)), (s) => setOpsProv(mapear(s)), (e) => console.error('ACE ops proveedor:', e)),
      onSnapshot(query(collection(db, 'facturas_clientes'), where('clienteId', '==', empresaId)), (s) => setFactCli(mapear(s)), (e) => console.error('ACE fact cliente:', e)),
      onSnapshot(query(collection(db, 'facturas_proveedores'), where('proveedorId', '==', empresaId)), (s) => setFactProv(mapear(s)), (e) => console.error('ACE fact proveedor:', e)),
      // Pagos: unos documentos guardan clienteId/proveedorId y otros entidadId —
      // se consultan AMBOS y se fusionan por id.
      onSnapshot(query(collection(db, 'pagos'), where('tipo', '==', 'cliente'), where('clienteId', '==', empresaId)), (s) => setPagosCli((prev) => fusionar(prev, mapear(s), 'a')), (e) => console.error('ACE pagos cliente:', e)),
      onSnapshot(query(collection(db, 'pagos'), where('tipo', '==', 'cliente'), where('entidadId', '==', empresaId)), (s) => setPagosCli((prev) => fusionar(prev, mapear(s), 'b')), (e) => console.error('ACE pagos cliente (entidadId):', e)),
      onSnapshot(query(collection(db, 'pagos'), where('tipo', '==', 'proveedor'), where('proveedorId', '==', empresaId)), (s) => setPagosProv((prev) => fusionar(prev, mapear(s), 'a')), (e) => console.error('ACE pagos proveedor:', e)),
      onSnapshot(query(collection(db, 'pagos'), where('tipo', '==', 'proveedor'), where('entidadId', '==', empresaId)), (s) => setPagosProv((prev) => fusionar(prev, mapear(s), 'b')), (e) => console.error('ACE pagos proveedor (entidadId):', e)),
    ];
    return () => subs.forEach((u) => u());
  }, [empresaId]);

  /** Arma las tres columnas cruzadas de un lado (cliente o proveedor). */
  const armarLado = (ops: any[] | null, facturas: any[] | null, pagos: any[] | null, montoOp: (op: any) => number, monedaOp: (op: any) => string) => {
    const listaOps = ops || []; const listaF = facturas || []; const listaP = pagos || [];
    // Factura → ops amparadas; op → facturas donde aparece.
    const factsDeOp = new Map<string, string[]>();
    const opsDeFact = new Map<string, string[]>();
    listaF.forEach((f) => {
      const guardadas = Array.isArray(f.operacionesGuardadas) ? f.operacionesGuardadas : [];
      const ids = guardadas.map((g: any) => String(g?.id || '')).filter(Boolean);
      opsDeFact.set(String(f.id), ids);
      ids.forEach((oid: string) => { factsDeOp.set(oid, [...(factsDeOp.get(oid) || []), String(f.id)]); });
    });
    // Pago → facturas aplicadas; factura → pagos.
    const factsDePago = new Map<string, string[]>();
    const pagosDeFact = new Map<string, string[]>();
    listaP.forEach((p) => {
      const apl = Array.isArray(p.facturas) ? p.facturas : [];
      const ids = apl.map((fa: any) => String(fa?.facturaId || '')).filter(Boolean);
      factsDePago.set(String(p.id), ids);
      ids.forEach((fid: string) => { pagosDeFact.set(fid, [...(pagosDeFact.get(fid) || []), String(p.id)]); });
    });
    const filasOps = listaOps.map((op) => ({
      id: String(op.id), ref: String(op.ref || op.id), fecha: String(op.fechaServicio || ''),
      status: String(op.statusNombre || ''), monto: montoOp(op), moneda: monedaOp(op),
      facturas: factsDeOp.get(String(op.id)) || [], raw: op,
      cancelada: /cancelad/i.test(String(op.statusNombre || '')),
    })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const filasF = listaF.map((f) => {
      const pagosIds = pagosDeFact.get(String(f.id)) || [];
      return {
        id: String(f.id), invoice: String(f.invoice || f.id), fecha: String(f.fecha || ''),
        total: num(f.subtotalFactura ?? f.totalFactura ?? f.total), moneda: nombreMoneda(f.monedaFacturacion || f.monedaProveedor || f.moneda || f.monedaId),
        pagado: num(f.montoPagado), saldo: num(f.saldoPendiente),
        ops: opsDeFact.get(String(f.id)) || [], pagos: pagosIds, raw: f,
      };
    }).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    const filasP = listaP.map((p) => ({
      id: String(p.id), numero: String(p.numeroPago || p.id), fecha: String(p.fecha || ''),
      metodo: String(p.metodoPago || ''), monto: num(p.monto ?? p.montoTotal), moneda: nombreMoneda(p.moneda || p.monedaId),
      facturas: factsDePago.get(String(p.id)) || [],
      invoices: (Array.isArray(p.facturas) ? p.facturas : []).map((fa: any) => String(fa?.invoice || '')).filter(Boolean).join(', '),
      raw: p,
    })).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
    return { filasOps, filasF, filasP };
  };

  const lado = useMemo(() => {
    // ✅ V00335: el rango filtra LAS OPERACIONES por su fecha de servicio;
    //   la facturación y los pagos de la empresa se muestran completos.
    const enRango = (ops: any[] | null): any[] | null => {
      if (ops === null) return null;
      if (!rangoIni && !rangoFin) return ops;
      return ops.filter((op) => {
        const iso = fechaISO(op.fechaServicio);
        if (!iso) return true;
        if (rangoIni && iso < rangoIni) return false;
        if (rangoFin && iso > rangoFin) return false;
        return true;
      });
    };
    const opsPagaR = enRango(opsPaga); const opsMercR = enRango(opsMerc); const opsProvR = enRango(opsProv);
    if (papel === 'paga') return armarLado(opsPagaR, factCli, pagosCli, (op) => num(op.conversionCliente) || num(op.montoConvenioCliente), (op) => nombreMoneda(op.monedaConvenioCliente || op.facturadoEnCobrar));
    if (papel === 'proveedor') return armarLado(opsProvR, factProv, pagosProv, (op) => num(op.conversionProv) || num(op.totalAPagarProv), (op) => nombreMoneda(op.monedaConvenioProveedor || op.facturadoEnUnidad));
    return armarLado(opsMercR, [], [], (op) => num(op.conversionCliente) || num(op.montoConvenioCliente), (op) => nombreMoneda(op.monedaConvenioCliente));
  }, [papel, opsPaga, opsMerc, opsProv, factCli, factProv, pagosCli, pagosProv, rangoIni, rangoFin]);

  // Camino de la selección (las facturas arrastran sus ops y pagos).
  const camino = useMemo(() => {
    const vacio = { ops: new Set<string>(), facturas: new Set<string>(), pagos: new Set<string>() };
    if (!sel) return vacio;
    const opsSet = new Set<string>(); const factSet = new Set<string>(); const pagosSet = new Set<string>();
    if (sel.tipo === 'op') { opsSet.add(sel.id); (lado.filasOps.find((x) => x.id === sel.id)?.facturas || []).forEach((f) => factSet.add(f)); }
    else if (sel.tipo === 'fact') factSet.add(sel.id);
    else { pagosSet.add(sel.id); (lado.filasP.find((x) => x.id === sel.id)?.facturas || []).forEach((f) => factSet.add(f)); }
    lado.filasOps.forEach((o) => { if (o.facturas.some((f) => factSet.has(f))) opsSet.add(o.id); });
    lado.filasF.forEach((f) => { if (factSet.has(f.id)) f.pagos.forEach((p) => pagosSet.add(p)); });
    return { ops: opsSet, facturas: factSet, pagos: pagosSet };
  }, [sel, lado]);

  const cargando = opsPaga === null || opsMerc === null || opsProv === null;
  const totales = useMemo(() => ({
    ops: lado.filasOps.length,
    montoOps: lado.filasOps.filter((o) => !o.cancelada).reduce((a, o) => a + o.monto, 0),
    facturado: lado.filasF.reduce((a, f) => a + f.total, 0),
    aplicado: lado.filasP.reduce((a, p) => a + p.monto, 0),
  }), [lado]);

  const conteo = (arr: any[] | null) => (arr === null ? '…' : String(arr.length));
  const claseSel = (enCamino: boolean, esSel: boolean) => `${esSel ? ' ace-item--sel' : ''}${sel && enCamino ? ' ace-item--camino' : ''}`;

  return (
    <div className="modal-overlay ace-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="form-card ace-modal">
        <div className="ace-encabezado">
          <div>
            <h3 className="ace-titulo">🔍 Auditoría de la cadena — {empresaNombre}</h3>
            <p className="ace-sub">Todo lo de esta empresa, EN VIVO y separado por su papel. Clic en una operación, factura o pago muestra SOLO su camino (clic de nuevo para volver).</p>
          </div>
          <button type="button" className="roelca-window-btn danger" title="Cerrar" onClick={onCerrar}>✕</button>
        </div>

        {/* ── Pestañas por PAPEL ── */}
        <div className="ace-tabs">
          <button type="button" className={`ace-tab${papel === 'paga' ? ' ace-tab--activa' : ''}`} onClick={() => { setPapel('paga'); setSel(null); }}>Cliente (Paga) <span className="ace-tab-n">{conteo(opsPaga)}</span></button>
          <button type="button" className={`ace-tab${papel === 'mercancia' ? ' ace-tab--activa' : ''}`} onClick={() => { setPapel('mercancia'); setSel(null); }}>Cliente (Mercancía) <span className="ace-tab-n">{conteo(opsMerc)}</span></button>
          <button type="button" className={`ace-tab${papel === 'proveedor' ? ' ace-tab--activa' : ''}`} onClick={() => { setPapel('proveedor'); setSel(null); }}>Proveedor (transporte y servicios) <span className="ace-tab-n">{conteo(opsProv)}</span></button>
        </div>

        {/* ✅ V00335: rango de fechas + moneda de la empresa */}
        <div className="ace-barra">
          <span className="ace-rango" title="El rango aplica a la FECHA DE SERVICIO de las operaciones; la facturación y los pagos se muestran completos">
            Servicio de <input type="date" className="form-control ace-rango-input" value={rangoIni} onChange={(e) => setRangoIni(e.target.value)} />
            a <input type="date" className="form-control ace-rango-input" value={rangoFin} onChange={(e) => setRangoFin(e.target.value)} />
            {(rangoIni || rangoFin) && <button type="button" className="ace-mini" title="Quitar el rango" onClick={() => { setRangoIni(''); setRangoFin(''); }}>✕</button>}
          </span>
          <span className="ace-moneda" title="Moneda configurada en la ficha de la empresa">Moneda de la empresa: <b>{monedaEmpresa || '—'}</b></span>
        </div>

        {cargando ? <div className="ace-cargando">Cargando la cadena de la empresa…</div> : (
          <>
            {/* ── Totales del papel activo ── */}
            <div className="ace-totales">
              <div className="ace-total"><b>{totales.ops}</b><span>OPERACIONES</span></div>
              <div className="ace-total"><b>{money(totales.montoOps)}</b><span>OPERACIONES (CONVERSIÓN)</span></div>
              {papel !== 'mercancia' && <div className="ace-total"><b>{money(totales.facturado)}</b><span>FACTURADO</span></div>}
              {papel !== 'mercancia' && <div className="ace-total"><b>{money(totales.aplicado)}</b><span>APLICADO POR PAGOS</span></div>}
            </div>
            {papel === 'mercancia' && <p className="ace-nota">ℹ La facturación y los pagos de estas operaciones corren por el CLIENTE QUE PAGA (se indica en cada operación). Audítalo desde su propia ficha.</p>}

            <div className={`ace-columnas${papel === 'mercancia' ? ' ace-columnas--una' : ''}`}>
              {/* ── OPERACIONES ── */}
              <div className="ace-col">
                <div className="ace-col-titulo">OPERACIONES ({lado.filasOps.length})</div>
                <div className="ace-col-scroll">
                  {lado.filasOps.map((x) => {
                    if (sel && !camino.ops.has(x.id)) return null;
                    return (
                      <div key={x.id} className={`ace-item ace-item--clic${x.cancelada ? ' ace-item--cancelada' : ''}${claseSel(camino.ops.has(x.id), sel?.tipo === 'op' && sel.id === x.id)}`}
                        title="Clic para ver SOLO el camino de esta operación"
                        onClick={() => setSel((prev) => prev?.tipo === 'op' && prev.id === x.id ? null : { tipo: 'op', id: x.id })}>
                        <div className="ace-item-fila1">
                          <span className="ace-ref">{x.ref}</span>
                          {x.moneda && <span className="ace-chip">{x.moneda}</span>}
                          <span className="ace-monto">{money(x.monto)}</span>
                        </div>
                        <div className="ace-item-fila2">{x.fecha || '—'} · {x.status || '—'}</div>
                        <div className="ace-item-detalle">
                          {papel === 'mercancia'
                            ? <>Paga: {String(x.raw?.clienteNombre || '—')}{x.raw?.facturadoEnCobrar ? '' : ''}</>
                            : (x.facturas.length === 0 ? (x.cancelada ? 'Cancelada' : '⚠ Sin facturar') : `Facturada (${x.facturas.length})`)}
                        </div>
                      </div>
                    );
                  })}
                  {lado.filasOps.length === 0 && <div className="ace-vacio">Sin operaciones en este papel.</div>}
                </div>
              </div>

              {papel !== 'mercancia' && (
                <>
                  {/* ── FACTURACIÓN ── */}
                  <div className="ace-col">
                    <div className="ace-col-titulo">FACTURACIÓN ({lado.filasF.length})</div>
                    <div className="ace-col-scroll">
                      {lado.filasF.map((x) => {
                        if (sel && !camino.facturas.has(x.id)) return null;
                        return (
                          <div key={x.id} className={`ace-item ace-item--clic${x.saldo > 0.009 ? ' ace-item--saldo' : ''}${claseSel(camino.facturas.has(x.id), sel?.tipo === 'fact' && sel.id === x.id)}`}
                            title="Clic para ver SOLO el camino de esta factura"
                            onClick={() => setSel((prev) => prev?.tipo === 'fact' && prev.id === x.id ? null : { tipo: 'fact', id: x.id })}>
                            <div className="ace-item-fila1">
                              <span className="ace-ref">{x.invoice}</span>
                              {x.moneda && <span className="ace-chip">{x.moneda}</span>}
                              <span className="ace-monto">{money(x.total)}</span>
                            </div>
                            <div className="ace-item-fila2">{x.fecha || '—'} · ops: {x.ops.length}</div>
                            <div className="ace-item-detalle">{x.saldo > 0.009 ? `⏳ Pagado ${money(x.pagado)} · saldo ${money(x.saldo)}` : 'Pagada'}</div>
                          </div>
                        );
                      })}
                      {lado.filasF.length === 0 && <div className="ace-vacio">Sin facturación en este papel.</div>}
                    </div>
                  </div>

                  {/* ── PAGOS ── */}
                  <div className="ace-col">
                    <div className="ace-col-titulo">PAGOS ({lado.filasP.length})</div>
                    <div className="ace-col-scroll">
                      {lado.filasP.map((x) => {
                        if (sel && !camino.pagos.has(x.id)) return null;
                        return (
                          <div key={x.id} className={`ace-item ace-item--clic${claseSel(camino.pagos.has(x.id), sel?.tipo === 'pago' && sel.id === x.id)}`}
                            title="Clic para ver SOLO el camino de este pago"
                            onClick={() => setSel((prev) => prev?.tipo === 'pago' && prev.id === x.id ? null : { tipo: 'pago', id: x.id })}>
                            <div className="ace-item-fila1">
                              <span className="ace-ref">{x.numero}</span>
                              {x.moneda && <span className="ace-chip">{x.moneda}</span>}
                              <span className="ace-monto">{money(x.monto)}</span>
                            </div>
                            <div className="ace-item-fila2">{x.fecha || '—'} · {x.metodo || '—'}</div>
                            <div className="ace-item-detalle">Facturas: {x.invoices || '—'}</div>
                          </div>
                        );
                      })}
                      {lado.filasP.length === 0 && <div className="ace-vacio">Sin pagos en este papel.</div>}
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

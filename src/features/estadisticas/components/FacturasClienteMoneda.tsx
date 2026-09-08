// src/features/estadisticas/components/FacturasClienteMoneda.tsx
// ---------------------------------------------------------------------------
// ✅ V00191 — FACTURAS DEL CLIENTE CON SU MONEDA (desde el Desglose de
//   Facturación en Estadísticas, clic en el monto Pesos/Dólares de una fila
//   de CLIENTE).
//   Regla de negocio: un cliente factura en USD o en MXN, NUNCA en las dos.
//   · La moneda que MANDA es la guardada en la tabla EMPRESAS.
//   · Cada factura que tenga otra moneda se marca en rojo y se muestra una
//     alerta.
//   · Desde aquí mismo se puede EDITAR la moneda de la empresa, o presionar
//     "Corregir todas las facturas", que ejecuta propagarMonedaEmpresa
//     (V00147): aplica la moneda de la empresa en cascada a facturas,
//     convenios y operaciones — solo escribe donde hay diferencia.
// ---------------------------------------------------------------------------
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { propagarMonedaEmpresa, type ReporteMoneda } from '../../empresas/services/propagarMoneda';
import { registrarLog } from '../../../utils/logger';
import './FacturasClienteMoneda.css';

const ID_USD = '7dca62b3';
const ID_MXN = 'f95d8894';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- docs sin tipo canónico (mismo criterio de Estadísticas).
type Doc = any;

interface Props {
  /** Nombre del cliente tal como aparece en la fila del desglose. */
  cliente: string;
  /** Operaciones de la fila — de aquí se resuelve el id del cliente (clientePaga). */
  ops: Doc[];
  onCerrar: () => void;
}

/** Canoniza cualquier representación de moneda (id de catálogo, nombre o canon) a USD/MXN. */
const canonMoneda = (v: unknown): 'USD' | 'MXN' | '' => {
  const t = String(v ?? '').trim();
  if (!t) return '';
  if (t === ID_USD) return 'USD';
  if (t === ID_MXN) return 'MXN';
  const u = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (u.includes('USD') || u.includes('DOLAR') || u === 'US$' || u === 'DLS') return 'USD';
  if (u.includes('MXN') || u.includes('PESO') || u === 'MN') return 'MXN';
  return '';
};

const montoFactura = (f: Doc): number =>
  Number(f?.subtotalFactura) || Number(f?.total) || Number(f?.montoFactura) || 0;

const fmtMoney = (n: number): string =>
  `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const invoiceDe = (f: Doc): string =>
  String(f?.invoice || f?.numeroInvoice || f?.numInvoice || f?.folio || f?.id || '').trim();

export function FacturasClienteMoneda({ cliente, ops, onCerrar }: Props) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [empresa, setEmpresa] = useState<Doc | null>(null);
  const [facturas, setFacturas] = useState<Doc[]>([]);
  const [monedaEdit, setMonedaEdit] = useState<'USD' | 'MXN' | ''>('');
  const [guardandoMoneda, setGuardandoMoneda] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [reporte, setReporte] = useState<ReporteMoneda | null>(null);

  const monedaEmpresa = canonMoneda(empresa?.moneda) || canonMoneda(empresa?.monedaId) || canonMoneda(empresa?.monedaNombre);

  const cargar = async (id: string) => {
    const [snapE, snapF] = await Promise.all([
      getDoc(doc(db, 'empresas', id)),
      getDocs(query(collection(db, 'facturas_clientes'), where('clienteId', '==', id))),
    ]);
    setEmpresa(snapE.exists() ? { id: snapE.id, ...snapE.data() } : null);
    const lista = snapF.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a: Doc, b: Doc) => String(b.fecha || b.fechaFactura || '').localeCompare(String(a.fecha || a.fechaFactura || '')));
    setFacturas(lista);
  };

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        // El id del cliente sale de las operaciones de la fila (clientePaga);
        // si hubiera más de uno (no debería), gana el más frecuente.
        const conteo = new Map<string, number>();
        ops.forEach((o) => { const k = String(o?.clientePaga || '').trim(); if (k) conteo.set(k, (conteo.get(k) || 0) + 1); });
        const id = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
        if (!id) { if (activo) { setError('No se pudo identificar el id del cliente en estas operaciones.'); setCargando(false); } return; }
        if (activo) setClienteId(id);
        await cargar(id);
      } catch (e) {
        console.error('No se pudieron cargar las facturas del cliente:', e);
        if (activo) setError('No se pudieron cargar las facturas del cliente.');
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const facturasConCanon = facturas.map((f) => {
    const canon = canonMoneda(f.moneda) || canonMoneda(f.monedaId) || canonMoneda(f.monedaFacturacion);
    const distinta = Boolean(monedaEmpresa && canon && canon !== monedaEmpresa);
    return { ...f, _canon: canon, _distinta: distinta, _sinMoneda: !canon };
  });
  const numDistintas = facturasConCanon.filter((f) => f._distinta).length;
  const numSinMoneda = facturasConCanon.filter((f) => f._sinMoneda).length;
  const hayProblema = !cargando && !error && (!monedaEmpresa || numDistintas > 0 || numSinMoneda > 0);

  const guardarMonedaEmpresa = async () => {
    if (!monedaEdit || !clienteId || guardandoMoneda) return;
    setGuardandoMoneda(true);
    try {
      // Se escribe el ID de catálogo (formato que Empresas resuelve contra el
      // diccionario de monedas) + el nombre desnormalizado.
      await updateDoc(doc(db, 'empresas', clienteId), {
        moneda: monedaEdit === 'USD' ? ID_USD : ID_MXN,
        monedaNombre: monedaEdit === 'USD' ? 'Dólares' : 'Pesos',
      });
      await registrarLog('Empresas', 'Edición', `Cambió la moneda de "${cliente}" a ${monedaEdit} desde Estadísticas (facturas del cliente).`);
      await cargar(clienteId);
      setMonedaEdit('');
    } catch (e) {
      console.error('No se pudo guardar la moneda de la empresa:', e);
      alert('No se pudo guardar la moneda de la empresa.');
    } finally {
      setGuardandoMoneda(false);
    }
  };

  const corregirFacturas = async () => {
    if (!clienteId || corrigiendo) return;
    if (!monedaEmpresa) { alert('Primero guarda la moneda de la empresa: esa es la que se aplicará a las facturas.'); return; }
    if (!window.confirm(`Se aplicará la moneda de la empresa (${monedaEmpresa}) a TODAS sus facturas, convenios y operaciones donde sea distinta. ¿Continuar?`)) return;
    setCorrigiendo(true);
    try {
      const rep = await propagarMonedaEmpresa(clienteId);
      setReporte(rep);
      await registrarLog('Empresas', 'Edición', `Corrigió la moneda (${rep.canon}) de "${cliente}" en cascada desde Estadísticas: ${rep.facturasClientes} factura(s) de clientes, ${rep.conveniosClientes} convenio(s), ${rep.opsCliente} operación(es).`);
      await cargar(clienteId);
    } catch (e) {
      console.error('No se pudo corregir la moneda de las facturas:', e);
      alert(e instanceof Error ? e.message : 'No se pudo corregir la moneda de las facturas.');
    } finally {
      setCorrigiendo(false);
    }
  };

  return (
    <div className="modal-overlay fcm-overlay" onClick={onCerrar}>
      <div className="fcm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fcm-encabezado">
          <div>
            <h3 className="fcm-titulo">Facturas de <span className="fcm-cliente">{cliente}</span></h3>
            <p className="fcm-sub">
              Moneda registrada en Empresas:{' '}
              {monedaEmpresa
                ? <span className={`fcm-chip ${monedaEmpresa === 'USD' ? 'fcm-chip-usd' : 'fcm-chip-mxn'}`}>{monedaEmpresa}</span>
                : <span className="fcm-chip fcm-chip-falta">SIN MONEDA</span>}
              {!cargando && !error && <span className="fcm-conteo"> · {facturas.length} factura(s)</span>}
            </p>
          </div>
          <button type="button" className="fcm-cerrar" onClick={onCerrar}>✕</button>
        </div>

        {cargando ? (
          <p className="fcm-vacio">Cargando facturas del cliente…</p>
        ) : error ? (
          <p className="fcm-vacio">{error}</p>
        ) : (
          <>
            {hayProblema && (
              <div className="fcm-alerta">
                <div className="fcm-alerta-texto">
                  {!monedaEmpresa && <span>⚠ La empresa NO tiene moneda registrada. Elígela aquí y guárdala — un cliente factura en USD o en MXN, nunca en las dos.</span>}
                  {monedaEmpresa && numDistintas > 0 && <span>⚠ {numDistintas} factura(s) tienen una moneda DISTINTA a la de la empresa ({monedaEmpresa}).</span>}
                  {numSinMoneda > 0 && <span> {numSinMoneda} factura(s) sin moneda.</span>}
                </div>
                <div className="fcm-alerta-acciones">
                  <select
                    className="form-control fcm-select"
                    value={monedaEdit || monedaEmpresa}
                    onChange={(e) => setMonedaEdit(e.target.value as 'USD' | 'MXN')}
                    disabled={guardandoMoneda || corrigiendo}
                  >
                    {!monedaEmpresa && !monedaEdit && <option value="">Elegir moneda…</option>}
                    <option value="USD">USD — Dólares</option>
                    <option value="MXN">MXN — Pesos</option>
                  </select>
                  <button
                    type="button"
                    className="fcm-btn fcm-btn-guardar"
                    onClick={guardarMonedaEmpresa}
                    disabled={!monedaEdit || monedaEdit === monedaEmpresa || guardandoMoneda || corrigiendo}
                  >
                    {guardandoMoneda ? 'Guardando…' : 'Guardar moneda de la empresa'}
                  </button>
                  <button
                    type="button"
                    className="fcm-btn fcm-btn-corregir"
                    onClick={corregirFacturas}
                    disabled={!monedaEmpresa || corrigiendo || guardandoMoneda}
                    title="Aplica la moneda de la empresa a todas sus facturas, convenios y operaciones (solo donde sea distinta)"
                  >
                    {corrigiendo ? 'Corrigiendo…' : 'Corregir todas las facturas'}
                  </button>
                </div>
              </div>
            )}

            {reporte && (
              <p className="fcm-reporte">
                ✔ Moneda {reporte.canon} aplicada: {reporte.facturasClientes} factura(s) de clientes, {reporte.facturasProveedores} de proveedores,{' '}
                {reporte.conveniosClientes + reporte.conveniosProveedores} convenio(s) y {reporte.opsCliente + reporte.opsProveedor} operación(es) actualizadas.
              </p>
            )}

            {facturas.length === 0 ? (
              <p className="fcm-vacio">Este cliente no tiene facturas registradas.</p>
            ) : (
              <div className="fcm-marco">
                <table className="fcm-tabla">
                  <thead>
                    <tr><th>INVOICE</th><th>FECHA</th><th>TOTAL</th><th>MONEDA</th><th>STATUS</th></tr>
                  </thead>
                  <tbody>
                    {facturasConCanon.map((f) => (
                      <tr key={f.id} className={f._distinta || f._sinMoneda ? 'fcm-fila-mal' : ''}>
                        <td className="fcm-invoice">{invoiceDe(f) || '—'}</td>
                        <td>{f.fecha || f.fechaFactura || '—'}</td>
                        <td className="fcm-monto">{fmtMoney(montoFactura(f))}</td>
                        <td>
                          {f._canon
                            ? <span className={`fcm-chip ${f._distinta ? 'fcm-chip-mal' : f._canon === 'USD' ? 'fcm-chip-usd' : 'fcm-chip-mxn'}`} title={f._distinta ? `Distinta a la moneda de la empresa (${monedaEmpresa})` : undefined}>{f._canon}</span>
                            : <span className="fcm-chip fcm-chip-falta">SIN MONEDA</span>}
                        </td>
                        <td>{f.status || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        <div className="fcm-pie">
          <button type="button" className="btn btn-outline" onClick={onCerrar}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

// src/features/operaciones/components/TarjetaSaldoDiesel.tsx
// ✅ V00411: tarjeta del SALDO DE DIESEL en el resumen de Operaciones Activas.
//   Misma cuenta que Referencias del Diesel → Saldos: por proveedor, saldos
//   agregados − Total Cargado de sus referencias desde su primer saldo.
// ✅ V00441 (Fase 5.6): con la bandera `saldosCorrientes` ya no escucha las 3,000
//   referencias: lee el cargado POR DÍA que mantiene el servidor en
//   saldos_corrientes (un documento por proveedor). Misma cuenta.
// ✅ V00457: botón "Actualizar saldo" (el MISMO formulario de Referencias del Diesel →
//   Saldos, ModalAgregarSaldoDiesel) y, al presionar la tarjeta, el historial del saldo
//   (ModalMovimientosDiesel) con los datos que la tarjeta ya escucha.
import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../../config/firebase';
import { useModuloEscuchando } from '../../../utils/moduloVivoContexto';
import { useFlags, useFlagsCargadas } from '../../../shared/data/flags';
import { lazyWithRetry } from '../../../utils/lazyWithRetry';
import { COL_SALDOS_CORRIENTES, cuentasDiesel, cuentasDieselDesdeReferencias } from '../../../shared/dominio/saldosCorrientes';
import type { SaldoCorrienteDiesel } from '../../../shared/dominio/saldosCorrientes';

// ✅ V00457: los modales se cargan al abrirlos (la tarjeta va en la carga inicial de la app)
const ModalAgregarSaldoDiesel = lazyWithRetry(() => import('../../diesel/components/ModalAgregarSaldoDiesel'), 'ModalAgregarSaldoDiesel');
const ModalMovimientosDiesel = lazyWithRetry(() => import('./ModalMovimientosDiesel'), 'ModalMovimientosDiesel');

type Fila = Record<string, unknown>;
const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmt = (n: number) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const TarjetaSaldoDiesel: React.FC = () => {
  const [saldos, setSaldos] = useState<Fila[]>([]);
  const [refs, setRefs] = useState<Fila[]>([]);
  const [corrientes, setCorrientes] = useState<SaldoCorrienteDiesel[]>([]);
  // ✅ V00457: primera respuesta de cada listener, por fuente (el historial espera con CargandoDatos;
  //   al encenderse saldosCorrientes las cargas vuelven a esperar a su propio listener)
  const [listos, setListos] = useState({ saldos: false, refs: false, corrientes: false });
  const [recargar, setRecargar] = useState(false);
  const [verMovimientos, setVerMovimientos] = useState(false);
  const { saldosCorrientes } = useFlags();
  const flagsCargadas = useFlagsCargadas();
  // ✅ V00438 (Fase 2.7): escucha solo con Operaciones visible; oculta conserva las cifras.
  //   Sin ventana de fechas: el saldo restante descuenta TODAS las cargas desde el 1er
  //   saldo de cada proveedor y "Cargas hoy" sale de esas mismas referencias; acotar
  //   cambiaría las cifras. Saldo corrido en un documento → Fase 5.6.
  const moduloVisible = useModuloEscuchando(); // ✅ V00446: sigue escuchando unos minutos oculto
  // ✅ V00457: espera las banderas (antes, con saldosCorrientes encendida se abría primero el
  //   listener de las 3,000 referencias y luego se cambiaba al de saldos corrientes).
  useEffect(() => {
    if (!moduloVisible || !flagsCargadas) return;
    const listo = (k: keyof typeof listos) => setListos((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
    const u1 = onSnapshot(collection(db, 'saldos_diesel'), (s) => { setSaldos(s.docs.map((d) => ({ id: d.id, ...(d.data() as Fila) }))); listo('saldos'); }, () => { setSaldos([]); listo('saldos'); });
    const u2 = saldosCorrientes
      ? onSnapshot(query(collection(db, COL_SALDOS_CORRIENTES), where('tipo', '==', 'diesel')), (s) => { setCorrientes(s.docs.map((d) => d.data() as SaldoCorrienteDiesel)); listo('corrientes'); }, () => { setCorrientes([]); listo('corrientes'); })
      : onSnapshot(query(collection(db, 'referencias_diesel'), orderBy('createdAt', 'desc'), limit(3000)), (s) => { setRefs(s.docs.map((d) => ({ id: d.id, ...(d.data() as Fila) }))); listo('refs'); }, () => { setRefs([]); listo('refs'); });
    return () => { u1(); u2(); };
  }, [moduloVisible, flagsCargadas, saldosCorrientes]);

  const hoy = hoyISO();
  const cuentas = useMemo(
    () => (saldosCorrientes ? cuentasDiesel(saldos, corrientes, hoy) : cuentasDieselDesdeReferencias(saldos, refs, hoy)),
    [saldosCorrientes, saldos, corrientes, refs, hoy],
  );

  const total = cuentas.reduce((a, c) => a + c.restante, 0);
  const monedas = Array.from(new Set(cuentas.map((c) => c.moneda).filter(Boolean)));
  const cargasHoy = cuentas.reduce((a, c) => a + c.cargasHoy, 0);
  const cargadoHoy = cuentas.reduce((a, c) => a + c.cargadoHoy, 0);

  return (
    <>
      <div className="rd-card rd-card--naranja rd-card--clic" title="Saldo de diesel (Referencias del Diesel → Saldos): saldos agregados menos el total cargado por día. Presiona la tarjeta para ver los movimientos del saldo.">
        {/* ✅ V00457: toda la tarjeta abre el historial del saldo (el botón de abajo hace lo suyo) */}
        <button type="button" className="rd-card__abrir" onClick={() => setVerMovimientos(true)} aria-label="Ver los movimientos del saldo de diesel" />
        <div className="rd-card__head">
          <span className="rd-card__label">Saldo Diesel</span>
          {monedas.length === 1 && <span className="rd-card__chip">{monedas[0] === 'Dólares' ? 'USD' : monedas[0] === 'Pesos' ? 'MXN' : monedas[0]}</span>}
        </div>
        <span className={`rd-card__value${total < 0 ? ' rd-card__value--neg' : ''}`}>{cuentas.length ? fmt(total) : '—'}</span>
        <span className="rd-card__sub">{cuentas.length ? 'Saldo restante' : 'Sin saldos registrados'}</span>
        <div className="rd-filas">
          {cuentas.slice(0, 3).map((c) => (
            <div key={c.clave} className="rd-filas__f" title={c.nombre}>
              <span className="rd-filas__et">{c.nombre}</span>
              <span className={`rd-filas__v${c.restante < 0 ? ' rd-filas__v--neg' : ''}`}>{fmt(c.restante)}</span>
            </div>
          ))}
          {cuentas.length > 3 && <div className="rd-filas__f"><span className="rd-filas__et">+ {cuentas.length - 3} proveedor(es)</span><span /></div>}
          <div className="rd-filas__f rd-filas__f--sep">
            <span className="rd-filas__et">Cargas hoy · {cargasHoy}</span>
            <span className="rd-filas__v rd-filas__v--cargo">−{fmt(cargadoHoy)}</span>
          </div>
        </div>
        <div className="rd-card__foot">
          <button type="button" className="rd-btn rd-btn--ancho" onClick={() => setRecargar(true)} title="Agregar saldo de diesel (queda en Referencias del Diesel → Saldos)">Actualizar saldo</button>
        </div>
      </div>

      {recargar && <Suspense fallback={null}><ModalAgregarSaldoDiesel onCerrar={() => setRecargar(false)} /></Suspense>}

      {/* los movimientos se calculan dentro del modal (perezoso): la carga inicial no lleva esa lógica */}
      {verMovimientos && (
        <Suspense fallback={null}>
          <ModalMovimientosDiesel
            restante={total}
            moneda={monedas.length === 1 ? monedas[0] : ''}
            saldos={saldos}
            cargas={saldosCorrientes ? { corrientes } : { refs }}
            cargando={!(listos.saldos && (saldosCorrientes ? listos.corrientes : listos.refs))}
            onCerrar={() => setVerMovimientos(false)}
          />
        </Suspense>
      )}
    </>
  );
};

export default TarjetaSaldoDiesel;

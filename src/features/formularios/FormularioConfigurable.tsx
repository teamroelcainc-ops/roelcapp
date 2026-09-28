// src/features/formularios/FormularioConfigurable.tsx
// ============================================================================
// ✅ V00385: envoltura GENÉRICA de formularios.
//   · Descubre cada campo (etiqueta + su control) y lo registra en
//     config_formularios/{modulo} para que aparezca en Autorizaciones.
//   · Aplica la configuración: nombre personalizado, orden dentro de su
//     sección, oculto, visible solo para ciertos roles y OBLIGATORIO (bloquea
//     el guardado si está vacío).
//   · Botón "Editar formulario" (Admin o rol con el permiso "Editar
//     Formularios"): mover ↑/↓, renombrar, ocultar y marcar obligatorio.
//   La envoltura usa display: contents → no altera el diseño del formulario.
// ============================================================================
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  claveDeEtiqueta, campoVisiblePara, validadoresFormularios as validadores, guardarCamposFormulario, useConfigFormulario, usePermisoFormularios,
  type CampoFormCfg,
} from './configFormularios';
import './FormularioConfigurable.css';

interface CampoDom {
  clave: string;
  wrapper: HTMLElement;
  label: HTMLElement;
  texto: Text | null;
  original: string;
}

const registradosSesion = new Set<string>();


const primerTexto = (label: HTMLElement): Text | null => {
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode() as Text | null;
  while (n) {
    const t = (n.nodeValue || '').trim();
    const padre = n.parentElement;
    if (t && t !== '*' && !(padre && padre.closest('.campo-badge'))) return n;
    n = walker.nextNode() as Text | null;
  }
  return null;
};

const descubrir = (raiz: HTMLElement): CampoDom[] => {
  const out: CampoDom[] = [];
  const usadas = new Map<string, number>();
  raiz.querySelectorAll('label').forEach((lb) => {
    const label = lb as HTMLElement;
    if (label.closest('[data-fc-modulo]') !== raiz) return; // pertenece a otro formulario anidado
    if (label.closest('.fc-barra')) return;
    const ctrl = label.querySelector('input, select, textarea') as HTMLInputElement | null;
    let wrapper: HTMLElement | null = null;
    if (ctrl) {
      // etiqueta que ENVUELVE su control; las listas de opciones (varias casillas) no son campos
      const esOpcion = ctrl.type === 'checkbox' || ctrl.type === 'radio';
      const padre = label.parentElement;
      if (esOpcion && padre && Array.from(padre.children).filter((c) => c.tagName === 'LABEL').length > 1) return;
      wrapper = label;
    } else {
      const padre = label.parentElement;
      if (!padre || padre === raiz) return;
      const etiquetasDirectas = Array.from(padre.children).filter((c) => c.tagName === 'LABEL').length;
      if (etiquetasDirectas !== 1 || padre.children.length < 2) return; // contenedor con varios campos sueltos
      wrapper = padre;
    }
    const texto = primerTexto(label);
    if (!texto) return;
    const actual = (texto.nodeValue || '').trim();
    let original = label.dataset.fcOriginal || '';
    if (!original || (label.dataset.fcAplicado !== actual && actual !== original)) {
      original = actual;
      label.dataset.fcOriginal = original;
    }
    const badge = label.querySelector('.campo-badge')?.textContent?.trim();
    let clave = badge || wrapper.dataset.campo || claveDeEtiqueta(original);
    const n = (usadas.get(clave) || 0) + 1;
    usadas.set(clave, n);
    if (n > 1) clave = `${clave}-${n}`;
    out.push({ clave, wrapper, label, texto, original });
  });
  return out;
};

const esVisible = (el: HTMLElement) => el.getClientRects().length > 0;

interface Props { modulo: string; children: React.ReactNode }

export const FormularioConfigurable: React.FC<Props> = ({ modulo, children }) => {
  const raizRef = useRef<HTMLDivElement | null>(null);
  const camposRef = useRef<CampoDom[]>([]);
  const { config, cargada } = useConfigFormulario(modulo);
  const { usuario, puedeEditar } = usePermisoFormularios();
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState<Record<string, CampoFormCfg>>({});
  const [guardando, setGuardando] = useState(false);
  const [clavesVistas, setClavesVistas] = useState('');

  const cfgActiva = editando ? borrador : config.campos;
  const cfgRef = useRef(cfgActiva); cfgRef.current = cfgActiva;
  const editRef = useRef(editando); editRef.current = editando;
  const usuarioRef = useRef(usuario); usuarioRef.current = usuario;

  // ── aplicar la configuración al DOM ──
  const aplicar = useCallback(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    const campos = descubrir(raiz);
    camposRef.current = campos;
    const cfg = cfgRef.current;
    const ed = editRef.current;
    const porPadre = new Map<HTMLElement, CampoDom[]>();
    campos.forEach((c) => {
      const conf = cfg[c.clave];
      // nombre
      const deseado = String(conf?.etiqueta || '').trim() || c.original;
      if (c.texto && (c.texto.nodeValue || '').trim() !== deseado) {
        const v = c.texto.nodeValue || '';
        const ini = v.match(/^\s*/)?.[0] || '';
        const fin = v.match(/\s*$/)?.[0] || '';
        c.texto.nodeValue = `${ini}${deseado}${fin}`;
      }
      c.label.dataset.fcAplicado = deseado;
      // obligatorio (asterisco)
      c.label.classList.toggle('fc-oblig', !!conf?.obligatorio && !c.original.includes('*') && !c.label.textContent?.includes('*'));
      // visibilidad
      const ocultar = !ed && (!!conf?.oculto || !campoVisiblePara(conf, usuarioRef.current));
      if (ocultar) {
        if (c.wrapper.dataset.fcOculto !== '1') {
          c.wrapper.dataset.fcOculto = '1';
          c.wrapper.dataset.fcDisplayPrev = c.wrapper.style.display || '';
          c.wrapper.querySelectorAll('[required]').forEach((el) => { (el as HTMLElement).dataset.fcReq = '1'; el.removeAttribute('required'); });
        }
        if (c.wrapper.style.display !== 'none') c.wrapper.style.display = 'none';
      } else if (c.wrapper.dataset.fcOculto === '1') {
        c.wrapper.style.display = c.wrapper.dataset.fcDisplayPrev || '';
        delete c.wrapper.dataset.fcOculto;
        delete c.wrapper.dataset.fcDisplayPrev;
        c.wrapper.querySelectorAll('[data-fc-req]').forEach((el) => { el.setAttribute('required', ''); delete (el as HTMLElement).dataset.fcReq; });
      }
      c.wrapper.classList.toggle('fc-campo--editando', ed);
      c.wrapper.classList.toggle('fc-campo--oculto', ed && (!!conf?.oculto || !campoVisiblePara(conf, usuarioRef.current)));
      const padre = c.wrapper.parentElement;
      if (padre) { const l = porPadre.get(padre) || []; l.push(c); porPadre.set(padre, l); }
    });
    // orden dentro de cada sección
    porPadre.forEach((lista, padre) => {
      const conOrden = lista.some((c) => typeof cfg[c.clave]?.orden === 'number');
      const hijos = Array.from(padre.children) as HTMLElement[];
      if (!conOrden) {
        hijos.forEach((h) => { if (h.dataset.fcOrd) { h.style.order = ''; delete h.dataset.fcOrd; } });
        return;
      }
      hijos.forEach((h, i) => {
        const campo = lista.find((c) => c.wrapper === h);
        const o = campo && typeof cfg[campo.clave]?.orden === 'number' ? Number(cfg[campo.clave]!.orden) : i * 10;
        if (h.style.order !== String(o)) h.style.order = String(o);
        h.dataset.fcOrd = '1';
      });
    });
    const firma = campos.map((c) => c.clave).join('|');
    setClavesVistas((prev) => (prev === firma ? prev : firma));
  }, []);

  // observar cambios del formulario (React re-renderiza, pestañas, campos condicionales)
  useLayoutEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    let pendiente = 0;
    const obs = new MutationObserver(() => {
      if (pendiente) return;
      pendiente = requestAnimationFrame(() => { pendiente = 0; obs.disconnect(); aplicar(); conectar(); });
    });
    const conectar = () => obs.observe(raiz, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
    aplicar();
    conectar();
    return () => { obs.disconnect(); if (pendiente) cancelAnimationFrame(pendiente); };
  }, [aplicar]);

  // re-aplicar cuando cambia la config, el modo edición o el usuario
  useLayoutEffect(() => { aplicar(); }, [aplicar, cfgActiva, editando, usuario]);

  // registrar campos nuevos en Firestore (para Autorizaciones)
  useEffect(() => {
    if (!cargada || !clavesVistas) return;
    const nuevos: Record<string, CampoFormCfg> = {};
    camposRef.current.forEach((c, i) => {
      const id = `${modulo}::${c.clave}`;
      if (registradosSesion.has(id)) return;
      const actual = config.campos[c.clave];
      if (!actual || !actual.etiquetaOriginal) nuevos[c.clave] = { etiquetaOriginal: c.original, indice: i };
      registradosSesion.add(id);
    });
    if (Object.keys(nuevos).length) guardarCamposFormulario(modulo, nuevos).catch(() => {});
  }, [clavesVistas, cargada, modulo, config.campos]);

  // campos OBLIGATORIOS: se valida antes de que el formulario guarde
  const validar = useCallback((): boolean => {
    const cfg = cfgRef.current;
    const faltan: CampoDom[] = [];
    camposRef.current.forEach((c) => {
      const conf = cfg[c.clave];
      if (!conf?.obligatorio || c.wrapper.dataset.fcOculto === '1') return;
      const controles = Array.from(c.wrapper.querySelectorAll('input, select, textarea')) as HTMLInputElement[];
      const utiles = controles.filter((x) => !['hidden', 'button', 'submit', 'file', 'reset'].includes(x.type));
      if (utiles.length === 0) return;
      const casillas = utiles.filter((x) => x.type === 'checkbox' || x.type === 'radio');
      const lleno = casillas.length === utiles.length
        ? casillas.some((x) => x.checked)
        : utiles.some((x) => x.type !== 'checkbox' && x.type !== 'radio' && String(x.value ?? '').trim() !== '');
      if (!lleno) faltan.push(c);
    });
    if (!faltan.length) return true;
    faltan.forEach((c) => { c.wrapper.classList.add('fc-falta'); setTimeout(() => c.wrapper.classList.remove('fc-falta'), 4000); });
    const nombres = faltan.map((c) => String(cfg[c.clave]?.etiqueta || '').trim() || c.original.replace(/\*/g, '').trim());
    alert(`Faltan campos obligatorios:\n\n· ${nombres.join('\n· ')}`);
    return false;
  }, []);

  useEffect(() => {
    const raiz = raizRef.current;
    if (!raiz) return;
    const alEnviar = (e: Event) => {
      if (editRef.current || !validar()) { e.preventDefault(); e.stopPropagation(); }
    };
    raiz.addEventListener('submit', alEnviar, true);
    validadores.set(modulo, () => (editRef.current ? false : validar()));
    return () => { raiz.removeEventListener('submit', alEnviar, true); validadores.delete(modulo); };
  }, [modulo, validar]);

  // ── editor ──
  const iniciarEdicion = () => { setBorrador(JSON.parse(JSON.stringify(config.campos || {}))); setEditando(true); };
  const cambiar = (clave: string, cambio: Partial<CampoFormCfg>) =>
    setBorrador((prev) => ({ ...prev, [clave]: { ...(prev[clave] || {}), ...cambio } }));

  const mover = (clave: string, dir: -1 | 1) => {
    const campo = camposRef.current.find((c) => c.clave === clave);
    const padre = campo?.wrapper.parentElement;
    if (!campo || !padre) return;
    const disp = getComputedStyle(padre).display;
    if (!disp.includes('flex') && !disp.includes('grid')) { alert('Este campo está en una sección que no permite reacomodarlo.'); return; }
    const hijos = (Array.from(padre.children) as HTMLElement[])
      .map((h, i) => ({ h, o: h.style.order !== '' ? Number(h.style.order) : i * 10 }))
      .filter((x) => esVisible(x.h) || x.h === campo.wrapper || x.h.classList.contains('fc-campo--oculto'))
      .sort((a, b) => a.o - b.o);
    const k = hijos.findIndex((x) => x.h === campo.wrapper);
    if (k < 0) return;
    let nuevo: number;
    if (dir < 0) {
      if (k === 0) return;
      nuevo = k >= 2 ? (hijos[k - 2].o + hijos[k - 1].o) / 2 : hijos[k - 1].o - 10;
    } else {
      if (k === hijos.length - 1) return;
      nuevo = k + 2 < hijos.length ? (hijos[k + 1].o + hijos[k + 2].o) / 2 : hijos[k + 1].o + 10;
    }
    // fija el orden natural de los demás campos de la sección para que no salten
    setBorrador((prev) => {
      const sig = { ...prev };
      camposRef.current.filter((c) => c.wrapper.parentElement === padre).forEach((c) => {
        const idx = Array.from(padre.children).indexOf(c.wrapper);
        const act = sig[c.clave] || {};
        if (typeof act.orden !== 'number') sig[c.clave] = { ...act, orden: c.wrapper.style.order !== '' ? Number(c.wrapper.style.order) : idx * 10 };
      });
      sig[clave] = { ...(sig[clave] || {}), orden: nuevo };
      return sig;
    });
  };

  const renombrar = (c: CampoDom) => {
    const actual = String(borrador[c.clave]?.etiqueta || '').trim() || c.original;
    const nuevo = window.prompt(`Nombre del campo (vacío = volver a "${c.original}"):`, actual);
    if (nuevo === null) return;
    cambiar(c.clave, { etiqueta: nuevo.trim() === c.original ? '' : nuevo.trim() });
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      const salida: Record<string, CampoFormCfg> = {};
      Object.entries(borrador).forEach(([k, v]) => {
        const orig = camposRef.current.find((c) => c.clave === k)?.original;
        salida[k] = { ...v, orden: typeof v.orden === 'number' ? v.orden : null, ...(orig && !v.etiquetaOriginal ? { etiquetaOriginal: orig } : {}) };
      });
      await guardarCamposFormulario(modulo, salida);
      setEditando(false);
    } catch (e) {
      alert(`No se pudo guardar el diseño: ${(e as Error)?.message || e}`);
    } finally { setGuardando(false); }
  };

  const restablecer = () => {
    if (!window.confirm('¿Restablecer el orden y los nombres originales de este formulario? (Ocultos, obligatorios y visibilidad por rol se conservan.)')) return;
    setBorrador((prev) => {
      const sig: Record<string, CampoFormCfg> = {};
      Object.entries(prev).forEach(([k, v]) => { sig[k] = { ...v, orden: null, etiqueta: '' }; });
      camposRef.current.forEach((c) => { if (!sig[c.clave]) sig[c.clave] = { orden: null, etiqueta: '' }; });
      return sig;
    });
  };

  // posiciones de los controles del editor (capa fija sobre la pantalla)
  const [rects, setRects] = useState<{ clave: string; top: number; left: number; width: number; height: number }[]>([]);
  useEffect(() => {
    if (!editando) { setRects([]); return; }
    let id = 0;
    let firma = '';
    const tick = () => {
      const lista = camposRef.current
        .filter((c) => esVisible(c.wrapper))
        .map((c) => { const r = c.wrapper.getBoundingClientRect(); return { clave: c.clave, top: r.top, left: r.left, width: r.width, height: r.height }; })
        .filter((r) => r.width > 0 && r.height > 0 && r.top < window.innerHeight && r.top + r.height > 0);
      const f = lista.map((r) => `${r.clave}:${Math.round(r.top)}:${Math.round(r.left)}:${Math.round(r.width)}:${Math.round(r.height)}`).join('|');
      if (f !== firma) { firma = f; setRects(lista); }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [editando]);

  return (
    <div ref={raizRef} className="fc-raiz" data-fc-modulo={modulo}>
      {puedeEditar && (
        <div className={`fc-barra${editando ? ' fc-barra--editando' : ''}`}>
          {!editando ? (
            <button type="button" className="fc-btn fc-btn--editar" onClick={iniciarEdicion} title="Renombrar, mover, ocultar o marcar como obligatorios los campos de este formulario">✎ Editar formulario</button>
          ) : (
            <>
              <span className="fc-barra-texto">Editando formulario — usa los controles de cada campo. Los cambios aplican para todos al guardar.</span>
              <button type="button" className="fc-btn" onClick={restablecer} disabled={guardando}>Restablecer</button>
              <button type="button" className="fc-btn" onClick={() => setEditando(false)} disabled={guardando}>Cancelar</button>
              <button type="button" className="fc-btn fc-btn--primario" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar diseño'}</button>
            </>
          )}
        </div>
      )}
      {children}
      {editando && createPortal(
        <div className="fc-capa">
          {rects.map((r) => {
            const c = camposRef.current.find((x) => x.clave === r.clave);
            if (!c) return null;
            const conf = borrador[r.clave] || {};
            return (
              <div key={r.clave} className="fc-ctrl" style={{ '--fc-top': `${Math.max(0, r.top - 12)}px`, '--fc-left': `${r.left + r.width}px` } as React.CSSProperties}>
                <button type="button" title="Subir" onClick={() => mover(r.clave, -1)}>↑</button>
                <button type="button" title="Bajar" onClick={() => mover(r.clave, 1)}>↓</button>
                <button type="button" title="Cambiar el nombre" onClick={() => renombrar(c)}>Nombre</button>
                <button type="button" className={conf.obligatorio ? 'fc-on' : ''} title="Obligatorio: no se puede guardar vacío" onClick={() => cambiar(r.clave, { obligatorio: !conf.obligatorio })}>Oblig.</button>
                <button type="button" className={conf.oculto ? 'fc-on fc-on--rojo' : ''} title="Ocultar para todos" onClick={() => cambiar(r.clave, { oculto: !conf.oculto })}>{conf.oculto ? 'Oculto' : 'Ocultar'}</button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};

export default FormularioConfigurable;

// src/components/layout/CargandoModulo.tsx
// ✅ V00438: indicador de carga de un módulo (antes vivía dentro de App.tsx con
//   un <style> embebido; la animación ahora está en App.css).
export default function CargandoModulo() {
  return (
    <div className="app-x2">
      <span className="app-x3" />
      Cargando módulo…
    </div>
  );
}

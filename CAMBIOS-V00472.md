# V00472 — Reglas de Estatus: cambiar la aduana ya no borra los pasos

**Solo web.** Va encima de la V00471. Sin funciones, reglas, índices ni banderas.

## Qué cambia en pantalla
- **Configuración → Reglas de Estatus → Editor de Flujos.** Al cambiar la **aduana**, el tráfico o la carga de un flujo, los pasos del lienzo **se quedan**. Antes salía una pregunta; con *Cancelar*, o si el navegador no la mostraba, el lienzo quedaba en blanco.
  - Si la combinación nueva **aún no tiene flujo guardado**, debajo del nombre dice en amarillo: *Combinación sin flujo guardado: estos pasos se guardan aquí con Guardar flujo.*
  - Si la combinación nueva **ya tiene su flujo**, se abre ese, como siempre.
  - Para empezar un flujo desde cero: *Seleccionar todo* y *Supr*.
- **Al guardar**, se sigue preguntando si se elimina el flujo anterior (*Cancelar* = se quedan los dos). Si el anterior era el de **todas las aduanas** y el nuevo es de una aduana, avisa que, al eliminarlo, las operaciones de las demás aduanas se quedan sin flujo.

## Pasos manuales
Ninguno. Si ya habías perdido los pasos al cambiar la aduana, no se borró nada guardado. Abre el flujo con aduana *Todas*, cambia la aduana y presiona *Guardar flujo*.

## Técnico
- `ConfiguradorStatus.tsx`:
  - en la carga del flujo, una combinación sin documento con pasos en el lienzo los conserva (`setPasosSinGuardar(true)`), sin `window.confirm`;
  - aviso `.cs-aviso-combinacion`;
  - en el confirm de borrar el anterior, `eraGeneralAhoraAduana`.
- Banco de pruebas, con el flujo *Transfer · Exportación · Cargado* de 2 pasos:
  - Aduana *240 Nuevo Laredo* → siguen los 2 pasos, sale el aviso y no hay ningún diálogo;
  - *Guardar flujo* crea *Transfer_Exportación_Cargado_240 Nuevo Laredo* con aduana y 2 pasos; la pregunta de borrar el anterior trae el aviso de todas las aduanas;
  - sin errores de consola.

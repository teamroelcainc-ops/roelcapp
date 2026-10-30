# V00533 — Tipo de Cambio: el T.C. del DOF se registra a las 12:00 de la noche (hora de Texas)

**Solo funciones.** Va encima de la V00532. Sin reglas, índices, banderas ni dependencias.

## Qué cambia
- La Cloud Function programada `tipoCambioDofDiario` corría a las 5:00 a. m. de Texas (`0 5 * * *`, `America/Chicago`). Ahora corre a las **12:00 de la noche** (`0 0 * * *`, misma zona, con su horario de verano).
- Reintentos si Banxico no responde: igual que antes, a los pocos minutos (≈0:02, 0:06, 0:11), nunca más tarde.
- A medianoche de Texas la fecha (`fechaEnZona`) ya es el día nuevo, y el FIX del día hábil anterior ya está publicado por Banxico (sale hacia el mediodía de CDMX). La lógica del valor no cambia.

## Archivos
- `functions/src/tipoCambioDof.ts` (horario y comentarios)
- `functions/src/index.ts` (comentario)
- `functions/test/tipoCambioDof.test.ts` (prueba de la fecha a medianoche)
- `src/config/version.ts`, `public/version.json`, `src/config/historialCambios.ts`, `CAMBIOS-V00533.md`

## Pasos manuales
1. Publicar las funciones: `firebase deploy --only functions:tipoCambioDofDiario` (nunca `firebase deploy` sin `--only`). Al publicar, Cloud Scheduler actualiza el horario del job.
2. El día siguiente, revisar en los logs que corrió a las 0:00 de Texas y en Tipo de Cambio que quedó el T.C. del día.

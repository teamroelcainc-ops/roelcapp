# V00492 — T.C. del DOF automático a las 5:00 a. m. (hora de Texas)

**Solo funciones.** Va encima de la V00491. Sin cambios en la web, reglas, índices ni banderas.

## Qué hace
Todos los días a las **5:00 a. m. hora de Texas** (central, con horario de verano) la función `tipoCambioDofDiario` registra en Tipo de Cambio el T.C. que publica ese día el Diario Oficial:
- **Día hábil bancario en México**: el FIX que Banxico determinó el día hábil bancario anterior (serie SF43718). Ej.: lunes 26-oct-2026 → 18.6670 (FIX del viernes 23). Antes de guardarlo revisa que Banxico traiga el FIX justo de ese día; si no, no registra nada.
- **Sábado, domingo o inhábil bancario de México** (calendario de la CNBV): el DOF del último día hábil.
- **Festivo de la app** (botón Días Festivos): el T.C. del día anterior, como al capturarlo a mano.
- Al registrar un día crea también los días sin DOF que siguen (viernes → sábado y domingo).
- Si alguien ya capturó el día, no lo cambia.
- Corre **solo a las 5:00**. Si esa corrida falla (Banxico no responde), Cloud Scheduler la reintenta a los pocos minutos, hasta 3 veces; nunca más tarde.

## Pasos manuales
1. Pedir un token NUEVO de Banxico en https://www.banxico.org.mx/SieAPIRest/service/v1/token (el anterior quedó en el historial de GitHub; darlo de baja).
2. Aplicar el zip.
3. Guardar el token en Secret Manager (pide el valor; no se guarda en el repo):
   `firebase functions:secrets:set BANXICO_TOKEN`
4. Desplegar solo esta función:
   `npm --prefix functions run build`
   `firebase deploy --only functions:tipoCambioDofDiario`
5. Probarla sin esperar a las 5:00: Google Cloud → Cloud Scheduler → el job de `tipoCambioDofDiario` → **Forzar ejecución**. Si hoy ya está capturado, no hace nada; los logs: `firebase functions:log --only tipoCambioDofDiario`.

## Técnico
- `functions/src/tipoCambioDof.ts`: `fechaEnZona` (America/Chicago), `inhabilesBancariosMx`, `habilBancarioAnterior`, `dofDelDia`, `planTipoCambioDof` (puro), `registrarTipoCambioDof` (Firestore + Banxico, transacción), `tipoCambioDofDiario` (`onSchedule` 0 5 * * *).
- `functions/src/index.ts`: exporta `tipoCambioDofDiario`.
- `functions/test/tipoCambioDof.test.ts`: fechas, calendario 2026, DOF del día, plan.
- Campos nuevos en `tipo_cambio`: `origen`, `fechaFix`, `creadoPor`, `createdAt`.

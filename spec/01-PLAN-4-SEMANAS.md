# CRM Álvar · Plan de construcción · < 4 semanas

> Actualizado: 2026-08-31

---

## La idea que hace esto viable

El CRM **no tiene que estar terminado el día 1**. El embudo del lanzamiento es
secuencial en el tiempo, así que cada módulo tiene su propia fecha límite real:

```
Ads ──► Registro ──► Grupo ──► Clase 1 ──► Clase 2 ──► Clase 3 ──► Directo ──► Calendly ──► Reunión ──► Cierre
 │         │                      │                                              │            │          │
 │         └── LEADS + FORMULARIOS│                                              │            │          │
 └── CAPTURA DE ATRIBUCIÓN        └── SETTER (Call #1)                            │            │          │
                                          CALL #2 ──────────────────────────────┘            │          │
                                                              CALENDLY + MEETINGS ───────────┘          │
                                                                            CLOSER + VENTAS ────────────┘
                                                                                    IA + DASHBOARD ──────► después
```

Construir en ese mismo orden compra entre 1 y 3 semanas de margen por módulo.
El diagnóstico IA puede llegar **incluso después de las primeras reuniones**:
la transcripción se guarda igual y se analiza cuando el módulo esté listo.

---

## Fecha límite real de cada bloque

| Bloque | Tiene que estar listo antes de… | Margen |
|---|---|---|
| Captura de atribución en la landing | **el primer euro de ads** | ⚠️ hoy |
| Leads + formularios + auth | el primer euro de ads | Día 1 del gasto |
| Cola del setter + Call #1 | Clase 1 | +7–10 días |
| Call #2 (confirmar directo) | Clase 3 | +10–12 días |
| Calendly + reuniones + Call #3 | el directo | +12–14 días |
| Closer + resultados + ventas | la primera reunión comercial | +13–15 días |
| Transcripción + diagnóstico IA | *nunca bloquea* — la transcripción se guarda desde el día 1 del closer | +20 días |
| Dashboard + Meta + CAPI | *nunca bloquea la operación* | Durante el lanzamiento |

---

## ⚠️ Hoy, antes que nada

**`landing/capture.js` en producción.**

Es lo único con pérdida irreversible: si los anuncios corren antes de que la
landing guarde `campaign_id`/`ad_id`/`fbclid`, esa atribución **no se puede
reconstruir después**. Ni con la API de Meta, ni a mano.

No depende del CRM ni de la base de datos. Son 10 minutos:

1. Pegar `capture.js` en el `<head>` de todas las páginas de la landing.
2. Añadir al formulario: `<input type="hidden" name="attribution">`.
3. Verificar en consola que `crmAttribution()` devuelve datos al entrar con
   `?utm_source=meta&campaign_id=123`.

Mientras el CRM no exista, el formulario puede seguir enviando a donde envíe
hoy — el campo `attribution` viaja con el resto y se importa después.

---

## Semana 1 · Núcleo y captura

**Objetivo: se pueden gastar euros en ads sin perder un solo dato.**

- Proyecto Next.js + Supabase + Drizzle + Inngest, entornos `dev` y `prod`
- Schema V0 completo migrado (`02-SCHEMA-V0.sql`)
- Auth + roles múltiples por usuario + carga de permisos en login
- `POST /api/public/lead` — endpoint público: idempotente, rate-limited, honeypot
- Normalización E.164 + deduplicación conservadora (nunca fusionar por nombre)
- Atribución inmutable, first-touch y last-touch separados
- Formularios versionados: registro + perfil
- **Enlaces tokenizados por lead** para el formulario de perfil y el grupo
- Activity Log + Audit Log + outbox de eventos
- Ficha del lead: pestañas Datos / Formularios / Actividad
- Listado de leads con filtros y paginación server-side
- Seed con 60 leads falsos en distintos estados

**Necesito de vosotros esta semana:** acceso a la landing · dominio para el CRM ·
altas de Ryan, Álvar e Iwelo · fechas exactas de Clase 1, 2, 3 y directo.

---

## Semana 2 · Setter

**Objetivo: el día de la Clase 1, el setter entra y sabe a quién llamar.**

- Pantalla **"Mi trabajo"** con el orden de prioridad de D3-V2 §54
- Call #1: formulario con preguntas configurables desde BD
- Botón **"No contesta"** como acción atómica: guarda intento, escribe actividad,
  evalúa la política de reintentos y crea **una sola** tarea futura
- Reintentos agrupados por `call_group_id`, sin sobrescribir intentos
- Cualificación con motivo obligatorio si es negativa
- `contact_status` ≠ `qualification_status`. "No coge el teléfono" no descalifica
- Call #2 con segmentación configurable
- Motor de tareas + las 5 reglas automáticas con `dedupe_key`
- Asignación round-robin entre setters activos
- "Mis leads" y "Mis tareas"

**Necesito:** validar la lista definitiva de preguntas de Call #1 y Call #2 ·
confirmar cuántos setters reales hay y quién es cada uno.

---

## Semana 3 · Calendly, closer y ventas

**Objetivo: el día del directo, agendar funciona; al día siguiente, cerrar también.**

- Webhook de Calendly: idempotente por `external_booking_id`, con firma verificada
- Matching conservador con umbrales explícitos y bandeja de revisión manual
- Meetings con `meeting_status` y `commercial_result` separados
- Asignación de closer por event type de Calendly
- Cron de confirmación 24 h → Call #3, idempotente
- Reagendar: `scheduled_at` in-place + `meeting_schedule_history`
- Pantalla del closer: reuniones de hoy + **handoff del setter** montado solo
- Resultados con formulario adaptativo y validaciones de servidor:
  ganado exige importe y método · perdido exige motivo · seguimiento exige fecha
  **y** próxima acción · no-show **no** marca perdido
- Ventas + pagos + estados de financiación, en transacción, idempotentes
- Meeting #2 y #3 sin sobrescribir la anterior
- Campos de notas, Phantom URL y transcripción **con autosave**

**Necesito:** acceso a Calendly y sus event types · proveedor de financiación ·
qué es exactamente "Phantom" (¿PhantomBuster? ¿otra herramienta?).

---

## Semana 4 · Inteligencia y control

**Objetivo: entender qué está pasando mientras todavía se puede corregir.**

- Diagnóstico IA: job en cola, snapshot de contexto, validación contra JSON Schema,
  versión de prompt guardada, nueva fila por ejecución (nunca se sobrescribe)
- Prompt `sales_diagnostic_v1` + **rúbrica anclada** de los scores 0–10
- Vista de diagnóstico en bloques, con cita literal por score
- Dashboard del Owner: los KPIs de la primera fila + funnel + Needs Attention
- Sincronización de Meta (spend por día y entidad)
- **CAPI**: `Lead` → `QualifiedLead` → `Schedule` → `Purchase` con valor,
  server-side y deduplicado por `event_id`
- Health de integraciones + bandeja de incidencias
- Endurecimiento: tests de permisos, de idempotencia y de fórmulas de métricas

---

## Después del lanzamiento

Reports GPT · Productividad del equipo · Biblioteca global de diagnósticos ·
Calendario global · Exports · Cohorte vs actividad · Analytics profundo por
setter y closer.

---

## Lo que puede hacer descarrilar esto

| Riesgo | Mitigación |
|---|---|
| Los ads arrancan antes que `capture.js` | Desplegarlo hoy, independiente del CRM |
| Las fechas de clases se mueven | Automatizaciones relativas a `launch_events`, nunca fechas en el código |
| Preguntas del setter cambiando cada dos días | Están en BD; cambiarlas no requiere desplegar |
| Calendly manda datos distintos de los esperados | Semana 3 empieza capturando webhooks reales antes de escribir el matching |
| Se pide "un gráfico más" en semana 2 | Fuera de V0. Se anota y entra en V1 |
| Transcripciones muy largas para el contexto | Se guardan enteras igual; el troceo se resuelve en el job, no en la BD |

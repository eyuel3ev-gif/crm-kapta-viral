# CRM Álvar · Decisiones cerradas

> Resuelve las contradicciones internas de la *Especificación completa V2* (280 pág.).
> Cuando este documento y el PDF discrepen, **prevalece este documento**.
> Actualizado: 2026-08-31

---

## 1. Contradicciones del PDF, resueltas

| # | Conflicto | Origen | **Decisión** |
|---|---|---|---|
| 1 | `gross_amount DECIMAL` vs "céntimos enteros, nunca float" | D5 §29 vs D5-V2 §55 | `amount_cents INTEGER` + `currency CHAR(3)`. Nunca float para dinero |
| 2 | Un campo `result` vs `meeting_status` + `commercial_result` | D1 §13 vs D4-V2 §52 | **Dos campos separados**. Una reunión puede estar `completed` con resultado `follow_up` |
| 3 | `form_version` en submission vs tabla `FORM_VERSIONS` | D5 §11 vs D5-V2 §60 | Tabla `form_versions` + `form_version_id` en cada submission |
| 4 | `CALENDAR_EVENTS` como tabla vs agregación | D1 §30 vs D5 §72 | **Sin tabla.** El calendario agrega `setter_calls` + `meetings` + `tasks` + `launch_events` |
| 5 | Reagendado modelado de 3 formas | D5 §33 / D4 §19 / V2 §62 / V2 §65 | **Actualizar `scheduled_at` in-place** + fila en `meeting_schedule_history`. Único modelo que no infla `show_rate` ni rompe `meeting_number` |
| 6 | `PAYMENTS` se lista y nunca se define | D1 §30 | Definida en el schema. Obligatoria en V0 por la financiación |
| 7 | `lead.revenue` vs "el revenue pertenece a SALE" | D5 §6 vs V2 §66 | `leads.revenue_cents` es **campo derivado**, recalculado dentro de la transacción de venta. Jamás escrito a mano |
| 8 | `MEETING_COMPLETED` vs `meeting_held` | D5 §7 vs V2 §57 | Vocabulario único: `meeting_held` |
| 9 | `USERS.role_id` único, pero Álvar es Owner **y** Setter | D5 §4 vs D3 §52 | **Roles muchos-a-muchos** (`user_roles`). Con 3 personas todos hacen de todo |
| 10 | Reintentos sin forma de agruparse | D5 §14 vs D3 §32 | `setter_calls.call_group_id`. Sin esto `contact_rate` cuenta mal |
| 11 | `close_rate` sin denominador definido | D4 §49 vs V2 §58 | **Dos métricas distintas y etiquetadas**: `close_rate_meetings` (ventas / reuniones held elegibles) y `close_rate_leads` (leads won / leads con ≥1 reunión held). Un lead con 3 reuniones cuenta 3 veces en la primera y 1 en la segunda |
| 12 | `show_rate` excluye "cancelaciones válidas previas" | V2 §58 | **Válida = cancelada ≥ 2 h antes de `scheduled_at`.** Cancelar con menos margen cuenta como no-show |
| 13 | Dos listas de preguntas para Call #2 y #3 | D3 §21/§27 vs V2 §60/§62 | Prevalece V2. Lista única en `setter_call_questions` |
| 14 | Pregunta económica en Call #1 | D3 §14 P7 vs V2 §55 | Existe en BD, `active = false` por defecto. Se activa sin desplegar |

---

## 2. Stack

Criterio del cliente: *frontend simple y propio; el resto, lo más económico y simple a nivel operativo en el día a día.*

| Capa | Elección | Por qué |
|---|---|---|
| Frontend + API | **Next.js 15 (App Router) + TypeScript** | Propio, un solo repo, un solo deploy. Sin backend separado que mantener |
| UI | Tailwind + shadcn/ui | Negro/gris/blanco, color solo funcional, tal como pide D2 §46. Cero tiempo de diseño desde cero |
| Base de datos | **Supabase (PostgreSQL)** | Postgres gestionado + Auth + backups + editor SQL en un panel. Una herramienta menos que operar |
| Auth | Supabase Auth | Sesiones, recuperación y MFA para Owner sin construir nada |
| ORM / migraciones | Drizzle | SQL-first, migraciones versionadas (exigidas en D5 §99) |
| Jobs, cron, reintentos | **Inngest** | Cola durable + cron + backoff exponencial + dead-letter + panel de observabilidad. Sin infraestructura propia. Cubre de fábrica D5 §66-68 y V2 §63 |
| Email interno | Resend | Solo notificaciones al equipo |
| Hosting | Vercel | `git push` = deploy |
| IA diagnóstico | **Claude Opus 5** (`claude-opus-5`) | Un único proveedor en V0/V1. Los reports GPT son V2 |

**Coste operativo estimado: 20–45 €/mes** más el consumo de IA, que a este volumen de reuniones es despreciable (< 10 € por lanzamiento completo).

**No se usa en V0:** Redis propio, Docker, microservicios, GPT/OpenAI, WhatsApp API, multi-tenancy.

---

## 3. Convenciones no negociables

- **UI en español. Base de datos y API en inglés `snake_case`.** Los labels cambian sin romper datos históricos.
- **UTC en base de datos. `Europe/Madrid` en pantalla.**
- **Dinero en céntimos enteros + `currency` explícita.**
- **`NULL` ≠ `false` ≠ `0`.** `NULL` = no lo sabemos. `false` = sabemos que no ocurrió. `0` = valor real cero. La interfaz muestra `—` para `NULL`, nunca `0`.
- **Permisos en el servidor.** Ocultar un botón no es un permiso.
- **La IA no escribe hechos comerciales.** Solo produce datos derivados en su propia tabla.
- **Ningún fallo externo borra datos locales.** La transcripción sobrevive a cualquier caída de Claude.
- **Idempotencia obligatoria** en formularios, webhooks, tareas automáticas y creación de ventas.

---

## 4. Alcance V0 · lo que entra y lo que no

Con menos de 4 semanas, esto es lo que se construye antes de que entre el primer lead.

### Entra en V0

1. Auth + roles múltiples por usuario
2. Lead único: alta, teléfono E.164, deduplicación conservadora, `public_id` LD-000000
3. Atribución capturada y **inmutable** (IDs de Meta + UTM + `fbclid`/`_fbp`/`_fbc`)
4. Formularios versionados: registro + perfil, con **enlace tokenizado por lead**
5. Setter: cola "Mi trabajo", Call #1 / #2 / #3, reintentos, cualificación
6. Tareas + 5 reglas automáticas con `dedupe_key`
7. Calendly: webhook idempotente, matching conservador, `meetings`
8. Closer: reuniones de hoy, handoff del setter, resultado con validaciones
9. Ventas + pagos + estados de financiación
10. Activity Log + Audit Log
11. Ficha completa del lead

### No entra en V0 — y hay que decirlo en voz alta

Dashboard ejecutivo completo · Analytics con vistas cohorte/actividad · Sincronización de Meta · CAPI · Diagnóstico IA · Reports GPT · Productividad del equipo · Calendario global · Exports · Notificaciones push

Entran en V1 y V2, **escalonados según los plazos reales del embudo** (ver `01-PLAN-4-SEMANAS.md`). Ninguna función de IA o de análisis puede retrasar el núcleo operativo.

---

## 5. Riesgo abierto que hay que decidir ya

**Si los anuncios arrancan antes de que la landing capture parámetros, esa atribución se pierde para siempre y no se puede reconstruir.** El snippet de captura (`landing/capture.js`) es independiente del CRM y se puede desplegar hoy. Es lo primero que hay que poner en producción, antes que cualquier otra cosa de este proyecto.

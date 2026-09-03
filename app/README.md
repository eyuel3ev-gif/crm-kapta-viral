# CRM Álvar · MVP

Sistema operativo comercial del lanzamiento de YouTube Faceless.

Estado: **funciona.** Compila, tipa, el schema pasa 21 comprobaciones y las
tres interfaces se han recorrido en el navegador con datos reales.

📄 **El contexto completo del proyecto está en [`../CONTEXTO.md`](../CONTEXTO.md)**
— arquitectura, reglas de negocio, incoherencias conocidas y preguntas abiertas.

---

## Arrancar

```bash
npm install
npm run dev
```

Y ya está. **No hace falta base de datos ni configurar nada.** Sin
`DATABASE_URL`, el CRM levanta un Postgres embebido en `./.pglite`, crea el
schema y siembra 78 leads repartidos por todo el embudo en el primer arranque
(60 del lanzamiento y 18 del evergreen).

Abre `http://localhost:3000`. Con `DEV_AUTH=true` en `/login` sale un selector
de usuario sin contraseña. El seed crea cinco personas, todas con un solo rol:
**Álvar Sola**, **Eyuel** y **Ryan** (Propietario), **Darío** (Closer) y
**Ángel** (Setter). Cada rol ve su propia interfaz.

La contraseña inicial de las cinco es `CambiarEsto2026!`, pensada para
cambiarse el primer día con `npm run user:password`.

### Con Postgres real

Contra la base de **Neon**:

```bash
cp .env.example .env.local     # rellenar DATABASE_URL
npm run db:push                # crea las tablas
npm run db:init                # secuencia + CHECK que drizzle-kit no genera
```

> ⚠️ **`npm run db:seed` NO es un paso de puesta en marcha.** Empieza con un
> `TRUNCATE` de las 29 tablas: contra producción borra todos los datos. Úsalo
> solo contra una base desechable.

Con `DATABASE_URL` puesta, el modo embebido se desactiva solo y las
migraciones se aplican a mano, que es como debe ser en producción.

---

## Comprobar que sigue bien

```bash
npm run typecheck   # tipos
npm run verify      # 21 comprobaciones del schema contra Postgres embebido
npm run build       # build de producción
```

`npm run verify` no necesita base de datos: levanta un Postgres en memoria,
aplica la migración y comprueba que las promesas del proyecto se cumplen de
verdad — que un webhook repetido de Calendly no duplica la cita, que el doble
click en «Ganado» no crea dos ventas, que `webinar_attended` nace `NULL` y no
`false`. Merece la pena ejecutarlo después de tocar el schema.

---

## Si algo deja de cargar

Pantalla en blanco o un error `[object Event]` en el overlay de Next:

```bash
rm -rf .next && npm run dev
```

Pasa cuando se ejecuta `npm run build` con el servidor de desarrollo abierto:
el build de producción sobrescribe `.next` y el dev server se queda sin sus
chunks. Los datos no se pierden, viven en `.pglite/`.

Para empezar de cero con los datos: `rm -rf .pglite && npm run dev`.

---

## Cómo está organizado

```
src/
  db/          schema Drizzle · init.sql · seed
  lib/         teléfono E.164, dinero, fechas, labels ES↔EN, auth, permisos
  domain/      TODA la regla de negocio
    leads         alta, deduplicación, atribución, tokens
    setter-calls  llamadas, reintentos, cualificación
    meetings      reuniones, resultados, ventas, reagendado
    tasks         tareas y Smart Tasks con dedupe
    automation    las 5 reglas del cron
    state         máquina de estados del lead
    metrics       registro canónico de métricas
    queries       lecturas por rol
  app/         páginas (Owner / Setter / Closer) + rutas API
```

**Los controladores no tienen lógica.** Todo lo que decide algo vive en
`domain/`, y las páginas solo leen y pintan. Es lo que permite que el mismo
cierre de venta se comporte igual desde la interfaz, desde un webhook o desde
un script.

---

## Reglas que el código hace cumplir

Vienen de `spec/00-DECISIONES-CERRADAS.md`. No son estilo, son integridad:

| Regla | Dónde vive |
|---|---|
| Dinero en céntimos enteros, nunca float | `amount_cents` en todo el schema |
| `NULL` ≠ `false` ≠ `0` | `webinar_attended` nace NULL |
| No contestar **no** descalifica | `contact_status` separado de `qualification_status` |
| Reagendar no crea una reunión nueva | `meeting_schedule_history` |
| Meeting #2 nunca sobrescribe la #1 | `unique(lead_id, meeting_number)` |
| Un webhook repetido no duplica nada | `unique(provider, external_event_id)` |
| El cron no genera 12 tareas iguales | `tasks.dedupe_key` |
| Doble click en Ganado = una venta | `sales.idempotency_key` |
| No fusionar personas por nombre parecido | `lead_merge_candidates` |
| Un evento atrasado no degrada un estado avanzado | `domain/state.ts` |
| Perder exige motivo; seguir exige fecha y acción | `validateResult()` |
| Los permisos se validan en el servidor | `assertCan()` en cada action |

---

## Lo que todavía no está

Deliberadamente fuera del V0 (ver `spec/01-PLAN-4-SEMANAS.md`):

- Transcripciones de reuniones y diagnóstico IA — se guarda el enlace a la grabación, no el texto
- Sincronización de Meta y CAPI hacia Meta
- Informes GPT y productividad del equipo
- Calendario global, exportaciones, notificaciones
- Proveedor de identidad externo. La autenticación propia (scrypt + cookie
  firmada con HMAC) **sí está construida** en `src/lib/auth.ts`; lo que no hay
  es SSO ni MFA

---

## Producción · gratis

Vercel queda descartado: su plan Hobby **prohíbe el uso comercial**, y esto es
el CRM de un negocio. La alternativa sale a 0 €/mes:

| | Plan | Coste |
|---|---|---|
| Hosting | Netlify Starter | 0 € · permite uso comercial |
| Base de datos | Neon free | 0 € · 0,5 GB Postgres |
| Cron | GitHub Actions | 0 € |

Se elige **Neon y no Supabase** porque el plan gratuito de Supabase pausa el
proyecto tras 7 días sin actividad y hay que despausarlo a mano: los webhooks
empezarían a fallar en silencio. Neon también se duerme, pero se despierta solo
en medio segundo.

### Pasos

1. Crear la base en **Neon** y copiar la *pooled connection string*.
2. Conectar el repositorio en **Netlify**. `netlify.toml` ya está.
3. Variables de entorno en Netlify:
   `DATABASE_URL` · `DEV_AUTH=false` · `PUBLIC_FORM_TOKEN` ·
   `CRON_SECRET` · `HOTMART_WEBHOOK_TOKEN` · `MANYCHAT_WEBHOOK_TOKEN` ·
   `CALENDLY_WEBHOOK_SIGNING_KEY`
4. Aplicar el esquema: `DATABASE_URL=... npm run db:push`
5. Dominio: en Name.com, `CNAME  crm → <sitio>.netlify.app`
6. Cron: en GitHub, secretos `CRM_URL` y `CRON_SECRET`. El workflow ya está en
   `.github/workflows/cron.yml` y corre cada 10 minutos.
7. Auth: `DEV_AUTH=false` y `SESSION_SECRET` con al menos 32 caracteres
   (`openssl rand -base64 48`). Sin ese secreto la app no arranca.
8. `landing/capture.js` en la landing **antes del primer euro de ads**.

### Webhooks

```
https://crm.TU-DOMINIO/api/webhooks/hotmart     Zapier · cabecera x-crm-token
https://crm.TU-DOMINIO/api/webhooks/manychat    ManyChat · cabecera x-crm-token
https://crm.TU-DOMINIO/api/webhooks/calendly    Calendly · firma HMAC
```

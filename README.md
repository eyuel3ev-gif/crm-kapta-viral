# CRM Kapta Viral

Sistema operativo comercial: leads, cualificación, reuniones, cierre y facturación
en un solo sitio, con las ventas de Hotmart entrando solas.

## 👉 Ver el CRM funcionando

**<https://eyuel3ev-gif.github.io/crm-kapta-viral/>**

No hace falta instalar nada ni tener cuenta. Se entra por el perfil de cada persona
del equipo y se navega como en el día a día: del panel a la lista de leads, de la
lista a la ficha, de la ficha a la reunión.

- **511 pantallas** capturadas de la aplicación real contra su base de datos
- **78 fichas de lead**, cada una con sus 6 pestañas
- **9.915 enlaces internos**, todos funcionando

Los datos son de prueba. Es una versión estática: se navega entera, pero los
botones que escriben en base de datos no graban nada.

## El repositorio

| Carpeta | Qué hay |
|---|---|
| `app/` | La aplicación: Next.js 15, PostgreSQL, Drizzle. Arranca sin configurar nada |
| `spec/` | La especificación, el plan de 4 semanas y las 14 decisiones cerradas |
| `landing/` | Captura de atribución de primer toque. **Desplegar antes del primer euro en anuncios** |
| `docs/` | La demostración navegable que se publica arriba |

Para levantarlo en local, ver [`app/README.md`](app/README.md).

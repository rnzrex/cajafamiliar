# Caja Familiar

Aplicacion web familiar para gestionar ingresos, egresos, conteo de caja, pagos recurrentes, categorias y reportes en soles peruanos.

## Estado actual

- Frontend: React + TypeScript + Vite.
- Estilos: Tailwind CSS.
- Graficos: Recharts.
- Excel: xlsx.
- Base de datos online: Supabase cuando se configuran variables de entorno.
- Respaldo local: localStorage si Supabase no esta configurado o no responde.

## Configurar Supabase

1. Entra a [Supabase](https://supabase.com) y crea un proyecto.
2. Abre el SQL Editor.
3. Copia y ejecuta el contenido de `supabase/schema.sql`.
4. Ve a Project Settings > API.
5. Copia:
   - Project URL
   - anon public key
6. Crea un archivo `.env` usando `.env.example` como base:

```bash
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=TU_SUPABASE_ANON_KEY
VITE_SUPABASE_HOUSEHOLD_ID=00000000-0000-0000-0000-000000000001
```

7. Puedes mantener el `VITE_SUPABASE_HOUSEHOLD_ID` de ejemplo o generar otro UUID. Todos los dispositivos que usen el mismo valor veran la misma caja familiar.

## Migracion desde localStorage

La app detecta si Supabase esta configurado.

- Si Supabase tiene datos, carga los datos online.
- Si Supabase esta vacio, toma los datos actuales de `localStorage` y los sube como migracion inicial.
- Si Supabase no esta configurado, la app sigue funcionando con `localStorage`.

## Desarrollo local

```bash
npm install
npm run dev
```

Abre:

```bash
http://127.0.0.1:5173
```

## Verificar build

```bash
npm run build
```

El build final queda en `dist/`.

## Deploy en Vercel

1. Sube este proyecto a GitHub.
2. Entra a [Vercel](https://vercel.com).
3. Importa el repositorio.
4. Vercel detectara Vite automaticamente. Este proyecto incluye `vercel.json`.
5. Configura estas Environment Variables en Vercel:

```bash
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_HOUSEHOLD_ID
```

6. Deploy.
7. Abre la URL publicada desde celular y computadora.

## Nota de seguridad

El schema incluye politicas RLS simples para uso familiar compartido mientras se migra a internet. Para una version publica con usuarios externos, el siguiente paso recomendado es agregar Supabase Auth y una tabla de miembros por hogar.

## Comandos utiles

```bash
npm run dev
npm run build
npm run preview
```

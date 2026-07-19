# CineOps

Biblioteca privada para descubrir y reproducir películas almacenadas localmente. El frontend se puede publicar en Azure Static Web Apps Free; el video permanece en el equipo local.

## Desarrollo local

1. Copia `.env.example` como `.env` y ajusta las rutas si fuese necesario.
2. Instala dependencias con `npm install`.
3. Carga las variables y ejecuta API y web:

```powershell
$env:MEDIA_ROOTS='E:\Peliculas;F:\Pelicula2025;H:\ruta\a\peliculas'
$env:DATABASE_PATH='E:\CineOps-review\data\cineops.db'
npm run dev
```

Web: `http://localhost:5173`. API: `http://localhost:3001`.

## Docker y Jellyfin

```powershell
docker compose up -d
```

Jellyfin estará en `http://localhost:8096`. Durante su configuración agrega estas bibliotecas:

- `/media/peliculas-e`
- `/media/peliculas-f`
- `/media/peliculas-h`

Los montajes son de solo lectura. Docker Desktop debe tener acceso a las unidades E:, F: y H:.

## Seguridad

- No existen usuarios ni contraseñas predeterminados.
- El frontend desplegado admite Microsoft y GitHub mediante Azure Static Web Apps, pero exige el rol invitado `cineops-user`.
- No expongas los puertos 3001 ni 8096 directamente en el router. Usa Tailscale o un túnel HTTPS con control de acceso.
- Las rutas `/api/libraries/scan` y `/api/movies/:id/stream` deben quedar accesibles únicamente dentro de la red privada.

## Azure Static Web Apps

Configuración de compilación:

- App location: `/apps/web`
- Output location: `dist`
- App build command: `npm run build`

Define `VITE_API_URL` con la URL HTTPS privada/pública protegida del backend antes de compilar.

# Plan Resistencia (Android)

Esta carpeta es independiente del portafolio: no afecta a la página web.

App personal para mejorar la condición cardiovascular, la fuerza, la energía diaria y la resistencia física.
Plan de 4 semanas, hábitos, horario de sueño para entrenar a las 6:00 a. m., comida colombiana y un módulo privado
«Resistencia e intimidad». Todo en español y todos los datos se quedan en el teléfono.

## Instalar en el teléfono

1. En el teléfono, abre **Releases** del repositorio y busca «Plan Resistencia» (o la pestaña **Actions** → «Compilar APK Plan Resistencia» → *Artifacts*).
2. Descarga `PlanResistencia-1.0.N.apk`.
3. Ábrelo. Android pedirá permitir **instalar apps de origen desconocido** para tu navegador o gestor de archivos: acéptalo solo para esta instalación.
4. Al activar un recordatorio, la app pedirá permiso para mostrar notificaciones.

Las versiones nuevas se instalan encima de la anterior y conservan tus datos, porque todas se firman con la misma llave.

## Qué hace la app en Android

- Guarda el progreso en el almacenamiento interno de la app (Capacitor Preferences). Sin cuentas ni servidores.
- Copias de seguridad de Android desactivadas: los datos no se suben a Google Drive. Para pasar tus datos a otro teléfono, usa **Exportar copia (JSON)** en *Historial y ajustes* y luego **Importar**.
- Recordatorios diarios opcionales para bajar pantallas y para acostarte, calculados con tu hora de entrenamiento.
- La pantalla no se apaga mientras corre el cronómetro de una sesión.
- El botón atrás de Android cierra ventanas, sale de la sesión (pausándola) o vuelve al inicio.
- Funciona sin internet: fuentes y código van dentro del APK.

## Desarrollo

Requisitos: Node 22, Java 21 y Android SDK (Android Studio).

```bash
npm ci
npm run typecheck      # revisión de tipos TypeScript
npm run preview        # ver la app en el navegador
npm run sync           # compilar la web y copiarla al proyecto Android
cd android && ./gradlew assembleRelease
```

El APK queda en `android/app/build/outputs/apk/release/`. GitHub Actions (`.github/workflows/plan-resistencia-apk.yml`, en la raíz del repositorio) lo
compila cuando cambia esta carpeta y lo publica en Releases.

Estructura:

- `src/app.tsx`: toda la interfaz (React + TypeScript).
- `src/native.ts`: funciones nativas (almacenamiento, compartir archivo, notificaciones, botón atrás).
- `src/styles.css`: estilos.
- `android/`: proyecto nativo generado por Capacitor.
- `assets/`: icono y pantalla de inicio (se regeneran con `npx capacitor-assets generate --android`).

## Llave de firma

La llave que firma el APK **no está en el repositorio** (es público). El workflow la genera la primera vez y la guarda en
la caché de GitHub Actions para reutilizarla, así las versiones nuevas se instalan encima de la anterior. GitHub borra una
caché que lleva 7 días sin usarse: si eso pasa, la siguiente versión saldrá con otra llave y Android pedirá desinstalar
la anterior. Antes de actualizar en ese caso, usa **Exportar copia (JSON)** y luego **Importar** en la versión nueva.
Para compilar en tu computador, crea tu propia llave en `android/app/plan-resistencia.keystore` (alias `planresistencia`).

## Aviso

Es una aplicación educativa. No hace diagnósticos ni sustituye la valoración de un profesional de la salud. Si aparecen
dolor en el pecho, falta de aire intensa, mareos o desmayos, detén la actividad y busca atención (en Colombia, línea 123).

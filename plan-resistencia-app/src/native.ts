// Puente con las funciones nativas de Android (Capacitor). Todo funciona también en el navegador.
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App as CapApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();

/* ---------- Almacenamiento ---------- */
// Preferences guarda en el almacenamiento interno de la app; localStorage queda como copia de respaldo.
export async function loadRaw(key: string): Promise<string | null> {
  try { const { value } = await Preferences.get({ key }); if (value) return value; } catch { /* sin Preferences */ }
  try { return localStorage.getItem(key); } catch { return null; }
}
export async function saveRaw(key: string, value: string): Promise<boolean> {
  let ok = false;
  try { await Preferences.set({ key, value }); ok = true; } catch { /* sin Preferences */ }
  try { localStorage.setItem(key, value); ok = true; } catch { /* sin localStorage */ }
  return ok;
}
export async function removeRaw(key: string) {
  try { await Preferences.remove({ key }); } catch { /* nada */ }
  try { localStorage.removeItem(key); } catch { /* nada */ }
}

/* ---------- Exportar ---------- */
// Escribe el JSON en un archivo y abre el menú de compartir de Android (Drive, WhatsApp, Archivos…).
export async function shareJson(json: string): Promise<'shared' | 'copied' | 'failed'> {
  const name = `plan-resistencia-${new Date().toISOString().slice(0, 10)}.json`;
  if (isNative) {
    try {
      const res = await Filesystem.writeFile({ path: name, data: json, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: 'Copia de Plan Resistencia', files: [res.uri], dialogTitle: 'Guardar o enviar copia' });
      return 'shared';
    } catch (e) {
      // Cancelar el menú de compartir también llega aquí: no es un error real.
      if (String(e).toLowerCase().includes('cancel')) return 'shared';
    }
  }
  try { await navigator.clipboard.writeText(json); return 'copied'; } catch { return 'failed'; }
}

/* ---------- Recordatorios ---------- */
export const REMINDER_IDS = { screens: 101, bed: 102 } as const;
export type ReminderKey = keyof typeof REMINDER_IDS;

export async function ensureNotificationPermission(): Promise<boolean> {
  if (!isNative) return false;
  try {
    let st = await LocalNotifications.checkPermissions();
    if (st.display !== 'granted') st = await LocalNotifications.requestPermissions();
    return st.display === 'granted';
  } catch { return false; }
}
// Reprograma los recordatorios diarios según el horario actual. `times` en minutos desde medianoche.
export async function syncReminders(enabled: Record<ReminderKey, boolean>, times: Record<ReminderKey, number>, bedLabel: string): Promise<void> {
  if (!isNative) return;
  try {
    await LocalNotifications.cancel({ notifications: Object.values(REMINDER_IDS).map((id) => ({ id })) });
    const texts: Record<ReminderKey, { title: string; body: string }> = {
      screens: { title: 'Hora de bajar pantallas', body: `En una hora a dormir. A la cama a las ${bedLabel} para entrenar descansado.` },
      bed: { title: 'A la cama', body: 'Mañana entrenas temprano. Dormir bien también es parte del plan.' },
    };
    const list = (Object.keys(REMINDER_IDS) as ReminderKey[]).filter((k) => enabled[k]).map((k) => {
      const m = ((Math.round(times[k]) % 1440) + 1440) % 1440;
      return {
        id: REMINDER_IDS[k], title: texts[k].title, body: texts[k].body,
        schedule: { on: { hour: Math.floor(m / 60), minute: m % 60 }, allowWhileIdle: true },
        isExactNotification: false,
      };
    });
    if (list.length) await LocalNotifications.schedule({ notifications: list });
  } catch { /* sin notificaciones */ }
}

/* ---------- Botón atrás de Android ---------- */
// Pila de manejadores: el último registrado (por ejemplo, un modal abierto) responde primero.
const backStack: (() => void)[] = [];
export function pushBack(fn: () => void) { backStack.push(fn); return () => { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); }; }
export function initBackButton(fallback: () => boolean) {
  if (!isNative) return;
  void CapApp.addListener('backButton', () => {
    const top = backStack[backStack.length - 1];
    if (top) { top(); return; }
    if (!fallback()) void CapApp.minimizeApp();
  });
}
export function onAppPause(fn: () => void) {
  if (!isNative) return;
  void CapApp.addListener('pause', fn);
}

/* ---------- Pantalla y barra de estado ---------- */
export async function initStatusBar() {
  if (!isNative) return;
  try { await StatusBar.setStyle({ style: Style.Dark }); } catch { /* nada */ }
}
let wakeLock: { release: () => Promise<void> } | null = null;
export async function keepAwake(on: boolean) {
  const nav = navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
  try {
    if (on && !wakeLock && nav.wakeLock) wakeLock = await nav.wakeLock.request('screen');
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}

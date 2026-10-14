// Plan Resistencia — app Android con React + TypeScript + Capacitor
import React, { useState, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { isNative, loadRaw, saveRaw, removeRaw, shareJson, ensureNotificationPermission, syncReminders, pushBack, initBackButton, onAppPause, initStatusBar, keepAwake } from './native';
import type { ReminderKey } from './native';

/* ===================== Tipos ===================== */
type Level = 'bajo' | 'moderado' | 'alto';
type Goal = 'cardio' | 'fuerza' | 'energia' | 'combinado';
type Difficulty = 'suave' | 'estandar' | 'retador';
type DayKind = 'cardio' | 'fuerza' | 'fuerza-opcional' | 'descanso';
type ExKind = 'warmup' | 'cardio' | 'reps' | 'hold' | 'cooldown';
type Feeling = 'muy-bien' | 'bien' | 'regular' | 'cansado' | 'mal';
type Recovery = 'rapida' | 'normal' | 'lenta';
type Tab = 'inicio' | 'plan' | 'habitos' | 'intimidad' | 'rutina' | 'estadisticas' | 'ajustes';

interface Symptoms { breath: boolean; chest: boolean; dizzy: boolean; faint: boolean }
interface Profile {
  activity: Level | null; sleepHours: number | null; goal: Goal | null; minutes: number | null;
  symptoms: Symptoms; newFatigue: boolean; createdAt: string;
}
interface Exercise {
  id: string; name: string; kind: ExKind; sets: number; reps?: number; repsMax?: number;
  seconds?: number; minutes?: number; rest: number; how: string; cue?: string;
}
interface PlanDay { index: number; week: number; dow: number; kind: DayKind; title: string; subtitle: string; exercises: Exercise[]; note?: string }
interface ExerciseLog { id: string; name: string; sets: number; setsDone: number; detail: string }
interface SessionRecord {
  id: string; planDay: number; week: number; kind: DayKind; title: string; date: string; completedAt: string;
  exercises: ExerciseLog[]; minutes: number; cardioMinutes: number; rpe: number | null; feeling: Feeling | null;
  notes: string; reduced: boolean;
}
interface ActiveSession {
  planDay: number; startedAt: string; elapsedMs: number; runningSince: number | null;
  sets: Record<string, boolean[]>; reduced: boolean; rpe: number | null; feeling: Feeling | null; notes: string;
}
interface IntimacyLog { id: string; date: string; energy: number; tired: number; recovery: Recovery | null; notes: string }
interface Schedule { trainTime: string; sleepTarget: number; prepMinutes: number; reminders: Record<ReminderKey, boolean> }
interface AppState {
  version: 1; profile: Profile | null; difficulty: Difficulty; startedAt: string | null;
  sessions: SessionRecord[]; restDays: number[]; active: ActiveSession | null;
  habits: Record<string, string[]>; intimacy: IntimacyLog[]; schedule: Schedule; discreet: boolean;
}

/* ===================== Utilidades ===================== */
const KEY = 'plan-resistencia-v1';
const TAB_KEY = 'plan-resistencia-tab';
const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const daysBetween = (a: string, b: string) => Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000);
const addDays = (k: string, n: number) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dateKey(d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmtDate = (k: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
  parseKey(k).toLocaleDateString('es-CO', opts);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const fmtClock = (mins: number) => {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440; const h = Math.floor(m / 60); const mm = m % 60;
  return `${h % 12 || 12}:${pad(mm)} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};
const fmtElapsed = (ms: number) => { const t = Math.floor(ms / 1000); const h = Math.floor(t / 3600); const m = Math.floor((t % 3600) / 60); const s = t % 60; return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`; };
const mondayOf = (k: string) => { const d = parseKey(k); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return dateKey(d); };

let audioCtx: AudioContext | null = null;
function unlockAudio() {
  try {
    const W = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = W.AudioContext || W.webkitAudioContext;
    if (!audioCtx && Ctor) audioCtx = new Ctor();
    if (audioCtx && audioCtx.state === 'suspended') void audioCtx.resume();
  } catch { /* sin audio */ }
}
function beep() {
  try {
    if (audioCtx) {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain(); const t = audioCtx.currentTime;
      o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.55);
    }
  } catch { /* nada */ }
  try { navigator.vibrate?.(250); } catch { /* nada */ }
}

/* ===================== Plan de entrenamiento ===================== */
type PushVariant = 'pared' | 'superficie' | 'suelo';
const WEEKS: { name: string; focus: string; cardio: number; squat: [number, number]; bridge: [number, number]; push: { s: number; r: number; rMax?: number; v: PushVariant }; plank: [number, number]; optional: boolean }[] = [
  { name: 'Adaptación', focus: 'Aprender la técnica y crear el hábito.', cardio: 15, squat: [2, 8], bridge: [2, 10], push: { s: 2, r: 8, v: 'pared' }, plank: [2, 15], optional: false },
  { name: 'Desarrollo', focus: 'Más tiempo de cardio y algunas repeticiones extra.', cardio: 20, squat: [2, 10], bridge: [2, 12], push: { s: 2, r: 10, v: 'superficie' }, plank: [2, 20], optional: false },
  { name: 'Resistencia', focus: 'Tercera serie y fuerza opcional según recuperación.', cardio: 25, squat: [3, 10], bridge: [3, 12], push: { s: 2, r: 10, rMax: 12, v: 'suelo' }, plank: [3, 20], optional: true },
  { name: 'Consolidación', focus: 'Mantener lo ganado con 30 min de cardio si lo toleras.', cardio: 30, squat: [3, 12], bridge: [3, 15], push: { s: 3, r: 10, v: 'suelo' }, plank: [3, 25], optional: true },
];
const PATTERN: DayKind[] = ['cardio', 'fuerza', 'cardio', 'fuerza', 'cardio', 'descanso', 'cardio'];
const TOTAL_DAYS = 28;
const REQUIRED_SESSIONS = 24; // 4 cardio + 2 fuerza por semana

const DIFF_INFO: Record<Difficulty, { label: string; desc: string }> = {
  suave: { label: 'Suave', desc: 'Menos repeticiones, cardio 5 min más corto y variantes más fáciles.' },
  estandar: { label: 'Estándar', desc: 'El plan tal como está diseñado.' },
  retador: { label: 'Retador', desc: '+2 repeticiones, +5 s de plancha y variantes algo más exigentes.' },
};

function pushExercise(v: PushVariant, d: Difficulty): { name: string; how: string } {
  const wall = { name: 'Flexiones contra la pared', how: 'De pie frente a la pared, manos a la altura del pecho y algo más abiertas que los hombros. Cuerpo recto de cabeza a talones. Dobla los codos acercando el pecho a la pared y empuja para volver. Exhala al empujar.' };
  const incline = { name: 'Flexiones inclinadas', how: 'Manos en una mesa firme, encimera o banco estable. Cuerpo en línea recta, abdomen activo. Baja el pecho hacia el borde controlando y empuja. Cuanto más baja la superficie, más difícil.' };
  const floor = { name: 'Flexiones', how: 'Manos bajo los hombros, cuerpo recto y abdomen firme. Baja el pecho controlado hasta donde puedas con buena técnica y empuja. Si pierdes la línea del cuerpo, apoya las rodillas.' };
  if (v === 'pared') return d === 'retador' ? incline : wall;
  if (v === 'superficie') return d === 'suave' ? wall : d === 'retador' ? incline : { name: 'Flexiones en pared o superficie firme', how: incline.how };
  return d === 'suave' ? incline : floor;
}

function buildDay(index: number, diff: Difficulty, avail: number | null): PlanDay {
  const wk = Math.floor(index / 7); const dow = index % 7; const W = WEEKS[wk];
  let kind = PATTERN[dow];
  if (kind === 'descanso' && W.optional) kind = 'fuerza-opcional';
  const reps = (r: number) => diff === 'suave' ? Math.max(5, Math.round(r * 0.75)) : diff === 'retador' ? r + 2 : r;
  const hold = (t: number) => diff === 'suave' ? Math.max(10, Math.round((t * 0.75) / 5) * 5) : diff === 'retador' ? t + 5 : t;
  const restAdj = (r: number) => diff === 'suave' ? r + 15 : r;
  const wc = avail !== null && avail <= 15 ? 3 : 4;
  const warm: Exercise = { id: `${index}-warm`, name: 'Calentamiento suave', kind: 'warmup', sets: 1, minutes: wc, rest: 0, how: 'Marcha en el sitio o camina despacio, círculos de hombros y brazos, balanceo de piernas y movilidad de cadera. Sube el ritmo poco a poco.', cue: 'Dura entre 3 y 5 minutos.' };
  const cool: Exercise = { id: `${index}-cool`, name: 'Vuelta a la calma', kind: 'cooldown', sets: 1, minutes: wc, rest: 0, how: 'Camina despacio 1–2 min y estira suave cuádriceps, parte posterior del muslo, glúteos y pecho (20–30 s cada uno) con respiraciones largas.', cue: 'Sin rebotes ni dolor.' };
  const base = { index, week: wk + 1, dow: dow + 1 };

  if (kind === 'cardio') {
    let mins = diff === 'suave' ? Math.max(10, W.cardio - 5) : W.cardio;
    let note: string | undefined;
    if (avail !== null && mins > avail - 2 * wc) {
      const cap = Math.max(8, avail - 2 * wc);
      if (cap < mins) { note = `Ajustado a tu tiempo disponible (${avail} min). Si un día tienes más tiempo, puedes llegar a ${mins} min.`; mins = cap; }
    }
    if (wk === 3 && !note) note = 'Haz los 30 min solo si la semana 3 te sentó bien. Si no, quédate en 25 min: sigue contando como sesión completa.';
    const how = 'Camina a un ritmo que acelere tu respiración pero te deje hablar en frases cortas (prueba del habla). Brazos relajados, pasos naturales y respiración continua.';
    return { ...base, kind, title: 'Cardio', subtitle: `Caminata a paso ligero · ${mins} min`, note, exercises: [
      warm,
      { id: `${index}-walk`, name: 'Caminata a paso ligero', kind: 'cardio', sets: 1, minutes: mins, rest: 0, how, cue: diff === 'retador' ? 'Opcional: alterna 1 min más rápido con 2 min a ritmo normal.' : 'Si te falta el aire para hablar, baja el ritmo.' },
      cool,
    ] };
  }
  if (kind === 'descanso') {
    return { ...base, kind, title: 'Descanso', subtitle: 'Recuperación: caminata suave o estiramientos opcionales', exercises: [] };
  }
  const push = pushExercise(W.push.v, diff);
  const exercises: Exercise[] = [
    warm,
    { id: `${index}-squat`, name: diff === 'suave' ? 'Sentadillas a silla' : 'Sentadillas', kind: 'reps', sets: W.squat[0], reps: reps(W.squat[1]), rest: restAdj(60), how: 'Pies al ancho de los hombros y pecho erguido. Lleva la cadera atrás y abajo como si te sentaras; rodillas en la dirección de los pies. Sube empujando el suelo y exhala al subir.', cue: diff === 'suave' ? 'Toca la silla con los glúteos y vuelve a subir.' : undefined },
    { id: `${index}-bridge`, name: 'Puente de glúteos', kind: 'reps', sets: W.bridge[0], reps: reps(W.bridge[1]), rest: restAdj(45), how: 'Boca arriba, rodillas dobladas y pies apoyados. Aprieta glúteos y eleva la cadera hasta alinear rodillas, cadera y hombros. Sostén 1 s arriba y baja controlado.', cue: 'No arquees la zona lumbar.' },
    { id: `${index}-push`, name: push.name, kind: 'reps', sets: W.push.s, reps: reps(W.push.r), repsMax: W.push.rMax ? reps(W.push.rMax) : undefined, rest: restAdj(60), how: push.how },
    { id: `${index}-plank`, name: 'Plancha abdominal', kind: 'hold', sets: W.plank[0], seconds: hold(W.plank[1]), rest: restAdj(45), how: 'Antebrazos en el suelo, codos bajo los hombros y cuerpo en línea recta. Aprieta abdomen y glúteos, sin subir ni hundir la cadera. Respira normal.', cue: diff === 'suave' ? 'Puedes apoyar las rodillas.' : 'No contengas el aire.' },
    cool,
  ];
  const strengthNo = dow === 1 ? 'A' : dow === 3 ? 'B' : 'C';
  return { ...base, kind, exercises,
    title: kind === 'fuerza-opcional' ? 'Fuerza opcional' : `Fuerza ${strengthNo}`,
    subtitle: 'Piernas, glúteos, pecho y abdomen',
    note: kind === 'fuerza-opcional' ? 'Hazla solo si te sientes recuperado. Si no, márcala como descanso: no afecta tu progreso.' : undefined };
}

const exPrescription = (e: Exercise) => {
  if (e.kind === 'warmup' || e.kind === 'cooldown') return `${e.minutes} min`;
  if (e.kind === 'cardio') return `${e.minutes} min continuos`;
  if (e.kind === 'reps') return `${e.sets} series × ${e.reps}${e.repsMax ? `–${e.repsMax}` : ''} reps`;
  return `${e.sets} series × ${e.seconds} s`;
};
const exMinutes = (e: Exercise, setsDone: number) => {
  if (e.kind === 'warmup' || e.kind === 'cooldown' || e.kind === 'cardio') return setsDone > 0 ? e.minutes || 0 : 0;
  const work = e.kind === 'reps' ? (e.repsMax || e.reps || 0) * 3 : e.seconds || 0;
  return (setsDone * (work + e.rest)) / 60;
};

/* ===================== Estado ===================== */
const defaultState = (): AppState => ({
  version: 1, profile: null, difficulty: 'estandar', startedAt: null, sessions: [], restDays: [], active: null,
  habits: {}, intimacy: [], schedule: { trainTime: '06:00', sleepTarget: 8, prepMinutes: 30, reminders: { screens: false, bed: false } }, discreet: false,
});
function normalize(x: unknown): AppState {
  const d = defaultState();
  if (!x || typeof x !== 'object') return d;
  const o = x as Partial<AppState>;
  const st: AppState = {
    ...d, ...o, version: 1,
    schedule: { ...d.schedule, ...(o.schedule || {}), reminders: { ...d.schedule.reminders, ...(o.schedule?.reminders || {}) } },
    sessions: Array.isArray(o.sessions) ? o.sessions : [],
    restDays: Array.isArray(o.restDays) ? o.restDays.filter((n) => typeof n === 'number') : [],
    intimacy: Array.isArray(o.intimacy) ? o.intimacy : [],
    habits: o.habits && typeof o.habits === 'object' ? o.habits : {},
    difficulty: o.difficulty && o.difficulty in DIFF_INFO ? o.difficulty : 'estandar',
  };
  if (st.active) st.active = { ...st.active, runningSince: null };
  return st;
}
async function loadState(): Promise<AppState> {
  try { const raw = await loadRaw(KEY); if (raw) return normalize(JSON.parse(raw)); } catch { /* datos dañados */ }
  return defaultState();
}
const isFlagged = (p: Profile | null) => !!p && (p.symptoms.chest || p.symptoms.faint || p.symptoms.dizzy || p.symptoms.breath);
const effDifficulty = (s: AppState): Difficulty => isFlagged(s.profile) ? 'suave' : s.difficulty;
const dayDone = (s: AppState, i: number) => s.sessions.some((r) => r.planDay === i) || s.restDays.includes(i);
const currentDayIndex = (s: AppState) => { for (let i = 0; i < TOTAL_DAYS; i++) if (!dayDone(s, i)) return i; return TOTAL_DAYS; };
function computeStats(s: AppState) {
  const required = new Set(s.sessions.filter((r) => r.kind === 'cardio' || r.kind === 'fuerza').map((r) => r.planDay));
  const progress = Math.round((Math.min(required.size, REQUIRED_SESSIONS) / REQUIRED_SESSIONS) * 100);
  const minutes = Math.round(s.sessions.reduce((a, r) => a + (r.minutes || 0), 0));
  // Racha: días con entrenamiento; hasta 2 días seguidos de descanso no la rompen.
  const dates = Array.from(new Set(s.sessions.map((r) => r.date))).sort().reverse();
  let streak = 0;
  if (dates.length && daysBetween(dates[0], dateKey()) <= 3) {
    streak = 1;
    for (let i = 1; i < dates.length; i++) { if (daysBetween(dates[i], dates[i - 1]) <= 3) streak++; else break; }
  }
  return { progress, completed: s.sessions.length, requiredDone: required.size, minutes, streak };
}
function sleepPlan(sc: Schedule) {
  const train = toMin(sc.trainTime);
  const wake = train - sc.prepMinutes;
  const sleep = wake - sc.sleepTarget * 60;
  return { train, wake, sleep, bed: sleep - 15, screens: sleep - 60, dinner: sleep - 120, earliest: wake - 9 * 60, latest: wake - 7 * 60, breakfast: train + 60 };
}

const HABITS: { id: string; label: string; hint: (s: AppState) => string }[] = [
  { id: 'sueno', label: 'Dormir entre 7 y 9 horas', hint: (s) => `Para entrenar a las ${fmtClock(toMin(s.schedule.trainTime))}, duerme hacia las ${fmtClock(sleepPlan(s.schedule).sleep)}.` },
  { id: 'agua', label: 'Beber agua regularmente', hint: () => 'Guíate por la sed y bebe más si sudas o hace calor. No hay una cantidad única para todos.' },
  { id: 'comida', label: 'Comer proteína, frutas y verduras', hint: () => 'Huevo, fríjoles, lentejas, pollo o pescado, más fruta y ensalada durante el día.' },
  { id: 'actividad', label: 'Realizar la actividad programada', hint: () => 'Si hoy tocaba descanso, descansar también cuenta.' },
  { id: 'recuperacion', label: 'Dedicar tiempo a la recuperación', hint: () => 'Estiramientos, caminata suave, una siesta corta o un rato de calma.' },
  { id: 'fatiga', label: 'Respetar la fatiga', hint: () => 'No entrené intenso con fatiga importante (o no hubo fatiga).' },
];
const FEELINGS: { id: Feeling; label: string }[] = [
  { id: 'muy-bien', label: 'Muy bien' }, { id: 'bien', label: 'Bien' }, { id: 'regular', label: 'Regular' }, { id: 'cansado', label: 'Cansado' }, { id: 'mal', label: 'Mal' },
];
const RECOVERY: { id: Recovery; label: string }[] = [{ id: 'rapida', label: 'Rápida' }, { id: 'normal', label: 'Normal' }, { id: 'lenta', label: 'Lenta' }];
const rpeLabel = (n: number) => n <= 2 ? 'Muy fácil' : n <= 4 ? 'Fácil' : n <= 6 ? 'Moderado' : n <= 8 ? 'Duro' : 'Máximo';
const kindLabel: Record<DayKind, string> = { cardio: 'Cardio', fuerza: 'Fuerza', 'fuerza-opcional': 'Fuerza opcional', descanso: 'Descanso' };

/* ===================== Iconos ===================== */
const ICONS: Record<string, string> = {
  inicio: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  plan: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  habitos: 'M4 4h16v16H4zM8 12l3 3 5-6',
  intimidad: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  rutina: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  estadisticas: 'M5 20v-9M12 20V5M19 20v-6M3 20h18',
  ajustes: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  mas: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M15 18l-6-6 6-6',
  play: 'M7 5l12 7-12 7z',
  pause: 'M8 5v14M16 5v14',
  check: 'M5 12l5 5 9-10',
  timer: 'M12 8v5l3 2M9 2h6M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6A2 2 0 0 0 22 18L13.7 3.9a2 2 0 0 0-3.4 0z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  chev: 'M9 6l6 6-6 6',
  x: 'M6 6l12 12M18 6L6 18',
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === 'mas' ? 3.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

/* ===================== Componentes base ===================== */
function Card({ children, className = '', title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return <section className={`card ${className}`}>{(title || action) && <div className="card-head">{title && <h3>{title}</h3>}{action}</div>}{children}</section>;
}
function Ring({ value, size = 112, label }: { value: number; size?: number; label?: string }) {
  const r = (size - 12) / 2; const c = 2 * Math.PI * r; const v = clamp(value, 0, 100);
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${label || 'Progreso'}: ${v}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs><linearGradient id={`rg${size}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--green)" /><stop offset="1" stopColor="var(--blue)" /></linearGradient></defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#rg${size})`} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-arc" />
      </svg>
      <div className="ring-text"><strong>{v}%</strong>{label && <span>{label}</span>}</div>
    </div>
  );
}
function Bar({ value, tone = 'green' }: { value: number; tone?: 'green' | 'blue' }) {
  return <div className="bar" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><div className={`bar-fill ${tone}`} style={{ width: `${clamp(value, 0, 100)}%` }} /></div>;
}
function Chips<T extends string | number>({ options, value, onChange, label, allowClear = true }: { options: { id: T; label: string }[]; value: T | null; onChange: (v: T | null) => void; label: string; allowClear?: boolean }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={String(o.id)} role="radio" aria-checked={value === o.id} className={`chip ${value === o.id ? 'on' : ''}`}
          onClick={() => onChange(value === o.id && allowClear ? null : o.id)}>{o.label}</button>
      ))}
    </div>
  );
}
function Scale({ min, max, value, onChange, label }: { min: number; max: number; value: number | null; onChange: (v: number | null) => void; label: string }) {
  const opts = []; for (let i = min; i <= max; i++) opts.push({ id: i, label: String(i) });
  return <div className="scale"><Chips options={opts} value={value} onChange={onChange} label={label} /></div>;
}
function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', k);
    const off = pushBack(() => closeRef.current());
    if (!isNative) ref.current?.querySelector<HTMLElement>('button, input, textarea, select')?.focus();
    return () => { window.removeEventListener('keydown', k); off(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
function Confirm({ title, text, confirmLabel, danger, onConfirm, onCancel }: { title: string; text: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void }) {
  return <Modal title={title} onClose={onCancel} footer={<><button className="btn ghost" onClick={onCancel}>Cancelar</button><button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>{confirmLabel}</button></>}><p className="muted">{text}</p></Modal>;
}
function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty"><div className="empty-mark" aria-hidden="true" /><strong>{title}</strong><p>{text}</p>{action}</div>;
}
function Callout({ tone, title, children }: { tone: 'warn' | 'danger' | 'info'; title: string; children: ReactNode }) {
  return <div className={`callout ${tone}`} role={tone === 'danger' ? 'alert' : undefined}><Icon name={tone === 'info' ? 'lock' : 'alert'} /><div><strong>{title}</strong><div className="callout-body">{children}</div></div></div>;
}
const SAFETY_TEXT = (
  <p>Detén el ejercicio si aparece dolor u opresión en el pecho, falta de aire que no mejora al bajar el ritmo, mareo, palpitaciones irregulares o un dolor articular agudo. Si los síntomas son intensos o no ceden con el reposo, busca atención urgente (en Colombia, línea <strong>123</strong>).</p>
);

/* ===================== Gráficas ===================== */
const niceMax = (v: number) => { if (v <= 5) return 5; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };
function BarChart({ bars, colors, legend, unit, fixedMax }: { bars: { label: string; values: number[] }[]; colors: string[]; legend?: string[]; unit: string; fixedMax?: number }) {
  const W = 340, H = 190, L = 34, B = 26, T = 18, R = 8;
  const totals = bars.map((b) => b.values.reduce((a, v) => a + v, 0));
  const max = fixedMax ?? niceMax(Math.max(1, ...totals));
  const ih = H - B - T; const bw = (W - L - R) / bars.length;
  const y = (v: number) => T + ih - (v / max) * ih;
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={bars.map((b, i) => `${b.label}: ${Math.round(totals[i])} ${unit}`).join(', ')}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W - R} y1={y(max * f)} y2={y(max * f)} className="grid" /><text x={L - 6} y={y(max * f) + 4} className="axis" textAnchor="end">{Math.round(max * f)}</text></g>)}
        {bars.map((b, i) => {
          let acc = 0; const x = L + i * bw + bw * 0.2; const w = bw * 0.6;
          return <g key={b.label}>
            {b.values.map((v, j) => { const y0 = y(acc); acc += v; const y1 = y(acc); return v > 0 ? <rect key={j} x={x} y={y1} width={w} height={Math.max(0, y0 - y1)} rx={j === b.values.length - 1 || b.values.slice(j + 1).every((n) => !n) ? 5 : 0} fill={colors[j]} /> : null; })}
            {totals[i] > 0 && <text x={x + w / 2} y={y(totals[i]) - 5} className="val" textAnchor="middle">{Math.round(totals[i])}</text>}
            <text x={x + w / 2} y={H - 8} className="axis" textAnchor="middle">{b.label}</text>
          </g>;
        })}
      </svg>
      {legend && <figcaption className="legend">{legend.map((l, i) => <span key={l}><i style={{ background: colors[i] }} />{l}</span>)}<span className="unit">{unit}</span></figcaption>}
    </figure>
  );
}
function LineChart({ points, min, max, color, unit }: { points: { label: string; value: number }[]; min: number; max: number; color: string; unit: string }) {
  const W = 340, H = 180, L = 28, B = 26, T = 14, R = 14;
  const iw = W - L - R, ih = H - B - T;
  const x = (i: number) => L + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => T + ih - ((v - min) / (max - min)) * ih;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${d} L${x(points.length - 1).toFixed(1)},${y(min)} L${x(0).toFixed(1)},${y(min)} Z`;
  const ticks = [min, Math.round((min + max) / 2), max];
  const step = Math.max(1, Math.ceil(points.length / 6));
  const last = points[points.length - 1];
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Último valor: ${last.value} ${unit}`}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 6} y={y(t) + 4} className="axis" textAnchor="end">{t}</text></g>)}
        <path d={area} fill={color} opacity="0.12" />
        <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 5 : 3} fill={i === points.length - 1 ? color : 'var(--surface)'} stroke={color} strokeWidth="2" />)}
        {points.map((p, i) => (i % step === 0 || i === points.length - 1) ? <text key={`l${i}`} x={x(i)} y={H - 8} className="axis" textAnchor="middle">{p.label}</text> : null)}
      </svg>
    </figure>
  );
}

/* ===================== Evaluación inicial ===================== */
function Assessment({ initial, onDone, onCancel }: { initial: Profile | null; onDone: (p: Profile, d: Difficulty) => void; onCancel?: () => void }) {
  const [activity, setActivity] = useState<Level | null>(initial?.activity ?? null);
  const [sleep, setSleep] = useState<string>(initial?.sleepHours ? String(initial.sleepHours) : '');
  const [goal, setGoal] = useState<Goal | null>(initial?.goal ?? null);
  const [minutes, setMinutes] = useState<number | null>(initial?.minutes ?? null);
  const [sym, setSym] = useState<Symptoms>(initial?.symptoms ?? { breath: false, chest: false, dizzy: false, faint: false });
  const [fatigue, setFatigue] = useState(initial?.newFatigue ?? false);
  const [ack, setAck] = useState(false);
  const flagged = sym.breath || sym.chest || sym.dizzy || sym.faint;
  const submit = () => {
    const sh = parseFloat(sleep.replace(',', '.'));
    const p: Profile = { activity, sleepHours: isFinite(sh) ? clamp(sh, 0, 16) : null, goal, minutes, symptoms: sym, newFatigue: fatigue, createdAt: initial?.createdAt ?? new Date().toISOString() };
    const d: Difficulty = flagged || fatigue || activity === 'bajo' ? 'suave' : activity === 'alto' ? 'retador' : 'estandar';
    onDone(p, d);
  };
  const symList: { k: keyof Symptoms; label: string }[] = [
    { k: 'breath', label: 'Falta de aire desproporcionada' }, { k: 'chest', label: 'Dolor u opresión en el pecho' },
    { k: 'dizzy', label: 'Mareos importantes' }, { k: 'faint', label: 'Desmayos' },
  ];
  return (
    <div className="assess">
      <header className="assess-head">
        <span className="eyebrow">Evaluación inicial · 1 minuto</span>
        <h1>Ajustemos el plan a tu punto de partida</h1>
        <p className="muted">Todo es opcional. Con lo que respondas adaptamos la dificultad; puedes cambiarla luego.</p>
      </header>
      <Card title="Nivel de actividad física actual">
        <Chips label="Nivel de actividad" value={activity} onChange={setActivity} options={[{ id: 'bajo', label: 'Bajo' }, { id: 'moderado', label: 'Moderado' }, { id: 'alto', label: 'Alto' }]} />
      </Card>
      <Card title="Horas habituales de sueño">
        <div className="row-inline"><input id="as-sleep" className="input narrow" inputMode="decimal" placeholder="Ej. 6,5" value={sleep} onChange={(e) => setSleep(e.target.value)} aria-label="Horas de sueño" /><span className="muted">horas por noche</span></div>
      </Card>
      <Card title="Objetivo principal">
        <Chips label="Objetivo" value={goal} onChange={setGoal} options={[{ id: 'cardio', label: 'Resistencia cardiovascular' }, { id: 'fuerza', label: 'Fuerza' }, { id: 'energia', label: 'Energía general' }, { id: 'combinado', label: 'Combinación' }]} />
      </Card>
      <Card title="Tiempo disponible por sesión">
        <Chips label="Minutos disponibles" value={minutes} onChange={setMinutes} options={[15, 20, 30, 45].map((m) => ({ id: m, label: `${m} min` }))} />
      </Card>
      <Card title="¿Has tenido alguno de estos síntomas durante el esfuerzo?">
        <div className="checks">
          {symList.map((s) => (
            <label key={s.k} className="check"><input type="checkbox" checked={sym[s.k]} onChange={(e) => setSym({ ...sym, [s.k]: e.target.checked })} /><span>{s.label}</span></label>
          ))}
          <label className="check"><input type="checkbox" checked={fatigue} onChange={(e) => setFatigue(e.target.checked)} /><span>Cansancio nuevo, persistente o desproporcionado</span></label>
        </div>
      </Card>
      {flagged && (
        <Callout tone="danger" title="No te recomendamos empezar una rutina intensa">
          <p>Estos síntomas durante el esfuerzo deben ser valorados por un médico antes de entrenar con intensidad. Esta aplicación no hace diagnósticos.</p>
          <p>Si ahora mismo tienes dolor en el pecho, falta de aire intensa o te desmayaste, detén cualquier actividad y busca atención urgente (línea <strong>123</strong> en Colombia).</p>
          <p>Mientras consultas, el plan solo se activa en modo <strong>Suave</strong>.</p>
          <label className="check"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /><span>Entiendo y voy a consultar con un profesional de la salud.</span></label>
        </Callout>
      )}
      {!flagged && fatigue && (
        <Callout tone="warn" title="Consulta antes de subir la intensidad">
          <p>Un cansancio nuevo, persistente o desproporcionado merece valoración médica antes de aumentar la intensidad. Empezaremos en modo Suave.</p>
        </Callout>
      )}
      <div className="assess-actions">
        {onCancel && <button className="btn ghost" onClick={onCancel}>Cancelar</button>}
        <button className="btn primary lg" disabled={flagged && !ack} onClick={submit}>{flagged ? 'Comenzar en modo suave' : initial ? 'Guardar evaluación' : 'Comenzar el plan'}</button>
      </div>
    </div>
  );
}

/* ===================== Inicio ===================== */
function WeekStrip({ s, week, current, onOpen }: { s: AppState; week: number; current: number; onOpen: (i: number) => void }) {
  const diff = effDifficulty(s); const avail = s.profile?.minutes ?? null;
  const days = Array.from({ length: 7 }, (_, d) => buildDay((week - 1) * 7 + d, diff, avail));
  return (
    <div className="week-strip">
      {days.map((d) => {
        const rec = s.sessions.find((r) => r.planDay === d.index);
        const rest = s.restDays.includes(d.index);
        const st = rec ? 'done' : rest ? 'rest' : d.index === current ? 'today' : 'pending';
        return (
          <button key={d.index} className={`wday ${st} k-${d.kind}`} onClick={() => onOpen(d.index)} aria-label={`Día ${d.index + 1}: ${d.title}, ${st === 'done' ? 'completado' : st === 'rest' ? 'descanso registrado' : st === 'today' ? 'siguiente' : 'pendiente'}`}>
            <span className="wday-n">Día {d.index + 1}</span>
            <span className="wday-dot">{st === 'done' ? <Icon name="check" size={16} /> : st === 'rest' ? '–' : d.kind === 'cardio' ? 'C' : d.kind === 'descanso' ? 'D' : 'F'}</span>
            <span className="wday-k">{d.kind === 'fuerza-opcional' ? 'Opc.' : kindLabel[d.kind]}</span>
            {rec && <span className="wday-date">{fmtDate(rec.date, { day: 'numeric', month: 'short' })}</span>}
          </button>
        );
      })}
    </div>
  );
}
function Home({ s, onStart, onRest, goTab }: { s: AppState; onStart: (i: number) => void; onRest: (i: number) => void; goTab: (t: Tab) => void }) {
  const st = computeStats(s); const cur = currentDayIndex(s); const finished = cur >= TOTAL_DAYS;
  const week = finished ? 4 : Math.floor(cur / 7) + 1;
  const diff = effDifficulty(s);
  const next = finished ? null : buildDay(cur, diff, s.profile?.minutes ?? null);
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  const sp = sleepPlan(s.schedule);
  const todayHabits = (s.habits[dateKey()] || []).length;
  const activeDay = s.active ? buildDay(s.active.planDay, diff, s.profile?.minutes ?? null) : null;
  return (
    <div className="stack">
      <header className="page-head">
        <span className="eyebrow">{fmtDate(dateKey(), { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        <h1>{greet}</h1>
      </header>
      {isFlagged(s.profile) && <Callout tone="danger" title="Modo suave activo por los síntomas que indicaste"><p>Consulta con un médico antes de aumentar la intensidad.</p>{SAFETY_TEXT}</Callout>}

      <div className="hero-grid">
        <Card className="hero">
          <div className="hero-top">
            <div>
              <span className="eyebrow">Semana {week} de 4 · {WEEKS[week - 1].name}</span>
              <h2 className="display">Día {finished ? TOTAL_DAYS : cur + 1}<small> de {TOTAL_DAYS}</small></h2>
              <p className="muted">{WEEKS[week - 1].focus}</p>
            </div>
            <Ring value={st.progress} label="del plan" />
          </div>
          {activeDay && s.active ? (
            <div className="next">
              <div><span className="eyebrow amber">Sesión en pausa</span><strong>Día {activeDay.index + 1} · {activeDay.title}</strong><span className="muted">{fmtElapsed(s.active.elapsedMs)} registrados</span></div>
              <button className="btn primary" onClick={() => onStart(s.active!.planDay)}><Icon name="play" size={18} />Reanudar</button>
            </div>
          ) : next ? (
            <div className="next">
              <div><span className="eyebrow">Siguiente</span><strong>{next.title}</strong><span className="muted">{next.subtitle}</span></div>
              {next.kind === 'descanso'
                ? <button className="btn primary" onClick={() => onRest(next.index)}><Icon name="check" size={18} />Registrar descanso</button>
                : <button className="btn primary" onClick={() => onStart(next.index)}><Icon name="play" size={18} />Continuar</button>}
            </div>
          ) : (
            <div className="next"><div><span className="eyebrow">Plan completado</span><strong>Terminaste las 4 semanas</strong><span className="muted">Puedes repetir el plan con más dificultad desde Ajustes.</span></div><button className="btn ghost" onClick={() => goTab('ajustes')}>Ir a ajustes</button></div>
          )}
          {next?.kind === 'fuerza-opcional' && <p className="hint">{next.note} <button className="link" onClick={() => onRest(next.index)}>Marcar como descanso</button></p>}
        </Card>

        <div className="stat-grid">
          <div className="stat"><span>Entrenamientos</span><strong>{st.completed}</strong><small>{st.requiredDone} de {REQUIRED_SESSIONS} del plan</small></div>
          <div className="stat"><span>Minutos activos</span><strong>{st.minutes}</strong><small>acumulados</small></div>
          <div className="stat"><span>Racha</span><strong>{st.streak}</strong><small>{st.streak === 1 ? 'día activo' : 'días activos'} · 2 días de descanso no la rompen</small></div>
          <div className="stat"><span>Hábitos hoy</span><strong>{Math.round((todayHabits / HABITS.length) * 100)}%</strong><small>{todayHabits} de {HABITS.length}</small></div>
        </div>
      </div>

      <Card title={`Semana ${week}`} action={<button className="link" onClick={() => goTab('plan')}>Ver plan completo</button>}>
        <WeekStrip s={s} week={week} current={cur} onOpen={(i) => { const d = buildDay(i, diff, null); if (d.kind === 'descanso' || dayDone(s, i)) goTab('plan'); else onStart(i); }} />
        <div className="legend small"><span><i className="lg done" />Completado</span><span><i className="lg today" />Siguiente</span><span><i className="lg rest" />Descanso</span></div>
      </Card>

      <Card title="Esta noche" action={<button className="link" onClick={() => goTab('rutina')}>Horario y comida</button>}>
        <div className="tonight">
          <div><span className="muted">A la cama</span><strong>{fmtClock(sp.bed)}</strong></div>
          <div><span className="muted">Dormido</span><strong>{fmtClock(sp.sleep)}</strong></div>
          <div><span className="muted">Despertar</span><strong>{fmtClock(sp.wake)}</strong></div>
          <div><span className="muted">Entreno</span><strong>{fmtClock(sp.train)}</strong></div>
        </div>
      </Card>
    </div>
  );
}

/* ===================== Plan ===================== */
function PlanView({ s, setDifficulty, onStart, onRest, onUnrest }: { s: AppState; setDifficulty: (d: Difficulty) => void; onStart: (i: number) => void; onRest: (i: number) => void; onUnrest: (i: number) => void }) {
  const cur = currentDayIndex(s);
  const [open, setOpen] = useState<number>(Math.min(3, Math.floor(Math.min(cur, 27) / 7)));
  const flagged = isFlagged(s.profile); const diff = effDifficulty(s);
  return (
    <div className="stack">
      <header className="page-head"><span className="eyebrow">4 semanas · 4 cardio + 2–3 fuerza por semana</span><h1>Plan de entrenamiento</h1></header>
      <Card title="Dificultad">
        <Chips label="Dificultad" allowClear={false} value={diff} onChange={(v) => v && setDifficulty(v)}
          options={(['suave', 'estandar', 'retador'] as Difficulty[]).filter((d) => !flagged || d === 'suave').map((d) => ({ id: d, label: DIFF_INFO[d].label }))} />
        <p className="muted small-text">{DIFF_INFO[diff].desc}{flagged ? ' Bloqueada en Suave por los síntomas indicados en la evaluación.' : ' Cambiarla no borra tu progreso.'}</p>
      </Card>
      {WEEKS.map((w, wi) => {
        const days = Array.from({ length: 7 }, (_, d) => buildDay(wi * 7 + d, diff, s.profile?.minutes ?? null));
        const done = days.filter((d) => dayDone(s, d.index)).length;
        const isOpen = open === wi;
        return (
          <section key={wi} className={`card week ${isOpen ? 'open' : ''}`}>
            <button className="week-head" onClick={() => setOpen(isOpen ? -1 : wi)} aria-expanded={isOpen}>
              <div><span className="eyebrow">Semana {wi + 1}</span><h3>{w.name}</h3><span className="muted small-text">Cardio {w.cardio} min · Sentadillas {w.squat[0]}×{w.squat[1]} · Plancha {w.plank[0]}×{w.plank[1]} s</span></div>
              <div className="week-meta"><span className="pill">{done}/7</span><span className={`chev ${isOpen ? 'up' : ''}`}><Icon name="chev" /></span></div>
            </button>
            {isOpen && (
              <ul className="day-list">
                {days.map((d) => {
                  const rec = s.sessions.find((r) => r.planDay === d.index);
                  const rest = s.restDays.includes(d.index);
                  const paused = s.active?.planDay === d.index;
                  return (
                    <li key={d.index} className={`day ${d.index === cur ? 'is-next' : ''}`}>
                      <span className={`tag k-${d.kind}`}>{d.kind === 'fuerza-opcional' ? 'Opcional' : kindLabel[d.kind]}</span>
                      <div className="day-main">
                        <strong>Día {d.index + 1} · {d.title}</strong>
                        <span className="muted small-text">{d.subtitle}</span>
                        {d.exercises.length > 0 && <span className="muted small-text">{d.exercises.filter((e) => e.kind === 'reps' || e.kind === 'hold').map((e) => `${e.name} ${exPrescription(e).replace(' series × ', '×').replace(' reps', '')}`).join(' · ')}</span>}
                        {rec && <span className="ok small-text">Completado el {fmtDate(rec.date)} · {rec.minutes} min{rec.reduced ? ' · versión reducida' : ''}</span>}
                        {rest && <span className="muted small-text">Descanso registrado</span>}
                      </div>
                      <div className="day-actions">
                        {rec ? <button className="btn ghost sm" onClick={() => onStart(d.index)}>Repetir</button>
                          : rest ? <button className="btn ghost sm" onClick={() => onUnrest(d.index)}>Deshacer</button>
                          : d.kind === 'descanso' ? <button className="btn ghost sm" onClick={() => onRest(d.index)}>Registrar descanso</button>
                          : <>
                            <button className={`btn sm ${d.index === cur || paused ? 'primary' : 'ghost'}`} onClick={() => onStart(d.index)}>{paused ? 'Reanudar' : 'Iniciar'}</button>
                            {d.kind === 'fuerza-opcional' && <button className="btn ghost sm" onClick={() => onRest(d.index)}>Descansar</button>}
                          </>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      <Callout tone="warn" title="Seguridad en cada sesión">{SAFETY_TEXT}</Callout>
    </div>
  );
}

/* ===================== Sesión ===================== */
function SessionView({ s, day, active, update, onExit, onRestToday, onFinish }: {
  s: AppState; day: PlanDay; active: ActiveSession; update: (a: ActiveSession) => void;
  onExit: () => void; onRestToday: () => void; onFinish: (r: SessionRecord) => void;
}) {
  const [, setTick] = useState(0);
  const [rest, setRest] = useState<{ endsAt: number; total: number; label: string } | null>(null);
  const [restDone, setRestDone] = useState(false);
  const [openHow, setOpenHow] = useState<string | null>(null);
  const [summary, setSummary] = useState(false);
  const running = active.runningSince !== null;
  useEffect(() => { void keepAwake(running); return () => { void keepAwake(false); }; }, [running]);
  useEffect(() => {
    if (!running && !rest) return;
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [running, rest]);
  const remaining = rest ? Math.max(0, Math.ceil((rest.endsAt - Date.now()) / 1000)) : 0;
  useEffect(() => {
    if (rest && remaining <= 0) { beep(); setRest(null); setRestDone(true); const t = setTimeout(() => setRestDone(false), 3500); return () => clearTimeout(t); }
  }, [rest, remaining]);
  const elapsed = active.elapsedMs + (active.runningSince ? Date.now() - active.runningSince : 0);
  const toggleClock = () => {
    unlockAudio();
    if (running) update({ ...active, elapsedMs: elapsed, runningSince: null });
    else update({ ...active, runningSince: Date.now() });
  };
  const setsOf = (e: Exercise) => { const arr = active.sets[e.id] || []; return Array.from({ length: e.sets }, (_, i) => !!arr[i]); };
  const writeSets = (e: Exercise, arr: boolean[]) => {
    const next: ActiveSession = { ...active, sets: { ...active.sets, [e.id]: arr } };
    if (!running && active.elapsedMs === 0 && arr.some(Boolean)) next.runningSince = Date.now();
    update(next);
  };
  const toggleSet = (e: Exercise, k: number) => {
    unlockAudio();
    const arr = setsOf(e); arr[k] = !arr[k]; writeSets(e, arr);
    if (arr[k] && e.rest > 0 && arr.some((v) => !v)) startRest(e);
  };
  const toggleAll = (e: Exercise) => { const arr = setsOf(e); const all = arr.every(Boolean); writeSets(e, arr.map(() => !all)); };
  const startRest = (e: Exercise) => { unlockAudio(); setRestDone(false); setRest({ endsAt: Date.now() + e.rest * 1000, total: e.rest, label: e.name }); };

  const exDone = day.exercises.filter((e) => setsOf(e).every(Boolean)).length;
  const setsTotal = day.exercises.reduce((a, e) => a + e.sets, 0);
  const setsDone = day.exercises.reduce((a, e) => a + setsOf(e).filter(Boolean).length, 0);
  const estimate = day.exercises.reduce((a, e) => a + exMinutes(e, setsOf(e).filter(Boolean).length), 0);
  const elapsedMin = Math.round(elapsed / 60000);
  const pct = setsTotal ? (setsDone / setsTotal) * 100 : 0;
  const cardioEx = day.exercises.find((e) => e.kind === 'cardio');

  return (
    <div className="stack session">
      <div className="session-bar">
        <button className="btn ghost sm" onClick={onExit}><Icon name="back" size={18} />{running || setsDone ? 'Pausar y salir' : 'Salir'}</button>
        <span className="muted small-text">Semana {day.week} · Día {day.index + 1}</span>
      </div>
      <header className="page-head">
        <span className={`tag k-${day.kind}`}>{kindLabel[day.kind]}</span>
        <h1>{day.title}{active.reduced && <span className="pill amber">Versión reducida</span>}</h1>
        <p className="muted">{day.subtitle}</p>
        {day.note && <p className="hint">{day.note}</p>}
      </header>

      <Card className="clock-card">
        <div className="clock">
          <div><span className="eyebrow">{running ? 'En curso' : elapsed > 0 ? 'En pausa' : 'Lista para empezar'}</span><strong className="display mono">{fmtElapsed(elapsed)}</strong></div>
          <button className={`btn ${running ? 'ghost' : 'primary'} lg`} onClick={toggleClock}><Icon name={running ? 'pause' : 'play'} size={18} />{running ? 'Pausar' : elapsed > 0 ? 'Reanudar' : 'Iniciar sesión'}</button>
        </div>
        <Bar value={pct} />
        <span className="muted small-text">{setsDone} de {setsTotal} series · {exDone} de {day.exercises.length} ejercicios</span>
      </Card>

      <div className="fatigue">
        <span>¿Fatiga importante hoy?</span>
        <div className="row-inline">
          <button className={`btn sm ${active.reduced ? 'primary' : 'ghost'}`} onClick={() => update({ ...active, reduced: !active.reduced })}>{active.reduced ? 'Usando versión reducida' : 'Reducir dificultad'}</button>
          <button className="btn ghost sm" onClick={onRestToday}>Descansar hoy</button>
        </div>
      </div>

      <ol className="ex-list">
        {day.exercises.map((e) => {
          const sets = setsOf(e); const all = sets.every(Boolean);
          return (
            <li key={e.id} className={`card ex ${all ? 'done' : ''}`}>
              <div className="ex-head">
                <label className="ex-check"><input type="checkbox" checked={all} onChange={() => toggleAll(e)} aria-label={`Marcar ${e.name} como completado`} /><span className="box"><Icon name="check" size={16} /></span></label>
                <div className="ex-title">
                  <strong>{e.name}</strong>
                  <span className="presc">{exPrescription(e)}{e.rest ? ` · descanso ${e.rest} s` : ''}</span>
                </div>
                <button className="link" onClick={() => setOpenHow(openHow === e.id ? null : e.id)} aria-expanded={openHow === e.id}>{openHow === e.id ? 'Ocultar' : 'Cómo hacerlo'}</button>
              </div>
              {openHow === e.id && <p className="how">{e.how}{e.cue && <em> {e.cue}</em>}</p>}
              {e.sets > 1 && (
                <div className="ex-sets">
                  {sets.map((v, k) => <button key={k} className={`set ${v ? 'on' : ''}`} onClick={() => toggleSet(e, k)} aria-pressed={v}>Serie {k + 1}</button>)}
                  {e.rest > 0 && <button className="btn ghost sm" onClick={() => rest && rest.label === e.name ? setRest(null) : startRest(e)}><Icon name="timer" size={16} />{rest && rest.label === e.name ? 'Detener descanso' : `Descanso ${e.rest} s`}</button>}
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <Card title="¿Cómo te sentiste?">
        <label className="field-label">Esfuerzo percibido (opcional){active.rpe !== null && <b> · {active.rpe} = {rpeLabel(active.rpe)}</b>}</label>
        <Scale min={1} max={10} value={active.rpe} onChange={(v) => update({ ...active, rpe: v })} label="Esfuerzo percibido de 1 a 10" />
        <label className="field-label">Sensación general</label>
        <Chips label="Sensación" value={active.feeling} onChange={(v) => update({ ...active, feeling: v })} options={FEELINGS} />
        <label className="field-label" htmlFor="ses-notes">Notas (opcional)</label>
        <textarea id="ses-notes" className="input" rows={2} placeholder="Ej. la plancha me costó en la 3.ª serie" value={active.notes} onChange={(ev) => update({ ...active, notes: ev.target.value })} />
      </Card>

      <Callout tone="warn" title="Detén la actividad si notas algo preocupante">{SAFETY_TEXT}</Callout>

      <div className="finish-row">
        <button className="btn primary lg block" onClick={() => { if (running) update({ ...active, elapsedMs: elapsed, runningSince: null }); setSummary(true); }}>Terminar sesión</button>
      </div>

      {(rest || restDone) && (
        <div className="rest-float" role="status" aria-live="polite">
          {rest ? <>
            <div className="rest-ring" style={{ ['--p' as string]: `${(remaining / rest.total) * 100}%` }}><span className="mono">{remaining}</span></div>
            <div className="rest-txt"><strong>Descanso</strong><span className="muted small-text">{rest.label}</span></div>
            <button className="btn ghost sm" onClick={() => setRest({ ...rest, endsAt: rest.endsAt + 15000, total: rest.total + 15 })}>+15 s</button>
            <button className="btn ghost sm" onClick={() => setRest(null)}>Detener</button>
          </> : <><Icon name="check" /><strong>Descanso terminado. Siguiente serie.</strong></>}
        </div>
      )}

      {summary && <SessionSummary day={day} active={active} exDone={exDone} setsDone={setsDone} setsTotal={setsTotal}
        defaultMinutes={elapsedMin >= 3 ? elapsedMin : Math.max(1, Math.round(estimate))} elapsedMin={elapsedMin} estimate={Math.round(estimate)}
        cardioDefault={cardioEx && setsOf(cardioEx).every(Boolean) ? cardioEx.minutes || 0 : 0}
        onClose={() => setSummary(false)}
        onSave={(minutes, cardioMinutes) => onFinish({
          id: uid(), planDay: day.index, week: day.week, kind: day.kind, title: day.title, date: dateKey(), completedAt: new Date().toISOString(),
          exercises: day.exercises.map((e) => ({ id: e.id, name: e.name, sets: e.sets, setsDone: setsOf(e).filter(Boolean).length, detail: exPrescription(e) })),
          minutes, cardioMinutes, rpe: active.rpe, feeling: active.feeling, notes: active.notes.trim(), reduced: active.reduced,
        })} />}
      <div className="spacer-float" />
    </div>
  );
}
function SessionSummary({ day, active, exDone, setsDone, setsTotal, defaultMinutes, elapsedMin, estimate, cardioDefault, onClose, onSave }: {
  day: PlanDay; active: ActiveSession; exDone: number; setsDone: number; setsTotal: number; defaultMinutes: number; elapsedMin: number; estimate: number; cardioDefault: number;
  onClose: () => void; onSave: (m: number, c: number) => void;
}) {
  const [mins, setMins] = useState(String(defaultMinutes));
  const [cardio, setCardio] = useState(String(cardioDefault));
  const [saving, setSaving] = useState(false);
  const hasCardio = day.exercises.some((e) => e.kind === 'cardio');
  const m = Math.max(0, Math.round(Number(mins) || 0));
  const c = hasCardio ? clamp(Math.round(Number(cardio) || 0), 0, m || 999) : 0;
  const nothing = setsDone === 0;
  return (
    <Modal title="Resumen de la sesión" onClose={onClose} footer={<>
      <button className="btn ghost" onClick={onClose}>Seguir entrenando</button>
      <button className="btn primary" disabled={nothing || saving} onClick={() => { setSaving(true); setTimeout(() => onSave(m, c), 250); }}>{saving ? 'Guardando…' : 'Guardar sesión'}</button>
    </>}>
      <div className="sum-grid">
        <div><span className="muted">Ejercicios</span><strong>{exDone}/{day.exercises.length}</strong></div>
        <div><span className="muted">Series</span><strong>{setsDone}/{setsTotal}</strong></div>
        <div><span className="muted">Tiempo medido</span><strong>{elapsedMin} min</strong></div>
        <div><span className="muted">Esfuerzo</span><strong>{active.rpe ?? '—'}</strong></div>
      </div>
      {nothing && <Callout tone="warn" title="No marcaste ningún ejercicio">Marca lo que hiciste o usa «Descansar hoy» si prefieres recuperarte. Descansar no te penaliza.</Callout>}
      <div className="form-grid">
        <label className="field"><span>Minutos de actividad</span><input id="sum-min" className="input" type="number" min={0} max={300} value={mins} onChange={(e) => setMins(e.target.value)} /><small className="muted">Medido: {elapsedMin} min · estimado por ejercicios: {estimate} min</small></label>
        {hasCardio && <label className="field"><span>Minutos de cardio</span><input id="sum-cardio" className="input" type="number" min={0} max={300} value={cardio} onChange={(e) => setCardio(e.target.value)} /></label>}
      </div>
      <ul className="sum-list">
        {day.exercises.map((e) => { const done = (active.sets[e.id] || []).slice(0, e.sets).filter(Boolean).length; return <li key={e.id}><span className={done === e.sets ? 'ok' : 'muted'}>{done === e.sets ? '✓' : `${done}/${e.sets}`}</span>{e.name}</li>; })}
      </ul>
      {active.feeling && <p className="muted">Sensación: {FEELINGS.find((f) => f.id === active.feeling)?.label}{active.notes ? ` · «${active.notes}»` : ''}</p>}
    </Modal>
  );
}

/* ===================== Hábitos ===================== */
function HabitsView({ s, toggle }: { s: AppState; toggle: (date: string, id: string) => void }) {
  const today = dateKey();
  const [date, setDate] = useState(today);
  const checked = s.habits[date] || [];
  const dayPct = (checked.length / HABITS.length) * 100;
  const monday = mondayOf(date);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => d <= today);
  const weekChecks = weekDays.reduce((a, d) => a + (s.habits[d] || []).length, 0);
  const weekPct = weekDays.length ? (weekChecks / (weekDays.length * HABITS.length)) * 100 : 0;
  const cur = currentDayIndex(s);
  const nextDay = cur < TOTAL_DAYS ? buildDay(cur, effDifficulty(s), null) : null;
  return (
    <div className="stack">
      <header className="page-head"><span className="eyebrow">Panel diario</span><h1>Hábitos saludables</h1></header>
      <Card>
        <div className="date-nav">
          <button className="icon-btn" onClick={() => setDate(addDays(date, -1))} aria-label="Día anterior"><Icon name="back" /></button>
          <div className="date-nav-label"><strong>{date === today ? 'Hoy' : fmtDate(date, { weekday: 'long' })}</strong><span className="muted small-text">{fmtDate(date, { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
          <button className="icon-btn flip" disabled={date >= today} onClick={() => setDate(addDays(date, 1))} aria-label="Día siguiente"><Icon name="back" /></button>
        </div>
        <div className="habit-sum">
          <Ring value={Math.round(dayPct)} size={96} label="del día" />
          <div className="habit-week">
            <span className="muted">Semana del {fmtDate(monday, { day: 'numeric', month: 'short' })}</span>
            <strong>{Math.round(weekPct)}%</strong>
            <Bar value={weekPct} tone="blue" />
            <span className="muted small-text">{weekChecks} de {weekDays.length * HABITS.length} casillas en {weekDays.length} {weekDays.length === 1 ? 'día' : 'días'}</span>
          </div>
        </div>
      </Card>
      <ul className="habit-list">
        {HABITS.map((h) => {
          const on = checked.includes(h.id);
          return (
            <li key={h.id}>
              <label className={`habit ${on ? 'on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(date, h.id)} />
                <span className="box"><Icon name="check" size={16} /></span>
                <span className="habit-txt"><strong>{h.label}</strong><span className="muted small-text">{h.id === 'actividad' && date === today && nextDay ? `Siguiente en el plan: ${nextDay.title}. ` : ''}{h.hint(s)}</span></span>
              </label>
            </li>
          );
        })}
      </ul>
      <p className="muted small-text center">Sin dietas restrictivas ni suplementos: se trata de constancia, no de perfección.</p>
    </div>
  );
}

/* ===================== Resistencia e intimidad ===================== */
const TIPS: { t: string; d: string }[] = [
  { t: 'Mejora el cardio poco a poco', d: 'Las caminatas progresivas del plan aumentan tu capacidad aeróbica. Notarás que te recuperas antes en cualquier esfuerzo.' },
  { t: 'Fortalece piernas, glúteos y abdomen', d: 'Sentadillas, puente de glúteos y plancha trabajan los músculos que más sostienen el esfuerzo y los cambios de posición.' },
  { t: 'Respira de forma continua', d: 'Evita contener el aire durante el esfuerzo. Exhalar en la fase de mayor esfuerzo ayuda a mantener el ritmo sin agotarte.' },
  { t: 'Alterna intensidad y ritmo', d: 'No hace falta mantener un ritmo alto todo el tiempo. Bajar el ritmo, cambiar de posición o hacer pausas es parte natural del encuentro.' },
  { t: 'Comunícate y haz pausas', d: 'Hablar con tu pareja sobre ritmo, comodidad y pausas reduce la presión y mejora la experiencia de ambos.' },
  { t: 'La duración no es una prueba', d: 'El sexo no es una competencia ni una medida de masculinidad. Convertir la duración en obligación aumenta la ansiedad, y la ansiedad empeora el rendimiento.' },
];
const DIFFS: { t: string; what: string; help: string; when: string }[] = [
  { t: 'Cansancio físico', what: 'Piernas, glúteos, brazos o espalda se fatigan y necesitas parar por agotamiento muscular.', help: 'Entrenamiento de fuerza y resistencia, dormir bien, cambiar de posición y de ritmo.', when: 'Si el cansancio es nuevo, persistente o desproporcionado para lo que haces.' },
  { t: 'Falta de aire', what: 'Respiración muy agitada para el esfuerzo realizado.', help: 'Cardio progresivo, respirar de forma continua y bajar la intensidad cuando haga falta.', when: 'Si es intensa, nueva o viene con dolor en el pecho, mareo o palpitaciones: consulta pronto; si es aguda, busca atención urgente (123).' },
  { t: 'Pérdida de erección', what: 'Dificultad para lograr o mantener la erección. No es un problema de resistencia física.', help: 'Puede relacionarse con salud cardiovascular, glucosa, presión arterial, sueño, alcohol, tabaco, medicamentos o ansiedad. El ejercicio aporta a la salud vascular, pero no garantiza mejores erecciones.', when: 'Si es frecuente o persistente, consulta con medicina general o urología: a veces es una señal temprana de problemas cardiovasculares.' },
  { t: 'Eyaculación precoz', what: 'Eyacular antes de lo deseado con poco control y que te genera malestar. No depende de la condición física.', help: 'Hablar con la pareja, manejar la ansiedad y técnicas conductuales guiadas por un profesional.', when: 'Si te preocupa o afecta tu relación, consulta con urología o sexología.' },
];
function IntimacyView({ s, save, remove }: { s: AppState; save: (l: IntimacyLog) => void; remove: (id: string) => void }) {
  const blank = (): IntimacyLog => ({ id: '', date: dateKey(), energy: 0, tired: 0, recovery: null, notes: '' });
  const [form, setForm] = useState<IntimacyLog>(blank);
  const [show, setShow] = useState(false);
  const [del, setDel] = useState<string | null>(null);
  const [tab, setTab] = useState<'guia' | 'registro'>('guia');
  const valid = form.energy > 0 && form.tired > 0;
  const logs = [...s.intimacy].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div className="stack">
      <header className="page-head"><span className="eyebrow"><Icon name="lock" size={14} /> Privado · solo en este dispositivo</span><h1>Resistencia e intimidad</h1></header>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'guia'} className={tab === 'guia' ? 'on' : ''} onClick={() => setTab('guia')}>Guía</button>
        <button role="tab" aria-selected={tab === 'registro'} className={tab === 'registro' ? 'on' : ''} onClick={() => setTab('registro')}>Registro privado</button>
      </div>
      {tab === 'guia' ? <>
        <div className="tip-grid">{TIPS.map((t, i) => <Card key={i} className="tip"><strong>{t.t}</strong><p className="muted">{t.d}</p></Card>)}</div>
        <Card title="No son el mismo problema">
          <div className="diff-list">
            {DIFFS.map((d) => (
              <details key={d.t} className="diff">
                <summary><strong>{d.t}</strong><span className="chev"><Icon name="chev" size={18} /></span></summary>
                <dl><dt>Qué es</dt><dd>{d.what}</dd><dt>Qué suele ayudar</dt><dd>{d.help}</dd><dt>Cuándo consultar</dt><dd>{d.when}</dd></dl>
              </details>
            ))}
          </div>
        </Card>
        <Callout tone="info" title="Lo que este plan no promete">
          <p>Ningún entrenamiento puede prometer un número concreto de minutos de duración ni garantizar mejores erecciones. Lo que sí mejora con constancia es tu condición física, tu energía y tu recuperación.</p>
          <p>Este plan no usa sildenafilo ni otros medicamentos como estrategia de resistencia. No tomes testosterona, estimulantes ni suplementos «para rendimiento» sin evaluación profesional.</p>
        </Callout>
      </> : <>
        <Card title={form.id ? 'Editar registro' : 'Nuevo registro'}>
          <div className="form-grid">
            <label className="field"><span>Fecha</span><input id="int-date" className="input" type="date" max={dateKey()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value || dateKey() })} /></label>
          </div>
          <label className="field-label">Nivel de energía antes (1 = muy bajo, 5 = muy alto)</label>
          <Scale min={1} max={5} value={form.energy || null} onChange={(v) => setForm({ ...form, energy: v || 0 })} label="Energía antes" />
          <label className="field-label">Cansancio físico después (1 = nada, 5 = mucho)</label>
          <Scale min={1} max={5} value={form.tired || null} onChange={(v) => setForm({ ...form, tired: v || 0 })} label="Cansancio después" />
          <label className="field-label">Sensación de recuperación</label>
          <Chips label="Recuperación" value={form.recovery} onChange={(v) => setForm({ ...form, recovery: v })} options={RECOVERY} />
          <label className="field-label" htmlFor="int-notes">Notas (opcional)</label>
          <textarea id="int-notes" className="input" rows={2} placeholder="Ej. me recuperé rápido el aliento" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <p className="muted small-text">No escribas nombres ni detalles íntimos identificables. Nada de esto sale de tu navegador.</p>
          <div className="row-inline end">
            {form.id && <button className="btn ghost" onClick={() => setForm(blank())}>Cancelar edición</button>}
            <button className="btn primary" disabled={!valid} onClick={() => { save({ ...form, id: form.id || uid(), notes: form.notes.trim() }); setForm(blank()); }}>{form.id ? 'Guardar cambios' : 'Guardar registro'}</button>
          </div>
        </Card>
        <Card title={`Registros (${logs.length})`} action={logs.length > 0 && <button className="link" onClick={() => setShow(!show)}>{show ? 'Ocultar' : 'Mostrar'}</button>}>
          {logs.length === 0 ? <Empty title="Sin registros todavía" text="Cuando quieras, anota tu energía antes y tu cansancio después. Te ayudará a ver si tu condición física mejora." />
            : !show ? <p className="muted">Los registros están ocultos por discreción.</p>
            : <ul className="log-list">{logs.map((l) => (
              <li key={l.id}>
                <div><strong>{fmtDate(l.date)}</strong><span className="muted small-text">Energía {l.energy}/5 · Cansancio {l.tired}/5{l.recovery ? ` · Recuperación ${RECOVERY.find((r) => r.id === l.recovery)?.label.toLowerCase()}` : ''}</span>{l.notes && <span className="muted small-text">«{l.notes}»</span>}</div>
                <div className="row-inline"><button className="btn ghost sm" onClick={() => { setForm(l); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button><button className="btn ghost sm" onClick={() => setDel(l.id)}>Borrar</button></div>
              </li>))}</ul>}
        </Card>
      </>}
      {del && <Confirm title="Borrar registro" text="Este registro se eliminará de forma permanente." confirmLabel="Borrar" danger onCancel={() => setDel(null)} onConfirm={() => { remove(del); setDel(null); }} />}
    </div>
  );
}

/* ===================== Horario y comida ===================== */
const MEALS: { when: (p: ReturnType<typeof sleepPlan>) => string; title: string; intro: string; items: string[] }[] = [
  { when: (p) => `${fmtClock(p.wake)} · al despertar`, title: 'Antes de entrenar (opcional)', intro: 'Algo pequeño y fácil de digerir si tienes hambre o te sientes sin energía. Si entrenas en ayunas y te sientes bien, también es válido; si te mareas, come algo.',
    items: ['Un vaso de agua al levantarte', 'Banano, granadilla o mandarina', 'Media arepa pequeña con queso campesino', 'Pan con un poco de mantequilla de maní', 'Tinto o café con leche, si te sienta bien'] },
  { when: (p) => `${fmtClock(p.breakfast)} · después del entreno`, title: 'Desayuno de recuperación', intro: 'Proteína + carbohidrato + fruta para recuperar y llegar con energía al mediodía.',
    items: ['Huevos pericos con arepa y una porción de papaya, piña o mango', 'Changua con pan o calado', 'Calentado casero de fríjoles con arroz y huevo, con poco aceite', 'Arepa con queso o cuajada y chocolate o café con leche', 'Avena en leche con banano y poca panela'] },
  { when: () => 'Media mañana', title: 'Onces', intro: 'Útil si el almuerzo queda lejos.', items: ['Fruta con un puñado de maní', 'Yogur o kumis', 'Queso con bocadillo, en porción pequeña'] },
  { when: () => '12:00–1:30 p. m.', title: 'Almuerzo: la comida principal', intro: 'Arma el plato así: la mitad verduras o ensalada, un cuarto proteína y un cuarto almidón.',
    items: ['Proteína: pollo, carne magra, pescado, fríjoles, lentejas o garbanzos', 'Almidón: arroz, papa criolla, yuca o plátano maduro asado', 'Verduras: tomate, lechuga, zanahoria, habichuela, ahuyama', 'Aguacate como grasa saludable', 'Sopas que suman: ajiaco, sancocho, sopa de lentejas', 'Bandeja paisa o fritos: de vez en cuando, mejor al almuerzo y en porción moderada'] },
  { when: () => 'Tarde', title: 'Algo', intro: 'Ligero, para no llegar con mucha hambre a la cena.', items: ['Fruta', 'Mazorca o arepa pequeña', 'Galletas integrales con queso'] },
  { when: (p) => `antes de ${fmtClock(p.dinner)}`, title: 'Cena ligera', intro: 'Termina de cenar unas 2 horas antes de dormir. Las comidas muy pesadas o fritas de noche pueden empeorar el sueño.',
    items: ['Sudado de pollo con papa y ensalada', 'Pescado a la plancha con patacón al horno', 'Tortilla de huevo con verduras y arepa', 'Sopa de verduras con pollo', 'Arepa con huevo y tomate'] },
];
function ScheduleView({ s, setSchedule, toast }: { s: AppState; setSchedule: (sc: Schedule) => void; toast: (m: string) => void }) {
  const sc = s.schedule; const p = sleepPlan(sc);
  const [busy, setBusy] = useState<ReminderKey | null>(null);
  const toggleReminder = async (k: ReminderKey, on: boolean) => {
    if (!isNative) { toast('Los recordatorios funcionan en la app instalada en Android'); return; }
    setBusy(k);
    if (on && !(await ensureNotificationPermission())) { setBusy(null); toast('Activa las notificaciones de la app en los ajustes de Android'); return; }
    setSchedule({ ...sc, reminders: { ...sc.reminders, [k]: on } });
    setBusy(null);
    toast(on ? `Recordatorio diario a las ${fmtClock(k === 'bed' ? p.bed : p.screens)}` : 'Recordatorio desactivado');
  };
  const timeline: { t: number; label: string; tone?: string }[] = [
    { t: 14 * 60, label: 'Último café o tinto del día (protege el sueño)' },
    { t: p.dinner, label: 'Terminar la cena' },
    { t: p.screens, label: 'Bajar pantallas y luces; preparar la ropa del entreno' },
    { t: p.bed, label: 'A la cama', tone: 'blue' },
    { t: p.sleep, label: `Dormir · ${sc.sleepTarget} h de sueño`, tone: 'blue' },
    { t: p.wake + 1440, label: 'Despertar, agua y snack opcional', tone: 'green' },
    { t: p.train + 1440, label: 'Entrenamiento con calentamiento', tone: 'green' },
    { t: p.breakfast + 1440, label: 'Desayuno de recuperación', tone: 'green' },
  ];
  return (
    <div className="stack">
      <header className="page-head"><span className="eyebrow">Entrenar temprano sin dormir menos</span><h1>Horario y comida</h1></header>
      <div className="sched-grid">
        <Card title="Tus datos">
          <div className="form-grid">
            <label className="field"><span>Hora de entrenamiento</span><input id="sc-train" className="input" type="time" value={sc.trainTime} onChange={(e) => e.target.value && setSchedule({ ...sc, trainTime: e.target.value })} /></label>
            <label className="field"><span>Tiempo para alistarte</span>
              <select id="sc-prep" className="input" value={sc.prepMinutes} onChange={(e) => setSchedule({ ...sc, prepMinutes: Number(e.target.value) })}>{[15, 20, 30, 45].map((m) => <option key={m} value={m}>{m} min</option>)}</select></label>
            <label className="field wide"><span>Horas de sueño objetivo: <b>{sc.sleepTarget} h</b></span>
              <input id="sc-sleep" type="range" min={7} max={9} step={0.5} value={sc.sleepTarget} onChange={(e) => setSchedule({ ...sc, sleepTarget: Number(e.target.value) })} /></label>
          </div>
          <div className="reminders">
            <label className="pref"><div><strong>Recordar bajar pantallas</strong><span className="muted small-text">Cada día a las {fmtClock(p.screens)}</span></div>
              <input type="checkbox" className="switch" disabled={busy !== null} checked={sc.reminders.screens} onChange={(e) => void toggleReminder('screens', e.target.checked)} /></label>
            <label className="pref"><div><strong>Recordar irme a la cama</strong><span className="muted small-text">Cada día a las {fmtClock(p.bed)}</span></div>
              <input type="checkbox" className="switch" disabled={busy !== null} checked={sc.reminders.bed} onChange={(e) => void toggleReminder('bed', e.target.checked)} /></label>
            <p className="muted small-text">Para despertarte a las {fmtClock(p.wake)}, usa la alarma del reloj de tu teléfono.</p>
          </div>
          {s.profile?.sleepHours != null && s.profile.sleepHours < 7 && <p className="hint">Indicaste que sueles dormir {s.profile.sleepHours} h. Adelanta la hora de acostarte 15 minutos cada pocos días hasta llegar a la meta.</p>}
        </Card>
        <Card className="bed-card">
          <span className="eyebrow">Para entrenar a las {fmtClock(p.train)}</span>
          <div className="bed-big"><div><span className="muted">A la cama</span><strong className="display">{fmtClock(p.bed)}</strong></div><div><span className="muted">Despertar</span><strong className="display">{fmtClock(p.wake)}</strong></div></div>
          <p className="muted small-text">Para dormir entre 7 y 9 horas, duérmete entre las {fmtClock(p.earliest)} y las {fmtClock(p.latest)}; calculamos 15 min para conciliar el sueño.</p>
        </Card>
      </div>
      <Card title="Tu día">
        <ol className="timeline">{timeline.map((t, i) => <li key={i} className={t.tone || ''}><span className="mono">{fmtClock(t.t)}</span><span>{t.label}</span></li>)}</ol>
        <p className="muted small-text">Los fines de semana intenta no mover la hora de despertar más de una hora: así el madrugón del lunes cuesta menos.</p>
      </Card>
      <h2 className="section-title">Qué comer, a la colombiana</h2>
      <div className="meal-grid">
        {MEALS.map((m) => (
          <Card key={m.title} className="meal">
            <span className="eyebrow">{m.when(p)}</span><h3>{m.title}</h3><p className="muted">{m.intro}</p>
            <ul className="dots">{m.items.map((it) => <li key={it}>{it}</li>)}</ul>
          </Card>
        ))}
      </div>
      <Card title="Bebidas">
        <ul className="dots">
          <li>Agua según la sed durante el día; más si hace calor o sudas mucho.</li>
          <li>Jugos naturales en agua con poca azúcar, mejor que gaseosas.</li>
          <li>Aguapanela con limón está bien con moderación.</li>
          <li>Alcohol (cerveza, aguardiente): empeora la calidad del sueño y puede afectar la erección y la recuperación. Mejor poco y lejos de la hora de dormir.</li>
        </ul>
      </Card>
      <Callout tone="info" title="Sin dietas ni suplementos">No necesitas dietas restrictivas, suplementos ni productos «para rendimiento sexual». Si tienes diabetes, hipertensión, problemas renales u otra condición, pide orientación a un profesional de nutrición.</Callout>
    </div>
  );
}

/* ===================== Estadísticas ===================== */
function StatsView({ s, goTab }: { s: AppState; goTab: (t: Tab) => void }) {
  const byWeek = [1, 2, 3, 4].map((w) => s.sessions.filter((r) => r.week === w));
  const rpePts = [...s.sessions].filter((r) => r.rpe !== null).sort((a, b) => a.completedAt.localeCompare(b.completedAt)).map((r) => ({ label: `D${r.planDay + 1}`, value: r.rpe as number }));
  const energyPts = [...s.intimacy].sort((a, b) => a.date.localeCompare(b.date)).map((l) => ({ label: fmtDate(l.date, { day: 'numeric', month: 'numeric' }), value: l.energy }));
  const today = dateKey();
  const habitDays = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const anyHabits = habitDays.some((d) => (s.habits[d] || []).length > 0);
  const st = computeStats(s);
  if (!s.sessions.length && !anyHabits && !s.intimacy.length) {
    return <div className="stack"><header className="page-head"><span className="eyebrow">Tus datos reales</span><h1>Estadísticas</h1></header>
      <Card><Empty title="Aún no hay datos" text="Completa tu primera sesión o marca tus hábitos de hoy. Las gráficas se llenan solo con lo que registres." action={<div className="row-inline center"><button className="btn primary" onClick={() => goTab('plan')}>Ir al plan</button><button className="btn ghost" onClick={() => goTab('habitos')}>Marcar hábitos</button></div>} /></Card></div>;
  }
  return (
    <div className="stack">
      <header className="page-head"><span className="eyebrow">Tus datos reales</span><h1>Estadísticas</h1></header>
      <div className="stat-grid four">
        <div className="stat"><span>Progreso</span><strong>{st.progress}%</strong><small>{st.requiredDone}/{REQUIRED_SESSIONS} sesiones del plan</small></div>
        <div className="stat"><span>Minutos</span><strong>{st.minutes}</strong><small>actividad total</small></div>
        <div className="stat"><span>Cardio</span><strong>{Math.round(s.sessions.reduce((a, r) => a + r.cardioMinutes, 0))}</strong><small>minutos</small></div>
        <div className="stat"><span>Esfuerzo medio</span><strong>{rpePts.length ? (rpePts.reduce((a, p) => a + p.value, 0) / rpePts.length).toFixed(1) : '—'}</strong><small>de 10</small></div>
      </div>
      <div className="chart-grid">
        <Card title="Minutos de cardio por semana">
          {s.sessions.some((r) => r.cardioMinutes > 0)
            ? <BarChart bars={byWeek.map((rs, i) => ({ label: `Sem ${i + 1}`, values: [rs.reduce((a, r) => a + r.cardioMinutes, 0)] }))} colors={['var(--green)']} unit="min" />
            : <Empty title="Sin cardio registrado" text="Completa una sesión de cardio para ver tus minutos por semana." />}
        </Card>
        <Card title="Sesiones completadas">
          {s.sessions.length
            ? <BarChart bars={byWeek.map((rs, i) => ({ label: `Sem ${i + 1}`, values: [rs.filter((r) => r.kind === 'cardio').length, rs.filter((r) => r.kind !== 'cardio').length] }))} colors={['var(--green)', 'var(--blue)']} legend={['Cardio', 'Fuerza']} unit="sesiones" fixedMax={7} />
            : <Empty title="Sin sesiones" text="Tus sesiones aparecerán aquí agrupadas por semana del plan." />}
        </Card>
        <Card title="Esfuerzo percibido">
          {rpePts.length >= 2 ? <LineChart points={rpePts} min={0} max={10} color="var(--blue)" unit="de 10" />
            : <Empty title="Faltan registros" text="Indica tu esfuerzo (1–10) al terminar al menos dos sesiones." />}
        </Card>
        <Card title="Nivel de energía">
          {energyPts.length >= 2 ? <LineChart points={energyPts} min={0} max={5} color="var(--green)" unit="de 5" />
            : <Empty title="Faltan registros" text="Necesitas al menos dos registros en el módulo privado para ver la evolución." />}
        </Card>
        <Card title="Cumplimiento de hábitos · 14 días" className="span2">
          {anyHabits ? <BarChart bars={habitDays.map((d) => ({ label: String(parseKey(d).getDate()), values: [Math.round(((s.habits[d] || []).length / HABITS.length) * 100)] }))} colors={['var(--blue)']} unit="% de hábitos" fixedMax={100} />
            : <Empty title="Sin hábitos marcados" text="Marca tus hábitos en el panel diario para ver tu cumplimiento." />}
        </Card>
      </div>
    </div>
  );
}

/* ===================== Historial y ajustes ===================== */
function EditSession({ rec, onClose, onSave, onDelete }: { rec: SessionRecord; onClose: () => void; onSave: (r: SessionRecord) => void; onDelete: () => void }) {
  const [r, setR] = useState<SessionRecord>(rec);
  const [ask, setAsk] = useState(false);
  if (ask) return <Confirm title="Borrar sesión" text="Se eliminará de tu historial y el día volverá a quedar pendiente en el plan." confirmLabel="Borrar sesión" danger onCancel={() => setAsk(false)} onConfirm={onDelete} />;
  return (
    <Modal title={`Editar · Día ${rec.planDay + 1} ${rec.title}`} onClose={onClose} footer={<>
      <button className="btn ghost danger-text" onClick={() => setAsk(true)}>Borrar</button>
      <span className="grow" />
      <button className="btn ghost" onClick={onClose}>Cancelar</button>
      <button className="btn primary" onClick={() => onSave({ ...r, notes: r.notes.trim() })}>Guardar cambios</button>
    </>}>
      <div className="form-grid">
        <label className="field"><span>Fecha</span><input id="ed-date" className="input" type="date" max={dateKey()} value={r.date} onChange={(e) => e.target.value && setR({ ...r, date: e.target.value })} /></label>
        <label className="field"><span>Minutos de actividad</span><input id="ed-min" className="input" type="number" min={0} max={300} value={r.minutes} onChange={(e) => setR({ ...r, minutes: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></label>
        {r.kind === 'cardio' && <label className="field"><span>Minutos de cardio</span><input id="ed-cardio" className="input" type="number" min={0} max={300} value={r.cardioMinutes} onChange={(e) => setR({ ...r, cardioMinutes: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></label>}
      </div>
      <label className="field-label">Esfuerzo percibido</label>
      <Scale min={1} max={10} value={r.rpe} onChange={(v) => setR({ ...r, rpe: v })} label="Esfuerzo" />
      <label className="field-label">Sensación</label>
      <Chips label="Sensación" value={r.feeling} onChange={(v) => setR({ ...r, feeling: v })} options={FEELINGS} />
      <label className="field-label" htmlFor="ed-notes">Notas</label>
      <textarea id="ed-notes" className="input" rows={2} value={r.notes} onChange={(e) => setR({ ...r, notes: e.target.value })} />
    </Modal>
  );
}
function SettingsView({ s, storageOk, setS, onReassess, toast }: { s: AppState; storageOk: boolean; setS: (fn: (p: AppState) => AppState) => void; onReassess: () => void; toast: (m: string) => void }) {
  const [edit, setEdit] = useState<SessionRecord | null>(null);
  const [confirm, setConfirm] = useState<'reset' | 'wipe' | 'import' | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importErr, setImportErr] = useState('');
  const json = useMemo(() => JSON.stringify(s, null, 2), [s]);
  const kb = (new Blob([json]).size / 1024).toFixed(1);
  const sessions = [...s.sessions].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [sharing, setSharing] = useState(false);
  const exportFile = async () => {
    setSharing(true);
    const r = await shareJson(json);
    setSharing(false);
    if (r === 'copied') toast('Copia guardada en el portapapeles');
    else if (r === 'failed') { setExportOpen(true); toast('No se pudo compartir. Copia el texto de abajo'); }
  };
  const copy = () => {
    const fallback = () => { taRef.current?.focus(); taRef.current?.select(); toast('Texto seleccionado: mantén pulsado para copiar'); };
    try { navigator.clipboard.writeText(json).then(() => toast('Historial copiado al portapapeles'), fallback); } catch { fallback(); }
  };
  const readFile = (f: File | undefined) => {
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { setImportText(String(rd.result || '')); setImportErr(''); };
    rd.onerror = () => setImportErr('No se pudo leer el archivo.');
    rd.readAsText(f);
  };
  const tryImport = () => {
    try { const parsed = JSON.parse(importText); if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) throw new Error('x'); setImportErr(''); setConfirm('import'); }
    catch { setImportErr('El texto no es una copia válida de esta aplicación. Pega el JSON completo exportado.'); }
  };
  return (
    <div className="stack">
      <header className="page-head"><span className="eyebrow">Tus registros</span><h1>Historial y ajustes</h1></header>
      <Card title={`Historial de sesiones (${sessions.length})`}>
        {sessions.length === 0 ? <Empty title="Sin sesiones todavía" text="Cuando termines una sesión aparecerá aquí y podrás editarla." />
          : <ul className="hist">{sessions.map((r) => (
            <li key={r.id}>
              <span className={`tag k-${r.kind}`}>{kindLabel[r.kind]}</span>
              <div className="hist-main"><strong>Día {r.planDay + 1} · {r.title}</strong>
                <span className="muted small-text">{fmtDate(r.date)} · {r.minutes} min{r.cardioMinutes ? ` (${r.cardioMinutes} cardio)` : ''} · {r.exercises.filter((e) => e.setsDone === e.sets).length}/{r.exercises.length} ejercicios{r.rpe ? ` · esfuerzo ${r.rpe}` : ''}{r.feeling ? ` · ${FEELINGS.find((f) => f.id === r.feeling)?.label.toLowerCase()}` : ''}</span>
                {r.notes && <span className="muted small-text">«{r.notes}»</span>}</div>
              <button className="btn ghost sm" onClick={() => setEdit(r)}>Editar</button>
            </li>))}</ul>}
      </Card>
      <Card title="Preferencias">
        <div className="pref"><div><strong>Evaluación inicial</strong><span className="muted small-text">{s.profile ? `Actividad ${s.profile.activity ?? 'sin indicar'} · ${s.profile.minutes ? `${s.profile.minutes} min por sesión` : 'tiempo sin indicar'}` : 'Sin completar'}</span></div><button className="btn ghost sm" onClick={onReassess}>Repetir evaluación</button></div>
        <label className="pref"><div><strong>Modo discreto</strong><span className="muted small-text">Muestra «Bienestar» en el menú en lugar de «Intimidad».</span></div><input type="checkbox" className="switch" checked={s.discreet} onChange={(e) => setS((p) => ({ ...p, discreet: e.target.checked }))} /></label>
      </Card>
      <Card title="Tus datos">
        <div className={`storage ${storageOk ? 'ok' : 'bad'}`}>
          <Icon name="lock" />
          <div><strong>{storageOk ? (isNative ? 'Guardado en este teléfono' : 'Guardado en este navegador') : 'No se pudo guardar'}</strong>
            <span className="muted small-text">{storageOk ? `Todo se guarda en el almacenamiento interno de la app en este dispositivo (${kb} KB). No hay cuentas ni servidores: nada sale del teléfono salvo que tú exportes una copia. Si desinstalas la app o borras sus datos, se pierde; exporta una copia antes.` : 'El último guardado falló. Exporta una copia para no perder tus registros.'}</span></div>
        </div>
        <div className="data-actions">
          <button className="btn primary" disabled={sharing} onClick={() => void exportFile()}>{sharing ? 'Preparando…' : 'Exportar copia (JSON)'}</button>
          <button className="btn ghost" onClick={() => setExportOpen(!exportOpen)}>{exportOpen ? 'Ocultar texto e importación' : 'Ver texto / importar'}</button>
          <button className="btn ghost" onClick={() => setConfirm('reset')}>Reiniciar plan</button>
          <button className="btn danger" onClick={() => setConfirm('wipe')}>Borrar todos los datos</button>
        </div>
        {exportOpen && <div className="export">
          <p className="muted small-text">También puedes copiar el texto. Para restaurar, elige el archivo .json o pega el texto abajo.</p>
          <textarea ref={taRef} id="export-json" className="input mono" rows={8} readOnly value={json} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn primary sm" onClick={copy}>Copiar JSON</button>
          <label className="field-label" htmlFor="import-file">Importar una copia</label>
          <input id="import-file" type="file" accept="application/json,.json,text/plain" className="input" onChange={(e) => readFile(e.target.files?.[0])} />
          <textarea id="import-json" className="input mono" rows={4} placeholder="Pega aquí el JSON exportado" value={importText} onChange={(e) => setImportText(e.target.value)} />
          {importErr && <p className="danger-text small-text">{importErr}</p>}
          <button className="btn ghost sm" disabled={!importText.trim()} onClick={tryImport}>Importar</button>
        </div>}
      </Card>
      <p className="muted small-text center">Esta aplicación es educativa y no sustituye la valoración de un profesional de la salud. Versión 1.0</p>

      {edit && <EditSession rec={edit} onClose={() => setEdit(null)}
        onSave={(r) => { setS((p) => ({ ...p, sessions: p.sessions.map((x) => x.id === r.id ? r : x) })); setEdit(null); toast('Sesión actualizada'); }}
        onDelete={() => { setS((p) => ({ ...p, sessions: p.sessions.filter((x) => x.id !== edit.id) })); setEdit(null); toast('Sesión borrada'); }} />}
      {confirm === 'reset' && <Confirm title="¿Reiniciar el plan?" text="Se borrarán las sesiones completadas y los descansos registrados, y volverás al día 1. Se conservan tus hábitos, el registro privado, el horario y la evaluación." confirmLabel="Reiniciar plan" danger onCancel={() => setConfirm(null)}
        onConfirm={() => { setS((p) => ({ ...p, sessions: [], restDays: [], active: null, startedAt: new Date().toISOString() })); setConfirm(null); toast('Plan reiniciado. Empiezas en el día 1'); }} />}
      {confirm === 'wipe' && <Confirm title="¿Borrar todos los datos?" text="Se eliminará todo lo guardado en este navegador: sesiones, hábitos, registro privado, horario y evaluación. No se puede deshacer." confirmLabel="Borrar todo" danger onCancel={() => setConfirm(null)}
        onConfirm={() => { void removeRaw(KEY); void removeRaw(TAB_KEY); setS(() => ({ ...defaultState() })); setConfirm(null); toast('Datos borrados'); }} />}
      {confirm === 'import' && <Confirm title="¿Reemplazar tus datos?" text="La copia importada reemplazará todos los datos actuales de este navegador." confirmLabel="Importar y reemplazar" onCancel={() => setConfirm(null)}
        onConfirm={() => { try { setS(() => normalize(JSON.parse(importText))); setImportText(''); toast('Datos importados'); } catch { setImportErr('No se pudo importar.'); } setConfirm(null); }} />}
    </div>
  );
}

/* ===================== App ===================== */
const NAV: { id: Tab; label: string }[] = [
  { id: 'inicio', label: 'Mi progreso' }, { id: 'plan', label: 'Plan' }, { id: 'habitos', label: 'Hábitos' },
  { id: 'intimidad', label: 'Intimidad' }, { id: 'rutina', label: 'Horario y comida' }, { id: 'estadisticas', label: 'Estadísticas' }, { id: 'ajustes', label: 'Historial y ajustes' },
];
const MOBILE_MAIN: Tab[] = ['inicio', 'plan', 'habitos', 'estadisticas'];
const MOBILE_LABEL: Partial<Record<Tab, string>> = { inicio: 'Inicio', estadisticas: 'Gráficas' };

const pauseActiveFn = (p: AppState): AppState => p.active && p.active.runningSince
  ? { ...p, active: { ...p.active, elapsedMs: p.active.elapsedMs + (Date.now() - p.active.runningSince), runningSince: null } } : p;

function App({ initial }: { initial: AppState }) {
  const [s, setState] = useState<AppState>(initial);
  const [tab, setTab] = useState<Tab>(() => { try { const t = localStorage.getItem(TAB_KEY) as Tab | null; return t && NAV.some((n) => n.id === t) ? t : 'inicio'; } catch { return 'inicio'; } });
  const [sessionDay, setSessionDay] = useState<number | null>(null);
  const [save, setSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const [reassess, setReassess] = useState(false);
  const [pendingStart, setPendingStart] = useState<number | null>(null);
  const stateRef = useRef(s); stateRef.current = s;
  const toastTimer = useRef<number | undefined>(undefined);
  const setS = (fn: (p: AppState) => AppState) => setState((p) => fn(p));
  const toast = (m: string) => { setToastMsg(m); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(null), 2800); };

  useEffect(() => {
    setSave('saving');
    let alive = true;
    const t = setTimeout(() => { void saveRaw(KEY, JSON.stringify(s)).then((ok) => { if (alive) setSave(ok ? 'saved' : 'error'); }); }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [s]);
  useEffect(() => {
    // Al salir de la app o bloquear el teléfono se guarda de inmediato.
    const flush = () => { void saveRaw(KEY, JSON.stringify(stateRef.current)); };
    window.addEventListener('pagehide', flush);
    const vis = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', vis);
    onAppPause(flush);
    void initStatusBar();
    return () => { window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); };
  }, []);
  // Recordatorios diarios: se reprograman cuando cambia el horario.
  const sp = sleepPlan(s.schedule);
  useEffect(() => {
    void syncReminders(s.schedule.reminders, { screens: sp.screens, bed: sp.bed }, fmtClock(sp.bed));
  }, [s.schedule.reminders.screens, s.schedule.reminders.bed, sp.screens, sp.bed]);
  // Botón atrás de Android: cierra el menú, sale de la sesión o vuelve al inicio antes de minimizar.
  const navRef = useRef({ more, sessionDay, tab });
  navRef.current = { more, sessionDay, tab };
  useEffect(() => {
    initBackButton(() => {
      const n = navRef.current;
      if (n.more) { setMore(false); return true; }
      if (n.sessionDay !== null) { setState(pauseActiveFn); setSessionDay(null); return true; }
      if (n.tab !== 'inicio') { setTab('inicio'); return true; }
      return false;
    });
  }, []);
  useEffect(() => { try { localStorage.setItem(TAB_KEY, tab); } catch { /* nada */ } }, [tab]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab, sessionDay]);

  const pauseActive = pauseActiveFn;
  const goTab = (t: Tab) => { if (sessionDay !== null) { setS(pauseActive); setSessionDay(null); } setTab(t); setMore(false); };
  const openSession = (i: number) => {
    const p = stateRef.current;
    if (p.active && p.active.planDay !== i) { setPendingStart(i); return; }
    if (!p.active) setS((x) => ({ ...x, active: { planDay: i, startedAt: new Date().toISOString(), elapsedMs: 0, runningSince: null, sets: {}, reduced: false, rpe: null, feeling: null, notes: '' }, startedAt: x.startedAt ?? new Date().toISOString() }));
    setSessionDay(i);
  };
  const markRest = (i: number) => { setS((p) => ({ ...p, restDays: p.restDays.includes(i) ? p.restDays : [...p.restDays, i] })); toast('Descanso registrado. Recuperarse también es entrenar'); };

  if (!s.profile || reassess) {
    return <div className="shell solo"><main className="main"><Assessment initial={s.profile} onCancel={s.profile ? () => setReassess(false) : undefined}
      onDone={(profile, difficulty) => { setS((p) => ({ ...p, profile, difficulty: p.profile && !reassess ? p.difficulty : difficulty, startedAt: p.startedAt ?? new Date().toISOString() })); setReassess(false); toast(reassess ? 'Evaluación actualizada' : 'Plan listo. ¡A por el día 1!'); setTab('inicio'); }} />
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}</main></div>;
  }

  const diff = effDifficulty(s);
  const day = sessionDay !== null ? buildDay(sessionDay, s.active?.reduced ? 'suave' : diff, s.profile.minutes) : null;
  const navLabel = (t: Tab, mobile = false) => t === 'intimidad' && s.discreet ? 'Bienestar' : (mobile && MOBILE_LABEL[t]) || NAV.find((n) => n.id === t)!.label;

  let view: ReactNode;
  if (day && s.active && s.active.planDay === day.index) {
    view = <SessionView s={s} day={day} active={s.active} update={(a) => setS((p) => ({ ...p, active: a }))}
      onExit={() => { setS(pauseActive); setSessionDay(null); toast('Sesión en pausa. Puedes reanudarla cuando quieras'); }}
      onRestToday={() => { setS((p) => { const a = p.active; const any = a && Object.values(a.sets).some((arr) => arr.some(Boolean)); return any ? pauseActive(p) : { ...p, active: null }; }); setSessionDay(null); setTab('inicio'); toast('Hoy descansas, sin penalización. La sesión te espera'); }}
      onFinish={(r) => { setS((p) => ({ ...p, sessions: [...p.sessions, r], active: null, restDays: p.restDays.filter((d) => d !== r.planDay) })); setSessionDay(null); setTab('inicio'); toast(`Sesión guardada · ${r.minutes} min`); }} />;
  } else if (tab === 'inicio') view = <Home s={s} onStart={openSession} onRest={markRest} goTab={goTab} />;
  else if (tab === 'plan') view = <PlanView s={s} setDifficulty={(d) => { setS((p) => ({ ...p, difficulty: d })); toast(`Dificultad: ${DIFF_INFO[d].label}`); }} onStart={openSession} onRest={markRest} onUnrest={(i) => setS((p) => ({ ...p, restDays: p.restDays.filter((d) => d !== i) }))} />;
  else if (tab === 'habitos') view = <HabitsView s={s} toggle={(date, id) => setS((p) => { const cur = p.habits[date] || []; return { ...p, habits: { ...p.habits, [date]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] } }; })} />;
  else if (tab === 'intimidad') view = <IntimacyView s={s} save={(l) => { setS((p) => ({ ...p, intimacy: p.intimacy.some((x) => x.id === l.id) ? p.intimacy.map((x) => x.id === l.id ? l : x) : [...p.intimacy, l] })); toast('Registro guardado en este dispositivo'); }} remove={(id) => { setS((p) => ({ ...p, intimacy: p.intimacy.filter((x) => x.id !== id) })); toast('Registro borrado'); }} />;
  else if (tab === 'rutina') view = <ScheduleView s={s} toast={toast} setSchedule={(sc) => setS((p) => ({ ...p, schedule: sc }))} />;
  else if (tab === 'estadisticas') view = <StatsView s={s} goTab={goTab} />;
  else view = <SettingsView s={s} storageOk={save !== 'error'} setS={setS} onReassess={() => setReassess(true)} toast={toast} />;

  const activeTab = sessionDay !== null ? 'plan' : tab;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><div><strong>Plan Resistencia</strong><span className="muted small-text">4 semanas</span></div></div>
        <nav aria-label="Secciones">{NAV.map((n) => <button key={n.id} className={`nav-item ${activeTab === n.id ? 'on' : ''}`} onClick={() => goTab(n.id)} aria-current={activeTab === n.id ? 'page' : undefined}><Icon name={n.id} />{navLabel(n.id)}</button>)}</nav>
        <div className={`save-state ${save}`}><i />{save === 'saving' ? 'Guardando…' : save === 'error' ? 'Error al guardar' : 'Guardado en este dispositivo'}</div>
      </aside>
      <main className="main">
        <div className="mobile-top"><div className="brand"><span className="brand-mark" aria-hidden="true" /><strong>Plan Resistencia</strong></div><div className={`save-state ${save}`}><i />{save === 'saving' ? 'Guardando…' : save === 'error' ? 'Error al guardar' : 'Guardado'}</div></div>
        <div className="view" key={sessionDay !== null ? `s${sessionDay}` : tab}>{view}</div>
      </main>
      <nav className="bottom-nav" aria-label="Secciones">
        {MOBILE_MAIN.map((t) => <button key={t} className={activeTab === t && !more ? 'on' : ''} onClick={() => goTab(t)}><Icon name={t} /><span>{navLabel(t, true)}</span></button>)}
        <button className={more || (!MOBILE_MAIN.includes(activeTab) ) ? 'on' : ''} onClick={() => setMore(!more)} aria-expanded={more}><Icon name="mas" /><span>Más</span></button>
      </nav>
      {more && <div className="sheet-overlay" onClick={() => setMore(false)}><div className="sheet" onClick={(e) => e.stopPropagation()} role="menu">
        {(['intimidad', 'rutina', 'ajustes'] as Tab[]).map((t) => <button key={t} role="menuitem" className={`nav-item ${activeTab === t ? 'on' : ''}`} onClick={() => goTab(t)}><Icon name={t} />{navLabel(t)}</button>)}
      </div></div>}
      {pendingStart !== null && <Confirm title="Tienes una sesión en pausa" text={`La sesión del día ${(s.active?.planDay ?? 0) + 1} está en pausa. Si empiezas el día ${pendingStart + 1}, se descartará lo marcado en la sesión pausada.`} confirmLabel="Descartar y empezar"
        onCancel={() => setPendingStart(null)} onConfirm={() => { const i = pendingStart; setS((p) => ({ ...p, active: { planDay: i, startedAt: new Date().toISOString(), elapsedMs: 0, runningSince: null, sets: {}, reduced: false, rpe: null, feeling: null, notes: '' } })); setPendingStart(null); setSessionDay(i); }} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

function Root() {
  const [initial, setInitial] = useState<AppState | null>(null);
  useEffect(() => { void loadState().then(setInitial); }, []);
  if (!initial) return <div className="splash" role="status"><span className="brand-mark" aria-hidden="true" /><span className="muted">Cargando tu plan…</span></div>;
  return <App initial={initial} />;
}

createRoot(document.getElementById('root')!).render(<Root />);

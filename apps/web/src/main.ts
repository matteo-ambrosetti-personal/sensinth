import './style.css';
import {
  STYLES,
  SensorRecorder,
  getStyle,
  parseRecording,
  type EngineView,
  type Router,
  type Style,
} from '@sensinth/core';
import { loadFonts } from './fonts';
import { Player } from './player';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { CameraSource } from './sensors/camera';
import { DeviceSource } from './sensors/device';
import { GamepadSource } from './sensors/gamepad';
import { LidAngleSource } from './sensors/lid';
import { MacMotionSource, MacSensorsSource, isMacApp } from './sensors/mac';
import { LightSource } from './sensors/light';
import { LocationSource } from './sensors/location';
import { SourceManager } from './sensors/manager';
import { MicrophoneSource } from './sensors/microphone';
import { MidiSource } from './sensors/midi';
import { MotionSource } from './sensors/motion';
import { NativeSensorsSource, isNativeApp } from './sensors/native';
import { PointerSource } from './sensors/pointer';
import { ComputePressureSource } from './sensors/pressure';
import { ReplayWebSource, formatDuration } from './sensors/replay';
import { SimulatedWebSource } from './sensors/simulated';
import { nowSeconds } from './sensors/source';
import { DialsView } from './ui/dials';
import { FlowView } from './ui/flow/flow';
import { LabView, SOURCE_NAMES } from './ui/lab';
import { MatrixView } from './ui/matrix';
import { Scope } from './ui/scope';
import { SensorsView } from './ui/sensors';
import { SourcesView } from './ui/sources';
import { TracksView } from './ui/tracks';

loadFonts();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MIN_BPM = 60;
const MAX_BPM = 200;

const prefs: Prefs = loadPrefs();
let style: Style = getStyle(prefs.styleId ?? '') ?? (STYLES[0] as Style);
let bpm = clampBpm(prefs.bpm ?? style.defaultTempo);
const player = new Player(style, bpm);

// Tempo ---------------------------------------------------------------------
const tempoInput = $<HTMLInputElement>('tempo');
const tempoValue = $<HTMLOutputElement>('tempo-value');
tempoInput.min = String(MIN_BPM);
tempoInput.max = String(MAX_BPM);

function clampBpm(v: number): number {
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(v)));
}

function setBpm(v: number): void {
  bpm = clampBpm(v);
  tempoInput.value = String(bpm);
  tempoValue.textContent = String(bpm);
  player.setTempo(bpm);
  prefs.bpm = bpm;
  savePrefs(prefs);
}

tempoInput.addEventListener('input', () => setBpm(Number(tempoInput.value)));
$('tempo-down').addEventListener('click', () => setBpm(bpm - 1));
$('tempo-up').addEventListener('click', () => setBpm(bpm + 1));

const taps: number[] = [];
const tapBtn = $('tap');
tapBtn.addEventListener('click', () => {
  const t = performance.now();
  if (taps.length && t - (taps[taps.length - 1] as number) > 2000) taps.length = 0;
  taps.push(t);
  if (taps.length > 5) taps.shift();
  if (taps.length >= 2) {
    const span = (taps[taps.length - 1] as number) - (taps[0] as number);
    setBpm(60000 / (span / (taps.length - 1)));
  }
  tapBtn.classList.add('flash');
  setTimeout(() => tapBtn.classList.remove('flash'), 90);
});
setBpm(bpm);

// Style ---------------------------------------------------------------------
const stylesEl = $('styles');
const styleDesc = $('style-desc');

function renderStyles(): void {
  stylesEl.replaceChildren();
  for (const s of STYLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-chip';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(s.id === style.id));
    btn.textContent = s.name;
    btn.addEventListener('click', () => selectStyle(s));
    stylesEl.append(btn);
  }
  styleDesc.textContent = `${style.description} Suggested tempo: ${style.defaultTempo} BPM.`;
}

function selectStyle(s: Style): void {
  style = s;
  player.setStyle(s);
  prefs.styleId = s.id;
  savePrefs(prefs);
  renderStyles();
}
renderStyles();

// Sources -------------------------------------------------------------------
const locationSource = new LocationSource();
player.keyHint = () => locationSource.keyHint();
const sources = new SourceManager(player.hub, [
  new MotionSource(),
  new PointerSource(),
  new MicrophoneSource(),
  new CameraSource(),
  locationSource,
  new DeviceSource(),
  new NativeSensorsSource(),
  // In the app, the native source reads the real light sensor instead.
  ...(isNativeApp() ? [] : [new LightSource()]),
  // The Mac app reads the lid natively (and faster) than WebHID can.
  ...(isMacApp() ? [] : [new LidAngleSource()]),
  new MacSensorsSource(),
  new MacMotionSource(),
  new ComputePressureSource(),
  new GamepadSource(),
  new MidiSource(),
  new SimulatedWebSource(),
]);
const sourcesView = new SourcesView($('sources'), sources, (id, on) => void toggleSource(id, on));
sources.onChange = () => sourcesView.render();
sourcesView.render();

/**
 * First visit: the Android app starts with motion and its native sensors,
 * the Mac app with the pointer, keyboard and Mac sensors, phone browsers with
 * motion, computers with the pointer and keyboard.
 */
function defaultSources(): Record<string, boolean> {
  if (isNativeApp()) return { motion: true, device: true, native: true };
  if (isMacApp()) return { pointer: true, device: true, mac: true };
  const touch = window.matchMedia('(pointer: coarse)').matches;
  return touch ? { motion: true, device: true } : { pointer: true, device: true };
}

async function toggleSource(id: string, on: boolean): Promise<void> {
  if (on) await sources.enable(id);
  else sources.disable(id);
  if (id !== 'replay') {
    prefs.sources = { ...prefs.sources, [id]: sources.isOn(id) };
    savePrefs(prefs);
  }
}

prefs.sources ??= defaultSources();
for (const [id, on] of Object.entries(prefs.sources)) if (on) void sources.restore(id);

// Recorder ------------------------------------------------------------------
const recorder = new SensorRecorder();
const recordBtn = $<HTMLButtonElement>('record');
const recordLabel = $('record-label');
const recorderStatus = $('recorder-status');
const loadInput = $<HTMLInputElement>('load-recording');

recordBtn.addEventListener('click', () => {
  if (!recorder.recording) {
    recorder.start(player.hub);
    recordBtn.setAttribute('aria-pressed', 'true');
    recordLabel.textContent = 'Stop and save';
    renderRecorder();
    return;
  }
  const rec = recorder.stop();
  recordBtn.setAttribute('aria-pressed', 'false');
  recordLabel.textContent = 'Record sensors';
  if (rec.samples.length === 0) {
    recorderStatus.textContent = 'Nothing recorded. Turn on a source first.';
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  const name = `sensinth-${stamp}.json`;
  download(name, JSON.stringify(rec));
  recorderStatus.textContent = `Saved ${name}: ${rec.descriptors.length} channels, ${formatDuration(rec.samples.at(-1)?.[0] ?? 0)}.`;
});

loadInput.addEventListener('change', async () => {
  const file = loadInput.files?.[0];
  loadInput.value = '';
  if (!file) return;
  try {
    const rec = parseRecording(JSON.parse(await file.text()));
    sources.add(new ReplayWebSource(rec, file.name));
    await sources.enable('replay');
    recorderStatus.textContent = `Replaying ${file.name}. Turn other sources off to hear only the recording.`;
  } catch (err) {
    recorderStatus.textContent =
      err instanceof SyntaxError ? `${file.name} is not valid JSON.` : (err as Error).message;
  }
});

function renderRecorder(): void {
  if (!recorder.recording) return;
  recorderStatus.textContent = `Recording ${formatDuration(recorder.duration)} · ${recorder.sampleCount.toLocaleString()} readings`;
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Transport -----------------------------------------------------------------
const playBtn = $<HTMLButtonElement>('play');
const hint = $('hint');

/** No sensor, no music: Play needs at least one source switched on (deterministic mode aside). */
function anySourceOn(): boolean {
  return sources.sources.some((s) => sources.isOn(s.id));
}

function renderTransport(): void {
  const playing = player.playing;
  const seeded = player.deterministic;
  const canPlay = playing || anySourceOn() || seeded !== undefined;
  playBtn.setAttribute('aria-pressed', String(playing));
  playBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  playBtn.disabled = !canPlay;
  const channels = player.hub.list();
  const playingSeed = player.view()?.snapshot.seed;
  if (!canPlay) hint.textContent = 'Turn on at least one sensor source. No sensor, no music.';
  else if (!playing && seeded)
    hint.textContent = `Seed ${seeded.seed}: the same gestures at the same times play the same music.`;
  else if (!playing) hint.textContent = 'You set tempo and style. The sensors write the rest.';
  else if (playingSeed !== undefined)
    hint.textContent = `Seed ${playingSeed}. Every key you type plays a note; every sensor moves the music the same way each time.`;
  else if (player.view()?.snapshot.waiting ?? true)
    hint.textContent = 'Waiting for a sensor… the music starts on the next bar after one sends.';
  else if (channels.some((c) => c.desc.source === 'phone'))
    hint.textContent = 'Shake, tilt, clap or point the camera somewhere else. The music follows.';
  else hint.textContent = 'Playing. Every track below is written by the sensors.';
}

// Play becomes available as soon as a source is switched on.
sources.onChange = () => {
  sourcesView.render();
  renderTransport();
};

playBtn.addEventListener('click', async () => {
  if (player.playing) player.stop();
  else {
    if (!anySourceOn() && !player.deterministic) return;
    try {
      await player.start();
    } catch (err) {
      hint.textContent = `Audio could not start: ${(err as Error).message}`;
      return;
    }
  }
  renderTransport();
});
renderTransport();

// Deterministic mode ---------------------------------------------------------
const detOn = $<HTMLInputElement>('det-on');
const detSeed = $<HTMLInputElement>('det-seed');
const detDesc = $('det-desc');
detOn.checked = prefs.deterministic ?? false;
detSeed.value = String(prefs.seed ?? 42);

function readSeed(): number {
  const v = Math.floor(Number(detSeed.value));
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 0xffffffff) : 42;
}

function applyDeterministic(): void {
  const seed = readSeed();
  detSeed.value = String(seed);
  player.setDeterministic(detOn.checked ? seed : undefined);
  detSeed.disabled = !detOn.checked;
  prefs.deterministic = detOn.checked;
  prefs.seed = seed;
  savePrefs(prefs);
  const later = player.playing ? ' Takes effect at the next Play.' : '';
  detDesc.textContent = detOn.checked
    ? `The seed writes the tracks. Each sensor moves the music by a fixed amount, and every key you type plays its own note when you type it.${later}`
    : `Off: the sensors write everything, so the smallest change plays different music.${later}`;
  renderTransport();
}
detOn.addEventListener('change', applyDeterministic);
detSeed.addEventListener('change', applyDeterministic);
applyDeterministic();

// A replay starts over at Play, so a recording always plays the same piece.
player.beforeStart = (origin) => {
  const replay = sources.get('replay');
  if (replay instanceof ReplayWebSource && sources.isOn('replay')) replay.rewind(origin);
};

// Modes: Play and Sensor lab ------------------------------------------------
const lab = new LabView(
  player.hub,
  () => player.router,
  (id) => player.setSolo(id),
  {
    select: $<HTMLSelectElement>('lab-channel'),
    about: $('lab-about'),
    rawNow: $('lab-raw-now'),
    rawTitle: $('lab-raw-title'),
    rawCanvas: $<HTMLCanvasElement>('lab-raw'),
    procCanvas: $<HTMLCanvasElement>('lab-proc'),
    time: $('lab-time'),
    level: $('lab-level'),
    normalized: $('lab-norm'),
    activity: $('lab-activity'),
    onsets: $('lab-onsets'),
    trend: $('lab-trend'),
    range: $('lab-range'),
    rate: $('lab-rate'),
    timescale: $('lab-scale'),
    drives: $('lab-drives'),
    solo: $<HTMLInputElement>('lab-solo'),
    empty: $('lab-empty'),
    body: $('lab-body'),
  },
  nowSeconds,
);

const flow = new FlowView(
  {
    hub: player.hub,
    router: () => player.router,
    view: () => player.view(),
    trackAnalyser: (slot) => player.trackAnalyser(slot),
    busAnalyser: (bus) => player.busAnalyser(bus),
    masterAnalyser: () => player.analyserNode,
    fxNow: () => player.fxNow(),
    isMuted: (slot) => player.isMuted(slot),
    now: nowSeconds,
    sourceName: (source) => SOURCE_NAMES[source ?? ''] ?? source ?? 'Other',
  },
  {
    root: $('flow'),
    sensors: $('flow-sensors'),
    mods: $('flow-mods'),
    tracks: $('flow-tracks'),
    buses: $('flow-buses'),
    svg: $('flow-links') as unknown as SVGSVGElement,
    tip: $('flow-tip'),
    pick: $<HTMLSelectElement>('flow-pick'),
    strong: $<HTMLInputElement>('flow-strong'),
    pause: $<HTMLButtonElement>('flow-pause'),
    empty: $('flow-empty'),
    table: $('flow-table'),
  },
);

type Mode = 'play' | 'flow' | 'lab';
function setMode(mode: Mode): void {
  for (const m of ['play', 'flow', 'lab'] as const) {
    $(`mode-${m}`).setAttribute('aria-pressed', String(mode === m));
    document.querySelectorAll<HTMLElement>(`.${m}-only`).forEach((el) => (el.hidden = mode !== m));
  }
  document.querySelector('.app')?.classList.toggle('is-flow', mode === 'flow');
  lab.setActive(mode === 'lab');
  flow.setActive(mode === 'flow');
}
$('mode-play').addEventListener('click', () => setMode('play'));
$('mode-flow').addEventListener('click', () => setMode('flow'));
$('mode-lab').addEventListener('click', () => setMode('lab'));

// Live view -----------------------------------------------------------------
const scope = new Scope($<HTMLCanvasElement>('scope'));
const dials = new DialsView($('dials'));
const sensorsView = new SensorsView($('sensors'), $('sensors-empty'));
const nowKey = $('now-key');
const nowChord = $('now-chord');
const nowPos = $('now-pos');
const tracksView = new TracksView($('tracks'), $('tracks-empty'), {
  analyser: (slot) => player.trackAnalyser(slot),
  isMuted: (slot) => player.isMuted(slot),
  setMuted: (slot, muted) => player.setMuted(slot, muted),
  fxNow: () => player.fxNow(),
});
const channelLabel = (id: string) => player.hub.get(id)?.desc.label ?? id;
const matrixView = new MatrixView($('matrix'), $('matrix-empty'), channelLabel);
const genomeHashLabel = $('g-hash-label');
const genomeChangeLabel = $('g-change-label');
const tracksNote = $('tracks-note');
const genome = {
  section: $('g-section'),
  hash: $('g-hash'),
  key: $('g-key'),
  change: $('g-change'),
};
const KEY_SOURCE = {
  place: 'from the place',
  sensors: 'from the sensors',
  colour: 'moved by colour',
  seed: 'from the seed',
};
const REBUILD = {
  start: 'start',
  section: 'new section',
  scene: 'new scene',
  style: 'new style',
  resume: 'sensors back',
};

function renderGenome(view: EngineView | undefined): void {
  const snap = view?.snapshot;
  if (!view || !snap || snap.waiting) {
    for (const el of Object.values(genome)) el.textContent = '–';
    return;
  }
  genome.section.textContent = `${snap.section + 1} · phrase ${snap.phrase + 1}`;
  genomeHashLabel.textContent = snap.seed !== undefined ? 'Seed' : 'Genome';
  genome.hash.textContent = snap.seed !== undefined ? String(snap.seed) : `#${snap.genome}`;
  genome.key.textContent = `${snap.keyName}, ${KEY_SOURCE[view.keySource]}`;
  tracksNote.textContent =
    snap.seed !== undefined ? 'written by the seed' : 'written by the sensors';
  // Deterministic mode rewrites only on section lines; show the notes you played instead.
  genomeChangeLabel.textContent = snap.seed !== undefined ? 'Your notes' : 'Last rewrite';
  const r = view.rebuild;
  genome.change.textContent =
    snap.seed !== undefined
      ? String(player.eventNotes)
      : `${REBUILD[r.reason]}${r.channel ? `: ${r.channel}` : ''}, bar ${Math.floor(r.step / 16) + 1}`;
}

let lastTracks = 0;
let lastWaiting: boolean | undefined;

let shownVersion = -1;
let shownRouter: Router | undefined;
let lastFrame = performance.now();
let lastUi = 0;
let lastScope = 0;

function frame(t: number): void {
  const dt = Math.min(0.25, (t - lastFrame) / 1000);
  lastFrame = t;
  player.idleUpdate(dt);

  lab.frame();
  flow.frame(t);

  const analyser = player.analyserNode;
  if (analyser || t - lastScope > 500) {
    scope.draw(analyser);
    lastScope = t;
  }

  if (t - lastUi > 66) {
    lastUi = t;
    const channels = player.hub.list();
    if (player.hub.version !== shownVersion || player.router !== shownRouter) {
      shownVersion = player.hub.version;
      shownRouter = player.router;
      sensorsView.rebuild(channels, player.router);
      dials.updateSources(player.router, (id) => player.hub.get(id)?.desc.label ?? id);
      renderTransport();
    }
    sensorsView.update(channels, nowSeconds());
    dials.update(player.router.macros);
    renderRecorder();

    const view = player.view();
    const snap = view?.snapshot;
    const live = snap && !snap.waiting;
    nowKey.textContent = !snap ? 'Stopped' : live ? snap.keyName : 'Waiting';
    nowChord.textContent = live ? `${snap.chordRoman} · ${snap.chordName}` : '–';
    nowPos.textContent = live ? `${snap.bar + 1}.${snap.beat + 1}` : '–';
    renderGenome(view);
    matrixView.update(view);
    if (snap?.waiting !== lastWaiting) {
      lastWaiting = snap?.waiting;
      renderTransport();
    }
  }

  // Track grids and scopes: about 30 times a second, only in Play mode.
  if (t - lastTracks > 33 && !$('tracks').closest('[hidden]')) {
    lastTracks = t;
    tracksView.update(player.view(), true);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

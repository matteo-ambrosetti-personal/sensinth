import './style.css';
import {
  DEFAULT_LOOP_BARS,
  LOOP_BARS,
  REPEAT_MODES,
  SENSOR_MODES,
  STYLES,
  SensorRecorder,
  type RepeatMode,
  type SensorMode,
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
import { KeyboardSource } from './sensors/keyboard';
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
import { AreasView } from './ui/areas';
import { BannerView } from './ui/banner';
import { DialsView } from './ui/dials';
import { DriftChart } from './ui/drift';
import { FlowView } from './ui/flow/flow';
import { LabView, SOURCE_NAMES } from './ui/lab';
import { ChangesView } from './ui/changes';
import { InputMapEditor } from './ui/inputMap';
import { MatrixView } from './ui/matrix';
import { Scope } from './ui/scope';
import { SensorsView } from './ui/sensors';
import { SourcesView } from './ui/sources';
import { Stage } from './ui/stage/stage';
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

/** Each cartridge's label colour. */
const CART_COLORS: Record<string, string> = {
  free: 'var(--ink)',
  chiptune: 'var(--t4)',
  ambient: 'var(--t6)',
  lofi: 'var(--t2)',
  hiphop: 'var(--t1)',
  jazz: 'var(--t7)',
  blues: '#4a90f0',
  techno: 'var(--t5)',
  synthwave: '#ff60c0',
  dnb: 'var(--t3)',
  minimal: '#c8c8d8',
};

function renderStyles(): void {
  stylesEl.replaceChildren();
  for (const s of STYLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-chip';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(s.id === style.id));
    btn.style.setProperty('--cart', CART_COLORS[s.id] ?? 'var(--line)');
    btn.textContent = s.name;
    btn.addEventListener('click', () => selectStyle(s));
    stylesEl.append(btn);
  }
  styleDesc.textContent = `${style.description} Suggested tempo: ${style.defaultTempo} BPM.`;
}

/** A new style brings its suggested tempo; the slider and Tap still change it after. */
function selectStyle(s: Style): void {
  style = s;
  player.setStyle(s);
  prefs.styleId = s.id;
  savePrefs(prefs);
  setBpm(s.defaultTempo);
  renderStyles();
}
renderStyles();

// Sources -------------------------------------------------------------------
const locationSource = new LocationSource();
player.keyHint = () => locationSource.keyHint();
const keyboard = new KeyboardSource();
// While a deterministic song plays, keys such as Space and the arrows play it, not the page.
keyboard.capture = () => player.playingDeterministic;
const sources = new SourceManager(player.hub, [
  new MotionSource(),
  new PointerSource(),
  keyboard,
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
sourcesView.render();

/**
 * First visit: the Android app starts with motion and its native sensors,
 * the Mac app with the pointer, keyboard and Mac sensors, phone browsers with
 * motion, computers with the pointer and keyboard.
 */
function defaultSources(): Record<string, boolean> {
  if (isNativeApp()) return { motion: true, device: true, native: true };
  if (isMacApp()) return { pointer: true, keyboard: true, device: true, mac: true };
  const touch = window.matchMedia('(pointer: coarse)').matches;
  return touch ? { motion: true, device: true } : { pointer: true, keyboard: true, device: true };
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
// The keyboard used to be part of the pointer source: keep it on for whoever had that on.
if (!('keyboard' in prefs.sources)) prefs.sources.keyboard = prefs.sources.pointer ?? false;
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
const restartBtn = $<HTMLButtonElement>('restart');
const hint = $('hint');

/** No sensor, no music: Play needs at least one source switched on (deterministic mode aside). */
function anySourceOn(): boolean {
  return sources.sources.some((s) => sources.isOn(s.id));
}

function renderTransport(): void {
  const playing = player.playing || player.isRestarting;
  const seeded = player.deterministic;
  const canPlay = playing || anySourceOn() || seeded !== undefined;
  playBtn.setAttribute('aria-pressed', String(playing));
  playBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  playBtn.disabled = !canPlay;
  restartBtn.disabled = !playing;
  const channels = player.hub.list();
  const playingSeed = player.view()?.snapshot.seed;
  const tilt =
    isMacApp() && !sources.isOn('macMotion') ? ' Turn on Mac motion to play with tilt.' : '';
  if (!canPlay) hint.textContent = 'Turn on at least one sensor source. No sensor, no music.';
  else if (!playing && seeded)
    hint.textContent = `Seed ${seeded.seed}: a song that loops until you change something.${tilt}`;
  else if (!playing)
    hint.textContent = `You set tempo and style. The sensors write the rest.${tilt}`;
  else if (playingSeed !== undefined)
    hint.textContent = `Seed ${playingSeed}. Each key and sensor changes the song its own way, from the next bar: the box on the screen says what and when. With no change it loops.`;
  else if (player.view()?.snapshot.waiting ?? true)
    hint.textContent = 'Waiting for a sensor… the music starts on the next bar after one sends.';
  else if (channels.some((c) => c.desc.source === 'phone'))
    hint.textContent = 'Shake, tilt, clap or point the camera somewhere else. The music follows.';
  else hint.textContent = 'Playing. Every track below is written by the sensors.';
}

// A menu picked with the mouse or a finger hands the keys back to the music; one stepped
// through with the keyboard keeps the focus, so it can go on stepping.
let pointedAt: Node | null = null;
document.addEventListener('pointerdown', (e) => (pointedAt = e.target as Node), true);
document.addEventListener('keydown', () => (pointedAt = null), true);
document.addEventListener(
  'change',
  (e) => {
    const el = e.target;
    if (el instanceof HTMLSelectElement && pointedAt && el.contains(pointedAt)) el.blur();
    pointedAt = null;
  },
  true,
);

// Play becomes available as soon as a source is switched on.
sources.onChange = () => {
  sourcesView.render();
  renderTransport();
};

playBtn.addEventListener('click', async (event) => {
  // After a click, let Space and Enter reach the music rather than this button.
  if (event.detail > 0) playBtn.blur();
  // Stop, also while Start over is still starting the audio again.
  if (player.playing || player.isRestarting) player.stop();
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

// Start over: a new piece from the top, or the seed's own song again.
restartBtn.addEventListener('click', async (event) => {
  if (event.detail > 0) restartBtn.blur();
  if (!player.playing) return;
  try {
    await player.restart();
  } catch (err) {
    hint.textContent = `Audio could not start: ${(err as Error).message}`;
  }
  renderTransport();
});

// Stop in the Android app's notification stops the music here too.
player.background.onStopRequested = () => {
  if (player.playing) player.stop();
  renderTransport();
};
renderTransport();

// Deterministic mode ---------------------------------------------------------
const detOn = $<HTMLInputElement>('det-on');
const detSeed = $<HTMLInputElement>('det-seed');
const detLoop = $<HTMLSelectElement>('det-loop');
const detRepeat = $<HTMLSelectElement>('det-repeat');
const detSensors = $<HTMLSelectElement>('det-sensors');
const detInstruments = $<HTMLSelectElement>('det-instruments');
const detEvolve = $<HTMLInputElement>('det-evolve');
const detDesc = $('det-desc');
const detMap = $<HTMLDetailsElement>('det-map');
const detMapCount = $('det-map-count');
const inputMap = new InputMapEditor($('det-map-rows'), $<HTMLButtonElement>('det-map-reset'));
detOn.checked = prefs.deterministic ?? false;
detSeed.value = String(prefs.seed ?? 42);
detLoop.value = String(
  LOOP_BARS.includes(prefs.loopBars ?? 0) ? prefs.loopBars : DEFAULT_LOOP_BARS,
);
detRepeat.value = REPEAT_MODES.includes(prefs.repeat as RepeatMode)
  ? (prefs.repeat as string)
  : 'toggle';
detSensors.value = SENSOR_MODES.includes(prefs.sensors as SensorMode)
  ? (prefs.sensors as string)
  : 'zones';
detInstruments.value = prefs.instruments === false ? 'fixed' : 'free';
detEvolve.checked = prefs.evolve ?? false;

function readSeed(): number {
  const v = Math.floor(Number(detSeed.value));
  return Number.isFinite(v) && v >= 0 ? Math.min(v, 0xffffffff) : 42;
}

const REPEAT_TEXT: Record<RepeatMode, string> = {
  toggle: 'Pressing a key again undoes it.',
  accumulate: 'Pressing a key again does it once more.',
  once: 'Only the first press of each key counts.',
};
const SENSOR_TEXT: Record<SensorMode, string> = {
  zones:
    'Sensors act by zone, counted from where they were at Play: back in a zone, back to its song.',
  steps: 'Sensors act in steps: each zone crossed counts as a press.',
  off: 'Sensors change nothing: only keys and presses edit the song.',
};

/** Applies the settings; `remap` redraws the input map (its defaults changed). */
function applyDeterministic(remap = true): void {
  const seed = readSeed();
  const loopBars = Number(detLoop.value);
  const repeat = detRepeat.value as RepeatMode;
  const sensors = detSensors.value as SensorMode;
  const instruments = detInstruments.value !== 'fixed';
  const evolve = detEvolve.checked;
  if (remap) inputMap.set(prefs.inputMap ?? {}, { repeat, sensors, instruments });
  const mapping = inputMap.map;
  detSeed.value = String(seed);
  player.setDeterministic(
    detOn.checked ? { seed, loopBars, repeat, sensors, instruments, mapping, evolve } : undefined,
  );
  for (const el of [detSeed, detLoop, detRepeat, detSensors, detInstruments, detEvolve]) {
    el.disabled = !detOn.checked;
  }
  detMap.hidden = !detOn.checked;
  const changed = inputMap.changed;
  detMapCount.textContent = changed > 0 ? `${changed} changed` : '';
  Object.assign(prefs, {
    deterministic: detOn.checked,
    seed,
    loopBars,
    repeat,
    sensors,
    instruments,
    evolve,
    inputMap: mapping,
  });
  savePrefs(prefs);
  const later = player.playing ? ' Takes effect when you start over or at the next Play.' : '';
  const kept = instruments ? '' : ' The instruments stay the seed’s.';
  const grows = evolve
    ? ' Evolve: every 16 bars or so it grows a little, the same way every time.'
    : '';
  const own =
    changed > 0
      ? ` ${changed === 1 ? 'One input does' : `${changed} inputs do`} what you chose.`
      : '';
  detDesc.textContent = detOn.checked
    ? `The seed writes a ${loopBars}-bar song that loops until something changes. Every key and sensor changes it its own way, the same way every time. ${REPEAT_TEXT[repeat]} ${SENSOR_TEXT[sensors]}${kept}${grows}${own}${later}`
    : `Off: the sensors write everything, so the smallest change plays different music.${later}`;
  renderTransport();
}
for (const el of [detOn, detSeed, detLoop, detRepeat, detSensors, detInstruments, detEvolve]) {
  el.addEventListener('change', () => {
    applyDeterministic();
  });
}
inputMap.onChange = (map) => {
  prefs.inputMap = map;
  applyDeterministic(false);
};
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
let mode: Mode = 'play';
function setMode(next: Mode): void {
  mode = next;
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
const changesView = new ChangesView(
  $('song-panel'),
  $('song-loop'),
  $('pending'),
  $('changes'),
  $('changes-empty'),
  $('zones'),
  () => mode === 'play',
);
/** A source's name by its id (what the partition calls a group). */
const groupName = (group: string) => sources.get(group)?.label ?? SOURCE_NAMES[group] ?? group;
const areasView = new AreasView($('areas'), $('areas-note'), groupName);
const driftChart = new DriftChart($<HTMLCanvasElement>('drift'), $('drift-now'));
const banner = new BannerView($('banner'));
const stage = new Stage($<HTMLCanvasElement>('stage'));
const genomeSectionLabel = $('g-section-label');
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
const REBUILD: Record<EngineView['rebuild']['reason'], string> = {
  start: 'start',
  section: 'new section',
  scene: 'new scene',
  style: 'new style',
  resume: 'sensors back',
  edit: 'your edit',
  evolve: 'evolved',
};

function renderGenome(view: EngineView | undefined): void {
  const snap = view?.snapshot;
  if (!view || !snap || snap.waiting) {
    for (const el of Object.values(genome)) el.textContent = '–';
    // Stopped: the labels say what the next piece will show.
    const seeded = player.deterministic !== undefined;
    genomeSectionLabel.textContent = seeded ? 'Loop' : 'Section';
    genomeHashLabel.textContent = seeded ? 'Seed' : 'Genome';
    genomeChangeLabel.textContent = seeded ? 'Version' : 'Last rewrite';
    tracksNote.textContent = seeded ? 'written by the seed' : 'written by the sensors';
    return;
  }
  const song = view.song;
  genomeSectionLabel.textContent = song ? 'Loop' : 'Section';
  genome.section.textContent = song
    ? `bar ${song.loopBar + 1} of ${song.loopBars}`
    : `${snap.section + 1} · phrase ${snap.phrase + 1}`;
  genomeHashLabel.textContent = snap.seed !== undefined ? 'Seed' : 'Genome';
  genome.hash.textContent = snap.seed !== undefined ? String(snap.seed) : `#${snap.genome}`;
  genome.key.textContent = `${snap.keyName}, ${KEY_SOURCE[view.keySource]}`;
  tracksNote.textContent =
    snap.seed !== undefined ? 'written by the seed' : 'written by the sensors';
  // Deterministic mode: the song version and how many changes made it.
  genomeChangeLabel.textContent = song ? 'Version' : 'Last rewrite';
  const r = view.rebuild;
  const changes = song?.edits.length ?? 0;
  genome.change.textContent = song
    ? song.version === 'base'
      ? 'the seed’s own'
      : `${song.version} · ${changes} change${changes === 1 ? '' : 's'}`
    : `${REBUILD[r.reason]}${r.channel ? `: ${r.channel}` : ''}, bar ${Math.floor(r.step / 16) + 1}`;
}

let lastTracks = 0;
let lastWaiting: boolean | undefined;

let shownVersion = -1;
let shownRouter: Router | undefined;
let shownPartition: EngineView['partition'] | undefined;
let lastBanner = 0;
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
    const partition = player.partition();
    if (
      player.hub.version !== shownVersion ||
      player.router !== shownRouter ||
      partition !== shownPartition
    ) {
      shownVersion = player.hub.version;
      shownRouter = player.router;
      shownPartition = partition;
      sensorsView.rebuild(channels, player.router, partition);
      dials.updateSources(player.router, (id) => player.hub.get(id)?.desc.label ?? id);
      areasView.update(partition);
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
    changesView.update(view);
    matrixView.update(view);
    driftChart.update(view);
    if (snap?.waiting !== lastWaiting) {
      lastWaiting = snap?.waiting;
      renderTransport();
    }
  }

  // The screen, the edit banner and what lands: about 30 times a second, on the Play page.
  if (mode === 'play') {
    stage.frame(
      {
        view: player.view(),
        events: player.events(),
        fx: player.fxNow(),
        playing: player.playing,
        styleId: style.id,
        styleName: style.name,
        bpm,
        isMuted: (slot) => player.isMuted(slot),
      },
      t,
    );
  }
  if (t - lastBanner > 33) {
    lastBanner = t;
    const landed = banner.update(player.view(), t);
    for (const slot of landed?.slots ?? []) tracksView.flash(slot);
    if (landed) stage.react(landed.slots);
  }

  // Track grids and scopes: about 30 times a second, only in Play mode.
  if (t - lastTracks > 33 && mode === 'play') {
    lastTracks = t;
    tracksView.update(player.view(), true);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

import './style.css';
import { STYLES, getStyle, type Router, type Style } from '@sensinth/core';
import { loadFonts } from './fonts';
import { Player } from './player';
import { loadPrefs, savePrefs, type Prefs } from './prefs';
import { SimulatedWebSource } from './sensors/simulated';
import { nowSeconds } from './sensors/source';
import { DialsView } from './ui/dials';
import { Scope } from './ui/scope';
import { SensorsView } from './ui/sensors';

loadFonts();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Styles from the roadmap, shown so the picker reflects what is coming. */
const UPCOMING = ['Ambient', 'Lo-fi'];

const prefs: Prefs = loadPrefs();
let style: Style = getStyle(prefs.styleId ?? '') ?? (STYLES[0] as Style);
let bpm = clampBpm(prefs.bpm ?? style.defaultTempo);
const player = new Player(style, bpm);
const sim = new SimulatedWebSource();

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
  for (const name of UPCOMING) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-chip';
    btn.disabled = true;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', 'false');
    btn.innerHTML = `${name} <small>soon</small>`;
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

// Sensors -------------------------------------------------------------------
const simToggle = $<HTMLInputElement>('sim-toggle');
simToggle.checked = prefs.simulated ?? true;

async function applySimulated(): Promise<void> {
  if (simToggle.checked) await player.addSource(sim);
  else player.removeSource(sim.id);
  prefs.simulated = simToggle.checked;
  savePrefs(prefs);
}
simToggle.addEventListener('change', () => void applySimulated());
void applySimulated();

// Transport -----------------------------------------------------------------
const playBtn = $<HTMLButtonElement>('play');
const hint = $('hint');

function renderTransport(): void {
  const playing = player.playing;
  playBtn.setAttribute('aria-pressed', String(playing));
  playBtn.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  if (!playing) hint.textContent = 'You set tempo and style. The sensors write the rest.';
  else if (player.hub.list().length === 0)
    hint.textContent = 'No sensors on: the dials rest at their defaults.';
  else hint.textContent = 'Playing. Watch the dials follow the sensors.';
}

playBtn.addEventListener('click', async () => {
  if (player.playing) player.stop();
  else {
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

// Live view -----------------------------------------------------------------
const scope = new Scope($<HTMLCanvasElement>('scope'));
const dials = new DialsView($('dials'));
const sensorsView = new SensorsView($('sensors'), $('sensors-empty'));
const nowKey = $('now-key');
const nowChord = $('now-chord');
const nowPos = $('now-pos');

let shownVersion = -1;
let shownRouter: Router | undefined;
let lastFrame = performance.now();
let lastUi = 0;
let lastScope = 0;

function frame(t: number): void {
  const dt = Math.min(0.25, (t - lastFrame) / 1000);
  lastFrame = t;
  player.idleUpdate(dt);

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

    const snap = player.snapshot();
    nowKey.textContent = snap ? snap.keyName : 'Stopped';
    nowChord.textContent = snap ? `${snap.chordRoman} · ${snap.chordName}` : '–';
    nowPos.textContent = snap ? `${snap.bar + 1}.${snap.beat + 1}` : '–';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

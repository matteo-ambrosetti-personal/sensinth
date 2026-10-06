import {
  EFFECT_CHOICES,
  INPUT_ROWS,
  INSTRUMENT_EFFECTS,
  TRACK_EFFECTS,
  effectLabel,
  effectName,
  type Effect,
  type InputMap,
  type InputRow,
  type InputRule,
  type RepeatMode,
  type SensorMode,
  type Target,
} from '@sensinth/core';

/** The settings an input falls back to. */
export interface MapDefaults {
  repeat: RepeatMode;
  sensors: SensorMode;
  /** False while the instruments stay the seed's. */
  instruments: boolean;
}

const SECTIONS: Record<InputRow['section'], string> = {
  keys: 'Keys',
  controllers: 'MIDI and controllers',
  onsets: 'Sudden changes',
  sensors: 'Sensors',
};

const REPEAT_NAMES: Record<RepeatMode, string> = {
  toggle: 'Toggles',
  accumulate: 'Adds up',
  once: 'Counts once',
};

const STEP_NAMES: Record<RepeatMode, string> = {
  toggle: 'Steps that toggle',
  accumulate: 'Steps that add up',
  once: 'One step only',
};

const TARGETS: readonly [Target, string][] = [
  ['drums', 'on the drums'],
  ['melodic', 'on the melody'],
  ['lead', 'on the lead'],
  ['rhythmic', 'on every pattern'],
  ['all', 'on every track'],
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n): [Target, string] => [n, `on track ${n}`]),
];

const choiceValue = (e: Effect) => (e.dir ? `${e.id}:${e.dir}` : e.id);

function choiceOf(value: string): Effect | undefined {
  return EFFECT_CHOICES.find((e) => choiceValue(e) === value);
}

/** What a row does by default, as its menu says it. */
function defaultLabel(row: InputRow): string {
  if (!row.effect) return 'Each its own';
  if (row.perTrack) return effectLabel({ ...row.effect, target: 1 }).replace('T1', 'track n');
  return effectLabel(row.effect);
}

function option(value: string, text: string, disabled = false): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  o.disabled = disabled;
  return o;
}

/**
 * The "What each input does" editor: for every key, group of keys, sudden
 * change and sensor, its effect (or another, or nothing) and how it repeats.
 * Rows you leave at Default follow the settings above.
 */
export class InputMapEditor {
  onChange: (map: InputMap) => void = () => {};
  private rules: Record<string, InputRule> = {};
  private defaults: MapDefaults = { repeat: 'toggle', sensors: 'zones', instruments: true };

  constructor(
    private readonly root: HTMLElement,
    reset: HTMLButtonElement,
  ) {
    reset.addEventListener('click', () => {
      this.rules = {};
      this.render();
      this.onChange(this.map);
    });
  }

  get map(): InputMap {
    return { ...this.rules };
  }

  /** How many inputs differ from their defaults. */
  get changed(): number {
    return Object.keys(this.rules).length;
  }

  set(map: InputMap, defaults: MapDefaults): void {
    // Rules saved by an older version may name rows or effects that no longer exist.
    const known = new Set(INPUT_ROWS.map((r) => r.id));
    const effects = new Set(EFFECT_CHOICES.map((e) => e.id));
    this.rules = Object.fromEntries(
      Object.entries(map).filter(
        ([id, rule]) =>
          known.has(id) &&
          (rule.effect === undefined || rule.effect === 'none' || effects.has(rule.effect.id)),
      ),
    );
    this.defaults = defaults;
    this.render();
  }

  private render(): void {
    const groups: HTMLElement[] = [];
    for (const [section, title] of Object.entries(SECTIONS)) {
      const group = document.createElement('div');
      group.className = 'map-group';
      group.setAttribute('role', 'group');
      const h = document.createElement('h3');
      h.className = 'map-title';
      h.textContent = title;
      h.id = `map-${section}`;
      group.setAttribute('aria-labelledby', h.id);
      group.append(h);
      for (const row of INPUT_ROWS) if (row.section === section) group.append(this.renderRow(row));
      groups.push(group);
    }
    this.root.replaceChildren(...groups);
  }

  private renderRow(row: InputRow): HTMLElement {
    const rule = this.rules[row.id] ?? {};
    const el = document.createElement('div');
    el.className = 'map-row';
    el.dataset.row = row.id;
    el.classList.toggle('is-changed', this.rules[row.id] !== undefined);

    const name = document.createElement('span');
    name.className = 'map-name';
    name.textContent = row.name;

    const effect = document.createElement('select');
    effect.className = 'map-effect';
    effect.setAttribute('aria-label', `${row.name}: what it does`);
    effect.append(option('', `${defaultLabel(row)} (default)`), option('none', 'Nothing'));
    for (const e of EFFECT_CHOICES) {
      if (row.perTrack && !TRACK_EFFECTS.has(e.id)) continue;
      const fixed = !this.defaults.instruments && INSTRUMENT_EFFECTS.has(e.id);
      const text = row.perTrack ? `${effectName(e)} track n` : effectName(e);
      effect.append(option(choiceValue(e), fixed ? `${text} (instruments stay)` : text, fixed));
    }
    effect.value = rule.effect === 'none' ? 'none' : rule.effect ? choiceValue(rule.effect) : '';

    const target = document.createElement('select');
    target.className = 'map-target';
    target.setAttribute('aria-label', `${row.name}: on which tracks`);
    for (const [t, text] of TARGETS) target.append(option(String(t), text));
    const chosen = rule.effect && rule.effect !== 'none' ? rule.effect : undefined;
    target.value = String(chosen?.target ?? 'all');
    target.hidden = !chosen || !!row.perTrack || !TRACK_EFFECTS.has(chosen.id);

    const again = document.createElement('select');
    again.className = 'map-again';
    again.setAttribute('aria-label', `${row.name}: again`);
    const { repeat, sensors } = this.defaults;
    if (row.continuous) {
      const now = sensors === 'zones' ? 'By zone' : STEP_NAMES[repeat];
      again.append(option('', `${now} (default)`), option('zones', 'By zone'));
      for (const r of ['toggle', 'accumulate', 'once'] as const) {
        again.append(option(`steps:${r}`, STEP_NAMES[r]));
      }
      again.value =
        rule.sensors === 'zones'
          ? 'zones'
          : rule.sensors === 'steps'
            ? `steps:${rule.repeat ?? repeat}`
            : '';
    } else {
      again.append(option('', `${REPEAT_NAMES[repeat]} (default)`));
      for (const r of ['toggle', 'accumulate', 'once'] as const) {
        again.append(option(r, REPEAT_NAMES[r]));
      }
      again.value = rule.repeat ?? '';
    }

    const update = () => {
      const next: InputRule = {};
      if (effect.value === 'none') next.effect = 'none';
      else if (effect.value) {
        const e = choiceOf(effect.value);
        if (e) {
          const wantsTarget = !row.perTrack && TRACK_EFFECTS.has(e.id);
          if (wantsTarget && target.hidden) {
            // Newly picked: start from the tracks the input already worked on.
            const own = row.effect?.target;
            target.value = String(own ?? 'all');
          }
          target.hidden = !wantsTarget;
          const t = TARGETS.find(([v]) => String(v) === target.value)?.[0];
          next.effect = wantsTarget && t !== undefined ? { ...e, target: t } : e;
        }
      } else target.hidden = true;
      if (row.continuous) {
        if (again.value === 'zones') next.sensors = 'zones';
        else if (again.value.startsWith('steps:')) {
          next.sensors = 'steps';
          next.repeat = again.value.slice(6) as RepeatMode;
        }
      } else if (again.value) next.repeat = again.value as RepeatMode;
      if (Object.keys(next).length > 0) this.rules[row.id] = next;
      else delete this.rules[row.id];
      el.classList.toggle('is-changed', this.rules[row.id] !== undefined);
      this.onChange(this.map);
    };
    for (const s of [effect, target, again]) s.addEventListener('change', update);

    const does = document.createElement('span');
    does.className = 'map-does';
    does.append(effect, target);
    el.append(name, does, again);
    return el;
  }
}

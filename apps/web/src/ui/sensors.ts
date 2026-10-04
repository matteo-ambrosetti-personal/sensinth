import type { ChannelState, Router } from '@sensinth/core';

interface Row {
  li: HTMLLIElement;
  led: HTMLElement;
  value: HTMLElement;
  level: HTMLElement;
  activity: HTMLElement;
}

/** Live list of sensor channels: value, level, activity, onsets and routes. */
export class SensorsView {
  private readonly rows = new Map<string, Row>();

  constructor(
    private readonly list: HTMLElement,
    private readonly empty: HTMLElement,
  ) {}

  /** Rebuilds rows when the channel set changes. */
  rebuild(channels: readonly ChannelState[], router: Router): void {
    this.list.replaceChildren();
    this.rows.clear();
    const { macros, triggers } = router.getRoutes();
    for (const ch of channels) {
      const li = document.createElement('li');
      li.className = 'sensor';
      const name = document.createElement('span');
      name.className = 'sensor-name';
      name.textContent = ch.desc.label;
      li.innerHTML = `
        <span class="led" aria-hidden="true"></span>
        <span class="sensor-name-slot"></span>
        <span class="sensor-value">–</span>
        <div class="sensor-meters">
          <div class="meter" aria-hidden="true"><span></span></div>
          <div class="meter thin" aria-hidden="true"><span></span></div>
        </div>
        <div class="sensor-routes"></div>`;
      li.querySelector('.sensor-name-slot')?.replaceWith(name);
      const routes = li.querySelector('.sensor-routes') as HTMLElement;
      for (const r of macros.filter((m) => m.channelId === ch.desc.id)) {
        routes.append(
          tag(`${r.feature === 'level' ? '' : `${r.feature} `}→ ${r.macro}`, r.auto ? 'auto' : ''),
        );
      }
      for (const t of triggers.filter((m) => m.channelId === ch.desc.id)) {
        routes.append(tag(`onset → ${t.trigger}`, 'trigger'));
      }
      this.list.append(li);
      this.rows.set(ch.desc.id, {
        li,
        led: li.querySelector('.led') as HTMLElement,
        value: li.querySelector('.sensor-value') as HTMLElement,
        level: li.querySelector('.meter:not(.thin) > span') as HTMLElement,
        activity: li.querySelector('.meter.thin > span') as HTMLElement,
      });
    }
    this.empty.hidden = channels.length > 0;
  }

  update(channels: readonly ChannelState[], now: number): void {
    for (const ch of channels) {
      const row = this.rows.get(ch.desc.id);
      if (!row) continue;
      row.value.textContent = Number.isFinite(ch.raw) ? formatValue(ch.raw, ch.desc.unit) : '–';
      row.level.style.transform = `scaleX(${ch.features.level.toFixed(3)})`;
      row.activity.style.transform = `scaleX(${ch.features.activity.toFixed(3)})`;
      row.led.classList.toggle('on', now - ch.lastOnsetT < 0.15);
      row.li.style.opacity = ch.stale ? '0.5' : '';
    }
  }
}

function tag(text: string, kind: string): HTMLElement {
  const el = document.createElement('span');
  el.className = `route ${kind}`.trim();
  el.textContent = text;
  return el;
}

function formatValue(v: number, unit?: string): string {
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

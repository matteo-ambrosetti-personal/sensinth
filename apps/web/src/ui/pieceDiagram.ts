import {
  DOMAINS,
  DOMAIN_INFO,
  SECTION_INFO,
  sensorShares,
  type Domain,
  type PieceLog,
  type SectionKind,
  type SensorTrace,
} from '@sensinth/core';

/** What the diagram needs to know about a piece beside its record. */
export interface DiagramPiece {
  number: number;
  /** When it started, ms since the epoch. */
  id: number;
  bpm: number;
  seconds: number;
  complete: boolean;
  log: PieceLog;
}

/** The diagram's own colours: it is a file of its own, so it carries them. */
const C = {
  bg: '#0b0805',
  panel: '#15100a',
  ink: '#f3dcb4',
  muted: '#a98f66',
  line: 'rgba(255,179,71,0.22)',
  amber: '#ffb347',
};
export const DOMAIN_COLORS: Record<Domain, string> = {
  rhythm: '#e07a5f',
  harmony: '#e9d16c',
  sound: '#6fb3b8',
  space: '#c48fc0',
  motion: '#8fbf7f',
};
const SECTION_COLORS: Record<SectionKind, string> = {
  intro: '#6b5a3c',
  riff: '#c98a3a',
  voice: '#d9b64a',
  solo: '#e07a5f',
  break: '#5f8f96',
  outro: '#6b5a3c',
};
const MARKS: Record<string, { glyph: string; color: string; label: string }> = {
  fx: { glyph: '▼', color: '#c48fc0', label: 'fired an effect' },
  accent: { glyph: '•', color: '#e07a5f', label: 'added an accent' },
  fill: { glyph: '■', color: '#e07a5f', label: 'asked for a fill' },
  scene: { glyph: '★', color: '#ffffff', label: 'changed the scene' },
  section: { glyph: '◆', color: '#ffb347', label: 'chose the next section' },
};

const W = 1120;
const LEFT = 190;
const RIGHT = 250;
const ROW = 64;
const TOP = 132;

function esc(text: string): string {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** What a sensor did, in a sentence: its domains by share, then its marks by kind. */
export function sensorSummary(s: SensorTrace): string {
  const sum = DOMAINS.reduce((a, d) => a + s.total[d], 0);
  const parts = DOMAINS.map((d) => ({ d, share: sum > 0 ? s.total[d] / sum : 0 }))
    .filter((x) => x.share >= 0.08)
    .sort((a, b) => b.share - a.share)
    .slice(0, 3)
    .map((x) => `${DOMAIN_INFO[x.d].label.toLowerCase()} ${Math.round(x.share * 100)}%`);
  const count = (what: string) => s.marks.filter((m) => m.what === what).length;
  const did: string[] = [];
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (count('section') > 0) did.push(`chose ${plural(count('section'), 'section', 'sections')}`);
  if (count('scene') > 0) did.push(`${plural(count('scene'), 'new scene', 'new scenes')}`);
  if (count('fx') > 0) did.push(`fired ${plural(count('fx'), 'effect', 'effects')}`);
  if (count('accent') + count('fill') > 0) {
    did.push(plural(count('accent') + count('fill'), 'accent or fill', 'accents and fills'));
  }
  return [parts.join(', '), did.join(', ')].filter(Boolean).join(' · ');
}

/**
 * A piece as a picture: its sections along the top, then a row per sensor
 * with what it moved, bar by bar and by domain, its own reading as a line,
 * and a mark wherever it fired an effect, changed the scene or chose a
 * section. On the right, each sensor's share of the piece. The picture is a
 * complete SVG file with its own colours.
 */
export function pieceDiagram(piece: DiagramPiece): string {
  const { log } = piece;
  const bars = Math.max(1, log.bars);
  const shares = new Map(sensorShares(log).map((s) => [s.id, s.share]));
  const sensors = [...log.sensors].sort(
    (a, b) => (shares.get(b.id) ?? 0) - (shares.get(a.id) ?? 0),
  );
  const plotW = W - LEFT - RIGHT;
  const H = TOP + Math.max(1, sensors.length) * ROW + 78;
  const x = (bar: number) => LEFT + (Math.min(bars, Math.max(0, bar)) / bars) * plotW;
  const barSeconds = piece.seconds > 0 ? piece.seconds / bars : log.barSeconds;
  const out: string[] = [];
  const when = new Date(piece.id);
  const date = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-${String(when.getDate()).padStart(2, '0')} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="'IBM Plex Sans', system-ui, sans-serif" role="img" aria-label="How each sensor contributed to piece ${piece.number}">`,
    `<rect width="${W}" height="${H}" fill="${C.bg}"/>`,
    `<text x="24" y="38" fill="${C.amber}" font-size="22" font-weight="600" font-family="'Chakra Petch', 'IBM Plex Sans', sans-serif">Piece ${piece.number} · ${esc(log.styleName)}</text>`,
    `<text x="24" y="60" fill="${C.ink}" font-size="13">${esc(log.key)} · ${piece.bpm} BPM · ${clock(piece.seconds)} · ${bars} bars${piece.complete ? '' : ' · stopped before the end'} · ${date}</text>`,
    `<text x="${W - 24}" y="38" fill="${C.muted}" font-size="12" text-anchor="end">sensinth — every note here came from these sensors</text>`,
  );

  // Legend.
  let lx = W - 24;
  const legend: string[] = [];
  for (const d of [...DOMAINS].reverse()) {
    const label = DOMAIN_INFO[d].label;
    lx -= label.length * 7 + 8;
    legend.push(`<text x="${lx}" y="60" fill="${C.ink}" font-size="12">${label}</text>`);
    lx -= 16;
    legend.push(
      `<rect x="${lx}" y="50" width="11" height="11" rx="2" fill="${DOMAIN_COLORS[d]}"/>`,
    );
    lx -= 10;
  }
  out.push(...legend);

  // Sections.
  const secY = 78;
  out.push(`<text x="24" y="${secY + 17}" fill="${C.muted}" font-size="12">Form</text>`);
  for (const s of log.sections) {
    const x0 = x(s.startBar);
    const x1 = x(s.startBar + s.bars);
    const w = Math.max(2, x1 - x0 - 2);
    out.push(
      `<rect x="${x0.toFixed(1)}" y="${secY}" width="${w.toFixed(1)}" height="26" rx="3" fill="${SECTION_COLORS[s.kind]}" opacity="0.9"><title>${esc(s.label)}: ${esc(SECTION_INFO[s.kind].description)}${s.chosenBy ? `. Chosen by ${esc(s.chosenBy.label)} (${esc(s.chosenBy.why)})` : ''}</title></rect>`,
    );
    const label = w > s.label.length * 6.4 + 8 ? s.label : w > 34 ? SECTION_INFO[s.kind].label : '';
    if (label) {
      out.push(
        `<text x="${(x0 + 6).toFixed(1)}" y="${secY + 17}" fill="#120c05" font-size="11.5" font-weight="600">${esc(label)}</text>`,
      );
    }
    out.push(
      `<line x1="${x0.toFixed(1)}" y1="${secY + 28}" x2="${x0.toFixed(1)}" y2="${H - 70}" stroke="${C.line}" stroke-dasharray="2 4"/>`,
    );
  }
  // Minutes along the bottom of the form.
  for (let t = 0; t <= piece.seconds + 1; t += 30) {
    const bx = x(t / Math.max(0.01, barSeconds));
    out.push(
      `<line x1="${bx.toFixed(1)}" y1="${secY + 28}" x2="${bx.toFixed(1)}" y2="${secY + 33}" stroke="${C.muted}"/>`,
      `<text x="${bx.toFixed(1)}" y="${secY + 44}" fill="${C.muted}" font-size="10" text-anchor="middle">${clock(t)}</text>`,
    );
  }
  for (const k of log.keys) {
    out.push(
      `<text x="${x(k.bar).toFixed(1)}" y="${secY - 5}" fill="${C.ink}" font-size="10">→ ${esc(k.name)}</text>`,
    );
  }

  // One scale for every row, so a tall row is a sensor that did a lot.
  let peak = 1e-6;
  for (const s of sensors) {
    for (let b = 0; b < bars; b++) {
      let v = 0;
      for (const d of DOMAINS) v += s.influence[d][b] ?? 0;
      if (v > peak) peak = v;
    }
  }

  sensors.forEach((s, i) => {
    const y0 = TOP + i * ROW;
    const h = ROW - 16;
    const base = y0 + h;
    out.push(
      `<rect x="${LEFT}" y="${y0}" width="${plotW}" height="${h}" fill="${C.panel}"/>`,
      `<text x="24" y="${y0 + 18}" fill="${C.ink}" font-size="13" font-weight="600">${esc(s.label)}</text>`,
      `<text x="24" y="${y0 + 34}" fill="${C.muted}" font-size="11">${esc(s.group)}</text>`,
    );
    // Stacked influence, bar by bar.
    const bw = plotW / bars;
    for (let b = 0; b < bars; b++) {
      let acc = 0;
      for (const d of DOMAINS) {
        const v = ((s.influence[d][b] ?? 0) / peak) * h;
        if (v < 0.4) continue;
        out.push(
          `<rect x="${(LEFT + b * bw).toFixed(1)}" y="${(base - acc - v).toFixed(1)}" width="${Math.max(0.6, bw - 0.4).toFixed(1)}" height="${v.toFixed(1)}" fill="${DOMAIN_COLORS[d]}"/>`,
        );
        acc += v;
      }
    }
    // Its own reading over the piece.
    let path = '';
    let pen = false;
    for (let b = 0; b < bars; b++) {
      const v = s.level[b];
      if (v === undefined || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      path += `${pen ? 'L' : 'M'}${(LEFT + (b + 0.5) * bw).toFixed(1)} ${(base - 2 - v * (h - 4)).toFixed(1)}`;
      pen = true;
    }
    if (path)
      out.push(
        `<path d="${path}" fill="none" stroke="${C.ink}" stroke-width="1.2" opacity="0.75"/>`,
      );
    // Its marks. Accents and fills are many: they sit on the floor of the row as small dots.
    for (const m of s.marks) {
      const mark = MARKS[m.what];
      if (!mark) continue;
      const small = m.what === 'accent' || m.what === 'fill';
      out.push(
        `<text x="${x(m.at).toFixed(1)}" y="${small ? base - 1 : y0 + 11}" fill="${mark.color}" font-size="${small ? 8 : 11}" text-anchor="middle">${mark.glyph}<title>${esc(m.label)} (${clock(m.at * barSeconds)})</title></text>`,
      );
    }
    // Its share, and what it did.
    const share = shares.get(s.id) ?? 0;
    const sx = W - RIGHT + 16;
    out.push(
      `<text x="${sx}" y="${y0 + 16}" fill="${C.amber}" font-size="15" font-weight="600">${Math.round(share * 100)}%</text>`,
    );
    const sum = DOMAINS.reduce((a, d) => a + s.total[d], 0);
    let px = sx + 44;
    const full = RIGHT - 84;
    for (const d of DOMAINS) {
      const w = sum > 0 ? (s.total[d] / sum) * full * Math.min(1, share * 3 + 0.25) : 0;
      if (w < 0.5) continue;
      out.push(
        `<rect x="${px.toFixed(1)}" y="${y0 + 5}" width="${w.toFixed(1)}" height="12" fill="${DOMAIN_COLORS[d]}"/>`,
      );
      px += w;
    }
    const words = sensorSummary(s);
    const lines = wrap(words, 38).slice(0, 2);
    lines.forEach((line, j) =>
      out.push(
        `<text x="${sx}" y="${y0 + 33 + j * 13}" fill="${C.muted}" font-size="10.5">${esc(line)}</text>`,
      ),
    );
  });
  if (sensors.length === 0) {
    out.push(
      `<text x="${LEFT}" y="${TOP + 30}" fill="${C.muted}" font-size="13">No sensor was live.</text>`,
    );
  }

  // How to read it.
  const fy = H - 46;
  out.push(
    `<text x="24" y="${fy}" fill="${C.muted}" font-size="11">Bars: how much the sensor moved the music in each bar, by what it moved. Line: its own reading. The sections' kinds were chosen by the dials the sensors drive;</text>`,
    `<text x="24" y="${fy + 14}" fill="${C.muted}" font-size="11">the notes, the instruments, the key and the length come from a hash of every reading.</text>`,
  );
  let mx = 24;
  for (const m of Object.values(MARKS)) {
    out.push(
      `<text x="${mx}" y="${fy + 32}" fill="${m.color}" font-size="11">${m.glyph}</text>`,
      `<text x="${mx + 12}" y="${fy + 32}" fill="${C.ink}" font-size="11">${m.label}</text>`,
    );
    mx += 24 + m.label.length * 6.2;
  }
  out.push('</svg>');
  return out.join('');
}

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

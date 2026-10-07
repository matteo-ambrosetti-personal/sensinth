import type { SourceManager } from '../sensors/manager';

/** One switch per sensor source, with its status or the reason it is unavailable. */
export class SourcesView {
  constructor(
    private readonly list: HTMLElement,
    private readonly manager: SourceManager,
    private readonly onToggle: (id: string, on: boolean) => void,
  ) {}

  render(): void {
    const focused = document.activeElement?.id;
    const wasOpen = this.list.querySelector('details')?.open ?? false;
    this.list.replaceChildren();
    // Sources this device cannot use go in a closed group at the end.
    const usable = this.manager.sources.filter(
      (s) => this.manager.state(s.id).status !== 'unsupported',
    );
    const other = this.manager.sources.filter(
      (s) => this.manager.state(s.id).status === 'unsupported',
    );
    let target: HTMLElement = this.list;
    for (const source of [...usable, ...other]) {
      if (source === other[0]) {
        const item = document.createElement('li');
        item.className = 'sources-more';
        const details = document.createElement('details');
        details.open = wasOpen;
        const summary = document.createElement('summary');
        summary.textContent = `Not on this device (${other.length})`;
        const ul = document.createElement('ul');
        ul.className = 'sources';
        details.append(summary, ul);
        item.append(details);
        this.list.append(item);
        target = ul;
      }
      const state = this.manager.state(source.id);
      const li = document.createElement('li');
      li.className = `source is-${state.status}`;

      const inputId = `src-${source.id}`;
      const label = document.createElement('label');
      label.className = 'switch source-switch';
      label.htmlFor = inputId;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = inputId;
      input.checked = this.manager.isOn(source.id);
      input.disabled = state.status === 'unsupported';
      input.addEventListener('change', () => this.onToggle(source.id, input.checked));
      const track = document.createElement('span');
      track.className = 'switch-track';
      track.setAttribute('aria-hidden', 'true');
      label.append(input, track);

      const text = document.createElement('label');
      text.className = 'source-text';
      text.htmlFor = inputId;
      const name = document.createElement('span');
      name.className = 'source-name';
      name.textContent = source.label;
      const desc = document.createElement('span');
      desc.className = 'source-desc';
      desc.textContent = source.description;
      text.append(name, desc);
      if (state.message) {
        const msg = document.createElement('span');
        msg.className = 'source-msg';
        msg.textContent = state.message;
        text.append(msg);
      }
      li.append(label, text);
      const help = state.status === 'unsupported' ? source.helpLink?.() : undefined;
      if (help) {
        const a = document.createElement('a');
        a.className = 'source-link';
        a.href = help.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = help.label;
        text.append(a);
      }
      if (source.preview && state.status === 'on') li.append(source.preview);
      target.append(li);
    }
    if (focused) document.getElementById(focused)?.focus();
  }
}

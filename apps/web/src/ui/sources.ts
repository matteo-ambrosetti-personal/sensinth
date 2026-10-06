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
    this.list.replaceChildren();
    for (const source of this.manager.sources) {
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
      this.list.append(li);
    }
    if (focused) document.getElementById(focused)?.focus();
  }
}

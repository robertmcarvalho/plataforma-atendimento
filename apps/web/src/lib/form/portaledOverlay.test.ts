import { describe, expect, it } from 'vitest';
import { hasOpenPortaledSelect, isPortaledOverlayTarget } from './portaledOverlay';

describe('isPortaledOverlayTarget', () => {
  it('detecta clique em select portaled', () => {
    const root = document.createElement('div');
    const content = document.createElement('div');
    content.setAttribute('data-slot', 'select-content');
    const item = document.createElement('button');
    content.appendChild(item);
    document.body.appendChild(root);
    document.body.appendChild(content);

    expect(isPortaledOverlayTarget(item)).toBe(true);
    expect(isPortaledOverlayTarget(root)).toBe(false);

    content.remove();
    root.remove();
  });

  it('detecta clique em item do select', () => {
    const item = document.createElement('div');
    item.setAttribute('data-slot', 'select-item');
    const label = document.createElement('span');
    item.appendChild(label);
    document.body.appendChild(item);

    expect(isPortaledOverlayTarget(label)).toBe(true);

    item.remove();
  });

  it('detecta clique em listbox do combobox', () => {
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    const option = document.createElement('button');
    listbox.appendChild(option);
    document.body.appendChild(listbox);

    expect(isPortaledOverlayTarget(option)).toBe(true);

    listbox.remove();
  });
});

describe('hasOpenPortaledSelect', () => {
  it('retorna true quando popup do select está aberto', () => {
    const content = document.createElement('div');
    content.setAttribute('data-slot', 'select-content');
    content.setAttribute('data-open', '');
    document.body.appendChild(content);

    expect(hasOpenPortaledSelect()).toBe(true);

    content.remove();
  });
});

// Small builders for the page's elements.

export function h(tag: string, props: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) element.setAttribute(name, value);
  element.append(...children);
  return element;
}
export function button(label: string, act: () => void, props: Record<string, string> = {}): HTMLButtonElement {
  const element = h('button', { type: 'button', ...props }, label) as HTMLButtonElement;
  element.onclick = act;
  return element;
}
export function checkbox(label: string | Node, checked: boolean, change: (on: boolean) => void, mixed = false): HTMLElement {
  const box = h('input', { type: 'checkbox' }) as HTMLInputElement;
  box.checked = checked;
  box.indeterminate = mixed;
  box.onchange = () => change(box.checked);
  return h('label', { class: 'check' }, box, label);
}
export const link = (label: string, href: string) => h('a', { href, target: '_blank', rel: 'noopener' }, label);
export const count = (n: number, noun: string) => `${n.toLocaleString('en-GB')} ${noun}${n === 1 ? '' : 's'}`;
export const facts = (pairs: [string, Node | string][]) =>
  h('dl', {}, ...pairs.flatMap(([name, value]) => [h('dt', {}, name), h('dd', {}, value)]));
export const bar = (title: string, ...beside: Node[]) => h('div', { class: 'bar' }, h('h2', { title }, title), ...beside);

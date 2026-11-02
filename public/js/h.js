// Tiny DOM builder: h('div', { class: 'x', onClick: fn }, 'text', childElement)
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'readOnly', 'multiple']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(props || {})) {
    if (val === undefined || val === null || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'style' && typeof val === 'object') Object.assign(el.style, val);
    else if (key === 'dataset') Object.assign(el.dataset, val);
    else if (key.length > 2 && key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
    else if (PROPS.has(key)) el[key] = val;
    else el.setAttribute(key, val === true ? '' : String(val));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export const clear = (el, ...children) => { el.replaceChildren(); append(el, children); return el; };

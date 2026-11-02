import { h, clear } from './h.js';

// The tray: a top-view serving tray that sits at the top of the page. Every drink added
// appears as a cup on it, side by side, and flies in from where it was chosen.
export function createTray({ cart, i18n, placeholder, onOpen }) {
  const slots = h('div', { class: 'tray-slots' });
  const total = h('div', { class: 'tray-total' });
  const openBtn = h('button', { class: 'tray-open', type: 'button' });
  const el = h('section', { class: 'tray', role: 'button', tabindex: '0', onClick: () => onOpen() },
    slots, h('div', { class: 'tray-side' }, total, openBtn));
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } });
  let known = new Set();

  function cup(line) {
    return h('div', { class: 'cup', dataset: { key: line.key } },
      h('div', { class: 'cup-in' }, h('img', { src: line.thumb_url || placeholder, alt: i18n.name(line), loading: 'lazy' })),
      h('span', { class: 'cup-qty' }, String(line.qty)));
  }

  function render() {
    const items = cart.items();
    el.setAttribute('aria-label', i18n.t('tray_title'));
    clear(slots, items.length
      ? items.map(cup)
      : [h('div', { class: 'cup ghost' }), h('div', { class: 'cup ghost' }), h('div', { class: 'cup ghost' }), h('span', { class: 'tray-empty' }, i18n.t('tray_empty'))]);
    clear(total, cart.count() ? i18n.money(cart.subtotal()) : '');
    clear(openBtn, cart.count() ? `${i18n.t('tray_open')} (${cart.count()})` : i18n.t('tray_open'));
    known = new Set(items.map((l) => l.key));
  }

  // Marks the cup of a just-added drink so it pops into place.
  function pop(key) {
    for (const c of slots.children) if (c.dataset && c.dataset.key === key) c.classList.add('pop');
  }

  // Animates a copy of the drink from `from` (a DOMRect) to the tray. Always resolves.
  function fly(from, imgUrl) {
    return new Promise((resolve) => {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduce || !from || typeof el.animate !== 'function') { resolve(); return; }
      const size = 64;
      const to = slots.getBoundingClientRect();
      const startX = from.left + from.width / 2 - size / 2;
      const startY = from.top + from.height / 2 - size / 2;
      const endX = to.left + to.width / 2 - size / 2;
      const endY = to.top + to.height / 2 - size / 2;
      const ghost = h('div', { class: 'fly', style: { left: `${startX}px`, top: `${startY}px`, width: `${size}px`, height: `${size}px` } },
        h('img', { src: imgUrl || placeholder, alt: '' }));
      document.body.appendChild(ghost);
      let done = false;
      const finish = () => { if (done) return; done = true; ghost.remove(); resolve(); };
      try {
        const anim = ghost.animate([
          { transform: 'translate(0, 0) scale(1.15) rotate(0deg)', opacity: 1 },
          { transform: `translate(${(endX - startX) * 0.55}px, ${Math.min(endY - startY, 0) - 70}px) scale(.95) rotate(140deg)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${endX - startX}px, ${endY - startY}px) scale(.55) rotate(300deg)`, opacity: .9 },
        ], { duration: 720, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
        anim.onfinish = finish;
      } catch (_) { finish(); }
      setTimeout(finish, 1100);
    });
  }

  return { el, render, pop, fly, slots, wasKnown: (key) => known.has(key) };
}

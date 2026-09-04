// Keep the shared menu behaviour, adding page-local keyboard/accessibility state.
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.getElementById('power-menu');
  const syncMenu = () => {
    const open = menu.classList.contains('active');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    menu.inert = !open;
  };
  new MutationObserver(syncMenu).observe(menu, { attributes: true, attributeFilter: ['class'] });
  syncMenu();
  document.addEventListener('keydown', event => {
    if (event.key === 'Tab' && menu.classList.contains('active')) {
      const items = [toggle, ...menu.querySelectorAll('a[href]')];
      const index = items.indexOf(document.activeElement);
      if (index === -1 || (event.shiftKey && index === 0) || (!event.shiftKey && index === items.length - 1)) {
        event.preventDefault();
        items[event.shiftKey ? items.length - 1 : 0].focus();
      }
    }
    if (event.key === 'Escape' && menu.classList.contains('active')) {
      toggle.click();
      toggle.focus();
    }
  });
  window.matchMedia('(min-width: 1024px)').addEventListener('change', event => {
    if (event.matches && menu.classList.contains('active')) toggle.click();
  });
  // Capture before main.js's delegated anchor handler to honour reduced motion.
  document.addEventListener('click', event => {
    const anchor = event.target.closest('a[href^="#"]');
    if (!anchor) return;
    const target = document.getElementById(anchor.hash.slice(1));
    if (!target) return;
    if (anchor.classList.contains('power-skip') || menu.contains(anchor)) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (menu.classList.contains('active')) toggle.click();
    target.scrollIntoView({ behavior: 'instant' });
  }, true);
});

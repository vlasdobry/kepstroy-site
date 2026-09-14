const SOLAR_PANEL_POWER_KW = 0.65;
const SOLAR_PANEL_PRICE = 20000;

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.menu-toggle');
    const menu = document.getElementById('solar-menu');
    if (!toggle || !menu) return;

    const syncMenu = () => {
      const open = menu.classList.contains('active');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
      menu.inert = !open;
    };

    new MutationObserver(syncMenu).observe(menu, {
      attributes: true,
      attributeFilter: ['class'],
    });
    syncMenu();

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Tab' && menu.classList.contains('active')) {
        const items = [toggle, ...menu.querySelectorAll('a[href]')];
        const index = items.indexOf(document.activeElement);
        const wrapBack = event.shiftKey && index === 0;
        const wrapForward = !event.shiftKey && index === items.length - 1;
        if (index === -1 || wrapBack || wrapForward) {
          event.preventDefault();
          items[event.shiftKey ? items.length - 1 : 0].focus();
        }
      }
      if (event.key === 'Escape' && menu.classList.contains('active')) {
        toggle.click();
        toggle.focus();
      }
    });

    window.matchMedia('(min-width: 1024px)').addEventListener('change', (event) => {
      if (event.matches && menu.classList.contains('active')) toggle.click();
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SOLAR_PANEL_POWER_KW, SOLAR_PANEL_PRICE };
}

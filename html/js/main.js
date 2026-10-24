// === Mobile Menu ===
const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');

if (menuToggle && mobileMenu) {
  function menuFocusables() {
    return [
      menuToggle,
      ...Array.from(mobileMenu.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )),
    ];
  }

  function setMenuOpen(isOpen, { restoreFocus = false } = {}) {
    menuToggle.classList.toggle('active', isOpen);
    mobileMenu.classList.toggle('active', isOpen);
    menuToggle.setAttribute('aria-expanded', String(isOpen));
    menuToggle.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
    mobileMenu.setAttribute('aria-hidden', String(!isOpen));
    document.body.style.overflow = isOpen ? 'hidden' : '';
    if (restoreFocus) menuToggle.focus();
  }

  setMenuOpen(false);

  menuToggle.addEventListener('click', () => {
    setMenuOpen(menuToggle.getAttribute('aria-expanded') !== 'true');
  });

  // Close menu on link click
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      setMenuOpen(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (menuToggle.getAttribute('aria-expanded') !== 'true') return;

    if (event.key === 'Escape') {
      event.preventDefault();
      setMenuOpen(false, { restoreFocus: true });
      return;
    }

    if (event.key !== 'Tab') return;
    const focusables = menuFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!focusables.includes(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  });

  if (typeof window.matchMedia === 'function') {
    const desktopNavigation = window.matchMedia('(min-width: 1024px)');
    desktopNavigation.addEventListener('change', (event) => {
      if (event.matches) setMenuOpen(false);
    });
    if (desktopNavigation.matches) setMenuOpen(false);
  }
}

// === Accessible modal ===
const defaultModalOverlay = document.getElementById('modalOverlay');
let activeModalOverlay = null;
let modalReturnFocus = null;

function modalDialog(overlay) {
  return overlay ? overlay.querySelector('[role="dialog"]') || overlay.querySelector('.modal') : null;
}

function modalFocusables(overlay) {
  const dialog = modalDialog(overlay);
  if (!dialog) return [];
  return Array.from(dialog.querySelectorAll(
    'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  ));
}

function openModal(overlay = defaultModalOverlay) {
  if (!overlay) return;
  if (activeModalOverlay === overlay && overlay.classList.contains('active')) return;
  modalReturnFocus = document.activeElement;
  activeModalOverlay = overlay;
  overlay.classList.add('active');
  document.body.classList.add('modal-open');
  const firstMeaningfulField = overlay.querySelector(
    'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled])'
  );
  const focusTarget = firstMeaningfulField || modalFocusables(overlay)[0];
  if (focusTarget) focusTarget.focus();
  trackGoal('callback_open');
}

function canRestoreModalFocus(element) {
  return Boolean(
    element
    && element.isConnected !== false
    && element.disabled !== true
    && element.hidden !== true
    && typeof element.focus === 'function'
    && (!element.getClientRects || element.getClientRects().length > 0)
    && (!element.getAttribute || (
      element.getAttribute('tabindex') !== '-1'
      && element.getAttribute('aria-hidden') !== 'true'
    ))
  );
}

function focusModalFallback() {
  if (!document.body || typeof document.body.focus !== 'function') return;
  const previousTabindex = document.body.getAttribute('tabindex');
  if (previousTabindex === null) document.body.setAttribute('tabindex', '-1');
  document.body.focus();
  if (previousTabindex === null) document.body.removeAttribute('tabindex');
  else document.body.setAttribute('tabindex', previousTabindex);
}

function closeModal(overlay = activeModalOverlay || defaultModalOverlay) {
  if (!overlay || !overlay.classList.contains('active')) return;
  overlay.classList.remove('active');
  document.body.classList.remove('modal-open');
  activeModalOverlay = null;
  if (canRestoreModalFocus(modalReturnFocus)) modalReturnFocus.focus();
  else focusModalFallback();
  modalReturnFocus = null;
}

window.KepstroyModal = { open: openModal, close: closeModal };

document.addEventListener('keydown', (event) => {
  if (!activeModalOverlay || !activeModalOverlay.classList.contains('active')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
    return;
  }

  if (event.key !== 'Tab') return;
  const focusables = modalFocusables(activeModalOverlay);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!focusables.includes(document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
});

// === Sticky Phone Bar - show after scrolling past first viewport ===
const stickyPhone = document.querySelector('.sticky-phone');

if (stickyPhone) {
  const showThreshold = Math.max(window.innerHeight * 0.55, 300);
  let phoneVisible = false;

  function updateStickyPhone() {
    const shouldShow = window.scrollY > showThreshold;
    if (shouldShow === phoneVisible) return;
    phoneVisible = shouldShow;
    stickyPhone.classList.toggle('is-visible', shouldShow);
  }

  window.addEventListener('scroll', updateStickyPhone, { passive: true });
  window.addEventListener('resize', () => {
    updateStickyPhone();
  }, { passive: true });
  updateStickyPhone();
}


// === Smart Call: Desktop → Modal, Mobile → tel: ===
document.querySelectorAll('.js-smart-call').forEach(btn => {
  btn.addEventListener('click', function (e) {
    const isMobile = window.innerWidth <= 768;
    const hasModal = typeof openModal === 'function';
    const action = window.KepstroyTracking
      ? window.KepstroyTracking.resolveSmartCallAction({ isMobile, hasModal })
      : (isMobile || !hasModal ? 'phone' : 'callback');

    if (action === 'phone') {
      trackGoal('phone_click');
      window.location.href = 'tel:+79784615962';
      return;
    }

    openModal();
  });
});

function hasFilledHoneypot(form) {
  return Array.from(form.querySelectorAll('.form-honeypot input'))
    .some(input => input.value.trim());
}

async function sendFormRequest(formData) {
  try {
    await appendTrackingData(formData);
  } catch {
    throw { formDiagnostic: { reason: 'prepare_request', http_status: 0 } };
  }
  let response;
  try {
    response = await fetch('/submit', { method: 'POST', body: formData });
  } catch {
    throw { formDiagnostic: { reason: 'network', http_status: 0 } };
  }
  if (!response.ok) {
    const knownReasons = ['invalid_source', 'bot_check', 'invalid_form', 'rejected_content',
      'invalid_phone', 'rate_limit', 'delivery_failed', 'invalid_payload', 'payload_too_large', 'internal_error'];
    const reason = response.headers?.get('X-Form-Error');
    const requestId = response.headers?.get('X-Request-ID');
    const params = { reason: knownReasons.includes(reason) ? reason : 'http_error',
      http_status: Number.isInteger(response.status) && response.status >= 400 && response.status <= 599 ? response.status : 0 };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) {
      params.request_id = requestId;
    }
    throw { formDiagnostic: params };
  }
  return response;
}

function reportFormFailure(form, error) {
  const goal = form.dataset.errorGoal === 'solar_submit_error' ? 'solar_submit_error' : 'form_submit_error';
  trackGoal(goal, error?.formDiagnostic || { reason: 'prepare_request', http_status: 0 });
}

// === Universal form handler for all /submit forms ===
document.querySelectorAll('form[action="/submit"]').forEach(form => {
  if (form.id === 'contact-form') return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (form.dataset.submitting === 'true') return;

    if (hasFilledHoneypot(form)) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalHtml = submitBtn ? submitBtn.innerHTML : '';
    form.dataset.submitting = 'true';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправка...';
    }

    try {
      const formData = new URLSearchParams(new FormData(form));
      if (!formData.get('page')) {
        formData.append('page', window.location.href);
      }
      const response = await sendFormRequest(formData);
      if (response.ok) {
        trackGoal('form_submit');
        window.location.href = '/spasibo/';
      } else {
        throw new Error('Submit failed');
      }
    } catch (error) {
      delete form.dataset.submitting;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalHtml;
      }
      reportFormFailure(form, error);
      alert('Ошибка отправки. Пожалуйста, позвоните нам напрямую: +7 (978) 461-59-62');
    }
  });
});

// === Traffic attribution and Yandex.Metrica goals ===
function trackGoal(goal, params) {
  try {
    if (window.KepstroyTracking) {
      window.KepstroyTracking.trackGoal(goal, params);
      return;
    }
    if (window.KepstroyAnalytics) {
      window.KepstroyAnalytics.trackGoal(goal, params);
    }
  } catch {
    // Analytics must never change the result of a user action.
  }
}

async function appendTrackingData(formData) {
  if (window.KepstroyTracking) {
    await window.KepstroyTracking.appendTo(formData);
    return;
  }
  formData.set('current_page', window.location.href);
  formData.set('original_referrer', document.referrer || '');
}

// === Form Handling ===
const contactForm = document.getElementById('contact-form');

if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (contactForm.dataset.submitting === 'true') return;

    // Honeypot check
    if (hasFilledHoneypot(contactForm)) {
      return;
    }

    const submitBtn = contactForm.querySelector('button[type="submit"]');
    const originalHtml = submitBtn.innerHTML;

    contactForm.dataset.submitting = 'true';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';

    try {
      const formData = new URLSearchParams(new FormData(contactForm));
      formData.append('page', window.location.href);
      const response = await sendFormRequest(formData);

      if (response.ok) {
        // Track form submission
        trackGoal('form_submit');

        // Show success
        contactForm.innerHTML = `
          <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">✓</div>
            <h3 style="margin-bottom: 0.5rem;">Заявка отправлена!</h3>
            <p style="color: var(--color-text-light);">Мы свяжемся с вами по указанному номеру.</p>
          </div>
        `;
      } else {
        throw new Error('Submit failed');
      }
    } catch (error) {
      delete contactForm.dataset.submitting;
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalHtml;
      reportFormFailure(contactForm, error);
      alert('Ошибка отправки. Пожалуйста, позвоните нам напрямую.');
    }
  });
}

// === Smooth scroll for anchor links ===
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const targetId = this.getAttribute('href');
    if (targetId === '#') return;
    
    const targetElement = document.querySelector(targetId);
    if (targetElement) {
      e.preventDefault();
      targetElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});

// === Header scroll effect ===
const header = document.querySelector('.header');
let lastScroll = 0;

window.addEventListener('scroll', () => {
  const currentScroll = window.scrollY;
  
  if (currentScroll > 100) {
    header.style.boxShadow = '0 2px 10px rgba(0,0,0,0.1)';
  } else {
    header.style.boxShadow = 'none';
  }
  
  lastScroll = currentScroll;
});

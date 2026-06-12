// === Mobile Menu ===
const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');

if (menuToggle && mobileMenu) {
  menuToggle.addEventListener('click', () => {
    menuToggle.classList.toggle('active');
    mobileMenu.classList.toggle('active');
    document.body.style.overflow = mobileMenu.classList.contains('active') ? 'hidden' : '';
  });

  // Close menu on link click
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      menuToggle.classList.remove('active');
      mobileMenu.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

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

// === Phone Click Tracking (Yandex Metrica) ===
document.querySelectorAll('a[href^="tel:"]').forEach(link => {
  link.addEventListener('click', () => {
    if (typeof ym !== 'undefined') {
      ym(109754800, 'reachGoal', 'phone_click');
    }
  });
});

// === Smart Call: Desktop → Modal, Mobile → tel: ===
document.querySelectorAll('.js-smart-call').forEach(btn => {
  btn.addEventListener('click', function (e) {
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      window.location.href = 'tel:+79784615962';
    } else {
      if (typeof openModal === 'function') openModal();
    }

    if (typeof ym !== 'undefined') ym(109754800, 'reachGoal', 'phone_click');
  });
});

// === Add page source to all forms (for Telegram tracking) ===
document.querySelectorAll('form').forEach(form => {
  form.addEventListener('submit', () => {
    let pageInput = form.querySelector('input[name="page"]');
    if (!pageInput) {
      pageInput = document.createElement('input');
      pageInput.type = 'hidden';
      pageInput.name = 'page';
      form.appendChild(pageInput);
    }
    pageInput.value = window.location.href;
  });
});

// === Form Handling ===
const contactForm = document.getElementById('contact-form');

if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Honeypot check
    const honeypot = contactForm.querySelector('.form-honeypot');
    if (honeypot && honeypot.value) {
      return;
    }

    const formData = new FormData(contactForm);
    const submitBtn = contactForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Отправка...';

    try {
      // Using FormSubmit.co (replace with your email)
      const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          name: formData.get('name'),
          phone: formData.get('phone'),
          service: formData.get('service'),
          message: formData.get('message'),
          page: window.location.href
        })
      });

      if (response.ok) {
        // Track form submission
        if (typeof ym !== 'undefined') {
          ym(109754800, 'reachGoal', 'form_submit');
        }

        // Show success
        contactForm.innerHTML = `
          <div style="text-align: center; padding: 2rem;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">✓</div>
            <h3 style="margin-bottom: 0.5rem;">Заявка отправлена!</h3>
            <p style="color: var(--color-text-light);">Мы перезвоним вам в течение 15 минут.</p>
          </div>
        `;
      } else {
        throw new Error('Submit failed');
      }
    } catch (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
      alert('Ошибка отправки. Пожалуйста, позвоните нам напрямую.');
    }
  });
}

// === Scroll Tracking (50% depth) ===
let scrollTracked = false;
window.addEventListener('scroll', () => {
  if (scrollTracked) return;

  const scrollPercent = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight * 100;
  if (scrollPercent >= 50) {
    scrollTracked = true;
    if (typeof ym !== 'undefined') {
      ym(109754800, 'reachGoal', 'scroll_50');
    }
  }
});

// === Time on site tracking (2 minutes) ===
setTimeout(() => {
  if (typeof ym !== 'undefined') {
    ym(109754800, 'reachGoal', 'time_2min');
  }
}, 120000);

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

// === Quiz ===
const quizContainers = document.querySelectorAll('.quiz-container');

quizContainers.forEach(container => {
  const steps = container.querySelectorAll('.quiz-step');
  const prevBtn = container.querySelector('.quiz-prev');
  const nextBtn = container.querySelector('.quiz-next');
  const submitBtn = container.querySelector('.quiz-submit');
  const progressBar = container.querySelector('.quiz-progress-bar');
  const result = container.querySelector('.quiz-result');
  let currentStep = 0;

  function updateStep() {
    steps.forEach((step, i) => {
      step.classList.toggle('active', i === currentStep);
    });
    if (progressBar) {
      progressBar.style.width = ((currentStep + 1) / steps.length * 100) + '%';
    }
    if (prevBtn) prevBtn.style.display = currentStep > 0 ? 'inline-flex' : 'none';
    if (nextBtn) nextBtn.style.display = currentStep < steps.length - 1 ? 'inline-flex' : 'none';
    if (submitBtn) submitBtn.style.display = currentStep === steps.length - 1 ? 'inline-flex' : 'none';
  }

  // Handle option clicks
  steps.forEach((step, stepIndex) => {
    const options = step.querySelectorAll('.quiz-option');
    options.forEach(opt => {
      opt.addEventListener('click', () => {
        options.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        if (stepIndex < steps.length - 1) {
          setTimeout(() => {
            currentStep++;
            updateStep();
          }, 300);
        }
      });
    });
  });

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentStep > 0) {
        currentStep--;
        updateStep();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      const currentStepEl = steps[currentStep];
      const selected = currentStepEl.querySelector('.quiz-option.selected');
      if (!selected) {
        alert('Выберите вариант ответа');
        return;
      }
      if (currentStep < steps.length - 1) {
        currentStep++;
        updateStep();
      }
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const lastStep = steps[steps.length - 1];
      const selected = lastStep.querySelector('.quiz-option.selected');
      if (!selected) {
        alert('Выберите вариант ответа');
        return;
      }

      // Collect answers
      const answers = {};
      steps.forEach((step, i) => {
        const sel = step.querySelector('.quiz-option.selected');
        if (sel) {
          answers['q' + (i + 1)] = sel.dataset.value;
        }
      });

      // Show form
      container.querySelector('.quiz-steps').style.display = 'none';
      if (prevBtn) prevBtn.style.display = 'none';
      if (nextBtn) nextBtn.style.display = 'none';
      if (submitBtn) submitBtn.style.display = 'none';
      if (container.querySelector('.quiz-form')) {
        container.querySelector('.quiz-form').style.display = 'block';
      }
    });
  }

  // Quiz form submit
  const quizForm = container.querySelector('.quiz-form-inner');
  if (quizForm) {
    quizForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const honeypot = quizForm.querySelector('.form-honeypot');
      if (honeypot && honeypot.value) return;

      const formData = new FormData(quizForm);
      const submitBtn = quizForm.querySelector('button[type="submit"]');
      const originalText = submitBtn.textContent;

      // Collect quiz answers
      const answers = {};
      steps.forEach((step, i) => {
        const sel = step.querySelector('.quiz-option.selected');
        if (sel) answers['q' + (i + 1)] = sel.dataset.value;
      });

      submitBtn.disabled = true;
      submitBtn.textContent = 'Отправка...';

      try {
        const response = await fetch('https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            name: formData.get('name'),
            phone: formData.get('phone'),
            service: 'Квиз: септик',
            message: 'Ответы квиза: ' + JSON.stringify(answers),
            page: window.location.href
          })
        });

        if (response.ok) {
          if (typeof ym !== 'undefined') ym(109754800, 'reachGoal', 'quiz_submit');
          quizForm.innerHTML = `
            <div style="text-align:center;padding:2rem;">
              <div style="font-size:3rem;margin-bottom:1rem;">✓</div>
              <h3 style="margin-bottom:.5rem;">Заявка отправлена!</h3>
              <p style="color:var(--color-text-light);margin-bottom:1rem;">Андрей перезвонит в течение 15 минут.</p>
              <div style="background:var(--color-bg-alt);padding:1.5rem;border-radius:var(--radius-lg);margin-top:1rem;">
                <strong>Бонус:</strong> PDF-гайд «Как выбрать септик и не переплатить»<br>
                <small>Отправим в WhatsApp или Telegram</small>
              </div>
            </div>
          `;
        } else {
          throw new Error('Submit failed');
        }
      } catch (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        alert('Ошибка отправки. Позвоните напрямую: +7 (978) 461-59-62');
      }
    });
  }

  updateStep();
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


// === Cookie Consent Banner ===
document.addEventListener('DOMContentLoaded', function() {
  const banner = document.getElementById('cookieBanner');
  if (!banner) return;

  if (localStorage.getItem('cookiesAccepted') === 'true') {
    banner.style.display = 'none';
    return;
  }

  const acceptBtn = banner.querySelector('.cookie-banner__btn');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', function() {
      localStorage.setItem('cookiesAccepted', 'true');
      banner.style.display = 'none';
    });
  }
});

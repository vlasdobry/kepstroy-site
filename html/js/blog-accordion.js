document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.blog-article table').forEach(function (table) {
    if (!table.getAttribute('tabindex')) table.setAttribute('tabindex', '0');
    if (!table.getAttribute('aria-label')) table.setAttribute('aria-label', 'Прокручиваемая таблица');
  });

  const faqItems = document.querySelectorAll('.blog-faq__item');

  faqItems.forEach(function (item) {
    const question = item.querySelector('.blog-faq__question');
    const answer = item.querySelector('.blog-faq__answer');

    if (!question || !answer) return;

    answer.style.display = 'none';
    question.setAttribute('aria-expanded', 'false');

    question.addEventListener('click', function () {
      const isOpen = answer.style.display === 'block';

      faqItems.forEach(function (otherItem) {
        const otherAnswer = otherItem.querySelector('.blog-faq__answer');
        const otherQuestion = otherItem.querySelector('.blog-faq__question');
        if (otherAnswer && otherAnswer !== answer) {
          otherAnswer.style.display = 'none';
          otherQuestion.classList.remove('is-open');
          otherQuestion.setAttribute('aria-expanded', 'false');
        }
      });

      answer.style.display = isOpen ? 'none' : 'block';
      question.classList.toggle('is-open', !isOpen);
      question.setAttribute('aria-expanded', String(!isOpen));
    });
  });
});

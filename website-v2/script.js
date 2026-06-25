const header = document.querySelector('[data-header]');
const navToggle = document.querySelector('.nav-toggle');
const siteNav = document.querySelector('.site-nav');
const siteConfig = window.NATURE_ILLUSTRATED_CONFIG;

if (!siteConfig?.contact?.email || !siteConfig?.shop?.url) {
  throw new Error('Missing required contact or shop settings in site-config.js');
}

const contactEmail = siteConfig.contact.email;

document.querySelectorAll('[data-contact-email]').forEach((link) => {
  link.href = `mailto:${contactEmail}`;
  link.textContent = contactEmail;
});

document.querySelectorAll('[data-contact-form]').forEach((form) => {
  form.action = `mailto:${contactEmail}`;
});

document.querySelectorAll('[data-shop-link]').forEach((link) => {
  link.href = siteConfig.shop.url;
});

document.querySelectorAll('[data-social-link]').forEach((link) => {
  const url = siteConfig.social?.[link.dataset.socialLink];
  if (url) {
    link.href = url;
  } else {
    link.hidden = true;
  }
});

const updateHeader = () => header.classList.toggle('scrolled', window.scrollY > 20);
updateHeader();
window.addEventListener('scroll', updateHeader, { passive: true });

navToggle.addEventListener('click', () => {
  const isOpen = navToggle.getAttribute('aria-expanded') === 'true';
  navToggle.setAttribute('aria-expanded', String(!isOpen));
  navToggle.setAttribute('aria-label', isOpen ? 'Open menu' : 'Close menu');
  siteNav.classList.toggle('open', !isOpen);
  document.body.classList.toggle('menu-open', !isOpen);
});

siteNav.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
    siteNav.classList.remove('open');
    document.body.classList.remove('menu-open');
  });
});

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('.reveal').forEach((element) => revealObserver.observe(element));
document.querySelector('[data-year]').textContent = new Date().getFullYear();

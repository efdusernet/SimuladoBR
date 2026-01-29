function initFocusSection() {
  const app = document.getElementById('app');
  if (!app) return;
  const focus = String(app.getAttribute('data-focus-section') ?? '').trim();
  if (!focus) return;

  const el = document.getElementById(focus);
  if (!el) return;

  try {
    // Keep URL stable for the user
    if (history && history.replaceState) {
      history.replaceState(null, '', `#${focus}`);
    } else {
      window.location.hash = `#${focus}`;
    }
  } catch {
    // ignore
  }

  // Allow layout to settle before scrolling
  setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function initPlanSelectButtons() {
  const select = document.querySelector('select[name="planId"]');
  if (!select) return;

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    const btn = target.closest('.js-select-plan');
    if (!btn) return;

    const planId = String(btn.getAttribute('data-plan-id') ?? '').trim();
    if (!planId) return;

    ev.preventDefault();

    select.value = planId;
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const checkout = document.getElementById('checkout');
    if (checkout) {
      try {
        if (history && history.replaceState) {
          history.replaceState(null, '', '#checkout');
        } else {
          window.location.hash = '#checkout';
        }
      } catch {
        // ignore
      }

      checkout.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
}

function initAutoCollapseNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;

    const link = target.closest('a.nav-link, a.btn');
    if (!link) return;

    const href = String(link.getAttribute('href') ?? '');
    if (!href.includes('#')) return;

    const shown = nav.classList.contains('show');
    if (!shown) return;

    try {
      // bootstrap is loaded via footer
      const Collapse = window.bootstrap?.Collapse;
      if (!Collapse) return;
      const inst = Collapse.getOrCreateInstance(nav);
      inst.hide();
    } catch {
      // ignore
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initFocusSection();
  initPlanSelectButtons();
  initAutoCollapseNav();
});

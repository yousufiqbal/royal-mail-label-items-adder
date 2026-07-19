/* nav.js — page switching + initialisation */

// Set today's date as default for ship-date
(function () {
  const today = new Date();
  const yyyy  = today.getFullYear();
  const mm    = String(today.getMonth() + 1).padStart(2, '0');
  const dd    = String(today.getDate()).padStart(2, '0');
  document.getElementById('f-ship-date').value = `${yyyy}-${mm}-${dd}`;
})();

// Tab navigation
function activatePage(target, pushHash) {
  const pageEl = document.getElementById(`page-${target}`);
  if (!pageEl) return false;

  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.page === target));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  pageEl.classList.add('active');
  if (pushHash) location.hash = target;
  return true;
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activatePage(btn.dataset.page, true);
    closeNavMenu();
  });
});

// Hamburger menu (mobile) ────────────────────────────────────
const navToggle = document.getElementById('nav-toggle');
const navEl     = document.getElementById('nav');

function closeNavMenu() {
  navEl.classList.remove('open');
  navToggle.setAttribute('aria-expanded', 'false');
}
function toggleNavMenu() {
  const open = navEl.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(open));
}

navToggle.addEventListener('click', e => {
  e.stopPropagation();
  toggleNavMenu();
});

document.addEventListener('click', e => {
  if (navEl.classList.contains('open') && !navEl.contains(e.target) && e.target !== navToggle) {
    closeNavMenu();
  }
});

// Restore tab from URL hash on load, and react to back/forward + manual hash edits
window.addEventListener('hashchange', () => {
  const target = location.hash.slice(1);
  if (target) activatePage(target, false);
});

const initialPage = location.hash.slice(1);
if (initialPage) activatePage(initialPage, false);

// app.js
// Starts the app: screen switching, the worker dropdowns and offline support.

import * as storage from './storage.js';
import { initDashboardView, refreshDashboardView } from './dashboard.js';
import { initWorkersView, refreshWorkersView, leaveWorkersView } from './workers.js';
import { initPostureView, refreshPostureView, leavePostureView } from './posture.js';
import { initNoiseView, refreshNoiseView, leaveNoiseView } from './noise.js';
import { initProfileView, refreshProfileView, refreshFactoryView } from './profile.js';
import { initPriorityView, refreshPriorityView } from './priorityActions.js';
import { escapeHtml } from './ui.js';

// Each screen: which <section> it uses, which tab is highlighted, and the
// functions to redraw it / clean up when leaving it.
const VIEWS = {
  home: { section: 'home', tab: 'home', refresh: refreshDashboardView, leave: null },
  workers: { section: 'workers', tab: 'workers', refresh: refreshWorkersView, leave: leaveWorkersView },
  posture: { section: 'posture', tab: 'posture', refresh: refreshPostureView, leave: leavePostureView },
  noise: { section: 'noise', tab: 'noise', refresh: refreshNoiseView, leave: leaveNoiseView },
  risk: { section: 'risk', tab: 'risk', refresh: refreshFactoryView, leave: null },              // all workers
  'risk-worker': { section: 'risk', tab: 'risk', refresh: refreshProfileView, leave: null },     // one worker
  priority: { section: 'priority', tab: 'risk', refresh: refreshPriorityView, leave: null },      // priority actions
};

let currentView = null;

function viewFromHash() {
  const name = window.location.hash.replace('#', '');
  return VIEWS[name] ? name : 'home';
}

function showView(name) {
  if (currentView && currentView !== name && VIEWS[currentView].leave) {
    VIEWS[currentView].leave();
  }
  const view = VIEWS[name];
  for (const section of document.querySelectorAll('main > .view')) {
    section.hidden = section.id !== 'view-' + view.section;
  }
  for (const tab of document.querySelectorAll('.tab-bar a')) {
    if (tab.dataset.tab === view.tab) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
  }
  const changedView = currentView !== name;
  currentView = name;
  view.refresh();
  if (changedView) {
    window.scrollTo(0, 0);
  }
}

// Fills every "Worker being assessed" dropdown (Posture and Noise screens).
function renderWorkerSelects() {
  const workers = storage.getWorkers();
  const activeId = storage.getSettings().activeWorkerId;
  let html = '<option value="">Select worker</option>';
  for (const worker of workers) {
    html += '<option value="' + worker.id + '"' + (worker.id === activeId ? ' selected' : '') + '>' + escapeHtml(worker.name) + '</option>';
  }
  for (const select of document.querySelectorAll('[data-worker-select]')) {
    select.innerHTML = html;
  }
}

function start() {
  initDashboardView();
  initWorkersView();
  initPostureView();
  initNoiseView();
  initProfileView();
  initPriorityView();

  document.addEventListener('change', function (event) {
    if (event.target.matches('[data-worker-select]')) {
      storage.saveSettings({ activeWorkerId: event.target.value || null });
    }
  });

  // Whenever saved data changes, redraw the header and the visible screen.
  window.addEventListener('ergosafe:data-changed', function () {
    renderWorkerSelects();
    if (currentView) {
      VIEWS[currentView].refresh();
    }
  });

  // Fold-out steps (Posture, Noise): opening one closes the others in the
  // same group, so only one step is open at a time. The "toggle" event
  // does not bubble, so it is caught on the way down (capture phase).
  document.addEventListener('toggle', function (event) {
    const opened = event.target;
    if (!(opened instanceof HTMLDetailsElement) || !opened.open || !opened.dataset.accordion) {
      return;
    }
    for (const other of document.querySelectorAll('details[data-accordion="' + opened.dataset.accordion + '"]')) {
      if (other !== opened && other.open) {
        other.open = false;
      }
    }
  }, true);

  window.addEventListener('hashchange', function () { showView(viewFromHash()); });

  renderWorkerSelects();
  showView(viewFromHash());

  if ('serviceWorker' in navigator) {
    // updateViaCache: 'none' — always check the server for a new sw.js.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(function (error) {
      console.warn('Offline support not available:', error);
    });
  }
}

try {
  start();
  // Tell the safety net in index.html that the app started fine.
  window.__ergosafeStarted = true;
  try { sessionStorage.removeItem('ergosafe-recovered'); } catch (error) { /* ignore */ }
} catch (error) {
  console.error('ErgoSafe failed to start:', error);
  if (window.__ergosafeRecover) {
    window.__ergosafeRecover();
  }
}

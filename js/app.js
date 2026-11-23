// app.js
// Starts the app: screen switching, the worker picker in the header,
// high-contrast mode and offline support.

import * as storage from './storage.js';
import { initDashboardView, refreshDashboardView } from './dashboard.js';
import { initWorkersView, refreshWorkersView } from './workers.js';
import { initPostureView, refreshPostureView, leavePostureView } from './posture.js';
import { initNoiseView, refreshNoiseView, leaveNoiseView } from './noise.js';
import { initFeedbackView, refreshFeedbackView } from './feedback.js';
import { initProfileView, refreshProfileView } from './profile.js';
import { escapeHtml } from './ui.js';

const VIEWS = {
  home: { refresh: refreshDashboardView, leave: null },
  workers: { refresh: refreshWorkersView, leave: null },
  posture: { refresh: refreshPostureView, leave: leavePostureView },
  noise: { refresh: refreshNoiseView, leave: leaveNoiseView },
  risk: { refresh: refreshProfileView, leave: null },
  feedback: { refresh: refreshFeedbackView, leave: null },
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
  for (const viewName in VIEWS) {
    document.getElementById('view-' + viewName).hidden = viewName !== name;
  }
  for (const tab of document.querySelectorAll('.tab-bar a')) {
    if (tab.dataset.tab === name) {
      tab.setAttribute('aria-current', 'page');
    } else {
      tab.removeAttribute('aria-current');
    }
  }
  const changedView = currentView !== name;
  currentView = name;
  VIEWS[name].refresh();
  if (changedView) {
    window.scrollTo(0, 0);
  }
}

function renderWorkerPicker() {
  const select = document.getElementById('active-worker-select');
  const workers = storage.getWorkers();
  const activeId = storage.getSettings().activeWorkerId;
  let html = '<option value="">— none —</option>';
  for (const worker of workers) {
    html += '<option value="' + worker.id + '"' + (worker.id === activeId ? ' selected' : '') + '>' + escapeHtml(worker.name) + '</option>';
  }
  select.innerHTML = html;
}

function applyContrast() {
  const highContrast = storage.getSettings().highContrast;
  document.documentElement.classList.toggle('high-contrast', highContrast);
  document.getElementById('contrast-toggle').setAttribute('aria-pressed', highContrast ? 'true' : 'false');
}

function start() {
  initDashboardView();
  initWorkersView();
  initPostureView();
  initNoiseView();
  initFeedbackView();
  initProfileView();

  document.getElementById('active-worker-select').addEventListener('change', function (event) {
    storage.saveSettings({ activeWorkerId: event.target.value || null });
  });
  document.getElementById('contrast-toggle').addEventListener('click', function () {
    storage.saveSettings({ highContrast: !storage.getSettings().highContrast });
  });

  // Whenever saved data changes, redraw the header and the visible screen.
  window.addEventListener('ergosafe:data-changed', function () {
    renderWorkerPicker();
    applyContrast();
    if (currentView) {
      VIEWS[currentView].refresh();
    }
  });

  window.addEventListener('hashchange', function () { showView(viewFromHash()); });

  renderWorkerPicker();
  applyContrast();
  showView(viewFromHash());

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(function (error) {
      console.warn('Offline support not available:', error);
    });
  }
}

start();

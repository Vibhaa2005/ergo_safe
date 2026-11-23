// profile.js
// The Risk tab has two screens:
//   #risk         — all workers in the factory, ranked from highest to lowest risk
//   #risk-worker  — one worker's combined posture + noise risk, HIRA matrix,
//                   before/after, personalised 4W1H and User vs Work graph,
//                   and the action plan ordered by the hierarchy of controls.

import * as storage from './storage.js';
import { buildWorkerRiskProfile, buildFactoryTable } from './riskModel.js';
import {
  renderOverall, renderRiskMatrix, renderHazardCards, render4W1H, renderGraph, renderActionPlan,
  renderFactoryTotals, renderFactoryTable,
} from './riskViews.js';
import { prepareReassessment } from './posture.js';
import { prepareNoiseReassessment } from './noise.js';
import { renderPriorityActions, deletePostureWithFollowUps, renderNoisePriority, deleteNoiseWithFollowUps } from './priorityActions.js';
import { escapeHtml } from './ui.js';

let container = null;
let priorityOpen = false;   // is the "Priority actions" list showing?

function openWorker(workerId) {
  storage.saveSettings({ activeWorkerId: workerId });
  window.location.hash = '#risk-worker';
}

export function initProfileView() {
  container = document.getElementById('risk-profile');

  container.addEventListener('change', function (event) {
    const box = event.target.closest('[data-action-key]');
    if (box) {
      storage.setActionStatus(box.dataset.actionKey, box.checked);
    }
  });

  container.addEventListener('click', function (event) {
    if (event.target.closest('[data-toggle-priority]')) {
      priorityOpen = !priorityOpen;
      refreshFactoryView();
      return;
    }
    const deleteButton = event.target.closest('[data-delete-posture]');
    if (deleteButton) {
      deletePostureWithFollowUps(deleteButton.dataset.deletePosture);
      return;
    }
    const deleteNoiseButton = event.target.closest('[data-delete-noise]');
    if (deleteNoiseButton) {
      deleteNoiseWithFollowUps(deleteNoiseButton.dataset.deleteNoise);
      return;
    }
    const postureButton = event.target.closest('[data-reassess-posture]');
    if (postureButton) {
      prepareReassessment(postureButton.dataset.reassessPosture);
      return;
    }
    const noiseButton = event.target.closest('[data-reassess-noise]');
    if (noiseButton) {
      prepareNoiseReassessment(noiseButton.dataset.reassessNoise);
      return;
    }
    // A tap anywhere on a factory table row opens that worker.
    const workerRow = event.target.closest('[data-open-worker]');
    if (workerRow) {
      openWorker(workerRow.dataset.openWorker);
    }
  });
}

// ---------------------------------------------------------------
// All workers
// ---------------------------------------------------------------

export function refreshFactoryView() {
  const table = buildFactoryTable(storage.getWorkers(), storage.getPostureAssessments(), storage.getNoiseAssessments());
  container.innerHTML =
    '<h2 class="view-title">Factory risk — all workers</h2>' +
    '<div class="risk-actions">' +
      '<a class="button primary" href="report.html?factory=1">Export factory report (PDF)</a>' +
      '<button type="button" class="button" data-toggle-priority aria-expanded="' + (priorityOpen ? 'true' : 'false') + '" aria-controls="priority-panel">' +
        (priorityOpen ? 'Hide priority actions' : 'Priority actions') + '</button>' +
    '</div>' +
    '<div class="card" id="priority-panel"' + (priorityOpen ? '' : ' hidden') + '><h2>Priority actions</h2>' +
      (priorityOpen
        ? '<h3>Posture</h3>' + renderPriorityActions() + '<h3>Noise exposure</h3>' + renderNoisePriority()
        : '') +
    '</div>' +
    renderFactoryTotals(table) +
    '<div class="card">' +
      '<p class="hint">Ranked from highest to lowest overall risk. Overall posture score = each worker\'s worst posture. Tap a worker for their full profile and personal report.</p>' +
      renderFactoryTable(table, true) +
    '</div>';
}

// ---------------------------------------------------------------
// One worker
// ---------------------------------------------------------------

export function refreshProfileView() {
  const worker = storage.getActiveWorker();
  if (!worker) {
    // No worker chosen — show the factory table instead.
    window.location.hash = '#risk';
    return;
  }

  const profile = buildWorkerRiskProfile(worker, storage.getPostureAssessments(), storage.getNoiseAssessments());
  const statuses = storage.getActionStatuses();
  let openActions = 0;
  for (const action of profile.actions) {
    if (!statuses[action.key]) openActions++;
  }

  container.innerHTML =
    '<a class="back-link" href="#risk">← All workers</a>' +
    '<div class="card">' +
      '<div class="card-header"><h2>' + escapeHtml(worker.name) + '</h2>' +
      '<a class="button primary" href="report.html?worker=' + encodeURIComponent(worker.id) + '">Export report (PDF)</a></div>' +
      '<p class="hint">' + escapeHtml(worker.workstation || 'Workstation not recorded') + ' · ' + worker.statureCm + ' cm · ' +
      profile.postureCount + ' of 10 postures · ' + openActions + ' open action' + (openActions === 1 ? '' : 's') + '</p>' +
      renderOverall(profile) +
    '</div>' +
    (profile.hazards.length === 0 ? '' :
      '<div class="card"><h2>Hazards</h2>' + renderHazardCards(profile) + '</div>' +
      '<div class="card"><h2>Risk matrix</h2>' + renderRiskMatrix(profile) + '</div>' +
      '<div class="card"><h2>4W1H for ' + escapeHtml(worker.name) + '</h2>' + render4W1H(profile) + '</div>' +
      '<details class="card collapsible"><summary><h2>User vs Work characteristics</h2></summary>' +
        '<p class="hint">Each level of the framework, filled in with this worker\'s own findings.</p>' + renderGraph(profile) + '</details>' +
      '<div class="card"><h2>Action plan</h2><p class="hint">Ordered by the hierarchy of controls — change the workplace before relying on rules or protective equipment. Tick an action when it is done, then re-assess.</p>' +
        renderActionPlan(profile, statuses, true) + '</div>');
}

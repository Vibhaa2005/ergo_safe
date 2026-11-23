// profile.js
// The Risk screen: one worker's combined posture + noise risk, the HIRA
// risk matrix, before/after results, personalised 4W1H and User vs Work
// graph, and the action plan ordered by the hierarchy of controls.

import * as storage from './storage.js';
import { buildWorkerRiskProfile } from './riskModel.js';
import { renderOverall, renderRiskMatrix, renderHazardCards, render4W1H, renderGraph, renderActionPlan } from './riskViews.js';
import { prepareReassessment } from './posture.js';
import { prepareNoiseReassessment } from './noise.js';
import { escapeHtml } from './ui.js';

let container = null;

export function initProfileView() {
  container = document.getElementById('risk-profile');

  container.addEventListener('change', function (event) {
    const box = event.target.closest('[data-action-key]');
    if (box) {
      storage.setActionStatus(box.dataset.actionKey, box.checked);
    }
  });

  container.addEventListener('click', function (event) {
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
    const pickButton = event.target.closest('[data-pick-worker]');
    if (pickButton) {
      storage.saveSettings({ activeWorkerId: pickButton.dataset.pickWorker });
    }
  });
}

export function refreshProfileView() {
  const worker = storage.getActiveWorker();
  if (!worker) {
    const workers = storage.getWorkers();
    let html = '<div class="card"><h2>Choose a worker</h2>';
    if (workers.length === 0) {
      html += '<p class="empty">No workers yet. <a href="#workers">Add a worker</a> first, or load sample data on the Home screen.</p>';
    } else {
      html += '<div class="button-row">';
      for (const item of workers) {
        html += '<button type="button" class="button" data-pick-worker="' + item.id + '">' + escapeHtml(item.name) + '</button>';
      }
      html += '</div>';
    }
    container.innerHTML = html + '</div>';
    return;
  }

  const profile = buildWorkerRiskProfile(worker, storage.getPostureAssessments(), storage.getNoiseAssessments());
  const statuses = storage.getActionStatuses();
  let openActions = 0;
  for (const action of profile.actions) {
    if (!statuses[action.key]) openActions++;
  }

  container.innerHTML =
    '<div class="card">' +
      '<div class="card-header"><h2>' + escapeHtml(worker.name) + '</h2>' +
      '<a class="button primary" href="report.html?worker=' + encodeURIComponent(worker.id) + '">Export report (PDF)</a></div>' +
      '<p class="hint">' + escapeHtml(worker.workstation || 'Workstation not recorded') + ' · ' + worker.statureCm + ' cm · ' +
      profile.hazards.length + ' hazard' + (profile.hazards.length === 1 ? '' : 's') + ' · ' + openActions + ' open action' + (openActions === 1 ? '' : 's') + '</p>' +
      renderOverall(profile) +
    '</div>' +
    (profile.hazards.length === 0 ? '' :
      '<div class="card"><h2>Hazards</h2>' + renderHazardCards(profile) + '</div>' +
      '<div class="card"><h2>Risk matrix</h2>' + renderRiskMatrix(profile) + '</div>' +
      '<div class="card"><h2>4W1H for ' + escapeHtml(worker.name) + '</h2>' + render4W1H(profile) + '</div>' +
      '<div class="card"><h2>User vs Work characteristics</h2><p class="hint">Each level of the framework, filled in with this worker\'s own findings.</p>' + renderGraph(profile) + '</div>' +
      '<div class="card"><h2>Action plan</h2><p class="hint">Ordered by the hierarchy of controls — change the workplace before relying on rules or protective equipment. Tick an action when it is done, then re-assess.</p>' +
        renderActionPlan(profile, statuses, true) + '</div>');
}

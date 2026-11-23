// priorityActions.js
// The Priority actions page (#priority, opened from the Risk screen):
// every posture assessment (highest risk first, with its most important fix)
// and every noise assessment (highest daily dose first).

import * as storage from './storage.js';
import { prepareReassessment } from './posture.js';
import { prepareNoiseReassessment } from './noise.js';
import { riskBadge, escapeHtml, formatDate, RISK_LEVELS } from './ui.js';

let page = null;

export function initPriorityView() {
  page = document.getElementById('priority-page');
  page.addEventListener('click', function (event) {
    const deletePosture = event.target.closest('[data-delete-posture]');
    if (deletePosture) {
      deletePostureWithFollowUps(deletePosture.dataset.deletePosture);
      return;
    }
    const deleteNoise = event.target.closest('[data-delete-noise]');
    if (deleteNoise) {
      deleteNoiseWithFollowUps(deleteNoise.dataset.deleteNoise);
      return;
    }
    const reassessPosture = event.target.closest('[data-reassess-posture]');
    if (reassessPosture) {
      prepareReassessment(reassessPosture.dataset.reassessPosture);
      return;
    }
    const reassessNoise = event.target.closest('[data-reassess-noise]');
    if (reassessNoise) {
      prepareNoiseReassessment(reassessNoise.dataset.reassessNoise);
    }
  });
}

export function refreshPriorityView() {
  page.innerHTML =
    '<div class="card"><h2>Posture</h2>' + renderPriorityActions() + '</div>' +
    '<div class="card"><h2>Noise exposure</h2>' + renderNoisePriority() + '</div>';
}

const RISK_RANK = { negligible: 0, low: 1, medium: 2, high: 3, veryhigh: 4 };

function primaryResult(assessment) {
  return assessment.method === 'rula' ? assessment.rula : assessment.reba;
}

function findById(list, id) {
  for (const item of list) {
    if (item.id === id) return item;
  }
  return null;
}

export function renderPriorityActions() {
  const postures = storage.getPostureAssessments();
  const sorted = postures.slice().sort(function (first, second) {
    const rankDifference = RISK_RANK[primaryResult(second).riskLevel] - RISK_RANK[primaryResult(first).riskLevel];
    if (rankDifference !== 0) return rankDifference;
    return primaryResult(second).finalScore / (second.method === 'rula' ? 7 : 15) - primaryResult(first).finalScore / (first.method === 'rula' ? 7 : 15);
  });
  if (sorted.length === 0) {
    return '<p class="empty">No posture assessments yet. Go to <a href="#posture">Posture</a> to make one.</p>';
  }
  let html = '<p class="hint">Every saved posture assessment, highest risk first, with its most important fix.</p><div class="assessment-list">';
  for (const assessment of sorted) {
    const result = primaryResult(assessment);
    const maxScore = assessment.method === 'rula' ? 7 : 15;
    const topFix = assessment.recommendations && assessment.recommendations.length ? assessment.recommendations[0] : null;
    const baseline = assessment.baselineId ? findById(postures, assessment.baselineId) : null;
    let followUpText = '';
    if (baseline) {
      const before = primaryResult(baseline).finalScore;
      const after = (baseline.method === 'rula' ? assessment.rula : assessment.reba).finalScore;
      const change = before ? ((before - after) / before) * 100 : 0;
      followUpText = '<p class="follow-up-note">After fix of "' + escapeHtml(baseline.task) + '": ' + baseline.method.toUpperCase() + ' ' + before + ' → ' + after +
        ' (' + (change >= 0 ? '−' : '+') + Math.abs(change).toFixed(0) + '%)</p>';
    }
    html += '<article class="assessment-card risk-border-' + result.riskLevel + '">' +
      (assessment.thumbnail ? '<img src="' + assessment.thumbnail + '" alt="Posture photo for ' + escapeHtml(assessment.task) + '">' : '<div class="thumb-placeholder" aria-hidden="true">' + assessment.method.toUpperCase() + '</div>') +
      '<div class="assessment-body">' +
        '<div class="assessment-title"><strong>' + escapeHtml(assessment.task) + '</strong>' + riskBadge(result.riskLevel, RISK_LEVELS[result.riskLevel].label + ' · ' + assessment.method.toUpperCase() + ' ' + result.finalScore + '/' + maxScore) + '</div>' +
        '<p class="hint">' + escapeHtml(assessment.workerName) + ' · ' + formatDate(assessment.date) + '</p>' +
        followUpText +
        (topFix ? '<p><strong>' + escapeHtml(topFix.bodyPart) + ':</strong> ' + escapeHtml(topFix.action) + '</p>' : '') +
        '<div class="card-actions"><button type="button" class="button small" data-reassess-posture="' + (assessment.baselineId || assessment.id) + '">Re-assess after fix</button>' +
        '<button type="button" class="link-button" data-delete-posture="' + assessment.id + '">Delete</button></div>' +
      '</div></article>';
  }
  return html + '</div>';
}

// Deleting a posture also deletes its after-fix re-assessments.
export function deletePostureWithFollowUps(assessmentId) {
  if (!confirm('Delete this posture assessment and any after-fix re-assessments of it?')) {
    return;
  }
  for (const assessment of storage.getPostureAssessments()) {
    if (assessment.baselineId === assessmentId) storage.deletePostureAssessment(assessment.id);
  }
  storage.deletePostureAssessment(assessmentId);
}

// Noise exposure: every saved noise assessment, highest daily dose first.
export function renderNoisePriority() {
  const noiseAssessments = storage.getNoiseAssessments();
  if (noiseAssessments.length === 0) {
    return '<p class="empty">No noise assessments yet. Go to <a href="#noise">Noise</a> to measure.</p>';
  }
  const sortedNoise = noiseAssessments.slice().sort(function (first, second) { return second.nioshDosePercent - first.nioshDosePercent; });
  let html = '<p class="hint">Every saved noise assessment, highest daily dose first.</p><div class="assessment-list">';
  for (const assessment of sortedNoise) {
    const zones = assessment.entries.map(function (entry) { return entry.zone + ' ' + entry.levelDb.toFixed(0) + ' dB(A) × ' + entry.hours + ' h'; }).join(', ');
    const baseline = assessment.baselineId ? findById(noiseAssessments, assessment.baselineId) : null;
    html += '<article class="assessment-card risk-border-' + assessment.riskLevel + '">' +
      '<div class="thumb-placeholder" aria-hidden="true">dB</div>' +
      '<div class="assessment-body">' +
        '<div class="assessment-title"><strong>' + escapeHtml(assessment.workerName) + '</strong>' + riskBadge(assessment.riskLevel, assessment.statusLabel) + '</div>' +
        '<p>NIOSH dose <strong>' + assessment.nioshDosePercent.toFixed(0) + '%</strong> · Factories Act dose <strong>' + assessment.indiaDosePercent.toFixed(0) + '%</strong>' +
        (assessment.nioshTwa !== null ? ' · TWA ' + assessment.nioshTwa.toFixed(1) + ' dB(A)' : '') + '</p>' +
        '<p class="hint">' + escapeHtml(zones) + ' · ' + formatDate(assessment.date) + '</p>' +
        (baseline ? '<p class="follow-up-note">After fix: dose ' + baseline.nioshDosePercent.toFixed(0) + '% → ' + assessment.nioshDosePercent.toFixed(0) + '%</p>' : '') +
        '<div class="card-actions"><button type="button" class="button small" data-reassess-noise="' + (assessment.baselineId || assessment.id) + '">Re-assess after fix</button>' +
        '<button type="button" class="link-button" data-delete-noise="' + assessment.id + '">Delete</button></div>' +
      '</div></article>';
  }
  return html + '</div>';
}

// Deleting a noise assessment also deletes its after-fix re-assessments.
export function deleteNoiseWithFollowUps(assessmentId) {
  if (!confirm('Delete this noise assessment and any after-fix re-assessments of it?')) {
    return;
  }
  for (const assessment of storage.getNoiseAssessments()) {
    if (assessment.baselineId === assessmentId) storage.deleteNoiseAssessment(assessment.id);
  }
  storage.deleteNoiseAssessment(assessmentId);
}

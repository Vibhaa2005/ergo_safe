// priorityActions.js
// "Priority actions": every saved posture assessment, highest risk first,
// with its most important fix. Shown on the Risk screen behind a button.

import * as storage from './storage.js';
import { riskBadge, escapeHtml, formatDate, RISK_LEVELS } from './ui.js';

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

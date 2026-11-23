// riskViews.js
// Turns a worker risk profile (riskModel.js) into HTML.
// Shared by the Risk screen in the app and the printable report.

import { riskBadge, escapeHtml, formatDate, iconSvg, RISK_LEVELS } from './ui.js';
import { CONTROL_TYPES } from './riskModel.js';

const OVERALL_TEXT = {
  negligible: 'Acceptable — keep monitoring.',
  low: 'Acceptable — keep monitoring and re-assess when the job changes.',
  medium: 'Plan changes within the next few weeks.',
  high: 'Act soon — fix the highest-rated hazards first.',
  veryhigh: 'Act now — this worker should not continue the job unchanged.',
};

const PRIORITY_TEXT = { veryhigh: 'Urgent', high: 'Fix first', medium: 'Fix soon', low: 'Improve' };

const SEVERITY_LABELS = { 1: 'Negligible', 2: 'Low', 3: 'Medium', 4: 'High', 5: 'Very high' };
const LIKELIHOOD_LABELS = { 1: 'Rare / < 1 h', 2: '1–2 h', 3: '2–4 h', 4: '4–6 h', 5: '> 6 h / continuous' };

function levelLabel(level) {
  return level === 'none' ? 'Not assessed' : RISK_LEVELS[level].label;
}

// Badge that also supports the grey "not assessed" state.
export function cellBadge(level, text) {
  if (level === 'none') {
    return '<span class="badge risk-none">' + iconSvg('alert') + '<span>' + escapeHtml(text || 'Not assessed') + '</span></span>';
  }
  return riskBadge(level, text);
}

function ratingBand(rating) {
  if (rating <= 4) return 'low';
  if (rating <= 9) return 'medium';
  if (rating <= 16) return 'high';
  return 'veryhigh';
}

// ---------------------------------------------------------------

export function renderOverall(profile) {
  if (profile.hazards.length === 0) {
    return '<p class="empty">No posture or noise assessments for this worker yet. Assess them on the Posture and Noise screens.</p>';
  }
  const level = profile.overallLevel;
  return '<div class="overall-banner risk-border-' + level + '">' +
    '<div class="overall-head"><span class="overall-label">Overall risk</span>' + riskBadge(level, levelLabel(level) + ' risk') + '</div>' +
    '<p>' + OVERALL_TEXT[level] + '</p>' +
    (profile.combinedRuleApplied ? '<p class="hint"><strong>Combined-exposure rule applied:</strong> posture and noise are both rated high, so the overall risk is raised to very high (a conservative ErgoSafe rule).</p>' : '') +
    '</div>';
}

export function renderRiskMatrix(profile) {
  // Collect markers per cell.
  const markers = {};
  function addMarker(severity, likelihood, html) {
    const key = severity + '-' + likelihood;
    if (!markers[key]) markers[key] = [];
    markers[key].push(html);
  }
  for (const hazard of profile.hazards) {
    if (hazard.after) {
      addMarker(hazard.before.severity, hazard.before.likelihood.value, '<span class="chip chip-before" title="' + escapeHtml(hazard.title) + ' before fix">' + hazard.code + ' before</span>');
      addMarker(hazard.after.severity, hazard.after.likelihood.value, '<span class="chip" title="' + escapeHtml(hazard.title) + ' after fix">' + hazard.code + ' now</span>');
    } else {
      addMarker(hazard.before.severity, hazard.before.likelihood.value, '<span class="chip" title="' + escapeHtml(hazard.title) + '">' + hazard.code + '</span>');
    }
  }

  let html = '<div class="table-wrap"><table class="risk-matrix" aria-label="Risk matrix: severity by likelihood">' +
    '<thead><tr><th class="matrix-corner">Severity ↓ · Likelihood →</th>';
  for (let likelihood = 1; likelihood <= 5; likelihood++) {
    html += '<th>' + likelihood + '<span>' + LIKELIHOOD_LABELS[likelihood] + '</span></th>';
  }
  html += '</tr></thead><tbody>';
  for (let severity = 5; severity >= 1; severity--) {
    html += '<tr><th>' + severity + '<span>' + SEVERITY_LABELS[severity] + '</span></th>';
    for (let likelihood = 1; likelihood <= 5; likelihood++) {
      const rating = severity * likelihood;
      const cellMarkers = markers[severity + '-' + likelihood] || [];
      html += '<td class="matrix-cell band-' + ratingBand(rating) + '"><span class="matrix-rating">' + rating + '</span>' + cellMarkers.join('') + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>' +
    '<p class="hint">Rating = severity × likelihood. 1–4 low · 5–9 medium · 10–16 high · 20–25 very high. "before" chips show where a hazard was before the fix.</p>';
  return html;
}

export function renderHazardTable(profile, withButtons) {
  if (profile.hazards.length === 0) {
    return '';
  }
  let html = '<div class="table-wrap"><table class="data-table"><thead><tr><th>Code</th><th>Hazard</th><th>Score</th><th>Severity × likelihood</th><th>Rating</th><th>After fix</th>' +
    (withButtons ? '<th><span class="visually-hidden">Actions</span></th>' : '') + '</tr></thead><tbody>';
  for (const hazard of profile.hazards) {
    const current = hazard.current;
    let afterText = '<span class="hint">Not re-assessed</span>';
    if (hazard.reduction) {
      const percent = hazard.reduction.percent;
      afterText = '<strong>' + escapeHtml(hazard.reduction.text) + '</strong><br>' +
        (percent >= 0 ? '−' : '+') + Math.abs(percent).toFixed(0) + '% · rating ' + hazard.reduction.ratingText;
    }
    html += '<tr><td><strong>' + hazard.code + '</strong></td><td>' + escapeHtml(hazard.title) + '<br><span class="hint">' + formatDate(current.assessment.date) + '</span></td>' +
      '<td class="nowrap">' + escapeHtml(current.scoreText) + '</td>' +
      '<td>' + current.severity + ' × ' + current.likelihood.value + '<br><span class="hint">' + escapeHtml(current.likelihood.text) + '</span></td>' +
      '<td>' + riskBadge(current.level, current.rating + ' · ' + levelLabel(current.level)) + '</td>' +
      '<td>' + afterText + '</td>' +
      (withButtons ? '<td><button type="button" class="button small" data-reassess-' + hazard.type + '="' + hazard.before.assessment.id + '">Re-assess after fix</button></td>' : '') +
      '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

// Phone-friendly version of the hazard table, used on the Risk screen.
export function renderHazardCards(profile) {
  let html = '<div class="hazard-cards">';
  for (const hazard of profile.hazards) {
    const current = hazard.current;
    let afterText = '<p class="hint">Not re-assessed after a fix yet.</p>';
    if (hazard.reduction) {
      const percent = hazard.reduction.percent;
      afterText = '<p class="follow-up-note">After fix: ' + escapeHtml(hazard.reduction.text) + ' (' + (percent >= 0 ? '−' : '+') +
        Math.abs(percent).toFixed(0) + '%) · rating ' + hazard.reduction.ratingText + '</p>';
    }
    html += '<article class="hazard-card risk-border-' + current.level + '">' +
      '<div class="assessment-title"><strong><span class="chip">' + hazard.code + '</span> ' + escapeHtml(hazard.title) + '</strong>' +
      riskBadge(current.level, current.rating + ' · ' + levelLabel(current.level)) + '</div>' +
      '<p>' + escapeHtml(current.scoreText) + ' · severity ' + current.severity + ' × likelihood ' + current.likelihood.value +
      ' <span class="hint">(' + escapeHtml(current.likelihood.text) + ')</span></p>' +
      afterText +
      '<button type="button" class="button small" data-reassess-' + hazard.type + '="' + hazard.before.assessment.id + '">Re-assess after fix</button>' +
      '</article>';
  }
  return html + '</div>';
}

function listHtml(items) {
  let html = '<ul>';
  for (const item of items) html += '<li>' + escapeHtml(item) + '</li>';
  return html + '</ul>';
}

export function render4W1H(profile) {
  const data = profile.fourWOneH;
  return '<dl class="four-w">' +
    '<div><dt>Who is affected?</dt><dd>' + escapeHtml(data.who) + '</dd></div>' +
    '<div><dt>When does it happen?</dt><dd>' + listHtml(data.when) + '</dd></div>' +
    '<div><dt>Where does it happen?</dt><dd>' + listHtml(data.where) + '</dd></div>' +
    '<div><dt>What is the issue?</dt><dd>' + listHtml(data.what) + '</dd></div>' +
    '<div><dt>How to solve it?</dt><dd>' + listHtml(data.how) + '</dd></div>' +
    '</dl>';
}

// The User vs Work Characteristics graph, with this worker's findings
// in the five diagonal cells.
export function renderGraph(profile) {
  const userRows = ['Affective needs', 'Effective needs', 'Cognitive utility', 'Dynamic physical requirement', 'Static physical requirement'];
  const workColumns = ['Static physical dimensions', 'Dynamic', 'Operability', 'Utility', 'Art'];
  // Diagonal from bottom-left to top-right.
  const diagonal = [
    { key: 'anthropometry', title: 'Anthropometry' },
    { key: 'biomechanics', title: 'Biomechanics' },
    { key: 'informationHandling', title: 'Information handling' },
    { key: 'functional', title: 'Functional evaluation' },
    { key: 'aesthetic', title: 'Aesthetic evaluation' },
  ];

  let html = '<div class="table-wrap"><div class="hf-graph" role="table" aria-label="User versus work characteristics graph for ' + escapeHtml(profile.worker.name) + '">';
  html += '<div class="hf-axis-y" aria-hidden="true">User characteristics ↑</div>';
  for (let rowIndex = 0; rowIndex < 5; rowIndex++) {
    const fromBottom = 4 - rowIndex;
    html += '<div class="hf-row-label" role="rowheader">' + userRows[rowIndex] + '</div>';
    for (let columnIndex = 0; columnIndex < 5; columnIndex++) {
      if (columnIndex === fromBottom) {
        const definition = diagonal[fromBottom];
        const cell = profile.graph[definition.key];
        html += '<div class="hf-cell hf-diagonal level-' + cell.level + '" role="cell">' +
          '<strong>' + definition.title + '</strong>' + cellBadge(cell.level, levelLabel(cell.level)) +
          '<p>' + escapeHtml(cell.text) + '</p></div>';
      } else {
        html += '<div class="hf-cell" role="cell"></div>';
      }
    }
  }
  // Bottom row: skip the axis column and the row-label column.
  html += '<div></div><div></div>';
  for (const column of workColumns) {
    html += '<div class="hf-column-label" role="columnheader">' + column + '</div>';
  }
  html += '<div></div><div class="hf-axis-x" aria-hidden="true">Work characteristics →</div>';
  html += '</div></div>';
  return html;
}

export function renderActionPlan(profile, statusMap, editable) {
  if (profile.actions.length === 0) {
    return '<p class="empty">No actions yet.</p>';
  }
  let html = '';
  for (const controlKey of ['elimination', 'engineering', 'administrative', 'ppe']) {
    const group = profile.actions.filter(function (action) { return action.control === controlKey; });
    if (group.length === 0) continue;
    html += '<h3 class="control-heading"><span class="control-order">' + (CONTROL_TYPES[controlKey].order + 1) + '</span>' + CONTROL_TYPES[controlKey].label + '</h3><ul class="action-list">';
    for (const action of group) {
      const status = statusMap[action.key];
      const done = Boolean(status && status.done);
      html += '<li class="action-item' + (done ? ' done' : '') + '">' +
        (editable
          ? '<label class="action-check"><input type="checkbox" data-action-key="' + escapeHtml(action.key) + '"' + (done ? ' checked' : '') + '><span class="visually-hidden">Mark done</span></label>'
          : '<span class="action-status">' + (done ? '✓ Done' : '☐ Open') + '</span>') +
        '<div class="action-body"><div class="recommendation-head">' + riskBadge(action.priority, PRIORITY_TEXT[action.priority]) +
        '<span class="chip">' + action.hazardCode + '</span><strong>' + escapeHtml(action.bodyPart) + '</strong>' +
        (done && status.date ? '<span class="hint">done ' + formatDate(status.date) + '</span>' : '') + '</div>' +
        '<p class="recommendation-issue">' + escapeHtml(action.issue) + '</p><p>' + escapeHtml(action.action) + '</p></div></li>';
    }
    html += '</ul>';
  }
  return html;
}

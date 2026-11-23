// report.js
// Builds the printable worker risk assessment report (report.html).
// The browser's "Print → Save as PDF" turns it into a PDF.

import * as storage from './storage.js';
import { buildWorkerRiskProfile, buildFactoryTable, recomputeAssessment, FREQUENCY_OPTIONS } from './riskModel.js';
import {
  renderOverall, renderRiskMatrix, renderHazardTable, render4W1H, renderGraph, renderActionPlan,
  renderPostureSummaryTable, renderFactoryTotals, renderFactoryTable,
} from './riskViews.js';
import { escapeHtml, formatDate, formatHours } from './ui.js';
import { NOISE_STANDARDS, allowedHours } from './noiseMath.js';
import { formatRangeMm, INDIAN_POPULATION } from './anthropometry.js';

const reportElement = document.getElementById('report');
document.getElementById('print-button').addEventListener('click', function () { window.print(); });

const STORAGE_LIMITATION = '<li><strong>Data storage:</strong> all data is kept in the local storage of the browser on one device (about 5 MB). With posture photos this holds roughly 15–20 workers; it is not shared between devices and is lost if the browser data is cleared, so export the data regularly.</li>';

const parameters = new URLSearchParams(window.location.search);

if (parameters.has('factory')) {
  document.querySelector('.report-toolbar a').href = 'index.html#risk';
  buildFactoryReport();
} else {
  const worker = storage.getWorkerById(parameters.get('worker')) || storage.getActiveWorker();
  if (!worker) {
    reportElement.innerHTML = '<p class="empty">No worker selected. Go back to the app, choose a worker on the Risk screen and press "Export report".</p>';
  } else {
    document.querySelector('.report-toolbar a').href = 'index.html#risk-worker';
    buildReport(worker);
  }
}

function section(number, title, body) {
  return '<section class="report-section"><h2><span class="section-number">' + number + '</span>' + title + '</h2>' + body + '</section>';
}

function postureStateHtml(label, assessment) {
  const full = recomputeAssessment(assessment);
  const result = assessment.method === 'rula' ? full.rula : full.reba;
  let html = '<div class="report-phase"><h4>' + label + ' · ' + formatDate(assessment.date) + '</h4>';
  if (assessment.thumbnail) {
    html += '<img class="report-photo" src="' + assessment.thumbnail + '" alt="Posture photo: ' + escapeHtml(label) + '">';
  }
  html += '<p><strong>' + result.method + ' ' + result.finalScore + ' / ' + result.maxScore + '</strong> — ' + escapeHtml(result.actionText) + '</p>';
  html += '<table class="data-table compact"><thead><tr><th>Body part</th><th>Measured</th><th>Score</th></tr></thead><tbody>';
  for (const step of result.steps) {
    html += '<tr><td>' + escapeHtml(step.name) + '</td><td>' + escapeHtml(step.detail) +
      (step.adjustments.length ? '<br><span class="hint">' + escapeHtml(step.adjustments.join(', ')) + '</span>' : '') + '</td><td>' + step.score + '</td></tr>';
  }
  for (const row of result.summary) {
    html += '<tr' + (row.total ? ' class="total-row"' : '') + '><td colspan="2">' + escapeHtml(row.name) + '</td><td>' + row.score + '</td></tr>';
  }
  html += '</tbody></table>';
  if (assessment.exposure) {
    const frequency = FREQUENCY_OPTIONS[assessment.exposure.frequency];
    html += '<p class="hint">Exposure: ' + assessment.exposure.hoursPerShift + ' h per shift, ' + escapeHtml(frequency ? frequency.shortLabel : assessment.exposure.frequency) + '.</p>';
  }
  return html + '</div>';
}

function noiseStateHtml(label, assessment) {
  const standard = NOISE_STANDARDS.niosh;
  let html = '<div class="report-phase"><h4>' + label + ' · ' + formatDate(assessment.date) + '</h4>' +
    '<table class="data-table compact"><thead><tr><th>Zone</th><th>dB(A)</th><th>Hours</th><th>Allowed (NIOSH)</th></tr></thead><tbody>';
  for (const entry of assessment.entries) {
    html += '<tr><td>' + escapeHtml(entry.zone) + '</td><td>' + entry.levelDb.toFixed(1) + '</td><td>' + entry.hours + '</td><td>' + formatHours(allowedHours(entry.levelDb, standard)) + '</td></tr>';
  }
  html += '</tbody></table>' +
    '<p>NIOSH dose <strong>' + assessment.nioshDosePercent.toFixed(0) + '%</strong>' + (assessment.nioshTwa !== null ? ' (TWA ' + assessment.nioshTwa.toFixed(1) + ' dB(A))' : '') +
    ' · Factories Act dose <strong>' + assessment.indiaDosePercent.toFixed(0) + '%</strong>' + (assessment.indiaTwa !== null ? ' (TWA ' + assessment.indiaTwa.toFixed(1) + ' dB(A))' : '') + '</p>' +
    '<p class="hint">Microphone calibration: ' + escapeHtml(assessment.calibration || 'not recorded') + '.</p>';
  return html + '</div>';
}

function buildReport(worker) {
  const profile = buildWorkerRiskProfile(worker, storage.getPostureAssessments(), storage.getNoiseAssessments());
  const statuses = storage.getActionStatuses();
  const today = new Date();
  document.title = 'ErgoSafe report — ' + worker.name + ' — ' + today.toISOString().slice(0, 10);

  // ---- cover ----
  let html = '<header class="report-cover">' +
    '<div class="report-brand"><img src="icons/icon-192.png" alt="" width="44" height="44"><div><div class="report-kicker">ErgoSafe</div>' +
    '<h1>Workplace risk assessment</h1></div></div>' +
    '<dl class="report-meta">' +
      '<div><dt>Worker</dt><dd>' + escapeHtml(worker.name) + '</dd></div>' +
      '<div><dt>Workstation</dt><dd>' + escapeHtml(worker.workstation || '—') + '</dd></div>' +
      '<div><dt>Report date</dt><dd>' + formatDate(today.toISOString()) + '</dd></div>' +
      '<div><dt>Assessed by</dt><dd contenteditable="true" class="fill-in">&nbsp;</dd></div>' +
    '</dl></header>';

  // ---- 1. summary ----
  html += section(1, 'Summary', renderOverall(profile) +
    (profile.hazards.length ? '<h3>Hazards</h3>' + renderHazardTable(profile, false) : '') +
    '<h3>Top actions</h3><ol>' + profile.fourWOneH.how.map(function (item) { return '<li>' + escapeHtml(item) + '</li>'; }).join('') + '</ol>');

  // ---- 2. 4W1H ----
  html += section(2, '4W1H analysis', render4W1H(profile));

  // ---- 3. framework ----
  html += section(3, 'User vs Work characteristics', '<p class="hint">The five levels of the human factors framework, filled in with this worker\'s findings.</p>' + renderGraph(profile));

  // ---- 4. risk matrix ----
  html += section(4, 'Risk matrix (HIRA)', renderRiskMatrix(profile));

  // ---- 5. anthropometry ----
  const population = INDIAN_POPULATION[worker.sex];
  let anthropometry = '<p>' + escapeHtml(worker.name) + ' is ' + worker.statureCm + ' cm tall — taller than about <strong>' + Math.round(profile.percentile) + '%</strong> of ' +
    population.label.toLowerCase() + '. Works ' + (worker.workPosture === 'seated' ? 'seated' : 'standing') + ', ' + worker.taskType + ' work.</p>' +
    '<table class="data-table compact"><thead><tr><th>Recommended dimension</th><th>Value</th><th>Why</th></tr></thead><tbody>';
  for (const item of profile.workstation.recommendations) {
    anthropometry += '<tr><td>' + escapeHtml(item.label) + '</td><td class="nowrap"><strong>' + formatRangeMm(item.low, item.high) + '</strong></td><td>' + escapeHtml(item.note) + '</td></tr>';
  }
  anthropometry += '</tbody></table>';
  html += section(5, 'Anthropometric fit', anthropometry);

  // ---- 6. posture ----
  let postureHtml = '<h3>All postures</h3>' + renderPostureSummaryTable(profile) + '<h3>Each posture in detail</h3>';
  for (const hazard of profile.hazards) {
    if (hazard.type !== 'posture') continue;
    postureHtml += '<div class="report-hazard"><h3>' + hazard.code + ' · ' + escapeHtml(hazard.title) + '</h3><div class="report-pair">' +
      postureStateHtml(hazard.after ? 'Before fix' : 'Assessment', hazard.before.assessment) +
      (hazard.after ? postureStateHtml('After fix', hazard.after.assessment) : '') + '</div>' +
      (hazard.reduction ? '<p class="report-change"><strong>Result of the fix:</strong> ' + escapeHtml(hazard.reduction.text) + ' (' +
        (hazard.reduction.percent >= 0 ? '−' : '+') + Math.abs(hazard.reduction.percent).toFixed(0) + '%), HIRA rating ' + hazard.reduction.ratingText + '.</p>' : '') +
      '</div>';
  }
  html += section(6, 'Posture assessment (RULA / REBA)', profile.postureCount ? postureHtml : '<p class="empty">No posture assessment.</p>');

  // ---- 7. noise ----
  let noiseHtml = '';
  for (const hazard of profile.hazards) {
    if (hazard.type !== 'noise') continue;
    noiseHtml += '<div class="report-hazard"><h3>' + hazard.code + ' · Noise exposure</h3><div class="report-pair">' +
      noiseStateHtml(hazard.after ? 'Before fix' : 'Assessment', hazard.before.assessment) +
      (hazard.after ? noiseStateHtml('After fix', hazard.after.assessment) : '') + '</div>' +
      (hazard.reduction ? '<p class="report-change"><strong>Result of the fix:</strong> ' + escapeHtml(hazard.reduction.text) + ' (' +
        (hazard.reduction.percent >= 0 ? '−' : '+') + Math.abs(hazard.reduction.percent).toFixed(0) + '%), HIRA rating ' + hazard.reduction.ratingText + '.</p>' : '') +
      '</div>';
  }
  html += section(7, 'Noise exposure', noiseHtml || '<p class="empty">No noise assessment.</p>');

  // ---- 8. action plan ----
  html += section(8, 'Action plan', '<p class="hint">Ordered by the hierarchy of controls: change the workplace before relying on rules or protective equipment.</p>' +
    renderActionPlan(profile, statuses, false));

  // ---- 9. method ----
  html += section(9, 'Method and limitations',
    '<ul class="method-list">' +
      '<li><strong>Posture:</strong> RULA (McAtamney &amp; Corlett, 1993) and REBA (Hignett &amp; McAtamney, 2000). Joint angles measured from a side-view photo by in-browser pose detection (MediaPipe) and checked by the assessor.</li>' +
      '<li><strong>Noise:</strong> A-weighted level from a phone microphone; daily dose and TWA under NIOSH (85 dB(A), 3 dB exchange) and the Factories Act, India (90 dB(A), 5 dB exchange).</li>' +
      '<li><strong>Anthropometry:</strong> body dimensions estimated from stature using standard segment proportions; work-surface rules after Grandjean.</li>' +
      '<li><strong>Risk matrix:</strong> HIRA, severity × likelihood (1–25). Severity from the RULA/REBA level or the loudest noise level; likelihood from hours per shift and frequency. If posture and noise are both high, the overall risk is raised to very high (a conservative ErgoSafe rule).</li>' +
      '<li><strong>Overall posture score:</strong> the worst of the postures of the worker (up to 10), not an average — one dangerous posture is enough to cause injury.</li>' +
      '<li><strong>Limitations:</strong> a single 2-D photo cannot see twisting or side-bending (entered by the assessor); phone microphones are accurate to about ±2–5 dB only after calibration; estimated body dimensions should be measured directly when precision matters.</li>' +
      STORAGE_LIMITATION +
    '</ul>');

  // ---- sign-off ----
  html += '<section class="report-section signoff"><h2>Sign-off</h2><div class="signoff-grid">' +
    '<div><span>Assessed by</span><div class="sign-line"></div></div>' +
    '<div><span>Reviewed by (supervisor)</span><div class="sign-line"></div></div>' +
    '<div><span>Next review date</span><div class="sign-line"></div></div>' +
    '</div></section>';

  reportElement.innerHTML = html;
}

// ---------------------------------------------------------------
// Factory report: every worker, ranked from highest to lowest risk
// ---------------------------------------------------------------

function buildFactoryReport() {
  const table = buildFactoryTable(storage.getWorkers(), storage.getPostureAssessments(), storage.getNoiseAssessments());
  const today = new Date();
  document.title = 'ErgoSafe factory risk report — ' + today.toISOString().slice(0, 10);

  let html = '<header class="report-cover">' +
    '<div class="report-brand"><img src="icons/icon-192.png" alt="" width="44" height="44"><div><div class="report-kicker">ErgoSafe</div>' +
    '<h1>Factory risk assessment — all workers</h1></div></div>' +
    '<dl class="report-meta">' +
      '<div><dt>Site / factory</dt><dd contenteditable="true" class="fill-in">&nbsp;</dd></div>' +
      '<div><dt>Report date</dt><dd>' + formatDate(today.toISOString()) + '</dd></div>' +
      '<div><dt>Workers</dt><dd>' + table.rows.length + '</dd></div>' +
      '<div><dt>Prepared by</dt><dd contenteditable="true" class="fill-in">&nbsp;</dd></div>' +
    '</dl></header>';

  html += section(1, 'Summary', renderFactoryTotals(table));
  html += section(2, 'Workers ranked by risk', '<p class="hint">Highest risk first. Act on the top rows first. Full details for each worker are in their personal report.</p>' + renderFactoryTable(table, false));
  html += section(3, 'How the ranking works',
    '<ul class="method-list">' +
      '<li><strong>Overall posture score:</strong> the worst posture of each worker (RULA or REBA, up to 10 postures per worker). RULA (out of 7) and REBA (out of 15) are compared by risk level, not by raw number.</li>' +
      '<li><strong>Noise exposure:</strong> daily noise dose and 8-hour TWA under NIOSH (85 dB(A), 3 dB exchange); 100 % is the daily limit.</li>' +
      '<li><strong>Overall risk:</strong> the highest HIRA rating (severity × likelihood) among the hazards of the worker; raised to very high when posture and noise are both high (a conservative ErgoSafe rule). After-fix re-assessments count as the current status.</li>' +
      '<li><strong>Order:</strong> overall risk level, then HIRA rating, then posture score. Workers not yet assessed are listed last.</li>' +
      '<li><strong>Review due:</strong> the latest assessment of the worker is more than 6 months old.</li>' +
      STORAGE_LIMITATION +
    '</ul>');
  html += '<section class="report-section signoff"><h2>Sign-off</h2><div class="signoff-grid">' +
    '<div><span>Prepared by</span><div class="sign-line"></div></div>' +
    '<div><span>Approved by (factory manager)</span><div class="sign-line"></div></div>' +
    '<div><span>Next review date</span><div class="sign-line"></div></div>' +
    '</div></section>';

  reportElement.innerHTML = html;
}

// dashboard.js
// The Home screen: summary tiles, priority action list, noise results,
// worker overview and data export.

import * as storage from './storage.js';
import { computeRula } from './rula.js';
import { computeReba } from './reba.js';
import { generateRecommendations } from './recommendations.js';
import { analyseExposure, prepareNoiseReassessment } from './noise.js';
import { prepareReassessment } from './posture.js';
import { buildWorkerRiskProfile } from './riskModel.js';
import { riskBadge, escapeHtml, formatDate, downloadTextFile, toCsv, showToast, RISK_LEVELS } from './ui.js';

const RISK_RANK = { negligible: 0, low: 1, medium: 2, high: 3, veryhigh: 4 };

let elements = {};

export function initDashboardView() {
  elements = {
    summary: document.getElementById('home-summary'),
    priorityList: document.getElementById('home-priority-list'),
    noiseList: document.getElementById('home-noise-list'),
    workerTable: document.getElementById('home-worker-table'),
  };

  document.getElementById('export-postures-csv').addEventListener('click', exportPosturesCsv);
  document.getElementById('export-noise-csv').addEventListener('click', exportNoiseCsv);
  document.getElementById('export-json').addEventListener('click', function () {
    downloadTextFile('ergosafe-data.json', JSON.stringify(storage.exportAllData(), null, 2), 'application/json');
  });
  document.getElementById('load-sample-data').addEventListener('click', loadSampleData);
  document.getElementById('clear-all-data').addEventListener('click', function () {
    if (confirm('Delete ALL workers and assessments on this device? This cannot be undone.')) {
      storage.clearAllData();
      showToast('All data deleted.');
    }
  });

  elements.priorityList.addEventListener('click', function (event) {
    const reassessButton = event.target.closest('[data-reassess-posture]');
    if (reassessButton) {
      prepareReassessment(reassessButton.dataset.reassessPosture);
      return;
    }
    const button = event.target.closest('[data-delete-posture]');
    if (button && confirm('Delete this posture assessment and any after-fix re-assessments of it?')) {
      const assessmentId = button.dataset.deletePosture;
      for (const assessment of storage.getPostureAssessments()) {
        if (assessment.baselineId === assessmentId) storage.deletePostureAssessment(assessment.id);
      }
      storage.deletePostureAssessment(assessmentId);
    }
  });
  elements.noiseList.addEventListener('click', function (event) {
    const reassessButton = event.target.closest('[data-reassess-noise]');
    if (reassessButton) {
      prepareNoiseReassessment(reassessButton.dataset.reassessNoise);
      return;
    }
    const button = event.target.closest('[data-delete-noise]');
    if (button && confirm('Delete this noise assessment and any after-fix re-assessments of it?')) {
      const assessmentId = button.dataset.deleteNoise;
      for (const assessment of storage.getNoiseAssessments()) {
        if (assessment.baselineId === assessmentId) storage.deleteNoiseAssessment(assessment.id);
      }
      storage.deleteNoiseAssessment(assessmentId);
    }
  });
  elements.workerTable.addEventListener('click', function (event) {
    const button = event.target.closest('[data-open-profile]');
    if (button) {
      storage.saveSettings({ activeWorkerId: button.dataset.openProfile });
      window.location.hash = '#risk-worker';
    }
  });
}

function findById(list, id) {
  for (const item of list) {
    if (item.id === id) return item;
  }
  return null;
}

function primaryResult(assessment) {
  return assessment.method === 'rula' ? assessment.rula : assessment.reba;
}

export function refreshDashboardView() {
  const workers = storage.getWorkers();
  const postures = storage.getPostureAssessments();
  const noiseAssessments = storage.getNoiseAssessments();

  // ---- summary tiles ----
  let highPostures = 0;
  for (const assessment of postures) {
    if (RISK_RANK[primaryResult(assessment).riskLevel] >= RISK_RANK.high) highPostures++;
  }
  let overLimit = 0;
  for (const assessment of noiseAssessments) {
    if (RISK_RANK[assessment.riskLevel] >= RISK_RANK.high) overLimit++;
  }
  elements.summary.innerHTML =
    tile(workers.length, 'Workers', null) +
    tile(postures.length, 'Posture assessments', null) +
    tile(highPostures, 'High-risk postures', highPostures > 0 ? 'high' : 'low') +
    tile(overLimit, 'Over noise limit', overLimit > 0 ? 'high' : 'low');

  // ---- priority list ----
  const sorted = postures.slice().sort(function (first, second) {
    const rankDifference = RISK_RANK[primaryResult(second).riskLevel] - RISK_RANK[primaryResult(first).riskLevel];
    if (rankDifference !== 0) return rankDifference;
    return primaryResult(second).finalScore / (second.method === 'rula' ? 7 : 15) - primaryResult(first).finalScore / (first.method === 'rula' ? 7 : 15);
  });
  if (sorted.length === 0) {
    elements.priorityList.innerHTML = '<p class="empty">No posture assessments yet. Go to <a href="#posture">Posture</a> to make one, or load sample data below.</p>';
  } else {
    let html = '';
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
    elements.priorityList.innerHTML = html;
  }

  // ---- noise list ----
  if (noiseAssessments.length === 0) {
    elements.noiseList.innerHTML = '<p class="empty">No noise assessments yet. Go to <a href="#noise">Noise</a> to measure.</p>';
  } else {
    let html = '';
    const sortedNoise = noiseAssessments.slice().sort(function (first, second) { return second.nioshDosePercent - first.nioshDosePercent; });
    for (const assessment of sortedNoise) {
      const zones = assessment.entries.map(function (entry) { return entry.zone + ' ' + entry.levelDb.toFixed(0) + ' dB(A) × ' + entry.hours + ' h'; }).join(', ');
      html += '<article class="assessment-card risk-border-' + assessment.riskLevel + '">' +
        '<div class="thumb-placeholder" aria-hidden="true">dB</div>' +
        '<div class="assessment-body">' +
          '<div class="assessment-title"><strong>' + escapeHtml(assessment.workerName) + '</strong>' + riskBadge(assessment.riskLevel, assessment.statusLabel) + '</div>' +
          '<p>NIOSH dose <strong>' + assessment.nioshDosePercent.toFixed(0) + '%</strong> · Factories Act dose <strong>' + assessment.indiaDosePercent.toFixed(0) + '%</strong>' +
          (assessment.nioshTwa !== null ? ' · TWA ' + assessment.nioshTwa.toFixed(1) + ' dB(A)' : '') + '</p>' +
          '<p class="hint">' + escapeHtml(zones) + ' · ' + formatDate(assessment.date) + '</p>' +
          (assessment.baselineId && findById(noiseAssessments, assessment.baselineId)
            ? '<p class="follow-up-note">After fix: dose ' + findById(noiseAssessments, assessment.baselineId).nioshDosePercent.toFixed(0) + '% → ' + assessment.nioshDosePercent.toFixed(0) + '%</p>' : '') +
          '<div class="card-actions"><button type="button" class="button small" data-reassess-noise="' + (assessment.baselineId || assessment.id) + '">Re-assess after fix</button>' +
          '<button type="button" class="link-button" data-delete-noise="' + assessment.id + '">Delete</button></div>' +
        '</div></article>';
    }
    elements.noiseList.innerHTML = html;
  }

  // ---- worker table ----
  if (workers.length === 0) {
    elements.workerTable.innerHTML = '<p class="empty">No workers yet.</p>';
  } else {
    let html = '<table class="data-table"><thead><tr><th>Worker</th><th>Overall risk</th><th>Worst posture</th><th>Noise dose (NIOSH)</th><th><span class="visually-hidden">Profile</span></th></tr></thead><tbody>';
    for (const worker of workers) {
      let worst = null;
      for (const assessment of postures) {
        if (assessment.workerId === worker.id && (!worst || RISK_RANK[primaryResult(assessment).riskLevel] > RISK_RANK[primaryResult(worst).riskLevel])) {
          worst = assessment;
        }
      }
      let latestNoise = null;
      for (const assessment of noiseAssessments) {
        if (assessment.workerId === worker.id && (!latestNoise || assessment.date > latestNoise.date)) {
          latestNoise = assessment;
        }
      }
      const profile = buildWorkerRiskProfile(worker, postures, noiseAssessments);
      const overall = profile.overallLevel === 'none' ? '—' : riskBadge(profile.overallLevel);
      html += '<tr><td>' + escapeHtml(worker.name) + '<br><span class="hint">' + escapeHtml(worker.workstation || '') + '</span></td><td>' + overall + '</td><td>' +
        (worst ? riskBadge(primaryResult(worst).riskLevel, worst.method.toUpperCase() + ' ' + primaryResult(worst).finalScore) : '—') + '</td><td>' +
        (latestNoise ? riskBadge(latestNoise.riskLevel, latestNoise.nioshDosePercent.toFixed(0) + '%') : '—') + '</td>' +
        '<td><button type="button" class="button small" data-open-profile="' + worker.id + '">Risk profile</button></td></tr>';
    }
    html += '</tbody></table>';
    elements.workerTable.innerHTML = html;
  }
}

function tile(value, label, levelKey) {
  return '<div class="tile' + (levelKey ? ' tile-' + levelKey : '') + '"><span class="tile-value">' + value + '</span><span class="tile-label">' + label + '</span></div>';
}

// ---------------------------------------------------------------
// Export
// ---------------------------------------------------------------

function exportPosturesCsv() {
  const rows = [['id', 'date', 'worker', 'task', 'method', 'trunk', 'neck', 'upperArm', 'lowerArm', 'wrist', 'knee',
    'anglesEdited', 'seated', 'loadKg', 'rulaScore', 'rulaRisk', 'rebaScore', 'rebaRisk', 'topRecommendation']];
  for (const assessment of storage.getPostureAssessments()) {
    const edited = [];
    for (const key in assessment.angleSource) {
      if (assessment.angleSource[key] === 'edited') edited.push(key);
    }
    rows.push([assessment.id, assessment.date, assessment.workerName, assessment.task, assessment.method,
      assessment.angles.trunk, assessment.angles.neck, assessment.angles.upperArm, assessment.angles.lowerArm, assessment.angles.wrist, assessment.angles.knee,
      edited.join(' '), assessment.factors.seated, assessment.factors.loadKg,
      assessment.rula.finalScore, assessment.rula.riskLevel, assessment.reba.finalScore, assessment.reba.riskLevel,
      assessment.recommendations && assessment.recommendations[0] ? assessment.recommendations[0].action : '']);
  }
  downloadTextFile('ergosafe-postures.csv', toCsv(rows), 'text/csv');
}

function exportNoiseCsv() {
  const rows = [['id', 'date', 'worker', 'zone', 'levelDbA', 'hours', 'source', 'shiftLeq', 'nioshDosePercent', 'nioshTwa', 'indiaDosePercent', 'indiaTwa', 'calibration']];
  for (const assessment of storage.getNoiseAssessments()) {
    for (const entry of assessment.entries) {
      rows.push([assessment.id, assessment.date, assessment.workerName, entry.zone, entry.levelDb, entry.hours, entry.source,
        assessment.leq === null ? '' : assessment.leq.toFixed(1), assessment.nioshDosePercent.toFixed(1),
        assessment.nioshTwa === null ? '' : assessment.nioshTwa.toFixed(1), assessment.indiaDosePercent.toFixed(1),
        assessment.indiaTwa === null ? '' : assessment.indiaTwa.toFixed(1), assessment.calibration]);
    }
  }
  downloadTextFile('ergosafe-noise.csv', toCsv(rows), 'text/csv');
}

// ---------------------------------------------------------------
// Sample data for demonstrations
// ---------------------------------------------------------------

function loadSampleData() {
  const sampleWorkers = [
    { id: 'sample-w1', name: 'Ravi (sample)', sex: 'male', statureCm: 168, massKg: 64, workPosture: 'standing', taskType: 'heavy', workstation: 'Warehouse — loading bay' },
    { id: 'sample-w2', name: 'Meena (sample)', sex: 'female', statureCm: 152, massKg: 52, workPosture: 'seated', taskType: 'precision', workstation: 'Electronics assembly' },
    { id: 'sample-w3', name: 'Arjun (sample)', sex: 'male', statureCm: 175, massKg: 72, workPosture: 'standing', taskType: 'light', workstation: 'Press shop' },
    { id: 'sample-w4', name: 'Lakshmi (sample)', sex: 'female', statureCm: 155, massKg: 55, workPosture: 'standing', taskType: 'light', workstation: 'Packing line 2' },
    { id: 'sample-w5', name: 'Imran (sample)', sex: 'male', statureCm: 170, massKg: 68, workPosture: 'standing', taskType: 'light', workstation: 'Quality inspection' },
  ];
  for (const worker of sampleWorkers) {
    storage.saveWorker(worker);
  }

  const baseFactors = {
    shoulderRaised: false, armAbducted: false, armSupported: false, armAcrossMidline: false, wristDeviated: false,
    wristTwistEndRange: false, neckTwisted: false, neckSideBent: false, trunkTwisted: false, trunkSideBent: false,
    trunkWellSupported: false, legsSupported: true, seated: false, loadKg: 0, loadPattern: 'intermittent', coupling: 0,
    staticOver1Min: false, repeatedOver4PerMin: false, rapidOrUnstable: false,
  };
  const samplePostures = [
    { id: 'sample-p1', worker: sampleWorkers[0], task: 'Lifting cartons from floor pallet', method: 'reba',
      angles: { trunk: 72, neck: 25, upperArm: 70, lowerArm: 30, wrist: 10, knee: 35 },
      factors: { loadKg: 14, loadPattern: 'intermittent', coupling: 2, trunkTwisted: true, repeatedOver4PerMin: true },
      exposure: { hoursPerShift: 5, frequency: 'frequently' }, minutesAgo: 60 },
    { id: 'sample-p2', worker: sampleWorkers[0], task: 'Lifting cartons from floor pallet (after fix)', method: 'reba', baselineId: 'sample-p1',
      angles: { trunk: 15, neck: 10, upperArm: 30, lowerArm: 70, wrist: 5, knee: 10 },
      factors: { loadKg: 14, loadPattern: 'intermittent', coupling: 1, repeatedOver4PerMin: true },
      exposure: { hoursPerShift: 5, frequency: 'frequently' }, minutesAgo: 5 },
    { id: 'sample-p3', worker: sampleWorkers[1], task: 'Soldering circuit boards', method: 'rula',
      angles: { trunk: 25, neck: 38, upperArm: 35, lowerArm: 110, wrist: 20, knee: 85 },
      factors: { seated: true, staticOver1Min: true, shoulderRaised: true, wristDeviated: true },
      exposure: { hoursPerShift: 7, frequency: 'continuously' }, minutesAgo: 40 },
    { id: 'sample-p4', worker: sampleWorkers[2], task: 'Feeding sheets into press', method: 'reba',
      angles: { trunk: 10, neck: 15, upperArm: 95, lowerArm: 40, wrist: 15, knee: 5 },
      factors: { loadKg: 4, repeatedOver4PerMin: true, armAbducted: true, staticOver1Min: true },
      exposure: { hoursPerShift: 4, frequency: 'frequently' }, minutesAgo: 30 },
    { id: 'sample-p5', worker: sampleWorkers[0], task: 'Taping cartons at packing table', method: 'reba',
      angles: { trunk: 25, neck: 30, upperArm: 40, lowerArm: 75, wrist: 20, knee: 5 },
      factors: { repeatedOver4PerMin: true, staticOver1Min: true },
      exposure: { hoursPerShift: 2, frequency: 'frequently' }, minutesAgo: 50 },
    { id: 'sample-p6', worker: sampleWorkers[3], task: 'Reaching to top shelf for rolls', method: 'reba',
      angles: { trunk: -5, neck: -15, upperArm: 120, lowerArm: 30, wrist: 10, knee: 5 },
      factors: { loadKg: 6, shoulderRaised: true },
      exposure: { hoursPerShift: 1.5, frequency: 'occasionally' }, minutesAgo: 200 * 24 * 60 },
  ];
  for (const sample of samplePostures) {
    const factors = Object.assign({}, baseFactors, sample.factors);
    const rula = computeRula({ angles: sample.angles, factors: factors });
    const reba = computeReba({ angles: sample.angles, factors: factors });
    storage.savePostureAssessment({
      id: sample.id,
      date: new Date(Date.now() - sample.minutesAgo * 60000).toISOString(),
      exposure: sample.exposure,
      baselineId: sample.baselineId || null,
      durationSeconds: null,
      workerId: sample.worker.id,
      workerName: sample.worker.name,
      task: sample.task,
      method: sample.method,
      angles: sample.angles,
      angleSource: {},
      factors: factors,
      rula: { finalScore: rula.finalScore, riskLevel: rula.riskLevel, actionText: rula.actionText, parts: {} },
      reba: { finalScore: reba.finalScore, riskLevel: reba.riskLevel, actionText: reba.actionText, parts: {} },
      recommendations: generateRecommendations({ angles: sample.angles, factors: factors, worker: sample.worker }),
      thumbnail: null,
    });
  }

  const sampleNoise = [
    { id: 'sample-n1', worker: sampleWorkers[2], entries: [
      { zone: 'Power press', levelDb: 96, hours: 4, source: 'manual' },
      { zone: 'Store room', levelDb: 78, hours: 3, source: 'manual' },
      { zone: 'Canteen', levelDb: 70, hours: 1, source: 'manual' }] },
    { id: 'sample-n2', worker: sampleWorkers[1], entries: [
      { zone: 'Assembly hall', levelDb: 74, hours: 7.5, source: 'manual' }] },
    // After fix: press enclosure (96 → 88 dB(A)) and rotation (4 h → 2 h in the press area).
    { id: 'sample-n3', worker: sampleWorkers[2], baselineId: 'sample-n1', minutesAgo: 2, entries: [
      { zone: 'Power press', levelDb: 88, hours: 2, source: 'manual' },
      { zone: 'Store room', levelDb: 78, hours: 5, source: 'manual' },
      { zone: 'Canteen', levelDb: 70, hours: 1, source: 'manual' }] },
  ];
  for (const sample of sampleNoise) {
    const analysis = analyseExposure(sample.entries);
    const status = analysis.results.niosh.status;
    storage.saveNoiseAssessment({
      id: sample.id,
      baselineId: sample.baselineId || null,
      durationSeconds: null,
      date: new Date(Date.now() - (sample.minutesAgo || 20) * 60000).toISOString(),
      workerId: sample.worker.id,
      workerName: sample.worker.name,
      standard: 'niosh',
      entries: sample.entries,
      leq: analysis.leq,
      totalHours: analysis.totalHours,
      nioshDosePercent: analysis.results.niosh.dosePercent,
      nioshTwa: analysis.results.niosh.twa,
      indiaDosePercent: analysis.results.india.dosePercent,
      indiaTwa: analysis.results.india.twa,
      riskLevel: status.riskLevel,
      statusLabel: status.label,
      calibration: 'manual',
    });
  }
  showToast('Sample workers and assessments loaded.');
}

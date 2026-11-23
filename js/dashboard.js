// dashboard.js
// The Home screen: summary tiles and data export.

import * as storage from './storage.js';
import { computeRula } from './rula.js';
import { computeReba } from './reba.js';
import { generateRecommendations } from './recommendations.js';
import { analyseExposure } from './noise.js';
import { buildWorkerRiskProfile } from './riskModel.js';
import { downloadTextFile, toCsv, showToast } from './ui.js';

const RISK_RANK = { negligible: 0, low: 1, medium: 2, high: 3, veryhigh: 4 };

let elements = {};

export function initDashboardView() {
  elements = {
    summary: document.getElementById('home-summary'),
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
  // Workers due for a risk assessment: never assessed, or their latest
  // assessment is more than 6 months old.
  let assessmentDue = 0;
  for (const worker of workers) {
    const profile = buildWorkerRiskProfile(worker, postures, noiseAssessments);
    if (profile.latestDate === null || profile.reviewDue) assessmentDue++;
  }
  // How many workers have at least one posture / noise assessment.
  let postureDone = 0;
  let noiseDone = 0;
  for (const worker of workers) {
    if (postures.some(function (assessment) { return assessment.workerId === worker.id; })) postureDone++;
    if (noiseAssessments.some(function (assessment) { return assessment.workerId === worker.id; })) noiseDone++;
  }
  function coverageLevel(done) {
    if (workers.length === 0) return null;
    return done === workers.length ? 'low' : 'medium';   // green when everyone is assessed
  }
  elements.summary.innerHTML =
    tile(postureDone + ' / ' + workers.length, 'Workers with posture assessed', coverageLevel(postureDone)) +
    tile(noiseDone + ' / ' + workers.length, 'Workers with noise assessed', coverageLevel(noiseDone)) +
    tile(highPostures, 'High-risk postures', highPostures > 0 ? 'high' : 'low') +
    tile(overLimit, 'Over noise limit', overLimit > 0 ? 'high' : 'low') +
    tile(assessmentDue, 'Workers due for risk assessment (new or > 6 months)', assessmentDue > 0 ? 'medium' : 'low');
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

// noise.js
// The Noise screen: live A-weighted sound level from the microphone,
// calibration, the worker's daily exposure (dose, TWA) and control measures.

import * as storage from './storage.js';
import {
  NOISE_STANDARDS, allowedHours, dailyDosePercent, timeWeightedAverage,
  equivalentLevel, doseStatus, aWeightingDb, generateNoiseActions,
} from './noiseMath.js';
import { riskBadge, escapeHtml, showToast, formatHours } from './ui.js';

const UPDATE_INTERVAL_MS = 125;   // "fast" time weighting on sound level meters
const RECENT_READINGS = 16;       // about 2 seconds, used for calibration
const DEFAULT_OFFSET = 110;
const MINIMUM_LEVEL = 20;

const meter = {
  running: false,
  audioContext: null,
  stream: null,
  analyser: null,
  frequencyData: null,
  weights: null,
  timer: null,
  energySum: 0,
  readingCount: 0,
  maxLevel: null,
  startTime: 0,
  elapsedMs: 0,
  recentRawLevels: [],
  currentLevel: null,
};

let elements = {};

export function initNoiseView() {
  elements = {
    level: document.getElementById('noise-level'),
    levelBadge: document.getElementById('noise-level-badge'),
    needle: document.getElementById('gauge-needle'),
    leq: document.getElementById('noise-leq'),
    max: document.getElementById('noise-max'),
    duration: document.getElementById('noise-duration'),
    allowed: document.getElementById('noise-allowed'),
    startButton: document.getElementById('noise-start-button'),
    stopButton: document.getElementById('noise-stop-button'),
    resetButton: document.getElementById('noise-reset-button'),
    status: document.getElementById('noise-status'),
    zoneInput: document.getElementById('noise-zone-input'),
    hoursInput: document.getElementById('noise-hours-input'),
    addToLogButton: document.getElementById('noise-add-to-log-button'),
    standardSelect: document.getElementById('noise-standard'),
    exposureRows: document.getElementById('exposure-rows'),
    manualZone: document.getElementById('manual-zone'),
    manualLevel: document.getElementById('manual-level'),
    manualHours: document.getElementById('manual-hours'),
    manualAddButton: document.getElementById('manual-add-button'),
    exposureResults: document.getElementById('exposure-results'),
    recommendations: document.getElementById('noise-recommendations'),
    saveButton: document.getElementById('noise-save-button'),
    calibrationBadge: document.getElementById('calibration-badge'),
    calibrationReference: document.getElementById('calibration-reference'),
    calibrateButton: document.getElementById('calibrate-button'),
    roughCalibrateButton: document.getElementById('rough-calibrate-button'),
    resetCalibrationButton: document.getElementById('reset-calibration-button'),
    calibrationOffset: document.getElementById('calibration-offset'),
  };

  elements.startButton.addEventListener('click', startMeter);
  elements.stopButton.addEventListener('click', stopMeter);
  elements.resetButton.addEventListener('click', resetMeterStatistics);
  elements.addToLogButton.addEventListener('click', addMeasuredLevel);
  elements.manualAddButton.addEventListener('click', addManualLevel);
  elements.saveButton.addEventListener('click', saveNoiseAssessment);
  elements.calibrateButton.addEventListener('click', calibrateToReference);
  elements.roughCalibrateButton.addEventListener('click', calibrateRough);
  elements.resetCalibrationButton.addEventListener('click', resetCalibration);
  elements.standardSelect.addEventListener('change', function () {
    storage.saveSettings({ noiseStandard: elements.standardSelect.value });
  });
  document.getElementById('noise-reassess-banner').addEventListener('click', function (event) {
    if (event.target.closest('[data-cancel-noise-reassess]')) {
      storage.saveSettings({ noiseBaselineId: null });
    }
  });
  elements.exposureRows.addEventListener('click', function (event) {
    const button = event.target.closest('[data-remove-index]');
    if (button) {
      const entries = getDraftEntries();
      entries.splice(Number(button.dataset.removeIndex), 1);
      saveDraftEntries(entries);
    }
  });

  renderMeter();
}

export function refreshNoiseView() {
  const settings = storage.getSettings();
  elements.standardSelect.value = settings.noiseStandard;
  renderCalibration();
  renderExposure();
}

export function leaveNoiseView() {
  stopMeter();
}

function currentStandard() {
  return NOISE_STANDARDS[storage.getSettings().noiseStandard] || NOISE_STANDARDS.niosh;
}

function setStatus(message, isError) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', Boolean(isError));
}

// ---------------------------------------------------------------
// Live meter
// ---------------------------------------------------------------

async function startMeter() {
  if (meter.running) {
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('This browser cannot use the microphone.', true);
    return;
  }
  try {
    // Switch off the phone's voice processing — it would hide the real level.
    meter.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  } catch (error) {
    setStatus('Microphone permission was refused or no microphone was found.', true);
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  meter.audioContext = new AudioContextClass();
  if (meter.audioContext.state === 'suspended') {
    await meter.audioContext.resume();
  }
  const source = meter.audioContext.createMediaStreamSource(meter.stream);
  meter.analyser = meter.audioContext.createAnalyser();
  meter.analyser.fftSize = 4096;
  meter.analyser.smoothingTimeConstant = 0;
  source.connect(meter.analyser);

  // Pre-compute the A-weighting factor for every frequency bin.
  const binCount = meter.analyser.frequencyBinCount;
  const binWidthHz = meter.audioContext.sampleRate / meter.analyser.fftSize;
  meter.frequencyData = new Float32Array(binCount);
  meter.weights = new Float32Array(binCount);
  for (let bin = 1; bin < binCount; bin++) {
    const frequency = bin * binWidthHz;
    meter.weights[bin] = frequency < 20 ? 0 : Math.pow(10, aWeightingDb(frequency) / 10);
  }

  meter.running = true;
  meter.startTime = performance.now() - meter.elapsedMs;
  meter.timer = setInterval(takeReading, UPDATE_INTERVAL_MS);
  elements.startButton.disabled = true;
  elements.stopButton.disabled = false;
  setStatus('Measuring… hold the phone at the worker\'s ear position, away from your body.');
}

function takeReading() {
  meter.analyser.getFloatFrequencyData(meter.frequencyData);
  let weightedPower = 0;
  for (let bin = 1; bin < meter.frequencyData.length; bin++) {
    const binDb = meter.frequencyData[bin];
    if (isFinite(binDb)) {
      weightedPower += Math.pow(10, binDb / 10) * meter.weights[bin];
    }
  }
  // Complete digital silence gives no power at all; treat it as the floor.
  const rawLevel = weightedPower > 0 ? 10 * Math.log10(weightedPower) : -200;
  // Nothing real is quieter than about 20 dB(A), so that is the meter's floor.
  const level = Math.max(MINIMUM_LEVEL, rawLevel + storage.getSettings().microphoneOffset);

  meter.recentRawLevels.push(rawLevel);
  if (meter.recentRawLevels.length > RECENT_READINGS) {
    meter.recentRawLevels.shift();
  }
  meter.currentLevel = level;
  meter.energySum += Math.pow(10, level / 10);
  meter.readingCount += 1;
  meter.maxLevel = meter.maxLevel === null ? level : Math.max(meter.maxLevel, level);
  meter.elapsedMs = performance.now() - meter.startTime;
  renderMeter();
}

function stopMeter() {
  if (!meter.running) {
    return;
  }
  meter.running = false;
  clearInterval(meter.timer);
  if (meter.stream) {
    for (const track of meter.stream.getTracks()) {
      track.stop();
    }
  }
  if (meter.audioContext) {
    meter.audioContext.close();
  }
  meter.stream = null;
  meter.audioContext = null;
  elements.startButton.disabled = false;
  elements.stopButton.disabled = true;
  setStatus(meter.readingCount > 0 ? 'Stopped. Add the average level to the worker\'s day below.' : '');
}

function resetMeterStatistics() {
  meter.energySum = 0;
  meter.readingCount = 0;
  meter.maxLevel = null;
  meter.elapsedMs = 0;
  meter.startTime = performance.now();
  meter.currentLevel = meter.running ? meter.currentLevel : null;
  renderMeter();
}

function averageLevel() {
  if (meter.readingCount === 0) {
    return null;
  }
  return 10 * Math.log10(meter.energySum / meter.readingCount);
}

function levelRisk(levelDb, standard) {
  if (levelDb > standard.ceiling) {
    return { riskLevel: 'veryhigh', text: 'Above the ceiling — no unprotected exposure' };
  }
  const hours = allowedHours(levelDb, standard);
  if (hours >= 8) return { riskLevel: 'low', text: 'Safe for a full 8-hour shift' };
  if (hours >= 2) return { riskLevel: 'medium', text: 'Limit exposure to ' + formatHours(hours) };
  return { riskLevel: 'high', text: 'Hazardous — only ' + formatHours(hours) + ' allowed' };
}

function renderMeter() {
  const standard = currentStandard();
  const level = meter.currentLevel;
  if (level === null) {
    elements.level.textContent = '--';
    elements.levelBadge.innerHTML = '';
    elements.needle.style.left = '0%';
  } else {
    elements.level.textContent = level.toFixed(1);
    const risk = levelRisk(level, standard);
    elements.levelBadge.innerHTML = riskBadge(risk.riskLevel, risk.text);
    const position = Math.max(0, Math.min(1, (level - 30) / 100));
    elements.needle.style.left = (position * 100) + '%';
  }
  const leq = averageLevel();
  elements.leq.textContent = leq === null ? '--' : leq.toFixed(1) + ' dB(A)';
  elements.max.textContent = meter.maxLevel === null ? '--' : meter.maxLevel.toFixed(1) + ' dB(A)';
  const seconds = Math.round(meter.elapsedMs / 1000);
  elements.duration.textContent = meter.readingCount === 0 ? '--' : Math.floor(seconds / 60) + ' min ' + (seconds % 60) + ' s';
  elements.allowed.textContent = leq === null ? '--' : formatHours(allowedHours(leq, standard)) + ' (' + standard.shortLabel + ')';
}

// ---------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------

function recentRawAverage() {
  if (meter.recentRawLevels.length === 0) {
    return null;
  }
  let energy = 0;
  for (const raw of meter.recentRawLevels) {
    energy += Math.pow(10, raw / 10);
  }
  return 10 * Math.log10(energy / meter.recentRawLevels.length);
}

function calibrateToReference() {
  const reference = parseFloat(elements.calibrationReference.value);
  if (!meter.running) {
    showToast('Start measuring first, with the phone next to the reference meter.');
    return;
  }
  if (!isFinite(reference) || reference < 30 || reference > 130) {
    showToast('Enter the reference meter reading (30–130 dB(A)).');
    return;
  }
  const raw = recentRawAverage();
  if (raw === null) {
    return;
  }
  storage.saveSettings({ microphoneOffset: reference - raw, microphoneCalibration: 'reference' });
  resetMeterStatistics();
  showToast('Calibrated to the reference meter.');
}

function calibrateRough() {
  if (!meter.running) {
    showToast('Start measuring first, in a quiet room.');
    return;
  }
  const raw = recentRawAverage();
  if (raw === null) {
    return;
  }
  storage.saveSettings({ microphoneOffset: 40 - raw, microphoneCalibration: 'rough' });
  resetMeterStatistics();
  showToast('Roughly calibrated (quiet room ≈ 40 dB(A)).');
}

function resetCalibration() {
  storage.saveSettings({ microphoneOffset: DEFAULT_OFFSET, microphoneCalibration: 'none' });
  resetMeterStatistics();
  showToast('Calibration reset.');
}

function renderCalibration() {
  const settings = storage.getSettings();
  let badge;
  if (settings.microphoneCalibration === 'reference') {
    badge = riskBadge('low', 'Calibrated to a reference meter');
  } else if (settings.microphoneCalibration === 'rough') {
    badge = riskBadge('medium', 'Roughly calibrated — about ±5 dB');
  } else {
    badge = riskBadge('high', 'Not calibrated — readings are approximate (±10 dB)');
  }
  elements.calibrationBadge.innerHTML = badge;
  elements.calibrationOffset.textContent = 'Current microphone offset: ' + settings.microphoneOffset.toFixed(1) + ' dB.';
}

// ---------------------------------------------------------------
// Daily exposure (draft kept in settings until saved)
// ---------------------------------------------------------------

function getDraftEntries() {
  const draft = storage.getSettings().noiseDraft;
  return Array.isArray(draft) ? draft.slice() : [];
}

function saveDraftEntries(entries) {
  const changes = { noiseDraft: entries };
  // Start the "time taken" clock when the first zone is added.
  if (entries.length > 0 && !storage.getSettings().noiseDraftStartedAt) {
    changes.noiseDraftStartedAt = Date.now();
  }
  storage.saveSettings(changes);
}

function findNoiseAssessment(assessmentId) {
  for (const assessment of storage.getNoiseAssessments()) {
    if (assessment.id === assessmentId) return assessment;
  }
  return null;
}

// Called from the Home and Risk screens: "Re-assess after fix".
// Loads the original zones so the user can update the levels / hours that
// the fix changed (e.g. a machine enclosure, job rotation).
export function prepareNoiseReassessment(assessmentId) {
  const baseline = findNoiseAssessment(assessmentId);
  if (!baseline) {
    return;
  }
  const entries = [];
  for (const entry of baseline.entries) {
    entries.push(Object.assign({}, entry));
  }
  const changes = { noiseDraft: entries, noiseBaselineId: baseline.id, noiseDraftStartedAt: Date.now(), noiseStandard: baseline.standard };
  if (baseline.workerId) {
    changes.activeWorkerId = baseline.workerId;
  }
  storage.saveSettings(changes);
  window.location.hash = '#noise';
  window.scrollTo(0, 0);
}

function renderNoiseReassessBanner(analysis) {
  const banner = document.getElementById('noise-reassess-banner');
  const baselineId = storage.getSettings().noiseBaselineId;
  const baseline = baselineId ? findNoiseAssessment(baselineId) : null;
  if (!baseline) {
    banner.hidden = true;
    banner.innerHTML = '';
    return;
  }
  let comparison = '';
  if (analysis) {
    const before = baseline.nioshDosePercent;
    const now = analysis.results.niosh.dosePercent;
    const change = before === 0 ? 0 : ((before - now) / before) * 100;
    let verdict;
    if (now < before) verdict = riskBadge('low', 'Improved ' + change.toFixed(0) + '%');
    else if (now === before) verdict = riskBadge('medium', 'No change yet');
    else verdict = riskBadge('high', 'Worse by ' + Math.abs(change).toFixed(0) + '%');
    comparison = '<div class="comparison"><span>Before fix: <strong>' + before.toFixed(0) + '%</strong></span><span aria-hidden="true">→</span>' +
      '<span>Now: <strong>' + now.toFixed(0) + '%</strong> (NIOSH dose)</span>' + verdict + '</div>';
  }
  banner.hidden = false;
  banner.innerHTML = '<p><strong>Re-assessing after a fix:</strong> noise for ' + escapeHtml(baseline.workerName) +
    '. Update the zones the fix changed — re-measure the level, or change the hours.</p>' + comparison +
    '<button type="button" class="link-button" data-cancel-noise-reassess>Cancel re-assessment</button>';
}

function addMeasuredLevel() {
  const leq = averageLevel();
  if (leq === null) {
    showToast('Measure the zone first (press Start measuring).');
    return;
  }
  const hours = parseFloat(elements.hoursInput.value);
  if (!isFinite(hours) || hours <= 0) {
    showToast('Enter the hours per shift spent in this zone.');
    return;
  }
  const entries = getDraftEntries();
  entries.push({
    zone: elements.zoneInput.value.trim() || 'Zone ' + (entries.length + 1),
    levelDb: Math.round(leq * 10) / 10,
    hours: hours,
    source: 'measured',
    calibration: storage.getSettings().microphoneCalibration,
  });
  saveDraftEntries(entries);
  elements.zoneInput.value = '';
  showToast('Added to the worker\'s day.');
}

function addManualLevel() {
  const level = parseFloat(elements.manualLevel.value);
  const hours = parseFloat(elements.manualHours.value);
  if (!isFinite(level) || !isFinite(hours) || hours <= 0) {
    showToast('Enter both the level and the hours.');
    return;
  }
  const entries = getDraftEntries();
  entries.push({
    zone: elements.manualZone.value.trim() || 'Zone ' + (entries.length + 1),
    levelDb: level,
    hours: hours,
    source: 'manual',
  });
  saveDraftEntries(entries);
  elements.manualZone.value = '';
  elements.manualLevel.value = '';
  elements.manualHours.value = '';
}

// Works out everything for a list of entries.
export function analyseExposure(entries) {
  const results = {};
  for (const key in NOISE_STANDARDS) {
    const standard = NOISE_STANDARDS[key];
    const dose = dailyDosePercent(entries, standard);
    results[key] = {
      dosePercent: dose,
      twa: timeWeightedAverage(dose, standard),
      status: doseStatus(dose, entries, standard),
    };
  }
  let totalHours = 0;
  for (const entry of entries) {
    totalHours += entry.hours;
  }
  return { results: results, leq: equivalentLevel(entries), totalHours: totalHours };
}

function renderExposure() {
  const standard = currentStandard();
  const entries = getDraftEntries();

  let rows = '';
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const allowed = allowedHours(entry.levelDb, standard);
    const dose = isFinite(allowed) ? (entry.hours / allowed) * 100 : 0;
    rows += '<tr><td>' + escapeHtml(entry.zone) + (entry.source === 'measured' ? ' <span class="tag tag-auto">measured</span>' : '') + '</td>' +
      '<td>' + entry.levelDb.toFixed(1) + '</td><td>' + entry.hours + '</td><td>' + formatHours(allowed) + '</td>' +
      '<td>' + dose.toFixed(0) + '%</td>' +
      '<td><button type="button" class="link-button" data-remove-index="' + index + '" aria-label="Remove ' + escapeHtml(entry.zone) + '">Remove</button></td></tr>';
  }
  if (entries.length === 0) {
    rows = '<tr><td colspan="6" class="empty">No zones yet. Measure a zone above, or add one by hand.</td></tr>';
  }
  elements.exposureRows.innerHTML = rows;

  if (entries.length === 0) {
    renderNoiseReassessBanner(null);
    elements.exposureResults.innerHTML = '';
    elements.recommendations.innerHTML = '<li class="recommendation"><p>Measure or add the zones the worker spends time in to see their daily dose.</p></li>';
    return;
  }

  const analysis = analyseExposure(entries);
  renderNoiseReassessBanner(analysis);
  const selected = analysis.results[standard.key];
  const otherKey = standard.key === 'niosh' ? 'india' : 'niosh';
  const other = analysis.results[otherKey];
  const doseWidth = Math.min(100, selected.dosePercent / 2); // bar shows 0–200 %

  elements.exposureResults.innerHTML =
    '<div class="dose-summary risk-border-' + selected.status.riskLevel + '">' +
      '<div class="dose-headline"><span class="score-number">' + selected.dosePercent.toFixed(0) + '%</span><span>daily noise dose</span></div>' +
      riskBadge(selected.status.riskLevel, selected.status.label) +
      '<div class="dose-bar" aria-hidden="true"><div class="dose-bar-fill risk-fill-' + selected.status.riskLevel + '" style="width:' + doseWidth + '%"></div><div class="dose-bar-limit"></div></div>' +
      '<p class="hint dose-bar-caption">The line marks 100 % (the daily limit).</p>' +
      '<p>' + escapeHtml(selected.status.text) + '</p>' +
      '<dl class="stat-grid">' +
        '<div><dt>8-hour TWA (' + standard.shortLabel + ')</dt><dd>' + (selected.twa === null ? '—' : selected.twa.toFixed(1) + ' dB(A)') + '</dd></div>' +
        '<div><dt>Shift Leq</dt><dd>' + (analysis.leq === null ? '—' : analysis.leq.toFixed(1) + ' dB(A)') + '</dd></div>' +
        '<div><dt>Hours counted</dt><dd>' + analysis.totalHours + ' h</dd></div>' +
        '<div><dt>' + NOISE_STANDARDS[otherKey].shortLabel + ' dose</dt><dd>' + other.dosePercent.toFixed(0) + '%</dd></div>' +
      '</dl>' +
    '</div>';

  renderNoiseRecommendations(entries, analysis, standard);
}

const CONTROL_SHORT = { elimination: 'Eliminate', engineering: 'Engineering control', administrative: 'Organise the work', ppe: 'Protective equipment' };

function renderNoiseRecommendations(entries, analysis, standard) {
  const actions = generateNoiseActions(entries, standard.key);
  let html = '';
  for (const action of actions) {
    html += '<li class="recommendation"><div class="recommendation-head">' + riskBadge(action.priority, CONTROL_SHORT[action.control]) +
      '<strong>' + escapeHtml(action.bodyPart) + '</strong></div><p class="recommendation-issue">' + escapeHtml(action.issue) + '</p><p>' + escapeHtml(action.action) + '</p></li>';
  }
  elements.recommendations.innerHTML = html;
}

function saveNoiseAssessment() {
  const entries = getDraftEntries();
  if (entries.length === 0) {
    showToast('Add at least one zone first.');
    return;
  }
  const worker = storage.getActiveWorker();
  const standard = currentStandard();
  const analysis = analyseExposure(entries);
  const selected = analysis.results[standard.key];
  const assessment = {
    id: storage.makeId(),
    date: new Date().toISOString(),
    workerId: worker ? worker.id : null,
    workerName: worker ? worker.name : 'Unassigned',
    standard: standard.key,
    entries: entries,
    leq: analysis.leq,
    totalHours: analysis.totalHours,
    nioshDosePercent: analysis.results.niosh.dosePercent,
    nioshTwa: analysis.results.niosh.twa,
    indiaDosePercent: analysis.results.india.dosePercent,
    indiaTwa: analysis.results.india.twa,
    riskLevel: selected.status.riskLevel,
    statusLabel: selected.status.label,
    calibration: storage.getSettings().microphoneCalibration,
    baselineId: storage.getSettings().noiseBaselineId || null,
    durationSeconds: storage.getSettings().noiseDraftStartedAt ? Math.round((Date.now() - storage.getSettings().noiseDraftStartedAt) / 1000) : null,
  };
  if (storage.saveNoiseAssessment(assessment)) {
    storage.saveSettings({ noiseDraft: [], noiseBaselineId: null, noiseDraftStartedAt: null });
    showToast(assessment.baselineId ? 'Re-assessment saved — see the before/after on the Risk screen.' : 'Noise assessment saved.');
  } else {
    showToast('Could not save — device storage is full or blocked.');
  }
}

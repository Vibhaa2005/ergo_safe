// posture.js
// The Posture screen: capture -> joint angles -> task factors ->
// RULA and REBA scores -> body map -> specific fixes -> save.

import { detectPoseInImage, detectPoseInVideoFrame, loadPoseModel, analysePose, drawPoseOverlay } from './pose.js';
import { computeRula } from './rula.js';
import { computeReba } from './reba.js';
import { generateRecommendations } from './recommendations.js';
import * as storage from './storage.js';
import { riskBadge, escapeHtml, showToast, RISK_LEVELS } from './ui.js';

const ANGLE_DEFINITIONS = [
  { key: 'trunk', label: 'Trunk', min: -45, max: 120, help: '0° upright · + bending forward · − leaning back' },
  { key: 'neck', label: 'Neck', min: -45, max: 80, help: '0° in line with trunk · + head bent forward · − tilted back' },
  { key: 'upperArm', label: 'Upper arm', min: -60, max: 180, help: '0° hanging by the side · + raised forward · − behind the body' },
  { key: 'lowerArm', label: 'Elbow bend', min: 0, max: 160, help: '0° straight arm · best range 60°–100°' },
  { key: 'wrist', label: 'Wrist bend', min: 0, max: 90, help: '0° straight wrist (hard to see in photos — check it)' },
  { key: 'knee', label: 'Knee bend', min: 0, max: 160, help: '0° straight leg' },
];

const DEFAULT_ANGLES = { trunk: 0, neck: 5, upperArm: 10, lowerArm: 80, wrist: 5, knee: 5 };
const MAX_IMAGE_WIDTH = 1280;

const state = {
  hasPosture: false,
  sourceImage: null,          // canvas holding the still image (no overlay)
  pose: null,                 // output of analysePose
  angles: Object.assign({}, DEFAULT_ANGLES),
  angleSource: {},            // key -> 'auto' | 'check' | 'edited' | 'default'
  method: 'reba',
  methodChosenByUser: false,
  postureModeChosenByUser: false,
  rula: null,
  reba: null,
  recommendations: [],
  stream: null,
  facingMode: 'environment',
  liveRunning: false,
  lastLiveUpdate: 0,
};

let elements = {};

export function initPostureView() {
  elements = {
    taskInput: document.getElementById('posture-task'),
    captureInput: document.getElementById('photo-capture-input'),
    uploadInput: document.getElementById('photo-upload-input'),
    liveButton: document.getElementById('live-camera-button'),
    manualButton: document.getElementById('manual-mode-button'),
    status: document.getElementById('pose-status'),
    stage: document.getElementById('pose-stage'),
    canvas: document.getElementById('pose-canvas'),
    video: document.getElementById('pose-video'),
    liveControls: document.getElementById('live-controls'),
    freezeButton: document.getElementById('freeze-button'),
    switchCameraButton: document.getElementById('switch-camera-button'),
    stopCameraButton: document.getElementById('stop-camera-button'),
    details: document.getElementById('posture-details'),
    sliders: document.getElementById('angle-sliders'),
    loadKg: document.getElementById('load-kg'),
    loadPattern: document.getElementById('load-pattern'),
    coupling: document.getElementById('coupling'),
    methodButtons: document.querySelectorAll('[data-method]'),
    methodRecommendation: document.getElementById('method-recommendation'),
    scoreSummary: document.getElementById('score-summary'),
    bodyMap: document.getElementById('body-map'),
    breakdown: document.getElementById('score-breakdown'),
    recommendationList: document.getElementById('recommendation-list'),
    saveButton: document.getElementById('save-assessment-button'),
  };

  buildAngleSliders();

  elements.captureInput.addEventListener('change', handleFileInput);
  elements.uploadInput.addEventListener('change', handleFileInput);
  elements.liveButton.addEventListener('click', startLiveCamera);
  elements.freezeButton.addEventListener('click', freezeLiveFrame);
  elements.switchCameraButton.addEventListener('click', switchCamera);
  elements.stopCameraButton.addEventListener('click', function () { stopLiveCamera(); setStatus(''); });
  elements.manualButton.addEventListener('click', startManualMode);
  elements.saveButton.addEventListener('click', saveAssessment);

  // Any change to the task description recalculates the score.
  for (const box of document.querySelectorAll('[data-factor]')) {
    box.addEventListener('change', recompute);
  }
  for (const radio of document.querySelectorAll('input[name="posture-mode"]')) {
    radio.addEventListener('change', function () {
      state.postureModeChosenByUser = true;
      recompute();
    });
  }
  elements.loadKg.addEventListener('input', recompute);
  elements.loadPattern.addEventListener('change', recompute);
  elements.coupling.addEventListener('change', recompute);

  for (const button of elements.methodButtons) {
    button.addEventListener('click', function () {
      state.method = button.dataset.method;
      state.methodChosenByUser = true;
      recompute();
    });
  }
}

export function refreshPostureView() {
  if (state.hasPosture) {
    recompute();
  }
}

export function leavePostureView() {
  stopLiveCamera();
}

function setStatus(message, isError) {
  elements.status.textContent = message;
  elements.status.classList.toggle('error', Boolean(isError));
}

// ---------------------------------------------------------------
// Angle sliders
// ---------------------------------------------------------------

function buildAngleSliders() {
  let html = '';
  for (const definition of ANGLE_DEFINITIONS) {
    html +=
      '<div class="angle-row">' +
        '<div class="angle-label">' +
          '<label for="angle-' + definition.key + '">' + definition.label + '</label>' +
          '<span class="tag" id="angle-tag-' + definition.key + '"></span>' +
          '<output id="angle-value-' + definition.key + '" for="angle-' + definition.key + '"></output>' +
        '</div>' +
        '<input type="range" id="angle-' + definition.key + '" min="' + definition.min + '" max="' + definition.max + '" step="1">' +
        '<p class="angle-help">' + definition.help + '</p>' +
      '</div>';
  }
  elements.sliders.innerHTML = html;

  for (const definition of ANGLE_DEFINITIONS) {
    const slider = document.getElementById('angle-' + definition.key);
    slider.addEventListener('input', function () {
      state.angles[definition.key] = Number(slider.value);
      state.angleSource[definition.key] = 'edited';
      updateSliderDisplay(definition.key);
      recompute();
    });
  }
}

const SOURCE_TAGS = {
  auto: { text: 'auto', className: 'tag-auto' },
  check: { text: 'check this', className: 'tag-check' },
  edited: { text: 'edited', className: 'tag-edited' },
  default: { text: 'not measured', className: 'tag-default' },
};

function updateSliderDisplay(key) {
  const slider = document.getElementById('angle-' + key);
  const output = document.getElementById('angle-value-' + key);
  const tag = document.getElementById('angle-tag-' + key);
  const value = Math.round(state.angles[key]);
  slider.value = value;
  output.textContent = value + '°';
  const source = SOURCE_TAGS[state.angleSource[key] || 'default'];
  tag.textContent = source.text;
  tag.className = 'tag ' + source.className;
}

function updateAllSliders() {
  for (const definition of ANGLE_DEFINITIONS) {
    updateSliderDisplay(definition.key);
  }
}

function setAnglesFromPose(pose) {
  for (const definition of ANGLE_DEFINITIONS) {
    const key = definition.key;
    const measured = Math.max(definition.min, Math.min(definition.max, pose.angles[key]));
    state.angles[key] = Math.round(measured);
    // A front-on photo makes every side-view angle unreliable.
    state.angleSource[key] = (pose.confidence[key] >= 0.6 && !pose.looksFrontOn) ? 'auto' : 'check';
  }
  if (!state.postureModeChosenByUser) {
    const wanted = pose.seatedGuess ? 'seated' : 'standing';
    const radio = document.querySelector('input[name="posture-mode"][value="' + wanted + '"]');
    if (radio) radio.checked = true;
  }
  updateAllSliders();
}

// ---------------------------------------------------------------
// Capture: photo, live camera, manual
// ---------------------------------------------------------------

async function handleFileInput(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) {
    return;
  }
  stopLiveCamera();
  setStatus('Loading image…');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    setStatus('Could not open that image. Try a JPG or PNG photo.', true);
    return;
  }

  // Copy into a canvas no wider than MAX_IMAGE_WIDTH.
  const scale = Math.min(1, MAX_IMAGE_WIDTH / bitmap.width);
  const imageCanvas = document.createElement('canvas');
  imageCanvas.width = Math.round(bitmap.width * scale);
  imageCanvas.height = Math.round(bitmap.height * scale);
  imageCanvas.getContext('2d').drawImage(bitmap, 0, 0, imageCanvas.width, imageCanvas.height);

  state.sourceImage = imageCanvas;
  state.pose = null;
  elements.stage.hidden = false;
  elements.video.hidden = true;
  elements.liveControls.hidden = true;
  drawStillImage();

  setStatus('Finding the body… (the first time, the pose model downloads — about 9 MB)');
  let landmarks = null;
  try {
    landmarks = await detectPoseInImage(imageCanvas);
  } catch (error) {
    console.error(error);
    setStatus('The pose model could not load (are you offline?). Enter the angles by hand below.', true);
    startDetails(false);
    return;
  }

  if (!landmarks) {
    // Do not keep angles from a previous photo — they belong to someone else.
    resetAnglesToDefaults();
    setStatus('No person found. Use a side-on photo with the whole body visible — or set the angles by hand below.', true);
    startDetails(false);
    return;
  }

  state.pose = analysePose(landmarks, imageCanvas.width, imageCanvas.height);
  setAnglesFromPose(state.pose);
  if (state.pose.looksFrontOn) {
    setStatus('This photo looks front-on. RULA and REBA need a SIDE view — the angles below are probably wrong. Retake from the side, or correct each slider.', true);
  } else if (!state.pose.legsVisible) {
    setStatus('Body found, but the legs are not clearly visible. Check the knee angle and the standing / seated choice.');
  } else {
    setStatus('Body found (' + state.pose.side + ' side facing the camera). Check the angles, then describe the task.');
  }
  startDetails(true);
}

async function startLiveCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('This browser cannot use the camera. Use "Take photo" instead.', true);
    return;
  }
  stopLiveCamera();
  setStatus('Starting camera…');
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: state.facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
  } catch (error) {
    setStatus('Camera permission was refused or no camera was found.', true);
    return;
  }
  elements.video.srcObject = state.stream;
  elements.video.hidden = true; // we draw the video onto the canvas instead
  await elements.video.play();
  elements.stage.hidden = false;
  elements.liveControls.hidden = false;
  state.sourceImage = null;

  setStatus('Loading the pose model… (first time about 9 MB)');
  try {
    await loadPoseModel('VIDEO');
  } catch (error) {
    console.error(error);
    setStatus('The pose model could not load (are you offline?).', true);
    stopLiveCamera();
    return;
  }
  setStatus('Live: the score updates as the person moves. Press "Freeze & assess" at the worst moment.');
  state.postureModeChosenByUser = false;
  state.liveRunning = true;
  startDetails(true);
  requestAnimationFrame(liveLoop);
}

function liveLoop() {
  if (!state.liveRunning) {
    return;
  }
  const video = elements.video;
  if (video.readyState >= 2 && video.videoWidth > 0) {
    const canvas = elements.canvas;
    if (canvas.width !== video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const landmarks = detectPoseInVideoFrame(video, performance.now());
    if (landmarks) {
      state.pose = analysePose(landmarks, canvas.width, canvas.height);
      const now = performance.now();
      if (now - state.lastLiveUpdate > 250) {
        state.lastLiveUpdate = now;
        setAnglesFromPose(state.pose);
        recompute();
        if (state.pose.looksFrontOn) {
          setStatus('Turn the person side-on to the camera — front views give wrong angles.', true);
        } else {
          setStatus('Live: the score updates as the person moves. Press "Freeze & assess" at the worst moment.');
        }
      }
      drawPoseOverlay(context, state.pose, state.angles, currentPartLevels());
    }
  }
  requestAnimationFrame(liveLoop);
}

function freezeLiveFrame() {
  const video = elements.video;
  if (!state.liveRunning || video.videoWidth === 0) {
    return;
  }
  const still = document.createElement('canvas');
  still.width = video.videoWidth;
  still.height = video.videoHeight;
  still.getContext('2d').drawImage(video, 0, 0);
  stopLiveCamera();
  state.sourceImage = still;
  elements.stage.hidden = false;
  if (state.pose) {
    setStatus('Frame frozen. Adjust any angle that looks wrong, then describe the task.');
  } else {
    setStatus('Frame frozen, but no body was found in it. Set the angles by hand.', true);
  }
  recompute();
}

async function switchCamera() {
  state.facingMode = state.facingMode === 'environment' ? 'user' : 'environment';
  await startLiveCamera();
}

function stopLiveCamera() {
  state.liveRunning = false;
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
    state.stream = null;
  }
  if (elements.liveControls) {
    elements.liveControls.hidden = true;
  }
}

function resetAnglesToDefaults() {
  state.pose = null;
  state.angles = Object.assign({}, DEFAULT_ANGLES);
  state.angleSource = {};
  updateAllSliders();
}

function startManualMode() {
  stopLiveCamera();
  state.sourceImage = null;
  elements.stage.hidden = true;
  resetAnglesToDefaults();
  setStatus('Manual mode: set each angle with its slider (measure from a photo or by observation).');
  startDetails(false);
  elements.details.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function startDetails(fromCamera) {
  state.hasPosture = true;
  elements.details.hidden = false;
  if (!fromCamera) {
    updateAllSliders();
  }
  recompute();
}

// ---------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------

function readFactors() {
  const factors = {};
  for (const box of document.querySelectorAll('[data-factor]')) {
    factors[box.dataset.factor] = box.checked;
  }
  const postureRadio = document.querySelector('input[name="posture-mode"]:checked');
  factors.seated = postureRadio ? postureRadio.value === 'seated' : false;
  factors.loadKg = Math.max(0, parseFloat(elements.loadKg.value) || 0);
  factors.loadPattern = elements.loadPattern.value;
  factors.coupling = parseInt(elements.coupling.value, 10) || 0;
  return factors;
}

function currentPartLevels() {
  const result = state.method === 'rula' ? state.rula : state.reba;
  if (!result) {
    return null;
  }
  const levels = {};
  for (const partName in result.parts) {
    levels[partName] = result.parts[partName].level;
  }
  return levels;
}

function recompute() {
  if (!state.hasPosture) {
    return;
  }
  const factors = readFactors();
  const input = { angles: state.angles, factors: factors };
  state.rula = computeRula(input);
  state.reba = computeReba(input);
  state.recommendations = generateRecommendations({ angles: state.angles, factors: factors, worker: storage.getActiveWorker() });

  const recommended = factors.seated ? 'rula' : 'reba';
  if (!state.methodChosenByUser) {
    state.method = recommended;
  }
  elements.methodRecommendation.textContent = recommended === 'rula'
    ? 'Recommended: RULA — seated or mainly upper-limb work.'
    : 'Recommended: REBA — standing, lifting or whole-body work.';
  for (const button of elements.methodButtons) {
    button.setAttribute('aria-pressed', button.dataset.method === state.method ? 'true' : 'false');
  }

  renderScoreSummary();
  renderBodyMap();
  renderBreakdown();
  renderRecommendations();
  if (!state.liveRunning) {
    drawStillImage();
  }
}

function drawStillImage() {
  if (!state.sourceImage) {
    return;
  }
  const canvas = elements.canvas;
  canvas.width = state.sourceImage.width;
  canvas.height = state.sourceImage.height;
  const context = canvas.getContext('2d');
  context.drawImage(state.sourceImage, 0, 0);
  if (state.pose) {
    drawPoseOverlay(context, state.pose, state.angles, currentPartLevels());
  }
}

// ---------------------------------------------------------------
// Rendering results
// ---------------------------------------------------------------

function renderScoreSummary() {
  const active = state.method === 'rula' ? state.rula : state.reba;
  const other = state.method === 'rula' ? state.reba : state.rula;
  const activeLevel = RISK_LEVELS[active.riskLevel];
  const otherLevel = RISK_LEVELS[other.riskLevel];
  const worker = storage.getActiveWorker();
  let unmeasuredCount = 0;
  for (const definition of ANGLE_DEFINITIONS) {
    const source = state.angleSource[definition.key];
    if (!source || source === 'default') unmeasuredCount++;
  }
  const placeholderWarning = unmeasuredCount > 0
    ? '<p class="placeholder-warning">' + riskBadge('medium', unmeasuredCount + ' of 6 angles not measured') +
      ' They use neutral placeholder values — set their sliders before trusting this score.</p>'
    : '';
  elements.scoreSummary.className = 'score-summary risk-border-' + active.riskLevel;
  elements.scoreSummary.innerHTML = placeholderWarning +
    '<div class="score-big"><span class="score-number">' + active.finalScore + '</span><span class="score-max">/ ' + active.maxScore + '</span></div>' +
    '<div class="score-text">' +
      '<div class="score-method">' + active.method + ' score</div>' +
      riskBadge(active.riskLevel, activeLevel.label + ' risk') +
      '<p>' + escapeHtml(active.actionText) + '</p>' +
      '<p class="hint">' + other.method + ' gives ' + other.finalScore + ' / ' + other.maxScore + ' (' + otherLevel.label.toLowerCase() + ').' +
      (worker ? ' Worker: <strong>' + escapeHtml(worker.name) + '</strong>.' : ' No worker selected — fixes will not include exact heights.') + '</p>' +
    '</div>';
}

const BODY_PART_NAMES = {
  neck: 'Neck',
  trunk: 'Trunk',
  upperArm: 'Upper arm',
  lowerArm: 'Lower arm',
  wrist: 'Wrist',
  legs: 'Legs',
};

function renderBodyMap() {
  const result = state.method === 'rula' ? state.rula : state.reba;
  const parts = result.parts;
  function cls(partName) {
    return 'part level-' + parts[partName].level;
  }
  const svg =
    '<svg viewBox="0 0 120 240" role="img" aria-label="Body map coloured by risk">' +
      '<circle cx="60" cy="20" r="14" class="part-head"/>' +
      '<rect x="53" y="34" width="14" height="12" rx="3" class="' + cls('neck') + '"/>' +
      '<rect x="38" y="46" width="44" height="72" rx="10" class="' + cls('trunk') + '"/>' +
      '<rect x="22" y="48" width="14" height="46" rx="7" class="' + cls('upperArm') + '"/>' +
      '<rect x="84" y="48" width="14" height="46" rx="7" class="' + cls('upperArm') + '"/>' +
      '<rect x="20" y="96" width="13" height="40" rx="6" class="' + cls('lowerArm') + '"/>' +
      '<rect x="87" y="96" width="13" height="40" rx="6" class="' + cls('lowerArm') + '"/>' +
      '<circle cx="26" cy="144" r="7" class="' + cls('wrist') + '"/>' +
      '<circle cx="94" cy="144" r="7" class="' + cls('wrist') + '"/>' +
      '<rect x="41" y="121" width="17" height="104" rx="8" class="' + cls('legs') + '"/>' +
      '<rect x="62" y="121" width="17" height="104" rx="8" class="' + cls('legs') + '"/>' +
    '</svg>';

  let list = '<ul class="part-list">';
  for (const partName of ['neck', 'trunk', 'upperArm', 'lowerArm', 'wrist', 'legs']) {
    const part = parts[partName];
    list += '<li><span>' + BODY_PART_NAMES[partName] + ' <span class="part-score">score ' + part.score + '</span></span>' + riskBadge(part.level) + '</li>';
  }
  list += '</ul>';
  elements.bodyMap.innerHTML = svg + list;
}

function renderBreakdown() {
  const result = state.method === 'rula' ? state.rula : state.reba;
  let html = '<table class="data-table breakdown"><caption>How the ' + result.method + ' score was worked out</caption>' +
    '<thead><tr><th>Body part</th><th>Measured</th><th>Base</th><th>Adjustments</th><th>Score</th></tr></thead><tbody>';
  for (const step of result.steps) {
    html += '<tr><td>' + escapeHtml(step.name) + '</td><td>' + escapeHtml(step.detail) + '</td><td>' + step.base + '</td><td>' +
      (step.adjustments.length ? escapeHtml(step.adjustments.join(', ')) : '—') + '</td><td><strong>' + step.score + '</strong></td></tr>';
  }
  html += '</tbody></table><table class="data-table breakdown"><tbody>';
  for (const row of result.summary) {
    html += '<tr' + (row.total ? ' class="total-row"' : '') + '><td>' + escapeHtml(row.name) + '</td><td>' + row.score + '</td></tr>';
  }
  html += '</tbody></table>';
  elements.breakdown.innerHTML = html;
}

const PRIORITY_TO_LEVEL = { high: 'high', medium: 'medium', low: 'low' };
const PRIORITY_TEXT = { high: 'Fix first', medium: 'Fix soon', low: 'Improve' };

function renderRecommendations() {
  let html = '';
  for (const item of state.recommendations) {
    html += '<li class="recommendation">' +
      '<div class="recommendation-head">' + riskBadge(PRIORITY_TO_LEVEL[item.priority], PRIORITY_TEXT[item.priority]) +
      '<strong>' + escapeHtml(item.bodyPart) + '</strong></div>' +
      '<p class="recommendation-issue">' + escapeHtml(item.issue) + '</p>' +
      '<p>' + escapeHtml(item.action) + '</p></li>';
  }
  elements.recommendationList.innerHTML = html;
}

// ---------------------------------------------------------------
// Saving
// ---------------------------------------------------------------

function makeThumbnail() {
  if (elements.stage.hidden || !state.sourceImage) {
    return null;
  }
  const source = elements.canvas;
  const thumbnailWidth = 320;
  const scale = thumbnailWidth / source.width;
  const thumbnail = document.createElement('canvas');
  thumbnail.width = thumbnailWidth;
  thumbnail.height = Math.round(source.height * scale);
  thumbnail.getContext('2d').drawImage(source, 0, 0, thumbnail.width, thumbnail.height);
  try {
    return thumbnail.toDataURL('image/jpeg', 0.7);
  } catch (error) {
    return null;
  }
}

function summariseResult(result) {
  const parts = {};
  for (const partName in result.parts) {
    parts[partName] = result.parts[partName].score;
  }
  return { finalScore: result.finalScore, riskLevel: result.riskLevel, actionText: result.actionText, parts: parts };
}

function saveAssessment() {
  if (!state.hasPosture) {
    return;
  }
  const worker = storage.getActiveWorker();
  const assessment = {
    id: storage.makeId(),
    date: new Date().toISOString(),
    workerId: worker ? worker.id : null,
    workerName: worker ? worker.name : 'Unassigned',
    task: elements.taskInput.value.trim() || 'Untitled task',
    method: state.method,
    angles: Object.assign({}, state.angles),
    angleSource: Object.assign({}, state.angleSource),
    factors: readFactors(),
    rula: summariseResult(state.rula),
    reba: summariseResult(state.reba),
    recommendations: state.recommendations,
    thumbnail: makeThumbnail(),
  };
  const saved = storage.savePostureAssessment(assessment);
  if (saved) {
    showToast('Assessment saved — see it on the Home screen.');
  } else {
    showToast('Could not save — device storage is full or blocked.');
  }
}

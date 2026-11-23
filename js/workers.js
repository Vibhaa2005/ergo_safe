// workers.js
// The Workers screen: add workers, see where they sit in the Indian
// population, their estimated body dimensions and their workstation.

import * as storage from './storage.js';
import {
  INDIAN_POPULATION, BODY_PROPORTIONS, percentileOfStature, estimateBodyDimensions,
  recommendWorkstation, populationDesignRanges, formatRangeMm,
} from './anthropometry.js';
import { escapeHtml, showToast } from './ui.js';

const TASK_LABELS = { precision: 'Precision work', light: 'Light work', heavy: 'Heavy work' };

let elements = {};
const openWorkerIds = new Set();   // worker folds the user has opened

export function initWorkersView() {
  elements = {
    list: document.getElementById('worker-list'),
    addButton: document.getElementById('add-worker-button'),
    form: document.getElementById('worker-form'),
    formTitle: document.getElementById('worker-form-title'),
    cancelButton: document.getElementById('worker-form-cancel'),
    id: document.getElementById('worker-id'),
    name: document.getElementById('worker-name'),
    sex: document.getElementById('worker-sex'),
    stature: document.getElementById('worker-stature'),
    mass: document.getElementById('worker-mass'),
    posture: document.getElementById('worker-posture'),
    task: document.getElementById('worker-task'),
    workstation: document.getElementById('worker-workstation'),
    populationRanges: document.getElementById('population-ranges'),
  };

  elements.addButton.addEventListener('click', function () { openForm(null); });
  elements.cancelButton.addEventListener('click', closeForm);
  elements.form.addEventListener('submit', saveWorkerFromForm);

  elements.list.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-action]');
    if (!button) {
      return;
    }
    // The buttons sit inside the fold's title row: don't let a click on them
    // also open or close the fold.
    event.preventDefault();
    const workerId = button.dataset.workerId;
    if (button.dataset.action === 'edit') {
      openForm(storage.getWorkerById(workerId));
    } else if (button.dataset.action === 'delete') {
      const worker = storage.getWorkerById(workerId);
      if (worker && confirm('Delete worker "' + worker.name + '"? Their saved assessments stay.')) {
        openWorkerIds.delete(workerId);
        storage.deleteWorker(workerId);
      }
    }
  });

  // Remember which worker folds are open, so they stay open when the list
  // is redrawn (e.g. after editing). "toggle" does not bubble, so listen
  // in the capture phase.
  elements.list.addEventListener('toggle', function (event) {
    const fold = event.target;
    if (!fold.matches || !fold.matches('details.worker-fold')) {
      return;
    }
    if (fold.open) {
      openWorkerIds.add(fold.dataset.workerId);
    } else {
      openWorkerIds.delete(fold.dataset.workerId);
    }
  }, true);

  renderPopulationRanges();
}

export function refreshWorkersView() {
  renderWorkerList();
}

function openForm(worker) {
  elements.form.hidden = false;
  elements.formTitle.textContent = worker ? 'Edit worker' : 'Add worker';
  elements.id.value = worker ? worker.id : '';
  elements.name.value = worker ? worker.name : '';
  elements.sex.value = worker ? worker.sex : 'male';
  elements.stature.value = worker ? worker.statureCm : '';
  elements.mass.value = worker && worker.massKg ? worker.massKg : '';
  elements.posture.value = worker ? worker.workPosture : 'standing';
  elements.task.value = worker ? worker.taskType : 'light';
  elements.workstation.value = worker ? worker.workstation || '' : '';
  elements.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  elements.name.focus();
}

function closeForm() {
  elements.form.hidden = true;
}

function saveWorkerFromForm(event) {
  event.preventDefault();
  const statureCm = parseFloat(elements.stature.value);
  if (!isFinite(statureCm) || statureCm < 120 || statureCm > 210) {
    showToast('Enter a height between 120 and 210 cm.');
    return;
  }
  const massKg = parseFloat(elements.mass.value);
  const worker = {
    id: elements.id.value || storage.makeId(),
    name: elements.name.value.trim(),
    sex: elements.sex.value,
    statureCm: statureCm,
    massKg: isFinite(massKg) ? massKg : null,
    workPosture: elements.posture.value,
    taskType: elements.task.value,
    workstation: elements.workstation.value.trim(),
  };
  openWorkerIds.add(worker.id);          // show the saved worker's profile
  storage.saveWorker(worker);
  storage.saveSettings({ activeWorkerId: worker.id });
  closeForm();
  showToast('Worker saved.');
}

function renderWorkerList() {
  const workers = storage.getWorkers();
  if (workers.length === 0) {
    elements.list.innerHTML = '<p class="empty">No workers yet. Add one to get workstation heights sized to their body.</p>';
    return;
  }
  // Each worker is a fold: the title row shows the worker with Edit / Delete
  // on the right; opening it shows their anthropometric profile.
  let html = '<p class="hint">Tap a worker to open their anthropometric profile.</p>';
  for (const worker of workers) {
    html += '<details class="worker-fold" data-worker-id="' + worker.id + '"' + (openWorkerIds.has(worker.id) ? ' open' : '') + '>' +
      '<summary class="worker-card">' +
        '<strong class="worker-name">' + escapeHtml(worker.name) + '</strong>' +
        '<span class="hint worker-details">' + worker.statureCm + ' cm · ' + (worker.workPosture === 'seated' ? 'Seated' : 'Standing') + ' · ' +
        TASK_LABELS[worker.taskType] + (worker.workstation ? ' · ' + escapeHtml(worker.workstation) : '') + '</span>' +
        '<div class="worker-actions">' +
          '<button type="button" class="button small" data-action="edit" data-worker-id="' + worker.id + '">Edit</button>' +
          '<button type="button" class="button small danger" data-action="delete" data-worker-id="' + worker.id + '">Delete</button>' +
        '</div>' +
      '</summary>' +
      '<div class="worker-profile-panel"><h3>Anthropometric profile</h3>' + profileHtml(worker) + '</div>' +
      '</details>';
  }
  elements.list.innerHTML = html;
}

function profileHtml(worker) {
  const statureMm = worker.statureCm * 10;
  const percentile = percentileOfStature(statureMm, worker.sex);
  const population = INDIAN_POPULATION[worker.sex];
  const body = estimateBodyDimensions(statureMm);
  const workstation = recommendWorkstation(worker);

  let html = '<div class="percentile-block">' +
    '<p><strong>' + escapeHtml(worker.name) + '</strong> is ' + worker.statureCm + ' cm tall — taller than about <strong>' +
    Math.round(percentile) + '%</strong> of ' + population.label.toLowerCase() + '.</p>' +
    '<div class="percentile-bar" aria-hidden="true"><div class="percentile-marker" style="left:' + percentile + '%"></div>' +
    '<span style="left:5%">5th</span><span style="left:50%">50th</span><span style="left:95%">95th</span></div>' +
    '</div>';

  html += '<h3>Recommended workstation (' + (workstation.posture === 'seated' ? 'seated' : 'standing') + ', ' + TASK_LABELS[workstation.task].toLowerCase() + ')</h3>';
  html += '<div class="result-grid">' + workstationDiagram(worker, workstation) + '<div class="table-wrap"><table class="data-table"><thead><tr><th>Dimension</th><th>Value</th><th>Why</th></tr></thead><tbody>';
  for (const item of workstation.recommendations) {
    html += '<tr><td>' + escapeHtml(item.label) + '</td><td class="nowrap"><strong>' + formatRangeMm(item.low, item.high) + '</strong></td><td>' + escapeHtml(item.note) + '</td></tr>';
  }
  html += '</tbody></table></div></div>';

  html += '<details><summary>Estimated body dimensions</summary><div class="table-wrap"><table class="data-table"><thead><tr><th>Dimension</th><th>Fraction of height</th><th>Estimate</th></tr></thead><tbody>';
  for (const proportion of BODY_PROPORTIONS) {
    html += '<tr><td>' + escapeHtml(proportion.label) + '</td><td>' + proportion.fraction.toFixed(3) + ' × H</td><td>' + Math.round(body[proportion.key] / 10) + ' cm</td></tr>';
  }
  html += '</tbody></table></div><p class="hint">Estimated from stature with standard body-segment proportions. Measure directly when precision matters.</p></details>';

  return html;
}

// Side-view height chart: floor at the bottom, key heights marked.
function workstationDiagram(worker, workstation) {
  const statureMm = worker.statureCm * 10;
  const chartTopMm = 2000;
  const chartHeight = 260;
  function y(mm) {
    return 10 + chartHeight - (mm / chartTopMm) * chartHeight;
  }
  const body = workstation.body;
  const shoe = 25;
  const lines = [];
  let surface = null;
  for (const item of workstation.recommendations) {
    if (item.key === 'workSurface') surface = item;
  }

  let figure = '';
  if (workstation.posture === 'standing') {
    const headTop = statureMm + shoe;
    figure =
      '<circle cx="70" cy="' + (y(headTop) + 11) + '" r="11" class="figure"/>' +
      '<line x1="70" y1="' + (y(headTop) + 22) + '" x2="70" y2="' + y(body.kneeHeight * 1.8) + '" class="figure-line"/>' +
      '<line x1="70" y1="' + y(body.kneeHeight * 1.8) + '" x2="62" y2="' + y(0) + '" class="figure-line"/>' +
      '<line x1="70" y1="' + y(body.kneeHeight * 1.8) + '" x2="78" y2="' + y(0) + '" class="figure-line"/>' +
      '<line x1="70" y1="' + y(body.shoulderHeight + shoe) + '" x2="76" y2="' + y(body.elbowHeight + shoe) + '" class="figure-line"/>' +
      '<line x1="76" y1="' + y(body.elbowHeight + shoe) + '" x2="104" y2="' + y(body.elbowHeight + shoe - 30) + '" class="figure-line"/>';
    lines.push({ mm: body.eyeHeight + shoe, label: 'Eye' });
    lines.push({ mm: body.shoulderHeight + shoe, label: 'Shoulder' });
    lines.push({ mm: body.elbowHeight + shoe, label: 'Elbow' });
  } else {
    const seat = body.poplitealHeight + shoe;
    const eye = seat + body.sittingEyeHeight;
    const elbow = seat + body.sittingElbowHeight;
    figure =
      '<rect x="44" y="' + y(seat) + '" width="40" height="6" class="furniture"/>' +
      '<line x1="50" y1="' + y(seat) + '" x2="50" y2="' + y(0) + '" class="furniture-line"/>' +
      '<circle cx="62" cy="' + (y(eye) - 2) + '" r="11" class="figure"/>' +
      '<line x1="62" y1="' + (y(eye) + 9) + '" x2="60" y2="' + y(seat) + '" class="figure-line"/>' +
      '<line x1="60" y1="' + y(seat) + '" x2="96" y2="' + y(seat) + '" class="figure-line"/>' +
      '<line x1="96" y1="' + y(seat) + '" x2="96" y2="' + y(0) + '" class="figure-line"/>' +
      '<line x1="62" y1="' + y(elbow + 140) + '" x2="66" y2="' + y(elbow) + '" class="figure-line"/>' +
      '<line x1="66" y1="' + y(elbow) + '" x2="104" y2="' + y(elbow) + '" class="figure-line"/>';
    lines.push({ mm: eye, label: 'Eye' });
    lines.push({ mm: elbow, label: 'Elbow' });
    lines.push({ mm: seat, label: 'Seat' });
  }

  let marks = '';
  for (const line of lines) {
    marks += '<line x1="30" x2="200" y1="' + y(line.mm) + '" y2="' + y(line.mm) + '" class="guide-line"/>' +
      '<text x="204" y="' + (y(line.mm) + 4) + '" class="chart-label">' + line.label + ' ' + Math.round(line.mm / 10) + '</text>';
  }

  let surfaceBand = '';
  if (surface) {
    const top = y(surface.high);
    const bottom = y(surface.low);
    surfaceBand = '<rect x="100" y="' + top + '" width="70" height="' + Math.max(3, bottom - top) + '" class="surface-band"/>' +
      '<line x1="160" x2="160" y1="' + bottom + '" y2="' + y(0) + '" class="furniture-line"/>' +
      '<text x="204" y="' + ((top + bottom) / 2 + 4) + '" class="chart-label strong">Work ' + formatRangeMm(surface.low, surface.high).replace(' cm', '') + '</text>';
  }

  return '<svg class="workstation-diagram" viewBox="0 0 290 285" role="img" aria-label="Side view of recommended heights in centimetres">' +
    '<line x1="20" x2="280" y1="' + y(0) + '" y2="' + y(0) + '" class="floor"/>' +
    figure + surfaceBand + marks +
    '<text x="20" y="' + (y(0) + 14) + '" class="chart-label">Floor 0 · heights in cm</text>' +
    '</svg>';
}

function renderPopulationRanges() {
  const ranges = populationDesignRanges();
  let html = '<table class="data-table"><thead><tr><th>Dimension</th><th>Design principle</th><th>Value</th></tr></thead><tbody>';
  for (const row of ranges.rows) {
    html += '<tr><td>' + escapeHtml(row.label) + '</td><td>' + escapeHtml(row.principle) + '</td><td class="nowrap"><strong>' + formatRangeMm(row.low, row.high) + '</strong></td></tr>';
  }
  html += '</tbody></table><p class="hint">Based on 5th percentile woman (' + Math.round(ranges.smallStatureMm / 10) + ' cm) and 95th percentile man (' +
    Math.round(ranges.largeStatureMm / 10) + ' cm) of the Indian adult population.</p>';
  elements.populationRanges.innerHTML = html;
}

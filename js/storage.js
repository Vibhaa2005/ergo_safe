// storage.js
// Saves everything on this device using the browser's localStorage.
// Every read and write is wrapped in try/catch so the app still works
// in private windows or when storage is blocked (data just is not kept).

const STORAGE_KEYS = {
  workers: 'ergosafe.workers',
  postureAssessments: 'ergosafe.postureAssessments',
  noiseAssessments: 'ergosafe.noiseAssessments',
  feedbackResponses: 'ergosafe.feedbackResponses',
  settings: 'ergosafe.settings',
};

const DEFAULT_SETTINGS = {
  activeWorkerId: null,
  highContrast: false,
  microphoneOffset: 110,          // dB added to the raw microphone level
  microphoneCalibration: 'none',  // 'none' | 'rough' | 'reference'
  noiseStandard: 'niosh',         // 'niosh' | 'india'
};

function readValue(key, fallbackValue) {
  try {
    const storedText = localStorage.getItem(key);
    if (storedText === null) {
      return fallbackValue;
    }
    return JSON.parse(storedText);
  } catch (error) {
    return fallbackValue;
  }
}

function writeValue(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('Could not save to this device:', error);
    return false;
  }
  // Tell the rest of the app that saved data changed.
  window.dispatchEvent(new CustomEvent('ergosafe:data-changed', { detail: { key: key } }));
  return true;
}

export function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- generic list helpers ----------

function getList(key) {
  const list = readValue(key, []);
  return Array.isArray(list) ? list : [];
}

function saveItemInList(key, item) {
  const list = getList(key);
  let foundIndex = -1;
  for (let index = 0; index < list.length; index++) {
    if (list[index].id === item.id) {
      foundIndex = index;
    }
  }
  if (foundIndex === -1) {
    list.push(item);
  } else {
    list[foundIndex] = item;
  }
  return writeValue(key, list);
}

function deleteItemFromList(key, itemId) {
  const list = getList(key);
  const remaining = [];
  for (const item of list) {
    if (item.id !== itemId) {
      remaining.push(item);
    }
  }
  return writeValue(key, remaining);
}

// ---------- workers ----------

export function getWorkers() {
  return getList(STORAGE_KEYS.workers);
}

export function getWorkerById(workerId) {
  for (const worker of getWorkers()) {
    if (worker.id === workerId) {
      return worker;
    }
  }
  return null;
}

export function saveWorker(worker) {
  return saveItemInList(STORAGE_KEYS.workers, worker);
}

export function deleteWorker(workerId) {
  const settings = getSettings();
  if (settings.activeWorkerId === workerId) {
    saveSettings({ activeWorkerId: null });
  }
  return deleteItemFromList(STORAGE_KEYS.workers, workerId);
}

export function getActiveWorker() {
  const settings = getSettings();
  if (!settings.activeWorkerId) {
    return null;
  }
  return getWorkerById(settings.activeWorkerId);
}

// ---------- posture assessments ----------

export function getPostureAssessments() {
  return getList(STORAGE_KEYS.postureAssessments);
}

export function savePostureAssessment(assessment) {
  return saveItemInList(STORAGE_KEYS.postureAssessments, assessment);
}

export function deletePostureAssessment(assessmentId) {
  return deleteItemFromList(STORAGE_KEYS.postureAssessments, assessmentId);
}

// ---------- noise assessments ----------

export function getNoiseAssessments() {
  return getList(STORAGE_KEYS.noiseAssessments);
}

export function saveNoiseAssessment(assessment) {
  return saveItemInList(STORAGE_KEYS.noiseAssessments, assessment);
}

export function deleteNoiseAssessment(assessmentId) {
  return deleteItemFromList(STORAGE_KEYS.noiseAssessments, assessmentId);
}

// ---------- feedback (usability questionnaire) ----------

export function getFeedbackResponses() {
  return getList(STORAGE_KEYS.feedbackResponses);
}

export function saveFeedbackResponse(response) {
  return saveItemInList(STORAGE_KEYS.feedbackResponses, response);
}

export function deleteFeedbackResponse(responseId) {
  return deleteItemFromList(STORAGE_KEYS.feedbackResponses, responseId);
}

// ---------- settings ----------

export function getSettings() {
  const stored = readValue(STORAGE_KEYS.settings, {});
  return Object.assign({}, DEFAULT_SETTINGS, stored);
}

export function saveSettings(changes) {
  const updated = Object.assign(getSettings(), changes);
  return writeValue(STORAGE_KEYS.settings, updated);
}

// ---------- whole-app data ----------

export function exportAllData() {
  return {
    exportedAt: new Date().toISOString(),
    workers: getWorkers(),
    postureAssessments: getPostureAssessments(),
    noiseAssessments: getNoiseAssessments(),
    feedbackResponses: getFeedbackResponses(),
  };
}

export function clearAllData() {
  writeValue(STORAGE_KEYS.workers, []);
  writeValue(STORAGE_KEYS.postureAssessments, []);
  writeValue(STORAGE_KEYS.noiseAssessments, []);
  writeValue(STORAGE_KEYS.feedbackResponses, []);
  saveSettings({ activeWorkerId: null });
}

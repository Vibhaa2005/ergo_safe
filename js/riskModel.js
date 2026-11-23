// riskModel.js
// Builds one worker's combined risk profile from their saved posture and
// noise assessments (no screen code here, so it can be tested).
//
// Method: HIRA (Hazard Identification and Risk Assessment) risk matrix,
// as used in Indian industry and ISO 45001.
//   Severity   (1–5): how bad the exposure is when it happens
//                       posture -> RULA/REBA risk level, noise -> loudest level
//   Likelihood (1–5): how much / how often the worker is exposed
//                       posture -> hours per shift + frequency, noise -> hours at >= 85 dB(A)
//   Risk rating = Severity × Likelihood (1–25)
//     1–4 Low · 5–9 Medium · 10–16 High · 20–25 Very high
// Overall worker risk = the highest hazard rating. ErgoSafe rule (stated
// openly as our own, conservative choice): if posture AND noise are both
// High or worse, the overall risk is raised to Very high.

import { computeRula } from './rula.js';
import { computeReba } from './reba.js';
import { recommendWorkstation, percentileOfStature, formatRangeMm } from './anthropometry.js';
import { generateNoiseActions } from './noiseMath.js';

export const FREQUENCY_OPTIONS = {
  rarely: { label: 'Rarely (less than once an hour)', shortLabel: 'rarely', band: 1 },
  occasionally: { label: 'Occasionally (1–10 times an hour)', shortLabel: '1–10 times an hour', band: 2 },
  frequently: { label: 'Frequently (10–60 times an hour)', shortLabel: '10–60 times an hour', band: 4 },
  continuously: { label: 'Continuously, or held for long periods', shortLabel: 'continuously / held', band: 5 },
};

export const CONTROL_TYPES = {
  elimination: { order: 0, label: 'Eliminate the hazard' },
  engineering: { order: 1, label: 'Engineering controls (change the workplace)' },
  administrative: { order: 2, label: 'Administrative controls (change how work is organised)' },
  ppe: { order: 3, label: 'Personal protective equipment' },
};

const LEVEL_TO_SEVERITY = { negligible: 1, low: 2, medium: 3, high: 4, veryhigh: 5 };
export const LEVEL_RANK = { none: -1, negligible: 0, low: 1, medium: 2, high: 3, veryhigh: 4 };
const PRIORITY_RANK = { veryhigh: 0, high: 1, medium: 2, low: 3 };

// ---------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------

export function hoursBand(hours) {
  if (hours < 1) return 1;
  if (hours < 2) return 2;
  if (hours < 4) return 3;
  if (hours < 6) return 4;
  return 5;
}

export function ratingLevel(rating) {
  if (rating <= 4) return 'low';
  if (rating <= 9) return 'medium';
  if (rating <= 16) return 'high';
  return 'veryhigh';
}

export function primaryResult(assessment) {
  return assessment.method === 'rula' ? assessment.rula : assessment.reba;
}

// Recalculates the full scoring (with every step) from the saved angles.
export function recomputeAssessment(assessment) {
  const input = { angles: assessment.angles, factors: assessment.factors };
  return { rula: computeRula(input), reba: computeReba(input) };
}

export function postureSeverity(assessment) {
  return LEVEL_TO_SEVERITY[primaryResult(assessment).riskLevel] || 3;
}

export function postureLikelihood(assessment) {
  const exposure = assessment.exposure;
  if (!exposure || !isFinite(exposure.hoursPerShift)) {
    return { value: 3, assumed: true, text: 'exposure not recorded (assumed moderate)' };
  }
  const frequency = FREQUENCY_OPTIONS[exposure.frequency] || FREQUENCY_OPTIONS.occasionally;
  const value = Math.round((hoursBand(exposure.hoursPerShift) + frequency.band) / 2);
  return { value: value, assumed: false, text: exposure.hoursPerShift + ' h per shift, ' + frequency.shortLabel };
}

export function noiseSeverity(entries) {
  let loudest = 0;
  for (const entry of entries) {
    if (entry.hours > 0) loudest = Math.max(loudest, entry.levelDb);
  }
  if (loudest < 80) return 1;
  if (loudest < 85) return 2;
  if (loudest < 90) return 3;
  if (loudest < 100) return 4;
  return 5;
}

export function hoursAtOrAbove85(entries) {
  let hours = 0;
  for (const entry of entries) {
    if (entry.levelDb >= 85) hours += entry.hours;
  }
  return hours;
}

export function noiseLikelihood(entries) {
  const loudHours = hoursAtOrAbove85(entries);
  if (loudHours === 0) {
    return { value: 1, assumed: false, text: 'no time at 85 dB(A) or more' };
  }
  return { value: hoursBand(loudHours), assumed: false, text: loudHours + ' h per shift at 85 dB(A) or more' };
}

function sortByDate(list) {
  return list.slice().sort(function (first, second) { return first.date < second.date ? -1 : 1; });
}

// Splits assessments into original ("baseline") ones and their latest
// re-assessment after a fix ("follow-up").
function pairBaselinesWithFollowUps(assessments) {
  const ids = {};
  for (const assessment of assessments) ids[assessment.id] = true;
  const baselines = [];
  const latestFollowUp = {};
  for (const assessment of sortByDate(assessments)) {
    if (assessment.baselineId && ids[assessment.baselineId]) {
      latestFollowUp[assessment.baselineId] = assessment; // later dates overwrite earlier
    } else {
      baselines.push(assessment);
    }
  }
  const pairs = [];
  for (const baseline of baselines) {
    pairs.push({ baseline: baseline, followUp: latestFollowUp[baseline.id] || null });
  }
  return pairs;
}

function percentReduction(before, after) {
  if (!before) return 0;
  return ((before - after) / before) * 100;
}

// ---------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------

function postureState(assessment) {
  const severity = postureSeverity(assessment);
  const likelihood = postureLikelihood(assessment);
  const rating = severity * likelihood.value;
  const result = primaryResult(assessment);
  return {
    assessment: assessment,
    severity: severity,
    likelihood: likelihood,
    rating: rating,
    level: ratingLevel(rating),
    scoreText: assessment.method.toUpperCase() + ' ' + result.finalScore + '/' + (assessment.method === 'rula' ? 7 : 15),
  };
}

function makePostureHazard(code, pair) {
  const before = postureState(pair.baseline);
  const after = pair.followUp ? postureState(pair.followUp) : null;
  let reduction = null;
  if (after) {
    // Compare with the SAME method the original assessment used.
    const method = pair.baseline.method;
    const beforeScore = primaryResult(pair.baseline).finalScore;
    const afterScore = (method === 'rula' ? pair.followUp.rula : pair.followUp.reba).finalScore;
    reduction = {
      text: method.toUpperCase() + ' ' + beforeScore + ' → ' + afterScore,
      percent: percentReduction(beforeScore, afterScore),
      ratingText: before.rating + ' → ' + after.rating,
    };
  }
  return {
    code: code,
    type: 'posture',
    title: pair.baseline.task,
    before: before,
    after: after,
    current: after || before,
    reduction: reduction,
  };
}

function noiseState(assessment) {
  const severity = noiseSeverity(assessment.entries);
  const likelihood = noiseLikelihood(assessment.entries);
  const rating = severity * likelihood.value;
  return {
    assessment: assessment,
    severity: severity,
    likelihood: likelihood,
    rating: rating,
    level: ratingLevel(rating),
    scoreText: 'Dose ' + assessment.nioshDosePercent.toFixed(0) + '% (NIOSH)',
  };
}

function makeNoiseHazard(code, pair) {
  const before = noiseState(pair.baseline);
  const after = pair.followUp ? noiseState(pair.followUp) : null;
  let reduction = null;
  if (after) {
    reduction = {
      text: 'Dose ' + pair.baseline.nioshDosePercent.toFixed(0) + '% → ' + pair.followUp.nioshDosePercent.toFixed(0) + '%',
      percent: percentReduction(pair.baseline.nioshDosePercent, pair.followUp.nioshDosePercent),
      ratingText: before.rating + ' → ' + after.rating,
    };
  }
  return {
    code: code,
    type: 'noise',
    title: 'Noise exposure',
    before: before,
    after: after,
    current: after || before,
    reduction: reduction,
  };
}

// ---------------------------------------------------------------
// Actions (merged, ordered by the hierarchy of controls)
// ---------------------------------------------------------------

function buildActions(hazards) {
  const actions = [];
  for (const hazard of hazards) {
    const assessment = hazard.current.assessment;
    let list;
    if (hazard.type === 'posture') {
      list = assessment.recommendations || [];
    } else {
      list = generateNoiseActions(assessment.entries, assessment.standard);
    }
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      actions.push({
        key: assessment.id + ':' + index,
        hazardCode: hazard.code,
        hazardTitle: hazard.title,
        priority: item.priority,
        control: CONTROL_TYPES[item.control] ? item.control : 'engineering',
        bodyPart: item.bodyPart,
        issue: item.issue,
        action: item.action,
      });
    }
  }
  actions.sort(function (first, second) {
    const controlDifference = CONTROL_TYPES[first.control].order - CONTROL_TYPES[second.control].order;
    if (controlDifference !== 0) return controlDifference;
    return PRIORITY_RANK[first.priority] - PRIORITY_RANK[second.priority];
  });
  return actions;
}

// ---------------------------------------------------------------
// Personalised User vs Work graph (the five diagonal cells)
// ---------------------------------------------------------------

function worstHazard(hazards, type) {
  let worst = null;
  for (const hazard of hazards) {
    if (hazard.type !== type) continue;
    if (!worst || hazard.current.rating > worst.current.rating) worst = hazard;
  }
  return worst;
}

function buildGraphCells(worker, hazards, workstation, percentile) {
  const worstPosture = worstHazard(hazards, 'posture');
  const worstNoise = worstHazard(hazards, 'noise');
  const cells = {};

  // --- Anthropometry: does the workstation fit this body? ---
  let surfaceText = '';
  for (const item of workstation.recommendations) {
    if (item.key === 'workSurface') surfaceText = 'Work surface should be ' + formatRangeMm(item.low, item.high) + '.';
  }
  if (!worstPosture) {
    cells.anthropometry = { level: 'none', text: Math.round(percentile) + 'th percentile stature. ' + surfaceText + ' No posture assessment yet to check the fit.' };
  } else {
    const angles = worstPosture.current.assessment.angles;
    const factors = worstPosture.current.assessment.factors;
    const misfits = [];
    let severe = false;
    if (angles.trunk > 20) { misfits.push('trunk bent ' + Math.round(angles.trunk) + '°'); if (angles.trunk > 60) severe = true; }
    if (angles.neck > 20) misfits.push('neck bent ' + Math.round(angles.neck) + '°');
    if (angles.upperArm > 45) { misfits.push('arm raised ' + Math.round(angles.upperArm) + '°'); if (angles.upperArm > 90) severe = true; }
    if (!factors.seated && angles.knee > 60) { misfits.push('deep squat'); severe = true; }
    if (factors.shoulderRaised) misfits.push('shoulders raised');
    const level = misfits.length === 0 ? 'low' : (severe ? 'high' : 'medium');
    const fitText = misfits.length === 0 ? 'Observed posture is consistent with a good fit.' : 'Workstation does not fit: ' + misfits.join(', ') + '.';
    cells.anthropometry = { level: level, text: Math.round(percentile) + 'th percentile stature. ' + surfaceText + ' ' + fitText };
  }

  // --- Biomechanics: loading of the body ---
  if (!worstPosture) {
    cells.biomechanics = { level: 'none', text: 'No posture assessment yet.' };
  } else {
    const assessment = worstPosture.current.assessment;
    const full = recomputeAssessment(assessment);
    const result = assessment.method === 'rula' ? full.rula : full.reba;
    const parts = [];
    for (const partName in result.parts) {
      if (result.parts[partName].level !== 'low') parts.push(PART_NAMES[partName] + ' ' + result.parts[partName].score);
    }
    cells.biomechanics = {
      level: LEVEL_TO_CELL[result.riskLevel],
      text: worstPosture.title + ': ' + worstPosture.current.scoreText + '. ' +
        (parts.length ? 'Loaded body parts: ' + parts.join(', ') + '.' : 'No body part above low risk.') +
        (assessment.factors.loadKg > 0 ? ' Load ' + assessment.factors.loadKg + ' kg.' : ''),
    };
  }

  // --- Information handling: the noise environment the worker works in ---
  if (!worstNoise) {
    cells.informationHandling = { level: 'none', text: 'No noise assessment yet.' };
  } else {
    const assessment = worstNoise.current.assessment;
    let loudest = assessment.entries[0];
    for (const entry of assessment.entries) if (entry.levelDb > loudest.levelDb) loudest = entry;
    cells.informationHandling = {
      level: worstNoise.current.level,
      text: 'Shift Leq ' + (assessment.leq === null ? '—' : assessment.leq.toFixed(1)) + ' dB(A); loudest zone ' + loudest.zone + ' at ' + loudest.levelDb.toFixed(0) +
        ' dB(A). ' + (loudest.levelDb >= 85 ? 'Loud noise makes it harder to hear speech and warning signals and adds to fatigue.' : 'Noise is unlikely to interfere with communication.'),
    };
  }

  // --- Functional evaluation: did the fixes work? ---
  const verified = [];
  let worstAfterRank = -1;
  for (const hazard of hazards) {
    if (hazard.reduction) {
      verified.push(hazard.code + ' ' + hazard.title + ': ' + hazard.reduction.text + ' (' + (hazard.reduction.percent >= 0 ? '−' : '+') + Math.abs(hazard.reduction.percent).toFixed(0) + '%)');
      worstAfterRank = Math.max(worstAfterRank, LEVEL_RANK[hazard.after.level]);
    }
  }
  if (verified.length === 0) {
    cells.functional = { level: 'none', text: 'Not yet verified. Apply the fixes, then use "Re-assess after fix" to measure the improvement.' };
  } else {
    cells.functional = { level: worstAfterRank <= LEVEL_RANK.medium ? 'low' : 'medium', text: 'Verified after fixes — ' + verified.join('; ') + '.' };
  }

  // --- Aesthetic evaluation: not collected per worker in this version ---
  cells.aesthetic = { level: 'none', text: 'Not assessed for this worker. Collect the worker\'s comfort with and acceptance of the changed workstation.' };

  return cells;
}

const PART_NAMES = { neck: 'neck', trunk: 'trunk', upperArm: 'upper arm', lowerArm: 'lower arm', wrist: 'wrist', legs: 'legs' };
const LEVEL_TO_CELL = { negligible: 'low', low: 'low', medium: 'medium', high: 'high', veryhigh: 'veryhigh' };

// ---------------------------------------------------------------
// The whole profile
// ---------------------------------------------------------------

export function buildWorkerRiskProfile(worker, allPostureAssessments, allNoiseAssessments) {
  const postures = allPostureAssessments.filter(function (assessment) { return assessment.workerId === worker.id; });
  const noises = allNoiseAssessments.filter(function (assessment) { return assessment.workerId === worker.id; });

  const hazards = [];
  let postureNumber = 1;
  for (const pair of pairBaselinesWithFollowUps(postures)) {
    hazards.push(makePostureHazard('P' + postureNumber, pair));
    postureNumber++;
  }
  let noiseNumber = 1;
  for (const pair of pairBaselinesWithFollowUps(noises)) {
    hazards.push(makeNoiseHazard('N' + noiseNumber, pair));
    noiseNumber++;
  }

  // ---- overall risk ----
  let overallLevel = 'none';
  let worstPostureRank = -1;
  let worstNoiseRank = -1;
  for (const hazard of hazards) {
    const rank = LEVEL_RANK[hazard.current.level];
    if (rank > LEVEL_RANK[overallLevel]) overallLevel = hazard.current.level;
    if (hazard.type === 'posture') worstPostureRank = Math.max(worstPostureRank, rank);
    if (hazard.type === 'noise') worstNoiseRank = Math.max(worstNoiseRank, rank);
  }
  let combinedRuleApplied = false;
  if (worstPostureRank >= LEVEL_RANK.high && worstNoiseRank >= LEVEL_RANK.high && overallLevel !== 'veryhigh') {
    overallLevel = 'veryhigh';
    combinedRuleApplied = true;
  }

  const statureMm = worker.statureCm * 10;
  const percentile = percentileOfStature(statureMm, worker.sex);
  const workstation = recommendWorkstation(worker);
  const actions = buildActions(hazards);

  // ---- personalised 4W1H ----
  const sexWord = worker.sex === 'female' ? 'women' : 'men';
  const when = [];
  const where = [worker.workstation || 'Workstation not recorded'];
  const what = [];
  for (const hazard of hazards) {
    const current = hazard.current;
    if (hazard.type === 'posture') {
      when.push(hazard.code + ' ' + hazard.title + ': ' + current.likelihood.text);
    } else {
      when.push(hazard.code + ' Noise: ' + current.likelihood.text);
      for (const entry of current.assessment.entries) {
        where.push(entry.zone + ' (' + entry.levelDb.toFixed(0) + ' dB(A), ' + entry.hours + ' h)');
      }
    }
    let firstIssue = '';
    if (hazard.type === 'posture' && current.assessment.recommendations && current.assessment.recommendations.length) {
      firstIssue = ' — ' + current.assessment.recommendations[0].issue;
    }
    what.push(hazard.code + ' ' + hazard.title + ': ' + current.scoreText + firstIssue);
  }
  const how = [];
  const topActions = actions.slice().sort(function (first, second) { return PRIORITY_RANK[first.priority] - PRIORITY_RANK[second.priority]; });
  for (const action of topActions.slice(0, 3)) {
    how.push(action.action);
  }

  const fourWOneH = {
    who: worker.name + ', ' + worker.statureCm + ' cm — taller than about ' + Math.round(percentile) + '% of Indian adult ' + sexWord + '; works ' +
      (worker.workPosture === 'seated' ? 'seated' : 'standing') + ', ' + worker.taskType + ' work.',
    when: when.length ? when : ['No exposure recorded yet.'],
    where: where,
    what: what.length ? what : ['No hazards assessed yet.'],
    how: how.length ? how : ['Assess the worker first.'],
  };

  return {
    worker: worker,
    percentile: percentile,
    workstation: workstation,
    hazards: hazards,
    overallLevel: overallLevel,
    combinedRuleApplied: combinedRuleApplied,
    actions: actions,
    fourWOneH: fourWOneH,
    graph: buildGraphCells(worker, hazards, workstation, percentile),
  };
}

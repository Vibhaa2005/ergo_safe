// anthropometry.js
// Turns a worker's stature into body dimensions and recommended
// workstation dimensions.
//
// Method: body dimensions are estimated as fixed fractions of stature
// (segment-proportion method). Standing proportions follow Drillis &
// Contini (1966) as reproduced in Winter, "Biomechanics and Motor Control
// of Human Movement". Seated proportions are derived from the ratios in
// Pheasant & Haslegrave, "Bodyspace".
// Work-surface rules follow Grandjean, "Fitting the Task to the Man".
//
// NOTE: population values below are approximate Indian adult figures.
// Check them against Chakrabarti (1997), "Indian Anthropometric Dimensions
// for Ergonomic Design Practice", NID, before quoting in the report.

export const INDIAN_POPULATION = {
  male: { label: 'Indian adult men', statureMeanMm: 1650, statureSdMm: 65 },
  female: { label: 'Indian adult women', statureMeanMm: 1525, statureSdMm: 60 },
};

// Allowance added to floor-based heights for footwear (mm).
export const SHOE_ALLOWANCE_MM = 25;

// Body dimension = fraction × stature.
export const BODY_PROPORTIONS = [
  { key: 'eyeHeight', label: 'Eye height (standing)', fraction: 0.936 },
  { key: 'shoulderHeight', label: 'Shoulder height (standing)', fraction: 0.818 },
  { key: 'elbowHeight', label: 'Elbow height (standing)', fraction: 0.630 },
  { key: 'knuckleHeight', label: 'Knuckle height (standing)', fraction: 0.434 },
  { key: 'kneeHeight', label: 'Knee height (standing)', fraction: 0.285 },
  { key: 'upperArmLength', label: 'Upper arm length', fraction: 0.186 },
  { key: 'forearmLength', label: 'Forearm length', fraction: 0.146 },
  { key: 'handLength', label: 'Hand length', fraction: 0.108 },
  { key: 'shoulderBreadth', label: 'Shoulder breadth', fraction: 0.259 },
  { key: 'poplitealHeight', label: 'Popliteal height (under-knee, seated)', fraction: 0.253 },
  { key: 'sittingKneeHeight', label: 'Knee height (seated, top of knee)', fraction: 0.313 },
  { key: 'buttockPoplitealLength', label: 'Buttock–popliteal length', fraction: 0.284 },
  { key: 'sittingEyeHeight', label: 'Eye height above seat', fraction: 0.454 },
  { key: 'sittingElbowHeight', label: 'Elbow height above seat', fraction: 0.141 },
];

// ---------- statistics helpers ----------

// Normal distribution cumulative probability (Abramowitz & Stegun 7.1.26).
function normalCdf(z) {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const polynomial = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
  const erf = 1 - polynomial * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

const Z_FOR_PERCENTILE = { 5: -1.645, 50: 0, 95: 1.645 };

export function percentileOfStature(statureMm, sex) {
  const population = INDIAN_POPULATION[sex] || INDIAN_POPULATION.male;
  const z = (statureMm - population.statureMeanMm) / population.statureSdMm;
  return Math.max(0.1, Math.min(99.9, normalCdf(z) * 100));
}

export function statureAtPercentile(percentile, sex) {
  const population = INDIAN_POPULATION[sex] || INDIAN_POPULATION.male;
  return population.statureMeanMm + Z_FOR_PERCENTILE[percentile] * population.statureSdMm;
}

// ---------- body dimensions ----------

export function estimateBodyDimensions(statureMm) {
  const dimensions = {};
  for (const proportion of BODY_PROPORTIONS) {
    dimensions[proportion.key] = proportion.fraction * statureMm;
  }
  dimensions.normalReach = dimensions.forearmLength + dimensions.handLength;
  dimensions.maximumReach = dimensions.upperArmLength + dimensions.forearmLength + dimensions.handLength;
  return dimensions;
}

// ---------- workstation recommendations ----------

const WORK_SURFACE_RULES = {
  // offsets from elbow height in mm [lowest, highest]
  standing: {
    precision: { from: 50, to: 100, text: 'Precision work: 5–10 cm above elbow height, so the eyes are closer to the work.' },
    light: { from: -150, to: -100, text: 'Light assembly / packing: 10–15 cm below elbow height.' },
    heavy: { from: -400, to: -150, text: 'Heavy work using body weight: 15–40 cm below elbow height.' },
  },
  seated: {
    precision: { from: 50, to: 100, text: 'Precision work: 5–10 cm above seated elbow height.' },
    light: { from: -50, to: 0, text: 'Light work / keyboard: at or just below seated elbow height.' },
    heavy: { from: -150, to: -50, text: 'Heavier seated work: 5–15 cm below seated elbow height.' },
  },
};

// Returns the recommended dimensions for one worker.
// worker = { statureCm, workPosture: 'standing'|'seated', taskType: 'precision'|'light'|'heavy' }
export function recommendWorkstation(worker) {
  const statureMm = worker.statureCm * 10;
  const body = estimateBodyDimensions(statureMm);
  const posture = worker.workPosture === 'seated' ? 'seated' : 'standing';
  const task = WORK_SURFACE_RULES[posture][worker.taskType] ? worker.taskType : 'light';
  const rule = WORK_SURFACE_RULES[posture][task];
  const recommendations = [];

  if (posture === 'standing') {
    const elbowHeight = body.elbowHeight + SHOE_ALLOWANCE_MM;
    const eyeHeight = body.eyeHeight + SHOE_ALLOWANCE_MM;
    recommendations.push({ key: 'workSurface', label: 'Work surface height', low: elbowHeight + rule.from, high: elbowHeight + rule.to, note: rule.text });
    recommendations.push({ key: 'elbowHeight', label: 'Elbow height (with shoes)', low: elbowHeight, high: elbowHeight, note: 'Reference point for all work heights.' });
    recommendations.push({ key: 'display', label: 'Display / screen centre', low: eyeHeight - 250, high: eyeHeight - 100, note: 'Slightly below eye level (10°–20° downward gaze) keeps the neck neutral.' });
    recommendations.push({ key: 'storage', label: 'Best zone for frequent or heavy items', low: body.knuckleHeight + SHOE_ALLOWANCE_MM, high: body.shoulderHeight + SHOE_ALLOWANCE_MM, note: 'Between knuckle and shoulder height — no stooping, no reaching overhead.' });
  } else {
    const seatHeight = body.poplitealHeight + SHOE_ALLOWANCE_MM;
    const seatedElbow = seatHeight + body.sittingElbowHeight;
    const seatedEye = seatHeight + body.sittingEyeHeight;
    recommendations.push({ key: 'seatHeight', label: 'Seat height', low: seatHeight - 20, high: seatHeight, note: 'At or just below under-knee (popliteal) height, so the thighs are not pressed.' });
    recommendations.push({ key: 'seatDepth', label: 'Seat depth (maximum)', low: body.buttockPoplitealLength - 50, high: body.buttockPoplitealLength - 50, note: 'Shorter than thigh length so the seat edge does not press behind the knee.' });
    recommendations.push({ key: 'workSurface', label: 'Work surface height', low: seatedElbow + rule.from, high: seatedElbow + rule.to, note: rule.text });
    recommendations.push({ key: 'legRoom', label: 'Leg-room height under desk (minimum)', low: body.sittingKneeHeight + SHOE_ALLOWANCE_MM + 50, high: body.sittingKneeHeight + SHOE_ALLOWANCE_MM + 50, note: 'Seated knee height plus clearance to move the legs.' });
    recommendations.push({ key: 'display', label: 'Top of screen', low: seatedEye - 50, high: seatedEye, note: 'At or slightly below eye height; viewing distance 50–75 cm.' });
  }

  recommendations.push({ key: 'normalReach', label: 'Normal reach (elbow at side)', low: body.normalReach, high: body.normalReach, note: 'Place frequently used items within this distance of the elbow.' });
  recommendations.push({ key: 'maximumReach', label: 'Maximum reach (arm straight)', low: body.maximumReach, high: body.maximumReach, note: 'Occasional items only. Anything further forces the trunk to bend.' });

  return { posture: posture, task: task, body: body, recommendations: recommendations };
}

// Ranges for designing ONE adjustable workstation for the whole
// working population (5th percentile woman to 95th percentile man).
export function populationDesignRanges() {
  const smallStature = statureAtPercentile(5, 'female');
  const largeStature = statureAtPercentile(95, 'male');
  const small = estimateBodyDimensions(smallStature);
  const large = estimateBodyDimensions(largeStature);

  return {
    smallStatureMm: smallStature,
    largeStatureMm: largeStature,
    rows: [
      { label: 'Seat height', principle: 'Adjustable range', low: small.poplitealHeight + SHOE_ALLOWANCE_MM - 20, high: large.poplitealHeight + SHOE_ALLOWANCE_MM },
      { label: 'Standing light-work surface', principle: 'Adjustable range', low: small.elbowHeight + SHOE_ALLOWANCE_MM - 150, high: large.elbowHeight + SHOE_ALLOWANCE_MM - 100 },
      { label: 'Standing precision-work surface', principle: 'Adjustable range', low: small.elbowHeight + SHOE_ALLOWANCE_MM + 50, high: large.elbowHeight + SHOE_ALLOWANCE_MM + 100 },
      { label: 'Seat depth', principle: 'Design for the smallest (5th %ile woman)', low: small.buttockPoplitealLength - 50, high: small.buttockPoplitealLength - 50 },
      { label: 'Maximum reach to controls', principle: 'Design for the smallest (5th %ile woman)', low: small.maximumReach, high: small.maximumReach },
      { label: 'Leg-room height under desk', principle: 'Design for the largest (95th %ile man)', low: large.sittingKneeHeight + SHOE_ALLOWANCE_MM + 50, high: large.sittingKneeHeight + SHOE_ALLOWANCE_MM + 50 },
      { label: 'Overhead clearance / door height', principle: 'Design for the largest (95th %ile man)', low: largeStature + SHOE_ALLOWANCE_MM + 100, high: largeStature + SHOE_ALLOWANCE_MM + 100 },
    ],
  };
}

export function formatRangeMm(low, high) {
  const lowCm = Math.round(low / 10);
  const highCm = Math.round(high / 10);
  if (lowCm === highCm) {
    return lowCm + ' cm';
  }
  return lowCm + '–' + highCm + ' cm';
}

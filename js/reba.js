// reba.js
// Rapid Entire Body Assessment (Hignett & McAtamney, 2000).
// Best for standing work, lifting and whole-body tasks.
// Uses the same angle conventions as rula.js.

// Table A: [trunk-1][neck-1][legs-1]
const REBA_TABLE_A = [
  [[1, 2, 3, 4], [1, 2, 3, 4], [3, 3, 5, 6]],
  [[2, 3, 4, 5], [3, 4, 5, 6], [4, 5, 6, 7]],
  [[2, 4, 5, 6], [4, 5, 6, 7], [5, 6, 7, 8]],
  [[3, 5, 6, 7], [5, 6, 7, 8], [6, 7, 8, 9]],
  [[4, 6, 7, 8], [6, 7, 8, 9], [7, 8, 9, 9]],
];

// Table B: [upperArm-1][lowerArm-1][wrist-1]
const REBA_TABLE_B = [
  [[1, 2, 2], [1, 2, 3]],
  [[1, 2, 3], [2, 3, 4]],
  [[3, 4, 5], [4, 5, 5]],
  [[4, 5, 5], [5, 6, 7]],
  [[6, 7, 8], [7, 8, 8]],
  [[7, 8, 8], [8, 9, 9]],
];

// Table C: [scoreA-1][scoreB-1]
const REBA_TABLE_C = [
  [1, 1, 1, 2, 3, 3, 4, 5, 6, 7, 7, 7],
  [1, 2, 2, 3, 4, 4, 5, 6, 6, 7, 7, 8],
  [2, 3, 3, 3, 4, 5, 6, 7, 7, 8, 8, 8],
  [3, 4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9],
  [4, 4, 4, 5, 6, 7, 8, 8, 9, 9, 9, 9],
  [6, 6, 6, 7, 8, 8, 9, 9, 10, 10, 10, 10],
  [7, 7, 7, 8, 9, 9, 9, 10, 10, 11, 11, 11],
  [8, 8, 8, 9, 10, 10, 10, 10, 10, 11, 11, 11],
  [9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12],
  [10, 10, 10, 11, 11, 11, 11, 12, 12, 12, 12, 12],
  [11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12],
  [12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12],
];

const PART_THRESHOLDS = {
  neck: { medium: 2, high: 3 },
  trunk: { medium: 3, high: 4 },
  legs: { medium: 2, high: 3 },
  upperArm: { medium: 3, high: 4 },
  lowerArm: { medium: 2, high: 3 },
  wrist: { medium: 2, high: 3 },
};

const COUPLING_TEXT = ['good grip', 'fair grip', 'poor grip', 'unacceptable grip'];

function limit(value, smallest, largest) {
  return Math.max(smallest, Math.min(largest, value));
}

function partLevel(partName, score) {
  const threshold = PART_THRESHOLDS[partName];
  if (score >= threshold.high) return 'high';
  if (score >= threshold.medium) return 'medium';
  return 'low';
}

function roundAngle(angle) {
  return Math.round(angle) + '°';
}

export function computeReba(input) {
  const angles = input.angles;
  const factors = input.factors;
  const steps = [];

  // ================= Group A: trunk, neck, legs =================

  // ---- Neck ----
  let neckBase;
  let neckRange;
  if (angles.neck < -5) { neckBase = 2; neckRange = 'tilted back'; }
  else if (angles.neck <= 20) { neckBase = 1; neckRange = '0°–20° forward'; }
  else { neckBase = 2; neckRange = 'more than 20° forward'; }
  const neckAdjustments = [];
  let neckScore = neckBase;
  if (factors.neckTwisted || factors.neckSideBent) { neckScore += 1; neckAdjustments.push('+1 neck twisted or bent sideways'); }
  neckScore = limit(neckScore, 1, 3);
  steps.push({ name: 'Neck', detail: roundAngle(angles.neck) + ' (' + neckRange + ')', base: neckBase, adjustments: neckAdjustments, score: neckScore });

  // ---- Trunk ----
  let trunkBase;
  let trunkRange;
  const trunkAngle = angles.trunk;
  if (Math.abs(trunkAngle) <= 5) { trunkBase = 1; trunkRange = 'upright'; }
  else if (trunkAngle > 5 && trunkAngle <= 20) { trunkBase = 2; trunkRange = '0°–20° forward'; }
  else if (trunkAngle < -5 && trunkAngle >= -20) { trunkBase = 2; trunkRange = '0°–20° back'; }
  else if (trunkAngle > 20 && trunkAngle <= 60) { trunkBase = 3; trunkRange = '20°–60° forward'; }
  else if (trunkAngle < -20) { trunkBase = 3; trunkRange = 'more than 20° back'; }
  else { trunkBase = 4; trunkRange = 'more than 60° forward'; }
  const trunkAdjustments = [];
  let trunkScore = trunkBase;
  if (factors.trunkTwisted || factors.trunkSideBent) { trunkScore += 1; trunkAdjustments.push('+1 trunk twisted or bent sideways'); }
  trunkScore = limit(trunkScore, 1, 5);
  steps.push({ name: 'Trunk', detail: roundAngle(trunkAngle) + ' (' + trunkRange + ')', base: trunkBase, adjustments: trunkAdjustments, score: trunkScore });

  // ---- Legs ----
  const bothLegsBearingWeight = factors.seated || factors.legsSupported;
  const legsBase = bothLegsBearingWeight ? 1 : 2;
  const legsAdjustments = [];
  let legsScore = legsBase;
  if (!factors.seated) {
    if (angles.knee > 60) { legsScore += 2; legsAdjustments.push('+2 knees bent more than 60°'); }
    else if (angles.knee >= 30) { legsScore += 1; legsAdjustments.push('+1 knees bent 30°–60°'); }
  }
  legsScore = limit(legsScore, 1, 4);
  const legsDetail = factors.seated ? 'sitting' : (bothLegsBearingWeight ? 'weight on both legs' : 'weight on one leg / unstable') + ', knee ' + roundAngle(angles.knee);
  steps.push({ name: 'Legs', detail: legsDetail, base: legsBase, adjustments: legsAdjustments, score: legsScore });

  const tableAScore = REBA_TABLE_A[trunkScore - 1][neckScore - 1][legsScore - 1];

  // ---- Load / force ----
  let loadScore;
  if (factors.loadKg > 10) loadScore = 2;
  else if (factors.loadKg >= 5) loadScore = 1;
  else loadScore = 0;
  if (factors.loadPattern === 'shock') loadScore += 1;
  const scoreA = limit(tableAScore + loadScore, 1, 12);

  // ================= Group B: arms and wrists =================

  // ---- Upper arm ----
  let upperArmBase;
  let upperArmRange;
  if (angles.upperArm < -20) { upperArmBase = 2; upperArmRange = 'more than 20° behind the body'; }
  else if (angles.upperArm <= 20) { upperArmBase = 1; upperArmRange = '20° back to 20° forward'; }
  else if (angles.upperArm <= 45) { upperArmBase = 2; upperArmRange = '20°–45° forward'; }
  else if (angles.upperArm <= 90) { upperArmBase = 3; upperArmRange = '45°–90° forward'; }
  else { upperArmBase = 4; upperArmRange = 'above 90°'; }
  const upperArmAdjustments = [];
  let upperArmScore = upperArmBase;
  if (factors.shoulderRaised) { upperArmScore += 1; upperArmAdjustments.push('+1 shoulder raised'); }
  if (factors.armAbducted) { upperArmScore += 1; upperArmAdjustments.push('+1 arm out to the side'); }
  if (factors.armSupported) { upperArmScore -= 1; upperArmAdjustments.push('−1 arm supported / leaning'); }
  upperArmScore = limit(upperArmScore, 1, 6);
  steps.push({ name: 'Upper arm', detail: roundAngle(angles.upperArm) + ' (' + upperArmRange + ')', base: upperArmBase, adjustments: upperArmAdjustments, score: upperArmScore });

  // ---- Lower arm ----
  const lowerArmScore = (angles.lowerArm >= 60 && angles.lowerArm <= 100) ? 1 : 2;
  steps.push({ name: 'Lower arm', detail: roundAngle(angles.lowerArm) + ' elbow bend (ideal 60°–100°)', base: lowerArmScore, adjustments: [], score: lowerArmScore });

  // ---- Wrist ----
  const wristBase = angles.wrist <= 15 ? 1 : 2;
  const wristAdjustments = [];
  let wristScore = wristBase;
  if (factors.wristDeviated || factors.wristTwistEndRange) { wristScore += 1; wristAdjustments.push('+1 wrist bent sideways or twisted'); }
  wristScore = limit(wristScore, 1, 3);
  steps.push({ name: 'Wrist', detail: roundAngle(angles.wrist) + ' bend', base: wristBase, adjustments: wristAdjustments, score: wristScore });

  const tableBScore = REBA_TABLE_B[upperArmScore - 1][lowerArmScore - 1][wristScore - 1];

  // ---- Coupling (grip quality) ----
  const couplingScore = limit(factors.coupling, 0, 3);
  const scoreB = limit(tableBScore + couplingScore, 1, 12);

  // ================= Table C and activity =================
  const tableCScore = REBA_TABLE_C[scoreA - 1][scoreB - 1];
  let activityScore = 0;
  if (factors.staticOver1Min) activityScore += 1;
  if (factors.repeatedOver4PerMin) activityScore += 1;
  if (factors.rapidOrUnstable) activityScore += 1;
  const finalScore = tableCScore + activityScore;

  let riskLevel;
  let actionText;
  if (finalScore <= 1) { riskLevel = 'negligible'; actionText = 'Negligible risk — no action needed.'; }
  else if (finalScore <= 3) { riskLevel = 'low'; actionText = 'Low risk — change may be needed.'; }
  else if (finalScore <= 7) { riskLevel = 'medium'; actionText = 'Medium risk — investigate further and change soon.'; }
  else if (finalScore <= 10) { riskLevel = 'high'; actionText = 'High risk — investigate and implement change.'; }
  else { riskLevel = 'veryhigh'; actionText = 'Very high risk — implement change now.'; }

  return {
    method: 'REBA',
    maxScore: 15,
    steps: steps,
    summary: [
      { name: 'Table A (trunk, neck & legs)', score: tableAScore },
      { name: '+ Load / force', score: loadScore },
      { name: '= Score A', score: scoreA, total: true },
      { name: 'Table B (arms & wrist)', score: tableBScore },
      { name: '+ Coupling (' + COUPLING_TEXT[couplingScore] + ')', score: couplingScore },
      { name: '= Score B', score: scoreB, total: true },
      { name: 'Table C', score: tableCScore },
      { name: '+ Activity', score: activityScore },
      { name: '= Final REBA score', score: finalScore, total: true },
    ],
    parts: {
      neck: { score: neckScore, level: partLevel('neck', neckScore) },
      trunk: { score: trunkScore, level: partLevel('trunk', trunkScore) },
      upperArm: { score: upperArmScore, level: partLevel('upperArm', upperArmScore) },
      lowerArm: { score: lowerArmScore, level: partLevel('lowerArm', lowerArmScore) },
      wrist: { score: wristScore, level: partLevel('wrist', wristScore) },
      legs: { score: legsScore, level: partLevel('legs', legsScore) },
    },
    finalScore: finalScore,
    riskLevel: riskLevel,
    actionText: actionText,
  };
}

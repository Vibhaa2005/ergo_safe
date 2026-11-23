// rula.js
// Rapid Upper Limb Assessment (McAtamney & Corlett, 1993).
// Best for seated work and tasks that mainly use the arms, neck and trunk.
//
// Angle conventions used by the whole app (side view, in degrees):
//   trunk     : 0 = upright, + = bent forward, - = leaning back
//   neck      : 0 = in line with trunk, + = bent forward, - = tilted back
//   upperArm  : 0 = hanging by the side, + = raised forward, - = behind body
//   lowerArm  : elbow bend, 0 = straight arm
//   wrist     : bend away from straight (flexion or extension), always +
//   knee      : knee bend, 0 = straight leg

// Table A: [upperArm-1][lowerArm-1][wrist-1][wristTwist-1]
const RULA_TABLE_A = [
  [[[1, 2], [2, 2], [2, 3], [3, 3]], [[2, 2], [2, 2], [3, 3], [3, 3]], [[2, 3], [3, 3], [3, 3], [4, 4]]],
  [[[2, 3], [3, 3], [3, 4], [4, 4]], [[3, 3], [3, 3], [3, 4], [4, 4]], [[3, 4], [4, 4], [4, 4], [5, 5]]],
  [[[3, 3], [4, 4], [4, 4], [5, 5]], [[3, 4], [4, 4], [4, 4], [5, 5]], [[4, 4], [4, 4], [4, 5], [5, 5]]],
  [[[4, 4], [4, 4], [4, 5], [5, 5]], [[4, 4], [4, 4], [4, 5], [5, 5]], [[4, 4], [4, 5], [5, 5], [6, 6]]],
  [[[5, 5], [5, 5], [5, 6], [6, 7]], [[5, 6], [6, 6], [6, 7], [7, 7]], [[6, 6], [6, 7], [7, 7], [7, 8]]],
  [[[7, 7], [7, 7], [7, 8], [8, 9]], [[8, 8], [8, 8], [8, 9], [9, 9]], [[9, 9], [9, 9], [9, 9], [9, 9]]],
];

// Table B: [neck-1][trunk-1][legs-1]
const RULA_TABLE_B = [
  [[1, 3], [2, 3], [3, 4], [5, 5], [6, 6], [7, 7]],
  [[2, 3], [2, 3], [4, 5], [5, 5], [6, 7], [7, 7]],
  [[3, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 7]],
  [[5, 5], [5, 6], [6, 7], [7, 7], [7, 7], [8, 8]],
  [[7, 7], [7, 7], [7, 8], [8, 8], [8, 8], [8, 8]],
  [[8, 8], [8, 8], [8, 8], [8, 9], [9, 9], [9, 9]],
];

// Table C: [wristAndArmScore-1 (max 8)][neckTrunkLegScore-1 (max 7)]
const RULA_TABLE_C = [
  [1, 2, 3, 3, 4, 5, 5],
  [2, 2, 3, 4, 4, 5, 5],
  [3, 3, 3, 4, 4, 5, 6],
  [3, 3, 3, 4, 5, 6, 6],
  [4, 4, 4, 5, 6, 7, 7],
  [4, 4, 5, 6, 6, 7, 7],
  [5, 5, 6, 6, 7, 7, 7],
  [5, 5, 6, 7, 7, 7, 7],
];

// Score at which each body part is shown as medium / high on the body map.
const PART_THRESHOLDS = {
  upperArm: { medium: 3, high: 4 },
  lowerArm: { medium: 2, high: 3 },
  wrist: { medium: 3, high: 4 },
  neck: { medium: 3, high: 4 },
  trunk: { medium: 3, high: 4 },
  legs: { medium: 2, high: 3 },
};

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

// input = { angles: {...}, factors: {...} }  (see posture.js readFactors)
export function computeRula(input) {
  const angles = input.angles;
  const factors = input.factors;
  const steps = [];

  // ---- Step 1: upper arm ----
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

  // ---- Step 2: lower arm ----
  const lowerArmBase = (angles.lowerArm >= 60 && angles.lowerArm <= 100) ? 1 : 2;
  const lowerArmAdjustments = [];
  let lowerArmScore = lowerArmBase;
  if (factors.armAcrossMidline) { lowerArmScore += 1; lowerArmAdjustments.push('+1 working across the body or out to the side'); }
  lowerArmScore = limit(lowerArmScore, 1, 3);
  steps.push({ name: 'Lower arm', detail: roundAngle(angles.lowerArm) + ' elbow bend (ideal 60°–100°)', base: lowerArmBase, adjustments: lowerArmAdjustments, score: lowerArmScore });

  // ---- Step 3: wrist ----
  let wristBase;
  if (angles.wrist <= 5) wristBase = 1;
  else if (angles.wrist <= 15) wristBase = 2;
  else wristBase = 3;
  const wristAdjustments = [];
  let wristScore = wristBase;
  if (factors.wristDeviated) { wristScore += 1; wristAdjustments.push('+1 wrist bent sideways'); }
  wristScore = limit(wristScore, 1, 4);
  steps.push({ name: 'Wrist', detail: roundAngle(angles.wrist) + ' bend', base: wristBase, adjustments: wristAdjustments, score: wristScore });

  // ---- Step 4: wrist twist ----
  const wristTwistScore = factors.wristTwistEndRange ? 2 : 1;
  steps.push({ name: 'Wrist twist', detail: factors.wristTwistEndRange ? 'near end of range' : 'mid-range', base: wristTwistScore, adjustments: [], score: wristTwistScore });

  // ---- Step 5: Table A ----
  const tableAScore = RULA_TABLE_A[upperArmScore - 1][lowerArmScore - 1][wristScore - 1][wristTwistScore - 1];

  // ---- Steps 6–7: muscle use and force/load (added to both groups) ----
  const muscleUseScore = (factors.staticOver1Min || factors.repeatedOver4PerMin) ? 1 : 0;
  let forceScore;
  const loadKg = factors.loadKg;
  const pattern = factors.loadPattern; // 'intermittent' | 'static' | 'shock'
  if (pattern === 'shock') forceScore = 3;
  else if (loadKg > 10) forceScore = (pattern === 'intermittent') ? 2 : 3;
  else if (loadKg >= 2) forceScore = (pattern === 'intermittent') ? 1 : 2;
  else forceScore = 0;

  const wristAndArmScore = tableAScore + muscleUseScore + forceScore;

  // ---- Step 9: neck ----
  let neckBase;
  let neckRange;
  if (angles.neck < -5) { neckBase = 4; neckRange = 'tilted back'; }
  else if (angles.neck <= 10) { neckBase = 1; neckRange = '0°–10°'; }
  else if (angles.neck <= 20) { neckBase = 2; neckRange = '10°–20°'; }
  else { neckBase = 3; neckRange = 'more than 20°'; }
  const neckAdjustments = [];
  let neckScore = neckBase;
  if (factors.neckTwisted) { neckScore += 1; neckAdjustments.push('+1 neck twisted'); }
  if (factors.neckSideBent) { neckScore += 1; neckAdjustments.push('+1 neck bent sideways'); }
  neckScore = limit(neckScore, 1, 6);
  steps.push({ name: 'Neck', detail: roundAngle(angles.neck) + ' (' + neckRange + ')', base: neckBase, adjustments: neckAdjustments, score: neckScore });

  // ---- Step 10: trunk ----
  let trunkBase;
  let trunkRange;
  if (factors.seated && factors.trunkWellSupported && angles.trunk <= 20) { trunkBase = 1; trunkRange = 'seated and well supported'; }
  else if (Math.abs(angles.trunk) <= 5) { trunkBase = 1; trunkRange = 'upright'; }
  else if (angles.trunk < -5) { trunkBase = 2; trunkRange = 'leaning back'; }
  else if (angles.trunk <= 20) { trunkBase = 2; trunkRange = '0°–20° forward'; }
  else if (angles.trunk <= 60) { trunkBase = 3; trunkRange = '20°–60° forward'; }
  else { trunkBase = 4; trunkRange = 'more than 60° forward'; }
  const trunkAdjustments = [];
  let trunkScore = trunkBase;
  if (factors.trunkTwisted) { trunkScore += 1; trunkAdjustments.push('+1 trunk twisted'); }
  if (factors.trunkSideBent) { trunkScore += 1; trunkAdjustments.push('+1 trunk bent sideways'); }
  trunkScore = limit(trunkScore, 1, 6);
  steps.push({ name: 'Trunk', detail: roundAngle(angles.trunk) + ' (' + trunkRange + ')', base: trunkBase, adjustments: trunkAdjustments, score: trunkScore });

  // ---- Step 11: legs ----
  const legsScore = factors.legsSupported ? 1 : 2;
  steps.push({ name: 'Legs', detail: factors.legsSupported ? 'supported and balanced' : 'not supported or unbalanced', base: legsScore, adjustments: [], score: legsScore });

  // ---- Step 12: Table B ----
  const tableBScore = RULA_TABLE_B[neckScore - 1][trunkScore - 1][legsScore - 1];
  const neckTrunkLegScore = tableBScore + muscleUseScore + forceScore;

  // ---- Table C: final score ----
  const tableCRow = limit(wristAndArmScore, 1, 8);
  const tableCColumn = limit(neckTrunkLegScore, 1, 7);
  const finalScore = RULA_TABLE_C[tableCRow - 1][tableCColumn - 1];

  let riskLevel;
  let actionLevel;
  let actionText;
  if (finalScore <= 2) { riskLevel = 'low'; actionLevel = 1; actionText = 'Acceptable posture if not kept or repeated for long periods.'; }
  else if (finalScore <= 4) { riskLevel = 'medium'; actionLevel = 2; actionText = 'Investigate further — changes may be needed.'; }
  else if (finalScore <= 6) { riskLevel = 'high'; actionLevel = 3; actionText = 'Investigate and change soon.'; }
  else { riskLevel = 'veryhigh'; actionLevel = 4; actionText = 'Investigate and change immediately.'; }

  return {
    method: 'RULA',
    maxScore: 7,
    steps: steps,
    summary: [
      { name: 'Table A (arm & wrist posture)', score: tableAScore },
      { name: '+ Muscle use', score: muscleUseScore },
      { name: '+ Force / load', score: forceScore },
      { name: '= Wrist & arm score', score: wristAndArmScore, total: true },
      { name: 'Table B (neck, trunk & legs)', score: tableBScore },
      { name: '+ Muscle use', score: muscleUseScore },
      { name: '+ Force / load', score: forceScore },
      { name: '= Neck, trunk & leg score', score: neckTrunkLegScore, total: true },
      { name: 'Table C → final RULA score', score: finalScore, total: true },
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
    actionLevel: actionLevel,
    actionText: actionText,
  };
}

// recommendations.js
// Turns a posture assessment into specific, practical fixes.
// Where the worker's stature is known, fixes include exact heights from
// the anthropometry module, linking biomechanics back to anthropometry.

import { recommendWorkstation, formatRangeMm } from './anthropometry.js';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function findRecommendation(workstation, key) {
  if (!workstation) {
    return null;
  }
  for (const item of workstation.recommendations) {
    if (item.key === key) {
      return item;
    }
  }
  return null;
}

// input = { angles, factors, worker (may be null) }
export function generateRecommendations(input) {
  const angles = input.angles;
  const factors = input.factors;
  const worker = input.worker;
  const list = [];

  let workstation = null;
  let body = null;
  if (worker && worker.statureCm) {
    workstation = recommendWorkstation({
      statureCm: worker.statureCm,
      workPosture: factors.seated ? 'seated' : 'standing',
      taskType: worker.taskType || 'light',
    });
    body = workstation.body;
  }
  const surface = findRecommendation(workstation, 'workSurface');
  const display = findRecommendation(workstation, 'display');
  const surfaceText = surface ? ' For this worker the work surface should be ' + formatRangeMm(surface.low, surface.high) + ' high.' : ' Add the worker\'s height in the Workers tab to get an exact height.';

  function add(priority, bodyPart, issue, action, control) {
    list.push({ priority: priority, bodyPart: bodyPart, issue: issue, action: action, control: control || 'engineering' });
  }

  // ---- trunk ----
  if (angles.trunk > 60) {
    add('high', 'Back', 'Trunk bent forward ' + Math.round(angles.trunk) + '° (severe stoop).', 'Raise the work or bring it closer so the back stays within 20° of upright. Use a lift table or raised pallet for low items.' + surfaceText);
  } else if (angles.trunk > 20) {
    add('medium', 'Back', 'Trunk bent forward ' + Math.round(angles.trunk) + '°.', 'Bring the work closer and higher so the worker can stand or sit upright.' + surfaceText);
  } else if (angles.trunk < -10) {
    add('medium', 'Back', 'Trunk leaning back ' + Math.round(-angles.trunk) + '°.', 'Lower overhead work or use a platform so the worker does not lean back.');
  }
  if (factors.trunkTwisted || factors.trunkSideBent) {
    add('medium', 'Back', 'Trunk twisted or bent sideways.', 'Rearrange the layout so the worker faces the task; place incoming and outgoing items in front, not to the side. Use a swivel chair for seated work.');
  }

  // ---- neck ----
  if (angles.neck > 20) {
    const displayText = display ? ' Put the screen or work at ' + formatRangeMm(display.low, display.high) + ' from the floor.' : '';
    add(angles.neck > 35 ? 'high' : 'medium', 'Neck', 'Head bent forward ' + Math.round(angles.neck) + '°.', 'Raise the display or the work so the line of sight is only 10°–20° below horizontal. Tilt the work surface towards the worker for reading tasks.' + displayText);
  } else if (angles.neck < -5) {
    add('medium', 'Neck', 'Head tilted back ' + Math.round(-angles.neck) + '°.', 'Lower displays and overhead tasks below eye height.');
  }
  if (factors.neckTwisted || factors.neckSideBent) {
    add('low', 'Neck', 'Neck twisted or bent sideways.', 'Place the main display and the task directly in front of the worker.');
  }

  // ---- upper arm and shoulder ----
  const reachText = body ? ' Keep frequent items within ' + Math.round(body.normalReach / 10) + ' cm of the elbow and never beyond ' + Math.round(body.maximumReach / 10) + ' cm.' : '';
  if (angles.upperArm > 90) {
    add('high', 'Shoulder', 'Arm raised above shoulder level (' + Math.round(angles.upperArm) + '°).', 'Lower the work or use a step/platform so hands work below shoulder height.' + reachText);
  } else if (angles.upperArm > 45) {
    add('medium', 'Shoulder', 'Arm raised ' + Math.round(angles.upperArm) + '° forward.', 'Move items closer to the body; reduce reach distance.' + reachText);
  } else if (angles.upperArm < -20) {
    add('medium', 'Shoulder', 'Arm reaching behind the body.', 'Rearrange items so they are in front of the worker.');
  }
  if (factors.shoulderRaised) {
    add('medium', 'Shoulder', 'Shoulders raised (shrugging).', 'The work surface is too high — lower it by 5–10 cm or raise the chair and add a footrest.');
  }
  if (factors.armAbducted) {
    add('low', 'Shoulder', 'Elbows held out to the side.', 'Bring the work closer to the body\'s midline; check that the surface is not too high.');
  }

  // ---- lower arm and wrist ----
  if (angles.lowerArm < 60 || angles.lowerArm > 100) {
    add('low', 'Elbow', 'Elbow bend ' + Math.round(angles.lowerArm) + '° (best range 60°–100°).', 'Adjust work height so the forearms are close to horizontal while working.');
  }
  if (angles.wrist > 15 || factors.wristDeviated || factors.wristTwistEndRange) {
    add('medium', 'Wrist', 'Wrist bent or twisted while working.', 'Keep the wrist straight: use tools with angled handles ("bend the tool, not the wrist"), adjust the angle of the work piece, and avoid end-of-range twisting.');
  }

  // ---- legs ----
  if (!factors.seated && angles.knee > 60) {
    const storageItem = findRecommendation(workstation, 'storage');
    const storageText = storageItem ? ' Store items between ' + formatRangeMm(storageItem.low, storageItem.high).replace('–', ' and ') + ' from the floor.' : '';
    add('high', 'Legs', 'Deep squat or kneeling (knee ' + Math.round(angles.knee) + '°).', 'Raise low items to between knuckle and shoulder height; provide kneeling pads if unavoidable.' + storageText);
  } else if (!factors.seated && angles.knee >= 30) {
    add('low', 'Legs', 'Knees bent ' + Math.round(angles.knee) + '°.', 'Raise the work slightly so the worker can stand upright.');
  }
  if (!factors.legsSupported && !factors.seated) {
    add('medium', 'Legs', 'Weight on one leg or unstable footing.', 'Provide a stable, level floor; an anti-fatigue mat; or a foot rail to shift weight.');
  }

  // ---- load and activity ----
  if (factors.loadKg > 10 || factors.loadPattern === 'shock') {
    add('high', 'Load', 'Heavy load (' + factors.loadKg + ' kg)' + (factors.loadPattern === 'shock' ? ' with sudden force' : '') + '.', 'Use a mechanical aid (trolley, hoist, vacuum lifter) or a two-person lift; split loads into smaller units.');
  } else if (factors.loadKg >= 5) {
    add('medium', 'Load', 'Moderate load (' + factors.loadKg + ' kg).', 'Keep the load close to the body and between knuckle and shoulder height.', 'administrative');
  }
  if (factors.coupling >= 2) {
    add('medium', 'Grip', 'Poor grip on the load or tool.', 'Add handles or hand-holds; use containers with cut-outs; provide gloves with grip.');
  }
  if (factors.staticOver1Min) {
    add('low', 'Whole body', 'Posture held for more than a minute.', 'Allow micro-breaks and posture changes every 20–30 minutes; consider a sit-stand arrangement.', 'administrative');
  }
  if (factors.repeatedOver4PerMin) {
    add('medium', 'Whole body', 'Same action repeated more than 4 times a minute.', 'Rotate workers between tasks; automate or use jigs for the most repetitive step.', 'administrative');
  }
  if (factors.rapidOrUnstable) {
    add('medium', 'Whole body', 'Rapid large posture changes or unstable base.', 'Slow the work pace and give the worker a stable base of support.', 'administrative');
  }

  if (list.length === 0) {
    add('low', 'Whole body', 'No major posture problems found.', 'Posture is acceptable. Re-assess if the task, tools or workstation change.', 'administrative');
  }

  list.sort(function (first, second) {
    return PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority];
  });
  return list;
}

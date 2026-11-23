// pose.js
// Finds body landmarks in a photo or camera frame with Google MediaPipe
// Pose Landmarker (runs fully inside the browser, nothing is uploaded),
// then turns the landmarks into the joint angles RULA and REBA need.

const MEDIAPIPE_VERSION = '0.10.14';
const MEDIAPIPE_MODULE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MEDIAPIPE_VERSION + '/vision_bundle.mjs';
const MEDIAPIPE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MEDIAPIPE_VERSION + '/wasm';
const POSE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

// MediaPipe landmark numbers we use (left side / right side of the body).
const LANDMARKS = {
  nose: 0,
  ear: { left: 7, right: 8 },
  shoulder: { left: 11, right: 12 },
  elbow: { left: 13, right: 14 },
  wrist: { left: 15, right: 16 },
  index: { left: 19, right: 20 },
  hip: { left: 23, right: 24 },
  knee: { left: 25, right: 26 },
  ankle: { left: 27, right: 28 },
};

let poseLandmarker = null;
let currentRunningMode = null;
let loadingPromise = null;

// Loads the model the first time it is needed (about 9 MB, then cached).
export async function loadPoseModel(runningMode) {
  if (!poseLandmarker) {
    if (!loadingPromise) {
      loadingPromise = createLandmarker(runningMode);
    }
    poseLandmarker = await loadingPromise;
    currentRunningMode = runningMode;
  }
  if (currentRunningMode !== runningMode) {
    await poseLandmarker.setOptions({ runningMode: runningMode });
    currentRunningMode = runningMode;
  }
  return poseLandmarker;
}

async function createLandmarker(runningMode) {
  const vision = await import(MEDIAPIPE_MODULE_URL);
  const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate: 'GPU' },
    runningMode: runningMode,
    numPoses: 1,
  };
  try {
    return await vision.PoseLandmarker.createFromOptions(fileset, options);
  } catch (gpuError) {
    // Some phones have no usable GPU in the browser — fall back to the CPU.
    options.baseOptions.delegate = 'CPU';
    return await vision.PoseLandmarker.createFromOptions(fileset, options);
  }
}

export async function detectPoseInImage(imageSource) {
  const landmarker = await loadPoseModel('IMAGE');
  const result = landmarker.detect(imageSource);
  return result.landmarks && result.landmarks.length > 0 ? result.landmarks[0] : null;
}

export function detectPoseInVideoFrame(videoElement, timestampMs) {
  if (!poseLandmarker || currentRunningMode !== 'VIDEO') {
    return null;
  }
  const result = poseLandmarker.detectForVideo(videoElement, timestampMs);
  return result.landmarks && result.landmarks.length > 0 ? result.landmarks[0] : null;
}

// ---------- geometry helpers ----------

function toDegrees(radians) {
  return radians * 180 / Math.PI;
}

function vectorBetween(fromPoint, toPoint) {
  return { x: toPoint.x - fromPoint.x, y: toPoint.y - fromPoint.y };
}

// Angle from `reference` to `target` in degrees (-180..180).
// Screen y points down, so a clockwise turn on screen is positive here.
function signedAngle(reference, target) {
  const cross = reference.x * target.y - reference.y * target.x;
  const dot = reference.x * target.x + reference.y * target.y;
  return toDegrees(Math.atan2(cross, dot));
}

// Inside angle at `joint` between the two segments (0..180).
function insideAngle(pointA, joint, pointC) {
  const first = vectorBetween(joint, pointA);
  const second = vectorBetween(joint, pointC);
  return Math.abs(signedAngle(first, second));
}

// ---------- landmarks -> angles ----------

// landmarks: MediaPipe output (x, y between 0 and 1)
// width, height: size of the image in pixels (needed so angles are not
// distorted by the image's aspect ratio)
export function analysePose(landmarks, width, height) {
  const pixelPoints = [];
  for (const landmark of landmarks) {
    pixelPoints.push({ x: landmark.x * width, y: landmark.y * height, visibility: landmark.visibility === undefined ? 1 : landmark.visibility });
  }

  // 1. Use the side of the body that faces the camera (more visible).
  let leftVisibility = 0;
  let rightVisibility = 0;
  for (const part of ['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
    leftVisibility += pixelPoints[LANDMARKS[part].left].visibility;
    rightVisibility += pixelPoints[LANDMARKS[part].right].visibility;
  }
  const side = leftVisibility >= rightVisibility ? 'left' : 'right';

  const points = {
    nose: pixelPoints[LANDMARKS.nose],
    ear: pixelPoints[LANDMARKS.ear[side]],
    shoulder: pixelPoints[LANDMARKS.shoulder[side]],
    elbow: pixelPoints[LANDMARKS.elbow[side]],
    wrist: pixelPoints[LANDMARKS.wrist[side]],
    index: pixelPoints[LANDMARKS.index[side]],
    hip: pixelPoints[LANDMARKS.hip[side]],
    knee: pixelPoints[LANDMARKS.knee[side]],
    ankle: pixelPoints[LANDMARKS.ankle[side]],
  };

  // 2. Which way is the person facing? The nose is in front of the ear.
  //    forwardSign = +1 when facing right on screen, -1 when facing left.
  const forwardSign = points.nose.x >= points.ear.x ? 1 : -1;

  const up = { x: 0, y: -1 };
  const down = { x: 0, y: 1 };
  const trunkVector = vectorBetween(points.hip, points.shoulder);       // hip -> shoulder
  const trunkDownVector = vectorBetween(points.shoulder, points.hip);   // shoulder -> hip

  // Trunk: tilt of hip->shoulder line away from vertical (forward = +).
  const trunk = signedAngle(up, trunkVector) * forwardSign;

  // Neck: shoulder->ear line compared with the trunk line (forward = +).
  const neck = signedAngle(trunkVector, vectorBetween(points.shoulder, points.ear)) * forwardSign;

  // Upper arm: shoulder->elbow compared with the trunk pointing down
  // (raised forward = +). Turning from "down" towards "forward" is the
  // opposite screen direction to turning from "up", hence the minus sign.
  const upperArm = -signedAngle(trunkDownVector, vectorBetween(points.shoulder, points.elbow)) * forwardSign;

  // Lower arm: how much the elbow is bent (0 = straight).
  const lowerArm = 180 - insideAngle(points.shoulder, points.elbow, points.wrist);

  // Wrist: bend between forearm and hand (0 = straight). Hand landmarks are
  // the least reliable, so the app marks this one as "check".
  const wrist = 180 - insideAngle(points.elbow, points.wrist, points.index);

  // Knee: how much the knee is bent (0 = straight leg).
  const knee = 180 - insideAngle(points.hip, points.knee, points.ankle);

  // Seated guess: thigh close to horizontal. Only trusted when the hip and
  // knee are clearly visible — otherwise assume standing.
  const legsVisible = Math.min(points.hip.visibility, points.knee.visibility) >= 0.6;
  const thighFromVertical = Math.abs(signedAngle(down, vectorBetween(points.hip, points.knee)));
  const seatedGuess = legsVisible && thighFromVertical > 50;

  // Camera-view check. RULA/REBA angles are measured in the side (sagittal)
  // plane. In a side view the two shoulders overlap; in a front view they are
  // far apart compared with the trunk length, and the angles become wrong.
  const leftShoulder = pixelPoints[LANDMARKS.shoulder.left];
  const rightShoulder = pixelPoints[LANDMARKS.shoulder.right];
  const shoulderSpread = Math.abs(leftShoulder.x - rightShoulder.x);
  const trunkLength = Math.hypot(trunkVector.x, trunkVector.y);
  const shoulderToTrunkRatio = trunkLength > 0 ? shoulderSpread / trunkLength : 0;
  const looksFrontOn = shoulderToTrunkRatio > 0.45;

  function confidenceOf(names) {
    let smallest = 1;
    for (const name of names) {
      smallest = Math.min(smallest, points[name].visibility);
    }
    return smallest;
  }

  return {
    side: side,
    forwardSign: forwardSign,
    points: points,
    allPoints: pixelPoints,
    seatedGuess: seatedGuess,
    legsVisible: legsVisible,
    looksFrontOn: looksFrontOn,
    shoulderToTrunkRatio: shoulderToTrunkRatio,
    angles: {
      trunk: trunk,
      neck: neck,
      upperArm: upperArm,
      lowerArm: lowerArm,
      wrist: wrist,
      knee: knee,
    },
    confidence: {
      trunk: confidenceOf(['hip', 'shoulder']),
      neck: confidenceOf(['ear', 'shoulder', 'hip']),
      upperArm: confidenceOf(['shoulder', 'elbow', 'hip']),
      lowerArm: confidenceOf(['shoulder', 'elbow', 'wrist']),
      wrist: Math.min(0.5, confidenceOf(['elbow', 'wrist', 'index'])),
      knee: confidenceOf(['hip', 'knee', 'ankle']),
    },
  };
}

// ---------- drawing ----------

const LEVEL_COLOURS = {
  low: '#1f9d55',
  medium: '#d98a00',
  high: '#d64545',
  veryhigh: '#a3001b',
};

// Draws the measured side of the body on top of the image.
// partLevels = { neck: 'low', trunk: 'high', ... } from the active method.
export function drawPoseOverlay(context, pose, angles, partLevels) {
  if (!pose) {
    return;
  }
  const canvasWidth = context.canvas.width;
  const lineWidth = Math.max(4, canvasWidth / 150);
  const fontSize = Math.max(14, Math.round(canvasWidth / 42));
  const points = pose.points;

  function colourFor(partName) {
    const level = partLevels && partLevels[partName] ? partLevels[partName] : 'low';
    return LEVEL_COLOURS[level] || LEVEL_COLOURS.low;
  }

  function drawSegment(fromPoint, toPoint, partName) {
    context.strokeStyle = 'rgba(0,0,0,0.55)';
    context.lineWidth = lineWidth + 4;
    context.beginPath();
    context.moveTo(fromPoint.x, fromPoint.y);
    context.lineTo(toPoint.x, toPoint.y);
    context.stroke();
    context.strokeStyle = colourFor(partName);
    context.lineWidth = lineWidth;
    context.beginPath();
    context.moveTo(fromPoint.x, fromPoint.y);
    context.lineTo(toPoint.x, toPoint.y);
    context.stroke();
  }

  context.lineCap = 'round';
  drawSegment(points.shoulder, points.ear, 'neck');
  drawSegment(points.hip, points.shoulder, 'trunk');
  drawSegment(points.shoulder, points.elbow, 'upperArm');
  drawSegment(points.elbow, points.wrist, 'lowerArm');
  drawSegment(points.wrist, points.index, 'wrist');
  drawSegment(points.hip, points.knee, 'legs');
  drawSegment(points.knee, points.ankle, 'legs');

  for (const name of ['ear', 'shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle']) {
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#111111';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(points[name].x, points[name].y, lineWidth * 0.9, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  }

  function drawLabel(text, point, offsetX, offsetY) {
    context.font = '600 ' + fontSize + 'px system-ui, sans-serif';
    const textWidth = context.measureText(text).width;
    const boxX = point.x + offsetX;
    const boxY = point.y + offsetY;
    context.fillStyle = 'rgba(17,24,39,0.82)';
    context.fillRect(boxX - 6, boxY - fontSize, textWidth + 12, fontSize * 1.4);
    context.fillStyle = '#ffffff';
    context.fillText(text, boxX, boxY + fontSize * 0.1);
  }

  const awaySign = -pose.forwardSign; // put labels behind the body
  const gap = fontSize * 0.8;
  drawLabel('Neck ' + Math.round(angles.neck) + '°', points.ear, awaySign > 0 ? gap : -gap * 7, -gap);
  drawLabel('Trunk ' + Math.round(angles.trunk) + '°', midpoint(points.hip, points.shoulder), awaySign > 0 ? gap : -gap * 7.5, 0);
  drawLabel('Arm ' + Math.round(angles.upperArm) + '°', points.elbow, gap, gap * 1.2);
  drawLabel('Elbow ' + Math.round(angles.lowerArm) + '°', points.wrist, gap, gap * 1.6);
  drawLabel('Knee ' + Math.round(angles.knee) + '°', points.knee, awaySign > 0 ? gap : -gap * 7, 0);
}

function midpoint(first, second) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

// Minimal vector and quaternion maths.
//
// WHY NOT USE THREE.JS'S. Because the snap engine must not depend on a renderer.
// Everything in src/engine is pure, so it runs in vitest without a canvas, and
// so that if the Phase 0 spike concludes we should be on Babylon instead, the
// engine survives the switch untouched. Only src/three knows about three.js.
//
// Vectors are plain [x, y, z] arrays. Quaternions are [x, y, z, w], matching
// glTF's node.rotation order — NOT three.js's constructor order confusion.

export const EPS = 1e-6;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);

export function normalise(a) {
  const l = length(a);
  return l < EPS ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

/** Rotate a vector by a quaternion. Standard v' = q * v * q⁻¹, expanded. */
export function rotateVec(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * (q_vec × v)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function multiplyQuat(a, b) {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** A rotation of `angle` radians about the Y axis. */
export function quatFromYaw(angle) {
  const h = angle / 2;
  return [0, Math.sin(h), 0, Math.cos(h)];
}

/**
 * A rotation of `angle` radians about an arbitrary unit axis, as [x,y,z,w].
 *
 * Needed for ROLL — turning a part about the axis of the joint it sits on.
 * Every other rotation in this engine is a yaw, because every other joint is
 * solved by opposing two facings and yaw is the only freedom left. A joint that
 * also declares a roll needs the axis to be the joint's own, which is any
 * direction the parts happen to meet along.
 */
export function quatFromAxisAngle(axis, angle) {
  const [x, y, z] = normalise(axis);
  const h = angle / 2;
  const s = Math.sin(h);
  return [x * s, y * s, z * s, Math.cos(h)];
}

/**
 * The yaw of a horizontal direction, measured the way glTF/three.js expect:
 * zero along +Z, increasing towards +X.
 *
 * Vertical-ish vectors have no meaningful yaw, so this returns null rather than
 * quietly producing garbage — the caller decides whether that is an error.
 */
export function yawOf(v) {
  const horizontal = Math.hypot(v[0], v[2]);
  if (horizontal < EPS) return null;
  return Math.atan2(v[0], v[2]);
}

/** Apply a translation + rotation (no scale — see note in component.js). */
export function transformPoint({ translation, rotation }, p) {
  return add(translation, rotateVec(rotation, p));
}

export const approxEqual = (a, b, eps = 1e-4) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;

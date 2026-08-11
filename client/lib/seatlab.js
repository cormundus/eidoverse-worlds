// seatlab — #101's measuring instrument: where does a seated body ACTUALLY
// rest, relative to the seat its socket claims?
//
// Phase A doctrine (the issue, verbatim spirit): instrument before
// correcting. No magic offsets live here — this module only OBSERVES, and
// it reports every landmark CANDIDATE rather than blessing one, because a
// hips-bone origin may be normalization metadata rather than a contact
// surface (Mica's amendment). The Phase B acceptance regression will drive
// these same numbers; until then this is a laboratory bench, not a fix.
//
// All quantities in WORLD metres. Signed gaps are (landmark − seat surface):
// positive = the landmark floats above the authored seat.

import { THREE } from './core.js';
import { remotes } from './remotes.js';
import { entities, comps, avatarMounts, socketWorldPos, mountTransform } from './world.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();
const _a = new THREE.Vector3();

/** Deterministically COMPOSE a mounted rider the way the frame loop would —
 *  apply the seat's sit pose, settle the mixer, place the root at the socket
 *  — so a measurement doesn't depend on rAF having run (the browser pane may
 *  be hidden; and the numbers must be reproducible, not timing-dependent).
 *  Read-only intent: it drives the same code the renderer drives, nothing
 *  more. `settleMs`/`steps` advance the VRM mixer into the sit pose. */
export function composeSeat(riderId, { settleMs = 400, steps = 24 } = {}) {
  const m = avatarMounts.get(riderId);
  const rec = remotes.get(riderId);
  const avatar = rec?.avatar;
  if (!m || !avatar) return false;
  const sock = comps.get(m.to)?.sockets?.[m.slot];
  avatar.setClip?.(sock?.pose ?? 'sitchair');
  const dt = (settleMs / 1000) / steps;
  for (let i = 0; i < steps; i++) avatar.update?.(dt, performance.now());
  const sw = mountTransform(riderId, _a);
  if (sw) { avatar.root.position.copy(_a); avatar.root.rotation.y = sw.yaw; }
  avatar.vrm?.update?.(0);
  avatar.root.updateWorldMatrix(true, true);
  return true;
}

/** Measure one mounted rider. `localAvatar` supplies the browser-local
 *  body's avatar wrapper when measuring yourself (remotes only hold the
 *  others). Returns a plain JSON-able record, or {error}. */
export function measureSeat(riderId, { localAvatar = null } = {}) {
  const m = avatarMounts.get(riderId);
  if (!m) return { error: `${riderId} is not mounted` };
  const parent = entities.get(m.to);
  if (!parent) return { error: `mount parent ${m.to} not present` };
  const sock = comps.get(m.to)?.sockets?.[m.slot] ?? null;

  // ---- the seat's claim ----------------------------------------------------
  const seatPos = socketWorldPos(m.to, m.slot, _v);
  if (!seatPos) return { error: `socket ${m.to}/${m.slot} unresolvable` };
  const seat = { world: seatPos.toArray().map((n) => +n.toFixed(4)) };
  parent.getWorldQuaternion(_q);
  const fwd = _v.set(0, 0, 1).applyQuaternion(_q);
  seat.parentYaw = +Math.atan2(fwd.x, fwd.z).toFixed(4);
  seat.socketLocal = sock ? { pos: sock.pos ?? null, yaw: sock.yaw ?? 0, pose: sock.pose ?? 'sitchair', part: sock.part ?? null } : null;
  seat.mountOverrides = { offset: m.offset ?? null, yaw: m.yaw ?? null };
  const seatY = seatPos.y;

  // ---- the body ------------------------------------------------------------
  const rec = remotes.get(riderId);
  const avatar = rec?.avatar ?? localAvatar;
  if (!avatar) return { error: `${riderId} has no avatar here`, seat };
  const kind = rec ? 'remote' : 'local';
  const vrm = avatar.vrm ?? null;
  const humanoid = !!vrm?.humanoid;

  const root = avatar.root;
  root.updateWorldMatrix(true, true);
  const rootY = root.getWorldPosition(_v).y;

  // every landmark CANDIDATE, none blessed (the amendment): a hips origin
  // can be rig metadata; bounds are geometry; the truth is for the table
  const candidates = { root: +(rootY - seatY).toFixed(4) };
  let hipsRawY = null, hipsNormY = null;
  if (humanoid) {
    const raw = vrm.humanoid.getRawBoneNode?.('hips');
    const norm = vrm.humanoid.getNormalizedBoneNode?.('hips');
    if (raw) { raw.updateWorldMatrix(true, false); hipsRawY = raw.getWorldPosition(_v).y; candidates.hipsRaw = +(hipsRawY - seatY).toFixed(4); }
    if (norm) { norm.updateWorldMatrix(true, false); hipsNormY = norm.getWorldPosition(_v).y; candidates.hipsNormalized = +(hipsNormY - seatY).toFixed(4); }
  }
  _box.setFromObject(vrm?.scene ?? root);
  candidates.boundsMin = +(_box.min.y - seatY).toFixed(4);
  const bounds = { height: +(_box.max.y - _box.min.y).toFixed(4),
    width: +(_box.max.x - _box.min.x).toFixed(4), depth: +(_box.max.z - _box.min.z).toFixed(4) };

  return {
    rider: riderId, kind,
    rig: humanoid ? 'vrm-humanoid' : 'unsupported (no humanoid mapping)',
    avatarPath: rec?.avatarPath ?? '(local)',
    activeClip: rec?.lastClip ?? avatar.currentSlot ?? null,
    seat,
    body: { rootWorldY: +rootY.toFixed(4), hipsRawWorldY: hipsRawY && +hipsRawY.toFixed(4),
      hipsNormWorldY: hipsNormY && +hipsNormY.toFixed(4), bounds },
    /** signed vertical gaps, landmark − authored seat surface (＋ = floats) */
    gap: candidates,
  };
}

/** Every mounted rider at once — the table row generator. */
export function measureAllSeats(opts = {}) {
  return [...avatarMounts.keys()].map((id) => measureSeat(id, opts));
}

/** RIG-INTRINSIC sit geometry — the quantity that actually produces the
 *  hover, isolated from world, mount and entity scale (Mica's amendment:
 *  show the landmark candidates; a hips origin may be metadata, not a seat).
 *  Places the avatar's root at the origin with identity transform, applies
 *  the seat's sit pose with the mixer settled, and reads each landmark's Y
 *  in ROOT-LOCAL metres. The seat mechanic is "root goes to the socket"
 *  (remotes.js), so each landmark's root-local Y IS its signed gap above
 *  the authored seat once mounted. Restores the transform after. */
export function measureRigIntrinsic(avatar, { pose = 'sitchair', settleMs = 600, steps = 36 } = {}) {
  if (!avatar?.root) return { error: 'no avatar' };
  const vrm = avatar.vrm ?? null;
  const humanoid = !!vrm?.humanoid;
  const root = avatar.root;
  // snapshot + neutralize the root frame so world Y == root-local Y
  const savePos = root.position.clone(), saveRot = root.rotation.clone(), saveScl = root.scale.clone();
  root.position.set(0, 0, 0); root.rotation.set(0, 0, 0); root.scale.set(1, 1, 1);

  avatar.setClip?.(pose);
  const clipReady = !!avatar.actions?.[pose] || !!avatar.actions?.sit;
  const dt = (settleMs / 1000) / steps;
  for (let i = 0; i < steps; i++) avatar.update?.(dt, performance.now());
  vrm?.update?.(0);
  root.updateWorldMatrix(true, true);

  const yOf = (node) => { if (!node) return null; node.updateWorldMatrix(true, false); return +node.getWorldPosition(_v).y.toFixed(4); };
  const bone = (n) => vrm?.humanoid?.getRawBoneNode?.(n) ?? null;
  const out = {
    rig: humanoid ? 'vrm-humanoid' : 'unsupported',
    pose, clipReady,
    landmarks: {
      root: 0,
      hips: yOf(bone('hips')),
      spine: yOf(bone('spine')),
      leftUpperLeg: yOf(bone('leftUpperLeg')),
      leftFoot: yOf(bone('leftFoot')),
      head: yOf(bone('head')),
    },
  };
  _box.setFromObject(vrm?.scene ?? root);
  out.bounds = { minY: +_box.min.y.toFixed(4), maxY: +_box.max.y.toFixed(4), height: +(_box.max.y - _box.min.y).toFixed(4) };

  root.position.copy(savePos); root.rotation.copy(saveRot); root.scale.copy(saveScl);
  root.updateWorldMatrix(true, true);
  return out;
}

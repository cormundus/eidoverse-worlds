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

// ---- the detached lab (#101 Phase A, revised per Mica review) ---------------
// Measurements happen on instances the lab OWNS — constructed, pulled
// off-scene, measured, disposed. No live resident is ever posed, re-clipped
// or moved: the passive measureSeat above only reads, and everything below
// touches only lab-created bodies (review B1).

import { scene } from './core.js';
import { makeAvatar } from './avatar.js';

/** Measure one avatar instance's sit-pose geometry, with full animation
 *  receipts (review B2) and a MEASURED contact candidate (review B3): the
 *  lowest skinned vertex among those weighted ≥ minWeight to the pelvis
 *  bone set, under the settled pose — an actual support surface, not a
 *  joint origin. Root is neutralized to the origin, so every Y is
 *  root-local = the signed gap above an authored seat once mounted.
 *  The caller owns `av` and its lifecycle; `labRig` below does both. */
export function labAvatar(av, { pose = 'sitchair', settleMs = 1200, steps = 72 } = {}) {
  if (!av?.root) return { error: 'no avatar' };
  const vrm = av.vrm ?? null;
  if (!vrm?.humanoid) {
    // the legible refusal (review receipt 6): no humanoid mapping means no
    // seat landmark exists to derive — say so, never guess
    return { rig: 'unsupported', refusal: 'no humanoid mapping — no seat landmark derivable' };
  }
  av.root.position.set(0, 0, 0); av.root.rotation.set(0, 0, 0); av.root.scale.set(1, 1, 1);

  // ---- animation receipts: what ACTUALLY produced this skeleton -----------
  av.setClip(pose);
  const actual = av.currentSlot;
  const action = av.actions[actual] ?? null;
  if (action) { action.time = 0; }               // known phase: start of clip
  const dt = (settleMs / 1000) / steps;
  for (let i = 0; i < steps; i++) av.update(dt, 0);
  vrm.update?.(0);
  av.root.updateWorldMatrix(true, true);
  const anim = {
    requestedPose: pose,
    actualSlot: actual,
    fallback: actual !== pose,
    available: { sitchair: !!av.actions.sitchair, sit: !!av.actions.sit, idle: !!av.actions.idle },
    actionTime: action ? +action.time.toFixed(4) : null,
    actionWeight: action ? +action.getEffectiveWeight().toFixed(4) : null,
  };

  // ---- landmarks (bone origins — context, not contact) --------------------
  const yOf = (n) => { const b = vrm.humanoid.getRawBoneNode?.(n); if (!b) return null; b.updateWorldMatrix(true, false); return +b.getWorldPosition(_v).y.toFixed(4); };
  const landmarks = { root: 0, hips: yOf('hips'), spine: yOf('spine'),
    leftUpperLeg: yOf('leftUpperLeg'), leftFoot: yOf('leftFoot'), head: yOf('head') };

  // ---- the measured contact candidate (skinned pelvis underside) ----------
  const pelvis = ['hips', 'leftUpperLeg', 'rightUpperLeg']
    .map((n) => vrm.humanoid.getRawBoneNode?.(n)).filter(Boolean);
  let contactY = Infinity, sampled = 0, meshes = 0;
  const minWeight = 0.5;
  vrm.scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const boneIdx = new Set(pelvis.map((b) => o.skeleton.bones.indexOf(b)).filter((i) => i >= 0));
    if (!boneIdx.size) return;
    meshes++;
    const si = o.geometry.getAttribute('skinIndex'), sw = o.geometry.getAttribute('skinWeight');
    for (let i = 0; i < si.count; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (boneIdx.has(si.getComponent(i, k))) w += sw.getComponent(i, k);
      if (w < minWeight) continue;
      o.getVertexPosition(i, _v).applyMatrix4(o.matrixWorld);   // skinned, root-local (root at origin)
      sampled++;
      if (_v.y < contactY) contactY = _v.y;
    }
  });
  _box.setFromObject(vrm.scene);
  const bounds = { minY: +_box.min.y.toFixed(4), maxY: +_box.max.y.toFixed(4) };
  const contact = sampled
    ? { seatContactY: +contactY.toFixed(4), sampledVerts: sampled, meshes,
        plausible: contactY >= _box.min.y - 0.1 && contactY <= _box.max.y }
    : { error: 'no pelvis-weighted vertices found' };

  return { rig: 'vrm-humanoid', anim, landmarks, contact, bounds };
}

/** Construct a DETACHED instance of an avatar, measure it `runs` times for
 *  determinism, dispose it. Never touches the scene or any resident. */
export async function labRig(avatarPath, { pose = 'sitchair', runs = 3 } = {}) {
  const av = await makeAvatar(`seatlab-${Math.random().toString(36).slice(2, 8)}`, avatarPath, { urgent: true });
  try {
    scene.remove(av.root);
    if (av.gaze) scene.remove(av.gaze);
    await av.hydrateClips();                       // review B2: never measure a fallback unknowingly
    const results = [];
    for (let r = 0; r < runs; r++) results.push(labAvatar(av, { pose }));
    const keys = results.map((x) => JSON.stringify(x));
    return { avatarPath, runs, deterministic: keys.every((k) => k === keys[0]), result: results[0],
      ...(keys.every((k) => k === keys[0]) ? {} : { allRuns: results }) };
  } finally { av.dispose(); }
}

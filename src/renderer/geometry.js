// Pure ring geometry, shared by the ring and the tests.
// Angles are degrees, 0 = straight up, increasing clockwise (like a clock).

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RGGeometry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function norm(a) {
    return ((a % 360) + 360) % 360;
  }

  function angleOf(dx, dy) {
    return norm((Math.atan2(dx, -dy) * 180) / Math.PI);
  }

  function angDiff(a, b) {
    const d = Math.abs(norm(a) - norm(b));
    return d > 180 ? 360 - d : d;
  }

  // Directions for n items. At the root ring the first item points up. In a
  // sub-ring one slot is reserved for "back" (pointing at the parent) and the
  // items take the remaining slots, so the way back is always where you came
  // from.
  function slotAngles(n, backAngle) {
    if (backAngle === undefined || backAngle === null) {
      const step = 360 / n;
      return { items: Array.from({ length: n }, (_, i) => norm(i * step)), back: null };
    }
    const step = 360 / (n + 1);
    return {
      items: Array.from({ length: n }, (_, i) => norm(backAngle + (i + 1) * step)),
      back: norm(backAngle),
    };
  }

  // What the pointer is aiming at: an item index, 'back', or -1 inside the
  // dead zone. Direction is all that matters, not distance - that is what
  // makes a flick work without aiming.
  function aimAt(slots, dx, dy, deadZone) {
    if (Math.hypot(dx, dy) < deadZone) return -1;
    const a = angleOf(dx, dy);
    let best = -1;
    let bestD = 999;
    slots.items.forEach((s, i) => {
      const d = angDiff(a, s);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (slots.back !== null && angDiff(a, slots.back) < bestD) return 'back';
    return best;
  }

  function polar(cx, cy, angle, r) {
    const rad = (angle * Math.PI) / 180;
    return { x: cx + Math.sin(rad) * r, y: cy - Math.cos(rad) * r };
  }

  // Keep the whole ring on screen when opened near an edge.
  function clampCenter(x, y, w, h, margin) {
    return {
      x: Math.min(Math.max(x, margin), Math.max(margin, w - margin)),
      y: Math.min(Math.max(y, margin), Math.max(margin, h - margin)),
    };
  }

  return { norm, angleOf, angDiff, slotAngles, aimAt, polar, clampCenter };
});

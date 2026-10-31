// Geofence arithmetic (part 02.02): circles and polygons on the earth's surface, in metres. Pure functions, no database.
// A polygon is a closed ring of [latitude, longitude] pairs (first point repeated as the last). At site scale (a few km) a local
// flat projection around the shape is accurate to well under a metre, which is far finer than a phone's GPS.

export const MIN_RADIUS_M = 25;
export const MAX_RADIUS_M = 5000;
export const MAX_VERTICES = 200;
export const MAX_EXTENT_M = 10_000;
export const DEFAULT_TOLERANCE_M = 10;
export const MAX_TOLERANCE_M = 100;

const EARTH_M = 6_371_008.8;
const rad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const project = (origin) => (p) => ({ x: rad(p.lng - origin.lng) * Math.cos(rad(origin.lat)) * EARTH_M, y: rad(p.lat - origin.lat) * EARTH_M });
const pt = ([lat, lng]) => ({ lat, lng });

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const onSegment = (a, b, p) => Math.min(a.x, b.x) - 1e-9 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-9 && Math.min(a.y, b.y) - 1e-9 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-9;
/** Do segments ab and cd touch or cross? */
function segmentsMeet(a, b, c, d) {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return (d1 === 0 && onSegment(c, d, a)) || (d2 === 0 && onSegment(c, d, b)) || (d3 === 0 && onSegment(a, b, c)) || (d4 === 0 && onSegment(a, b, d));
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function insideRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Why a polygon is not acceptable, or an empty list (BR-02: closed, not self-intersecting). */
export function polygonProblems(polygon) {
  if (!Array.isArray(polygon)) return ['The polygon must be a list of points.'];
  if (polygon.length < 4) return ['A polygon needs at least three corners, and the first point repeated at the end to close it.'];
  if (polygon.length > MAX_VERTICES) return [`A polygon can have at most ${MAX_VERTICES - 1} corners.`];
  for (const p of polygon) {
    if (!Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return ['Every point must be [latitude, longitude] within the valid range.'];
  }
  const first = polygon[0];
  const last = polygon[polygon.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return ['The polygon is not closed: the last point must equal the first.'];
  const flat = project(pt(first));
  const ring = polygon.map((p) => flat(pt(p)));
  const n = ring.length - 1; // distinct vertices
  for (let i = 0; i < n; i++) if (ring[i].x === ring[(i + 1) % n].x && ring[i].y === ring[(i + 1) % n].y) return ['Two consecutive points are the same.'];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // neighbours share one corner; they must not also overlap along a line (a spike that doubles back)
        const [s, t] = j === i + 1 ? [i, j] : [j, i];
        const a = ring[s];
        const shared = ring[t];
        const b = ring[(t + 1) % n];
        if (cross(a, shared, b) === 0 && ((shared.x - a.x) * (b.x - shared.x) + (shared.y - a.y) * (b.y - shared.y)) < 0) return ['The polygon doubles back on itself.'];
        continue;
      }
      if (segmentsMeet(ring[i], ring[i + 1], ring[j], ring[j + 1])) return ['The polygon crosses itself. Redraw it so its edges do not cross.'];
    }
  }
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) > MAX_EXTENT_M) return [`The polygon is larger than ${MAX_EXTENT_M / 1000} km across.`];
  const area = Math.abs(ring.slice(0, n).reduce((s, p, i) => s + (p.x * ring[(i + 1) % n].y - ring[(i + 1) % n].x * p.y), 0)) / 2;
  if (area < Math.PI * MIN_RADIUS_M ** 2) return [`The polygon is smaller than a ${MIN_RADIUS_M} m circle.`];
  return [];
}

/** Check a geofence description. Returns a list of problems (empty when valid). */
export function geofenceProblems(g) {
  if (!g || g.type === 'NONE') return [];
  if (g.type === 'CIRCLE') {
    const problems = [];
    if (!Number.isInteger(g.radiusM) || g.radiusM < MIN_RADIUS_M || g.radiusM > MAX_RADIUS_M) problems.push(`The radius must be a whole number of metres from ${MIN_RADIUS_M} to ${MAX_RADIUS_M}.`);
    if (!Number.isFinite(g.latitude) || !Number.isFinite(g.longitude) || Math.abs(g.latitude) > 90 || Math.abs(g.longitude) > 180) problems.push('A circle needs a centre (latitude and longitude).');
    return problems;
  }
  if (g.type === 'POLYGON') return polygonProblems(g.polygon);
  return ['The geofence type must be NONE, CIRCLE or POLYGON.'];
}

/**
 * Is a coordinate inside a geofence? `toleranceM` forgives GPS error at the edge: a point up to that far outside still counts
 * as inside. `edgeDistanceM` is negative inside, positive outside (how far from the boundary).
 */
export function testPoint(g, point, toleranceM = DEFAULT_TOLERANCE_M) {
  const tol = Math.min(Math.max(toleranceM, 0), MAX_TOLERANCE_M);
  if (!g || g.type === 'NONE') return { method: 'NONE', inside: false, strictlyInside: false, edgeDistanceM: null, toleranceM: tol };
  let edge;
  if (g.type === 'CIRCLE') {
    edge = distanceM({ lat: g.latitude, lng: g.longitude }, point) - g.radiusM;
  } else {
    const flat = project(pt(g.polygon[0]));
    const ring = g.polygon.map((p) => flat(pt(p)));
    const p = flat(point);
    let min = Infinity;
    for (let i = 0; i < ring.length - 1; i++) min = Math.min(min, distanceToSegment(p, ring[i], ring[i + 1]));
    edge = insideRing(p, ring) ? -min : min;
  }
  const rounded = Math.round(edge * 100) / 100;
  return { method: g.type, inside: edge <= tol, strictlyInside: edge <= 0, edgeDistanceM: rounded, toleranceM: tol };
}

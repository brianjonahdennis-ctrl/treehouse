import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Point = { latitude: number; longitude: number };
type NavigationRoute = {
  distance_m: number;
  duration_seconds: number;
  points: Point[];
  steps: { instruction: string; distance_m: number; distance_from_start_m: number }[];
};

const response = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const routeCache = new Map<string, { at: number; route: NavigationRoute }>();
const memberLimits = new Map<string, { lastAt: number; requests: number[] }>();
const CACHE_MS = 30_000;
const MIN_REQUEST_MS = 20_000;
const HOUR_MS = 60 * 60_000;
const FIELD_MASK = [
  'routes.distanceMeters', 'routes.duration', 'routes.polyline.encodedPolyline',
  'routes.legs.steps.distanceMeters', 'routes.legs.steps.navigationInstruction.instructions',
].join(',');

function isPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return Object.keys(point).length === 2 && Object.keys(point).every((key) => key === 'latitude' || key === 'longitude')
    && typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

function decodePolyline(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0, latitude = 0, longitude = 0;
  const read = () => {
    let result = 0, shift = 0, byte = 0;
    do {
      if (index >= encoded.length || shift > 30) throw new Error('Invalid route polyline.');
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) throw new Error('Invalid route polyline.');
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length && points.length < 6000) {
    latitude += read(); longitude += read();
    points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
  }
  return points;
}

function parseDuration(value: unknown): number {
  const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(value) : null;
  return match ? Math.max(0, Number(match[1])) : 0;
}

function compactPolyline(points: Point[]): Point[] {
  if (points.length <= 2000) return points;
  const last = points.length - 1;
  return Array.from({ length: 2000 }, (_, index) => points[Math.round(index * last / 1999)]);
}

function routeKey(origin: Point, destination: Point, travelMode: string) {
  return `${origin.latitude.toFixed(6)},${origin.longitude.toFixed(6)}:${destination.latitude.toFixed(6)},${destination.longitude.toFixed(6)}:${travelMode}`;
}

function limited(member: string): boolean {
  const now = Date.now();
  const state = memberLimits.get(member) || { lastAt: 0, requests: [] };
  state.requests = state.requests.filter((at) => now - at < HOUR_MS);
  if (now - state.lastAt < MIN_REQUEST_MS || state.requests.length >= 60) return true;
  state.lastAt = now;
  state.requests.push(now);
  memberLimits.set(member, state);
  if (memberLimits.size > 10_000) {
    for (const [id, item] of memberLimits) if (!item.requests.some((at) => now - at < HOUR_MS)) memberLimits.delete(id);
  }
  return false;
}

export async function POST(request: Request) {
  let body: Record<string, unknown> | null = null;
  try {
    const raw = await request.text();
    if (raw.length > 4000) return response(400, { error: 'bad_request', message: 'Invalid route request.' });
    body = JSON.parse(raw);
  } catch { return response(400, { error: 'bad_request', message: 'Invalid route request.' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 3 || !Object.keys(body).every((key) => ['hunt', 'origin', 'travelMode'].includes(key))
    || typeof body.hunt !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.hunt)
    || !isPoint(body.origin) || !['WALK', 'DRIVE'].includes(String(body.travelMode))) {
    return response(400, { error: 'bad_request', message: 'Invalid route request.' });
  }
  const origin = body.origin, hunt = body.hunt, travelMode = String(body.travelMode);
  const token = (/^Bearer ([A-Za-z0-9._~-]{12,4000})$/.exec(request.headers.get('authorization') || '') || [])[1];
  if (!token) return response(401, { error: 'signed_out', message: 'Sign in to get road directions.' });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  if (!url || !publishableKey) return response(503, { error: 'unavailable', message: 'Road directions are unavailable. Follow the direction arrow or Google Maps.' });
  let member = '';
  let supabase;
  try {
    supabase = createClient(url, publishableKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return response(401, { error: 'signed_out', message: 'Sign in again to get road directions.' });
    member = data.user.id;
  } catch { return response(401, { error: 'signed_out', message: 'Sign in again to get road directions.' }); }
  if (limited(member)) return response(429, { error: 'too_many', message: 'Please wait before refreshing road directions.' });

  let destination: Point;
  try {
    const { data, error } = await supabase.rpc('treasure_hunt_progress', { p_hunt: hunt });
    if (error) return response(403, { error: 'target_unavailable', message: 'Join this hunt to get directions to your next checkpoint.' });
    const target = data?.current_target;
    if (!target || typeof target !== 'object' || !isPoint({ latitude: target.latitude, longitude: target.longitude })) {
      return response(409, { error: 'target_unavailable', message: 'There is no next checkpoint to route to.' });
    }
    destination = { latitude: target.latitude, longitude: target.longitude };
  } catch { return response(503, { error: 'unavailable', message: 'Road directions are unavailable. Follow the direction arrow or Google Maps.' }); }

  const key = routeKey(origin, destination, travelMode);
  const cached = routeCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_MS) return response(200, cached.route as unknown as Record<string, unknown>);
  routeCache.delete(key);

  const googleKey = process.env.GOOGLE_ROUTES_KEY || '';
  if (!googleKey) return response(503, { error: 'unavailable', message: 'Road directions are unavailable. Follow the direction arrow or Google Maps.' });
  try {
    const result = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': googleKey, 'X-Goog-FieldMask': FIELD_MASK },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
        destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
        travelMode,
        languageCode: 'en',
        units: 'METRIC',
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!result.ok) return response(502, { error: 'unavailable', message: 'Road directions are unavailable. Follow the direction arrow or Google Maps.' });
    const json = await result.json();
    const first = Array.isArray(json?.routes) ? json.routes[0] : null;
    const leg = Array.isArray(first?.legs) ? first.legs[0] : null;
    const points = typeof first?.polyline?.encodedPolyline === 'string' ? compactPolyline(decodePolyline(first.polyline.encodedPolyline)) : [];
    if (!leg || points.length < 2) return response(502, { error: 'unavailable', message: 'No road route was found. Follow Google Maps instead.' });
    let distanceFromStart = 0;
    const steps = (Array.isArray(leg.steps) ? leg.steps : []).map((step: any) => {
      const normalized = {
        instruction: typeof step?.navigationInstruction?.instructions === 'string' ? step.navigationInstruction.instructions.slice(0, 160) : 'Continue along the route',
        distance_m: Math.max(0, Number(step?.distanceMeters) || 0),
        distance_from_start_m: Math.max(0, distanceFromStart),
      };
      distanceFromStart += normalized.distance_m;
      return normalized;
    });
    const route: NavigationRoute = {
      distance_m: Math.max(0, Number(first.distanceMeters) || 0),
      duration_seconds: parseDuration(first.duration),
      points,
      steps,
    };
    routeCache.set(key, { at: Date.now(), route });
    if (routeCache.size > 120) {
      const now = Date.now();
      for (const [cacheKey, item] of routeCache) if (now - item.at >= CACHE_MS) routeCache.delete(cacheKey);
      while (routeCache.size > 120) routeCache.delete(routeCache.keys().next().value as string);
    }
    return response(200, route as unknown as Record<string, unknown>);
  } catch {
    return response(502, { error: 'unavailable', message: 'Road directions are unavailable. Follow the direction arrow or Google Maps.' });
  }
}

// Lets staff check that road directions are switched on (whether the Google key is set). No key, no details.
export async function GET() {
  return response(200, { road_directions: !!process.env.GOOGLE_ROUTES_KEY });
}

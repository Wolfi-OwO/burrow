/** Routes and places from GPX, TCX, KML and GeoJSON files, read in the browser. */

export interface GeoPoint {
    lat: number;
    lon: number;
    ele?: number;
    time?: number;
}
export interface GeoTrack {
    name: string;
    points: GeoPoint[];
}
export interface GeoPlace {
    name: string;
    lat: number;
    lon: number;
}
export interface GeoData {
    tracks: GeoTrack[];
    places: GeoPlace[];
}
export interface GeoStats {
    km: number;
    ascent: number;
    descent: number;
    minEle: number | null;
    maxEle: number | null;
    seconds: number | null;
    points: number;
}

const EARTH_KM = 6371;
const rad = (d: number): number => (d * Math.PI) / 180;

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
    const h =
        Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
        Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export function statsOf(tracks: GeoTrack[]): GeoStats {
    let km = 0;
    let ascent = 0;
    let descent = 0;
    let points = 0;
    let minEle: number | null = null;
    let maxEle: number | null = null;
    let first: number | null = null;
    let last: number | null = null;
    for (const t of tracks) {
        t.points.forEach((p, i) => {
            points += 1;
            const prev = t.points[i - 1];
            if (prev) {
                km += distanceKm(prev, p);
                if (p.ele !== undefined && prev.ele !== undefined) {
                    const d = p.ele - prev.ele;
                    // Ignore sub-metre jitter, which would otherwise add up to a false climb.
                    if (d > 1) ascent += d;
                    else if (d < -1) descent -= d;
                }
            }
            if (p.ele !== undefined) {
                minEle = minEle === null ? p.ele : Math.min(minEle, p.ele);
                maxEle = maxEle === null ? p.ele : Math.max(maxEle, p.ele);
            }
            if (p.time !== undefined) {
                first = first === null ? p.time : Math.min(first, p.time);
                last = last === null ? p.time : Math.max(last, p.time);
            }
        });
    }
    return {
        km,
        ascent,
        descent,
        minEle,
        maxEle,
        seconds: first !== null && last !== null ? (last - first) / 1000 : null,
        points,
    };
}

const num = (v: string | null | undefined): number | undefined => {
    if (v === null || v === undefined || v.trim() === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
};

function fromXml(text: string, ext: string): GeoData {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) return { tracks: [], places: [] };
    const tracks: GeoTrack[] = [];
    const places: GeoPlace[] = [];
    const all = (sel: string, root: ParentNode = doc): Element[] => [...root.querySelectorAll(sel)];
    const child = (el: Element, tag: string): string | null =>
        [...el.children].find((c) => c.localName === tag)?.textContent ?? null;
    const pointOf = (el: Element): GeoPoint | null => {
        const lat = num(el.getAttribute('lat'));
        const lon = num(el.getAttribute('lon'));
        if (lat === undefined || lon === undefined) return null;
        const ele = num(child(el, 'ele'));
        const time = child(el, 'time');
        return {
            lat,
            lon,
            ...(ele === undefined ? {} : { ele }),
            ...(time && !Number.isNaN(Date.parse(time)) ? { time: Date.parse(time) } : {}),
        };
    };
    if (ext === 'gpx') {
        for (const trk of all('trk')) {
            const points = all('trkpt', trk)
                .map(pointOf)
                .filter((p): p is GeoPoint => p !== null);
            if (points.length) tracks.push({ name: child(trk, 'name') ?? 'Track', points });
        }
        for (const rte of all('rte')) {
            const points = all('rtept', rte)
                .map(pointOf)
                .filter((p): p is GeoPoint => p !== null);
            if (points.length) tracks.push({ name: child(rte, 'name') ?? 'Route', points });
        }
        for (const wpt of all('wpt')) {
            const p = pointOf(wpt);
            if (p) places.push({ name: child(wpt, 'name') ?? 'Waypoint', lat: p.lat, lon: p.lon });
        }
    } else if (ext === 'tcx') {
        const points: GeoPoint[] = [];
        for (const tp of all('Trackpoint')) {
            const lat = num(tp.getElementsByTagName('LatitudeDegrees')[0]?.textContent);
            const lon = num(tp.getElementsByTagName('LongitudeDegrees')[0]?.textContent);
            if (lat === undefined || lon === undefined) continue;
            const ele = num(tp.getElementsByTagName('AltitudeMeters')[0]?.textContent);
            const time = tp.getElementsByTagName('Time')[0]?.textContent;
            points.push({
                lat,
                lon,
                ...(ele === undefined ? {} : { ele }),
                ...(time && !Number.isNaN(Date.parse(time)) ? { time: Date.parse(time) } : {}),
            });
        }
        if (points.length) tracks.push({ name: 'Activity', points });
    } else {
        for (const pm of all('Placemark')) {
            const name = child(pm, 'name') ?? 'Place';
            for (const c of all('coordinates', pm)) {
                const pts = (c.textContent ?? '')
                    .trim()
                    .split(/\s+/)
                    .map((s) => s.split(',').map(Number))
                    .filter((a) => a.length >= 2 && a.every((n) => Number.isFinite(n)))
                    .map(([lon, lat, ele]) => ({
                        lat: lat as number,
                        lon: lon as number,
                        ...(ele === undefined ? {} : { ele }),
                    }));
                if (pts.length === 1 && pts[0])
                    places.push({ name, lat: pts[0].lat, lon: pts[0].lon });
                else if (pts.length > 1) tracks.push({ name, points: pts });
            }
        }
    }
    return { tracks, places };
}

type Coord = number[];
function fromGeoJson(text: string): GeoData {
    const tracks: GeoTrack[] = [];
    const places: GeoPlace[] = [];
    const line = (name: string, coords: Coord[]): void => {
        const points = coords
            .filter((c) => c.length >= 2)
            .map((c) => ({
                lon: c[0] as number,
                lat: c[1] as number,
                ...(c[2] === undefined ? {} : { ele: c[2] }),
            }));
        if (points.length > 1) tracks.push({ name, points });
    };
    const visit = (node: unknown, name = 'Shape'): void => {
        if (!node || typeof node !== 'object') return;
        const n = node as {
            type?: string;
            features?: unknown[];
            geometry?: unknown;
            properties?: { name?: string };
            coordinates?: unknown;
            geometries?: unknown[];
        };
        if (n.type === 'FeatureCollection') n.features?.forEach((f) => visit(f));
        else if (n.type === 'Feature') visit(n.geometry, n.properties?.name ?? name);
        else if (n.type === 'GeometryCollection') n.geometries?.forEach((g) => visit(g, name));
        else if (n.type === 'Point') {
            const c = n.coordinates as Coord;
            places.push({ name, lat: c[1] as number, lon: c[0] as number });
        } else if (n.type === 'MultiPoint')
            (n.coordinates as Coord[]).forEach((c) =>
                places.push({ name, lat: c[1] as number, lon: c[0] as number }),
            );
        else if (n.type === 'LineString') line(name, n.coordinates as Coord[]);
        else if (n.type === 'MultiLineString')
            (n.coordinates as Coord[][]).forEach((l) => line(name, l));
        else if (n.type === 'Polygon') (n.coordinates as Coord[][]).forEach((r) => line(name, r));
        else if (n.type === 'MultiPolygon')
            (n.coordinates as Coord[][][]).forEach((p) => p.forEach((r) => line(name, r)));
    };
    try {
        visit(JSON.parse(text));
    } catch {
        // not JSON: nothing to draw
    }
    return { tracks, places };
}

export function parseGeo(text: string, name: string): GeoData {
    const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
    return ext === 'geojson' || (ext === 'json' && text.trimStart().startsWith('{'))
        ? fromGeoJson(text)
        : fromXml(text, ext);
}

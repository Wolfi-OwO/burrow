import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

import type { GeoData } from '../lib/geo.ts';
import { statsOf } from '../lib/geo.ts';

const W = 900;
const H = 520;
const PAD = 36;

const clock = (s: number): string => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${String(h)} h ${String(m)} min` : `${String(m)} min`;
};

/** Draws a route or a set of places without any map tiles (nothing leaves the page), with the usual numbers. */
export function GeoPreview({ data }: { data: GeoData }): ReactNode {
    const pts = [...data.tracks.flatMap((t) => t.points), ...data.places];
    if (pts.length === 0)
        return (
            <p className="muted" style={{ padding: 24 }}>
                No routes or places found in this file.
            </p>
        );
    const lats = pts.map((p) => p.lat);
    const lons = pts.map((p) => p.lon);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    // Equirectangular, with longitude scaled by the latitude so a route keeps its shape.
    const k = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
    const spanX = Math.max((maxLon - minLon) * k, 1e-6);
    const spanY = Math.max(maxLat - minLat, 1e-6);
    const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const x = (lon: number): number =>
        PAD + ((lon - minLon) * k - 0) * scale + (W - 2 * PAD - spanX * scale) / 2;
    const y = (lat: number): number =>
        H - PAD - (lat - minLat) * scale - (H - 2 * PAD - spanY * scale) / 2;

    const stats = statsOf(data.tracks);
    const withEle = data.tracks.flatMap((t) => t.points).filter((p) => p.ele !== undefined);
    const eleMin = stats.minEle ?? 0;
    const eleMax = stats.maxEle ?? 1;
    const profile =
        withEle.length > 1
            ? withEle
                  .map((p, i) => {
                      const px = (i / (withEle.length - 1)) * 600;
                      const py =
                          70 - (((p.ele as number) - eleMin) / Math.max(eleMax - eleMin, 1)) * 60;
                      return `${i === 0 ? 'M' : 'L'}${px.toFixed(1)} ${py.toFixed(1)}`;
                  })
                  .join(' ')
            : null;
    const first = pts[0];
    const osm = first
        ? `https://www.openstreetmap.org/?mlat=${String(first.lat)}&mlon=${String(first.lon)}#map=14/${String(first.lat)}/${String(first.lon)}`
        : null;

    return (
        <div className="preview-doc wide">
            <svg
                className="geo-map"
                viewBox={`0 0 ${String(W)} ${String(H)}`}
                role="img"
                aria-label="Route drawn from the file"
            >
                <rect width={W} height={H} rx="12" className="geo-bg" />
                {data.tracks.map((t, i) => (
                    <polyline
                        key={i}
                        className="geo-line"
                        points={t.points
                            .map((p) => `${x(p.lon).toFixed(1)},${y(p.lat).toFixed(1)}`)
                            .join(' ')}
                    />
                ))}
                {data.tracks.map((t, i) => {
                    const a = t.points[0];
                    const b = t.points.at(-1);
                    return a && b ? (
                        <g key={i}>
                            <circle cx={x(a.lon)} cy={y(a.lat)} r="7" className="geo-start" />
                            <circle cx={x(b.lon)} cy={y(b.lat)} r="7" className="geo-end" />
                        </g>
                    ) : null;
                })}
                {data.places.map((p, i) => (
                    <g key={i}>
                        <circle cx={x(p.lon)} cy={y(p.lat)} r="6" className="geo-place" />
                        <text x={x(p.lon) + 10} y={y(p.lat) + 4} className="geo-label">
                            {p.name}
                        </text>
                    </g>
                ))}
            </svg>
            <dl className="geo-stats">
                {data.tracks.length > 0 ? (
                    <>
                        <div>
                            <dt>Distance</dt>
                            <dd>{stats.km.toFixed(2)} km</dd>
                        </div>
                        {stats.seconds !== null && stats.seconds > 0 ? (
                            <div>
                                <dt>Time</dt>
                                <dd>{clock(stats.seconds)}</dd>
                            </div>
                        ) : null}
                        {stats.minEle !== null ? (
                            <>
                                <div>
                                    <dt>Climb</dt>
                                    <dd>
                                        {Math.round(stats.ascent)} m up, {Math.round(stats.descent)}{' '}
                                        m down
                                    </dd>
                                </div>
                                <div>
                                    <dt>Height</dt>
                                    <dd>
                                        {Math.round(stats.minEle)} to{' '}
                                        {Math.round(stats.maxEle ?? 0)} m
                                    </dd>
                                </div>
                            </>
                        ) : null}
                        <div>
                            <dt>Tracks</dt>
                            <dd>
                                {data.tracks.length} ({stats.points} points)
                            </dd>
                        </div>
                    </>
                ) : null}
                {data.places.length > 0 ? (
                    <div>
                        <dt>Places</dt>
                        <dd>{data.places.length}</dd>
                    </div>
                ) : null}
            </dl>
            {profile ? (
                <svg
                    className="geo-profile"
                    viewBox="0 0 600 80"
                    role="img"
                    aria-label="Elevation profile"
                >
                    <path d={`${profile} L600 80 L0 80 Z`} className="geo-fill" />
                    <path d={profile} className="geo-line thin" />
                </svg>
            ) : null}
            {osm ? (
                <p className="small">
                    <a href={osm} target="_blank" rel="noopener noreferrer">
                        <ExternalLink size={13} /> Open the start in OpenStreetMap
                    </a>
                </p>
            ) : null}
        </div>
    );
}

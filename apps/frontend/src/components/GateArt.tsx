import type { ReactNode } from 'react';

const CARVED = 'color-mix(in srgb, var(--surface-2) 40%, #0e0e10)';
const LIP = 'color-mix(in srgb, var(--text) 13%, var(--surface-2))';

/** Files travel along the tunnels into their rooms; the chip paths mirror the tunnel paths below. */
const ROUTES = [
    { d: 'M400 262 L400 350 C400 390 330 400 250 492', dur: 8, begin: 0 },
    { d: 'M400 262 L400 350 C400 390 470 400 550 492', dur: 9, begin: 2.5 },
    { d: 'M400 262 L400 350 L400 622', dur: 10, begin: 5 },
];

const ROOMS = [
    {
        x: 250,
        y: 500,
        label: 'Photos',
        icon: 'M-14 8 L-5 -3 L1 4 L6 -1 L14 8 Z M-9 -7 a3 3 0 1 0 0.01 0',
    },
    {
        x: 550,
        y: 500,
        label: 'Documents',
        icon: 'M-9 -12 H3 L10 -5 V12 H-9 Z M3 -12 V-5 H10 M-5 1 H6 M-5 6 H6',
    },
    { x: 400, y: 630, label: 'Screenshots', icon: 'M-13 -9 H13 V9 H-13 Z M-13 -3 H13 M-9 -6 h.01' },
];

/** Decorative cross-section of a burrow with files drifting into rooms; hidden from assistive tech. */
export function GateArt(): ReactNode {
    return (
        <svg
            className="cross"
            aria-hidden="true"
            viewBox="0 0 800 720"
            preserveAspectRatio="xMidYMid meet"
        >
            <defs>
                <linearGradient
                    id="gate-sky"
                    gradientUnits="userSpaceOnUse"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="250"
                >
                    <stop offset="0" stopColor="color-mix(in srgb, var(--accent) 30%, var(--bg))" />
                    <stop offset="1" stopColor="color-mix(in srgb, var(--accent) 12%, var(--bg))" />
                </linearGradient>
                <linearGradient
                    id="gate-soil"
                    gradientUnits="userSpaceOnUse"
                    x1="0"
                    y1="250"
                    x2="0"
                    y2="720"
                >
                    <stop
                        offset="0"
                        stopColor="color-mix(in srgb, var(--text) 9%, var(--surface-2))"
                    />
                    <stop
                        offset="1"
                        stopColor="color-mix(in srgb, var(--bg) 70%, var(--surface-2))"
                    />
                </linearGradient>
                <filter id="gate-soft" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow
                        dx="0"
                        dy="6"
                        stdDeviation="8"
                        floodColor="#000"
                        floodOpacity=".28"
                    />
                </filter>
            </defs>
            <rect x="-3000" y="-3000" width="6800" height="3250" fill="url(#gate-sky)" />
            <circle cx="640" cy="120" r="40" fill="var(--accent)" opacity=".4" />
            <circle cx="640" cy="120" r="70" fill="var(--accent)" opacity=".14" />
            <path
                d="M-3000 250 H-20 C120 228 250 262 400 250 S650 232 820 250 H3800 V3000 H-3000 Z"
                fill="url(#gate-soil)"
            />
            <path
                d="M-3000 250 H-20 C120 228 250 262 400 250 S650 232 820 250 H3800"
                fill="none"
                stroke="color-mix(in srgb, var(--accent) 55%, var(--surface-2))"
                strokeWidth="6"
                strokeLinecap="round"
            />
            <g fill="color-mix(in srgb, var(--text) 10%, transparent)">
                <circle cx="90" cy="340" r="5" />
                <circle cx="130" cy="560" r="7" />
                <circle cx="700" cy="380" r="6" />
                <circle cx="660" cy="640" r="5" />
                <circle cx="60" cy="470" r="4" />
                <circle cx="740" cy="530" r="4" />
            </g>

            {/* tunnels: a light lip first, the carved dark centre on top */}
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                <g stroke={LIP} strokeWidth="46">
                    <path d="M400 262 L400 350 C400 390 330 400 250 492" />
                    <path d="M400 350 C400 390 470 400 550 492" />
                    <path d="M400 350 L400 622" />
                </g>
                <g stroke={CARVED} strokeWidth="32">
                    <path d="M400 262 L400 350 C400 390 330 400 250 492" />
                    <path d="M400 350 C400 390 470 400 550 492" />
                    <path d="M400 350 L400 622" />
                </g>
            </g>

            {/* entrance */}
            <ellipse cx="400" cy="252" rx="34" ry="11" fill={CARVED} />

            {/* rooms */}
            {ROOMS.map((room) => (
                <g key={room.label} transform={`translate(${room.x} ${room.y})`}>
                    <rect
                        x="-102"
                        y="-52"
                        width="204"
                        height="104"
                        rx="40"
                        fill={LIP}
                        filter="url(#gate-soft)"
                    />
                    <rect x="-94" y="-44" width="188" height="88" rx="34" fill={CARVED} />
                    <rect
                        x="-94"
                        y="-44"
                        width="188"
                        height="88"
                        rx="34"
                        fill="none"
                        stroke="color-mix(in srgb, var(--accent) 22%, transparent)"
                        strokeWidth="1.5"
                    />
                    <g
                        transform="translate(-62 0)"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d={room.icon} />
                    </g>
                    <text
                        x="-36"
                        y="6"
                        fontFamily="var(--font-display)"
                        fontWeight="600"
                        fontSize="18"
                        fill="#f4f4f5"
                    >
                        {room.label}
                    </text>
                </g>
            ))}

            {/* files drifting in */}
            {ROUTES.map((route) => (
                <g key={route.d} opacity="0">
                    <rect
                        x="-13"
                        y="-10"
                        width="26"
                        height="20"
                        rx="6"
                        fill="var(--surface)"
                        stroke="var(--accent)"
                        strokeWidth="2"
                    />
                    <rect x="-7" y="-4" width="14" height="5" rx="2" fill="var(--accent)" />
                    <animateMotion
                        dur={`${route.dur}s`}
                        begin={`${route.begin}s`}
                        repeatCount="indefinite"
                        path={route.d}
                        keyPoints="0;1"
                        keyTimes="0;1"
                        calcMode="linear"
                    />
                    <animate
                        attributeName="opacity"
                        values="0;1;1;0"
                        keyTimes="0;0.1;0.88;1"
                        dur={`${route.dur}s`}
                        begin={`${route.begin}s`}
                        repeatCount="indefinite"
                    />
                </g>
            ))}
        </svg>
    );
}

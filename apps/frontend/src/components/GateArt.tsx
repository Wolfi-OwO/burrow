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

/* Phone scene: the same burrow turned portrait. A sun rising behind the horizon, one shaft down, three rooms in a row.
   Everything is drawn on a 390 x 520 board and anchored to the bottom, so only the soil edges crop on narrow screens. */
const PHONE_ROOMS = [
    {
        x: 90,
        label: 'Photos',
        icon: 'M-12 7 L-4 -3 L1 3 L5 -1 L12 7 Z M-8 -7 a2.6 2.6 0 1 0 0.01 0',
    },
    { x: 195, label: 'Screenshots', icon: 'M-11 -8 H11 V8 H-11 Z M-11 -3 H11 M-8 -5.5 h.01' },
    {
        x: 300,
        label: 'Documents',
        icon: 'M-8 -11 H2 L9 -4 V11 H-8 Z M2 -11 V-4 H9 M-4 1 H5 M-4 5 H5',
    },
] as const;
const PHONE_ROOM_Y = 408;
/** Each file leaves the entrance, drops down the shaft and is swallowed by one room; the room lights up on arrival. */
const PHONE_ROUTES = [
    { d: 'M195 238 L195 300 C195 336 90 328 90 372', dur: 7, begin: 0, room: 0 },
    { d: 'M195 238 L195 372', dur: 8, begin: 2.4, room: 1 },
    { d: 'M195 238 L195 300 C195 336 300 328 300 372', dur: 9, begin: 4.6, room: 2 },
] as const;

/** Portrait version of the scene for phones, always animated; hidden from assistive tech. */
function GateArtPhone(): ReactNode {
    return (
        <svg
            className="cross cross-phone"
            aria-hidden="true"
            viewBox="0 0 390 520"
            preserveAspectRatio="xMidYMax slice"
        >
            <defs>
                <linearGradient
                    id="gate-sky-p"
                    gradientUnits="userSpaceOnUse"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="230"
                >
                    <stop offset="0" stopColor="color-mix(in srgb, var(--accent) 26%, var(--bg))" />
                    <stop offset="1" stopColor="color-mix(in srgb, var(--accent) 12%, var(--bg))" />
                </linearGradient>
                <linearGradient
                    id="gate-soil-p"
                    gradientUnits="userSpaceOnUse"
                    x1="0"
                    y1="230"
                    x2="0"
                    y2="520"
                >
                    <stop
                        offset="0"
                        stopColor="color-mix(in srgb, var(--text) 9%, var(--surface-2))"
                    />
                    <stop
                        offset="1"
                        stopColor="color-mix(in srgb, var(--bg) 60%, var(--surface-2))"
                    />
                </linearGradient>
            </defs>
            <rect x="-800" y="-100" width="1990" height="340" fill="url(#gate-sky-p)" />
            {/* The sun comes up behind the horizon and breathes; the soil is drawn over its lower half. */}
            <circle cx="312" cy="222" r="62" fill="var(--accent)" opacity=".13">
                <animate attributeName="r" values="58;70;58" dur="6s" repeatCount="indefinite" />
            </circle>
            <circle cx="312" cy="222" r="34" fill="var(--accent)" opacity=".42">
                <animate
                    attributeName="cy"
                    values="226;214;226"
                    dur="6s"
                    repeatCount="indefinite"
                />
            </circle>
            <path
                d="M-800 232 H-10 C70 218 130 240 195 232 S330 220 400 232 H1190 V1000 H-800 Z"
                fill="url(#gate-soil-p)"
            />
            <path
                d="M-800 232 H-10 C70 218 130 240 195 232 S330 220 400 232 H1190"
                fill="none"
                stroke="color-mix(in srgb, var(--accent) 55%, var(--surface-2))"
                strokeWidth="5"
                strokeLinecap="round"
            />
            {/* strata, so the ground has depth below the rooms too */}
            <g
                fill="none"
                stroke="color-mix(in srgb, var(--text) 8%, transparent)"
                strokeWidth="2"
                strokeLinecap="round"
            >
                <path d="M-20 470 C80 456 150 482 240 468 S360 456 420 472" />
                <path d="M-20 500 C60 492 140 508 230 498 S350 490 420 502" />
            </g>
            <g fill="color-mix(in srgb, var(--text) 10%, transparent)">
                <circle cx="30" cy="300" r="4" />
                <circle cx="352" cy="330" r="5" />
                <circle cx="60" cy="470" r="5" />
                <circle cx="330" cy="486" r="4" />
                <circle cx="150" cy="500" r="3" />
            </g>

            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
                <g stroke={LIP} strokeWidth="34">
                    {PHONE_ROUTES.map((r) => (
                        <path key={r.d} d={r.d} />
                    ))}
                </g>
                <g stroke={CARVED} strokeWidth="22">
                    {PHONE_ROUTES.map((r) => (
                        <path key={r.d} d={r.d} />
                    ))}
                </g>
            </g>
            <ellipse cx="195" cy="232" rx="26" ry="9" fill={CARVED} />

            {PHONE_ROOMS.map((room) => (
                <g key={room.label} transform={`translate(${room.x} ${PHONE_ROOM_Y})`}>
                    <rect x="-47" y="-38" width="94" height="76" rx="12" fill={LIP} />
                    <rect x="-41" y="-32" width="82" height="64" rx="9" fill={CARVED} />
                    <rect
                        x="-41"
                        y="-32"
                        width="82"
                        height="64"
                        rx="9"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="1.6"
                        strokeOpacity=".22"
                    >
                        {PHONE_ROUTES.filter((r) => PHONE_ROOMS[r.room]?.x === room.x).map((r) => (
                            <animate
                                key={r.d}
                                attributeName="stroke-opacity"
                                values=".22;.22;1;.22"
                                keyTimes="0;.8;.93;1"
                                dur={`${String(r.dur)}s`}
                                begin={`${String(r.begin)}s`}
                                repeatCount="indefinite"
                            />
                        ))}
                    </rect>
                    <g
                        transform="translate(0 -8)"
                        fill="none"
                        stroke="var(--accent)"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <path d={room.icon} />
                    </g>
                    <text
                        x="0"
                        y="20"
                        textAnchor="middle"
                        fontFamily="var(--font-display)"
                        fontWeight="600"
                        fontSize="13"
                        fill="#f4f4f5"
                    >
                        {room.label}
                    </text>
                </g>
            ))}

            {PHONE_ROUTES.map((route) => (
                <g key={route.d} opacity="0">
                    <rect
                        x="-11"
                        y="-8"
                        width="22"
                        height="16"
                        rx="4"
                        fill="var(--surface)"
                        stroke="var(--accent)"
                        strokeWidth="2"
                    />
                    <rect x="-6" y="-3" width="12" height="4" rx="1.5" fill="var(--accent)" />
                    <animateMotion
                        dur={`${String(route.dur)}s`}
                        begin={`${String(route.begin)}s`}
                        repeatCount="indefinite"
                        path={route.d}
                        keyPoints="0;1"
                        keyTimes="0;1"
                        calcMode="linear"
                    />
                    <animate
                        attributeName="opacity"
                        values="0;1;1;0"
                        keyTimes="0;0.1;0.9;1"
                        dur={`${String(route.dur)}s`}
                        begin={`${String(route.begin)}s`}
                        repeatCount="indefinite"
                    />
                </g>
            ))}
        </svg>
    );
}

/** Decorative cross-section of a burrow with files drifting into rooms; hidden from assistive tech. */
export function GateArt(): ReactNode {
    return (
        <>
            <GateArtDesktop />
            <GateArtPhone />
        </>
    );
}

function GateArtDesktop(): ReactNode {
    return (
        <svg
            className="cross cross-desktop"
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

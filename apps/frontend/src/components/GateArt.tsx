import type { ReactNode } from 'react';

/** Decorative cross-section of a burrow with files drifting into rooms; purely ornamental, so hidden from assistive tech. */
export function GateArt(): ReactNode {
    return (
        <svg
            className="cross"
            aria-hidden="true"
            viewBox="0 0 800 720"
            preserveAspectRatio="xMidYMid slice"
        >
            <rect
                x="-600"
                y="-400"
                width="2000"
                height="650"
                fill="color-mix(in srgb, var(--accent) 20%, var(--bg))"
            />
            <path
                d="M-600 250 C-120 238 200 262 330 248 S600 236 1400 252"
                fill="none"
                stroke="color-mix(in srgb, var(--text) 18%, transparent)"
                strokeWidth="3"
            />
            <g transform="translate(0,115)">
                <g
                    fill="none"
                    stroke="color-mix(in srgb, var(--text) 12%, var(--surface-2))"
                    strokeWidth="30"
                    strokeLinecap="round"
                >
                    <path d="M170 140 L170 170 C170 250 215 285 300 335" />
                    <path d="M170 170 C190 260 320 255 440 305 L560 300" />
                    <path d="M185 215 C185 330 275 430 410 475" />
                </g>
                <g fontFamily="var(--font-display)" fontWeight="600" textAnchor="middle">
                    <ellipse
                        cx="300"
                        cy="335"
                        rx="96"
                        ry="54"
                        fill="var(--surface)"
                        stroke="var(--line)"
                        strokeWidth="3"
                    />
                    <text x="300" y="342" fontSize="22" fill="var(--text)">
                        Photos
                    </text>
                    <ellipse
                        cx="565"
                        cy="300"
                        rx="104"
                        ry="58"
                        fill="var(--surface)"
                        stroke="var(--line)"
                        strokeWidth="3"
                    />
                    <text x="565" y="307" fontSize="22" fill="var(--text)">
                        Nature
                    </text>
                    <ellipse
                        cx="410"
                        cy="480"
                        rx="116"
                        ry="62"
                        fill="var(--surface)"
                        stroke="var(--line)"
                        strokeWidth="3"
                    />
                    <text x="410" y="487" fontSize="22" fill="var(--text)">
                        Screenshots
                    </text>
                </g>
                <ellipse
                    cx="170"
                    cy="140"
                    rx="34"
                    ry="12"
                    fill="color-mix(in srgb, var(--text) 78%, transparent)"
                />
                <g className="chipg">
                    <g>
                        <rect
                            className="file-chip"
                            x="-14"
                            y="-10"
                            width="28"
                            height="20"
                            rx="5"
                            strokeWidth="2"
                        />
                        <rect x="-9" y="-5" width="18" height="6" rx="2" fill="var(--accent)" />
                        <animateMotion
                            dur="9s"
                            repeatCount="indefinite"
                            path="M170 100 L170 140 L170 170 C170 250 215 285 290 330"
                            keyPoints="0;1"
                            keyTimes="0;1"
                        />
                    </g>
                    <g>
                        <rect
                            className="file-chip"
                            x="-14"
                            y="-10"
                            width="28"
                            height="20"
                            rx="5"
                            strokeWidth="2"
                        />
                        <rect x="-9" y="-5" width="18" height="6" rx="2" fill="var(--accent)" />
                        <animateMotion
                            dur="11s"
                            begin="3s"
                            repeatCount="indefinite"
                            path="M170 100 L170 140 L170 170 C190 260 320 255 440 305 L545 300"
                        />
                    </g>
                    <g>
                        <rect
                            className="file-chip"
                            x="-14"
                            y="-10"
                            width="28"
                            height="20"
                            rx="5"
                            strokeWidth="2"
                        />
                        <rect x="-9" y="-5" width="18" height="6" rx="2" fill="var(--accent)" />
                        <animateMotion
                            dur="12s"
                            begin="6s"
                            repeatCount="indefinite"
                            path="M170 100 L170 140 L185 215 C185 330 275 430 395 475"
                        />
                    </g>
                </g>
            </g>
        </svg>
    );
}

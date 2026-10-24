import { randomUUID } from 'node:crypto';
import pino from 'pino';

import { config } from '../config/index.ts';

// Field names (timestamp/level/message) deliberately match
// apps/vision's JSON formatter, so a
// log aggregator sees one schema across both services, not two.
export const logger = pino({
    level: config.logLevel,
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    messageKey: 'message',
    formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
    },
});

/** The header both services read/write a correlation id under. */
export const CORRELATION_ID_HEADER = 'x-correlation-id';

export function correlationId(headers: { [key: string]: string | string[] | undefined }): string {
    const header = headers[CORRELATION_ID_HEADER];
    if (typeof header === 'string' && header.length > 0) return header;
    return randomUUID();
}

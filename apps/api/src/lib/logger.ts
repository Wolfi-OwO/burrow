import pino from 'pino';

import { config } from '../config/index.ts';
import { currentTraceId } from './trace.ts';

// Field names (timestamp/level/message) deliberately match
// apps/vision's JSON formatter, so a
// log aggregator sees one schema across both services, not two.
export const logger = pino({
    level: config.logLevel,
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    messageKey: 'message',
    // Every line written while a request is handled carries its trace id, whoever wrote it.
    mixin: () => {
        const traceId = currentTraceId();
        return traceId ? { traceId } : {};
    },
    formatters: {
        level: (label) => ({ level: label.toUpperCase() }),
    },
});

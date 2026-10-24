//: request counts, latencies, and error rates in a scrapeable
// (Prometheus exposition) format. One Histogram carries all three — its
// `_count` series is the request count, its `_bucket`/`_sum` series give
// latency, and filtering by `status_code` yields the error rate. No
// separate Counter needed for the same thing prom-client already derives.

import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, labeled by method, route, and status code.',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
});

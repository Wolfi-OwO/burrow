# Onboarding burrow into metrion

metrion shows CPU, memory, request counts and storage per app. On the VPS, per-container CPU and memory come from
`/opt/vps-container-metrics/collect.sh`, which routes each container to a metrion project by **container-name
prefix** (`netviz-`, `nutrilens-`, `portfolio-`). burrow's compose project is named `burrow`, so its containers are
`burrow-burrow-1`, `burrow-burrow-vision-1` and `burrow-burrow-db-1`, and one prefix, `burrow-`, covers all three.

## What it covers, and what it does not

Measured against the collector, not assumed:

| Wanted | Source | Status |
| - | - | - |
| CPU per container | `collect.sh` | Covered once the route below exists |
| RAM per container | `collect.sh` | Covered; matters most for `burrow-vision`, whose `mem_limit` is 1280 MB |
| Request count | none | **Not collected.** The collector reads no per-hostname request numbers. `GET /metrics` on the API exposes `http_request_duration_seconds`, so a Prometheus-format scrape is possible, but nothing scrapes it today |
| Storage used | none | **Not collected for B2.** Local disk is a capped cache (ADR-0002) and says nothing about what burrow holds; the number that matters is bytes in `burrow-blobs`, from B2's own bucket size report |

Request counts and B2 bytes therefore need new collectors in metrion; they are not something a config line turns on.

## Steps

1. In metrion, create a project `burrow` and copy its API key.
2. On the VPS add the key to `/etc/vps-container-metrics/routing.env` (mode 600):

   ```text
   BURROW_API_KEY=<the key>
   ```

3. Add one line to the `ROUTES` array in `/opt/vps-container-metrics/collect.sh`:

   ```text
   "burrow-|burrow|BURROW_API_KEY"
   ```

4. Wait one minute (the timer runs every minute) and confirm the three containers appear in the burrow project.
5. `/metrics` on the API needs `METRICS_TOKEN` as a bearer token; scrape it from inside `edge-net` only, never through Caddy.

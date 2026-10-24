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
| Storage used | none | **Not collected.** Since ADR-0006 the local directory `/opt/burrow/data` is the store of record, so its size is exactly what burrow holds; nothing reads it today |

Request counts and the size of `/opt/burrow/data` therefore need new collectors in metrion; they are not something a config line turns on.

## Steps

Done on 2026-10-24; kept here so it can be repeated or audited.

1. In metrion, API keys belong to the group (here "Server 01"), not to an application: the application name comes
   from the `resource` field of each payload. So burrow does not get a metrion "project"; it gets its own key
   (Group, Settings, "Create key"), which makes it revocable without touching the other apps.
2. On the VPS the key went into `/etc/vps-container-metrics/routing.env` (mode 600) as `BURROW_API_KEY`.
3. One line was added to the `ROUTES` array in `/opt/vps-container-metrics/collect.sh`, after the portfolio entry
   (the originals were copied to `*.bak-burrow-20261024` first):

   ```text
   "burrow-|burrow|BURROW_API_KEY"
   ```

4. The route is inert until the containers exist. From the first deploy, within a minute the three containers
   report CPU and RAM under the application name `burrow`.
5. `/metrics` on the API needs `METRICS_TOKEN` as a bearer token; scrape it from inside `edge-net` only, never
   through Caddy.

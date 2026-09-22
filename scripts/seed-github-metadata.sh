#!/usr/bin/env bash
# Seeds labels and milestones on Wolfi-OwO/burrow. Idempotent — re-running
# must not error on labels/milestones that already exist (existing ones are
# edited in place instead of re-created).
set -euo pipefail

REPO="Wolfi-OwO/burrow"

label() {
  local name="$1" color="$2" description="$3"
  if gh label create "$name" --repo "$REPO" --color "$color" --description "$description" 2>/dev/null; then
    return
  fi
  gh label edit "$name" --repo "$REPO" --color "$color" --description "$description"
}

milestone() {
  local title="$1" description="$2"
  local existing
  existing=$(gh api "repos/$REPO/milestones?state=all" --jq ".[] | select(.title == \"$title\") | .number")
  if [[ -n "$existing" ]]; then
    gh api -X PATCH "repos/$REPO/milestones/$existing" -f description="$description" >/dev/null
  else
    gh api -X POST "repos/$REPO/milestones" -f title="$title" -f description="$description" >/dev/null
  fi
}

# type:*
label "type:feature"  "1f883d" "New capability being added"
label "type:bugfix"   "d73a4a" "Something isn't working as intended"
label "type:chore"    "c5def5" "Maintenance work with no user-facing behavior change"
label "type:docs"     "0075ca" "Docs, READMEs, ADRs, diagrams"
label "type:refactor" "fbca04" "Internal restructuring, no behavior change"
label "type:security" "b60205" "Vulnerability, hardening, or security-relevant change"
label "type:test"     "0e8a16" "Test coverage addition or fix"
label "type:legal"    "7EA6E0" "Privacy, terms, compliance-document changes"

# area:*
label "area:api"            "5319e7" "apps/api — main application server"
label "area:vision"         "5319e7" "apps/vision — vision-classification inference service"
label "area:frontend"       "5319e7" "Frontend / eventual production UI"
label "area:database"       "5319e7" "Schema, migrations, storage layout"
label "area:jobs"           "5319e7" "Scheduled/background work — bulk sorts, backups"
label "area:infra"          "5319e7" "CI, Docker, deployment, DNS, observability"
label "area:organizational" "5319e7" "organizational/ design docs, use cases, diagrams"

# priority:*
label "priority:critical" "b60205" "Drop everything — broken build, security incident, data loss"
label "priority:high"     "d93f0b" "Should be next in line"
label "priority:medium"   "fbca04" "Normal priority"
label "priority:low"      "c2e0c6" "Nice to have, no urgency"

# status:*
label "status:blocked"     "000000" "Cannot proceed until a dependency is resolved"
label "status:in-progress" "fef2c0" "Actively being worked"
label "status:triage"      "ededed" "Not yet scoped or prioritized"

# epic + phase
label "epic"           "8B5CF6" "Tracks a group of child issues"
label "phase:prototype" "BFD4F2" "Hard-coded walking-skeleton phase (M1)"
label "phase:full-app"  "D4C5F9" "Spec-driven full application phase (M2-M8)"

milestone "M1 - Prototype"                          "Hard-coded walking-skeleton: upload, browse, one vision pass, no auth or migrations."
milestone "M2 - Specs & Organizational Design"      "Functional requirements, ADRs, activity diagrams before the real build starts."
milestone "M3 - Data Model & Storage"                "Postgres 16 schema, ltree category tree, content-addressed blobs, search, backups."
milestone "M4 - Auth"                                "Credentials auth, sessions, OIDC via GitHub/Microsoft/Google, account linking."
milestone "M5 - Drive & Category Tree"               "User-editable category tree, upload/dedup, profile, search UI."
milestone "M6 - Vision & Bulk Sorts"                 "apps/vision classification, NSFW split, scheduler, human-review queue."
milestone "M7 - Infrastructure, DNS & Observability" "Deploy runbook, DNS, reverse proxy, metrion onboarding, backups."
milestone "M8 - Hardening & Release"                 "Security workflows, rate limiting, legal doc completion, e2e smoke, v0.1.0."

echo "Labels and milestones seeded on $REPO."

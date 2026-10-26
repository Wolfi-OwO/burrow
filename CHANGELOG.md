# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) once a
first release is cut.

## [Unreleased]

### Added

- Big uploads: files of 48 MB and more go up in 16 MB pieces, four at a time, each retried on its own and written straight into place on the server, so a 5 GB file is sent as fast as the line allows (measured locally: 5 GB in 14 seconds) and finishes in seconds. Files up to 20 GB and zips unpacking to 32 GB are accepted (`MAX_FILE_GB`, `ZIP_MAX_TOTAL_MB`).

- The left sidebar is resizable: drag its edge (or use the arrow keys when it is focused, double-click to reset); the width is remembered.

### Fixed

- Zip contents were not filed into the folder the zip was uploaded from.
- The previewer's type list was missing the old Office formats, which broke the type check in CI.

### Changed

- Release workflow redesigned: the web image (api and frontend) is built only when its files changed, the AI detector image only when asked for (`[vision]` in the release notes, or ticked on a manual run); unchanged components reuse their image. Deploy takes a tag per component, shows the release version even for a reused image, and a registry tidy job removes old and duplicate image versions.
- CI runs the web, vision and smoke jobs only when their files changed.

## [0.3.0] - 2026-10-26

### Added

- Duplicates page: byte-identical files and near-identical pictures (same picture saved at another size or quality, found from the sorter's picture embeddings), keep the best copy, remove the rest one group at a time or all at once.
- Rating check on the Review page: moves pictures that the NSFW classifier puts on the other side of an SFW / NSFW folder pair.
- "Re-sort" on a folder sends its files back to the sorter.
- Filter the drive by kind of file (pictures, documents, spreadsheets, presentations, archives, audio, video, other) with counts.
- Unzip zips that are already in the drive, one or all: the contents are saved in the zip's folder and the zip is removed; zips inside zips are unpacked too, on upload as well.
- Previews for old Office files too (.doc, .xls, .ppt), read in the browser.
- Zip contents are filed into the folder the upload was started from.
- Previews for everything: text and code, CSV, PDF, Word (docx), Excel (xlsx), PowerPoint (pptx) and OpenDocument files, audio, video and zip contents open full screen from Details and on share pages; anything else shows a clear "no preview" card with Download.
- Choose the avatar from the pictures already in the drive, besides uploading one.
- "Unsort everything" on the Review page: every file back to Unsorted and queued for the sorter, folders stay; asks first.
- Full-screen viewer: click the picture in Details to see the original, click again for the real pixel size, arrow keys step through the folder.
- Where a picture was taken: the photo's own GPS position and time are read at upload, the sorter guesses a landmark or kind of scene (about a hundred well-known places and scenes), Details shows both with a map link, search finds the place, and a folder named after the place (for example "Paris") takes the picture.
- Zip uploads run in the background with a progress bar (uploading, then unpacking entry by entry), and the server pushes results over a live event stream: unpacking finished or failed, and how many files the sorter decided, shown as a notification on any page.

### Changed

- The interface text is a step smaller.
- Folders named SFW / NSFW (and safe, explicit, adult ...) are decided by the NSFW classifier instead of the zero-shot labels, which cannot read those words from a picture; the grey zone goes to review.
- Pictures that fit none of your folders stay in Unsorted instead of being forced into the closest one: competing labels for everyday objects, people, screenshots, documents, food and rooms, and a review floor under which no guess is offered.

## [0.2.0] - 2026-10-26

### Added

- Share links to a file or a whole category: open to anyone with the link, or only to the accounts you add; permanent or expiring (1 hour to 30 days), revocable, editable. A "Shared" page lists links you made and what was shared with you, and `/s/<token>` is the public viewing page.
- Upload a `.zip`: its files are unpacked and stored one by one (folders, hidden files and macOS resource forks are skipped, entry count and unpacked size are bounded).
- Bulk upload runs three files at a time and waits out a rate limit instead of failing.
- "Sort all now" on the Unsorted view.

### Fixed

- Sorting never worked in production: the API did not send the vision service's token, so every classification was refused with 401.
- "Sort now" processes the whole backlog instead of one batch of 100, and reports what is still waiting.
- "Too many uploads": the upload limit is 3000 per 15 minutes and the general API limit 3000; thumbnails and downloads no longer count against it.

### Changed

- The whole interface is redesigned: neutral surfaces, hairline borders instead of shadows, small radii, Geist type and one terracotta accent, in light and dark.

## [0.1.7] - 2026-10-26

### Changed

- The owner setup token is gone: the first account is created by password or by signing in with GitHub, Microsoft or Google.
- Sign-in form and provider buttons restyled: flat, bordered, no glows.

## [0.1.6] - 2026-10-26

### Changed

- Bottom bar now matches the other apps: copyright, build chip, Status, Impressum, Privacy Policy and Contact.
- Google sign-in is configured on the live site.

## [0.1.5] - 2026-10-25

### Changed

- Sign-in page always fits the screen, at any size.
- The colour panel is removed everywhere; a light and dark mode toggle replaces it (sidebar and sign-in page), following the system setting until chosen.
- GitHub, Microsoft and Google icons are always shown; a provider that is not set up yet is dimmed.
- Bottom bar on every page with copyright, the legal pages and the running version.

## [0.1.3] - 2026-10-25

### Changed

- Sign-in illustration redrawn: carved tunnels and rooms, works in light and dark.
- Secondary text keeps at least AA contrast on the light palette; first-visit contrast is medium.
- Clickable prototype in `prototypes/` that reuses the real screens with example data.

## [0.1.2] - 2026-10-25

### Changed

- Sign-in page redesigned: burrow cross-section illustration, GitHub, Microsoft and Google as icon buttons with tooltips instead of text.
- Neutral example room names in the illustration.

## [0.1.1] - 2026-10-25

- The first account now needs a setup token (`OWNER_SETUP_TOKEN`), and a provider login cannot create it: a new
  public hostname must not let a stranger become the owner. The sign-up page shows the field when it is needed.

## [0.1.0] - 2026-10-25

- Built `apps/api`: credential and OIDC login, revocable sessions, the ltree category tree with atomic subtree
  moves, content-addressed uploads with dedup, ranked name search, the review queue and the scheduler.
- Built `apps/vision`: OpenCLIP ViT-B/32 embeddings and zero-shot scoring plus a dedicated NSFW classifier on
  ONNX Runtime; measured latency and memory are recorded in ADR-0004.
- Built `apps/frontend`: drive, search, review, profile and the colour panel.
- Uploads live on the VPS disk with an encrypted nightly backup to Azure Blob Storage (ADR-0006), instead of Backblaze.
- Completed the Impressum, privacy policy and terms and serve them in the app at `/impressum`, `/privacy` and `/terms`.
- Added the production compose file, the forced-command deploy script, the Caddy vhost, the nightly backup
  timer and the restore drill, the release workflow, and an end-to-end smoke test.

- Scaffolded the repository: npm workspaces, tooling config, directory
  layout for `apps/api`, `apps/vision`, `apps/frontend`, `prototype`,
  `packages/shared`, and `organizational/`. No application code yet.

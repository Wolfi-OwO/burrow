# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/) once a
first release is cut.

## [Unreleased]

## [1.0.2] - 2026-11-11

### Fixed

- Typing "yes" or "no" in the assistant chat answers the card that waits for one, exactly like its buttons. Before, the
  model was asked what a bare "yes" meant and made something up.
- The assistant no longer repeats a claim that it moved, made or found something when it listed no action: such an
  answer is replaced by a plain "I have not changed anything yet" with an example of what to ask.
- The assistant knows how many files wait in the review queue, and is told never to guess a number or say that it did
  something itself.

## [1.0.1] - 2026-11-11

### Fixed

- The folder drop-downs (file a review item, move a folder, file from the drive) show the hierarchy again: subfolders carry a visible corner mark and an indent. The old indentation used invisible spaces that some browsers drop from a drop-down list.

## [1.0.0] - 2026-11-11

The first stable release. Since 0.11 the app gained an object-store tier (files stored encrypted in an EU bucket, with a
small disk cache), per-account quotas, trace ids, a self-hosted assistant that builds folders, teaches the sorter, finds
pictures by description and writes files, a background sorter and duplicate search, shared folders with subfolders,
folder-scoped search and a reworked review desk. Code scanning has no open alerts and the shipped dependencies audit
clean; the one remaining finding is a moderate `minimatch` issue in the lint tooling, which never runs on the server.

### Fixed

- When the assistant searches for pictures, its final sentence now states what the search really found and that nothing has moved yet. Before, it repeated the model's guess ("I found 66 pictures and moved them") written before the search ran.

## [0.17.0] - 2026-11-09

### Fixed

- Unpacking a zip no longer hangs silently when storing one of its files fails: that file is skipped and counted, the rest is unpacked, and a failure that would hit every later file (no room left, storage unreachable) stops the unpacking and reports it.
- A zip that failed half way is no longer deleted afterwards; it stays so the person does not have to upload many GB again. Only a zip that was read to the end is removed.

### Added

- Searching while a folder is open looks in that folder and every folder below it. The results page says so and has a link to search everywhere.

### Changed

- Dependabot no longer proposes numpy 2.5 for the vision service: it needs Python 3.12 and the image is on 3.11, so the monthly pull request could not install.

### Security

- The remaining code-scanning path findings are closed at the places that touch the disk (a path is proven to be inside the storage folder right there), the OpenDocument preview reads the XML with a parser instead of patterns, and `re2js` (lint tooling) is pinned to the patched release.

## [0.16.0] - 2026-11-09

### Added

- Tell the assistant to find certain pictures and put them in a folder ("put all the dog pictures into Dogs"). It matches your description against the pictures with the same CLIP model that sorts them, shows a card with how many matched (and a strip of thumbnails), and moves exactly those pictures only after you confirm. A folder that does not exist yet is made first; nothing is made when nothing matches. The vision service gained `POST /embed-text` for this. `FIND_MIN_SIMILARITY`, `FIND_WINDOW` and `FIND_MAX` tune how strict the match is.

## [0.15.9] - 2026-11-09

### Changed

- The object store for the files is now Contabo Object Storage in the EU instead of Backblaze B2 in the US: the privacy text and the setup guide say so, which also removes the transfer-to-a-third-country check.

## [0.15.8] - 2026-11-08

### Fixed

- A picture sent to the vision service is read into memory first (up to 64 MB), and a read that fails while a request is cut off no longer stops the server. The blob store touches a file's time whenever it is used, which made Node's lazy file reads fail and crashed Burrow in a loop as soon as the object store was switched on.

## [0.15.7] - 2026-11-08

### Changed

- Every button and control that shows only an icon (the folder tools, the viewer's close and arrows, the share and upload controls, the theme and account buttons, the send button and more) now tells you what it does when you hover it, not only to screen readers.

## [0.15.6] - 2026-11-08

### Fixed

- On the Review page a long file name (such as a bare id) no longer wraps over the sorter's percentage and the buttons: it is cut with an ellipsis, and the buttons move to their own line when they do not fit beside the name.

## [0.15.5] - 2026-11-08

### Added

- A shared folder now opens like the drive: its own files plus a card for every subfolder, each of which opens in turn, with a path to climb back up. Only folders inside the shared one can be reached through the link.

### Fixed

- The kind filter above the files counts only what the open folder holds, so it lists just the kinds that are in it.

### Security

- Every place that reads, writes or removes a staged upload, an unpacked zip entry or a cached blob now first proves the path lies inside the storage folder, which closes the code-scanning path-injection findings at their source instead of dismissing them.

## [0.15.4] - 2026-11-08

### Security

- The account export is written with `yazl` instead of `archiver`, which removes the vulnerable `glob`/`minimatch` chain from the shipped dependencies; `npm audit --omit=dev` is clean. The export also opens one file at a time now.
- Updated `re2js` (a lint-only dependency) to the patched release.

## [0.15.3] - 2026-11-08

### Fixed

- A pasted folder tree no longer turns the sentences around it ("Good, create these:", "Which categories would you also recommend?") into folders. A question next to the tree is answered by the assistant, which now also sees what the sorter recognised in the unfiled pictures, so its recommendations are based on your images.
- A lint error and a slow regex in the folder outline reader that failed CI on 0.15.2.

## [0.15.2] - 2026-11-08

### Fixed

- The assistant no longer writes the tree path ("Nature > Alps") into folder names; it creates the folder inside its parent instead. Existing folders named that way are renamed to their plain name.
- A folder outline pasted into the assistant (`|- Furry`, indented lists, notes such as "make categories for: A, B") is built exactly as drawn, with every folder under the right parent, without asking the model to retype it.

### Added

- The assistant can rename a folder.

## [0.15.1] - 2026-11-08

### Fixed

- The assistant page no longer scrolls as a whole on wide screens; only the conversation scrolls and the message box stays in view.

## [0.15.0] - 2026-11-08

### Added

- Files can be encrypted on the server before they go to the bucket (`BLOB_ENCRYPTION_KEY`, AES-256-GCM, a new IV per
  file), so the storage provider only holds bytes it cannot read. A changed object or a wrong key fails the read instead
  of being served; objects stored before encryption was switched on are still readable. See the deploy README.

## [0.14.0] - 2026-11-08

### Added

- An S3-compatible bucket (Backblaze B2) can now be the store of record for the files, with the VPS disk as a cache in front of
  it (`S3_*`, `BLOB_CACHE_GB`). Files are written to the bucket before an upload counts as stored, in parts for big ones (the
  old single request stopped at 5 GB); a file that is not on the disk streams from the bucket to the reader at once and is
  cached on the way, once however many people ask for it; the least recently used files are removed from the disk when the
  cache is full or the disk is short, never the only copy; files stored before the bucket was added are copied into it in the
  background. See the deploy README for the Backblaze setup.

## [0.13.0] - 2026-11-08

### Added

- A storage limit per account (`USER_QUOTA_GB`, 25 by default, 0 for none; one account can have its own in
  `users.quota_bytes`, 0 meaning no limit). It is checked before anything is accepted: a single upload, the start of a
  big upload (so it fails at once, not after hours), a link import (which stops at what is left), a zip (which stops
  unpacking at what fits) and files the assistant writes. The profile page shows how much is used. Every write is also
  refused while the disk has less than `DISK_RESERVE_GB` (10 in production) free, so a full disk can never take the
  other applications on the server down.

## [0.12.0] - 2026-11-08

### Changed

- Deleting a category now deletes the categories inside it too, in one step. The files in them are never deleted: they
  move up to the parent of the deleted folder (or to Unsorted for a top-level one). The dialog says how many folders and
  files are affected before you confirm. The assistant's "remove folder" follows the same rule.

### Added

- Trace ids. Every request gets one (the browser makes it, the server keeps it), it is written on every log line of the
  request, returned in a header and in every error, and passed on to the vision and model services. When something
  fails on our side or the connection drops, the message says so plainly and shows `Reference: <id>` with a button to
  copy it; `organizational/deploy/vps/trace.sh <id>` then shows what happened. Refusals ("that name is taken") keep
  their own words.
- Select several categories (the new Select button above the tree; click, or shift-click for a range) and delete them
  together. A folder ticked together with its own subfolder is counted once.
- The assistant can also unsort a folder or everything, remove a folder or all folders, and write files into the
  drive: Markdown, plain text, CSV, SVG drawings, and PlantUML, Mermaid or Graphviz diagrams. Anything that changes
  or removes what is there waits as a card with "Do it" and "Keep as it is" until you answer; nothing is deleted (a
  removed folder lifts its files and subfolders up one level). It now also knows how many files each folder holds.
  SVG drawings with scripts, outside references or event handlers are refused, and every file is served in a sandbox.
- "Sort now" can be left alone: close the browser, come back later, and the same bar is there with how many files are
  done of how many, and the time left. The bar sits at the top of every page while the sorter works, not only on Review.
- "Same picture, other size" is searched in the background, a batch of 1,000 files a minute (`DUPLICATE_BATCH`) and
  right after a sort run, and the findings are stored. The Duplicates page only reads them, shows how many pictures are
  compared so far and fills in by itself; nothing has to be started, and a big drive no longer makes the page wait.
  A vector index makes the comparison about 30 times faster (11,100 pictures in 20 s, all 100 planted copies found),
  so a drive is worked through within minutes of the update.
- A run survives a server restart or a deploy. It is written down when it starts and taken up again by the next start,
  with the same total and what was left of it.

### Fixed

- A message you typed showed twice in the chat while the answer was being written.
- The sorter's three workers all started by asking for the same file, so a picture could be classified up to three
  times and counted each time, which pushed the progress past 100%. They now take turns claiming the next file.

## [0.11.0] - 2026-11-08

### Added

- Assistant chat: a page where you tell a language model how your pictures should be organised. It creates folders
  (also inside other folders) and teaches the sorter your own words for what a folder holds: each phrase is scored next
  to the folder name from then on. The answer streams in as it is written, with the actions shown as cards. The model
  (llama.cpp, Qwen2.5 3B) runs in a container on the same server with no route to the internet or the database, so
  nothing is sent to a third party. The chat and what it taught go into the account export and are deleted with the
  account. Needs `LLM_SERVICE_URL`; see the deploy README.
- Review: select several files at once. Click selects, shift-click takes the whole range from the last click, ctrl-click
  adds one, "Select all guessed as..." takes every file with the same best guess. A bar then accepts the guesses, files
  the selection into one category or leaves it unsorted.

### Removed

- The one-off start-up pass that rewrote file names with percent escapes (it ran with 0.10.0).

## [0.10.0] - 2026-11-07

### Added

- Import from a link: paste a direct download link and the server fetches the file itself (a zip is unpacked), so your
  own upload speed does not matter. Only public http and https addresses on ports 80 and 443 are allowed; the address
  is checked after DNS and again on every redirect, and the connection is pinned to the checked address. Capped by
  size (10 GB) and by two parallel imports per account.
- The uploads panel shows the speed and a live countdown of the time left (per file and in total), also for zips being
  unpacked and for link imports.
- Uploads resume: asking again for the same file returns the unfinished session and the pieces it already has, so only
  the rest is sent. Before, every retry started from zero.
- An optional HTTP/1.1-only upload address (`UPLOAD_ORIGIN`): measured 22 against 12 Mbit/s on a home line, because a
  browser carries every HTTP/2 or HTTP/3 request on one connection. The page probes it and falls back to its own
  origin if it cannot be reached.

### Changed

- The uploads panel is no longer a live region for screen readers, because the time left changes every second.
- The frontend has a `test` script, run in CI.

## [0.9.0] - 2026-11-06

### Added

- Share your whole drive: one link to everything you have, from the Drive page ("Share my drive") or the Shared page, with the same options as any link (anyone with it or specific people, permanent or expiring, revocable). The public page and the viewer work as before, and a big drive or category is read 200 files at a time with a Load more button, where a link used to stop at 500 files.
- Registration is open to everyone and every account is equal: there is no owner, no admin and no setup step.
  `REGISTRATION_OPEN` is gone from the configuration.
- Account deletion is no longer refused for the first account, since nothing treats it as special any more.

### Changed

- New look, "The Archive": serif display type with a paper and olive palette and a vermilion accent, a masthead with
  tabs, search (`/` or Cmd/Ctrl+K), Upload and the account menu, a bottom tab bar on phones, and new sign-in art.

### Fixed

- The Shared page's link rows no longer run off the right edge of a phone screen; their buttons wrap.
- The legal pages no longer grow wider than a phone screen (long words wrap, the header wraps).
- The small uppercase labels, phone tab labels and footer text were about 10px and are now 11px.

## [0.8.0] - 2026-11-04

### Added

- Profile, "Your data": a switch for the NSFW check (off for new accounts; withdrawing it deletes the stored scores), a
  zip export of everything an account holds, and self-service account deletion that also removes blobs no other
  account uses. The only admin account cannot delete itself.
- `GET /api/me/export` and `DELETE /api/me`; `nsfwOptIn` on `PATCH /api/me`.

### Changed

- The NSFW model no longer runs for accounts that did not opt in, and a picture without a score is never auto-filed into
  a category with a public preview link.
- Privacy policy and terms describe the above instead of listing it as missing.
- Updated `katex` to 0.18.2 (Dependabot alert).

## [0.7.4] - 2026-11-02

### Changed

- Privacy policy and terms of use rewritten for open registration: the operator is the controller, DSGVO applies in
  full, and the missing self-service export, account deletion and per-account NSFW opt-out are stated plainly.
- README and deploy notes no longer say registration stays closed after the first account.

## [0.7.3] - 2026-11-01

### Added

- `robots.txt` and `sitemap.xml` so search engines can find the sign-in page and the legal pages; share links and
  every signed-in route are disallowed.
- Meta description, canonical link and Open Graph tags on the page shell.

## [0.7.2] - 2026-10-27

### Added

- Files that no folder fits by type (mp3, mp4, py, html, zip, no extension) are listed on the Unsorted page with one button, "Create the folders and sort", that makes an Audio, Video, Code, Archives and so on folder for exactly the kinds that have none and files them.
- Files without an extension or with a generic type are recognised from their first bytes (mp4, mp3, zip, pdf, ogg, flac, wav, webm, 7z, rar, gzip), when uploaded and when sorted.
- Test coverage is measured (API through Node's built-in coverage, vision through pytest-cov) and uploaded to Codecov from CI.
- A README in the shape of the other projects: demo clip, a screenshot per feature, test and CI tables.

### Fixed

- Pictures of scenery with a person in them (a summit photo) stayed in Unsorted; `Nature` and `Documents` folders are now also scored under mountain-scenery and scanned-page phrasings.
- In the slide viewer the arrow keys moved to the next file instead of the next slide.

## [0.7.1] - 2026-10-27

### Changed

- Every scrollbar is the same thin, arrowless bar in the theme's colours, and the folder tree no longer scrolls sideways.

## [0.6.1] - 2026-10-27

### Fixed

- Drawn pictures stayed in Unsorted: the folder names were still scored on their own, so a competitor label such as "a screenshot" beat `Furry` on artwork. Every folder is now scored under its several phrasings, summed, as the 0.5.0 notes said it was.

## [0.6.0] - 2026-10-27

### Added

- Every file in the drive has a page icon in its kind's colour with its extension on it (DOCX blue, XLSX green, PPTX orange, PDF red, code violet, routes teal, and so on).
- The sorter files by type: a folder named after an extension (DOCX, GPX, "png files") or after a kind (Documents, Code, Routes, Archives, Spreadsheets, Presentations, Audio, Video) takes matching files, the extension folder first.

### Fixed

- "Sort all now" said nothing was waiting for files the sorter had already looked at and left in Unsorted; it now looks at everything in Unsorted again, so new folders take effect.

## [0.5.0] - 2026-10-26

### Added

- "Sort all now" runs in the background without a time limit (it used to stop after four minutes, about 200 files); the button shows `done / total`, the Review page a progress bar, and it can be left and come back to. `SORT_CONCURRENCY` sets how many files are classified at once.
- The ratings are fixed automatically after every sorting run and once at start-up: pictures the NSFW model scores as explicit leave SFW, and the reverse.
- Folders are scored under several phrasings (the name, "<name> artwork", "an illustration of <name>", plus aliases such as an anthropomorphic animal character for Furry), summed, so drawn pictures land in the right folder more often.
- The drive loads 200 files at a time with a Load more button instead of stopping at 200.
- The viewer opens routes (GPX, TCX, KML, GeoJSON) with a drawn map, distance, climb, time and elevation profile; source files with syntax highlighting; Markdown rendered; JSON pretty-printed. The drive has Code and Routes filters.
- Big uploads: files of 48 MB and more go up in 16 MB pieces, eight at a time, each retried on its own and written straight into place on the server, so a 5 GB file is sent as fast as the line allows (measured locally: 5 GB in 14 seconds) and finishes in seconds. Files up to 20 GB and zips unpacking to 32 GB are accepted (`MAX_FILE_GB`, `ZIP_MAX_TOTAL_MB`).

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

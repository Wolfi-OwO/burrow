# Privacy Policy — burrow

Published in the app at `/privacy`. Last reviewed 2026-11-04. This file states
what the system does today and what applies if its shape changes; it does not
claim a legal review has taken place.

> Compliance draft, not legal advice. Not reviewed by a Rechtsanwalt.

## 1. Controller

Phillip Kofler operates this deployment (Contabo VPS, Austria-based operator) and is the controller under DSGVO Art 4(7)
for the personal data of everyone who has an account. Contact details are in § 9.

**Registration is open.** Since 2026-11-01 anyone can create an account, with a username and password or by signing in
with a GitHub, Microsoft or Google account. burrow is no longer a one-person system, so the household exemption in
Art 2(2)(c) that earlier versions of this document relied on **does not apply** and DSGVO applies in full. The legal bases
in § 3 are therefore the bases actually relied on, not hypothetical ones.

burrow is run privately and free of charge, with no advertising and no sale of data. That does not change the
operator's duties as controller.

## 2. Data Subjects

Every person with a burrow account is a data subject: the operator and everyone who registers. burrow does not verify
anyone's age. It is meant for adults only (see the Terms of Use); an account that turns out to belong to a minor is
deleted on request.

## 3. What Is Collected

| Data                                                                                                                                          | Where it lives                                                                                                     | Legal basis                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Username, Argon2id password hash, linked provider ids, the email the provider confirmed, and whether the NSFW check is switched on            | PostgreSQL on the VPS                                                                                              | Art 6(1)(b): needed to give the account holder the service they asked for                                       |
| Active sessions: user agent, creation and expiry time                                                                                         | PostgreSQL                                                                                                         | Art 6(1)(f): keeping the account secure and letting a user end a session                                        |
| Profile: display name, bio, avatar                                                                                                            | PostgreSQL, avatar in the blob store                                                                               | Art 6(1)(b)                                                                                                     |
| Uploaded files and the category tree                                                                                                          | Metadata in PostgreSQL, bytes in `/opt/burrow/data` on the VPS, plus an encrypted copy in an Azure container (§ 5) | Art 6(1)(b)                                                                                                     |
| Per-file sorter output: suggested category, confidence, NSFW score, a 512-number image embedding                                              | PostgreSQL, in the same row as the file                                                                            | Art 6(1)(b), and see § 4 for the Art 9 question                                                                 |
| Assistant chat: what the account holder wrote to the assistant, what it answered and did, and the phrases it taught the sorter about a folder | PostgreSQL                                                                                                         | Art 6(1)(b): the feature the account holder uses; deleted with the account, or by "Clear chat" for the messages |
| Server logs: request line, status, correlation id; no request bodies, no passwords                                                            | The container log, rotated at 3 x 10 MB                                                                            | Art 6(1)(f)                                                                                                     |

The last column is the legal basis relied on for each row.

## 4. Special-Category Data Risk (Art 9 DSGVO)

The vision job classifies uploaded photos into a user-defined category tree, including an NSFW branch. Scoring photos of
people by whether they depict nudity or sexual content is **inference over personal images** and can engage **Art 9(1)**
special-category data (data concerning a person's sex life), and depending on the model, arguably biometric data. This is
a real Art 9 risk, not "just a filename tag."

**How it is handled:**

- **Opt-in, per account.** The NSFW check is **off for every new account**. It runs on an account's pictures only after
  its owner switches it on in Profile, "Your data", which is the consent under Art 9(2)(a). Accounts that already
  existed on 2026-11-04 were created before this switch and kept the check on.
- **Withdrawing.** Switching it off stops the check at once and deletes the NSFW scores already stored for that account.
  Files stay where they were filed. A picture with no score never files itself into a category that has a public preview
  link; it waits in the review queue instead, because nothing can vouch for it.
- **What you can also do:** delete any file at any time, which removes its scores and embedding with it.
- **What is stored:** the result is not a separate record. A category, a confidence, an NSFW probability and an image
  embedding live as columns of the file's own row, so deleting the file deletes all of them. The NSFW probability is used
  for one purpose: keeping a file out of any category marked as possibly publicly previewable. Nothing is sent to anyone.
- **Models:** both run on the VPS (`apps/vision`) and the service keeps no upload and no result after answering.

Art 9 attaches to the nature of the data, not to audience size, which is why the check is opt-in.

## 5. Recipients and Third-Country Transfers

- **The assistant chat runs on a language model on the same VPS** (llama.cpp, a container with no network route to
  the internet or the database). The messages, the account holder's folder names and the phrases already taught are
  sent to it and nowhere else; no third-party AI service is involved, so no third-country transfer arises here either.
- **Vision processing (`apps/vision`) runs locally on the operator's own
  Contabo VPS.** No file, photo, or classification request is sent to a
  third-party or cloud vision API — this was an explicit design constraint
  (see README.md), and it means no Chapter V third-country transfer
  question arises for the classification step itself.
- **User-uploaded file storage is the VPS disk** (`/opt/burrow/data` on the Contabo server), the same place as the
  database. Unless the object store below is switched on, uploads are not sent to any third-party storage service while
  they are in use.
- **Object storage for the files: Contabo Object Storage (Contabo GmbH, Germany), region European Union, once the
  operator switches it on (`S3_*` settings).** Then the VPS disk is only a cache and the bucket holds every file. Each file
  is **encrypted on the VPS before it is sent** (AES-256-GCM, a fresh random IV per file, a key that exists only on the VPS
  and in the operator's password manager), so Contabo stores opaque bytes it cannot read, classify or act on, and the
  content of an NSFW category does not depend on Contabo's content policy. The file names, folders, accounts and
  everything else stay in the database on the VPS. Contabo is the same EU provider that hosts the VPS and the bucket is in
  the EU, so storing the files there is not a transfer to a third country.
- **Offsite backup: Microsoft Azure Blob Storage, West Europe (Netherlands), Standard LRS.** Every night the database
  dump (GPG-encrypted to a public key whose private half is not on the server) and any new blobs (encrypted
  with rclone `crypt`, which encrypts both contents and file names) are copied to a private container. Microsoft
  therefore stores opaque data it cannot read or classify, which is also why the content of an NSFW category does not
  depend on Microsoft's content policy.
  - **Transfer mechanism, checked live on 2026-10-24** against the U.S. Department of Commerce's Data Privacy
    Framework list (<https://www.dataprivacyframework.gov/list>): Microsoft Corporation, Redmond, is an **active**
    participant in the EU-U.S. Data Privacy Framework, which covers the access question for a US-headquartered
    provider. The data is in an EU region, and encryption with keys that Microsoft does not hold is the additional
    safeguard. It is a snapshot, not a guarantee: re-checked at each release (`organizational/release-checklist.md`).
  - **Art 28:** the backup is stored under the operator's existing Azure account, on Microsoft's standard online
    services terms, which include its data protection addendum.
  - **Protection against loss and tampering:** the backup credential is a container-scoped SAS token that can read,
    add, create, write and list but **cannot delete**; blob soft delete and versioning (30 days) are on; database dumps
    are expired by a lifecycle rule after 30 days.
  - **Sub-processor disclosure.** Azure is named here as a sub-processor of backup copies for every account.
- **OIDC login (GitHub, Microsoft, Google)** is a third-party data flow: the
  chosen provider receives the OAuth handshake and, depending on scopes,
  identity/profile fields. These are US-headquartered providers. All three are offered as options and each is
  switched on only when the operator registers an app with it. **Checked live on 2026-10-24** on the Data
  Privacy Framework list: GitHub (San Francisco), Microsoft Corporation (Redmond) and Google LLC (Mountain View)
  are each an **active** EU-U.S. Data Privacy Framework participant. Same caveat as above: a snapshot that is
  re-checked at each release. burrow reads only the provider user id, the display name, the profile picture URL
  and the email address with its verified flag, and stores the id and the verified email.
- **Contabo** (hosting) is a processor for anything it can technically access on the VPS host. Contabo GmbH is an
  EU-established company, so no third-country transfer question arises for the hosting itself. Its standard
  data processing agreement is accepted in the customer account; the operator confirms that acceptance before
  the first production deploy (a gate in the release checklist).
- **Import from a link.** When you paste a link, the server contacts that address to download the file; the site you
  named sees this server's address and the link's request, nothing about you or your account. The file is then stored
  like an upload. The server refuses links that point to private or internal addresses.
- No other third party receives data. There is no analytics vendor, no error-tracking service, no advertising and
  no public API. Adding any of those means adding it here, with its own processor entry, in the same change.

## 6. Retention

- **Files and their sorter output** stay until the account holder deletes them. Deleting a file removes its
  database row (and with it the category, scores and embedding), and removes the stored bytes from the VPS disk once
  no other file uses the same content. Identical uploads share one stored copy, so the
  bytes are only removed with the last file that references them.
- **Backups:** a nightly encrypted database dump is kept for 30 days (a lifecycle rule deletes older ones); blob copies
  in the backup container are content-addressed and are not deleted by the backup job. The container keeps deleted
  and overwritten versions for 30 days (soft delete and versioning) as protection against mistakes. A deleted file's
  encrypted bytes therefore remain in the backup container, unreadable without the operator's keys, until the container
  is purged; erasure from the backups means deleting those blobs from the container, which the operator can do from the
  Azure portal.
- **Account deletion:** removes the account's rows and every blob no other account uses at once; see § 7 for the backups.
- **Sessions:** a session row is deleted 7 days after it expired or was revoked.
- **Logs:** the container log keeps three files of 10 MB and overwrites the oldest.
- **Thumbnails** are derived data in `/opt/burrow/data/thumbs`; they can be deleted at any time.

## 7. Rights

Each data subject has the rights under Art 15 to 21 (access, rectification, erasure, portability, objection) and the right
to withdraw consent where consent is the basis.

- **Access and portability (Art 15, 20):** Profile, "Download all my data" gives a zip with the account, the folders,
  `files.json` (every field burrow stored about each file, including scores and place guesses) and the files themselves.
- **Erasure (Art 17):** Profile, "Delete my account" removes the account, its files, folders, share links, sign-in methods
  and sessions at once, and deletes every stored file that no other account still uses. Encrypted backup copies follow the schedule in § 6.
- **Rectification and objection:** names, bio and the NSFW opt-in are editable in Profile. Anything else goes to the
  contact in § 9, and the operator answers within one month as Art 12(3) requires.

## 8. Breach Notification

If DSGVO applies, Art 33 (72-hour notification to the Datenschutzbehörde
where risk is likely) and Art 34 (direct notification to affected data
subjects where risk is high) apply. Procedure, written for a single operator: (1) contain it: end all sessions
(`UPDATE sessions SET revoked_at = now()`), rotate `JWT_SECRET` and any key that may be exposed, and
take the service offline if needed; (2) establish what was reachable, using the container log and the Azure
storage account's activity log; (3) if personal data of a person other than the operator was affected and a risk to them is likely,
notify the Datenschutzbehörde within 72 hours of becoming aware, and the affected people directly if the risk is
high; (4) write down what happened, what was done and when, whether or not notification was required.

## 9. Contact

Phillip Kofler, <KoflerPhillip@outlook.com>. Operator details are in `IMPRESSUM.md`.
Complaints can also go to the Österreichische Datenschutzbehörde (<https://www.dsb.gv.at>).

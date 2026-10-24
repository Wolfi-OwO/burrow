# Privacy Policy — burrow

Published in the app at `/privacy`. Last reviewed 2026-10-24. This file states
what the system does today and what applies if its shape changes; it does not
claim a legal review has taken place.

> Compliance draft, not legal advice. Not reviewed by a Rechtsanwalt.

## 1. Controller and the Household Question

Phillip Kofler operates the deployment (Contabo VPS, Austria-based
operator). **Resolved with a conditional default — see below.** DSGVO
Art 2(2)(c) exempts processing by a natural person "in the course of a
purely personal or household activity." burrow is intended as
household/family use, which is the shape that exemption is written for —
but this document (see § 5's "sub-processor ... for every account —
operator and family members alike") is written anticipating **separate
accounts for other family members**, who would not merely be subjects of
the operator's own processing but users acting on their own behalf
(uploading their own files, having their own photos sorted). Whether the
whole system still qualifies as "purely personal or household," or whether
Phillip Kofler would become a controller relative to other family members'
accounts (taking the processing outside the Art 2(2)(c) exemption for that
slice of it), was a genuine open question. It is resolved below by tying
the answer to the system's *current* state rather than to its anticipated
one. This gates everything below: if DSGVO applies, the rest of this
document is the scaffold for a real policy; while the household exemption
holds in full, a much lighter framework applies instead.

**Resolution (2026-09-26), conditional default.** As of this pass, burrow
has exactly one account — the operator's own. README.md's "Legal" section
states this plainly: *"burrow is personal, single-tenant software — I am
the only user, running it on my own infrastructure."* With no
non-operator account yet provisioned, there is no other data subject whose
files or identity the operator processes as anyone other than themself. On
that fact pattern, **the Art 2(2)(c) purely-personal-or-household-activity
exemption applies in full**: DSGVO does not attach to the operator's own
single-account use of burrow. Concretely, this means no Art 6 legal basis
is required for the rows in § 3, Art 35 (DPIA) is not triggered by § 4's
NSFW classification because Art 9 attaches to *processing subject to
DSGVO in the first place* and the exemption removes that predicate, and
Art 15/17/20 self-service rights (§ 7) are not a *legal* requirement —
though none of this is a reason to skip reasonable data hygiene as a
matter of practice, only a statement of what is not legally compelled.

**This default is state-dependent, not a one-time answer, and it breaks
automatically the moment a second, non-operator account is provisioned** —
at that point the operator becomes a controller relative to that other
person's own files and identity (their own uploads, their own login,
processed on infrastructure the operator controls but for that other
person's own purposes), which is exactly the "users acting on their own
behalf" scenario this section already anticipated above. CJEU case law on
the household exemption (*Rynes*, C-212/13) reads the carve-out narrowly
even for activity that is genuinely private but extends beyond the
operator's own strictly personal sphere; provisioning a distinct account
for a named third party is a clearer step outside that sphere than the
facts in *Rynes* itself (a home security camera incidentally recording a
public street). No new legal analysis is required to reach that
conclusion when it happens — it follows directly from the reasoning above
— but from that moment §§ 3, 4, 6, 7 of this document stop being
scaffolding for a hypothetical and start being binding for the
non-operator account(s), at minimum.

**Known inconsistency this default does not paper over.** The paragraph
above and § 5 of this document are written anticipating family-member
accounts, while README.md's "Legal" section states burrow is single-tenant
with the operator as its only user. Those two framings do not currently
agree with each other, and this resolution does not paper over that by
picking one — it is a separate, open **product** question (does burrow
stay single-tenant, or become multi-user) that a technical planning pass
already flagged as unresolved and that this document cannot settle, since
it is a build decision, not a legal one. This default simply tracks
whichever is true *right now* per README.md (one account) and is
explicitly revisable the instant that product question is settled either
way: staying single-tenant keeps this exemption durable; becoming
multi-user ends the exemption for every non-operator account the moment it
exists, per the reasoning above, with no further legal analysis needed to
re-trigger it.

## 2. Data Subjects

Every person with a burrow account is a data subject under DSGVO — the
operator and every family member alike. This is stated explicitly because
it's easy to treat a private/family app as having only one real user; it
does not.

**Account holders today:** exactly one, the operator. Registration is closed
after the first account (`REGISTRATION_OPEN=false`), so no other person's data
can enter the system without the operator changing that setting on purpose.
Before doing so, the self-service export and erasure paths in § 7 have to
exist; that is a rule for the operator, not an aspiration.

## 3. What Is Collected

| Data | Where it lives | Legal basis if DSGVO applies (see § 1) |
| - | - | - |
| Username, Argon2id password hash, linked provider ids and the email the provider confirmed | PostgreSQL on the VPS | Art 6(1)(b): needed to give the account holder the service they asked for |
| Active sessions: user agent, creation and expiry time | PostgreSQL | Art 6(1)(f): keeping the account secure and letting a user end a session |
| Profile: display name, bio, avatar | PostgreSQL, avatar in the blob store | Art 6(1)(b) |
| Uploaded files and the category tree | Metadata in PostgreSQL, bytes in `/opt/burrow/data` on the VPS, plus an encrypted copy in an Azure container (§ 5) | Art 6(1)(b) |
| Per-file sorter output: suggested category, confidence, NSFW score, a 512-number image embedding | PostgreSQL, in the same row as the file | Art 6(1)(b), and see § 4 for the Art 9 question |
| Server logs: request line, status, correlation id; no request bodies, no passwords | The container log, rotated at 3 x 10 MB | Art 6(1)(f) |

While the household exemption in § 1 holds, none of these rows needs a legal
basis. The column says what would be relied on the moment it stops holding.

## 4. Special-Category Data Risk (Art 9 DSGVO)

The scheduled vision job classifies personal photos into a user-defined
category tree, including an NSFW branch. Classifying photos of people by
whether they depict nudity/sexual content is **biometric-adjacent inference
over personal images** and can engage **Art 9(1)** special-category data —
potentially data concerning a person's sex life or sexual orientation, and
depending on the model's feature representation, arguably biometric data
processed to analyse characteristics of a natural person. This is flagged as
a real Art 9 risk, not dismissed as "just a filename tag."

**How this is handled:**

- **Today** the operator uploads only their own files to their own account, and the household exemption in § 1
  holds. Art 9 only attaches to processing that DSGVO covers in the first place.
- **Rule for any second account:** the NSFW pass must not run on a second person's files without that person's
  explicit consent under Art 9(2)(a), given separately from signing up. The software cannot enforce that today
  (there is no per-account switch), which is one more reason registration stays closed. Building that switch is
  the precondition for opening it.
- **What is stored:** the classification result is not a separate record. A category, a confidence, an NSFW
  probability and an image embedding live as columns of the file's own row. Deleting the file deletes all of
  them with it, and they cannot outlive it. The NSFW probability is used for one purpose: keeping a file out of
  any category marked as possibly publicly previewable. Nothing is sent to anyone.
- **Models:** both run on the VPS (`apps/vision`) and the service keeps no upload and no result after answering.

This category of risk does not resolve itself by keeping the deployment
private; Art 9 attaches to the nature of the data, not to audience size.

## 5. Recipients and Third-Country Transfers

- **Vision processing (`apps/vision`) runs locally on the operator's own
  Contabo VPS.** No file, photo, or classification request is sent to a
  third-party or cloud vision API — this was an explicit design constraint
  (see README.md), and it means no Chapter V third-country transfer
  question arises for the classification step itself.
- **User-uploaded file storage is the VPS disk** (`/opt/burrow/data` on the Contabo server), the same place as the
  database. Uploads are not sent to any third-party storage service while they are in use.
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
  - **Sub-processor disclosure.** Azure is named here as a sub-processor of backup copies for every account, whatever
    § 1's household-exemption question ends up concluding.
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
- **Sessions:** a session row is deleted 7 days after it expired or was revoked.
- **Logs:** the container log keeps three files of 10 MB and overwrites the oldest.
- **Thumbnails** are derived data in `/opt/burrow/data/thumbs`; they can be deleted at any time.

## 7. Rights

If DSGVO applies (see § 1), each data subject has the rights under Art
15–21 (access, rectification, erasure, portability, objection). There is no
self-service account export or account deletion screen yet: the operator
handles such requests by hand, directly in the database and the bucket. That is
a workable answer for one account and not for several, so the rule from § 2
stands: build self-service export and erasure before onboarding any account
beyond the operator's own. Individual files can already be downloaded and
deleted by their owner at any time.

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

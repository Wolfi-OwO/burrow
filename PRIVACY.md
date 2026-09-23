# Privacy Policy — burrow

Scoped stub, not a finished policy. Every unresolved point below is marked
`TODO`. Nothing in this file asserts DSGVO compliance has been established —
it names the obligations that apply and the open questions that block that
claim.

> Compliance draft, not legal advice. Not reviewed by a Rechtsanwalt.

## 1. Controller and the Household Question

Phillip Kofler operates the deployment (Contabo VPS, Austria-based
operator). **TODO — unresolved:** DSGVO Art 2(2)(c) exempts processing by a
natural person "in the course of a purely personal or household activity."
burrow is intended as household/family use, which is the shape that
exemption is written for — but burrow provisions **separate accounts for
other family members**, who are not merely subjects of the operator's own
processing but users acting on their own behalf (uploading their own files,
having their own photos sorted). Whether the whole system still qualifies as
"purely personal or household," or whether Phillip Kofler is a controller
relative to the other family members' accounts (taking the processing
outside the Art 2(2)(c) exemption for that slice of it), is a genuine open
question — not resolved here, and not assumed either way. This gates
everything below: if DSGVO applies, the rest of this document is the
scaffold for a real policy; if the household exemption holds in full, a
much lighter framework may be appropriate instead. **TODO: resolve before
any non-operator account is provisioned.**

## 2. Data Subjects

Every person with a burrow account is a data subject under DSGVO — the
operator and every family member alike. This is stated explicitly because
it's easy to treat a private/family app as having only one real user; it
does not. **TODO** — list actual account holders and their relationship to
the controller once accounts exist, for the real (non-stub) version of this
document.

## 3. What Is Collected

| Data | Likely legal basis (if DSGVO applies, see § 1) | Notes |
| - | - | - |
| Login credentials / OIDC identity (GitHub, Microsoft, Google) | Art 6(1)(b) or Art 6(1)(f), pending § 1 | Third-party IdP — see § 5 |
| Profile (avatar, name, bio) | Art 6(1)(b)/(f), pending § 1 | |
| Uploaded files and the user-defined category tree | Art 6(1)(b)/(f), pending § 1 | Canonical copy stored off-VPS on Backblaze B2 — see § 5 |
| AI-generated category assignment per file (including the NSFW branch) | See § 4 | Inference output, not raw upload |

**TODO** — finalize legal basis per row once § 1 is resolved; a purely
household-exempt system may not need an Art 6 basis at all, a non-exempt one
does.

## 4. Special-Category Data Risk (Art 9 DSGVO)

The scheduled vision job classifies personal photos into a user-defined
category tree, including an NSFW branch. Classifying photos of people by
whether they depict nudity/sexual content is **biometric-adjacent inference
over personal images** and can engage **Art 9(1)** special-category data —
potentially data concerning a person's sex life or sexual orientation, and
depending on the model's feature representation, arguably biometric data
processed to analyse characteristics of a natural person. This is flagged as
a real Art 9 risk, not dismissed as "just a filename tag."

**TODO — unresolved:**

- Whether Art 9(2)(a) explicit consent (separate from account signup, per
  the pattern used elsewhere in this account's projects) is required before
  a photo of a given person is run through NSFW classification, and how
  consent is captured for a photo that depicts a family member other than
  the account holder (e.g. a shared album).
- Whether the § 1 household exemption, if it holds, also covers this
  specific processing, or whether AI-driven classification of another
  person's likeness is exactly the kind of activity that falls outside
  "purely personal."
- What happens to the classification result itself (stored as metadata?
  retained after reclassification? deletable independently of the source
  file?) — not yet decided, not yet built.

This category of risk does not resolve itself by keeping the deployment
private; Art 9 attaches to the nature of the data, not to audience size.

## 5. Recipients and Third-Country Transfers

- **Vision processing (`apps/vision`) runs locally on the operator's own
  Contabo VPS.** No file, photo, or classification request is sent to a
  third-party or cloud vision API — this was an explicit design constraint
  (see README.md), and it means no Chapter V third-country transfer
  question arises for the classification step itself.
- **User-uploaded file storage: Backblaze B2, EU-Central region, via its
  S3-compatible API, is the canonical durable tier for every uploaded file
  blob — not a backup copy.** The local Contabo VPS disk holds only a
  bounded ~50GB cache of recently-accessed blobs (GitHub issue #30,
  ADR-0002); a blob evicted from that cache exists only on B2 until
  re-fetched. **This means uploaded files — including files that land in
  the NSFW-classified branch (§ 4) — leave the VPS and are held by
  Backblaze, a sub-processor. This document must not be read as saying
  uploads stay on the VPS; since the blob-store change (issue #30) they do
  not.**
  - **Region.** EU-Central is Backblaze's own designated EU region; per
    Backblaze's published regional documentation this keeps blob data
    physically within the EU at rest, which is why this deployment uses it
    and not a US-region bucket — the same reasoning `mona/PRIVACY.md` § 5
    applies to its own (not yet provisioned) Backblaze target.
  - **Backblaze Inc. is a US-headquartered company**, unlike Contabo GmbH
    (EU-established; see `mona/PRIVACY.md` § 5 for the equivalent
    reasoning there). Physical data residency in the EU does not by itself
    close the Chapter V DSGVO question if Backblaze's US entity retains
    remote administrative or support access to EU-Central data from
    outside the EEA — under EDPB post-Schrems-II guidance, remote access
    from a third country can itself constitute a transfer, independent of
    where the bytes are stored at rest.
  - **TODO — unresolved:** confirm (a) whether Backblaze's EU-Central
    offering is covered by executed Standard Contractual Clauses or a
    current EU-US Data Privacy Framework certification specific to
    Backblaze Inc. (DPF status must be checked live against Backblaze's
    current certification list, not assumed from general knowledge — the
    same caveat § 5 already states for the OIDC providers below), and (b)
    whether an Art 28 Auftragsverarbeitervertrag with Backblaze has been
    reviewed and executed for this account. Until both are confirmed,
    treat Backblaze as a **named-but-unconfirmed processor**, not a
    documented one — the same posture `mona/PRIVACY.md` § 5 takes with
    Contabo's own open DPA point.
  - **Sub-processor disclosure.** Backblaze B2 is named here as a
    sub-processor of user-uploaded file content for every account —
    operator and family members alike. This disclosure is made regardless
    of how § 1's household-exemption question ultimately resolves: family
    members' accounts are the slice least likely to fall inside any Art
    2(2)(c) exemption in the first place, and even if the exemption were
    to hold in full, this document still has to say where uploads actually
    live rather than where an earlier draft assumed they lived.
- **OIDC login (GitHub, Microsoft, Google)** is a third-party data flow: the
  chosen provider receives the OAuth handshake and, depending on scopes,
  identity/profile fields. These are US-headquartered providers.
  **TODO** — confirm which providers are actually used at launch, and for
  each one, whether the current transfer mechanism (EU-US Data Privacy
  Framework certification, or SCCs) is in force at that time; DPF status is
  not static and needs checking against the provider's current
  certification, not assumed from general knowledge.
- **TODO** — Contabo (hosting) is itself a processor for anything it can
  technically access (the VPS host). An Art 28 Auftragsverarbeitervertrag
  with Contabo has not been reviewed for this project; confirm Contabo's
  standard DPA terms before treating hosting as settled.
- No other third party is designed to receive data. No public API, no
  analytics vendor, no error-tracking SaaS decided yet — **TODO** flag any
  of those the moment they're added; each one needs its own AVV entry here.

## 6. Retention

**TODO** — not decided. No automated deletion policy exists yet; this is
scaffolding, not a built feature. Retention now has to be decided for two
tiers, not one: the ~50GB local cache (evicts on its own capacity policy,
not a data-protection one) and the Backblaze B2 canonical copy (no
deletion job exists yet — deleting a file record does not yet imply
deleting the underlying B2 object). A DSAR erasure request is not fully
answerable until a delete path reaches B2 as well as the local cache and
the database row; do not treat "removed from the app" as "removed from
B2" until that path is built.

## 7. Rights

If DSGVO applies (see § 1), each data subject has the rights under Art
15–21 (access, rectification, erasure, portability, objection). **TODO** —
no self-service export/delete endpoint exists yet; until one does, rights
requests would have to be handled manually by the operator, which is not a
durable answer for a system with multiple real users. Build this before
onboarding any account beyond the operator's own.

## 8. Breach Notification

If DSGVO applies, Art 33 (72-hour notification to the Datenschutzbehörde
where risk is likely) and Art 34 (direct notification to affected data
subjects where risk is high) apply. **TODO** — no incident-response process
exists yet for this project.

## 9. Contact

**TODO** — see IMPRESSUM.md; contact address not yet finalized.

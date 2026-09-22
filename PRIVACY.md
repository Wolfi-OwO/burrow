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
| Uploaded files and the user-defined category tree | Art 6(1)(b)/(f), pending § 1 | |
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
scaffolding, not a built feature.

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

# Terms of Use — burrow

Scoped stub, not a finished policy. Unresolved points are marked `TODO`.

> Compliance draft, not legal advice.

## 1. What burrow Is

A private, self-hosted, single-tenant file drive. Accounts are provisioned
by the operator (Phillip Kofler) for himself and household/family members —
there is no public sign-up, no public content, and no offering to the
general public. **This is not a public service, not a SaaS product, and
nothing is sold.**

## 2. Not a Distance-Selling / Consumer Contract

Because no goods or services are sold and there is no commercial
transaction between operator and account holders, this deployment is not
within the scope of Austria's FAGG (Fern- und Auswärtsgeschäfte-Gesetz) or
its distance-selling withdrawal-right regime — those apply to contracts for
payment, and none exists here. **TODO** — re-confirm this if the project's
shape ever changes (e.g. if burrow is ever offered to anyone outside the
household, or for payment); that would put an entirely different set of
obligations (FAGG, Button-Lösung, KSchG) back in scope and this section
would need a full rewrite, not a patch.

## 3. Account Holders

Accounts exist for the operator and specific family members the operator
personally provisions. **TODO** — decide and document who is/isn't eligible
for an account, and whether any account holder is a minor (relevant to
DSGVO Art 8 / § 1 PRIVACY.md, not resolved there either).

## 4. AI-Assisted Sorting

The scheduled vision job sorts uploaded files into the category tree,
including into an NSFW branch, automatically. Classification is a
best-effort automated estimate and can be wrong (misfiled file, wrong
subcategory); it is not a moderation or content-removal decision — a
misclassified file is only misfiled, not deleted or restricted. **TODO** —
decide and document whether/how a user can correct a wrong classification.

## 5. User Responsibilities

- Keep credentials confidential.
- Uploaded content must not be unlawful (e.g. content depicting minors is
  never permitted, regardless of category — see SECURITY.md and the Contabo
  finding in WEB_APP_COMPLIANCE_CHECKLIST.md for hosting-level constraints
  on this VPS).
- Do not use burrow to circumvent its single-tenant/private design (e.g. do
  not turn a personal account into a public redistribution point for
  uploaded files).

## 6. Intellectual Property

Source code is MIT-licensed (`LICENSE`). Uploaded files remain the
uploader's own; the operator processes them only to provide the service
(storage, category sorting) and grants no further rights to them.

## 7. No Warranty

burrow is provided as-is, is scaffolding/early-stage software, and carries
no uptime or accuracy guarantee, including for AI classification results.

## 8. Governing Law

Austrian law. **TODO** — this section is a placeholder; revisit once/if the
deployment shape changes per § 2.

## 9. Changes

**TODO** — no change-notification process defined yet; scaffolding only.

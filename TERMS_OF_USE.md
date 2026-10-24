# Terms of Use — burrow

Published in the app at `/terms`. Last reviewed 2026-10-24.

> Compliance draft, not legal advice. Not reviewed by a Rechtsanwalt.

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
payment, and none exists here. If the project's shape ever changes (burrow
offered to anyone outside the household, or for payment), an entirely
different set of obligations (FAGG, Button-Lösung, KSchG) comes into scope and
this section needs a full rewrite, not a patch.

## 3. Account Holders

Accounts exist for the operator and specific family members the operator
personally provisions. Today there is exactly one account, the operator's.
Registration is closed by default (`REGISTRATION_OPEN=false`): after the first
account exists, nobody can sign up. Eligibility rule: an account is only
provisioned for an adult the operator knows personally. No account is ever
provisioned for a minor; that would need its own review under DSGVO Art 8
(see `PRIVACY.md`) before it could happen.

## 4. AI-Assisted Sorting

The scheduled vision job sorts uploaded files into the category tree,
including into an NSFW branch, automatically. Classification is a
best-effort automated estimate and can be wrong (misfiled file, wrong
subcategory); it is not a moderation or content-removal decision — a
misclassified file is only misfiled, not deleted or restricted. A user can
always correct it: drag the file to another category, change its category in
the details panel, or resolve it from the review queue (accept the suggestion,
pick another category, or leave it unsorted). The sorter files on its own only
when it is at least 60% sure; everything below that waits in the review queue
instead of being filed on a guess.

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

Austrian law applies. Revisit this section if the deployment shape changes per
§ 2.

## 9. Changes

These terms change only with the repository: every change is a commit to
`TERMS_OF_USE.md`, and the "Last reviewed" date above moves with it. With one
account holder, the operator is the person who would be notified, so there is
no separate notification process.

# Terms of Use — burrow

Published in the app at `/terms`. Last reviewed 2026-11-02.

> Compliance draft, not legal advice. Not reviewed by a Rechtsanwalt.

## 1. What burrow Is

A personal file drive that sorts uploaded pictures and files into a category tree you define. It is run privately by
the operator (Phillip Kofler), is free to use, shows no advertising and sells nothing. Anyone can register an account;
the operator can close registration or an individual account at any time.

## 2. Not a Distance-Selling / Consumer Contract

No goods or services are sold and nothing is paid for, so there is no payment contract between operator and account
holders and Austria's FAGG distance-selling withdrawal rules do not apply. If burrow is ever offered for payment, an
entirely different set of obligations (FAGG, Button-Lösung, KSchG) comes into scope and this section needs a full
rewrite, not a patch.

## 3. Account Holders

- You must be an adult. burrow does not verify age; an account that belongs to a minor is deleted on request.
- One account per person. Keep your credentials confidential.
- The operator may suspend or delete an account that breaks these terms, and may close registration.
- To have your account and data deleted, write to the contact in `PRIVACY.md` § 9. There is no self-service deletion
  yet; the operator does it by hand.

## 4. AI-Assisted Sorting

The scheduled vision job sorts uploaded files into the category tree, including into an NSFW branch, automatically.
It runs on every account's files; there is no per-account switch yet (see `PRIVACY.md` § 4). Classification is a
best-effort automated estimate and can be wrong (misfiled file, wrong subcategory); it is not a moderation or
content-removal decision, so a misclassified file is only misfiled, not deleted or restricted. You can always correct it:
drag the file to another category, change its category in the details panel, or resolve it from the review queue
(accept the suggestion, pick another category, or leave it unsorted). The sorter files on its own only when it is at
least 60% sure; everything below that waits in the review queue instead of being filed on a guess.

## 5. User Responsibilities

- Uploaded content must not be unlawful. Content depicting minors is never permitted, regardless of category
  (see `SECURITY.md` and the Contabo finding in `WEB_APP_COMPLIANCE_CHECKLIST.md` for hosting-level constraints on
  this VPS).
- Do not use burrow as a public redistribution point for files, for example by handing out share links to content
  you do not have the right to share.
- Do not try to access other people's accounts or files, or to disrupt the service.

## 6. Intellectual Property

Source code is MIT-licensed (`LICENSE`). Uploaded files remain the uploader's own; the operator processes them only
to provide the service (storage, category sorting) and grants no further rights to them.

## 7. No Warranty

burrow is provided as-is, is early-stage software, and carries no uptime, storage or accuracy guarantee, including for
AI classification results. Keep your own copy of anything you cannot lose.

## 8. Governing Law

Austrian law applies. Revisit this section if the deployment shape changes per § 2.

## 9. Changes

These terms change only with the repository: every change is a commit to `TERMS_OF_USE.md`, and the "Last reviewed"
date above moves with it. There is no separate notification process, so check the date.

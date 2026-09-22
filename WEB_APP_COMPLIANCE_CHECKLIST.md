# Web App Compliance Checklist — burrow

Scaffolding-phase checklist. Most items here are deferred to the full-app
phase and tracked as `TODO`. Two items below are **researched findings**,
not TODOs — they state a conclusion, the reasoning, and the source.

> Compliance draft, not legal advice. Not reviewed by a Rechtsanwalt. The
> Contabo finding is based on a live fetch of Contabo's published terms on
> 2026-09-22; re-check against Contabo's then-current terms before relying
> on it — hosting providers change their terms without much notice.

## Finding 1: Does Contabo's terms permit hosting adult (NSFW) material for private use?

**Conclusion: Not cleanly. Contabo has no separate "Acceptable Use Policy"
document — the relevant obligation lives in its General Terms and
Conditions, and it is broader and less forgiving than a typical "no public
adult content" carve-out. Treat storing the NSFW category on this VPS as an
open contractual risk, not a settled yes.**

**Source:** Contabo GmbH, "General Terms and Conditions", effective
December 2025, retrieved live from <https://contabo.com/en/legal/terms-and-conditions/>
on 2026-09-22.

**Reasoning:**

- Clause 6(1) ("Infringement of generally applicable law") states, as a
  customer warranty: *"The customer furthermore warrants that the content
  provided or published does not violate public morals, does not contain
  any pornographic or obscene materials, does not incite racial hatred,
  does not infringe upon human dignity, does not endanger children or
  adolescents, and is not insulting or discriminatory."* This clause sits
  in **Part 1: General regulations**, which applies to *all* contracts
  concluded via Contabo's shop (Clause 1(2)) — it is not scoped to shared
  web hosting or to publicly-reachable websites specifically, and nothing
  in the clause's text limits it to *public* content. It refers to "the
  content which the customer uploads," which textually covers private,
  authenticated storage on a VPS just as much as a public web page.
- This means the literal text of Clause 6(1) is broader than "no public
  pornography" — a strict reading makes hosting any pornographic/obscene
  material a warranty breach regardless of who can see it, which would
  include a private, login-gated NSFW category on a household file drive.
- Against that: enforcement under Clause 6(2) is **complaint-driven**, not
  proactive. Contabo states elsewhere in the same document (Part 3, DSA
  implementation, §2.3(1)) that as a hosting provider it "cannot organise
  general monitoring of the content hosted on the servers... nor can it
  determine whether it is lawful or unlawful," and only acts on a
  third-party report via its abuse form. A private, single-tenant
  deployment with no public exposure and no third party ever seeing the
  content has, in practice, no realistic path to triggering that mechanism.
- **Net conclusion:** the *contractual* risk under Clause 6(1) is real and
  not narrowly scoped to public content — this is not "clearly fine because
  it's private." The *practical* enforcement risk is low, because Contabo's
  own stated process only acts on a report, and there is no plausible
  reporter for content nobody but the household ever sees. These are two
  different things; do not collapse them into "so it's fine."
- Separately, and not in tension with the above: content depicting minors
  ("child pornography") is called out as **illegal content** under Part 3
  (DSA implementation, §1(4)) with its own reporting/removal mechanism —
  this is unconditional and has nothing to do with public/private status.
  It is out of scope for the lawful-adult-content question this finding
  answers, and is mentioned only so the distinction (lawful adult NSFW vs.
  unconditionally-illegal CSAM) is explicit and not blurred.

**TODO** — this finding is not a substitute for asking Contabo directly.
Before treating the NSFW category as safe to store on this VPS long-term,
either (a) contact Contabo support and get their position on private,
non-public NSFW storage in writing, or (b) plan a fallback host/volume for
that specific category if the answer is unfavorable or ambiguous. Re-check
this finding against Contabo's then-current terms before relying on it —
the version above is dated December 2025 and terms can change.

## Finding 2: Does an EU/Austrian age-verification obligation attach to this deployment?

**Conclusion: Most likely no, for the deployment as currently planned — but
this conclusion is conditional on the deployment staying exactly as
described (closed, operator-provisioned accounts, no public registration),
and it does not resolve a separate, real question about minor account
holders.**

**Reasoning:**

- The age-verification regimes that would otherwise be relevant — Germany's
  Jugendmedienschutz-Staatsvertrag (JMStV), the various Austrian
  Landes-Jugendschutzgesetze restricting minors' access to pornographic
  content, and the DSA's Art 28 protection-of-minors provisions — are all
  built around services **offered to the public or to an indeterminate
  audience**. A closed, single-tenant system where every account is
  personally provisioned by the operator for named household members, with
  no public sign-up and no path for an unknown/unverified person to reach
  the NSFW category, does not match the fact pattern those regimes target.
  No public audience means no practical "who is behind this login" problem
  that age-verification law is trying to solve.
- This is general legal reasoning applied to the stated facts, not a
  reviewed opinion, and it is conditional: it holds only as long as no
  public registration path, invite link, or external account is ever added.
  **TODO** — re-run this analysis the moment the deployment shape changes
  (see TERMS_OF_USE.md § 2, same conditionality).
- **Separate, unresolved point — not the same question:** if a family
  member with a burrow account is a minor, that raises DSGVO Art 8 (minimum
  age for a minor's own valid consent to an information-society service,
  14 in Austria per the DSG) and a household-governance question about
  whether a minor should have access to an NSFW category at all. This is a
  parental-consent/child-safeguarding question, not a public
  age-verification-statute question, and it is **not answered by this
  finding**. **TODO** — resolve before any minor is given an account,
  independent of the age-verification conclusion above.
- This entire finding should get a Rechtsanwalt sanity-check before the
  deployment goes live, given the subject matter (adult content + possible
  minors in the household) — flagging this explicitly rather than treating
  the reasoning above as sufficient on its own.

## Everything Else — Deferred to the Full-App Phase

The items below are named so they become issues later, not resolved now.

- [ ] `TODO` — DSGVO Art 30 Verarbeitungsverzeichnis: not started.
- [ ] `TODO` — DPIA (Art 35) assessment: the NSFW/Art 9-adjacent
      classification described in PRIVACY.md § 4 is a plausible DPIA
      trigger; not assessed yet.
- [ ] `TODO` — Art 28 AVV with Contabo (hosting): not reviewed.
- [ ] `TODO` — OIDC provider (GitHub/Microsoft/Google) transfer mechanism
      check (DPF certification vs. SCCs) at time of launch: not done.
- [ ] `TODO` — DSGVO Art 2(2)(c) household-exemption question
      (PRIVACY.md § 1): not resolved.
- [ ] `TODO` — self-service export/delete (Art 15/17/20) endpoints: not
      built.
- [ ] `TODO` — breach-notification process (Art 33/34): not defined.
- [ ] `TODO` — Impressum contact details and the § 5 ECG threshold question
      (IMPRESSUM.md): not resolved.
- [ ] `TODO` — CI/security scanning (gitleaks, Trivy, CodeQL, Dependabot):
      not configured (see SECURITY.md).

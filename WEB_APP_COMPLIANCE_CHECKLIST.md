# Web App Compliance Checklist — burrow

Scaffolding-phase checklist. Most items here are deferred to the full-app
phase and tracked as `TODO`. Three items below are **researched findings**,
not TODOs — they state a conclusion, the reasoning, and the source.

> Compliance draft, not legal advice. Not reviewed by a Rechtsanwalt. The
> Contabo finding is based on a live fetch of Contabo's published terms on
> 2026-09-22; the Backblaze finding is based on a live fetch of Backblaze's
> published Terms of Service and Acceptable Use Policy on 2026-09-23.
> Re-check both against the providers' then-current terms before relying
> on them — hosting providers change their terms without much notice.

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

## Finding 3: Does Backblaze's acceptable-use policy permit storing private adult (NSFW) material in B2?

**Conclusion: More permissive than Contabo on its face, but "not prohibited"
is not the same claim as "affirmatively permitted" — and because B2 is now
burrow's canonical blob store rather than a backup target, a takedown here
is loss of the store of record, not merely a legal event. Backblaze's
Acceptable Use Policy (AUP) contains no blanket "no pornographic/obscene
content" clause of the kind Contabo's General Terms and Conditions has. Its
only sexual-content-specific prohibitions are CSAM and non-consensual
intimate imagery, both of which are categorically different from lawful,
private adult content. Treat the NSFW category as not currently prohibited
by B2's published terms, while still carrying the same complaint-driven
takedown risk Finding 1 identifies for Contabo — with materially higher
stakes given the store-of-record change.**

**Source:** Backblaze, Inc., "Terms of Service" and "Acceptable Use Policy",
both effective April 16, 2026, retrieved live via `curl` from
<https://www.backblaze.com/company/policy/terms-of-service> and
<https://www.backblaze.com/company/policy/acceptable-use-policy> on
2026-09-23.

**Reasoning:**

- The AUP's "Illegal Activity and Prohibited Content" section lists, among
  the things a user "may not" do: *"Store, publish, share, or transmit
  content that constitutes CSAM, or that sexually exploits or promotes the
  sexual exploitation of minors,"* and *"Store, publish, share, or transmit
  another person's intimate imagery without their authorization for
  purposes of harassing, exposing, harming, or exploiting them."* Neither
  clause reaches lawful, consensual adult content stored privately — the
  first is scoped to minors, the second to *non-consensual* sharing of
  another person's imagery. There is no equivalent of Contabo's Clause
  6(1) ("does not contain any pornographic or obscene materials") anywhere
  in the AUP or the Terms of Service text as fetched. Read literally, the
  AUP does not prohibit lawful adult NSFW content as such.
- This absence is the whole finding, and it cuts the other way too: the
  AUP is short and enumerated, not a general "acceptable content" standard.
  Its silence on lawful pornography is evidence Backblaze chose not to
  regulate it, not proof Backblaze has affirmatively blessed it — the two
  are legally different postures, and this finding does not collapse them.
- Backblaze's Terms of Service (Part B) do the takedown work outside the
  AUP, through a general applicable-law and notice clause rather than a
  content-standards clause: *"Please be careful about what Files you choose
  to share. Backblaze does not actively monitor Files you upload,
  download, or share. However, we reserve the right, in our sole
  discretion, to remove Files and/or suspend or terminate your account
  without prior notice if we become aware that your Files or use of the
  Service(s) violates our Terms, Acceptable Use Policy, or applicable
  law."* This is the same complaint/awareness-driven posture Finding 1
  found in Contabo's DSA-implementation clause — Backblaze does not
  proactively scan, but reserves an immediate, no-notice removal right
  once it becomes aware of a problem via any channel (report, legal
  process, automated abuse signal). Lawful private NSFW gives no third
  party a reason to report it, so the practical trigger risk is low, same
  as the Contabo analysis — but the mechanism it would trigger is broader:
  "remove Files and/or suspend or terminate your account."
- The stakes of that mechanism firing are qualitatively different from the
  Contabo finding, because of a separate architectural decision this
  finding does not itself evaluate but must state plainly: B2 EU-Central
  is burrow's **canonical** blob store, with local VPS disk holding only a
  bounded ~50GB cache (`organizational/deploy/b2-credential-security.md`,
  "Live findings" §5). A Contabo AUP action would threaten hosting of the
  application; a B2 AUP action removes or blocks the actual files — there
  is no second copy to fall back to unless burrow's own backup/versioning
  design provides one independently. §5 states this directly: *"An AUP
  takedown at B2 is not only a legal event — it is loss of the store of
  record."* This finding adopts that framing rather than restating it as a
  new discovery.
- The Terms of Service also confirm that account-level termination can
  include data loss, not just access loss: *"If you stop paying for our
  Service(s) or violate any of our Terms or applicable policies, we
  reserve the right to suspend or terminate your account and may delete
  your data."* Combined with the no-notice removal right above, an AUP
  finding against burrow's B2 account is a plausible path to permanent,
  not just temporary, loss of the canonical file store.
- As with Finding 1, the CSAM/lawful-adult-NSFW distinction is explicit and
  categorical, not a matter of degree: CSAM is called out by name in the
  AUP as one of the enumerated grounds for **immediate, no-notice**
  suspension or termination — *"involves child sexual abuse material
  ('CSAM') or non-consensual intimate imagery"* — alongside illegal
  activity and security risk. That unconditional prohibition is unrelated
  to, and does not inform, the lawful-adult-content question this finding
  answers.
- Separately, §5 also notes a Data Processing Agreement (Art 28 DSGVO AVV)
  with Backblaze has not yet been put in place. That is a distinct
  compliance gap from the AUP content question answered here — both are
  real, neither substitutes for the other — and is already tracked as its
  own item in "Everything Else" below rather than restated here.

**TODO** — this finding (Finding 3) is not a substitute for asking
Backblaze directly, and it is weaker evidence than Finding 1 in one
respect: Contabo's terms
were checked against an explicit prohibition clause, while this finding
rests partly on the *absence* of one, which can change without the kind of
visible amendment a new prohibition clause would get. Before treating B2 as
settled for the NSFW category long-term: (a) get Backblaze's position on
lawful private adult content in writing if the volume or visibility of that
category grows, (b) put the Art 28 AVV in place before real user files land
there (§5), and (c) re-check this finding against Backblaze's
then-current Terms of Service and AUP before relying on it — both are dated
April 16, 2026 and, per the Terms of Service itself, can change.

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

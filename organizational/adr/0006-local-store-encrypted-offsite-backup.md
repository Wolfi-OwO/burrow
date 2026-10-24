# ADR-0006: The VPS disk is the store of record; the offsite copy is an encrypted backup on Azure

## Status

Accepted (2026-10-24). Supersedes the tiering decision in [ADR-0002](0002-storage-layout.md); its content-addressed
layout (`blobs/<aa>/<bb>/<sha256>`, hash before write, dedup by key) is unchanged.

## Context

ADR-0002 made Backblaze B2 the durable store and the VPS disk a bounded cache. Before anything was deployed the
operator decided against Backblaze: no account exists, a new vendor and a new contract are a cost for a single-user
drive, and the cost of a second paid service is out of proportion to the data. Two facts shaped the replacement:

- The VPS has ~76 GB free and burrow has one user. Disk space is not the constraint; durability is.
- A category of this drive is NSFW content. Any provider holding those bytes in the clear is subject to its own
  content policy (`WEB_APP_COMPLIANCE_CHECKLIST.md` already treats that as a risk for the host).

## Decision

**The local directory `/opt/burrow/data` is the store of record.** The API writes blobs there and reads them from
there; no remote tier is required. The optional `S3_*` settings remain for anyone who wants a live second copy, but
production does not use them.

**Durability comes from a nightly encrypted backup to a private Azure Blob container** (`burrow-backups`, Standard
LRS, Cool tier, West Europe, no public access), in an Azure account the operator already has:

- The database dump is encrypted with GPG to a public key whose private half is not on the server.
- Blobs are copied through an rclone `crypt` remote, so both contents and file names are encrypted before they leave
  the box. The storage provider holds opaque data, which also takes its content policy out of the question.
- The backup credential is a container-scoped SAS token with read, add, create, write and list, and **no delete**. A
  compromised server can add backups but cannot erase them. Blob soft delete and versioning (30 days) are on, and a
  lifecycle rule expires database dumps after 30 days.
- Blobs are never deleted by the backup job (`rclone copy --immutable`, not `sync`).

**Recovery point:** up to one night of uploads can be lost if the disk dies before the next run. For one user that is
accepted; running the timer more often is a one-line change.

## Consequences

- No new vendor, no new account, and the only third-country question left is Microsoft, an active EU-US Data Privacy
  Framework participant (checked 2026-10-24) that receives encrypted data only (`PRIVACY.md` § 5).
- Cost is roughly one cent per GB-month for the backup plus negligible operations, and nothing for the primary.
- The disk is now the live copy: `/opt/burrow/data` has to stay on the VPS volume and be watched for space. metrion
  does not collect disk usage for burrow (`deploy/metrion-onboarding.md`).
- The crypt password and the GPG private key are the keys to every backup. Lose them and the backups are noise; they
  are stored off the server (the operator's password store), and the restore drill proves they work.
- Restoring means: decrypt and restore the latest dump, `rclone copy` the blobs back into `/opt/burrow/data/blobs`.

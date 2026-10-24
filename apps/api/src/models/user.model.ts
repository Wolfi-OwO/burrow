import type { Role } from '../lib/jwt.ts';

/** An account. `passwordHash` is null for an account that only ever used an OIDC provider. */
export interface User {
    id: string;
    username: string;
    passwordHash: string | null;
    displayName: string;
    bio: string;
    avatarSha256: string | null;
    role: Role;
    createdAt: Date;
}

/** What other accounts may see (FR-019): never an email, never a linked provider. */
export interface PublicProfile {
    id: string;
    displayName: string;
    bio: string;
    hasAvatar: boolean;
}

export type Provider = 'github' | 'microsoft' | 'google';

/** A linked login provider (FR-009). */
export interface UserIdentity {
    id: number;
    userId: string;
    provider: Provider;
    providerUserId: string;
    email: string | null;
    emailVerified: boolean;
}

export interface Session {
    id: string;
    userId: string;
    expiresAt: Date;
    revokedAt: Date | null;
}

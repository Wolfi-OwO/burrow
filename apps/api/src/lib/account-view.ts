import type { PublicProfile, User } from '../models/user.model.ts';

/** The owner's own view of their account: no password hash, ever. */
export function toAccount(user: User): {
    id: string;
    username: string;
    displayName: string;
    bio: string;
    hasAvatar: boolean;
    hasPassword: boolean;
    role: string;
} {
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        bio: user.bio,
        hasAvatar: user.avatarSha256 !== null,
        hasPassword: user.passwordHash !== null,
        role: user.role,
    };
}

/** What anyone else may see (FR-019): no username, no emails, no linked providers. */
export function toPublicProfile(user: User): PublicProfile {
    return {
        id: user.id,
        displayName: user.displayName,
        bio: user.bio,
        hasAvatar: user.avatarSha256 !== null,
    };
}

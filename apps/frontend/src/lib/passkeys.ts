import {
    startAuthentication,
    startRegistration,
    browserSupportsWebAuthn,
} from '@simplewebauthn/browser';
import type {
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

import { api } from './api.ts';
import type { Account } from './types.ts';

export interface PasskeyInfo {
    id: string;
    name: string;
    createdAt: string;
    lastUsedAt: string | null;
    backedUp: boolean;
}

export const passkeysSupported = (): boolean => browserSupportsWebAuthn();

/** Asks the browser for a passkey and finishes the sign-in on the server. */
export async function signInWithPasskey(): Promise<{ accessToken: string; user: Account }> {
    const { ceremonyId, options } = await api<{
        ceremonyId: string;
        options: PublicKeyCredentialRequestOptionsJSON;
    }>('POST', '/api/auth/passkey/options', {});
    const response = await startAuthentication({ optionsJSON: options });
    return api('POST', '/api/auth/passkey/login', { ceremonyId, response });
}

/** Creates a passkey for the signed-in account. */
export async function addPasskey(name: string): Promise<PasskeyInfo> {
    const { ceremonyId, options } = await api<{
        ceremonyId: string;
        options: PublicKeyCredentialCreationOptionsJSON;
    }>('POST', '/api/auth/passkeys/register/options', {});
    const response = await startRegistration({ optionsJSON: options });
    return (
        await api<{ passkey: PasskeyInfo }>('POST', '/api/auth/passkeys/register', {
            ceremonyId,
            name,
            response,
        })
    ).passkey;
}

export const listPasskeys = async (): Promise<PasskeyInfo[]> =>
    (await api<{ passkeys: PasskeyInfo[] }>('GET', '/api/auth/passkeys')).passkeys;

export const removePasskey = (id: string): Promise<void> =>
    api<void>('DELETE', `/api/auth/passkeys/${id}`);

import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { config, validateConfig } from '../src/config/index.ts';

describe('storage configuration', () => {
    const original = { ...config.storage.s3 };
    afterEach(() => {
        Object.assign(config.storage.s3, original);
    });

    it('needs no object store: the local directory is the store of record', () => {
        Object.assign(config.storage.s3, {
            endpoint: undefined,
            bucket: undefined,
            accessKeyId: undefined,
            secretAccessKey: undefined,
        });
        assert.doesNotThrow(validateConfig);
    });

    it('accepts the optional S3 tier only when all four values are set', () => {
        Object.assign(config.storage.s3, {
            endpoint: 'https://s3.example',
            bucket: 'b',
            accessKeyId: undefined,
            secretAccessKey: undefined,
        });
        assert.throws(validateConfig, /must be set together/);
        Object.assign(config.storage.s3, { accessKeyId: 'id', secretAccessKey: 'secret' });
        assert.doesNotThrow(validateConfig);
    });
});

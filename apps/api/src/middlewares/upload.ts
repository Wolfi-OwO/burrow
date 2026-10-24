import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

import { config } from '../config/index.ts';

const stagingDir = join(config.storage.dir, 'tmp');
mkdirSync(stagingDir, { recursive: true });

/** Multipart overhead (boundaries, field headers) allowed on top of the file cap. */
const MULTIPART_SLACK = 64 * 1024;

function stage(maxBytes: number): RequestHandler {
    return multer({ dest: stagingDir, limits: { fileSize: maxBytes, files: 1, fields: 5 } }).single(
        'file',
    );
}

/**
 * FR-017: rejects an over-size upload from its Content-Length header before a single byte is read or
 * stored; multer's own limit then stops a client that lies about the length.
 */
function rejectOversize(maxBytes: number): RequestHandler {
    return function check(req: Request, res: Response, next: NextFunction): void {
        const length = Number(req.header('content-length'));
        if (Number.isFinite(length) && length > maxBytes + MULTIPART_SLACK) {
            res.status(413).json({
                error: 'PayloadTooLargeError',
                message: 'The file is larger than the upload limit.',
                statusCode: 413,
            });
            return;
        }
        next();
    };
}

/** Stages one file field called `file`, up to `MAX_UPLOAD_MB`. */
export const uploadFile: RequestHandler[] = [
    rejectOversize(config.maxUploadBytes),
    stage(config.maxUploadBytes),
];
/** Same for an avatar, with a much lower cap. */
export const uploadAvatar: RequestHandler[] = [
    rejectOversize(config.maxAvatarBytes),
    stage(config.maxAvatarBytes),
];

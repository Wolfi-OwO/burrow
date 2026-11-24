import { Router } from 'express';

import { config } from '../config/index.ts';

export const versionRouter = Router();

/**
 * Stamped into the image at build time; `dev` outside a real build. `/api/info` is the path every app of this stack
 * answers (name, version, revision, buildDate, repositoryUrl); `/api/version` stays for what already reads it.
 */
versionRouter.get(['/api/info', '/api/version'], (_req, res) => {
    res.json({
        ...config.buildInfo,
        ...(config.uploadOrigin ? { uploadOrigin: config.uploadOrigin } : {}),
    });
});

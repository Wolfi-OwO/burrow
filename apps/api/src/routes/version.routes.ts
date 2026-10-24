import { Router } from 'express';

import { config } from '../config/index.ts';

export const versionRouter = Router();

/** Stamped into the image at build time; `dev` outside a real build. */
versionRouter.get('/api/version', (_req, res) => {
    res.json(config.buildInfo);
});

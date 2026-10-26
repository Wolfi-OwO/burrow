import type { Request } from 'express';

import { asyncHandler, NotFoundError } from '../lib/errors.ts';
import { categoryRepository } from '../repository/category.repository.ts';
import { fileRepository } from '../repository/file.repository.ts';
import type { DuplicateMode } from '../services/duplicate-service.ts';
import { duplicateService } from '../services/duplicate-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;

export const list = asyncHandler(async (req, res) => {
    const { mode } = req.query as unknown as { mode: DuplicateMode };
    res.json({ groups: await duplicateService.groups(uid(req), mode) });
});

export const resolve = asyncHandler(async (req, res) => {
    const { keepId, removeIds } = req.body as { keepId: string; removeIds: string[] };
    res.json({ removed: await duplicateService.remove(uid(req), keepId, removeIds) });
});

export const clean = asyncHandler(async (req, res) => {
    const { mode } = req.body as { mode: DuplicateMode };
    res.json({ removed: await duplicateService.clean(uid(req), mode) });
});

export const ratingPreview = asyncHandler(async (req, res) => {
    res.json(await duplicateService.ratingPreview(uid(req)));
});

export const ratingFix = asyncHandler(async (req, res) => {
    res.json(await duplicateService.ratingFix(uid(req)));
});

/** "Re-sort this folder": the files go back to the sorter, which decides again. */
export const resort = asyncHandler(async (req, res) => {
    const { categoryId } = req.body as { categoryId: number };
    if (!(await categoryRepository.findById(uid(req), categoryId)))
        throw new NotFoundError('Category not found.');
    res.json({ queued: await fileRepository.requeueCategory(uid(req), categoryId) });
});

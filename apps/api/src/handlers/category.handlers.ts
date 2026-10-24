import type { Request } from 'express';

import { asyncHandler } from '../lib/errors.ts';
import { categoryService } from '../services/category-service.ts';

const uid = (req: Request): string => (req.user as { sub: string }).sub;
const id = (req: Request): number => Number(req.params.id);

export const tree = asyncHandler(async (req, res) => {
    res.json({ categories: await categoryService.tree(uid(req)) });
});

export const create = asyncHandler(async (req, res) => {
    const { name, parentId, publicPreview } = req.body as {
        name: string;
        parentId: number | null;
        publicPreview: boolean;
    };
    res.status(201).json(await categoryService.create(uid(req), parentId, name, publicPreview));
});

export const patch = asyncHandler(async (req, res) => {
    const { name, publicPreview } = req.body as { name?: string; publicPreview?: boolean };
    if (publicPreview !== undefined)
        await categoryService.setPublicPreview(uid(req), id(req), publicPreview);
    if (name !== undefined) await categoryService.rename(uid(req), id(req), name);
    res.json({ categories: await categoryService.tree(uid(req)) });
});

export const move = asyncHandler(async (req, res) => {
    const { parentId } = req.body as { parentId: number | null };
    await categoryService.move(uid(req), id(req), parentId);
    res.json({ categories: await categoryService.tree(uid(req)) });
});

export const remove = asyncHandler(async (req, res) => {
    const { onNonEmpty } = req.query as unknown as { onNonEmpty: 'block' | 'moveUp' };
    await categoryService.remove(uid(req), id(req), onNonEmpty);
    res.status(204).end();
});

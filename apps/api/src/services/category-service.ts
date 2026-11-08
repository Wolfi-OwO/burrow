import { getPool } from '../database/connection.ts';
import { BadRequestError, ConflictError, NotFoundError } from '../lib/errors.ts';
import type { Category, CategoryNode } from '../models/category.model.ts';
import { categoryRepository } from '../repository/category.repository.ts';

/** Postgres' unique-violation code. */
const UNIQUE_VIOLATION = '23505';

function mapDuplicate(error: unknown): never {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new ConflictError('A category with that name already exists here.');
    }
    throw error;
}

/** What removing folders took with it. */
export interface RemovedTree {
    /** Folders removed, the ones asked for and every folder below them. */
    categories: number;
    /** Files that moved up (to the parent of the removed folder, or Unsorted). None is deleted. */
    files: number;
}

export const categoryService = {
    /** @returns The user's whole tree in path order. */
    tree(userId: string): Promise<CategoryNode[]> {
        return categoryRepository.listTree(userId);
    },

    /**
     * Creates a category at any depth (FR-010).
     *
     * @throws {NotFoundError} When the parent is not the user's.
     * @throws {ConflictError} When a sibling has the same name.
     */
    async create(
        userId: string,
        parentId: number | null,
        name: string,
        publicPreview = false,
    ): Promise<Category> {
        if (parentId !== null && !(await categoryRepository.findById(userId, parentId)))
            throw new NotFoundError('Parent category not found.');
        try {
            return await getPool().transaction((tx) =>
                categoryRepository.create(userId, parentId, name, publicPreview, tx),
            );
        } catch (error) {
            return mapDuplicate(error);
        }
    },

    /** Renames a category at any depth (FR-011). */
    async rename(userId: string, id: number, name: string): Promise<Category> {
        try {
            const updated = await categoryRepository.rename(userId, id, name);
            if (!updated) throw new NotFoundError('Category not found.');
            return updated;
        } catch (error) {
            return mapDuplicate(error);
        }
    },

    async setPublicPreview(userId: string, id: number, value: boolean): Promise<void> {
        if (!(await categoryRepository.findById(userId, id)))
            throw new NotFoundError('Category not found.');
        await categoryRepository.setPublicPreview(userId, id, value);
    },

    /**
     * Moves a category and its whole subtree, atomically (FR-014).
     *
     * @throws {BadRequestError} When the target lies inside the moved subtree.
     */
    async move(userId: string, id: number, newParentId: number | null): Promise<Category> {
        try {
            const moved = await getPool().transaction((tx) =>
                categoryRepository.move(userId, id, newParentId, tx),
            );
            if (!moved) throw new NotFoundError('Category not found.');
            return moved;
        } catch (error) {
            if (error instanceof Error && error.message === 'INVALID_MOVE') {
                throw new BadRequestError(
                    'A category cannot be moved into itself or one of its own subcategories.',
                );
            }
            return mapDuplicate(error);
        }
    },

    /**
     * Deletes a category. A non-empty one needs a decision (FR-012): `block` refuses, `moveUp`
     * lifts its children and files one level up first.
     *
     * @throws {ConflictError} When it has content and the mode is `block`.
     */
    async remove(userId: string, id: number, onNonEmpty: 'block' | 'moveUp'): Promise<void> {
        const node = await categoryRepository.findById(userId, id);
        if (!node) throw new NotFoundError('Category not found.');

        await getPool().transaction(async (tx) => {
            const children = await categoryRepository.countChildren(userId, id, tx);
            const files = await categoryRepository.countFilesInSubtree(userId, id, tx);
            if (children + files > 0 && onNonEmpty === 'block') {
                throw new ConflictError(
                    'The category is not empty; choose to move its contents up or empty it first.',
                );
            }
            if (children > 0) {
                for (const child of await categoryRepository.listChildren(userId, id, tx)) {
                    await categoryRepository.move(userId, child.id, node.parentId, tx);
                }
            }
            await categoryRepository.refileFiles(userId, id, node.parentId, tx);
            await categoryRepository.remove(userId, id, tx);
        });
    },

    /**
     * Removes folders together with every folder below them, in one transaction. The files in them are not deleted:
     * they move up to the parent of the folder that was removed, or to Unsorted when that was a top-level folder.
     * Asking for a folder and one of its descendants in the same call is fine; the descendant goes with its folder.
     *
     * @throws {NotFoundError} When any id is not the user's (nothing is removed then).
     */
    async removeTree(userId: string, ids: number[]): Promise<RemovedTree> {
        const all = await categoryRepository.listAll(userId);
        const byId = new Map(all.map((c) => [c.id, c]));
        const asked = [...new Set(ids)];
        for (const id of asked) if (!byId.has(id)) throw new NotFoundError('Category not found.');
        // Only the topmost of the folders asked for matter; the rest are inside one of them.
        const tops = asked
            .map((id) => byId.get(id) as Category)
            .filter(
                (c) =>
                    !asked.some((other) => {
                        const parent = byId.get(other) as Category;
                        return other !== c.id && c.path.startsWith(`${parent.path}.`);
                    }),
            );

        const result: RemovedTree = { categories: 0, files: 0 };
        await getPool().transaction(async (tx) => {
            for (const top of tops) {
                result.files += await categoryRepository.refileSubtree(
                    userId,
                    top.id,
                    top.parentId,
                    tx,
                );
                for (const id of await categoryRepository.subtreeIdsDeepestFirst(
                    userId,
                    top.id,
                    tx,
                )) {
                    if (await categoryRepository.remove(userId, id, tx)) result.categories += 1;
                }
            }
        });
        return result;
    },
};

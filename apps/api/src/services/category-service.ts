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
};

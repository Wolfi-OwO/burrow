import { useMutation } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import type { ReactNode } from 'react';

import { api } from '../lib/api.ts';
import { Dialog, Spinner, useToast } from './ui.tsx';

/** Asks before unpacking archives that are already in the drive: their contents are saved and the zips are removed. */
export function UnzipDialog({ ids, onClose }: { ids: string[]; onClose: () => void }): ReactNode {
    const toast = useToast();
    const run = useMutation({
        mutationFn: () => api<{ job: string; count: number }>('POST', '/api/files/unzip', { ids }),
        onSuccess: (r) => {
            onClose();
            toast.say(
                r.count === 0
                    ? 'No archives to unpack.'
                    : `Unpacking ${String(r.count)} archive${r.count === 1 ? '' : 's'} in the background.`,
            );
        },
        onError: (e: Error) => toast.say(e.message),
    });
    return (
        <Dialog
            title={`Unzip ${String(ids.length)} archive${ids.length === 1 ? '' : 's'}?`}
            onClose={onClose}
        >
            <p>
                The files inside are saved in the same folder as the zip, zips inside zips are
                unpacked too, and each zip that was unpacked is removed from the drive. You get a
                notification when it is done.
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn ghost" onClick={onClose}>
                    Cancel
                </button>
                <button className="btn" disabled={run.isPending} onClick={() => run.mutate()}>
                    {run.isPending ? <Spinner /> : <FolderOpen size={16} />}
                    Unzip and remove the zip
                </button>
            </div>
        </Dialog>
    );
}

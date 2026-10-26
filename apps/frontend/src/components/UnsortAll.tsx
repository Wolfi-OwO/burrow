import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '../lib/api.ts';
import { Dialog, Spinner, useToast } from './ui.tsx';

/** Puts every file back into Unsorted and in the sorter's queue; the folders stay. Asks first, because it undoes all filing. */
export function UnsortAll(): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const [asking, setAsking] = useState(false);
    const run = useMutation({
        mutationFn: () => api<{ queued: number }>('POST', '/api/sorting/unsort-all'),
        onSuccess: (r) => {
            setAsking(false);
            for (const key of ['files', 'tree', 'review', 'sorting', 'ratings'])
                void client.invalidateQueries({ queryKey: [key] });
            toast.say(
                `${String(r.queued)} file${r.queued === 1 ? '' : 's'} are unsorted. Press Sort all now to file them again.`,
            );
        },
        onError: (e: Error) => toast.say(e.message),
    });
    return (
        <>
            <button className="btn ghost" onClick={() => setAsking(true)}>
                <RotateCcw size={16} />
                Unsort everything
            </button>
            {asking ? (
                <Dialog title="Unsort everything?" onClose={() => setAsking(false)}>
                    <p>
                        Every file goes back to Unsorted, including the ones you filed by hand, and
                        the sorter will decide again. Your folders stay as they are.
                    </p>
                    <div className="row" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn ghost" onClick={() => setAsking(false)}>
                            Cancel
                        </button>
                        <button
                            className="btn danger"
                            disabled={run.isPending}
                            onClick={() => run.mutate()}
                        >
                            {run.isPending ? <Spinner /> : null}
                            Unsort everything
                        </button>
                    </div>
                </Dialog>
            ) : null}
        </>
    );
}

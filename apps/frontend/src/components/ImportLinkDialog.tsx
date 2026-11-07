import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';

import { useUploads } from '../lib/uploads.tsx';
import { Dialog } from './ui.tsx';

/** Has the server download a file from a link, so how fast the file leaves your own connection does not matter. */
export function ImportLinkDialog({
    folder,
    onClose,
}: {
    folder?: number;
    onClose: () => void;
}): ReactNode {
    const { importLink } = useUploads();
    const [url, setUrl] = useState('');
    const valid = /^https?:\/\/\S+$/i.test(url.trim());
    const submit = (event: FormEvent): void => {
        event.preventDefault();
        if (!valid) return;
        void importLink(url.trim(), folder);
        onClose();
    };
    return (
        <Dialog title="Import from a link" onClose={onClose}>
            <form onSubmit={submit} className="field">
                <p className="muted small" style={{ margin: '0 0 10px' }}>
                    The server downloads the file itself, so your own upload speed does not matter.
                    Use a direct download link; a zip is unpacked like an uploaded one. A page that
                    only shows a download button (a Google Drive or Dropbox share page) will not
                    work; Dropbox links work with <code>dl=1</code> at the end. Links to private or
                    internal addresses are refused.
                </p>
                <label htmlFor="import-url">Link</label>
                <input
                    id="import-url"
                    className="input"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    placeholder="https://example.com/photos.zip"
                    maxLength={2000}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                />
                <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                    <button type="button" className="btn ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="submit" className="btn" disabled={!valid}>
                        Import
                    </button>
                </div>
            </form>
        </Dialog>
    );
}

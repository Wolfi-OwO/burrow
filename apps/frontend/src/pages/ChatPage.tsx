import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowUp,
    BookOpenCheck,
    Check,
    FolderPlus,
    Info,
    Minus,
    Sparkles,
    Trash2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { useToast } from '../components/ui.tsx';
import { api, request } from '../lib/api.ts';
import type { ChatAction, ChatMessage } from '../lib/types.ts';

interface ChatState {
    enabled: boolean;
    ready: boolean;
    messages: ChatMessage[];
}

/** What is being written right now: the text so far, the cards that appeared, or a place in the queue. */
interface Draft {
    text: string;
    actions: ChatAction[];
    queued: number;
}

const SUGGESTIONS = [
    'Make folders for my holidays: Italy, Austria and Spain, all inside Travel.',
    'Cats is for pictures of my orange cat Luna, she sleeps on the sofa a lot.',
    'What can you do?',
];

const ICON = { done: Check, exists: Minus, skipped: Info } as const;

function ActionCard({ action, index }: { action: ChatAction; index: number }): ReactNode {
    const Icon = ICON[action.status];
    const Kind = action.type === 'create_category' ? FolderPlus : BookOpenCheck;
    return (
        <li
            className={`chat-card ${action.status}`}
            style={{ animationDelay: `${String(index * 90)}ms` }}
        >
            <span className="chat-card-icon" aria-hidden="true">
                <Icon size={15} strokeWidth={2.4} />
            </span>
            <span className="chat-card-text">
                <b>
                    <Kind size={13} aria-hidden="true" />
                    {action.type === 'create_category'
                        ? action.status === 'done'
                            ? 'Folder made'
                            : action.status === 'exists'
                              ? 'Folder exists'
                              : 'Not made'
                        : action.status === 'done'
                          ? 'Sorter taught'
                          : action.status === 'exists'
                            ? 'Already known'
                            : 'Not taught'}
                </b>
                <span>{action.label}</span>
                {action.detail ? <small>{action.detail}</small> : null}
            </span>
        </li>
    );
}

function Bubble({
    message,
}: {
    message: Pick<ChatMessage, 'role' | 'content' | 'actions'>;
}): ReactNode {
    return (
        <div className={`chat-row ${message.role}`}>
            {message.role === 'assistant' ? (
                <span className="chat-avatar" aria-hidden="true">
                    <Sparkles size={16} />
                </span>
            ) : null}
            <div className="chat-stack">
                <p className="chat-bubble">{message.content}</p>
                {message.actions.length > 0 ? (
                    <ul className="chat-cards" aria-label="What I did">
                        {message.actions.map((a, i) => (
                            <ActionCard
                                key={`${a.type}-${a.label}-${String(i)}`}
                                action={a}
                                index={i}
                            />
                        ))}
                    </ul>
                ) : null}
            </div>
        </div>
    );
}

export function ChatPage(): ReactNode {
    const client = useQueryClient();
    const toast = useToast();
    const state = useQuery({
        queryKey: ['chat'],
        queryFn: () => api<ChatState>('GET', '/api/chat'),
        refetchInterval: 20_000,
    });
    const [text, setText] = useState('');
    const [sentText, setSentText] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const end = useRef<HTMLDivElement>(null);
    const field = useRef<HTMLTextAreaElement>(null);
    const busy = draft !== null;

    useEffect(() => {
        end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }, [state.data?.messages.length, draft?.text, draft?.actions.length, draft?.queued, sentText]);

    // The box grows with what is typed, up to a few lines.
    useEffect(() => {
        const box = field.current;
        if (!box) return;
        box.style.height = 'auto';
        box.style.height = `${String(Math.min(box.scrollHeight, 160))}px`;
    }, [text]);

    const send = async (raw: string): Promise<void> => {
        const message = raw.trim();
        if (message === '' || busy) return;
        setText('');
        setSentText(message);
        setDraft({ text: '', actions: [], queued: 0 });
        let created = false;
        try {
            const response = await request('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message }),
            });
            if (!response.ok || !response.body) {
                const problem = (await response.json().catch(() => null)) as {
                    message?: string;
                    error?: string;
                } | null;
                throw new Error(
                    problem?.message ?? problem?.error ?? 'The assistant could not answer.',
                );
            }
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let cut = buffer.indexOf('\n\n');
                while (cut !== -1) {
                    const block = buffer.slice(0, cut);
                    buffer = buffer.slice(cut + 2);
                    cut = buffer.indexOf('\n\n');
                    const event = /^event: (.*)$/m.exec(block)?.[1];
                    const data = JSON.parse(/^data: (.*)$/m.exec(block)?.[1] ?? '{}') as {
                        text?: string;
                        position?: number;
                        action?: ChatAction;
                        message?: string;
                    };
                    if (event === 'queued')
                        setDraft((d) => d && { ...d, queued: data.position ?? 1 });
                    else if (event === 'delta')
                        setDraft((d) => d && { ...d, queued: 0, text: d.text + (data.text ?? '') });
                    else if (event === 'action' && data.action) {
                        const action = data.action;
                        if (action.status === 'done') created = true;
                        setDraft((d) => d && { ...d, actions: [...d.actions, action] });
                    } else if (event === 'failed')
                        throw new Error(data.message ?? 'The assistant could not answer.');
                }
            }
        } catch (error) {
            toast.say(error instanceof Error ? error.message : 'The assistant could not answer.');
        } finally {
            await client.invalidateQueries({ queryKey: ['chat'] });
            setDraft(null);
            setSentText(null);
            if (created)
                for (const key of ['tree', 'files', 'sorting'])
                    void client.invalidateQueries({ queryKey: [key] });
            field.current?.focus();
        }
    };

    const onKey = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send(text);
        }
    };

    const clear = async (): Promise<void> => {
        await api('DELETE', '/api/chat');
        await client.invalidateQueries({ queryKey: ['chat'] });
    };

    const messages = state.data?.messages ?? [];
    const offline = state.data !== undefined && (!state.data.enabled || !state.data.ready);

    return (
        <>
            <header className="page-head">
                <div>
                    <p className="kicker">Talk it through</p>
                    <h1>Assistant</h1>
                    <p className="chat-intro">
                        Tell it how your pictures should be organised. It makes the folders and
                        teaches the sorter what goes in them. It runs on this server; nothing you
                        write leaves it.
                    </p>
                </div>
                {messages.length > 0 ? (
                    <button className="btn sm ghost" onClick={() => void clear()} disabled={busy}>
                        <Trash2 size={15} />
                        Clear chat
                    </button>
                ) : null}
            </header>

            <section className="chat" aria-label="Conversation with the assistant">
                {offline ? (
                    <p className="chip warn chat-offline" role="status">
                        {state.data?.enabled
                            ? 'The assistant is starting or not answering. Messages will work again in a moment.'
                            : 'The assistant is not set up on this server.'}
                    </p>
                ) : null}

                <div
                    className="chat-log"
                    role="log"
                    aria-live="polite"
                    aria-relevant="additions text"
                >
                    {messages.length === 0 && !busy ? (
                        <div className="chat-empty">
                            <span className="chat-orb" aria-hidden="true">
                                <Sparkles size={26} />
                            </span>
                            <h2>What should your drive look like?</h2>
                            <p className="muted">Try one of these, or write your own.</p>
                            <div className="chat-suggest">
                                {SUGGESTIONS.map((s, i) => (
                                    <button
                                        key={s}
                                        className="chat-suggestion"
                                        style={{ animationDelay: `${String(120 + i * 90)}ms` }}
                                        disabled={offline}
                                        onClick={() => void send(s)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {messages.map((m) => (
                        <Bubble key={m.id} message={m} />
                    ))}

                    {sentText !== null ? (
                        <Bubble message={{ role: 'user', content: sentText, actions: [] }} />
                    ) : null}
                    {draft ? (
                        <div className="chat-row assistant">
                            <span className="chat-avatar thinking" aria-hidden="true">
                                <Sparkles size={16} />
                            </span>
                            <div className="chat-stack">
                                {draft.text === '' ? (
                                    <p className="chat-bubble chat-wait" role="status">
                                        <span className="chat-dots" aria-hidden="true">
                                            <i />
                                            <i />
                                            <i />
                                        </span>
                                        <span className="muted small">
                                            {draft.queued > 0
                                                ? `${String(draft.queued)} ahead of you, one moment`
                                                : 'Thinking'}
                                        </span>
                                    </p>
                                ) : (
                                    <p className="chat-bubble streaming">{draft.text}</p>
                                )}
                                {draft.actions.length > 0 ? (
                                    <ul className="chat-cards" aria-label="What I did">
                                        {draft.actions.map((a, i) => (
                                            <ActionCard
                                                key={`${a.label}-${String(i)}`}
                                                action={a}
                                                index={0}
                                            />
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        </div>
                    ) : null}
                    <div ref={end} />
                </div>

                <form
                    className="chat-compose"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void send(text);
                    }}
                >
                    <label className="sr" htmlFor="chat-input">
                        Message to the assistant
                    </label>
                    <textarea
                        id="chat-input"
                        ref={field}
                        className="chat-input"
                        rows={1}
                        maxLength={1500}
                        placeholder="Make a folder for ..."
                        value={text}
                        disabled={offline}
                        onChange={(event) => setText(event.target.value)}
                        onKeyDown={onKey}
                    />
                    <button
                        className="chat-send"
                        type="submit"
                        aria-label="Send"
                        disabled={busy || offline || text.trim() === ''}
                    >
                        <ArrowUp size={18} strokeWidth={2.4} />
                    </button>
                </form>
            </section>
        </>
    );
}

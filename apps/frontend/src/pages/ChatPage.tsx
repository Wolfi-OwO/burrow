import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    ArrowUp,
    BookOpenCheck,
    Check,
    Eraser,
    FileText,
    FolderMinus,
    FolderPlus,
    Info,
    Minus,
    Sparkles,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { Lightbox } from '../components/Lightbox.tsx';
import { Spinner, useToast } from '../components/ui.tsx';
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

const ICON = { done: Check, exists: Minus, skipped: Info, pending: Info, declined: X } as const;

const KIND = {
    create_category: { icon: FolderPlus, titles: ['Folder made', 'Folder exists', 'Not made'] },
    rename_category: { icon: FolderPlus, titles: ['Folder renamed', 'Same name', 'Not renamed'] },
    add_hint: { icon: BookOpenCheck, titles: ['Sorter taught', 'Already known', 'Not taught'] },
    unsort_category: { icon: Undo2, titles: ['Folder unsorted', '', 'Not unsorted'] },
    unsort_all: { icon: Undo2, titles: ['Everything unsorted', '', 'Not unsorted'] },
    remove_category: { icon: FolderMinus, titles: ['Folder removed', '', 'Not removed'] },
    remove_all_categories: { icon: Eraser, titles: ['Folders removed', '', 'Not removed'] },
    create_file: { icon: FileText, titles: ['File written', '', 'Not written'] },
} as const;

type Answer = (messageId: number, index: number, decision: 'confirm' | 'decline') => Promise<void>;

function ActionCard({
    action,
    index,
    messageId,
    onAnswer,
    onOpen,
}: {
    action: ChatAction;
    index: number;
    messageId?: number;
    onAnswer?: Answer;
    onOpen?: (action: ChatAction) => void;
}): ReactNode {
    const [busy, setBusy] = useState(false);
    const Icon = ICON[action.status];
    const kind = KIND[action.type];
    const Kind = kind.icon;
    const title =
        action.status === 'pending'
            ? 'Waiting for your yes'
            : action.status === 'declined'
              ? 'Left as it was'
              : action.status === 'done'
                ? kind.titles[0]
                : action.status === 'exists'
                  ? kind.titles[1] || 'Already so'
                  : kind.titles[2];
    const answer = (decision: 'confirm' | 'decline'): void => {
        if (messageId === undefined || !onAnswer) return;
        setBusy(true);
        void onAnswer(messageId, index, decision).finally(() => setBusy(false));
    };
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
                    {title}
                </b>
                <span>{action.label}</span>
                {action.detail ? <small>{action.detail}</small> : null}
                {action.status === 'pending' && messageId !== undefined ? (
                    <span className="chat-card-buttons">
                        <button
                            className="btn sm danger"
                            disabled={busy}
                            onClick={() => answer('confirm')}
                        >
                            {busy ? <Spinner /> : <Check size={14} />}
                            Do it
                        </button>
                        <button
                            className="btn sm ghost"
                            disabled={busy}
                            onClick={() => answer('decline')}
                        >
                            Keep as it is
                        </button>
                    </span>
                ) : null}
                {action.status === 'done' && action.type === 'create_file' && action.fileId ? (
                    <button
                        className="btn sm ghost chat-card-open"
                        onClick={() => onOpen?.(action)}
                    >
                        Open
                    </button>
                ) : null}
            </span>
        </li>
    );
}

function Bubble({
    message,
    onAnswer,
    onOpen,
}: {
    message: Pick<ChatMessage, 'role' | 'content' | 'actions'> & { id?: number };
    onAnswer?: Answer;
    onOpen?: (action: ChatAction) => void;
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
                                {...(message.id !== undefined ? { messageId: message.id } : {})}
                                {...(onAnswer ? { onAnswer } : {})}
                                {...(onOpen ? { onOpen } : {})}
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
    const [text, setText] = useState('');
    const [sentText, setSentText] = useState<string | null>(null);
    // The newest saved message when the person pressed send: anything newer from them is the message just sent.
    const [baseId, setBaseId] = useState(0);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [opened, setOpened] = useState<ChatAction | null>(null);
    const end = useRef<HTMLDivElement>(null);
    const field = useRef<HTMLTextAreaElement>(null);
    const busy = draft !== null;
    const state = useQuery({
        queryKey: ['chat'],
        queryFn: () => api<ChatState>('GET', '/api/chat'),
        // Not while an answer is being made: the server already saved the question, and showing that copy next to
        // the page's own would put the message on screen twice.
        refetchInterval: busy ? false : 20_000,
    });

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
        setBaseId(Math.max(0, ...(state.data?.messages ?? []).map((m) => m.id)));
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

    const answer: Answer = async (messageId, index, decision) => {
        try {
            await api('POST', `/api/chat/messages/${String(messageId)}/actions/${String(index)}`, {
                decision,
            });
            await client.invalidateQueries({ queryKey: ['chat'] });
            if (decision === 'confirm')
                for (const key of ['tree', 'files', 'sorting', 'review', 'types'])
                    void client.invalidateQueries({ queryKey: [key] });
        } catch (error) {
            toast.say(error instanceof Error ? error.message : 'Could not do that.');
        }
    };

    const clear = async (): Promise<void> => {
        await api('DELETE', '/api/chat');
        await client.invalidateQueries({ queryKey: ['chat'] });
    };

    const messages = state.data?.messages ?? [];
    const offline = state.data !== undefined && (!state.data.enabled || !state.data.ready);

    return (
        <div className="chat-page">
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
                        <Bubble key={m.id} message={m} onAnswer={answer} onOpen={setOpened} />
                    ))}

                    {sentText !== null &&
                    !messages.some((m) => m.role === 'user' && m.id > baseId) ? (
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
                        title="Send"
                        disabled={busy || offline || text.trim() === ''}
                    >
                        <ArrowUp size={18} strokeWidth={2.4} />
                    </button>
                </form>
            </section>
            {opened?.fileId ? (
                <Lightbox
                    name={opened.label}
                    mime={opened.mime ?? 'text/plain'}
                    path={`/api/files/${opened.fileId}/content`}
                    onClose={() => setOpened(null)}
                />
            ) : null}
        </div>
    );
}

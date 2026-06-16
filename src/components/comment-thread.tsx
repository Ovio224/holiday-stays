"use client";

// CommentThread — a Notion-style discussion under an accommodation, so the group
// can say WHY they're leaning yes/no instead of just casting a silent vote. Each
// comment shows its author (initials in their color), that author's CURRENT vote
// as a small sentiment chip, a relative timestamp, and the body. You can edit or
// delete your own comments inline. Posting is optimistic (the server returns the
// row, which we show immediately) and reconciles via the same realtime
// subscription that streams votes/prices — so everyone's threads update live.
//
// Rendered both in the card's right pane (variant="card", a bounded scroll area)
// and in the full detail dialog (variant="dialog"). Both instances mutate the same
// accommodation through the same Server Actions, so they stay perfectly in sync.

import * as React from "react";
import { MessageSquare, Pencil, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { addComment, deleteComment, updateComment } from "@/actions/comments";
import { initials, formatRelativeTime } from "@/lib/format";
import { MAX_COMMENT_LENGTH } from "@/lib/comments";
import type { AccommodationComment, Member, Vote } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface CommentThreadProps {
  accommodationId: string;
  comments: AccommodationComment[];
  members: Member[];
  /** This accommodation's votes — used to tag each author with their leaning. */
  votes: Vote[];
  currentMemberId: string | null;
  /** "card" caps the list height with its own scroll; "dialog" lets it flow. */
  variant?: "card" | "dialog";
}

/** A deterministic UTC "Jun 16" used pre-mount (before the clock-based relative
 *  time is available) so server + client render the same string — no hydration
 *  mismatch from reading Date.now() during render. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function shortDateUTC(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export function CommentThread({
  accommodationId,
  comments,
  members,
  votes,
  currentMemberId,
  variant = "card",
}: CommentThreadProps) {
  // Member directory + each member's current vote (true = yes, false = no).
  const byId = React.useMemo(
    () => new Map(members.map((m) => [m.id, m] as const)),
    [members],
  );
  const voteByMember = React.useMemo(() => {
    const map = new Map<string, boolean>();
    for (const v of votes) map.set(v.member_id, v.value);
    return map;
  }, [votes]);

  // Optimistic overlays on top of the realtime `comments` base: rows we just
  // posted (server-returned, so they carry real ids), ids we just removed, and
  // bodies we just edited. The merge below is self-correcting — it dedupes by id,
  // filters removed ids, and lets edits win — so once realtime echoes the same
  // change the overlay simply coincides with the base; no pruning effect needed.
  const [extra, setExtra] = React.useState<AccommodationComment[]>([]);
  const [removed, setRemoved] = React.useState<Set<string>>(new Set());
  const [edits, setEdits] = React.useState<Map<string, AccommodationComment>>(
    new Map(),
  );

  const merged = React.useMemo(() => {
    const map = new Map<string, AccommodationComment>();
    for (const c of comments) map.set(c.id, c);
    for (const c of extra) map.set(c.id, c);
    for (const [id, c] of edits) if (map.has(id)) map.set(id, c);
    return [...map.values()]
      .filter((c) => !removed.has(c.id))
      .sort(
        (a, b) =>
          a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
      );
  }, [comments, extra, edits, removed]);

  // Clock-driven relative time, set after mount + ticking each minute. Null until
  // mounted so SSR/first paint use the deterministic absolute date instead (the
  // initial read is deferred to an animation frame so we never set state
  // synchronously inside the effect body).
  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => {
    const raf = requestAnimationFrame(() => setNowMs(Date.now()));
    const t = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  const when = React.useCallback(
    (iso: string) => (nowMs == null ? shortDateUTC(iso) : formatRelativeTime(iso, nowMs)),
    [nowMs],
  );

  const [isPending, startTransition] = React.useTransition();

  function handleAdd(body: string) {
    if (!currentMemberId) {
      toast.error("Pick your name first");
      return;
    }
    startTransition(async () => {
      try {
        const row = await addComment({ accommodationId, memberId: currentMemberId, body });
        setExtra((prev) => [...prev, row]);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't post your comment — try again",
        );
        throw error; // let the composer keep the draft on failure
      }
    });
  }

  function handleSaveEdit(id: string, body: string) {
    startTransition(async () => {
      try {
        const row = await updateComment({ id, body });
        setEdits((prev) => new Map(prev).set(id, row));
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Couldn't save your edit — try again",
        );
        throw error;
      }
    });
  }

  function handleDelete(id: string) {
    setRemoved((prev) => new Set(prev).add(id));
    startTransition(async () => {
      try {
        await deleteComment({ id });
      } catch (error) {
        // Roll the optimistic removal back so the comment never silently vanishes.
        setRemoved((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast.error(
          error instanceof Error ? error.message : "Couldn't delete that comment — try again",
        );
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">
          <MessageSquare className="size-3.5" aria-hidden />
          Discussion
        </span>
        {merged.length > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
            {merged.length}
          </span>
        )}
      </div>

      {merged.length > 0 ? (
        <ul
          className={cn(
            "flex flex-col gap-3 pr-0.5",
            variant === "card" && "max-h-72 overflow-y-auto",
          )}
        >
          {merged.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              author={byId.get(comment.member_id) ?? null}
              leaning={voteByMember.get(comment.member_id) ?? null}
              when={when(comment.updated_at)}
              isMine={comment.member_id === currentMemberId}
              busy={isPending}
              onSave={(body) => handleSaveEdit(comment.id, body)}
              onDelete={() => handleDelete(comment.id)}
            />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          No comments yet — say why this place is a yes or a no.
        </p>
      )}

      {currentMemberId ? (
        <Composer
          author={byId.get(currentMemberId) ?? null}
          busy={isPending}
          onSubmit={handleAdd}
        />
      ) : (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          Pick your name to join the discussion.
        </p>
      )}
    </section>
  );
}

/** A round initials avatar in the member's personal color. */
function Avatar({ member, className }: { member: Member | null; className?: string }) {
  return (
    <span
      title={member?.name}
      style={member ? { backgroundColor: member.color } : undefined}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[0.65rem] font-semibold text-white select-none",
        !member && "bg-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {member ? initials(member.name) : "?"}
    </span>
  );
}

/** A tiny yes/no chip echoing how this author voted on the card. */
function LeaningChip({ leaning }: { leaning: boolean | null }) {
  if (leaning == null) return null;
  return leaning ? (
    <span
      className="inline-flex items-center gap-0.5 text-[0.7rem] font-semibold text-yes"
      title="Voted yes"
    >
      <ThumbsUp className="size-3" aria-hidden />
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-0.5 text-[0.7rem] font-semibold text-foreground"
      title="Voted no"
    >
      <ThumbsDown className="size-3" aria-hidden />
    </span>
  );
}

function CommentRow({
  comment,
  author,
  leaning,
  when,
  isMine,
  busy,
  onSave,
  onDelete,
}: {
  comment: AccommodationComment;
  author: Member | null;
  leaning: boolean | null;
  when: string;
  isMine: boolean;
  busy: boolean;
  onSave: (body: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const edited = comment.updated_at !== comment.created_at;

  if (editing) {
    return (
      <li className="flex gap-2.5">
        <Avatar member={author} />
        <div className="min-w-0 flex-1">
          <CommentEditor
            initial={comment.body}
            busy={busy}
            submitLabel="Save"
            onSubmit={(body) => {
              onSave(body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </li>
    );
  }

  return (
    <li className="group/comment flex gap-2.5">
      <Avatar member={author} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-foreground">
            {author?.name ?? "Someone"}
          </span>
          <LeaningChip leaning={leaning} />
          <span className="text-xs text-muted-foreground">·</span>
          <span className="shrink-0 text-xs text-muted-foreground" title={comment.created_at}>
            {when}
            {edited && " · edited"}
          </span>

          {isMine && (
            <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100">
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Edit comment"
                onClick={() => setEditing(true)}
              >
                <Pencil className="size-3" aria-hidden />
              </Button>
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                aria-label="Delete comment"
                disabled={busy}
                onClick={onDelete}
              >
                <Trash2 className="size-3" aria-hidden />
              </Button>
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm leading-relaxed whitespace-pre-line break-words text-foreground/90">
          {comment.body}
        </p>
      </div>
    </li>
  );
}

/** The new-comment composer: an avatar + auto-growing textarea + submit. */
function Composer({
  author,
  busy,
  onSubmit,
}: {
  author: Member | null;
  busy: boolean;
  onSubmit: (body: string) => void;
}) {
  const [draft, setDraft] = React.useState("");

  function submit() {
    const body = draft.trim();
    if (!body || busy) return;
    // Clear eagerly for snappy feel; handleAdd re-throws on failure so we restore.
    setDraft("");
    try {
      onSubmit(body);
    } catch {
      setDraft(body);
    }
  }

  return (
    <div className="flex gap-2.5">
      <Avatar member={author} />
      <div className="min-w-0 flex-1">
        <AutoTextarea
          value={draft}
          onChange={setDraft}
          onSubmitShortcut={submit}
          placeholder="Add a comment… say why you're a yes or no"
          ariaLabel="Add a comment"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[0.7rem] text-muted-foreground">
            <kbd className="rounded border border-border bg-muted px-1 font-sans">⌘</kbd>
            <kbd className="rounded border border-border bg-muted px-1 font-sans">↵</kbd>{" "}
            to post
          </span>
          <Button
            type="button"
            size="sm"
            onClick={submit}
            disabled={busy || draft.trim().length === 0}
          >
            Comment
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Inline editor reused for editing an existing comment. */
function CommentEditor({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  busy: boolean;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  const dirty = draft.trim() !== initial.trim();

  return (
    <div className="flex flex-col gap-1.5">
      <AutoTextarea
        value={draft}
        onChange={setDraft}
        onSubmitShortcut={() => dirty && draft.trim() && onSubmit(draft.trim())}
        onEscape={onCancel}
        autoFocus
        ariaLabel="Edit comment"
      />
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          onClick={() => onSubmit(draft.trim())}
          disabled={busy || !dirty || draft.trim().length === 0}
        >
          {submitLabel}
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Cancel" onClick={onCancel}>
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/** A textarea that grows with its content (1 → ~6 rows) and fires submit/escape
 *  shortcuts. Kept local so both the composer and the inline editor share it. */
function AutoTextarea({
  value,
  onChange,
  onSubmitShortcut,
  onEscape,
  placeholder,
  ariaLabel,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmitShortcut: () => void;
  onEscape?: () => void;
  placeholder?: string;
  ariaLabel: string;
  autoFocus?: boolean;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  // Resize to fit content, capped so a long comment scrolls instead of growing
  // without bound. Runs on every value change.
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onSubmitShortcut();
        } else if (e.key === "Escape" && onEscape) {
          e.preventDefault();
          onEscape();
        }
      }}
      rows={1}
      maxLength={MAX_COMMENT_LENGTH}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    />
  );
}

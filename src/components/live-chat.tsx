"use client";

/**
 * Floating live-chat widget (bottom-right). Owns all UI state and the single
 * EventSource per active session. Visitor identity + open-state live ONLY in
 * component memory (no persistence): a full page refresh deliberately starts a
 * fresh conversation. Attachments are on by default; the paperclip is hidden
 * only when NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED === "false" (the server
 * re-checks the same flag).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  X,
  Send,
  Paperclip,
  Download,
  FileText,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useI18n } from "@/lib/use-i18n";
import type { ChatMessageDto, ChatSessionDto, ChatAttachmentDto } from "@/lib/chat/types";

/** Envelope-aware JSON helper: unwraps `{ ok, data }` or throws on `{ error }`. */
async function parseEnvelope(res: Response): Promise<any> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(body?.error?.message || "Request failed");
  }
  return body?.data ?? body;
}

/** Merge incoming into existing by id (dedupe) then sort ascending by createdAt. */
function mergeMessages(existing: ChatMessageDto[], incoming: ChatMessageDto[]): ChatMessageDto[] {
  const byId = new Map<string, ChatMessageDto>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

/** Human-readable byte size label. */
function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

interface ChatAttachmentProps {
  attachment: ChatAttachmentDto;
  messageId: string;
  visitorId: string;
  direction: "visitor" | "support";
  downloadLabel: string;
}

/** Renders one message attachment from its metadata; never embeds bytes. */
function ChatAttachment({ attachment, messageId, visitorId, direction, downloadLabel }: ChatAttachmentProps) {
  const base = `/api/chat/attachments/${messageId}?visitorId=${encodeURIComponent(visitorId)}`;
  if (attachment.type === "image") {
    return (
      <a href={base} target="_blank" rel="noreferrer">
        <img
          src={base}
          alt={attachment.name}
          loading="lazy"
          className="max-w-full max-h-56 rounded-lg object-contain bg-black/20"
        />
      </a>
    );
  }
  if (attachment.type === "video") {
    return <video src={base} controls className="max-w-full max-h-56 rounded-lg bg-black/20" />;
  }
  if (attachment.type === "audio" || attachment.type === "voice") {
    return <audio src={base} controls className="max-w-full" />;
  }
  const tint =
    direction === "visitor"
      ? "bg-black/20 hover:bg-black/30"
      : "bg-black/30 hover:bg-black/40";
  return (
    <a
      href={`${base}&download=1`}
      download={attachment.name}
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors ${tint}`}
      title={downloadLabel}
    >
      <FileText size={18} className="shrink-0" />
      <span className="flex flex-col min-w-0">
        <span className="truncate text-xs font-medium">{attachment.name}</span>
        <span className="text-[10px] opacity-70">{formatBytes(attachment.size)}</span>
      </span>
      <Download size={16} className="ml-auto shrink-0" />
    </a>
  );
}

export default function LiveChat() {
  const { t } = useI18n();

  const [isOpen, setIsOpen] = useState(false);
  const [hasAnimation, setHasAnimation] = useState(false);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [session, setSession] = useState<ChatSessionDto | null>(null);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [showForm, setShowForm] = useState(true);
  const [status, setStatus] = useState<"idle" | "sending" | "error" | "connecting">("idle");
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [showCloseModal, setShowCloseModal] = useState(false);
  // Server-side availability (round-robin registry). Starts true so the bubble
  // shows immediately; the config probe hides it only when no group can receive.
  const [serverEnabled, setServerEnabled] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const sessionRef = useRef<ChatSessionDto | null>(session);
  const visitorIdRef = useRef<string>("");
  const nameRef = useRef(name);
  const emailRef = useRef(email);

  useEffect(() => {
    nameRef.current = name;
    emailRef.current = email;
  }, [name, email]);

  const enabled = process.env.NEXT_PUBLIC_LIVE_CHAT_ENABLED !== "false";
  const attachmentsEnabled = process.env.NEXT_PUBLIC_LIVE_CHAT_ATTACHMENTS_ENABLED !== "false";
  const greeting = process.env.NEXT_PUBLIC_LIVE_CHAT_GREETING || t("chat.greeting");

  // Probe live availability once (registry may report chat disabled when no
  // support group is active). Best-effort: a failed probe leaves the bubble on.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chat/config", { signal: AbortSignal.timeout(8000) });
        const data = res.ok ? await res.json() : null;
        if (!cancelled && data && typeof data.enabled === "boolean") setServerEnabled(data.enabled);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  function ensureVisitorId(): string {
    if (!visitorIdRef.current) visitorIdRef.current = crypto.randomUUID();
    return visitorIdRef.current;
  }

  // Stable (empty deps): reads name/email through refs so identity never changes
  // — critical so the focus effect below never re-runs on keystrokes.
  const resetChat = useCallback((clearMessages = false) => {
    visitorIdRef.current = "";
    setSession(null);
    setShowForm(!nameRef.current.trim() || !emailRef.current.trim());
    setError(null);
    if (clearMessages) setMessages([]);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);
  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen) setHasAnimation(true);
    else {
      const timer = setTimeout(() => setHasAnimation(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // SSE lifecycle: one EventSource per active, non-closed session while open.
  useEffect(() => {
    if (!isOpen || !session?.id || session?.status === "closed") return;
    const visitorId = session.visitorId;
    setStatus("connecting");
    const es = new EventSource(`/api/chat/stream?visitorId=${encodeURIComponent(visitorId)}`);
    eventSourceRef.current = es;

    es.addEventListener("open", () => {
      setStatus("idle");
      setError(null);
    });

    es.addEventListener("history", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      if (Array.isArray(data.messages)) setMessages((prev) => mergeMessages(prev, data.messages));
      if (data.session) setSession((prev) => (prev ? { ...prev, ...data.session } : prev));
    });

    es.addEventListener("message", (event) => {
      const msg = JSON.parse((event as MessageEvent).data) as ChatMessageDto;
      setMessages((prev) => mergeMessages(prev, [msg]));
      setUnread((u) => (document.hidden ? u + 1 : u));
    });

    es.addEventListener("status", (event) => {
      const data = JSON.parse((event as MessageEvent).data);
      if (data.status === "closed" && data.sessionId) {
        setSession((prev) => (prev ? { ...prev, status: "closed" } : prev));
        setError(t("chat.sessionClosed"));
        setStatus("idle");
        eventSourceRef.current?.close();
        visitorIdRef.current = "";
      }
    });

    es.addEventListener("error", () => {
      if (sessionRef.current?.status === "closed") {
        setStatus("idle");
        return;
      }
      setStatus("error");
      setError(t("chat.connectionLost"));
    });

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, session?.id]);

  // Focus on open; reset a closed session on hide. Depends only on [isOpen]
  // (resetChat is stable) so typing never re-triggers focus stealing.
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        (nameInputRef.current ?? inputRef.current)?.focus();
      }, 300);
      setUnread(0);
      return () => clearTimeout(timer);
    }
    if (sessionRef.current?.status === "closed") resetChat(true);
  }, [isOpen, resetChat]);

  function formatSendError(err: unknown): string {
    if (err instanceof Error) {
      if (err.name === "AbortError" || err.name === "TimeoutError") return t("chat.timeout");
      if (err instanceof TypeError) return t("chat.networkError");
      return err.message || t("chat.sendFailed");
    }
    return t("chat.sendFailed");
  }

  async function handleSend() {
    const text = input.trim();
    if ((!text && !attachment) || status === "sending") return;
    if (session?.status === "closed") {
      setError(t("chat.sessionClosed"));
      return;
    }
    setError(null);
    if (showForm && (!name.trim() || !email.trim())) {
      setError(t("chat.enterNameEmail"));
      return;
    }
    setStatus("sending");
    const visitorId = session?.visitorId || ensureVisitorId();
    const pageUrl = typeof window !== "undefined" ? window.location.href : undefined;
    try {
      let res: Response;
      if (attachment) {
        const form = new FormData();
        form.set("visitorId", visitorId);
        if (name.trim()) form.set("name", name.trim());
        if (email.trim()) form.set("email", email.trim());
        if (text) form.set("message", text);
        if (pageUrl) form.set("pageUrl", pageUrl);
        form.set("file", attachment, attachment.name);
        res = await fetch("/api/chat/send", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(30000),
        });
      } else {
        res = await fetch("/api/chat/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId,
            name: name.trim() || undefined,
            email: email.trim() || undefined,
            message: text,
            pageUrl,
          }),
          signal: AbortSignal.timeout(10000),
        });
      }
      const data = await parseEnvelope(res);
      if (data.session) {
        setSession(data.session);
        visitorIdRef.current = data.visitorId;
      }
      if (Array.isArray(data.messages)) setMessages((prev) => mergeMessages(prev, data.messages));
      setInput("");
      setAttachment(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (showForm) setShowForm(false);
    } catch (err) {
      if (err instanceof Error && err.message.includes("closed")) {
        resetChat(true);
        setError(t("chat.sessionClosedRestart"));
      } else setError(formatSendError(err));
    } finally {
      setStatus("idle");
    }
  }

  function handleClose() {
    if (session?.status === "closed" || !session?.id) {
      if (session?.status === "closed") resetChat(true);
      setIsOpen(false);
      return;
    }
    setShowCloseModal(true);
  }

  function handleCloseCancel() {
    setShowCloseModal(false);
    setIsOpen(false);
  }

  async function closeSession() {
    if (!session?.visitorId) return;
    setStatus("sending");
    try {
      const res = await fetch("/api/chat/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitorId: session.visitorId }),
        signal: AbortSignal.timeout(10000),
      });
      const data = await parseEnvelope(res);
      if (data.session) setSession(data.session);
      visitorIdRef.current = "";
      setMessages([]);
      setError(null);
      setShowCloseModal(false);
      setIsOpen(false);
    } catch (err) {
      setError(formatSendError(err));
      setShowCloseModal(false);
    } finally {
      setStatus("idle");
    }
  }

  async function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      await handleSend();
    }
  }

  if (!enabled) return null;
  // Hide entirely when the server reports chat unavailable AND there is no live
  // session to preserve (an in-flight conversation is never yanked away).
  if (!serverEnabled && !session) return null;

  const isClosed = session?.status === "closed";
  const sendDisabled = isClosed || status === "sending" || (!input.trim() && !attachment);

  return (
    <div className="fixed bottom-3 right-3 sm:bottom-4 sm:right-4 z-50 flex flex-col items-end gap-2 sm:gap-3">
      {(isOpen || hasAnimation) && (
        <div
          className={`relative w-[calc(100vw-1.5rem)] max-w-sm sm:w-96 sm:max-w-none max-h-[80vh] sm:max-h-[70vh] bg-card text-fg rounded-2xl shadow-2xl border border-border flex flex-col overflow-hidden transition-all duration-300 ease-out origin-bottom-right ${
            isOpen
              ? "opacity-100 translate-y-0 scale-100 pointer-events-auto"
              : "opacity-0 translate-y-4 scale-95 pointer-events-none"
          }`}
        >
          {/* Header */}
          <div className="bg-accent text-bg p-3 sm:p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold text-sm">{t("chat.title")}</div>
              <div className="text-xs opacity-80">{t("chat.subtitle")}</div>
            </div>
            <button
              onClick={handleClose}
              className="opacity-80 hover:opacity-100 p-1 rounded-full hover:bg-black/10"
              aria-label={t("chat.closeChat")}
            >
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-bg/40">
            <div className="text-sm text-muted bg-card p-3 rounded-xl shadow-sm border border-border">
              {greeting}
            </div>
            {messages.map((msg, i) => {
              const isVisitor = msg.direction === "visitor";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col max-w-[85%] animate-fade-in-up ${
                    isVisitor ? "ml-auto items-end" : "items-start"
                  }`}
                  style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                >
                  <div
                    className={`px-3 py-2 rounded-2xl text-sm shadow-sm ${
                      isVisitor
                        ? "bg-accent text-bg rounded-br-md"
                        : "bg-card text-fg border border-border rounded-bl-md"
                    } ${msg.errorText ? "border border-red-400" : ""}`}
                  >
                    {msg.attachment && session?.visitorId && (
                      <ChatAttachment
                        attachment={msg.attachment}
                        messageId={msg.id}
                        visitorId={session.visitorId}
                        direction={msg.direction}
                        downloadLabel={t("chat.download")}
                      />
                    )}
                    {msg.text && (
                      <div className={`whitespace-pre-wrap break-words ${msg.attachment ? "mt-1.5" : ""}`}>
                        {msg.text}
                      </div>
                    )}
                  </div>
                  {msg.errorText && (
                    <div className="text-[10px] text-red-500 mt-1 flex items-center gap-1">
                      <AlertCircle size={11} /> {msg.errorText}
                    </div>
                  )}
                  <div className="text-[10px] text-muted mt-1">{formatTime(msg.createdAt)}</div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Intake form */}
          {showForm && messages.length === 0 && (
            <div className="p-4 bg-card border-t border-border space-y-2">
              <input
                ref={nameInputRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("chat.namePlaceholder")}
                className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-bg text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                placeholder={t("chat.emailPlaceholder")}
                className="w-full px-3 py-2 text-sm rounded-xl border border-border bg-bg text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </div>
          )}

          {/* Input bar */}
          <div className="p-3 bg-card border-t border-border">
            {error && (
              <div className="mb-2 text-xs text-red-500 bg-red-500/10 px-2 py-1 rounded-lg flex items-center gap-1">
                <AlertCircle size={12} /> {error}
              </div>
            )}
            {attachment && (
              <div className="mb-2 flex items-center justify-between gap-2 text-xs bg-accent/10 text-fg px-2 py-1.5 rounded-lg">
                <span className="flex items-center gap-1 min-w-0">
                  <FileText size={13} className="shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                  <span className="opacity-60">({formatBytes(attachment.size)})</span>
                </span>
                <button
                  onClick={() => {
                    setAttachment(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                  disabled={isClosed || status === "sending"}
                  className="opacity-70 hover:opacity-100 disabled:opacity-40"
                  aria-label={t("chat.removeFile")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              {attachmentsEnabled && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => setAttachment(e.target.files?.[0] ?? null)}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isClosed || status === "sending"}
                    className="shrink-0 p-2 rounded-full text-muted hover:text-accent hover:bg-accent/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    aria-label={t("chat.attach")}
                  >
                    <Paperclip size={16} />
                  </button>
                </>
              )}
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isClosed}
                placeholder={isClosed ? t("chat.chatClosedPlaceholder") : t("chat.messagePlaceholder")}
                className="flex-1 resize-none max-h-32 min-h-[2.5rem] px-3 py-2 text-sm rounded-xl border border-border bg-bg text-fg placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:cursor-not-allowed"
                rows={1}
              />
              <button
                onClick={async () => { await handleSend(); }}
                disabled={sendDisabled}
                className="shrink-0 p-2 rounded-full bg-accent text-bg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95"
                aria-label={t("chat.send")}
              >
                {status === "sending" ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Send size={16} />
                )}
              </button>
            </div>
          </div>

          {/* Close-confirm modal */}
          {showCloseModal && (
            <div className="absolute inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
              <div className="bg-card text-fg rounded-xl shadow-xl p-5 w-full max-w-sm text-center border border-border">
                <div className="font-semibold text-sm mb-1">{t("chat.closeConfirmTitle")}</div>
                <div className="text-xs text-muted mb-4">{t("chat.closeConfirmBody")}</div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={async () => { await closeSession(); }}
                    disabled={status === "sending"}
                    className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {t("chat.confirmClose")}
                  </button>
                  <button
                    onClick={handleCloseCancel}
                    className="px-4 py-2 rounded-lg bg-bg text-fg border border-border text-sm font-medium hover:bg-accent/10"
                  >
                    {t("chat.cancelClose")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Floating bubble */}
      <button
        onClick={() => (isOpen ? handleClose() : setIsOpen(true))}
        className="group relative w-11 h-11 sm:w-14 sm:h-14 rounded-full bg-accent text-bg shadow-lg flex items-center justify-center transition-all duration-300 hover:scale-110 hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-accent/30"
        aria-label={isOpen ? t("chat.closeChat") : t("chat.openChat")}
      >
        {isOpen ? (
          <X size={18} className="sm:hidden" />
        ) : (
          <MessageCircle size={18} className="sm:hidden" />
        )}
        {isOpen ? (
          <X size={22} className="hidden sm:block" />
        ) : (
          <MessageCircle size={22} className="hidden sm:block" />
        )}
        {!isOpen && unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] sm:text-xs font-bold w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center border-2 border-card animate-bounce">
            {unread}
          </span>
        )}
      </button>
    </div>
  );
}

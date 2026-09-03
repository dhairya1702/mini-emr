import { useEffect, useRef, useState } from "react";

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["⇧", "Z", "X", "C", "V", "B", "N", "M", "⌫"],
];

type MessageKind = "text" | "schedule" | "context" | "draft";

type ChatMessage = {
  id: string;
  from: "me" | "clinic";
  kind: MessageKind;
  text?: string;
};

const TURNS: Array<{ prompt: string; replies: Array<Omit<ChatMessage, "id" | "from">> }> = [
  {
    prompt: "Who am I seeing today?",
    replies: [
      {
        kind: "text",
        text: "Good morning, Dr. Mehta. You have 8 patients today.",
      },
      { kind: "schedule" },
    ],
  },
  {
    prompt: "What should I know about Priya?",
    replies: [{ kind: "context" }],
  },
  {
    prompt: "Draft her follow-up instructions.",
    replies: [{ kind: "draft" }],
  },
];

const REDUCED_MOTION_MESSAGES: ChatMessage[] = [
  { id: "static-1", from: "me", kind: "text", text: TURNS[0].prompt },
  { id: "static-2", from: "clinic", kind: "text", text: TURNS[0].replies[0].text },
  { id: "static-3", from: "clinic", kind: "schedule" },
  { id: "static-4", from: "me", kind: "text", text: TURNS[1].prompt },
  { id: "static-5", from: "clinic", kind: "context" },
];

export default function PhoneHero() {
  const root = useRef<HTMLElement>(null);
  const chat = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [sendReady, setSendReady] = useState(false);
  const [typing, setTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isInView, setIsInView] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsInView(entry.isIntersecting && entry.intersectionRatio >= 0.35),
      { threshold: [0, 0.35] }
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const updateVisibility = () => setIsPageVisible(!document.hidden);
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  useEffect(() => {
    const chatNode = chat.current;
    if (!chatNode) return;
    chatNode.scrollTo({ top: chatNode.scrollHeight, behavior: "smooth" });
  }, [draft, messages, typing]);

  useEffect(() => {
    const timers: number[] = [];
    const later = (callback: () => void, delay: number) => {
      timers.push(window.setTimeout(callback, delay));
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setMessages(REDUCED_MOTION_MESSAGES);
      return () => undefined;
    }

    const reset = () => {
      setDraft("");
      setActiveKey("");
      setKeyboardOpen(false);
      setSendReady(false);
      setTyping(false);
      setMessages([]);
    };

    if (!isInView || !isPageVisible) {
      reset();
      return () => timers.forEach((timer) => window.clearTimeout(timer));
    }

    const addMessage = (message: ChatMessage) => {
      setMessages((current) => [...current, message]);
    };

    const typePrompt = (prompt: string, turnIndex: number, startAt: number) => {
      later(() => {
        setKeyboardOpen(true);
        setDraft("");
        setSendReady(false);
      }, startAt);

      [...prompt].forEach((character, index) => {
        later(() => {
          setDraft((value) => value + character);
          const normalizedKey = character.trim().toUpperCase();
          if (normalizedKey) {
            setActiveKey(normalizedKey);
            later(() => setActiveKey(""), 95);
          }
          if (index === prompt.length - 1) setSendReady(true);
        }, startAt + 420 + index * 34);
      });

      const sentAt = startAt + 420 + prompt.length * 34 + 430;
      later(() => {
        setDraft("");
        setSendReady(false);
        setKeyboardOpen(false);
      }, sentAt);
      later(() => addMessage({ id: `turn-${turnIndex}-prompt`, from: "me", kind: "text", text: prompt }), sentAt + 280);

      return sentAt + 760;
    };

    const play = (offset = 300) => {
      reset();
      let cursor = offset;

      TURNS.forEach((turn, turnIndex) => {
        cursor = typePrompt(turn.prompt, turnIndex, cursor);
        later(() => setTyping(true), cursor);
        cursor += 1050;
        later(() => setTyping(false), cursor);

        turn.replies.forEach((reply, replyIndex) => {
          cursor += replyIndex === 0 ? 120 : 560;
          later(() => {
            addMessage({
              id: `turn-${turnIndex}-reply-${replyIndex}`,
              from: "clinic",
              ...reply,
            });
          }, cursor);
        });

        cursor += turnIndex === TURNS.length - 1 ? 4900 : 1550;
      });

      later(() => play(0), cursor);
    };

    play();

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [isInView, isPageVisible]);

  return (
    <section ref={root} className="phone-hook" id="assistant-demo" aria-label="ClinicOS mobile assistant demonstration">
      <div className="phone-hook__copy">
        <div className="scene__kicker">AI assistant</div>
        <h2 className="phone-hook__title">Your clinic, one message away.</h2>
        <p className="phone-hook__body">
          Ask about today&apos;s schedule, a patient&apos;s history, or what needs attention.
          ClinicOS replies with the context already inside your clinic and helps you take the next step.
        </p>
      </div>

      <div className="phone-hook__device">
        <span className="phone-hook__side phone-hook__side--volume" aria-hidden />
        <span className="phone-hook__side phone-hook__side--power" aria-hidden />
        <div className="phone-hook__screen">
          <div className="phone-hook__status">
            <span>9:12</span>
            <span className="phone-hook__signal">91%</span>
          </div>

          <div className="phone-hook__header">
            <span className="phone-hook__back" aria-hidden>‹</span>
            <div className="phone-hook__avatar" aria-hidden>C</div>
            <strong>ClinicOS</strong>
          </div>

          <div className="phone-hook__chat" ref={chat} aria-live="polite">
            <div className="phone-hook__day">Today</div>

            {messages.map((message) => (
              <ChatBubble message={message} key={message.id} />
            ))}

            <div className={`phone-hook__typing${typing ? " is-visible" : ""}`} aria-label="ClinicOS is typing">
              <span /><span /><span />
            </div>
          </div>

          <div className={`phone-hook__compose${keyboardOpen ? " has-keyboard" : ""}`}>
            <div className="phone-hook__input">
              <span>{draft}</span>
              {keyboardOpen && <span className="phone-hook__caret" aria-hidden />}
            </div>
            <span className={`phone-hook__send${sendReady ? " is-ready" : ""}`} aria-hidden>➤</span>
          </div>

          <div className={`phone-hook__keyboard${keyboardOpen ? " is-open" : ""}`} aria-hidden>
            {KEY_ROWS.map((row, rowIndex) => (
              <div className="phone-hook__key-row" key={rowIndex}>
                {row.map((key) => (
                  <span
                    className={`phone-hook__key${key === "⇧" || key === "⌫" ? " phone-hook__key--wide" : ""}${activeKey === key ? " is-pressed" : ""}`}
                    key={key}
                  >
                    {key}
                  </span>
                ))}
              </div>
            ))}
            <div className="phone-hook__key-row">
              <span className="phone-hook__key phone-hook__key--wide">123</span>
              <span className="phone-hook__key phone-hook__key--wide">☺</span>
              <span className="phone-hook__key phone-hook__key--space">space</span>
              <span className="phone-hook__key phone-hook__key--wide">return</span>
            </div>
          </div>
        </div>
        <span className="phone-hook__home" aria-hidden />
      </div>

      <a className="phone-hook__cue" href="#ai" aria-label="Continue to the AI scribe">↓</a>
    </section>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`phone-hook__message phone-hook__message--${message.from === "me" ? "mine" : "theirs"} is-visible`}>
      <div className="phone-hook__bubble">
        {message.kind === "text" && message.text}
        {message.kind === "schedule" && <ScheduleReply />}
        {message.kind === "context" && <ContextReply />}
        {message.kind === "draft" && <DraftReply />}
      </div>
    </div>
  );
}

function ScheduleReply() {
  return (
    <>
      <div className="phone-hook__intro">Here&apos;s who&apos;s up first:</div>
      <div className="phone-hook__patient">
        <strong>9:30 · Aarav Sharma</strong>
        <span>Myopia follow-up, axial length due</span>
      </div>
      <div className="phone-hook__patient">
        <strong>10:15 · Priya Nair</strong>
        <span>Contact lens review, reported irritation</span>
      </div>
      <div className="phone-hook__patient">
        <strong>11:00 · Rohan Iyer</strong>
        <span>New patient, intake incomplete</span>
      </div>
    </>
  );
}

function ContextReply() {
  return (
    <>
      <div className="phone-hook__intro">Priya flagged irritation after switching lens brand.</div>
      <div className="phone-hook__patient">
        <strong>Last visit</strong>
        <span>Dryness noted, no corneal staining.</span>
      </div>
      <div className="phone-hook__patient">
        <strong>Today</strong>
        <span>Check fit, comfort, and wearing time.</span>
      </div>
    </>
  );
}

function DraftReply() {
  return (
    <>
      <div className="phone-hook__intro">Draft ready:</div>
      <div className="phone-hook__patient">
        <span>Use lubricating drops twice daily, limit lens wear to 8 hours, and return if redness increases.</span>
      </div>
    </>
  );
}

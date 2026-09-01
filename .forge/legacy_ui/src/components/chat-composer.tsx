// Isolated composer: owns its own text state so keystrokes do NOT re-render the
// entire ChatPage tree (sidebar, message list, agents/tools popovers, etc.).
// Parent talks to it via an imperative ref handle.
import { forwardRef, memo, useCallback, useImperativeHandle, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";
import { EmojiPicker } from "./emoji-picker";

export interface ChatComposerHandle {
  getText(): string;
  setText(s: string): void;
  appendText(s: string): void;
  clearText(): void;
  focus(): void;
}

interface Props {
  disabled?: boolean;
  streaming?: boolean;
  recording?: boolean;
  waveCanvasRef?: RefObject<HTMLCanvasElement | null>;
  placeholder?: string;
  onSend(text: string): void;
  onStop?: () => void;
  onPaste?: (e: ClipboardEvent) => void;
}

export const ChatComposer = memo(forwardRef<ChatComposerHandle, Props>(function ChatComposer(
  { disabled, streaming, recording, waveCanvasRef, placeholder, onSend, onStop, onPaste },
  ref,
) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  // Mirror the latest text in a ref so imperative getText() never returns stale state
  // (parent send() reads it synchronously from a button click handler).
  const textRef = useRef(text);
  textRef.current = text;

  useImperativeHandle(ref, () => ({
    getText: () => textRef.current,
    setText: (s) => setText(s),
    appendText: (s) => setText((cur) => cur + s),
    clearText: () => setText(""),
    focus: () => taRef.current?.focus(),
  }), []);

  const handleSend = useCallback(() => {
    const t = textRef.current;
    if (!t.trim()) return;
    onSend(t);
  }, [onSend]);

  const handleEmoji = useCallback((em: string) => setText((s) => s + em), []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <>
      {recording ? (
        <canvas
          ref={waveCanvasRef as RefObject<HTMLCanvasElement>}
          width={400}
          height={36}
          className="flex-1 h-9 rounded bg-background/40"
        />
      ) : (
        <Textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={onPaste}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={3}
          className="flex-1 min-h-[72px] max-h-[280px] resize-y border-0 bg-transparent focus-visible:ring-0 leading-relaxed"
          disabled={disabled}
        />
      )}
      {!recording && <EmojiPicker onPick={handleEmoji} />}
      {streaming ? (
        <Button onClick={onStop} variant="destructive">
          <Loader2 className="h-4 w-4 animate-spin" />
        </Button>
      ) : (
        <Button
          onClick={handleSend}
          className="bg-gradient-primary text-primary-foreground"
          disabled={disabled}
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </>
  );
}));

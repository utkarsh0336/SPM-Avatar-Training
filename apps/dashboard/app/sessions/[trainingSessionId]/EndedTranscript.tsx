import transcriptStyles from "./TranscriptPanel.module.css";
import endedStyles from "./VideoChatSession.module.css";
import { TranscriptBubble } from "./TranscriptBubble";
import type { ConversationMessage } from "./useConversationSession";

// Unlike TranscriptPanel (aria-hidden — CaptionBar is the live session's authoritative
// screen-reader source, see .claude/specs/video-chat-session.md Accessibility), this is the ONLY
// surface conveying a read-only, already-ended session's content, so it must stay in the
// accessibility tree.
export function EndedTranscript({ messages }: { messages: ConversationMessage[] }) {
  if (messages.length === 0) {
    return <p className={endedStyles.emptyTranscript}>No conversation recorded.</p>;
  }
  return (
    <div className={transcriptStyles.transcript}>
      {messages.map((message) => (
        <TranscriptBubble key={message.id} message={message} />
      ))}
    </div>
  );
}

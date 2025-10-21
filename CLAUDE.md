# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A trigger-based voice agent demo using OpenAI's Realtime API. The agent listens continuously but only responds when explicitly triggered by phrases like "good question" or "let me think". Built with Next.js 15, React 19, and the OpenAI Agents SDK.

## Development Commands

```bash
# Start development server (uses Turbopack)
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start

# Run linter
pnpm lint
```

## Environment Setup

Required: Create `.env` file with:
```
OPENAI_API_KEY=sk-...
```

The API key must have Realtime API access. It's used server-side only via Next.js Server Actions to generate ephemeral client tokens.

## Core Architecture Pattern: Modality Switching

**Critical concept**: This app uses **API-enforced silence** via modality switching, not instruction-based silence.

### The Pattern

```
[Silent Listening: output_modalities: ['text']]
         ↓ (trigger phrase detected)
[Switch to: output_modalities: ['audio']]
         ↓ (create single response)
[Response completes]
         ↓
[Switch back to: output_modalities: ['text']]
```

### Why This Works

- In `['text']` mode, the agent **cannot produce audio** (API enforced)
- Not relying on instructions like "don't respond" (unreliable)
- State-based control with explicit transitions
- See `MODALITY_SWITCHING.md` for full implementation details

### Key Implementation Details

1. **Session Configuration** (`app/page.tsx:123-146`):
   - Start with `output_modalities: ['text']` (silent mode)
   - Use `server_vad` with `create_response: false`
   - Transcription model: `gpt-4o-transcribe` with `language: 'en'`

2. **Trigger Detection** (`app/page.tsx:161-227`):
   - Listen for `conversation.item.input_audio_transcription.completed` events
   - Check transcript for trigger phrases (configurable)
   - Switch to `['audio']` mode, create response, then switch back to `['text']`

3. **State Machine** (`app/page.tsx:31-34`):
   ```typescript
   type AgentState = 'idle' | 'listening' | 'generating' | 'speaking'
   ```
   - `isPlayingAudio` ref tracks actual audio playback (not just state)
   - Critical for proper interrupt timing

## File Structure & Responsibilities

```
app/
├── page.tsx                 # Main voice agent logic - ALL session management,
│                           # event handling, trigger detection, state machine
├── server/token.action.tsx  # Server-side OpenAI token generation
└── layout.tsx              # Root layout (minimal)

components/
├── TranscriptDisplay.tsx   # Live conversation view with auto-scroll
├── SettingsPanel.tsx       # Pre-connection configuration UI
└── ui/
    ├── Button.tsx          # Styled button component
    └── utils.ts            # cn() utility for className merging
```

### app/page.tsx - The Heart of the App

This 700+ line file contains all critical logic:

- **RealtimeSession setup**: WebRTC transport, agent configuration
- **Event handlers**: `transport_event` and `history_updated` listeners
- **Trigger detection**: Voice and button-triggered responses
- **Interrupt handling**: Immediate audio stop on barge-in
- **State management**: Connection, listening, speaking states
- **Transcript caching**: Store assistant audio transcripts by item_id
- **LLM request logging**: Full conversation context before each response

Key refs used:
- `session`, `recorder`, `player`: Core audio/session objects
- `transcriptCache`: Maps item_id → transcript text (fixes disappearing responses)
- `sessionHistory`: Full conversation for LLM context logging
- `isPlayingAudio`: Boolean flag for accurate interrupt timing (independent of agentState)

## Critical Implementation Notes

### 1. Transcript Caching Pattern

**Problem**: Assistant audio responses would appear briefly then disappear from transcript.

**Solution** (`app/page.tsx:365-375`):
```typescript
// Capture transcripts when they complete
if (event.type === 'response.output_audio_transcript.done') {
  transcriptCache.current.set(itemId, transcript);
}

// Use cached transcript in history handler
text = content.transcript || transcriptCache.current.get(item.itemId) || '';
```

### 2. Interrupt Timing with isPlayingAudio

**Problem**: `agentState` transitions to 'listening' after response.done, but audio still playing in browser.

**Solution** (`app/page.tsx:34, 259, 358-363`):
- `isPlayingAudio` ref stays true for 5 seconds after response.done
- Barge-in check: `if (isPlayingAudio.current || agentState === 'speaking' || ...)`
- Ensures voice interrupts work even after state transitions

### 3. LLM Context Logging

Before each `response.create`, logs full conversation context:
- Instructions being sent
- Complete session history (all messages)
- Message types and transcripts

Stored in `sessionHistory` ref, populated from `history_updated` events.

### 4. Audio Event Flow

```
response.output_audio.delta → Base64 decode → Int16Array → player.add16BitPCM()
```

NOT `response.audio.delta` (wrong event type).

### 5. Error Suppression

Two expected errors are suppressed:
- `input_audio_buffer_commit_empty`: VAD fires before audio sent (session start)
- `response_cancel_not_active`: Interrupt after response done but audio playing

## Modality API Constraints

**Important**: The Realtime API only accepts:
- `output_modalities: ['text']` OR
- `output_modalities: ['audio']`

NOT `['text', 'audio']` together. You must switch between modes.

## State Transitions

```
[Connect] → idle → listening
           ↓ (trigger detected)
         generating → speaking
           ↓ (response.done)
         listening
           ↓ (barge-in detected)
         [interrupt] → listening
```

## Debugging

All console logs follow a pattern:
- `🎯` Trigger detection
- `📤` API requests
- `🔊` Audio events
- `⚡` Barge-in/interrupts
- `🤖` LLM request details
- `📝` Transcription
- `⛔` Errors/interrupts
- `✅` Success states

Check console for structured logs showing full LLM context before each response.

## Common Modification Patterns

### Changing Trigger Phrases

Update `DEFAULT_SETTINGS` in `app/page.tsx:16-22`.

### Adjusting Agent Instructions

Modify `createAgent()` function in `app/page.tsx:44-58`. Remember:
- Always emphasize English-only responses
- Keep instructions concise
- Instructions are combined with per-response instructions during trigger

### Adding New Trigger Types

1. Add new trigger phrase to settings
2. Update detection logic in `conversation.item.input_audio_transcription.completed` handler
3. Create response with appropriate instructions and duration
4. Follow the modality switching pattern: text → audio → text

### Modifying Interrupt Behavior

Key function: `interruptAgent()` at `app/page.tsx:611-647`
- Immediately clear `isPlayingAudio.current` flag
- Set state to 'listening'
- Call `player.interrupt()`
- Send `response.cancel`
- Switch back to `['text']` mode

## Architecture Documents

- `ARCHITECTURE.md`: Full system architecture with diagrams
- `MODALITY_SWITCHING.md`: Detailed pattern implementation guide
- `README.md`: User-facing documentation
- `QUICKSTART.md`: Quick start guide (if present)

## Dependencies of Note

- `@openai/agents`: Provides `RealtimeSession`, `RealtimeAgent` classes
- `wavtools`: `WavRecorder`, `WavStreamPlayer` for audio handling
- Audio is handled automatically by WebRTC transport (no manual audio processing needed)

## Testing the App

1. Start dev server: `pnpm dev`
2. Open http://localhost:3000
3. Allow microphone access
4. Click "Connect"
5. Say "good question" or "let me think" to trigger responses
6. Say "got it" to interrupt
7. Check browser console for detailed event logs

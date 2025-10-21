# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser (Client)                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │   User Interface │         │  Transcript View │          │
│  │  - ConnectBtn   │◄────────┤  - Live Updates  │          │
│  │  - Settings     │         │  - Auto-scroll   │          │
│  │  - Trigger Btns │         └──────────────────┘          │
│  └────────┬─────────┘                                        │
│           │                                                   │
│  ┌────────▼─────────┐         ┌──────────────────┐          │
│  │  RealtimeSession │◄────────┤  Event Listeners │          │
│  │  - WebRTC        │         │  - history_update│          │
│  │  - Agent Config  │         │  - audio         │          │
│  └────────┬─────────┘         │  - transport     │          │
│           │                   └──────────────────┘          │
└───────────┼─────────────────────────────────────────────────┘
            │
            │ WebRTC Connection
            │ (Audio Streams)
            │
┌───────────▼─────────────────────────────────────────────────┐
│                     Next.js Server                           │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐                                        │
│  │  Server Actions  │                                        │
│  │  getToken()      │                                        │
│  └────────┬─────────┘                                        │
│           │                                                   │
│           │ API Key (Server-side only)                       │
│           │                                                   │
└───────────┼─────────────────────────────────────────────────┘
            │
            │ HTTPS Request
            │ POST /v1/realtime/client_secrets
            │
┌───────────▼─────────────────────────────────────────────────┐
│                     OpenAI API                               │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐         ┌──────────────────┐          │
│  │  Auth & Token    │         │  Realtime Model  │          │
│  │  Management      │────────►│  gpt-4o-realtime │          │
│  └──────────────────┘         └────────┬─────────┘          │
│                                         │                     │
│                               ┌─────────▼─────────┐          │
│                               │  Voice Processing │          │
│                               │  - STT           │          │
│                               │  - TTS           │          │
│                               │  - VAD           │          │
│                               └──────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Data Flow Diagrams

### 1. Connection Flow

```
User Clicks Connect
       ↓
[Browser] Call getToken()
       ↓
[Server] Fetch API key from env
       ↓
[Server] POST to OpenAI /client_secrets
       ↓
[OpenAI] Generate ephemeral token
       ↓
[Server] Return token to browser
       ↓
[Browser] RealtimeSession.connect(token)
       ↓
[WebRTC] Establish peer connection
       ↓
[Browser] Update UI: Connected ✅
```

### 2. Voice Trigger Flow (Quick Hint)

```
User speaks: "What is 2+2? Good question"
       ↓
[Browser Mic] Capture audio
       ↓
[WebRTC] Stream to OpenAI
       ↓
[OpenAI STT] Transcribe: "What is 2+2? Good question"
       ↓
[OpenAI Agent] Detect trigger phrase "good question"
       ↓
[OpenAI Agent] Access conversation context (last 3 msgs)
       ↓
[OpenAI Agent] Generate quick hint response
       ↓
[OpenAI TTS] Convert to audio
       ↓
[WebRTC] Stream audio back
       ↓
[Browser Speaker] Play audio
       ↓
[Browser UI] Update transcript with response
```

### 3. Manual Button Trigger Flow

```
User clicks "Quick Hint" button
       ↓
[Browser] session.sendText("[TRIGGER: Quick Hint]...")
       ↓
[WebRTC] Send text message
       ↓
[OpenAI Agent] Process trigger with context
       ↓
[OpenAI Agent] Generate response
       ↓
[OpenAI TTS] Convert to audio
       ↓
[WebRTC] Stream back
       ↓
[Browser] Play and display
```

### 4. Interruption Flow

```
Agent is speaking...
       ↓
User says "got it" OR clicks Interrupt
       ↓
[Browser] Detect interrupt signal
       ↓
[Browser] session.cancelResponse()
       ↓
[WebRTC] Send cancellation
       ↓
[OpenAI] Stop generation
       ↓
[Browser] Stop audio playback
       ↓
[Browser UI] Update status: Listening
```

## Component Architecture

```
app/page.tsx (Main Component)
├── State Management
│   ├── isConnected
│   ├── isListening
│   ├── isSpeaking
│   ├── settings
│   ├── transcripts
│   ├── events
│   └── conversationHistory
│
├── RealtimeSession Setup
│   ├── createAgent(settings)
│   ├── Event Listeners
│   │   ├── transport_event
│   │   ├── history_updated
│   │   └── error
│   └── Configuration
│       ├── model: gpt-4o-realtime-preview
│       ├── voice: alloy
│       └── turn_detection: server_vad
│
└── UI Components
    ├── Status Bar
    │   ├── Connection indicator
    │   ├── Listening indicator
    │   └── Speaking indicator
    │
    ├── TranscriptDisplay
    │   └── Real-time message list
    │
    ├── Manual Triggers
    │   ├── Quick Hint button
    │   ├── Full Guidance button
    │   └── Interrupt button
    │
    ├── SettingsPanel
    │   ├── Trigger phrases
    │   ├── Durations
    │   └── Interrupt phrases
    │
    └── Event Log
        └── Transport events
```

## State Transitions

```
                    ┌─────────────┐
                    │ Disconnected│
                    └──────┬──────┘
                           │ connect()
                           ▼
                    ┌─────────────┐
                    │  Connected  │
                    │  Listening  │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        │ Trigger          │ toggleMute()     │ Disconnect
        ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Speaking   │    │   Muted     │    │Disconnected │
│  Listening  │    │ (No Audio)  │    └─────────────┘
└──────┬──────┘    └──────┬──────┘
       │                  │
       │ Response         │ toggleMute()
       │ Complete         │
       ▼                  ▼
┌─────────────┐    ┌─────────────┐
│  Listening  │◄───│  Listening  │
│   (Ready)   │    │   (Ready)   │
└─────────────┘    └─────────────┘
```

## Message Flow Timeline

```
Time  User                 Agent               System
───────────────────────────────────────────────────────
0s    [Connects]           [Ready]             Connected ✅
1s    "Hello"              [Listening]         Transcript: "Hello"
2s    "How are you?"       [Listening]         Transcript: "How are you?"
3s    [Silent]             [Listening]         [Waiting]
4s    "Good question"      [Triggered!]        Detecting trigger...
5s                         "I'm doing well..." Transcript: Agent response
6s                         [Speaking]          Speaking 🟣
7s                         [Speaking]          Speaking 🟣
8s    "Got it"             [Interrupted!]      Cancelled
9s    [Silent]             [Listening]         Listening 🔵
```

## Security Architecture

```
┌─────────────────────────────────────────┐
│           Environment Variables          │
│  OPENAI_API_KEY (Server-side only)      │
└────────────────┬────────────────────────┘
                 │
                 │ Read by Server Action
                 ▼
         ┌───────────────┐
         │ getToken()    │
         │ Server Action │
         └───────┬───────┘
                 │
                 │ Exchange for Ephemeral Token
                 ▼
         ┌───────────────┐
         │ OpenAI API    │
         └───────┬───────┘
                 │
                 │ Return Short-lived Token
                 ▼
         ┌───────────────┐
         │ Browser       │
         │ (Token only)  │
         └───────────────┘

Key Points:
✅ API key never sent to browser
✅ Ephemeral tokens expire automatically
✅ Tokens can't be used to modify account
✅ Server validates all requests
```

## Event System

```
RealtimeSession Events:
┌────────────────────────────────────┐
│  transport_event                   │───► All raw events
│  - response.audio.delta            │
│  - response.done                   │
│  - input_audio_buffer.speech_start │
│  - etc.                            │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  history_updated                   │───► Conversation updates
│  - New messages                    │
│  - Transcripts                     │
│  - Tool calls                      │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  error                             │───► Error handling
│  - Connection errors               │
│  - API errors                      │
│  - Validation errors               │
└────────────────────────────────────┘

┌────────────────────────────────────┐
│  audio (WebSocket mode only)       │───► Raw audio chunks
│  - PCM16 data                      │
│  - Response ID                     │
└────────────────────────────────────┘
```

## Performance Optimization

### 1. Audio Streaming
```
Traditional Approach:
User speaks → Wait → Process → Wait → Full response → Play

WebRTC Approach:
User speaks ──┬──► Process ──┬──► Stream response
              └──► Continue  └──► Play immediately
                   listening      (Low latency!)
```

### 2. Context Management
```
Full History (Inefficient):
[Msg 1][Msg 2][Msg 3]...[Msg 100]
All sent to API on each trigger

Optimized Approach:
Quick Hint: [Last 3 messages only]
Full Guidance: [Last 10 messages only]
Reduces token usage and latency
```

### 3. UI Updates
```
Event Batching:
Multiple events → Batch → Single UI update
Prevents UI thrashing, maintains 60fps
```

## Technology Stack Layers

```
┌─────────────────────────────────────┐
│         User Interface Layer         │
│  React Components + Tailwind CSS    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│       Application Logic Layer        │
│  Next.js App Router + TypeScript    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      OpenAI Agents SDK Layer        │
│  RealtimeSession + RealtimeAgent    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│        Transport Layer               │
│  WebRTC (Automatic Audio Handling)  │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│          API Layer                   │
│  OpenAI Realtime API                │
└─────────────────────────────────────┘
```

---

**Architecture Version**: 1.0
**Last Updated**: 2025-10-20
**Complexity**: Medium
**Maintainability**: High

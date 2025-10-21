# Voice Agent Demo - Trigger Phrases & Live Transcript

An intelligent voice assistant built with Next.js and OpenAI's Realtime API that listens continuously and responds when triggered by specific phrases.

## Features

### 🎯 Core Capabilities

1. **Always Listening Mode**
   - Agent continuously listens to all conversations
   - Maintains context of recent conversation history
   - Only responds when explicitly triggered

2. **Two-Level Response System**
   - **Quick Hint**: Brief 10-second response (customizable)
     - Triggered by phrase: "good question" (customizable)
     - Provides concise, actionable advice
   - **Full Guidance**: Detailed 20-second response (customizable)
     - Triggered by phrase: "let me think" (customizable)
     - Provides comprehensive step-by-step guidance

3. **User Interruption Support**
   - Say "got it", "thanks", or "stop" to interrupt the agent
   - Agent stops speaking immediately
   - Interrupt phrases are customizable

4. **Manual Trigger Buttons**
   - Alternative to voice trigger phrases
   - Quick Hint button
   - Full Guidance button
   - Interrupt button (stops agent mid-speech)

5. **Live Transcript Display**
   - Real-time conversation transcription
   - Shows both user input and agent responses
   - Auto-scrolls to latest messages
   - Visual indicators for speaking/listening state

6. **Customizable Settings**
   - Configure trigger phrases before connecting
   - Adjust response durations (5-120 seconds)
   - Customize interrupt phrases
   - Settings lock during active session for consistency

## Setup

### Prerequisites

- Node.js 20+
- pnpm (or npm/yarn)
- OpenAI API key with Realtime API access

### Installation

1. Clone the repository:
```bash
cd s2s_demo
```

2. Install dependencies:
```bash
pnpm install
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Add your OpenAI API key to `.env`:
```
OPENAI_API_KEY=sk-...
```

### Running the App

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage Guide

### 1. Configure Settings (Before Connecting)

- Set your preferred trigger phrases
- Adjust response durations
- Configure interrupt phrases
- Note: Settings are locked once connected

### 2. Connect to Voice Agent

- Click the "Connect" button
- Allow microphone access when prompted
- Wait for "Connected" status indicator

### 3. Interact with Voice

**Method A: Voice Trigger Phrases**
- Talk naturally while the agent listens
- Say "good question" for a quick hint
- Say "let me think" for full guidance
- Say "got it" or "thanks" to interrupt

**Method B: Manual Buttons**
- Click "Quick Hint" button for immediate brief response
- Click "Full Guidance" button for detailed response
- Click "Interrupt" button to stop agent mid-speech

### 4. Monitor Conversation

- View live transcript in the main panel
- Check status indicators:
  - Green = Connected
  - Blue = Listening
  - Purple = Speaking
- Review event log for debugging

## Architecture

### Key Components

```
app/
├── page.tsx                    # Main voice agent logic
├── layout.tsx                  # Root layout
├── globals.css                 # Global styles
└── server/
    └── token.action.tsx        # OpenAI token generation

components/
├── TranscriptDisplay.tsx       # Live conversation transcript
├── SettingsPanel.tsx           # Configuration panel
└── ui/
    ├── Button.tsx              # Reusable button component
    └── utils.ts                # UI utilities
```

### How It Works

1. **Session Management**
   - Creates `RealtimeSession` with custom agent instructions
   - Configures WebRTC transport for automatic audio handling
   - Server-side VAD (Voice Activity Detection) for turn detection

2. **Trigger Detection**
   - Agent instructions include trigger phrase awareness
   - Conversation context maintained in memory (last 10 messages)
   - Agent responds only when triggers detected

3. **Response Control**
   - Quick hints limited to ~10 seconds of speech
   - Full guidance provides ~20 seconds of detailed response
   - Interrupt phrases cancel ongoing responses

4. **Transcript Processing**
   - Listens to `history_updated` events
   - Extracts text from audio/text content
   - Updates UI in real-time

## API Integration

### OpenAI Realtime API

- Model: `gpt-4o-realtime-preview`
- Transport: WebRTC
- Voice: `alloy`
- Turn Detection: Server VAD

### Token Generation

Server action fetches ephemeral client secrets:
```typescript
POST https://api.openai.com/v1/realtime/client_secrets
```

This approach keeps your API key secure on the server.

## Customization

### Changing Agent Personality

Edit the agent instructions in `app/page.tsx`:

```typescript
const instructions = `You are a helpful voice assistant...`;
```

### Adding New Trigger Phrases

Update the `DEFAULT_SETTINGS` in `app/page.tsx`:

```typescript
const DEFAULT_SETTINGS: VoiceSettings = {
  quickHintPhrase: 'your custom phrase',
  fullGuidancePhrase: 'another phrase',
  // ...
};
```

### Adjusting Response Durations

Modify the duration limits in `components/SettingsPanel.tsx`:

```typescript
<input type="number" min="5" max="60" ... />
```

## Troubleshooting

### Microphone Not Working
- Check browser permissions
- Ensure HTTPS (required for microphone access)
- Try refreshing the page

### Agent Not Responding to Triggers
- Check transcript to see if phrase was heard correctly
- Try using manual buttons instead
- Ensure agent is in "Listening" state (blue indicator)

### Connection Errors
- Verify `OPENAI_API_KEY` is set correctly
- Check API key has Realtime API access
- Review browser console for error details

## License

MIT

## Credits

Built with:
- [Next.js 15](https://nextjs.org/)
- [OpenAI Agents SDK](https://github.com/anthropics/openai-agents-js)
- [Tailwind CSS](https://tailwindcss.com/)

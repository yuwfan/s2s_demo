# Modality Switching Implementation Guide

## Problem Statement

**Original Issue**: Agent was responding to every user input instead of staying silent until triggered.

**Why Instructions Failed**: 
- Telling the agent "don't respond unless triggered" is unreliable
- GPT models interpret instructions flexibly
- They may still respond "helpfully" despite instructions
- Turn detection (server_vad) auto-triggered responses on silence

## Solution: Modality-Based Silence

Instead of relying on instructions, we use **API-enforced modality control**.

### Key Insight

**In text-only mode, the agent CANNOT produce audio** - it's not a behavioral choice, it's an API constraint.

## Implementation

### 1. Default State: Silent Listening

```typescript
session.current = new RealtimeSession(agent, {
  model: 'gpt-realtime',
  config: {
    modalities: ['text'],  // ← Text only = No audio output possible
    voice: 'alloy',        // ← Configured but unused until audio mode
    turn_detection: {
      type: 'server_vad',  // ← Enable continuous listening
      threshold: 0.5,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
    },
  },
});
```

**What happens:**
- Microphone stays open
- Server VAD detects speech
- Speech → Text transcription
- Agent receives transcripts but **cannot speak**

### 2. Trigger Detection

```typescript
session.current.on('history_updated', (history) => {
  // ... extract latest user text ...
  
  const quickHintDetected = text.includes('good question');
  const fullGuidanceDetected = text.includes('let me think');
  
  if (quickHintDetected || fullGuidanceDetected) {
    // Switch to audio mode and trigger response
    triggerAudioResponse(context);
  }
});
```

### 3. Switch to Audio Mode

```typescript
function triggerAudioResponse(context) {
  // Step 1: Enable audio in session
  session.current.transport.sendEvent({
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],  // ← Now audio is enabled
    },
  });
  
  // Step 2: Create response with audio
  setTimeout(() => {
    session.current.transport.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],  // ← This response includes audio
        instructions: `Provide guidance based on: "${context}"`,
      },
    });
  }, 100);
}
```

### 4. Automatic Return to Silence

```typescript
session.current.on('transport_event', (event) => {
  if (event.type === 'response.done') {
    // Response finished, switch back to text-only
    session.current.transport.sendEvent({
      type: 'session.update',
      session: {
        modalities: ['text'],  // ← Silent again
      },
    });
  }
});
```

## State Flow

```
[TEXT MODE - Silent] 
      ↓
   User speaks: "What is 2+2?"
      ↓
   [TEXT MODE - Transcribed, stays silent]
      ↓
   User speaks: "Good question"
      ↓
   Trigger detected!
      ↓
   [Switch to AUDIO MODE]
      ↓
   [Generate audio response]
      ↓
   [Play response to user]
      ↓
   response.done event
      ↓
   [Switch back to TEXT MODE - Silent]
```

## Key Events

### session.update
```typescript
{
  type: 'session.update',
  session: {
    modalities: ['text']           // or ['text', 'audio']
  }
}
```
Changes the session configuration mid-session.

### response.create
```typescript
{
  type: 'response.create',
  response: {
    modalities: ['text', 'audio'],  // What this response includes
    instructions: '...'              // Context for this specific response
  }
}
```
Creates a single response with specified modalities.

### response.done
```typescript
{
  type: 'response.done',
  // ... response details
}
```
Signals response completion. We use this to switch back to text-only.

## Manual Triggers

Same approach works for button-triggered responses:

```typescript
async function triggerQuickHint() {
  const context = conversationHistory.slice(-3).join(' ');
  
  // Switch to audio
  session.current.transport.sendEvent({
    type: 'session.update',
    session: { modalities: ['text', 'audio'] },
  });
  
  // Create response
  setTimeout(() => {
    session.current.transport.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: `Quick hint based on: "${context}"`,
      },
    });
  }, 100);
}
```

## Interruption Handling

When user interrupts:

```typescript
async function interruptAgent() {
  // Cancel current response
  await session.current.cancelResponse();
  
  // Switch back to text-only
  session.current.transport.sendEvent({
    type: 'session.update',
    session: { modalities: ['text'] },
  });
}
```

## Advantages

### ✅ Reliability
- Agent **cannot** speak in text-only mode (API constraint)
- Not dependent on instruction following
- No ambiguity in behavior

### ✅ Predictability  
- Clear state transitions
- Explicit control flow
- Easy to debug (check modality state)

### ✅ Simplicity
- No complex prompt engineering
- Straightforward logic
- Clean separation of concerns

### ✅ Flexibility
- Easy to add new trigger types
- Can customize response creation
- Works with manual buttons too

## Debugging Tips

### Check Current Modality
Look for `session.update` events in the event log.

### Verify Response Creation
Check for `response.create` events when triggers fire.

### Monitor State Transitions
Watch for the pattern:
1. `session.update` → modalities: ['text', 'audio']
2. `response.create` → modalities: ['text', 'audio']  
3. `response.done`
4. `session.update` → modalities: ['text']

## Common Issues

### Agent still speaking without trigger
- Check if modality is switching correctly
- Verify `response.done` handler is working
- Ensure no other code is creating responses

### Trigger not working
- Check trigger phrase detection logic
- Verify `session.update` is being sent
- Ensure `response.create` follows after delay

### Audio not playing
- Verify modalities include 'audio'
- Check voice is configured
- Ensure WebRTC connection is active

## Testing Checklist

- [ ] Connect to session - should be silent
- [ ] Speak normally - should stay silent  
- [ ] Say trigger phrase - should respond with audio
- [ ] Response completes - should return to silent
- [ ] Click manual button - should respond
- [ ] Interrupt response - should stop and return to silent
- [ ] Multiple triggers in sequence - should work each time

## Conclusion

Modality switching provides **API-enforced silence control** that is:
- More reliable than instruction-based approaches
- Easier to understand and maintain
- Predictable in behavior
- Flexible for future enhancements

This is the recommended approach for implementing trigger-based voice agents with OpenAI's Realtime API.

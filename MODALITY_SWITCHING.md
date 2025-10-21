# Context Accumulation Pattern - Implementation Guide

**Note**: This guide has been updated to reflect the correct pattern for trigger-based voice agents.

## Problem Statement

**Original Issue**: Agent was responding to every user input instead of staying silent until triggered.

**Why Previous Approaches Failed**:
- **Instructions**: Telling agent "don't respond" is unreliable - models interpret flexibly
- **Modality switching**: Complex and doesn't match the API's intended pattern
- **Turn detection with server_vad**: Auto-triggers responses on silence

## Solution: Context Accumulation Pattern

The correct approach is **continuous context collection + triggered response**.

### Key Insight

**Feed audio into the session continuously to build context, but only create a response when explicitly triggered.**

This matches how the Realtime API is designed to work:

## Implementation

### 1. Silent Context Collection Mode

```typescript
session.current = new RealtimeSession(agent, {
  model: 'gpt-realtime',
  config: {
    voice: 'alloy',
  },
});

// After session.created, configure for silent listening
session.current.on('transport_event', (event) => {
  if (event.type === 'session.created') {
    session.current.transport.sendEvent({
      type: 'session.update',
      session: {
        turn_detection: null, // ← Disable auto-response
        input_audio_transcription: {
          model: 'whisper-1', // ← Enable transcription
        },
      },
    });
  }
});
```

**What happens:**
- Microphone captures audio
- Audio streams to server
- Whisper transcribes to text
- **No responses created** - just collecting context

### 2. Manual Audio Commitment

```typescript
session.current.on('transport_event', (event) => {
  // When user stops speaking
  if (event.type === 'input_audio_buffer.speech_stopped') {
    // Commit the audio to add it to conversation context
    session.current.transport.sendEvent({
      type: 'input_audio_buffer.commit',
    });
  }

  // Audio is now part of the conversation
  if (event.type === 'conversation.item.created') {
    // Context updated - don't create response yet
  }
});
```

### 3. Trigger Detection

```typescript
session.current.on('history_updated', (history) => {
  // ... extract latest user text ...

  const quickHintDetected = text.includes('good question');
  const fullGuidanceDetected = text.includes('let me think');

  if (quickHintDetected || fullGuidanceDetected) {
    // Create a SINGLE audio response
    createTriggeredResponse();
  }
});
```

### 4. Create Triggered Response

```typescript
function createTriggeredResponse() {
  // Create a single response using accumulated context
  session.current.transport.sendEvent({
    type: 'response.create',
    response: {
      modalities: ['text', 'audio'], // ← Request audio output
      instructions: 'Provide guidance based on conversation context',
    },
  });
  // Session already has all committed audio as context!
}
```

### 5. Return to Silence

```typescript
session.current.on('transport_event', (event) => {
  if (event.type === 'response.done') {
    // Response finished
    // Just don't create another response - back to silent listening
    // Continue collecting audio context for next trigger
  }
});
```

## State Flow

```
[SILENT LISTENING - Collecting Context]
      ↓
   User speaks: "What is 2+2?"
      ↓
   input_audio_buffer.speech_stopped
      ↓
   Send: input_audio_buffer.commit
      ↓
   conversation.item.created (audio added to context)
      ↓
   [SILENT - Context accumulated, no response]
      ↓
   User speaks: "Good question"
      ↓
   input_audio_buffer.speech_stopped → commit
      ↓
   Trigger phrase detected!
      ↓
   Send: response.create (with audio modality)
      ↓
   [Generate audio response using ALL accumulated context]
      ↓
   [Play response to user]
      ↓
   response.done event
      ↓
   [Back to SILENT LISTENING - Continue collecting context]
```

## Key Events

### input_audio_buffer.speech_stopped
```typescript
{
  type: 'input_audio_buffer.speech_stopped'
}
```
Fired when silence is detected. Time to commit the audio.

### input_audio_buffer.commit
```typescript
{
  type: 'input_audio_buffer.commit'
}
```
Commits buffered audio to the conversation as context.

### conversation.item.created
```typescript
{
  type: 'conversation.item.created',
  item: {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_audio', transcript: '...' }]
  }
}
```
Audio has been added to conversation context.

### response.create
```typescript
{
  type: 'response.create',
  response: {
    modalities: ['text', 'audio'],  // Request audio output
    instructions: '...'              // Context for this response
  }
}
```
Creates a single response. Session context is automatically included.

### response.done
```typescript
{
  type: 'response.done'
}
```
Response complete. Back to silent listening.

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

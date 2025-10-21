# Quick Start Guide

## 1. Set up your OpenAI API Key

Create a `.env` file in the project root:

```bash
echo "OPENAI_API_KEY=sk-your-key-here" > .env
```

Replace `sk-your-key-here` with your actual OpenAI API key.

## 2. Start the Development Server

```bash
pnpm dev
```

The app will be available at [http://localhost:3000](http://localhost:3000)

## 3. First-Time Usage

### Step 1: Configure Settings
Before connecting, customize your trigger phrases and durations:
- **Quick Hint Phrase**: Default is "good question"
- **Full Guidance Phrase**: Default is "let me think"
- **Interrupt Phrases**: Default is "got it, thanks, stop"
- **Durations**: Adjust how long each response should be

### Step 2: Connect
1. Click the blue "Connect" button
2. Allow microphone access when prompted
3. Wait for the green "Connected" indicator

### Step 3: Test Voice Triggers
Try saying:
- "Hello, can you hear me?" (agent listens but doesn't respond)
- "What's 2 + 2?" (agent listens)
- "Good question" → Agent gives a quick hint!
- "Let me think" → Agent provides full guidance!

### Step 4: Test Manual Triggers
- Click "🚀 Quick Hint" button for immediate brief response
- Click "💡 Full Guidance" button for detailed response
- Click "⛔ Interrupt" button while agent is speaking

### Step 5: Test Interruption
- Let the agent start speaking
- Say "got it" or "thanks" to interrupt
- Or click the "Interrupt" button

## 4. Understanding the Interface

### Status Indicators
- 🟢 **Green**: Connected to voice agent
- 🔵 **Blue**: Actively listening to you
- 🟣 **Purple**: Agent is speaking

### Transcript Panel
- Shows all conversation in real-time
- Blue bubbles = Your speech
- White bubbles = Agent responses
- Auto-scrolls to latest message

### Event Log
- Bottom right panel shows technical events
- Useful for debugging
- Shows last 10 events

## 5. Common Use Cases

### Use Case 1: Interview Practice
1. Connect to the agent
2. Practice answering interview questions
3. Say "good question" after each question for quick tips
4. Say "let me think" for detailed feedback

### Use Case 2: Study Assistant
1. Read aloud while studying
2. When you hit a concept you don't understand, say "let me think"
3. Get detailed explanations based on what you just read

### Use Case 3: Presentation Coach
1. Practice your presentation
2. Say "good question" for quick improvement tips
3. Say "let me think" for comprehensive feedback

## 6. Troubleshooting

### "Microphone access denied"
- Check browser settings
- Ensure you're using HTTPS or localhost
- Try a different browser

### "Agent not responding to my voice"
- Check the transcript - is your speech being recognized?
- Try speaking more clearly
- Use manual trigger buttons as backup
- Ensure you're not muted (blue indicator should be on)

### "Connection failed"
- Verify your API key is correct in `.env`
- Ensure your OpenAI account has Realtime API access
- Restart the dev server: `pnpm dev`

## 7. Tips for Best Experience

1. **Speak Clearly**: The agent uses speech recognition, so clear pronunciation helps
2. **Wait for Blue**: Ensure the "Listening" indicator is blue before speaking
3. **Use Manual Buttons**: If voice triggers aren't working, use the buttons
4. **Customize First**: Set up your preferred phrases before connecting
5. **Monitor Transcript**: Watch the transcript to see what the agent hears

## Next Steps

- Read the full [README.md](./README.md) for architecture details
- Customize the agent instructions in `app/page.tsx`
- Add your own trigger phrases in the settings panel
- Experiment with different response durations

Enjoy your voice agent! 🎤✨

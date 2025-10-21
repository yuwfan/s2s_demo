'use client';

import {
  RealtimeAgent,
  RealtimeSession,
  TransportEvent,
  RealtimeItem,
} from '@openai/agents/realtime';
import { useEffect, useRef, useState } from 'react';
import { getToken } from './server/token.action';
import { Button } from '@/components/ui/Button';
import { TranscriptDisplay, TranscriptItem } from '@/components/TranscriptDisplay';
import { SettingsPanel, VoiceSettings } from '@/components/SettingsPanel';

const DEFAULT_SETTINGS: VoiceSettings = {
  quickHintPhrase: 'good question',
  fullGuidancePhrase: 'let me think',
  interruptPhrases: ['got it', 'thanks', 'stop'],
  quickHintDuration: 10,
  fullGuidanceDuration: 20,
};

export default function Home() {
  const session = useRef<RealtimeSession<any> | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [events, setEvents] = useState<TransportEvent[]>([]);
  const [currentTranscript, setCurrentTranscript] = useState('');
  const [conversationHistory, setConversationHistory] = useState<string[]>([]);

  // Create agent with simplified instructions for triggered responses
  const createAgent = (settings: VoiceSettings) => {
    const instructions = `You are a helpful voice assistant. When asked to provide a hint or guidance, base your response on the recent conversation context.

For quick hints (${settings.quickHintDuration} seconds): Provide brief, actionable advice in 1-2 sentences.
For full guidance (${settings.fullGuidanceDuration} seconds): Provide comprehensive step-by-step explanations with context and examples.

Always be concise, helpful, and base responses on what the user was discussing.`;

    return new RealtimeAgent({
      name: 'Voice Assistant',
      instructions,
      tools: [],
    });
  };

  useEffect(() => {
    const agent = createAgent(settings);

    session.current = new RealtimeSession(agent, {
      model: 'gpt-realtime',
      config: {
        voice: 'alloy',
      },
    });

    // Configure session for text-only mode with server VAD after connection
    session.current.on('transport_event', (event) => {
      if (event.type === 'session.created') {
        // Set up text-only mode with server VAD
        session.current?.transport?.sendEvent({
          type: 'session.update',
          session: {
            modalities: ['text'],
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        });
      }
    });

    // Listen to all transport events
    session.current.on('transport_event', (event) => {
      setEvents((prev) => [...prev, event]);

      // Track when agent starts/stops speaking
      if (event.type === 'response.audio.delta') {
        setIsSpeaking(true);
      }
      if (event.type === 'response.done') {
        setIsSpeaking(false);

        // Switch back to text-only mode after response completes
        session.current?.transport?.sendEvent({
          type: 'session.update',
          session: {
            modalities: ['text'],
          },
        });
      }
    });

    // Listen to conversation history updates
    session.current.on('history_updated', (history: RealtimeItem[]) => {
      const newTranscripts: TranscriptItem[] = [];
      let latestUserText = '';

      history.forEach((item) => {
        if (item.type === 'message') {
          item.content.forEach((content) => {
            let text = '';
            if (content.type === 'input_text') {
              text = content.text;
            } else if (content.type === 'output_text') {
              text = content.text;
            } else if (content.type === 'input_audio' && content.transcript) {
              text = content.transcript;
            } else if (content.type === 'output_audio' && content.transcript) {
              text = content.transcript;
            }

            if (text) {
              newTranscripts.push({
                id: `${item.itemId}-${content.type}`,
                role: item.role === 'user' ? 'user' : 'assistant',
                text,
                timestamp: new Date(),
              });

              // Update conversation history for context
              if (item.role === 'user') {
                latestUserText = text;
                setConversationHistory((prev) => [...prev, text].slice(-10)); // Keep last 10 messages
              }
            }
          });
        }
      });

      // Detect trigger phrases and switch to audio mode for response
      if (latestUserText) {
        const textLower = latestUserText.toLowerCase();
        const quickHintDetected = textLower.includes(settings.quickHintPhrase.toLowerCase());
        const fullGuidanceDetected = textLower.includes(settings.fullGuidancePhrase.toLowerCase());

        if (quickHintDetected || fullGuidanceDetected) {
          // Determine the type of response needed
          const responseType = quickHintDetected ? 'quick hint' : 'full guidance';
          const context = conversationHistory.slice(quickHintDetected ? -3 : -10).join(' ');

          // Switch to audio mode and create a response
          setTimeout(() => {
            // First, switch session to include audio in modalities
            session.current?.transport?.sendEvent({
              type: 'session.update',
              session: {
                modalities: ['text', 'audio'],
              },
            });

            // Then create a response with the context
            setTimeout(() => {
              session.current?.transport?.sendEvent({
                type: 'response.create',
                response: {
                  modalities: ['text', 'audio'],
                  instructions: `The user said "${settings.quickHintPhrase}" or "${settings.fullGuidancePhrase}".
                  Provide a ${responseType} based on this recent conversation: "${context}".
                  Keep it to about ${quickHintDetected ? settings.quickHintDuration : settings.fullGuidanceDuration} seconds.`,
                },
              });
            }, 100);
          }, 100);
        }
      }

      setTranscripts(newTranscripts);
    });

    // Listen for errors
    session.current.on('error', (error) => {
      console.error('Session error:', error);
    });

    return () => {
      session.current?.close();
    };
  }, [settings]);

  async function connect() {
    if (isConnected) {
      await session.current?.close();
      setIsConnected(false);
      setIsSpeaking(false);
      setIsListening(true);
    } else {
      const token = await getToken();
      try {
        await session.current?.connect({
          apiKey: token,
        });
        setIsConnected(true);
        setIsListening(true);
      } catch (error) {
        console.error('Error connecting to session', error);
      }
    }
  }

  async function toggleMute() {
    if (isListening) {
      await session.current?.mute(true);
      setIsListening(false);
    } else {
      await session.current?.mute(false);
      setIsListening(true);
    }
  }

  // Trigger response via button - switch to audio mode and create response
  async function triggerQuickHint() {
    if (!session.current || !isConnected) return;

    const context = conversationHistory.slice(-3).join(' '); // Last 3 messages

    // Switch to audio mode
    session.current.transport?.sendEvent({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
      },
    });

    // Create response with audio
    setTimeout(() => {
      session.current?.transport?.sendEvent({
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: `Provide a quick hint (${settings.quickHintDuration} seconds) based on this conversation: "${context}". Be brief and actionable.`,
        },
      });
    }, 100);
  }

  async function triggerFullGuidance() {
    if (!session.current || !isConnected) return;

    const context = conversationHistory.join(' '); // Full history

    // Switch to audio mode
    session.current.transport?.sendEvent({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
      },
    });

    // Create response with audio
    setTimeout(() => {
      session.current?.transport?.sendEvent({
        type: 'response.create',
        response: {
          modalities: ['text', 'audio'],
          instructions: `Provide full guidance (${settings.fullGuidanceDuration} seconds) based on this conversation: "${context}". Be comprehensive with steps and examples.`,
        },
      });
    }, 100);
  }

  async function interruptAgent() {
    if (!session.current || !isConnected || !isSpeaking) return;

    // Cancel the current response
    session.current.transport?.sendEvent({
      type: 'response.cancel',
    });
    setIsSpeaking(false);

    // Switch back to text-only mode
    session.current.transport?.sendEvent({
      type: 'session.update',
      session: {
        modalities: ['text'],
      },
    });
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">
            Voice Agent Demo - Trigger Phrases
          </h1>
          <p className="text-gray-600 mt-2">
            Intelligent voice assistant that listens and responds to trigger phrases
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Transcript Area */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status Bar */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      isConnected
                        ? 'bg-green-500 animate-pulse'
                        : 'bg-gray-300'
                    }`}
                  />
                  <span className="text-sm font-medium">
                    {isConnected ? 'Connected' : 'Disconnected'}
                  </span>
                </div>
                {isConnected && (
                  <>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          isListening ? 'bg-blue-500' : 'bg-gray-300'
                        }`}
                      />
                      <span className="text-sm">
                        {isListening ? 'Listening' : 'Muted'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          isSpeaking ? 'bg-purple-500 animate-pulse' : 'bg-gray-300'
                        }`}
                      />
                      <span className="text-sm">
                        {isSpeaking ? 'Speaking' : 'Silent'}
                      </span>
                    </div>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                {isConnected && (
                  <Button
                    onClick={toggleMute}
                    variant={isListening ? 'default' : 'outline'}
                    size="sm"
                  >
                    {isListening ? 'Mute' : 'Unmute'}
                  </Button>
                )}
                <Button
                  onClick={connect}
                  variant={isConnected ? 'danger' : 'primary'}
                >
                  {isConnected ? 'Disconnect' : 'Connect'}
                </Button>
              </div>
            </div>

            {/* Transcript Display */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 h-[500px] flex flex-col">
              <h2 className="text-lg font-semibold mb-4">Live Transcript</h2>
              <TranscriptDisplay items={transcripts} />
            </div>

            {/* Manual Trigger Buttons */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold mb-3 text-gray-700">
                Manual Triggers (Alternative to voice commands)
              </h3>
              <div className="flex gap-3">
                <Button
                  onClick={triggerQuickHint}
                  disabled={!isConnected || isSpeaking}
                  variant="success"
                  className="flex-1"
                >
                  🚀 Quick Hint ({settings.quickHintDuration}s)
                </Button>
                <Button
                  onClick={triggerFullGuidance}
                  disabled={!isConnected || isSpeaking}
                  variant="warning"
                  className="flex-1"
                >
                  💡 Full Guidance ({settings.fullGuidanceDuration}s)
                </Button>
                <Button
                  onClick={interruptAgent}
                  disabled={!isConnected || !isSpeaking}
                  variant="danger"
                >
                  ⛔ Interrupt
                </Button>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Or say the trigger phrases: "{settings.quickHintPhrase}" or "
                {settings.fullGuidancePhrase}"
              </p>
            </div>
          </div>

          {/* Settings Sidebar */}
          <div className="space-y-4">
            <SettingsPanel
              settings={settings}
              onSettingsChange={setSettings}
              isConnected={isConnected}
            />

            {/* Event Log */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h3 className="text-sm font-semibold mb-3 text-gray-700">
                Event Log
              </h3>
              <div className="max-h-64 overflow-y-auto text-xs space-y-1">
                {events.slice(-10).reverse().map((event, i) => (
                  <div
                    key={i}
                    className="p-2 bg-gray-50 rounded border border-gray-100"
                  >
                    <div className="font-mono text-blue-600">{event.type}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

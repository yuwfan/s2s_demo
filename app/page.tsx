'use client';

import {
  RealtimeAgent,
  RealtimeSession,
  TransportEvent,
  RealtimeItem,
} from '@openai/agents/realtime';
import { useEffect, useRef, useState } from 'react';
import { WavRecorder, WavStreamPlayer } from 'wavtools';
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
  const recorder = useRef<WavRecorder | null>(null);
  const player = useRef<WavStreamPlayer | null>(null);

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [events, setEvents] = useState<TransportEvent[]>([]);
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

    // Use WebSocket transport for manual audio control
    session.current = new RealtimeSession(agent, {
      transport: 'websocket',
      model: 'gpt-realtime',
      config: {
        modalities: ['text'], // Text-only mode - agent cannot produce audio
        voice: 'alloy',
        turn_detection: null, // Disable automatic turn detection
        input_audio_transcription: {
          model: 'whisper-1', // Enable transcription
        },
      },
    });

    // Set up audio recorder and player
    recorder.current = new WavRecorder({ sampleRate: 24000 });
    player.current = new WavStreamPlayer({ sampleRate: 24000 });

    // Handle all transport events
    session.current.on('transport_event', (event) => {
      setEvents((prev) => [...prev, event]);

      // Check for and suppress expected empty buffer errors first
      if (event.type === 'error') {
        // @ts-ignore - error event structure
        const errorCode = event.error?.code;

        // Suppress expected "empty buffer" errors - these happen when VAD
        // fires before any audio has been sent (e.g., at session start)
        if (errorCode === 'input_audio_buffer_commit_empty') {
          // Silently ignore - this is expected behavior at session start
          return;
        }

        // Log other errors
        console.group('🔴 Server Error Event');
        console.error('Server error event:', event);
        console.error('Error details:', JSON.stringify(event, null, 2));
        console.groupEnd();
        return;
      }

      // Log important events for debugging (after filtering out suppressed errors)
      if (event.type === 'session.created') {
        console.log('📡 Transport event:', event.type, event);
        // @ts-ignore
        const sessionData = event.session;
        console.log('  Initial session config:', sessionData);

        // Configure session for silent listening with transcription
        console.log('🔧 Configuring session for trigger-based responses...');
        session.current?.transport?.sendEvent({
          type: 'session.update',
          session: {
            type: 'realtime', // Required field
            output_modalities: ['text'], // Text-only mode - prevents audio responses
            audio: {
              input: {
                transcription: {
                  model: 'whisper-1', // Enable transcription for trigger detection
                },
                turn_detection: {
                  type: 'server_vad',
                  create_response: false, // CRITICAL: Disable auto-response
                },
              },
              output: {
                voice: 'alloy', // Voice config
              },
            },
          },
        });
      }

      if (event.type === 'session.updated') {
        console.log('📡 Transport event:', event.type);
        // @ts-ignore
        const sessionData = event.session;
        console.log('  output_modalities:', sessionData?.output_modalities);
        console.log('  audio.input.transcription:', sessionData?.audio?.input?.transcription);
        console.log('  audio.input.turn_detection:', sessionData?.audio?.input?.turn_detection);
        console.log('  create_response:', sessionData?.audio?.input?.turn_detection?.create_response);
      }

      // Server VAD detected speech starting
      if (event.type === 'input_audio_buffer.speech_started') {
        console.log('🎤 Speech started');
      }

      // Server VAD detected end of speech
      // DON'T commit automatically - we'll commit manually when we want to create a response
      if (event.type === 'input_audio_buffer.speech_stopped') {
        console.log('🎤 Speech stopped (audio buffered, not committed)');
        // Audio stays in buffer, waiting for manual commit when triggered
      }

      // Audio successfully committed to conversation
      if (event.type === 'input_audio_buffer.committed') {
        console.log('✅ Audio committed to conversation context');
      }

      // Listen for transcription completion (without committing)
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        // @ts-ignore
        const transcript = event.transcript;
        console.log('📝 Transcript (uncommitted):', transcript);

        if (transcript) {
          const textLower = transcript.toLowerCase();
          const quickHintDetected = textLower.includes(settings.quickHintPhrase.toLowerCase());
          const fullGuidanceDetected = textLower.includes(settings.fullGuidancePhrase.toLowerCase());

          if (quickHintDetected || fullGuidanceDetected) {
            console.log(`🎯 Trigger detected: "${transcript}"`);

            const responseType = quickHintDetected ? 'quick hint' : 'full guidance';
            const duration = quickHintDetected ? settings.quickHintDuration : settings.fullGuidanceDuration;

            console.log(`📤 Creating ${responseType} response with audio...`);

            // Create response with audio modality (overrides session default)
            session.current?.transport?.sendEvent({
              type: 'response.create',
              response: {
                modalities: ['text', 'audio'], // Enable audio for this response only
                instructions: `Provide a ${responseType} (around ${duration} seconds) based on the conversation context. ${
                  quickHintDetected
                    ? 'Be brief and actionable, 1-2 sentences.'
                    : 'Be comprehensive with steps and examples.'
                }`,
              },
            });
          }
        }
      }

      // Track response lifecycle for debugging
      if (event.type === 'response.created') {
        console.log('📝 Response created by server');
      }

      if (event.type === 'response.output_item.added') {
        console.log('📝 Response output item added');
      }

      // Handle audio output from agent responses
      if (event.type === 'response.audio.delta') {
        setIsSpeaking(true);
        // @ts-ignore - audio delta structure
        const audioData = event.delta;
        if (audioData && player.current) {
          // @ts-ignore
          player.current.add16BitPCM(audioData, event.item_id);
        }
      }

      if (event.type === 'response.done') {
        console.log('✅ Response complete');
        setIsSpeaking(false);
      }

      // Handle audio interruption
      if (event.type === 'response.audio_transcript.done' || event.type === 'conversation.item.input_audio_transcription.completed') {
        player.current?.interrupt();
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

      // Detect trigger phrases and create single audio response
      if (latestUserText) {
        const textLower = latestUserText.toLowerCase();
        const quickHintDetected = textLower.includes(settings.quickHintPhrase.toLowerCase());
        const fullGuidanceDetected = textLower.includes(settings.fullGuidancePhrase.toLowerCase());

        if (quickHintDetected || fullGuidanceDetected) {
          console.log(`🎯 Trigger detected: "${latestUserText}"`);
          // Create a SINGLE audio response based on accumulated context
          // The session already has all committed audio as context
          const responseType = quickHintDetected ? 'quick hint' : 'full guidance';
          const duration = quickHintDetected ? settings.quickHintDuration : settings.fullGuidanceDuration;

          setTimeout(() => {
            console.log(`📤 Creating ${responseType} response...`);
            session.current?.transport?.sendEvent({
              type: 'response.create',
              response: {
                modalities: ['text', 'audio'], // Request audio output for this response
                instructions: `Provide a ${responseType} (around ${duration} seconds) based on the conversation context. ${
                  quickHintDetected
                    ? 'Be brief and actionable, 1-2 sentences.'
                    : 'Be comprehensive with steps and examples.'
                }`,
              },
            });
          }, 100);
        }
      }

      setTranscripts(newTranscripts);
    });

    // Listen for errors with comprehensive logging
    session.current.on('error', (error: any) => {
      // Suppress expected "empty buffer" errors - these happen when VAD
      // fires before any audio has been sent (e.g., at session start)
      const errorCode = error?.error?.error?.code;
      if (errorCode === 'input_audio_buffer_commit_empty') {
        // Silently ignore - this is expected behavior at session start
        return;
      }

      console.group('🔴 Session Error Captured');
      console.error('Raw error object:', error);
      console.error('Error type:', typeof error);
      console.error('Error constructor:', error?.constructor?.name);

      if (error instanceof Error) {
        console.error('Error.message:', error.message);
        console.error('Error.stack:', error.stack);
        console.error('Error.name:', error.name);
      }

      try {
        console.error('JSON.stringify:', JSON.stringify(error, null, 2));
      } catch (e) {
        console.error('Cannot stringify error:', e);
      }

      console.error('Object.keys:', error ? Object.keys(error) : 'null/undefined');
      console.error('Object.getOwnPropertyNames:', error ? Object.getOwnPropertyNames(error) : 'null/undefined');

      // Try to extract all properties
      if (error && typeof error === 'object') {
        const allProps = Object.getOwnPropertyNames(error);
        allProps.forEach(key => {
          try {
            console.error(`  ${key}:`, (error as any)[key]);
          } catch (e) {
            console.error(`  ${key}: [Cannot access]`);
          }
        });
      }

      console.groupEnd();
    });

    return () => {
      session.current?.close();
    };
  }, [settings]);

  async function startRecording() {
    await recorder.current?.record(async (data: any) => {
      // Send audio to the session
      if (session.current && data.mono) {
        try {
          await session.current.sendAudio(data.mono as unknown as ArrayBuffer);
          // Log occasionally to confirm audio is flowing
          if (Math.random() < 0.01) { // 1% of chunks
            console.log('🎤 Sending audio chunk, size:', data.mono.byteLength);
          }
        } catch (error) {
          console.error('Error sending audio:', error);
        }
      }
    });
  }

  async function connect() {
    if (isConnected) {
      console.log('Disconnecting...');
      await session.current?.close();
      await player.current?.interrupt();
      await recorder.current?.end();
      setIsConnected(false);
      setIsListening(false);
    } else {
      console.log('Connecting to session...');
      try {
        await player.current?.connect();
        console.log('Player connected');

        const token = await getToken();
        console.log('Got token, connecting session...');

        await session.current?.connect({
          apiKey: token,
        });
        console.log('Session connected');

        await recorder.current?.begin();
        console.log('Recorder initialized');

        await startRecording();
        console.log('Recording started');

        setIsConnected(true);
        setIsListening(true);
        console.log('✅ Connection complete');
      } catch (error) {
        console.group('❌ Connection Error');
        console.error('Error connecting to session:', error);
        if (error instanceof Error) {
          console.error('Message:', error.message);
          console.error('Stack:', error.stack);
        }
        console.groupEnd();
      }
    }
  }

  async function toggleMute() {
    if (isListening) {
      await recorder.current?.pause();
      setIsListening(false);
    } else {
      await startRecording();
      setIsListening(true);
    }
  }

  // Trigger response via button - create single audio response from accumulated context
  async function triggerQuickHint() {
    if (!session.current || !isConnected) return;

    // Create a single audio response
    // Session already has all committed audio turns as context
    session.current.transport?.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['audio'], // Audio output only (add 'text' if you want transcript)
        instructions: `Provide a quick hint (around ${settings.quickHintDuration} seconds) based on the recent conversation context. Be brief and actionable, 1-2 sentences.`,
      },
    });
  }

  async function triggerFullGuidance() {
    if (!session.current || !isConnected) return;

    // Create a single audio response
    // Session already has all committed audio turns as context
    session.current.transport?.sendEvent({
      type: 'response.create',
      response: {
        modalities: ['audio'], // Audio output only
        instructions: `Provide full guidance (around ${settings.fullGuidanceDuration} seconds) based on the entire conversation context. Be comprehensive with steps and examples.`,
      },
    });
  }

  async function interruptAgent() {
    if (!session.current || !isConnected || !isSpeaking) return;

    // Cancel the current response and return to silent listening
    session.current.transport?.sendEvent({
      type: 'response.cancel',
    });
    setIsSpeaking(false);
    // Back to silent mode - just don't create another response
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

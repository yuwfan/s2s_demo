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
  interruptPhrases: ['got it'],
  quickHintDuration: 10,
  fullGuidanceDuration: 20,
};

export default function Home() {
  const session = useRef<RealtimeSession<any> | null>(null);
  const recorder = useRef<WavRecorder | null>(null);
  const player = useRef<WavStreamPlayer | null>(null);
  const transcriptCache = useRef<Map<string, string>>(new Map()); // Cache transcripts by item_id

  // Agent states
  type AgentState = 'idle' | 'listening' | 'generating' | 'speaking';
  const [agentState, setAgentState] = useState<AgentState>('idle');
  const isPlayingAudio = useRef(false); // Track if audio is actually playing

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(true);
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [transcripts, setTranscripts] = useState<TranscriptItem[]>([]);
  const [events, setEvents] = useState<TransportEvent[]>([]);
  const [conversationHistory, setConversationHistory] = useState<string[]>([]);

  // Create agent with simplified instructions for triggered responses
  const createAgent = (settings: VoiceSettings) => {
    const instructions = `You are a helpful voice assistant. ALWAYS respond in English, regardless of the language used in the conversation.

When asked to provide a hint or guidance, base your response on the recent conversation context.

For quick hints (${settings.quickHintDuration} seconds): Provide brief, actionable advice in 1-2 sentences.
For full guidance (${settings.fullGuidanceDuration} seconds): Provide comprehensive step-by-step explanations with context and examples.

Always be concise, helpful, and base responses on what the user was discussing. Remember: ALWAYS use English for all responses.`;

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
          model: 'gpt-4o-mini-transcribe', // More accurate real-time transcription
          language: 'en', // Force English transcription
        },
      },
    });

    // Set up audio recorder and player
    recorder.current = new WavRecorder({ sampleRate: 24000 });
    player.current = new WavStreamPlayer({ sampleRate: 24000 });

    // Handle all transport events
    session.current.on('transport_event', (event) => {
      setEvents((prev) => [...prev, event]);

      // Check for and suppress expected errors first
      if (event.type === 'error') {
        // @ts-ignore - error event structure
        const errorCode = event.error?.code;

        // Suppress expected "empty buffer" errors - these happen when VAD
        // fires before any audio has been sent (e.g., at session start)
        if (errorCode === 'input_audio_buffer_commit_empty') {
          // Silently ignore - this is expected behavior at session start
          return;
        }

        // Suppress "response_cancel_not_active" - happens when we try to cancel
        // after response finished but audio is still playing
        if (errorCode === 'response_cancel_not_active') {
          console.log('ℹ️ Response already completed (audio was still playing)');
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
                  model: 'gpt-4o-transcribe', // More accurate real-time transcription
                  language: 'en', // Force English transcription
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

      // Server VAD detected speech starting - interrupt immediately if audio is playing
      if (event.type === 'input_audio_buffer.speech_started') {
        console.log(`🎤 Speech started - agentState: ${agentState}, isPlayingAudio: ${isPlayingAudio.current}`);

        // IMMEDIATE barge-in: Stop agent if audio is playing OR if generating/speaking
        if (isPlayingAudio.current || agentState === 'speaking' || agentState === 'generating') {
          console.log(`⚡ BARGE-IN: User started speaking while audio playing - interrupting IMMEDIATELY`);
          interruptAgent();
        } else {
          console.log(`ℹ️ Speech started but no audio playing (agent state: ${agentState})`);
        }
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

          // Check for interrupt phrases first
          const interruptDetected = settings.interruptPhrases.some(phrase =>
            textLower.includes(phrase.toLowerCase())
          );

          if (interruptDetected && (agentState === 'speaking' || agentState === 'generating')) {
            console.log(`⛔ Interrupt phrase detected during ${agentState}: "${transcript}"`);
            interruptAgent();
            return;
          }

          // Check for trigger phrases
          const quickHintDetected = textLower.includes(settings.quickHintPhrase.toLowerCase());
          const fullGuidanceDetected = textLower.includes(settings.fullGuidancePhrase.toLowerCase());

          if (quickHintDetected || fullGuidanceDetected) {
            // Check if already generating a response
            if (agentState === 'generating' || agentState === 'speaking') {
              console.log(`⚠️ Agent is ${agentState}, ignoring trigger`);
              return;
            }

            console.log(`🎯 Trigger detected: "${transcript}"`);
            setAgentState('generating');

            const responseType = quickHintDetected ? 'quick hint' : 'full guidance';
            const duration = quickHintDetected ? settings.quickHintDuration : settings.fullGuidanceDuration;

            console.log(`📤 Switching to audio mode and creating ${responseType} response...`);

            // First, switch session to audio mode
            session.current?.transport?.sendEvent({
              type: 'session.update',
              session: {
                type: 'realtime',
                output_modalities: ['audio'], // Audio-only mode for voice response
              },
            });

            // Then create response (audio will be generated)
            setTimeout(() => {
              const instructions = `RESPOND IN ENGLISH ONLY. Provide a ${responseType} (around ${duration} seconds) based on the conversation context. ${
                quickHintDetected
                  ? 'Be brief and actionable, 1-2 sentences.'
                  : 'Be comprehensive with steps and examples.'
              }`;

              // Log the complete request context being sent to the LLM
              console.group('🤖 LLM Request Details (Voice Trigger)');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('Trigger Type:', quickHintDetected ? 'Quick Hint' : 'Full Guidance');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('\n📋 INSTRUCTIONS SENT TO LLM:');
              console.log(instructions);
              console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('💬 CONVERSATION CONTEXT (Full Session History):');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

              // Get the current session history
              const currentHistory = session.current?.getHistory() || [];
              if (currentHistory.length > 0) {
                currentHistory.forEach((item, idx) => {
                  if (item.type === 'message') {
                    const role = item.role === 'user' ? '👤 USER' : '🤖 ASSISTANT';
                    console.log(`\n${idx + 1}. ${role}:`);
                    item.content.forEach((content) => {
                      if (content.type === 'input_text') {
                        console.log(`   [Text Input] ${content.text}`);
                      } else if (content.type === 'output_text') {
                        console.log(`   [Text Output] ${content.text}`);
                      } else if (content.type === 'input_audio') {
                        console.log(`   [Audio Input] "${content.transcript || '[No transcript]'}"`);
                      } else if (content.type === 'output_audio') {
                        console.log(`   [Audio Output] "${content.transcript || '[No transcript]'}"`);
                      } else {
                        console.log(`   [${content.type}]`, content);
                      }
                    });
                  }
                });
              } else {
                console.log('(No conversation history yet)');
              }

              console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.log('ℹ️ The Realtime API will use ALL messages above as context for generating the response.');
              console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
              console.groupEnd();

              session.current?.transport?.sendEvent({
                type: 'response.create',
                response: {
                  instructions,
                },
              });
            }, 100);
          }
        }
      }

      // Track response lifecycle for debugging
      if (event.type === 'response.created') {
        console.log('📝 Response created by server');
        setAgentState('generating');
      }

      if (event.type === 'response.output_item.added') {
        console.log('📝 Response output item added');
      }

      // Handle audio output from agent responses
      if (event.type === 'response.output_audio.delta') {
        console.log('🔊 Audio delta received, size:', event.delta?.length);
        setAgentState('speaking');
        isPlayingAudio.current = true; // Mark that audio is playing
        // @ts-ignore - audio delta structure
        const audioData = event.delta;
        if (audioData && player.current) {
          // Decode base64 audio data
          const binaryString = atob(audioData);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const int16Array = new Int16Array(bytes.buffer);
          player.current.add16BitPCM(int16Array, event.item_id);
        }
      }

      // Track when audio generation finishes (not playback)
      if (event.type === 'response.output_audio.done') {
        console.log('🔇 Audio generation complete (playback may continue)');
        // Keep state as 'speaking' - audio is still playing
      }

      // Capture audio transcript when it completes
      if (event.type === 'response.output_audio_transcript.done') {
        console.log('🎯 Output audio transcript done event received!', event);
        // @ts-ignore
        const itemId = event.item_id;
        // @ts-ignore
        const transcript = event.transcript;
        console.log(`  item_id: ${itemId}, transcript length: ${transcript?.length}`);
        if (itemId && transcript) {
          console.log(`💾 Caching transcript for ${itemId}: ${transcript.substring(0, 50)}...`);
          transcriptCache.current.set(itemId, transcript);
        }
      }

      if (event.type === 'response.done') {
        console.log('✅ Response generation complete - switching back to text-only mode');

        // Switch back to text-only mode (silent) for future responses
        session.current?.transport?.sendEvent({
          type: 'session.update',
          session: {
            type: 'realtime',
            output_modalities: ['text'], // Back to text-only (silent)
          },
        });

        // Keep audio playing flag true for a bit longer to allow playback to finish
        setTimeout(() => {
          console.log('🔇 Clearing audio playing flag');
          isPlayingAudio.current = false;
          setAgentState((currentState) => {
            // Only transition if we haven't been interrupted
            if (currentState === 'speaking') {
              console.log('🔇 Audio playback complete - back to listening');
              return 'listening';
            }
            return currentState;
          });
        }, 5000); // 5 second buffer for audio playback to complete
      }

      // Audio interruption is handled separately via the interruptAgent() function
      // Don't auto-interrupt on transcription events
    });

    // Listen to conversation history updates
    session.current.on('history_updated', (history: RealtimeItem[]) => {
      console.log('📜 History updated, total items:', history.length);
      const newTranscripts: TranscriptItem[] = [];
      let latestUserText = '';

      history.forEach((item) => {
        if (item.type === 'message') {
          item.content.forEach((content, contentIndex) => {
            let text = '';
            if (content.type === 'input_text') {
              text = content.text;
            } else if (content.type === 'output_text') {
              text = content.text;
            } else if (content.type === 'input_audio') {
              // Check both transcript and audio properties
              text = content.transcript || '';
            } else if (content.type === 'output_audio') {
              // For output_audio, use transcript if available, otherwise check cache by item ID
              // The content doesn't have a stable ID, so we use the parent item's itemId
              text = content.transcript || transcriptCache.current.get(item.itemId) || '';

              // Debug: Log the full content structure
              if (!text) {
                console.log(`  Output audio content:`, JSON.stringify(content, null, 2));
                console.log(`  Checking cache for item ID: ${item.itemId}, found: ${transcriptCache.current.has(item.itemId)}`);
              }
            }

            if (text) {
              console.log(`  Adding to transcript: [${item.role}] ${text.substring(0, 50)}...`);
              newTranscripts.push({
                id: `${item.itemId}-${content.type}-${contentIndex}`,
                role: item.role === 'user' ? 'user' : 'assistant',
                text,
                timestamp: new Date(),
              });

              // Update conversation history for context
              if (item.role === 'user') {
                latestUserText = text;
                setConversationHistory((prev) => [...prev, text].slice(-10)); // Keep last 10 messages
              }
            } else {
              // Debug: log items without transcripts
              console.log(`  Skipping item: role=${item.role}, content.type=${content.type}, has transcript=${!!content.transcript}`);
            }
          });
        }
      });

      console.log(`📜 Total transcripts: ${newTranscripts.length}`);
      setTranscripts(newTranscripts);
    });

    // Listen for errors with comprehensive logging
    session.current.on('error', (error: any) => {
      // Suppress expected errors
      const errorCode = error?.error?.error?.code;

      // Suppress expected "empty buffer" errors - these happen when VAD
      // fires before any audio has been sent (e.g., at session start)
      if (errorCode === 'input_audio_buffer_commit_empty') {
        // Silently ignore - this is expected behavior at session start
        return;
      }

      // Suppress "response_cancel_not_active" - happens when we interrupt
      // after response finished but audio is still playing
      if (errorCode === 'response_cancel_not_active') {
        console.log('ℹ️ Response already completed (audio was still playing)');
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

  // Trigger response via button - switch to audio mode and create response
  async function triggerQuickHint() {
    if (!session.current || !isConnected) return;
    if (agentState === 'generating' || agentState === 'speaking') {
      console.log(`⚠️ Agent is ${agentState}, ignoring button click`);
      return;
    }

    console.log('📤 Manual trigger: Quick Hint - switching to audio mode...');
    setAgentState('generating');

    // Switch to audio mode
    session.current.transport?.sendEvent({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'], // Audio-only mode for voice response
      },
    });

    // Create response
    setTimeout(() => {
      const instructions = `RESPOND IN ENGLISH ONLY. Provide a quick hint (around ${settings.quickHintDuration} seconds) based on the recent conversation context. Be brief and actionable, 1-2 sentences.`;

      // Log the complete request context being sent to the LLM
      console.group('🤖 LLM Request Details (Manual Quick Hint Button)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n📋 INSTRUCTIONS SENT TO LLM:');
      console.log(instructions);
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('💬 CONVERSATION CONTEXT (Full Session History):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Get the current session history
      const currentHistory = session.current?.getHistory() || [];
      if (currentHistory.length > 0) {
        currentHistory.forEach((item, idx) => {
          if (item.type === 'message') {
            const role = item.role === 'user' ? '👤 USER' : '🤖 ASSISTANT';
            console.log(`\n${idx + 1}. ${role}:`);
            item.content.forEach((content) => {
              if (content.type === 'input_text') {
                console.log(`   [Text Input] ${content.text}`);
              } else if (content.type === 'output_text') {
                console.log(`   [Text Output] ${content.text}`);
              } else if (content.type === 'input_audio') {
                console.log(`   [Audio Input] "${content.transcript || '[No transcript]'}"`);
              } else if (content.type === 'output_audio') {
                console.log(`   [Audio Output] "${content.transcript || '[No transcript]'}"`);
              } else {
                console.log(`   [${content.type}]`, content);
              }
            });
          }
        });
      } else {
        console.log('(No conversation history yet)');
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('ℹ️ The Realtime API will use ALL messages above as context for generating the response.');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.groupEnd();

      session.current?.transport?.sendEvent({
        type: 'response.create',
        response: {
          instructions,
        },
      });
    }, 100);
  }

  async function triggerFullGuidance() {
    if (!session.current || !isConnected) return;
    if (agentState === 'generating' || agentState === 'speaking') {
      console.log(`⚠️ Agent is ${agentState}, ignoring button click`);
      return;
    }

    console.log('📤 Manual trigger: Full Guidance - switching to audio mode...');
    setAgentState('generating');

    // Switch to audio mode
    session.current.transport?.sendEvent({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['audio'], // Audio-only mode for voice response
      },
    });

    // Create response
    setTimeout(() => {
      const instructions = `RESPOND IN ENGLISH ONLY. Provide full guidance (around ${settings.fullGuidanceDuration} seconds) based on the entire conversation context. Be comprehensive with steps and examples.`;

      // Log the complete request context being sent to the LLM
      console.group('🤖 LLM Request Details (Manual Full Guidance Button)');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('\n📋 INSTRUCTIONS SENT TO LLM:');
      console.log(instructions);
      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('💬 CONVERSATION CONTEXT (Full Session History):');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Get the current session history
      const currentHistory = session.current?.getHistory() || [];
      if (currentHistory.length > 0) {
        currentHistory.forEach((item, idx) => {
          if (item.type === 'message') {
            const role = item.role === 'user' ? '👤 USER' : '🤖 ASSISTANT';
            console.log(`\n${idx + 1}. ${role}:`);
            item.content.forEach((content) => {
              if (content.type === 'input_text') {
                console.log(`   [Text Input] ${content.text}`);
              } else if (content.type === 'output_text') {
                console.log(`   [Text Output] ${content.text}`);
              } else if (content.type === 'input_audio') {
                console.log(`   [Audio Input] "${content.transcript || '[No transcript]'}"`);
              } else if (content.type === 'output_audio') {
                console.log(`   [Audio Output] "${content.transcript || '[No transcript]'}"`);
              } else {
                console.log(`   [${content.type}]`, content);
              }
            });
          }
        });
      } else {
        console.log('(No conversation history yet)');
      }

      console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('ℹ️ The Realtime API will use ALL messages above as context for generating the response.');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.groupEnd();

      session.current?.transport?.sendEvent({
        type: 'response.create',
        response: {
          instructions,
        },
      });
    }, 100);
  }

  async function interruptAgent() {
    if (!session.current || !isConnected) return;
    if (!isPlayingAudio.current && agentState !== 'speaking' && agentState !== 'generating') return;

    console.log(`⛔ Interrupting agent (was ${agentState}, audio playing: ${isPlayingAudio.current})...`);

    // IMMEDIATELY clear audio playing flag and set state to listening
    isPlayingAudio.current = false;
    setAgentState('listening');

    try {
      // Stop audio playback
      if (player.current) {
        console.log('🔇 Calling player.interrupt()...');
        await player.current.interrupt();
        console.log('✅ player.interrupt() completed');
      }
    } catch (error) {
      console.error('❌ Error calling player.interrupt():', error);
    }

    // Cancel the current response
    console.log('📤 Sending response.cancel...');
    session.current.transport?.sendEvent({
      type: 'response.cancel',
    });

    // Switch back to text-only mode
    console.log('📤 Switching to text-only mode...');
    session.current.transport?.sendEvent({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['text'],
      },
    });

    console.log('✅ Agent interrupted - back to listening');
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
                          agentState === 'speaking' ? 'bg-purple-500 animate-pulse' :
                          agentState === 'generating' ? 'bg-yellow-500 animate-pulse' :
                          'bg-gray-300'
                        }`}
                      />
                      <span className="text-sm">
                        {agentState === 'speaking' ? 'Speaking' :
                         agentState === 'generating' ? 'Generating' :
                         'Silent'}
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
                  disabled={!isConnected || agentState === 'generating' || agentState === 'speaking'}
                  variant="success"
                  className="flex-1"
                >
                  🚀 Quick Hint ({settings.quickHintDuration}s)
                </Button>
                <Button
                  onClick={triggerFullGuidance}
                  disabled={!isConnected || agentState === 'generating' || agentState === 'speaking'}
                  variant="warning"
                  className="flex-1"
                >
                  💡 Full Guidance ({settings.fullGuidanceDuration}s)
                </Button>
                <Button
                  onClick={interruptAgent}
                  disabled={!isConnected || (agentState !== 'generating' && agentState !== 'speaking')}
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

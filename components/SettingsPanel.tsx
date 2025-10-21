'use client';

import { Button } from './ui/Button';

export type VoiceSettings = {
  quickHintPhrase: string;
  fullGuidancePhrase: string;
  interruptPhrases: string[];
  quickHintDuration: number;
  fullGuidanceDuration: number;
};

type SettingsPanelProps = {
  settings: VoiceSettings;
  onSettingsChange: (settings: VoiceSettings) => void;
  isConnected: boolean;
};

export function SettingsPanel({ settings, onSettingsChange, isConnected }: SettingsPanelProps) {
  const updateSetting = <K extends keyof VoiceSettings>(
    key: K,
    value: VoiceSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
      <h2 className="text-xl font-bold text-gray-900">Settings</h2>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Quick Hint Trigger Phrase
          </label>
          <input
            type="text"
            value={settings.quickHintPhrase}
            onChange={(e) => updateSetting('quickHintPhrase', e.target.value)}
            disabled={isConnected}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="e.g., good question"
          />
          <p className="text-xs text-gray-500 mt-1">
            Say this phrase to trigger a quick hint
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Quick Hint Duration (seconds)
          </label>
          <input
            type="number"
            min="5"
            max="60"
            value={settings.quickHintDuration}
            onChange={(e) => updateSetting('quickHintDuration', parseInt(e.target.value) || 10)}
            disabled={isConnected}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
        </div>

        <div className="pt-4 border-t border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Full Guidance Trigger Phrase
          </label>
          <input
            type="text"
            value={settings.fullGuidancePhrase}
            onChange={(e) => updateSetting('fullGuidancePhrase', e.target.value)}
            disabled={isConnected}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="e.g., let me think"
          />
          <p className="text-xs text-gray-500 mt-1">
            Say this phrase to trigger full guidance
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Full Guidance Duration (seconds)
          </label>
          <input
            type="number"
            min="5"
            max="120"
            value={settings.fullGuidanceDuration}
            onChange={(e) => updateSetting('fullGuidanceDuration', parseInt(e.target.value) || 20)}
            disabled={isConnected}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
          />
        </div>

        <div className="pt-4 border-t border-gray-200">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Interrupt Phrases
          </label>
          <input
            type="text"
            value={settings.interruptPhrases.join(', ')}
            onChange={(e) =>
              updateSetting(
                'interruptPhrases',
                e.target.value.split(',').map(s => s.trim()).filter(Boolean)
              )
            }
            disabled={isConnected}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
            placeholder="e.g., got it, thanks, stop"
          />
          <p className="text-xs text-gray-500 mt-1">
            Comma-separated phrases to interrupt the agent
          </p>
        </div>

        {isConnected && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-sm text-blue-800">
              Settings are locked while connected. Disconnect to modify.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

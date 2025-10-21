'use client';

import { useEffect, useRef } from 'react';

export type TranscriptItem = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: Date;
  isLive?: boolean;
};

type TranscriptDisplayProps = {
  items: TranscriptItem[];
};

export function TranscriptDisplay({ items }: TranscriptDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new items are added
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items]);

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50 rounded-lg"
    >
      {items.length === 0 ? (
        <div className="flex items-center justify-center h-full text-gray-400">
          <p>No transcript yet. Start listening to see conversation here.</p>
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.id}
            className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                item.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-900 border border-gray-200'
              } ${item.isLive ? 'animate-pulse' : ''}`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="text-xs opacity-70 mb-1">
                    {item.role === 'user' ? 'You' : 'Assistant'}
                    {item.isLive && ' (speaking...)'}
                  </div>
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {item.text || '...'}
                  </div>
                </div>
              </div>
              <div className="text-xs opacity-50 mt-1">
                {item.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

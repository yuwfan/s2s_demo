'use server';

export async function getToken() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable.');
  }

  const response = await fetch(
    'https://api.openai.com/v1/realtime/client_secrets',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        session: {
          type: 'realtime',
          model: 'gpt-realtime',
        },
      }),
    },
  );

  if (!response.ok) {
    let detail = '';
    try {
      const errJson = await response.json();
      detail = JSON.stringify(errJson);
    } catch {
      detail = await response.text();
    }
    throw new Error(
      `Failed to create ephemeral client secret: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`,
    );
  }

  const clientSecret: {
    value: string;
    expires_at: number;
    session: Record<string, unknown>;
  } = await response.json();

  return clientSecret.value;
}

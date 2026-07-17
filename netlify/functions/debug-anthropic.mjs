import Anthropic from '@anthropic-ai/sdk';
export const handler = async () => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });
  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8192,
      system: [{ type: 'text', text: 'You are a test', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'Test' }]
    });
    return { statusCode: 200, body: 'SUCCESS: ' + JSON.stringify(msg.usage) };
  } catch (e) {
    return { statusCode: 200, body: 'FAILED WITH ERROR: ' + e.message };
  }
};

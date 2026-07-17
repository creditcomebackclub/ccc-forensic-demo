import Anthropic from '@anthropic-ai/sdk';

export const handler = async (event) => {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) return { statusCode: 500, body: 'ANTHROPIC_API_KEY missing' };

    const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });

    const msg = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Please reply with the exact word: SUCCESS' }],
    });

    const rawText = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    
    return { statusCode: 200, body: rawText };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
};

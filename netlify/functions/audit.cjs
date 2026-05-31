const https = require('https');

function callClaude(apiKey, systemPrompt, messages, maxTokens = 8192) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    });
    const options = {
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(raw);
          if (res.statusCode === 429) {
            resolve({ rateLimited: true, retryAfter: parseInt(res.headers['retry-after'] || '60') });
          } else if (res.statusCode !== 200) {
            reject(new Error(data.error?.message || 'API error ' + res.statusCode));
          } else {
            const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
            resolve({ text });
          }
        } catch (e) { reject(new Error('Parse error: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(new Error('Request timeout')); });
    req.write(body);
    req.end();
  });
}

async function claudeWithRetry(apiKey, systemPrompt, messages, maxTokens = 8192, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const result = await callClaude(apiKey, systemPrompt, messages, maxTokens);
    if (result.rateLimited) {
      const wait = (result.retryAfter + 5) * 1000;
      console.log('Rate limited — waiting ' + (result.retryAfter + 5) + 's');
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return result.text;
  }
  throw new Error('Max retries exceeded due to rate limiting');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractJSON(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1];
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) { try { return JSON.parse(objMatch[0]); } catch (e) {} }
  try { return JSON.parse(text.trim()); } catch (e) {}
  throw new Error('Could not parse JSON from response');
}

function trimBureau(data) {
  if (!data) return null;
  return {
    bureau: data.bureau,
    client: data.client,
    accounts: (data.accounts || []).map((a) => ({
      furnisher: a.furnisher,
      accountNumber: a.accountNumber,
      status: a.status,
      balance: a.balance,
      pastDue: a.pastDue,
      lastPaymentDate: a.lastPaymentDate,
      dofd: a.dofd,
      paymentHistory: a.paymentHistory,
      accountClassification: a.accountClassification,
      violations: a.violations,
    })),
  };
}

function pdfMessage(base64, text) {
  return {
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
      { type: 'text', text },
    ],
  };
}

const today = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured on server' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { mode, systemPrompt } = payload;
  const t = today();

  try {
    if (mode === 'combined') {
      const { pdfBase64 } = payload;
      const text = await claudeWithRetry(apiKey, systemPrompt, [
        pdfMessage(pdfBase64, 'AUDIT_JSON_MODE\n\nToday is ' + t + '. Perform a full forensic Metro 2 and FCRA audit of the attached three-bureau credit report. Return the complete JSON object per the schema in your instructions. Identify every violation. Classify accounts A, B, or C. Rank into Batch 1 top 5 and Batch 2 remaining. Output JSON only. No prose. No code fences.')
      ]);
      return { statusCode: 200, body: JSON.stringify({ result: text }) };
    }

    if (mode === 'single') {
      const { pdfBase64, bureau } = payload;
      const text = await claudeWithRetry(apiKey, systemPrompt, [
        pdfMessage(pdfBase64, 'AUDIT_JSON_MODE\n\nToday is ' + t + '. Bureau: ' + bureau + ' only. Perform a forensic Metro 2 and FCRA audit. No cross-bureau comparisons possible. Return complete JSON per standard schema. JSON only.')
      ]);
      return { statusCode: 200, body: JSON.stringify({ result: text }) };
    }

    if (mode === 'individual') {
      const { eqBase64, expBase64, tuBase64 } = payload;
      const bureauPrompt = (bureau) => 'BUREAU_AUDIT_JSON_MODE\n\nToday is ' + t + '. Bureau: ' + bureau + '.\n\nParse this single-bureau credit report. Extract client info, score, and every account with: furnisher, account number (masked), type, status, balance, pastDue, lastPaymentDate, dofd, paymentHistory, remarks, Metro 2 violations (field, currentValue, expectedValue, reason), accountClassification (A/B/C).\n\nOutput JSON only:\n{"bureau":"' + bureau + '","client":{"name":"","address":"","score":0},"accounts":[{"furnisher":"","accountNumber":"","type":"","status":"","balance":0,"pastDue":0,"lastPaymentDate":"","dofd":"","paymentHistory":"","accountClassification":"A","violations":[{"field":"","currentValue":"","expectedValue":"","reason":""}]}]}';

      const eqText = await claudeWithRetry(apiKey, systemPrompt, [pdfMessage(eqBase64, bureauPrompt('Equifax'))]);
      const eqData = extractJSON(eqText);
      await sleep(30000);

      const expText = await claudeWithRetry(apiKey, systemPrompt, [pdfMessage(expBase64, bureauPrompt('Experian'))]);
      const expData = extractJSON(expText);
      await sleep(30000);

      const tuText = await claudeWithRetry(apiKey, systemPrompt, [pdfMessage(tuBase64, bureauPrompt('TransUnion'))]);
      const tuData = extractJSON(tuText);
      await sleep(30000);

      const mergePrompt = 'MERGE_AUDIT_JSON_MODE\n\nToday is ' + t + '.\n\nMerge these three bureau reports into a unified forensic audit. Match accounts across bureaus. Identify cross-bureau violations. Classify each account A/B/C. Rank top 5 as Batch 1, rest as Batch 2. Return complete audit JSON.\n\nData:\n' + JSON.stringify({ equifax: trimBureau(eqData), experian: trimBureau(expData), transunion: trimBureau(tuData) }, null, 2) + '\n\nJSON only.';

      const mergeText = await claudeWithRetry(apiKey, systemPrompt, [{ role: 'user', content: mergePrompt }], 8192);
      const merged = extractJSON(mergeText);

      if (merged && merged.client) {
        merged.client.scores = merged.client.scores || {};
        if (eqData && eqData.client && eqData.client.score) merged.client.scores.equifax = eqData.client.score;
        if (expData && expData.client && expData.client.score) merged.client.scores.experian = expData.client.score;
        if (tuData && tuData.client && tuData.client.score) merged.client.scores.transunion = tuData.client.score;
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ result: JSON.stringify(merged), bureauData: { equifax: eqData, experian: expData, transunion: tuData } })
      };
    }

    if (mode === 'letter') {
      const { account, client, clientSignature } = payload;
      const text = await claudeWithRetry(apiKey, systemPrompt, [{
        role: 'user',
        content: 'LETTER_HTML_MODE\n\nToday is ' + t + '. Use this exact date at the top of the letter.\n\nGenerate the Phase 1 dispute letter HTML for this account.\n\nData:\n' + JSON.stringify({ account, client, clientSignature: clientSignature || null }, null, 2) + '\n\nFollow the 16-step structure. For Type C include section 1692g(b) demands. If clientSignature is provided embed it in the signature block. Output complete HTML only. No prose. No fences.',
      }], 16000);
      return { statusCode: 200, body: JSON.stringify({ result: text }) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown mode: ' + mode }) };

  } catch (e) {
    console.error('Audit error:', e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Audit failed' }) };
  }
};

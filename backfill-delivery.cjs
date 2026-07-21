const fs = require('fs');
const https = require('https');

// Load .env.local file from parent directory
const envFile = fs.readFileSync('/Users/chris/Desktop/ccc-demo/.env.local', 'utf8');
const envVars = {};
for (const line of envFile.split('\n')) {
  if (line.includes('=')) {
    const [k, ...v] = line.split('=');
    envVars[k.trim()] = v.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
}

const supabaseUrl = envVars.VITE_SUPABASE_URL || 'https://mlsbdmewxocgweotcdud.supabase.co';
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

function supabaseRequest(path, method, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(supabaseUrl + path);
    const options = {
      hostname: u.hostname, port: 443, path: u.pathname + u.search, method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': 'Bearer ' + supabaseKey,
        'Prefer': 'return=representation',
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const letters = [
  { lob_id: 'ltr_aa0064da2055504b', delivered_at: new Date('July 20, 2026 09:44:00').toISOString() },
  { lob_id: 'ltr_398e538c1716442b', delivered_at: new Date('July 18, 2026 05:27:00').toISOString() },
  { lob_id: 'ltr_089c606aea960aed', delivered_at: new Date('July 18, 2026 05:27:00').toISOString() },
];

async function run() {
  for (const letter of letters) {
    const patch = {
      tracking_status: 'Delivered',
      delivered_at: letter.delivered_at
    };
    console.log(`Patching ${letter.lob_id}...`);
    const res = await supabaseRequest(`/rest/v1/letters?lob_id=eq.${letter.lob_id}`, 'PATCH', patch);
    console.log(`Status: ${res.status}`);
    console.log(`Response:`, res.body);
  }
}

run().catch(console.error);

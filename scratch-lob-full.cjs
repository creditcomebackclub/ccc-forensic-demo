const fs = require('fs');
const https = require('https');

const envContent = fs.readFileSync('/Users/chris/Desktop/ccc-demo/.env.local', 'utf8');
const env = envContent.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

const lobKey = env.LOB_LIVE_KEY || env.VITE_LOB_LIVE_KEY;
const lobId = 'ltr_07e4b0df590880ee';

const options = {
  hostname: 'api.lob.com',
  port: 443,
  path: '/v1/letters/' + lobId,
  method: 'GET',
  headers: {
    'Authorization': 'Basic ' + Buffer.from(lobKey + ':').toString('base64')
  }
};

const req = https.request(options, (res) => {
  let raw = '';
  res.on('data', c => raw += c);
  res.on('end', () => {
    try {
      const data = JSON.parse(raw);
      console.dir(data, { depth: null });
    } catch(e) {
      console.log(raw);
    }
  });
});
req.on('error', console.error);
req.end();

const fs = require('node:fs');
const path = require('node:path');

const GUIDE_FILENAME = 'credit-comeback-club-credit-report-field-guide.pdf';
const GUIDE_PATH = path.join(__dirname, 'assets', GUIDE_FILENAME);

const DOWNLOAD_HEADERS = {
  'Content-Type': 'application/pdf',
  'Content-Disposition': `attachment; filename="${GUIDE_FILENAME}"`,
  'Cache-Control': 'no-store, private, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

function textResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body,
  };
}

function readGuideBase64() {
  const guide = fs.readFileSync(GUIDE_PATH);
  if (!guide.length || guide.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('guide asset is invalid');
  }
  return guide.toString('base64');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return textResponse(405, 'Method Not Allowed');

  try {
    const body = readGuideBase64();
    return {
      statusCode: 200,
      headers: DOWNLOAD_HEADERS,
      body,
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Guide download unavailable:', error.message || error);
    return textResponse(503, 'Guide download is temporarily unavailable.');
  }
};

exports._test = { GUIDE_FILENAME, GUIDE_PATH, readGuideBase64 };

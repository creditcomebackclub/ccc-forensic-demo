export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/letters?client_name=eq.Karl%20J%20Elliott&select=id,furnisher,type,html`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    const data = await res.json();
    
    // Return a list of letters showing the ID, furnisher, type, and whether the HTML contains signature/enclosures and its length
    const result = data.map(l => ({
      id: l.id,
      furnisher: l.furnisher,
      type: l.type,
      htmlLength: l.html ? l.html.length : 0,
      hasSignature: l.html ? l.html.includes('client-signature') || l.html.includes('chris_signature') || l.html.includes('img') || l.html.includes('Signature') : false,
      hasEnclosures: l.html ? l.html.toLowerCase().includes('enclosures') : false,
      htmlEnd: l.html ? l.html.slice(-300) : ''
    }));
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};

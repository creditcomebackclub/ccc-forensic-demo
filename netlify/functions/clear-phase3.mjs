export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mlsbdmewxocgweotcdud.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  const furnishers = [
    'OneMain Financial',
    'LendingClub Bank, N.A.',
    'Navy Federal Credit Union'
  ];
  
  try {
    for (const furnisher of furnishers) {
      const id = `stefani-bryant__${furnisher.replace(/[^a-z0-9]/gi, '-').toLowerCase()}__phase3-dummy__${new Date().toISOString().slice(0,10)}`;
      
      const payload = {
        id,
        user_id: 'dummy',
        created_by: 'dummy',
        client_name: 'Stefani Bryant',
        furnisher: furnisher,
        phase: 'Phase 3 — Manual',
        saved_at: new Date().toISOString(),
        date: new Date().toISOString().slice(0, 10),
        html: '<p>Manually generated outside the system.</p>',
        mailed_date: new Date().toISOString().slice(0, 10)
      };

      // Since we don't have the user_id of Chris locally, we will fetch one letter from Stefani to get the user_id
      const res1 = await fetch(`${supabaseUrl}/rest/v1/letters?client_name=eq.Stefani%20Bryant&limit=1`, {
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
      const data1 = await res1.json();
      if (data1 && data1.length > 0) {
        payload.user_id = data1[0].user_id;
        payload.created_by = data1[0].created_by;
      }
      
      await fetch(`${supabaseUrl}/rest/v1/letters`, {
        method: 'POST',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
    }
    
    return { statusCode: 200, body: `Success` };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};

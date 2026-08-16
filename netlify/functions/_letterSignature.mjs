export async function loadCanonicalClientSignature(db, letter, client) {
  const { data: profiles, error: profileError } = await db.from('client_profiles')
    .select('signature_data').eq('client_id', letter.client_id).limit(1);
  if (profileError) throw profileError;
  const profileSignature = String(profiles?.[0]?.signature_data || '');
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(profileSignature)) {
    return { dataUrl: profileSignature, printedName: client.name };
  }
  const signatureRecord = client.lpoa_signature_data || {};
  if (signatureRecord.signaturePath) {
    const bucket = signatureRecord.storageBucket || 'documents';
    const { data, error } = await db.storage.from(bucket).download(signatureRecord.signaturePath);
    if (error || !data) throw error || new Error('Stored client signature could not be downloaded.');
    const bytes = Buffer.from(await data.arrayBuffer());
    return { dataUrl: `data:${data.type || 'image/png'};base64,${bytes.toString('base64')}`, printedName: client.name };
  }
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(signatureRecord.signatureUrl || ''))) {
    return { dataUrl: signatureRecord.signatureUrl, printedName: client.name };
  }
  throw new Error('The client has no stored signature for this letter.');
}

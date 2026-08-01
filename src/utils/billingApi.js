import { supabase } from './supabase';

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

export function nmiTokenizationKey() {
  return import.meta.env.VITE_NMI_TOKENIZATION_KEY || '';
}

export function nmiConfigured() {
  return !!nmiTokenizationKey();
}

export async function vaultCard({ clientId, paymentToken, cardLast4, cardType, cardExpiry, billing, initiatedBy }) {
  const headers = await authHeader();
  const res = await fetch('/.netlify/functions/billing-vault', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      clientId,
      paymentToken,
      cardLast4,
      cardType,
      cardExpiry,
      billing,
      initiatedBy,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not save card');
  return data;
}

export async function chargeDue({ clientId, invoiceIds }) {
  const headers = await authHeader();
  const res = await fetch('/.netlify/functions/billing-charge', {
    method: 'POST',
    headers,
    body: JSON.stringify({ clientId, invoiceIds }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || 'Payment failed');
  return data;
}

export async function fetchCardOnFile(clientId) {
  if (!clientId) return null;
  const { data, error } = await supabase
    .from('client_profiles')
    .select('card_last4,card_type,card_expiry,card_vaulted_at')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

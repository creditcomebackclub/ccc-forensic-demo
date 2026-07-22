import { supabase } from './supabase';

const DEFAULT_SETTINGS = {
  pricing: {
    firstWorkFee: 49,
    monthlyFee: 99,
    monitoringFee: 16
  },
  notifications: {
    emailNewLeads: true,
    emailClientUploads: true,
    emailEscalations: true
  },
  affiliates: {
    defaultCommissionRate: 20
  },
  disputes: {
    defaultAggressiveness: 'Standard'
  }
};

const SETTINGS_FILE_PATH = 'admin/settings.json';
const BUCKET = 'client-docs';

export async function getSettings() {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(SETTINGS_FILE_PATH);
    if (error) {
      if (error.message.includes('not found') || error.message.includes('Object not found')) {
        return DEFAULT_SETTINGS;
      }
      console.error('Error downloading settings:', error);
      return DEFAULT_SETTINGS;
    }
    const text = await data.text();
    const parsed = JSON.parse(text);
    // Merge defaults so missing fields don't break the app
    return {
      pricing: { ...DEFAULT_SETTINGS.pricing, ...(parsed.pricing || {}) },
      notifications: { ...DEFAULT_SETTINGS.notifications, ...(parsed.notifications || {}) },
      affiliates: { ...DEFAULT_SETTINGS.affiliates, ...(parsed.affiliates || {}) },
      disputes: { ...DEFAULT_SETTINGS.disputes, ...(parsed.disputes || {}) }
    };
  } catch (e) {
    console.error('Failed to parse settings:', e);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings) {
  try {
    const jsonString = JSON.stringify(settings, null, 2);
    const { error } = await supabase.storage.from(BUCKET).upload(SETTINGS_FILE_PATH, jsonString, {
      contentType: 'application/json',
      upsert: true
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

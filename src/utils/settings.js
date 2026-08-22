import { supabase } from './supabase';
import {
  ACTIVE_PRICING_VERSION,
  DEFAULT_TIER_PRICING,
  getTierPricing,
} from './pricing';

const DEFAULT_SETTINGS = {
  pricing: {
    // Real pricing is tiered — see utils/pricing.js. Kept here (rather than
    // only as a hardcoded default) so admins can adjust fees from Settings
    // without a code change.
    version: ACTIVE_PRICING_VERSION,
    tiers: DEFAULT_TIER_PRICING,
    monitoringFee: 16, // estimate shown regardless of which monitoring service a client uses
  },
  notifications: {
    emailNewLeads: true,
    emailClientUploads: true,
    emailEscalations: true,
    emailOnboardingComplete: true,
    emailAffiliateReferralConfirm: true,
    emailAffiliateEnrolled: true,
    emailAffiliateExited: true,
    emailAffiliateCommission: true,
    emailAffiliateMonthlySummary: true,
  },
  affiliates: {
    defaultCommissionRate: 20
  },
  disputes: {
    // Matches the letter style CCC has always actually sent (the only
    // prompt that existed before this setting had any real effect) — not
    // "Standard," so wiring this setting up for real doesn't silently
    // soften every future letter for anyone who's never touched Settings.
    defaultAggressiveness: 'Aggressive',
    // Opt-in applies only when a new campaign is created. Existing campaigns
    // retain their original routing behavior and historical packet shape.
    consolidatedPacketsEnabled: false,
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
    const parsedPricing = parsed.pricing && typeof parsed.pricing === 'object'
      ? parsed.pricing
      : {};
    const pricing = {
      ...DEFAULT_SETTINGS.pricing,
      monitoringFee: parsedPricing.monitoringFee ?? DEFAULT_SETTINGS.pricing.monitoringFee,
      version: ACTIVE_PRICING_VERSION,
      tiers: getTierPricing({ pricing: parsedPricing }),
    };
    return {
      pricing,
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
    const normalized = {
      ...settings,
      pricing: {
        ...(settings?.pricing || {}),
        version: ACTIVE_PRICING_VERSION,
        tiers: getTierPricing({
          pricing: {
            ...(settings?.pricing || {}),
            version: ACTIVE_PRICING_VERSION,
          },
        }),
      },
    };
    const jsonString = JSON.stringify(normalized, null, 2);
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

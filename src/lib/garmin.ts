/**
 * Server-only client for the Garmin Connect Personal API.
 * The personal API key is exchanged for a short-lived (~24h) bearer token.
 *
 * NOTE: the token endpoint is documented by Garmin. The data endpoint paths below
 * are kept in one place (GARMIN_PATHS) so they are easy to adjust against the
 * official Swagger docs if one differs.
 */
const BASE_URL = process.env.GARMIN_API_BASE_URL || 'https://personal.connectapi.garmin.com';

export const GARMIN_PATHS = {
  token: '/personalapitoken-service/personal-api/personal-api-key/token',
  activityList: '/activitylist-service/activities/search/activities',
  activitySummary: (id: string) => `/activity-service/activity/${id}`,
  fitDownload: (id: string) => `/download-service/files/activity/${id}`,
  hrvRange: (from: string, to: string) => `/hrv-service/hrv/daily/${from}/${to}`,
  hrvDay: (date: string) => `/hrv-service/hrv/${date}`,
  sleepRange: (from: string, to: string) =>
    `/sleep-service/sleep/dailySleepSummariesByDate?startDate=${from}&endDate=${to}`,
  dailySummariesV2: (from: string, to: string) =>
    `/usersummary-service/v2/dailysummaries?startDate=${from}&endDate=${to}`,
  userSummaryDay: (date: string) => `/usersummary-service/usersummary/daily?calendarDate=${date}`,
  heartRateZones: '/biometric-service/heartRateZones/v2',
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value;
  }
  const apiKey = process.env.GARMIN_API_KEY;
  if (!apiKey) throw new Error('GARMIN_API_KEY is not configured.');

  const res = await fetch(`${BASE_URL}${GARMIN_PATHS.token}`, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}` },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Garmin token request failed (${res.status}). Is the API key valid/expired?`);
  }
  // Garmin may return the token as a raw JWT string or as a JSON object.
  const raw = (await res.text()).trim();
  let token: string | undefined;
  try {
    const parsed = JSON.parse(raw);
    token = typeof parsed === 'string' ? parsed : parsed.access_token || parsed.token || parsed.accessToken;
  } catch {
    token = raw.replace(/^"|"$/g, '');
  }
  if (!token) throw new Error('Garmin token response did not contain a token.');
  // Tokens last up to 24h; refresh well before that.
  cachedToken = { value: token, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
  return token;
}

export async function garminFetch(path: string): Promise<Response> {
  let token = await getAccessToken();
  let res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 401) {
    token = await getAccessToken(true);
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  }
  return res;
}

export async function garminJson<T = any>(path: string): Promise<T | null> {
  const res = await garminFetch(path);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`Garmin request failed (${res.status}) for ${path}`);
  const text = await res.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

export async function downloadFit(activityId: string): Promise<Buffer> {
  if (!/^\d+$/.test(activityId)) throw new Error('Invalid Garmin activity id.');
  const res = await garminFetch(GARMIN_PATHS.fitDownload(activityId));
  if (!res.ok) throw new Error(`Failed to download FIT file (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Garmin's download endpoint may return a ZIP wrapping the .fit file.
  if (buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(buf);
    const entry = Object.values(zip.files).find((f) => f.name.toLowerCase().endsWith('.fit'));
    if (!entry) throw new Error('No .fit file found in Garmin download.');
    return Buffer.from(await entry.async('nodebuffer'));
  }
  return buf;
}

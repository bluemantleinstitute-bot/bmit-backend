'use strict';

/**
 * The verification URL is the ONLY thing ever encoded into a QR code.
 * Format: USER_APP_URL/verify/BMIT/YYYY/NNNNNNNNN (slashes kept raw on purpose).
 */
function buildVerificationUrl(certificateId) {
  const base = (process.env.USER_APP_URL || 'https://bmit-verification.vercel.app').trim().replace(/\/+$/, '');
  const idStr = String(certificateId || '').trim();
  const numericMatch = idStr.match(/\d+$/);
  const numericId = numericMatch ? numericMatch[0] : idStr;
  if (!base) return `/verify/${numericId}`;
  return `${base}/verify/${numericId}`;
}

module.exports = { buildVerificationUrl };

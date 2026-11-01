const SECRET_ASSIGNMENT = /((?:password|passwd|passphrase|secret|token|authorization|api[_-]?key|merchant[_-]?id|authority|encryption[_-]?key|database[_-]?url|connection[_-]?string|dsn|callback(?:[_-]?url)?|return[_-]?url|cookie)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi;
const IDENTITY_ASSIGNMENT = /((?:username|user[_-]?name|full[_-]?name|actor[_-]?name|customer[_-]?name)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi;
const MOBILE_ASSIGNMENT = /((?:mobile|phone)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi;
const NATIONAL_ID_ASSIGNMENT = /((?:national[_-]?id|nationalCode)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi;
const EMAIL_ASSIGNMENT = /((?:email|e[_-]?mail)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^,\s}]+)/gi;
const URL_SECRET_QUERY = /([?&](?:token|key|password|secret|authority|payment[_-]?id|code|auth|signature|merchant[_-]?id|callback[_-]?url|return[_-]?url)=)[^&\s]+/gi;
const URL_CREDENTIALS = /\b((?:postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^:\s/@]+:)[^@\s/]+@/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const MOBILE = /(?<!\d)(?:\+?98|0)?9\d{9}(?!\d)/g;
const NATIONAL_ID = /(?<!\d)\d{10}(?!\d)/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const USER_HOME = /(?:[A-Z]:\\Users\\|\/home\/)[^\\/\s]+/gi;

/** Remove secrets and identity-like values before persisting local manager diagnostics. */
export function sanitizeManagerLogMessage(value, maxLength = 1600) {
  let message = String(value ?? '')
    .replace(/\0/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(SECRET_ASSIGNMENT, '$1[redacted]')
    .replace(URL_CREDENTIALS, '$1[redacted]@')
    .replace(IDENTITY_ASSIGNMENT, '$1[redacted]')
    .replace(MOBILE_ASSIGNMENT, '$1[redacted-mobile]')
    .replace(NATIONAL_ID_ASSIGNMENT, '$1[redacted-id]')
    .replace(EMAIL_ASSIGNMENT, '$1[redacted-email]')
    .replace(URL_SECRET_QUERY, '$1[redacted]')
    .replace(BEARER, 'Bearer [redacted]')
    .replace(JWT, '[redacted-token]')
    .replace(MOBILE, '[redacted-mobile]')
    .replace(NATIONAL_ID, '[redacted-id]')
    .replace(EMAIL, '[redacted-email]')
    .replace(USER_HOME, '[redacted-home]');
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(0, Math.trunc(Number(maxLength))) : 1600;
  return message.slice(0, limit);
}

export function formatManagerLogLine(message, timestamp = new Date()) {
  const safeTimestamp = timestamp instanceof Date && !Number.isNaN(timestamp.getTime())
    ? timestamp.toISOString()
    : new Date().toISOString();
  return `[${safeTimestamp}] ${sanitizeManagerLogMessage(message)}\n`;
}

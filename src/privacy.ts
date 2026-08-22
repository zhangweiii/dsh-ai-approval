const PEM_BLOCK = /-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g
const ENV_SECRET =
  /\b([A-Z][A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY))\b\s*([=:])\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\n]+)/g

/** Redact credential-shaped values without retaining the original value. */
export function redactSensitiveText(text: string): string {
  return text
    .replace(PEM_BLOCK, '<redacted-pem>')
    .replace(
      /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|private[_-]?key|token|cookie|credential)\s*:\s*Bearer\s+[^\s,;}]+/gi,
      '$1: <redacted>',
    )
    .replace(ENV_SECRET, '$1$2<redacted>')
    .replace(
      /(["']?)(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|client[_-]?secret|private[_-]?key|token|cookie|credential)\1\s*:\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}]+)/gi,
      (_match, quote: string, key: string) => `${quote}${key}${quote}: "<redacted>"`,
    )
    .replace(
      /(authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|client[_-]?secret|private[_-]?key|token|cookie|credential)\s*([:=])\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\n]+)/gi,
      '$1$2<redacted>',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '<redacted-aws-key>')
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/g, '<redacted-npm-token>')
    .replace(/\bglpat-[A-Za-z0-9_-]{10,}\b/g, '<redacted-gitlab-token>')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '<redacted-slack-token>')
    .replace(/\b(gho|ghp|ghs|ghu|github_pat|sk-proj|sk)([-_])[A-Za-z0-9_-]+\b/gi, '$1$2<redacted>')
}

/** Redact common local usernames in paths. */
export function redactLocalPaths(text: string): string {
  return text
    .replace(/(\/Users\/)[^/\s"']+/g, '$1<user>')
    .replace(/(\/home\/)[^/\s"']+/g, '$1<user>')
    .replace(/([A-Za-z]:[\\/]+Users[\\/])[^\\/\s"']+/gi, '$1<user>')
}

/** Apply all configured privacy transformations to text. */
export function privacyText(text: string, redactPaths = true): string {
  const safe = redactSensitiveText(text)
  return redactPaths ? redactLocalPaths(safe) : safe
}

/** Stable testable interface for values serialized into prompts or audits. */
export function sanitizeText(text: string, redactPaths = true): string {
  return privacyText(text, redactPaths)
}

/** Serialize a value while redacting credential-shaped strings. */
export function jsonText(value: unknown): string {
  try {
    return redactSensitiveText(JSON.stringify(value, null, 2) ?? String(value))
  } catch {
    return '<unserializable>'
  }
}

/** Stable testable interface for sanitized structured values. */
export function sanitizeValue(value: unknown, redactPaths = true): string {
  return privacyText(jsonText(value), redactPaths)
}

/** Truncate text without exceeding a UTF-8 byte budget. */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text
  let end = text.length
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes) end -= 1
  return text.slice(0, end)
}

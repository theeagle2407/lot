/** Describe failed Vitest runs without publishing witnesses, measurements or proof blobs. */
export function summarizeFailedRun(output, phase = 'Unknown step') {
  const clean = String(output || '').replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split(/\r?\n/);
  const stripSecrets = (line) => {
    if (/LOT_LOCAL_PROOF_PAYLOAD|secret|salt|witness|privateState|proof request body/i.test(line)) {
      return '[sensitive data redacted]';
    }
    return line.replace(/\/Users\/[^/\s]+/g, '~')
      .replace(/0x[a-f0-9]{16,}/gi, '[hex redacted]')
      .replace(/\b[a-f0-9]{64,}\b/gi, '[hex redacted]')
      .replace(/\{[^\n}]{20,}\}/g, '[structured data redacted]')
      .trim().slice(0, 260);
  };
  // Find the actual exception, not the Vitest FAIL headline/test name.
  const patterns = [
    /^\s*(?:Error|AssertionError|TypeError|ReferenceError|SyntaxError|RangeError):\s*.+/,
    /^\s*(?:Caused by:|Error Cause:|expected .+ to .+|Timed out .+)/i,
    /^\s*\u00d7\s+.+/,
  ];
  let cause = '';
  for (const pattern of patterns) {
    const candidate = [...lines].reverse().find(line => pattern.test(line));
    if (candidate) {cause = stripSecrets(candidate); break;}
  }
  if (!cause || cause === '[sensitive data redacted]') {
    // Exit status and last completed phase are still a usable diagnosis boundary.
    cause = 'Vitest exited nonzero; no safe exception line was found in its output.';
  }
  return { phase: String(phase).slice(0, 60), cause };
}

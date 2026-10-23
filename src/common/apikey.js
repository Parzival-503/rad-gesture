// The Anthropic API key as people actually paste it, and API errors in words.
// Same rules as CleanApiKey / KeyProblem / ApiErrorText in the helper.

// Spaces, line breaks, quotes, an "x-api-key:" prefix, or a new key pasted
// after an old one in a masked field: keep the key itself (the last one).
function cleanKey(k) {
  k = String(k || '').replace(/[\s"'<>]/g, '').replace(/^x-api-key:/i, '');
  const p = k.lastIndexOf('sk-ant-');
  return p > 0 ? k.slice(p) : k;
}

// '' unless it is clearly not a Claude API key; any other sk-ant-... key
// goes to Anthropic, which has the final word (it issues more than one kind:
// sk-ant-api03-, sk-ant-usr-, ...; an sk-ant-api-only check would reject
// real keys).
function keyProblem(k) {
  if (!k) return 'Enter an API key first.';
  if (k.startsWith('sk-ant-oat')) return 'That is a Claude app login code, not an API key. Make an API key at console.anthropic.com > Settings > API keys (it starts with sk-ant-) and paste that.';
  if (/^sk-(proj|svcacct|admin)-/.test(k) || (/^sk-[A-Za-z0-9]/.test(k) && !k.startsWith('sk-ant-'))) return 'That is an OpenAI (ChatGPT) key, not a Claude key. Make a Claude key at console.anthropic.com > Settings > API keys (it starts with sk-ant-) and paste that.';
  if (!k.startsWith('sk-ant-')) return 'That does not look like an Anthropic API key (they start with sk-ant-). Copy it again from console.anthropic.com > Settings > API keys.';
  return '';
}

function errorText(status, apiMessage) {
  if (status === 401) return 'Anthropic says this API key is not valid. It may be mistyped, cut off, or deleted. Copy a fresh key from console.anthropic.com > Settings > API keys.';
  if (status === 403) return "This API key is not allowed to do that. Check the key's workspace and permissions in the Anthropic console.";
  if (status === 404) return 'Anthropic does not know this model for your key. Pick another model.';
  if (status === 429) return 'Too many requests or out of credit. Check usage and billing in the Anthropic console, or wait a minute.';
  if (status === 529 || status === 503) return 'Anthropic is busy right now. Try again in a moment.';
  return `HTTP ${status}: ${apiMessage || ''}`.slice(0, 300);
}

module.exports = { cleanKey, keyProblem, errorText };

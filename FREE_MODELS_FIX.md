# Fix Summary: OpenCode Free Models Error

## Problem
Navi's free models were not working because:

1. **Wrong API URL**: free-models.json was using `openrouter.ai` API instead of `zenmux.ai`
2. **Wrong Provider ID**: Using "opencode" instead of "zenmux" for free models
3. **Incorrect Headers**: Headers pointing to wrong referrer/title
4. **Missing API Key Handling**: zenmux provider didn't properly handle free vs paid models

## Solution

### 1. Updated free-models.json
Changed from:
```json
{
  "opencode": {
    "api": "https://openrouter.ai/api/v1",
    ...
  }
}
```

To:
```json
{
  "zenmux": {
    "api": "https://zenmux.ai/api/v1",
    "models": {
      "xiaomi/mimo-v2-flash-free": { ... }
    }
  }
}
```

### 2. Updated provider.ts zenmux loader

Before:
```typescript
zenmux: async () => {
  return {
    autoload: false,
    options: {
      headers: {
        "HTTP-Referer": "https://opencode.ai/",
        "X-Title": "opencode",
      },
    },
  }
},
```

After:
```typescript
zenmux: async (input) => {
  if (!input) return { autoload: false, options: {} }
  const hasKey = await (async () => {
    const env = Env.all()
    if (input.env.some((item) => env[item])) return true
    if (await Auth.get(input.id)) return true
    const config = await Config.get()
    if (config.provider?.["zenmux"]?.options?.apiKey) return true
    return false
  })()

  if (!hasKey) {
    for (const [key, value] of Object.entries(input.models)) {
      if (value.cost.input === 0) continue
      delete input.models[key]
    }
  }

  return {
    autoload: Object.keys(input.models).length > 0,
    options: hasKey ? {} : { apiKey: "public" },
  }
},
```

### Key Changes:
- Added API key checking (env, auth, config)
- Automatically filters out paid models when no API key is present
- Only loads free models (cost.input === 0) without API key
- Returns `apiKey: "public"` for free access

## Files Modified
1. `packages/navi/src/provider/free-models.json` - Complete rewrite with zenmux models
2. `packages/navi/src/provider/provider.ts` - Updated zenmux loader

## Testing
After applying these changes:

1. Run navi
2. Try to use free model: `xiaomi/mimo-v2-flash-free`
3. Should work without API key (free access)

## Notes
- The free models will be available automatically without API key
- Headers are set to `https://navi.ai/` with `X-Title: navi`
- Models with cost 0 will be loaded even without authentication
- Models with cost > 0 require API key or are filtered out

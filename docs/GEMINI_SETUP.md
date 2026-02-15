# Setting Up Google Gemini API

To use the AI Brain (Block 1) in Project Tofu, you need a Google Gemini API key.

## Getting Your Free API Key

1. **Visit Google AI Studio:**
   - Go to: https://makersuite.google.com/app/apikey
   - Or: https://aistudio.google.com/app/apikey

2. **Sign in with your Google Account**
   - Use any Google account (Gmail, etc.)

3. **Create API Key:**
   - Click "Create API Key"
   - Choose "Create API key in new project" (or select an existing project)
   - Copy the generated API key

4. **Add to Project:**
   ```bash
   # Copy the example .env file
   cp .env.example .env

   # Edit .env and paste your API key
   # Replace 'your_api_key_here' with your actual key
   nano .env
   ```

   Your `.env` file should look like:
   ```
   GEMINI_API_KEY=AIzaSyD...your_actual_key_here
   ```

5. **Test It:**
   ```bash
   cargo run --release -- "show me a circle"
   ```

## Free Tier Limits

Gemini 2.0 Flash (experimental) offers a generous free tier:
- **Rate limit:** 15 requests per minute (free tier)
- **Token limit:** 1 million tokens per minute
- **Context window:** 1 million tokens
- **Speed:** 2x faster than Gemini 1.5 Pro
- **Quality:** Improved reasoning and JSON generation
- **Cost:** FREE for moderate use

Perfect for Project Tofu! 🎉

**Note:** Using Gemini 2.0 Flash (experimental). The same API key works for all Gemini models.

## Troubleshooting

### Error: "GEMINI_API_KEY environment variable not set"
- Make sure `.env` file exists in project root
- Check that the file contains `GEMINI_API_KEY=your_key`
- Restart your terminal after creating `.env`

### Error: "Gemini API error (403): API key not valid"
- Check that you copied the full API key
- Make sure there are no extra spaces or quotes
- Regenerate the key in Google AI Studio if needed

### Error: "Gemini API error (429): Resource exhausted"
- You've hit the rate limit (15 requests/min)
- Wait a minute and try again
- For production use, consider upgrading to paid tier

## Security Notes

⚠️ **NEVER commit your `.env` file to git!**
- It's already in `.gitignore`
- Don't share your API key publicly
- Regenerate the key if accidentally exposed

## Alternative: Environment Variable

If you prefer not to use `.env` file, you can export the key:

```bash
export GEMINI_API_KEY="your_key_here"
cargo run --release -- "show me a circle"
```

On Windows (PowerShell):
```powershell
$env:GEMINI_API_KEY="your_key_here"
cargo run --release -- "show me a circle"
```

---

**Ready to use the AI Brain!** 🧠✨

# Voice Mode - Speak Your Imagination! 🎤

## ✨ Button-Controlled Voice Input

Project Tofu now supports **voice-based interaction** - click the mic button, speak, and watch your words become visualizations!

---

## How It Works

1. **Start Voice Mode** (it's the default!)
   ```bash
   cargo run --release
   ```

2. **Click the Mic Button**
   - Look for the blue mic button in the top-right corner
   - Click it to start recording (it turns red)

3. **Speak Your Vision**
   - Say what you want to visualize
   - Example: "Show me a spiral galaxy"
   - The button stays red while recording

4. **Click Again to Process**
   - Click the button again to stop recording
   - Gemini transcribes your speech
   - AI generates the visualization
   - Particles animate your imagination!

5. **Keep Creating**
   - Click the mic button again for a new visualization
   - Simple, intuitive, no keyboard needed!

**Want text mode instead?**
```bash
cargo run --release -- --text
```

---

## Examples

Try saying:

**Simple Shapes:**
- "Show me a circle"
- "Create a DNA helix"
- "Make a heart shape"

**Complex Objects:**
- "Visualize a spiral galaxy"
- "Show me the Eiffel Tower"
- "Create quantum particles"

**Abstract Concepts:**
- "Show me chaos becoming order"
- "Visualize the concept of time"
- "Create a mandala pattern"

---

## Technical Details

### Audio Capture
- Uses `cpal` for cross-platform microphone access
- Button-controlled recording (click to start/stop)
- Visual feedback via mic button color:
  - Blue: Ready to record
  - Red: Currently recording
- Manual control ensures precise capture

### Speech-to-Text
- **Powered by Gemini 3 Pro Preview**
- No additional API keys needed!
- Sends audio to Gemini's audio understanding API
- Returns transcribed text

### Visualization Pipeline
```
Click Mic Button (Blue → Red)
    ↓
Your Voice Recorded
    ↓
Click Again to Stop (Red → Processing)
    ↓
Audio saved as WAV
    ↓
Gemini Audio API (transcription)
    ↓
Gemini Text API (layout generation)
    ↓
Particles Animate!
    ↓
Mic Button Ready (Blue)
```

---

## Setup

### 1. Ensure Microphone Access
- macOS: Grant microphone permission when prompted
- Linux: Ensure ALSA/PulseAudio is configured
- Windows: Microphone should work automatically

### 2. API Key
Only need **one** API key - your existing Gemini key!

```bash
# .env file
GEMINI_API_KEY=your_key_here
```

Get a free key: https://makersuite.google.com/app/apikey

### 3. Run Voice Mode (Default!)
```bash
cargo run --release
```

That's it! Just speak!

---

## Modes Comparison

| Mode | How to Start | Input Method | Use Case |
|------|--------------|--------------|----------|
| **Voice** 🎤 | `cargo run --release` (default) | Speak naturally | Hands-free, natural interaction |
| **Text** ⌨️ | `cargo run --release -- --text` | Type commands | Precise control, quiet environments |

---

## Advanced Usage

### UI Controls

The mic button is positioned at the top-right corner (90% horizontal, 10% vertical).
To customize the button position, modify [src/ui_overlay.rs:111-113](../src/ui_overlay.rs#L111-L113):
```rust
let center_x = 0.9 * screen_width;  // 0.9 = 90% from left
let center_y = 0.1 * screen_height; // 0.1 = 10% from top
```

### Test Microphone
```bash
# Start app and check for microphone message
cargo run --release
# Look for "🎤 Microphone ready!" message
# Click the mic button and speak: "Show me a DNA helix"
```

---

## Troubleshooting

### "No microphone found"
- Check system permissions
- Ensure microphone is plugged in
- Try different USB port (for external mics)

### "Speech recognition failed"
- Check internet connection (Gemini API is cloud-based)
- Verify `GEMINI_API_KEY` in `.env`
- Try speaking louder or closer to mic

### Visualization not appearing
- Check if transcription is correct (printed in terminal)
- Try rephrasing your prompt
- Ensure window has focus (press ESC to quit, restart if needed)

---

## Why Button-Controlled Voice Mode?

### Natural Interaction
- No typing, no keyboard shortcuts
- Speak like you're talking to a friend
- Truly "Living UI" experience
- Visual feedback via button colors

### Precise Control
- You decide when to start recording
- You decide when to stop
- No false triggers from background noise
- Perfect for noisy environments

### Creative Flow
- Don't break your creative momentum
- Rapid iteration through voice
- Natural language = natural creativity
- Clean, intuitive interface

---

## Behind the Scenes

### Why Gemini for Everything?

1. **Single API Key** - Simplicity!
2. **Unified Experience** - Same AI for speech and vision
3. **Quality** - Gemini 3 Pro Preview excels at both audio and generation
4. **Free Tier** - Generous limits for experimentation

### Audio Format
- WAV files (16kHz, 16-bit, mono)
- Temporary file: `/tmp/tofu_voice.wav`
- Automatically cleaned up after transcription

---

## Performance

- **Latency**: ~1-2 seconds (after clicking stop)
  - Instant: Button click response
  - 0.5-1s: Gemini transcription
  - 0.5-1s: Gemini layout generation

- **Accuracy**: Excellent (Gemini 3 Pro Preview STT)
- **Control**: Precise - you decide when to start/stop
- **Continuous**: Click button again for new visualizations

---

## Future Enhancements

Possible improvements:
- [ ] Multi-language support
- [ ] Custom wake words ("Hey Tofu...")
- [ ] Voice commands (pause, clear, randomize)
- [ ] Real-time transcription display
- [ ] Voice feedback (speak results)

---

## Examples to Try

Click the mic button, say these, then click again:

```
"Show me a perfect circle"
"Create a DNA double helix"
"Visualize a spiral galaxy spinning"
"Show me the Eiffel Tower"
"Create chaos particles becoming orderly"
"Make a heart shape"
"Show me quantum entanglement"
"Visualize sound waves"
"Create a mandala pattern"
"Show me the fibonacci sequence"
```

---

## Summary

| Aspect | Details |
|--------|---------|
| **Activation** | `cargo run --release` (voice is default!) |
| **Input** | Button-controlled voice recording |
| **Controls** | Click mic button → Speak → Click again |
| **Visual Feedback** | Blue (ready) / Red (recording) / Spinner (processing) |
| **Processing** | Gemini audio + text APIs |
| **Output** | Real-time particle visualizations |
| **Latency** | 1-2 seconds after clicking stop |
| **API Key** | Gemini only (free tier available) |
| **Alternative** | `cargo run --release -- --text` for keyboard input |

---

**Click. Speak. Click. Watch. Be amazed.** 🎤✨

---

**Updated:** February 2026
**Feature:** Voice-Based Natural Language Input
**Status:** ✅ Fully Functional
**Dependencies:** Gemini API, cpal, hound

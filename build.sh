#!/bin/bash
# Project Tofu - Rust + wgpu Build Script

set -e

echo "🦀 Project Tofu - Rust + wgpu Build Script"
echo "=========================================="

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust is not installed!"
    echo "Install Rust: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

echo "✅ Rust found: $(rustc --version)"

# Build for desktop
echo ""
echo "Building for desktop (native)..."
cargo build --release

echo ""
echo "✅ Build complete!"
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║      🧊 Project Tofu - Living UI 🧊            ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "✨ Pure AI-Driven Interface"
echo "   Just speak - your imagination becomes reality!"
echo ""
echo "🚀 Usage:"
echo ""
echo "   Voice Mode 🎤 (default - just speak!):"
echo "   $ cargo run --release"
echo ""
echo "   Text Mode ⌨️  (type commands):"
echo "   $ cargo run --release -- --text"
echo ""
echo "💡 Try saying or typing:"
echo "   \"show me a DNA helix\""
echo "   \"create a spiral galaxy\""
echo "   \"visualize an Eiffel Tower\""
echo "   \"show me chaos becoming order\""
echo ""
echo "📖 Setup: docs/GEMINI_SETUP.md (only Gemini API key needed!)"
echo "📖 Voice: docs/VOICE_MODE.md"
echo "📚 Docs:  docs/ folder"
echo ""
echo "⌨️  Controls: ESC or Ctrl+C to quit"
echo ""

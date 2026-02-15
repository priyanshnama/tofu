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
echo "   Type your prompts, watch them come to life!"
echo ""
echo "🚀 Usage:"
echo ""
echo "   Interactive Mode (recommended):"
echo "   $ cargo run --release"
echo "   > show me a DNA helix"
echo "   > create a spiral galaxy"
echo "   > visualize quantum particles"
echo ""
echo "   One-shot Mode:"
echo "   $ cargo run --release -- \"your prompt here\""
echo ""
echo "💡 Examples:"
echo "   cargo run --release -- \"show me a heart shape\""
echo "   cargo run --release -- \"create an Eiffel Tower\""
echo "   cargo run --release -- \"visualize chaos becoming order\""
echo ""
echo "📖 Setup: See docs/GEMINI_SETUP.md"
echo "📚 Docs:  See docs/ folder"
echo ""
echo "⌨️  Controls: ESC or Ctrl+C to quit"
echo ""

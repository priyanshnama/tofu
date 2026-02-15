Here is the formal documentation for **Project Tofu**. You can add this to your repository's `README.md` or `docs/ARCHITECTURE.md`.

This captures the "Living UI" vision and outlines the technical roadmap we discussed, updated for your Rust implementation.

---

# **Project Tofu: Generative UI Framework**

**Status:** ✅ Complete - All 3 Blocks Implemented!
**Core Concept:** A fluid, AI-driven user interface where "screens" do not exist. Instead, the UI is composed of thousands of intelligent "particles" that dynamically rearrange themselves based on user intent.

📖 **[View Full Documentation →](docs/)**

## **1. The Vision**

Traditional UIs are static. You click a button to load a new page.
**Project Tofu** is organic.

* **No Page Loads:** You stay on a single, infinite canvas.
* **Fluidity:** When context changes (e.g., from "Chat" to "Data Visualization"), the UI elements (pixels/widgets) physically morph into the new state.
* **AI-Native:** The layout isn't hardcoded by a designer; it is hallucinated by an AI in real-time to fit the exact data being discussed.

---

## **2. The 3-Block Architecture**

To achieve this, we split the system into three distinct processing layers.

### **Block 1: The Brain (Intelligence Layer)**

* **Role:** The Director.
* **Input:** Natural Language (e.g., "Show me the structure of a DNA helix").
* **Responsibility:** It does not know *how* to draw. It only knows *what* to draw. It parses user intent and outputs a structured **Layout Descriptor**.
* **Tech Stack:** Gemini 2.0 Flash (latest, 2x faster than 1.5 Pro) / OpenAI GPT-4o.
* **Output Format:** JSON (Standardized Schema).
```json
{
  "intent": "visualize_structure",
  "entity": "dna_helix",
  "components": [
    {"type": "backbone", "count": 200, "color": "#FF0000"},
    {"type": "base_pairs", "count": 100, "color": "#00FF00"}
  ]
}

```



### **Block 2: The Layout Engine (Translation Layer)**

* **Role:** The Architect.
* **Input:** Layout Descriptor (JSON) from Block 1.
* **Responsibility:** This is the math layer. It translates abstract concepts (like "Helix") into concrete screen coordinates .
* If the input is "Grid", it calculates row/column positions.
* If the input is "DNA", it applies sine/cosine functions to generate the spiral coordinates.


* **Current State (PoC):** Hardcoded Rust functions (swapping between predetermined shapes).
* **Future State:** A dynamic engine that interprets the JSON to generate coordinates on the fly.

### **Block 3: The Renderer (Physics & Visuals Layer)**

* **Role:** The Artist.
* **Input:** Coordinate List (`Vec<Point>`) from Block 2.
* **Responsibility:** This is the **Rust Runner** you have built.
* **Drawing:** Renders thousands of particles/primitives at 60+ FPS.
* **Physics:** It does not teleport pixels. It interpolates them. It applies "force" to move a pixel from `Current(x,y)` to `Target(x,y)` smoothly.
* **Visuals:** Handles bloom, color blending, and trails.


* **Tech Stack:** Rust (w/ WGPU, Bevy, or similar low-level graphics crate).

---

## **3. The "Tofu" Metaphor**

Why Tofu?

* **Bland but Versatile:** Like raw tofu, the individual UI particles have no inherent meaning.
* **Absorbs Flavor:** They take on the "flavor" (context) of whatever the AI pours onto them.
* **Shape Shifting:** Tofu can be soft, firm, cubed, or sliced. Our UI can be a graph, a chat bubble, a 3D model, or a button.

## **4. How to Use**

### **Quick Start**

1. **Set up your API key:**
   ```bash
   # Create a .env file
   echo "GEMINI_API_KEY=your_key_here" > .env
   ```
   Get a free Gemini API key at: https://makersuite.google.com/app/apikey

2. **Run Voice Mode (Default):**
   ```bash
   cargo run --release
   ```
   - Click the **blue mic button** (top-right corner)
   - Speak your visualization (e.g., "Show me a DNA helix")
   - Click again to stop and process
   - Watch particles animate!

3. **Or run Text Mode:**
   ```bash
   cargo run --release -- --text
   ```
   - Type your prompts in the terminal
   - Press Enter to visualize

### **Examples to Try**

Click mic button and say:
- "Show me a DNA helix"
- "Create a spiral galaxy"
- "Visualize the Eiffel Tower"
- "Make a heart shape"
- "Show me quantum particles"

📖 **[Full Voice Mode Guide →](docs/VOICE_MODE.md)**

---

## **5. Next Steps (Roadmap)**

1. **Refine Physics:** Add "spring" physics to the Rust runner so the particles bounce slightly when they arrive (giving it organic weight).
2. **Multi-modal Input:** Expand beyond voice to support sketch-based input, gesture control, etc.
3. **The "Lego" Protocol:** Continue refining the JSON schema that allows the AI to control the Rust renderer.
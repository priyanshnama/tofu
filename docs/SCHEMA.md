# Project Tofu - JSON Schema (Lego Protocol v1.0)

## Overview

This is the standardized interface between **Block 1 (AI Brain)** and **Block 2 (Layout Engine)**. The AI outputs JSON, and the Layout Engine parses it to generate particle coordinates.

---

## Schema Structure

```json
{
  "version": "1.0",
  "layout": {
    "type": "circle|grid|dna_helix|spiral|wave|random",
    "params": {
      // Type-specific parameters (optional)
    }
  }
}
```

### Fields:

- **`version`** (string): Schema version for backward compatibility. Current: `"1.0"`
- **`layout.type`** (string): The shape/pattern to render. Supported types:
  - `"circle"` - Circular formation
  - `"grid"` - Uniform grid layout
  - `"dna_helix"` - DNA double helix pattern
  - `"spiral"` - Logarithmic spiral
  - `"wave"` - Sine wave pattern
  - `"random"` - Random scattered positions
- **`layout.params`** (object, optional): Shape-specific parameters. If omitted, defaults are used.

---

## Layout Types & Parameters

### 1. Circle

Perfect circular formation.

```json
{
  "version": "1.0",
  "layout": {
    "type": "circle",
    "params": {
      "radius_factor": 0.35
    }
  }
}
```

**Parameters:**
- `radius_factor` (float, default: `0.35`) - Radius as a fraction of screen size (0.0-1.0)

---

### 2. Grid

Uniform grid layout with equal spacing.

```json
{
  "version": "1.0",
  "layout": {
    "type": "grid",
    "params": {
      "padding": 60.0
    }
  }
}
```

**Parameters:**
- `padding` (float, default: `60.0`) - Border padding in pixels

---

### 3. DNA Helix

Double helix pattern with two intertwined strands.

```json
{
  "version": "1.0",
  "layout": {
    "type": "dna_helix",
    "params": {
      "amplitude": 0.2,
      "frequency": 0.02
    }
  }
}
```

**Parameters:**
- `amplitude` (float, default: `0.2`) - Helix width as fraction of screen width
- `frequency` (float, default: `0.02`) - Tightness of the spiral

---

### 4. Spiral

Logarithmic spiral expanding outward.

```json
{
  "version": "1.0",
  "layout": {
    "type": "spiral",
    "params": {
      "max_radius_factor": 0.4,
      "rotations": 3.0
    }
  }
}
```

**Parameters:**
- `max_radius_factor` (float, default: `0.4`) - Maximum radius as fraction of screen size
- `rotations` (float, default: `3.0`) - Number of complete rotations

---

### 5. Wave

Sine wave pattern flowing horizontally.

```json
{
  "version": "1.0",
  "layout": {
    "type": "wave",
    "params": {
      "amplitude": 0.2,
      "frequency": 0.01
    }
  }
}
```

**Parameters:**
- `amplitude` (float, default: `0.2`) - Wave height as fraction of screen height
- `frequency` (float, default: `0.01`) - Wave tightness

---

### 6. Random

Randomly scattered positions.

```json
{
  "version": "1.0",
  "layout": {
    "type": "random",
    "params": {
      "padding": 20.0
    }
  }
}
```

**Parameters:**
- `padding` (float, default: `20.0`) - Border padding in pixels

---

## Example AI Outputs

### User: "Show me a circle"
```json
{
  "version": "1.0",
  "layout": {
    "type": "circle"
  }
}
```

### User: "Create a wide DNA helix"
```json
{
  "version": "1.0",
  "layout": {
    "type": "dna_helix",
    "params": {
      "amplitude": 0.35,
      "frequency": 0.015
    }
  }
}
```

### User: "Make a tight spiral"
```json
{
  "version": "1.0",
  "layout": {
    "type": "spiral",
    "params": {
      "rotations": 5.0,
      "max_radius_factor": 0.45
    }
  }
}
```

---

## Future Extensions (v2.0)

The schema is designed to be extensible. Future versions may include:

1. **Multi-Component Layouts:**
```json
{
  "version": "2.0",
  "components": [
    {"layout": {"type": "circle"}, "count": 200},
    {"layout": {"type": "grid"}, "count": 300}
  ]
}
```

2. **Particle-Level Control:**
```json
{
  "version": "2.0",
  "layout": {"type": "circle"},
  "particles": {
    "colors": ["#FF0000", "#00FF00"],
    "size_range": [2.0, 6.0]
  }
}
```

3. **Custom Shapes:**
```json
{
  "version": "2.0",
  "layout": {
    "type": "custom",
    "coordinates": [[100, 200], [150, 250], ...]
  }
}
```

---

## Validation Rules

1. `version` must be `"1.0"` (string, not number)
2. `layout.type` must be one of the supported types
3. All parameters are optional (defaults will be used)
4. Invalid JSON should fall back to `"random"` layout
5. Unknown layout types should fall back to `"random"`

---

## Implementation Notes

**For Block 2 (Layout Engine):**
- Parse JSON using `serde_json`
- Validate schema version
- Use default values for missing parameters
- Return `Vec<Vec2>` as before

**For Block 1 (AI):**
- Generate valid JSON matching this schema
- Can omit `params` to use defaults
- Should validate output before sending to Block 2

---

**Status:** ✅ Schema v1.0 Complete
**Next Step:** Implement parser in `layout_engine.rs`

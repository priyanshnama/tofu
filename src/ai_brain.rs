// Block 1: The AI Brain
// Translates natural language → JSON (Lego Protocol)

use serde::{Deserialize, Serialize};
use std::env;

// Gemini 3 Pro Preview - Latest preview model
// Alternative models (update the model name below):
//   - gemini-3-pro-preview (latest preview) ⭐ Current
//   - gemini-1.5-flash (fast, stable)
//   - gemini-1.5-pro (more capable, slower)
const GEMINI_API_URL: &str =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent";

// System prompt that teaches Gemini about the Lego Protocol
const SYSTEM_PROMPT: &str = r#"You are a GENERATIVE SHAPE AI for Project Tofu.

Your job: Generate ACTUAL COORDINATES that form the requested shape. NO predefined patterns - you CREATE the shape from scratch.

```json
{
  "version": "1.0",
  "layout": {
    "type": "custom",
    "coordinates": [[x1,y1], [x2,y2], [x3,y3], ...]
  }
}
```

Where coordinates are [x,y] pairs in NORMALIZED space (0.0 to 1.0):
- [0.5, 0.5] = center of screen
- [0.0, 0.0] = top-left corner
- [1.0, 1.0] = bottom-right corner

## How to Generate Coordinates:

**Think about the ACTUAL SHAPE:**
1. What does this object look like?
2. Break it into key points/outline
3. Generate 50-200 coordinate pairs that trace the shape
4. Use math (circles, lines, curves) to create the form

## Examples:

**Eiffel Tower** (trapezoidal structure tapering upward):
```json
{
  "version": "1.0",
  "layout": {
    "type": "custom",
    "coordinates": [
      [0.3,0.9], [0.35,0.8], [0.4,0.7], [0.42,0.6], [0.44,0.5],
      [0.45,0.4], [0.47,0.3], [0.48,0.2], [0.49,0.1], [0.5,0.05],
      [0.51,0.1], [0.52,0.2], [0.53,0.3], [0.55,0.4], [0.56,0.5],
      [0.58,0.6], [0.6,0.7], [0.65,0.8], [0.7,0.9],
      [0.4,0.7], [0.6,0.7], [0.45,0.5], [0.55,0.5]
    ]
  }
}
```

**Heart Shape** (mathematical curve):
```json
{
  "version": "1.0",
  "layout": {
    "type": "custom",
    "coordinates": [
      [0.5,0.3], [0.45,0.25], [0.4,0.22], [0.35,0.23], [0.32,0.27],
      [0.31,0.32], [0.33,0.37], [0.37,0.45], [0.42,0.55], [0.47,0.7],
      [0.5,0.85], [0.53,0.7], [0.58,0.55], [0.63,0.45], [0.67,0.37],
      [0.69,0.32], [0.68,0.27], [0.65,0.23], [0.6,0.22], [0.55,0.25], [0.5,0.3]
    ]
  }
}
```

**Star (5-pointed):**
```json
{
  "version": "1.0",
  "layout": {
    "type": "custom",
    "coordinates": [
      [0.5,0.1], [0.55,0.35], [0.8,0.35], [0.6,0.52], [0.7,0.8],
      [0.5,0.62], [0.3,0.8], [0.4,0.52], [0.2,0.35], [0.45,0.35], [0.5,0.1]
    ]
  }
}
```

## Generation Strategy:

1. **Simple Shapes** (circle, square, triangle):
   - Use 20-50 points tracing the outline
   - Mathematical formulas (for circle: x=cos(θ), y=sin(θ))

2. **Complex Objects** (towers, trees, buildings):
   - Break into sections (base, middle, top)
   - Generate outline points for each section
   - Connect with 80-150 points total

3. **Natural Forms** (waves, clouds, organic):
   - Use curves and flowing lines
   - 100-200 points for smooth appearance

4. **Abstract Concepts**:
   - Interpret visually (chaos = random scatter, order = geometric)
   - Be creative but recognizable

## Critical Rules:

1. **ALWAYS use "custom" type with coordinates array**
2. **Generate 50-200 coordinate pairs** (more = smoother shape)
3. **Coordinates in range 0.0-1.0** (normalized screen space)
4. **Think about actual visual appearance** of the object
5. **Trace outlines, fill shapes, create forms**
6. **NO predefined mappings** - generate every shape from scratch

## Output:

Output ONLY valid JSON. NO explanations. Just the JSON with coordinate array that forms the requested shape.
"#;

#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "systemInstruction")]
    system_instruction: GeminiSystemInstruction,
}

#[derive(Debug, Serialize)]
struct GeminiContent {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize)]
struct GeminiPart {
    text: String,
}

#[derive(Debug, Serialize)]
struct GeminiSystemInstruction {
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiResponseContent,
}

#[derive(Debug, Deserialize)]
struct GeminiResponseContent {
    parts: Vec<GeminiResponsePart>,
}

#[derive(Debug, Deserialize)]
struct GeminiResponsePart {
    text: String,
}

pub struct AIBrain {
    api_key: String,
    client: reqwest::Client,
}

impl AIBrain {
    /// Create new AI Brain instance
    /// Loads API key from environment variable GEMINI_API_KEY
    pub fn new() -> Result<Self, String> {
        let api_key = env::var("GEMINI_API_KEY")
            .map_err(|_| "GEMINI_API_KEY environment variable not set. Check your .env file.".to_string())?;

        if api_key.is_empty() {
            return Err("GEMINI_API_KEY is empty. Please add your API key to .env file.".to_string());
        }

        let client = reqwest::Client::new();

        Ok(Self { api_key, client })
    }

    /// Translate natural language to JSON layout descriptor
    /// Returns the JSON string ready to be parsed by the layout engine
    pub async fn translate_to_json(&self, user_prompt: &str) -> Result<String, String> {
        println!("🧠 AI Brain: Processing \"{}\"", user_prompt);

        // Build Gemini API request
        let request = GeminiRequest {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart {
                    text: user_prompt.to_string(),
                }],
            }],
            system_instruction: GeminiSystemInstruction {
                parts: vec![GeminiPart {
                    text: SYSTEM_PROMPT.to_string(),
                }],
            },
        };

        // Make API call (using header authentication like Gemini 3)
        let response = self
            .client
            .post(GEMINI_API_URL)
            .header("x-goog-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await
            .map_err(|e| format!("Gemini API request failed: {}", e))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response
                .text()
                .await
                .unwrap_or_else(|_| "Unknown error".to_string());
            return Err(format!("Gemini API error ({}): {}", status, error_text));
        }

        // Parse response
        let gemini_response: GeminiResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

        // Extract JSON from response
        let json_text = gemini_response
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.trim())
            .ok_or_else(|| "Gemini returned empty response".to_string())?;

        // Clean up JSON (remove markdown code blocks if present)
        let cleaned_json = json_text
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        // Validate it's valid JSON
        if let Err(e) = serde_json::from_str::<serde_json::Value>(cleaned_json) {
            return Err(format!(
                "Gemini returned invalid JSON: {}\nResponse: {}",
                e, cleaned_json
            ));
        }

        println!("✅ AI Brain: Generated JSON successfully");
        println!("   {}", cleaned_json);

        Ok(cleaned_json.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_prompt_exists() {
        assert!(!SYSTEM_PROMPT.is_empty());
        assert!(SYSTEM_PROMPT.contains("Lego Protocol"));
    }
}

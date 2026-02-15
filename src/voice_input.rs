/// Transcribe audio file using Gemini API
pub async fn transcribe_audio(audio_path: &std::path::Path) -> Result<String, String> {
    // Read Gemini API key from environment
    let api_key = std::env::var("GEMINI_API_KEY")
        .map_err(|_| "GEMINI_API_KEY not found in environment. Add it to .env file".to_string())?;

    // Read audio file and encode as base64
    let audio_bytes = std::fs::read(audio_path)
        .map_err(|e| format!("Failed to read audio file: {}", e))?;

    let audio_base64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &audio_bytes);

    // Use Gemini's audio understanding capability
    let client = reqwest::Client::new();

    let request_body = serde_json::json!({
        "contents": [{
            "parts": [
                {
                    "inline_data": {
                        "mime_type": "audio/wav",
                        "data": audio_base64
                    }
                },
                {
                    "text": "Transcribe this audio to text. Return ONLY the transcribed text, nothing else."
                }
            ]
        }]
    });

    let response = client
        .post("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent")
        .header("x-goog-api-key", &api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Gemini API request failed: {}", e))?;

    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Gemini API error: {}", error_text));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;

    // Extract text from Gemini response
    let text = json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or("No transcription in Gemini response")?
        .trim()
        .to_string();

    Ok(text)
}

use glam::Vec2;
use serde::{Deserialize, Serialize};
use std::f32::consts::PI;

/// JSON Layout Descriptor (Lego Protocol v1.0)
#[derive(Debug, Deserialize, Serialize)]
pub struct LayoutDescriptor {
    pub version: String,
    pub layout: LayoutConfig,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct LayoutConfig {
    #[serde(rename = "type")]
    pub layout_type: String,
    #[serde(default)]
    pub params: LayoutParams,
    #[serde(default)]
    pub coordinates: Option<Vec<[f32; 2]>>,  // For custom layouts
}

/// Optional parameters for each layout type
#[derive(Debug, Deserialize, Serialize, Default)]
pub struct LayoutParams {
    // Circle
    pub radius_factor: Option<f32>,
    // Grid & Random
    pub padding: Option<f32>,
    // DNA Helix & Wave
    pub amplitude: Option<f32>,
    pub frequency: Option<f32>,
    // Spiral
    pub max_radius_factor: Option<f32>,
    pub rotations: Option<f32>,
}

pub struct LayoutEngine {
    screen_width: f32,
    screen_height: f32,
}

impl LayoutEngine {
    pub fn new(screen_width: f32, screen_height: f32) -> Self {
        Self {
            screen_width,
            screen_height,
        }
    }

    /// Generate layout from JSON string (Lego Protocol)
    pub fn generate_from_json_str(&self, json: &str, particle_count: usize) -> Vec<Vec2> {
        match serde_json::from_str::<LayoutDescriptor>(json) {
            Ok(descriptor) => self.generate_from_json(&descriptor, particle_count),
            Err(e) => {
                eprintln!("JSON parse error: {}. Falling back to random layout.", e);
                self.random(particle_count, None)
            }
        }
    }

    /// Generate layout from parsed JSON descriptor
    pub fn generate_from_json(&self, descriptor: &LayoutDescriptor, particle_count: usize) -> Vec<Vec2> {
        // Validate version
        if descriptor.version != "1.0" {
            eprintln!(
                "Warning: Unknown schema version '{}'. Expected '1.0'",
                descriptor.version
            );
        }

        // Check for custom coordinates first
        if let Some(coords) = &descriptor.layout.coordinates {
            println!("🎨 Using AI-generated custom coordinates!");
            return self.custom(coords, particle_count);
        }

        let layout_type = descriptor.layout.layout_type.to_lowercase();
        let params = &descriptor.layout.params;

        match layout_type.as_str() {
            "custom" => {
                eprintln!("Warning: 'custom' type requires coordinates array");
                self.random(particle_count, None)
            }
            "circle" => self.circle(particle_count, params.radius_factor),
            "grid" => self.grid(particle_count, params.padding),
            "dna_helix" | "helix" => {
                self.dna_helix(particle_count, params.amplitude, params.frequency)
            }
            "spiral" => self.spiral(
                particle_count,
                params.max_radius_factor,
                params.rotations,
            ),
            "wave" => self.wave(particle_count, params.amplitude, params.frequency),
            "random" => self.random(particle_count, params.padding),
            _ => {
                eprintln!(
                    "Unknown layout type '{}'. Falling back to random.",
                    layout_type
                );
                self.random(particle_count, None)
            }
        }
    }

    /// Generate target layout based on command (backward compatibility)
    pub fn generate(&self, command: &str, particle_count: usize) -> Vec<Vec2> {
        match command.to_lowercase().as_str() {
            "circle" => self.circle(particle_count, None),
            "grid" => self.grid(particle_count, None),
            "dna" | "helix" => self.dna_helix(particle_count, None, None),
            "spiral" => self.spiral(particle_count, None, None),
            "wave" => self.wave(particle_count, None, None),
            _ => self.random(particle_count, None),
        }
    }

    /// Perfect circle formation
    fn circle(&self, count: usize, radius_factor: Option<f32>) -> Vec<Vec2> {
        let center = Vec2::new(self.screen_width / 2.0, self.screen_height / 2.0);
        let radius_factor = radius_factor.unwrap_or(0.35);
        let radius = self.screen_width.min(self.screen_height) * radius_factor;

        (0..count)
            .map(|i| {
                let angle = (i as f32 / count as f32) * 2.0 * PI;
                center + Vec2::new(angle.cos(), angle.sin()) * radius
            })
            .collect()
    }

    /// Uniform grid layout
    fn grid(&self, count: usize, padding_opt: Option<f32>) -> Vec<Vec2> {
        let cols = (count as f32).sqrt().ceil() as usize;
        let rows = (count + cols - 1) / cols;

        let padding = padding_opt.unwrap_or(60.0);
        let cell_width = (self.screen_width - padding * 2.0) / cols as f32;
        let cell_height = (self.screen_height - padding * 2.0) / rows as f32;

        (0..count)
            .map(|i| {
                let row = i / cols;
                let col = i % cols;

                Vec2::new(
                    padding + col as f32 * cell_width + cell_width / 2.0,
                    padding + row as f32 * cell_height + cell_height / 2.0,
                )
            })
            .collect()
    }

    /// DNA double helix pattern
    fn dna_helix(
        &self,
        count: usize,
        amplitude_opt: Option<f32>,
        frequency_opt: Option<f32>,
    ) -> Vec<Vec2> {
        let center_x = self.screen_width / 2.0;
        let amplitude = self.screen_width * amplitude_opt.unwrap_or(0.2);
        let frequency = frequency_opt.unwrap_or(0.02);
        let vertical_spacing = self.screen_height / count as f32;

        (0..count)
            .map(|i| {
                let y = i as f32 * vertical_spacing;
                let phase = i as f32 * frequency * 2.0 * PI;

                // Alternate between two helices
                let x_offset = amplitude * phase.sin();
                let x = if i % 2 == 0 {
                    center_x + x_offset
                } else {
                    center_x - x_offset
                };

                Vec2::new(x, y)
            })
            .collect()
    }

    /// Logarithmic spiral
    fn spiral(
        &self,
        count: usize,
        max_radius_factor_opt: Option<f32>,
        rotations_opt: Option<f32>,
    ) -> Vec<Vec2> {
        let center = Vec2::new(self.screen_width / 2.0, self.screen_height / 2.0);
        let max_radius_factor = max_radius_factor_opt.unwrap_or(0.4);
        let max_radius = self.screen_width.min(self.screen_height) * max_radius_factor;
        let rotations = rotations_opt.unwrap_or(3.0);

        (0..count)
            .map(|i| {
                let t = i as f32 / count as f32;
                let angle = t * rotations * 2.0 * PI;
                let radius = max_radius * t;

                center + Vec2::new(angle.cos(), angle.sin()) * radius
            })
            .collect()
    }

    /// Sine wave pattern
    fn wave(
        &self,
        count: usize,
        amplitude_opt: Option<f32>,
        frequency_opt: Option<f32>,
    ) -> Vec<Vec2> {
        let amplitude = self.screen_height * amplitude_opt.unwrap_or(0.2);
        let frequency = frequency_opt.unwrap_or(0.01);
        let center_y = self.screen_height / 2.0;
        let horizontal_spacing = self.screen_width / count as f32;

        (0..count)
            .map(|i| {
                let x = i as f32 * horizontal_spacing;
                let y = center_y + amplitude * (i as f32 * frequency * 2.0 * PI).sin();

                Vec2::new(x, y)
            })
            .collect()
    }

    /// Random scattered positions
    fn random(&self, count: usize, padding_opt: Option<f32>) -> Vec<Vec2> {
        use rand::Rng;
        let mut rng = rand::thread_rng();
        let padding = padding_opt.unwrap_or(20.0);

        (0..count)
            .map(|_| {
                Vec2::new(
                    rng.gen_range(padding..self.screen_width - padding),
                    rng.gen_range(padding..self.screen_height - padding),
                )
            })
            .collect()
    }

    /// Custom layout from AI-generated coordinates
    /// Takes normalized coordinates (0.0-1.0) and scales to screen size
    /// Distributes particles along the provided points
    fn custom(&self, coords: &[[f32; 2]], particle_count: usize) -> Vec<Vec2> {
        if coords.is_empty() {
            eprintln!("Warning: Empty coordinates array, using random layout");
            return self.random(particle_count, None);
        }

        // Scale normalized coordinates to screen size
        let scaled_coords: Vec<Vec2> = coords
            .iter()
            .map(|[x, y]| {
                Vec2::new(
                    x * self.screen_width,
                    y * self.screen_height,
                )
            })
            .collect();

        // Distribute particles evenly among the provided coordinates
        // If we have more particles than coordinates, interpolate between points
        if scaled_coords.len() >= particle_count {
            // Sample from the coordinates
            (0..particle_count)
                .map(|i| {
                    let idx = (i * scaled_coords.len()) / particle_count;
                    scaled_coords[idx]
                })
                .collect()
        } else {
            // Interpolate to fill particle_count
            (0..particle_count)
                .map(|i| {
                    let t = i as f32 / (particle_count - 1) as f32;
                    let float_idx = t * (scaled_coords.len() - 1) as f32;
                    let idx = float_idx.floor() as usize;
                    let next_idx = (idx + 1).min(scaled_coords.len() - 1);
                    let blend = float_idx - idx as f32;

                    // Linear interpolation between points
                    scaled_coords[idx] * (1.0 - blend) + scaled_coords[next_idx] * blend
                })
                .collect()
        }
    }
}

// Library exports for WebAssembly and library usage
pub mod ai_brain;
pub mod layout_engine;
pub mod particle_system;
pub mod renderer;

// Re-export main types
pub use ai_brain::AIBrain;
pub use layout_engine::LayoutEngine;
pub use particle_system::{Particle, ParticleSystem};
pub use renderer::Renderer;

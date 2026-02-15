use glam::{Vec2, Vec4};
use rand::Rng;

/// GPU-aligned particle structure (16-byte aligned for GPU)
/// This struct is directly copied to GPU buffers - zero-copy design
#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Particle {
    pub position: [f32; 2],      // Current position (x, y)
    pub target: [f32; 2],        // Target position
    pub color: [f32; 4],         // RGBA color
    pub size: f32,               // Particle size
    pub _padding: [f32; 3],      // Padding for 16-byte alignment
}

impl Particle {
    pub fn new(position: Vec2, color: Vec4, size: f32) -> Self {
        Self {
            position: position.to_array(),
            target: position.to_array(),
            color: color.to_array(),
            size,
            _padding: [0.0; 3],
        }
    }
}

/// High-performance particle system with GPU-friendly layout
pub struct ParticleSystem {
    pub particles: Vec<Particle>,
    pub count: usize,
    velocities: Vec<Vec2>,       // Velocity for spring physics (CPU-side only)
    spring_strength: f32,         // Spring force multiplier (0.0-1.0)
    damping: f32,                 // Velocity damping (0.0-1.0)
}

impl ParticleSystem {
    /// Create new particle system with random initialization
    pub fn new(count: usize, screen_width: f32, screen_height: f32) -> Self {
        let mut rng = rand::thread_rng();
        let colors = [
            Vec4::new(0.0, 1.0, 0.0, 1.0), // Neon Green
            Vec4::new(0.0, 1.0, 1.0, 1.0), // Cyan
            Vec4::new(0.0, 1.0, 0.53, 1.0), // Mint
            Vec4::new(0.53, 1.0, 0.0, 1.0), // Lime
        ];

        let particles = (0..count)
            .map(|_| {
                let x = rng.gen_range(20.0..screen_width - 20.0);
                let y = rng.gen_range(20.0..screen_height - 20.0);
                let color = colors[rng.gen_range(0..colors.len())];
                let size = rng.gen_range(3.0..5.0);

                Particle::new(Vec2::new(x, y), color, size)
            })
            .collect();

        // Initialize velocities to zero
        let velocities = vec![Vec2::ZERO; count];

        Self {
            particles,
            count,
            velocities,
            spring_strength: 0.08,  // Moderate spring force for smooth, organic movement
            damping: 0.85,          // Damping prevents infinite oscillation
        }
    }

    /// Update all particle positions using spring physics
    /// Spring physics creates organic, bouncy movement with inertia
    /// This is CPU-side update, but could be moved to GPU compute shader
    pub fn update(&mut self) {
        for (i, particle) in self.particles.iter_mut().enumerate() {
            let position = Vec2::from_array(particle.position);
            let target = Vec2::from_array(particle.target);
            let velocity = self.velocities[i];

            // Spring physics: F = -k * displacement
            let displacement = target - position;
            let spring_force = displacement * self.spring_strength;

            // Update velocity with damping
            let new_velocity = velocity * self.damping + spring_force;

            // Update position
            let new_position = position + new_velocity;

            // Store updated values
            particle.position = new_position.to_array();
            self.velocities[i] = new_velocity;
        }
    }

    /// Set new target positions for morphing
    pub fn set_targets(&mut self, targets: &[Vec2]) {
        for (i, particle) in self.particles.iter_mut().enumerate() {
            if i < targets.len() {
                particle.target = targets[i].to_array();
            }
        }
    }

    /// Get particles as byte slice for GPU upload (zero-copy)
    pub fn as_bytes(&self) -> &[u8] {
        bytemuck::cast_slice(&self.particles)
    }
}

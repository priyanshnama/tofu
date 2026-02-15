// Particle Vertex Shader for wgpu (Metal/Vulkan/WebGPU)
// GPU instancing - one draw call for all particles

struct Uniforms {
    screen_size: vec2<f32>,
    time: f32,
    _padding: f32,
}

struct Particle {
    position: vec2<f32>,
    target_pos: vec2<f32>,
    color: vec4<f32>,
    size: f32,
    _padding: vec3<f32>,
}

struct VertexInput {
    @location(0) local_position: vec2<f32>,  // Quad vertex position
}

struct InstanceInput {
    @location(1) particle_position: vec2<f32>,
    @location(2) particle_target: vec2<f32>,
    @location(3) particle_color: vec4<f32>,
    @location(4) particle_size: f32,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
    @location(1) local_pos: vec2<f32>,  // For distance calculation in fragment shader
    @location(2) size: f32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// Vertex shader - runs once per vertex per instance
@vertex
fn vs_main(
    vertex: VertexInput,
    instance: InstanceInput,
) -> VertexOutput {
    var out: VertexOutput;

    // Transform to clip space (-1 to 1)
    let screen_pos = instance.particle_position / uniforms.screen_size * 2.0 - 1.0;
    let vertex_offset = vertex.local_position * instance.particle_size / uniforms.screen_size * 2.0;

    // Flip Y axis (screen space to clip space)
    out.clip_position = vec4<f32>(
        screen_pos.x + vertex_offset.x,
        -(screen_pos.y + vertex_offset.y),
        0.0,
        1.0
    );

    out.color = instance.particle_color;
    out.local_pos = vertex.local_position;
    out.size = instance.particle_size;

    return out;
}

// Fragment shader - runs once per pixel
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    // Calculate distance from center for circular glow
    let dist = length(in.local_pos);

    // Smooth circular falloff for glow effect
    let alpha = smoothstep(1.0, 0.0, dist);

    // Brighter core
    let core_intensity = smoothstep(0.5, 0.0, dist);

    // Combine glow and core
    let final_alpha = alpha * 0.6 + core_intensity * 0.4;

    return vec4<f32>(in.color.rgb, in.color.a * final_alpha);
}

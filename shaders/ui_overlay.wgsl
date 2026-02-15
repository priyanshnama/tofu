// Simple UI overlay shader for status indicators

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) color: vec4<f32>,
}

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) color: vec4<f32>,
}

@vertex
fn vs_main(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;

    // Convert normalized coordinates (0-1) to clip space (-1 to 1)
    let x = in.position.x * 2.0 - 1.0;
    let y = -(in.position.y * 2.0 - 1.0); // Flip Y

    out.clip_position = vec4<f32>(x, y, 0.0, 1.0);
    out.color = in.color;

    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return in.color;
}

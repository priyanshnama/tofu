/// Simple UI overlay for showing status (microphone, loading)

#[repr(C)]
#[derive(Copy, Clone, Debug, bytemuck::Pod, bytemuck::Zeroable)]
struct UIVertex {
    position: [f32; 2],
    color: [f32; 4],
}

pub struct UIOverlay {
    pipeline: wgpu::RenderPipeline,
    vertex_buffer: wgpu::Buffer,
    index_buffer: wgpu::Buffer,
    num_indices: u32,
}

impl UIOverlay {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        // Create shader
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("UI Overlay Shader"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/ui_overlay.wgsl").into()),
        });

        // Create pipeline
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("UI Overlay Pipeline Layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("UI Overlay Pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<UIVertex>() as wgpu::BufferAddress,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[
                        wgpu::VertexAttribute {
                            offset: 0,
                            shader_location: 0,
                            format: wgpu::VertexFormat::Float32x2,
                        },
                        wgpu::VertexAttribute {
                            offset: 8,
                            shader_location: 1,
                            format: wgpu::VertexFormat::Float32x4,
                        },
                    ],
                }],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState {
                topology: wgpu::PrimitiveTopology::TriangleList,
                strip_index_format: None,
                front_face: wgpu::FrontFace::Ccw,
                cull_mode: None,
                polygon_mode: wgpu::PolygonMode::Fill,
                unclipped_depth: false,
                conservative: false,
            },
            depth_stencil: None,
            multisample: wgpu::MultisampleState {
                count: 1,
                mask: !0,
                alpha_to_coverage_enabled: false,
            },
            multiview: None,
            cache: None,
        });

        // Create empty buffers (will be updated when rendering)
        let vertex_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("UI Vertex Buffer"),
            size: 4096,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let index_buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("UI Index Buffer"),
            size: 4096,
            usage: wgpu::BufferUsages::INDEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        Self {
            pipeline,
            vertex_buffer,
            index_buffer,
            num_indices: 0,
        }
    }

    /// Check if point is inside mic button
    pub fn is_mic_button_clicked(&self, x: f32, y: f32, screen_width: f32, screen_height: f32) -> bool {
        let center_x = 0.9 * screen_width;
        let center_y = 0.1 * screen_height;
        let radius = 0.06 * screen_height.min(screen_width);

        let dx = x - center_x;
        let dy = y - center_y;
        (dx * dx + dy * dy).sqrt() < radius
    }

    /// Render a microphone button (clickable)
    pub fn render_mic_button(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        _screen_width: f32,
        _screen_height: f32,
        is_recording: bool,
    ) {
        // Button: larger circle with mic icon
        let center_x = 0.9;
        let center_y = 0.1;
        let button_radius = 0.06;
        let icon_radius = 0.03;

        // Button color changes when recording
        let button_color = if is_recording {
            [1.0, 0.2, 0.2, 0.9] // Red when recording
        } else {
            [0.3, 0.6, 0.9, 0.9] // Blue when idle
        };

        let mut vertices = Vec::new();
        let mut indices = Vec::new();

        // Outer button circle
        let segments = 30;
        let center_idx = vertices.len() as u16;
        vertices.push(UIVertex {
            position: [center_x, center_y],
            color: button_color,
        });

        for i in 0..=segments {
            let angle = (i as f32 / segments as f32) * std::f32::consts::PI * 2.0;
            let x = center_x + button_radius * angle.cos();
            let y = center_y + button_radius * angle.sin();
            vertices.push(UIVertex {
                position: [x, y],
                color: button_color,
            });

            if i > 0 {
                indices.push(center_idx);
                indices.push(center_idx + i);
                indices.push(center_idx + i + 1);
            }
        }

        // Mic icon (white)
        let icon_color = [1.0, 1.0, 1.0, 1.0];

        // Mic head (small circle)
        let mic_center_idx = vertices.len() as u16;
        vertices.push(UIVertex {
            position: [center_x, center_y - 0.01],
            color: icon_color,
        });

        let icon_segments = 15;
        for i in 0..=icon_segments {
            let angle = (i as f32 / icon_segments as f32) * std::f32::consts::PI * 2.0;
            let x = center_x + icon_radius * 0.5 * angle.cos();
            let y = center_y - 0.01 + icon_radius * 0.7 * angle.sin();
            vertices.push(UIVertex {
                position: [x, y],
                color: icon_color,
            });

            if i > 0 {
                indices.push(mic_center_idx);
                indices.push(mic_center_idx + i);
                indices.push(mic_center_idx + i + 1);
            }
        }

        // Mic stand (vertical line)
        let line_width = 0.005;
        let line_start_y = center_y + 0.015;
        let line_end_y = center_y + 0.04;

        let base_idx = vertices.len() as u16;
        vertices.push(UIVertex {
            position: [center_x - line_width, line_start_y],
            color: icon_color,
        });
        vertices.push(UIVertex {
            position: [center_x + line_width, line_start_y],
            color: icon_color,
        });
        vertices.push(UIVertex {
            position: [center_x + line_width, line_end_y],
            color: icon_color,
        });
        vertices.push(UIVertex {
            position: [center_x - line_width, line_end_y],
            color: icon_color,
        });

        indices.push(base_idx);
        indices.push(base_idx + 1);
        indices.push(base_idx + 2);
        indices.push(base_idx);
        indices.push(base_idx + 2);
        indices.push(base_idx + 3);

        self.upload_and_render(device, queue, encoder, view, vertices, indices);
    }

    /// Render a microphone icon (for listening state)
    #[allow(dead_code)]
    pub fn render_microphone(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        _screen_width: f32,
        _screen_height: f32,
    ) {
        // Microphone icon: circle + vertical line (simplified mic shape)
        let center_x = 0.9;
        let center_y = 0.1;
        let radius = 0.04;
        let color = [1.0, 0.3, 0.3, 0.8]; // Red with transparency

        let mut vertices = Vec::new();
        let mut indices = Vec::new();

        // Circle (mic head)
        let segments = 20;
        let center_idx = vertices.len() as u16;
        vertices.push(UIVertex {
            position: [center_x, center_y],
            color,
        });

        for i in 0..=segments {
            let angle = (i as f32 / segments as f32) * std::f32::consts::PI * 2.0;
            let x = center_x + radius * angle.cos();
            let y = center_y + radius * angle.sin();
            vertices.push(UIVertex {
                position: [x, y],
                color,
            });

            if i > 0 {
                indices.push(center_idx);
                indices.push(center_idx + i);
                indices.push(center_idx + i + 1);
            }
        }

        // Vertical line (mic stand)
        let line_width = 0.008;
        let line_start_y = center_y + radius;
        let line_end_y = center_y + radius * 2.0;

        let base_idx = vertices.len() as u16;
        vertices.push(UIVertex {
            position: [center_x - line_width, line_start_y],
            color,
        });
        vertices.push(UIVertex {
            position: [center_x + line_width, line_start_y],
            color,
        });
        vertices.push(UIVertex {
            position: [center_x + line_width, line_end_y],
            color,
        });
        vertices.push(UIVertex {
            position: [center_x - line_width, line_end_y],
            color,
        });

        indices.push(base_idx);
        indices.push(base_idx + 1);
        indices.push(base_idx + 2);
        indices.push(base_idx);
        indices.push(base_idx + 2);
        indices.push(base_idx + 3);

        self.upload_and_render(device, queue, encoder, view, vertices, indices);
    }

    /// Render a circular loading indicator (for processing state)
    pub fn render_loading(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        _screen_width: f32,
        _screen_height: f32,
        time: f32,
    ) {
        // Spinning arc
        let center_x = 0.5;
        let center_y = 0.5;
        let radius = 0.08;
        let thickness = 0.012;
        let color = [0.3, 0.8, 1.0, 0.9]; // Blue

        let mut vertices = Vec::new();
        let mut indices = Vec::new();

        // Rotating arc (3/4 of a circle)
        let segments = 30;
        let arc_length = std::f32::consts::PI * 1.5; // 270 degrees
        let rotation = time * 2.0; // Rotate over time

        for i in 0..segments {
            let angle1 = rotation + (i as f32 / segments as f32) * arc_length;
            let angle2 = rotation + ((i + 1) as f32 / segments as f32) * arc_length;

            let base_idx = vertices.len() as u16;

            // Inner arc point 1
            vertices.push(UIVertex {
                position: [
                    center_x + (radius - thickness) * angle1.cos(),
                    center_y + (radius - thickness) * angle1.sin(),
                ],
                color,
            });

            // Outer arc point 1
            vertices.push(UIVertex {
                position: [
                    center_x + (radius + thickness) * angle1.cos(),
                    center_y + (radius + thickness) * angle1.sin(),
                ],
                color,
            });

            // Outer arc point 2
            vertices.push(UIVertex {
                position: [
                    center_x + (radius + thickness) * angle2.cos(),
                    center_y + (radius + thickness) * angle2.sin(),
                ],
                color,
            });

            // Inner arc point 2
            vertices.push(UIVertex {
                position: [
                    center_x + (radius - thickness) * angle2.cos(),
                    center_y + (radius - thickness) * angle2.sin(),
                ],
                color,
            });

            // Two triangles to form quad
            indices.push(base_idx);
            indices.push(base_idx + 1);
            indices.push(base_idx + 2);
            indices.push(base_idx);
            indices.push(base_idx + 2);
            indices.push(base_idx + 3);
        }

        self.upload_and_render(device, queue, encoder, view, vertices, indices);
    }

    fn upload_and_render(
        &mut self,
        _device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        view: &wgpu::TextureView,
        vertices: Vec<UIVertex>,
        mut indices: Vec<u16>,
    ) {
        if vertices.is_empty() || indices.is_empty() {
            return;
        }

        // Upload vertices
        queue.write_buffer(&self.vertex_buffer, 0, bytemuck::cast_slice(&vertices));

        // Upload indices - ensure alignment to 4 bytes (COPY_BUFFER_ALIGNMENT)
        // Since u16 indices are 2 bytes each, we need an even number for 4-byte alignment
        let original_index_count = indices.len();
        if indices.len() % 2 != 0 {
            // Add a padding index (won't be rendered since num_indices is set to original count)
            indices.push(0);
        }
        queue.write_buffer(&self.index_buffer, 0, bytemuck::cast_slice(&indices));

        self.num_indices = original_index_count as u32;

        // Render
        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("UI Overlay Render Pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });

        render_pass.set_pipeline(&self.pipeline);
        render_pass.set_vertex_buffer(0, self.vertex_buffer.slice(..));
        render_pass.set_index_buffer(self.index_buffer.slice(..), wgpu::IndexFormat::Uint16);
        render_pass.draw_indexed(0..self.num_indices, 0, 0..1);
    }
}

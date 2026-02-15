mod ai_brain;
mod layout_engine;
mod particle_system;
mod renderer;
mod ui_overlay;
mod voice_input;

use layout_engine::LayoutEngine;
use particle_system::ParticleSystem;
use renderer::Renderer;
use std::io::{self, Write};
use std::sync::Arc;
use std::thread;
use std::time::Instant;
use winit::{
    application::ApplicationHandler,
    event::*,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    keyboard::{KeyCode, PhysicalKey},
    window::{Window, WindowId},
};

const PARTICLE_COUNT: usize = 500;

#[derive(Debug, Clone)]
enum UserEvent {
    NewLayout(String),
    UIState(UIState),
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum UIState {
    Idle,
    Recording,
    Transcribing,
    Generating,
}

struct App {
    renderer: Option<Renderer>,
    particle_system: Option<ParticleSystem>,
    layout_engine: Option<LayoutEngine>,
    start_time: Instant,
    window: Option<Arc<Window>>,
    ui_overlay: Option<ui_overlay::UIOverlay>,
    ui_state: UIState,
    is_recording: bool,
    last_cursor_pos: Option<(f32, f32)>,
    recording_flag: Option<Arc<std::sync::Mutex<bool>>>,
}

impl App {
    fn new() -> Self {
        Self {
            renderer: None,
            particle_system: None,
            layout_engine: None,
            start_time: Instant::now(),
            window: None,
            ui_overlay: None,
            ui_state: UIState::Idle,
            is_recording: false,
            last_cursor_pos: None,
            recording_flag: None,
        }
    }

    fn apply_json_layout(&mut self, json: &str) {
        if let (Some(layout_engine), Some(particle_system)) =
            (&self.layout_engine, &mut self.particle_system)
        {
            let targets = layout_engine.generate_from_json_str(json, PARTICLE_COUNT);
            particle_system.set_targets(&targets);
            println!("✨ Layout updated!\n");
        }
    }

    // Removed preset methods - now purely AI-driven via command-line

    fn update(&mut self) {
        if let Some(particle_system) = &mut self.particle_system {
            particle_system.update();
        }
    }

    fn render(&mut self) {
        if let (Some(renderer), Some(particle_system), Some(ui_overlay)) =
            (&mut self.renderer, &self.particle_system, &mut self.ui_overlay)
        {
            let elapsed = self.start_time.elapsed().as_secs_f32();
            let ui_state = self.ui_state;
            let is_recording = self.is_recording;

            let result = renderer.render_ui_overlay(particle_system, elapsed, |device, queue, encoder, view, width, height, time| {
                match ui_state {
                    UIState::Idle | UIState::Recording => {
                        // Always show mic button
                        ui_overlay.render_mic_button(device, queue, encoder, view, width, height, is_recording);
                    }
                    UIState::Transcribing | UIState::Generating => {
                        ui_overlay.render_loading(device, queue, encoder, view, width, height, time);
                    }
                }
            });

            match result {
                Ok(_) => {}
                Err(wgpu::SurfaceError::Lost) => {
                    let size = renderer.size();
                    renderer.resize(size);
                }
                Err(wgpu::SurfaceError::OutOfMemory) => panic!("Out of memory!"),
                Err(e) => eprintln!("Render error: {:?}", e),
            }
        }
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn user_event(&mut self, _event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::NewLayout(json) => {
                self.apply_json_layout(&json);
                self.ui_state = UIState::Idle;
                self.is_recording = false;
            }
            UserEvent::UIState(state) => {
                self.ui_state = state;
                if state == UIState::Recording {
                    self.is_recording = true;
                } else if state != UIState::Recording {
                    self.is_recording = false;
                }
            }
        }
    }

    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_none() {
            let window_attributes = Window::default_attributes()
                .with_title("Project Tofu - Rust + wgpu")
                .with_inner_size(winit::dpi::LogicalSize::new(800, 600));

            let window = Arc::new(event_loop.create_window(window_attributes).unwrap());
            self.window = Some(window.clone());

            // Initialize renderer asynchronously
            let size = window.inner_size();
            let renderer = pollster::block_on(Renderer::new(window.clone(), PARTICLE_COUNT));

            // Initialize UI overlay
            let ui_overlay = ui_overlay::UIOverlay::new(renderer.device(), renderer.format());

            self.renderer = Some(renderer);
            self.ui_overlay = Some(ui_overlay);

            // Initialize particle system
            self.particle_system = Some(ParticleSystem::new(
                PARTICLE_COUNT,
                size.width as f32,
                size.height as f32,
            ));

            // Initialize layout engine
            self.layout_engine = Some(LayoutEngine::new(size.width as f32, size.height as f32));

            // Startup message shown in interactive mode
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested
            | WindowEvent::KeyboardInput {
                event:
                    KeyEvent {
                        physical_key: PhysicalKey::Code(KeyCode::Escape),
                        ..
                    },
                ..
            } => {
                event_loop.exit();
            }

            WindowEvent::Resized(physical_size) => {
                if let Some(renderer) = &mut self.renderer {
                    renderer.resize(physical_size);
                    self.layout_engine = Some(LayoutEngine::new(
                        physical_size.width as f32,
                        physical_size.height as f32,
                    ));
                }
            }

            WindowEvent::CursorMoved { position, .. } => {
                self.last_cursor_pos = Some((position.x as f32, position.y as f32));
            }

            WindowEvent::MouseInput {
                state: element_state,
                button: winit::event::MouseButton::Left,
                ..
            } => {
                if element_state == winit::event::ElementState::Pressed {
                    if let Some((x, y)) = self.last_cursor_pos {
                        if let (Some(renderer), Some(ui_overlay)) = (&self.renderer, &self.ui_overlay) {
                            let size = renderer.size();
                            if ui_overlay.is_mic_button_clicked(x, y, size.width as f32, size.height as f32) {
                                // Toggle recording state
                                if let Some(flag) = &self.recording_flag {
                                    let mut recording = flag.lock().unwrap();
                                    *recording = !*recording;

                                    if *recording {
                                        println!("🎤 Recording started - speak now!");
                                        self.is_recording = true;
                                        self.ui_state = UIState::Recording;
                                    } else {
                                        println!("🔇 Recording stopped - processing...");
                                        self.is_recording = false;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // All keyboard controls removed - purely AI-driven interface
            // Only ESC to quit (handled above in CloseRequested match)

            WindowEvent::RedrawRequested => {
                self.update();
                self.render();
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
            }

            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    // Load environment variables from .env file
    dotenv::dotenv().ok();

    // Set up logging
    env_logger::init();

    // Check for command-line arguments
    let args: Vec<String> = std::env::args().collect();

    if args.len() > 1 {
        let first_arg = args[1].as_str();

        if first_arg == "--text" || first_arg == "-t" {
            // Text mode: Type commands
            run_interactive_mode();
        } else {
            // Default: Voice mode
            run_voice_mode();
        }
    } else {
        // No arguments: Default to voice mode
        run_voice_mode();
    }
}

/// Voice mode: Click mic button to speak
fn run_voice_mode() {
    println!("\n╔══════════════════════════════════════════════════╗");
    println!("║      🧊 Project Tofu - Living UI 🧊            ║");
    println!("╚══════════════════════════════════════════════════╝");
    println!("\n🎤 Voice Mode - Click and Speak!");
    println!("   Your voice creates the visualization.");
    println!("\n💡 How it works:");
    println!("   1. Click the mic button (top-right corner)");
    println!("   2. Speak your visualization");
    println!("   3. Click again to stop recording");
    println!("   4. Watch particles animate your imagination!");
    println!("\n✨ Try saying:");
    println!("   \"Show me a DNA helix\"");
    println!("   \"Create a spiral galaxy\"");
    println!("   \"Visualize an Eiffel Tower\"");
    println!("\n💬 Want text mode instead?");
    println!("   Run: cargo run --release -- --text");
    println!("\n⌨️  Controls:");
    println!("   Press Ctrl+C or ESC to quit\n");

    let event_loop = EventLoop::<UserEvent>::with_user_event().build().unwrap();
    let proxy = event_loop.create_proxy();
    event_loop.set_control_flow(ControlFlow::Poll);

    // Shared state for recording control
    let recording_flag = Arc::new(std::sync::Mutex::new(false));
    let recording_flag_for_thread = Arc::clone(&recording_flag);

    // Spawn voice input thread
    thread::spawn(move || {
        voice_loop(proxy, recording_flag_for_thread);
    });

    let mut app = App::new();
    app.recording_flag = Some(recording_flag);
    event_loop.run_app(&mut app).unwrap();
}

/// Interactive mode: Type prompts in terminal, visualize in window
fn run_interactive_mode() {
    println!("\n╔══════════════════════════════════════════════════╗");
    println!("║      🧊 Project Tofu - Living UI 🧊            ║");
    println!("╚══════════════════════════════════════════════════╝");
    println!("\n⌨️  Text Mode");
    println!("   Type your prompts below, press Enter to generate!");
    println!("\n💡 Examples:");
    println!("   > show me a DNA helix");
    println!("   > create a spiral galaxy");
    println!("   > visualize an Eiffel Tower");
    println!("\n💬 Want voice mode instead?");
    println!("   Run: cargo run --release");
    println!("\n⌨️  Controls:");
    println!("   Press Ctrl+C or ESC to quit\n");

    let event_loop = EventLoop::<UserEvent>::with_user_event().build().unwrap();
    let proxy = event_loop.create_proxy();
    event_loop.set_control_flow(ControlFlow::Poll);

    // Spawn input thread
    thread::spawn(move || {
        input_loop(proxy);
    });

    let mut app = App::new();
    event_loop.run_app(&mut app).unwrap();
}

/// Background thread for voice input
fn voice_loop(proxy: EventLoopProxy<UserEvent>, recording_flag: Arc<std::sync::Mutex<bool>>) {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use tokio::runtime::Runtime;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    let rt = Runtime::new().unwrap();

    let audio_buffer = Arc::new(Mutex::new(Vec::<f32>::new()));

    // Start audio capture
    let host = cpal::default_host();
    let device: cpal::Device = match host.default_input_device() {
        Some(d) => d,
        None => {
            eprintln!("❌ No microphone found!");
            return;
        }
    };

    println!("🎤 Microphone ready!");
    println!("   Click the mic button to start recording!\n");

    let config: cpal::SupportedStreamConfig = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("❌ Failed to get microphone config: {}", e);
            return;
        }
    };

    let current_recording_f32 = Arc::new(Mutex::new(Vec::new()));
    let last_recording_state_f32 = Arc::new(Mutex::new(false));

    let current_recording_i16 = Arc::new(Mutex::new(Vec::new()));
    let last_recording_state_i16 = Arc::new(Mutex::new(false));

    let buffer_for_stream = Arc::clone(&audio_buffer);
    let recording_flag_for_stream = Arc::clone(&recording_flag);

    let err_fn = |err| eprintln!("Audio error: {}", err);

    let stream: Result<cpal::Stream, cpal::BuildStreamError> = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let current_rec = Arc::clone(&current_recording_f32);
            let last_state = Arc::clone(&last_recording_state_f32);

            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let is_recording = *recording_flag_for_stream.lock().unwrap();

                    if is_recording {
                        // Recording - capture audio
                        let mut rec = current_rec.lock().unwrap();
                        rec.extend_from_slice(data);
                        *last_state.lock().unwrap() = true;
                    } else if *last_state.lock().unwrap() {
                        // Just stopped recording - save buffer
                        let mut rec = current_rec.lock().unwrap();
                        let mut buffer = buffer_for_stream.lock().unwrap();
                        *buffer = rec.clone();
                        rec.clear();
                        *last_state.lock().unwrap() = false;
                    }
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let buffer_for_i16 = Arc::clone(&audio_buffer);
            let recording_flag_for_i16 = Arc::clone(&recording_flag);
            let current_rec = Arc::clone(&current_recording_i16);
            let last_state = Arc::clone(&last_recording_state_i16);

            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let is_recording = *recording_flag_for_i16.lock().unwrap();

                    if is_recording {
                        // Recording - capture audio (convert i16 to f32)
                        let samples: Vec<f32> = data.iter().map(|&s| s as f32 / i16::MAX as f32).collect();
                        let mut rec = current_rec.lock().unwrap();
                        rec.extend_from_slice(&samples);
                        *last_state.lock().unwrap() = true;
                    } else if *last_state.lock().unwrap() {
                        // Just stopped recording - save buffer
                        let mut rec = current_rec.lock().unwrap();
                        let mut buffer = buffer_for_i16.lock().unwrap();
                        *buffer = rec.clone();
                        rec.clear();
                        *last_state.lock().unwrap() = false;
                    }
                },
                err_fn,
                None,
            )
        }
        _ => {
            eprintln!("❌ Unsupported audio format");
            return;
        }
    };

    let stream: cpal::Stream = match stream {
        Ok(s) => s,
        Err(e) => {
            eprintln!("❌ Failed to create audio stream: {}", e);
            return;
        }
    };

    if let Err(e) = stream.play() {
        eprintln!("❌ Failed to start audio stream: {}", e);
        return;
    }

    // Main loop - check for completed audio and transcribe
    loop {
        std::thread::sleep(Duration::from_millis(100));

        let audio_data = {
            let mut buffer = audio_buffer.lock().unwrap();
            if buffer.is_empty() {
                continue;
            }
            let data = buffer.clone();
            buffer.clear();
            data
        };

        // Save to temp file and transcribe
        let temp_path = std::env::temp_dir().join("tofu_voice.wav");

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 16000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        if let Ok(mut writer) = hound::WavWriter::create(&temp_path, spec) {
            for &sample in audio_data.iter() {
                let amplitude = (sample * i16::MAX as f32) as i16;
                let _ = writer.write_sample(amplitude);
            }
            let _ = writer.finalize();

            // Show transcribing state
            let _ = proxy.send_event(UserEvent::UIState(UIState::Transcribing));

            // Transcribe using Gemini
            let transcription = rt.block_on(async {
                voice_input::transcribe_audio(&temp_path).await
            });

            match transcription {
                Ok(text) => {
                    if !text.trim().is_empty() {
                        println!("💬 You said: \"{}\"", text);
                        println!("🧊 Generating visualization...");

                        // Show generating state
                        let _ = proxy.send_event(UserEvent::UIState(UIState::Generating));

                        // Translate to JSON using AI
                        let brain = match ai_brain::AIBrain::new() {
                            Ok(b) => b,
                            Err(e) => {
                                eprintln!("❌ AI initialization failed: {}", e);
                                let _ = proxy.send_event(UserEvent::UIState(UIState::Idle));
                                continue;
                            }
                        };

                        let json_result = rt.block_on(async {
                            brain.translate_to_json(&text).await
                        });

                        match json_result {
                            Ok(json) => {
                                if proxy.send_event(UserEvent::NewLayout(json)).is_err() {
                                    break; // Window closed
                                }
                            }
                            Err(e) => {
                                eprintln!("❌ Generation failed: {}", e);
                                let _ = proxy.send_event(UserEvent::UIState(UIState::Idle));
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("❌ Speech recognition failed: {}", e);
                    let _ = proxy.send_event(UserEvent::UIState(UIState::Idle));
                }
            }
        }
    }
}

/// Background thread that reads user input and sends to event loop
fn input_loop(proxy: EventLoopProxy<UserEvent>) {
    use tokio::runtime::Runtime;
    let rt = Runtime::new().unwrap();

    loop {
        print!("> ");
        io::stdout().flush().unwrap();

        let mut input = String::new();
        if io::stdin().read_line(&mut input).is_err() {
            break;
        }

        let prompt = input.trim();
        if prompt.is_empty() {
            continue;
        }

        println!("🧊 Generating...");

        // Show generating state
        let _ = proxy.send_event(UserEvent::UIState(UIState::Generating));

        // Translate to JSON using AI
        let brain = match ai_brain::AIBrain::new() {
            Ok(b) => b,
            Err(e) => {
                eprintln!("❌ AI initialization failed: {}", e);
                let _ = proxy.send_event(UserEvent::UIState(UIState::Idle));
                continue;
            }
        };

        let json_result = rt.block_on(async {
            brain.translate_to_json(prompt).await
        });

        match json_result {
            Ok(json) => {
                if proxy.send_event(UserEvent::NewLayout(json)).is_err() {
                    break; // Window closed
                }
            }
            Err(e) => {
                eprintln!("❌ Generation failed: {}", e);
                let _ = proxy.send_event(UserEvent::UIState(UIState::Idle));
            }
        }
    }
}

// WebAssembly entry point
#[cfg(target_arch = "wasm32")]
fn main() {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
    console_log::init_with_level(log::Level::Warn).expect("Failed to initialize logger");

    wasm_bindgen_futures::spawn_local(run());
}

#[cfg(target_arch = "wasm32")]
async fn run() {
    let event_loop = EventLoop::new().unwrap();
    let mut app = App::new();

    event_loop.run_app(&mut app).unwrap();
}

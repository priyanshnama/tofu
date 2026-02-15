mod ai_brain;
mod layout_engine;
mod particle_system;
mod renderer;

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
}

struct App {
    renderer: Option<Renderer>,
    particle_system: Option<ParticleSystem>,
    layout_engine: Option<LayoutEngine>,
    start_time: Instant,
    window: Option<Arc<Window>>,
}

impl App {
    fn new() -> Self {
        Self {
            renderer: None,
            particle_system: None,
            layout_engine: None,
            start_time: Instant::now(),
            window: None,
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
        if let (Some(renderer), Some(particle_system)) = (&mut self.renderer, &self.particle_system) {
            let elapsed = self.start_time.elapsed().as_secs_f32();

            match renderer.render(particle_system, elapsed) {
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
            self.renderer = Some(renderer);

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
        // One-shot mode: User provided natural language prompt
        let prompt = args[1..].join(" ");
        run_oneshot_mode(&prompt);
    } else {
        // Interactive mode: Type prompts in terminal
        run_interactive_mode();
    }
}

/// One-shot mode: Translate natural language → JSON → Render once
fn run_oneshot_mode(prompt: &str) {
    use tokio::runtime::Runtime;

    println!("\n🧊 Project Tofu");
    println!("Generating: \"{}\"", prompt);

    // Create async runtime
    let rt = Runtime::new().unwrap();

    // Translate natural language to JSON
    let json_result = rt.block_on(async {
        match ai_brain::AIBrain::new() {
            Ok(brain) => brain.translate_to_json(prompt).await,
            Err(e) => {
                eprintln!("\n❌ Failed to initialize AI:");
                eprintln!("   {}", e);
                eprintln!("\n💡 Get a free API key: https://makersuite.google.com/app/apikey");
                eprintln!("   Copy .env.example to .env and add your key");
                std::process::exit(1);
            }
        }
    });

    let json = match json_result {
        Ok(j) => j,
        Err(e) => {
            eprintln!("\n❌ Generation failed: {}", e);
            std::process::exit(1);
        }
    };

    println!("✨ Layout generated!\n");

    // Run GUI with initial layout
    let event_loop = EventLoop::<UserEvent>::with_user_event().build().unwrap();
    event_loop.set_control_flow(ControlFlow::Poll);

    let mut app = AppWithInitialJSON::new(json);
    event_loop.run_app(&mut app).unwrap();
}

/// Interactive mode: Type prompts in terminal, visualize in window
fn run_interactive_mode() {
    println!("\n╔══════════════════════════════════════════════════╗");
    println!("║      🧊 Project Tofu - Living UI 🧊            ║");
    println!("╚══════════════════════════════════════════════════╝");
    println!("\n✨ Interactive Mode");
    println!("   Type your prompts below, press Enter to generate!");
    println!("\n💡 Examples:");
    println!("   > show me a DNA helix");
    println!("   > create a spiral galaxy");
    println!("   > visualize quantum particles");
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

        // Translate to JSON using AI
        let brain = match ai_brain::AIBrain::new() {
            Ok(b) => b,
            Err(e) => {
                eprintln!("❌ AI initialization failed: {}", e);
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
            }
        }
    }
}

/// App variant that starts with initial JSON (for one-shot mode)
struct AppWithInitialJSON {
    inner: App,
    initial_json: Option<String>,
}

impl AppWithInitialJSON {
    fn new(json: String) -> Self {
        Self {
            inner: App::new(),
            initial_json: Some(json),
        }
    }
}

impl ApplicationHandler<UserEvent> for AppWithInitialJSON {
    fn user_event(&mut self, event_loop: &ActiveEventLoop, event: UserEvent) {
        self.inner.user_event(event_loop, event);
    }

    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        self.inner.resumed(event_loop);

        // Apply initial layout
        if let Some(json) = self.initial_json.take() {
            self.inner.apply_json_layout(&json);
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        self.inner.window_event(event_loop, window_id, event);
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.inner.about_to_wait(event_loop);
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

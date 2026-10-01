// Night Studio vit dans la zone de notification : l'app lance l'agent Node en arrière-plan (sans console),
// le relance s'il tombe, et fermer la fenêtre la range dans le tray au lieu d'arrêter le studio.
use std::{
    fs::{self, OpenOptions},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, WindowEvent,
};

struct Agent {
    child: Mutex<Option<Child>>,
    quitting: AtomicBool,
}

// Racine du projet (package.json de l'agent) : NIGHT_STUDIO_ROOT, sinon deux niveaux au-dessus de ui/src-tauri.
fn project_root() -> PathBuf {
    std::env::var("NIGHT_STUDIO_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join(".."))
}

fn studio_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".night-studio")
}

// Un agent répond déjà sur l'API locale (lancé à la main dans un terminal, par exemple) : on ne le double pas.
fn api_up() -> bool {
    let addr: SocketAddr = "127.0.0.1:8787".parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

fn spawn_agent() -> std::io::Result<Child> {
    let dir = studio_dir();
    fs::create_dir_all(&dir)?;
    let log = OpenOptions::new().create(true).append(true).open(dir.join("agent.log"))?;
    let mut cmd = Command::new("node");
    cmd.args(["--disable-warning=ExperimentalWarning", "--env-file-if-exists=.env", "src/studio/main.ts"])
        .current_dir(project_root())
        .stdin(Stdio::null())
        .stdout(log.try_clone()?)
        .stderr(log);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn()
}

// Démarre l'agent s'il ne tourne pas (ni chez nous, ni ailleurs). Appelé au lancement puis par le chien de garde.
fn ensure_agent(app: &AppHandle) {
    let state = app.state::<Agent>();
    if state.quitting.load(Ordering::SeqCst) {
        return;
    }
    let mut child = state.child.lock().unwrap();
    let alive = child.as_mut().map(|c| matches!(c.try_wait(), Ok(None))).unwrap_or(false);
    if alive || api_up() {
        return;
    }
    match spawn_agent() {
        Ok(c) => *child = Some(c),
        Err(e) => eprintln!("Night Studio: could not start the agent: {e}"),
    }
}

fn stop_agent(app: &AppHandle) {
    let state = app.state::<Agent>();
    state.quitting.store(true, Ordering::SeqCst);
    let taken = state.child.lock().unwrap().take();
    if let Some(mut c) = taken {
        let _ = c.kill();
        let _ = c.wait();
    }
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Agent { child: Mutex::new(None), quitting: AtomicBool::new(false) })
        .setup(|app| {
            ensure_agent(app.handle());

            // Chien de garde : l'agent est relancé s'il s'arrête (crash, mise à jour…), toutes les 15 s.
            let handle = app.handle().clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_secs(15));
                ensure_agent(&handle);
            });

            let status = MenuItem::with_id(app, "status", "Agent running · auto-restart on", false, None::<&str>)?;
            let open = MenuItem::with_id(app, "open", "Open Night Studio", true, None::<&str>)?;
            let folder = MenuItem::with_id(app, "folder", "Open renders folder", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit (stops the agent)", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&status, &PredefinedMenuItem::separator(app)?, &open, &folder, &PredefinedMenuItem::separator(app)?, &quit],
            )?;

            TrayIconBuilder::with_id("night-studio")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Night Studio · Paris Claw Agent Challenge 🗼")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, e| match e.id.as_ref() {
                    "open" => show(app),
                    "folder" => {
                        let _ = Command::new("explorer").arg(studio_dir()).spawn();
                    }
                    "quit" => {
                        stop_agent(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // Fermer la fenêtre ne coupe pas le studio : elle se range dans le tray.
        .on_window_event(|w, e| {
            if let WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = w.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Night Studio")
        .run(|app, e| {
            if let RunEvent::Exit = e {
                stop_agent(app);
            }
        });
}

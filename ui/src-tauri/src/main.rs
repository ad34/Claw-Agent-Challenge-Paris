// Pas de console en plus de la fenêtre en release sur Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    night_studio_lib::run()
}

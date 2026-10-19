//! Native child WebViews for web tiles (Tauri multiwebview, `unstable` feature).
//! The frontend owns layout: it measures the tile body and calls `browser_set_bounds`
//! on every move/zoom; we only create / move / navigate / close native webviews.
//! The child webview has its own label + a remote origin → no capability grants it IPC.

use board_core::browser::{self, Rect};
use serde::Serialize;
use tauri::{
    webview::{PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Url, Webview, WebviewUrl,
};

use board_core::error::{Error, Result};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct NavEvent {
    tile: String,
    url: String,
    loading: bool,
}

fn label(tile: &str) -> Result<String> {
    browser::label_for(tile).ok_or_else(|| Error::Browser(format!("bad tile id {tile:?}")))
}

fn parse(url: &str) -> Result<Url> {
    let s = browser::normalize_url(url).map_err(Error::Browser)?;
    Url::parse(&s).map_err(|e| Error::Browser(format!("invalid URL: {e}")))
}

fn tauri_err(e: tauri::Error) -> Error {
    Error::Browser(format!("webview: {e}"))
}

fn get(app: &AppHandle, tile: &str) -> Result<Option<Webview>> {
    Ok(app.get_webview(&label(tile)?))
}

/// Create (or re-point) the tile's webview at `rect` (logical px in the main window).
#[tauri::command]
pub fn browser_open(
    app: AppHandle,
    tile: String,
    url: String,
    rect: Rect,
    zoom: f64,
) -> Result<()> {
    let target = parse(&url)?;
    if let Some(wv) = get(&app, &tile)? {
        if wv.url().map(|u| u != target).unwrap_or(true) {
            wv.navigate(target).map_err(tauri_err)?;
        }
        return place(&wv, rect, zoom);
    }
    let window = app
        .get_window("main")
        .ok_or_else(|| Error::Browser("main window missing".into()))?;
    let lbl = label(&tile)?;
    let (t_nav, t_load) = (tile.clone(), tile.clone());
    let app_nav = app.clone();
    let app_load = app.clone();
    let builder = WebviewBuilder::new(&lbl, WebviewUrl::External(target))
        .on_navigation(move |u| {
            let ok = browser::allow_navigation(u.as_str());
            if ok {
                let _ = app_nav.emit(
                    "browser://nav",
                    NavEvent {
                        tile: t_nav.clone(),
                        url: u.to_string(),
                        loading: true,
                    },
                );
            }
            ok
        })
        .on_page_load(move |_, p| {
            let _ = app_load.emit(
                "browser://nav",
                NavEvent {
                    tile: t_load.clone(),
                    url: p.url().to_string(),
                    loading: matches!(p.event(), PageLoadEvent::Started),
                },
            );
        });
    // created hidden-size then placed, so a bad rect never flashes full-window
    let r = rect.sanitize();
    let (pos, size) = match r {
        Some(r) => (LogicalPosition::new(r.x, r.y), LogicalSize::new(r.w, r.h)),
        None => (LogicalPosition::new(0.0, 0.0), LogicalSize::new(1.0, 1.0)),
    };
    let wv = window.add_child(builder, pos, size).map_err(tauri_err)?;
    if r.is_none() {
        let _ = wv.hide();
    }
    let _ = wv.set_zoom(browser::clamp_zoom(zoom));
    Ok(())
}

fn place(wv: &Webview, rect: Rect, zoom: f64) -> Result<()> {
    match rect.sanitize() {
        Some(r) => {
            wv.set_position(LogicalPosition::new(r.x, r.y))
                .map_err(tauri_err)?;
            wv.set_size(LogicalSize::new(r.w, r.h)).map_err(tauri_err)?;
            wv.set_zoom(browser::clamp_zoom(zoom)).map_err(tauri_err)?;
            wv.show().map_err(tauri_err)
        }
        None => wv.hide().map_err(tauri_err),
    }
}

/// Move/resize (rect = None-ish → hidden, e.g. tile scrolled off-screen or a modal is open).
#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    tile: String,
    rect: Rect,
    zoom: f64,
    visible: bool,
) -> Result<()> {
    let Some(wv) = get(&app, &tile)? else {
        return Ok(());
    };
    if !visible {
        return wv.hide().map_err(tauri_err);
    }
    place(&wv, rect, zoom)
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, tile: String, url: String) -> Result<()> {
    let target = parse(&url)?;
    match get(&app, &tile)? {
        Some(wv) => wv.navigate(target).map_err(tauri_err),
        None => Err(Error::Browser("browser not open".into())),
    }
}

/// "back" | "forward" | "reload" | "stop"
#[tauri::command]
pub fn browser_action(app: AppHandle, tile: String, action: String) -> Result<()> {
    let Some(wv) = get(&app, &tile)? else {
        return Ok(());
    };
    match action.as_str() {
        "reload" => wv.reload().map_err(tauri_err),
        "back" => wv.eval("history.back()").map_err(tauri_err),
        "forward" => wv.eval("history.forward()").map_err(tauri_err),
        "stop" => wv.eval("window.stop()").map_err(tauri_err),
        other => Err(Error::Browser(format!("unknown browser action {other}"))),
    }
}

#[tauri::command]
pub fn browser_close(app: AppHandle, tile: String) -> Result<()> {
    if let Some(wv) = get(&app, &tile)? {
        wv.close().map_err(tauri_err)?;
    }
    Ok(())
}

/// Hide every tile browser (modals/menus open over the board — native views would sit on top).
#[tauri::command]
pub fn browser_hide_all(app: AppHandle) -> Result<()> {
    for (l, wv) in app.webviews() {
        if l.starts_with("webtile-") {
            let _ = wv.hide();
        }
    }
    Ok(())
}

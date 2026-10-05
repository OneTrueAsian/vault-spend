use crate::auto_lock::SystemSessionEvent;

#[cfg(windows)]
mod platform {
    use super::SystemSessionEvent;
    use tauri::Manager;
    use windows::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        System::RemoteDesktop::{WTSRegisterSessionNotification, WTSUnRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION},
        UI::{
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, WM_NCDESTROY, WM_POWERBROADCAST, WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK,
            },
        },
    };

    const SUBCLASS_ID: usize = 0x5653_5353;

    struct HookContext {
        app: tauri::AppHandle,
        wts_registered: bool,
    }

    unsafe extern "system" fn window_subclass(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _subclass_id: usize,
        reference_data: usize,
    ) -> LRESULT {
        if reference_data != 0 {
            let context = unsafe { &*(reference_data as *const HookContext) };
            if let Some(event) = event_from_message(message, wparam.0) {
                crate::auto_lock::queue_system_session_lock(&context.app, event);
                if let Some(service) = context.app.try_state::<crate::mobile_server::MobileService>() {
                    match event {
                        SystemSessionEvent::Suspending => service.stop(),
                        SystemSessionEvent::Resumed => {
                            let service = service.inner().clone();
                            tauri::async_runtime::spawn_blocking(move || service.resume());
                        }
                        SystemSessionEvent::Locked => {}
                    }
                }
            }

            if message == WM_NCDESTROY {
                if context.wts_registered {
                    let _ = unsafe { WTSUnRegisterSessionNotification(hwnd) };
                }
                if unsafe { RemoveWindowSubclass(hwnd, Some(window_subclass), SUBCLASS_ID) }.as_bool() {
                    unsafe { drop(Box::from_raw(reference_data as *mut HookContext)) };
                }
            }
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    fn event_from_message(message: u32, wparam: usize) -> Option<SystemSessionEvent> {
        match (message, wparam as u32) {
            (WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK) => Some(SystemSessionEvent::Locked),
            (WM_POWERBROADCAST, PBT_APMSUSPEND) => Some(SystemSessionEvent::Suspending),
            (WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND) => Some(SystemSessionEvent::Resumed),
            _ => None,
        }
    }

    pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "The main window is unavailable for system session notifications.".to_string())?;
        let hwnd = window.hwnd().map_err(|error| error.to_string())?;
        let context = Box::into_raw(Box::new(HookContext {
            app: app.clone(),
            wts_registered: false,
        }));

        let installed = unsafe { SetWindowSubclass(hwnd, Some(window_subclass), SUBCLASS_ID, context as usize) }.as_bool();
        if !installed {
            unsafe { drop(Box::from_raw(context)) };
            return Err("Windows rejected the system session event hook.".to_string());
        }

        match unsafe { WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) } {
            Ok(()) => unsafe { (*context).wts_registered = true },
            Err(error) => {
                // Power suspend notifications still arrive through the installed window callback.
                // Session registration can fail transiently before Remote Desktop Services is ready.
                eprintln!("Windows session-lock notifications are unavailable: {error}");
            }
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn maps_only_lock_suspend_and_resume_messages() {
            assert_eq!(
                event_from_message(WM_WTSSESSION_CHANGE, WTS_SESSION_LOCK as usize),
                Some(SystemSessionEvent::Locked)
            );
            assert_eq!(
                event_from_message(WM_POWERBROADCAST, PBT_APMSUSPEND as usize),
                Some(SystemSessionEvent::Suspending)
            );
            assert_eq!(
                event_from_message(WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC as usize),
                Some(SystemSessionEvent::Resumed)
            );
            assert_eq!(event_from_message(WM_WTSSESSION_CHANGE, 8), None);
        }
    }
}

pub fn install(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(windows)]
    return platform::install(app);

    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(())
    }
}

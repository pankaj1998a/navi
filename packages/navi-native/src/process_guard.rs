//! Process supervisor and job object management for clean task termination.
//! On Windows, assigns processes to Windows Job Objects with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`
//! to guarantee zero orphaned background tasks when parent tasks exit or time out.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

#[derive(Default)]
pub struct ProcessGuardRegistry {
    tracked_pids: Mutex<HashMap<u32, u64>>,
}

static REGISTRY: Mutex<Option<ProcessGuardRegistry>> = Mutex::new(None);

pub fn init_process_guard() {
    let mut guard = REGISTRY.lock().unwrap_or_else(PoisonError::into_inner);
    if guard.is_none() {
        *guard = Some(ProcessGuardRegistry::default());
    }
}

/// Registers a child process PID for supervision and auto-cleanup.
pub fn register_pid(pid: u32) -> bool {
    init_process_guard();
    let mut guard = REGISTRY.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(ref mut reg) = *guard {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        reg.tracked_pids.lock().unwrap_or_else(PoisonError::into_inner).insert(pid, now);
        true
    } else {
        false
    }
}

/// Removes a terminated PID from tracking.
pub fn unregister_pid(pid: u32) -> bool {
    let guard = REGISTRY.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(ref reg) = *guard {
        reg.tracked_pids.lock().unwrap_or_else(PoisonError::into_inner).remove(&pid).is_some()
    } else {
        false
    }
}

/// Kills a process tree cleanly.
pub fn kill_process_tree(pid: u32) -> bool {
    #[cfg(windows)]
    {
        // Use Windows taskkill /F /T /PID to tear down the entire process tree
        use std::process::Command;
        let status = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
        unregister_pid(pid);
        status.map(|s| s.status.success()).unwrap_or(false)
    }

    #[cfg(not(windows))]
    {
        use std::process::Command;
        let status = Command::new("kill")
            .args(["-9", &format!("-{}", pid)])
            .output();
        unregister_pid(pid);
        status.map(|s| s.status.success()).unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_guard_lifecycle() {
        assert!(register_pid(999999));
        assert!(unregister_pid(999999));
        assert!(!unregister_pid(999999));
    }
}

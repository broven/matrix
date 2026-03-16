use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const GITHUB_OWNER: &str = "broven";
const GITHUB_REPO: &str = "matrix";
const ALLOWED_DOWNLOAD_HOSTS: &[&str] = &[
    "github.com",
    "objects.githubusercontent.com",
];

#[derive(Serialize, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Serialize, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GitHubAsset>,
}

#[derive(Serialize)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub version: String,
    pub download_url: String,
    pub release_notes: String,
}

#[derive(Clone, Serialize)]
struct DownloadProgress {
    downloaded: u64,
    total: u64,
}

fn strip_v_prefix(version: &str) -> &str {
    version.strip_prefix('v').unwrap_or(version)
}

/// Simple semver comparison: returns true if `latest` is newer than `current`.
fn is_newer_version(current: &str, latest: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        strip_v_prefix(v)
            .split('.')
            .filter_map(|s| s.parse().ok())
            .collect()
    };
    let cur = parse(current);
    let lat = parse(latest);
    let max_len = cur.len().max(lat.len());
    for i in 0..max_len {
        let c = cur.get(i).copied().unwrap_or(0);
        let l = lat.get(i).copied().unwrap_or(0);
        if l > c {
            return true;
        }
        if l < c {
            return false;
        }
    }
    false
}

fn cache_dir() -> std::path::PathBuf {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(home)
        .join("Library/Caches/com.matrix.client")
}

fn validate_download_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid download URL".to_string())?;
    if parsed.scheme() != "https" {
        return Err("Download URL must use HTTPS".to_string());
    }
    let host = parsed.host_str().unwrap_or("");
    if !ALLOWED_DOWNLOAD_HOSTS.iter().any(|allowed| host == *allowed || host.ends_with(&format!(".{}", allowed))) {
        return Err(format!("Download URL host '{}' is not allowed", host));
    }
    Ok(())
}

#[tauri::command]
pub async fn check_update(app: AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.config().version.clone().unwrap_or_default();

    let url = format!(
        "https://api.github.com/repos/{}/{}/releases/latest",
        GITHUB_OWNER, GITHUB_REPO
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "matrix-client")
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Failed to check for updates: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {}", e))?;

    let latest_version = strip_v_prefix(&release.tag_name);
    let has_update = is_newer_version(&current_version, latest_version);

    let download_url = release
        .assets
        .iter()
        .find(|a| a.name.ends_with(".dmg"))
        .map(|a| a.browser_download_url.clone())
        .unwrap_or_default();

    Ok(UpdateInfo {
        has_update,
        version: latest_version.to_string(),
        download_url,
        release_notes: release.body.unwrap_or_default(),
    })
}

#[tauri::command]
pub async fn download_update(app: AppHandle, url: String) -> Result<String, String> {
    validate_download_url(&url)?;

    let cache = cache_dir();
    tokio::fs::create_dir_all(&cache)
        .await
        .map_err(|e| format!("Failed to create cache dir: {}", e))?;

    let dest = cache.join("update.dmg");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "matrix-client")
        .send()
        .await
        .map_err(|e| format!("Failed to download update: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download server returned status: {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("Failed to create file: {}", e))?;

    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download error: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += chunk.len() as u64;

        let _ = app.emit("update-download-progress", DownloadProgress {
            downloaded,
            total,
        });
    }

    file.flush()
        .await
        .map_err(|e| format!("Flush error: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

/// Parse the mount point from hdiutil attach stdout.
/// hdiutil outputs tab-separated lines; the last line's last column is the mount point.
fn parse_mount_point(stdout: &str) -> Option<String> {
    for line in stdout.lines().rev() {
        // Format: /dev/diskXsY  Apple_HFS  /Volumes/Name
        let parts: Vec<&str> = line.split('\t').collect();
        if let Some(last) = parts.last() {
            let trimmed = last.trim();
            if trimmed.starts_with("/Volumes/") {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

#[tauri::command]
pub async fn install_update(dmg_path: String) -> Result<(), String> {
    // Mount the DMG (not quiet, so we can parse the mount point)
    let output = std::process::Command::new("hdiutil")
        .args(["attach", &dmg_path, "-nobrowse"])
        .output()
        .map_err(|e| format!("Failed to mount DMG: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "hdiutil attach failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let volume_path = parse_mount_point(&stdout)
        .ok_or_else(|| format!("Could not parse mount point from hdiutil output: {}", stdout))?;

    // Find .app in mounted volume
    let app_entry = std::fs::read_dir(&volume_path)
        .map_err(|e| format!("Failed to read volume: {}", e))?
        .filter_map(|entry| entry.ok())
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .ends_with(".app")
        })
        .ok_or_else(|| "No .app found in DMG".to_string())?;

    let app_name = app_entry.file_name();
    let source_app = std::path::PathBuf::from(&volume_path).join(&app_name);
    let target_app = std::path::PathBuf::from("/Applications").join(&app_name);

    // Create install script using mktemp for unique path
    let mktemp_output = std::process::Command::new("mktemp")
        .args(["/tmp/matrix_update.XXXXXXXX"])
        .output()
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    if !mktemp_output.status.success() {
        return Err("mktemp failed".to_string());
    }

    let script_path = String::from_utf8_lossy(&mktemp_output.stdout).trim().to_string();

    // Atomic install: copy to temp location, then mv to replace.
    // Keep old app as .bak for rollback on failure.
    let script = format!(
        r#"#!/bin/bash
set -e

BACKUP=""
TARGET="{target}"
SOURCE="{source}"
VOLUME="{volume}"
TEMP_DEST="/Applications/.Matrix-update-staging.app"

sleep 1

# Copy new app to staging location
rm -rf "$TEMP_DEST"
cp -R "$SOURCE" "$TEMP_DEST"

# Back up current app (if it exists)
if [ -d "$TARGET" ]; then
    BACKUP="${{TARGET}}.bak"
    rm -rf "$BACKUP"
    mv "$TARGET" "$BACKUP"
fi

# Atomic move from staging to target
if mv "$TEMP_DEST" "$TARGET"; then
    # Success - remove backup
    rm -rf "$BACKUP"
else
    # Restore backup on failure
    if [ -n "$BACKUP" ] && [ -d "$BACKUP" ]; then
        mv "$BACKUP" "$TARGET"
    fi
    rm -rf "$TEMP_DEST"
    exit 1
fi

open "$TARGET"
hdiutil detach "$VOLUME" -quiet 2>/dev/null || true
rm "$0"
"#,
        target = target_app.display(),
        source = source_app.display(),
        volume = volume_path,
    );

    std::fs::write(&script_path, &script)
        .map_err(|e| format!("Failed to write install script: {}", e))?;

    // Make executable
    std::process::Command::new("chmod")
        .args(["+x", &script_path])
        .output()
        .map_err(|e| format!("Failed to chmod script: {}", e))?;

    // Run detached
    std::process::Command::new("bash")
        .arg(&script_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn install script: {}", e))?;

    // Exit current app
    std::process::exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_newer_version ────────────────────────────────────────────

    #[test]
    fn newer_basic_minor_bump() {
        assert!(is_newer_version("0.1.0", "0.2.0"));
    }

    #[test]
    fn newer_same_version() {
        assert!(!is_newer_version("0.1.0", "0.1.0"));
    }

    #[test]
    fn newer_downgrade() {
        assert!(!is_newer_version("0.2.0", "0.1.0"));
    }

    #[test]
    fn newer_major_bump() {
        assert!(is_newer_version("1.0.0", "2.0.0"));
    }

    #[test]
    fn newer_patch_bump() {
        assert!(is_newer_version("0.1.0", "0.1.1"));
    }

    #[test]
    fn newer_with_v_prefix() {
        assert!(is_newer_version("v0.1.0", "v0.2.0"));
    }

    #[test]
    fn newer_mixed_v_prefix() {
        assert!(is_newer_version("v0.1.0", "0.2.0"));
    }

    #[test]
    fn newer_two_segment_versions() {
        assert!(is_newer_version("0.1", "0.2"));
    }

    #[test]
    fn newer_longer_version_string() {
        // "0.1.0.1" is newer than "0.1.0" because the 4th segment (1) > implicit 0
        assert!(is_newer_version("0.1.0", "0.1.0.1"));
    }

    // ── parse_mount_point ───────────────────────────────────────────

    #[test]
    fn parse_mount_real_hdiutil_output() {
        let stdout = "/dev/disk4s1\tApple_HFS\t/Volumes/Matrix";
        assert_eq!(
            parse_mount_point(stdout),
            Some("/Volumes/Matrix".to_string()),
        );
    }

    #[test]
    fn parse_mount_multiline_output() {
        // Typical hdiutil output has a preamble line before the mount line
        let stdout = "/dev/disk4\t\t\n/dev/disk4s1\tApple_HFS\t/Volumes/Matrix";
        assert_eq!(
            parse_mount_point(stdout),
            Some("/Volumes/Matrix".to_string()),
        );
    }

    #[test]
    fn parse_mount_no_mount_point() {
        let stdout = "/dev/disk4\t\t\n/dev/disk4s1\tApple_HFS\t";
        assert_eq!(parse_mount_point(stdout), None);
    }

    #[test]
    fn parse_mount_empty_string() {
        assert_eq!(parse_mount_point(""), None);
    }

    #[test]
    fn parse_mount_volume_with_spaces() {
        let stdout = "/dev/disk4s1\tApple_HFS\t/Volumes/Matrix Client";
        assert_eq!(
            parse_mount_point(stdout),
            Some("/Volumes/Matrix Client".to_string()),
        );
    }

    // ── validate_download_url ───────────────────────────────────────

    #[test]
    fn validate_url_github_com() {
        let url = "https://github.com/broven/matrix/releases/download/v0.2.0/Matrix.dmg";
        assert!(validate_download_url(url).is_ok());
    }

    #[test]
    fn validate_url_objects_githubusercontent() {
        let url = "https://objects.githubusercontent.com/some/path/Matrix.dmg";
        assert!(validate_download_url(url).is_ok());
    }

    #[test]
    fn validate_url_http_rejected() {
        let url = "http://github.com/broven/matrix/releases/download/v0.2.0/Matrix.dmg";
        assert!(validate_download_url(url).is_err());
    }

    #[test]
    fn validate_url_random_domain_rejected() {
        let url = "https://evil.com/Matrix.dmg";
        assert!(validate_download_url(url).is_err());
    }

    #[test]
    fn validate_url_not_a_url() {
        assert!(validate_download_url("not-a-url").is_err());
    }

    #[test]
    fn validate_url_subdomain_of_github_allowed() {
        // ends with .github.com → allowed
        let url = "https://evil.github.com/some/path";
        assert!(validate_download_url(url).is_ok());
    }

    #[test]
    fn validate_url_github_com_in_middle_rejected() {
        // github.com is NOT a suffix of "github.com.evil.com"
        let url = "https://github.com.evil.com/some/path";
        assert!(validate_download_url(url).is_err());
    }
}

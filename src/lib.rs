//! Zed extension — attaches the properties-unicode language server to the Properties language.
//! The server is a single dependency-free node script, downloaded from this repository's GitHub releases
//! and run with Zed's bundled node. `lsp.properties-unicode.binary` in settings overrides the command.

use std::fs;

use zed_extension_api::{
    self as zed, settings::LspSettings, LanguageServerId, LanguageServerInstallationStatus, Result,
};

const REPO: &str = "koliflawa/zed-properties-unicode";
const SERVER_NAME: &str = "properties-unicode";
const SERVER_FILE: &str = "properties-unicode-lsp.mjs";
const VERSION_DIR_PREFIX: &str = "properties-unicode-lsp-";

struct PropertiesUnicode {
    cached_server_path: Option<String>,
}

fn is_file(path: &str) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file())
}

/// A previously downloaded server, used when GitHub cannot be reached.
fn downloaded_server() -> Option<String> {
    fs::read_dir(".")
        .ok()?
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| name.starts_with(VERSION_DIR_PREFIX))
        .map(|dir| format!("{dir}/{SERVER_FILE}"))
        .filter(|path| is_file(path))
        .max()
}

impl PropertiesUnicode {
    fn server_path(&mut self, id: &LanguageServerId) -> Result<String> {
        if let Some(path) = &self.cached_server_path {
            if is_file(path) {
                return Ok(path.clone());
            }
        }

        zed::set_language_server_installation_status(
            id,
            &LanguageServerInstallationStatus::CheckingForUpdate,
        );
        let release = match zed::latest_github_release(
            REPO,
            zed::GithubReleaseOptions {
                require_assets: true,
                pre_release: false,
            },
        ) {
            Ok(release) => release,
            Err(e) => {
                let path = downloaded_server().ok_or(e)?;
                self.cached_server_path = Some(path.clone());
                return Ok(path);
            }
        };
        let asset = release
            .assets
            .iter()
            .find(|asset| asset.name == SERVER_FILE)
            .ok_or_else(|| format!("release {} has no {SERVER_FILE} asset", release.version))?;

        let version_dir = format!("{VERSION_DIR_PREFIX}{}", release.version);
        let path = format!("{version_dir}/{SERVER_FILE}");
        if !is_file(&path) {
            zed::set_language_server_installation_status(
                id,
                &LanguageServerInstallationStatus::Downloading,
            );
            fs::create_dir_all(&version_dir)
                .map_err(|e| format!("failed to create {version_dir}: {e}"))?;
            zed::download_file(
                &asset.download_url,
                &path,
                zed::DownloadedFileType::Uncompressed,
            )
            .map_err(|e| format!("failed to download {SERVER_FILE}: {e}"))?;

            for entry in fs::read_dir(".").into_iter().flatten().flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if name.starts_with(VERSION_DIR_PREFIX) && name != version_dir {
                    fs::remove_dir_all(entry.path()).ok();
                }
            }
        }

        zed::set_language_server_installation_status(id, &LanguageServerInstallationStatus::None);
        self.cached_server_path = Some(path.clone());
        Ok(path)
    }
}

impl zed::Extension for PropertiesUnicode {
    fn new() -> Self {
        Self {
            cached_server_path: None,
        }
    }

    fn language_server_command(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        if let Some(binary) = LspSettings::for_worktree(SERVER_NAME, worktree)
            .ok()
            .and_then(|settings| settings.binary)
        {
            if let Some(command) = binary.path {
                return Ok(zed::Command {
                    command,
                    args: binary.arguments.unwrap_or_else(|| vec!["--stdio".into()]),
                    env: binary.env.unwrap_or_default().into_iter().collect(),
                });
            }
        }

        let path = self.server_path(id)?;
        let path = std::env::current_dir()
            .map_err(|e| format!("failed to resolve the extension work directory: {e}"))?
            .join(path);
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![path.to_string_lossy().into_owned(), "--stdio".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(PropertiesUnicode);

//! Zed extension — attaches the properties-unicode language server (server/properties-unicode-lsp.mjs) to the Properties language.
//! The server script is embedded in the wasm, written to the extension work directory and run with Zed's bundled node
//! (works without publishing anything to npm).

use zed_extension_api::{self as zed, LanguageServerId, Result};

const SERVER_FILE: &str = "properties-unicode-lsp.mjs";
const SERVER_SRC: &str = include_str!("../server/properties-unicode-lsp.mjs");

struct PropertiesUnicode;

impl zed::Extension for PropertiesUnicode {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _id: &LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        std::fs::write(SERVER_FILE, SERVER_SRC)
            .map_err(|e| format!("failed to write the server script: {e}"))?;
        let path = std::env::current_dir()
            .map_err(|e| format!("failed to resolve the extension work directory: {e}"))?
            .join(SERVER_FILE);
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![path.to_string_lossy().into_owned(), "--stdio".into()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(PropertiesUnicode);

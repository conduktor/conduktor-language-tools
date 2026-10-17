use std::{env, fs};
use zed_extension_api::{
    self as zed, LanguageServerId, Result, serde_json::Value, serde_json::json,
    settings::LspSettings,
};

/// On the PATH: a build from the repository (`pnpm install-zed-dev`), or a global npm install.
const BINARY_NAME: &str = "conduktor-console-language-server";
const PACKAGE_NAME: &str = "@conduktor/console-language-server";
const SERVER_PATH: &str = "node_modules/@conduktor/console-language-server/dist/server.cjs";

struct ConduktorConsole {
    installed: bool,
}

impl ConduktorConsole {
    fn server_exists() -> bool {
        fs::metadata(SERVER_PATH).is_ok_and(|stat| stat.is_file())
    }

    /// Installs the latest server from npm into the extension's work directory, keeping an older copy when npm fails.
    fn server_script_path(&mut self, id: &LanguageServerId) -> Result<String> {
        if self.installed && Self::server_exists() {
            return Ok(SERVER_PATH.to_string());
        }

        zed::set_language_server_installation_status(
            id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );
        // npm unreachable (offline, registry down): an earlier install still runs.
        let version = match zed::npm_package_latest_version(PACKAGE_NAME) {
            Ok(version) => version,
            Err(_) if Self::server_exists() => {
                self.installed = true;
                return Ok(SERVER_PATH.to_string());
            }
            Err(error) => return Err(error),
        };
        let installed = zed::npm_package_installed_version(PACKAGE_NAME)
            .ok()
            .flatten();
        if !Self::server_exists() || installed.as_ref() != Some(&version) {
            zed::set_language_server_installation_status(
                id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            if let Err(error) = zed::npm_install_package(PACKAGE_NAME, &version)
                && !Self::server_exists()
            {
                return Err(error);
            }
            if !Self::server_exists() {
                return Err(format!(
                    "the npm package {PACKAGE_NAME} has no {SERVER_PATH}"
                ));
            }
        }
        self.installed = true;
        Ok(SERVER_PATH.to_string())
    }
}

impl zed::Extension for ConduktorConsole {
    fn new() -> Self {
        Self { installed: false }
    }

    fn language_server_command(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // The login shell's environment is where CONDUKTOR_TOKEN lives.
        let env = worktree.shell_env();
        if let Some(path) = worktree.which(BINARY_NAME) {
            return Ok(zed::Command {
                command: path,
                args: vec!["--stdio".to_string()],
                env,
            });
        }

        let script = env::current_dir()
            .map_err(|error| error.to_string())?
            .join(self.server_script_path(id)?)
            .to_string_lossy()
            .into_owned();
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![script, "--stdio".to_string()],
            env,
        })
    }

    /// `lsp.conduktor-console.settings` (the Console's url, name, mode and token), under the section the server asks
    /// for. Zed sends it again whenever it changes, so the server follows without a restart.
    fn language_server_workspace_configuration(
        &mut self,
        id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<Value>> {
        let settings = LspSettings::for_worktree(id.as_ref(), worktree)
            .ok()
            .and_then(|lsp| lsp.settings);
        Ok(Some(json!({ "conduktor": settings })))
    }
}

zed::register_extension!(ConduktorConsole);

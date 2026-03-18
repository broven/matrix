use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationErrorCode {
    Unauthorized,
    InvalidJson,
    MissingField,
    UnsupportedAction,
    UnsupportedCondition,
    Timeout,
    WebviewUnavailable,
    NativeUnavailable,
    ResetFailed,
    InternalError,
}

impl AutomationErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Unauthorized => "unauthorized",
            Self::InvalidJson => "invalid_json",
            Self::MissingField => "missing_field",
            Self::UnsupportedAction => "unsupported_action",
            Self::UnsupportedCondition => "unsupported_condition",
            Self::Timeout => "timeout",
            Self::WebviewUnavailable => "webview_unavailable",
            Self::NativeUnavailable => "native_unavailable",
            Self::ResetFailed => "reset_failed",
            Self::InternalError => "internal_error",
        }
    }
}

impl fmt::Display for AutomationErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

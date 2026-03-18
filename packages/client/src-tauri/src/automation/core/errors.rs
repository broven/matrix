use serde::de::{self, Visitor};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

impl FromStr for AutomationErrorCode {
    type Err = &'static str;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "unauthorized" => Ok(Self::Unauthorized),
            "invalid_json" => Ok(Self::InvalidJson),
            "missing_field" => Ok(Self::MissingField),
            "unsupported_action" => Ok(Self::UnsupportedAction),
            "unsupported_condition" => Ok(Self::UnsupportedCondition),
            "timeout" => Ok(Self::Timeout),
            "webview_unavailable" => Ok(Self::WebviewUnavailable),
            "native_unavailable" => Ok(Self::NativeUnavailable),
            "reset_failed" => Ok(Self::ResetFailed),
            "internal_error" => Ok(Self::InternalError),
            _ => Err("unknown_automation_error_code"),
        }
    }
}

impl fmt::Display for AutomationErrorCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for AutomationErrorCode {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for AutomationErrorCode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        struct AutomationErrorCodeVisitor;

        impl<'de> Visitor<'de> for AutomationErrorCodeVisitor {
            type Value = AutomationErrorCode;

            fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str("a known automation error code string")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                AutomationErrorCode::from_str(value).map_err(E::custom)
            }
        }

        deserializer.deserialize_str(AutomationErrorCodeVisitor)
    }
}

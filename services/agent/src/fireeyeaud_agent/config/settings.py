"""sidecar 运行时配置（环境变量前缀 FIREYEAUD_）。"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="FIREYEAUD_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_version: str = "0.0.0"
    schema_version: int = 1
    host: str = "127.0.0.1"
    port: int = 8765
    token: str | None = None
    max_steps: int = 12
    turn_timeout_seconds: int = 300


settings = Settings()

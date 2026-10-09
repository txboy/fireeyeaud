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
    global_dir: str = "~/.fireeye"
    host: str = "127.0.0.1"
    port: int = 8765
    token: str | None = None
    max_steps: int = 12
    turn_timeout_seconds: int = 300

    model_base_url: str = "http://127.0.0.1:11434/v1"
    model_name: str = "qwen2.5"
    model_api_key: str | None = None
    model_temperature: float = 0.2
    sql_row_limit: int = 200
    sql_timeout_seconds: int = 30


settings = Settings()

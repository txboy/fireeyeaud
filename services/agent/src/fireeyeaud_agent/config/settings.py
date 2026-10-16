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
    # 附件读取：单文件/单轮字符上限，以及单个文件转写的最长等待秒数。
    attachment_max_chars: int = 20_000
    attachment_total_chars: int = 60_000
    attachment_read_timeout_seconds: int = 120

    model_base_url: str = "http://127.0.0.1:11434/v1"
    model_name: str = "qwen2.5"
    model_api_key: str | None = None
    model_temperature: float = 0.2
    sql_row_limit: int = 200
    sql_timeout_seconds: int = 30

    # 上下文压缩（Phase 9）：窗口未知时的保守回退与预算系数。
    default_context_window: int = 8192
    context_safety_factor: float = 0.8
    compact_keep_tokens: int = 15000
    compact_reserve_output_tokens: int = 4096

    # MCP 接入（Phase 9）：连接/调用超时与单次输出上限。
    mcp_timeout_seconds: int = 30
    mcp_max_output_chars: int = 20_000


settings = Settings()

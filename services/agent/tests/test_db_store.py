from pathlib import Path

from fireeyeaud_agent.store import db, secrets


def test_connection_crud_and_secret(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    secrets.clear()

    conn = db.create_connection(
        {
            "name": "本地账套",
            "driver": "sqlite",
            "path": str(tmp_path / "a.db"),
            "scope": "project",
        },
        password=None,
        root=tmp_path / "ws",
    )
    assert conn["id"] == "conn_1"
    assert conn["driver"] == "sqlite"
    assert "password" not in conn
    assert conn["credRef"] == "conn_1"

    items = db.list_connections(root=tmp_path / "ws")
    assert [c["id"] for c in items] == ["conn_1"]

    db.set_secret("conn_1", "p@ss")
    assert db.get_secret("conn_1") == "p@ss"
    assert secrets.get("conn_1") == "p@ss"

    db.delete_connection("conn_1", "project", root=tmp_path / "ws")
    assert db.list_connections(root=tmp_path / "ws") == []
    assert secrets.get("conn_1") is None


def test_connection_cred_ref_from_body(tmp_path, monkeypatch):
    monkeypatch.setenv("FIREYEAUD_GLOBAL_DIR", str(tmp_path / "global"))
    (tmp_path / "ws" / ".fireeye").mkdir(parents=True)
    secrets.clear()

    conn = db.create_connection(
        {
            "name": "pg",
            "driver": "postgresql",
            "host": "h",
            "database": "d",
            "username": "u",
            "scope": "project",
        },
        cred_ref="sec_abc",
        root=tmp_path / "ws",
    )
    assert conn["credRef"] == "sec_abc"
    assert "password" not in conn


def test_url_builders():
    assert db.build_url({"driver": "sqlite", "path": "C:/data/a.db"}).startswith(
        "sqlite:///"
    )
    assert (
        db.build_url(
            {
                "driver": "postgresql",
                "host": "h",
                "port": 5432,
                "database": "d",
                "username": "u",
            }
        )
        == "postgresql+psycopg://u@h:5432/d"
    )
    assert (
        db.build_url(
            {
                "driver": "mysql",
                "host": "h",
                "port": 3306,
                "database": "d",
                "username": "u",
            }
        )
        == "mysql+pymysql://u@h:3306/d"
    )
    assert db.build_url(
        {
            "driver": "mssql",
            "host": "h",
            "port": 1433,
            "database": "d",
            "username": "u",
        }
    ).startswith("mssql+pyodbc://u@h:1433/d")
    assert db.build_url({"driver": "access", "path": "C:/data/a.accdb"}).startswith(
        "access+pyodbc://"
    )
    # Oracle 默认按服务名；connectBy=sid 时走 SID。
    assert (
        db.build_url(
            {
                "driver": "oracle",
                "host": "h",
                "port": 1521,
                "database": "ORCLPDB1",
                "username": "u",
            }
        )
        == "oracle+oracledb://u@h:1521/?service_name=ORCLPDB1"
    )
    assert (
        db.build_url(
            {
                "driver": "oracle",
                "host": "h",
                "port": 1521,
                "database": "XE",
                "username": "u",
                "connectBy": "sid",
            }
        )
        == "oracle+oracledb://u@h:1521/XE"
    )

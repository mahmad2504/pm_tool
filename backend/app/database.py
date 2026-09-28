import os
from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "sqlite:///./pm.db",
)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def run_sqlite_migrations() -> None:
    if not DATABASE_URL.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "project_resources" not in inspector.get_table_names():
        return
    pr_columns = {col["name"] for col in inspector.get_columns("project_resources")}
    group_columns = (
        {col["name"] for col in inspector.get_columns("groups")}
        if "groups" in inspector.get_table_names()
        else set()
    )
    with engine.begin() as conn:
        if "groups" in inspector.get_table_names() and "icon_filename" not in group_columns:
            conn.execute(text("ALTER TABLE groups ADD COLUMN icon_filename VARCHAR(255)"))
        if "utilization_percent" not in pr_columns:
            if "availability_percent" in pr_columns:
                conn.execute(
                    text(
                        "ALTER TABLE project_resources RENAME COLUMN "
                        "availability_percent TO utilization_percent"
                    )
                )
            else:
                conn.execute(
                    text(
                        "ALTER TABLE project_resources ADD COLUMN utilization_percent "
                        "INTEGER NOT NULL DEFAULT 100"
                    )
                )
        if "project_role" not in pr_columns:
            conn.execute(
                text(
                    "ALTER TABLE project_resources ADD COLUMN project_role "
                    "VARCHAR(64) NOT NULL DEFAULT 'member'"
                )
            )
        if "onboarded" not in pr_columns:
            conn.execute(
                text(
                    "ALTER TABLE project_resources ADD COLUMN onboarded "
                    "INTEGER NOT NULL DEFAULT 0"
                )
            )
        if "projects" in inspector.get_table_names():
            project_columns = {col["name"] for col in inspector.get_columns("projects")}
            if "status" not in project_columns:
                conn.execute(
                    text(
                        "ALTER TABLE projects ADD COLUMN status "
                        "VARCHAR(32) NOT NULL DEFAULT 'in_progress'"
                    )
                )
            if "reports_with_pmo" not in project_columns:
                conn.execute(
                    text(
                        "ALTER TABLE projects ADD COLUMN reports_with_pmo "
                        "INTEGER NOT NULL DEFAULT 1"
                    )
                )


def ensure_reports_with_pmo_column() -> None:
    if DATABASE_URL.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if "projects" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("projects")}
    if "reports_with_pmo" in columns:
        return
    with engine.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE projects ADD COLUMN reports_with_pmo "
                "TINYINT(1) NOT NULL DEFAULT 1"
            )
        )


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

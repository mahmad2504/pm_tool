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
    with engine.begin() as conn:
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


def get_db() -> Generator:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

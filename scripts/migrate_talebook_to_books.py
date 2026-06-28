#!/usr/bin/env python3
import hashlib
import os
import shutil
import sqlite3
from pathlib import Path


SOURCE_LIBRARY = Path("/vol1/data/talebook/book/books/library")
SOURCE_DB = SOURCE_LIBRARY / "metadata.db"
TARGET_ROOT = Path("/vol1/data/Books/data/uploads")
TARGET_BOOK_DIR = TARGET_ROOT / "book"
TARGET_COVER_DIR = TARGET_ROOT / "cover"
TARGET_CONFIG_DIR = TARGET_ROOT / "config"
CURRENT_BOOKS_ROOT = Path("/vol1/app/Books/data/uploads")
CURRENT_BOOKS_DB = CURRENT_BOOKS_ROOT / "config" / "books.db"
CURRENT_LIBRARY_DB = CURRENT_BOOKS_ROOT / "config" / "library.db"
TARGET_BOOKS_DB = TARGET_CONFIG_DIR / "books.db"
TARGET_LIBRARY_DB = TARGET_CONFIG_DIR / "library.db"

ALLOWED_FORMATS = {"EPUB", "MOBI", "AZW", "AZW3", "PDF"}


def ensure_dirs():
    TARGET_BOOK_DIR.mkdir(parents=True, exist_ok=True)
    TARGET_COVER_DIR.mkdir(parents=True, exist_ok=True)
    TARGET_CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def copy_current_config():
    if CURRENT_BOOKS_DB.exists():
        shutil.copy2(CURRENT_BOOKS_DB, TARGET_BOOKS_DB)
    if CURRENT_LIBRARY_DB.exists():
        shutil.copy2(CURRENT_LIBRARY_DB, TARGET_LIBRARY_DB)


def ensure_target_books_schema(conn: sqlite3.Connection):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS books (
            key TEXT PRIMARY KEY,
            name TEXT,
            author TEXT,
            description TEXT,
            md5 TEXT,
            cover TEXT,
            format TEXT,
            publisher TEXT,
            size INTEGER,
            page INTEGER,
            path TEXT,
            charset TEXT,
            isbn TEXT,
            douban_id TEXT,
            tags TEXT,
            series TEXT,
            published_at TEXT,
            source TEXT,
            source_url TEXT,
            rating TEXT,
            owner_user_id INTEGER DEFAULT 1,
            visible_to_all INTEGER DEFAULT 1
        )
        """
    )
    conn.commit()


def file_md5(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_talebook_rows(conn: sqlite3.Connection):
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT
            b.id AS book_id,
            b.title,
            b.path,
            b.pubdate,
            b.isbn,
            b.has_cover,
            d.format,
            d.name AS data_name,
            d.uncompressed_size,
            GROUP_CONCAT(DISTINCT a.name) AS authors,
            c.text AS description,
            p.name AS publisher,
            s.name AS series,
            GROUP_CONCAT(DISTINCT t.name) AS tags,
            (
              SELECT val FROM identifiers i
              WHERE i.book = b.id AND i.type = 'isbn' AND i.val != ''
              LIMIT 1
            ) AS identifier_isbn
        FROM books b
        JOIN data d ON d.book = b.id
        LEFT JOIN books_authors_link bal ON bal.book = b.id
        LEFT JOIN authors a ON a.id = bal.author
        LEFT JOIN comments c ON c.book = b.id
        LEFT JOIN books_publishers_link bpl ON bpl.book = b.id
        LEFT JOIN publishers p ON p.id = bpl.publisher
        LEFT JOIN books_series_link bsl ON bsl.book = b.id
        LEFT JOIN series s ON s.id = bsl.series
        LEFT JOIN books_tags_link btl ON btl.book = b.id
        LEFT JOIN tags t ON t.id = btl.tag
        WHERE d.format IN ('EPUB', 'MOBI', 'AZW', 'AZW3', 'PDF')
        GROUP BY b.id, d.id
        ORDER BY b.id
        """
    )
    return cur.fetchall()


def sanitize_pubdate(value: str) -> str:
    if not value:
        return ""
    return str(value).split(" ")[0]


def migrate():
    ensure_dirs()
    copy_current_config()

    source = sqlite3.connect(SOURCE_DB)
    target = sqlite3.connect(TARGET_BOOKS_DB)
    ensure_target_books_schema(target)

    rows = load_talebook_rows(source)
    migrated = 0
    skipped = 0

    for row in rows:
        fmt = (row["format"] or "").upper()
        if fmt not in ALLOWED_FORMATS:
            skipped += 1
            continue

        base_dir = SOURCE_LIBRARY / row["path"]
        filename = f"{row['data_name']}.{fmt.lower()}"
        source_file = base_dir / filename
        if not source_file.exists():
            skipped += 1
            continue

        key = f"talebook-{row['book_id']}-{fmt.lower()}"
        target_file = TARGET_BOOK_DIR / f"{key}.{fmt.lower()}"
        shutil.copy2(source_file, target_file)

        cover_name = ""
        source_cover = base_dir / "cover.jpg"
        if source_cover.exists():
            cover_name = f"{key}.jpg"
            shutil.copy2(source_cover, TARGET_COVER_DIR / cover_name)

        isbn = (row["identifier_isbn"] or row["isbn"] or "").strip()
        title = (row["title"] or "").strip()
        author = (row["authors"] or "").strip()
        description = row["description"] or ""
        publisher = (row["publisher"] or "").strip()
        series = (row["series"] or "").strip()
        tags = (row["tags"] or "").strip()
        published_at = sanitize_pubdate(row["pubdate"] or "")
        size = int(row["uncompressed_size"] or source_file.stat().st_size or 0)
        path = f"./{filename}"
        md5 = file_md5(source_file)

        target.execute(
            """
            INSERT OR REPLACE INTO books (
                key, name, author, description, md5, cover, format,
                publisher, size, page, path, charset, isbn, douban_id,
                tags, series, published_at, source, source_url, rating,
                owner_user_id, visible_to_all
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                key,
                title,
                author,
                description,
                md5,
                cover_name,
                fmt,
                publisher,
                size,
                0,
                path,
                "",
                isbn,
                "",
                tags,
                series,
                published_at,
                "Talebook",
                "",
                "",
                1,
                1,
            ),
        )
        migrated += 1

    target.commit()
    source.close()
    target.close()
    print(f"migrated={migrated}")
    print(f"skipped={skipped}")


if __name__ == "__main__":
    migrate()

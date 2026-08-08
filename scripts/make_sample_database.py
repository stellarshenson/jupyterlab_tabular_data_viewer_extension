#!/usr/bin/env python3
"""Build data/sample_database.db - the deterministic SQLite test fixture.

Four user tables cover every branch of the SQLite datasource:

- customers    plain TEXT/INTEGER/REAL columns, first table alphabetically
- orders       INTEGER PRIMARY KEY AUTOINCREMENT, which creates sqlite_sequence
- attachments  a BLOB column, for the "<BLOB n>" placeholder
- mixed_types  one column holding both integers and strings, for the
               per-column cascading type inference

No randomness and no current timestamps - re-running rebuilds the same
logical content. Run with: python scripts/make_sample_database.py
"""

import os
import sqlite3

DB_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data",
    "sample_database.db",
)

CUSTOMERS = [
    (1, "Ada Lovelace", "London", "2023-01-15", 1520.50, 7),
    (2, "Grace Hopper", "New York", "2023-02-03", 2840.00, 12),
    (3, "Alan Turing", "Manchester", "2023-02-19", 980.25, 4),
    (4, "Katherine Johnson", "Hampton", "2023-03-07", 3310.75, 15),
    (5, "Edsger Dijkstra", "Rotterdam", "2023-03-22", 640.00, 3),
    (6, "Barbara Liskov", "Boston", "2023-04-11", 1875.40, 9),
    (7, "Donald Knuth", "Milwaukee", "2023-05-02", 2210.10, 11),
    (8, "Margaret Hamilton", "Paoli", "2023-05-28", 4120.90, 18),
    (9, "Ken Thompson", "New Orleans", "2023-06-14", 1330.00, 6),
    (10, "Radia Perlman", "Portsmouth", "2023-07-01", 2695.65, 13),
    (11, "Leslie Lamport", "Yonkers", "2023-08-09", 755.30, 3),
    (12, "Frances Allen", "Peru", "2023-09-21", 1980.00, 8),
]

PRODUCTS = [
    ("Keyboard", 49.99),
    ("Monitor", 219.00),
    ("Docking Station", 134.50),
    ("Webcam", 79.95),
    ("Headset", 99.00),
    ("Mouse", 24.75),
]

# order_id is autoincremented; rows are derived deterministically from index
ORDERS = [
    (
        (i % 12) + 1,
        PRODUCTS[i % 6][0],
        (i % 4) + 1,
        PRODUCTS[i % 6][1],
        "2024-%02d-%02d 09:%02d:00" % ((i % 12) + 1, (i % 27) + 1, (i * 7) % 60),
    )
    for i in range(30)
]

ATTACHMENT_SIZES = [256, 1024, 4096, 16384]

ATTACHMENTS = [
    (1, 3, "invoice_0003.pdf", ATTACHMENT_SIZES[0]),
    (2, 11, "packing_slip_0011.pdf", ATTACHMENT_SIZES[1]),
    (3, 17, "warranty_0017.pdf", ATTACHMENT_SIZES[2]),
    (4, 26, "manual_0026.pdf", ATTACHMENT_SIZES[3]),
]

MIXED_TYPES = [
    (1, 42, "integer reading"),
    (2, "n/a", "string sentinel"),
    (3, 17, "integer reading"),
    (4, "pending", "string sentinel"),
    (5, 3, "integer reading"),
    (6, "1250", "numeric string"),
]


def blob(size):
    """Deterministic filler bytes of the requested length."""
    return bytes((i * 7 + 13) % 256 for i in range(size))


def build(path):
    if os.path.exists(path):
        os.remove(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)

    conn = sqlite3.connect(path)
    try:
        conn.executescript(
            """
            CREATE TABLE customers (
                customer_id     INTEGER PRIMARY KEY,
                name            TEXT NOT NULL,
                city            TEXT NOT NULL,
                signup_date     TEXT NOT NULL,
                lifetime_value  REAL NOT NULL,
                orders_count    INTEGER NOT NULL
            );

            CREATE TABLE orders (
                order_id     INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id  INTEGER NOT NULL,
                product      TEXT NOT NULL,
                quantity     INTEGER NOT NULL,
                unit_price   REAL NOT NULL,
                ordered_at   TEXT NOT NULL
            );

            CREATE TABLE attachments (
                attachment_id  INTEGER PRIMARY KEY,
                order_id       INTEGER NOT NULL,
                filename       TEXT NOT NULL,
                content        BLOB NOT NULL
            );

            CREATE TABLE mixed_types (
                record_id    INTEGER PRIMARY KEY,
                measurement,  -- no affinity: keeps INTEGER and TEXT as given
                note         TEXT NOT NULL
            );
            """
        )
        conn.executemany(
            "INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?)", CUSTOMERS
        )
        conn.executemany(
            "INSERT INTO orders (customer_id, product, quantity, unit_price, "
            "ordered_at) VALUES (?, ?, ?, ?, ?)",
            ORDERS,
        )
        conn.executemany(
            "INSERT INTO attachments VALUES (?, ?, ?, ?)",
            [(a, o, f, blob(n)) for a, o, f, n in ATTACHMENTS],
        )
        conn.executemany(
            "INSERT INTO mixed_types VALUES (?, ?, ?)", MIXED_TYPES
        )
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()


def verify(path):
    conn = sqlite3.connect(path)
    try:
        names = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
        ]
        assert "sqlite_sequence" in names, "sqlite_sequence was not created"
        expected = {
            "attachments": 4,
            "customers": 12,
            "mixed_types": 6,
            "orders": 30,
        }
        for table, count in expected.items():
            assert table in names, "missing table: %s" % table
            actual = conn.execute(
                'SELECT COUNT(*) FROM "%s"' % table
            ).fetchone()[0]
            assert actual == count, "%s: %d rows, expected %d" % (
                table,
                actual,
                count,
            )
        return names, expected
    finally:
        conn.close()


def main():
    build(DB_PATH)
    names, expected = verify(DB_PATH)
    print("wrote %s (%d bytes)" % (DB_PATH, os.path.getsize(DB_PATH)))
    print("tables in sqlite_master: %s" % ", ".join(names))
    for table in sorted(expected):
        print("  %-12s %2d rows" % (table, expected[table]))


if __name__ == "__main__":
    main()

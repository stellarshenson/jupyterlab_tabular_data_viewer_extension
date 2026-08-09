"""File readers for tabular formats with cascading type inference.

Reads parquet/excel/csv/tsv/sqlite files into PyArrow tables. Object columns
with mixed types (e.g. integers mixed with strings) fall back to string when
native PyArrow inference fails, so the viewer can still display them.
"""

import os
import sqlite3
import threading
from collections import OrderedDict
from contextlib import closing, contextmanager
from urllib.parse import quote

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

# pandas re-raises driver errors as its own DatabaseError, which moved to
# pandas.errors only in 2.0; the declared floor is 1.5, where it lives in
# pandas.io.sql. Bind it once at import: resolving the attribute inside an
# `except` clause would raise AttributeError while an error is already
# propagating, which is how the 500 this arm exists to prevent would come back.
try:
    from pandas.errors import DatabaseError as PandasDatabaseError
except ImportError:  # pandas < 2.0
    from pandas.io.sql import DatabaseError as PandasDatabaseError

# Only SQLite is sniffed. It is the one format whose extension carries no
# information (.db belongs to Berkeley DB, LevelDB and others, and a database
# may have any extension at all), and its 16-byte magic cannot occur at the
# start of a text file.
#
# Parquet and xlsx are deliberately NOT sniffed. "PAR1" is four printable
# characters, so a CSV whose first column is named PAR1 was being read as
# parquet; "PK\x03\x04" matches every zip, so any zip named .db was typed as
# excel and failed with a KeyError - which is not a ValueError, so it escaped
# the handlers' 400 path and surfaced as a 500 with a traceback. Both formats
# resolve from their extension exactly as they did before.
_MAGIC = [
    (b"SQLite format 3\x00", "sqlite"),
]


def sniff_file_type(file_path):
    """Identify by magic header, as file(1) does. None when unrecognised."""
    # Guard the open: a FIFO in the notebook tree would otherwise block the
    # handler (and the Tornado IOLoop with it) until a writer appeared.
    if not os.path.isfile(file_path):
        return None
    try:
        with open(file_path, "rb") as fh:
            head = fh.read(16)
    except OSError:
        return None
    for magic, kind in _MAGIC:
        if head.startswith(magic):
            return kind
    return None


def get_file_type(file_path):
    """Determine file type from content first, extension as fallback.

    CSV/TSV carry no magic header so they always resolve by extension.
    """
    sniffed = sniff_file_type(file_path)
    if sniffed:
        return sniffed
    ext = os.path.splitext(file_path)[1].lower()
    if ext == ".parquet":
        return "parquet"
    elif ext in [".xlsx", ".xls"]:
        return "excel"
    elif ext == ".csv":
        return "csv"
    elif ext == ".tsv":
        return "tsv"
    else:
        return "unknown"


def _series_to_arrow_array(series):
    """Convert a pandas Series to a PyArrow Array with a two-step type cascade.

    Tries native PyArrow inference first. If that fails (typically on object
    columns with mixed types where inference picks a numeric/boolean type from
    the leading values and then chokes on a later string), retries with the
    series cast to nullable string dtype.

    Numeric coercion is intentionally not part of the cascade: Excel stores
    dates as floats internally, so a numeric fallback could silently strip
    date semantics from columns that have a few stray non-date values.
    """
    try:
        return pa.array(series, from_pandas=True)
    except (pa.ArrowInvalid, pa.ArrowTypeError, pa.ArrowNotImplementedError):
        return pa.array(series.astype("string"), from_pandas=True)


def _df_to_arrow(df):
    """Convert a pandas DataFrame to a PyArrow Table column-by-column.

    Each column passes through the cascading type inference in
    `_series_to_arrow_array`, so a single problematic column does not block
    the whole table.
    """
    arrays = [_series_to_arrow_array(df[col]) for col in df.columns]
    return pa.Table.from_arrays(arrays, names=list(df.columns))


def _read_excel(file_path, sheet=None):
    """Read a worksheet of an Excel file into a PyArrow Table.

    `sheet` accepts a sheet name (string) or `None` for the first sheet.
    """
    sheet_name = sheet if sheet else 0
    df = pd.read_excel(file_path, sheet_name=sheet_name, engine="openpyxl")
    return _df_to_arrow(df)


def list_excel_sheets(file_path):
    """Return sheet names in workbook order. Empty list for non-Excel files."""
    if get_file_type(file_path) != "excel":
        return []
    with pd.ExcelFile(file_path, engine="openpyxl") as xl:
        return list(xl.sheet_names)


def _read_delimited(file_path, delimiter):
    """Read a delimited text file (CSV/TSV) into a PyArrow Table.

    Tries UTF-8 first, falls back to latin1 on decoding errors.
    """
    try:
        df = pd.read_csv(file_path, delimiter=delimiter, encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(file_path, delimiter=delimiter, encoding="latin1")
    return _df_to_arrow(df)


def _sqlite_uri(file_path):
    """Read-only SQLite URI for a path, percent-escaping '?' and '#'."""
    return "file:" + quote(os.path.abspath(file_path)) + "?mode=ro"


@contextmanager
def _sqlite_conn(file_path):
    """Read-only connection, with driver errors mapped to ValueError.

    A corrupt database, one locked by another writer, or a WAL database on a
    read-only mount all raise sqlite3.Error subclasses that are not
    ValueError, so without this they escape the handlers' 400 path and surface
    as a 500 with a server-side traceback in the body.

    pandas.errors.DatabaseError has to be caught alongside it: pandas catches
    the driver's exception inside read_sql_query and re-raises it as its own
    DatabaseError, which subclasses OSError rather than sqlite3.Error. Without
    that arm, a table whose SELECT fails - a virtual table backed by a module
    this SQLite build lacks, or a clobbered data page behind an intact
    header - still escaped as a 500.
    """
    try:
        conn = sqlite3.connect(_sqlite_uri(file_path), uri=True)
    except sqlite3.Error as e:
        raise ValueError(f"Cannot open SQLite database: {e}")
    try:
        with closing(conn):
            yield conn
    except (sqlite3.Error, PandasDatabaseError) as e:
        raise ValueError(f"Cannot read SQLite database: {e}")


def list_sqlite_tables(file_path):
    """User tables in name order. System tables (sqlite_*) excluded.

    Empty list for non-SQLite files. The ESCAPE clause matters: without it
    the underscore in 'sqlite_%' is a single-character wildcard and would
    also hide user tables like 'sqliteX...'.
    """
    if get_file_type(file_path) != "sqlite":
        return []
    with _sqlite_conn(file_path) as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            r"AND name NOT LIKE 'sqlite\_%' ESCAPE '\' ORDER BY name"
        ).fetchall()
    return [r[0] for r in rows]


def _quote_ident(name):
    """Double-quote a SQL identifier, doubling any embedded quote."""
    return '"' + name.replace('"', '""') + '"'


def _blob_placeholder_sql(name):
    """SQL yielding '<BLOB size>' for BLOB cells and the value for everything else.

    Size is rendered B/KB/MB with one decimal and a trailing '.0' dropped:
    `rtrim(rtrim(x, '0'), '.')` removes it because the inner rtrim stops at the
    decimal point and the outer takes the point itself.

    This SQL is the only implementation of the format. A Python twin used to
    exist and the two silently disagreed on 5,118 sizes: SQLite's printf rounds
    half away from zero while CPython's `%.1f` rounds half to even, so a
    1,280-byte BLOB rendered '1.3 KB' here and '1.2 KB' there. BLOB sizes hit
    exact binary halves constantly because the divisors are powers of two, so
    that was not a corner case. Half-up is kept - it is what a reader expects
    of 1.25 - and the twin is gone rather than reconciled.

    Built in SQL rather than in pandas on purpose. SQLite answers LENGTH() on a
    BLOB from the record header without loading the payload off its overflow
    pages, so the bytes are never read, never cross into pandas, and never
    reach the frontend. Doing it in pandas meant materialising every BLOB in
    full only to throw it away - 410 MB per request on a real database.
    """
    col = _quote_ident(name)

    def scaled(divisor, unit):
        return (
            f"rtrim(rtrim(printf('%.1f', LENGTH({col}) / {divisor}), '0'), '.')"
            f" || ' {unit}'"
        )

    return (
        f"CASE WHEN typeof({col}) = 'blob' THEN '<BLOB ' || CASE"
        f" WHEN LENGTH({col}) < 1024 THEN {scaled('1.0', 'B')}"
        f" WHEN LENGTH({col}) < 1048576 THEN {scaled('1024.0', 'KB')}"
        f" ELSE {scaled('1048576.0', 'MB')} END || '>'"
        f" ELSE {col} END AS {col}"
    )


def _read_sqlite(file_path, table=None):
    """Read a table of a SQLite database into a PyArrow Table.

    `table` accepts a table name or `None` for the first user table. The name
    is validated against `list_sqlite_tables` - table names cannot be passed
    as SQL parameters, so the whitelist is the security boundary.

    The whole table is read. Serving a page from a SQL LIMIT/OFFSET window was
    tried and reverted - see DEF-3 in docs/defects.md.
    """
    tables = list_sqlite_tables(file_path)
    if not tables:
        raise ValueError("No user tables in database")
    if not table:
        table = tables[0]
    elif table not in tables:
        raise ValueError(f"Table not found: {table}")
    ident = _quote_ident(table)
    with _sqlite_conn(file_path) as conn:
        # table_xinfo, not table_info: table_info omits generated columns, which
        # `SELECT *` returns, so building the select list from it silently
        # dropped them from the grid. xinfo's trailing `hidden` flag is 0 for an
        # ordinary column, 2 and 3 for VIRTUAL and STORED generated columns
        # (both of which `*` includes), and 1 for a genuinely hidden column such
        # as an fts5 shadow (which `*` excludes) - so `!= 1` reproduces `*`.
        columns = [
            row[1]
            for row in conn.execute(f"PRAGMA table_xinfo({ident})")
            if row[-1] != 1
        ]
        if not columns:
            raise ValueError(f"Table has no readable columns: {table}")
        select_list = ", ".join(_blob_placeholder_sql(c) for c in columns)
        df = pd.read_sql_query(f"SELECT {select_list} FROM {ident}", conn)
    return _df_to_arrow(df)


# ---------------------------------------------------------------------------
# Read cache
#
# Arrow tables are immutable and every consumer builds new tables from them
# (append_column, filter, slice, take all return copies), so one cached table
# can back concurrent readers without defensive copying.
#
# The key carries mtime_ns and size, so an edited file misses rather than
# serving stale rows. That is the same staleness signal JupyterLab itself uses
# for documents.
#
# It also carries the -wal sidecar's mtime and size. A SQLite writer that holds
# its connection open commits into the WAL without checkpointing, leaving the
# main file byte-for-byte identical - so on mtime and size alone the cache
# served rows that were already superseded on disk, which re-reading could not
# cure because a reopen produces the same key.
# ---------------------------------------------------------------------------

_CACHE_MAX_BYTES = 256 * 1024 * 1024

# key -> arrow Table, in least-recently-used order
_CACHE = OrderedDict()
_CACHE_BYTES = 0

# Handlers are synchronous, so today they run one at a time on the IOLoop
# thread. The lock costs nothing measurable and means the cache does not
# silently corrupt if a handler is ever moved onto an executor.
_CACHE_LOCK = threading.Lock()


def _cache_key(file_path, sheet):
    """Identity of a read: absolute path, sheet/table, mtime/size, WAL mtime/size."""
    path = os.path.abspath(file_path)
    stat = os.stat(path)
    try:
        wal = os.stat(path + "-wal")
        wal_id = (wal.st_mtime_ns, wal.st_size)
    except OSError:
        # No sidecar: not a WAL database, or already checkpointed
        wal_id = (0, 0)
    return (path, sheet, stat.st_mtime_ns, stat.st_size, wal_id)


def _cache_get(key):
    """Cached table for `key`, or None. Marks the entry most recently used."""
    with _CACHE_LOCK:
        if key not in _CACHE:
            return None
        _CACHE.move_to_end(key)
        return _CACHE[key]


def _cache_put(key, table):
    """Store `table`, dropping stale versions of the same file and evicting LRU."""
    global _CACHE_BYTES
    size = table.nbytes
    path, sheet = key[0], key[1]
    with _CACHE_LOCK:
        # Purge first, and unconditionally: an edited file would otherwise leave
        # its previous version resident and counted. That has to happen even
        # when the new table is too big to cache, or growing a file past the
        # budget would strand its old version until LRU pressure removed it.
        for stale in [k for k in _CACHE if k[0] == path and k[1] == sheet]:
            _CACHE_BYTES -= _CACHE.pop(stale).nbytes
        if size > _CACHE_MAX_BYTES:
            # One table bigger than the whole budget would evict everything and
            # then itself on the next read; skip it rather than thrash.
            return
        _CACHE[key] = table
        _CACHE_BYTES += size
        while _CACHE_BYTES > _CACHE_MAX_BYTES:
            _CACHE_BYTES -= _CACHE.popitem(last=False)[1].nbytes


def _cache_clear():
    """Empty the cache. Used by tests."""
    global _CACHE_BYTES
    with _CACHE_LOCK:
        _CACHE.clear()
        _CACHE_BYTES = 0


def _read_uncached(file_path, sheet):
    """Dispatch to the per-format reader. See `read_as_arrow_table`."""
    ft = get_file_type(file_path)
    if ft == "parquet":
        return pq.read_table(file_path)
    if ft == "excel":
        return _read_excel(file_path, sheet)
    if ft == "sqlite":
        return _read_sqlite(file_path, sheet)
    if ft == "csv":
        return _read_delimited(file_path, ",")
    if ft == "tsv":
        return _read_delimited(file_path, "\t")
    raise ValueError(f"Unsupported file type: {ft}")


def read_as_arrow_table(file_path, sheet=None):
    """Read a tabular file (parquet/excel/csv/tsv/sqlite) into a PyArrow Table.

    `sheet` is honoured for Excel files (sheet name) and SQLite databases
    (table name); ignored otherwise. Raises ValueError for unsupported file
    types so callers can map the error to an HTTP 400 response.

    Results are cached - see `_CACHE`. Every handler reads the whole table and
    then pages, sorts or filters it, so without a cache a browse re-read the
    file on every scroll: 0.735s and 66 MB of arrow per page on a 46k-row
    table. Caching the table rather than pushing a row window into SQL keeps
    filters, sorting and statistics global and, because the page is cut from
    the identical table object every time, sidesteps the type-inference
    mismatch that makes a windowed read disagree with a full one (DEF-3).
    """
    try:
        key = _cache_key(file_path, sheet)
    except OSError:
        # Unstattable file - let the reader raise the real error
        return _read_uncached(file_path, sheet)

    cached = _cache_get(key)
    if cached is not None:
        return cached

    table = _read_uncached(file_path, sheet)
    _cache_put(key, table)
    return table

"""File readers for tabular formats with cascading type inference.

Reads parquet/excel/csv/tsv/sqlite files into PyArrow tables. Object columns
with mixed types (e.g. integers mixed with strings) fall back to string when
native PyArrow inference fails, so the viewer can still display them.
"""

import os
import sqlite3
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


def _format_blob_size(num_bytes):
    """Human-readable BLOB size: B/KB/MB, one decimal, trailing '.0' dropped."""
    size = float(num_bytes)
    for unit in ("B", "KB", "MB"):
        if size < 1024 or unit == "MB":
            return f"{size:.1f}".rstrip("0").rstrip(".") + f" {unit}"
        size /= 1024


def _blob_placeholder(value):
    """Replace a binary cell with a '<BLOB size>' string, pass anything else."""
    if isinstance(value, memoryview):
        return f"<BLOB {_format_blob_size(value.nbytes)}>"
    if isinstance(value, bytes):
        return f"<BLOB {_format_blob_size(len(value))}>"
    return value


def _read_sqlite(file_path, table=None):
    """Read a table of a SQLite database into a PyArrow Table.

    `table` accepts a table name or `None` for the first user table. The name
    is validated against `list_sqlite_tables` - table names cannot be passed
    as SQL parameters, so the whitelist is the security boundary.
    """
    tables = list_sqlite_tables(file_path)
    if not tables:
        raise ValueError("No user tables in database")
    if not table:
        table = tables[0]
    elif table not in tables:
        raise ValueError(f"Table not found: {table}")
    ident = table.replace('"', '""')
    with _sqlite_conn(file_path) as conn:
        df = pd.read_sql_query(f'SELECT * FROM "{ident}"', conn)
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].map(_blob_placeholder)
    return _df_to_arrow(df)


def read_as_arrow_table(file_path, sheet=None):
    """Read a tabular file (parquet/excel/csv/tsv/sqlite) into a PyArrow Table.

    `sheet` is honoured for Excel files (sheet name) and SQLite databases
    (table name); ignored otherwise. Raises ValueError for unsupported file
    types so callers can map the error to an HTTP 400 response.
    """
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

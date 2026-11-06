"""File readers for tabular formats.

Reads parquet/excel/csv/tsv/sqlite files into PyArrow tables. Three engines:
pyarrow reads parquet, openpyxl reads the worksheet rows of an .xlsx and polars
types them, and polars reads csv, tsv and sqlite outright.

A column holding mixed types - integers with the odd string among them -
resolves to string rather than failing the read. Polars does that itself, but
only when allowed to infer from every row, which is why
`infer_schema_length=None` appears on the CSV and SQLite reads and is not
tidy-up-able. At the default 100-row window a string arriving at row 201 raises
ComputeError instead, which is precisely how two real-world Excel files came to
be unopenable before v1.6.0 - and no fixture in this repo is long enough to
catch the regression. Excel needs no window: `_column_series` resolves such a
column in Python, over every row, before polars sees a value.
"""

import codecs
import datetime as dt
import json
import mmap
import os
import re
import sqlite3
import threading
from collections import OrderedDict
from contextlib import closing, contextmanager
from urllib.parse import quote

import openpyxl
import polars as pl
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

# Bound at import, not looked up inside an `except` clause. Resolving
# `pl.exceptions.X` while an exception is already propagating would raise
# AttributeError from the handler itself, which is the dead request these arms
# exist to prevent; PanicException is only re-exported by polars (it is
# pyo3_runtime's) so it is the likeliest of the two to move.
from polars.exceptions import ComputeError, PanicException, PolarsError

# Both openpyxl call sites load with these options. keep_links is the one that
# changes behaviour: left at its default True, openpyxl walks every
# <externalReference> part, which costs 0.55s against 0.002s on a workbook with
# a large cached link and raises AttributeError - not a ValueError, so a 500 -
# when a link's relationship is missing, as an Excel repair leaves it.
_OPENPYXL_LOAD = dict(read_only=True, data_only=True, keep_links=False)

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


# The strings pandas treated as missing by default. Polars parses none of them,
# so without this a numeric column carrying one 'NA' typed as text - which the
# frontend then filters as a substring and sorts lexicographically, putting 9
# after 100, and which loses min, max and mean from its statistics. R exports,
# BI tools and hand-maintained spreadsheets all emit these.
_NULL_STRINGS = [
    "",
    "#N/A",
    "#N/A N/A",
    "#NA",
    "-1.#IND",
    "-1.#QNAN",
    "-NaN",
    "-nan",
    "1.#IND",
    "1.#QNAN",
    "<NA>",
    "N/A",
    "NA",
    "NULL",
    "NaN",
    "None",
    "n/a",
    "nan",
    "null",
]
_NULL_STRING_SET = frozenset(_NULL_STRINGS)

# Excel's seven error values, as openpyxl's own ERROR_CODES lists them. Read
# with `values_only` a broken cell hands back the error STRING, where pandas
# mapped it to NaN, and only '#N/A' happens to be in the missing-value set
# above - so one post-delete '#REF!' or one broken VLOOKUP retyped an entire
# numeric column as text, which is exactly the harm that set exists to prevent.
# Spelled out rather than imported: ERROR_CODES is a module-level constant in
# `openpyxl.cell.cell`, not documented API, and an ImportError there would take
# the whole server extension down.
#
# Excel only. Pandas did NOT treat these as missing in a csv, and the csv reader
# shares _NULL_STRINGS. The cost is a text cell whose literal content is '#REF!'
# reading as empty - strictly the smaller loss.
_EXCEL_ERRORS = frozenset(
    ("#NULL!", "#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#NUM!", "#N/A")
)


def _null_marker_to_none(value):
    """Map a spreadsheet cell holding a missing-value marker to None."""
    if not isinstance(value, str):
        return value
    return None if value in _NULL_STRING_SET or value in _EXCEL_ERRORS else value


# The message polars raises when an integer literal overflows Int128, its widest
# integer type. The column name is what a retry needs.
_I128_OVERFLOW = re.compile(r"as dtype `i128` at column '([^']*)'")


def _oversized_integer_column(error):
    """The column an Int128 overflow names, or None for any other ComputeError."""
    match = _I128_OVERFLOW.search(str(error))
    return match.group(1) if match else None


def _cast_unsupported_columns_to_string(df):
    """Type as string the columns arrow cannot carry, so the read survives them.

    Two dtypes, both of which otherwise fail AFTER the read has succeeded:

    - Null. A named but entirely blank spreadsheet column comes back Null-typed,
      which reaches arrow as `null`. Nothing downstream has kernels for it:
      column statistics raise ArrowNotImplementedError, which is not a
      ValueError, so the request 500s. Pandas typed such a column float64;
      string is the closer reading of a blank text column, and it is a type the
      rest of the pipeline can actually compute on.
    - Int128. Polars infers it for an integer literal at or above 2**63 in a csv
      and above 2**64 in a spreadsheet, and pyarrow cannot consume its arrow
      export - `.to_arrow()` raises ArrowInvalid('_pli128'). That is itself a
      ValueError, so a csv carrying one uint64 key or snowflake id became a 400
      and would not open at all, where pandas read the column as uint64.

    An Int128 column whose values all fit in an unsigned 64-bit integer becomes
    UInt64, which is where snowflake ids, uint64 hashes and Discord or Twitter
    ids actually live - keeping numeric sorting and min/max/mean, as pandas did.
    A column outside that band falls back to String, which keeps every digit
    but sorts lexicographically and reports no aggregates - so a value past
    2**64-1, and equally a uint64 id column carrying a negative sentinel, which
    no unsigned type can hold.

    This runs after inference has succeeded, so it cannot help a literal wider
    than Int128 itself - a 39-digit integer fails inside `read_csv`. The csv
    reader catches that and re-reads with the named column typed as text, which
    lands here already String.
    """
    to_string, to_uint64 = [], []
    for name, dtype in df.schema.items():
        if dtype == pl.Null:
            to_string.append(name)
        elif dtype == pl.Int128:
            low, high = df[name].min(), df[name].max()
            fits = low is not None and low >= 0 and high <= 2**64 - 1
            (to_uint64 if fits else to_string).append(name)
    casts = {name: pl.String for name in to_string}
    casts.update({name: pl.UInt64 for name in to_uint64})
    return df.cast(casts) if casts else df


def _is_blank(value):
    """True for a header cell that renders as nothing.

    Whitespace counts as blank, so a header of '   ' is numbered exactly as an
    empty one: the two are indistinguishable in the grid, and a name made only
    of spaces is unusable in a filter or a statistics request. This is a
    deliberate divergence, not parity - measured, pandas kept '   ' as the column
    name and gave `Unnamed: N` only to a truly empty cell. The trailing-row trim
    deliberately does NOT share this definition either - there a whitespace cell
    is a value, not an absence.
    """
    return value is None or not str(value).strip()


def _header_names(header_row, width):
    """Column names from a header row, numbered where blank and deduplicated.

    `Unnamed: <position>` for a blank cell and a `.1`, `.2` suffix for a repeat
    are both pandas' conventions, and both are load-bearing rather than
    cosmetic: an empty name makes the frontend's statistics request 400, and a
    repeated one silently collapses two columns into one, because the frame is
    built from a mapping of name to values.

    The suffix search skips names the header ALREADY carries, which is what makes
    it safe. A header of `name, name.1, name` numbers the repeat `.2`, where
    stopping at the first candidate would have produced a second `name.1` and
    dropped the middle column's values entirely.
    """
    raw = [
        f"Unnamed: {i}" if _is_blank(header_row[i] if i < len(header_row) else None)
        else str(header_row[i])
        for i in range(width)
    ]
    taken = set(raw)
    names, seen = [], {}
    for name in raw:
        if name not in seen:
            seen[name] = 0
            names.append(name)
            continue
        suffix = seen[name]
        while True:
            suffix += 1
            candidate = f"{name}.{suffix}"
            if candidate not in taken:
                break
        seen[name] = suffix
        seen[candidate] = 0
        taken.add(candidate)
        names.append(candidate)
    return names


# The value kinds a spreadsheet column can mix. A column holding more than one
# of them is typed as text, which is what pandas' object dtype amounted to.
# Without this polars' `strict=False` coerces the odd value into the majority
# type and the value is silently replaced: a date in a column of integers comes
# back as its epoch microsecond count, and a stray string in a column of dates
# makes the whole read raise instead.
#
# One kind per set of types polars can actually widen together. `date` and
# `datetime` can - `datetime` is a subclass, and openpyxl returns a datetime for
# both anyway - but `time` and `timedelta` cannot, and a cell formatted as a
# clock time or as an elapsed `[h]:mm` is how they arrive. Grouping all four as
# one "temporal" kind kept the guard from firing on the mixtures that need it
# most: datetime+time and date+time raised so the file would not open at all,
# datetime+timedelta dropped the duration to null, and time+timedelta reached
# arrow as fixed_size_binary[8] holding raw CPython object pointers, which the
# grid rendered as mojibake and every export wrote out as hex.
def _value_kind(value):
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "text"
    if isinstance(value, dt.date):
        return "temporal"
    return type(value).__name__


def _column_series(name, values):
    """One column, typed by polars, forced to text when it mixes value kinds.

    `strict=False` is what resolves a single-kind column without raising, but it
    resolves by DISCARDING: a value the inferred dtype cannot hold becomes null,
    with no error and no trace in the response - an integer at or above 2**127
    lands in an Int128 column as nothing at all. The mixed-kind guard cannot
    catch it, since every value there is the same kind. So the result is counted
    against the input, and a column that lost a value is rebuilt as text, where
    every digit survives.
    """
    def as_text():
        return pl.Series(name, [None if v is None else str(v) for v in values], strict=False)

    kinds = {_value_kind(v) for v in values if v is not None}
    if len(kinds) > 1:
        return as_text()
    series = pl.Series(name, values, strict=False)
    supplied = sum(1 for v in values if v is not None)
    if series.null_count() != len(values) - supplied:
        return as_text()
    return series


def _read_excel(file_path, sheet=None):
    """Read a worksheet of an Excel file into a PyArrow Table.

    `sheet` accepts a sheet name (string) or `None` for the first worksheet.

    The sheet is read through openpyxl here rather than through
    `pl.read_excel`, which uses openpyxl itself but decides two things
    differently from pandas, each losing data:

    - it prefers a defined Table object over the used range, and reads only the
      FIRST one. "Format as Table" is how business spreadsheets are normally
      structured, and a table whose `ref` was never extended after rows were
      appended is how they normally rot - so a sheet with 4 rows, 3 columns and
      a stale `ref="A1:B3"` came back as 2 rows and 2 columns, in the grid, the
      statistics and every export. There is no kwarg to turn the preference off.
    - it takes the header from the first NON-EMPTY row, so a blank spacer row
      above a table consumed the first real data row, and a header row with no
      data under it produced a frame with no columns at all.

    Reading the rows directly settles both, and drops the three kwargs that were
    correcting polars' other defaults (`drop_empty_cols`, `drop_empty_rows`,
    `raise_if_empty`) - nothing is dropped now, so there is nothing to switch
    off. Polars still does the typing: `pl.Series(..., strict=False)` resolves a
    column of integers holding one string to String, which is the v1.6.0
    cascade's job, and it sees every row, so a string arriving at row 250 needs
    no inference window.

    The three load kwargs are pandas' own, verified against its openpyxl reader.
    `data_only=True` is the load-bearing one: without it a formula cell yields
    its formula text, so a header row of formulas reads as populated where
    pandas saw the cached value - or no value at all.
    """
    sheet = sheet or None
    # Handed an open file rather than a path on purpose: openpyxl refuses a path
    # ending in .xls outright, and `.xls` is one of the extensions this viewer
    # claims, so a real xlsx saved under the old name 500d. Pandas passed a
    # handle for the same reason.
    with open(file_path, "rb") as handle:
        book = openpyxl.load_workbook(handle, **_OPENPYXL_LOAD)
        try:
            if not book.worksheets:
                # A workbook of nothing but chartsheets. Indexing [0] would
                # raise IndexError, which is not a ValueError, so it would 500
                # rather than 400.
                raise ValueError("Workbook contains no worksheets")
            if sheet is None:
                worksheet = book.worksheets[0]
            else:
                # First match, as openpyxl's own __getitem__ resolves it. Two
                # worksheets can share a title only in a hand-edited file, but
                # then `list_excel_sheets` renders two identical tabs and both
                # must open the same sheet as each other.
                worksheet = next(
                    (ws for ws in book.worksheets if ws.title == sheet), None
                )
                if worksheet is None:
                    raise ValueError(f"Sheet not found: {sheet}")
            # In read-only mode openpyxl trusts the sheet's declared <dimension>
            # rather than the cells present, and a dimension record that
            # under-reports the used range - which several writers emit, some as
            # a bare "A1" placeholder - silently truncated the sheet to it.
            # Pandas calls this for the same reason.
            worksheet.reset_dimensions()
            rows = [row for row in worksheet.iter_rows(values_only=True)]
        finally:
            book.close()

    # A sheet's used range routinely overshoots its data - a cell that was
    # formatted and then cleared still counts - so pandas trimmed trailing empty
    # rows and this does too. Two limits, both learned from a differential sweep
    # against pandas: only rows AFTER the header are candidates, or a sheet whose
    # single row is a blank header lost its columns as well; and a cell holding
    # whitespace is a value, not an absence, so `is None` is the test rather than
    # `_is_blank`. Empty rows BETWEEN data rows stay - they carry position, and
    # dropping them would shift every row number after them.
    while len(rows) > 1 and all(v is None for v in rows[-1]):
        rows.pop()

    if not rows:
        return pl.DataFrame().to_arrow()

    header_row, data_rows = rows[0], rows[1:]
    width = max(len(header_row), max((len(row) for row in data_rows), default=0))
    names = _header_names(header_row, width)

    columns = {}
    for i, name in enumerate(names):
        values = [
            _null_marker_to_none(row[i] if i < len(row) else None)
            for row in data_rows
        ]
        columns[name] = _column_series(name, values)

    return _cast_unsupported_columns_to_string(pl.DataFrame(columns)).to_arrow()


def list_excel_sheets(file_path):
    """Return worksheet names in workbook order. Empty list for non-Excel files.

    Worksheets only, deliberately: `book.sheetnames` also lists chartsheets, and
    a chartsheet holds no cells, so offering one as a tab produces a tab that
    can only fail when clicked. Pandas' ExcelFile.sheet_names read `.worksheets`
    for the same reason. Hidden worksheets stay listed - they do hold data.

    Read straight from openpyxl rather than through polars: polars only exposes
    the sheet list by reading the sheets, and this is called on every metadata
    request purely to populate the tab bar.
    """
    if get_file_type(file_path) != "excel":
        return []
    # Handed an open file rather than a path, for the reason `_read_excel`
    # records, and loaded through the shared `_OPENPYXL_LOAD` so the two sites
    # cannot drift: this one runs FIRST on every metadata request, and both
    # openpyxl's refusal of a .xls path and its external-link walk raise
    # exceptions that are not ValueError, so either 500d here even once the
    # reader opened the same file.
    with open(file_path, "rb") as handle:
        book = openpyxl.load_workbook(handle, **_OPENPYXL_LOAD)
        try:
            return [sheet.title for sheet in book.worksheets]
        finally:
            book.close()


# A line holding nothing but blanks, between two records - or as the very first
# line. `\r?` lets the CRLF form match too. The blank set fills `%s`: space and
# tab in a csv, space alone in a tsv, where a line of tabs is a row of empty
# fields.
_BLANK_LINE = rb"(?:^|\n)[%s]*\r?\n"


def _delimited_source(file_path, delimiter):
    """The path itself, or the file's bytes rewritten, for three shapes polars
    cannot parse and pandas opened.

    Each is detected on the first 64 KB where it is visible there, and the file
    is rewritten only then, so an ordinary file still reaches polars as a path
    - memory-mapped, one pass. The rewritten forms are read from bytes.

    - UTF-16, which is what Excel's "Unicode Text" export writes. Every such
      file carries a NUL byte inside its first header name, and polars' arrow
      FFI panics on it; decoded to UTF-8 it parses like any other. Excel writes
      a BOM; a file without one is told by the NUL in its first two bytes,
      which no single-byte text can carry there, and its position gives the
      byte order.
    - Bare CR line terminators, the classic-Mac and old Excel-for-Mac form.
      Polars ends a line only at LF, so the whole file read as one header row
      with no data under it. Tested after the UTF-16 decode, because Excel 2011
      for Mac wrote both at once.
    - A blank line between records, which polars parsed as a row of nulls where
      pandas skipped it. Removed only when the file holds no quote character at
      all: inside a quoted field a blank line is content, and telling the two
      apart is a full parse. A `,,` row, or a tsv line of tabs alone, is a row
      of empty fields and stays, as pandas kept it; in a csv a tab is a blank.
    """
    with open(file_path, "rb") as fh:
        head = fh.read(65536)
        if head.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
            encoding = "utf-16"
        elif head[:1] == b"\x00":
            encoding = "utf-16-be"
        elif head[1:2] == b"\x00":
            encoding = "utf-16-le"
        else:
            encoding = None
        data = None
        if encoding:
            fh.seek(0)
            data = fh.read().decode(encoding).encode("utf-8")
            head = data[:65536]
        if b"\n" not in head and b"\r" in head:
            if data is None:
                fh.seek(0)
                data = fh.read()
            return data.replace(b"\r", b"\n")
        if data is not None:
            return data
        if not head:
            return file_path
        blanks = b" " if delimiter == "\t" else b" \t"
        with mmap.mmap(fh.fileno(), 0, access=mmap.ACCESS_READ) as mm:
            if mm.find(b'"') == -1 and re.search(_BLANK_LINE % blanks, mm):
                lines = bytes(mm).splitlines(keepends=True)
                return b"".join(
                    line for line in lines if line.strip(blanks + b"\r\n")
                )
    return file_path


def _read_delimited(file_path, delimiter):
    """Read a delimited text file (CSV/TSV) into a PyArrow Table.

    Tries UTF-8 first, falls back to latin1 on a decoding error. Polars reports
    that as ComputeError rather than UnicodeDecodeError, and ComputeError also
    covers genuine parse failures. Nothing is masked - every byte is valid
    latin1, so a non-encoding failure raises again on the retry and propagates -
    but the message the user ends up with is the retry's, which can describe a
    consequence rather than the cause: binary rubbish named .csv reports a field
    count where the truth was the encoding. The retry also pays a second full
    scan, which the read cache amortises to once per file.

    An integer literal of 39 or more digits is the other ComputeError handled
    here: polars infers Int128 for anything at or above 2**63 and raises when a
    literal exceeds it, so `_cast_unsupported_columns_to_string` - which recasts
    Int128 to text - never ran, and the file did not open. The message names
    the column, so the read is retried with that column typed as text; every
    other column keeps its inferred type.

    Column names come from the header row read raw, not from polars' parsed
    names: polars leaves only the FIRST blank header empty and names the rest
    `_duplicated_0`, `_duplicated_1`, and suffixes a repeated header
    `a_duplicated_0`. `_header_names` numbers every blank by position and
    suffixes a repeat `.1`, as pandas did and as the Excel reader already does,
    so a header is named the same whichever file carries it. An empty name is
    not cosmetic: the frontend posts it back for statistics and the handler
    rejects it with a 400.
    """
    source = _delimited_source(file_path, delimiter)
    encoding = "utf8"
    overrides = {}
    while True:
        try:
            df = pl.read_csv(
                source,
                separator=delimiter,
                encoding=encoding,
                infer_schema_length=None,
                null_values=_NULL_STRINGS,
                schema_overrides=overrides or None,
            )
            break
        except ComputeError as e:
            column = _oversized_integer_column(e)
            if column is not None and column not in overrides:
                overrides[column] = pl.String
            elif encoding == "utf8":
                encoding = "latin1"
            else:
                raise
    header = pl.read_csv(
        source,
        separator=delimiter,
        encoding=encoding,
        has_header=False,
        n_rows=1,
        infer_schema=False,
    )
    if header.width == df.width:
        df.columns = _header_names(list(header.row(0)), df.width)
    return _cast_unsupported_columns_to_string(df).to_arrow()


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

    Only sqlite3.Error is mapped here. The pandas arm this replaces also caught
    pandas' own DatabaseError, because pandas re-raised driver errors as its
    own; polars lets sqlite3.Error through untouched. Polars' own failures are
    mapped once for every format in `_read_uncached` rather than per reader.
    """
    try:
        conn = sqlite3.connect(_sqlite_uri(file_path), uri=True)
    except sqlite3.Error as e:
        raise ValueError(f"Cannot open SQLite database: {e}")
    try:
        with closing(conn):
            yield conn
    except sqlite3.Error as e:
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


# Field metadata marking a SQLite column that holds BLOBs. The column is
# served as '<BLOB size>' text, so its Arrow type is string and nothing in the
# values says the cells stand for bytes; this marker is the only record of it.
BINARY_PLACEHOLDER_KEY = b"jl_tabular_binary_placeholder"


def is_binary_placeholder(field):
    """True when a reader served this field as '<BLOB size>' placeholder text."""
    return (field.metadata or {}).get(BINARY_PLACEHOLDER_KEY) == b"1"


# Field metadata carrying the exact blob-size aggregates as a JSON object. The
# placeholder text holds a rounded size ('1.3 KB'), so it cannot answer a
# minimum, a quartile or a byte total - these aggregates can.
BLOB_SIZE_STATS_KEY = b"jl_tabular_blob_size_stats"


def _format_blob_size(size):
    """Bytes in the same B/KB/MB text the placeholder SQL renders."""
    if size < 1024:
        return f"{size:g} B"
    if size < 1048576:
        value, unit = size / 1024.0, "KB"
    else:
        value, unit = size / 1048576.0, "MB"
    text = f"{value:.1f}"
    return f"{text[:-2] if text.endswith('.0') else text} {unit}"


def _blob_size_stats(lengths):
    """Size aggregates and log2 bins for one blob column's exact byte lengths.

    `lengths` is an int64 Arrow array with a null where the cell is NULL, so
    the count and every aggregate describe the non-null cells. Quartiles come
    from pyarrow.quantile. Each bin is one power of two, labelled by its lower
    bound in the same B/KB/MB text the placeholder column shows. An empty blob
    has no log2, so the size is floored at 1 byte and keeps bucket 0.
    """
    valid = pc.drop_null(lengths)
    if len(valid) == 0:
        return None
    quantiles = pc.quantile(valid, q=[0.25, 0.5, 0.75]).to_pylist()
    buckets = pc.cast(
        pc.floor(
            pc.log2(
                pc.cast(
                    pc.max_element_wise(valid, pa.scalar(1, pa.int64())),
                    pa.float64(),
                )
            )
        ),
        pa.int64(),
    )
    value_counts = pc.value_counts(buckets)
    counts = dict(
        zip(
            value_counts.field("values").to_pylist(),
            value_counts.field("counts").to_pylist(),
        )
    )
    low, high = min(counts), max(counts)
    return {
        "count": len(valid),
        "min": float(pc.min(valid).as_py()),
        "q1": float(quantiles[0]),
        "median": float(quantiles[1]),
        "q3": float(quantiles[2]),
        "max": float(pc.max(valid).as_py()),
        "mean": float(pc.mean(valid).as_py()),
        "std_dev": float(pc.stddev(valid).as_py()),
        "total": float(pc.sum(valid).as_py()),
        "bins": [
            {"label": f"<{_format_blob_size(2**bucket)}>", "count": counts.get(bucket, 0)}
            for bucket in range(low, high + 1)
        ],
    }


def _blob_placeholder_sql(name, alias=None):
    """SQL yielding '<BLOB size>' for BLOB cells and the value for everything else.

    `alias` names the result column when it must differ from the source - a
    column declared with an empty name. Left to polars, an unnamed result
    column becomes `column_0`, which collided with a real column of that name
    and made the table unopenable (DEF-SQLITE-13).

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

    Built in SQL rather than in the dataframe layer on purpose. SQLite answers
    LENGTH() on a BLOB from the record header without loading the payload off
    its overflow pages, so the bytes are never read, never reach the reader, and
    never reach the frontend. Doing it in Python meant materialising every BLOB
    in full only to throw it away - 410 MB per request on a real database.
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
        f" ELSE {col} END AS {_quote_ident(alias or name)}"
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
        # SQLite allows a column declared with an empty name. Numbered by
        # position as the other readers number a blank header; a table cannot
        # repeat a name, so the suffix branch of `_header_names` never fires.
        names = _header_names(columns, len(columns))
        # typeof() answers from the value's storage class without reading the
        # BLOB payload off its overflow pages, so every column is probed in one
        # pass here and the bytes are never materialised.
        probes = ", ".join(
            f"max(typeof({_quote_ident(column)}) = 'blob')" for column in columns
        )
        row = conn.execute(f"SELECT {probes} FROM {ident}").fetchone()
        blob_columns = {name for name, flag in zip(names, row) if flag}
        select_list = ", ".join(
            _blob_placeholder_sql(column, name)
            for column, name in zip(columns, names)
        )
        # infer_schema_length=None is load-bearing: SQLite columns carry a
        # storage class per value, not per column, so a column of integers with
        # a string at row 201 raises ComputeError under the default 100-row
        # window. Scanning every row is what makes it resolve to string, which
        # is the behaviour `mixed_types` in the fixture exists to pin.
        df = pl.read_database(
            f"SELECT {select_list} FROM {ident}", conn, infer_schema_length=None
        )
        # Exact byte lengths for each blob column. length() answers from the
        # record header for a BLOB, so the payload is never loaded; the int64
        # array feeds the quantiles and the log2 histogram in stats.py. The
        # typeof filter keeps a mixed-affinity column's text and numeric cells
        # out: length() counts their characters and digits, not bytes.
        blob_size_stats = {}
        for column, name in zip(columns, names):
            if name in blob_columns:
                lengths = pa.array(
                    [
                        length
                        for (length,) in conn.execute(
                            f"SELECT length({_quote_ident(column)}) FROM {ident}"
                            f" WHERE typeof({_quote_ident(column)}) = 'blob'"
                        )
                    ],
                    type=pa.int64(),
                )
                blob_size_stats[name] = _blob_size_stats(lengths)
    # A column that is NULL in every row comes back Null-typed, which has no
    # arrow kernels - column statistics raise ArrowNotImplementedError, not a
    # ValueError, so the request 500s. SQLite is where a wholly-NULL column is
    # most common, so the same cast the two text readers apply belongs here.
    table = _cast_unsupported_columns_to_string(df).to_arrow()
    if blob_columns:
        schema = table.schema
        for index, field in enumerate(schema):
            if field.name in blob_columns:
                metadata = {**(field.metadata or {}), BINARY_PLACEHOLDER_KEY: b"1"}
                size_stats = blob_size_stats.get(field.name)
                if size_stats is not None:
                    metadata[BLOB_SIZE_STATS_KEY] = json.dumps(size_stats).encode()
                schema = schema.set(index, field.with_metadata(metadata))
        table = table.cast(schema)
    return table


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


def _json_text(value):
    """One nested cell as JSON text; bytes as hex, as a top-level binary is.

    Non-ASCII characters are kept as written. Escaped to `\\u00fc`, a text
    filter for the word found nothing and every export carried the escapes.
    """
    return json.dumps(
        value,
        ensure_ascii=False,
        default=lambda o: o.hex() if isinstance(o, bytes) else str(o),
    )


def _served_type(arrow_type):
    """The type a parquet column is served as.

    Parquet returns before the polars readers' dispatch, so the policy
    `_cast_unsupported_columns_to_string` applies to their columns is applied
    here, for the column types arrow has no kernels for:

    - null. A column that is null in every row arrives as arrow `null`, and
      column statistics on it raise ArrowNotImplementedError, a 500. Served as
      text, as pandas' parquet reader and the old cascade typed it.
    - dictionary. A column written from a pandas Categorical has no
      count_distinct, sort_indices or equal kernel, and the frontend's
      numeric-type test matched the `int8` inside the type name (DEF-LOAD-24).
      Served as its value type.
    - list, struct, map and union. No sort, cast-to-text or count_distinct
      kernel, so a header sort, a text filter, statistics and unique values each
      answered 500. Served as JSON text - the form the grid already displayed.

    The metadata handler passes the file's own schema through here too, so the
    type it reports is the type the rows carry.
    """
    if pa.types.is_dictionary(arrow_type):
        return arrow_type.value_type
    if pa.types.is_null(arrow_type) or pa.types.is_nested(arrow_type):
        return pa.string()
    return arrow_type


def _read_uncached(file_path, sheet):
    """Dispatch to the per-format reader. See `read_as_arrow_table`.

    Every polars failure is mapped to ValueError here, in one place, because the
    handlers map ValueError to HTTP 400 and everything else to 500 with the
    traceback in the body. No polars exception subclasses ValueError - unlike
    the pandas errors they replace, where ParserError and EmptyDataError both
    did - so without this a 0-byte csv, a row with too many fields, or an empty
    worksheet each turned a 400 into a 500. PolarsError is the base of
    ComputeError and NoDataError, so one arm covers the family.

    pyarrow needs no such arm: ArrowInvalid already is a ValueError.
    """
    ft = get_file_type(file_path)
    if ft == "parquet":
        table = pq.read_table(file_path)
        for index, field in enumerate(table.schema):
            served = _served_type(field.type)
            if served == field.type:
                continue
            column = table.column(index)
            if pa.types.is_nested(field.type):
                # arrow has no cast from a nested type to string
                values = column.to_pylist()
                column = pa.array(
                    [None if v is None else _json_text(v) for v in values], pa.string()
                )
            else:
                column = column.cast(served)
            table = table.set_column(index, field.name, column)
        return table
    try:
        if ft == "excel":
            return _read_excel(file_path, sheet)
        if ft == "sqlite":
            return _read_sqlite(file_path, sheet)
        if ft == "csv":
            return _read_delimited(file_path, ",")
        if ft == "tsv":
            return _read_delimited(file_path, "\t")
    except PolarsError as e:
        # Polars appends a hint addressed to its own caller after a blank line
        # ("Consider setting 'truncate_ragged_lines=True'"), which nobody
        # reading the 400 can act on.
        message = str(e).split("\n\n")[0]
        raise ValueError(f"Cannot read {ft} file: {message}")
    except PanicException as e:
        # A Rust panic reaches Python as a direct BaseException subclass, so the
        # handlers' `except Exception` would let it escape and the client got a
        # closed connection with no status and no body. This is reachable, not
        # hypothetical: a NUL byte anywhere in a header name panics in polars'
        # arrow FFI, and every UTF-16-encoded csv has one - which is what Excel's
        # own "Unicode Text" export produces.
        raise ValueError(f"Cannot read {ft} file: {e}")
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

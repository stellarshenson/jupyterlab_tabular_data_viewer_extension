"""File readers for tabular formats with cascading type inference.

Reads parquet/excel/csv/tsv files into PyArrow tables. Object columns with
mixed types (e.g. integers mixed with strings) fall back to string when
native PyArrow inference fails, so the viewer can still display them.
"""

import os

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq


def get_file_type(file_path):
    """Determine file type based on extension"""
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


def _read_excel(file_path):
    """Read first worksheet of an Excel file into a PyArrow Table"""
    df = pd.read_excel(file_path, sheet_name=0, engine="openpyxl")
    return _df_to_arrow(df)


def _read_delimited(file_path, delimiter):
    """Read a delimited text file (CSV/TSV) into a PyArrow Table.

    Tries UTF-8 first, falls back to latin1 on decoding errors.
    """
    try:
        df = pd.read_csv(file_path, delimiter=delimiter, encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(file_path, delimiter=delimiter, encoding="latin1")
    return _df_to_arrow(df)


def read_as_arrow_table(file_path):
    """Read a tabular file (parquet/excel/csv/tsv) into a PyArrow Table.

    Raises ValueError for unsupported file types so callers can map the error
    to an HTTP 400 response.
    """
    ft = get_file_type(file_path)
    if ft == "parquet":
        return pq.read_table(file_path)
    if ft == "excel":
        return _read_excel(file_path)
    if ft == "csv":
        return _read_delimited(file_path, ",")
    if ft == "tsv":
        return _read_delimited(file_path, "\t")
    raise ValueError(f"Unsupported file type: {ft}")

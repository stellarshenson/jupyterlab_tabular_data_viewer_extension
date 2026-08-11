import json
import math
import os
import re
from pathlib import Path
from datetime import date, datetime
from decimal import Decimal

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
import polars as pl
import polars.selectors as cs

# Bound at import rather than resolved inside the `except` clause below, where
# an AttributeError would fire while the original exception was propagating and
# take out the very handler that arm exists to keep alive.
from polars.exceptions import PanicException
import pyarrow.parquet as pq
import pyarrow.compute as pc
import pyarrow as pa

from .readers import (
    get_file_type,
    list_excel_sheets,
    list_sqlite_tables,
    read_as_arrow_table,
)
from .stats import calculate_column_stats, json_safe, numeric_view


def slugify(s):
    """Lowercase, collapse non-alphanumerics to underscore, strip edges.

    Used to embed sheet names in download filenames safely.
    """
    return re.sub(r"[^a-z0-9]+", "_", (s or "").lower()).strip("_") or "sheet"


# The Excel grid. A worksheet holds 1,048,576 rows including the header row and
# 16,384 columns; one past either, xlsxwriter writes a single cell instead.
_XLSX_MAX_ROWS = 1_048_576
_XLSX_MAX_COLUMNS = 16_384


def _numeric_scalar(filter_value, column_type):
    """A comparison scalar in the COLUMN's type, not a bare python float.

    `pc.greater(uint64_column, 100.0)` makes pyarrow promote the column to
    double, and it refuses outright when a value exceeds a double's exact
    integer range - `ArrowInvalid: Integer value 9223372036854775808 not in
    range`. ArrowInvalid is a ValueError, so the arm meant for a non-numeric
    entry swallowed it and the filter silently matched every row. Building the
    scalar in the column's own type compares exactly and never promotes.

    Raises ValueError when the entry is not a number, which is the caller's
    signal that there is no predicate to add.
    """
    text = str(filter_value).strip()
    if pa.types.is_integer(column_type):
        try:
            return pa.scalar(int(text), column_type)
        except (ValueError, OverflowError, pa.ArrowInvalid):
            # A decimal entry against an integer column, or one outside the
            # column type's range: fall through to a float comparison, which
            # pyarrow can still answer for an in-range integer column.
            pass
    return float(text)


def _sort_indices(table, sort_by, sort_order):
    """Sort indices for one column, numerically when a text column holds numbers.

    A worksheet cell can hold a number as text, so the column is a string column
    and stays one - forcing it numeric would strip a zip code's leading zeros.
    Sorting it as text puts 10 before 2, which is the wrong answer for the same
    values. Sorting on `numeric_view`'s reading of the column gives the numeric
    order while the stored, displayed and exported values remain the text the
    file holds. Both the grid and the export sort through here, so a downloaded
    file is ordered exactly as the grid showed it.
    """
    direction = "ascending" if sort_order == "asc" else "descending"
    numeric = numeric_view(table.column(sort_by))
    if numeric is not None:
        return pc.sort_indices(
            pa.table({sort_by: numeric}), sort_keys=[(sort_by, direction)]
        )
    return pc.sort_indices(table, sort_keys=[(sort_by, direction)])


def _uniquify_headers_for_excel(df):
    """Suffix column names that collide case-insensitively, for the xlsx writer.

    `write_excel` writes through xlsxwriter's `add_table`, which requires
    case-insensitively unique headers: given `ID` and `id` it warns and returns
    before writing the header row or a single value, so the export was a valid
    workbook holding one cell and the whole table was gone - at HTTP 200, with
    the correct content type. Pandas wrote a plain sheet and had no such rule.

    Renames follow pandas' duplicate-header convention (`.1`, `.2`), so only the
    exported header differs and no cell value is touched. The grid, and every
    other export format, keep the original names.

    A candidate is rejected if any OTHER column already carries it, not merely if
    an earlier one took it - the rule `_header_names` documents for the same
    convention. Without it, `ID, id, id.1` renamed `id` to the `id.1` the frame
    already had, so two columns shipped under labels belonging to other columns.
    """
    taken = {name.lower() for name in df.columns}
    seen = set()
    renames = {}
    for name in df.columns:
        candidate, suffix = name, 0
        while candidate.lower() in seen or (
            candidate != name and candidate.lower() in taken
        ):
            suffix += 1
            candidate = f"{name}.{suffix}"
        seen.add(candidate.lower())
        if candidate != name:
            renames[name] = candidate
    return df.rename(renames) if renames else df


# A double holds every integer up to 2**53 exactly and no more. Javascript has
# only doubles, so `JSON.parse` silently rounds anything past this: a uint64
# snowflake id 9223372036854775808 reached the grid as 9223372036854776000.
_JS_EXACT_INTEGER = 2**53
INF = math.inf


def convert_to_json_serializable(value):
    """Convert Python objects to JSON-serializable types"""
    if value is None:
        return None
    elif isinstance(value, bool):
        return value
    elif isinstance(value, int) and abs(value) > _JS_EXACT_INTEGER:
        # Sent as a string so the browser cannot round it. The column keeps its
        # integer type, so sorting, filtering and statistics stay numeric; only
        # the wire form of these particular values changes, and it is the only
        # form in which they survive the trip.
        return str(value)
    elif isinstance(value, float) and (value != value or value in (INF, -INF)):
        # NaN and +/-Infinity are not JSON. Python emits them as bare literals
        # that `JSON.parse` rejects, so one such cell made the whole response
        # unparseable and the panel reported a load failure for the column.
        return None
    elif isinstance(value, (date, datetime)):
        return value.isoformat()
    elif isinstance(value, Decimal):
        return float(value)
    elif isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    elif isinstance(value, (list, tuple)):
        # Convert list/tuple to JSON string for display
        return json.dumps(value)
    elif isinstance(value, dict):
        # Convert dict to JSON string for display
        return json.dumps(value)
    else:
        return value


def normalize_arrow_type(arrow_type_str):
    """Normalize PyArrow type strings for user-friendly display.

    Maps internal/optimized types like string_view, large_string to their
    base equivalents (e.g. string, binary).
    """
    type_map = {
        "string_view": "string",
        "binary_view": "binary",
        "large_string": "string",
        "large_binary": "binary",
        "large_utf8": "string",
        # Parquet metadata is answered from `schema_arrow`, which is the file's
        # own schema and so never sees the reader's recast of an all-null column
        # to string. Without this the badge and the filter type came from `null`
        # while the statistics for the same column said `string`.
        "null": "string",
    }
    return type_map.get(arrow_type_str, arrow_type_str)


class ParquetMetadataHandler(APIHandler):
    """Handler for getting Parquet file metadata (columns, types, row count)"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get("path", "")
            sheet = input_data.get("sheet")

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({"error": "No file path provided"}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get("contents_manager")
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(f"Processing request for: {file_path}")
            self.log.debug(f"Root dir: {root_dir}")

            full_path = os.path.join(root_dir, file_path.lstrip("/"))
            abs_path = Path(full_path).resolve()

            self.log.debug(f"Full path: {full_path}")
            self.log.debug(f"Resolved path: {abs_path}")
            self.log.debug(f"File exists: {abs_path.exists()}")

            if not abs_path.exists():
                self.set_status(404)
                self.finish(
                    json.dumps(
                        {
                            "error": f"File not found: {file_path} (resolved to {abs_path})"
                        }
                    )
                )
                return

            # Detect file type. Tabbed formats populate `sheets`: Excel with
            # its worksheet names, SQLite with its user table names.
            #
            # Listing and reading share one 400 boundary: an unreadable file
            # (corrupt database, locked by a writer, unsupported type) raises
            # ValueError from whichever call reaches it first, and pyarrow's
            # ArrowInvalid is itself a ValueError, so a damaged parquet lands
            # here too instead of escaping as a 500 with a traceback.
            file_type = get_file_type(str(abs_path))
            try:
                if file_type == "excel":
                    sheets = list_excel_sheets(str(abs_path))
                elif file_type == "sqlite":
                    sheets = list_sqlite_tables(str(abs_path))
                else:
                    sheets = []

                if file_type == "parquet":
                    # Parquet has a metadata-only fast path - no need to read data
                    parquet_file = pq.ParquetFile(str(abs_path))
                    schema = parquet_file.schema_arrow
                    total_rows = parquet_file.metadata.num_rows
                else:
                    # Resolve the default sheet here rather than letting the
                    # reader do it. The frontend omits `sheet` on this first
                    # call and sends the resolved name on every later one, so
                    # leaving it None caches the same table under two keys -
                    # on a tabbed source that is the first table held twice.
                    # Canonicalising here only holds while this handler runs
                    # BEFORE the four that pass `sheet` through untouched
                    # (`src/widget.ts` sets the active sheet from the metadata
                    # response before requesting rows); a client that asked for
                    # rows first would still cache the default twice.
                    table = read_as_arrow_table(
                        str(abs_path), sheet or (sheets[0] if sheets else None)
                    )
                    schema = table.schema
                    total_rows = len(table)
            except ValueError as e:
                self.set_status(400)
                self.finish(json.dumps({"error": str(e)}))
                return

            # Extract column information
            columns = []
            for i in range(len(schema)):
                field = schema.field(i)
                columns.append(
                    {
                        "name": field.name,
                        "type": normalize_arrow_type(str(field.type)),
                    }
                )

            # Get file size
            file_size = abs_path.stat().st_size

            self.finish(
                json.dumps(
                    {
                        "columns": columns,
                        "totalRows": total_rows,
                        "fileSize": file_size,
                        "sheets": sheets,
                        "sourceType": file_type,
                    }
                )
            )

        except Exception as e:
            import traceback

            error_traceback = traceback.format_exc()
            self.log.error(f"Handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(
                json.dumps(
                    {
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "traceback": error_traceback,
                    }
                )
            )


class ParquetDataHandler(APIHandler):
    """Handler for reading Parquet file data with pagination and filtering"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get("path", "")
            offset = input_data.get("offset", 0)
            limit = input_data.get("limit", 500)
            filters = input_data.get("filters", {})
            sort_by = input_data.get("sortBy", None)
            sort_order = input_data.get("sortOrder", "asc")
            case_insensitive = input_data.get("caseInsensitive", False)
            use_regex = input_data.get("useRegex", False)
            sheet = input_data.get("sheet")

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({"error": "No file path provided"}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get("contents_manager")
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(
                f"Data request for: {file_path} (offset={offset}, limit={limit})"
            )
            self.log.debug(f"Root dir: {root_dir}")

            full_path = os.path.join(root_dir, file_path.lstrip("/"))
            abs_path = Path(full_path).resolve()

            self.log.debug(f"Full path: {full_path}")
            self.log.debug(f"Resolved path: {abs_path}")
            self.log.debug(f"File exists: {abs_path.exists()}")

            if not abs_path.exists():
                self.set_status(404)
                self.finish(
                    json.dumps(
                        {
                            "error": f"File not found: {file_path} (resolved to {abs_path})"
                        }
                    )
                )
                return

            # Detect file type and read accordingly
            file_type = get_file_type(str(abs_path))
            self.log.debug(f"Reading {file_type} file: {abs_path}")

            # The whole table is read even though only a page is returned; a
            # SQL LIMIT/OFFSET window was tried and reverted. See DEF-3 in
            # docs/defects.md.
            try:
                table = read_as_arrow_table(str(abs_path), sheet)
            except ValueError as e:
                self.set_status(400)
                self.finish(json.dumps({"error": str(e)}))
                return

            # Add original row index column (1-indexed for display)
            original_indices = pa.array(range(1, len(table) + 1))
            table = table.append_column("__original_row_index__", original_indices)

            # Apply filters if provided
            if filters:
                filter_expressions = []
                for col_name, filter_spec in filters.items():
                    if col_name not in table.column_names:
                        continue

                    filter_type = filter_spec.get("type", "text")
                    filter_value = filter_spec.get("value", "")

                    if not filter_value:
                        continue

                    column = table.column(col_name)

                    if filter_type == "text":
                        # Cast column to string for text filtering (handles both string and numeric columns)
                        column_str = pc.cast(column, pa.string())

                        # Replace null values with "(null)" for consistent filtering
                        column_str = pc.fill_null(column_str, "(null)")

                        if use_regex:
                            # Use regex matching when enabled
                            try:
                                filter_expressions.append(
                                    pc.match_substring_regex(
                                        column_str,
                                        filter_value,
                                        ignore_case=case_insensitive,
                                    )
                                )
                            except Exception:
                                # Fall back to simple substring matching if regex is invalid
                                filter_expressions.append(
                                    pc.match_substring(
                                        column_str,
                                        filter_value,
                                        ignore_case=case_insensitive,
                                    )
                                )
                        else:
                            # Use simple substring matching by default
                            filter_expressions.append(
                                pc.match_substring(
                                    column_str,
                                    filter_value,
                                    ignore_case=case_insensitive,
                                )
                            )
                    elif filter_type == "number":
                        operator = filter_spec.get("operator", "=")
                        try:
                            numeric_value = _numeric_scalar(filter_value, column.type)
                        except ValueError:
                            continue

                        kernel = {
                            ">": pc.greater,
                            "<": pc.less,
                            ">=": pc.greater_equal,
                            "<=": pc.less_equal,
                            "=": pc.equal,
                        }.get(operator)
                        if kernel is not None:
                            # Same reasoning as the grid handler: the kernel's
                            # own refusal must not be mistaken for a
                            # non-numeric entry, or the download ships the whole
                            # table under a `_filtered` filename.
                            filter_expressions.append(kernel(column, numeric_value))

                if filter_expressions:
                    combined_filter = filter_expressions[0]
                    for expr in filter_expressions[1:]:
                        combined_filter = pc.and_(combined_filter, expr)

                    table = table.filter(combined_filter)

            # Apply sorting if requested
            if sort_by and sort_by in table.column_names:
                indices = _sort_indices(table, sort_by, sort_order)
                table = pc.take(table, indices)

            # Get total filtered rows
            total_filtered_rows = len(table)

            # Apply pagination
            end = min(offset + limit, len(table))
            table_slice = table.slice(offset, end - offset)

            # Convert to list of dictionaries with JSON-serializable values
            data = []
            for i in range(len(table_slice)):
                row = {}
                original_row_idx = None
                for col_name in table_slice.column_names:
                    value = table_slice.column(col_name)[i].as_py()
                    # Store original row index separately, don't include it in row data
                    if col_name == "__original_row_index__":
                        original_row_idx = value
                    else:
                        row[col_name] = convert_to_json_serializable(value)
                # Add original row index as metadata
                row["__row_index__"] = original_row_idx
                data.append(row)

            self.finish(
                json.dumps(
                    {
                        "data": data,
                        "offset": offset,
                        "limit": limit,
                        "totalRows": total_filtered_rows,
                        "hasMore": end < total_filtered_rows,
                    }
                )
            )

        except Exception as e:
            import traceback

            error_traceback = traceback.format_exc()
            self.log.error(f"Handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(
                json.dumps(
                    {
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "traceback": error_traceback,
                    }
                )
            )


class ColumnStatsHandler(APIHandler):
    """Handler for calculating column statistics"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get("path", "")
            column_name = input_data.get("columnName", "")
            sheet = input_data.get("sheet")

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({"error": "No file path provided"}))
                return

            if not column_name:
                self.set_status(400)
                self.finish(json.dumps({"error": "No column name provided"}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get("contents_manager")
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(
                f"Stats request for column '{column_name}' in file: {file_path}"
            )

            full_path = os.path.join(root_dir, file_path.lstrip("/"))
            abs_path = Path(full_path).resolve()

            if not abs_path.exists():
                self.set_status(404)
                self.finish(json.dumps({"error": f"File not found: {file_path}"}))
                return

            # Detect file type and read accordingly
            try:
                table = read_as_arrow_table(str(abs_path), sheet)
            except ValueError as e:
                self.set_status(400)
                self.finish(json.dumps({"error": str(e)}))
                return

            # Calculate statistics
            stats = json_safe(calculate_column_stats(table, column_name))

            self.finish(json.dumps(stats))

        except ValueError as e:
            # Column not found or other validation error
            self.set_status(400)
            self.finish(json.dumps({"error": str(e)}))
        except Exception as e:
            import traceback

            error_traceback = traceback.format_exc()
            self.log.error(f"Stats handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e), "error_type": type(e).__name__}))


class UniqueValuesHandler(APIHandler):
    """Handler for fetching unique values from a column"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get("path", "")
            column_name = input_data.get("columnName", "")
            sheet = input_data.get("sheet")

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({"error": "No file path provided"}))
                return

            if not column_name:
                self.set_status(400)
                self.finish(json.dumps({"error": "No column name provided"}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get("contents_manager")
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(
                f"Unique values request for column '{column_name}' in file: {file_path}"
            )

            full_path = os.path.join(root_dir, file_path.lstrip("/"))
            abs_path = Path(full_path).resolve()

            if not abs_path.exists():
                self.set_status(404)
                self.finish(json.dumps({"error": f"File not found: {file_path}"}))
                return

            # Detect file type and read accordingly
            try:
                table = read_as_arrow_table(str(abs_path), sheet)
            except ValueError as e:
                self.set_status(400)
                self.finish(json.dumps({"error": str(e)}))
                return

            # Check if column exists
            if column_name not in table.column_names:
                self.set_status(400)
                self.finish(
                    json.dumps({"error": f'Column "{column_name}" not found in file'})
                )
                return

            # Get column
            column = table.column(column_name)

            # Cast to string to handle all types uniformly
            column_str = pc.cast(column, pa.string())

            # Replace null values with the string "(null)" for consistent handling
            column_str = pc.fill_null(column_str, "(null)")

            # Get limit from request (default to 100 if not provided)
            limit = input_data.get("limit", 100)

            # Get value counts
            value_counts = pc.value_counts(column_str)

            # value_counts returns a StructArray with 'values' and 'counts' fields
            values_array = value_counts.field("values")
            counts_array = value_counts.field("counts")

            # Combine into list of tuples
            value_count_pairs = list(
                zip(values_array.to_pylist(), counts_array.to_pylist())
            )

            # Sort by count (frequency) descending - most frequent first
            value_count_pairs.sort(key=lambda x: x[1], reverse=True)

            # Limit the results
            total_unique = len(value_count_pairs)
            if limit > 0:
                value_count_pairs = value_count_pairs[:limit]

            # Separate back into values and counts
            values_list = [v for v, c in value_count_pairs]
            counts_list = [c for v, c in value_count_pairs]

            result = {
                "values": values_list,
                "counts": counts_list,
                "limit": limit,
                "total_count": total_unique,
            }

            self.finish(json.dumps(result))

        except ValueError as e:
            # Column not found or other validation error
            self.set_status(400)
            self.finish(json.dumps({"error": str(e)}))
        except Exception as e:
            import traceback

            error_traceback = traceback.format_exc()
            self.log.error(f"Unique values handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e), "error_type": type(e).__name__}))


class DownloadHandler(APIHandler):
    """Handler for downloading filtered and sorted data in specified format"""

    @tornado.web.authenticated
    def get(self):
        try:
            file_path = self.get_argument("path", "")
            download_format = self.get_argument(
                "format", "original"
            )  # 'original', 'xlsx', 'csv', 'parquet', 'jsonl'
            filters_json = self.get_argument("filters", "{}")
            sort_by = self.get_argument("sortBy", None)
            sort_order = self.get_argument("sortOrder", "asc")
            case_insensitive = self.get_argument("caseInsensitive", "false") == "true"
            use_regex = self.get_argument("useRegex", "false") == "true"
            sheet = self.get_argument("sheet", None) or None

            filters = json.loads(filters_json) if filters_json else {}

            if not file_path:
                self.set_status(400)
                self.finish("No file path provided")
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get("contents_manager")
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            full_path = os.path.join(root_dir, file_path.lstrip("/"))
            abs_path = Path(full_path).resolve()

            if not abs_path.exists():
                self.set_status(404)
                self.finish(f"File not found: {file_path}")
                return

            # Detect source file type and read accordingly
            file_type = get_file_type(str(abs_path))
            original_filename = abs_path.name
            name_parts = os.path.splitext(original_filename)
            base_filename = name_parts[0]
            source_ext = name_parts[1]

            # Map requested download format to internal output format + extension
            format_map = {
                "original": (file_type, source_ext),
                "xlsx": ("excel", ".xlsx"),
                "csv": ("csv", ".csv"),
                "parquet": ("parquet", ".parquet"),
                "jsonl": ("jsonl", ".jsonl"),
            }
            if download_format not in format_map:
                self.set_status(400)
                self.finish(f"Invalid format: {download_format}")
                return
            output_format, output_ext = format_map[download_format]

            # Build filename: <base>[_<slug>][_filtered].<ext>
            # Slug is appended only when a sheet is active (a multi-sheet
            # Excel worksheet, or a SQLite table).
            # `_filtered` is appended only when filters are non-empty; sort
            # order alone does not trigger it.
            parts = [base_filename]
            if sheet:
                parts.append(slugify(sheet))
            if filters:
                parts.append("filtered")
            output_filename = "_".join(parts) + output_ext

            try:
                table = read_as_arrow_table(str(abs_path), sheet)
            except ValueError as e:
                self.set_status(400)
                self.finish(str(e))
                return

            # Apply filters if provided (same logic as ParquetDataHandler)
            if filters:
                filter_expressions = []
                for col_name, filter_spec in filters.items():
                    if col_name not in table.column_names:
                        continue

                    filter_type = filter_spec.get("type", "text")
                    filter_value = filter_spec.get("value", "")

                    if not filter_value:
                        continue

                    column = table.column(col_name)

                    if filter_type == "text":
                        column_str = pc.cast(column, pa.string())
                        column_str = pc.fill_null(column_str, "(null)")

                        if use_regex:
                            try:
                                filter_expressions.append(
                                    pc.match_substring_regex(
                                        column_str,
                                        filter_value,
                                        ignore_case=case_insensitive,
                                    )
                                )
                            except Exception:
                                filter_expressions.append(
                                    pc.match_substring(
                                        column_str,
                                        filter_value,
                                        ignore_case=case_insensitive,
                                    )
                                )
                        else:
                            filter_expressions.append(
                                pc.match_substring(
                                    column_str,
                                    filter_value,
                                    ignore_case=case_insensitive,
                                )
                            )
                    elif filter_type == "number":
                        operator = filter_spec.get("operator", "=")
                        try:
                            numeric_value = float(filter_value)

                            if operator == ">":
                                filter_expressions.append(
                                    pc.greater(column, numeric_value)
                                )
                            elif operator == "<":
                                filter_expressions.append(
                                    pc.less(column, numeric_value)
                                )
                            elif operator == ">=":
                                filter_expressions.append(
                                    pc.greater_equal(column, numeric_value)
                                )
                            elif operator == "<=":
                                filter_expressions.append(
                                    pc.less_equal(column, numeric_value)
                                )
                            elif operator == "=":
                                filter_expressions.append(
                                    pc.equal(column, numeric_value)
                                )
                        except ValueError:
                            pass

                if filter_expressions:
                    combined_filter = filter_expressions[0]
                    for expr in filter_expressions[1:]:
                        combined_filter = pc.and_(combined_filter, expr)

                    table = table.filter(combined_filter)

            # Apply sorting if requested
            if sort_by and sort_by in table.column_names:
                indices = _sort_indices(table, sort_by, sort_order)
                table = pc.take(table, indices)

            # Numeric buffers are shared with the arrow table rather than
            # copied; string columns are converted, because polars' String is a
            # view type. Still cheaper than the pandas call it replaces, which
            # copied everything.
            df = pl.from_arrow(table)

            if output_format != "parquet":
                # Binary is writable only by the parquet writer: the csv writer
                # raises ComputeError, the xlsx writer TypeError, and
                # write_ndjson panics in Rust - see the PanicException arm at
                # the bottom of this method for why a panic needs its own.
                #
                # Hex, not a decode. Casting to String is a strict UTF-8 decode,
                # and a real BLOB is image bytes or a hash, so it raised
                # ComputeError on exactly the payloads worth exporting. Hex
                # never raises, is lossless and is stable across formats. It
                # matches neither of pandas' two behaviours - pandas wrote the
                # Python repr b'...' to csv/tsv/xlsx and raised
                # UnicodeDecodeError on jsonl - and the changelog says so.
                df = df.with_columns(cs.binary().bin.encode("hex"))

            # Export based on requested output format.
            # NB: APIHandler.finish() overrides Content-Type to application/json
            # unless the caller passes `set_content_type=`. We compute the
            # body + content_type per branch then call finish() once.
            import io

            if output_format == "parquet":
                buffer = io.BytesIO()
                df.write_parquet(buffer)
                buffer.seek(0)
                body: bytes = buffer.read()
                content_type = "application/octet-stream"
            elif output_format == "excel":
                buffer = io.BytesIO()
                # Restore the General number format pandas wrote. Without this
                # polars applies '#,##0.000;[Red]-#,##0.000', which displays a
                # float rounded to 3 decimals with red negatives - the stored
                # value stays exact, but the sheet does not show it.
                #
                # Keyed per column rather than per dtype: `dtype_formats` needs
                # an exact dtype and polars seeds every integer and float WIDTH
                # separately, so naming Int64 and Float64 left Int32, UInt32 and
                # Float32 on polars' format. `column_formats` is consulted ahead
                # of the dtype defaults, so it covers every width and leaves the
                # date and time formats alone. The sheet also carries a defined
                # table object, which is not suppressible here.
                df = _uniquify_headers_for_excel(df)
                # Excel stores every number as a double, so an integer past
                # 2**53 is written rounded - a uint64 id came out as
                # 9.223372036854776e+18 while the csv export of the same file
                # kept every digit. Such a column is written as text, which is
                # exact and is what the previous release produced for it.
                too_wide = [
                    name
                    for name, dtype in df.schema.items()
                    if dtype.is_integer()
                    and (
                        (df[name].max() or 0) > _JS_EXACT_INTEGER
                        or (df[name].min() or 0) < -_JS_EXACT_INTEGER
                    )
                ]
                if too_wide:
                    df = df.cast({name: pl.String for name in too_wide})
                # A frame one column past the grid is written as a single cell:
                # add_table fails its dimension check and returns without writing
                # a header or a value, silently, and the 200 carries an almost
                # empty workbook. Measured - 16384 columns write in full, 16385
                # yields A1:A1, and only 16386 raises. The row limit truncates the
                # same way. A 400 naming the limit is the honest answer, and a
                # spreadsheet cannot hold this data in any case.
                if df.width > _XLSX_MAX_COLUMNS or df.height + 1 > _XLSX_MAX_ROWS:
                    # Reported the way this handler reports its other client
                    # error: inline, not raised - the arm below maps everything
                    # it catches to 500, and this is the caller's data, not a
                    # server fault.
                    self.set_status(400)
                    self.finish(
                        f"{df.height} rows x {df.width} columns does not fit an "
                        f"Excel worksheet (limit {_XLSX_MAX_ROWS - 1} rows x "
                        f"{_XLSX_MAX_COLUMNS} columns) - export CSV or Parquet "
                        "instead"
                    )
                    return
                df.write_excel(
                    buffer,
                    autofilter=False,
                    column_formats={
                        name: "General"
                        for name, dtype in df.schema.items()
                        if dtype.is_numeric()
                    },
                )
                buffer.seek(0)
                body = buffer.read()
                content_type = (
                    "application/vnd.openxmlformats-officedocument."
                    "spreadsheetml.sheet"
                )
            elif output_format == "csv":
                body = df.write_csv().encode("utf-8")
                content_type = "text/csv"
            elif output_format == "tsv":
                body = df.write_csv(separator="\t").encode("utf-8")
                content_type = "text/tab-separated-values"
            elif output_format == "jsonl":
                # No ASCII escaping, null for missing values. NOT byte-identical
                # to the pandas call this replaces: polars writes floats at
                # round-trip precision where pandas truncated to 10 significant
                # digits, renders a date32 as '2023-02-25' rather than
                # '2023-02-25T00:00:00.000', renders a timestamp with a space
                # instead of a 'T', and does not escape '/'. Polars is the more
                # faithful of the two; the differences are listed in the
                # changelog because they change exported bytes.
                body = df.write_ndjson().encode("utf-8")
                content_type = "application/x-ndjson"
            else:
                self.set_status(400)
                self.finish(f"Unhandled output format: {output_format}")
                return

            self.set_header(
                "Content-Disposition", f'attachment; filename="{output_filename}"'
            )
            self.write(body)
            self.finish(set_content_type=content_type)
            return

        except (Exception, PanicException) as e:
            # PanicException needs naming explicitly: a Rust panic reaches
            # Python as a direct BaseException subclass, so `except Exception`
            # alone let it escape the handler and the client got a closed
            # connection with no status and no body - nothing the frontend can
            # report. Naming the class is not a blanket BaseException arm:
            # KeyboardInterrupt and SystemExit are siblings of PanicException,
            # not subclasses, so both still propagate.
            #
            # Two shapes reach a panic today. A decimal256 column panics inside
            # `pl.from_arrow` before any format branch, so it kills all five
            # formats (DEF-8), and a Binary column nested in a List or Struct is
            # not matched by the top-level hex cast above and panics in
            # write_ndjson (DEF-9). Both are now a plain 500 with a message.
            import traceback

            error_traceback = traceback.format_exc()
            self.log.error(f"Download handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(f"Error downloading file: {str(e)}")


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    metadata_pattern = url_path_join(
        base_url, "jupyterlab-tabular-data-viewer-extension", "metadata"
    )
    data_pattern = url_path_join(
        base_url, "jupyterlab-tabular-data-viewer-extension", "data"
    )
    stats_pattern = url_path_join(
        base_url, "jupyterlab-tabular-data-viewer-extension", "column-stats"
    )
    unique_values_pattern = url_path_join(
        base_url, "jupyterlab-tabular-data-viewer-extension", "unique-values"
    )
    download_pattern = url_path_join(
        base_url, "jupyterlab-tabular-data-viewer-extension", "download"
    )

    handlers = [
        (metadata_pattern, ParquetMetadataHandler),
        (data_pattern, ParquetDataHandler),
        (stats_pattern, ColumnStatsHandler),
        (unique_values_pattern, UniqueValuesHandler),
        (download_pattern, DownloadHandler),
    ]

    web_app.add_handlers(host_pattern, handlers)

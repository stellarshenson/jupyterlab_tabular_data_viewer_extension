import json
import os
from pathlib import Path
from datetime import date, datetime
from decimal import Decimal

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado
import pyarrow.parquet as pq
import pyarrow.compute as pc
import pyarrow as pa
import pandas as pd

from .stats import calculate_column_stats


def convert_to_json_serializable(value):
    """Convert Python objects to JSON-serializable types"""
    if value is None:
        return None
    elif isinstance(value, (date, datetime)):
        return value.isoformat()
    elif isinstance(value, Decimal):
        return float(value)
    elif isinstance(value, bytes):
        return value.decode('utf-8', errors='replace')
    elif isinstance(value, (list, tuple)):
        # Convert list/tuple to JSON string for display
        return json.dumps(value)
    elif isinstance(value, dict):
        # Convert dict to JSON string for display
        return json.dumps(value)
    else:
        return value


def get_file_type(file_path):
    """Determine file type based on extension"""
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.parquet':
        return 'parquet'
    elif ext in ['.xlsx', '.xls']:
        return 'excel'
    elif ext == '.csv':
        return 'csv'
    elif ext == '.tsv':
        return 'tsv'
    else:
        return 'unknown'


def read_excel_as_arrow_table(file_path):
    """Read Excel file (first worksheet only) and convert to PyArrow Table"""
    try:
        # Read only the first worksheet
        df = pd.read_excel(file_path, sheet_name=0, engine='openpyxl')

        # Convert pandas DataFrame to PyArrow Table
        table = pa.Table.from_pandas(df)

        return table
    except Exception as e:
        raise Exception(f"Failed to read Excel file: {str(e)}. Ensure the file is a valid Excel file and openpyxl is installed.")


def read_csv_as_arrow_table(file_path, delimiter=','):
    """Read CSV/TSV file and convert to PyArrow Table"""
    try:
        # Read CSV with pandas, handling various encodings
        # Try UTF-8 first, fall back to latin1 if that fails
        try:
            df = pd.read_csv(file_path, delimiter=delimiter, encoding='utf-8')
        except UnicodeDecodeError:
            df = pd.read_csv(file_path, delimiter=delimiter, encoding='latin1')

        # Convert pandas DataFrame to PyArrow Table
        table = pa.Table.from_pandas(df)

        return table
    except Exception as e:
        raise Exception(f"Failed to read CSV file: {str(e)}. Ensure the file is a valid CSV file.")


class ParquetMetadataHandler(APIHandler):
    """Handler for getting Parquet file metadata (columns, types, row count)"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get('path', '')

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({'error': 'No file path provided'}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get('contents_manager')
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(f"Processing request for: {file_path}")
            self.log.debug(f"Root dir: {root_dir}")

            full_path = os.path.join(root_dir, file_path.lstrip('/'))
            abs_path = Path(full_path).resolve()

            self.log.debug(f"Full path: {full_path}")
            self.log.debug(f"Resolved path: {abs_path}")
            self.log.debug(f"File exists: {abs_path.exists()}")

            if not abs_path.exists():
                self.set_status(404)
                self.finish(json.dumps({'error': f'File not found: {file_path} (resolved to {abs_path})'}))
                return

            # Detect file type
            file_type = get_file_type(str(abs_path))

            if file_type == 'parquet':
                # Read Parquet file metadata
                parquet_file = pq.ParquetFile(str(abs_path))
                schema = parquet_file.schema_arrow

                # Extract column information
                columns = []
                for i in range(len(schema)):
                    field = schema.field(i)
                    columns.append({
                        'name': field.name,
                        'type': str(field.type)
                    })

                # Get total row count
                total_rows = parquet_file.metadata.num_rows

            elif file_type == 'excel':
                # Read Excel file metadata
                table = read_excel_as_arrow_table(str(abs_path))
                schema = table.schema

                # Extract column information
                columns = []
                for i in range(len(schema)):
                    field = schema.field(i)
                    columns.append({
                        'name': field.name,
                        'type': str(field.type)
                    })

                # Get total row count
                total_rows = len(table)

            elif file_type == 'csv':
                # Read CSV file metadata
                table = read_csv_as_arrow_table(str(abs_path), delimiter=',')
                schema = table.schema

                # Extract column information
                columns = []
                for i in range(len(schema)):
                    field = schema.field(i)
                    columns.append({
                        'name': field.name,
                        'type': str(field.type)
                    })

                # Get total row count
                total_rows = len(table)

            elif file_type == 'tsv':
                # Read TSV file metadata
                table = read_csv_as_arrow_table(str(abs_path), delimiter='\t')
                schema = table.schema

                # Extract column information
                columns = []
                for i in range(len(schema)):
                    field = schema.field(i)
                    columns.append({
                        'name': field.name,
                        'type': str(field.type)
                    })

                # Get total row count
                total_rows = len(table)

            else:
                self.set_status(400)
                self.finish(json.dumps({'error': f'Unsupported file type: {file_type}'}))
                return

            # Get file size
            file_size = abs_path.stat().st_size

            self.finish(json.dumps({
                'columns': columns,
                'totalRows': total_rows,
                'fileSize': file_size
            }))

        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            self.log.error(f"Handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(json.dumps({
                'error': str(e),
                'error_type': type(e).__name__,
                'traceback': error_traceback
            }))


class ParquetDataHandler(APIHandler):
    """Handler for reading Parquet file data with pagination and filtering"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get('path', '')
            offset = input_data.get('offset', 0)
            limit = input_data.get('limit', 500)
            filters = input_data.get('filters', {})
            sort_by = input_data.get('sortBy', None)
            sort_order = input_data.get('sortOrder', 'asc')
            case_insensitive = input_data.get('caseInsensitive', False)
            use_regex = input_data.get('useRegex', False)

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({'error': 'No file path provided'}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get('contents_manager')
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(f"Data request for: {file_path} (offset={offset}, limit={limit})")
            self.log.debug(f"Root dir: {root_dir}")

            full_path = os.path.join(root_dir, file_path.lstrip('/'))
            abs_path = Path(full_path).resolve()

            self.log.debug(f"Full path: {full_path}")
            self.log.debug(f"Resolved path: {abs_path}")
            self.log.debug(f"File exists: {abs_path.exists()}")

            if not abs_path.exists():
                self.set_status(404)
                self.finish(json.dumps({'error': f'File not found: {file_path} (resolved to {abs_path})'}))
                return

            # Detect file type and read accordingly
            file_type = get_file_type(str(abs_path))

            if file_type == 'parquet':
                self.log.debug(f"Reading parquet file: {abs_path}")
                table = pq.read_table(str(abs_path))
            elif file_type == 'excel':
                self.log.debug(f"Reading excel file: {abs_path}")
                table = read_excel_as_arrow_table(str(abs_path))
            elif file_type == 'csv':
                self.log.debug(f"Reading CSV file: {abs_path}")
                table = read_csv_as_arrow_table(str(abs_path), delimiter=',')
            elif file_type == 'tsv':
                self.log.debug(f"Reading TSV file: {abs_path}")
                table = read_csv_as_arrow_table(str(abs_path), delimiter='\t')
            else:
                self.set_status(400)
                self.finish(json.dumps({'error': f'Unsupported file type: {file_type}'}))
                return

            # Add original row index column (1-indexed for display)
            original_indices = pa.array(range(1, len(table) + 1))
            table = table.append_column('__original_row_index__', original_indices)

            # Apply filters if provided
            if filters:
                filter_expressions = []
                for col_name, filter_spec in filters.items():
                    if col_name not in table.column_names:
                        continue

                    filter_type = filter_spec.get('type', 'text')
                    filter_value = filter_spec.get('value', '')

                    if not filter_value:
                        continue

                    column = table.column(col_name)

                    if filter_type == 'text':
                        # Cast column to string for text filtering (handles both string and numeric columns)
                        column_str = pc.cast(column, pa.string())

                        # Replace null values with "(null)" for consistent filtering
                        column_str = pc.fill_null(column_str, '(null)')

                        if use_regex:
                            # Use regex matching when enabled
                            try:
                                filter_expressions.append(
                                    pc.match_substring_regex(column_str, filter_value, ignore_case=case_insensitive)
                                )
                            except Exception:
                                # Fall back to simple substring matching if regex is invalid
                                filter_expressions.append(
                                    pc.match_substring(column_str, filter_value, ignore_case=case_insensitive)
                                )
                        else:
                            # Use simple substring matching by default
                            filter_expressions.append(
                                pc.match_substring(column_str, filter_value, ignore_case=case_insensitive)
                            )
                    elif filter_type == 'number':
                        # Numerical comparison
                        operator = filter_spec.get('operator', '=')
                        try:
                            numeric_value = float(filter_value)

                            if operator == '>':
                                filter_expressions.append(pc.greater(column, numeric_value))
                            elif operator == '<':
                                filter_expressions.append(pc.less(column, numeric_value))
                            elif operator == '>=':
                                filter_expressions.append(pc.greater_equal(column, numeric_value))
                            elif operator == '<=':
                                filter_expressions.append(pc.less_equal(column, numeric_value))
                            elif operator == '=':
                                filter_expressions.append(pc.equal(column, numeric_value))
                        except ValueError:
                            pass  # Skip invalid numeric values

                # Combine all filters with AND logic
                if filter_expressions:
                    combined_filter = filter_expressions[0]
                    for expr in filter_expressions[1:]:
                        combined_filter = pc.and_(combined_filter, expr)

                    table = table.filter(combined_filter)

            # Apply sorting if requested
            if sort_by and sort_by in table.column_names:
                # Create sort indices
                indices = pc.sort_indices(table, sort_keys=[(sort_by, "ascending" if sort_order == "asc" else "descending")])
                # Apply sort
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
                    if col_name == '__original_row_index__':
                        original_row_idx = value
                    else:
                        row[col_name] = convert_to_json_serializable(value)
                # Add original row index as metadata
                row['__row_index__'] = original_row_idx
                data.append(row)

            self.finish(json.dumps({
                'data': data,
                'offset': offset,
                'limit': limit,
                'totalRows': total_filtered_rows,
                'hasMore': end < total_filtered_rows
            }))

        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            self.log.error(f"Handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(json.dumps({
                'error': str(e),
                'error_type': type(e).__name__,
                'traceback': error_traceback
            }))


class ColumnStatsHandler(APIHandler):
    """Handler for calculating column statistics"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get('path', '')
            column_name = input_data.get('columnName', '')

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({'error': 'No file path provided'}))
                return

            if not column_name:
                self.set_status(400)
                self.finish(json.dumps({'error': 'No column name provided'}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get('contents_manager')
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(f"Stats request for column '{column_name}' in file: {file_path}")

            full_path = os.path.join(root_dir, file_path.lstrip('/'))
            abs_path = Path(full_path).resolve()

            if not abs_path.exists():
                self.set_status(404)
                self.finish(json.dumps({'error': f'File not found: {file_path}'}))
                return

            # Detect file type and read accordingly
            file_type = get_file_type(str(abs_path))

            if file_type == 'parquet':
                table = pq.read_table(str(abs_path))
            elif file_type == 'excel':
                table = read_excel_as_arrow_table(str(abs_path))
            elif file_type == 'csv':
                table = read_csv_as_arrow_table(str(abs_path), delimiter=',')
            elif file_type == 'tsv':
                table = read_csv_as_arrow_table(str(abs_path), delimiter='\t')
            else:
                self.set_status(400)
                self.finish(json.dumps({'error': f'Unsupported file type: {file_type}'}))
                return

            # Calculate statistics
            stats = calculate_column_stats(table, column_name)

            self.finish(json.dumps(stats))

        except ValueError as e:
            # Column not found or other validation error
            self.set_status(400)
            self.finish(json.dumps({'error': str(e)}))
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            self.log.error(f"Stats handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(json.dumps({
                'error': str(e),
                'error_type': type(e).__name__
            }))


class UniqueValuesHandler(APIHandler):
    """Handler for fetching unique values from a column"""

    @tornado.web.authenticated
    def post(self):
        try:
            input_data = self.get_json_body()
            file_path = input_data.get('path', '')
            column_name = input_data.get('columnName', '')

            if not file_path:
                self.set_status(400)
                self.finish(json.dumps({'error': 'No file path provided'}))
                return

            if not column_name:
                self.set_status(400)
                self.finish(json.dumps({'error': 'No column name provided'}))
                return

            # Get the full path to the file using contents manager
            contents_manager = self.settings.get('contents_manager')
            if contents_manager:
                root_dir = contents_manager.root_dir
            else:
                root_dir = os.getcwd()

            self.log.info(f"Unique values request for column '{column_name}' in file: {file_path}")

            full_path = os.path.join(root_dir, file_path.lstrip('/'))
            abs_path = Path(full_path).resolve()

            if not abs_path.exists():
                self.set_status(404)
                self.finish(json.dumps({'error': f'File not found: {file_path}'}))
                return

            # Detect file type and read accordingly
            file_type = get_file_type(str(abs_path))

            if file_type == 'parquet':
                table = pq.read_table(str(abs_path))
            elif file_type == 'excel':
                table = read_excel_as_arrow_table(str(abs_path))
            elif file_type == 'csv':
                table = read_csv_as_arrow_table(str(abs_path), delimiter=',')
            elif file_type == 'tsv':
                table = read_csv_as_arrow_table(str(abs_path), delimiter='\t')
            else:
                self.set_status(400)
                self.finish(json.dumps({'error': f'Unsupported file type: {file_type}'}))
                return

            # Check if column exists
            if column_name not in table.column_names:
                self.set_status(400)
                self.finish(json.dumps({'error': f'Column "{column_name}" not found in file'}))
                return

            # Get column
            column = table.column(column_name)

            # Cast to string to handle all types uniformly
            column_str = pc.cast(column, pa.string())

            # Replace null values with the string "(null)" for consistent handling
            column_str = pc.fill_null(column_str, '(null)')

            # Get limit from request (default to 100 if not provided)
            limit = input_data.get('limit', 100)

            # Get value counts
            value_counts = pc.value_counts(column_str)

            # value_counts returns a StructArray with 'values' and 'counts' fields
            values_array = value_counts.field('values')
            counts_array = value_counts.field('counts')

            # Combine into list of tuples
            value_count_pairs = list(zip(values_array.to_pylist(), counts_array.to_pylist()))

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
                'values': values_list,
                'counts': counts_list,
                'limit': limit,
                'total_count': total_unique
            }

            self.finish(json.dumps(result))

        except ValueError as e:
            # Column not found or other validation error
            self.set_status(400)
            self.finish(json.dumps({'error': str(e)}))
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            self.log.error(f"Unique values handler error: {str(e)}\n{error_traceback}")
            self.set_status(500)
            self.finish(json.dumps({
                'error': str(e),
                'error_type': type(e).__name__
            }))


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    metadata_pattern = url_path_join(base_url, "jupyterlab-tabular-data-viewer-extension", "metadata")
    data_pattern = url_path_join(base_url, "jupyterlab-tabular-data-viewer-extension", "data")
    stats_pattern = url_path_join(base_url, "jupyterlab-tabular-data-viewer-extension", "column-stats")
    unique_values_pattern = url_path_join(base_url, "jupyterlab-tabular-data-viewer-extension", "unique-values")

    handlers = [
        (metadata_pattern, ParquetMetadataHandler),
        (data_pattern, ParquetDataHandler),
        (stats_pattern, ColumnStatsHandler),
        (unique_values_pattern, UniqueValuesHandler)
    ]

    web_app.add_handlers(host_pattern, handlers)

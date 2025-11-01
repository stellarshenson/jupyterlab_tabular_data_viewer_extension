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
    else:
        return value


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

            # Read Parquet file
            self.log.debug(f"Reading parquet file: {abs_path}")
            table = pq.read_table(str(abs_path))

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
                        # Substring matching for text columns
                        filter_expressions.append(
                            pc.match_substring(column, filter_value)
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
                import pyarrow as pa
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
                for col_name in table_slice.column_names:
                    value = table_slice.column(col_name)[i].as_py()
                    row[col_name] = convert_to_json_serializable(value)
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


def setup_route_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]

    metadata_pattern = url_path_join(base_url, "jupyterlab-parquet-viewer-extension", "metadata")
    data_pattern = url_path_join(base_url, "jupyterlab-parquet-viewer-extension", "data")

    handlers = [
        (metadata_pattern, ParquetMetadataHandler),
        (data_pattern, ParquetDataHandler)
    ]

    web_app.add_handlers(host_pattern, handlers)

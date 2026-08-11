"""
Column statistics calculation using PyArrow.
"""

import math

import pyarrow as pa
import pyarrow.compute as pc
from typing import Dict, Any


def simplify_type(arrow_type: pa.DataType) -> str:
    """
    Convert PyArrow data type to simplified display type.

    Args:
        arrow_type: PyArrow data type

    Returns:
        Simplified type string: 'int', 'float', 'string', 'date', 'datetime', 'boolean'
    """
    type_str = str(arrow_type)

    if pa.types.is_integer(arrow_type):
        return "int"
    elif pa.types.is_floating(arrow_type):
        return "float"
    elif (
        pa.types.is_string(arrow_type)
        or pa.types.is_large_string(arrow_type)
        or type_str in ("string_view", "large_utf8")
    ):
        return "string"
    elif (
        type_str == "binary_view"
        or pa.types.is_binary(arrow_type)
        or pa.types.is_large_binary(arrow_type)
    ):
        return "binary"
    elif pa.types.is_date(arrow_type):
        return "date"
    elif pa.types.is_timestamp(arrow_type):
        return "datetime"
    elif pa.types.is_boolean(arrow_type):
        return "boolean"
    else:
        return type_str


def numeric_view(column):
    """A numeric reading of a text column, or None when it is not all numbers.

    A worksheet cell can hold a number as TEXT, and openpyxl returns a str for
    it, so the column is genuinely a string column and stays one - a zip code
    typed as text keeps its leading zeros, which pandas destroyed by coercing
    the column to int64. But the harm pandas' coercion avoided is real: a text
    column sorts lexicographically, putting 10 before 2, and reports no minimum,
    maximum or mean. This gives the sort key and the aggregates a numeric view
    of the same values without changing what is stored, displayed or exported.

    int64 is tried before float64 so a 19-digit id keeps every digit; float64
    would round it. The cast raises on anything not a number - a non-numeric
    value, an empty string, even surrounding whitespace - which makes one
    vectorised attempt the whole test.
    """
    if not (pa.types.is_string(column.type) or pa.types.is_large_string(column.type)):
        return None
    for target in (pa.int64(), pa.float64()):
        try:
            return pc.cast(column, target)
        except pa.ArrowInvalid:
            continue
    return None


def json_safe(stats: Dict[str, Any]) -> Dict[str, Any]:
    """Replace NaN and +/-Infinity with None throughout a statistics payload.

    Both are legal python floats and `json.dumps` writes them as bare `NaN` and
    `Infinity`, which `JSON.parse` rejects - so a single non-finite aggregate
    made the entire response unparseable and the column's panel reported a load
    failure. Reachable from a text column holding `Inf`, which R's write.csv
    emits, and from any genuine float column carrying an infinity.
    """
    return {
        key: (
            None
            if isinstance(value, float) and not math.isfinite(value)
            else value
        )
        for key, value in stats.items()
    }


def calculate_column_stats(table: pa.Table, column_name: str) -> Dict[str, Any]:
    """
    Calculate comprehensive statistics for a column.

    Args:
        table: PyArrow table containing the data
        column_name: Name of column to analyze

    Returns:
        Dictionary with statistics appropriate for the column type
    """
    if column_name not in table.column_names:
        raise ValueError(f"Column '{column_name}' not found in table")

    column = table.column(column_name)
    column_type = column.type
    simplified_type = simplify_type(column_type)

    # Cast view types to their base equivalents for compute compatibility
    view_type_cast = {
        "string_view": pa.string(),
        "binary_view": pa.binary(),
    }
    cast_target = view_type_cast.get(str(column_type))
    if cast_target is not None:
        column = pc.cast(column, cast_target)

    # Basic statistics for all types
    total_count = len(column)
    # pc.sum over an empty column returns null, and int(None) raises TypeError -
    # not a ValueError, so the handler answered 500 with a traceback for any
    # zero-row table: a header-only worksheet, an empty SQLite table, or a csv
    # the reader opened with no data rows.
    null_count = 0 if total_count == 0 else int(pc.sum(pc.is_null(column)).as_py())
    non_null_count = total_count - null_count
    null_percentage = (null_count / total_count * 100) if total_count > 0 else 0
    non_null_percentage = (100 - null_percentage) if total_count > 0 else 0

    # Unique values (computed on non-null values)
    unique_count = int(pc.count_distinct(column).as_py())
    unique_percentage = (unique_count / total_count * 100) if total_count > 0 else 0

    stats = {
        "column_name": column_name,
        "data_type": simplified_type,
        "total_rows": total_count,
        "non_null_count": non_null_count,
        "non_null_percentage": round(non_null_percentage, 1),
        "null_count": null_count,
        "null_percentage": round(null_percentage, 1),
        "unique_count": unique_count,
        "unique_percentage": round(unique_percentage, 1),
    }

    # Skip further statistics if all nulls
    if non_null_count == 0:
        return stats

    # Numeric statistics. A text column whose every value is a number gets them
    # too, computed on a numeric view - the reported data_type stays "string",
    # and the stored values are untouched.
    numeric_column = column if simplified_type in ("int", "float") else numeric_view(column)
    if numeric_column is not None:
        try:
            min_max = pc.min_max(numeric_column)
            stats["min_value"] = (
                float(min_max["min"].as_py()) if min_max["min"].is_valid else None
            )
            stats["max_value"] = (
                float(min_max["max"].as_py()) if min_max["max"].is_valid else None
            )

            mean_val = pc.mean(numeric_column)
            stats["mean"] = (
                round(float(mean_val.as_py()), 2) if mean_val.is_valid else None
            )

            # Median using quantile
            median_val = pc.quantile(numeric_column, q=0.5)
            if isinstance(median_val, pa.Array):
                stats["median"] = (
                    round(float(median_val[0].as_py()), 2)
                    if median_val[0].is_valid
                    else None
                )
            else:
                stats["median"] = (
                    round(float(median_val.as_py()), 2) if median_val.is_valid else None
                )

            stddev_val = pc.stddev(numeric_column)
            stats["std_dev"] = (
                round(float(stddev_val.as_py()), 2) if stddev_val.is_valid else None
            )

            # IQR and outlier detection
            q1 = pc.quantile(numeric_column, q=0.25)
            q3 = pc.quantile(numeric_column, q=0.75)

            if isinstance(q1, pa.Array):
                q1_val = float(q1[0].as_py()) if q1[0].is_valid else None
            else:
                q1_val = float(q1.as_py()) if q1.is_valid else None

            if isinstance(q3, pa.Array):
                q3_val = float(q3[0].as_py()) if q3[0].is_valid else None
            else:
                q3_val = float(q3.as_py()) if q3.is_valid else None

            if q1_val is not None and q3_val is not None:
                iqr = q3_val - q1_val
                lower_bound = q1_val - 1.5 * iqr
                upper_bound = q3_val + 1.5 * iqr

                # Count outliers
                outlier_mask = pc.or_(
                    pc.less(numeric_column, lower_bound), pc.greater(numeric_column, upper_bound)
                )
                outlier_count = int(pc.sum(outlier_mask).as_py())
                outlier_percentage = (
                    (outlier_count / non_null_count * 100) if non_null_count > 0 else 0
                )

                stats["outlier_count"] = outlier_count
                stats["outlier_percentage"] = round(outlier_percentage, 1)
                stats["outlier_lower_bound"] = round(lower_bound, 2)
                stats["outlier_upper_bound"] = round(upper_bound, 2)
        except Exception as e:
            # Log but don't fail - return partial stats
            print(f"Warning: Could not compute numeric stats for {column_name}: {e}")

    # String statistics - also for a numeric-text column, which is a string
    if simplified_type == "string":
        try:
            # Filter out nulls for string operations
            non_null_column = pc.drop_null(column)

            if len(non_null_column) > 0:
                # Most common value (mode)
                try:
                    mode_result = pc.mode(non_null_column)
                    if len(mode_result) > 0:
                        mode_struct = mode_result[0]
                        most_common = mode_struct["mode"].as_py()
                        most_common_count = int(mode_struct["count"].as_py())
                        stats["most_common_value"] = most_common
                        stats["most_common_count"] = most_common_count
                except Exception as e:
                    print(f"Warning: Could not compute mode for {column_name}: {e}")

                # String lengths
                try:
                    lengths = pc.utf8_length(non_null_column)
                    lengths_min_max = pc.min_max(lengths)
                    stats["min_length"] = int(lengths_min_max["min"].as_py())
                    stats["max_length"] = int(lengths_min_max["max"].as_py())

                    avg_length = pc.mean(lengths)
                    stats["avg_length"] = round(float(avg_length.as_py()), 1)
                except Exception as e:
                    print(
                        f"Warning: Could not compute string lengths for {column_name}: {e}"
                    )
        except Exception as e:
            print(f"Warning: Could not compute string stats for {column_name}: {e}")

    # Date/datetime statistics
    elif simplified_type in ("date", "datetime"):
        try:
            min_date = pc.min(column).as_py()
            max_date = pc.max(column).as_py()

            stats["earliest_date"] = str(min_date)
            stats["latest_date"] = str(max_date)

            # Calculate span
            if min_date and max_date:
                span = max_date - min_date
                stats["date_range_days"] = span.days if hasattr(span, "days") else None
        except Exception as e:
            print(f"Warning: Could not compute date stats for {column_name}: {e}")

    return stats

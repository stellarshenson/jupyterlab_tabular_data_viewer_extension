import json
import os
import shutil
from pathlib import Path

import pytest

# Shared fixture directory. Pre-existing tests inline this path; new tests use
# the constant.
DATA_DIR = Path(__file__).parent.parent.parent / "data"


async def test_metadata_endpoint(jp_fetch, jp_root_dir):
    """Test fetching metadata from email classification parquet file"""
    # Copy test file to pytest temporary directory
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    target_file = target_dir / "email_classification_dataset.parquet"
    shutil.copy(source_file, target_file)

    # Create test file path relative to server root
    test_file = "data/email_classification_dataset.parquet"

    # When
    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "metadata",
        method="POST",
        body=json.dumps({"path": test_file}),
    )

    # Then
    assert response.code == 200
    metadata = json.loads(response.body)

    # Verify structure
    assert "columns" in metadata
    assert "totalRows" in metadata
    assert "fileSize" in metadata

    # Verify expected columns
    assert len(metadata["columns"]) == 2
    column_names = [col["name"] for col in metadata["columns"]]
    assert "email" in column_names
    assert "is_maintenance" in column_names

    # Verify row count
    assert metadata["totalRows"] == 13


async def test_unique_values_endpoint(jp_fetch, jp_root_dir):
    """Test fetching unique values with counts from is_maintenance column"""
    # Copy test file to pytest temporary directory
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    target_file = target_dir / "email_classification_dataset.parquet"
    shutil.copy(source_file, target_file)

    # Create test file path relative to server root
    test_file = "data/email_classification_dataset.parquet"

    # When
    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "unique-values",
        method="POST",
        body=json.dumps({"path": test_file, "columnName": "is_maintenance"}),
    )

    # Then
    assert response.code == 200
    result = json.loads(response.body)

    # Verify structure
    assert "values" in result
    assert "counts" in result
    assert "limit" in result
    assert "total_count" in result

    # Verify unique values for is_maintenance (should be 0 and 1)
    assert result["total_count"] == 2
    assert len(result["values"]) == 2
    assert len(result["counts"]) == 2

    # Verify values are strings (cast from int)
    assert all(isinstance(v, str) for v in result["values"])
    assert set(result["values"]) == {"0", "1"}

    # Verify counts sum to total rows
    assert sum(result["counts"]) == 13

    # Both values should appear at least once
    assert all(c > 0 for c in result["counts"])


async def test_data_endpoint_with_filter(jp_fetch, jp_root_dir):
    """Test fetching data with regex filter on is_maintenance column"""
    # Copy test file to pytest temporary directory
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    target_file = target_dir / "email_classification_dataset.parquet"
    shutil.copy(source_file, target_file)

    # Create test file path relative to server root
    test_file = "data/email_classification_dataset.parquet"

    # When - filter for maintenance emails only (is_maintenance = 1)
    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "data",
        method="POST",
        body=json.dumps(
            {
                "path": test_file,
                "offset": 0,
                "limit": 100,
                "filters": {"is_maintenance": {"type": "text", "value": "^(1)$"}},
                "useRegex": True,
                "caseInsensitive": False,
            }
        ),
    )

    # Then
    assert response.code == 200
    result = json.loads(response.body)

    # Verify structure
    assert "data" in result
    assert "totalRows" in result
    assert "offset" in result
    assert "limit" in result
    assert "hasMore" in result

    # Verify filtering worked - totalRows is filtered count
    assert result["totalRows"] > 0  # Some maintenance emails exist
    assert (
        result["totalRows"] < 13
    )  # Not all emails are maintenance (we know total is 13)
    assert (
        result["totalRows"] == 4
    )  # Based on email_classification_dataset.parquet data

    # Verify all returned rows have is_maintenance = 1
    for row in result["data"]:
        assert row["is_maintenance"] == 1
        # Verify email field exists and contains text
        assert "email" in row
        assert isinstance(row["email"], str)
        assert len(row["email"]) > 0
        # Verify original row index is preserved
        assert "__row_index__" in row


async def test_first_row_content(jp_fetch, jp_root_dir):
    """Test that the first row contains the expected email content"""
    # Copy test file to pytest temporary directory
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    target_file = target_dir / "email_classification_dataset.parquet"
    shutil.copy(source_file, target_file)

    # Create test file path relative to server root
    test_file = "data/email_classification_dataset.parquet"

    # When - fetch the first row of data
    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "data",
        method="POST",
        body=json.dumps(
            {
                "path": test_file,
                "offset": 0,
                "limit": 1,
                "filters": {},
                "useRegex": False,
                "caseInsensitive": False,
            }
        ),
    )

    # Then
    assert response.code == 200
    result = json.loads(response.body)

    # Verify we got exactly one row
    assert len(result["data"]) == 1
    first_row = result["data"][0]

    # Verify the email content is about Annual Budget Review Meeting
    assert "email" in first_row
    assert "Annual Budget Review Meeting" in first_row["email"]
    assert "Finance Department" in first_row["email"]
    assert "February 10, 2025" in first_row["email"]

    # Verify it's not a maintenance email
    assert first_row["is_maintenance"] == 0


async def test_string_view_metadata(jp_fetch, jp_root_dir):
    """Test that string_view columns are normalized to 'string' in metadata"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "activity_stats.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "activity_stats.parquet")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "metadata",
        method="POST",
        body=json.dumps({"path": "data/activity_stats.parquet"}),
    )

    assert response.code == 200
    metadata = json.loads(response.body)

    # string_view columns should appear as 'string'
    type_by_name = {c["name"]: c["type"] for c in metadata["columns"]}
    for col in ("id", "farm_id", "date", "period", "source"):
        assert type_by_name[col] == "string", (
            f"{col} should be 'string', got '{type_by_name[col]}'"
        )

    # numeric columns should remain double
    assert type_by_name["animal_count"] == "double"


async def test_string_view_column_stats(jp_fetch, jp_root_dir):
    """Test that column stats work on string_view columns without errors"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "activity_stats.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "activity_stats.parquet")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "column-stats",
        method="POST",
        body=json.dumps({"path": "data/activity_stats.parquet", "columnName": "date"}),
    )

    assert response.code == 200
    stats = json.loads(response.body)

    assert stats["data_type"] == "string"
    assert stats["total_rows"] > 0
    assert "unique_count" in stats
    assert "min_length" in stats
    assert "max_length" in stats


async def test_string_view_unique_values(jp_fetch, jp_root_dir):
    """Test that unique values work on string_view columns"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "activity_stats.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "activity_stats.parquet")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "unique-values",
        method="POST",
        body=json.dumps({"path": "data/activity_stats.parquet", "columnName": "date"}),
    )

    assert response.code == 200
    result = json.loads(response.body)

    assert "values" in result
    assert "counts" in result
    assert result["total_count"] > 0


async def test_column_stats_all_types(jp_fetch, jp_root_dir):
    """Test column stats for string_view and double columns in activity_stats"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "activity_stats.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "activity_stats.parquet")
    test_file = "data/activity_stats.parquet"

    # Test string_view columns
    for col_name in ("id", "farm_id", "date", "period", "source"):
        response = await jp_fetch(
            "jupyterlab-tabular-data-viewer-extension",
            "column-stats",
            method="POST",
            body=json.dumps({"path": test_file, "columnName": col_name}),
        )
        assert response.code == 200, f"Stats failed for string_view column '{col_name}'"
        stats = json.loads(response.body)
        assert stats["data_type"] == "string", f"{col_name} type should be 'string'"
        assert stats["total_rows"] > 0
        assert "min_length" in stats, f"{col_name} missing min_length"
        assert "max_length" in stats, f"{col_name} missing max_length"
        assert "avg_length" in stats, f"{col_name} missing avg_length"

    # Test double columns
    for col_name in ("animal_count", "total_activity_mean", "alarm_rate"):
        response = await jp_fetch(
            "jupyterlab-tabular-data-viewer-extension",
            "column-stats",
            method="POST",
            body=json.dumps({"path": test_file, "columnName": col_name}),
        )
        assert response.code == 200, f"Stats failed for double column '{col_name}'"
        stats = json.loads(response.body)
        assert stats["data_type"] == "float", f"{col_name} type should be 'float'"
        assert "min_value" in stats, f"{col_name} missing min_value"
        assert "max_value" in stats, f"{col_name} missing max_value"
        assert "mean" in stats, f"{col_name} missing mean"
        assert "median" in stats, f"{col_name} missing median"
        assert "std_dev" in stats, f"{col_name} missing std_dev"


# ---------------------------------------------------------------------------
# Unit tests: slugify, list_excel_sheets, cascading type inference
# ---------------------------------------------------------------------------


def test_slugify_basic():
    """slugify lowercases, collapses non-alphanumerics to underscore"""
    from jupyterlab_tabular_data_viewer_extension.routes import slugify

    assert slugify("Sheet 1") == "sheet_1"
    assert slugify("Sales 2024") == "sales_2024"
    assert slugify("Hello World!") == "hello_world"
    assert slugify("data_2024") == "data_2024"


def test_slugify_edge_cases():
    """slugify handles empty/whitespace/unicode by falling back to 'sheet'"""
    from jupyterlab_tabular_data_viewer_extension.routes import slugify

    assert slugify("") == "sheet"
    assert slugify("   ") == "sheet"
    assert slugify(None) == "sheet"
    # Polish diacritics get stripped (ASCII-only slug)
    assert slugify("PĘPÓW") == "p_p_w"


def test_list_excel_sheets_multi_sheet(tmp_path):
    """list_excel_sheets returns workbook sheet names in order"""
    from jupyterlab_tabular_data_viewer_extension.readers import list_excel_sheets

    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target = tmp_path / "multi_sheet.xlsx"
    shutil.copy(source_file, target)

    sheets = list_excel_sheets(str(target))
    assert sheets == ["Sheet1", "MixedTypes", "Sales 2024"]


def test_list_excel_sheets_non_excel():
    """list_excel_sheets returns empty list for non-Excel formats"""
    from jupyterlab_tabular_data_viewer_extension.readers import list_excel_sheets

    parquet_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    assert list_excel_sheets(str(parquet_file)) == []


def test_read_excel_specific_sheet(tmp_path):
    """read_as_arrow_table with sheet param reads the named sheet"""
    from jupyterlab_tabular_data_viewer_extension.readers import read_as_arrow_table

    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target = tmp_path / "multi_sheet.xlsx"
    shutil.copy(source_file, target)

    # Sheet1: clean
    t1 = read_as_arrow_table(str(target), "Sheet1")
    assert t1.column_names == ["id", "name", "score"]
    assert len(t1) == 3

    # Sales 2024: spaced sheet name
    t3 = read_as_arrow_table(str(target), "Sales 2024")
    assert t3.column_names == ["q", "revenue"]
    assert len(t3) == 4


def test_read_excel_default_first_sheet(tmp_path):
    """sheet=None reads the first sheet (preserves prior behaviour)"""
    from jupyterlab_tabular_data_viewer_extension.readers import read_as_arrow_table

    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target = tmp_path / "multi_sheet.xlsx"
    shutil.copy(source_file, target)

    t = read_as_arrow_table(str(target))
    assert t.column_names == ["id", "name", "score"]


def test_cascade_mixed_type_column(tmp_path):
    """Mixed int+string column falls back to string via the cascade.

    Regression for v1.6.0 fix - the MixedTypes sheet has AccountID with
    integers and 'ACCFS-108' string mixed.
    """
    from jupyterlab_tabular_data_viewer_extension.readers import read_as_arrow_table

    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target = tmp_path / "multi_sheet.xlsx"
    shutil.copy(source_file, target)

    from jupyterlab_tabular_data_viewer_extension.routes import normalize_arrow_type

    t = read_as_arrow_table(str(target), "MixedTypes")
    schema_by_name = {
        f.name: normalize_arrow_type(str(f.type)) for f in t.schema
    }
    # Mixed-type column ends up as a string-family type (string or large_string,
    # both normalize to "string"); the cascade routed around the int64 inference.
    assert schema_by_name["AccountID"] == "string", (
        "mixed-type column must fall back to string"
    )
    values = t.column("AccountID").to_pylist()
    assert "ACCFS-108" in values
    assert "43216987345427" in values


# ---------------------------------------------------------------------------
# HTTP: metadata sheets field + sheet param flow
# ---------------------------------------------------------------------------


async def test_metadata_returns_sheets_for_excel(jp_fetch, jp_root_dir):
    """ParquetMetadataHandler returns sheets list for multi-sheet Excel"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "multi_sheet.xlsx")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "metadata",
        method="POST",
        body=json.dumps({"path": "data/multi_sheet.xlsx"}),
    )

    assert response.code == 200
    metadata = json.loads(response.body)
    assert metadata["sheets"] == ["Sheet1", "MixedTypes", "Sales 2024"]


async def test_metadata_returns_empty_sheets_for_parquet(jp_fetch, jp_root_dir):
    """Parquet metadata returns empty sheets list (frontend hides bar)"""
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "email_classification_dataset.parquet")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "metadata",
        method="POST",
        body=json.dumps({"path": "data/email_classification_dataset.parquet"}),
    )

    assert response.code == 200
    metadata = json.loads(response.body)
    assert metadata["sheets"] == []


async def test_metadata_with_sheet_param(jp_fetch, jp_root_dir):
    """Metadata for a specific sheet returns that sheet's columns"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "multi_sheet.xlsx")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "metadata",
        method="POST",
        body=json.dumps(
            {"path": "data/multi_sheet.xlsx", "sheet": "Sales 2024"}
        ),
    )

    assert response.code == 200
    metadata = json.loads(response.body)
    column_names = [c["name"] for c in metadata["columns"]]
    assert column_names == ["q", "revenue"]
    assert metadata["totalRows"] == 4


async def test_data_endpoint_with_sheet_param(jp_fetch, jp_root_dir):
    """Data endpoint reads only the requested sheet"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "multi_sheet.xlsx")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "data",
        method="POST",
        body=json.dumps(
            {
                "path": "data/multi_sheet.xlsx",
                "sheet": "MixedTypes",
                "offset": 0,
                "limit": 100,
                "filters": {},
            }
        ),
    )

    assert response.code == 200
    result = json.loads(response.body)
    assert result["totalRows"] == 3
    account_ids = [row["AccountID"] for row in result["data"]]
    # Mixed-type cascade: all values arrive as strings
    assert "ACCFS-108" in account_ids
    assert "43216987345427" in account_ids


# ---------------------------------------------------------------------------
# HTTP: download formats and filename construction
# ---------------------------------------------------------------------------


async def _download(jp_fetch, **params):
    """Helper: GET /download with query params, return (response, filename)"""
    from urllib.parse import urlencode

    qs = urlencode(params)
    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "download",
        method="GET",
        params=params,
    )
    # Parse filename out of Content-Disposition: attachment; filename="..."
    cd = response.headers.get("Content-Disposition", "")
    filename = None
    if 'filename="' in cd:
        filename = cd.split('filename="', 1)[1].rsplit('"', 1)[0]
    return response, filename, qs


async def test_download_filename_no_sheet_no_filter(jp_fetch, jp_root_dir):
    """parquet/csv/etc without sheet or filter: <base>.<ext>"""
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "email_classification_dataset.parquet")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/email_classification_dataset.parquet",
        format="csv",
    )
    assert response.code == 200
    assert filename == "email_classification_dataset.csv"


async def test_download_filename_no_sheet_with_filter(jp_fetch, jp_root_dir):
    """non-empty filters trigger _filtered suffix"""
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "email_classification_dataset.parquet")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/email_classification_dataset.parquet",
        format="csv",
        filters=json.dumps(
            {"is_maintenance": {"type": "text", "value": "1"}}
        ),
    )
    assert response.code == 200
    assert filename == "email_classification_dataset_filtered.csv"


async def test_download_filename_with_sheet_no_filter(jp_fetch, jp_root_dir):
    """sheet active, no filters: <base>_<slug>.<ext>"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "multi_sheet.xlsx")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/multi_sheet.xlsx",
        format="csv",
        sheet="Sales 2024",
    )
    assert response.code == 200
    assert filename == "multi_sheet_sales_2024.csv"


async def test_download_filename_with_sheet_and_filter(jp_fetch, jp_root_dir):
    """sheet + filters: <base>_<slug>_filtered.<ext>"""
    source_file = (
        Path(__file__).parent.parent.parent / "data" / "multi_sheet.xlsx"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "multi_sheet.xlsx")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/multi_sheet.xlsx",
        format="csv",
        sheet="Sales 2024",
        filters=json.dumps({"q": {"type": "text", "value": "Q1"}}),
    )
    assert response.code == 200
    assert filename == "multi_sheet_sales_2024_filtered.csv"


async def test_download_sort_alone_no_filtered_suffix(jp_fetch, jp_root_dir):
    """sortBy without filters does NOT trigger _filtered"""
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "email_classification_dataset.parquet")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/email_classification_dataset.parquet",
        format="csv",
        sortBy="email",
        sortOrder="asc",
    )
    assert response.code == 200
    assert filename == "email_classification_dataset.csv"


async def test_download_format_jsonl(jp_fetch, jp_root_dir):
    """JSONL output is line-delimited JSON, one record per line"""
    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "email_classification_dataset.parquet")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/email_classification_dataset.parquet",
        format="jsonl",
    )
    assert response.code == 200
    assert filename == "email_classification_dataset.jsonl"
    assert (
        response.headers.get("Content-Type") == "application/x-ndjson"
    ), "JSONL must be served as application/x-ndjson"

    body = response.body.decode("utf-8")
    lines = [line for line in body.split("\n") if line]
    assert len(lines) == 13  # known row count for this dataset
    first = json.loads(lines[0])
    assert "email" in first
    assert "is_maintenance" in first


async def test_download_format_parquet(jp_fetch, jp_root_dir):
    """Parquet output is binary, openable by pyarrow"""
    import io

    import pyarrow.parquet as pq

    source_file = (
        Path(__file__).parent.parent.parent
        / "data"
        / "email_classification_dataset.parquet"
    )
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(source_file, target_dir / "email_classification_dataset.parquet")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/email_classification_dataset.parquet",
        format="parquet",
    )
    assert response.code == 200
    assert filename == "email_classification_dataset.parquet"
    assert (
        response.headers.get("Content-Type") == "application/octet-stream"
    ), "Parquet must be served as application/octet-stream"

    # Parse the bytes back into a parquet table to confirm it's valid
    table = pq.read_table(io.BytesIO(response.body))
    assert "email" in table.column_names
    assert len(table) == 13


# ---------------------------------------------------------------------------
# Unit tests: content-based detection (sniff_file_type / get_file_type)
# ---------------------------------------------------------------------------

def test_sniff_file_type_only_claims_sqlite():
    """Only SQLite is sniffed; every other format resolves by extension.

    Parquet and xlsx are deliberately absent from _MAGIC: "PAR1" is four
    printable characters and matched a CSV whose first column was named PAR1,
    and the zip signature matched any zip named .db. Both misreads produced a
    500 rather than the clean 400 the detection design promises.
    """
    from jupyterlab_tabular_data_viewer_extension.readers import sniff_file_type

    assert sniff_file_type(str(DATA_DIR / "sample_database.db")) == "sqlite"
    assert sniff_file_type(str(DATA_DIR / "sample_data.parquet")) is None
    assert sniff_file_type(str(DATA_DIR / "sample_data.xlsx")) is None
    assert sniff_file_type(str(DATA_DIR / "sample_data.csv")) is None
    assert sniff_file_type(str(DATA_DIR / "sample_data.tsv")) is None


def test_par1_named_csv_column_is_not_parquet(tmp_path):
    """A CSV whose first column is named PAR1 stays a CSV"""
    from jupyterlab_tabular_data_viewer_extension.readers import (
        get_file_type,
        read_as_arrow_table,
    )

    csv_path = tmp_path / "params.csv"
    csv_path.write_text("PAR1,PAR2,PAR3\n1,2,3\n")

    assert get_file_type(str(csv_path)) == "csv"
    table = read_as_arrow_table(str(csv_path))
    assert table.column_names == ["PAR1", "PAR2", "PAR3"]
    assert len(table) == 1


def test_zip_named_db_is_rejected_cleanly(tmp_path):
    """A zip archive named .db raises ValueError, not an unhandled error.

    ValueError is what the handlers translate to HTTP 400; anything else
    reaches the outer handler and becomes a 500 with a traceback in the body.
    """
    import zipfile

    from jupyterlab_tabular_data_viewer_extension.readers import (
        get_file_type,
        read_as_arrow_table,
    )

    impostor = tmp_path / "impostor.db"
    with zipfile.ZipFile(impostor, "w") as zf:
        zf.writestr("a.txt", "hello")

    assert get_file_type(str(impostor)) == "unknown"
    with pytest.raises(ValueError):
        read_as_arrow_table(str(impostor))


def test_corrupt_sqlite_raises_value_error(tmp_path):
    """A truncated database surfaces as ValueError, not sqlite3.DatabaseError"""
    from jupyterlab_tabular_data_viewer_extension.readers import (
        get_file_type,
        list_sqlite_tables,
    )

    corrupt = tmp_path / "corrupt.db"
    corrupt.write_bytes(b"SQLite format 3\x00" + b"\x00" * 40)

    assert get_file_type(str(corrupt)) == "sqlite"
    with pytest.raises(ValueError):
        list_sqlite_tables(str(corrupt))


def test_unreadable_table_raises_value_error(tmp_path):
    """A listed table whose SELECT fails surfaces as ValueError, not a 500.

    pandas re-raises driver errors as pandas.errors.DatabaseError, which
    subclasses OSError - neither sqlite3.Error nor ValueError - so this escaped
    the 400 path even after the connection wrapper was added. The table sorts
    first, so the whole database was unopenable, not just this tab.
    """
    import sqlite3

    from jupyterlab_tabular_data_viewer_extension.readers import (
        list_sqlite_tables,
        read_as_arrow_table,
    )

    db = tmp_path / "virtual.db"
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE zz (a INTEGER)")
    conn.execute("INSERT INTO zz VALUES (1)")
    conn.execute("CREATE TABLE aaa_geo (x)")
    conn.commit()
    # Rewrite the schema so the first table needs a module this build lacks
    conn.execute("PRAGMA writable_schema=ON")
    conn.execute(
        "UPDATE sqlite_master SET sql = "
        "'CREATE VIRTUAL TABLE aaa_geo USING zzz_no_such_module(x)' "
        "WHERE name = 'aaa_geo'"
    )
    conn.commit()
    conn.close()

    # It is listed, so the frontend offers it as a tab
    assert list_sqlite_tables(str(db)) == ["aaa_geo", "zz"]
    with pytest.raises(ValueError):
        read_as_arrow_table(str(db))
    # The readable table is unaffected
    assert len(read_as_arrow_table(str(db), "zz")) == 1


def test_sniff_does_not_block_on_fifo(tmp_path):
    """A named pipe returns None instead of blocking the handler.

    Bounded on purpose: without the is-a-regular-file guard, `open()` on a
    writerless FIFO blocks forever, and an unbounded assertion would wedge the
    whole suite until the CI wall clock killed it rather than naming a failure.
    """
    import threading

    from jupyterlab_tabular_data_viewer_extension.readers import sniff_file_type

    fifo = tmp_path / "feed.csv"
    os.mkfifo(fifo)

    # A daemon thread, deliberately not a ThreadPoolExecutor: the pool's
    # __exit__ calls shutdown(wait=True), which joins a worker still blocked in
    # open() and never returns, so the bound would be illusory and the whole
    # suite would hang - the very outcome this test exists to convert into a
    # named failure. Daemon threads are never joined at interpreter exit.
    result = []
    worker = threading.Thread(
        target=lambda: result.append(sniff_file_type(str(fifo))), daemon=True
    )
    worker.start()
    worker.join(5)

    assert not worker.is_alive(), "sniff_file_type blocked on a FIFO"
    assert result == [None]


def test_get_file_type_per_format():
    """get_file_type resolves every supported format"""
    from jupyterlab_tabular_data_viewer_extension.readers import get_file_type

    assert get_file_type(str(DATA_DIR / "sample_database.db")) == "sqlite"
    assert get_file_type(str(DATA_DIR / "sample_data.parquet")) == "parquet"
    assert get_file_type(str(DATA_DIR / "sample_data.xlsx")) == "excel"
    assert get_file_type(str(DATA_DIR / "sample_data.csv")) == "csv"
    assert get_file_type(str(DATA_DIR / "sample_data.tsv")) == "tsv"


def test_detection_is_content_based_not_extension(tmp_path):
    """A SQLite database renamed to .txt is still detected as sqlite"""
    from jupyterlab_tabular_data_viewer_extension.readers import (
        get_file_type,
        list_sqlite_tables,
        sniff_file_type,
    )

    disguised = tmp_path / "not_a_database.txt"
    shutil.copy(DATA_DIR / "sample_database.db", disguised)

    assert sniff_file_type(str(disguised)) == "sqlite"
    assert get_file_type(str(disguised)) == "sqlite"
    # And it is genuinely readable under the wrong extension
    assert list_sqlite_tables(str(disguised)) == [
        "attachments",
        "customers",
        "mixed_types",
        "orders",
    ]


def test_plain_text_named_db_is_not_sqlite(tmp_path):
    """A plain-text file named .db is NOT detected as sqlite"""
    from jupyterlab_tabular_data_viewer_extension.readers import (
        get_file_type,
        list_sqlite_tables,
        sniff_file_type,
    )

    impostor = tmp_path / "notes.db"
    impostor.write_text("this is not a database, just prose\n")

    assert sniff_file_type(str(impostor)) is None
    assert get_file_type(str(impostor)) == "unknown"
    assert list_sqlite_tables(str(impostor)) == []


# ---------------------------------------------------------------------------
# Unit tests: SQLite reader
# ---------------------------------------------------------------------------


def test_list_sqlite_tables_excludes_system_tables(tmp_path):
    """User tables in name order; sqlite_sequence filtered out"""
    import sqlite3

    from jupyterlab_tabular_data_viewer_extension.readers import list_sqlite_tables

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    # Guard against a vacuous pass: sqlite_sequence must really be in the file
    with sqlite3.connect(str(target)) as conn:
        raw = sorted(
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        )
    conn.close()
    assert raw == [
        "attachments",
        "customers",
        "mixed_types",
        "orders",
        "sqlite_sequence",
    ]

    assert list_sqlite_tables(str(target)) == [
        "attachments",
        "customers",
        "mixed_types",
        "orders",
    ]


def test_read_sqlite_default_first_table(tmp_path):
    """table=None reads the first user table alphabetically (attachments)"""
    from jupyterlab_tabular_data_viewer_extension.readers import read_as_arrow_table

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    t = read_as_arrow_table(str(target))
    assert t.column_names == ["attachment_id", "order_id", "filename", "content"]
    assert len(t) == 4


def test_read_sqlite_named_table(tmp_path):
    """A named table reads that table's columns and row count"""
    from jupyterlab_tabular_data_viewer_extension.readers import read_as_arrow_table

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    customers = read_as_arrow_table(str(target), "customers")
    assert customers.column_names == [
        "customer_id",
        "name",
        "city",
        "signup_date",
        "lifetime_value",
        "orders_count",
    ]
    assert len(customers) == 12
    assert customers.column("name").to_pylist()[0] == "Ada Lovelace"
    assert customers.column("name").to_pylist()[-1] == "Frances Allen"

    orders = read_as_arrow_table(str(target), "orders")
    assert orders.column_names == [
        "order_id",
        "customer_id",
        "product",
        "quantity",
        "unit_price",
        "ordered_at",
    ]
    assert len(orders) == 30
    assert orders.column("order_id").to_pylist() == list(range(1, 31))


def test_read_sqlite_unknown_table_raises(tmp_path):
    """An unknown table name raises ValueError (whitelist validation)"""
    import pytest

    from jupyterlab_tabular_data_viewer_extension.readers import (
        _read_sqlite,
        read_as_arrow_table,
    )

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    with pytest.raises(ValueError, match="Table not found: no_such_table"):
        _read_sqlite(str(target), "no_such_table")

    # The system table is not reachable either - it is not in the whitelist
    with pytest.raises(ValueError, match="Table not found: sqlite_sequence"):
        read_as_arrow_table(str(target), "sqlite_sequence")


def test_read_sqlite_blob_placeholder(tmp_path):
    """BLOB cells render as '<BLOB size>' strings, never raw bytes"""
    from jupyterlab_tabular_data_viewer_extension.readers import read_as_arrow_table
    from jupyterlab_tabular_data_viewer_extension.routes import normalize_arrow_type

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    t = read_as_arrow_table(str(target), "attachments")
    type_by_name = {f.name: normalize_arrow_type(str(f.type)) for f in t.schema}
    assert type_by_name["content"] == "string", "BLOB column must arrive as strings"

    content = t.column("content").to_pylist()
    assert all(isinstance(v, str) for v in content)
    assert all(v.startswith("<BLOB ") for v in content)
    # 256 / 1024 / 4096 / 16384 bytes
    assert content == [
        "<BLOB 256 B>",
        "<BLOB 1 KB>",
        "<BLOB 4 KB>",
        "<BLOB 16 KB>",
    ]
    assert t.column("filename").to_pylist() == [
        "invoice_0003.pdf",
        "packing_slip_0011.pdf",
        "warranty_0017.pdf",
        "manual_0026.pdf",
    ]


def test_sqlite_cascade_mixed_type_column(tmp_path):
    """A column mixing INTEGER and TEXT falls back to string via the cascade"""
    from jupyterlab_tabular_data_viewer_extension.readers import read_as_arrow_table
    from jupyterlab_tabular_data_viewer_extension.routes import normalize_arrow_type

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    t = read_as_arrow_table(str(target), "mixed_types")
    assert len(t) == 6
    type_by_name = {f.name: normalize_arrow_type(str(f.type)) for f in t.schema}
    # Raw Arrow may report large_string - normalize before comparing
    assert type_by_name["measurement"] == "string", (
        "mixed int/text column must fall back to string"
    )
    assert type_by_name["record_id"] == "int64"
    assert t.column("measurement").to_pylist() == [
        "42",
        "n/a",
        "17",
        "pending",
        "3",
        "1250",
    ]


def test_sqlite_read_does_not_mutate_file(tmp_path):
    """Read-only connection: mtime and size unchanged after reads"""
    from jupyterlab_tabular_data_viewer_extension.readers import (
        list_sqlite_tables,
        read_as_arrow_table,
    )

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    before = target.stat()
    list_sqlite_tables(str(target))
    for name in ("attachments", "customers", "mixed_types", "orders"):
        read_as_arrow_table(str(target), name)
    after = target.stat()

    assert after.st_size == before.st_size
    assert after.st_mtime == before.st_mtime
    # No journal or WAL side files left behind either
    assert sorted(p.name for p in tmp_path.iterdir()) == ["sample_database.db"]


# ---------------------------------------------------------------------------
# HTTP: sourceType, sqlite sheets, sqlite table param, sqlite download
# ---------------------------------------------------------------------------


async def _metadata(jp_fetch, jp_root_dir, filename, **body):
    """Helper: copy a data/ fixture into the server root and POST /metadata"""
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / filename, target_dir / filename)

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "metadata",
        method="POST",
        body=json.dumps({"path": f"data/{filename}", **body}),
    )
    assert response.code == 200
    return json.loads(response.body)


async def test_metadata_source_type_every_format(jp_fetch, jp_root_dir):
    """Metadata reports the raw file type for every supported format"""
    expected = {
        "sample_database.db": "sqlite",
        "sample_data.parquet": "parquet",
        "sample_data.xlsx": "excel",
        "sample_data.csv": "csv",
        "sample_data.tsv": "tsv",
    }
    for filename, source_type in expected.items():
        metadata = await _metadata(jp_fetch, jp_root_dir, filename)
        assert metadata["sourceType"] == source_type, (
            f"{filename} should report sourceType '{source_type}'"
        )


async def test_metadata_returns_tables_as_sheets_for_sqlite(jp_fetch, jp_root_dir):
    """SQLite metadata exposes user tables in the sheets array, no system table"""
    metadata = await _metadata(jp_fetch, jp_root_dir, "sample_database.db")

    assert metadata["sheets"] == [
        "attachments",
        "customers",
        "mixed_types",
        "orders",
    ]
    assert "sqlite_sequence" not in metadata["sheets"]
    # Default table is the first alphabetically
    assert [c["name"] for c in metadata["columns"]] == [
        "attachment_id",
        "order_id",
        "filename",
        "content",
    ]
    assert metadata["totalRows"] == 4


async def test_metadata_with_sqlite_table_param(jp_fetch, jp_root_dir):
    """Metadata with sheet=<table> returns that table's columns and row count"""
    metadata = await _metadata(
        jp_fetch, jp_root_dir, "sample_database.db", sheet="customers"
    )

    assert [c["name"] for c in metadata["columns"]] == [
        "customer_id",
        "name",
        "city",
        "signup_date",
        "lifetime_value",
        "orders_count",
    ]
    assert metadata["totalRows"] == 12
    assert metadata["sourceType"] == "sqlite"
    assert metadata["sheets"] == [
        "attachments",
        "customers",
        "mixed_types",
        "orders",
    ]


async def test_metadata_unknown_sqlite_table_is_400(jp_fetch, jp_root_dir):
    """An unknown table name surfaces as HTTP 400 with the ValueError message"""
    import pytest
    from tornado.httpclient import HTTPClientError

    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    with pytest.raises(HTTPClientError) as excinfo:
        await jp_fetch(
            "jupyterlab-tabular-data-viewer-extension",
            "metadata",
            method="POST",
            body=json.dumps(
                {"path": "data/sample_database.db", "sheet": "no_such_table"}
            ),
        )
    assert excinfo.value.code == 400
    body = json.loads(excinfo.value.response.body)
    assert body["error"] == "Table not found: no_such_table"


async def test_data_endpoint_with_sqlite_table(jp_fetch, jp_root_dir):
    """Data endpoint reads only the requested SQLite table"""
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "data",
        method="POST",
        body=json.dumps(
            {
                "path": "data/sample_database.db",
                "sheet": "orders",
                "offset": 0,
                "limit": 100,
                "filters": {},
            }
        ),
    )

    assert response.code == 200
    result = json.loads(response.body)
    assert result["totalRows"] == 30
    assert len(result["data"]) == 30
    first = result["data"][0]
    assert first["order_id"] == 1
    assert first["customer_id"] == 1
    assert first["product"] == "Keyboard"
    assert first["quantity"] == 1
    assert first["unit_price"] == 49.99
    assert first["ordered_at"] == "2024-01-01 09:00:00"


async def test_data_endpoint_sqlite_blob_placeholder(jp_fetch, jp_root_dir):
    """The /data endpoint serves BLOB placeholders, never raw binary"""
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "data",
        method="POST",
        body=json.dumps(
            {
                "path": "data/sample_database.db",
                "sheet": "attachments",
                "offset": 0,
                "limit": 100,
                "filters": {},
            }
        ),
    )

    assert response.code == 200
    result = json.loads(response.body)
    assert result["totalRows"] == 4
    assert [row["content"] for row in result["data"]] == [
        "<BLOB 256 B>",
        "<BLOB 1 KB>",
        "<BLOB 4 KB>",
        "<BLOB 16 KB>",
    ]


async def test_download_sqlite_table_filename(jp_fetch, jp_root_dir):
    """SQLite download slugifies the table name: sample_database_orders.csv"""
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    response, filename, _ = await _download(
        jp_fetch,
        path="data/sample_database.db",
        format="csv",
        sheet="orders",
    )
    assert response.code == 200
    assert filename == "sample_database_orders.csv"

    body = response.body.decode("utf-8")
    lines = [line for line in body.splitlines() if line]
    # header + 30 order rows
    assert len(lines) == 31
    assert lines[0].startswith("order_id,customer_id,product")


async def test_download_sqlite_original_format_is_400(jp_fetch, jp_root_dir):
    """'original' on SQLite is rejected, not attempted.

    format_map sends "original" to (file_type, source_ext), which for a
    database is the unwritable output format "sqlite". The export popup hides
    the entry for SQLite sources, so this guard is unreachable through the UI -
    it is pinned here so it stays a deliberate 400 rather than decaying into a
    500 from a half-written .db.
    """
    import pytest
    from tornado.httpclient import HTTPClientError

    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    with pytest.raises(HTTPClientError) as excinfo:
        await _download(
            jp_fetch,
            path="data/sample_database.db",
            format="original",
            sheet="orders",
        )
    assert excinfo.value.code == 400
    assert b"Unhandled output format: sqlite" in excinfo.value.response.body


# ---------------------------------------------------------------------------
# Progressive load: BLOB placeholders built in SQL, row windows pushed down.
# ---------------------------------------------------------------------------


def _blob_db(path, sizes):
    """A one-table database whose `payload` column holds BLOBs of `sizes`."""
    import sqlite3

    conn = sqlite3.connect(str(path))
    try:
        conn.execute("CREATE TABLE payloads (id INTEGER, payload BLOB)")
        conn.executemany(
            "INSERT INTO payloads VALUES (?, ?)",
            [(i, b"\x00" * n) for i, n in enumerate(sizes)],
        )
        conn.commit()
    finally:
        conn.close()


def test_blob_bytes_are_never_materialised(tmp_path):
    """Reading a BLOB table allocates placeholder text, not the BLOB payload.

    The placeholder used to be produced by mapping over the pandas column,
    which meant every byte was read and then thrown away - 410 MB per request
    on the database that prompted this. Building it in SQL keeps the payload
    inside SQLite, so peak allocation must stay far below the BLOB total.
    """
    import tracemalloc

    from jupyterlab_tabular_data_viewer_extension.readers import _read_sqlite

    target = tmp_path / "blobs.db"
    blob_total = 24 * 1024 * 1024
    _blob_db(target, [1024 * 1024] * 24)

    tracemalloc.start()
    try:
        table = _read_sqlite(str(target))
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()

    assert len(table) == 24
    assert all(v == "<BLOB 1 MB>" for v in table.column("payload").to_pylist())
    # Generous bound: a tenth of the payload. The pandas-side implementation
    # allocated more than the payload itself.
    assert peak < blob_total // 10, (
        f"peak allocation {peak:,} B suggests the {blob_total:,} B of BLOB "
        "payload was materialised"
    )


@pytest.mark.parametrize(
    "size,expected",
    [
        (0, "0 B"),
        (1, "1 B"),
        (512, "512 B"),
        (1023, "1023 B"),
        (1024, "1 KB"),
        (1025, "1 KB"),
        (1280, "1.3 KB"),          # 1.25 exactly - rounds half away from zero
        (1536, "1.5 KB"),
        (10 * 1024, "10 KB"),
        (1023 * 1024, "1023 KB"),
        (1048575, "1024 KB"),      # just under a megabyte
        (1048576, "1 MB"),
        (1310720, "1.3 MB"),       # 1.25 MB exactly
        (3 * 1024 * 1024, "3 MB"),
    ],
)
def test_blob_placeholder_size_rendering(tmp_path, size, expected):
    """The rendered placeholder is pinned to literal expected strings.

    Deliberately not compared against a Python reimplementation of the format:
    the previous version of this test did exactly that and was green while the
    two implementations disagreed on 5,118 sizes, because none of its sampled
    sizes was a half-way value. It would also have passed with the SQL fix
    reverted, since the Python formatter would then have been on both sides of
    the comparison. Literal expectations cannot do either.
    """
    from jupyterlab_tabular_data_viewer_extension.readers import _read_sqlite

    target = tmp_path / f"blob_{size}.db"
    _blob_db(target, [size])

    value = _read_sqlite(str(target)).column("payload").to_pylist()[0]
    assert value == f"<BLOB {expected}>"


def test_blob_column_null_and_mixed_affinity(tmp_path):
    """NULL stays NULL, text stays verbatim, only real BLOBs get a placeholder"""
    import sqlite3

    from jupyterlab_tabular_data_viewer_extension.readers import _read_sqlite

    target = tmp_path / "mixed_blob.db"
    conn = sqlite3.connect(str(target))
    try:
        conn.execute("CREATE TABLE items (label TEXT, payload BLOB)")
        conn.executemany(
            "INSERT INTO items VALUES (?, ?)",
            [
                ("null row", None),
                ("empty blob", b""),
                ("real blob", b"\x00" * 2048),
                ("text in blob column", "not binary"),
                ("number in blob column", 42),
            ],
        )
        conn.commit()
    finally:
        conn.close()

    payload = _read_sqlite(str(target)).column("payload").to_pylist()
    assert payload[0] is None, "NULL must not become a placeholder"
    assert payload[1] == "<BLOB 0 B>"
    assert payload[2] == "<BLOB 2 KB>"
    assert payload[3] == "not binary", "text in a BLOB column passes through"
    assert payload[4] == "42", "a number in a mixed column casts, not placeholders"


def test_sqlite_column_name_requiring_quoting(tmp_path):
    """Awkward column names survive the generated select list"""
    import sqlite3

    from jupyterlab_tabular_data_viewer_extension.readers import _read_sqlite

    target = tmp_path / "awkward.db"
    conn = sqlite3.connect(str(target))
    try:
        conn.execute(
            'CREATE TABLE weird ("with space" TEXT, "quote""inside" TEXT, '
            '"select" TEXT, "payload" BLOB)'
        )
        conn.execute("INSERT INTO weird VALUES ('a', 'b', 'c', ?)", (b"\x00" * 512,))
        conn.commit()
    finally:
        conn.close()

    table = _read_sqlite(str(target))
    assert table.column_names == [
        "with space",
        'quote"inside',
        "select",
        "payload",
    ]
    assert table.column("with space").to_pylist() == ["a"]
    assert table.column('quote"inside').to_pylist() == ["b"]
    assert table.column("select").to_pylist() == ["c"]
    assert table.column("payload").to_pylist() == ["<BLOB 512 B>"]





async def _sqlite_page(jp_fetch, **body):
    """POST /data against the sample database, returning the parsed payload."""
    payload = {
        "path": "data/sample_database.db",
        "sheet": "orders",
        "offset": 0,
        "limit": 10,
        "filters": {},
    }
    payload.update(body)
    response = await jp_fetch(
        "jupyterlab-tabular-data-viewer-extension",
        "data",
        method="POST",
        body=json.dumps(payload),
    )
    assert response.code == 200
    return json.loads(response.body)


async def test_data_endpoint_row_indices_continue_across_pages(jp_fetch, jp_root_dir):
    """Pushed-down pages keep numbering rows from their offset, not from 1.

    The row index is computed after the read, so a windowed read that restarted
    the numbering would label every page 1..n and silently mislabel every row
    past the first page.
    """
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    first = await _sqlite_page(jp_fetch, offset=0, limit=10)
    second = await _sqlite_page(jp_fetch, offset=10, limit=10)
    third = await _sqlite_page(jp_fetch, offset=25, limit=10)

    assert first["totalRows"] == 30
    assert second["totalRows"] == 30
    assert [row["__row_index__"] for row in first["data"]] == list(range(1, 11))
    assert [row["__row_index__"] for row in second["data"]] == list(range(11, 21))
    assert [row["__row_index__"] for row in third["data"]] == list(range(26, 31))
    assert first["hasMore"] is True
    assert third["hasMore"] is False

    # The window is the page, so order_id tracks the offset
    assert [row["order_id"] for row in second["data"]] == list(range(11, 21))


async def test_data_endpoint_sort_is_global_not_page_local(jp_fetch, jp_root_dir):
    """Sorting orders the whole table before the page is cut.

    Asserted against the true global ordering rather than against the first
    page's maximum: the fixture's largest unit_price also happens to sit in the
    first ten rows, so a page-local sort would have passed that check.
    """
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    every_row = await _sqlite_page(jp_fetch, offset=0, limit=1000)
    expected = sorted(
        (row["unit_price"] for row in every_row["data"]), reverse=True
    )[:10]

    sorted_page = await _sqlite_page(
        jp_fetch, offset=0, limit=10, sortBy="unit_price", sortOrder="desc"
    )
    assert sorted_page["totalRows"] == 30
    assert [row["unit_price"] for row in sorted_page["data"]] == expected

    # The second sorted page continues the global ordering rather than
    # restarting within its own window
    second = await _sqlite_page(
        jp_fetch, offset=10, limit=10, sortBy="unit_price", sortOrder="desc"
    )
    all_desc = sorted((r["unit_price"] for r in every_row["data"]), reverse=True)
    assert [row["unit_price"] for row in second["data"]] == all_desc[10:20]


async def test_data_endpoint_filter_is_global_not_page_local(jp_fetch, jp_root_dir):
    """Filtering matches across the whole table, not just the first window"""
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    filtered = await _sqlite_page(
        jp_fetch,
        offset=0,
        limit=10,
        filters={"product": {"type": "text", "value": "Monitor"}},
    )

    assert filtered["totalRows"] > 0
    assert all(row["product"] == "Monitor" for row in filtered["data"])
    # Matches exist beyond the first unfiltered window, so a page-local filter
    # would have found fewer of them
    all_rows = await _sqlite_page(jp_fetch, offset=0, limit=1000)
    expected = sum(1 for row in all_rows["data"] if row["product"] == "Monitor")
    assert filtered["totalRows"] == expected
    assert any(
        row["__row_index__"] > 10 for row in all_rows["data"]
        if row["product"] == "Monitor"
    ), "fixture no longer exercises matches past the first page"


def test_nullable_column_type_is_stable_across_any_row_window(tmp_path):
    """A column's arrow type must not depend on which rows were read.

    This pins the invariant that killed the LIMIT/OFFSET pushdown (DEF-3) by
    demonstrating the mismatch itself, not merely the full read: pandas types a
    nullable INTEGER column int64 from a window whose rows happen to be
    non-null, and float64 from the whole table, so the same cell renders 0 on
    one page and 0.0 on another. Any future attempt to serve a page from a SQL
    window has to make these two agree.
    """
    import sqlite3

    import pandas as pd

    from jupyterlab_tabular_data_viewer_extension.readers import (
        _df_to_arrow,
        _read_sqlite,
    )

    target = tmp_path / "nullable.db"
    conn = sqlite3.connect(str(target))
    try:
        conn.execute("CREATE TABLE readings (v INTEGER)")
        # Ten non-null rows, then a null - a first page sees only the integers
        conn.executemany(
            "INSERT INTO readings VALUES (?)", [(i,) for i in range(10)] + [(None,)]
        )
        conn.commit()
    finally:
        conn.close()

    full = _read_sqlite(str(target))
    assert len(full) == 11
    assert str(full.schema.field("v").type) == "double"
    assert full.column("v").to_pylist()[:3] == [0.0, 1.0, 2.0]
    assert full.column("v").to_pylist()[-1] is None

    # The window the pushdown would have served, read the same way the reader
    # reads: it disagrees, which is exactly why the pushdown was reverted
    conn = sqlite3.connect(str(target))
    try:
        windowed = _df_to_arrow(
            pd.read_sql_query("SELECT v FROM readings LIMIT 10", conn)
        )
    finally:
        conn.close()

    assert str(windowed.schema.field("v").type) == "int64"
    assert windowed.column("v").to_pylist()[:3] == [0, 1, 2]
    assert str(windowed.schema.field("v").type) != str(full.schema.field("v").type), (
        "the window and the full read now agree - if that is a deliberate "
        "improvement, DEF-3 can be reopened and the pushdown reconsidered"
    )


# ---------------------------------------------------------------------------
# Read cache
# ---------------------------------------------------------------------------


def test_cache_serves_repeat_reads_from_memory(tmp_path):
    """A second read of an unchanged file returns the identical table object.

    Identity is the proof: every reader builds a fresh arrow table, so the same
    object coming back twice can only have come from the cache. It also matters
    on its own - the handlers slice and filter this object, and arrow tables are
    immutable, so sharing one instance across requests is safe.
    """
    from jupyterlab_tabular_data_viewer_extension import readers

    readers._cache_clear()
    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    first = readers.read_as_arrow_table(str(target), "customers")
    second = readers.read_as_arrow_table(str(target), "customers")

    assert second is first, "second read did not come from the cache"
    assert len(second) == 12

    # A cleared cache must rebuild rather than keep serving the old object
    readers._cache_clear()
    third = readers.read_as_arrow_table(str(target), "customers")
    assert third is not first
    assert third.to_pylist() == first.to_pylist()


def test_cache_key_separates_tables_of_one_database(tmp_path):
    """Two tables of the same file are cached independently"""
    from jupyterlab_tabular_data_viewer_extension import readers

    readers._cache_clear()
    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    customers = readers.read_as_arrow_table(str(target), "customers")
    orders = readers.read_as_arrow_table(str(target), "orders")

    assert len(customers) == 12
    assert len(orders) == 30
    assert readers.read_as_arrow_table(str(target), "customers") is customers
    assert readers.read_as_arrow_table(str(target), "orders") is orders


def test_cache_invalidates_on_modification(tmp_path):
    """An edited file is re-read, and its stale entry does not linger"""
    import sqlite3
    import time

    from jupyterlab_tabular_data_viewer_extension import readers

    readers._cache_clear()
    target = tmp_path / "edited.db"
    conn = sqlite3.connect(str(target))
    try:
        conn.execute("CREATE TABLE t (v INTEGER)")
        conn.executemany("INSERT INTO t VALUES (?)", [(i,) for i in range(5)])
        conn.commit()
    finally:
        conn.close()

    before = readers.read_as_arrow_table(str(target), "t")
    assert len(before) == 5

    # mtime_ns has nanosecond resolution but a coarse filesystem clock could
    # still land on the same tick; the row count changes the size too
    time.sleep(0.01)
    conn = sqlite3.connect(str(target))
    try:
        conn.executemany("INSERT INTO t VALUES (?)", [(i,) for i in range(5, 40)])
        conn.commit()
    finally:
        conn.close()

    after = readers.read_as_arrow_table(str(target), "t")
    assert len(after) == 40, "edited file served a stale cached table"
    assert after is not before

    # The superseded entry was dropped rather than left resident
    assert len([k for k in readers._CACHE if k[0] == os.path.abspath(str(target))]) == 1



def test_cache_skips_a_table_larger_than_the_whole_budget(tmp_path, monkeypatch):
    """An oversized table is served but not cached, rather than thrashing"""
    from jupyterlab_tabular_data_viewer_extension import readers

    readers._cache_clear()
    monkeypatch.setattr(readers, "_CACHE_MAX_BYTES", 16)

    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    table = readers.read_as_arrow_table(str(target), "customers")
    assert len(table) == 12
    assert len(readers._CACHE) == 0, "oversized table should not be cached"

    # And it is still served correctly on the next call
    assert len(readers.read_as_arrow_table(str(target), "customers")) == 12


def test_empty_and_single_row_tables(tmp_path):
    """A zero-row table keeps its columns; a one-row table reads back one row"""
    import sqlite3

    from jupyterlab_tabular_data_viewer_extension.readers import _read_sqlite

    target = tmp_path / "edges.db"
    conn = sqlite3.connect(str(target))
    try:
        conn.execute("CREATE TABLE aempty (id INTEGER, label TEXT, payload BLOB)")
        conn.execute("CREATE TABLE bsingle (id INTEGER, label TEXT)")
        conn.execute("INSERT INTO bsingle VALUES (1, 'only')")
        conn.commit()
    finally:
        conn.close()

    empty = _read_sqlite(str(target), "aempty")
    assert len(empty) == 0
    assert empty.column_names == ["id", "label", "payload"], (
        "an empty table must still report its columns, or the grid renders headerless"
    )

    single = _read_sqlite(str(target), "bsingle")
    assert len(single) == 1
    assert single.to_pylist() == [{"id": 1, "label": "only"}]


async def test_download_carries_blob_placeholders_not_binary(jp_fetch, jp_root_dir):
    """Exports contain the placeholder string, never raw BLOB bytes"""
    target_dir = jp_root_dir / "data"
    target_dir.mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "sample_database.db", target_dir / "sample_database.db")

    for fmt, needle in (("csv", b"<BLOB 256 B>"), ("jsonl", b"<BLOB 256 B>")):
        response, _filename, _qs = await _download(
            jp_fetch,
            path="data/sample_database.db",
            format=fmt,
            sheet="attachments",
        )
        assert response.code == 200
        body = response.body
        assert needle in body, f"{fmt} export lost the BLOB placeholder"
        # The fixture's BLOBs are runs of a repeating byte pattern; none of that
        # may reach the exported file
        assert b"\x00\x00\x00\x00" not in body, f"{fmt} export leaked raw BLOB bytes"


def test_generated_columns_are_not_dropped(tmp_path):
    """Generated columns must appear, exactly as `SELECT *` returns them.

    Building the select list from `PRAGMA table_info` silently omitted STORED
    and VIRTUAL generated columns - the column vanished from the grid with no
    error and no log line. `table_xinfo` with `hidden != 1` reproduces `*`.
    """
    import sqlite3

    from jupyterlab_tabular_data_viewer_extension.readers import _read_sqlite

    target = tmp_path / "generated.db"
    conn = sqlite3.connect(str(target))
    try:
        conn.execute(
            "CREATE TABLE t ("
            " a INTEGER, b INTEGER,"
            " stored_total INTEGER GENERATED ALWAYS AS (a + b) STORED,"
            " virtual_product INTEGER GENERATED ALWAYS AS (a * b) VIRTUAL)"
        )
        conn.execute("INSERT INTO t (a, b) VALUES (2, 3)")
        conn.commit()
        star = [d[0] for d in conn.execute("SELECT * FROM t").description]
    finally:
        conn.close()

    table = _read_sqlite(str(target), "t")
    assert table.column_names == star, "reader disagrees with SELECT *"
    assert table.column_names == ["a", "b", "stored_total", "virtual_product"]
    assert table.column("stored_total").to_pylist() == [5]
    assert table.column("virtual_product").to_pylist() == [6]


def test_cache_sees_a_wal_commit_from_an_open_writer(tmp_path):
    """A WAL commit invalidates the cache even with the main file untouched.

    A writer holding its connection open commits into the -wal sidecar without
    checkpointing, so the main file's mtime and size are unchanged. Keyed on
    those alone the cache served superseded rows, and re-reading could not cure
    it because a reopen produced the same key.
    """
    import sqlite3

    from jupyterlab_tabular_data_viewer_extension import readers

    readers._cache_clear()
    target = tmp_path / "wal.db"
    setup = sqlite3.connect(str(target))
    try:
        setup.execute("PRAGMA journal_mode=WAL")
        setup.execute("CREATE TABLE t (v INTEGER)")
        setup.execute("INSERT INTO t VALUES (1)")
        setup.commit()
    finally:
        setup.close()

    assert len(readers.read_as_arrow_table(str(target), "t")) == 1
    before = os.stat(str(target))

    writer = sqlite3.connect(str(target))
    try:
        writer.execute("INSERT INTO t VALUES (2)")
        writer.commit()
        after = os.stat(str(target))
        # The premise of the test: the main file really is untouched
        assert before.st_mtime_ns == after.st_mtime_ns
        assert before.st_size == after.st_size

        assert len(readers.read_as_arrow_table(str(target), "t")) == 2, (
            "cache served rows superseded by an un-checkpointed WAL commit"
        )
    finally:
        writer.close()


def test_cache_byte_counter_tracks_contents_and_recency_is_lru(tmp_path):
    """_CACHE_BYTES matches the resident tables, and eviction is LRU not FIFO"""
    from jupyterlab_tabular_data_viewer_extension import readers

    readers._cache_clear()
    target = tmp_path / "sample_database.db"
    shutil.copy(DATA_DIR / "sample_database.db", target)

    readers.read_as_arrow_table(str(target), "attachments")
    readers.read_as_arrow_table(str(target), "customers")
    assert readers._CACHE_BYTES == sum(t.nbytes for t in readers._CACHE.values())

    # Size the budget so that exactly attachments + orders fit. Measured, not
    # guessed: an under-sized budget would make `orders` skip caching entirely
    # (the oversized path) and evict nothing, which would pass for the wrong
    # reason.
    sizes = {
        name: readers.read_as_arrow_table(str(target), name).nbytes
        for name in ("attachments", "customers", "orders")
    }
    readers._cache_clear()
    readers.read_as_arrow_table(str(target), "attachments")
    readers.read_as_arrow_table(str(target), "customers")
    # Touch the oldest so it becomes the most recently used
    readers.read_as_arrow_table(str(target), "attachments")

    saved = readers._CACHE_MAX_BYTES
    readers._CACHE_MAX_BYTES = sizes["attachments"] + sizes["orders"]
    try:
        readers.read_as_arrow_table(str(target), "orders")
    finally:
        readers._CACHE_MAX_BYTES = saved

    resident = {k[1] for k in readers._CACHE}
    assert "orders" in resident, "the new table was not cached at all"
    assert "attachments" in resident, (
        "the re-read entry was evicted, so eviction is FIFO rather than LRU"
    )
    assert "customers" not in resident
    assert readers._CACHE_BYTES == sum(t.nbytes for t in readers._CACHE.values())

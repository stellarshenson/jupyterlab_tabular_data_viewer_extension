import json
import shutil
from pathlib import Path


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

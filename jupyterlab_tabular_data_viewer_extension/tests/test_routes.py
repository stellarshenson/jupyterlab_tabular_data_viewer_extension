import json
import os
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

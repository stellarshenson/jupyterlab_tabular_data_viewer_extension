#!/usr/bin/env python3
"""Print the number of data rows in a tabular file, one integer on stdout.

Used by the galata export tests: a browser download lands as bytes, and the
only honest way to check an export covered the whole table is to parse it back
and count. Dispatch is on the file extension, which is what the download's
Content-Disposition filename carries.

CSV and TSV are parsed rather than line-counted, because a quoted field may
hold a newline and a line count would then over-report.
"""

import csv
import sys
import os


def count(path):
    ext = os.path.splitext(path)[1].lower()

    if ext == ".parquet":
        import pyarrow.parquet as pq

        # Footer only - reading the table would materialise every row, which on
        # a large export would OOM the counter rather than the code under test
        return pq.ParquetFile(path).metadata.num_rows

    if ext == ".xlsx":
        import openpyxl

        book = openpyxl.load_workbook(path, read_only=True)
        try:
            return max(book.worksheets[0].max_row - 1, 0)
        finally:
            book.close()

    if ext == ".jsonl":
        with open(path, encoding="utf-8") as fh:
            return sum(1 for line in fh if line.strip())

    if ext in (".csv", ".tsv"):
        delimiter = "\t" if ext == ".tsv" else ","
        with open(path, encoding="utf-8", newline="") as fh:
            rows = sum(1 for row in csv.reader(fh, delimiter=delimiter) if row)
        return max(rows - 1, 0)

    raise SystemExit("cannot count rows in %s" % ext)


if __name__ == "__main__":
    print(count(sys.argv[1]))

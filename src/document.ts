import { DocumentWidget } from '@jupyterlab/docregistry';
import { ParquetViewer } from './widget';

/**
 * A document widget for Parquet files
 */
export class ParquetDocument extends DocumentWidget<ParquetViewer> {
  constructor(options: DocumentWidget.IOptions<ParquetViewer>) {
    super(options);
  }
}

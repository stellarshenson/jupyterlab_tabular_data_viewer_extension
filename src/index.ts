import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  IDocumentWidget,
  DocumentRegistry,
  ABCWidgetFactory
} from '@jupyterlab/docregistry';

import { ParquetViewer } from './widget';
import { ParquetDocument } from './document';

/**
 * A widget factory for Parquet files
 */
class ParquetWidgetFactory extends ABCWidgetFactory<
  IDocumentWidget<ParquetViewer>
> {
  /**
   * Create a new widget given a context
   */
  protected createNewWidget(
    context: DocumentRegistry.Context
  ): IDocumentWidget<ParquetViewer> {
    const content = new ParquetViewer(context.path);
    const widget = new ParquetDocument({ content, context });
    widget.title.label = context.path.split('/').pop() || 'Parquet File';
    return widget;
  }
}

/**
 * Initialization data for the jupyterlab_basic_parquet_viewer_extension extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'jupyterlab_basic_parquet_viewer_extension:plugin',
  description:
    'Jupyterlab extension to allow simple browsing of the parquet files with basic data filtering capabilities',
  autoStart: true,
  requires: [],
  activate: (app: JupyterFrontEnd) => {
    console.log(
      'JupyterLab extension jupyterlab_basic_parquet_viewer_extension is activated!'
    );

    const { docRegistry } = app;

    // Register the file type - mark as binary to prevent text loading
    try {
      docRegistry.addFileType({
        name: 'parquet',
        displayName: 'Parquet',
        extensions: ['.parquet'],
        mimeTypes: ['application/x-parquet'],
        iconClass: 'jp-MaterialIcon jp-SpreadsheetIcon',
        contentType: 'file',
        fileFormat: 'base64'
      });
      console.log('Parquet file type registered with base64 format');
    } catch (e) {
      console.warn('Parquet file type already registered', e);
    }

    // Create widget factory - use base64 model to handle binary files
    const factory = new ParquetWidgetFactory({
      name: 'Parquet Viewer',
      modelName: 'base64',
      fileTypes: ['parquet'],
      defaultFor: ['parquet'],
      defaultRendered: ['parquet'],
      readOnly: true
    });

    // Register the factory
    docRegistry.addWidgetFactory(factory);

    console.log('Parquet viewer factory registered with base64 model');
  }
};

export default plugin;
